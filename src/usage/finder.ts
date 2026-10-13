import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Node, Project, SyntaxKind, ts, type SourceFile } from 'ts-morph';
import type { BreakingChange, HitKind, UsageHit } from '../types.js';

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.turbo', '.cache', 'vendor', '.yarn', '.pnpm-store']);
const MAX_FILE_BYTES = 1_000_000;
const MAX_FILES = 20_000;
const MODULE_FORMAT = /\b(esm|es modules?|ecmascript modules?|commonjs|cjs|require\(\)?|pure esm)\b/i;
const SAMPLE_SOURCE_FILES = ['src/index.ts', 'src/App.tsx', 'src/index.js', 'src/App.jsx', 'src/index.mjs', 'src/index.cjs'];
const UBIQUITOUS_FILES = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'README.md', 'tsconfig.json', '.gitignore'];
/** Receiver names with a fixed conventional meaning (Express/Koa/Fetch style). */
const CONVENTIONAL_RECEIVERS = new Set(['req', 'res', 'app', 'router', 'request', 'response', 'ctx', 'next']);

export interface FinderOptions {
  contextLines?: number;
  maxHitsPerChange?: number;
}

export interface FinderResult {
  hits: Map<string, UsageHit[]>;
  /** Repo-relative files that import the package */
  importingFiles: string[];
  /** Human-readable notes about what could not be analysed (shown in the comment) */
  unanalysed: string[];
  /** Internal notes for the job log, e.g. patterns that were ignored */
  diagnostics: string[];
}

/** Local names bound to the package in one file. */
interface Bindings {
  /** local name → exported name ('default' for default imports) */
  named: Map<string, { imported: string; line: number }>;
  /** local names bound to the whole module (import * as X, const X = require(), default imports) */
  namespaces: Map<string, number>;
  /** exported names re-exported from this file: name → line */
  reexports: Map<string, number>;
  /** lines of every import/require/re-export of the package */
  importLines: { line: number; specifier: string; via: 'import' | 'export' | 'require' | 'dynamic' }[];
  dynamic: number[];
  exportStar: number[];
}

export function listRepoFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name));
      } else if (e.isFile()) {
        out.push(path.relative(root, path.join(dir, e.name)).split(path.sep).join('/'));
      }
    }
  };
  walk(root);
  return out.sort();
}

function matchesPackage(specifier: string, pkg: string): boolean {
  return specifier === pkg || specifier.startsWith(`${pkg}/`);
}

function moduleArg(call: Node): string | null {
  if (!Node.isCallExpression(call)) return null;
  const arg = call.getArguments()[0];
  return arg && Node.isStringLiteral(arg) ? arg.getLiteralValue() : arg && Node.isNoSubstitutionTemplateLiteral(arg) ? arg.getLiteralValue() : null;
}

function isRequire(call: Node): boolean {
  return Node.isCallExpression(call) && call.getExpression().getText() === 'require';
}

function isDynamicImport(call: Node): boolean {
  return Node.isCallExpression(call) && call.getExpression().getKind() === SyntaxKind.ImportKeyword;
}

/** Bind the target of `const x = <module>` / `const { a, b: c } = <module>`. */
function bindDeclaration(decl: Node | undefined, b: Bindings, line: number): boolean {
  if (!decl || !Node.isVariableDeclaration(decl)) return false;
  const name = decl.getNameNode();
  if (Node.isIdentifier(name)) {
    b.namespaces.set(name.getText(), line);
    return true;
  }
  if (Node.isObjectBindingPattern(name)) {
    for (const el of name.getElements()) {
      const prop = el.getPropertyNameNode()?.getText() ?? el.getNameNode().getText();
      const local = el.getNameNode();
      if (Node.isIdentifier(local)) b.named.set(local.getText(), { imported: prop, line });
    }
    return true;
  }
  return false;
}

function collectBindings(sf: SourceFile, pkg: string, extraSpecifiers: string[]): Bindings {
  const b: Bindings = { named: new Map(), namespaces: new Map(), reexports: new Map(), importLines: [], dynamic: [], exportStar: [] };
  const wanted = (s: string) => matchesPackage(s, pkg) || extraSpecifiers.some((x) => matchesPackage(s, x));

  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    if (!wanted(spec)) continue;
    const line = imp.getStartLineNumber();
    b.importLines.push({ line, specifier: spec, via: 'import' });
    if (!matchesPackage(spec, pkg)) continue;
    const def = imp.getDefaultImport();
    if (def) {
      b.named.set(def.getText(), { imported: 'default', line });
      b.namespaces.set(def.getText(), line); // CJS-style default objects: express.Router, express.query
    }
    const ns = imp.getNamespaceImport();
    if (ns) b.namespaces.set(ns.getText(), line);
    for (const n of imp.getNamedImports()) {
      b.named.set(n.getAliasNode()?.getText() ?? n.getName(), { imported: n.getName(), line });
    }
  }

  for (const exp of sf.getExportDeclarations()) {
    const spec = exp.getModuleSpecifierValue();
    if (!spec || !wanted(spec)) continue;
    const line = exp.getStartLineNumber();
    b.importLines.push({ line, specifier: spec, via: 'export' });
    if (!matchesPackage(spec, pkg)) continue;
    const named = exp.getNamedExports();
    if (!named.length && !exp.getNamespaceExport()) b.exportStar.push(line);
    for (const n of named) b.reexports.set(n.getName(), line);
  }

  // `export import x = require('pkg')` / `import x = require('pkg')`
  for (const ie of sf.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration)) {
    const ref = ie.getModuleReference();
    const m = ref.getText().match(/^require\(\s*['"]([^'"]+)['"]\s*\)$/);
    if (m?.[1] && wanted(m[1])) {
      b.importLines.push({ line: ie.getStartLineNumber(), specifier: m[1], via: 'require' });
      if (matchesPackage(m[1], pkg)) b.namespaces.set(ie.getName(), ie.getStartLineNumber());
    }
  }

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const req = isRequire(call);
    const dyn = isDynamicImport(call);
    if (!req && !dyn) continue;
    const spec = moduleArg(call);
    if (spec === null) {
      if (dyn) b.dynamic.push(call.getStartLineNumber()); // import(variable) – cannot tell which module
      continue;
    }
    if (!wanted(spec)) continue;
    const line = call.getStartLineNumber();
    b.importLines.push({ line, specifier: spec, via: req ? 'require' : 'dynamic' });
    if (!matchesPackage(spec, pkg)) continue;
    // Walk up through `await` and parentheses to the declaration, if any
    let target: Node = call;
    while (Node.isAwaitExpression(target.getParent()) || Node.isParenthesizedExpression(target.getParent())) target = target.getParentOrThrow();
    const parent = target.getParent();
    if (bindDeclaration(parent, b, line)) continue;
    if (parent && Node.isPropertyAccessExpression(parent) && parent.getExpression() === target) {
      // require('pkg').foo – direct member use; record as a namespace-style access below
      b.named.set(`\0direct:${line}:${parent.getName()}`, { imported: parent.getName(), line });
      continue;
    }
    if (dyn) b.dynamic.push(line);
  }
  return b;
}

/** `ReactDOM` ≈ `react-dom`, `Express` ≈ `express`. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function patternToRegex(p: string): RegExp | null {
  const m = p.match(/^\/(.+)\/([gimsuy]*)$/);
  try {
    if (m?.[1]) return new RegExp(m[1], m[2]?.replace('g', '') ?? '');
  } catch {
    return null;
  }
  return new RegExp(escapeRe(p));
}

export function globToRegex(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] ?? '';
    if (c === '*') re += glob[i + 1] === '*' ? (i++, '.*') : '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      re += `(?:${glob.slice(i + 1, end).split(',').map(escapeRe).join('|')})`;
      i = end;
    } else re += escapeRe(c);
  }
  return new RegExp(`^${re}$`);
}

export function snippet(lines: string[], line: number, context: number): { text: string; start: number } {
  const start = Math.max(1, line - context);
  const end = Math.min(lines.length, line + context);
  const width = String(end).length;
  const out: string[] = [];
  for (let n = start; n <= end; n++) out.push(`${n === line ? '>' : ' '} ${String(n).padStart(width)} | ${lines[n - 1] ?? ''}`);
  return { text: out.join('\n'), start };
}

/**
 * Find where each breaking change could touch the repo, deterministically.
 * Symbols are matched through the file's import bindings, so `import { json as j }`
 * finds `j(...)`, `import * as RR` finds `RR.json`, and `const { json } = require()` works too.
 */
export function findUsages(root: string, pkg: string, changes: BreakingChange[], opts: FinderOptions = {}): FinderResult {
  const context = opts.contextLines ?? 10;
  const maxHits = opts.maxHitsPerChange ?? 20;
  const files = listRepoFiles(root);
  const importPaths = [...new Set(changes.flatMap((c) => c.affectedSymbols.filter((s) => s.type === 'import-path').map((s) => s.name)))].filter((p) => p !== pkg);
  const shortName = pkg.replace(/^@[^/]+\//, '');
  const unanalysed: string[] = [];
  const diagnostics: string[] = [];
  const hitMap = new Map<string, Map<string, UsageHit>>();
  const extraCounts = new Map<string, number>();
  const textCache = new Map<string, string[]>();

  const readLines = (f: string): string[] | null => {
    if (textCache.has(f)) return textCache.get(f) ?? null;
    try {
      const full = path.join(root, f);
      if (statSync(full).size > MAX_FILE_BYTES) return null;
      const lines = readFileSync(full, 'utf8').split(/\r?\n/);
      if (lines.length > 1 && lines.at(-1) === '') lines.pop();
      textCache.set(f, lines);
      return lines;
    } catch {
      return null;
    }
  };

  const add = (change: BreakingChange, file: string, line: number, kind: HitKind, matched: string) => {
    const lines = readLines(file);
    if (!lines) return;
    let m = hitMap.get(change.id);
    if (!m) hitMap.set(change.id, (m = new Map()));
    const key = `${file}:${line}`;
    if (m.has(key)) return;
    if (m.size >= maxHits) {
      extraCounts.set(change.id, (extraCounts.get(change.id) ?? 0) + 1);
      return;
    }
    const s = snippet(lines, line, context);
    m.set(key, { id: `${change.id}#${m.size + 1}`, changeId: change.id, file, line, kind, matched, snippet: s.text, snippetStartLine: s.start });
  };

  // 1. Source files that import the package (or a subpath an import-path change names)
  const project = new Project({
    useInMemoryFileSystem: true,
    skipLoadingLibFiles: true,
    compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve, noLib: true },
  });
  const importing: { file: string; sf: SourceFile; b: Bindings }[] = [];
  const needles = [pkg, ...importPaths];
  for (const f of files) {
    if (!SOURCE_EXT.test(f) || f.endsWith('.d.ts')) continue;
    const lines = readLines(f);
    if (!lines) continue;
    const text = lines.join('\n');
    if (!needles.some((n) => text.includes(`'${n}`) || text.includes(`"${n}`) || text.includes(`\`${n}`))) continue;
    let sf: SourceFile;
    try {
      sf = project.createSourceFile(`/${f}`, text, { overwrite: true });
    } catch {
      unanalysed.push(`${f}: could not be parsed`);
      continue;
    }
    const b = collectBindings(sf, pkg, importPaths);
    if (!b.importLines.length && !b.dynamic.length) continue;
    importing.push({ file: f, sf, b });
    for (const line of b.dynamic) unanalysed.push(`${f}:${line}: dynamic \`import()\` whose usage can't be followed statically`);
    for (const line of b.exportStar) unanalysed.push(`${f}:${line}: \`export * from '${pkg}'\` re-exports everything, so removed exports surface to this file's importers`);
  }

  for (const { file, sf, b } of importing) {
    // Identifier references grouped by name, skipping property names and import specifiers
    const refs = new Map<string, number[]>();
    for (const id of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
      const name = id.getText();
      if (!b.named.has(name) && !b.namespaces.has(name)) continue;
      const parent = id.getParent();
      if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === id) continue;
      if (Node.isPropertyAssignment(parent) && parent.getNameNode() === id) continue;
      if (Node.isImportSpecifier(parent) || Node.isImportClause(parent) || Node.isNamespaceImport(parent) || Node.isBindingElement(parent) || Node.isVariableDeclaration(parent)) continue;
      const list = refs.get(name) ?? [];
      list.push(id.getStartLineNumber());
      refs.set(name, list);
    }
    const propAccesses = sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);

    for (const change of changes) {
      for (const sym of change.affectedSymbols) {
        if (sym.type === 'import-path') {
          if (sym.name === pkg) {
            // The package itself matches every import, which says nothing, except for module-format
            // changes ("now ESM-only"): then exactly the require() calls are affected.
            if (MODULE_FORMAT.test(`${change.summary} ${change.migration.join(' ')}`)) {
              for (const il of b.importLines) if (il.via === 'require' && il.specifier === pkg) add(change, file, il.line, 'symbol', `require('${pkg}')`);
            }
            continue;
          }
          for (const il of b.importLines) if (matchesPackage(il.specifier, sym.name)) add(change, file, il.line, 'symbol', il.specifier);
          continue;
        }
        if (sym.type === 'export') {
          for (const [local, info] of b.named) {
            if (info.imported !== sym.name) continue;
            if (local.startsWith('\0direct:')) {
              add(change, file, info.line, 'symbol', `require('${pkg}').${sym.name}`);
              continue;
            }
            add(change, file, info.line, 'symbol', local === sym.name ? sym.name : `${sym.name} as ${local}`);
            for (const line of refs.get(local) ?? []) add(change, file, line, 'symbol', local);
          }
          if (b.reexports.has(sym.name)) add(change, file, b.reexports.get(sym.name) ?? 1, 'symbol', `export { ${sym.name} }`);
          for (const pa of propAccesses) {
            const recv = pa.getExpression().getText();
            if (pa.getName() === sym.name && b.namespaces.has(recv)) add(change, file, pa.getStartLineNumber(), 'symbol', `${recv}.${sym.name}`);
          }
          continue;
        }
        if (sym.type === 'member') {
          const parts = sym.name.split('.');
          const prop = parts.at(-1) ?? sym.name;
          const recvName = parts.slice(0, -1).join('.');
          // `ReactDOM.render` for react-dom, `express.query` for express: the receiver is the package itself
          // An imported lowercase object (`vi.fn` from vitest) is static too; an imported PascalCase
          // class/type (`NextRequest.geo`, `QueryClient.x`) describes instances, matched by property name.
          const importedObject = /^[a-z_$]/.test(recvName) && [...b.named.values()].some((i) => i.imported === recvName);
          const recvIsPackage = norm(recvName) === norm(shortName) || recvName === pkg || importedObject;
          for (const pa of propAccesses) {
            if (pa.getName() !== prop) continue;
            const recv = pa.getExpression().getText();
            if (recvIsPackage) {
              // `express.query` → only through a binding of the package (any local name)
              const info = b.named.get(recv);
              const ok = b.namespaces.has(recv) || (info && info.imported === recvName);
              if (!ok) continue;
            } else if (b.namespaces.has(recv) || b.named.has(recv)) {
              // `res.json` is an instance method; `express.json` (the package's own export) is not it
              continue;
            } else if (CONVENTIONAL_RECEIVERS.has(recvName) && CONVENTIONAL_RECEIVERS.has(recv) && recv !== recvName) {
              // `app.param` vs `req.param`: conventional names that clearly mean different objects
              continue;
            }
            add(change, file, pa.getStartLineNumber(), 'symbol', `${recv}.${prop}`);
          }
          continue;
        }
        if (sym.type === 'option' || sym.type === 'config-key') {
          const re = new RegExp(`(^|[^\\w$-])${escapeRe(sym.name)}(?![\\w$-])`);
          (readLines(file) ?? []).forEach((l, i) => re.test(l) && add(change, file, i + 1, 'pattern', sym.name));
        }
      }
      for (const p of change.searchPatterns) {
        const re = patternToRegex(p);
        if (re) (readLines(file) ?? []).forEach((l, i) => re.test(l) && add(change, file, i + 1, 'pattern', p));
      }
    }
  }

  // 2. Config files and package.json scripts (CLI flags, config keys, patterns)
  const configFiles = files.filter((f) => {
    const base = path.posix.basename(f);
    return (base.toLowerCase().includes(shortName.toLowerCase()) && !SOURCE_EXT.test(base)) || /^(eslint|next|vite|webpack|babel|jest|vitest|tsup|rollup)\.config\./.test(base) || base.toLowerCase().startsWith(`${shortName.toLowerCase()}.config.`) || base.startsWith(`.${shortName}rc`);
  });
  const manifests = files.filter((f) => path.posix.basename(f) === 'package.json');
  const workflows = files.filter((f) => /^\.github\/workflows\/.*\.ya?ml$/.test(f) || /(^|\/)(Makefile|.*\.sh)$/.test(f));
  for (const change of changes) {
    for (const sym of change.affectedSymbols) {
      if (sym.type === 'cli-flag') {
        const re = new RegExp(`(^|\\s)${escapeRe(sym.name)}(?=[\\s=]|$)`);
        for (const f of [...manifests, ...workflows]) {
          (readLines(f) ?? []).forEach((l, i) => l.includes(shortName) && re.test(l) && add(change, f, i + 1, 'pattern', sym.name));
        }
      } else if (sym.type === 'config-key' || sym.type === 'option') {
        const re = new RegExp(`(^|[^\\w$-])${escapeRe(sym.name)}(?![\\w$-])`);
        for (const f of [...configFiles, ...manifests]) (readLines(f) ?? []).forEach((l, i) => re.test(l) && add(change, f, i + 1, 'pattern', sym.name));
      }
    }
    for (const p of change.searchPatterns) {
      const re = patternToRegex(p);
      if (!re) continue;
      for (const f of [...configFiles, ...manifests]) (readLines(f) ?? []).forEach((l, i) => re.test(l) && add(change, f, i + 1, 'pattern', p));
    }
    // 3. File globs: the file's existence is the usage
    for (const g of change.fileGlobs) {
      const re = globToRegex(g);
      // A glob matching files every project has (package.json, lockfiles) says nothing about usage.
      if (UBIQUITOUS_FILES.some((f) => re.test(f))) {
        diagnostics.push(`${change.id}: ignored file pattern \`${g}\` (matches files every project has)`);
        continue;
      }
      // Source files are searched for symbols; their mere existence proves nothing.
      if (SAMPLE_SOURCE_FILES.some((f) => re.test(f) || re.test(path.posix.basename(f)))) {
        diagnostics.push(`${change.id}: ignored file pattern \`${g}\` (matches source files)`);
        continue;
      }
      for (const f of files) if (re.test(path.posix.basename(f)) || re.test(f)) add(change, f, 1, 'file', g);
    }
  }

  const hits = new Map<string, UsageHit[]>();
  for (const change of changes) {
    const list = [...(hitMap.get(change.id)?.values() ?? [])].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    hits.set(change.id, list);
    const extra = extraCounts.get(change.id);
    if (extra) unanalysed.push(`${change.id}: ${extra} more matching location(s) not listed (limit ${maxHits} per change)`);
  }
  return { hits, importingFiles: importing.map((i) => i.file), unanalysed, diagnostics };
}
