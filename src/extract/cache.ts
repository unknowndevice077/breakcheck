import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as actionsCache from '@actions/cache';
import * as core from '@actions/core';
import type { ExtractionResult } from '../types.js';

/** Where an extraction result is stored between runs. */
export interface ExtractionCache {
  get(key: string): Promise<ExtractionResult | null>;
  set(key: string, value: ExtractionResult): Promise<void>;
}

export function cacheKey(parts: { pkg: string; from: string; to: string; label: string }): string {
  // Bump the version prefix whenever the prompt or schema changes meaningfully.
  const raw = `breakcheck-v1-${parts.label}-${parts.pkg}-${parts.from}-${parts.to}`;
  return raw.replace(/[^\w.@/-]/g, '_').slice(0, 400);
}

/**
 * Backed by actions/cache. Note GitHub's cache scoping: a PR run can read caches
 * saved on its own ref and on the base branch, so results become shared across
 * PRs once the same upgrade has been analysed on the default branch (e.g. by a
 * push-triggered or scheduled run). Any cache failure is treated as a miss.
 */
export function createActionsCache(): ExtractionCache {
  const dir = path.join(process.env.RUNNER_TEMP || tmpdir(), 'breakcheck-cache');
  const fileFor = (key: string) => path.join(dir, `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);
  return {
    async get(key) {
      if (!actionsCache.isFeatureAvailable()) return null;
      const file = fileFor(key);
      try {
        mkdirSync(dir, { recursive: true });
        const hit = await actionsCache.restoreCache([file], key);
        if (!hit) return null;
        return JSON.parse(readFileSync(file, 'utf8')) as ExtractionResult;
      } catch (e) {
        core.debug(`cache restore failed for ${key}: ${String(e)}`);
        return null;
      }
    },
    async set(key, value) {
      if (!actionsCache.isFeatureAvailable()) return;
      const file = fileFor(key);
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, JSON.stringify(value));
        await actionsCache.saveCache([file], key);
      } catch (e) {
        // "Unable to reserve cache" when another job saved the same key first is fine.
        core.debug(`cache save failed for ${key}: ${String(e)}`);
      }
    },
  };
}

export function createMemoryCache(seed: Record<string, ExtractionResult> = {}): ExtractionCache & { store: Map<string, ExtractionResult> } {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
    },
  };
}
