/**
 * Context: a sourced background briefing for a book (prompts/book-context.md, API.md "Context").
 * The same shape as server/src/briefing/schema.rs. Every claim carries 1–3 citations the server
 * checked: a page whose quote was found on it, or a catalogue record that resolved.
 *
 * Type-only module: cross-file imports in shared/ must be `import type`.
 */

/** Who the briefing is written for. */
export type ContextLevel = "general" | "student" | "scholar";

export type ContextSectionKind = "overview" | "moment" | "conversation" | "readFirst" | "terms" | "furtherReading";

export type ContextTier = "essential" | "helpful" | "optional";

export type ContextReadScope = "whole" | "part" | "summary";

export type ContextRecordKind = "isbn" | "olid" | "doi" | "wikidata" | "url";

export interface ContextRecord {
  kind: ContextRecordKind;
  value: string;
}

export interface ContextCitation {
  /** `page`: a web page, with a quote found on it. `record`: a catalogue record. */
  kind: "page" | "record";
  url: string | null;
  title: string;
  author: string | null;
  year: string | null;
  quote: string | null;
  record: ContextRecord | null;
  /** How the server confirmed it. */
  check?: "quoted" | "record";
}

export interface ContextClaim {
  text: string;
  /** Drawn from the sources rather than stated by them: show a mark. */
  inferred: boolean;
  /** Hide behind a "contains spoilers" fold. */
  spoiler: boolean;
  citations: ContextCitation[];
}

export interface ContextWork {
  title: string;
  authors: string[];
  year: string | null;
  record: ContextRecord;
  /** The record's page (Open Library, doi.org, Wikidata, or the page itself). */
  resolvedUrl?: string;
}

export interface ContextDisagreement {
  summary: string;
  sides: { position: string; claims: ContextClaim[] }[];
}

export interface ContextItem {
  heading: string;
  /** The author's conversation: "replies to", "borrows from", "satirises", … */
  relation?: string;
  work?: ContextWork;
  tier?: ContextTier;
  readScope?: ContextReadScope;
  /** What exactly to read: "Chapters 1–3", "a summary is enough". */
  readNote?: string;
  timeEstimate?: string;
  /** Further reading: who it suits. */
  suits?: string;
  spoiler: boolean;
  claims: ContextClaim[];
  disagreement?: ContextDisagreement;
}

export interface ContextSection {
  kind: ContextSectionKind;
  items: ContextItem[];
}

export interface ContextStats {
  claimsKept: number;
  claimsDropped: number;
  worksKept: number;
  worksDropped: number;
  apiCalls: number;
  searches: number;
  fetches: number;
  lookups: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  /** An estimate at the model's list prices. */
  costUsd: number;
  durationMs: number;
}

export interface ContextBriefing {
  version: number;
  docId: string;
  level: ContextLevel;
  focus: string | null;
  /** The file version (sha256) it was made for. */
  contentHash: string;
  generatedAt: string;
  model: string;
  /** Show "Not much is known about this book's context." */
  littleKnown: boolean;
  /** In display order; sections with nothing verified are left out. */
  sections: ContextSection[];
  stats: ContextStats;
}

export interface ContextRun {
  id: string;
  docId: string;
  level: ContextLevel;
  status: "running" | "done" | "failed";
  stage: "queued" | "reading" | "researching" | "checking" | "done" | "failed";
  /** Failed runs: a calm sentence to show as is. */
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

/** GET /api/tools/context/status */
export interface ContextStatus {
  /** False when no API key is set on the computer: show the setup steps, make no calls. */
  ready: boolean;
  model: string;
  keyFile: string;
  keyVariable: string;
}

/** GET /api/tools/context/briefings/:docId?level= */
export interface ContextState {
  briefing: ContextBriefing | null;
  /** The briefing was made for an earlier version of the file (shown with just its date). */
  stale: boolean;
  /** A run in progress for this book and level. */
  run: ContextRun | null;
  cachedLevels: ContextLevel[];
}

/** POST /api/tools/context/briefings/:docId body. */
export interface StartContextInput {
  level?: ContextLevel;
  /** Make a new briefing even when one is cached. */
  refresh?: boolean;
}

/** POST answer: 200 with `briefing` (from the cache), or 202 with `run`. */
export interface StartContextResult {
  briefing: ContextBriefing | null;
  run: ContextRun | null;
}
