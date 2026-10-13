import semver from 'semver';

export interface ParsedTag {
  tag: string;
  /** Package-ish prefix, e.g. `react-router` for `react-router@7.0.0`, '' for `v7.0.0` */
  prefix: string;
  version: string;
}

/**
 * Parse the tag formats seen in the wild:
 *   v1.2.3 · 1.2.3 · pkg@1.2.3 · @scope/pkg@1.2.3 · pkg-v1.2.3 · pkg-1.2.3 · pkg/v1.2.3 · pkg_v1.2.3 · release-1.2.3
 */
export function parseTag(tag: string): ParsedTag | null {
  const m = tag.match(/^(.*?)(?:^|[@/\-_ ])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/);
  if (!m) return null;
  const version = semver.valid(m[2] ?? '');
  if (!version) return null;
  return { tag, prefix: (m[1] ?? '').replace(/[@/\-_ ]+$/, ''), version };
}

function shortName(pkg: string): string {
  return pkg.replace(/^@[^/]+\//, '');
}

const GENERIC_PREFIXES = new Set(['', 'release', 'releases', 'version', 'ver']);

/**
 * Does a tag prefix belong to this package? In a monorepo, `@remix-run/router@1.2.0`
 * must not be mistaken for a `react-router` release.
 */
export function prefixMatches(prefix: string, pkg: string): boolean {
  const p = prefix.toLowerCase();
  if (GENERIC_PREFIXES.has(p)) return true;
  const name = pkg.toLowerCase();
  return p === name || p === shortName(name) || p === name.replace('/', '-') || p === name.replace(/^@/, '').replace('/', '-');
}

/**
 * Tags that might exist for a given version, most likely first. Used to read
 * CHANGELOG.md at the right ref.
 */
export function tagCandidates(pkg: string, version: string): string[] {
  const short = shortName(pkg);
  const list = [`v${version}`, version, `${pkg}@${version}`, `${short}@${version}`, `${short}-v${version}`, `${short}@v${version}`, `${short}/v${version}`, `${short}-${version}`];
  return [...new Set(list)];
}

/**
 * Whether a version lies in the half-open range (from, to]. Prereleases only count if `to`
 * itself is a prerelease of that major, or (with `majorPrereleases`) if they are
 * prereleases of a major the bump crosses: Express lists most v5 removals under
 * 5.0.0-alpha.x, ESLint under 9.0.0-alpha.x.
 */
export function inRange(version: string, from: string, to: string, majorPrereleases = false): boolean {
  if (!semver.valid(version)) return false;
  if (semver.prerelease(version)) {
    const sameMajorAsPreTo = semver.prerelease(to) && semver.major(version) === semver.major(to);
    const crossedMajorPre =
      majorPrereleases && semver.minor(version) === 0 && semver.patch(version) === 0 && semver.major(version) > semver.major(from);
    if (!sameMajorAsPreTo && !crossedMajorPre) return false;
  }
  return semver.gt(version, from) && semver.lte(version, to);
}

/**
 * From a list of tag names, pick the ones that are releases of `pkg` within (from, to],
 * sorted ascending. If a repo has both prefixed and unprefixed tags for the same version,
 * the prefixed one is kept.
 */
export function selectTags(tags: string[], pkg: string, from: string, to: string): ParsedTag[] {
  const byVersion = new Map<string, ParsedTag>();
  for (const tag of tags) {
    const p = parseTag(tag);
    if (!p || !prefixMatches(p.prefix, pkg) || !inRange(p.version, from, to)) continue;
    const prev = byVersion.get(p.version);
    if (!prev || (GENERIC_PREFIXES.has(prev.prefix.toLowerCase()) && !GENERIC_PREFIXES.has(p.prefix.toLowerCase()))) {
      byVersion.set(p.version, p);
    }
  }
  return [...byVersion.values()].sort((a, b) => semver.compare(a.version, b.version));
}

/** Major versions crossed by a bump, e.g. 6.28.0 → 8.1.0 gives [7, 8]. */
export function majorsCrossed(from: string, to: string): number[] {
  const out: number[] = [];
  for (let m = semver.major(from) + 1; m <= semver.major(to); m++) out.push(m);
  return out;
}
