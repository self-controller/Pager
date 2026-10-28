/**
 * The interaction journal: an append-only log of what happened, written by the server in the same
 * transaction as the change it describes, plus whatever the UI chooses to record (POST /api/events).
 * The live stream (GET /api/stream, Server-Sent Events) carries the same events; each SSE `id` is the
 * event's `seq`, so a reconnecting EventSource resumes losslessly with Last-Event-ID.
 *
 * Type-only module: cross-file imports in shared/ must be `import type`.
 */

import type { AnchorStatus } from "./annotation";

export interface JournalEvent<T extends string = string, P = unknown> {
  seq: number;
  at: string;
  origin: "server" | "client";
  type: T;
  /** Payload schema version for this type. */
  v: number;
  docId: string | null;
  /** The annotation/record/source the event is about, when there is one. */
  subjectId: string | null;
  payload: P;
}

/** Event types the server emits, with their payloads. */
export interface ServerEventPayloads {
  "document.added": { title: string; format: string; sourceId: string };
  "document.removed": Record<string, never>;
  "document.updated": { fields: string[] };
  "revision.created": {
    revisionId: string;
    previousRevisionId: string | null;
    reason: "added" | "source-changed" | "parser-upgraded" | "reload" | "import";
    /** Sections whose blocks changed (refetch these). */
    changedSectionIds: string[];
    removedSectionIds: string[];
  };
  "annotation.created": { kind: string };
  "annotation.updated": { fields: string[] };
  "annotation.deleted": Record<string, never>;
  "annotation.restored": Record<string, never>;
  "annotations.reanchored": {
    revisionId: string;
    results: Array<{ id: string; owner: "annotation" | "record" | "progress"; from: AnchorStatus; to: AnchorStatus; confidence: number }>;
  };
  "record.created": { toolId: string };
  "record.updated": { toolId: string };
  "record.deleted": { toolId: string };
  "progress.jumped": { fromSectionId: string | null; toSectionId: string };
  /** The reading place moved to another section, or a different device wrote it (deviceId null: the desktop). */
  "progress.updated": { sectionId: string; percent: number; deviceId: string | null };
  "settings.changed": { scope: string; keys: string[] };
  "source.added": { kind: string; path: string };
  "source.removed": Record<string, never>;
  "source.missing": { path: string };
  "source.restored": { path: string };
  "job.updated": { jobId: string; status: string; documentIds: string[] };
  /** A reading session ended (no progress for 30 minutes). */
  "reading.session": { startedAt: string; endedAt: string; activeMs: number; fromPercent: number | null; toPercent: number | null };
  "document.merged": { intoId: string };
  "import.applied": { annotations: number; records: number };
  /** Something in the reads folder changed: a file or folder made, moved, trashed, or edited outside Pager. */
  "tree.changed": { reason: "created" | "moved" | "deleted" | "external"; path?: string };
  /** Paired devices (subjectId is the device id). */
  "device.paired": { name: string };
  "device.renamed": { name: string };
  "device.revoked": { name: string };
  /** A revoked or expired device was taken off the list. */
  "device.removed": { name: string };
}

export type ServerEventType = keyof ServerEventPayloads;

/**
 * What the UI may record. `type` matches ^[a-z]+(\.[a-z0-9_]+)+$ and must not start with a server
 * event's namespace. Suggested: nav.section_opened, nav.link_followed, nav.footnote_opened,
 * nav.toc_used, lookup.word, search.query, copy.text, session.heartbeat.
 */
export interface ClientEventInput {
  type: string;
  /** Defaults to the server's time of receipt. */
  at?: string;
  docId?: string;
  subjectId?: string;
  /** ≤ 4 KB as JSON. */
  payload?: Record<string, unknown>;
}

export interface PostEventsResult {
  /** Events written. Fewer than sent when a recording category is switched off. */
  accepted: number;
  /** Highest seq written, if any. */
  lastSeq: number | null;
}
