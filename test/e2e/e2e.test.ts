import { describe, expect, it } from 'vitest';
import { createMemoryCache } from '../../src/extract/cache.js';
import { createGitHubApi } from '../../src/github.js';
import { sliceChangelog } from '../../src/notes/sections.js';
import { createRegistry } from '../../src/notes/registry.js';
import { createProvider, ModelGateway, type ProviderSetting } from '../../src/providers/index.js';
import { MARKER } from '../../src/report/render.js';
import { renderSummary } from '../../src/report/summary.js';
import { run, type RunContext } from '../../src/run.js';
import {
  anthropicHandler,
  copilotRunner,
  createRecordedFetch,
  fixture,
  fixturePath,
  loadModel,
  prRoutes,
  registryRoute,
  upstreamRoutes,
  type CannedModel,
  type Route,
} from './harness.js';

const CTX: RunContext = { owner: 'acme', repo: 'shop', pr: 7, baseSha: 'b45e000000000000000000000000000000000001', headSha: 'c0ffee0000000000000000000000000000000002' };

const manifest = (deps: Record<string, string>, dev: Record<string, string> = {}) => JSON.stringify({ name: 'app', private: true, dependencies: deps, devDependencies: dev }, null, 2);
const npmLock = (pkgs: Record<string, string>) =>
  JSON.stringify({ lockfileVersion: 3, packages: { '': {}, ...Object.fromEntries(Object.entries(pkgs).map(([n, v]) => [`node_modules/${n}`, { version: v }])) } }, null, 2);

interface Scenario {
  name: string;
  routes: Route[];
  workspace: string;
}

// --- Upgrades -----------------------------------------------------------------

function reactRouter(): Scenario {
  const changelog = fixture('upstream/react-router.CHANGELOG.md');
  const sections = sliceChangelog(changelog, '6.27.0', '7.1.0');
  const releases = [...sections]
    .reverse()
    .map((s) => ({ tag: `react-router@${s.version}`, body: s.text.split('\n').slice(1).join('\n').trim() }));
  releases.splice(1, 0, { tag: 'react-router-dom@7.1.0', body: 'See `react-router` changes.' }, { tag: '@remix-run/router@1.21.0', body: '- internal' });
  return {
    name: 'react-router',
    workspace: fixturePath('e2e/react-router/repo'),
    routes: [
      ...prRoutes({
        ...CTX,
        files: {
          'package.json': { base: manifest({ react: '^18.3.1', 'react-router': '^6.28.0', 'react-router-dom': '^6.28.0' }), head: manifest({ react: '^18.3.1', 'react-router': '^7.1.0', 'react-router-dom': '^6.28.0' }) },
          'package-lock.json': { base: npmLock({ react: '18.3.1', 'react-router': '6.28.0', 'react-router-dom': '6.28.0' }), head: npmLock({ react: '18.3.1', 'react-router': '7.1.0', 'react-router-dom': '6.28.0' }) },
        },
      }),
      registryRoute('react-router', '7.1.0', JSON.parse(fixture('e2e/registry/react-router@7.1.0.json'))),
      ...upstreamRoutes({
        owner: 'remix-run',
        repo: 'react-router',
        releases,
        ref: 'react-router@7.1.0',
        files: { 'docs/upgrading/v6.md': fixture('upstream/react-router.upgrading-v6.md') },
        otherPaths: ['packages/react-router/CHANGELOG.md', 'docs/upgrading/remix.md', 'docs/upgrading/component-routes.md', 'README.md'],
      }),
    ],
  };
}

function express(): Scenario {
  return {
    name: 'express',
    workspace: fixturePath('e2e/express/repo'),
    routes: [
      ...prRoutes({
        ...CTX,
        files: {
          'package.json': { base: manifest({ express: '^4.21.2' }), head: manifest({ express: '^5.0.1' }) },
          'package-lock.json': { base: npmLock({ express: '4.21.2' }), head: npmLock({ express: '5.0.1' }) },
        },
      }),
      registryRoute('express', '5.0.1', JSON.parse(fixture('e2e/registry/express@5.0.1.json'))),
      // No GitHub releases in this recording: exercises the History.md fallback at the tag.
      ...upstreamRoutes({ owner: 'expressjs', repo: 'express', releases: [], tags: ['v5.0.1'], ref: 'v5.0.1', files: { 'History.md': fixture('upstream/express.History.md') }, otherPaths: ['Readme.md', 'lib/express.js'] }),
    ],
  };
}

function eslint(): Scenario {
  const yarn = (v: string, spec: string) => `# yarn lockfile v1\n\n\neslint@${spec}:\n  version "${v}"\n  resolved "https://registry.yarnpkg.com/eslint/-/eslint-${v}.tgz"\n`;
  return {
    name: 'eslint',
    workspace: fixturePath('e2e/eslint/repo'),
    routes: [
      ...prRoutes({
        ...CTX,
        files: {
          'package.json': { base: manifest({}, { eslint: '^8.57.0' }), head: manifest({}, { eslint: '^9.0.0' }) },
          'yarn.lock': { base: yarn('8.57.0', '^8.57.0'), head: yarn('9.0.0', '^9.0.0') },
        },
      }),
      registryRoute('eslint', '9.0.0', JSON.parse(fixture('e2e/registry/eslint@9.0.0.json'))),
      ...upstreamRoutes({
        owner: 'eslint',
        repo: 'eslint',
        releases: [],
        tags: ['v9.0.0'],
        ref: 'v9.0.0',
        files: { 'CHANGELOG.md': fixture('upstream/eslint.CHANGELOG.md'), 'docs/src/use/migrate-to-9.0.0.md': fixture('upstream/eslint.migrate-to-9.0.0.md') },
        otherPaths: ['docs/src/use/migrate-to-8.0.0.md', 'tests/fixtures/migrate-to-9.0.0.md'],
      }),
    ],
  };
}

function next(workspace = 'e2e/next/repo'): Scenario {
  const pnpm = (v: string) => `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      next:\n        specifier: ^${v}\n        version: ${v}(react-dom@19.0.0(react@19.0.0))(react@19.0.0)\n`;
  const guide = 'docs/02-app/01-building-your-application/11-upgrading/02-version-15.mdx';
  return {
    name: 'next',
    workspace: fixturePath(workspace),
    routes: [
      ...prRoutes({
        ...CTX,
        files: {
          'package.json': { base: manifest({ next: '^14.2.15' }), head: manifest({ next: '^15.0.0' }) },
          'pnpm-lock.yaml': { base: pnpm('14.2.15'), head: pnpm('15.0.0') },
        },
      }),
      registryRoute('next', '15.0.0', JSON.parse(fixture('e2e/registry/next@15.0.0.json'))),
      ...upstreamRoutes({
        owner: 'vercel',
        repo: 'next.js',
        releases: [],
        tags: ['v15.0.0'],
        ref: 'v15.0.0',
        files: { [guide]: fixture('upstream/next.version-15.mdx') },
        otherPaths: ['docs/02-app/01-building-your-application/11-upgrading/01-codemods.mdx', 'docs/02-app/01-building-your-application/11-upgrading/03-version-14.mdx', 'packages/next/package.json'],
      }),
    ],
  };
}

/** A bump whose repository is not on GitHub (synthetic package; registry doc shaped like npm's). */
function missingNotes(): Scenario {
  return {
    name: 'missing',
    workspace: fixturePath('e2e/next/repo-clean'),
    routes: [
      ...prRoutes({
        ...CTX,
        files: { 'package.json': { base: manifest({ '@acme/ui-kit': '^2.3.0' }), head: manifest({ '@acme/ui-kit': '^3.0.0' }) } },
      }),
      registryRoute('@acme/ui-kit', '3.0.0', { name: '@acme/ui-kit', version: '3.0.0', repository: { type: 'git', url: 'git+https://gitlab.com/acme/ui-kit.git' } }),
    ],
  };
}

// --- Runner ---------------------------------------------------------------------

interface RunOpts {
  provider: ProviderSetting;
  model?: CannedModel;
  cache?: ReturnType<typeof createMemoryCache>;
  anthropic?: Parameters<typeof anthropicHandler>[1];
  copilotFail?: { code: number; stderr: string };
  existingComments?: { id: number; body: string }[];
}

async function execute(s: Scenario, opts: RunOpts) {
  const unknown: string[] = [];
  const routes = opts.existingComments ? [...s.routes.filter((r) => !r.url.includes('/issues/7/comments')), ...prRoutes({ ...CTX, files: {}, existingComments: opts.existingComments }).filter((r) => r.url.includes('/comments'))] : s.routes;
  const handlers = opts.model && opts.provider === 'anthropic' ? [anthropicHandler(opts.model, { unknown, ...opts.anthropic })] : [];
  const rec = createRecordedFetch(routes, handlers);
  const copilotCalls: string[][] = [];
  const { provider, reason } = createProvider({
    provider: opts.provider,
    apiKey: 'sk-test',
    githubToken: 'ghs_test',
    fetch: rec.fetch,
    runner: copilotRunner(opts.model ?? null, { unknown, calls: copilotCalls, ...(opts.copilotFail ? { fail: opts.copilotFail } : {}) }),
  });
  const gateway = new ModelGateway(provider);
  const gh = createGitHubApi('ghs_test', { fetch: rec.fetch });
  const result = await run(CTX, { gh, registry: createRegistry({ fetch: rec.fetch, baseUrl: 'https://registry.npmjs.org' }), cache: opts.cache ?? createMemoryCache(), gateway, workspace: s.workspace, ...(reason ? { providerReason: reason } : {}) }, { includePatch: false, maxPackages: 10 });
  const posted = rec.requests.filter((r) => /\/issues\/(7\/)?comments/.test(r.url) && (r.method === 'POST' || r.method === 'PATCH'));
  // Only tag-existence probes may miss; anything else means the recording is incomplete.
  const unexpected = rec.unmatched.filter((u) => !u.includes('/git/ref/tags/'));
  return { result, gateway, gh, rec, posted, unexpected, unknown, copilotCalls };
}

const commentBody = (posted: { body?: string }[]) => (JSON.parse(posted.at(-1)?.body ?? '{}') as { body: string }).body;

// --- Tests ------------------------------------------------------------------------

describe.each([
  ['react-router', reactRouter, 'anthropic' as const],
  ['express', express, 'anthropic' as const],
  ['eslint', eslint, 'copilot' as const],
  ['next', next, 'anthropic' as const],
])('%s: AI-assisted', (name, scenario, provider) => {
  it('posts one comment with verified, located breaking changes', async () => {
    const s = scenario();
    const r = await execute(s, { provider, model: loadModel(name) });
    expect(r.unexpected).toEqual([]);
    expect(r.unknown).toEqual([]);
    expect(r.posted).toHaveLength(1);
    expect(r.posted[0]!.method).toBe('POST');
    const body = commentBody(r.posted);
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toMatch(/^## ⚠️ \d+ breaking changes? affects? this repo/m);
    expect(body).toContain(`**Mode:** AI-assisted via \`${provider}/${provider === 'copilot' ? 'auto' : 'claude-opus-5-5'}\``);
    expect(body).toContain(`https://github.com/acme/shop/blob/${CTX.headSha}/`);
    expect(r.result.report!.packages.every((p) => p.mode === 'ai')).toBe(true);
    await expect(body).toMatchFileSnapshot(`./__snapshots__/${name}.ai.md`);
  });
});

describe.each([
  ['react-router', reactRouter],
  ['express', express],
  ['eslint', eslint],
  ['next', next],
])('%s: rule-based (no AI)', (name, scenario) => {
  it('still produces a useful comment with "possibly affected" locations', async () => {
    const r = await execute(scenario(), { provider: 'none' });
    expect(r.unexpected).toEqual([]);
    expect(r.gateway.calls).toEqual([]);
    const body = commentBody(r.posted);
    expect(body).toContain('**Mode:** Rule-based (no AI available), lower confidence: provider is set to "none"');
    expect(r.result.report!.packages[0]!.changes.length).toBeGreaterThan(0);
    expect(r.result.report!.packages[0]!.changes.every((c) => c.change.confidence === 'low')).toBe(true);
    expect(r.result.report!.packages[0]!.changes.flatMap((c) => c.hits).every((h) => h.verdict === 'possibly')).toBe(true);
    await expect(body).toMatchFileSnapshot(`./__snapshots__/${name}.rules.md`);
  });
});

describe('specific outcomes', () => {
  it('react-router (AI): finds json/defer, react-router-dom and future flags, rules out the comment mention', async () => {
    const r = await execute(reactRouter(), { provider: 'anthropic', model: loadModel('react-router') });
    const pkg = r.result.report!.packages[0]!;
    const get = (id: string) => pkg.changes.find((c) => c.change.id === id)!;
    expect(get('json-defer-removed').hits.map((h) => [h.line, h.verdict])).toEqual([
      [1, 'yes'],
      [7, 'yes'],
      [9, 'yes'],
    ]);
    expect(get('future-flags-removed').hits.map((h) => `${h.file}:${h.line}:${h.verdict}`)).toEqual(['app/root.tsx:7:yes', 'app/routes/home.tsx:3:no']);
    expect(get('node-20-required').hits).toEqual([]);
    // 7.0.1's entry is empty, so that release carries no notes
    expect(pkg.notes.sources.map((s) => `${s.kind} ${s.title}`)).toEqual(['release react-router@7.0.0', 'release react-router@7.0.2', 'release react-router@7.1.0', 'migration-guide docs/upgrading/v6.md']);
    expect(r.result.affected).toBe(3);
    // Model saw only snippets: no request carried a whole file it did not need
    const modelBodies = r.rec.requests.filter((q) => q.url.includes('api.anthropic.com')).map((q) => q.body ?? '');
    expect(modelBodies.some((b) => b.includes('<snippet>'))).toBe(true);
    expect(modelBodies.join('')).not.toContain('export default function Account() {\\n  const { user }');
  });

  it('react-router (AI): rule-based safety net catches a change the model left out', async () => {
    // Seen on a real run: the model listed `defer` but skipped `json`, though both were in the notes.
    const model = loadModel('react-router');
    const jd = model.extraction.breakingChanges.find((c) => c.id === 'json-defer-removed')!;
    jd.affectedSymbols = jd.affectedSymbols.filter((s) => s.name !== 'json');
    const r = await execute(reactRouter(), { provider: 'anthropic', model });
    const extra = r.result.report!.packages[0]!.changes.filter((c) => c.change.id.startsWith('rules-') && c.hits.some((h) => h.file === 'app/routes/account.tsx' && h.line === 7));
    expect(extra).toHaveLength(1);
    expect(extra[0]!.change.affectedSymbols.map((s) => s.name)).toContain('json');
    expect(extra[0]!.change.confidence).toBe('low');
    // Locations the model's own changes already cover are not repeated
    expect(extra[0]!.hits.map((h) => h.line)).not.toContain(1);
  });

  it('react-router: pointer-only release bodies are skipped so the CHANGELOG fits the budget', async () => {
    // Seen on a real run: one "See the CHANGELOG" release per version used up the notes budget.
    const s = reactRouter();
    const pointer = (v: string) => ({ tag: `react-router@${v}`, body: `See the [CHANGELOG](https://github.com/remix-run/react-router/blob/main/CHANGELOG.md#v${v.replace(/\./g, '')}) for details.` });
    const versions = sliceChangelog(fixture('upstream/react-router.CHANGELOG.md'), '6.28.0', '7.1.0').map((b) => b.version).reverse();
    s.routes = [
      ...s.routes.filter((r) => !r.url.includes('/repos/remix-run/react-router/')),
      ...upstreamRoutes({
        owner: 'remix-run',
        repo: 'react-router',
        releases: versions.map(pointer),
        ref: 'react-router@7.1.0',
        files: { 'packages/react-router/CHANGELOG.md': fixture('upstream/react-router.CHANGELOG.md'), 'docs/upgrading/v6.md': fixture('upstream/react-router.upgrading-v6.md') },
      }),
    ];
    const r = await execute(s, { provider: 'none' });
    expect(r.unexpected).toEqual([]);
    const pkg = r.result.report!.packages[0]!;
    expect(pkg.notes.sources.map((x) => x.kind)).toEqual(['changelog', 'migration-guide']);
    expect(pkg.notes.text).not.toContain('=== Release ');
    expect(pkg.changes.some((c) => c.change.affectedSymbols.some((x) => x.name === 'json') && c.hits.some((h) => h.line === 7))).toBe(true);
  });

  it('express (AI): the model separates res.json(obj) from res.json(obj, status)', async () => {
    const r = await execute(express(), { provider: 'anthropic', model: loadModel('express') });
    const sig = r.result.report!.packages[0]!.changes.find((c) => c.change.id === 'res-json-status-signature')!;
    expect(sig.hits.map((h) => `${h.line}:${h.verdict}`)).toEqual(['7:no', '12:yes', '17:no']);
    expect(r.result.report!.packages[0]!.notes.sources.map((s) => s.kind)).toEqual(['changelog']);
    expect(commentBody(r.posted)).toContain('-  res.json(item, 201);\n  +  res.status(201).json(item);');
  });

  it('eslint (Copilot via GITHUB_TOKEN): flags .eslintrc.json, --ext and removed formatter; batches verification', async () => {
    const r = await execute(eslint(), { provider: 'copilot', model: loadModel('eslint') });
    expect(r.copilotCalls).toHaveLength(2); // one extraction + one batched verification
    expect(r.copilotCalls[0]!.slice(0, 3)).toEqual(['npx', '--yes', '@github/copilot@1.0.96']);
    expect(r.copilotCalls[0]).toContain('--deny-tool=shell,write');
    const changes = r.result.report!.packages[0]!.changes;
    expect(changes.find((c) => c.change.id === 'flat-config-default')!.hits[0]).toMatchObject({ file: '.eslintrc.json', kind: 'file', verdict: 'yes' });
    expect(changes.find((c) => c.change.id === 'no-unused-vars-caught-errors')!.hits[0]!.verdict).toBe('unsure');
    expect(r.result.affected).toBe(4);
    expect(r.result.possible).toBe(1);
    expect(r.result.report!.packages[0]!.notes.sources.map((s) => s.kind)).toEqual(['changelog', 'migration-guide']);
  });

  it('✅ next 14 → 15 with no affected code', async () => {
    const r = await execute(next('e2e/next/repo-clean'), { provider: 'anthropic', model: loadModel('next') });
    const body = commentBody(r.posted);
    expect(body).toMatch(/^## ✅ No breaking changes found that affect your code \(5 checked\)$/m);
    expect(r.gateway.calls.map((c) => c.purpose)).toEqual(['extract next 14.2.15→15.0.0']); // verification skipped: no hits
    await expect(body).toMatchFileSnapshot('./__snapshots__/clean.md');
  });

  it('❓ release notes not found', async () => {
    const r = await execute(missingNotes(), { provider: 'anthropic', model: loadModel('next') });
    const body = commentBody(r.posted);
    expect(body).toMatch(/^## ❓ Couldn't find release notes for @acme\/ui-kit$/m);
    expect(body).toContain("the package's repository (git+https://gitlab.com/acme/ui-kit.git) is not on GitHub");
    expect(r.gateway.calls).toEqual([]);
    await expect(body).toMatchFileSnapshot('./__snapshots__/missing.md');
  });
});

describe('provider failures never fail the run', () => {
  it('Copilot without permission falls back to rule-based mode and still posts a comment', async () => {
    const r = await execute(express(), {
      provider: 'copilot',
      model: loadModel('express'),
      copilotFail: { code: 1, stderr: 'Error: 403 Resource not accessible by integration. The workflow needs the copilot-requests permission.' },
    });
    expect(r.posted).toHaveLength(1);
    const pkg = r.result.report!.packages[0]!;
    expect(pkg.mode).toBe('rules');
    expect(pkg.fallbackReason).toMatch(/copilot\/auto failed \(auth\)/);
    expect(pkg.changes.length).toBeGreaterThan(0);
    const body = commentBody(r.posted);
    expect(body).toContain('**Mode:** Rule-based (no AI available), lower confidence: copilot/auto failed (auth)');
    expect(body).toMatch(/^## ⚠️ \d+ breaking changes? may affect this repo/m);
    expect(r.gateway.calls).toHaveLength(1); // circuit breaker: no further attempts
    const summary = renderSummary(r.result.report!, r.gateway.calls, r.gh.stats);
    expect(summary).toContain('failed: auth');
    expect(summary).toContain('Fell back to rule-based mode');
  });

  it('Anthropic rate limit falls back to rule-based mode', async () => {
    const r = await execute(react(), { provider: 'anthropic', model: loadModel('react-router'), anthropic: { unknown: [], failWith: { status: 429, type: 'rate_limit_error', message: 'Too many requests' } } });
    expect(r.result.report!.packages[0]!.mode).toBe('rules');
    expect(r.result.report!.packages[0]!.fallbackReason).toMatch(/rate-limit/);
    expect(r.posted).toHaveLength(1);
  });

  it('invalid JSON is retried once, then the package falls back to rules', async () => {
    const once = await execute(express(), { provider: 'anthropic', model: loadModel('express'), anthropic: { unknown: [], invalidFirst: 1 } });
    expect(once.result.report!.packages[0]!.mode).toBe('ai');
    expect(once.gateway.calls.slice(0, 2).map((c) => [c.purpose, c.ok])).toEqual([
      ['extract express 4.21.2→5.0.1', false],
      ['extract express 4.21.2→5.0.1 (retry)', true],
    ]);
    const twice = await execute(express(), { provider: 'anthropic', model: loadModel('express'), anthropic: { unknown: [], invalidFirst: 2 } });
    const pkg = twice.result.report!.packages[0]!;
    expect(pkg.mode).toBe('rules');
    expect(pkg.fallbackReason).toBe('AI output for express was invalid twice; matches were still checked by the AI');
    expect(commentBody(twice.posted)).toContain('Rule-based extraction with AI-verified matches, lower confidence: AI output for express was invalid twice');
    // The model still works, so rule-based matches get real verdicts instead of "possibly"
    expect(pkg.changes.flatMap((c) => c.hits).some((h) => h.verdict === 'yes' || h.verdict === 'no' || h.verdict === 'unsure')).toBe(true);
    expect(pkg.changes.flatMap((c) => c.hits).every((h) => h.verdict !== 'possibly')).toBe(true);
  });
});

describe('caching and comment lifecycle', () => {
  it('reuses cached extraction for the same package and range', async () => {
    const cache = createMemoryCache();
    const first = await execute(express(), { provider: 'anthropic', model: loadModel('express'), cache });
    expect(first.gateway.calls.some((c) => c.purpose.startsWith('extract'))).toBe(true);
    expect([...cache.store.keys()]).toEqual(['breakcheck-v2-anthropic/claude-opus-5-5-express-4.21.2-5.0.1']);
    const second = await execute(express(), { provider: 'anthropic', model: loadModel('express'), cache });
    expect(second.gateway.calls.some((c) => c.purpose.startsWith('extract'))).toBe(false);
    expect(second.result.report!.packages[0]!.fromCache).toBe(true);
  });

  it('updates its existing comment in place instead of posting a new one', async () => {
    const r = await execute(express(), { provider: 'none', existingComments: [{ id: 42, body: 'unrelated' }, { id: 555, body: `${MARKER}\nold result` }] });
    expect(r.posted.map((p) => [p.method, p.url])).toEqual([['PATCH', 'https://api.github.com/repos/acme/shop/issues/comments/555']]);
    expect(r.result.comment).toMatchObject({ id: 555, action: 'updated' });
  });

  it('does nothing when the PR has no dependency bumps', async () => {
    const rec = prRoutes({ ...CTX, files: { 'README.md': { base: 'a', head: 'b' } } });
    const f = createRecordedFetch(rec);
    const res = await run(CTX, { gh: createGitHubApi('t', { fetch: f.fetch }), registry: createRegistry({ fetch: f.fetch, baseUrl: 'https://registry.npmjs.org' }), cache: createMemoryCache(), gateway: new ModelGateway(null), workspace: fixturePath('e2e/express/repo') }, { includePatch: false, maxPackages: 10 });
    expect(res.report).toBeNull();
    expect(f.requests.filter((q) => q.method !== 'GET')).toEqual([]);
  });
});

function react() {
  return reactRouter();
}
