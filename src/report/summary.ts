import type { CallRecord } from '../providers/types.js';
import type { RunReport } from '../types.js';
import { headline } from './render.js';

/** Markdown for the job summary: result, mode per package, every model call with token usage. */
export function renderSummary(run: RunReport, calls: CallRecord[], github: { requests: number; rateLimited: number }): string {
  const out = [`## breakcheck: ${headline(run)}`, ''];
  out.push('| Package | Range | Mode | Breaking changes | Notes from |', '| --- | --- | --- | --- | --- |');
  for (const p of run.packages) {
    const mode = p.mode === 'ai' ? `AI (${p.modelLabel})${p.fromCache ? ', cached' : ''}` : `rule-based${p.fallbackReason ? ` (${p.fallbackReason})` : ''}`;
    const from = p.notes.sources.map((s) => `[${s.title}](${s.url})`).join(', ') || p.notes.missingReason || '–';
    out.push(`| ${p.bump.name}${p.bump.packageName ? ` (${p.bump.packageName})` : ''} | ${p.bump.fromVersion} → ${p.bump.toVersion} | ${mode.replace(/\|/g, '\\|')} | ${p.changes.length} | ${from.replace(/\|/g, '\\|')} |`);
  }
  out.push('');
  if (run.skipped.length) out.push(`Skipped: ${run.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}`, '');

  out.push(`### Model calls (${calls.length})`, '');
  if (!calls.length) out.push(run.providerLabel ? 'No model calls were needed (cached results or nothing to analyse).' : 'No AI provider was used.');
  else {
    out.push('| # | Provider/model | Purpose | Result | Time | Input tokens | Output tokens |', '| --- | --- | --- | --- | --- | --- | --- |');
    let tin = 0;
    let tout = 0;
    calls.forEach((c, i) => {
      tin += c.inputTokens ?? 0;
      tout += c.outputTokens ?? 0;
      out.push(
        `| ${i + 1} | ${c.provider}/${c.model} | ${c.purpose} | ${c.ok ? 'ok' : `failed: ${(c.error ?? '').replace(/\|/g, '\\|').slice(0, 160)}`} | ${(c.ms / 1000).toFixed(1)}s | ${c.inputTokens ?? 'n/a'} | ${c.outputTokens ?? 'n/a'} |`,
      );
    });
    const reported = calls.some((c) => c.inputTokens !== undefined);
    out.push('', reported ? `Total tokens reported by the provider: ${tin} in / ${tout} out.` : 'Token usage: not reported by this provider (the Copilot CLI does not expose it).');
  }
  if (run.providerError) out.push('', `> AI provider problem: ${run.providerError}. Fell back to rule-based mode.`);
  out.push('', `GitHub API requests: ${github.requests}${github.rateLimited ? ` (${github.rateLimited} rate-limited and retried)` : ''}.`);
  return out.join('\n');
}
