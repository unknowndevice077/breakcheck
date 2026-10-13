import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Project, ts, type ResolutionHostFactory } from 'ts-morph';
import type { Bump } from '../types.js';

/**
 * Compile-level ground truth: type-check the files that import a package once against
 * the old version's declarations and once against the new one, and keep the errors that
 * only the new version produces. This finds breaks the release notes never mention.
 */

const TS_FILE = /\.(?:[cm]?ts|tsx)$/;
const KEEP_FROM_TARBALL = /(?:\.d\.[cm]?ts|\.[cm]?ts|\.tsx|(?:^|\/)package\.json)$/;
const MAX_KEPT_BYTES = 60_000_000;
const MAX_ROOT_FILES = 400;

export interface CompilerDiagnostic {
  file: string;
  line: number;
  code: number;
  message: string;
}

export interface TypeCheckResult {
  /** Whether both type-checks ran; when false, `reason` says why */
  ran: boolean;
  reason?: string;
  /** Errors present with the new version and not with the old one */
  introduced: CompilerDiagnostic[];
  checkedFiles: number;
}

export type FetchTarball = (name: string, version: string) => Promise<Uint8Array | null>;

/** The npm package that provides types for an import specifier: `@types/foo__bar` types `@foo/bar`. */
export function typedSpecifier(real: string): string {
  const m = /^@types\/(.+)$/.exec(real);
  if (!m?.[1]) return real;
  const inner = m[1];
  return inner.includes('__') ? `@${inner.replace('__', '/')}` : inner;
}

/** Files of a gzipped npm tarball, paths relative to the package root (the `package/` prefix stripped). */
export function untar(gz: Uint8Array, keep: (p: string) => boolean = (p) => KEEP_FROM_TARBALL.test(p)): Map<string, Buffer> {
  const buf = gunzipSync(gz);
  const out = new Map<string, Buffer>();
  let kept = 0;
  let longName: string | null = null;
  for (let off = 0; off + 512 <= buf.length; ) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const str = (a: number, b: number) => header.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(header[156] ?? 48);
    const prefix = str(345, 500);
    let name = longName ?? (prefix ? `${prefix}/${str(0, 100)}` : str(0, 100));
    longName = null;
    const body = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') {
      longName = body.toString('utf8').replace(/\0.*$/s, '');
      continue;
    }
    if (type === 'x') {
      const m = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      if (m?.[1]) longName = m[1];
      continue;
    }
    if (type !== '0' && type !== '\0' && type !== '7') continue;
    name = name.replace(/^[^/]+\//, ''); // "package/", or the package name for some tarballs
    if (!name || name.includes('..') || !keep(name)) continue;
    kept += size;
    if (kept > MAX_KEPT_BYTES) break;
    out.set(name, Buffer.from(body));
  }
  return out;
}

function compilerOptions(workspace: string): ts.CompilerOptions {
  const fallback: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    esModuleInterop: true,
  };
  let options = fallback;
  const configPath = ts.findConfigFile(workspace, ts.sys.fileExists);
  if (configPath && path.dirname(configPath) === workspace) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!read.error) options = ts.parseJsonConfigFileContent(read.config, ts.sys, workspace).options;
  }
  // Only the declarations we install exist: no @types, no emit, no project references.
  return {
    ...options,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    typeRoots: [],
    composite: false,
    incremental: false,
    declaration: false,
    emitDeclarationOnly: false,
    allowJs: false,
    checkJs: false,
  };
}

async function check(workspace: string, roots: string[], specifier: string, realName: string, pkgRoot: string): Promise<{ diags: CompilerDiagnostic[]; resolved: boolean }> {
  const options = compilerOptions(workspace);
  let resolved = false;
  const resolution: ResolutionHostFactory = (host, getOptions) => ({
    resolveModuleNames(names, containingFile) {
      return names.map((name) => {
        if (name === specifier || name.startsWith(`${specifier}/`)) {
          const target = realName + name.slice(specifier.length);
          // Resolve as a bundler would, so `exports` maps with `types` conditions work for any project setting.
          const r = ts.resolveModuleName(
            target,
            path.join(pkgRoot, '__entry.ts'),
            { ...getOptions(), module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler },
            ts.sys,
          ).resolvedModule;
          if (r) resolved = true;
          return r;
        }
        return ts.resolveModuleName(name, containingFile, getOptions(), host).resolvedModule;
      });
    },
  });
  const project = new Project({ compilerOptions: options, resolutionHost: resolution, skipAddingFilesFromTsConfig: true });
  for (const f of roots) project.addSourceFileAtPath(path.join(workspace, f));
  project.resolveSourceFileDependencies();
  const diags: CompilerDiagnostic[] = [];
  for (const d of project.getPreEmitDiagnostics()) {
    const sf = d.getSourceFile();
    if (!sf || d.getCategory() !== ts.DiagnosticCategory.Error) continue;
    const abs = sf.getFilePath();
    const rel = path.relative(workspace, abs).split(path.sep).join('/');
    if (rel.startsWith('..') || rel.includes('node_modules/')) continue;
    const start = d.getStart() ?? 0;
    const line = sf.getLineAndColumnAtPos(start).line;
    diags.push({ file: rel, line, code: d.getCode(), message: ts.flattenDiagnosticMessageText(d.compilerObject.messageText, ' ') });
  }
  return { diags, resolved };
}

function install(root: string, realName: string, files: Map<string, Buffer>): string {
  const pkgRoot = path.join(root, 'node_modules', realName);
  for (const [rel, body] of files) {
    const dest = path.join(pkgRoot, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, body);
  }
  return root;
}

export async function typeCheckUpgrade(workspace: string, bump: Bump, importingFiles: string[], fetchTarball: FetchTarball): Promise<TypeCheckResult> {
  const roots = importingFiles.filter((f) => TS_FILE.test(f) && !f.endsWith('.d.ts')).slice(0, MAX_ROOT_FILES);
  const none = (reason: string): TypeCheckResult => ({ ran: false, reason, introduced: [], checkedFiles: 0 });
  if (!roots.length) return none('no TypeScript file imports it');
  const realName = bump.packageName ?? bump.name;
  const [oldTar, newTar] = await Promise.all([fetchTarball(realName, bump.fromVersion), fetchTarball(realName, bump.toVersion)]);
  if (!oldTar || !newTar) return none('could not download the package from the registry');
  const oldFiles = untar(oldTar);
  const newFiles = untar(newTar);
  const hasTypes = (m: Map<string, Buffer>) => [...m.keys()].some((k) => /\.d\.[cm]?ts$|\.tsx?$/.test(k));
  if (!hasTypes(newFiles)) return none('the package ships no type declarations');
  if (!hasTypes(oldFiles)) return none(`${bump.fromVersion} ships no type declarations to compare against`);

  // What the code imports: the alias for `npm:` aliases, `express` for `@types/express`.
  const typed = typedSpecifier(realName);
  const specifier = typed !== realName ? typed : bump.name;
  const tmp = mkdtempSync(path.join(tmpdir(), 'breakcheck-tc-'));
  try {
    const before = await check(workspace, roots, specifier, realName, install(path.join(tmp, 'old'), realName, oldFiles));
    const after = await check(workspace, roots, specifier, realName, install(path.join(tmp, 'new'), realName, newFiles));
    if (!before.resolved) return none(`its ${bump.fromVersion} type declarations could not be resolved`);
    const seen = new Set(before.diags.map((d) => `${d.file}:${d.line}:${d.code}`));
    const introduced: CompilerDiagnostic[] = [];
    const dedupe = new Set<string>();
    for (const d of after.diags) {
      const key = `${d.file}:${d.line}:${d.code}`;
      if (seen.has(key) || dedupe.has(key)) continue;
      dedupe.add(key);
      introduced.push(d);
    }
    introduced.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    return { ran: true, introduced, checkedFiles: roots.length };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
