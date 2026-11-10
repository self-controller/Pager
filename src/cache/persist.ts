/**
 * Keeps the query cache between launches: the lists and the chapters read last are put back before
 * the first render, shown at once and refreshed in the background the first time something uses them.
 *
 * No imports from the API here (src/api/index.ts builds the offline runtime; a cycle would follow):
 * the client, the store and the version stamp are passed in.
 */
import { hashKey, type Query, type QueryCacheNotifyEvent, type QueryClient, type QueryKey } from "@tanstack/react-query";
import type { CacheEntry, CacheStore } from "./store";

/** Raise when the shape of a stored entry changes: an older store is dropped. */
export const CACHE_FORMAT = 1;

/** The stamp a store must carry to be read: the API's version and this file's format. */
export function cacheStamp(apiVersion: number): string {
  return `api${apiVersion}:cache${CACHE_FORMAT}`;
}

/** The stamp's own record. A query hash is JSON (it starts with `[`), so this can't be one. */
export const STAMP_HASH = "#stamp";

const KEPT: ReadonlySet<unknown> = new Set(["tree", "documents", "document", "section", "annotations", "highlights", "tags", "health"]);

/**
 * Whether a query is kept between launches: the library's lists, books and chapters, highlights,
 * health, and the Assistant's list. Never pairing, devices, settings, search, jobs, or a Context
 * run, briefing, status or picture.
 */
export function shouldPersist(key: QueryKey): boolean {
  const first = key[0];
  if (first === "context") return key.length === 2 && key[1] === "list";
  return KEPT.has(first);
}

/** The data as it is stored: health without the relay's token, which must not be written to disk. */
export function forStore(key: QueryKey, data: unknown): unknown {
  if (key[0] !== "health" || !data || typeof data !== "object") return data;
  const remote = (data as { remote?: unknown }).remote;
  if (!remote || typeof remote !== "object" || !("relayToken" in remote)) return data;
  const { relayToken: _token, ...rest } = remote as Record<string, unknown>;
  return { ...data, remote: rest };
}

export interface PersistOptions {
  store: CacheStore;
  /** `cacheStamp(API_VERSION)`: a store with another stamp is dropped. */
  stamp: string;
  /** How long a changed query waits before it is written. */
  debounceMs?: number;
  /** An entry whose JSON is longer than this isn't stored. */
  maxEntryBytes?: number;
  /** How many chapters are kept: the ones used last. */
  maxSections?: number;
  /** An entry nothing has used for this long is dropped at the next launch. */
  maxAgeMs?: number;
  now?: () => number;
}

export interface Persister {
  /** Put the stored entries into the client, marked to be refreshed on first use. Resolves to how many. */
  restore(): Promise<number>;
  /** Write what is waiting now. */
  flush(): Promise<void>;
  /** Drop everything stored, and store nothing more until the page loads again. Memory is untouched. */
  wipe(): Promise<void>;
  /** Drop the stored chapters. */
  dropSections(): Promise<void>;
  /** Stop listening. What is waiting isn't written. */
  stop(): void;
}

const SECOND = 1000;
/** A chapter being opened again counts as use at most this often (each one is a write). */
const USE_PAUSE_MS = 60 * SECOND;

export function createPersister(client: QueryClient, options: PersistOptions): Persister {
  const { store, stamp } = options;
  const debounceMs = options.debounceMs ?? SECOND;
  const maxEntryBytes = options.maxEntryBytes ?? 2 * 1024 * 1024;
  const maxSections = options.maxSections ?? 60;
  const maxAgeMs = options.maxAgeMs ?? 30 * 24 * 60 * 60 * SECOND;
  const now = options.now ?? Date.now;
  const cache = client.getQueryCache();

  /** Queries waiting to be written, each with its own timer. */
  const waiting = new Map<string, ReturnType<typeof setTimeout>>();
  /** When each query was last used, by hash. */
  const used = new Map<string, number>();
  /** The stored chapters and when each was last used: the oldest go first. */
  const sections = new Map<string, number>();
  let restoring = false;
  let stopped = false;
  /** Store calls run one after another, so a wipe comes after the writes before it. */
  let tail: Promise<unknown> = Promise.resolve();
  const inOrder = <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work, work);
    tail = next.catch(() => {});
    return next;
  };
  const stampEntry = (): CacheEntry => ({ hash: STAMP_HASH, key: [], data: stamp, updatedAt: now(), usedAt: now() });

  function entryOf(query: Query): CacheEntry | "skip" | "drop" {
    const { data, dataUpdatedAt } = query.state;
    if (data === undefined) return "skip";
    const kept = forStore(query.queryKey, data);
    try {
      const json = JSON.stringify(kept);
      if (json === undefined || json.length > maxEntryBytes) return "drop";
    } catch {
      return "drop";
    }
    return { hash: query.queryHash, key: query.queryKey, data: kept, updatedAt: dataUpdatedAt, usedAt: used.get(query.queryHash) ?? now() };
  }

  function write(hashes: string[]): Promise<void> {
    const entries: CacheEntry[] = [];
    const remove: string[] = [];
    for (const hash of hashes) {
      clearTimeout(waiting.get(hash));
      waiting.delete(hash);
      const query = cache.get(hash);
      const entry = query ? entryOf(query) : "skip";
      if (entry === "skip") continue;
      if (entry === "drop") {
        // Too big to keep: an older, smaller answer for it must not come back either.
        remove.push(hash);
        sections.delete(hash);
        continue;
      }
      entries.push(entry);
      if (entry.key[0] === "section") sections.set(hash, entry.usedAt);
    }
    if (sections.size > maxSections) {
      const oldest = [...sections].sort((a, b) => a[1] - b[1]).slice(0, sections.size - maxSections);
      for (const [hash] of oldest) {
        sections.delete(hash);
        remove.push(hash);
      }
    }
    if (entries.length === 0 && remove.length === 0) return Promise.resolve();
    const gone = new Set(remove);
    return inOrder(async () => {
      if (stopped) return;
      const keep = entries.filter((e) => !gone.has(e.hash));
      if (keep.length) await store.put(keep);
      if (remove.length) await store.remove(remove);
    });
  }

  function schedule(query: Query): void {
    const hash = query.queryHash;
    used.set(hash, now());
    clearTimeout(waiting.get(hash));
    waiting.set(
      hash,
      setTimeout(() => void write([hash]), debounceMs),
    );
  }

  function onEvent(event: QueryCacheNotifyEvent): void {
    if (stopped || restoring) return;
    const query = event.query;
    if (!shouldPersist(query.queryKey)) return;
    // A fetch that answered, or data written by hand (a saved place patched into the lists).
    if (event.type === "updated" && event.action.type === "success") schedule(query);
    // A chapter opened again from memory: it moves to the front of the ones kept.
    else if (
      event.type === "observerAdded" &&
      query.queryKey[0] === "section" &&
      query.state.data !== undefined &&
      now() - (used.get(query.queryHash) ?? 0) > USE_PAUSE_MS
    )
      schedule(query);
    // "removed" (collected from memory after gcTime) is not a reason to forget the stored entry.
  }

  const flush = (): Promise<void> => write([...waiting.keys()]);
  const onHidden = () => {
    if (document.visibilityState === "hidden") void flush();
  };
  const onPageHide = () => void flush();

  const unsubscribe = cache.subscribe(onEvent);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onHidden);
  if (typeof window !== "undefined") window.addEventListener("pagehide", onPageHide);

  function cancelWaiting(only?: (hash: string) => boolean): void {
    for (const [hash, timer] of [...waiting]) {
      if (only && !only(hash)) continue;
      clearTimeout(timer);
      waiting.delete(hash);
    }
  }

  return {
    async restore() {
      const all = await inOrder(() => store.load());
      if (stopped) return 0;
      const stamped = all.find((e) => e.hash === STAMP_HASH);
      if (stamped?.data !== stamp) {
        // Another API version or format, or a store never stamped: nothing in it can be trusted.
        await inOrder(async () => {
          await store.clear();
          await store.put([stampEntry()]);
        });
        return 0;
      }
      const oldest = now() - maxAgeMs;
      const drop: string[] = [];
      const restored = new Set<string>();
      for (const entry of all) {
        if (entry.hash === STAMP_HASH) continue;
        if (!Array.isArray(entry.key) || !shouldPersist(entry.key) || hashKey(entry.key) !== entry.hash || entry.usedAt < oldest) {
          drop.push(entry.hash);
          continue;
        }
        if (entry.key[0] === "section") sections.set(entry.hash, Math.max(entry.usedAt, sections.get(entry.hash) ?? 0));
        if (!used.has(entry.hash)) used.set(entry.hash, entry.usedAt);
        // A restore that finishes after the first render: a fetch may already have put newer data there.
        const live = cache.get(entry.hash);
        if (live && live.state.data !== undefined && live.state.dataUpdatedAt >= entry.updatedAt) continue;
        restoring = true;
        try {
          client.setQueryData(entry.key, entry.data, { updatedAt: entry.updatedAt });
        } finally {
          restoring = false;
        }
        restored.add(entry.hash);
      }
      // Shown at once, fetched again the first time something uses them; `staleTime: Infinity` too.
      if (restored.size) {
        await client.invalidateQueries({ predicate: (q) => restored.has(q.queryHash), refetchType: "none" });
      }
      if (drop.length) void inOrder(() => store.remove(drop));
      return restored.size;
    },

    flush,

    wipe() {
      stopped = true;
      cancelWaiting();
      sections.clear();
      return inOrder(async () => {
        await store.clear();
        await store.put([stampEntry()]);
      });
    },

    dropSections() {
      const isSection = (hash: string) => cache.get(hash)?.queryKey[0] === "section" || sections.has(hash);
      cancelWaiting(isSection);
      sections.clear();
      return inOrder(async () => {
        const all = await store.load();
        const hashes = all.filter((e) => Array.isArray(e.key) && e.key[0] === "section").map((e) => e.hash);
        if (hashes.length) await store.remove(hashes);
      });
    },

    stop() {
      stopped = true;
      cancelWaiting();
      unsubscribe();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onHidden);
      if (typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide);
    },
  };
}
