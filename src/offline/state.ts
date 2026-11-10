import { useSyncExternalStore } from "react";
import { emptyClient, type ClientRecord, type OutboxEntry } from "./port";

/** What the UI knows about the iPhone app's copy. `available` is false in a browser. */
export interface OfflineState {
  /** Whether this page runs with a copy at all (the iPhone app). */
  available: boolean;
  /** Whether the computer can be reached; null until the app has tried. */
  online: boolean | null;
  /** When the computer was last reached (ISO-8601). */
  lastOnlineAt: string | null;
  /** The size of the stored answers. */
  bytes: number;
  /** Changes waiting to be sent, in order. */
  outbox: OutboxEntry[];
  client: ClientRecord;
  /** Books being downloaded now: sections fetched, of how many. */
  downloads: Record<string, { done: number; total: number }>;
  syncing: boolean;
}

export interface OfflineStore {
  get(): OfflineState;
  set(patch: Partial<OfflineState>): void;
  update(fn: (state: OfflineState) => Partial<OfflineState>): void;
  subscribe(listener: () => void): () => void;
}

export function createOfflineStore(initial: Partial<OfflineState> = {}): OfflineStore {
  let state: OfflineState = {
    available: false,
    online: null,
    lastOnlineAt: null,
    bytes: 0,
    outbox: [],
    client: emptyClient(),
    downloads: {},
    syncing: false,
    ...initial,
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<OfflineState>) => {
    state = { ...state, ...patch };
    for (const l of [...listeners]) l();
  };
  return {
    get: () => state,
    set,
    update: (fn) => set(fn(state)),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The one store the UI reads. It stays `available: false` unless the app's copy is set up (src/api/index.ts). */
export const offlineStore = createOfflineStore();

export function useOffline(): OfflineState {
  return useSyncExternalStore(offlineStore.subscribe, offlineStore.get, offlineStore.get);
}

/** Whether a book can be opened now: always while the computer may be reachable, else only once downloaded. */
export function canOpen(state: OfflineState, docId: string): boolean {
  if (!state.available || state.online !== false) return true;
  return state.client.kept[docId]?.complete === true;
}

/** Whether the book is on this phone: "kept", "partial" while a download is unfinished, or false. */
export function keptState(state: OfflineState, docId: string): "kept" | "partial" | false {
  const book = state.client.kept[docId];
  if (!book) return false;
  return book.complete ? "kept" : "partial";
}
