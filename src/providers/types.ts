import type { JsonSchema } from '../extract/schema.js';

export type ProviderId = 'copilot' | 'anthropic' | 'openai';

export interface CompletionRequest {
  system: string;
  prompt: string;
  schema: JsonSchema;
  /** Short identifier for the schema, e.g. "breaking_changes" */
  schemaName: string;
  /** What the call is for, shown in the job summary */
  purpose: string;
}

export interface CompletionResult {
  /** Parsed JSON (not yet validated against the schema) */
  data: unknown;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** The whole model layer: one call that returns a JSON object. Adding a provider is one file. */
export interface Provider {
  readonly id: ProviderId;
  readonly model: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export type ProviderErrorKind = 'auth' | 'rate-limit' | 'network' | 'timeout' | 'invalid-response' | 'unavailable' | 'refused';

/**
 * Every provider failure is normalised into this. `invalid-response` is worth one retry;
 * everything else means "stop using the model for this run and fall back to rules".
 */
export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface CallRecord {
  provider: ProviderId;
  model: string;
  purpose: string;
  ms: number;
  ok: boolean;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
}
