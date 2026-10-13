import type { AffectedSymbol, BreakingChange, ChangeKind, ExtractionResult, SymbolType } from '../types.js';
import { BREAKING_LINE, PRIORITY_HEADING, splitSections } from '../notes/sections.js';
import { normalizeExtraction } from './schema.js';

/**
 * Rule-based extraction: no model, lower confidence. Works on the same assembled
 * notes the AI sees (blocks separated by `=== title (url) ===`).
 */
export function extractByRules(notes: string, pkg: string, maxChanges = 40): ExtractionResult {
  const items: { text: string; heading?: string; url: string | null; guide: boolean; rank: number }[] = [];
  for (const block of splitBlocks(notes)) {
    const guide = /^Migration guide /.test(block.title);
    if (guide) items.push(...guideItems(block.body).map((i) => ({ ...i, url: block.url, guide, rank: 3 })));
    else items.push(...releaseItems(block.body).map((i) => ({ ...i, url: block.url, guide })));
  }
  // Most trustworthy first, so the cap drops the weakest candidates.
  items.sort((a, b) => b.rank - a.rank);
  const covered = new Set<string>();

  const changes: BreakingChange[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const summary = cleanSummary(item.heading ?? firstLine(item.text));
    if (!summary || seen.has(summary.toLowerCase())) continue;
    seen.add(summary.toLowerCase());
    const idText = item.heading ? `${item.heading}\n${item.guide ? '' : item.text}` : item.text;
    let symbols = identifiers(item.heading && hasIdentifiers(item.heading) ? item.heading : idText, pkg, item.heading ? 6 : 50);
    // Heading named only a file (e.g. `eslint.config.js`) or nothing usable: look in the body.
    if (item.heading && !symbols.some((x) => x.type !== 'other' || x.globs)) symbols = [...symbols, ...identifiers(item.text, pkg, 6)];
    const uniq = dedupeSymbols(symbols);
    // A guide subsection named after one identifier that a changelog item already covers adds nothing.
    if (item.heading && uniq.length === 1 && uniq[0] && covered.has(uniq[0].name)) continue;
    for (const u of uniq) covered.add(u.name);
    changes.push({
      id: slug(uniq[0]?.name ?? summary),
      summary,
      kind: kindOf(`${item.heading ?? ''} ${item.text}`, uniq),
      affectedSymbols: uniq.filter((s) => s.type !== 'other').map(({ name, type }) => ({ name, type })),
      searchPatterns: uniq.filter((s) => s.type === 'cli-flag' || s.type === 'config-key' || s.type === 'option').map((s) => s.name),
      fileGlobs: [...new Set(uniq.flatMap((s) => s.globs ?? []))],
      migration: migrationHints(item.text),
      sourceUrl: item.url,
      confidence: 'low',
    });
    if (changes.length >= maxChanges) break;
  }
  return normalizeExtraction({ breakingChanges: changes });
}

function splitBlocks(notes: string): { title: string; url: string | null; body: string }[] {
  const out: { title: string; url: string | null; body: string }[] = [];
  const re = /^=== (.*?) \((\S*)\) ===$/gm;
  const marks = [...notes.matchAll(re)];
  if (!marks.length) return [{ title: '', url: null, body: notes }];
  marks.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = marks[i + 1]?.index ?? notes.length;
    out.push({ title: m[1] ?? '', url: m[2] || null, body: notes.slice(start, end) });
  });
  return out;
}

interface Bullet {
  indent: number;
  lines: string[];
}

/** Top-level bullets with their nested content. */
function bullets(text: string): Bullet[] {
  const out: Bullet[] = [];
  let cur: Bullet | null = null;
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence && line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (m && (!cur || (m[1] ?? '').length <= cur.indent)) {
      cur = { indent: (m[1] ?? '').length, lines: [line] };
      out.push(cur);
    } else if (cur && (line.trim() === '' || /^\s/.test(line) || inFence)) {
      cur.lines.push(line);
    } else if (line.trim()) {
      cur = null;
    }
  }
  return out;
}

const PARENT_BULLET = /^(?:[-*+]|\d+\.)\s+(?:\*\*)?(remove[sd]?|breaking(?: changes?)?|deprecat\w*|drop(?:ped)?|removals?|change[sd]?)(?:\*\*)?\s*:\s*$/i;

const CONVENTIONAL = /^(?:[-*+]|\d+\.)\s+(?:\[`?[0-9a-f]{7,40}`?\]\([^)]*\)\s*)?(\w+)(?:\([^)]*\))?(!)?:\s/;

/** Items from release notes / changelog blocks, ranked: 3 = breaking section, 2 = marked `!:`, 1 = keyword match. */
function releaseItems(body: string): { text: string; rank: number }[] {
  const out: { text: string; rank: number }[] = [];
  for (const s of splitSections(body)) {
    const prioritySection = s.level > 0 && PRIORITY_HEADING.test(s.heading);
    for (const b of bullets(s.text)) {
      const head = b.lines[0]?.trim() ?? '';
      const parent = head.match(PARENT_BULLET);
      if (parent?.[1]) {
        // Express style: "* remove:" followed by nested "- `app.del` - use `app.delete`"
        const label = /^change/i.test(parent[1]) ? 'Changed' : /^deprecat/i.test(parent[1]) ? 'Deprecated' : 'Removed';
        const nested = bullets(b.lines.slice(1).map((l) => l.slice(Math.min(b.indent + 2, l.search(/\S|$/)))).join('\n'));
        for (const n of nested) out.push({ text: n.lines.join('\n').replace(/^(\s*(?:[-*+]|\d+\.)\s+)/, `$1${label}: `), rank: 3 });
        continue;
      }
      const conv = head.match(CONVENTIONAL);
      if (conv) {
        // Conventional commits: only `type!:` is breaking; "chore: remove x" is not.
        if (conv[2] === '!') out.push({ text: b.lines.join('\n'), rank: 2 });
        continue;
      }
      if (prioritySection) out.push({ text: b.lines.join('\n'), rank: 3 });
      else if (BREAKING_LINE.test(head)) out.push({ text: b.lines.join('\n'), rank: 1 });
    }
  }
  return out;
}

/** Items from a migration guide: one per level-2 section (subsections merged in). */
function guideItems(body: string): { heading: string; text: string }[] {
  const sections = splitSections(body);
  const top = Math.min(...sections.filter((s) => s.level >= 2).map((s) => s.level), 6);
  const out: { heading: string; text: string }[] = [];
  let cur: { heading: string; text: string } | null = null;
  for (const s of sections) {
    if (s.level === top) {
      cur = { heading: s.heading.replace(/<a [^>]*><\/a>\s*/g, ''), text: s.text.split('\n').slice(1).join('\n') };
      out.push(cur);
    } else if (s.level > top && cur) {
      // Future-flag style guides use one identifier per subsection ("### v7_startTransition")
      if (/^`?[A-Za-z_$][\w$.]*`?$/.test(s.heading.trim()) && !PRIORITY_HEADING.test(cur.heading)) {
        out.push({ heading: s.heading, text: s.text });
      } else cur.text += s.text;
    }
  }
  return out.filter((i) => !/table of contents|^upgrading from|^introduction|^overview|^summary/i.test(i.heading) && (hasIdentifiers(i.heading) || PRIORITY_HEADING.test(i.heading) || BREAKING_LINE.test(i.heading)));
}

function hasIdentifiers(text: string): boolean {
  return /`[^`]+`/.test(text) || /^[A-Za-z_$][\w$.]*$/.test(text.trim());
}

function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim()) ?? '';
}

function cleanSummary(s: string): string {
  return s
    .replace(/^\s*(?:[-*+]|\d+\.)\s+(?:[-*+]\s+)?/, '')
    .replace(/\[`?[0-9a-f]{7,40}`?\]\([^)]*\)\s*/g, '') // commit links
    .replace(/\(\[#\d+\]\([^)]*\)\)/g, '') // ([#123](...))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s*\((?:#\d+|[A-Z][\w .'-]+)\)\s*(?=\(|$)/g, ' ') // (#123) (Author Name)
    .replace(/\\_/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[:,]\s*$/, '')
    .trim()
    .slice(0, 240);
}

interface Ident extends AffectedSymbol {
  globs?: string[];
}

const REPLACEMENT = /\s(?:-|--|–)?\s*use\s|\bin favou?r of\b|->|→|=>|\breplaced (?:by|with)\b|\binstead\b|\s(?:with|into|to) `|\bexported as\b|\bnow `/i;

const STOP = new Set(['true', 'false', 'null', 'undefined', 'string', 'number', 'boolean', 'object', 'async', 'await', 'warn', 'error', 'off', 'on', 'all', 'none', 'type', 'types', 'api', 'node']);

/** Pull identifiers out of backticks (and removed lines of diff code blocks). */
export function identifiers(text: string, pkg: string, limit: number): Ident[] {
  const out: Ident[] = [];
  const raw: string[] = [];
  // Only what was removed/changed counts; the replacement after "use X" / "-> X" must not be flagged.
  const affectedPart = text
    .split('\n')
    .filter((l) => !/✅/.test(l))
    .map((l) => l.split(REPLACEMENT)[0] ?? '')
    .join('\n');
  for (const m of affectedPart.matchAll(/`([^`\n]{1,80})`/g)) raw.push(m[1] ?? '');
  // Diff code blocks: identifiers imported or called on removed lines
  for (const m of text.matchAll(/^-\s+(?!-)(.*)$/gm)) {
    const line = m[1] ?? '';
    const imp = line.match(/import\s*\{([^}]*)\}\s*from/);
    if (imp?.[1]) raw.push(...imp[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0] ?? ''));
  }
  // Config-file families mentioned in prose ("the deprecated eslintrc config") become file globs.
  for (const m of affectedPart.matchAll(/(?:^|[\s(*])\.?([a-z]{3,}rc)\b(?![\w.-])/g)) raw.push(`.${m[1]}`);
  // Bare-identifier headings like "v7_startTransition"
  if (/^[A-Za-z_$][\w$.]*$/.test(text.trim())) raw.push(text.trim());
  for (const r of raw) {
    const id = classify(r, pkg);
    if (id) out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}

function classify(input: string, pkg: string): Ident | null {
  let s = input.trim().replace(/^type\s+/, '').replace(/[,;]$/, '');
  if (!s || s.length > 60 || STOP.has(s.toLowerCase())) return null;
  if (/^v?\d+(\.\d+)*$/.test(s) || /^#\d+$/.test(s) || /^[0-9a-f]{7,40}$/.test(s)) return null;
  if (/^--?[a-z][\w-]*(=.*)?$/i.test(s)) return { name: s.replace(/=.*$/, ''), type: 'cli-flag' };
  if (/^\.?[\w.-]*rc(\.[\w*{},]+)?$/.test(s) || /^\.[\w-]+rc\b/.test(s)) {
    const base = s.replace(/\.(\*|\{.*\}|json|js|cjs|mjs|ya?ml)$/, '');
    return { name: s, type: 'other', globs: [`${base}`, `${base}.*`] };
  }
  if (/^[\w.-]+\.(json|js|cjs|mjs|ts|ya?ml)$/.test(s)) return null; // a file name, not an API
  // package paths, e.g. react-router-dom or next/legacy/image
  if (s === pkg || s.startsWith(`${pkg}/`) || /^@[\w-]+\/[\w.-]+(\/[\w./-]+)?$/.test(s)) {
    return s === pkg ? null : { name: s, type: 'import-path' };
  }
  if (/^<\/?([A-Z][\w.]*)[^>]*\/?>$/.test(s)) s = s.replace(/^<\/?([A-Z][\w.]*)[^>]*\/?>$/, '$1');
  s = s.replace(/\(.*\)$/, '').replace(/<.*>$/, '');
  if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(s)) {
    // future.v7_startTransition is a config option; res.sendfile / app.del are members
    if (/^(future|config|options?|experimental)\./i.test(s)) return { name: s.split('.').pop() ?? s, type: 'option' };
    return { name: s, type: 'member' };
  }
  if (/^[A-Za-z_$][\w$]*#[A-Za-z_$][\w$]*$/.test(s)) return { name: s.replace('#', '.'), type: 'member' };
  if (/^[A-Za-z_$][\w$]*$/.test(s)) {
    if (/^v\d+_/.test(s) || /^unstable_|^experimental_/.test(s)) return { name: s, type: 'option' };
    if (/^[a-z]+(-[a-z]+)+$/.test(s)) return { name: s, type: 'config-key' }; // eslint rule names etc.
    if (s.length < 3) return null;
    return { name: s, type: 'export' };
  }
  if (/^[a-z]+(-[a-z0-9]+)+$/.test(s)) return { name: s, type: 'config-key' };
  if (/^["'][\w:/-]+["']$/.test(s)) return { name: s.slice(1, -1), type: 'config-key' };
  return null;
}

function dedupeSymbols(list: Ident[]): Ident[] {
  const seen = new Set<string>();
  return list.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)));
}

function kindOf(text: string, symbols: AffectedSymbol[]): ChangeKind {
  const t = text.toLowerCase();
  if (/\brenam/.test(t) || /->|→| is now `|exported as/.test(t)) return 'renamed';
  if (/\bremov|\bdrop(?!.*node)|no longer (exported|supported|accepted|available)/.test(t)) return 'removed';
  if (/\bnode(\.js)?\b.*(\d{2}|version)|requires? node/i.test(t)) return 'runtime';
  if (symbols.some((s: { type: SymbolType }) => s.type === 'cli-flag')) return 'cli';
  if (/config|option|flag/.test(t)) return 'config';
  if (/signature|argument|parameter|now (returns|expects|accepts)/.test(t)) return 'signature';
  if (/default|behaviou?r|now /.test(t)) return 'behavior';
  return 'other';
}

function migrationHints(text: string): string[] {
  const hints: string[] = [];
  for (const line of text.split('\n')) {
    const l = cleanSummary(line);
    if (/\b(use|in favou?r of|replace|instead|migrate|update your|should now|->|→)\b/i.test(l) && l.length > 8) hints.push(l);
    if (hints.length >= 3) break;
  }
  return hints;
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .split('-')
      .slice(0, 6)
      .join('-') || 'change'
  );
}
