import type { GitHubApi } from '../github.js';
import { MARKER } from './render.js';

/** Create the breakcheck comment, or update it in place if one exists (found by its hidden marker). */
export async function upsertComment(gh: GitHubApi, owner: string, repo: string, pr: number, body: string, opts: { createIfMissing?: boolean } = {}) {
  const comments = await gh.listIssueComments(owner, repo, pr);
  const existing = comments.find((c) => c.body.includes(MARKER));
  if (existing) return { ...(await gh.updateComment(owner, repo, existing.id, body)), action: 'updated' as const };
  if (opts.createIfMissing === false) return null;
  return { ...(await gh.createComment(owner, repo, pr, body)), action: 'created' as const };
}
