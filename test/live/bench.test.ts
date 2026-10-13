import { it } from 'vitest';
import { createRegistry } from '../../src/notes/registry.js';
import { typeCheckUpgrade } from '../../src/typecheck/typecheck.js';

const ws = process.env.BENCH_WS ?? '';
const out: string[] = [];
it.skipIf(!ws)('live benchmark', async () => {
  const reg = createRegistry();
  const bumps = [
    ['@tanstack/query-core', '4.36.1', '5.104.2', ['src/queries.ts']],
    ['axios', '0.27.2', '1.20.0', ['src/http.ts']],
    ['commander', '9.5.0', '15.0.0', ['src/cli.ts']],
    ['date-fns', '2.30.0', '4.4.0', ['src/dates.ts']],
    ['openai', '3.3.0', '7.32.0', ['src/ai.ts']],
    ['zod', '3.23.8', '4.6.7', ['src/schemas.ts']],
  ] as const;
  for (const [name, from, to, files] of bumps) {
    const t = Date.now();
    const r = await typeCheckUpgrade(ws, { name, fromVersion: from, toVersion: to, bumpType: 'major', manifests: [], depTypes: [] }, [...files], (n, v) => reg.tarball!(n, v));
    out.push(`${name}: ran=${r.ran} ${r.reason ?? ''} ${Date.now() - t}ms`);
    for (const d of r.introduced) out.push(`  ${d.file}:${d.line} TS${d.code} ${d.message.slice(0, 110)}`);
  }
  (await import('node:fs')).writeFileSync(process.env.BENCH_OUT ?? '/dev/null', out.join('\n'));
}, 300_000);
