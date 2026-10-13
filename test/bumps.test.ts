import { describe, expect, it } from 'vitest';
import { classifyBump, detectBumps, type ReadFile } from '../src/bumps/detect.js';

function repo(base: Record<string, string>, head: Record<string, string>): ReadFile {
  return async (file, side) => (side === 'base' ? base : head)[file] ?? null;
}

const pkg = (deps: Record<string, string>, dev: Record<string, string> = {}) =>
  JSON.stringify({ name: 'app', dependencies: deps, devDependencies: dev });

describe('classifyBump', () => {
  it('classifies semver changes', () => {
    expect(classifyBump('6.28.0', '7.1.0')).toBe('major');
    expect(classifyBump('4.1.0', '4.2.0')).toBe('minor');
    expect(classifyBump('4.1.0', '4.1.3')).toBe('patch');
  });
  it('treats 0.x minor and 0.0.x patch bumps as major', () => {
    expect(classifyBump('0.3.1', '0.4.0')).toBe('major');
    expect(classifyBump('0.0.3', '0.0.4')).toBe('major');
    expect(classifyBump('0.3.1', '0.3.2')).toBe('patch');
  });
  it('rejects downgrades and invalid versions', () => {
    expect(classifyBump('2.0.0', '1.0.0')).toBeNull();
    expect(classifyBump('x', '1.0.0')).toBeNull();
  });
});

describe('detectBumps: npm', () => {
  const lockV3 = (rr: string, express: string) =>
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { 'react-router': '^6.0.0', express: '^4.0.0' } },
        'node_modules/react-router': { version: rr },
        'node_modules/express': { version: express },
        'node_modules/express/node_modules/debug': { version: '2.6.9' },
      },
    });

  it('reads exact versions from package-lock v3 (Dependabot style: manifest + lockfile)', async () => {
    const read = repo(
      { 'package.json': pkg({ 'react-router': '^6.28.0', express: '^4.21.0' }), 'package-lock.json': lockV3('6.28.1', '4.21.2') },
      { 'package.json': pkg({ 'react-router': '^7.1.0', express: '^4.21.0' }), 'package-lock.json': lockV3('7.1.3', '4.21.2') },
    );
    const { bumps } = await detectBumps(['package.json', 'package-lock.json'], read, { includePatch: false });
    expect(bumps).toEqual([
      { name: 'react-router', fromVersion: '6.28.1', toVersion: '7.1.3', bumpType: 'major', manifests: ['package.json'], depTypes: ['dependencies'] },
    ]);
  });

  it('detects lockfile-only bumps within the declared range', async () => {
    const m = pkg({ 'react-router': '^6.0.0', express: '^4.0.0' });
    const read = repo(
      { 'package.json': m, 'package-lock.json': lockV3('6.20.0', '4.18.0') },
      { 'package.json': m, 'package-lock.json': lockV3('6.28.0', '4.18.3') },
    );
    const res = await detectBumps(['package-lock.json'], read, { includePatch: false });
    expect(res.bumps.map((b) => `${b.name} ${b.fromVersion}->${b.toVersion} ${b.bumpType}`)).toEqual(['react-router 6.20.0->6.28.0 minor']);
    expect(res.skipped).toEqual([{ name: 'express', reason: expect.stringContaining('patch bump 4.18.0 → 4.18.3') }]);
  });

  it('includes patch bumps when asked', async () => {
    const m = pkg({ express: '^4.0.0' });
    const read = repo(
      { 'package.json': m, 'package-lock.json': lockV3('6.0.0', '4.18.0') },
      { 'package.json': m, 'package-lock.json': lockV3('6.0.0', '4.18.3') },
    );
    const res = await detectBumps(['package-lock.json'], read, { includePatch: true });
    expect(res.bumps.map((b) => b.bumpType)).toEqual(['patch']);
  });

  it('supports lockfile v1', async () => {
    const lock = (v: string) => JSON.stringify({ lockfileVersion: 1, dependencies: { eslint: { version: v } } });
    const read = repo(
      { 'package.json': pkg({}, { eslint: '^8.57.0' }), 'package-lock.json': lock('8.57.1') },
      { 'package.json': pkg({}, { eslint: '^9.0.0' }), 'package-lock.json': lock('9.17.0') },
    );
    const { bumps } = await detectBumps(['package.json', 'package-lock.json'], read, { includePatch: false });
    expect(bumps[0]).toMatchObject({ name: 'eslint', fromVersion: '8.57.1', toVersion: '9.17.0', depTypes: ['devDependencies'] });
  });

  it('falls back to the manifest range when there is no lockfile', async () => {
    const read = repo({ 'package.json': pkg({ next: '^14.2.3' }) }, { 'package.json': pkg({ next: '^15.0.3' }) });
    const { bumps } = await detectBumps(['package.json'], read, { includePatch: false });
    expect(bumps[0]).toMatchObject({ name: 'next', fromVersion: '14.2.3', toVersion: '15.0.3', bumpType: 'major' });
  });

  it('ignores newly added deps, removed deps, workspace: and git specs', async () => {
    const read = repo(
      { 'package.json': pkg({ a: '^1.0.0', gone: '^1.0.0', w: 'workspace:*', g: 'github:x/y' }) },
      { 'package.json': pkg({ a: '^1.0.0', added: '^2.0.0', w: 'workspace:*', g: 'github:x/z' }) },
    );
    const { bumps } = await detectBumps(['package.json'], read, { includePatch: true });
    expect(bumps).toEqual([]);
  });

  it('resolves npm workspaces (nested node_modules first, then hoisted)', async () => {
    const lock = (nested: string, hoisted: string) =>
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { workspaces: ['apps/*'] },
          'apps/web': { dependencies: { next: '^14' } },
          'node_modules/web': { resolved: 'apps/web', link: true },
          'apps/web/node_modules/next': { version: nested },
          'node_modules/next': { version: hoisted },
        },
      });
    const root = JSON.stringify({ name: 'root', workspaces: ['apps/*'] });
    const read = repo(
      { 'package.json': root, 'apps/web/package.json': pkg({ next: '^14.2.0' }), 'package-lock.json': lock('14.2.15', '13.0.0') },
      { 'package.json': root, 'apps/web/package.json': pkg({ next: '^15.0.0' }), 'package-lock.json': lock('15.1.0', '13.0.0') },
    );
    const { bumps } = await detectBumps(['apps/web/package.json', 'package-lock.json'], read, { includePatch: false });
    expect(bumps).toEqual([
      { name: 'next', fromVersion: '14.2.15', toVersion: '15.1.0', bumpType: 'major', manifests: ['apps/web/package.json'], depTypes: ['dependencies'] },
    ]);
  });
});

describe('detectBumps: request economy', () => {
  it('does not probe for lockfiles in subdirectories when the workspace root lockfile changed', async () => {
    const files: Record<string, string> = {};
    const reads: string[] = [];
    const read: ReadFile = async (f, side) => {
      reads.push(f);
      return side === 'base' ? (files[`b:${f}`] ?? null) : (files[`h:${f}`] ?? null);
    };
    const lock = (v: string) => `lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n\n  apps/web:\n    dependencies:\n      next:\n        specifier: ${v}\n        version: ${v}\n`;
    Object.assign(files, {
      'b:package.json': '{}', 'h:package.json': '{}',
      'b:apps/web/package.json': pkg({ next: '14.2.15' }), 'h:apps/web/package.json': pkg({ next: '15.1.0' }),
      'b:pnpm-lock.yaml': lock('14.2.15'), 'h:pnpm-lock.yaml': lock('15.1.0'),
    });
    const { bumps } = await detectBumps(['apps/web/package.json', 'pnpm-lock.yaml'], read, { includePatch: false });
    expect(bumps.map((b) => b.name)).toEqual(['next']);
    expect(reads.filter((f) => /lock|shrinkwrap/.test(f) && f !== 'pnpm-lock.yaml')).toEqual([]);
  });
});

describe('detectBumps: pnpm', () => {
  const v9 = (rr: string) => `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    dependencies:
      react-router:
        specifier: ^${rr}
        version: ${rr}(react-dom@18.3.1(react@18.3.1))(react@18.3.1)
    devDependencies:
      typescript:
        specifier: ^5.6.0
        version: 5.6.3
`;
  it('reads pnpm v9 importers and strips peer suffixes', async () => {
    const read = repo(
      { 'package.json': pkg({ 'react-router': '^6.28.0' }), 'pnpm-lock.yaml': v9('6.28.0') },
      { 'package.json': pkg({ 'react-router': '^7.1.1' }), 'pnpm-lock.yaml': v9('7.1.1') },
    );
    const { bumps } = await detectBumps(['package.json', 'pnpm-lock.yaml'], read, { includePatch: false });
    expect(bumps.map((b) => [b.name, b.fromVersion, b.toVersion])).toEqual([['react-router', '6.28.0', '7.1.1']]);
  });

  it('reads pnpm v5 top-level dependencies', async () => {
    const v5 = (e: string) => `lockfileVersion: 5.4\n\nspecifiers:\n  express: ^${e}\n\ndependencies:\n  express: ${e}\n`;
    const read = repo(
      { 'package.json': pkg({ express: '^4.21.1' }), 'pnpm-lock.yaml': v5('4.21.1') },
      { 'package.json': pkg({ express: '^5.0.1' }), 'pnpm-lock.yaml': v5('5.0.1') },
    );
    const { bumps } = await detectBumps(['package.json', 'pnpm-lock.yaml'], read, { includePatch: false });
    expect(bumps.map((b) => [b.name, b.fromVersion, b.toVersion])).toEqual([['express', '4.21.1', '5.0.1']]);
  });

  it('finds bumps in pnpm workspace importers from a lockfile-only change', async () => {
    const lock = (v: string) => `lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n\n  packages/ui:\n    dependencies:\n      next:\n        specifier: ^14.0.0\n        version: ${v}(react@18.3.1)\n`;
    const m = pkg({ next: '^14.0.0' });
    const read = repo(
      { 'package.json': '{}', 'packages/ui/package.json': m, 'pnpm-lock.yaml': lock('14.1.0') },
      { 'package.json': '{}', 'packages/ui/package.json': m, 'pnpm-lock.yaml': lock('14.2.18') },
    );
    const { bumps } = await detectBumps(['pnpm-lock.yaml'], read, { includePatch: false });
    expect(bumps).toEqual([
      { name: 'next', fromVersion: '14.1.0', toVersion: '14.2.18', bumpType: 'minor', manifests: ['packages/ui/package.json'], depTypes: ['dependencies'] },
    ]);
  });
});

describe('detectBumps: yarn', () => {
  it('reads yarn classic lockfiles, matching the declared range', async () => {
    const lock = (spec: string, v: string) => `# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
# yarn lockfile v1


"eslint@${spec}":
  version "${v}"
  resolved "https://registry.yarnpkg.com/eslint/-/eslint-${v}.tgz"

eslint@^7.0.0:
  version "7.32.0"
`;
    const read = repo(
      { 'package.json': pkg({}, { eslint: '^8.57.0' }), 'yarn.lock': lock('^8.57.0', '8.57.1') },
      { 'package.json': pkg({}, { eslint: '^9.17.0' }), 'yarn.lock': lock('^9.17.0', '9.17.0') },
    );
    const { bumps } = await detectBumps(['package.json', 'yarn.lock'], read, { includePatch: false });
    expect(bumps.map((b) => [b.name, b.fromVersion, b.toVersion, b.bumpType])).toEqual([['eslint', '8.57.1', '9.17.0', 'major']]);
  });

  it('reads yarn berry lockfiles with npm: protocol and merged descriptors', async () => {
    const lock = (v: string) => `__metadata:
  version: 8
  cacheKey: 10c0

"express@npm:^${v.split('.')[0]}.0.0, express@npm:^${v}":
  version: ${v}
  resolution: "express@npm:${v}"
  languageName: node
  linkType: hard
`;
    const read = repo(
      { 'package.json': pkg({ express: '^4.21.2' }), 'yarn.lock': lock('4.21.2') },
      { 'package.json': pkg({ express: '^5.0.1' }), 'yarn.lock': lock('5.0.1') },
    );
    const { bumps } = await detectBumps(['package.json', 'yarn.lock'], read, { includePatch: false });
    expect(bumps.map((b) => [b.name, b.fromVersion, b.toVersion])).toEqual([['express', '4.21.2', '5.0.1']]);
  });
});

describe('detectBumps: npm aliases', () => {
  it('keeps the local name for usage search and records the real package for release notes', async () => {
    const lock = (v: string) => JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/http': { name: 'axios', version: v } } });
    const read = repo(
      { 'package.json': pkg({ http: 'npm:axios@^0.28.1' }), 'package-lock.json': lock('0.28.1') },
      { 'package.json': pkg({ http: 'npm:axios@^1.7.0' }), 'package-lock.json': lock('1.7.9') },
    );
    const { bumps } = await detectBumps(['package.json', 'package-lock.json'], read, { includePatch: false });
    expect(bumps).toEqual([{ name: 'http', packageName: 'axios', fromVersion: '0.28.1', toVersion: '1.7.9', bumpType: 'major', manifests: ['package.json'], depTypes: ['dependencies'] }]);
  });
});
