import type { ChangeReport, PackageReport, RunReport, VerifiedHit } from '../types.js';

export const MARKER = '<!-- breakcheck:comment -->';
const MAX_COMMENT = 60_000; // GitHub's limit is 65,536 characters

const isAffected = (h: VerifiedHit) => h.verdict === 'yes';
const isPossible = (h: VerifiedHit) => h.verdict === 'unsure' || h.verdict === 'possibly';

export interface Tally {
  checked: number;
  /** Changes with nothing to search for (runtime requirements, behaviour changes): need a human */
  manual: number;
  affected: number;
  possible: number;
  missing: PackageReport[];
}

export function tally(run: RunReport): Tally {
  let checked = 0;
  let manual = 0;
  let affected = 0;
  let possible = 0;
  for (const p of run.packages) {
    checked += p.changes.length;
    manual += p.changes.filter((c) => !c.change.affectedSymbols.length && !c.change.searchPatterns.length && !c.change.fileGlobs.length).length;
    for (const c of p.changes) {
      if (c.hits.some(isAffected)) affected++;
      else if (c.hits.some(isPossible)) possible++;
    }
  }
  return { checked, manual, affected, possible, missing: run.packages.filter((p) => p.notes.missingReason) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function headline(run: RunReport): string {
  const t = tally(run);
  if (t.affected) {
    const more = t.possible ? ` (${t.possible} more may)` : '';
    return `⚠️ ${plural(t.affected, 'breaking change')} ${t.affected === 1 ? 'affects' : 'affect'} this repo${more}`;
  }
  if (t.possible) return `⚠️ ${plural(t.possible, 'breaking change')} may affect this repo`;
  if (t.missing.length) return `❓ Couldn't find release notes for ${t.missing.map((p) => p.bump.name).join(', ')}`;
  if (!t.checked) return `✅ The release notes list no breaking changes (${plural(run.packages.length, 'package')} checked)`;
  // Never let the green tick suggest more certainty than there is.
  const unsure = t.manual ? `, ${t.manual} can't be checked automatically` : '';
  return `✅ No breaking changes found that affect your code (${t.checked} checked${unsure})`;
}

function code(s: string): string {
  return '`' + s.replace(/`/g, 'ˋ') + '`';
}

/**
 * Make model- or release-note-derived text safe for a one-line Markdown context.
 * Outside code spans: `@user` / `@org/team` become code (no notifications to strangers
 * thanked in release notes), `<` and `>` are escaped (so `useFetcher<Data>` isn't eaten
 * as an HTML tag), and table pipes are escaped.
 */
export function esc(s: string): string {
  return s
    .replace(/\r?\n/g, ' ')
    .split(/(`[^`]*`)/)
    .map((part) =>
      /^`[^`]*`$/.test(part)
        ? part
        : part
            .replace(/(^|[^\w`/.])@([A-Za-z0-9][\w.-]*(?:\/[\w.-]+)?)/g, '$1`@$2`')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;'),
    )
    .join('')
    .replace(/\|/g, '\\|');
}

/** Markdown is not rendered inside <summary>, so turn `code` spans into <code> and escape the rest. */
export function inlineHtml(s: string): string {
  const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return s
    .replace(/\r?\n/g, ' ')
    .split(/(`[^`]+`)/)
    .map((part) =>
      /^`[^`]+`$/.test(part)
        ? `<code>${escape(part.slice(1, -1))}</code>`
        : escape(part).replace(/(^|[^\w/.])@([A-Za-z0-9][\w.-]*(?:\/[\w.-]+)?)/g, '$1<code>@$2</code>'),
    )
    .join('');
}

function blobUrl(run: RunReport, file: string, line: number): string {
  return `https://github.com/${run.repo.owner}/${run.repo.repo}/blob/${run.headSha}/${file.split('/').map(encodeURIComponent).join('/')}#L${line}`;
}

function packageLink(name: string): string {
  return `[${code(name)}](https://www.npmjs.com/package/${name})`;
}

function affectCell(p: PackageReport): string {
  if (p.notes.missingReason && !p.changes.length) return '❓ no release notes';
  const a = p.changes.filter((c) => c.hits.some(isAffected)).length;
  const m = p.changes.filter((c) => !c.hits.some(isAffected) && c.hits.some(isPossible)).length;
  if (!a && !m) return '0';
  if (!a) return `${m} possibly`;
  return m ? `**${a}** (+${m} possibly)` : `**${a}**`;
}

function modeLine(run: RunReport): string {
  const ai = run.packages.filter((p) => p.mode === 'ai');
  const rules = run.packages.filter((p) => p.mode === 'rules' && p.notes.text);
  const reasons = [...new Set(rules.map((p) => p.fallbackReason).filter(Boolean))];
  const why = reasons.length ? `: ${reasons.join('; ')}` : '';
  if (ai.length && !rules.length) return `**Mode:** AI-assisted via ${code(ai[0]?.modelLabel ?? run.providerLabel ?? 'unknown')}`;
  const aiVerified = rules.some((p) => p.changes.some((c) => c.hits.some((h) => h.verdict !== 'possibly')));
  if (!ai.length) return `**Mode:** Rule-based ${aiVerified ? 'extraction with AI-verified matches' : '(no AI available)'}, lower confidence${why}`;
  return `**Mode:** AI-assisted via ${code(ai[0]?.modelLabel ?? '')} for ${ai.map((p) => code(p.bump.name)).join(', ')}; rule-based (lower confidence) for ${rules.map((p) => code(p.bump.name)).join(', ')}${why}`;
}

function hitLine(run: RunReport, h: VerifiedHit): string {
  const icon = h.verdict === 'yes' ? '🔴' : '🟡';
  const label = h.verdict === 'yes' ? '' : h.verdict === 'unsure' ? ' _(unsure)_' : ' _(possibly)_';
  return `- ${icon} [${h.file}:${h.line}](${blobUrl(run, h.file, h.line)})${label}: ${esc(h.reason)}`;
}

function diffBlock(h: VerifiedHit): string {
  if (!h.fix) return '';
  const minus = h.fix.before.split('\n').map((l) => `-${l}`);
  const plus = h.fix.after === '' ? [] : h.fix.after.split('\n').map((l) => `+${l}`); // empty = delete the line(s)
  return ['', `  Suggested fix for \`${h.file}:${h.line}\`:`, '', '  ```diff', ...[...minus, ...plus].map((l) => `  ${l}`), '  ```'].join('\n');
}

interface Limits {
  /** Locations listed per change (rest summarised) */
  hits: number;
  /** Suggested diffs per change */
  diffs: number;
  /** Include every checked change in "All N checked", or only those with matches */
  fullChecklist: boolean;
}

const FULL: Limits = { hits: Infinity, diffs: Infinity, fullChecklist: true };

function changeSection(run: RunReport, p: PackageReport, c: ChangeReport, limits: Limits = FULL): string {
  const relevant = c.hits.filter((h) => h.verdict !== 'no');
  const definite = relevant.some(isAffected);
  const where = plural(relevant.length, 'location');
  const lines = [
    '<details>',
    `<summary>${definite ? '⚠️' : '🟡'} <b>${p.bump.name}</b>: ${inlineHtml(c.change.summary)} (${where})</summary>`,
    '',
  ];
  let diffs = 0;
  const shown: { file: string; before: string }[] = [];
  for (const h of relevant.slice(0, limits.hits)) {
    lines.push(hitLine(run, h));
    // Neighbouring hits (import, call, option) often get the same fix; show it once per file.
    const before = h.fix?.before.trim() ?? '';
    const repeat = shown.some((x) => x.file === h.file && before !== '' && x.before.includes(before));
    if (h.fix && !repeat) shown.push({ file: h.file, before: h.fix.before });
    const d = diffs < limits.diffs && !repeat ? diffBlock(h) : '';
    if (d) {
      lines.push(d);
      diffs++;
    }
  }
  if (relevant.length > limits.hits) lines.push(`- …and ${relevant.length - limits.hits} more location(s); see the job log`);
  const ruledOut = c.hits.filter((h) => h.verdict === 'no').length;
  if (ruledOut) lines.push(`- ${plural(ruledOut, 'other match', 'other matches')} checked and ruled out by the model`);
  const steps = c.change.migration.filter((m) => m !== c.change.summary);
  if (steps.length) lines.push('', '**How to migrate**', '', ...steps.map((m, i) => `${i + 1}. ${esc(m)}`));
  if (c.change.sourceUrl) lines.push('', `Source: ${c.change.sourceUrl}`);
  lines.push('', '</details>');
  return lines.join('\n');
}

function checkedList(p: PackageReport, full = true): string {
  const shown = full ? p.changes : p.changes.filter((c) => c.hits.length);
  const rows = shown.map((c) => {
    const status = c.hits.some(isAffected)
      ? 'affects this repo'
      : c.hits.some(isPossible)
        ? 'possibly affects this repo'
        : c.hits.length
          ? 'matches ruled out'
          : c.change.affectedSymbols.length || c.change.searchPatterns.length || c.change.fileGlobs.length
            ? 'no usages found'
            : 'nothing to search for automatically; review manually';
    const link = c.change.sourceUrl ? ` ([source](${c.change.sourceUrl}))` : '';
    return `- ${esc(c.change.summary)} — _${status}_${link}`;
  });
  if (shown.length < p.changes.length) rows.push(`- …and ${p.changes.length - shown.length} more with no usages found`);
  return rows.join('\n');
}

export function renderComment(run: RunReport): string {
  // Progressively compact until the comment fits GitHub's limit; never cut markup in half.
  const levels: Limits[] = [FULL, { hits: 10, diffs: 3, fullChecklist: false }, { hits: 5, diffs: 1, fullChecklist: false }, { hits: 3, diffs: 0, fullChecklist: false }];
  for (const limits of levels) {
    const body = renderWith(run, limits, Infinity);
    if (body.length <= MAX_COMMENT) return body;
  }
  return renderWith(run, levels[levels.length - 1]!, MAX_COMMENT);
}

function renderWith(run: RunReport, limits: Limits, maxLength: number): string {
  const t = tally(run);
  const head: string[] = [MARKER, `## ${headline(run)}`, ''];
  head.push('_breakcheck reads the release notes for each dependency bump in this PR and searches this repo for code the breaking changes touch._', '');
  head.push('| Package | Version range | Breaking changes found | Affect you |', '| --- | --- | --- | --- |');
  for (const p of run.packages) {
    const found = p.notes.missingReason && !p.changes.length ? '–' : String(p.changes.length);
    head.push(`| ${packageLink(p.bump.packageName ?? p.bump.name)}${p.bump.packageName ? ` (as ${code(p.bump.name)})` : ''} | ${p.bump.fromVersion} → ${p.bump.toVersion} (${p.bump.bumpType}) | ${found} | ${affectCell(p)} |`);
  }
  head.push('');

  const tail: string[] = [];
  if (t.missing.length) {
    tail.push('### Release notes not found', '');
    for (const p of t.missing) tail.push(`- ${code(p.bump.name)} ${p.bump.fromVersion} → ${p.bump.toVersion}: ${esc(p.notes.missingReason ?? '')}. Review the upgrade manually.`);
    tail.push('');
  }
  const detail: string[] = [];
  for (const p of run.packages) {
    if (!p.changes.length) continue;
    detail.push(`**${p.bump.name}** (${p.mode === 'ai' ? 'AI-extracted' : 'rule-based, low confidence'}${p.fromCache ? ', cached' : ''}${p.notes.truncated ? ', notes truncated' : ''})`, '', checkedList(p, limits.fullChecklist), '');
  }
  if (detail.length && maxLength === Infinity) tail.push('<details>', `<summary>All ${plural(t.checked, 'breaking change')} checked</summary>`, '', ...detail, '</details>', '');
  const notes = run.packages.flatMap((p) => p.unanalysed.map((u) => `- ${code(p.bump.name)}: ${esc(u)}`));
  if (notes.length) {
    const shown = maxLength === Infinity ? notes : notes.slice(0, 10);
    tail.push('<details>', `<summary>Couldn't analyse (${notes.length})</summary>`, '', ...shown, ...(shown.length < notes.length ? [`- …and ${notes.length - shown.length} more`] : []), '', '</details>', '');
  }
  tail.push(modeLine(run), '', footer(run));

  const ordered = run.packages.flatMap((p) =>
    p.changes
      .filter((c) => c.hits.some((h) => isAffected(h) || isPossible(h)))
      .sort((a, b) => Number(b.hits.some(isAffected)) - Number(a.hits.some(isAffected)))
      .map((c) => ({ p, c })),
  );
  const fixed = head.join('\n').length + tail.join('\n').length + 200;
  const sections: string[] = [];
  let size = fixed;
  for (const { p, c } of ordered) {
    const sec = changeSection(run, p, c, limits);
    if (size + sec.length + 2 > maxLength) break;
    sections.push(sec);
    size += sec.length + 2;
  }
  const out = [...head];
  if (sections.length || ordered.length) {
    out.push('### What to look at', '', ...sections.flatMap((x) => [x, '']));
    if (sections.length < ordered.length) {
      out.push(`_…and ${ordered.length - sections.length} more affected change(s) not shown to fit GitHub's comment size limit. The job log lists every location._`, '');
    }
  }
  return [...out, ...tail].join('\n');
}

function footer(run: RunReport): string {
  const pkgs = run.packages.map((p) => `${p.bump.name}`).join(', ');
  const sources = new Set(run.packages.flatMap((p) => p.notes.sources.map((s) => s.kind)));
  const from = [sources.has('release') && 'GitHub Releases', sources.has('changelog') && 'CHANGELOG files', sources.has('migration-guide') && 'migration guides'].filter(Boolean).join(', ') || 'no release notes';
  const skipped = run.skipped.length ? ` Skipped: ${run.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}.` : '';
  return [
    '---',
    `<sub>**Checked:** direct dependency bumps (${pkgs || 'none'}) using ${from}; searched source files that import each package, config files and package.json scripts.${skipped} ` +
      `**Not checked:** transitive dependencies, runtime behaviour without a code-level signal, and usages that can't be followed statically. ` +
      `This is advisory and does not mean the upgrade is safe. Generated by [breakcheck](https://github.com/unknowndevice077/breakcheck).</sub>`,
  ].join('\n');
}

/** Body used when a previously commented PR no longer contains any dependency bumps. */
export function renderNoBumps(): string {
  return [MARKER, '## breakcheck: no dependency bumps in this PR any more', '', '<sub>Nothing to analyse. This comment is kept so earlier results are not mistaken for current ones.</sub>'].join('\n');
}
