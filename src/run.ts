import { readFileSync } from 'node:fs';
import path from 'node:path/posix';
import { detectBumps } from './bumps/detect.js';
import { lockfileKind } from './bumps/lockfiles.js';
import { extractWithAI } from './extract/ai.js';
import { cacheKey, type ExtractionCache } from './extract/cache.js';
import { extractByRules } from './extract/rules.js';
import type { GitHubApi } from './github.js';
import { gatherNotes } from './notes/fetch.js';
import type { Registry } from './notes/registry.js';
import type { ModelGateway } from './providers/index.js';
import { ProviderError } from './providers/types.js';
import { upsertComment } from './report/comment.js';
import { renderComment, renderNoBumps, tally } from './report/render.js';
import type { BreakingChange, Bump, ExtractionResult, PackageReport, ReleaseNotes, RunReport, UsageHit, VerifiedHit } from './types.js';
import { typeCheckUpgrade, type CompilerDiagnostic, type FetchTarball } from './typecheck/typecheck.js';
import { findUsages, snippet } from './usage/finder.js';
import { verifyHits } from './verify/verify.js';

export interface RunContext {
  owner: string;
  repo: string;
  pr: number;
  baseSha: string;
  headSha: string;
}

export interface RunDeps {
  gh: GitHubApi;
  registry: Registry;
  cache: ExtractionCache;
  gateway: ModelGateway;
  /** Checked-out repository to search for usages */
  workspace: string;
  /** Why there is no provider, when there is none */
  providerReason?: string;
  /** Downloads package tarballs; when set, importing TypeScript files are type-checked against both versions */
  tarball?: FetchTarball;
  log?: (msg: string) => void;
}

export interface RunOptions {
  includePatch: boolean;
  maxPackages: number;
  /** Characters of release notes per package */
  notesBudget?: number;
  postComment?: boolean;
}

export interface RunResult {
  report: RunReport | null;
  body: string | null;
  comment: { id: number; url: string; action: 'created' | 'updated' } | null;
  affected: number;
  possible: number;
}

const TS_SOURCE = /\.(?:[cm]?ts|tsx)$/;
/** "Now ESM-only"/"CommonJS removed": compiles fine, fails at runtime, so the compiler can't rule it out. */
const MODULE_FORMAT_CHANGE = /\b(esm|es modules?|commonjs|cjs|require\(\)?|pure esm|runtime|node(?:\.js)? \d+)\b/i;

const isDependencyFile = (f: string) => path.basename(f) === 'package.json' || lockfileKind(f) !== null;

export async function run(ctx: RunContext, deps: RunDeps, opts: RunOptions): Promise<RunResult> {
  const log = deps.log ?? (() => {});
  const { gh } = deps;
  const changed = (await gh.listPullFiles(ctx.owner, ctx.repo, ctx.pr)).filter((f) => isDependencyFile(f) && !f.includes('node_modules/'));
  log(`Dependency files changed: ${changed.join(', ') || 'none'}`);

  // pull_request.base.sha is the base branch tip, which moves on after the PR branches off. Compare
  // against the merge base, like GitHub's own diff, so bumps made on the base branch since then
  // don't show up as changes (or downgrades) in this PR.
  const mergeBase = changed.length ? await gh.mergeBase(ctx.owner, ctx.repo, ctx.baseSha, ctx.headSha).catch(() => null) : null;
  const baseRef = mergeBase ?? ctx.baseSha;
  if (mergeBase && mergeBase !== ctx.baseSha) log(`Comparing against the merge base ${mergeBase.slice(0, 7)} (the base branch has moved since this PR branched).`);
  const read = (file: string, side: 'base' | 'head') => gh.getFile(ctx.owner, ctx.repo, file, side === 'base' ? baseRef : ctx.headSha);
  const { bumps, skipped } = changed.length ? await detectBumps(changed, read, { includePatch: opts.includePatch }) : { bumps: [], skipped: [] };

  if (!bumps.length) {
    log(`No bumps to analyse.${skipped.length ? ` Skipped: ${skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}` : ''}`);
    const comment = opts.postComment === false ? null : await upsertComment(gh, ctx.owner, ctx.repo, ctx.pr, renderNoBumps(), { createIfMissing: false });
    return { report: null, body: null, comment, affected: 0, possible: 0 };
  }

  const selected = bumps.slice(0, opts.maxPackages);
  for (const b of bumps.slice(opts.maxPackages)) skipped.push({ name: b.name, reason: `over the max-packages limit (${opts.maxPackages})` });

  const packages: PackageReport[] = [];
  // Per run: packages released together (react, react-dom) share notes and one extraction.
  const extractionMemo = new Map<string, Promise<ExtractionResult>>();
  for (const bump of selected) {
    log(`Analysing ${bump.name} ${bump.fromVersion} → ${bump.toVersion} (${bump.bumpType})`);
    packages.push(await analysePackage(bump, deps, opts, extractionMemo));
  }

  const report: RunReport = {
    packages,
    skipped,
    repo: { owner: ctx.owner, repo: ctx.repo },
    headSha: ctx.headSha,
    providerLabel: deps.gateway.label,
    ...(deps.gateway.failure ? { providerError: deps.gateway.failure } : {}),
  };
  const body = renderComment(report);
  const comment = opts.postComment === false ? null : await upsertComment(gh, ctx.owner, ctx.repo, ctx.pr, body);
  const t = tally(report);
  return { report, body, comment, affected: t.affected, possible: t.possible };
}

/**
 * Models sometimes invent source links (seen: github.com/react/react for facebook/react).
 * Keep a link only if it points into a document we actually fetched; otherwise use the
 * first source we fetched.
 */
export function checkSourceUrl(url: string | null, notes: ReleaseNotes): string | null {
  const known = notes.sources.map((x) => x.url.split('#')[0] ?? x.url);
  if (url && known.some((k) => url.split('#')[0] === k || url.startsWith(`${k}#`))) return url;
  return notes.sources[0]?.url ?? null;
}

async function analysePackage(bump: Bump, deps: RunDeps, opts: RunOptions, extractionMemo: Map<string, Promise<ExtractionResult>>): Promise<PackageReport> {
  const { gateway } = deps;
  const log = deps.log ?? (() => {});
  const unanalysed: string[] = [];
  let notes: ReleaseNotes;
  try {
    notes = await gatherNotes(deps.gh, deps.registry, bump, { budget: opts.notesBudget ?? 30_000 });
  } catch (e) {
    notes = { repo: null, text: '', sources: [], migrationLinks: [], truncated: false, missingReason: `fetching release notes failed (${(e as Error).message})` };
  }

  // Extraction: cache → AI → rules
  let mode: PackageReport['mode'] = gateway.available ? 'ai' : 'rules';
  let fallbackReason: string | undefined = gateway.available ? undefined : (gateway.failure ?? deps.providerReason);
  let fromCache = false;
  let extraction: ExtractionResult = { breakingChanges: [] };
  if (notes.text) {
    if (gateway.available && gateway.label) {
      const key = cacheKey({ pkg: bump.name, from: bump.fromVersion, to: bump.toVersion, label: gateway.label });
      const cached = await deps.cache.get(key);
      if (cached) {
        extraction = cached;
        fromCache = true;
      } else {
        try {
          // react and react-dom ship the same release notes: extract once per run.
          const memoKey = `${gateway.label}\n${notes.text}`;
          const memo = extractionMemo.get(memoKey);
          if (memo) {
            extraction = await memo;
            log(`${bump.name}: same release notes as an earlier package, reusing its extraction`);
          } else {
            const pending = extractWithAI(gateway, bump, notes);
            extractionMemo.set(memoKey, pending);
            pending.catch(() => extractionMemo.delete(memoKey));
            extraction = await pending;
          }
          extraction = { breakingChanges: extraction.breakingChanges.map((c) => ({ ...c, sourceUrl: checkSourceUrl(c.sourceUrl, notes) })) };
          await deps.cache.set(key, extraction);
        } catch (e) {
          mode = 'rules';
          log(`AI extraction for ${bump.name} failed: ${(e as Error).message}`);
          fallbackReason = e instanceof ProviderError && e.kind === 'invalid-response' ? `AI output for ${bump.name} was invalid twice` : (gateway.failure ?? (e as Error).message);
        }
      }
    }
    if (mode === 'rules') extraction = extractByRules(notes.text, bump.name);
  }
  let changes: BreakingChange[] = extraction.breakingChanges;
  // Safety net: a model can skip a change that is plainly in the notes. Rule-based
  // candidates it did not cover are searched too; only those that match code survive,
  // and the AI verification step still judges them.
  const extras = mode === 'ai' && notes.text ? ruleSupplement(changes, extractByRules(notes.text, bump.name).breakingChanges) : [];

  // Usage search (deterministic) and verification (AI only)
  let hits = new Map<string, UsageHit[]>();
  let importingFiles: string[] = [];
  try {
    const found = findUsages(deps.workspace, bump.name, [...changes, ...extras]);
    hits = found.hits;
    if (extras.length) {
      const seen = new Set(changes.flatMap((c) => (hits.get(c.id) ?? []).map((h) => `${h.file}:${h.line}`)));
      for (const x of extras) {
        const fresh = (hits.get(x.id) ?? []).filter((h) => !seen.has(`${h.file}:${h.line}`));
        if (!fresh.length) {
          hits.delete(x.id);
          continue;
        }
        fresh.forEach((h) => seen.add(`${h.file}:${h.line}`));
        hits.set(x.id, fresh);
        changes = [...changes, x];
      }
    }
    importingFiles = found.importingFiles;
    unanalysed.push(...found.unanalysed);
    for (const d of found.diagnostics) log(`  note: ${d}`);
    if (!found.importingFiles.length && changes.length) unanalysed.push(`no source file imports ${bump.name} (config files and scripts were still checked)`);
  } catch (e) {
    unanalysed.push(`usage search failed: ${(e as Error).message}`);
  }
  // If only this package's extraction failed (e.g. invalid output twice) the model is still
  // usable, so rule-based matches still get a yes/no/unsure verdict instead of "possibly".
  const verifyWithAI = gateway.available && (mode === 'ai' || !!fallbackReason);
  if (mode === 'rules' && verifyWithAI) {
    log(`AI extraction for ${bump.name} failed (${fallbackReason}); using rule-based extraction, AI verification`);
    fallbackReason = `${fallbackReason}; matches were still checked by the AI`;
  }
  const verification = await verifyHits(verifyWithAI ? gateway : disabledGateway(gateway), bump, changes, hits);
  if (verification.error) unanalysed.push(`AI verification failed for some locations, shown as "possibly": ${verification.error}`);

  // Compile-level ground truth, independent of what the notes say.
  let typecheck: PackageReport['typecheck'];
  let compilerChange: { change: BreakingChange; hits: VerifiedHit[] } | null = null;
  if (deps.tarball && importingFiles.length) {
    try {
      const tc = await typeCheckUpgrade(deps.workspace, bump, importingFiles, deps.tarball);
      typecheck = { ran: tc.ran, ...(tc.reason ? { reason: tc.reason } : {}), files: tc.checkedFiles, errors: tc.introduced.length };
      log(tc.ran ? `type-check: ${tc.checkedFiles} file(s), ${tc.introduced.length} new error(s) with ${bump.toVersion}` : `type-check skipped: ${tc.reason}`);
      if (tc.ran) compilerChange = await applyTypeCheck(bump, deps, tc.introduced, changes, verification.verified, verifyWithAI);
    } catch (e) {
      log(`type-check failed: ${(e as Error).message}`);
      typecheck = { ran: false, reason: `type-check failed: ${(e as Error).message}`, files: 0, errors: 0 };
    }
  }

  // What was searched and what came of it, for anyone reading the job log.
  log(`::group::${bump.name}: ${changes.length} breaking change(s), ${mode === 'ai' ? 'AI' : 'rule-based'}${fromCache ? ' (cached extraction)' : ''}`);
  log(`notes: ${notes.sources.map((x) => `${x.kind} ${x.title}`).join(', ') || notes.missingReason || 'none'} (${notes.text.length} chars${notes.truncated ? ', truncated' : ''})`);
  if (mode === 'ai') log(`safety net: ${extras.length} rule-based candidate(s) not covered by the AI, ${changes.filter((c) => c.id.startsWith('rules-')).length} matched new code`);
  for (const c of changes) {
    const searched = [...c.affectedSymbols.map((s) => `${s.type}:${s.name}`), ...c.searchPatterns.map((p) => `pattern:${p}`), ...c.fileGlobs.map((g) => `file:${g}`)];
    const found = (verification.verified.get(c.id) ?? []).map((h) => `${h.file}:${h.line}=${h.verdict}`);
    log(`${c.id}: searched [${searched.join(', ') || 'nothing'}] → ${found.join(', ') || 'no matches'}`);
  }
  log('::endgroup::');

  return {
    bump,
    notes,
    mode,
    ...(mode === 'ai' && gateway.label ? { modelLabel: gateway.label } : {}),
    ...(mode === 'rules' && fallbackReason ? { fallbackReason } : {}),
    changes: [...(compilerChange ? [compilerChange] : []), ...changes.map((change) => ({ change, hits: verification.verified.get(change.id) ?? [] }))],
    unanalysed,
    fromCache,
    ...(typecheck ? { typecheck } : {}),
  };
}

const COMPILER_CHANGE_ID = 'typescript-errors';

/**
 * Fold compiler results into the report:
 * - a note-based hit on a line the compiler rejects is confirmed (verdict yes);
 * - a note-based "removed export / import path" hit on a line that still compiles is ruled out;
 * - errors no note-based change explains become their own change, with AI-suggested fixes when available.
 */
async function applyTypeCheck(
  bump: Bump,
  deps: RunDeps,
  introduced: CompilerDiagnostic[],
  changes: BreakingChange[],
  verified: Map<string, VerifiedHit[]>,
  withAI: boolean,
): Promise<{ change: BreakingChange; hits: VerifiedHit[] } | null> {
  const byLine = new Map<string, CompilerDiagnostic[]>();
  for (const d of introduced) {
    const k = `${d.file}:${d.line}`;
    byLine.set(k, [...(byLine.get(k) ?? []), d]);
  }
  const describe = (ds: CompilerDiagnostic[]) => ds.map((d) => `TS${d.code}: ${d.message}`).join(' ').slice(0, 400);
  // An import that fails turns the name into `any`, so later uses compile: judge names by the
  // errors that mention them anywhere in the file, not by the line alone.
  const mentions = (d: CompilerDiagnostic, name: string) => d.message.includes(`'${name}'`) || d.message.includes(`'${name}/`) || d.message.includes(`"${name}"`);
  const reportedMissing = (file: string, name: string) => introduced.some((d) => d.file === file && mentions(d, name));
  const explained = new Set<string>();
  for (const change of changes) {
    const removal = !MODULE_FORMAT_CHANGE.test(`${change.summary} ${change.migration.join(' ')}`);
    const names = change.affectedSymbols.filter((s) => s.type === 'export' || s.type === 'import-path').map((s) => s.name);
    for (const h of verified.get(change.id) ?? []) {
      const k = `${h.file}:${h.line}`;
      const ds = byLine.get(k);
      const name = h.kind === 'symbol' ? names.find((n) => h.matched === n || h.matched.startsWith(`${n} as `) || h.matched.startsWith(`${n}/`)) : undefined;
      const relevant = ds && (name === undefined ? ds : ds.filter((d) => mentions(d, name)));
      if (relevant?.length) {
        explained.add(k);
        if (h.verdict !== 'yes') Object.assign(h, { verdict: 'yes', reason: `Confirmed by the TypeScript compiler: ${describe(relevant)}` });
      } else if (removal && name !== undefined && h.verdict !== 'no' && TS_SOURCE.test(h.file) && !reportedMissing(h.file, name)) {
        Object.assign(h, { verdict: 'no', reason: `The TypeScript compiler accepts \`${name}\` with ${bump.name} ${bump.toVersion}, so it still exists.`, fix: null });
      }
    }
  }
  const rest = [...byLine].filter(([k]) => !explained.has(k));
  if (!rest.length) return null;

  const change: BreakingChange = {
    id: COMPILER_CHANGE_ID,
    summary: `Code that no longer type-checks against ${bump.name} ${bump.toVersion}`,
    kind: 'signature',
    affectedSymbols: [],
    searchPatterns: [],
    fileGlobs: [],
    migration: [],
    sourceUrl: null,
    confidence: 'high',
  };
  const fileLines = new Map<string, string[]>();
  const linesOf = (f: string) => {
    if (!fileLines.has(f)) {
      let text = '';
      try {
        text = readFileSync(path.join(deps.workspace, f), 'utf8');
      } catch {
        // deleted between checks; the snippet stays empty
      }
      fileLines.set(f, text.split(/\r?\n/));
    }
    return fileLines.get(f) ?? [];
  };
  const hits: VerifiedHit[] = rest.map(([, ds], i) => {
    const d = ds[0] as CompilerDiagnostic;
    const s = snippet(linesOf(d.file), d.line, 10);
    return { id: `${COMPILER_CHANGE_ID}#${i + 1}`, changeId: COMPILER_CHANGE_ID, file: d.file, line: d.line, kind: 'compiler', matched: `TS${d.code}`, snippet: s.text, snippetStartLine: s.start, verdict: 'yes', reason: describe(ds), fix: null };
  });

  // The compiler decides the verdict; the model only proposes fixes, one pseudo-change per error.
  if (withAI) {
    const pseudo = hits.map((h) => ({ ...change, id: `${h.id}`, summary: `After the upgrade this location fails to type-check. Compiler error: ${h.reason}` }));
    const out = await verifyHits(deps.gateway, bump, pseudo, new Map(hits.map((h, i) => [pseudo[i]!.id, [h]])));
    hits.forEach((h, i) => {
      const v = out.verified.get(pseudo[i]!.id)?.[0];
      if (v?.fix) h.fix = v.fix;
    });
  }
  return { change, hits };
}

/**
 * Rule-based changes whose symbols or file globs the AI extraction did not mention.
 * Ids are prefixed so they never collide with the model's.
 */
export function ruleSupplement(ai: BreakingChange[], rules: BreakingChange[]): BreakingChange[] {
  // `NextRequest` is covered by an AI symbol `NextRequest.geo`; `geo` by `request.geo`.
  const covered = new Set(
    ai.flatMap((c) =>
      c.affectedSymbols.flatMap((s) => {
        const n = s.name.toLowerCase().replace('#', '.');
        const parts = n.split('.');
        return [n, ...(parts.length > 1 ? [parts.slice(0, -1).join('.'), parts.at(-1) ?? n] : [])];
      }),
    ),
  );
  const out: BreakingChange[] = [];
  for (const r of rules) {
    const affectedSymbols = r.affectedSymbols.filter((s) => !covered.has(s.name.toLowerCase()));
    const searchPatterns = r.searchPatterns.filter((p) => !covered.has(p.toLowerCase()));
    if (!affectedSymbols.length && !searchPatterns.length && !r.fileGlobs.length) continue;
    out.push({ ...r, id: `rules-${r.id}`, affectedSymbols, searchPatterns, confidence: 'low' });
  }
  return out;
}

/** A view of the gateway that reports itself unavailable, so verification runs in rule-based mode. */
function disabledGateway(gw: ModelGateway): ModelGateway {
  return Object.create(gw, { available: { get: () => false } }) as ModelGateway;
}
