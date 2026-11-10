/**
 * Where the query cache is kept between launches. The port is small on purpose: `persist.ts` decides
 * what is stored and when; a store only holds entries. Nothing here throws to its caller.
 */

/** One stored query: its answer, when it was fetched and when something last used it. */
export interface CacheEntry {
  /** The query hash (TanStack's `hashKey` of `key`): the entry's identity. */
  hash: string;
  key: readonly unknown[];
  data: unknown;
  /** When the answer was fetched (ms): the query's `dataUpdatedAt`. */
  updatedAt: number;
  /** When a page last used it (ms). */
  usedAt: number;
}

export interface CacheStore {
  load(): Promise<CacheEntry[]>;
  put(entries: CacheEntry[]): Promise<void>;
  remove(hashes: string[]): Promise<void>;
  clear(): Promise<void>;
}

export interface MemoryCacheStore extends CacheStore {
  /** What is stored, by hash: the stand-in for the disk. */
  entries: Map<string, CacheEntry>;
}

/** A store in memory, for tests. Entries are copied in and out, as a real store's are. */
export function memoryCacheStore(initial: CacheEntry[] = []): MemoryCacheStore {
  const copy = (e: CacheEntry): CacheEntry => structuredClone(e);
  const entries = new Map(initial.map((e) => [e.hash, copy(e)]));
  return {
    entries,
    load: async () => [...entries.values()].map(copy),
    put: async (list) => {
      for (const e of list) entries.set(e.hash, copy(e));
    },
    remove: async (hashes) => {
      for (const h of hashes) entries.delete(h);
    },
    clear: async () => entries.clear(),
  };
}

const OBJECT_STORE = "queries";

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * The store in IndexedDB: one database, one object store keyed by the query hash. Without
 * IndexedDB, or when it won't open (private browsing, a full disk), it is an empty store that
 * accepts everything and keeps nothing.
 */
export function idbCacheStore(name = "pager-query-cache"): CacheStore {
  let opening: Promise<IDBDatabase | null> | undefined;

  const open = (): Promise<IDBDatabase | null> =>
    (opening ??= new Promise<IDBDatabase | null>((resolve) => {
      try {
        if (typeof indexedDB === "undefined") return resolve(null);
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(OBJECT_STORE)) req.result.createObjectStore(OBJECT_STORE, { keyPath: "hash" });
        };
        req.onsuccess = () => {
          const db = req.result;
          // Another tab upgrading or deleting the database: let it, and open again when next needed.
          db.onversionchange = () => {
            db.close();
            opening = undefined;
          };
          resolve(db);
        };
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    }));

  /** Run `work` in one transaction; a failure is the fallback, never an exception. */
  async function run<T>(mode: IDBTransactionMode, fallback: T, work: (os: IDBObjectStore) => (() => T) | void): Promise<T> {
    try {
      const db = await open();
      if (!db) return fallback;
      const tx = db.transaction(OBJECT_STORE, mode);
      const result = work(tx.objectStore(OBJECT_STORE));
      await done(tx);
      return result ? result() : fallback;
    } catch {
      return fallback;
    }
  }

  return {
    load: () =>
      run<CacheEntry[]>("readonly", [], (os) => {
        const req = os.getAll();
        return () => (req.result as CacheEntry[]) ?? [];
      }),
    put: (entries) =>
      run("readwrite", undefined, (os) => {
        for (const e of entries) {
          try {
            os.put(e);
          } catch {
            // Something that can't be cloned: that entry isn't kept.
          }
        }
      }),
    remove: (hashes) =>
      run("readwrite", undefined, (os) => {
        for (const h of hashes) os.delete(h);
      }),
    clear: () =>
      run("readwrite", undefined, (os) => {
        os.clear();
      }),
  };
}
