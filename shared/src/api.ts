/**
 * Wire types for the Pager API. The base shapes are the UI's `src/api/types.ts` (CONTRACT.md),
 * copied field for field; everything marked "added" is additive and optional for older clients.
 * See API.md for routes and behaviour.
 *
 * Type-only module: cross-file imports in shared/ must be `import type`.
 */

import type { AnchorStatus, Annotation, BlockPoint } from "./annotation";
import type { DocSection, OutlineEntry } from "./document";

export type DocumentKind = "article" | "book";
export type DocumentFormat = "epub" | "pdf" | "html" | "md" | "txt" | "docx" | (string & {});

export interface ReadingProgress {
  docId: string;
  sectionId: string;
  /** 0–1 scroll position within the section. */
  offset: number;
  /** 0–1 position within the whole document. */
  percent: number;
  updatedAt: string;
  /** Added: the reading place as a block point (top of the viewport), kept attached across edits. */
  point?: BlockPoint;
  /** Added: how well `point` survived the latest edit of the file. */
  anchor?: AnchorStatus;
  /** Added: the paired device that wrote this place; null for the desktop. */
  deviceId?: string | null;
}

export interface DocumentSummary {
  id: string;
  kind: DocumentKind;
  format: DocumentFormat;
  title: string;
  subtitle?: string;
  author?: string;
  sourceId: string;
  sourceName: string;
  coverUrl?: string;
  excerpt?: string;
  wordCount?: number;
  estimatedMinutes?: number;
  sectionCount?: number;
  addedAt: string;
  publishedAt?: string;
  lastOpenedAt?: string;
  saved: boolean;
  progress?: ReadingProgress;
  /** Added: the file's path inside the reads folder (POSIX, no leading slash), when it lives there. */
  relPath?: string;
}

export interface TocEntry {
  /** Section id: pass to getSection. */
  id: string;
  title: string;
  index: number;
  depth: number;
  /** Added: the block the section starts with. */
  blockId?: string;
}

export type PathStatus = "ok" | "missing";

export interface DocumentDetail extends DocumentSummary {
  toc: TocEntry[];
  /** Added: the parsed revision this detail describes. */
  revisionId?: string;
  /** Added: the file is watched; edits arrive as `revision.created` on the stream. */
  live?: boolean;
  /** Added. */
  authors?: string[];
  language?: string;
  /** Added: absolute path on disk (empty for uploads). Local listener only: never sent to a paired device. */
  path?: string;
  pathStatus?: PathStatus;
  /** Added: things the parser could not keep ("2 equations shown as text"). */
  warnings?: string[];
  /** Added: every heading and TOC entry, for navigation inside sections. */
  outline?: OutlineEntry[];
}

export interface Section {
  id: string;
  docId: string;
  index: number;
  title: string;
  /** Sanitised HTML in the vocabulary described in API.md. */
  html: string;
  prevId?: string;
  nextId?: string;
  /** Added: the revision these blocks and offsets belong to. Send it back when anchoring. */
  revisionId?: string;
  /** Added: the structured blocks, with `?include=blocks`. */
  blocks?: DocSection["blocks"];
  notes?: DocSection["notes"];
  /** Added: with `?include=annotations`, this section's live annotations. */
  annotations?: Annotation[];
}

export type SourceKind = "file" | "folder" | "upload";
export type SourceStatus = "ready" | "indexing" | "error";

export interface Source {
  id: string;
  kind: SourceKind;
  path: string;
  name: string;
  documentCount: number;
  addedAt: string;
  status: SourceStatus;
  error?: string;
}

export type IngestStatus = "queued" | "processing" | "done" | "error";

export interface IngestJob {
  id: string;
  status: IngestStatus;
  documentIds: string[];
  error?: string;
}

export type DocumentSort = "recent" | "title" | "added";

export interface DocumentQuery {
  kind?: DocumentKind;
  saved?: boolean;
  history?: boolean;
  sort?: DocumentSort;
  q?: string;
  sourceId?: string;
}

export interface ProgressUpdate {
  sectionId: string;
  offset: number;
  percent: number;
  /** Added: the block at the top of the viewport. Preferred over offset when present. */
  point?: BlockPoint;
  /** Added: the revision `point` refers to. */
  revisionId?: string;
  /** Added: "jump" (TOC, link, search result) is remembered for "go back"; default "read". */
  reason?: "read" | "jump";
  /**
   * Added: when the client was at this place (ISO-8601). If the stored place is newer, nothing is
   * written and the answer is 409 `progress_conflict` with the current place. The UI never sends it.
   */
  updatedAt?: string;
}

export interface DocumentPatch {
  saved?: boolean;
  /** Added: override what the file says. null restores the file's value. */
  title?: string | null;
  author?: string | null;
}

export interface AddSourceResult {
  source: Source;
  job: IngestJob;
}

export interface ApiErrorBody {
  error: { code: ErrorCode | (string & {}); message: string };
}

/** 409 `progress_conflict`: the stored place is newer than the one sent; nothing was written. */
export interface ProgressConflictBody extends ApiErrorBody {
  progress: ReadingProgress;
}

export type ErrorCode =
  | "not_found"
  | "invalid_request"
  | "unsupported"
  | "unauthorized"
  | "forbidden"
  | "too_large"
  | "not_epub"
  | "drm_protected"
  | "empty_document"
  | "source_missing"
  | "gone"
  | "stale_revision"
  | "selection_mismatch"
  | "progress_conflict"
  | "conflict"
  | "internal";

export interface Health {
  app: "pager";
  apiVersion: 1;
  version: string;
  /** Local listener only (so are port, dataDir, readsDir and startedAt). */
  pid?: number;
  port?: number;
  dataDir?: string;
  startedAt?: string;
  /** Added: the folder the library lives in. */
  readsDir?: string;
  /**
   * Added. On the remote listener: the paired device asking (null when the request carries no valid
   * credential); over iroh also this computer's endpoint ID and the relay carrying it, so the phone
   * can refresh its ticket. On the local listener: the tailnet origin to suggest (from `tailscale
   * status`) and, while iroh is on, this computer's ID and relay. A UI is in remote mode when
   * `remote.device` is set.
   */
  remote?: { device?: { id: string; name: string }; suggestedOrigin?: string; endpointId?: string; relay?: string } | null;
}

// ---- Paired devices (the remote listener) ----

export type DeviceStatus = "active" | "revoked" | "expired";

export interface DeviceView {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
  lastIp: string | null;
  /** The phone's iroh endpoint ID when it paired over iroh; null when it paired over Tailscale. */
  endpointId: string | null;
  status: DeviceStatus;
}

/** POST /api/devices/pairing (local listener): the code and QR link to show on the desktop. */
export interface PairingWindow {
  /** XXXX-XXXX. */
  code: string;
  /** `${app.remote.origin}/pair#code=XXXX-XXXX`, for the QR code the Home Screen app scans. */
  url: string;
  /** `pager://pair?v=1&t=<ticket>&code=XXXX-XXXX` for the phone app, present while iroh is on. */
  appUrl?: string;
  expiresAt: string;
}

/** GET /api/devices/pairing (local listener). */
export interface PairingState {
  open: boolean;
  code?: string;
  url?: string;
  appUrl?: string;
  expiresAt?: string;
  /** Wrong codes typed into this window so far (it closes at 5). */
  attempts: number;
  /** A phone waiting for the desktop to allow or deny it; `endpointId` when it asked over iroh. */
  pending: { requestId: string; name: string; ip: string | null; at: string; endpointId?: string } | null;
}

/** POST /api/pair (remote listener). */
export interface PairRequestResult {
  requestId: string;
  pollSecret: string;
}

/** POST /api/pair/poll (remote listener): 202 while pending, then 200 once with the credential. */
export type PairPollResult = { status: "pending" } | { token: string; device: { id: string; name: string } };

// ---- Sync manifest (for the offline mirror) ----

export interface ManifestDocument {
  id: string;
  title: string;
  author?: string;
  format: DocumentFormat;
  relPath?: string;
  revisionId: string;
  /** sha256 of the current revision's file bytes. */
  contentHash: string;
  /** The current revision's file size in bytes. */
  size: number;
  sectionCount: number;
  updatedAt: string;
}

/** GET /api/sync/manifest?after=<seq>. */
export interface SyncManifest {
  /** The journal's latest seq: send it back as `after` next time. */
  cursor: number;
  /** True when this is the whole library (no `after`, or the journal no longer reaches back to it). */
  full: boolean;
  documents: ManifestDocument[];
  deleted: Array<{ id: string; deletedAt: string }>;
}

// ---- The reads folder (the library as files) ----

export interface TreeFile {
  kind: "file";
  name: string;
  /** Path inside the reads folder, POSIX separators, no leading slash. */
  path: string;
  format: string;
  size: number;
  modifiedAt: string;
  docId?: string;
  doc?: DocumentSummary;
  /** Why this file could not be read, when it couldn't. */
  error?: string;
}

export interface TreeFolder {
  kind: "folder";
  name: string;
  /** "" for the root. */
  path: string;
  folders: TreeFolder[];
  files: TreeFile[];
  /** Readable files in this folder and below. */
  fileCount: number;
}

export interface TreeResponse {
  root: TreeFolder;
  /** True when the walk stopped at the file limit. */
  truncated: boolean;
}

export interface CreateFileInput {
  /** Folder path inside the reads folder; "" for the root. */
  dir: string;
  title: string;
  author?: string;
}

export interface CreateFileResult {
  path: string;
  document: DocumentSummary;
}

export interface CreateFolderInput {
  dir: string;
  name: string;
}

export interface MoveEntryInput {
  from: string;
  /** The full new path, including the new name. */
  to: string;
}

export interface MoveEntryResult {
  path: string;
  document?: DocumentSummary;
}

export interface ImportPathInput {
  dir: string;
  /** A path on this machine, outside the reads folder; copied in. */
  path: string;
}

/** GET /search/documents: hits grouped per document, plus title/author/file-name matches. */
export interface DocumentSearchResult {
  doc: DocumentSummary;
  matched: Array<"title" | "author" | "fileName">;
  /** The best few text hits, in rank order. */
  hits: SearchHit[];
  totalHits: number;
}

export interface SearchHit {
  docId: string;
  docTitle: string;
  sectionId: string;
  blockId: string;
  /** Plain-text excerpt around the match. */
  snippet: string;
  /** Match ranges inside `snippet`. */
  ranges: Array<[number, number]>;
  /** Present when the hit is in an annotation rather than the text. */
  annotationId?: string;
}

export interface HistoryEntry {
  at: string;
  type: string;
  sectionId?: string;
  detail?: Record<string, unknown>;
}

export interface ReadingSession {
  docId: string;
  startedAt: string;
  endedAt: string;
  activeMs: number;
  fromPercent: number | null;
  toPercent: number | null;
}

/** GET /api/export, POST /api/import: everything the app keeps, in one portable file. */
export interface PagerExport {
  format: "pager-export";
  version: 1;
  exportedAt: string;
  app: { version: string };
  documents: ExportedDocument[];
  annotations: ExportedAnnotation[];
  records: ExportedRecord[];
  progress: Array<{
    docId: string;
    sectionId: string;
    offset: number;
    percent: number;
    updatedAt: string;
    place: ExportedAnchor | null;
  }>;
  settings: { global: Record<string, unknown>; documents: Record<string, Record<string, unknown>>; app: Record<string, unknown> };
  presets: Array<{ id: string; name: string; values: Record<string, unknown>; createdAt: string; updatedAt: string }>;
}

export interface ExportedDocument {
  id: string;
  title: string;
  authors: string[];
  format: string;
  /** Where the file was (may not exist on another machine). */
  path: string;
  fileName: string;
  /** sha256 of every version of the file Pager has seen: how an import finds the same file again. */
  contentHashes: string[];
  identifier: string | null;
  addedAt: string;
  lastOpenedAt: string | null;
  saved: boolean;
  titleOverride: string | null;
  authorOverride: string | null;
}

/** An anchor without block ids: the words and their context, enough to find the place in any copy. */
export interface ExportedAnchor {
  exact: string;
  prefix: string;
  suffix: string;
  position: { start: number; end: number };
  status: AnchorStatusExport;
  originalQuote: string;
}

type AnchorStatusExport = "anchored" | "moved" | "fuzzy" | "orphaned";

export interface ExportedAnnotation {
  id: string;
  docId: string;
  kind: string;
  color: string | null;
  style: string;
  body: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  anchor: ExportedAnchor;
}

export interface ExportedRecord {
  id: string;
  toolId: string;
  docId: string | null;
  data: unknown;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  anchor: ExportedAnchor | null;
}

export interface ImportResult {
  documents: { matched: number; waiting: number };
  annotations: { added: number; updated: number; unchanged: number };
  records: { added: number; updated: number; unchanged: number };
}
