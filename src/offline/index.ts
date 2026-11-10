/**
 * The iPhone app's copy of the library, from the page's side: books chosen with Download are read
 * from the phone when the computer can't be reached, and reading places and highlights made
 * meanwhile wait in a queue and are sent when it can. A browser has no copy; nothing here runs there.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { PagerApi } from "@/api/client";
import { createHttpApi } from "@/api/http";
import { ApiError, ErrorCodes, type JournalEvent } from "@/api/types";
import { isNativeApp, onNativeOnline } from "@/lib/native";
import { createOfflineApi } from "./api";
import { devCopyLink } from "./dev";
import { downloadBook, removeDownload, saveClient, type DownloadDeps, type Walker } from "./download";
import { KEEP_HEADER } from "./ops";
import { emptyClient, nativePort, readClient, type CopyPort } from "./port";
import { offlineStore, type OfflineStore } from "./state";
import { createSync } from "./sync";

export { canOpen, keptState, offlineStore, useOffline, type OfflineState } from "./state";

/** The copy and the way to the computer: the app's own, or the development stand-in's. */
export interface CopyLink {
  port: CopyPort;
  fetch: typeof fetch;
}

/** In the iPhone app, its copy. In a development build with `?devcopy=1`, a stand-in. Otherwise none. */
export function copyLink(): CopyLink | null {
  if (typeof window === "undefined") return null;
  if (isNativeApp()) return { port: nativePort(), fetch: window.fetch.bind(window) };
  return import.meta.env.DEV ? devCopyLink() : null;
}

/** Events after which the downloaded books may be out of date. */
const LIBRARY_EVENTS: ReadonlySet<string> = new Set([
  "revision.created",
  "document.added",
  "document.removed",
  "document.updated",
  "document.merged",
  "import.applied",
  "tree.changed",
]);
const EVENT_PAUSE_MS = 2000;

export interface OfflineRuntime {
  /** The API the UI uses: waiting changes show in its answers, and changes queue when the computer is away. */
  api: PagerApi;
  store: OfflineStore;
  /** Start following the computer's reachability and keeping the copy up to date. Call once. */
  start(queryClient: QueryClient): void;
  download(docId: string): Promise<void>;
  removeDownload(docId: string): Promise<void>;
  /** Remove every downloaded book. Changes waiting to be sent, and the ones that couldn't be, stay. */
  removeAll(): Promise<void>;
  /** Forget a change the computer refused. */
  discardFailed(index: number): Promise<void>;
  /** Try to reach the computer now. */
  probe(): Promise<void>;
}

export function createOfflineRuntime(link: CopyLink, store: OfflineStore = offlineStore): OfflineRuntime {
  const { port } = link;
  const http = createHttpApi("/api", link.fetch);
  store.set({ available: true });

  async function load(): Promise<void> {
    const state = await port.state();
    store.set({
      online: state.online,
      lastOnlineAt: state.lastOnlineAt,
      bytes: state.bytes,
      outbox: state.outbox,
      client: readClient(state.client),
    });
  }
  // Read the queue before anything is shown: the first lists already carry the waiting changes.
  const ready = load().catch(() => {});

  const walker = (tag: string): Walker => {
    const tagged: typeof fetch = (input, init) =>
      link.fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), [KEEP_HEADER]: tag } });
    return {
      api: createHttpApi("/api", tagged),
      asset: async (url) => {
        const res = await tagged(url);
        // A missing picture doesn't stop a download; the computer going away does.
        if (res.status >= 500)
          throw new ApiError(ErrorCodes.unavailable, "Pager can't reach your computer right now.", res.status);
        await res.arrayBuffer();
      },
    };
  };
  const deps: DownloadDeps = { walker, port, store };

  let onEvent: (event: JournalEvent) => void = () => {};
  const api = createOfflineApi(http, port, store, { ready, onEvent: (event) => onEvent(event) });

  let started = false;
  let requestSync: (reason: "start" | "online" | "event" | "manual") => Promise<void> = async () => {};

  async function refreshSize(): Promise<void> {
    try {
      const state = await port.state();
      store.set({ bytes: state.bytes, lastOnlineAt: state.lastOnlineAt });
    } catch {
      // The size shown is a little behind.
    }
  }

  return {
    api,
    store,

    start(queryClient) {
      if (started) return;
      started = true;
      const sync = createSync({
        ...deps,
        inner: http,
        onDone: ({ reason, sent, changed }) => {
          for (const docId of changed) void queryClient.invalidateQueries({ queryKey: ["section", docId] });
          // A change in the library already refreshed what it touched (applyServerEvent); coming
          // back, or sending the queue, refreshes everything. Sections are refetched only above:
          // an open page's text stays as it is unless its file changed.
          if (reason !== "event" || sent > 0 || changed.length > 0) {
            void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "section" });
          }
        },
      });
      requestSync = sync.request;
      onNativeOnline((up) => {
        store.set({ online: up });
        if (up) void sync.request("online");
        else void refreshSize();
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      onEvent = (event) => {
        if (!LIBRARY_EVENTS.has(event.type)) return;
        clearTimeout(timer);
        timer = setTimeout(() => void sync.request("event"), EVENT_PAUSE_MS);
      };
      void ready.then(() => {
        if (store.get().online !== false) void sync.request("start");
      });
    },

    async download(docId) {
      await ready;
      await downloadBook(deps, docId);
      await refreshSize();
    },

    async removeDownload(docId) {
      await ready;
      await removeDownload(deps, docId);
      await refreshSize();
    },

    async removeAll() {
      await ready;
      const { failed } = store.get().client;
      await port.wipe();
      store.set({ client: emptyClient(), bytes: 0 });
      await saveClient(deps, (c) => ({ ...c, failed }));
      await refreshSize();
      // The lists and covers come back with the next sync, so the offline Library stays whole.
      void requestSync("manual");
    },

    async discardFailed(index) {
      await ready;
      await saveClient(deps, (c) => ({ ...c, failed: c.failed.filter((_, i) => i !== index) }));
    },

    probe: () => port.probe(),
  };
}
