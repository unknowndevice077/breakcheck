/**
 * Test harness for end-to-end runs without any live network.
 *
 * - GitHub and npm registry traffic is served from recorded fixtures through an
 *   injected `fetch` (the same fetch Octokit and the provider SDKs use in production).
 *   Upstream text (changelogs, migration guides, registry metadata) is real, fetched
 *   once and committed under test/fixtures; the GitHub API envelopes around it are
 *   built here in the documented response shapes.
 * - Model replies are canned per scenario (test/fixtures/e2e/<name>/model.json) and
 *   returned in the provider's wire format, so the real SDK parsing path runs.
 */
import { readFileSync } from 'node:fs';
import type { Runner } from '../../src/providers/copilot.js';
import type { ExtractionResult } from '../../src/types.js';

export interface Route {
  method?: string;
  url: string;
  status?: number;
  json?: unknown;
  text?: string;
}

export interface RecordedRequest {
  method: string;
  url: string;
  body?: string;
}

function normalize(method: string, url: string): string {
  const u = new URL(url);
  const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  const qs = params.map(([k, v]) => `${k}=${v}`).join('&');
  return `${method.toUpperCase()} ${u.origin}${decodeURIComponent(u.pathname)}${qs ? `?${qs}` : ''}`;
}

export type Handler = (req: RecordedRequest) => Response | Promise<Response> | null;

export function createRecordedFetch(routes: Route[], handlers: Handler[] = []) {
  const table = new Map(routes.map((r) => [normalize(r.method ?? 'GET', r.url), r]));
  const requests: RecordedRequest[] = [];
  const unmatched: string[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const req = { method, url, ...(body ? { body } : {}) };
    requests.push(req);
    for (const h of handlers) {
      const res = await h(req);
      if (res) return res;
    }
    const route = table.get(normalize(method, url));
    if (!route) {
      unmatched.push(normalize(method, url));
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'content-type': 'application/json' } });
    }
    if (route.text !== undefined) {
      return new Response(route.text, { status: route.status ?? 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    return new Response(JSON.stringify(route.json ?? {}), { status: route.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: fetchImpl as typeof fetch, requests, unmatched };
}

const API = 'https://api.github.com';

export interface PrSpec {
  owner: string;
  repo: string;
  pr: number;
  baseSha: string;
  headSha: string;
  files: Record<string, { base?: string; head?: string }>;
  existingComments?: { id: number; body: string }[];
}

/** The PR side: changed files, file contents at base/head, comments. */
export function prRoutes(spec: PrSpec): Route[] {
  const base = `${API}/repos/${spec.owner}/${spec.repo}`;
  const routes: Route[] = [
    { url: `${base}/pulls/${spec.pr}/files?per_page=100&page=1`, json: Object.keys(spec.files).map((filename) => ({ filename, status: 'modified' })) },
    { url: `${base}/issues/${spec.pr}/comments?per_page=100&page=1`, json: (spec.existingComments ?? []).map((c) => ({ ...c, user: { login: 'github-actions[bot]' } })) },
    { method: 'POST', url: `${base}/issues/${spec.pr}/comments`, status: 201, json: { id: 1001, html_url: `https://github.com/${spec.owner}/${spec.repo}/pull/${spec.pr}#issuecomment-1001` } },
  ];
  for (const c of spec.existingComments ?? []) {
    routes.push({ method: 'PATCH', url: `${base}/issues/comments/${c.id}`, json: { id: c.id, html_url: `https://github.com/${spec.owner}/${spec.repo}/pull/${spec.pr}#issuecomment-${c.id}` } });
  }
  for (const [file, v] of Object.entries(spec.files)) {
    if (v.base !== undefined) routes.push({ url: `${base}/contents/${file}?ref=${spec.baseSha}`, text: v.base });
    if (v.head !== undefined) routes.push({ url: `${base}/contents/${file}?ref=${spec.headSha}`, text: v.head });
  }
  return routes;
}

export interface UpstreamSpec {
  owner: string;
  repo: string;
  releases?: { tag: string; body: string; prerelease?: boolean }[];
  tags?: string[];
  /** ref the tree and files are served at */
  ref: string;
  files: Record<string, string>;
  /** extra paths that exist in the tree but are not fetched */
  otherPaths?: string[];
}

export function upstreamRoutes(spec: UpstreamSpec): Route[] {
  const base = `${API}/repos/${spec.owner}/${spec.repo}`;
  const routes: Route[] = [
    {
      url: `${base}/releases?per_page=100&page=1`,
      json: (spec.releases ?? []).map((r, i) => ({
        id: i + 1,
        tag_name: r.tag,
        name: r.tag,
        body: r.body,
        draft: false,
        prerelease: r.prerelease ?? false,
        html_url: `https://github.com/${spec.owner}/${spec.repo}/releases/tag/${encodeURIComponent(r.tag)}`,
      })),
    },
    {
      url: `${base}/git/trees/${spec.ref}?recursive=1`,
      json: { sha: 'tree', truncated: false, tree: [...Object.keys(spec.files), ...(spec.otherPaths ?? [])].map((path) => ({ path, type: 'blob' })) },
    },
  ];
  for (const t of spec.tags ?? []) routes.push({ url: `${base}/git/ref/tags/${t}`, json: { ref: `refs/tags/${t}`, object: { sha: 'x', type: 'commit' } } });
  for (const [path, text] of Object.entries(spec.files)) routes.push({ url: `${base}/contents/${path}?ref=${spec.ref}`, text });
  return routes;
}

export function registryRoute(name: string, version: string, doc: unknown): Route {
  return { url: `https://registry.npmjs.org/${name.replace('/', '%2f')}/${version}`, json: doc };
}

export const fixture = (p: string) => readFileSync(new URL(`../fixtures/${p}`, import.meta.url), 'utf8');
export const fixturePath = (p: string) => new URL(`../fixtures/${p}`, import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Canned model behaviour

export interface Verdict {
  affected: 'yes' | 'no' | 'unsure';
  reason: string;
  fix: { before: string; after: string } | null;
}

export interface CannedModel {
  extraction: ExtractionResult;
  /** keyed by `${changeId}@${file}:${line}` */
  verdicts: Record<string, Verdict>;
}

export function loadModel(scenario: string): CannedModel {
  return JSON.parse(fixture(`e2e/${scenario}/model.json`)) as CannedModel;
}

/** Answer an extraction or verification prompt the way the canned model would. */
export function answer(model: CannedModel, prompt: string, isExtraction: boolean, unknown: string[]): unknown {
  if (isExtraction) return model.extraction;
  const results = [];
  for (const m of prompt.matchAll(/--- hitId: (\S+)\n[\s\S]*?Location: (\S+?) \(/g)) {
    const hitId = m[1] ?? '';
    const key = `${hitId.split('#')[0]}@${m[2]}`;
    const v = model.verdicts[key];
    if (!v) unknown.push(key);
    results.push({ hitId, ...(v ?? { affected: 'unsure', reason: 'no canned verdict', fix: null }) });
  }
  return { results };
}

/** Anthropic Messages API, as the SDK sees it over fetch. */
export function anthropicHandler(model: CannedModel, opts: { unknown: string[]; failWith?: { status: number; type: string; message: string }; invalidFirst?: number } = { unknown: [] }): Handler {
  let invalidLeft = opts.invalidFirst ?? 0;
  return (req) => {
    if (!req.url.startsWith('https://api.anthropic.com/v1/messages')) return null;
    if (opts.failWith) {
      return new Response(JSON.stringify({ type: 'error', error: { type: opts.failWith.type, message: opts.failWith.message } }), {
        status: opts.failWith.status,
        headers: { 'content-type': 'application/json', 'retry-after': '0' },
      });
    }
    const body = JSON.parse(req.body ?? '{}') as { system: string; messages: { content: string }[]; output_config: { format: { schema: { properties: Record<string, unknown> } } } };
    const isExtraction = 'breakingChanges' in body.output_config.format.schema.properties;
    const prompt = body.messages[0]?.content ?? '';
    let text = JSON.stringify(answer(model, prompt, isExtraction, opts.unknown));
    if (invalidLeft > 0) {
      invalidLeft--;
      text = isExtraction ? JSON.stringify({ breakingChanges: [{ id: 'x', summary: 'missing fields' }] }) : '{"results": "nope"}';
    }
    return new Response(
      JSON.stringify({
        id: `msg_${Math.random().toString(36).slice(2, 10)}`,
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: Math.ceil((body.system.length + prompt.length) / 4), output_tokens: Math.ceil(text.length / 4) },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
}

/** Copilot CLI, as breakcheck sees it through the process runner. */
export function copilotRunner(model: CannedModel | null, opts: { unknown: string[]; calls?: string[][]; fail?: { code: number; stderr: string } }): Runner {
  return async (cmd, args, runOpts) => {
    opts.calls?.push([cmd, ...args]);
    if (runOpts.env.COPILOT_GITHUB_TOKEN === undefined) throw new Error('token not passed to Copilot CLI');
    if (opts.fail || !model) return { code: opts.fail?.code ?? 1, stdout: '', stderr: opts.fail?.stderr ?? 'error', timedOut: false };
    const prompt = args[args.indexOf('-p') + 1] ?? '';
    const isExtraction = prompt.includes('"breakingChanges"');
    return { code: 0, stdout: '```json\n' + JSON.stringify(answer(model, prompt, isExtraction, opts.unknown)) + '\n```\n', stderr: '', timedOut: false };
  };
}
