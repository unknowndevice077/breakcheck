import type { BreakingChange, ExtractionResult } from '../types.js';

/**
 * JSON Schemas sent to the model. They stay inside the subset that both
 * Anthropic structured outputs and OpenAI strict mode accept: every object has
 * `additionalProperties: false` and lists all properties as required; nullable
 * values use `anyOf` with `null`.
 */
export type JsonSchema = Record<string, unknown>;

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const stringArray = { type: 'array', items: { type: 'string' } };

export const SYMBOL_TYPES = ['export', 'member', 'option', 'cli-flag', 'config-key', 'import-path', 'other'] as const;
export const CHANGE_KINDS = ['removed', 'renamed', 'signature', 'behavior', 'config', 'cli', 'runtime', 'other'] as const;
export const CONFIDENCES = ['high', 'medium', 'low'] as const;

export const extractionSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['breakingChanges'],
  properties: {
    breakingChanges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'summary', 'kind', 'affectedSymbols', 'searchPatterns', 'fileGlobs', 'migration', 'sourceUrl', 'confidence'],
        properties: {
          id: { type: 'string', description: 'kebab-case, unique within this package, e.g. "json-helper-removed"' },
          summary: { type: 'string', description: 'One sentence: what changed and why it breaks code' },
          kind: { type: 'string', enum: [...CHANGE_KINDS] },
          affectedSymbols: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'type'],
              properties: {
                name: { type: 'string', description: 'Exact identifier as written in user code, e.g. "json", "app.del", "--ext", "useFormState"' },
                type: { type: 'string', enum: [...SYMBOL_TYPES] },
              },
            },
          },
          searchPatterns: { ...stringArray, description: 'Literal strings, or /regex/ to find usages in source and config files' },
          fileGlobs: { ...stringArray, description: 'Globs for files whose mere presence means the change applies, e.g. ".eslintrc*"' },
          migration: { ...stringArray, description: 'Ordered, concrete migration steps' },
          sourceUrl: { ...nullableString, description: 'Link to the release note / changelog / guide this came from' },
          confidence: { type: 'string', enum: [...CONFIDENCES] },
        },
      },
    },
  },
};

export const VERDICTS = ['yes', 'no', 'unsure'] as const;

export const verificationSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['hitId', 'affected', 'reason', 'fix'],
        properties: {
          hitId: { type: 'string' },
          affected: { type: 'string', enum: [...VERDICTS] },
          reason: { type: 'string', description: 'One line' },
          fix: {
            anyOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['before', 'after'],
                properties: {
                  before: { type: 'string', description: 'The exact affected line(s) from the snippet, without line numbers' },
                  after: { type: 'string', description: 'The replacement code' },
                },
              },
              { type: 'null' },
            ],
          },
        },
      },
    },
  },
};

export interface VerificationResult {
  results: { hitId: string; affected: (typeof VERDICTS)[number]; reason: string; fix: { before: string; after: string } | null }[];
}

/**
 * Minimal validator for the schema subset above (type, enum, required,
 * properties, items, anyOf, additionalProperties: false). Returns a list of errors.
 */
export function validate(value: unknown, schema: JsonSchema, at = '$'): string[] {
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf as JsonSchema[];
    return branches.some((b) => validate(value, b, at).length === 0) ? [] : [`${at}: does not match any allowed shape`];
  }
  const errs: string[] = [];
  const type = schema.type as string | undefined;
  if (type === 'null') return value === null ? [] : [`${at}: expected null`];
  if (type === 'string') {
    if (typeof value !== 'string') return [`${at}: expected string`];
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return [`${at}: "${value}" is not one of ${schema.enum.join(', ')}`];
    return [];
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return [`${at}: expected array`];
    value.forEach((v, i) => errs.push(...validate(v, schema.items as JsonSchema, `${at}[${i}]`)));
    return errs;
  }
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${at}: expected object`];
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const r of (schema.required ?? []) as string[]) if (!(r in obj)) errs.push(`${at}.${r}: missing`);
    for (const [k, v] of Object.entries(obj)) {
      if (props[k]) errs.push(...validate(v, props[k], `${at}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${at}.${k}: unexpected property`);
    }
    return errs;
  }
  return errs;
}

/** Pull a JSON object out of model text that may be wrapped in prose or ``` fences. */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fenced = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new SyntaxError('no JSON object found in model output');
}

/** Clean up a validated extraction: unique kebab ids, trimmed strings, no empty symbols. */
export function normalizeExtraction(r: ExtractionResult): ExtractionResult {
  const seen = new Set<string>();
  const breakingChanges: BreakingChange[] = [];
  for (const c of r.breakingChanges) {
    let id =
      c.id
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'change';
    for (let n = 2; seen.has(id); n++) id = `${id.replace(/-\d+$/, '')}-${n}`;
    seen.add(id);
    breakingChanges.push({
      ...c,
      id,
      summary: c.summary.trim(),
      affectedSymbols: c.affectedSymbols.filter((s) => s.name.trim()).map((s) => ({ ...s, name: s.name.trim() })),
      searchPatterns: [...new Set(c.searchPatterns.map((p) => p.trim()).filter((p) => p.length >= 2))],
      fileGlobs: [...new Set(c.fileGlobs.map((g) => g.trim()).filter(Boolean))],
      migration: c.migration.map((m) => m.trim()).filter(Boolean),
    });
  }
  return { breakingChanges };
}
