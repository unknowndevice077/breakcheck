/**
 * Runs the bundled action (dist/index.js) as GitHub would: a real Node process
 * with a pull_request event, inputs as INPUT_* variables and the GitHub API
 * pointed at a local server that replays the recorded express scenario.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRecordedFetch, fixture, fixturePath, prRoutes, registryRoute, upstreamRoutes } from './e2e/harness.js';

const dist = new URL('../dist/index.js', import.meta.url).pathname;
const CTX = { owner: 'acme', repo: 'shop', pr: 7, baseSha: 'b45e', headSha: 'c0ffee' };
const manifest = (v: string) => JSON.stringify({ name: 'api', dependencies: { express: v } });

describe.skipIf(!existsSync(dist))('dist/index.js', () => {
  it('analyses a PR end to end in rule-based mode and posts a comment', async () => {
    const rec = createRecordedFetch([
      ...prRoutes({ ...CTX, files: { 'package.json': { base: manifest('^4.21.2'), head: manifest('^5.0.1') } } }),
      registryRoute('express', '5.0.1', JSON.parse(fixture('e2e/registry/express@5.0.1.json'))),
      ...upstreamRoutes({ owner: 'expressjs', repo: 'express', releases: [], tags: ['v5.0.1'], ref: 'v5.0.1', files: { 'History.md': fixture('upstream/express.History.md') } }),
    ]);
    // Local server: /gh/* → api.github.com, /npm/* → registry.npmjs.org
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const url = req.url!.startsWith('/npm/') ? `https://registry.npmjs.org${req.url!.slice(4)}` : `https://api.github.com${req.url!.slice(3)}`;
      const body = Buffer.concat(chunks).toString() || undefined;
      const r = await rec.fetch(url, { method: req.method, ...(body ? { body } : {}) });
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json' });
      res.end(await r.text());
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const tmp = mkdtempSync(path.join(tmpdir(), 'breakcheck-dist-'));
    const event = path.join(tmp, 'event.json');
    writeFileSync(event, JSON.stringify({ pull_request: { number: 7, base: { sha: CTX.baseSha }, head: { sha: CTX.headSha } } }));
    for (const f of ['summary.md', 'output.txt']) writeFileSync(path.join(tmp, f), '');
    const env = {
      PATH: process.env.PATH,
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: event,
      GITHUB_REPOSITORY: 'acme/shop',
      GITHUB_API_URL: `http://127.0.0.1:${port}/gh`,
      GITHUB_WORKSPACE: fixturePath('e2e/express/repo'),
      GITHUB_STEP_SUMMARY: path.join(tmp, 'summary.md'),
      GITHUB_OUTPUT: path.join(tmp, 'output.txt'),
      RUNNER_TEMP: tmp,
      npm_config_registry: `http://127.0.0.1:${port}/npm`,
      INPUT_PROVIDER: 'none',
      'INPUT_GITHUB-TOKEN': 'ghs_test',
      'INPUT_INCLUDE-PATCH': 'false',
      'INPUT_MAX-PACKAGES': '10',
      'INPUT_FAIL-ON-AFFECTED': 'false',
    };
    const out = await new Promise<{ code: number | null; stdout: string }>((resolve) => {
      const child = spawn(process.execPath, [dist], { env });
      let stdout = '';
      child.stdout.on('data', (d: Buffer) => (stdout += d));
      child.stderr.on('data', (d: Buffer) => (stdout += d));
      child.on('close', (code) => resolve({ code, stdout }));
    });
    server.close();

    expect(out.stdout).not.toMatch(/::error::/);
    expect(out.code).toBe(0);
    const post = rec.requests.find((r) => r.method === 'POST');
    expect(JSON.parse(post!.body!).body).toMatch(/## ⚠️ \d+ breaking changes? may affect this repo/);
    expect(readFileSync(path.join(tmp, 'output.txt'), 'utf8')).toMatch(/possibly-affected-count<<[\s\S]*\n[1-9]\d*\n/);
    expect(readFileSync(path.join(tmp, 'summary.md'), 'utf8')).toContain('No AI provider was used.');
  }, 60_000);
});
