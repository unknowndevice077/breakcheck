export interface RepoRef {
  owner: string;
  repo: string;
  directory?: string;
}

/** Parse the many shapes of package.json `repository` into a GitHub owner/repo. */
export function parseGitHubRepo(input: unknown): RepoRef | null {
  let url: string | undefined;
  let directory: string | undefined;
  if (typeof input === 'string') url = input;
  else if (input && typeof input === 'object') {
    const r = input as { url?: unknown; directory?: unknown };
    if (typeof r.url === 'string') url = r.url;
    if (typeof r.directory === 'string') directory = r.directory.replace(/^\.?\/+|\/+$/g, '') || undefined;
  }
  if (!url) return null;
  url = url.trim();
  // Shorthands: "owner/repo" and "github:owner/repo"
  const short = url.match(/^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (short?.[1] && short[2]) {
    return { owner: short[1], repo: short[2], ...(directory ? { directory } : {}) };
  }
  const m = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i);
  if (!m?.[1] || !m[2]) return null;
  // Some packages point at a sub-tree URL instead of using `directory`
  const tree = url.match(/github\.com\/[\w.-]+\/[\w.-]+\/tree\/[^/]+\/(.+)$/);
  if (!directory && tree?.[1]) directory = tree[1].replace(/\/+$/, '');
  return { owner: m[1], repo: m[2], ...(directory ? { directory } : {}) };
}

export interface Registry {
  repoFor(name: string, version: string): Promise<{ repo: RepoRef | null; rawRepository: string | null }>;
}

export function createRegistry(opts: { fetch?: typeof fetch; baseUrl?: string } = {}): Registry {
  const f = opts.fetch ?? fetch;
  // npm's own setting, so private mirrors work the same way they do for `npm install`
  const base = (opts.baseUrl ?? process.env.npm_config_registry ?? process.env.NPM_CONFIG_REGISTRY ?? 'https://registry.npmjs.org').replace(/\/$/, '');
  return {
    async repoFor(name, version) {
      // The per-version document is small even for packages with thousands of versions.
      const url = `${base}/${name.replace('/', '%2f')}/${encodeURIComponent(version)}`;
      const res = await f(url, { headers: { accept: 'application/json' } });
      if (!res.ok) return { repo: null, rawRepository: null };
      const doc = (await res.json()) as { repository?: unknown; homepage?: unknown; bugs?: { url?: unknown } | string };
      const repo =
        parseGitHubRepo(doc.repository) ??
        parseGitHubRepo(typeof doc.homepage === 'string' && doc.homepage.includes('github.com') ? doc.homepage : null) ??
        parseGitHubRepo(typeof doc.bugs === 'object' && typeof doc.bugs?.url === 'string' ? doc.bugs.url : null);
      const raw = typeof doc.repository === 'string' ? doc.repository : ((doc.repository as { url?: string } | undefined)?.url ?? null);
      return { repo, rawRepository: raw };
    },
  };
}
