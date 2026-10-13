import OpenAI from 'openai';
import { parseJsonLoose } from '../extract/schema.js';
import { ProviderError, type CompletionRequest, type CompletionResult, type Provider } from './types.js';

export const OPENAI_DEFAULT_MODEL = 'gpt-5.5';

export function createOpenAIProvider(opts: { apiKey: string; model?: string; baseURL?: string; fetch?: typeof fetch; timeoutMs?: number }): Provider {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    maxRetries: 1,
    timeout: opts.timeoutMs ?? 120_000,
    ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const model = opts.model || OPENAI_DEFAULT_MODEL;
  return {
    id: 'openai',
    model,
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      let response: OpenAI.Responses.Response;
      try {
        response = await client.responses.create({
          model,
          instructions: req.system,
          input: req.prompt,
          text: { format: { type: 'json_schema', name: req.schemaName, schema: req.schema, strict: true } },
        });
      } catch (e) {
        throw toProviderError(e);
      }
      let data: unknown;
      try {
        data = parseJsonLoose(response.output_text);
      } catch (e) {
        throw new ProviderError('invalid-response', (e as Error).message);
      }
      return { data, usage: { inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens } };
    },
  };
}

function toProviderError(e: unknown): ProviderError {
  if (e instanceof OpenAI.AuthenticationError || e instanceof OpenAI.PermissionDeniedError) {
    return new ProviderError('auth', `OpenAI rejected the API key (${e.status})`);
  }
  if (e instanceof OpenAI.RateLimitError) return new ProviderError('rate-limit', 'OpenAI rate limit or quota reached');
  if (e instanceof OpenAI.APIConnectionTimeoutError) return new ProviderError('timeout', 'OpenAI request timed out');
  if (e instanceof OpenAI.APIConnectionError) return new ProviderError('network', `could not reach OpenAI: ${e.message}`);
  if (e instanceof OpenAI.APIError) return new ProviderError('unavailable', `OpenAI API error ${e.status ?? ''}: ${e.message}`.trim());
  return new ProviderError('unavailable', (e as Error)?.message ?? String(e));
}
