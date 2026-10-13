import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { typeCheckUpgrade, typedSpecifier, untar } from '../src/typecheck/typecheck.js';
import type { Bump } from '../src/types.js';

/** A minimal ustar archive, like `npm pack` produces. */
export function tarball(files: Record<string, string>, root = 'package'): Uint8Array {
  const blocks: Buffer[] = [];
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text);
    const h = Buffer.alloc(512);
    h.write(`${root}/${name}`, 0, 100);
    h.write('0000644\0', 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
    h.write('00000000000\0', 136);
    h.write('0', 156);
    h.write('ustar\0', 257);
    h.write('        ', 148);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

export const widget = {
  '1.0.0': tarball({
    'package.json': '{"name":"widget","version":"1.0.0","types":"index.d.ts"}',
    'index.d.ts': 'export declare function oldFn(): void;\nexport declare function configure(o: { legacy?: boolean }): void;\nexport declare function same(): void;\n',
    'index.js': 'module.exports = {}',
  }),
  '2.0.0': tarball({
    'package.json': '{"name":"widget","version":"2.0.0","exports":{".":{"types":"./dist/index.d.mts","default":"./dist/index.mjs"}}}',
    'dist/index.d.mts': 'export declare function configure(o: { modern?: boolean }): void;\nexport declare function same(): void;\n',
  }),
};

const root = new URL('./fixtures/projects/typecheck/', import.meta.url).pathname;
const bump: Bump = { name: 'widget', fromVersion: '1.0.0', toVersion: '2.0.0', bumpType: 'major', manifests: ['package.json'], depTypes: ['dependencies'] };
const fetchTarball = async (_n: string, v: string) => widget[v as keyof typeof widget] ?? null;

describe('untar', () => {
  it('keeps declarations and package.json files, strips the package/ prefix', () => {
    expect([...untar(widget['1.0.0']).keys()].sort()).toEqual(['index.d.ts', 'package.json']);
  });
});

describe('typeCheckUpgrade', () => {
  it('reports exactly the errors the new version introduces', async () => {
    const r = await typeCheckUpgrade(root, bump, ['src/use.ts', 'src/clean.ts'], fetchTarball);
    expect(r.ran).toBe(true);
    // `not-installed` fails with both versions, so it is not reported
    expect(r.introduced.map((d) => `${d.file}:${d.line} TS${d.code}`)).toEqual(['src/use.ts:1 TS2305', 'src/use.ts:5 TS2353']);
    expect(r.checkedFiles).toBe(2);
  });

  it('explains why it did not run', async () => {
    expect((await typeCheckUpgrade(root, bump, ['src/app.js'], fetchTarball)).reason).toBe('no TypeScript file imports it');
    expect((await typeCheckUpgrade(root, bump, ['src/use.ts'], async () => null)).reason).toBe('could not download the package from the registry');
    const untyped = async () => tarball({ 'package.json': '{}', 'index.js': '' });
    expect((await typeCheckUpgrade(root, bump, ['src/use.ts'], untyped)).reason).toBe('the package ships no type declarations');
  });

  it('maps @types packages to the module they type', () => {
    expect(typedSpecifier('@types/express')).toBe('express');
    expect(typedSpecifier('@types/babel__core')).toBe('@babel/core');
    expect(typedSpecifier('zod')).toBe('zod');
  });
});
