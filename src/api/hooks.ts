import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { api } from "./index";
import { byLastOpened, newAnnotationId, provisional } from "../offline/ops";
import { ApiError, ErrorCodes } from "./types";
import type {
  Annotation,
  AppSettingsPatch,
  ContextLevel,
  ContextRun,
  ContextState,
  StartContextInput,
  CreateAnnotation,
  CreateFileInput,
  DocumentQuery,
  DocumentSummary,
  Health,
  HighlightQuery,
  IngestJob,
  JournalEvent,
  LibraryAnnotation,
  ProgressUpdate,
  ReadingProgress,
  ServerEventPayloads,
  TreeFolder,
  TreeResponse,
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
  contextStatus: ["context", "status"] as const,
  /** `focus`: a "Context for this" briefing ("" for the whole book), compared without case as the server does. */
  contextBriefing: (docId: string, level: ContextLevel, focus?: string | null) =>
    ["context", "briefing", docId, level, (focus ?? "").toLowerCase()] as const,
  contextRun: (runId: string) => ["context", "run", runId] as const,
  contextList: ["context", "list"] as const,
  /** `ids`: sorted, so the same entities share one entry. */
  contextMedia: (ids: readonly string[]) => ["context", "media", ids.join(",")] as const,
};

/**
 * A refresh that failed because the computer couldn't be reached doesn't take away what the page
 * already has: with data in the cache (from memory, or kept from the last launch by src/cache), the
 * answer reads as a success, so pages that show `error` before `data` keep showing the data. Any
 * other failure (not found, unauthorized) is passed on as it is, and so is a failure with no data.
 */
export function keepDataWhenAway<T>(result: UseQueryResult<T>): UseQueryResult<T> {
  if (result.data === undefined || !(result.error instanceof ApiError) || result.error.code !== ErrorCodes.unavailable) return result;
  return { ...result, error: null, isError: false, isRefetchError: false, isLoadingError: false, isSuccess: true, status: "success" } as UseQueryResult<T>;
}

/** The library changed shape: documents and the folder tree both show it. */
function invalidateLibrary(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: queryKeys.allDocuments });
  void qc.invalidateQueries({ queryKey: queryKeys.tree });
  void qc.invalidateQueries({ queryKey: ["search"] });
}

export function useDocuments(query: DocumentQuery = {}) {
  return keepDataWhenAway(useQuery({ queryKey: queryKeys.documents(query), queryFn: () => api.listDocuments(query) }));
}

export function useDocument(id: string | undefined) {
  return keepDataWhenAway(useQuery({
    queryKey: queryKeys.document(id ?? ""),
    queryFn: () => api.getDocument(id!),
    enabled: Boolean(id),
  }));
}

export function useSection(docId: string | undefined, sectionId: string | undefined) {
  return keepDataWhenAway(useQuery({
    queryKey: queryKeys.section(docId ?? "", sectionId ?? ""),
    queryFn: () => api.getSection(docId!, sectionId!),
    enabled: Boolean(docId && sectionId),
    staleTime: Infinity,
  }));
}

/** The reads folder as a tree, with each file's document. */
export function useTree() {
  return keepDataWhenAway(useQuery({ queryKey: queryKeys.tree, queryFn: () => api.getTree() }));
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

/** The document with a place just saved; as it is when it is another book, or already carries a newer place. */
function withProgress<D extends DocumentSummary>(doc: D, progress: ReadingProgress): D {
  if (doc.id !== progress.docId) return doc;
  if (doc.progress && doc.progress.updatedAt > progress.updatedAt) return doc;
  return { ...doc, progress, lastOpenedAt: progress.updatedAt };
}

function folderWithProgress(folder: TreeFolder, progress: ReadingProgress): TreeFolder {
  let changed = false;
  const files = folder.files.map((f) => {
    const doc = f.doc && withProgress(f.doc, progress);
    if (doc === f.doc) return f;
    changed = true;
    return { ...f, doc };
  });
  const folders = folder.folders.map((f) => {
    const next = folderWithProgress(f, progress);
    if (next !== f) changed = true;
    return next;
  });
  return changed ? { ...folder, files, folders } : folder;
}

/**
 * Change cached answers in place, leaving each as fresh or as stale as it was: a patch is not a
 * fetch, so it must not hide that the answer is due (or marked) to be fetched again.
 */
function patchCached<T>(qc: QueryClient, queryKey: readonly unknown[], patch: (data: T, key: readonly unknown[]) => T): void {
  for (const query of qc.getQueryCache().findAll({ queryKey })) {
    const { data, dataUpdatedAt, isInvalidated } = query.state;
    if (data === undefined) continue;
    const next = patch(data as T, query.queryKey);
    if (next === data) continue;
    query.setData(next, { updatedAt: dataUpdatedAt, manual: true });
    if (isInvalidated) query.invalidate();
  }
}

/**
 * A reading place was saved: put it on the cached lists and the Library's tree, so the Library's
 * first frame after reading already has the new order and percentage (the tree isn't fetched again
 * for a saved place). The same rule as the offline copy's overlay (`overlayProgress`): the newer
 * place wins, so a list fetched afterwards says the same.
 */
export function applySavedProgress(qc: QueryClient, progress: ReadingProgress): void {
  patchCached<DocumentSummary[]>(qc, queryKeys.allDocuments, (list, key) => {
    if (!Array.isArray(list)) return list;
    let changed = false;
    const next = list.map((d) => {
      const doc = withProgress(d, progress);
      if (doc !== d) changed = true;
      return doc;
    });
    if (!changed) return list;
    // History is the opened books, last read first: the Book tab opens the first.
    return (key[1] as DocumentQuery | undefined)?.history ? byLastOpened(next) : next;
  });
  patchCached<TreeResponse>(qc, queryKeys.tree, (tree) => {
    const root = folderWithProgress(tree.root, progress);
    return root === tree.root ? tree : { ...tree, root };
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
      applySavedProgress(qc, progress);
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
  return keepDataWhenAway(useQuery({
    queryKey: annotationKeys.forDoc(docId ?? ""),
    queryFn: () => api.listAnnotations(docId!),
    enabled: Boolean(docId),
  }));
}

export function useHighlights(query: HighlightQuery = {}) {
  return keepDataWhenAway(useQuery({ queryKey: annotationKeys.highlights(query), queryFn: () => api.listHighlights(query) }));
}

export function useTags() {
  return keepDataWhenAway(useQuery({ queryKey: annotationKeys.tags, queryFn: () => api.listTags() }));
}

/** Client ids make retries idempotent (API.md): 8–64 of [A-Za-z0-9_-]. */
export { newAnnotationId };

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

/**
 * GET /api/health. On a phone, `remote.device` is set. The mock has no server and answers unsupported.
 * `poll` gives a refetch interval from the latest answer, for something still on its way (iroh
 * starting); false stops polling.
 */
export function useHealth(poll?: (health: Health | undefined) => number | false) {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => api.getHealth(),
    staleTime: Infinity,
    retry: false,
    refetchInterval: poll ? (query) => poll(query.state.data) : false,
  });
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

// ---- Context briefings (API.md, "Context") ----

/** Whether the computer has an API key; on a phone, its paid runs left today. */
export function useContextStatus(enabled = true) {
  return useQuery({ queryKey: queryKeys.contextStatus, queryFn: () => api.getContextStatus(), enabled, staleTime: 10_000 });
}

/** The stored briefing for a document, level and focus (none: the whole book), and any run going for it. */
export function useContextBriefing(docId: string | undefined, level: ContextLevel, focus?: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.contextBriefing(docId ?? "", level, focus),
    queryFn: () => api.getContextBriefing(docId!, level, focus || undefined),
    enabled: enabled && Boolean(docId),
    staleTime: 60_000,
  });
}

/**
 * A run, polled every 2 s while it runs (CONTRACT: a run lives on the server, so this picks it up
 * again after the app sleeps). When it ends, the briefing and the phone's count are fetched again.
 */
export function useContextRun(runId: string | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: queryKeys.contextRun(runId ?? ""),
    queryFn: async (): Promise<ContextRun> => {
      const run = await api.getContextRun(runId!);
      if (run.status !== "running") {
        void qc.invalidateQueries({ queryKey: ["context", "briefing", run.docId] });
        void qc.invalidateQueries({ queryKey: queryKeys.contextStatus });
        void qc.invalidateQueries({ queryKey: queryKeys.contextList });
      }
      return run;
    },
    enabled: Boolean(runId),
    staleTime: 0,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== "running" ? false : 2000),
    refetchIntervalInBackground: false,
  });
}

/** Every book with a stored briefing, for the Assistant page. */
export function useContextBriefings(enabled = true) {
  return keepDataWhenAway(useQuery({ queryKey: queryKeys.contextList, queryFn: () => api.listContextBriefings(), enabled, staleTime: 30_000 }));
}

/** Ask for a briefing: the cached one comes back at once, otherwise a run starts (and costs money). */
export function useStartContext(docId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ level, refresh, focus }: StartContextInput & { level: ContextLevel }) =>
      api.startContextBriefing(docId!, focus ? { level, refresh, focus } : { level, refresh }),
    onSuccess: (result, { level, focus }) => {
      qc.setQueryData<ContextState>(queryKeys.contextBriefing(docId!, level, focus), (state) => {
        const base: ContextState = state ?? { briefing: null, stale: false, run: null, cachedLevels: [] };
        if (result.briefing) return { ...base, briefing: result.briefing, stale: false, run: null };
        return { ...base, run: result.run };
      });
      if (result.run) qc.setQueryData(queryKeys.contextRun(result.run.id), result.run);
      void qc.invalidateQueries({ queryKey: queryKeys.contextStatus });
    },
    // Refused (a phone past its limit, a limit lowered on the computer, no key): the runs-left line and
    // the buttons follow the server again.
    onError: () => void qc.invalidateQueries({ queryKey: queryKeys.contextStatus }),
  });
}

/**
 * Pictures and Wikipedia intros for a briefing's Wikidata items (Phase 5). Free; on failure the map
 * just keeps its shapes, so errors stay quiet.
 */
export function useContextMedia(ids: readonly string[]) {
  return useQuery({
    queryKey: queryKeys.contextMedia(ids),
    queryFn: () => api.getContextMedia([...ids]),
    enabled: ids.length > 0,
    staleTime: 60 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
  });
}
