import path from 'node:path/posix';
import { parseSyml } from '@yarnpkg/parsers';
import semver from 'semver';
import YAML from 'yaml';

export type LockfileKind = 'npm' | 'pnpm' | 'yarn';

export const LOCKFILE_NAMES: Record<string, LockfileKind> = {
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
};

export function lockfileKind(file: string): LockfileKind | null {
  return LOCKFILE_NAMES[path.basename(file)] ?? null;
}

/**
 * A parsed lockfile that can answer "which version of X does the project at
 * <dir> resolve to?". `dir` is relative to the lockfile's directory ('' = same dir).
 */
export interface Lockfile {
  kind: LockfileKind;
  resolve(name: string, specifier: string | undefined, dir: string): string | null;
  /** Project directories (relative to the lockfile) that this lockfile describes */
  importers(): string[];
}

function cleanVersion(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // pnpm: "1.2.3(react@18.2.0)" / "1.2.3_react@18.2.0"; npm aliases: "npm:foo@1.2.3",
  // pnpm v9 aliases "foo@1.2.3", pnpm v6 aliases "/foo@1.2.3" or "/foo/1.2.3"
  let s = v.replace(/\(.*$/, '').replace(/_.*$/, '');
  const alias = s.match(/^(?:npm:|\/)?(?:@[^/]+\/)?[^@/]+[@/]([^@/]+)$/);
  if (alias?.[1]) s = alias[1];
  return semver.valid(s);
}

export function parseLockfile(file: string, content: string): Lockfile | null {
  const kind = lockfileKind(file);
  try {
    if (kind === 'npm') return parseNpm(content);
    if (kind === 'pnpm') return parsePnpm(content);
    if (kind === 'yarn') return parseYarn(content);
  } catch {
    return null;
  }
  return null;
}

function parseNpm(content: string): Lockfile {
  const json = JSON.parse(content) as {
    lockfileVersion?: number;
    packages?: Record<string, { version?: string; dependencies?: unknown; link?: boolean }>;
    dependencies?: Record<string, { version?: string }>;
  };
  const packages = json.packages;
  return {
    kind: 'npm',
    resolve(name, _spec, dir) {
      if (packages) {
        const prefix = dir ? `${dir}/` : '';
        const candidates = [`${prefix}node_modules/${name}`, `node_modules/${name}`];
        for (const key of candidates) {
          const v = cleanVersion(packages[key]?.version);
          if (v) return v;
        }
        return null;
      }
      // lockfileVersion 1
      return cleanVersion(json.dependencies?.[name]?.version);
    },
    importers() {
      if (!packages) return [''];
      return Object.keys(packages).filter((k) => !k.includes('node_modules') && !packages[k]?.link);
    },
  };
}

interface PnpmDeps {
  [name: string]: string | { specifier?: string; version?: string };
}

function parsePnpm(content: string): Lockfile {
  const doc = YAML.parse(content) as {
    importers?: Record<string, Record<string, PnpmDeps | undefined>>;
    dependencies?: PnpmDeps;
    devDependencies?: PnpmDeps;
    optionalDependencies?: PnpmDeps;
  };
  const sections = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
  const importerFor = (dir: string): Record<string, PnpmDeps | undefined> | undefined => {
    if (doc.importers) return doc.importers[dir || '.'];
    return dir ? undefined : (doc as Record<string, PnpmDeps | undefined>);
  };
  return {
    kind: 'pnpm',
    resolve(name, _spec, dir) {
      const imp = importerFor(dir);
      if (!imp) return null;
      for (const s of sections) {
        const entry = imp[s]?.[name];
        if (entry === undefined) continue;
        const raw = typeof entry === 'string' ? entry : entry.version;
        const v = cleanVersion(raw);
        if (v) return v;
      }
      return null;
    },
    importers() {
      if (!doc.importers) return [''];
      return Object.keys(doc.importers).map((k) => (k === '.' ? '' : k));
    },
  };
}

function parseYarn(content: string): Lockfile {
  const doc = parseSyml(content) as Record<string, { version?: string }>;
  // Build name -> [{ ranges, version }]
  const byName = new Map<string, { ranges: string[]; version: string }[]>();
  for (const [rawKey, entry] of Object.entries(doc)) {
    if (rawKey === '__metadata' || !entry?.version) continue;
    const version = cleanVersion(entry.version);
    if (!version) continue;
    for (const descriptor of rawKey.split(/,\s*/)) {
      // Split at the first @ after the scope: "http@npm:axios@^1" is the alias http, range axios@^1
      const unquoted = descriptor.replace(/^"/, '');
      const at = unquoted.indexOf('@', 1);
      if (at <= 0) continue;
      const name = unquoted.slice(0, at);
      const range = unquoted.slice(at + 1).replace(/^npm:/, '').replace(/"$/, '');
      const list = byName.get(name) ?? [];
      let item = list.find((i) => i.version === version);
      if (!item) {
        item = { ranges: [], version };
        list.push(item);
      }
      item.ranges.push(range);
      byName.set(name, list);
    }
  }
  return {
    kind: 'yarn',
    resolve(name, spec) {
      const list = byName.get(name);
      if (!list?.length) return null;
      const wanted = spec?.replace(/^npm:/, '');
      if (wanted) {
        const exact = list.find((i) => i.ranges.includes(wanted));
        if (exact) return exact.version;
        const satisfying = list.filter((i) => semver.satisfies(i.version, wanted));
        if (satisfying.length) return satisfying.map((i) => i.version).sort(semver.rcompare)[0] ?? null;
      }
      return list.length === 1 ? (list[0]?.version ?? null) : null;
    },
    importers() {
      return [''];
    },
  };
}
