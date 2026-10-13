import { describe, expect, it } from 'vitest';
import { componentScript, findUsages, globToRegex, snippet } from '../src/usage/finder.js';
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

describe('findUsages: receivers named after the package', () => {
  it('treats ReactDOM.render as the package member, not any .render (root.render is the replacement)', () => {
    const res = findUsages(root, 'react-dom', [change('render', { affectedSymbols: [{ name: 'ReactDOM.render', type: 'member' }] })]);
    expect(where(res.hits.get('render'))).toEqual(['src/dom.tsx:5']);
  });
});

describe('findUsages: members of imported classes', () => {
  it('NextRequest.geo matches request.geo on an instance of the imported type', () => {
    const res = findUsages(root, 'next', [change('geo', { affectedSymbols: [{ name: 'NextRequest.geo', type: 'member' }] })]);
    expect(where(res.hits.get('geo'))).toEqual(['src/geo.ts:4']);
  });
});

describe('findUsages: module-format changes', () => {
  it('"now ESM-only" matches exactly the require() calls of the package', () => {
    const res = findUsages(root, 'react-router', [
      change('esm-only', { kind: 'runtime', summary: 'react-router is now pure ESM and can no longer be loaded with require()', affectedSymbols: [{ name: 'react-router', type: 'import-path' }] }),
    ]);
    expect(where(res.hits.get('esm-only'))).toEqual(['server/legacy.cjs:1', 'server/legacy.cjs:2', 'server/legacy.cjs:7']);
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
    expect(res.diagnostics).toEqual(expect.arrayContaining([expect.stringContaining('ignored file pattern `**/*.{ts,tsx}` (matches source files)')]));
    expect(res.diagnostics).toEqual(expect.arrayContaining([expect.stringContaining('ignored file pattern `package.json`')]));
    expect(res.unanalysed.join(' ')).not.toContain('ignored file pattern');
  });
});

describe('globToRegex', () => {
  it('supports *, ** and {a,b}', () => {
    expect(globToRegex('.eslintrc.*').test('.eslintrc.json')).toBe(true);
    expect(globToRegex('.eslintrc.*').test('.eslintrc')).toBe(false);
    expect(globToRegex('**/next.config.{js,mjs}').test('apps/web/next.config.mjs')).toBe(true);
  });
});

import { isSecretFile, redact } from '../src/usage/finder.js';
describe('privacy guards', () => {
  it('never reads secret-bearing files', () => {
    for (const f of ['.env', 'apps/web/.env.local', '.npmrc', 'deploy/key.pem', 'config/secrets.json', 'credentials', '.yarnrc.yml']) expect(isSecretFile(f)).toBe(true);
    for (const f of ['src/env.ts', 'package.json', '.eslintrc.json', 'next.config.js']) expect(isSecretFile(f)).toBe(false);
  });
  it('redacts token-shaped values in snippets', () => {
    const text = [
      "const openai = new OpenAI({ apiKey: 'sk-proj-abcdefghijklmnopqrstuvwxyz0123' });",
      'const gh = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";',
      'aws = AKIAABCDEFGHIJKLMNOP',
      'password: "hunter2hunter2"',
      'const ok = res.json({ id });',
    ].join('\n');
    const out = redact(text);
    expect(out).not.toMatch(/sk-proj-abc|ghp_abc|AKIAABC|hunter2/);
    expect(out).toContain("apiKey: '[redacted]'");
    expect(out).toContain('password: "[redacted]"');
    expect(out).toContain('const ok = res.json({ id });');
  });
  it('snippets sent to the model are redacted', () => {
    const lines = ['import x from "pkg";', 'const key = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";', 'x();'];
    expect(snippet(lines, 3, 10).text).not.toContain('ghp_');
  });
});

describe('findUsages: single-file components', () => {
  const components = new URL('./fixtures/projects/components/', import.meta.url).pathname;

  it('parses <script> blocks in .vue and .astro frontmatter with original line numbers', () => {
    const res = findUsages(components, 'vue-router', [
      change('use-router', { affectedSymbols: [{ name: 'useRouter', type: 'export' }] }),
      change('hash', { affectedSymbols: [{ name: 'createWebHashHistory', type: 'export' }] }),
    ]);
    expect(res.importingFiles).toEqual(['src/Nav.vue', 'src/Page.astro']);
    expect(where(res.hits.get('use-router'))).toEqual(['src/Nav.vue:8', 'src/Nav.vue:9', 'src/Page.astro:2', 'src/Page.astro:3']);
    expect(where(res.hits.get('hash'))).toEqual(['src/Nav.vue:8', 'src/Nav.vue:10']);
    expect(res.hits.get('hash')![0]!.matched).toBe('createWebHashHistory as hash');
  });

  it('follows bindings across the two <script> blocks of a .svelte file', () => {
    const res = findUsages(components, '@tanstack/query-core', [
      change('cancel', { affectedSymbols: [{ name: 'QueryClient.cancelQueries', type: 'member' }] }),
    ]);
    expect(where(res.hits.get('cancel'))).toEqual(['src/List.svelte:7']);
  });
});

describe('findUsages: component templates and Vue global properties', () => {
  const components = new URL('./fixtures/projects/components/', import.meta.url).pathname;
  const res = findUsages(components, 'vue-i18n', [change('tc', { affectedSymbols: [{ name: 'tc', type: 'member' }, { name: '$tc', type: 'member' }] })]);

  it('finds members called bare in templates and $-globals in components that do not import the package', () => {
    expect(where(res.hits.get('tc'))).toEqual(['src/Apples.vue:2', 'src/Apples.vue:11', 'src/Uses.vue:2']);
  });

  it('leaves $-globals alone when nothing in the repo uses the package', () => {
    const none = findUsages(components, 'vue-i18n-not-installed', [change('tc', { affectedSymbols: [{ name: '$tc', type: 'member' }] })]);
    expect(none.hits.get('tc')).toEqual([]);
  });
});

describe('componentScript', () => {
  it('handles > inside attribute values (Vue generic="T extends Record<K, V>")', () => {
    const r = componentScript('a.vue', `<script setup lang="ts" generic="T extends Record<string, number>">\nimport { x } from 'p'\n</script>\n<template><p>{{ x }}</p></template>`);
    const lines = r.text.split('\n');
    expect(lines[1]).toBe("import { x } from 'p'");
    expect([lines[0], lines[2], lines[3]].every((l) => !l?.trim())).toBe(true);
  });

  it('skips JSON and template script blocks', () => {
    const r = componentScript('a.astro', `---\nimport A from 'a'\n---\n<script type="application/json">{"b": 1}</script>\n<script>import C from 'c'</script>`);
    expect(r.text).toContain("import A from 'a'");
    expect(r.text).toContain("import C from 'c'");
    expect(r.text).not.toContain('"b"');
  });
});

describe('findUsages: the package name as a search pattern', () => {
  it('is ignored, since it matches every manifest that depends on the package', () => {
    const res = findUsages(root, 'react-router', [change('arity', { kind: 'behavior', searchPatterns: ['react-router', "'react-router'"] })]);
    expect(res.hits.get('arity')).toEqual([]);
    expect(res.diagnostics).toContain('arity: ignored search pattern `react-router` (the package name)');
  });
});
