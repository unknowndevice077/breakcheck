import { createAnthropicProvider } from './anthropic.js';
import { createCopilotProvider, type Runner } from './copilot.js';
import { createOpenAIProvider } from './openai.js';
import { ProviderError, type CallRecord, type CompletionRequest, type CompletionResult, type Provider } from './types.js';

export type ProviderSetting = 'copilot' | 'anthropic' | 'openai' | 'none';

export interface ProviderConfig {
  provider: ProviderSetting;
  apiKey?: string;
  model?: string;
  githubToken: string;
  copilotCliVersion?: string;
  fetch?: typeof fetch;
  runner?: Runner;
}

/** Build the configured provider, or explain why there is none (→ rule-based mode). */
export function createProvider(cfg: ProviderConfig): { provider: Provider | null; reason?: string } {
  switch (cfg.provider) {
    case 'none':
      return { provider: null, reason: 'provider is set to "none"' };
    case 'copilot':
      if (!cfg.githubToken) return { provider: null, reason: 'no github-token available for Copilot' };
      return { provider: createCopilotProvider({ token: cfg.githubToken, model: cfg.model, cliVersion: cfg.copilotCliVersion, runner: cfg.runner }) };
    case 'anthropic':
      if (!cfg.apiKey) return { provider: null, reason: 'provider is "anthropic" but no api-key was given (on Dependabot PRs it must be a Dependabot secret)' };
      return { provider: createAnthropicProvider({ apiKey: cfg.apiKey, model: cfg.model, fetch: cfg.fetch }) };
    case 'openai':
      if (!cfg.apiKey) return { provider: null, reason: 'provider is "openai" but no api-key was given (on Dependabot PRs it must be a Dependabot secret)' };
      return { provider: createOpenAIProvider({ apiKey: cfg.apiKey, model: cfg.model, fetch: cfg.fetch }) };
  }
}

/**
 * Wraps a provider with call logging and a circuit breaker: after the first hard
 * failure (auth, rate limit, network, timeout) the model is not called again this
 * run, and every later stage uses rule-based mode.
 */
export class ModelGateway {
  readonly calls: CallRecord[] = [];
  private brokenReason: string | null = null;

  constructor(readonly provider: Provider | null) {}

  get label(): string | null {
    return this.provider ? `${this.provider.id}/${this.provider.model}` : null;
  }

  get available(): boolean {
    return !!this.provider && !this.brokenReason;
  }

  get failure(): string | null {
    return this.brokenReason;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    if (!this.provider) throw new ProviderError('unavailable', 'no AI provider configured');
    if (this.brokenReason) throw new ProviderError('unavailable', this.brokenReason);
    const started = Date.now();
    try {
      const res = await this.provider.complete(req);
      this.calls.push({
        provider: this.provider.id,
        model: this.provider.model,
        purpose: req.purpose,
        ms: Date.now() - started,
        ok: true,
        inputTokens: res.usage?.inputTokens,
        outputTokens: res.usage?.outputTokens,
      });
      return res;
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError('unavailable', String((e as Error)?.message ?? e));
      this.calls.push({ provider: this.provider.id, model: this.provider.model, purpose: req.purpose, ms: Date.now() - started, ok: false, error: `${err.kind}: ${err.message}` });
      if (err.kind !== 'invalid-response') this.brokenReason = `${this.label} failed (${err.kind}): ${err.message}`;
      throw err;
    }
  }

  /** Record a schema-validation failure against the last call (the call itself "worked"). */
  markLastInvalid(reason: string): void {
    const last = this.calls.at(-1);
    if (last) {
      last.ok = false;
      last.error = `invalid-response: ${reason}`;
    }
  }
}
