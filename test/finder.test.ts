import { describe, expect, it } from 'vitest';
import { findUsages, globToRegex } from '../src/usage/finder.js';
import type { BreakingChange } from '../src/types.js';

const root = new URL('./fixtures/projects/usage/', import.meta.url).pathname;

function change(id: string, partial: Partial<BreakingChange>): BreakingChange {
  return { id, summary: id, kind: 'removed', affectedSymbols: [], searchPatterns: [], fileGlobs: [], migration: [], sourceUrl: null, confidence: 'high', ...partial };
}
const where = (hits: { file: string; line: number }[] | undefined) => (hits ?? []).map((h) => `${h.file}:${h.line}`);

describe('findUsages: react-router exports', () => {
  const changes = [
    change('json-removed', { affectedSymbols: [{ name: 'json', type: 'export' }] }),
    change('defer-removed', { affectedSymbols: [{ name: 'defer', type: 'export' }] }),
    change('dom-collapsed', { affectedSymbols: [{ name: 'react-router-dom', type: 'import-path' }] }),
    change('start-transition', { kind: 'config', affectedSymbols: [{ name: 'v7_startTransition', type: 'option' }] }),
  ];
  const res = findUsages(root, 'react-router', changes);

  it('finds named, aliased, namespace, require(), re-export and dynamic-import usages', () => {
    expect(where(res.hits.get('json-removed'))).toEqual([
      'server/legacy.cjs:1', // const { json: sendJson } = require()
      'server/legacy.cjs:5', // sendJson({})
      'server/legacy.cjs:7', // require('react-router').json
      'src/dynamic.mjs:2', // const { json } = await import()
      'src/dynamic.mjs:3',
      'src/reexport.ts:1', // export { json } from
      'src/routes/aliased.tsx:1', // import { json as toJson }
      'src/routes/aliased.tsx:4', // toJson(...)
      'src/routes/named.ts:1',
      'src/routes/named.ts:6',
      'src/routes/namespace.ts:3', // RR.json
    ]);
  });

  it('reports what matched, including the alias', () => {
    const aliased = res.hits.get('json-removed')!.find((h) => h.file === 'src/routes/aliased.tsx' && h.line === 1)!;
    expect(aliased.matched).toBe('json as toJson');
    expect(res.hits.get('json-removed')!.find((h) => h.file === 'src/routes/namespace.ts')!.matched).toBe('RR.json');
  });

  it('ignores files that do not import the package and anything in node_modules', () => {
    const files = new Set(where(res.hits.get('json-removed')).map((w) => w.split(':')[0]));
    expect(files.has('src/unrelated.ts')).toBe(false);
    expect([...files].some((f) => f!.includes('node_modules'))).toBe(false);
  });

  it('follows namespace-style require and dynamic import bindings', () => {
    expect(where(res.hits.get('defer-removed'))).toEqual(['server/legacy.cjs:6', 'src/dynamic.mjs:8', 'src/reexport.ts:1']);
  });

  it('finds subpath / sibling package imports and option names', () => {
    expect(where(res.hits.get('dom-collapsed'))).toEqual(['src/App.tsx:1']);
    expect(where(res.hits.get('start-transition'))).toEqual(['src/App.tsx:5']);
  });

  it('lists what it could not analyse', () => {
    expect(res.unanalysed).toEqual(
      expect.arrayContaining([expect.stringMatching(/src\/dynamic\.mjs:12: dynamic `import\(\)`/), expect.stringMatching(/src\/reexport\.ts:2: `export \* from 'react-router'`/)]),
    );
  });

  it('attaches ±10 lines of numbered context and marks the hit line', () => {
    const hit = res.hits.get('json-removed')!.find((h) => h.file === 'src/routes/named.ts' && h.line === 6)!;
    expect(hit.snippetStartLine).toBe(1);
    expect(hit.snippet).toContain('> 6 |   return json({ user });');
    expect(hit.snippet.split('\n')).toHaveLength(9); // file has 9 lines
    expect(hit.id).toBe('json-removed#10');
  });
});

describe('findUsages: express members (default imports under any name)', () => {
  const res = findUsages(root, 'express', [
    change('app-del', { affectedSymbols: [{ name: 'app.del', type: 'member' }] }),
    change('sendfile', { affectedSymbols: [{ name: 'res.sendfile', type: 'member' }] }),
    change('express-query', { affectedSymbols: [{ name: 'express.query', type: 'member' }] }),
    change('express-json', { affectedSymbols: [{ name: 'express.json', type: 'member' }] }),
  ]);
  it('matches instance members by property name in importing files', () => {
    expect(where(res.hits.get('app-del'))).toEqual(['server/app.js:8']);
    expect(where(res.hits.get('sendfile'))).toEqual(['server/app.js:9']);
  });
  it('matches package-object members through the default import, whatever it is called', () => {
    expect(where(res.hits.get('express-query'))).toEqual(['server/app.js:5']);
    expect(res.hits.get('express-json')!.map((h) => h.matched)).toEqual(['e.json']);
  });
  it('does not match res.json for express.json', () => {
    expect(where(res.hits.get('express-json'))).not.toContain('server/app.js:12');
  });
});

describe('findUsages: eslint config, CLI flags and file globs', () => {
  const res = findUsages(root, 'eslint', [
    change('flat-config', { kind: 'config', fileGlobs: ['.eslintrc', '.eslintrc.*'] }),
    change('ext-flag', { kind: 'cli', affectedSymbols: [{ name: '--ext', type: 'cli-flag' }] }),
    change('quiet-flag', { kind: 'cli', affectedSymbols: [{ name: '--quiet', type: 'cli-flag' }] }),
    change('vars-ignore', { kind: 'config', affectedSymbols: [{ name: 'varsIgnorePattern', type: 'option' }] }),
    change('recommended-string', { kind: 'config', searchPatterns: ['/"eslint:(recommended|all)"/'] }),
  ]);
  it('flags legacy config files by existence', () => {
    expect(where(res.hits.get('flat-config'))).toEqual(['.eslintrc.json:1']);
    expect(res.hits.get('flat-config')![0]!.kind).toBe('file');
  });
  it('finds CLI flags in package.json scripts and shell scripts, only on lines invoking the tool', () => {
    expect(where(res.hits.get('ext-flag'))).toEqual(['package.json:5']);
    expect(where(res.hits.get('quiet-flag'))).toEqual(['scripts/check.sh:2']);
  });
  it('finds options and regex patterns in config files', () => {
    expect(where(res.hits.get('vars-ignore'))).toEqual(['.eslintrc.json:3']);
    expect(where(res.hits.get('recommended-string'))).toEqual(['.eslintrc.json:2']);
  });
});

describe('findUsages: the package itself as an import path', () => {
  it('is ignored, since it would match every import', () => {
    const res = findUsages(root, 'react-router', [change('whole-pkg', { affectedSymbols: [{ name: 'react-router', type: 'import-path' }] })]);
    expect(res.hits.get('whole-pkg')).toEqual([]);
  });
});

describe('findUsages: file globs every project matches', () => {
  it('ignores package.json/lockfile globs instead of flagging every repo', () => {
    const res = findUsages(root, 'react-router', [
      change('node-20', { kind: 'runtime', fileGlobs: ['package.json', '**/package-lock.json'] }),
      change('broad', { kind: 'other', fileGlobs: ['**/*.{ts,tsx}', '*.js'] }),
    ]);
    expect(res.hits.get('node-20')).toEqual([]);
    expect(res.hits.get('broad')).toEqual([]);
    expect(res.unanalysed).toEqual(expect.arrayContaining([expect.stringContaining('ignored file pattern `**/*.{ts,tsx}` (matches source files)')]));
    expect(res.unanalysed).toEqual(expect.arrayContaining([expect.stringContaining('ignored file pattern `package.json`')]));
  });
});

describe('globToRegex', () => {
  it('supports *, ** and {a,b}', () => {
    expect(globToRegex('.eslintrc.*').test('.eslintrc.json')).toBe(true);
    expect(globToRegex('.eslintrc.*').test('.eslintrc')).toBe(false);
    expect(globToRegex('**/next.config.{js,mjs}').test('apps/web/next.config.mjs')).toBe(true);
  });
});
