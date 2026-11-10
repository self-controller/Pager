/**
 * Fetches ahead what the tabs and the book read last will ask for, so a tab switch or opening the
 * book paints from the cache. Every key and query function is the one the page's own hook uses: a
 * key that differs by one property is another cache entry and warms nothing.
 */
import { useEffect } from "react";
import { useQueryClient, type QueryCacheNotifyEvent, type QueryClient } from "@tanstack/react-query";
import { api as appApi } from "@/api";
import type { PagerApi } from "@/api/client";
import { annotationKeys, queryKeys } from "@/api/hooks";
import type { DocumentDetail, DocumentSummary, Section } from "@/api/types";
import { canOpen, offlineStore, useOffline } from "@/offline";
import { preloadContext } from "@/tools/context";

export type WarmApi = Pick<
  PagerApi,
  "getTree" | "listDocuments" | "listHighlights" | "listTags" | "listContextBriefings" | "getDocument" | "getSection" | "listAnnotations"
>;

export interface WarmOptions {
  api?: WarmApi;
  /** Whether a book can be opened now (the iPhone app, computer out of reach: only downloaded ones). */
  canOpen?: (docId: string) => boolean;
  /** Loads the Assistant's lazy code. */
  preload?: () => unknown;
  hidden?: () => boolean;
  /**
   * Fetch only what is missing or marked to be fetched again, whatever its age: for the passes an
   * invalidation starts, which come often while reading.
   */
  onlyInvalid?: boolean;
}

/** How many books after the Book tab's get their document and current chapter. */
export const WARM_BOOKS = 5;
/** A book's details change rarely; a pass doesn't fetch one again within this, unless it was invalidated. */
const BOOK_STALE_MS = 5 * 60_000;

const running = new WeakMap<QueryClient, Promise<void>>();

/** The chapter the reader opens for a book with no chapter in the link (ReaderPage's rule). */
export function currentSectionId(doc: Pick<DocumentDetail, "progress" | "toc">): string | undefined {
  return doc.progress?.sectionId ?? doc.toc[0]?.id;
}

function prefetchSection(qc: QueryClient, api: WarmApi, docId: string, sectionId: string): Promise<void> {
  // As ReaderPage's own prefetch and `useSection`: a chapter is fetched again only when invalidated.
  return qc.prefetchQuery({
    queryKey: queryKeys.section(docId, sectionId),
    queryFn: () => api.getSection(docId, sectionId),
    staleTime: Infinity,
  });
}

/**
 * A book's document and the chapter the reader will open: the one `sectionId` names (a link from
 * the Library carries it), else the book's saved place, else its first. Resolves to that chapter's
 * id once both are in the cache; errors are swallowed.
 */
export async function prefetchBook(
  qc: QueryClient,
  docId: string,
  options: { api?: WarmApi; sectionId?: string; staleTime?: number } = {},
): Promise<string | undefined> {
  const api = options.api ?? appApi;
  const known = options.sectionId ? prefetchSection(qc, api, docId, options.sectionId) : undefined;
  await qc.prefetchQuery({
    queryKey: queryKeys.document(docId),
    queryFn: () => api.getDocument(docId),
    ...(options.staleTime === undefined ? {} : { staleTime: options.staleTime }),
  });
  if (known) {
    await known;
    return options.sectionId;
  }
  const doc = qc.getQueryData<DocumentDetail>(queryKeys.document(docId));
  const sectionId = doc && currentSectionId(doc);
  if (sectionId) await prefetchSection(qc, api, docId, sectionId);
  return sectionId;
}

async function pass(qc: QueryClient, options: WarmOptions): Promise<void> {
  const api = options.api ?? appApi;
  const hidden = options.hidden ?? (() => typeof document !== "undefined" && document.hidden);
  const openable = options.canOpen ?? ((id: string) => canOpen(offlineStore.get(), id));
  const age = options.onlyInvalid ? { staleTime: Infinity } : {};
  const history = queryKeys.documents({ history: true });

  void options.preload?.();
  // The tabs' lists. prefetchQuery skips what is fresh and never throws.
  await Promise.all([
    qc.prefetchQuery({ queryKey: queryKeys.tree, queryFn: () => api.getTree(), ...age }),
    qc.prefetchQuery({ queryKey: history, queryFn: () => api.listDocuments({ history: true }), ...age }),
    qc.prefetchQuery({ queryKey: queryKeys.documents({}), queryFn: () => api.listDocuments({}), ...age }),
    qc.prefetchQuery({ queryKey: annotationKeys.highlights({}), queryFn: () => api.listHighlights({}), ...age }),
    qc.prefetchQuery({ queryKey: annotationKeys.tags, queryFn: () => api.listTags(), ...age }),
    qc.prefetchQuery({ queryKey: queryKeys.contextList, queryFn: () => api.listContextBriefings(), ...age }),
  ]);
  if (hidden()) return;

  const books = (qc.getQueryData<DocumentSummary[]>(history) ?? []).filter((d) => openable(d.id)).slice(0, 1 + WARM_BOOKS);
  const bookAge = options.onlyInvalid ? Infinity : BOOK_STALE_MS;
  const [first, ...rest] = books;
  if (first) {
    // The Book tab's book: its link has no chapter, so the reader needs the document first, then
    // the chapter, the two beside it (the scroll layout shows them) and the highlights.
    const notes = qc.prefetchQuery({
      queryKey: annotationKeys.forDoc(first.id),
      queryFn: () => api.listAnnotations(first.id),
      ...age,
    });
    const sectionId = await prefetchBook(qc, first.id, { api, staleTime: options.onlyInvalid ? Infinity : undefined });
    const section = sectionId ? qc.getQueryData<Section>(queryKeys.section(first.id, sectionId)) : undefined;
    await Promise.all([
      notes,
      ...[section?.prevId, section?.nextId].filter((id): id is string => Boolean(id)).map((id) => prefetchSection(qc, api, first.id, id)),
    ]);
  }
  // One book at a time: a request the reader makes meanwhile shouldn't queue behind five.
  for (const doc of rest) {
    if (hidden()) return;
    await prefetchBook(qc, doc.id, { api, staleTime: bookAge });
  }
}

/**
 * One warm pass. Safe to call often: fresh entries are skipped, a call during a pass joins it,
 * nothing happens while the page is hidden, and a computer out of reach is not an error.
 */
export function warmTabs(qc: QueryClient, options: WarmOptions = {}): Promise<void> {
  const going = running.get(qc);
  if (going) return going;
  const hidden = options.hidden ?? (() => typeof document !== "undefined" && document.hidden);
  if (hidden()) return Promise.resolve();
  const run = pass(qc, options)
    .catch(() => {})
    .finally(() => running.delete(qc));
  running.set(qc, run);
  return run;
}

/** The lists a tab opens with: one of these invalidated while no page shows it is worth fetching ahead. */
export function isTabList(key: readonly unknown[]): boolean {
  const first = key[0];
  if (first === "context") return key.length === 2 && key[1] === "list";
  return first === "tree" || first === "documents" || first === "highlights" || first === "tags";
}

const FIRST_PAINT_MS = 300;
const INVALID_PAUSE_MS = 2000;
const INVALID_EVERY_MS = 20_000;

/**
 * Starts the passes: once after the first paint, each time the page is shown again, and (waiting
 * 2 s, at most every 20 s) when a tab's list is invalidated while nothing is showing it. Returns
 * the function that stops it. `warm` is `warmTabs` unless a test says otherwise.
 */
export function startTabWarmth(
  qc: QueryClient,
  warm: (qc: QueryClient, options?: WarmOptions) => Promise<void> = (client, options) =>
    warmTabs(client, { preload: preloadContext, ...options }),
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = -Infinity;

  const idle = window.requestIdleCallback
    ? window.requestIdleCallback(() => void warm(qc), { timeout: 1500 })
    : undefined;
  const first = idle === undefined ? setTimeout(() => void warm(qc), FIRST_PAINT_MS) : undefined;

  const onVisible = () => {
    if (!document.hidden) void warm(qc);
  };
  document.addEventListener("visibilitychange", onVisible);

  const onEvent = (event: QueryCacheNotifyEvent) => {
    if (event.type !== "updated" || event.action.type !== "invalidate") return;
    if (!isTabList(event.query.queryKey) || event.query.getObserversCount() > 0) return;
    // Reading saves the place every few seconds, and each save invalidates the documents lists:
    // the first one starts the wait, the ones during it ride along.
    if (timer !== undefined) return;
    const wait = Math.max(INVALID_PAUSE_MS, last + INVALID_EVERY_MS - Date.now());
    timer = setTimeout(() => {
      timer = undefined;
      last = Date.now();
      void warm(qc, { onlyInvalid: true });
    }, wait);
  };
  const unsubscribe = qc.getQueryCache().subscribe(onEvent);

  return () => {
    if (idle !== undefined) window.cancelIdleCallback?.(idle);
    clearTimeout(first);
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    unsubscribe();
  };
}

/** Keeps the tabs warm for as long as the shell is mounted. */
export function useTabWarmth(): void {
  const qc = useQueryClient();
  useEffect(() => startTabWarmth(qc), [qc]);
  // The iPhone app found the computer again: what failed while it was away is fetched now.
  const online = useOffline().online;
  useEffect(() => {
    if (online) void warmTabs(qc, { preload: preloadContext });
  }, [qc, online]);
}
