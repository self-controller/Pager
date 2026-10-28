/**
 * Domain types shared by the web app and the backend. This file and CONTRACT.md describe the
 * same API; if you change one, change the other. All timestamps are ISO-8601 strings (UTC).
 */

import type { AnchorStatus, Annotation, BlockPoint } from "../../shared/src/annotation";
import type { AppSettings } from "../../shared/src/settings";

/**
 * Annotations and journal events are the backend's types (shared/, type-only), used as they are so
 * the two halves cannot drift. See API.md: Anchoring, Annotations, Journal and live stream.
 */
export type {
  AnchorInput,
  AnchorStatus,
  AnchorView,
  Annotation,
  AnnotationKind,
  BlockPoint,
  CreateAnnotation,
  HighlightColor,
  HighlightStyle,
  LibraryAnnotation,
  SectionRange,
  SectionSegment,
  UpdateAnnotation,
} from "../../shared/src/annotation";
export type { JournalEvent, ServerEventPayloads, ServerEventType } from "../../shared/src/events";
/** The reads folder and search: the backend's shapes, used as they are. */
export type {
  CreateFileInput,
  CreateFileResult,
  CreateFolderInput,
  DocumentSearchResult,
  ImportPathInput,
  MoveEntryInput,
  MoveEntryResult,
  SearchHit,
  TreeFile,
  TreeFolder,
  TreeResponse,
} from "../../shared/src/api";
/** The server itself and the phones paired with it (API.md: Security model). Backend only. */
export type {
  DeviceStatus,
  DeviceView,
  Health,
  PairingState,
  PairingWindow,
  PairPollResult,
  PairRequestResult,
} from "../../shared/src/api";
export type { AppSettings };

/** A change to the server's own settings: any of its groups, in part. */
export type AppSettingsPatch = { [K in keyof AppSettings]?: Partial<AppSettings[K]> };

export type DocumentKind = "article" | "book";

/** Known formats. The backend may report others; the UI shows them as an uppercase label. */
export type DocumentFormat = "epub" | "pdf" | "html" | "md" | "txt" | "docx" | (string & {});

export interface ReadingProgress {
  docId: string;
  sectionId: string;
  /** 0–1 scroll position within the section. */
  offset: number;
  /** 0–1 position within the whole document. */
  percent: number;
  updatedAt: string;
  /** The reading place as a block point (top of the viewport), kept attached across file edits. */
  point?: BlockPoint;
  /** How well `point` survived the latest edit of the file. */
  anchor?: AnchorStatus;
  /** The paired device that saved this place; null for the computer. */
  deviceId?: string | null;
}

export interface DocumentSummary {
  id: string;
  kind: DocumentKind;
  format: DocumentFormat;
  title: string;
  subtitle?: string;
  author?: string;
  /** The Source this document was ingested from. */
  sourceId: string;
  /** Display name of the source (folder name, file name, or "Uploads"). */
  sourceName: string;
  coverUrl?: string;
  /** Plain-text preview, about 200 characters. */
  excerpt?: string;
  wordCount?: number;
  estimatedMinutes?: number;
  /** Number of sections (chapters) in reading order. */
  sectionCount?: number;
  addedAt: string;
  /** ISO date, or a bare year ("1847") when that is all the file says. */
  publishedAt?: string;
  /** Set by the backend whenever progress is saved. Drives "History" and "Continue reading". */
  lastOpenedAt?: string;
  saved: boolean;
  progress?: ReadingProgress;
  /** The file's path inside the reads folder (POSIX, no leading slash), when it lives there. */
  relPath?: string;
}

export interface TocEntry {
  /** Section id: pass to getSection. */
  id: string;
  title: string;
  /** Reading order, starting at 0. */
  index: number;
  /** Nesting depth for display, starting at 0. */
  depth: number;
  /** The block the section starts with. */
  blockId?: string;
}

export interface DocumentDetail extends DocumentSummary {
  /** Reading-order sections. An article has exactly one entry. */
  toc: TocEntry[];
}

export interface Section {
  id: string;
  docId: string;
  index: number;
  title: string;
  /** Sanitised HTML for the section body (no <script>, no event handlers). */
  html: string;
  prevId?: string;
  nextId?: string;
  /** The revision these blocks and offsets belong to. Send it back when anchoring. */
  revisionId?: string;
  /** With `?include=annotations`: this section's live annotations. */
  annotations?: Annotation[];
}

export type IngestStatus = "queued" | "processing" | "done" | "error";

export interface IngestJob {
  id: string;
  status: IngestStatus;
  /** Documents created so far (complete when status is "done"). */
  documentIds: string[];
  error?: string;
}

export type DocumentSort = "recent" | "title" | "added";

export interface DocumentQuery {
  kind?: DocumentKind;
  saved?: boolean;
  /** Only documents that have been opened, most recently opened first. */
  history?: boolean;
  sort?: DocumentSort;
  /** Case-insensitive match on title, author and file name. */
  q?: string;
}

export interface ProgressUpdate {
  sectionId: string;
  offset: number;
  percent: number;
  /** The block at the top of the viewport. Preferred over offset when present. */
  point?: BlockPoint;
  /** The revision `point` refers to. */
  revisionId?: string;
  /** "jump" (contents, link, deep link) is remembered for "go back"; default "read". */
  reason?: "read" | "jump";
}

export interface HighlightQuery {
  q?: string;
  tag?: string;
  docId?: string;
}

export interface TagCount {
  tag: string;
  count: number;
}

/** Error envelope returned by the backend: `{ "error": { "code", "message" } }`. */
export interface ApiErrorBody {
  error: { code: string; message: string };
}

export class ApiError extends Error {
  readonly code: string;
  /** HTTP status when the error came from the backend; undefined for network failures. */
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

/** Error codes the UI treats specially. */
export const ErrorCodes = {
  /** Backend could not be reached (network error, proxy 502/504). */
  unavailable: "unavailable",
  notFound: "not_found",
  /** The adapter cannot do this (e.g. the mock cannot read paths on disk). */
  unsupported: "unsupported",
  invalid: "invalid_request",
  /** No valid device credential on the remote listener: pair this phone (the app goes to /pair). */
  unauthorized: "unauthorized",
  /** A pairing code or request that is no longer valid: start again. */
  gone: "gone",
} as const;
