/**
 * What a change waiting in the app's queue means: how it is written as a request, how it is read
 * back, and what it does to the lists the UI shows before the computer has it. Pure functions.
 */
import type {
  Annotation,
  CreateAnnotation,
  DocumentSummary,
  HighlightQuery,
  LibraryAnnotation,
  ProgressUpdate,
  ReadingProgress,
  TreeFolder,
  TreeResponse,
  UpdateAnnotation,
} from "@/api/types";
import type { OutboxEntry } from "./port";

/** The request header that tells the app to keep an answer, and under which tag. */
export const KEEP_HEADER = "x-pager-keep";
/** The tag of the lists and covers the app always keeps. */
export const SHELL_TAG = "shell";
const enc = encodeURIComponent;

/** The tag of everything a downloaded book needs (plain ASCII: it travels in a header). */
export const docTag = (docId: string): string => `doc:${enc(docId)}`;

export const progressKey = (docId: string): string => `progress:${docId}`;
export const createKey = (id: string): string => `create:${id}`;
export const patchKey = (id: string): string => `patch:${id}`;
export const deleteKey = (id: string): string => `delete:${id}`;

export const progressPath = (docId: string): string => `/api/documents/${enc(docId)}/progress`;
export const annotationsPath = (docId: string): string => `/api/documents/${enc(docId)}/annotations`;
export const annotationPath = (id: string): string => `/api/annotations/${enc(id)}`;

/** A reading place saved while the computer couldn't be reached: the place, and when it was. */
export type QueuedProgress = ProgressUpdate & { updatedAt: string };
export type NewAnnotation = CreateAnnotation & { id: string };

/** A queue entry, read back as what it does. */
export type PendingOp =
  | { type: "progress"; seq: number; docId: string; update: QueuedProgress }
  | { type: "create"; seq: number; docId: string; id: string; input: NewAnnotation; at: string; entry: OutboxEntry }
  | { type: "patch"; seq: number; id: string; patch: UpdateAnnotation; at: string }
  | { type: "delete"; seq: number; id: string };

const PROGRESS = /^\/api\/documents\/([^/]+)\/progress$/;
const ANNOTATIONS = /^\/api\/documents\/([^/]+)\/annotations$/;
const ANNOTATION = /^\/api\/annotations\/([^/]+)$/;

function segment(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Null for an entry this version of the page doesn't know how to send. */
export function parseEntry(e: OutboxEntry): PendingOp | null {
  const progress = PROGRESS.exec(e.path);
  if (e.method === "PUT" && progress && isObject(e.body) && typeof e.body.updatedAt === "string") {
    const docId = segment(progress[1]!);
    return docId === null ? null : { type: "progress", seq: e.seq, docId, update: e.body as unknown as QueuedProgress };
  }
  const create = ANNOTATIONS.exec(e.path);
  if (e.method === "POST" && create && isObject(e.body) && typeof e.body.id === "string") {
    const docId = segment(create[1]!);
    return docId === null
      ? null
      : { type: "create", seq: e.seq, docId, id: e.body.id, input: e.body as unknown as NewAnnotation, at: e.at, entry: e };
  }
  const one = ANNOTATION.exec(e.path);
  const id = one ? segment(one[1]!) : null;
  if (id !== null && e.method === "PATCH" && isObject(e.body))
    return { type: "patch", seq: e.seq, id, patch: e.body as UpdateAnnotation, at: e.at };
  if (id !== null && e.method === "DELETE") return { type: "delete", seq: e.seq, id };
  return null;
}

export function pendingOps(outbox: OutboxEntry[]): PendingOp[] {
  return outbox.map(parseEntry).filter((op): op is PendingOp => op !== null);
}

// ---- Annotations ----

/** Client ids make retries idempotent (API.md): 8–64 of [A-Za-z0-9_-]. */
export function newAnnotationId(): string {
  const raw = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `a-${raw.replace(/[^A-Za-z0-9_-]/g, "")}`.slice(0, 64);
}

/** What the reader shows for a new highlight until the computer confirms it. */
export function provisional(docId: string, input: NewAnnotation, at: string = new Date().toISOString()): Annotation {
  const range = input.sectionRange;
  const quote = input.selectedText ?? "";
  return {
    id: input.id,
    docId,
    kind: input.kind ?? (input.body ? "note" : "highlight"),
    color: input.color === undefined ? "yellow" : input.color,
    style: input.style ?? "highlight",
    body: input.body ?? null,
    tags: input.tags ?? [],
    anchor: {
      status: "anchored",
      confidence: 1,
      revisionId: input.revisionId ?? "",
      range: null,
      sectionId: range?.sectionId ?? null,
      segments: range ? [{ sectionId: range.sectionId, start: range.start, end: range.end }] : [],
      position: { start: range?.start ?? 0, end: range?.end ?? 0 },
      quote,
      originalQuote: quote,
    },
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
}

/** The fields of a change that can wait in the queue. Moving an annotation needs the computer. */
export function fieldsOf(patch: UpdateAnnotation): Pick<UpdateAnnotation, "kind" | "color" | "style" | "body" | "tags"> {
  const { reattach: _reattach, acceptAnchor: _accept, ...fields } = patch;
  return fields;
}

/** A new annotation's own fields (not where it is), as a change to one the computer already has. */
export function createdFields(input: CreateAnnotation): UpdateAnnotation {
  const out: UpdateAnnotation = {};
  if (input.kind !== undefined) out.kind = input.kind;
  if (input.color !== undefined) out.color = input.color;
  if (input.style !== undefined) out.style = input.style;
  if (input.body !== undefined) out.body = input.body;
  if (input.tags !== undefined) out.tags = input.tags;
  return out;
}

export function applyPatch<A extends Annotation>(a: A, patch: UpdateAnnotation, at: string): A {
  return { ...a, ...fieldsOf(patch), updatedAt: at };
}

/** A document's annotations with the waiting changes applied: new ones last, as the reader adds them. */
export function overlayAnnotations(list: Annotation[], ops: PendingOp[], docId: string): Annotation[] {
  if (ops.length === 0) return list;
  let out = list;
  const copy = () => (out === list ? (out = [...list]) : out);
  for (const op of ops) {
    if (op.type === "create" && op.docId === docId) {
      if (!out.some((a) => a.id === op.id)) copy().push(provisional(docId, op.input, op.at));
    } else if (op.type === "patch") {
      const i = out.findIndex((a) => a.id === op.id);
      if (i >= 0) copy()[i] = applyPatch(out[i]!, op.patch, op.at);
    } else if (op.type === "delete") {
      if (out.some((a) => a.id === op.id)) out = out.filter((a) => a.id !== op.id);
    }
  }
  return out;
}

function matches(a: LibraryAnnotation, query: HighlightQuery): boolean {
  if (a.kind === "bookmark") return false;
  if (query.docId && a.docId !== query.docId) return false;
  if (query.tag && !a.tags.includes(query.tag)) return false;
  const q = query.q?.trim().toLowerCase();
  if (q && !`${a.anchor.quote}\n${a.body ?? ""}`.toLowerCase().includes(q)) return false;
  return true;
}

/** The Highlights list with the waiting changes applied: new ones first, as the list is newest first. */
export function overlayHighlights(list: LibraryAnnotation[], ops: PendingOp[], query: HighlightQuery = {}): LibraryAnnotation[] {
  if (ops.length === 0) return list;
  let out = list;
  const copy = () => (out === list ? (out = [...list]) : out);
  for (const op of ops) {
    if (op.type === "create") {
      if (out.some((a) => a.id === op.id)) continue;
      const base = provisional(op.docId, op.input, op.at);
      const meta = op.entry.meta;
      const added: LibraryAnnotation = {
        ...base,
        docTitle: meta.docTitle ?? "",
        ...(meta.docAuthor ? { docAuthor: meta.docAuthor } : {}),
        sectionTitle: meta.sectionTitle ?? null,
        href: `/read/${enc(op.docId)}${base.anchor.sectionId ? `/${enc(base.anchor.sectionId)}` : ""}`,
      };
      copy().unshift(added);
    } else if (op.type === "patch") {
      const i = out.findIndex((a) => a.id === op.id);
      if (i >= 0) copy()[i] = applyPatch(out[i]!, op.patch, op.at);
    } else if (op.type === "delete") {
      if (out.some((a) => a.id === op.id)) out = out.filter((a) => a.id !== op.id);
    }
  }
  if (out === list) return list;
  // The computer filtered its own rows; the queued ones (and edited ones) are filtered here.
  const theirs = new Set(list);
  return out.filter((a) => theirs.has(a) || matches(a, query));
}

// ---- Reading places ----

/** The length of a section's text, near enough: its HTML without the tags. */
export function textLength(html: string): number {
  return html.replace(/<[^>]*>/g, "").length;
}

/**
 * How far through the book a place is (0–1), by characters: the text before the section, plus
 * `offset` of the section. The computer works `percent` out the same way when it saves a place, so a
 * place waiting in the queue shows the number it will have. Null when the section isn't in `weights`.
 */
export function percentAt(weights: Array<[string, number]>, sectionId: string, offset: number): number | null {
  const at = weights.findIndex(([id]) => id === sectionId);
  if (at < 0) return null;
  let before = 0;
  let total = 0;
  weights.forEach(([, chars], i) => {
    if (i < at) before += chars;
    total += chars;
  });
  if (total <= 0) return null;
  const within = Math.min(1, Math.max(0, offset));
  return Math.min(1, Math.max(0, (before + weights[at]![1] * within) / total));
}

export function optimisticProgress(docId: string, update: QueuedProgress): ReadingProgress {
  return {
    docId,
    sectionId: update.sectionId,
    offset: update.offset,
    percent: update.percent,
    updatedAt: update.updatedAt,
    ...(update.point ? { point: update.point } : {}),
  };
}

/** The document with a waiting reading place, when that place is newer than the one it carries. */
export function overlayProgress<D extends DocumentSummary>(doc: D, ops: PendingOp[]): D {
  for (const op of ops) {
    if (op.type !== "progress" || op.docId !== doc.id) continue;
    if (doc.progress && doc.progress.updatedAt >= op.update.updatedAt) continue;
    return { ...doc, progress: optimisticProgress(doc.id, op.update), lastOpenedAt: op.update.updatedAt };
  }
  return doc;
}

export function hasProgress(ops: PendingOp[]): boolean {
  return ops.some((op) => op.type === "progress");
}

function overlayFolder(folder: TreeFolder, ops: PendingOp[]): TreeFolder {
  let changed = false;
  const files = folder.files.map((f) => {
    if (!f.doc) return f;
    const doc = overlayProgress(f.doc, ops);
    if (doc === f.doc) return f;
    changed = true;
    return { ...f, doc };
  });
  const folders = folder.folders.map((f) => {
    const next = overlayFolder(f, ops);
    if (next !== f) changed = true;
    return next;
  });
  return changed ? { ...folder, files, folders } : folder;
}

/** The library tree with waiting reading places on its books. */
export function overlayTree(tree: TreeResponse, ops: PendingOp[]): TreeResponse {
  if (!hasProgress(ops)) return tree;
  const root = overlayFolder(tree.root, ops);
  return root === tree.root ? tree : { ...tree, root };
}

/** Opened books, last read first: the order the computer gives `history`. */
export function byLastOpened<D extends DocumentSummary>(docs: D[]): D[] {
  return [...docs].sort((a, b) => (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? ""));
}
