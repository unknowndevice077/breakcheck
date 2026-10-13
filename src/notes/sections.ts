import semver from 'semver';
import { inRange } from './tags.js';

export interface Section {
  level: number;
  heading: string;
  /** Heading line(s) plus content up to the next heading of any level */
  text: string;
}

/** A single line that announces a breaking change (conventional-commit `!:`, BREAKING, removed, ...). */
export const BREAKING_LINE = /BREAKING|\w!:|\bremoved?\b|\bno longer\b|\bdrop(?:ped|s)? support\b|\bdeprecat/i;

/** A line of GitHub's auto-generated "What's Changed" list: "* title by @user in https://github.com/o/r/pull/123". */
export const AUTO_PR_LINE = /\bby @[\w-]+(\[bot\])? in https:\/\/github\.com\/\S+\/pull\/\d+/;

/** Mostly an auto-generated PR list (titles of merged PRs, rarely user-facing breaks). */
export function isAutoPrList(text: string): boolean {
  const bullets = text.split('\n').filter((l) => /^\s*[-*+]\s/.test(l));
  return bullets.length >= 3 && bullets.filter((l) => AUTO_PR_LINE.test(l)).length / bullets.length >= 0.6;
}

export const PRIORITY_HEADING = /breaking|removed|removal|deprecat|migrat|upgrad|major changes|incompatib|⚠️|:warning:|drop(ped)? support/i;

interface Line {
  text: string;
  level: number; // 0 = not a heading
  heading: string;
  /** setext headings span two lines; the underline is skipped */
  skip?: boolean;
}

function classifyLines(md: string): Line[] {
  const raw = md.replace(/\r\n?/g, '\n').split('\n');
  const out: Line[] = [];
  let fence: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const text = raw[i] ?? '';
    const fenceMatch = text.match(/^\s*(```+|~~~+)/);
    if (fenceMatch?.[1]) {
      if (fence === null) fence = fenceMatch[1].slice(0, 3);
      else if (text.trim().startsWith(fence)) fence = null;
      out.push({ text, level: 0, heading: '' });
      continue;
    }
    if (fence !== null) {
      out.push({ text, level: 0, heading: '' });
      continue;
    }
    const atx = text.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (atx?.[1]) {
      out.push({ text, level: atx[1].length, heading: atx[2] ?? '' });
      continue;
    }
    // Plain "v9.0.0 - April 5, 2024" lines (ESLint) act as version headings.
    if (/^v?\d+\.\d+\.\d+\S*\s+[-–/]\s+\S/.test(text) && (raw[i - 1] ?? '').trim() === '') {
      out.push({ text, level: 2, heading: text.trim() });
      continue;
    }
    const next = raw[i + 1] ?? '';
    const prev = raw[i - 1] ?? '';
    const setext = /^\s*(=+|-+)\s*$/.exec(next);
    if (setext?.[1] && text.trim() && !/^\s*([-*+]|\d+\.)\s/.test(text) && prev.trim() === '' && setext[1].length >= 3) {
      out.push({ text, level: setext[1].startsWith('=') ? 1 : 2, heading: text.trim() });
      out.push({ text: next, level: 0, heading: '', skip: true });
      i++;
      continue;
    }
    out.push({ text, level: 0, heading: '' });
  }
  return out;
}

export function splitSections(md: string): Section[] {
  const lines = classifyLines(md);
  const sections: Section[] = [];
  let cur: Section = { level: 0, heading: '', text: '' };
  for (const l of lines) {
    if (l.level > 0) {
      if (cur.text.trim() || cur.level) sections.push(cur);
      cur = { level: l.level, heading: l.heading, text: l.text + '\n' };
    } else {
      cur.text += l.text + '\n';
    }
  }
  if (cur.text.trim() || cur.level) sections.push(cur);
  return sections;
}

const VERSION_IN_HEADING = /(?:^|[\s[(@v])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?=$|[\s\])/,:])/;

export function headingVersion(heading: string): string | null {
  const m = heading.match(VERSION_IN_HEADING);
  return m?.[1] ? semver.valid(m[1]) : null;
}

export interface VersionBlock {
  version: string;
  heading: string;
  text: string;
}

/**
 * Cut a CHANGELOG into per-version blocks and keep those in (from, to].
 * The version heading level is the shallowest level that carries versions,
 * so nested "### Breaking Changes" stay inside their version.
 */
export function sliceChangelog(md: string, from: string, to: string): VersionBlock[] {
  const sections = splitSections(md);
  const versionLevels = sections.filter((s) => s.level && headingVersion(s.heading)).map((s) => s.level);
  if (!versionLevels.length) return [];
  const level = Math.min(...versionLevels);
  const blocks: VersionBlock[] = [];
  let cur: VersionBlock | null = null;
  for (const s of sections) {
    if (s.level && s.level <= level) {
      if (cur) blocks.push(cur);
      const v = s.level === level ? headingVersion(s.heading) : null;
      cur = v ? { version: v, heading: s.heading, text: s.text } : null;
    } else if (cur) {
      cur.text += s.text;
    }
  }
  if (cur) blocks.push(cur);
  return blocks.filter((b) => inRange(b.version, from, to, true)).sort((a, b) => semver.compare(a.version, b.version));
}

export interface NoteBlock {
  title: string;
  url: string;
  body: string;
  version?: string;
  /** Minimum priority for every section of this block (migration guides are all relevant) */
  priorityFloor?: number;
  /** Migration guides share the budget with release notes instead of crowding them out */
  guide?: boolean;
}

/** Share of the budget migration guides may take before release notes have had their turn */
const GUIDE_SHARE = 0.5;

interface Chunk {
  block: number;
  order: number;
  text: string;
  priority: number;
}

/**
 * Join note blocks into one markdown document within `budget` characters.
 * Sections about breaking changes / removals / migrations are kept first;
 * the rest fills the remaining space in original order.
 */
export function assembleNotes(blocks: NoteBlock[], budget: number): { text: string; truncated: boolean } {
  const chunks: Chunk[] = [];
  blocks.forEach((b, bi) => {
    const isMajor = b.version ? semver.minor(b.version) === 0 && semver.patch(b.version) === 0 : false;
    splitSections(b.body).forEach((s, si) => {
      const text = s.text.trim();
      if (!text) return;
      // x.0.0 releases carry the big changes of a multi-major range
      let priority = Math.max(isMajor ? 2 : 0, b.priorityFloor ?? 0);
      if (PRIORITY_HEADING.test(s.heading)) priority = 3;
      else if (isAutoPrList(text)) priority = Math.min(priority, b.priorityFloor ?? 0);
      else if (BREAKING_LINE.test(text)) priority = Math.max(priority, 2);
      chunks.push({ block: bi, order: si, text, priority });
    });
  });

  const total = blocks.reduce((n, b) => n + b.title.length + b.url.length + 8, 0) + chunks.reduce((n, c) => n + c.text.length + 2, 0);
  if (total <= budget) return { text: render(blocks, chunks), truncated: false };

  // A block's "=== title (url) ===" header is only paid for (and shown) once one of
  // its sections is kept; dozens of empty patch-release headers must not eat the budget.
  const headerCost = (bi: number) => (blocks[bi]?.title.length ?? 0) + (blocks[bi]?.url.length ?? 0) + 10;
  const paid = new Set<number>();
  let remaining = budget;
  const keep = new Set<Chunk>();
  const byPriority = [...chunks].sort((a, b) => b.priority - a.priority || a.block - b.block || a.order - b.order);
  // Across several majors a guide covers one of them; it must not crowd out the other x.0.0 notes.
  const majorReleases = new Set(blocks.filter((b) => b.version && semver.minor(b.version) === 0 && semver.patch(b.version) === 0).map((b) => semver.major(b.version as string)));
  const isGuide = (c: Chunk) => majorReleases.size > 1 && !!blocks[c.block]?.guide;
  let guideBudget = budget * GUIDE_SHARE;
  const take = (c: Chunk, capped: boolean): boolean => {
    if (remaining <= 200 || keep.has(c)) return false;
    const header = paid.has(c.block) ? 0 : headerCost(c.block);
    const limit = capped && isGuide(c) ? Math.min(remaining, guideBudget) : remaining;
    let kept: Chunk | null = null;
    if (c.text.length + 2 + header <= limit) kept = c;
    else if (c.priority >= 2 && limit - header > 300 && (!capped || !isGuide(c))) {
      kept = { ...c, text: condense(c.text, limit - header - 2) };
      chunks.splice(chunks.indexOf(c), 1, kept);
    }
    if (!kept) return false;
    keep.add(kept);
    paid.add(c.block);
    const cost = kept.text.length + 2 + header;
    remaining -= cost;
    if (isGuide(c)) guideBudget -= cost;
    return true;
  };
  // First pass: guides capped at their share; second pass: any space left goes to what was skipped.
  for (const c of byPriority) take(c, true);
  for (const c of byPriority) if (chunks.includes(c)) take(c, false);
  const kept = chunks.filter((c) => keep.has(c));
  const dropped = chunks.length - kept.length;
  const text = render(blocks, kept) + (dropped ? `\n\n…[${dropped} lower-priority section(s) omitted to fit the size budget]` : '');
  return { text, truncated: true };
}

/** Shrink one section to `max` chars, keeping its heading and breaking-change lines first. */
export function condense(text: string, max: number): string {
  if (text.length <= max) return text;
  const lines = text.split('\n');
  const marker = '…[section truncated]';
  const keep = new Set<number>([0]);
  let size = (lines[0]?.length ?? 0) + marker.length + 2;
  const order = lines.map((l, i) => ({ l, i })).slice(1);
  const important = (l: string) => BREAKING_LINE.test(l) && !AUTO_PR_LINE.test(l);
  order.sort((a, b) => Number(important(b.l)) - Number(important(a.l)) || a.i - b.i);
  for (const { l, i } of order) {
    if (size + l.length + 1 > max) continue;
    keep.add(i);
    size += l.length + 1;
  }
  return lines.filter((_, i) => keep.has(i)).join('\n') + '\n' + marker;
}

function render(blocks: NoteBlock[], chunks: Chunk[]): string {
  return blocks
    .map((b, bi) => ({ b, body: chunks.filter((c) => c.block === bi).map((c) => c.text) }))
    .filter(({ body }) => body.length)
    .map(({ b, body }) => `=== ${b.title} (${b.url}) ===\n${body.join('\n\n')}`)
    .join('\n\n');
}

/** Markdown links that look like migration / upgrade guides. */
export function findMigrationLinks(md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)>\]]+)/g)) {
    const label = m[1] ?? '';
    const url = (m[2] ?? m[3] ?? '').replace(/[.,;]+$/, '');
    if (/migrat|upgrad/i.test(label) || /migrat|upgrad|breaking-changes/i.test(url)) out.add(url);
  }
  return [...out];
}
