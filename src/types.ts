/** Shared data model. Kept in one place so every stage speaks the same language. */

export type BumpType = 'major' | 'minor' | 'patch';

export interface Bump {
  name: string;
  fromVersion: string;
  toVersion: string;
  bumpType: BumpType;
  /** package.json files (repo-relative) that declare this dependency */
  manifests: string[];
  /** dependencies | devDependencies | optionalDependencies */
  depTypes: string[];
}

export type SymbolType = 'export' | 'member' | 'option' | 'cli-flag' | 'config-key' | 'import-path' | 'other';

export interface AffectedSymbol {
  name: string;
  type: SymbolType;
}

export type ChangeKind = 'removed' | 'renamed' | 'signature' | 'behavior' | 'config' | 'cli' | 'runtime' | 'other';
export type Confidence = 'high' | 'medium' | 'low';

export interface BreakingChange {
  id: string;
  summary: string;
  kind: ChangeKind;
  affectedSymbols: AffectedSymbol[];
  /** Literal strings, or /regex/flags */
  searchPatterns: string[];
  /** Globs whose mere presence means the change applies (e.g. `.eslintrc*`) */
  fileGlobs: string[];
  migration: string[];
  sourceUrl: string | null;
  confidence: Confidence;
}

export interface ExtractionResult {
  breakingChanges: BreakingChange[];
}

export interface ReleaseNoteSource {
  kind: 'release' | 'changelog' | 'migration-guide';
  url: string;
  title: string;
  version?: string;
}

export interface ReleaseNotes {
  repo: { owner: string; repo: string; directory?: string } | null;
  /** Markdown, already truncated to the budget */
  text: string;
  sources: ReleaseNoteSource[];
  /** Links to migration guides found in the notes that we did not fetch */
  migrationLinks: string[];
  truncated: boolean;
  /** Human-readable explanation when nothing was found */
  missingReason?: string;
}

export type HitKind = 'symbol' | 'pattern' | 'file' | 'dynamic';

export interface UsageHit {
  /** Stable id: `${changeId}#${index}` */
  id: string;
  changeId: string;
  file: string;
  line: number;
  kind: HitKind;
  /** What matched, e.g. `json` or `--ext` */
  matched: string;
  /** ±N lines of context, with line numbers */
  snippet: string;
  snippetStartLine: number;
}

export type Verdict = 'yes' | 'no' | 'unsure' | 'possibly';

export interface VerifiedHit extends UsageHit {
  verdict: Verdict;
  reason: string;
  fix: { before: string; after: string } | null;
}

export type Mode = 'ai' | 'rules';

export interface ChangeReport {
  change: BreakingChange;
  hits: VerifiedHit[];
}

export interface PackageReport {
  bump: Bump;
  notes: ReleaseNotes;
  mode: Mode;
  /** provider/model when mode === 'ai' */
  modelLabel?: string;
  /** Why we fell back to rules for this package, if we did */
  fallbackReason?: string;
  changes: ChangeReport[];
  /** Things we could not analyse (dynamic imports, unparsable files, ...) */
  unanalysed: string[];
  fromCache: boolean;
}

export interface RunReport {
  packages: PackageReport[];
  skipped: { name: string; reason: string }[];
  repo: { owner: string; repo: string };
  headSha: string;
  /** Overall mode description, filled by main */
  providerLabel: string | null;
  providerError?: string;
}
