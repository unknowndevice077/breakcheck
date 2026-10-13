// The bundled TypeScript compiler (via ts-morph) reads the CommonJS globals
// __filename/__dirname at load time; an ESM bundle has neither. This module is
// imported first in main.ts so they exist before ts-morph is evaluated.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const g = globalThis as { __filename?: string; __dirname?: string };
g.__filename ??= fileURLToPath(import.meta.url);
g.__dirname ??= path.dirname(g.__filename);
