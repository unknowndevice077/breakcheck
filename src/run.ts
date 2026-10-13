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
import type { BreakingChange, Bump, ExtractionResult, PackageReport, ReleaseNotes, RunReport, UsageHit } from './types.js';
import { findUsages } from './usage/finder.js';
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

const isDependencyFile = (f: string) => path.basename(f) === 'package.json' || lockfileKind(f) !== null;

export async function run(ctx: RunContext, deps: RunDeps, opts: RunOptions): Promise<RunResult> {
  const log = deps.log ?? (() => {});
  const { gh } = deps;
  const changed = (await gh.listPullFiles(ctx.owner, ctx.repo, ctx.pr)).filter((f) => isDependencyFile(f) && !f.includes('node_modules/'));
  log(`Dependency files changed: ${changed.join(', ') || 'none'}`);

  const read = (file: string, side: 'base' | 'head') => gh.getFile(ctx.owner, ctx.repo, file, side === 'base' ? ctx.baseSha : ctx.headSha);
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
    changes: changes.map((change) => ({ change, hits: verification.verified.get(change.id) ?? [] })),
    unanalysed,
    fromCache,
  };
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
