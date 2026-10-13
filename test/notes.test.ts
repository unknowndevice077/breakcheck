import { describe, expect, it } from 'vitest';
import { pickChangelog, pickMigrationGuides } from '../src/notes/fetch.js';
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
