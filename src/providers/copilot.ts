import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseJsonLoose } from '../extract/schema.js';
import { ProviderError, type CompletionRequest, type CompletionResult, type Provider } from './types.js';

/**
 * GitHub Copilot via the Copilot CLI, authenticated with the workflow's GITHUB_TOKEN.
 * Needs `permissions: copilot-requests: write` and a Copilot plan on the repo owner
 * (Copilot Free works). This replaces GitHub Models, which GitHub retired on 2026-07-30.
 *
 * The CLI is an agent; we give it nothing to act on: it runs in an empty temp dir,
 * with shell/write tools denied and no URL access, and only sees the prompt.
 */
export const COPILOT_CLI_VERSION = '1.0.96';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type Runner = (cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs: number }) => Promise<RunResult>;

export const defaultRunner: Runner = (cmd, args, opts) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { env: opts.env, cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + String(e), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });

/** Linux caps a single argv entry at 128 KiB. */
const MAX_PROMPT_CHARS = 120_000;

export function createCopilotProvider(opts: { token: string; model?: string; cliVersion?: string; runner?: Runner; timeoutMs?: number }): Provider {
  const run = opts.runner ?? defaultRunner;
  const version = opts.cliVersion || COPILOT_CLI_VERSION;
  return {
    id: 'copilot',
    // Copilot Free only offers automatic model selection, so "auto" is the default.
    model: opts.model || 'auto',
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      let prompt =
        `${req.system}\n\n${req.prompt}\n\n` +
        `Respond with ONLY a JSON object (no prose, no code fences) that validates against this JSON Schema:\n${JSON.stringify(req.schema)}`;
      if (prompt.length > MAX_PROMPT_CHARS) prompt = prompt.slice(0, MAX_PROMPT_CHARS);

      const cwd = mkdtempSync(path.join(tmpdir(), 'breakcheck-copilot-'));
      const args = ['--yes', `@github/copilot@${version}`, '-p', prompt, '-s', '--no-ask-user', '--deny-tool=shell,write'];
      if (opts.model && opts.model !== 'auto') args.push(`--model=${opts.model}`);
      const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        RUNNER_TEMP: process.env.RUNNER_TEMP,
        COPILOT_HOME: path.join(cwd, '.copilot'),
        COPILOT_GITHUB_TOKEN: opts.token,
        NO_COLOR: '1',
      };
      let res: RunResult;
      try {
        res = await run('npx', args, { env, cwd, timeoutMs: opts.timeoutMs ?? 240_000 });
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
      if (res.timedOut) throw new ProviderError('timeout', 'Copilot CLI timed out');
      if (res.code !== 0) throw classify(`${res.stderr}\n${res.stdout}`, res.code);
      try {
        return { data: parseJsonLoose(res.stdout) };
      } catch (e) {
        throw new ProviderError('invalid-response', (e as Error).message);
      }
    },
  };
}

function classify(output: string, code: number | null): ProviderError {
  const text = output.replace(/\s+/g, ' ').trim();
  const tail = text.slice(-300);
  if (/rate.?limit|429|too many requests|quota|credits? (exhausted|exceeded)/i.test(text)) return new ProviderError('rate-limit', `Copilot rate limit or AI-credit allowance reached: ${tail}`);
  if (/401|403|unauthori[sz]ed|forbidden|not (enabled|entitled|licensed)|no (active )?copilot|copilot-requests|permission|policy/i.test(text)) {
    return new ProviderError('auth', `Copilot is not available to this workflow (needs \`copilot-requests: write\` and a Copilot plan): ${tail}`);
  }
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|network|EAI_AGAIN/i.test(text)) return new ProviderError('network', `network error running Copilot CLI: ${tail}`);
  if (code === null) return new ProviderError('unavailable', `could not start Copilot CLI: ${tail}`);
  return new ProviderError('unavailable', `Copilot CLI exited with code ${code}: ${tail}`);
}
