import Anthropic from '@anthropic-ai/sdk';
import { parseJsonLoose } from '../extract/schema.js';
import { ProviderError, type CompletionRequest, type CompletionResult, type Provider } from './types.js';

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';

export function createAnthropicProvider(opts: { apiKey: string; model?: string; fetch?: typeof fetch; timeoutMs?: number }): Provider {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    maxRetries: 1,
    timeout: opts.timeoutMs ?? 120_000,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const model = opts.model || ANTHROPIC_DEFAULT_MODEL;
  return {
    id: 'anthropic',
    model,
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model,
          max_tokens: 16000,
          system: req.system,
          messages: [{ role: 'user', content: req.prompt }],
          output_config: { format: { type: 'json_schema', schema: req.schema } },
        });
      } catch (e) {
        throw toProviderError(e);
      }
      if (response.stop_reason === 'refusal') throw new ProviderError('refused', 'the model declined the request');
      if (response.stop_reason === 'max_tokens') throw new ProviderError('invalid-response', 'output hit max_tokens before the JSON was complete');
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      let data: unknown;
      try {
        data = parseJsonLoose(text);
      } catch (e) {
        throw new ProviderError('invalid-response', (e as Error).message);
      }
      return { data, usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } };
    },
  };
}

function toProviderError(e: unknown): ProviderError {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError('auth', `Anthropic rejected the API key (${e.status})`);
  }
  if (e instanceof Anthropic.RateLimitError) return new ProviderError('rate-limit', 'Anthropic rate limit reached');
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError('timeout', 'Anthropic request timed out');
  if (e instanceof Anthropic.APIConnectionError) return new ProviderError('network', `could not reach Anthropic: ${e.message}`);
  if (e instanceof Anthropic.APIError) return new ProviderError('unavailable', `Anthropic API error ${e.status ?? ''}: ${e.message}`.trim());
  return new ProviderError('unavailable', (e as Error)?.message ?? String(e));
}
