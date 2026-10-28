import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "./index";
import type {
  Annotation,
  AppSettingsPatch,
  CreateAnnotation,
  CreateFileInput,
  DocumentQuery,
  DocumentSummary,
  HighlightQuery,
  IngestJob,
  JournalEvent,
  LibraryAnnotation,
  ProgressUpdate,
  ServerEventPayloads,
  UpdateAnnotation,
} from "./types";

export const queryKeys = {
  documents: (query: DocumentQuery = {}) => ["documents", query] as const,
  allDocuments: ["documents"] as const,
  document: (id: string) => ["document", id] as const,
  section: (docId: string, sectionId: string) => ["section", docId, sectionId] as const,
  tree: ["tree"] as const,
  search: (q: string) => ["search", q] as const,
  job: (id: string) => ["job", id] as const,
  health: ["health"] as const,
  appSettings: ["appSettings"] as const,
  devices: ["devices"] as const,
  pairing: ["pairing"] as const,
};

/** The library changed shape: documents and the folder tree both show it. */
function invalidateLibrary(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: queryKeys.allDocuments });
  void qc.invalidateQueries({ queryKey: queryKeys.tree });
  void qc.invalidateQueries({ queryKey: ["search"] });
}

export function useDocuments(query: DocumentQuery = {}) {
  return useQuery({ queryKey: queryKeys.documents(query), queryFn: () => api.listDocuments(query) });
}

export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.document(id ?? ""),
    queryFn: () => api.getDocument(id!),
    enabled: Boolean(id),
  });
}

export function useSection(docId: string | undefined, sectionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.section(docId ?? "", sectionId ?? ""),
    queryFn: () => api.getSection(docId!, sectionId!),
    enabled: Boolean(docId && sectionId),
    staleTime: Infinity,
  });
}

/** The reads folder as a tree, with each file's document. */
export function useTree() {
  return useQuery({ queryKey: queryKeys.tree, queryFn: () => api.getTree() });
}

/** Search across every file; off until there are two characters to look for. */
export function useSearchDocuments(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: queryKeys.search(query),
    queryFn: () => api.searchDocuments(query),
    enabled: query.length >= 2,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
}

/** Polls a job every second until it is done or failed, then refreshes the library. */
export function useJob(id: string | undefined, initial?: IngestJob) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: queryKeys.job(id ?? ""),
    queryFn: async () => {
      const job = await api.getJob(id!);
      if (job.status === "done" || job.status === "error") invalidateLibrary(qc);
      return job;
    },
    enabled: Boolean(id) && initial?.status !== "done" && initial?.status !== "error",
    initialData: initial,
    refetchInterval: (q) => (q.state.data?.status === "done" || q.state.data?.status === "error" ? false : 1000),
  });
}

export function useToggleSaved() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, saved }: { id: string; saved: boolean }) => api.updateDocument(id, { saved }),
    onMutate: async ({ id, saved }) => {
      // Flip the bookmark immediately everywhere it is shown.
      qc.setQueriesData<DocumentSummary[]>({ queryKey: queryKeys.allDocuments }, (list) =>
        list?.map((d) => (d.id === id ? { ...d, saved } : d)),
      );
      qc.setQueryData(queryKeys.document(id), (d: DocumentSummary | undefined) => (d ? { ...d, saved } : d));
    },
    onSettled: (_data, _err, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.allDocuments });
      void qc.invalidateQueries({ queryKey: queryKeys.document(id) });
    },
  });
}

export function useSaveProgress(docId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (update: ProgressUpdate) => api.saveProgress(docId!, update),
    onSuccess: (progress) => {
      qc.setQueryData(queryKeys.document(progress.docId), (d: DocumentSummary | undefined) =>
        d ? { ...d, progress, lastOpenedAt: progress.updatedAt } : d,
      );
      void qc.invalidateQueries({ queryKey: queryKeys.allDocuments });
    },
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteDocument(id),
    onSuccess: () => invalidateLibrary(qc),
  });
}

export function useCreateFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFileInput) => api.createFile(input),
    onSuccess: () => invalidateLibrary(qc),
  });
}

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dir, name }: { dir: string; name: string }) => api.createFolder(dir, name),
    onSuccess: () => invalidateLibrary(qc),
  });
}

export function useMoveEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => api.moveEntry(from, to),
    onSuccess: (result) => {
      if (result.document) void qc.invalidateQueries({ queryKey: queryKeys.document(result.document.id) });
      invalidateLibrary(qc);
    },
  });
}

export function useDeleteEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.deleteEntry(path),
    onSuccess: () => invalidateLibrary(qc),
  });
}

/** Copy a file or folder from a path on this machine into `dir`. */
export function useImportPath(dir: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.importPath(dir, path),
    onSuccess: () => invalidateLibrary(qc),
  });
}

/** Upload a picked or dropped file into `dir`. */
export function useUploadFile(dir: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.uploadFile(file, dir),
    onSuccess: (job) => {
      if (job.status === "done") invalidateLibrary(qc);
    },
  });
}

// ---- Annotations (highlights and notes) ----

export const annotationKeys = {
  forDoc: (docId: string) => ["annotations", docId] as const,
  highlights: (query: HighlightQuery = {}) => ["highlights", query] as const,
  allHighlights: ["highlights"] as const,
  tags: ["tags"] as const,
};

function invalidateAnnotations(qc: QueryClient, docId: string) {
  void qc.invalidateQueries({ queryKey: annotationKeys.forDoc(docId) });
  void qc.invalidateQueries({ queryKey: annotationKeys.allHighlights });
  void qc.invalidateQueries({ queryKey: annotationKeys.tags });
}

/** A document's live annotations, in reading order. */
export function useAnnotations(docId: string | undefined) {
  return useQuery({
    queryKey: annotationKeys.forDoc(docId ?? ""),
    queryFn: () => api.listAnnotations(docId!),
    enabled: Boolean(docId),
  });
}

export function useHighlights(query: HighlightQuery = {}) {
  return useQuery({ queryKey: annotationKeys.highlights(query), queryFn: () => api.listHighlights(query) });
}

export function useTags() {
  return useQuery({ queryKey: annotationKeys.tags, queryFn: () => api.listTags() });
}

/** What the reader shows while the server confirms a new highlight. */
function provisional(docId: string, input: CreateAnnotation & { id: string }): Annotation {
  const at = new Date().toISOString();
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

/** Client ids make retries idempotent (API.md): 8–64 of [A-Za-z0-9_-]. */
export function newAnnotationId(): string {
  const raw = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `a-${raw.replace(/[^A-Za-z0-9_-]/g, "")}`.slice(0, 64);
}

export function useCreateAnnotation(docId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAnnotation & { id: string }) => api.createAnnotation(docId!, input),
    onMutate: (input) => {
      qc.setQueryData<Annotation[]>(annotationKeys.forDoc(docId!), (list) => [...(list ?? []), provisional(docId!, input)]);
    },
    onSuccess: (created) => {
      qc.setQueryData<Annotation[]>(annotationKeys.forDoc(docId!), (list) =>
        list?.map((a) => (a.id === created.id ? created : a)),
      );
    },
    onError: (_err, input) => {
      qc.setQueryData<Annotation[]>(annotationKeys.forDoc(docId!), (list) => list?.filter((a) => a.id !== input.id));
    },
    onSettled: () => invalidateAnnotations(qc, docId!),
  });
}

export function useUpdateAnnotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; docId: string; patch: UpdateAnnotation }) => api.updateAnnotation(id, patch),
    onMutate: ({ id, docId, patch }) => {
      const { reattach: _r, acceptAnchor, ...fields } = patch;
      qc.setQueryData<Annotation[]>(annotationKeys.forDoc(docId), (list) =>
        list?.map((a) =>
          a.id === id
            ? { ...a, ...fields, anchor: acceptAnchor ? { ...a.anchor, status: "anchored", confidence: 1 } : a.anchor }
            : a,
        ),
      );
    },
    onSettled: (_d, _e, { docId }) => invalidateAnnotations(qc, docId),
  });
}

export function useDeleteAnnotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; docId: string }) => api.deleteAnnotation(id),
    onMutate: ({ id, docId }) => {
      qc.setQueryData<Annotation[]>(annotationKeys.forDoc(docId), (list) => list?.filter((a) => a.id !== id));
      qc.setQueriesData<LibraryAnnotation[]>({ queryKey: annotationKeys.allHighlights }, (list) =>
        list?.filter((a) => a.id !== id),
      );
    },
    onSettled: (_d, _e, { docId }) => invalidateAnnotations(qc, docId),
  });
}

export function useRestoreAnnotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; docId: string }) => api.restoreAnnotation(id),
    onSettled: (_d, _e, { docId }) => invalidateAnnotations(qc, docId),
  });
}

// ---- Live updates (GET /api/stream) ----

/** Applies one journal event to the query cache: refetch exactly what it says changed. */
export function applyServerEvent(qc: QueryClient, event: JournalEvent): void {
  const docId = event.docId;
  switch (event.type) {
    case "revision.created": {
      const p = event.payload as ServerEventPayloads["revision.created"];
      if (docId) {
        void qc.invalidateQueries({ queryKey: queryKeys.document(docId) });
        for (const sid of [...p.changedSectionIds, ...p.removedSectionIds]) {
          void qc.invalidateQueries({ queryKey: queryKeys.section(docId, sid) });
        }
        invalidateAnnotations(qc, docId);
      }
      void qc.invalidateQueries({ queryKey: queryKeys.allDocuments });
      break;
    }
    case "annotation.created":
    case "annotation.updated":
    case "annotation.deleted":
    case "annotation.restored":
    case "annotations.reanchored":
      if (docId) invalidateAnnotations(qc, docId);
      else void qc.invalidateQueries({ queryKey: annotationKeys.allHighlights });
      break;
    case "progress.updated":
      // The library's progress bars and a book opened next show the new place; an open page stays put.
      if (docId) void qc.invalidateQueries({ queryKey: queryKeys.document(docId) });
      void qc.invalidateQueries({ queryKey: queryKeys.allDocuments });
      break;
    case "device.paired":
    case "device.renamed":
    case "device.revoked":
    case "device.removed":
      void qc.invalidateQueries({ queryKey: queryKeys.devices });
      break;
    case "document.added":
    case "document.removed":
    case "document.updated":
    case "document.merged":
    case "import.applied":
    case "source.added":
    case "source.removed":
    case "source.missing":
    case "source.restored":
    case "job.updated":
    case "tree.changed":
      if (docId) void qc.invalidateQueries({ queryKey: queryKeys.document(docId) });
      invalidateLibrary(qc);
      break;
    default:
      // Jumps, sessions, settings and tool records don't change anything on screen yet.
      break;
  }
}

/** Follows the backend's live stream for the life of the app (no-op in preview mode). */
export function useLiveUpdates(): void {
  const qc = useQueryClient();
  useEffect(() => api.subscribe((event) => applyServerEvent(qc, event)), [qc]);
}

// ---- The server, remote mode, and paired phones ----

/** GET /api/health. On a phone, `remote.device` is set. The mock has no server and answers unsupported. */
export function useHealth() {
  return useQuery({ queryKey: queryKeys.health, queryFn: () => api.getHealth(), staleTime: Infinity, retry: false });
}

/**
 * The paired device this app is running as: an object on a phone, null on the computer, undefined
 * while it isn't known yet. In preview mode (the mock) there is no server, so it is null.
 */
export function useRemoteDevice(): { id: string; name: string } | null | undefined {
  const health = useHealth();
  if (api.mode === "mock") return null;
  if (health.isPending) return undefined;
  return health.data?.remote?.device ?? null;
}

/** Whether this app may add, rename, move and delete files: on the computer, yes; from a phone, never. */
export function useCanChangeFiles(): boolean {
  return useRemoteDevice() === null;
}

export function useAppSettings(enabled = true) {
  return useQuery({ queryKey: queryKeys.appSettings, queryFn: () => api.getAppSettings(), enabled: enabled && api.mode === "http" });
}

export function useUpdateAppSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: AppSettingsPatch) => api.updateAppSettings(patch),
    onSuccess: (app) => qc.setQueryData(queryKeys.appSettings, app),
  });
}

export function useDevices(enabled = true) {
  return useQuery({ queryKey: queryKeys.devices, queryFn: () => api.listDevices(), enabled: enabled && api.mode === "http" });
}

/** The pairing window, polled every 2 s while the pairing dialog is open (it lives in memory, not the journal). */
export function usePairing(open: boolean) {
  return useQuery({ queryKey: queryKeys.pairing, queryFn: () => api.getPairing(), enabled: open, refetchInterval: open ? 2000 : false, staleTime: 0 });
}

function useDeviceMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.pairing });
      void qc.invalidateQueries({ queryKey: queryKeys.devices });
    },
  });
}

export const useOpenPairing = () => useDeviceMutation(() => api.openPairing());
export const useCancelPairing = () => useDeviceMutation(() => api.cancelPairing());
export const useApprovePairing = () => useDeviceMutation((requestId: string) => api.approvePairing(requestId));
export const useDenyPairing = () => useDeviceMutation((requestId: string) => api.denyPairing(requestId));
export const useRenameDevice = () => useDeviceMutation(({ id, name }: { id: string; name: string }) => api.renameDevice(id, name));
export const useRevokeDevice = () => useDeviceMutation((id: string) => api.revokeDevice(id));
