import { getOctokit } from '@actions/github';

export interface Release {
  tag: string;
  name: string;
  body: string;
  url: string;
  draft: boolean;
  prerelease: boolean;
}

export interface IssueComment {
  id: number;
  body: string;
}

/** The GitHub calls breakcheck makes. One implementation, backed by Octokit; tests swap `fetch`. */
export interface GitHubApi {
  getFile(owner: string, repo: string, path: string, ref?: string): Promise<string | null>;
  refExists(owner: string, repo: string, tag: string): Promise<boolean>;
  listTree(owner: string, repo: string, ref: string): Promise<{ paths: string[]; truncated: boolean } | null>;
  listReleases(owner: string, repo: string, page: number): Promise<Release[]>;
  getReleaseByTag(owner: string, repo: string, tag: string): Promise<Release | null>;
  listPullFiles(owner: string, repo: string, pull: number): Promise<string[]>;
  listIssueComments(owner: string, repo: string, issue: number): Promise<IssueComment[]>;
  createComment(owner: string, repo: string, issue: number, body: string): Promise<{ id: number; url: string }>;
  updateComment(owner: string, repo: string, id: number, body: string): Promise<{ id: number; url: string }>;
  readonly stats: { requests: number; rateLimited: number };
}

interface RequestError {
  status?: number;
  response?: { headers?: Record<string, string | undefined> };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createGitHubApi(token: string, opts: { fetch?: typeof fetch; baseUrl?: string; maxWaitMs?: number } = {}): GitHubApi {
  const octokit = getOctokit(token, {
    ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
    request: opts.fetch ? { fetch: opts.fetch } : {},
  });
  const stats = { requests: 0, rateLimited: 0 };
  const maxWait = opts.maxWaitMs ?? 60_000;

  /** One request, retried once if GitHub says we are rate limited and the wait is short. */
  async function call<T>(route: string, params: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      stats.requests++;
      try {
        const res = await octokit.request(route, params);
        return res.data as T;
      } catch (e) {
        const err = e as RequestError;
        const h = err.response?.headers ?? {};
        const limited = (err.status === 403 || err.status === 429) && (h['retry-after'] !== undefined || h['x-ratelimit-remaining'] === '0');
        if (!limited || attempt > 0) throw e;
        stats.rateLimited++;
        const wait = h['retry-after'] ? Number(h['retry-after']) * 1000 : Number(h['x-ratelimit-reset'] ?? 0) * 1000 - Date.now();
        if (!(wait > 0) || wait > maxWait) throw e;
        await sleep(wait);
      }
    }
  }

  const notFound = (e: unknown) => {
    const s = (e as RequestError).status;
    return s === 404 || s === 422;
  };

  return {
    stats,
    async getFile(owner, repo, path, ref) {
      try {
        const data = await call<unknown>('GET /repos/{owner}/{repo}/contents/{path}', {
          owner,
          repo,
          path,
          ...(ref ? { ref } : {}),
          mediaType: { format: 'raw' },
        });
        if (typeof data === 'string') return data;
        if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
        return null; // a directory
      } catch (e) {
        if (notFound(e)) return null;
        throw e;
      }
    },
    async refExists(owner, repo, tag) {
      try {
        await call('GET /repos/{owner}/{repo}/git/ref/{ref}', { owner, repo, ref: `tags/${tag}` });
        return true;
      } catch (e) {
        if (notFound(e)) return false;
        throw e;
      }
    },
    async listTree(owner, repo, ref) {
      try {
        const data = await call<{ tree: { path: string; type: string }[]; truncated: boolean }>(
          'GET /repos/{owner}/{repo}/git/trees/{tree_sha}',
          { owner, repo, tree_sha: ref, recursive: '1' },
        );
        return { paths: data.tree.filter((t) => t.type === 'blob').map((t) => t.path), truncated: data.truncated };
      } catch (e) {
        if (notFound(e)) return null;
        throw e;
      }
    },
    async listReleases(owner, repo, page) {
      try {
        const data = await call<
          { tag_name: string; name: string | null; body: string | null; html_url: string; draft: boolean; prerelease: boolean }[]
        >('GET /repos/{owner}/{repo}/releases', { owner, repo, per_page: 100, page });
        return data.map((r) => ({ tag: r.tag_name, name: r.name ?? r.tag_name, body: r.body ?? '', url: r.html_url, draft: r.draft, prerelease: r.prerelease }));
      } catch (e) {
        if (notFound(e)) return [];
        throw e;
      }
    },
    async getReleaseByTag(owner, repo, tag) {
      try {
        const r = await call<{ tag_name: string; name: string | null; body: string | null; html_url: string; draft: boolean; prerelease: boolean }>(
          'GET /repos/{owner}/{repo}/releases/tags/{tag}',
          { owner, repo, tag },
        );
        return { tag: r.tag_name, name: r.name ?? r.tag_name, body: r.body ?? '', url: r.html_url, draft: r.draft, prerelease: r.prerelease };
      } catch (e) {
        if (notFound(e)) return null;
        throw e;
      }
    },
    async listPullFiles(owner, repo, pull) {
      const out: string[] = [];
      for (let page = 1; page <= 30; page++) {
        const data = await call<{ filename: string }[]>('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', { owner, repo, pull_number: pull, per_page: 100, page });
        out.push(...data.map((f) => f.filename));
        if (data.length < 100) break;
      }
      return out;
    },
    async listIssueComments(owner, repo, issue) {
      const out: IssueComment[] = [];
      for (let page = 1; page <= 50; page++) {
        const data = await call<{ id: number; body?: string }[]>('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', { owner, repo, issue_number: issue, per_page: 100, page });
        out.push(...data.map((c) => ({ id: c.id, body: c.body ?? '' })));
        if (data.length < 100) break;
      }
      return out;
    },
    async createComment(owner, repo, issue, body) {
      const d = await call<{ id: number; html_url: string }>('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', { owner, repo, issue_number: issue, body });
      return { id: d.id, url: d.html_url };
    },
    async updateComment(owner, repo, id, body) {
      const d = await call<{ id: number; html_url: string }>('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', { owner, repo, comment_id: id, body });
      return { id: d.id, url: d.html_url };
    },
  };
}
