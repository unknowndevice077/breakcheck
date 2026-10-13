import './shim.js';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { createActionsCache } from './extract/cache.js';
import { createGitHubApi } from './github.js';
import { createRegistry } from './notes/registry.js';
import { createProvider, ModelGateway, type ProviderSetting } from './providers/index.js';
import { renderSummary } from './report/summary.js';
import { run } from './run.js';

const PROVIDERS: ProviderSetting[] = ['copilot', 'anthropic', 'openai', 'none'];

function readProvider(): ProviderSetting {
  const raw = (core.getInput('provider') || 'copilot').trim().toLowerCase();
  if (raw === 'github-models') {
    core.warning('GitHub Models was retired by GitHub on 2026-07-30. Using provider "copilot" (Copilot CLI with GITHUB_TOKEN) instead.');
    return 'copilot';
  }
  if (!PROVIDERS.includes(raw as ProviderSetting)) throw new Error(`Unknown provider "${raw}". Use one of: ${PROVIDERS.join(', ')}.`);
  return raw as ProviderSetting;
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = core.getInput(name);
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Input ${name} must be a positive integer, got "${raw}".`);
  return n;
}

function readBool(name: string, fallback: boolean): boolean {
  return core.getInput(name) ? core.getBooleanInput(name) : fallback;
}

export async function main(): Promise<void> {
  let provider: ProviderSetting;
  let maxPackages: number;
  let includePatch: boolean;
  let failOnAffected: boolean;
  let typecheck: boolean;
  try {
    provider = readProvider();
    maxPackages = readPositiveInt('max-packages', 10);
    includePatch = readBool('include-patch', false);
    failOnAffected = readBool('fail-on-affected', false);
    typecheck = readBool('typecheck', true);
  } catch (e) {
    core.setFailed((e as Error).message);
    return;
  }
  const token = core.getInput('github-token') || process.env.GITHUB_TOKEN || '';
  const apiKey = core.getInput('api-key');
  if (apiKey) core.setSecret(apiKey);

  const { context } = github;
  const pr = context.payload.pull_request;
  if (!pr) {
    core.info(`breakcheck only runs on pull_request events (got "${context.eventName}"). Nothing to do.`);
    return;
  }
  if (context.eventName === 'pull_request_target') {
    core.warning('breakcheck is designed for the pull_request event. With pull_request_target, never check out PR code; usage search will run against whatever is in the workspace.');
  }

  const gh = createGitHubApi(token);
  const registry = createRegistry();
  const { provider: p, reason } = createProvider({ provider, apiKey, model: core.getInput('model'), githubToken: token, copilotCliVersion: core.getInput('copilot-cli-version') });
  const gateway = new ModelGateway(p);
  core.info(p ? `AI provider: ${gateway.label}` : `Rule-based mode: ${reason}`);

  try {
    const result = await run(
      { owner: context.repo.owner, repo: context.repo.repo, pr: pr.number as number, baseSha: pr.base.sha as string, headSha: pr.head.sha as string },
      {
        gh,
        registry,
        ...(typecheck && registry.tarball ? { tarball: registry.tarball.bind(registry) } : {}),
        cache: createActionsCache(),
        gateway,
        workspace: process.env.GITHUB_WORKSPACE || process.cwd(),
        ...(reason ? { providerReason: reason } : {}),
        log: core.info,
      },
      { includePatch, maxPackages },
    ).catch(async (e: { status?: number; message?: string }) => {
      if (e?.status === 403 || e?.status === 401) {
        core.warning(
          `GitHub refused a request (${e.status}: ${e.message}). The workflow needs "permissions: pull-requests: write" and "contents: read"; ` +
            'on PRs from forks the token is read-only, so breakcheck cannot comment there.',
        );
        return null;
      }
      throw e;
    });
    if (!result) return;

    if (result.report) {
      await core.summary.addRaw(renderSummary(result.report, gateway.calls, gh.stats)).write();
      const modes = new Set(result.report.packages.map((x) => x.mode));
      core.setOutput('mode', modes.size > 1 ? 'mixed' : ([...modes][0] ?? 'rules'));
    }
    core.setOutput('affected-count', result.affected);
    core.setOutput('possibly-affected-count', result.possible);
    if (result.comment) {
      core.setOutput('comment-url', result.comment.url);
      core.info(`Comment ${result.comment.action}: ${result.comment.url}`);
    }
    if (failOnAffected && result.affected + result.possible > 0) {
      core.setFailed(`breakcheck: ${result.affected} breaking change(s) affect this repo, ${result.possible} more possibly (fail-on-affected is on).`);
    }
  } catch (e) {
    // Never block a PR because breakcheck itself broke; surface it loudly instead.
    core.error(`breakcheck failed unexpectedly: ${(e as Error).stack ?? String(e)}`);
  }
}

await main();
