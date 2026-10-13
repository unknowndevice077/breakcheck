import path from 'node:path/posix';
import semver from 'semver';
import type { Bump, BumpType } from '../types.js';
import { LOCKFILE_NAMES, lockfileKind, parseLockfile, type Lockfile } from './lockfiles.js';

export type Side = 'base' | 'head';
export type ReadFile = (file: string, side: Side) => Promise<string | null>;

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

interface Manifest {
  [field: string]: unknown;
}

export interface DetectOptions {
  includePatch: boolean;
}

export interface DetectResult {
  bumps: Bump[];
  skipped: { name: string; reason: string }[];
}

/** Classify a version change. 0.x minor bumps are breaking under caret semantics, so they count as major. */
export function classifyBump(from: string, to: string): BumpType | null {
  const a = semver.parse(from);
  const b = semver.parse(to);
  if (!a || !b || semver.lte(b, a)) return null;
  if (b.major !== a.major) return 'major';
  if (a.major === 0 && b.minor !== a.minor) return 'major';
  if (b.minor !== a.minor) return 'minor';
  if (a.major === 0 && a.minor === 0 && b.patch !== a.patch) return 'major';
  return 'patch';
}

function specToVersion(spec: unknown): string | null {
  if (typeof spec !== 'string') return null;
  if (/^(workspace:|file:|link:|git|github:|https?:|\.|\/)/.test(spec)) return null;
  const s = spec.replace(/^npm:(?:@[^/]+\/)?[^@]+@/, '');
  try {
    return semver.minVersion(s)?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Work out which manifests to inspect. A lockfile-only change (typical for
 * Renovate "lockFileMaintenance" or an in-range bump) still counts: we inspect
 * every project the lockfile describes.
 */
async function collectProjects(changedFiles: string[], read: ReadFile) {
  const lockfileDirs = new Map<string, { base: Lockfile | null; head: Lockfile | null; file: string }>();
  const projectDirs = new Set<string>();

  for (const f of changedFiles) {
    if (path.basename(f) === 'package.json' && !f.includes('node_modules/')) {
      projectDirs.add(path.dirname(f) === '.' ? '' : path.dirname(f));
    }
  }

  // Load every lockfile that changed, plus lockfiles that sit next to (or above) changed manifests.
  const candidateLockfiles = new Set(changedFiles.filter((f) => lockfileKind(f)));
  const dirsWithChangedLockfile = new Set([...candidateLockfiles].map((f) => (path.dirname(f) === '.' ? '' : path.dirname(f))));
  for (const dir of projectDirs) {
    for (let d = dir; ; d = path.dirname(d) === '.' ? '' : path.dirname(d)) {
      // A lockfile that changed in this PR is the one that matters; don't probe for others.
      if (dirsWithChangedLockfile.has(d)) break;
      for (const name of Object.keys(LOCKFILE_NAMES)) candidateLockfiles.add(d ? `${d}/${name}` : name);
      if (!d) break;
    }
  }

  for (const file of candidateLockfiles) {
    const [baseText, headText] = await Promise.all([read(file, 'base'), read(file, 'head')]);
    if (baseText === null && headText === null) continue;
    const base = baseText === null ? null : parseLockfile(file, baseText);
    const head = headText === null ? null : parseLockfile(file, headText);
    const dir = path.dirname(file) === '.' ? '' : path.dirname(file);
    if (lockfileDirs.has(dir)) continue; // first lockfile kind found wins
    lockfileDirs.set(dir, { base, head, file });
    if (changedFiles.includes(file)) {
      for (const imp of new Set([...(base?.importers() ?? []), ...(head?.importers() ?? [])])) {
        projectDirs.add(path.join(dir, imp).replace(/^\.$/, ''));
      }
    }
  }
  return { projectDirs, lockfileDirs };
}

function nearestLockfile(dir: string, lockfileDirs: Map<string, { base: Lockfile | null; head: Lockfile | null }>) {
  for (let d = dir; ; d = path.dirname(d) === '.' ? '' : path.dirname(d)) {
    const lf = lockfileDirs.get(d);
    if (lf) return { ...lf, rel: d ? path.relative(d, dir) : dir };
    if (!d) return null;
  }
}

function parseManifest(text: string | null): Manifest | null {
  if (text === null) return null;
  try {
    return JSON.parse(text) as Manifest;
  } catch {
    return null;
  }
}

export async function detectBumps(changedFiles: string[], read: ReadFile, opts: DetectOptions): Promise<DetectResult> {
  const { projectDirs, lockfileDirs } = await collectProjects(changedFiles, read);
  const byKey = new Map<string, Bump>();
  const skipped = new Map<string, string>();

  for (const dir of [...projectDirs].sort()) {
    const manifestPath = dir ? `${dir}/package.json` : 'package.json';
    const [baseText, headText] = await Promise.all([read(manifestPath, 'base'), read(manifestPath, 'head')]);
    const baseM = parseManifest(baseText);
    const headM = parseManifest(headText);
    if (!headM) continue;
    const lf = nearestLockfile(dir, lockfileDirs);

    for (const field of DEP_FIELDS) {
      const headDeps = (headM[field] ?? {}) as Record<string, string>;
      for (const [name, headSpec] of Object.entries(headDeps)) {
        const baseSpec = findSpec(baseM, name);
        if (baseSpec === undefined) continue; // newly added dependency, not a bump
        const from = lf?.base?.resolve(name, baseSpec, lf.rel) ?? specToVersion(baseSpec);
        const to = lf?.head?.resolve(name, headSpec, lf.rel) ?? specToVersion(headSpec);
        if (!from || !to || from === to) continue;
        const bumpType = classifyBump(from, to);
        if (!bumpType) {
          skipped.set(name, `downgrade or unparsable version (${from} → ${to})`);
          continue;
        }
        if (bumpType === 'patch' && !opts.includePatch) {
          skipped.set(name, `patch bump ${from} → ${to} (set include-patch: true to analyse)`);
          continue;
        }
        const key = `${name}@${from}..${to}`;
        const existing = byKey.get(key);
        if (existing) {
          if (!existing.manifests.includes(manifestPath)) existing.manifests.push(manifestPath);
          if (!existing.depTypes.includes(field)) existing.depTypes.push(field);
        } else {
          byKey.set(key, { name, fromVersion: from, toVersion: to, bumpType, manifests: [manifestPath], depTypes: [field] });
        }
      }
    }
  }

  const order: Record<BumpType, number> = { major: 0, minor: 1, patch: 2 };
  const bumps = [...byKey.values()].sort((a, b) => order[a.bumpType] - order[b.bumpType] || a.name.localeCompare(b.name));
  for (const b of bumps) skipped.delete(b.name);
  return { bumps, skipped: [...skipped].map(([name, reason]) => ({ name, reason })) };
}

function findSpec(m: Manifest | null, name: string): string | undefined {
  if (!m) return undefined;
  for (const field of DEP_FIELDS) {
    const deps = m[field] as Record<string, string> | undefined;
    if (deps && typeof deps[name] === 'string') return deps[name];
  }
  return undefined;
}
