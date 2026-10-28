import type { PagerApi } from "./client";
import type { SettingsResponse } from "../../shared/src/settings";
import {
  ApiError,
  ErrorCodes,
  type Annotation,
  type ApiErrorBody,
  type AppSettings,
  type CreateFileResult,
  type DocumentDetail,
  type DocumentQuery,
  type DocumentSearchResult,
  type DeviceView,
  type DocumentSummary,
  type Health,
  type HighlightQuery,
  type IngestJob,
  type JournalEvent,
  type LibraryAnnotation,
  type MoveEntryResult,
  type PairingState,
  type PairingWindow,
  type PairPollResult,
  type PairRequestResult,
  type ReadingProgress,
  type Section,
  type ServerEventType,
  type TagCount,
  type TreeResponse,
} from "./types";

/**
 * Every server event type. Typed as a record so the compiler flags any type added to (or removed
 * from) shared/src/events.ts; named SSE events only reach listeners registered by name.
 */
const SERVER_EVENTS: Record<ServerEventType, true> = {
  "document.added": true,
  "document.removed": true,
  "document.updated": true,
  "revision.created": true,
  "annotation.created": true,
  "annotation.updated": true,
  "annotation.deleted": true,
  "annotation.restored": true,
  "annotations.reanchored": true,
  "record.created": true,
  "record.updated": true,
  "record.deleted": true,
  "progress.jumped": true,
  "progress.updated": true,
  "settings.changed": true,
  "source.added": true,
  "source.removed": true,
  "source.missing": true,
  "source.restored": true,
  "job.updated": true,
  "reading.session": true,
  "document.merged": true,
  "import.applied": true,
  "tree.changed": true,
  "device.paired": true,
  "device.renamed": true,
  "device.revoked": true,
  "device.removed": true,
};
export const SERVER_EVENT_TYPES = Object.keys(SERVER_EVENTS) as ServerEventType[];

export function highlightQueryString(query: HighlightQuery = {}): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.tag) params.set("tag", query.tag);
  if (query.docId) params.set("docId", query.docId);
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** URL for (re)opening the stream; `after` resumes from the last event seen (API.md). */
export function streamUrl(base: string, lastSeq: string | null): string {
  return `${base}/stream${lastSeq ? `?after=${encodeURIComponent(lastSeq)}` : ""}`;
}

/**
 * Follows GET /stream while the tab is visible. The stream is closed while hidden (browsers allow
 * only six connections per origin) and reopened from the last seq, so no event is lost. A stream
 * the browser gives up on (readyState CLOSED: the server refused it, as it does a phone that isn't
 * paired or was revoked) stays closed; pairing reloads the app, which opens a new one.
 */
export function followStream(
  base: string,
  onEvent: (event: JournalEvent) => void,
  EventSourceImpl: typeof EventSource | undefined = globalThis.EventSource,
): () => void {
  if (!EventSourceImpl || typeof document === "undefined") return () => {};
  let source: EventSource | null = null;
  let lastSeq: string | null = null;
  let stopped = false;

  const handle = (e: MessageEvent<string>) => {
    if (e.lastEventId) lastSeq = e.lastEventId;
    try {
      onEvent(JSON.parse(e.data) as JournalEvent);
    } catch {
      // A malformed event is skipped; the next one carries on.
    }
  };
  const open = () => {
    if (source || stopped) return;
    const es = new EventSourceImpl(streamUrl(base, lastSeq));
    source = es;
    for (const type of SERVER_EVENT_TYPES) es.addEventListener(type, handle as EventListener);
    es.onmessage = handle;
    es.onerror = () => {
      // CONNECTING (0) means the browser is retrying by itself; CLOSED (2) means it won't.
      if (es.readyState !== 2) return;
      stopped = true;
      close();
    };
  };
  const close = () => {
    source?.close();
    source = null;
  };
  const onVisibility = () => (document.visibilityState === "hidden" ? close() : open());

  if (document.visibilityState !== "hidden") open();
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    stopped = true;
    close();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/** Builds the query string for GET /api/documents. Undefined values are left out. */
export function documentQueryString(query: DocumentQuery = {}): string {
  const params = new URLSearchParams();
  if (query.kind) params.set("kind", query.kind);
  if (query.saved !== undefined) params.set("saved", String(query.saved));
  if (query.history) params.set("history", "true");
  if (query.sort) params.set("sort", query.sort);
  if (query.q) params.set("q", query.q);
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** REST client for the backend described in CONTRACT.md. Always calls the relative /api path. */
export function createHttpApi(base = "/api", fetchImpl: typeof fetch = fetch.bind(globalThis)): PagerApi {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      });
    } catch {
      throw new ApiError(ErrorCodes.unavailable, "The reading service isn't reachable right now.");
    }

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    let body: unknown = undefined;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
    }

    if (!res.ok) {
      const err = (body as ApiErrorBody | undefined)?.error;
      if (err) throw new ApiError(err.code, err.message, res.status);
      // The Vite proxy answers 502/504 (or 500 with no JSON) when the backend is down.
      if (res.status >= 500) {
        throw new ApiError(ErrorCodes.unavailable, "The reading service isn't reachable right now.", res.status);
      }
      throw new ApiError(res.status === 404 ? ErrorCodes.notFound : "http_error", res.statusText, res.status);
    }
    return body as T;
  }

  const json = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data) });
  const enc = encodeURIComponent;

  return {
    mode: "http",
    listDocuments: (query) => request<DocumentSummary[]>(`/documents${documentQueryString(query)}`),
    getDocument: (id) => request<DocumentDetail>(`/documents/${enc(id)}`),
    getSection: (docId, sectionId) => request<Section>(`/documents/${enc(docId)}/sections/${enc(sectionId)}`),
    updateDocument: (id, patch) => request<DocumentSummary>(`/documents/${enc(id)}`, json("PATCH", patch)),
    deleteDocument: (id) => request<void>(`/documents/${enc(id)}`, { method: "DELETE" }),
    saveProgress: (id, update) => request<ReadingProgress>(`/documents/${enc(id)}/progress`, json("PUT", update)),
    getTree: () => request<TreeResponse>(`/tree`),
    createFile: (input) => request<CreateFileResult>(`/files`, json("POST", input)),
    createFolder: (dir, name) => request<{ path: string }>(`/folders`, json("POST", { dir, name })),
    moveEntry: (from, to) => request<MoveEntryResult>(`/files/move`, json("POST", { from, to })),
    deleteEntry: (path) => request<void>(`/files?path=${enc(path)}`, { method: "DELETE" }),
    importPath: (dir, path) => request<IngestJob>(`/files/import`, json("POST", { dir, path })),
    uploadFile: (file, dir) => {
      const form = new FormData();
      form.append("file", file, file.name);
      return request<IngestJob>(`/uploads${dir ? `?dir=${enc(dir)}` : ""}`, { method: "POST", body: form });
    },
    getJob: (id) => request<IngestJob>(`/jobs/${enc(id)}`),
    searchDocuments: (q) => request<DocumentSearchResult[]>(`/search/documents?q=${enc(q)}`),
    listAnnotations: (docId) => request<Annotation[]>(`/documents/${enc(docId)}/annotations`),
    createAnnotation: (docId, input) => request<Annotation>(`/documents/${enc(docId)}/annotations`, json("POST", input)),
    updateAnnotation: (id, patch) => request<Annotation>(`/annotations/${enc(id)}`, json("PATCH", patch)),
    deleteAnnotation: (id) => request<void>(`/annotations/${enc(id)}`, { method: "DELETE" }),
    restoreAnnotation: (id) => request<Annotation>(`/annotations/${enc(id)}/restore`, { method: "POST" }),
    listHighlights: (query) => request<LibraryAnnotation[]>(`/highlights${highlightQueryString(query)}`),
    listTags: () => request<TagCount[]>(`/tags`),
    subscribe: (onEvent) => followStream(base, onEvent),
    getHealth: () => request<Health>(`/health`),
    getAppSettings: async () => {
      const s = await request<SettingsResponse>(`/settings`);
      if (!s.app) throw new ApiError("forbidden", "The server's settings can only be changed on the computer itself.", 403);
      return s.app;
    },
    updateAppSettings: async (patch) => (await request<SettingsResponse>(`/settings/app`, json("PATCH", patch))).app as AppSettings,
    openPairing: () => request<PairingWindow>(`/devices/pairing`, { method: "POST" }),
    getPairing: () => request<PairingState>(`/devices/pairing`),
    approvePairing: (requestId) => request<DeviceView>(`/devices/pairing/approve`, json("POST", { requestId })),
    denyPairing: (requestId) => request<void>(`/devices/pairing/deny`, json("POST", { requestId })),
    cancelPairing: () => request<void>(`/devices/pairing`, { method: "DELETE" }),
    listDevices: () => request<DeviceView[]>(`/devices`),
    renameDevice: (id, name) => request<DeviceView>(`/devices/${enc(id)}`, json("PATCH", { name })),
    revokeDevice: (id) => request<void>(`/devices/${enc(id)}`, { method: "DELETE" }),
    requestPairing: (code, name) => request<PairRequestResult>(`/pair`, json("POST", { code, name })),
    pollPairing: (r) => request<PairPollResult>(`/pair/poll`, json("POST", { requestId: r.requestId, pollSecret: r.pollSecret })),
  };
}
