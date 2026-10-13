import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractByRules, identifiers } from '../src/extract/rules.js';
import { extractionSchema, validate } from '../src/extract/schema.js';
import { assembleNotes, sliceChangelog, type NoteBlock } from '../src/notes/sections.js';

const upstream = (f: string) => readFileSync(new URL(`./fixtures/upstream/${f}`, import.meta.url), 'utf8');

function notesFor(file: string, from: string, to: string, guide?: string): string {
  const blocks: NoteBlock[] = sliceChangelog(upstream(file), from, to).map((b) => ({
    title: `${file} ${b.heading}`,
    url: `https://example.test/${file}`,
    body: b.text,
    version: b.version,
  }));
  if (guide) blocks.push({ title: `Migration guide ${guide}`, url: `https://example.test/${guide}`, body: upstream(guide), priorityFloor: 3 });
  return assembleNotes(blocks, 30_000).text;
}

const byName = (r: ReturnType<typeof extractByRules>) => (name: string) => r.breakingChanges.find((c) => c.affectedSymbols.some((s) => s.name === name));

describe('extractByRules on real changelogs', () => {
  it('react-router 6.28 → 7.1: Major Changes bullets, nested export lists, future flags', () => {
    const r = extractByRules(notesFor('react-router.CHANGELOG.md', '6.28.0', '7.1.0', 'react-router.upgrading-v6.md'), 'react-router');
    expect(validate(r, extractionSchema)).toEqual([]);
    const find = byName(r);
    const defer = find('defer')!;
    expect(defer.kind).toBe('removed');
    expect(defer.affectedSymbols.map((s) => s.name)).toEqual(expect.arrayContaining(['defer', 'AbortedDeferredError', 'UNSAFE_DeferredData']));
    expect(find('json')).toMatchObject({ kind: 'removed', confidence: 'low' });
    expect(find('v7_startTransition')?.affectedSymbols[0]?.type).toBe('option');
    expect(find('@remix-run/router')?.affectedSymbols[0]?.type).toBe('import-path');
    // "`createBrowserHistory` -> in favor of `createBrowserRouter`": only the removed name is affected
    const cleanup = find('createBrowserHistory')!;
    expect(cleanup.affectedSymbols.map((s) => s.name)).not.toContain('createBrowserRouter');
    expect(r.breakingChanges.every((c) => c.sourceUrl?.startsWith('https://example.test/'))).toBe(true);
  });

  it('express 4 → 5: "remove:" parents, member APIs, and never the replacement API', () => {
    const r = extractByRules(notesFor('express.History.md', '4.21.2', '5.0.1'), 'express');
    const find = byName(r);
    expect(find('app.del')).toMatchObject({ kind: 'removed', summary: 'Removed: `app.del` - use `app.delete`' });
    expect(find('app.del')!.affectedSymbols).toEqual([{ name: 'app.del', type: 'member' }]);
    expect(find('res.sendfile')).toBeDefined();
    expect(find('req.param')).toBeDefined();
    expect(find('app.delete')).toBeUndefined();
    expect(find('res.sendFile')).toBeUndefined();
    expect(find('req.host')?.summary).toMatch(/^Changed:/);
    expect(find('app.del')!.migration[0]).toContain('use `app.delete`');
  });

  it('eslint 8 → 9: conventional `!:` commits and the migration guide (flat config → .eslintrc globs)', () => {
    const notes = notesFor('eslint.CHANGELOG.md', '8.57.0', '9.0.0', 'eslint.migrate-to-9.0.0.md');
    const r = extractByRules(notes, 'eslint');
    const flat = r.breakingChanges.find((c) => /New default config format/.test(c.summary))!;
    expect(flat.fileGlobs).toEqual(['.eslintrc', '.eslintrc.*']);
    expect(byName(r)('--quiet')?.kind).toBe('cli');
    const rename = byName(r)('FlatRuleTester')!;
    expect(rename.kind).toBe('renamed');
    expect(rename.affectedSymbols.map((s) => s.name)).not.toContain('RuleTester'); // the replacement isn't affected
  });

  it('skips non-breaking conventional commits like "chore: remove …"', () => {
    const notes = '=== v9.0.0 (https://x) ===\nv9.0.0 - April 5, 2024\n\n* [`c0f5d91`](https://x/c) chore: remove an unused instance of Linter in tests (Someone)\n* [`bdd6ba1`](https://x/c) feat!: Remove valid-jsdoc and require-jsdoc (Someone)\n';
    const r = extractByRules(notes, 'eslint');
    expect(r.breakingChanges.map((c) => c.summary)).toEqual(['feat!: Remove valid-jsdoc and require-jsdoc']);
  });

  it('next 14 → 15 migration guide: headings become changes', () => {
    const notes = `=== Migration guide docs/02-version-15.mdx (https://x/v15) ===\n${upstream('next.version-15.mdx')}`;
    const r = extractByRules(notes, 'next');
    const summaries = r.breakingChanges.map((c) => c.summary);
    expect(summaries).toEqual(expect.arrayContaining(['Async Request APIs', '`runtime` configuration', '`next/font`']));
    const asyncApis = r.breakingChanges.find((c) => c.summary.startsWith('Async Request APIs'))!;
    expect(asyncApis.affectedSymbols.map((s) => s.name)).toEqual(expect.arrayContaining(['cookies', 'headers', 'draftMode']));
  });

  it('returns nothing for notes without breaking signals', () => {
    expect(extractByRules('=== v1.2.0 (https://x) ===\n## Features\n- add `foo`\n', 'x').breakingChanges).toEqual([]);
  });
});

describe('identifiers', () => {
  it('classifies backticked identifiers', () => {
    const ids = identifiers('`--ext` `.babelrc` `res.sendfile()` `<Await>` `v7_fetcherPersist` `no-unused-vars` `react-router/dom` `abc1234` `true`', 'react-router', 20);
    expect(ids.map((i) => [i.name, i.type])).toEqual([
      ['--ext', 'cli-flag'],
      ['.babelrc', 'other'],
      ['res.sendfile', 'member'],
      ['Await', 'export'],
      ['v7_fetcherPersist', 'option'],
      ['no-unused-vars', 'config-key'],
      ['react-router/dom', 'import-path'],
    ]);
  });
  it('reads removed imports from diff code blocks', () => {
    expect(identifiers('```diff\n- import { json, defer } from "react-router";\n+ import { data } from "react-router";\n```', 'react-router', 10).map((i) => i.name)).toEqual(['json', 'defer']);
  });
});
