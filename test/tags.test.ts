import { describe, expect, it } from 'vitest';
import { inRange, majorsCrossed, parseTag, prefixMatches, selectTags, tagCandidates } from '../src/notes/tags.js';

describe('parseTag', () => {
  it.each([
    ['v1.2.3', '', '1.2.3'],
    ['1.2.3', '', '1.2.3'],
    ['react-router@7.1.0', 'react-router', '7.1.0'],
    ['@remix-run/router@1.21.0', '@remix-run/router', '1.21.0'],
    ['eslint-plugin-react-hooks@5.0.0', 'eslint-plugin-react-hooks', '5.0.0'],
    ['pkg-v1.2.3', 'pkg', '1.2.3'],
    ['pkg-1.2.3', 'pkg', '1.2.3'],
    ['pkg/v1.2.3', 'pkg', '1.2.3'],
    ['typescript-eslint_v8.0.0', 'typescript-eslint', '8.0.0'],
    ['v15.0.0-canary.12', '', '15.0.0-canary.12'],
    ['release-2.0.0', 'release', '2.0.0'],
  ])('%s', (tag, prefix, version) => {
    expect(parseTag(tag)).toEqual({ tag, prefix, version });
  });

  it('rejects non-version tags', () => {
    expect(parseTag('latest')).toBeNull();
    expect(parseTag('v1.2')).toBeNull();
    expect(parseTag('nightly-2024-01-01')).toBeNull();
  });
});

describe('prefixMatches', () => {
  it('accepts generic and own-package prefixes', () => {
    expect(prefixMatches('', 'express')).toBe(true);
    expect(prefixMatches('react-router', 'react-router')).toBe(true);
    expect(prefixMatches('router', '@remix-run/router')).toBe(true);
    expect(prefixMatches('@remix-run/router', '@remix-run/router')).toBe(true);
    expect(prefixMatches('remix-run-router', '@remix-run/router')).toBe(true);
  });
  it('rejects sibling packages in a monorepo', () => {
    expect(prefixMatches('react-router-dom', 'react-router')).toBe(false);
    expect(prefixMatches('@remix-run/router', 'react-router')).toBe(false);
  });
});

describe('inRange', () => {
  it('is (from, to]', () => {
    expect(inRange('6.28.0', '6.28.0', '7.1.0')).toBe(false);
    expect(inRange('7.0.0', '6.28.0', '7.1.0')).toBe(true);
    expect(inRange('7.1.0', '6.28.0', '7.1.0')).toBe(true);
    expect(inRange('7.1.1', '6.28.0', '7.1.0')).toBe(false);
  });
  it('ignores prereleases unless the target is a prerelease of the same major', () => {
    expect(inRange('7.0.0-pre.1', '6.28.0', '7.1.0')).toBe(false);
    expect(inRange('15.0.0-rc.1', '14.2.0', '15.0.0-rc.2')).toBe(true);
  });
});

describe('selectTags', () => {
  const monorepoTags = [
    'react-router@7.1.1',
    'react-router@7.1.0',
    'react-router-dom@7.1.0',
    '@remix-run/router@1.21.0',
    'react-router@7.0.0',
    'react-router@7.0.0-pre.3',
    'react-router@6.28.1',
    'react-router@6.28.0',
    'v7.0.0',
  ];
  it('picks only this package within the range, ascending, preferring prefixed tags', () => {
    expect(selectTags(monorepoTags, 'react-router', '6.28.0', '7.1.0').map((t) => t.tag)).toEqual([
      'react-router@6.28.1',
      'react-router@7.0.0',
      'react-router@7.1.0',
    ]);
  });
  it('handles plain v-tags', () => {
    expect(selectTags(['v5.0.1', 'v5.0.0', 'v4.21.2', '5.0.0-beta.3'], 'express', '4.21.2', '5.0.1').map((t) => t.tag)).toEqual(['v5.0.0', 'v5.0.1']);
  });
  it('handles pkg-v tags', () => {
    expect(selectTags(['foo-v2.0.0', 'bar-v2.0.0', 'foo-v1.9.0'], 'foo', '1.9.0', '2.0.0').map((t) => t.tag)).toEqual(['foo-v2.0.0']);
  });
});

describe('tagCandidates / majorsCrossed', () => {
  it('lists plausible tags for a version', () => {
    expect(tagCandidates('@scope/pkg', '1.2.3')).toEqual(['v1.2.3', '1.2.3', '@scope/pkg@1.2.3', 'pkg@1.2.3', 'pkg-v1.2.3', 'pkg@v1.2.3', 'pkg/v1.2.3', 'pkg-1.2.3']);
  });
  it('lists majors crossed', () => {
    expect(majorsCrossed('6.28.0', '8.1.0')).toEqual([7, 8]);
    expect(majorsCrossed('6.28.0', '6.30.0')).toEqual([]);
  });
});
