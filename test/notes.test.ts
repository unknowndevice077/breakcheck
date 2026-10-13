import { describe, expect, it } from 'vitest';
import { gatherNotes, isPointerOnly, pickChangelog, pickMigrationGuides } from '../src/notes/fetch.js';
import type { GitHubApi, Release } from '../src/github.js';
import { parseGitHubRepo } from '../src/notes/registry.js';

describe('parseGitHubRepo', () => {
  it.each([
    ['git+https://github.com/expressjs/express.git', { owner: 'expressjs', repo: 'express' }],
    ['git://github.com/eslint/eslint.git', { owner: 'eslint', repo: 'eslint' }],
    ['git@github.com:vercel/next.js.git', { owner: 'vercel', repo: 'next.js' }],
    ['github:remix-run/react-router', { owner: 'remix-run', repo: 'react-router' }],
    ['remix-run/react-router', { owner: 'remix-run', repo: 'react-router' }],
    ['https://github.com/vercel/next.js/tree/canary/packages/next', { owner: 'vercel', repo: 'next.js', directory: 'packages/next' }],
  ])('%s', (url, expected) => expect(parseGitHubRepo(url)).toEqual(expected));

  it('reads the monorepo directory field', () => {
    expect(parseGitHubRepo({ type: 'git', url: 'git+https://github.com/remix-run/react-router.git', directory: 'packages/react-router' })).toEqual({
      owner: 'remix-run',
      repo: 'react-router',
      directory: 'packages/react-router',
    });
  });

  it('returns null for non-GitHub hosts', () => {
    expect(parseGitHubRepo('https://gitlab.com/a/b.git')).toBeNull();
    expect(parseGitHubRepo('gitlab:a/b')).toBeNull();
    expect(parseGitHubRepo(undefined)).toBeNull();
  });
});

describe('pickChangelog', () => {
  it('prefers the package directory in a monorepo', () => {
    expect(pickChangelog(['CHANGELOG.md', 'packages/react-router/CHANGELOG.md'], 'packages/react-router')).toBe('packages/react-router/CHANGELOG.md');
    expect(pickChangelog(['History.md', 'README.md'])).toBe('History.md');
    expect(pickChangelog(['README.md'])).toBeNull();
  });
});

describe('pickMigrationGuides', () => {
  it('eslint: migrate-to-9.0.0', () => {
    const paths = ['docs/src/use/migrate-to-8.0.0.md', 'docs/src/use/migrate-to-9.0.0.md', 'docs/src/use/configure/migration-guide.md', 'tests/fixtures/migrate-to-9.0.0.md'];
    expect(pickMigrationGuides(paths, undefined, [9], 8)[0]).toBe('docs/src/use/migrate-to-9.0.0.md');
  });
  it('react-router: docs/upgrading/v6.md is the guide for leaving v6', () => {
    const paths = ['docs/upgrading/v6.md', 'docs/upgrading/remix.md', 'docs/upgrading/component-routes.md'];
    expect(pickMigrationGuides(paths, 'packages/react-router', [7], 6)).toEqual(['docs/upgrading/v6.md']);
  });
  it('next: ignores ordering prefixes like 02-version-15', () => {
    const paths = [
      'docs/02-app/01-building-your-application/11-upgrading/01-codemods.mdx',
      'docs/02-app/01-building-your-application/11-upgrading/02-version-15.mdx',
      'docs/02-app/01-building-your-application/11-upgrading/03-version-14.mdx',
    ];
    expect(pickMigrationGuides(paths, 'packages/next', [15], 14)).toEqual(['docs/02-app/01-building-your-application/11-upgrading/02-version-15.mdx']);
  });
  it('root MIGRATION.md / UPGRADING.md always qualify', () => {
    expect(pickMigrationGuides(['UPGRADING.md', 'README.md'], undefined, [3], 2)).toEqual(['UPGRADING.md']);
  });
});

describe('isPointerOnly', () => {
  it.each([
    ['See the [CHANGELOG](https://github.com/remix-run/react-router/blob/main/CHANGELOG.md#v7180) for details.', true],
    ['See https://github.com/x/y/blob/main/CHANGELOG.md', true],
    ['', true],
    ['- Remove `foo`', false],
    ['### Breaking Changes\n- `json` was removed; return plain objects.\n- `defer` was removed.', false],
  ])('%j → %s', (body, expected) => expect(isPointerOnly(body)).toBe(expected));
});

describe('gatherNotes: projects with more releases than we page through', () => {
  it('still fetches the x.0.0 release that lists the breaking changes', async () => {
    // 5 full pages of newest-first patch releases (5.104.x … 5.100.x), none reaching 4.44.0
    const page = (n: number): Release[] =>
      Array.from({ length: 100 }, (_, i) => {
        const minor = 104 - n;
        const v = `5.${minor}.${99 - i}`;
        return { tag: `v${v}`, name: `v${v}`, body: `- fix(query-core): something small in ${v}`, url: `https://x/${v}`, draft: false, prerelease: false };
      });
    const asked: string[] = [];
    const gh = {
      stats: { requests: 0, rateLimited: 0 },
      listReleases: async (_o: string, _r: string, p: number) => page(p - 1),
      getReleaseByTag: async (_o: string, _r: string, tag: string) => {
        asked.push(tag);
        return tag === 'v5.0.0' ? { tag, name: tag, body: '## Breaking changes\n- `cacheTime` was renamed to `gcTime`', url: 'https://x/v5.0.0', draft: false, prerelease: false } : null;
      },
      refExists: async () => false,
      listTree: async () => ({ paths: [], truncated: false }),
      getFile: async () => null,
    } as unknown as GitHubApi;
    const registry = { repoFor: async () => ({ repo: { owner: 'TanStack', repo: 'query' }, rawRepository: 'x' }) };
    const notes = await gatherNotes(gh, registry, { name: '@tanstack/react-query', fromVersion: '4.44.0', toVersion: '5.104.2', bumpType: 'major', manifests: [], depTypes: [] }, { budget: 30_000 });
    expect(asked).toContain('v5.0.0');
    expect(notes.sources.map((x) => x.title)).toContain('v5.0.0');
    expect(notes.text).toContain('`cacheTime` was renamed to `gcTime`');
  });
});

import { checkSourceUrl } from '../src/run.js';
describe('checkSourceUrl', () => {
  const notes = { repo: null, text: 'x', truncated: false, migrationLinks: [], sources: [{ kind: 'release' as const, url: 'https://github.com/facebook/react/releases/tag/v19.0.0', title: 'v19.0.0' }] };
  it('keeps links into fetched documents, including anchors', () => {
    expect(checkSourceUrl('https://github.com/facebook/react/releases/tag/v19.0.0#breaking', notes)).toBe('https://github.com/facebook/react/releases/tag/v19.0.0#breaking');
  });
  it('replaces invented links with a real source', () => {
    expect(checkSourceUrl('https://github.com/react/react/releases/tag/v19.0.0', notes)).toBe('https://github.com/facebook/react/releases/tag/v19.0.0');
    expect(checkSourceUrl(null, notes)).toBe('https://github.com/facebook/react/releases/tag/v19.0.0');
  });
});
