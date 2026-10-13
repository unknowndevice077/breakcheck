import path from 'node:path/posix';
import semver from 'semver';
import type { GitHubApi } from '../github.js';
import type { Bump, ReleaseNotes, ReleaseNoteSource } from '../types.js';
import type { Registry, RepoRef } from './registry.js';
import { assembleNotes, findMigrationLinks, sliceChangelog, type NoteBlock } from './sections.js';
import { majorsCrossed, parseTag, prefixMatches, selectTags, tagCandidates } from './tags.js';

export interface GatherOptions {
  /** Max characters of notes passed on to extraction */
  budget: number;
  /** Max release pages (100 each) to scan */
  maxReleasePages?: number;
}

const CHANGELOG_NAMES = ['CHANGELOG.md', 'CHANGES.md', 'HISTORY.md', 'History.md', 'changelog.md', 'RELEASES.md', 'NEWS.md'];
const MIGRATION_NAMES = /(^|\/)(MIGRATION|MIGRATING|UPGRADING|UPGRADE)(_GUIDE)?\.mdx?$/i;
const POINTER = /\b(see|check|refer to|read)\b[^\n]*\b(changelog|release notes|changes)\b/i;

/** A release body that only links elsewhere, e.g. "See the CHANGELOG for details". */
export function isPointerOnly(body: string): boolean {
  const text = body.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '').trim();
  if (text.length < 40) return !/`[^`]+`/.test(text); // "- Remove `foo`" is short but real
  return text.length < 300 && POINTER.test(text) && text.split('\n').filter((l) => l.trim()).length <= 3;
}

/**
 * Gather release notes for (from, to]: GitHub Releases first, CHANGELOG at the tag
 * as a fallback, and for major bumps a migration guide from the repo.
 */
export async function gatherNotes(gh: GitHubApi, registry: Registry, bump: Bump, opts: GatherOptions): Promise<ReleaseNotes> {
  const { name, fromVersion: from, toVersion: to } = bump;
  const { repo, rawRepository } = await registry.repoFor(name, to);
  if (!repo) {
    return empty(null, rawRepository ? `the package's repository (${rawRepository}) is not on GitHub` : 'the npm registry lists no repository for this package');
  }
  const { owner, repo: r } = repo;
  const blocks: NoteBlock[] = [];
  const sources: ReleaseNoteSource[] = [];

  // 1. GitHub Releases
  const releases = await findReleases(gh, repo, name, from, to, opts.maxReleasePages ?? 5);
  // Bodies that only point elsewhere ("See the CHANGELOG") carry nothing and would eat
  // the size budget (React Router has one per version), so they don't count as notes.
  const informative = releases.filter((x) => !isPointerOnly(x.body));
  for (const rel of informative) {
    blocks.push({ title: `Release ${rel.tag}`, url: rel.url, body: rel.body, version: rel.version });
    sources.push({ kind: 'release', url: rel.url, title: rel.tag, version: rel.version });
  }

  // Resolve a ref for the target version: needed for CHANGELOG and migration guides.
  const toTag = releases.find((x) => x.version === to)?.tag ?? (await findTag(gh, repo, name, to));
  const ref = toTag ?? undefined;
  const tree = await gh.listTree(owner, r, ref ?? 'HEAD');
  const paths = tree?.paths ?? [];

  // 2. CHANGELOG: the fallback when releases had nothing useful, and for major bumps a
  //    supplement when a release only summarises ("old method signatures were removed")
  //    while the changelog lists the APIs (Express 5).
  const releaseText = informative.map((x) => x.body).join('\n');
  const releasesUseless = releaseText.trim().length < 200;
  if (releasesUseless || bump.bumpType === 'major') {
    const file = pickChangelog(paths, repo.directory);
    const content = file ? await gh.getFile(owner, r, file, ref) : null;
    if (file && content) {
      const url = `https://github.com/${owner}/${r}/blob/${ref ?? 'HEAD'}/${file}`;
      const releaseLength = new Map(informative.map((x) => [x.version, x.body.length]));
      const majors = new Set(majorsCrossed(from, to));
      let added = 0;
      for (const b of sliceChangelog(content, from, to)) {
        if (!releasesUseless) {
          const isMajorEntry = majors.has(semver.major(b.version)) && semver.minor(b.version) === 0 && semver.patch(b.version) === 0;
          const detailedThanRelease = b.text.length > 2 * (releaseLength.get(b.version) ?? 0);
          if (!isMajorEntry || !detailedThanRelease) continue;
        }
        // As a supplement, these entries are the detailed list the release summarised: keep them first.
        blocks.push({ title: `${file} ${b.heading}`, url, body: b.text, version: b.version, ...(releasesUseless ? {} : { priorityFloor: 3 }) });
        added++;
      }
      if (added) sources.push({ kind: 'changelog', url, title: file });
    }
  }

  // 3. Migration guides for major bumps
  const migrationLinks = new Set(findMigrationLinks(blocks.map((b) => b.body).join('\n')));
  if (bump.bumpType === 'major') {
    const majors = majorsCrossed(from, to);
    if (semver.major(from) === 0) majors.push(0);
    const guides = pickMigrationGuides(paths, repo.directory, majors, semver.major(from));
    // Guides linked from the notes that live in the same GitHub repo can be read directly.
    for (const link of migrationLinks) {
      const m = link.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/blob\/([^/]+)\/(.+\.mdx?)$/);
      if (m && m[1] === owner && m[2] === r && m[4] && !guides.includes(m[4])) guides.push(m[4]);
    }
    for (const g of guides.slice(0, 3)) {
      const content = await gh.getFile(owner, r, g, ref);
      if (!content) continue;
      const url = `https://github.com/${owner}/${r}/blob/${ref ?? 'HEAD'}/${g}`;
      blocks.push({ title: `Migration guide ${g}`, url, body: content, priorityFloor: 3 });
      sources.push({ kind: 'migration-guide', url, title: g });
      migrationLinks.delete(url);
    }
  }

  if (!blocks.length) {
    const where = `${owner}/${r}${repo.directory ? `/${repo.directory}` : ''}`;
    return { ...empty(repo, `no GitHub releases, CHANGELOG entries or migration guide found for ${from} → ${to} in ${where}`), migrationLinks: [...migrationLinks] };
  }
  const { text, truncated } = assembleNotes(blocks, opts.budget);
  return { repo, text, sources, migrationLinks: [...migrationLinks], truncated };
}

function empty(repo: RepoRef | null, missingReason: string): ReleaseNotes {
  return { repo, text: '', sources: [], migrationLinks: [], truncated: false, missingReason };
}

async function findReleases(gh: GitHubApi, repo: RepoRef, name: string, from: string, to: string, maxPages: number) {
  const all: { tag: string; body: string; url: string; version: string }[] = [];
  const byTag = new Map<string, { tag: string; body: string; url: string }>();
  let reachedFrom = false;
  for (let page = 1; page <= maxPages; page++) {
    const list = await gh.listReleases(repo.owner, repo.repo, page);
    for (const rel of list) if (!rel.draft) byTag.set(rel.tag, rel);
    // Releases come newest first; once a page holds only versions older than `from`, stop.
    const versions = list
      .map((x) => parseTag(x.tag))
      .filter((p): p is NonNullable<typeof p> => !!p && prefixMatches(p.prefix, name))
      .map((p) => p.version);
    if (list.length < 100 || (versions.length && versions.some((v) => semver.lte(v, from)))) {
      reachedFrom = true;
      break;
    }
  }
  // Projects that release on every merge (TanStack, Next.js canaries) can have more releases
  // than we page through; the x.0.0 release that lists the breaking changes must not be lost.
  if (!reachedFrom) {
    for (const major of majorsCrossed(from, to)) {
      const version = `${major}.0.0`;
      if ([...byTag.keys()].some((t) => parseTag(t)?.version === version && prefixMatches(parseTag(t)?.prefix ?? '', name))) continue;
      for (const tag of tagCandidates(name, version)) {
        const rel = await gh.getReleaseByTag(repo.owner, repo.repo, tag);
        if (rel && !rel.draft) {
          byTag.set(rel.tag, rel);
          break;
        }
      }
    }
  }
  for (const t of selectTags([...byTag.keys()], name, from, to)) {
    const rel = byTag.get(t.tag);
    if (rel) all.push({ ...rel, version: t.version });
  }
  return all;
}

async function findTag(gh: GitHubApi, repo: RepoRef, name: string, version: string): Promise<string | null> {
  for (const tag of tagCandidates(name, version)) {
    if (await gh.refExists(repo.owner, repo.repo, tag)) return tag;
  }
  return null;
}

/** Prefer a changelog in the package's own directory (monorepos), then the repo root. */
export function pickChangelog(paths: string[], directory?: string): string | null {
  const set = new Set(paths);
  const dirs = directory ? [directory, ''] : [''];
  for (const d of dirs) {
    for (const n of CHANGELOG_NAMES) {
      const p = d ? `${d}/${n}` : n;
      if (set.has(p)) return p;
    }
  }
  // Tree unavailable (or truncated): guess the conventional location.
  if (!paths.length) return directory ? `${directory}/CHANGELOG.md` : 'CHANGELOG.md';
  return null;
}

/**
 * Find migration / upgrade guides in the repo tree for the majors being crossed, e.g.
 * `docs/src/use/migrate-to-9.0.0.md`, `docs/upgrading/v6.md` (upgrading *from* v6),
 * `.../upgrading/02-version-15.mdx`, or a root `MIGRATION.md`.
 */
export function pickMigrationGuides(paths: string[], directory: string | undefined, majors: number[], fromMajor: number): string[] {
  const scored: { p: string; score: number; base: number }[] = [];
  for (const p of paths) {
    if (!/\.mdx?$/i.test(p) || /(^|\/)(node_modules|test|tests|__tests__|fixtures|examples?)\//i.test(p) || /changelog/i.test(p)) continue;
    let score: number;
    if (MIGRATION_NAMES.test(p)) score = 5;
    else if (/migrat|upgrad/i.test(p)) {
      const stem = path.basename(p).replace(/\.mdx?$/i, '');
      const nums = [...stem.matchAll(/(?:^|[^0-9.])(?:v|version-?|to-)?(\d+)(?:\.0\.0|\.x)?(?=$|[^0-9.])/gi)].map((m) => Number(m[1]));
      const leading = stem.match(/^(\d+)-/)?.[1]; // "02-version-15" → 02 is just an ordering prefix
      const relevant = nums.filter((n, i) => !(i === 0 && leading && n === Number(leading)));
      if (relevant.some((n) => majors.includes(n))) score = 4;
      else if (relevant.includes(fromMajor) && /upgrad/i.test(p)) score = 3;
      else continue;
    } else continue;
    const base = score;
    if (directory && p.startsWith(`${directory}/`)) score += 1;
    if (/(^|\/)docs?\//i.test(p)) score += 0.5;
    scored.push({ p, score, base });
  }
  // "upgrading/v6" (= from v6) is only a fallback when no guide names the target major.
  const hasTargetGuide = scored.some((s) => s.base >= 4);
  return scored
    .filter((s) => !hasTargetGuide || s.base !== 3)
    .sort((a, b) => b.score - a.score || a.p.length - b.p.length)
    .map((s) => s.p);
}
