import { describe, expect, it } from 'vitest';
import { esc, inlineHtml } from '../src/report/render.js';

describe('esc (Markdown text from notes or the model)', () => {
  it('turns @mentions into code so strangers thanked in release notes are not pinged', () => {
    expect(esc('Thanks @kentcdodds! Imports from @remix-run/router can fail')).toBe('Thanks `@kentcdodds`! Imports from `@remix-run/router` can fail');
  });
  it('leaves emails, existing code spans and paths alone', () => {
    expect(esc('mail me at a@b.com, use `@scope/pkg` or node_modules/@types/node')).toBe('mail me at a@b.com, use `@scope/pkg` or node_modules/@types/node');
  });
  it('escapes angle brackets outside code so generics are not eaten as HTML', () => {
    expect(esc('useFetcher<LoaderData>() and `useFetcher<typeof loader>()`')).toBe('useFetcher&lt;LoaderData&gt;() and `useFetcher<typeof loader>()`');
  });
  it('escapes table pipes and joins lines', () => {
    expect(esc('a | b\nc')).toBe('a \\| b c');
  });
});

describe('inlineHtml (<summary> text)', () => {
  it('renders code spans as <code>, escapes HTML and neutralises mentions', () => {
    expect(inlineHtml('`json` removed; see @remix-run/router <b>now</b>')).toBe('<code>json</code> removed; see <code>@remix-run/router</code> &lt;b&gt;now&lt;/b&gt;');
  });
});

import { renderComment } from '../src/report/render.js';
import type { PackageReport, RunReport, VerifiedHit } from '../src/types.js';

function bigReport(packages: number, changes: number, hitsPer: number): RunReport {
  const pkgs: PackageReport[] = Array.from({ length: packages }, (_, p) => ({
    bump: { name: `pkg-${p}`, fromVersion: '1.0.0', toVersion: '2.0.0', bumpType: 'major', manifests: ['package.json'], depTypes: ['dependencies'] },
    notes: { repo: null, text: 'x', sources: [], migrationLinks: [], truncated: false },
    mode: 'ai',
    modelLabel: 'copilot/auto',
    fromCache: false,
    unanalysed: [],
    changes: Array.from({ length: changes }, (_, c) => ({
      change: { id: `c${c}`, summary: `Change ${c} of pkg-${p}: something long enough to matter `.repeat(2), kind: 'removed', affectedSymbols: [{ name: `fn${c}`, type: 'export' }], searchPatterns: [], fileGlobs: [], migration: ['Do the thing', 'Then the other thing'], sourceUrl: 'https://example.com/notes', confidence: 'high' },
      hits: Array.from({ length: hitsPer }, (_, h): VerifiedHit => ({
        id: `c${c}#${h}`, changeId: `c${c}`, file: `src/feature-${h}/file.ts`, line: h + 1, kind: 'symbol', matched: `fn${c}`, snippet: '', snippetStartLine: 1,
        verdict: 'yes', reason: 'Calls the removed function with the old signature.', fix: { before: `  fn${c}(a, b);`, after: `  fn${c}({ a, b });` },
      })),
    })),
  }));
  return { packages: pkgs, skipped: [], repo: { owner: 'o', repo: 'r' }, headSha: 'abc', providerLabel: 'copilot/auto' };
}

describe('renderComment size limit', () => {
  it('stays under GitHub\'s limit with well-formed markup and the headline, table and footer intact', () => {
    const body = renderComment(bigReport(10, 30, 8));
    expect(body.length).toBeLessThanOrEqual(65_536);
    expect(body.split('<details>').length).toBe(body.split('</details>').length);
    expect((body.match(/```/g) ?? []).length % 2).toBe(0);
    expect(body).toMatch(/^## ⚠️ 300 breaking changes affect this repo/m);
    expect(body).toContain('| `pkg-9`'.replace('`pkg-9`', '[`pkg-9`]'));
    expect(body).toContain('This is advisory');
  });

  it('degrades gracefully for absurd sizes: drops whole sections, never cuts markup', () => {
    const body = renderComment(bigReport(40, 60, 20));
    expect(body.length).toBeLessThanOrEqual(65_536);
    expect(body.split('<details>').length).toBe(body.split('</details>').length);
    expect((body.match(/```/g) ?? []).length % 2).toBe(0);
    expect(body).toMatch(/more affected change\(s\) not shown/);
    expect(body).toContain('This is advisory');
  });
});

describe('headline when the notes list nothing', () => {
  it('says so instead of "0 checked"', () => {
    const r = bigReport(1, 0, 0);
    expect(renderComment(r)).toMatch(/^## ✅ The release notes list no breaking changes \(1 package checked\)$/m);
  });
});

describe('suggested fixes', () => {
  it('shows a fix once when neighbouring hits in the same file repeat it', () => {
    const r = bigReport(1, 1, 3);
    const hits = r.packages[0]!.changes[0]!.hits;
    const fix = { before: "export const useCart = defineStore({\n  id: 'cart',", after: "export const useCart = defineStore('cart', {" };
    hits.forEach((h, i) => Object.assign(h, { file: 'src/stores/cart.ts', line: [1, 4, 5][i] }));
    hits[0]!.fix = fix;
    hits[1]!.fix = { ...fix };
    hits[2]!.fix = { before: "id: 'cart',", after: '' };
    const body = renderComment(r);
    expect(body.match(/Suggested fix/g)).toHaveLength(1);
    expect(body).toContain('src/stores/cart.ts:5');
  });

  it('still shows the same change in different files', () => {
    const body = renderComment(bigReport(1, 1, 3));
    expect(body.match(/Suggested fix/g)).toHaveLength(3);
  });
});
