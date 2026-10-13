import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assembleNotes, condense, findMigrationLinks, headingVersion, sliceChangelog, splitSections } from '../src/notes/sections.js';

const upstream = (f: string) => readFileSync(new URL(`./fixtures/upstream/${f}`, import.meta.url), 'utf8');

describe('headingVersion', () => {
  it.each([
    ['7.0.0', '7.0.0'],
    ['[5.0.0] - 2024-09-10', '5.0.0'],
    ['v9.0.0 - April 5, 2024', '9.0.0'],
    ['react-router@7.1.0', '7.1.0'],
    ['5.0.0-alpha.1 / 2014-11-06', '5.0.0-alpha.1'],
    ['Breaking Changes', null],
  ])('%s', (h, v) => expect(headingVersion(h)).toBe(v));
});

describe('splitSections', () => {
  it('ignores # inside fenced code', () => {
    const s = splitSections('# A\ntext\n```sh\n# not a heading\n```\n## B\nmore');
    expect(s.map((x) => x.heading)).toEqual(['A', 'B']);
  });
});

describe('sliceChangelog on real changelogs', () => {
  it('react-router (ATX headings, monorepo package changelog)', () => {
    const blocks = sliceChangelog(upstream('react-router.CHANGELOG.md'), '6.28.0', '7.1.0');
    expect(blocks.map((b) => b.version)).toEqual(['7.0.0', '7.0.1', '7.0.2', '7.1.0']);
    const v7 = blocks.find((b) => b.version === '7.0.0')!;
    expect(v7.text).toContain('### Major Changes');
    expect(v7.text).toContain('json');
  });

  it('express (setext headings) includes 5.0.0 prereleases when crossing the major', () => {
    const blocks = sliceChangelog(upstream('express.History.md'), '4.21.2', '5.0.1');
    const versions = blocks.map((b) => b.version);
    expect(versions[0]).toBe('5.0.0-alpha.1');
    expect(versions.at(-1)).toBe('5.0.1');
    expect(versions).not.toContain('4.20.0');
    expect(blocks[0]!.text).toContain('`app.del` - use `app.delete`');
  });

  it('eslint (plain "vX.Y.Z - date" lines)', () => {
    const blocks = sliceChangelog(upstream('eslint.CHANGELOG.md'), '8.57.0', '9.0.0');
    expect(blocks.map((b) => b.version)).toEqual([
      '9.0.0-alpha.0',
      '9.0.0-alpha.1',
      '9.0.0-alpha.2',
      '9.0.0-beta.0',
      '9.0.0-beta.1',
      '9.0.0-beta.2',
      '9.0.0-rc.0',
      '9.0.0',
    ]);
  });

  it('excludes prereleases of a major that is not crossed', () => {
    const md = '## 2.0.0-beta.1\nx\n\n## 1.2.0\ny\n\n## 1.1.0\nz\n';
    expect(sliceChangelog(md, '1.1.0', '1.2.0').map((b) => b.version)).toEqual(['1.2.0']);
  });
});

describe('assembleNotes truncation', () => {
  it('keeps everything under budget', () => {
    const r = assembleNotes([{ title: 'v1', url: 'u', body: '## Fixes\n- a' }], 10_000);
    expect(r.truncated).toBe(false);
    expect(r.text).toContain('- a');
  });

  it('prioritises Breaking / Removed / Migration sections over filler', () => {
    const filler = '## Patch Changes\n' + '- fixed a thing\n'.repeat(400);
    const body = `${filler}\n## Breaking Changes\n- removed \`json\`\n\n## Migration\nUse Response.json\n\n## Features\n- shiny`;
    const r = assembleNotes([{ title: 'v7.0.0', url: 'https://x', body, version: '7.0.0' }], 1500);
    expect(r.truncated).toBe(true);
    expect(r.text).toContain('removed `json`');
    expect(r.text).toContain('Use Response.json');
    expect(r.text.length).toBeLessThan(1700);
  });

  it('condenses an oversized section by keeping breaking lines', () => {
    const text = 'v9.0.0 - April 5, 2024\n' + '* chore: bump\n'.repeat(200) + '* feat!: Remove eslintrc support\n';
    const c = condense(text, 300);
    expect(c).toContain('feat!: Remove eslintrc support');
    expect(c.startsWith('v9.0.0')).toBe(true);
    expect(c.length).toBeLessThanOrEqual(300);
  });

  it('fits the real eslint 9 changelog into a small budget and keeps feat! lines', () => {
    const blocks = sliceChangelog(upstream('eslint.CHANGELOG.md'), '8.57.0', '9.0.0');
    const r = assembleNotes(
      blocks.map((b) => ({ title: b.heading, url: 'https://github.com/eslint/eslint/blob/v9.0.0/CHANGELOG.md', body: b.text, version: b.version })),
      12_000,
    );
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(12_200);
    expect(r.text).toMatch(/feat!: .*flat config/i);
  });
});

describe('findMigrationLinks', () => {
  it('finds upgrade/migration links', () => {
    const md = 'See the [upgrade guide](https://reactrouter.com/upgrading/v6). Also https://eslint.org/docs/latest/use/migrate-to-9.0.0. And [docs](https://x.dev/api).';
    expect(findMigrationLinks(md)).toEqual(['https://reactrouter.com/upgrading/v6', 'https://eslint.org/docs/latest/use/migrate-to-9.0.0']);
  });
});
