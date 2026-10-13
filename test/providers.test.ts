import { describe, expect, it } from 'vitest';
import { extractionSchema } from '../src/extract/schema.js';
import { createAnthropicProvider } from '../src/providers/anthropic.js';
import { createCopilotProvider } from '../src/providers/copilot.js';
import { createProvider, ModelGateway } from '../src/providers/index.js';
import { createOpenAIProvider } from '../src/providers/openai.js';
import { ProviderError, type CompletionRequest } from '../src/providers/types.js';
import type { BreakingChange } from '../src/types.js';
import { batchHits } from '../src/verify/verify.js';

const req: CompletionRequest = { system: 'sys', prompt: 'hello', schema: extractionSchema, schemaName: 'breaking_changes', purpose: 'test' };

function capture(response: unknown, status = 200) {
  const seen: { url: string; body: Record<string, unknown> }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify(response), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, seen };
}

describe('anthropic provider', () => {
  it('requests structured JSON output with the schema and reports token usage', async () => {
    const { f, seen } = capture({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: '{"breakingChanges":[]}' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 5 },
    });
    const p = createAnthropicProvider({ apiKey: 'k', fetch: f });
    const res = await p.complete(req);
    expect(res).toEqual({ data: { breakingChanges: [] }, usage: { inputTokens: 12, outputTokens: 5 } });
    expect(seen[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(seen[0]!.body).toMatchObject({ model: 'claude-opus-5-5', system: 'sys', output_config: { format: { type: 'json_schema', schema: extractionSchema } } });
    expect(seen[0]!.body).not.toHaveProperty('tool_choice');
  });

  it('maps 401 to an auth error', async () => {
    const { f } = capture({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401);
    await expect(createAnthropicProvider({ apiKey: 'bad', fetch: f }).complete(req)).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('openai provider', () => {
  it('uses the Responses API with a strict json_schema format', async () => {
    const { f, seen } = capture({
      id: 'resp_1',
      object: 'response',
      status: 'completed',
      output: [{ type: 'message', id: 'm', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"breakingChanges":[]}', annotations: [] }] }],
      usage: { input_tokens: 9, output_tokens: 4, total_tokens: 13 },
    });
    const p = createOpenAIProvider({ apiKey: 'k', fetch: f });
    const res = await p.complete(req);
    expect(res.data).toEqual({ breakingChanges: [] });
    expect(res.usage).toEqual({ inputTokens: 9, outputTokens: 4 });
    expect(seen[0]!.url).toBe('https://api.openai.com/v1/responses');
    expect(seen[0]!.body).toMatchObject({ model: 'gpt-5.5', instructions: 'sys', input: 'hello', text: { format: { type: 'json_schema', name: 'breaking_changes', strict: true } } });
  });
});

describe('copilot provider', () => {
  const run = (code: number, stdout: string, stderr = '', timedOut = false) =>
    createCopilotProvider({ token: 't', runner: async () => ({ code, stdout, stderr, timedOut }) }).complete(req);

  it('parses fenced JSON from the CLI output', async () => {
    await expect(run(0, 'Here you go:\n```json\n{"breakingChanges":[]}\n```')).resolves.toEqual({ data: { breakingChanges: [] } });
  });
  it.each([
    ['Error: 403 Forbidden: missing copilot-requests permission', 'auth'],
    ['You do not have an active Copilot subscription', 'auth'],
    ['429 Too Many Requests', 'rate-limit'],
    ['getaddrinfo ENOTFOUND api.githubcopilot.com', 'network'],
    ['something odd', 'unavailable'],
  ])('classifies "%s" as %s', async (stderr, kind) => {
    await expect(run(1, '', stderr)).rejects.toMatchObject({ kind });
  });
  it('reports timeouts and unparseable output', async () => {
    await expect(run(null as unknown as number, '', '', true)).rejects.toMatchObject({ kind: 'timeout' });
    await expect(run(0, 'I cannot help with that')).rejects.toMatchObject({ kind: 'invalid-response' });
  });
  it('passes only the token and a minimal environment to the CLI', async () => {
    let env: NodeJS.ProcessEnv = {};
    process.env.ANTHROPIC_API_KEY = 'should-not-leak';
    await createCopilotProvider({
      token: 'ghs_x',
      runner: async (_c, _a, o) => {
        env = o.env;
        return { code: 0, stdout: '{"breakingChanges":[]}', stderr: '', timedOut: false };
      },
    }).complete(req);
    delete process.env.ANTHROPIC_API_KEY;
    expect(env.COPILOT_GITHUB_TOKEN).toBe('ghs_x');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});

describe('createProvider / ModelGateway', () => {
  it('explains why there is no provider', () => {
    expect(createProvider({ provider: 'anthropic', githubToken: 't' })).toEqual({ provider: null, reason: expect.stringContaining('no api-key') });
    expect(createProvider({ provider: 'none', githubToken: 't' }).reason).toBe('provider is set to "none"');
  });
  it('stops calling the model after a hard failure, but not after invalid output', async () => {
    let calls = 0;
    const gw = new ModelGateway({
      id: 'openai',
      model: 'm',
      complete: async () => {
        calls++;
        throw new ProviderError(calls === 1 ? 'invalid-response' : 'rate-limit', 'x');
      },
    });
    await expect(gw.complete(req)).rejects.toMatchObject({ kind: 'invalid-response' });
    expect(gw.available).toBe(true);
    await expect(gw.complete(req)).rejects.toMatchObject({ kind: 'rate-limit' });
    expect(gw.available).toBe(false);
    await expect(gw.complete(req)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(calls).toBe(2);
    expect(gw.calls.map((c) => c.ok)).toEqual([false, false]);
  });
});

describe('batchHits', () => {
  it('splits by count and by size', () => {
    const change: BreakingChange = { id: 'c', summary: 's', kind: 'other', affectedSymbols: [], searchPatterns: [], fileGlobs: [], migration: [], sourceUrl: null, confidence: 'high' };
    const hit = (n: number, size: number) => ({ change, hit: { id: `c#${n}`, changeId: 'c', file: 'f', line: n, kind: 'symbol' as const, matched: 'x', snippet: 'x'.repeat(size), snippetStartLine: 1 } });
    expect(batchHits([1, 2, 3, 4, 5].map((n) => hit(n, 10)), 2, 10_000).map((b) => b.length)).toEqual([2, 2, 1]);
    expect(batchHits([1, 2, 3].map((n) => hit(n, 600)), 8, 1000).map((b) => b.length)).toEqual([1, 1, 1]);
  });
});
