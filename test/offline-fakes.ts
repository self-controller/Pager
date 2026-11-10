import type { PagerApi } from "@/api/client";
import {
  ApiError,
  ErrorCodes,
  type Annotation,
  type CreateAnnotation,
  type DocumentDetail,
  type DocumentSummary,
  type LibraryAnnotation,
  type ReadingProgress,
  type Section,
  type SyncManifest,
  type TreeResponse,
} from "@/api/types";
import { provisional, type NewAnnotation } from "@/offline/ops";

export const T0 = "2026-11-10T10:00:00.000Z";

/** A clock that moves a second on each reading. */
export function clock(start = T0): () => string {
  let t = new Date(start).getTime();
  return () => {
    const now = new Date(t).toISOString();
    t += 1000;
    return now;
  };
}

export function book(id: string, title: string, sections = 2, extra: Partial<DocumentDetail> = {}): DocumentDetail {
  return {
    id,
    kind: "book",
    format: "epub",
    title,
    author: "An Author",
    sourceId: "s",
    sourceName: "reads",
    addedAt: "2026-11-01T00:00:00.000Z",
    saved: false,
    toc: Array.from({ length: sections }, (_, i) => ({ id: `${id}-s${i}`, title: `Chapter ${i + 1}`, index: i, depth: 0 })),
    ...extra,
  };
}

export function highlight(id: string, docId: string, quote: string, extra: Partial<Annotation> = {}): Annotation {
  return {
    ...provisional(
      docId,
      { id, sectionRange: { sectionId: `${docId}-s0`, start: 0, end: quote.length }, selectedText: quote },
      "2026-11-02T00:00:00.000Z",
    ),
    ...extra,
  };
}

export interface FakeBackend {
  api: PagerApi;
  /** Every call that reached the backend, as "name arg". */
  calls: string[];
  /** False: every call fails as `unavailable`, as when the computer can't be reached. */
  up: boolean;
  /** A call that fails with this error once reached, by its "name arg". */
  fail: Map<string, ApiError>;
  docs: Map<string, DocumentDetail>;
  revisions: Map<string, string>;
  html: Map<string, string>;
  annotations: Map<string, Annotation[]>;
  /** Annotations the backend has, with the payload each was made from. */
  made: Map<string, string>;
}

export function unavailable(): ApiError {
  return new ApiError(ErrorCodes.unavailable, "The reading service isn't reachable right now.", 503);
}

function summary(d: DocumentDetail): DocumentSummary {
  const { toc: _toc, ...rest } = d;
  return rest;
}

/** A small backend that follows API.md where the copy leans on it: idempotent ids, the newer place wins. */
export function fakeBackend(docs: DocumentDetail[] = [book("a", "Persuasion"), book("b", "Emma")]): FakeBackend {
  const b: FakeBackend = {
    api: undefined as unknown as PagerApi,
    calls: [],
    up: true,
    fail: new Map(),
    docs: new Map(docs.map((d) => [d.id, d])),
    revisions: new Map(docs.map((d) => [d.id, "r1"])),
    html: new Map(),
    annotations: new Map(),
    made: new Map(),
  };
  const reach = (call: string) => {
    if (!b.up) throw unavailable();
    b.calls.push(call);
    const failure = b.fail.get(call);
    if (failure) throw failure;
  };
  const doc = (id: string): DocumentDetail => {
    const d = b.docs.get(id);
    if (!d) throw new ApiError(ErrorCodes.notFound, "No such document.", 404);
    return d;
  };
  const find = (id: string): { list: Annotation[]; i: number } => {
    for (const list of b.annotations.values()) {
      const i = list.findIndex((a) => a.id === id);
      if (i >= 0) return { list, i };
    }
    throw new ApiError(ErrorCodes.notFound, "No such annotation.", 404);
  };
  const implemented: Partial<PagerApi> = {
    mode: "http",
    getDocument: async (id) => {
      reach(`getDocument ${id}`);
      return doc(id);
    },
    getSection: async (docId, sectionId): Promise<Section> => {
      reach(`getSection ${sectionId}`);
      const d = doc(docId);
      const entry = d.toc.find((t) => t.id === sectionId);
      if (!entry) throw new ApiError(ErrorCodes.notFound, "No such section.", 404);
      return {
        id: sectionId,
        docId,
        index: entry.index,
        title: entry.title,
        html: b.html.get(sectionId) ?? `<p>${entry.title}</p>`,
        revisionId: b.revisions.get(docId),
      };
    },
    listDocuments: async (query) => {
      reach(`listDocuments${query?.history ? " history" : ""}`);
      const all = [...b.docs.values()].map(summary);
      if (!query?.history) return all;
      return all.filter((d) => d.lastOpenedAt).sort((x, y) => (y.lastOpenedAt ?? "").localeCompare(x.lastOpenedAt ?? ""));
    },
    getTree: async (): Promise<TreeResponse> => {
      reach("getTree");
      const files = [...b.docs.values()].map((d) => ({
        kind: "file" as const,
        name: `${d.title}.epub`,
        path: `${d.title}.epub`,
        format: "epub",
        size: 1,
        modifiedAt: T0,
        docId: d.id,
        doc: summary(d),
      }));
      return { root: { kind: "folder", name: "", path: "", folders: [], files, fileCount: files.length }, truncated: false };
    },
    saveProgress: async (id, update): Promise<ReadingProgress> => {
      reach(`saveProgress ${id}`);
      const d = doc(id);
      const at = (update as { updatedAt?: string }).updatedAt ?? "2026-11-10T12:00:00.000Z";
      if (d.progress && (update as { updatedAt?: string }).updatedAt && d.progress.updatedAt > at) {
        throw new ApiError("progress_conflict", "A newer reading place was saved for this book, so this one was not.", 409);
      }
      const progress: ReadingProgress = {
        docId: id,
        sectionId: update.sectionId,
        offset: update.offset,
        percent: update.percent,
        updatedAt: at,
      };
      b.docs.set(id, { ...d, progress, lastOpenedAt: at });
      return progress;
    },
    listAnnotations: async (docId) => {
      reach(`listAnnotations ${docId}`);
      return [...(b.annotations.get(docId) ?? [])];
    },
    listHighlights: async (): Promise<LibraryAnnotation[]> => {
      reach("listHighlights");
      return [...b.annotations.entries()].flatMap(([docId, list]) =>
        list.map((a) => ({ ...a, docTitle: b.docs.get(docId)?.title ?? "", sectionTitle: null, href: `/read/${docId}` })),
      );
    },
    createAnnotation: async (docId, input: CreateAnnotation) => {
      reach(`createAnnotation ${input.id}`);
      doc(docId);
      const payload = JSON.stringify(input);
      const id = input.id!;
      if (b.made.has(id)) {
        if (b.made.get(id) !== payload) throw new ApiError("conflict", "An annotation with that id already exists.", 409);
        return find(id).list[find(id).i]!;
      }
      const made = provisional(docId, input as NewAnnotation, "2026-11-10T12:00:00.000Z");
      b.made.set(id, payload);
      b.annotations.set(docId, [...(b.annotations.get(docId) ?? []), made]);
      return made;
    },
    updateAnnotation: async (id, patch) => {
      reach(`updateAnnotation ${id}`);
      const { list, i } = find(id);
      list[i] = { ...list[i]!, ...patch } as Annotation;
      return list[i]!;
    },
    deleteAnnotation: async (id) => {
      reach(`deleteAnnotation ${id}`);
      const { list, i } = find(id);
      list.splice(i, 1);
    },
    restoreAnnotation: async (id) => {
      reach(`restoreAnnotation ${id}`);
      throw new ApiError(ErrorCodes.notFound, `No such annotation ${id}.`, 404);
    },
    listTags: async () => {
      reach("listTags");
      return [];
    },
    getHealth: async () => {
      reach("getHealth");
      return { app: "pager", apiVersion: 1, version: "0" };
    },
    listContextBriefings: async () => {
      reach("listContextBriefings");
      return { briefings: [] } as never;
    },
    getSyncManifest: async (): Promise<SyncManifest> => {
      reach("getSyncManifest");
      return {
        cursor: 1,
        full: true,
        deleted: [],
        documents: [...b.docs.values()].map((d) => ({
          id: d.id,
          title: d.title,
          format: d.format,
          revisionId: b.revisions.get(d.id) ?? "r1",
          contentHash: "h",
          size: 1,
          sectionCount: d.toc.length,
          updatedAt: T0,
        })),
      };
    },
    subscribe: () => () => {},
  };
  b.api = new Proxy(implemented, {
    get(target, name) {
      if (name in target) return target[name as keyof PagerApi];
      return async () => {
        throw new ApiError(ErrorCodes.unsupported, `The fake backend has no ${String(name)}.`);
      };
    },
  }) as PagerApi;
  return b;
}
