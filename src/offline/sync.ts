import type { PagerApi } from "@/api/client";
import type { TreeFolder } from "@/api/types";
import { unreachable } from "./api";
import { downloadBook, refreshBook, removeDownload, saveClient, type DownloadDeps } from "./download";
import { SHELL_TAG } from "./ops";
import { replayOutbox } from "./replay";

/** Why a sync was asked for: the app started, the computer came back, the library changed, or the reader asked. */
export type SyncReason = "start" | "online" | "event" | "manual";

export interface SyncReport {
  reason: SyncReason;
  /** Queued changes the computer now has. */
  sent: number;
  /** Downloaded books fetched again or removed. */
  changed: string[];
}

export interface SyncDeps extends DownloadDeps {
  /** The plain API, with no waiting changes laid over its answers. */
  inner: PagerApi;
  /** After a pass that reached its end. */
  onDone?: (report: SyncReport) => void;
}

function coversIn(folder: TreeFolder, out: Map<string, string> = new Map()): Map<string, string> {
  for (const f of folder.files) {
    if (f.doc?.coverUrl?.startsWith("/api/assets/")) out.set(f.doc.id, f.doc.coverUrl);
  }
  for (const f of folder.folders) coversIn(f, out);
  return out;
}

/**
 * Bring the app's copy up to date, one pass at a time:
 * 1. send the changes that waited;
 * 2. check each downloaded book against the computer's manifest: fetch a changed one again, finish
 *    one cut short, take out one that is gone, and refresh the place and highlights of the rest;
 * 3. fetch the lists every page opens with, and any new cover, so the app keeps them.
 * A pass that finds the computer gone stops quietly; the next one starts over.
 */
export function createSync(deps: SyncDeps) {
  const now = deps.now ?? (() => new Date().toISOString());
  let running: Promise<void> | null = null;
  let next: SyncReason | null = null;

  async function warm(): Promise<void> {
    const { inner } = deps;
    const [tree] = await Promise.allSettled([
      inner.getTree(),
      inner.listDocuments(),
      inner.listDocuments({ history: true }),
      inner.listHighlights(),
      inner.listTags(),
      inner.getHealth(),
      inner.listContextBriefings(),
    ]);
    if (tree.status !== "fulfilled") return;
    const have = deps.store.get().client.covers;
    const covers = coversIn(tree.value.root);
    const fetched: Record<string, string> = {};
    const shell = deps.walker(SHELL_TAG);
    for (const [docId, url] of covers) {
      if (have[docId] === url) {
        fetched[docId] = url;
        continue;
      }
      try {
        await shell.asset(url);
        fetched[docId] = url;
      } catch {
        // Tried again next time.
      }
    }
    await saveClient(deps, (c) => ({ ...c, covers: fetched }));
  }

  async function pass(reason: SyncReason): Promise<void> {
    deps.store.set({ syncing: true });
    try {
      const replay = await replayOutbox(deps.inner, deps.port, deps.store, now);
      if (replay.stopped) return;
      const manifest = await deps.inner.getSyncManifest();
      const revisions = new Map(manifest.documents.map((d) => [d.id, d.revisionId]));
      const changed: string[] = [];
      for (const [docId, book] of Object.entries(deps.store.get().client.kept)) {
        const revision = revisions.get(docId);
        try {
          if (revision === undefined) {
            await removeDownload(deps, docId);
            changed.push(docId);
          } else if (revision !== book.revisionId || !book.complete) {
            await downloadBook(deps, docId);
            changed.push(docId);
          } else {
            await refreshBook(deps, docId);
          }
        } catch (err) {
          // The computer went away: stop. Anything else is this book's alone; the others still sync.
          if (unreachable(err)) throw err;
        }
      }
      await warm();
      await saveClient(deps, (c) => ({ ...c, lastSyncedAt: now() }));
      const state = await deps.port.state();
      deps.store.set({ bytes: state.bytes, lastOnlineAt: state.lastOnlineAt });
      deps.onDone?.({ reason, sent: replay.sent, changed });
    } finally {
      deps.store.set({ syncing: false });
    }
  }

  /** Run a pass, or have the one under way followed by another. Never rejects. */
  function request(reason: SyncReason): Promise<void> {
    if (running) {
      // "online" outranks the rest: it is the pass that refreshes everything on screen.
      if (next !== "online") next = reason;
      return running;
    }
    running = (async () => {
      let why: SyncReason | null = reason;
      while (why) {
        next = null;
        try {
          await pass(why);
        } catch {
          // The computer went away, or refused: the next pass starts over.
        }
        why = next;
      }
      running = null;
    })();
    return running;
  }

  return { request };
}
