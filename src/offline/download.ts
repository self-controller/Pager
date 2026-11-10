import type { PagerApi } from "@/api/client";
import { docTag, textLength } from "./ops";
import type { ClientRecord, CopyPort, KeptBook } from "./port";
import type { OfflineStore } from "./state";

/** Requests whose answers the app keeps under one tag: the plain API, and a fetch for images. */
export interface Walker {
  api: Pick<PagerApi, "getDocument" | "getSection" | "listAnnotations">;
  /** Fetch an image so the app keeps it. */
  asset(url: string): Promise<void>;
}

export interface DownloadDeps {
  walker: (tag: string) => Walker;
  port: CopyPort;
  store: OfflineStore;
  now?: () => string;
}

const ASSET = /\/api\/assets\/[A-Za-z0-9._~%-]+/g;
const SECTIONS_AT_ONCE = 4;

/** The computer's own images named in a section's HTML (pictures from elsewhere aren't kept). */
export function assetUrls(html: string): string[] {
  return [...new Set(html.match(ASSET) ?? [])];
}

/** Run `work` over `items`, a few at a time; the first failure stops the rest and is thrown. */
export async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed: unknown;
  const worker = async () => {
    while (failed === undefined && next < items.length) {
      const item = items[next++]!;
      try {
        await work(item);
      } catch (err) {
        failed = err ?? new Error("failed");
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  if (failed !== undefined) throw failed;
}

/** Change the page's record and store it in the app. */
export async function saveClient(
  deps: Pick<DownloadDeps, "port" | "store">,
  change: (client: ClientRecord) => ClientRecord,
): Promise<void> {
  deps.store.update((s) => ({ client: change(s.client) }));
  await deps.port.setClient(deps.store.get().client);
}

function setDownload(store: OfflineStore, docId: string, progress: { done: number; total: number } | null): void {
  store.update((s) => {
    const downloads = { ...s.downloads };
    if (progress) downloads[docId] = progress;
    else delete downloads[docId];
    return { downloads };
  });
}

/**
 * Put a whole book in the app's copy: its detail, every section, the images its text names, its
 * cover and its highlights. The book is marked unfinished first, so a download cut short (the
 * computer went away) is finished by the next sync.
 */
export async function downloadBook(deps: DownloadDeps, docId: string): Promise<KeptBook> {
  const now = deps.now ?? (() => new Date().toISOString());
  const walk = deps.walker(docTag(docId));
  const doc = await walk.api.getDocument(docId);
  const before = deps.store.get().client.kept[docId];
  let book: KeptBook = {
    revisionId: before?.revisionId ?? "",
    title: doc.title,
    sections: doc.toc.length,
    at: now(),
    complete: false,
  };
  await saveClient(deps, (c) => ({ ...c, kept: { ...c.kept, [docId]: book } }));
  setDownload(deps.store, docId, { done: 0, total: doc.toc.length });
  try {
    const assets = new Set<string>(doc.coverUrl ? assetUrls(doc.coverUrl) : []);
    let revisionId = "";
    let done = 0;
    const chars = new Map<string, number>();
    await pool(doc.toc, SECTIONS_AT_ONCE, async (entry) => {
      const section = await walk.api.getSection(docId, entry.id);
      if (section.revisionId) revisionId = section.revisionId;
      chars.set(entry.id, textLength(section.html));
      for (const url of assetUrls(section.html)) assets.add(url);
      done += 1;
      setDownload(deps.store, docId, { done, total: doc.toc.length });
    });
    await pool([...assets], SECTIONS_AT_ONCE, (url) => walk.asset(url));
    await walk.api.listAnnotations(docId);
    const weights = doc.toc.map((entry): [string, number] => [entry.id, chars.get(entry.id) ?? 0]);
    book = { ...book, revisionId, weights, at: now(), complete: true };
    await saveClient(deps, (c) => ({ ...c, kept: { ...c.kept, [docId]: book } }));
    return book;
  } finally {
    setDownload(deps.store, docId, null);
  }
}

/** Fetch again what changes without a new file version: the book's detail (its place) and its highlights. */
export async function refreshBook(deps: DownloadDeps, docId: string): Promise<void> {
  const walk = deps.walker(docTag(docId));
  await walk.api.getDocument(docId);
  await walk.api.listAnnotations(docId);
}

/** Take a book out of the copy. */
export async function removeDownload(deps: Pick<DownloadDeps, "port" | "store">, docId: string): Promise<void> {
  await deps.port.drop(docTag(docId));
  await saveClient(deps, (c) => {
    const kept = { ...c.kept };
    delete kept[docId];
    return { ...c, kept };
  });
}
