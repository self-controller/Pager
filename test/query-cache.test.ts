import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashKey, QueryClient, QueryObserver } from "@tanstack/react-query";
import { annotationKeys, applySavedProgress, keepDataWhenAway, queryKeys } from "@/api/hooks";
import { ApiError, ErrorCodes } from "@/api/types";
import type { DocumentSummary, ReadingProgress, TreeResponse } from "@/api/types";
import { cacheStamp, createPersister, forStore, shouldPersist, STAMP_HASH, type Persister } from "@/cache/persist";
import { memoryCacheStore, type CacheEntry, type MemoryCacheStore } from "@/cache/store";
import { recentFiles } from "@/components/library/tree";
import { book, fakeBackend } from "./offline-fakes";

// The query cache kept between launches: what is stored, what never is, and how it comes back.

const STAMP = cacheStamp(1);
const T = new Date("2026-11-10T10:00:00.000Z").getTime();

let store: MemoryCacheStore;
let client: QueryClient;
let persister: Persister;

const stampEntry = (stamp = STAMP): CacheEntry => ({ hash: STAMP_HASH, key: [], data: stamp, updatedAt: T, usedAt: T });
const entry = (key: readonly unknown[], data: unknown, at = T - 60_000): CacheEntry => ({ hash: hashKey(key), key, data, updatedAt: at, usedAt: at });
const stored = () => [...store.entries.keys()].filter((h) => h !== STAMP_HASH).sort();
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });

/** A launch: a new client and persister over what the store holds. */
function launch(options: Partial<Parameters<typeof createPersister>[1]> = {}) {
  persister?.stop();
  client?.clear();
  client = newClient();
  persister = createPersister(client, { store, stamp: STAMP, ...options });
  return persister;
}

/** Let the debounce pass and the store's promises settle. */
const settle = (ms = 1100) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T);
  store = memoryCacheStore([stampEntry()]);
  launch();
});

afterEach(() => {
  persister.stop();
  client.clear();
  vi.useRealTimers();
});

describe("what is kept", () => {
  it("the library's lists, books, chapters, highlights, health and the Assistant's list; nothing else", () => {
    const kept = [
      queryKeys.tree,
      queryKeys.documents({ history: true }),
      queryKeys.document("a"),
      queryKeys.section("a", "s1"),
      annotationKeys.forDoc("a"),
      annotationKeys.highlights({}),
      annotationKeys.tags,
      queryKeys.health,
      queryKeys.contextList,
    ];
    const never = [
      queryKeys.pairing,
      queryKeys.devices,
      queryKeys.appSettings,
      queryKeys.search("emma"),
      queryKeys.job("j"),
      queryKeys.contextStatus,
      queryKeys.contextBriefing("a", "standard" as never),
      queryKeys.contextRun("r"),
      queryKeys.contextMedia(["Q1"]),
    ];
    expect(kept.filter((k) => !shouldPersist(k))).toEqual([]);
    expect(never.filter((k) => shouldPersist(k))).toEqual([]);
  });

  it("writes a changed query a second later, and only allow-listed ones", async () => {
    client.setQueryData(queryKeys.tree, { root: 1 });
    client.setQueryData(queryKeys.devices, [{ id: "d" }]);
    client.setQueryData(queryKeys.pairing, { open: true });
    client.setQueryData(queryKeys.contextRun("r"), { status: "running" });
    client.setQueryData(queryKeys.contextList, { books: [] });
    await settle(900);
    expect(stored()).toEqual([]);
    await settle(200);
    expect(stored()).toEqual([hashKey(queryKeys.contextList), hashKey(queryKeys.tree)].sort());
    const tree = store.entries.get(hashKey(queryKeys.tree))!;
    expect(tree.key).toEqual(["tree"]);
    expect(tree.data).toEqual({ root: 1 });
    expect(tree.updatedAt).toBe(client.getQueryState(queryKeys.tree)!.dataUpdatedAt);
  });

  it("each query waits for its own quiet second", async () => {
    client.setQueryData(queryKeys.tree, { root: 1 });
    await settle(600);
    client.setQueryData(annotationKeys.tags, []);
    client.setQueryData(queryKeys.tree, { root: 2 });
    await settle(600);
    // 1.2 s after the tree's first change: it changed again 0.6 s ago, so nothing yet.
    expect(stored()).toEqual([]);
    await settle(500);
    expect(store.entries.get(hashKey(queryKeys.tree))!.data).toEqual({ root: 2 });
    expect(stored()).toHaveLength(2);
  });

  it("writes a fetch that answered, not one that failed", async () => {
    await client.prefetchQuery({ queryKey: annotationKeys.tags, queryFn: async () => [{ tag: "x", count: 1 }] });
    await client.prefetchQuery({ queryKey: queryKeys.tree, queryFn: async () => Promise.reject(new Error("away")) });
    await settle();
    expect(stored()).toEqual([hashKey(annotationKeys.tags)]);
  });

  it("health is stored without the relay's token", async () => {
    const health = { app: "pager", apiVersion: 1, remote: { device: { id: "d", name: "iPhone" }, relay: "https://r", relayToken: "secret" } };
    client.setQueryData(queryKeys.health, health);
    await settle();
    expect(store.entries.get(hashKey(queryKeys.health))!.data).toEqual({
      app: "pager",
      apiVersion: 1,
      remote: { device: { id: "d", name: "iPhone" }, relay: "https://r" },
    });
    expect(JSON.stringify([...store.entries.values()])).not.toContain("secret");
    // In memory it is whole.
    expect(client.getQueryData(queryKeys.health)).toEqual(health);
    expect(forStore(queryKeys.health, { app: "pager", remote: null })).toEqual({ app: "pager", remote: null });
  });

  it("skips an entry over 2 MB, and drops the smaller one stored before it", async () => {
    client.setQueryData(queryKeys.section("a", "s1"), { html: "small" });
    client.setQueryData(queryKeys.section("a", "s2"), { html: "x".repeat(2 * 1024 * 1024) });
    await settle();
    expect(stored()).toEqual([hashKey(queryKeys.section("a", "s1"))]);
    client.setQueryData(queryKeys.section("a", "s1"), { html: "y".repeat(2 * 1024 * 1024 + 1) });
    await settle();
    expect(stored()).toEqual([]);
  });

  it("keeps the 60 chapters used last", async () => {
    for (let i = 0; i < 62; i++) {
      client.setQueryData(queryKeys.section("a", `s${i}`), { html: `${i}` });
      await settle(1100);
    }
    const kept = stored();
    expect(kept).toHaveLength(60);
    expect(kept).not.toContain(hashKey(queryKeys.section("a", "s0")));
    expect(kept).not.toContain(hashKey(queryKeys.section("a", "s1")));
    expect(kept).toContain(hashKey(queryKeys.section("a", "s2")));
    expect(kept).toContain(hashKey(queryKeys.section("a", "s61")));
  });

  it("a chapter opened again counts as used: an older one goes instead", async () => {
    launch({ maxSections: 2 });
    client.setQueryData(queryKeys.section("a", "s0"), { html: "0" });
    await settle(61_000);
    client.setQueryData(queryKeys.section("a", "s1"), { html: "1" });
    await settle(61_000);
    // The reader shows s0 again, from memory.
    const observer = new QueryObserver(client, { queryKey: queryKeys.section("a", "s0"), queryFn: async () => ({ html: "0" }), staleTime: Infinity });
    const off = observer.subscribe(() => {});
    await settle(1100);
    client.setQueryData(queryKeys.section("a", "s2"), { html: "2" });
    await settle(1100);
    off();
    expect(stored()).toEqual([hashKey(queryKeys.section("a", "s0")), hashKey(queryKeys.section("a", "s2"))].sort());
  });

  it("the cap counts the chapters stored by earlier launches", async () => {
    store = memoryCacheStore([stampEntry(), entry(queryKeys.section("a", "old1"), { html: "1" }, T - 5000), entry(queryKeys.section("a", "old2"), { html: "2" }, T - 4000)]);
    launch({ maxSections: 2 });
    await persister.restore();
    client.setQueryData(queryKeys.section("a", "new"), { html: "3" });
    await settle();
    expect(stored()).toEqual([hashKey(queryKeys.section("a", "new")), hashKey(queryKeys.section("a", "old2"))].sort());
  });

  it("a query collected from memory keeps its stored entry", async () => {
    client.setQueryData(queryKeys.tree, { root: 1 });
    client.setQueryData(queryKeys.section("a", "s1"), { html: "one" });
    await settle();
    client.removeQueries({ queryKey: queryKeys.tree });
    // gcTime passing does the same as removeQueries: a "removed" event.
    client.getQueryCache().remove(client.getQueryCache().find({ queryKey: queryKeys.section("a", "s1") })!);
    await settle(5000);
    expect(client.getQueryData(queryKeys.tree)).toBeUndefined();
    expect(stored()).toEqual([hashKey(queryKeys.section("a", "s1")), hashKey(queryKeys.tree)].sort());
  });

  it("flushes what is waiting when the page is hidden or goes away", async () => {
    client.setQueryData(queryKeys.tree, { root: 1 });
    window.dispatchEvent(new Event("pagehide"));
    await settle(0);
    expect(stored()).toEqual([hashKey(queryKeys.tree)]);

    client.setQueryData(annotationKeys.tags, []);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await settle(0);
    visibility.mockRestore();
    expect(stored()).toContain(hashKey(annotationKeys.tags));
  });
});

describe("restore", () => {
  it("puts the data in the client with its time, marked invalid, without fetching", async () => {
    const at = T - 3 * 60 * 60_000;
    store = memoryCacheStore([stampEntry(), entry(queryKeys.tree, { root: "kept" }, at), entry(queryKeys.section("a", "s1"), { html: "<p>kept</p>" }, at)]);
    launch();
    const fetching = vi.fn();
    client.getQueryCache().subscribe((e) => {
      if (e.type === "updated" && e.action.type === "fetch") fetching();
    });
    expect(await persister.restore()).toBe(2);
    expect(client.getQueryData(queryKeys.tree)).toEqual({ root: "kept" });
    const state = client.getQueryState(queryKeys.section("a", "s1"))!;
    expect(state.data).toEqual({ html: "<p>kept</p>" });
    expect(state.dataUpdatedAt).toBe(at);
    expect(state.isInvalidated).toBe(true);
    expect(state.fetchStatus).toBe("idle");
    expect(client.getQueryState(queryKeys.tree)!.isInvalidated).toBe(true);
    await settle(5000);
    expect(fetching).not.toHaveBeenCalled();
    // Restoring is not a change: nothing is written back.
    expect(store.entries.get(hashKey(queryKeys.tree))!.updatedAt).toBe(at);
  });

  it("the first use shows the kept data at once and fetches again, staleTime: Infinity included", async () => {
    store = memoryCacheStore([stampEntry(), entry(queryKeys.section("a", "s1"), { html: "old" })]);
    launch();
    await persister.restore();
    const queryFn = vi.fn(async () => ({ html: "new" }));
    const observer = new QueryObserver(client, { queryKey: queryKeys.section("a", "s1"), queryFn, staleTime: Infinity });
    const seen: unknown[] = [];
    const off = observer.subscribe((r) => seen.push(r.data));
    expect(observer.getCurrentResult().data).toEqual({ html: "old" });
    expect(observer.getCurrentResult().isPending).toBe(false);
    await settle(0);
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(observer.getCurrentResult().data).toEqual({ html: "new" });
    off();
    // And prefetchQuery does too: the warm pass refreshes what was restored.
    store = memoryCacheStore([stampEntry(), entry(queryKeys.tree, { root: "old" }, T - 1000)]);
    launch();
    await persister.restore();
    await client.prefetchQuery({ queryKey: queryKeys.tree, queryFn: async () => ({ root: "new" }), staleTime: 30_000 });
    expect(client.getQueryData(queryKeys.tree)).toEqual({ root: "new" });
  });

  it("a late restore doesn't overwrite what a fetch already put there", async () => {
    store = memoryCacheStore([stampEntry(), entry(queryKeys.tree, { root: "kept" }, T - 60_000), entry(annotationKeys.tags, ["kept"], T - 60_000)]);
    launch();
    // The page rendered first and the tree's fetch answered before the store was read.
    await client.prefetchQuery({ queryKey: queryKeys.tree, queryFn: async () => ({ root: "fresh" }) });
    expect(await persister.restore()).toBe(1);
    expect(client.getQueryData(queryKeys.tree)).toEqual({ root: "fresh" });
    expect(client.getQueryState(queryKeys.tree)!.isInvalidated).toBe(false);
    expect(client.getQueryData(annotationKeys.tags)).toEqual(["kept"]);
    await settle();
    expect(store.entries.get(hashKey(queryKeys.tree))!.data).toEqual({ root: "fresh" });
  });

  it("a fetch still going when the restore lands wins when it answers", async () => {
    store = memoryCacheStore([stampEntry(), entry(queryKeys.tree, { root: "kept" })]);
    launch();
    let answer!: (v: unknown) => void;
    const going = client.prefetchQuery({ queryKey: queryKeys.tree, queryFn: () => new Promise((r) => (answer = r)) });
    await persister.restore();
    expect(client.getQueryData(queryKeys.tree)).toEqual({ root: "kept" });
    answer({ root: "fresh" });
    await going;
    expect(client.getQueryData(queryKeys.tree)).toEqual({ root: "fresh" });
    expect(client.getQueryState(queryKeys.tree)!.isInvalidated).toBe(false);
  });

  it("another version's store is dropped", async () => {
    for (const stamp of [stampEntry(cacheStamp(0)), null]) {
      store = memoryCacheStore([...(stamp ? [stamp] : []), entry(queryKeys.tree, { root: "old shape" })]);
      launch();
      expect(await persister.restore()).toBe(0);
      expect(client.getQueryData(queryKeys.tree)).toBeUndefined();
      expect(stored()).toEqual([]);
      expect(store.entries.get(STAMP_HASH)!.data).toBe(STAMP);
    }
    expect(cacheStamp(1)).not.toBe(cacheStamp(2));
  });

  it("an entry that isn't allow-listed, is mislabelled or went unused for a month is dropped, not restored", async () => {
    store = memoryCacheStore([
      stampEntry(),
      entry(queryKeys.devices, [{ id: "d" }]),
      { ...entry(queryKeys.tree, { root: 1 }), hash: "not-the-hash" },
      entry(queryKeys.document("old"), { id: "old" }, T - 31 * 24 * 60 * 60_000),
      entry(queryKeys.document("a"), { id: "a" }),
    ]);
    launch();
    expect(await persister.restore()).toBe(1);
    await settle(0);
    expect(client.getQueryData(queryKeys.devices)).toBeUndefined();
    expect(client.getQueryData(queryKeys.tree)).toBeUndefined();
    expect(stored()).toEqual([hashKey(queryKeys.document("a"))]);
  });
});

describe("wipe", () => {
  it("drops everything stored, leaves memory, and stores nothing more", async () => {
    client.setQueryData(queryKeys.tree, { root: 1 });
    await settle();
    client.setQueryData(annotationKeys.tags, ["waiting"]);
    await persister.wipe();
    expect(stored()).toEqual([]);
    expect(store.entries.get(STAMP_HASH)!.data).toBe(STAMP);
    // On screen until the page goes to /pair.
    expect(client.getQueryData(queryKeys.tree)).toEqual({ root: 1 });
    client.setQueryData(queryKeys.tree, { root: 2 });
    await settle(5000);
    expect(stored()).toEqual([]);
    // The next launch starts empty and keeps things again.
    launch();
    expect(await persister.restore()).toBe(0);
    client.setQueryData(queryKeys.tree, { root: 3 });
    await settle();
    expect(stored()).toEqual([hashKey(queryKeys.tree)]);
  });

  it("a wipe comes after a write already on its way", async () => {
    client.setQueryData(queryKeys.tree, { root: 1 });
    window.dispatchEvent(new Event("pagehide"));
    await persister.wipe();
    await settle(0);
    expect(stored()).toEqual([]);
  });

  it("dropSections removes the stored chapters and nothing else", async () => {
    client.setQueryData(queryKeys.tree, { root: 1 });
    client.setQueryData(queryKeys.section("a", "s1"), { html: "1" });
    await settle();
    client.setQueryData(queryKeys.section("a", "s2"), { html: "2" });
    await persister.dropSections();
    await settle();
    expect(stored()).toEqual([hashKey(queryKeys.tree)]);
    expect(client.getQueryData(queryKeys.section("a", "s1"))).toEqual({ html: "1" });
  });
});

describe("a saved reading place", () => {
  const progress: ReadingProgress = { docId: "b", sectionId: "b-s1", offset: 0.5, percent: 0.4, updatedAt: "2026-11-10T12:00:00.000Z" };

  async function library() {
    const backend = fakeBackend([
      book("a", "Persuasion", 2, { lastOpenedAt: "2026-11-09T00:00:00.000Z" }),
      book("b", "Emma", 2, { lastOpenedAt: "2026-11-08T00:00:00.000Z" }),
      book("c", "Sanditon", 1),
    ]);
    client.setQueryData(queryKeys.tree, await backend.api.getTree());
    client.setQueryData(queryKeys.documents({ history: true }), await backend.api.listDocuments({ history: true }));
    client.setQueryData(queryKeys.documents({}), await backend.api.listDocuments({}));
  }

  it("is put on the cached tree and lists: the Library's Recent has the new order at once", async () => {
    await library();
    const before = client.getQueryData<TreeResponse>(queryKeys.tree)!;
    expect(recentFiles(before.root).map((f) => f.doc!.id)).toEqual(["a", "b"]);

    applySavedProgress(client, progress);

    const tree = client.getQueryData<TreeResponse>(queryKeys.tree)!;
    expect(recentFiles(tree.root).map((f) => f.doc!.id)).toEqual(["b", "a"]);
    const emma = tree.root.files.find((f) => f.docId === "b")!.doc!;
    expect(emma.progress).toEqual(progress);
    expect(emma.lastOpenedAt).toBe(progress.updatedAt);
    // The other books are the same objects: their rows don't render again.
    expect(tree.root.files.find((f) => f.docId === "a")).toBe(before.root.files.find((f) => f.docId === "a"));

    // History is last read first (the Book tab opens the first); the full list keeps its order.
    expect(client.getQueryData<DocumentSummary[]>(queryKeys.documents({ history: true }))!.map((d) => d.id)).toEqual(["b", "a"]);
    const all = client.getQueryData<DocumentSummary[]>(queryKeys.documents({}))!;
    expect(all.map((d) => d.id)).toEqual(["a", "b", "c"]);
    expect(all[1]!.progress).toEqual(progress);
  });

  it("an older place doesn't replace a newer one (as the offline overlay has it)", async () => {
    await library();
    applySavedProgress(client, progress);
    const tree = client.getQueryData(queryKeys.tree);
    applySavedProgress(client, { ...progress, percent: 0.1, updatedAt: "2026-11-10T11:00:00.000Z" });
    expect(client.getQueryData(queryKeys.tree)).toBe(tree);
    expect(client.getQueryData<DocumentSummary[]>(queryKeys.documents({}))![1]!.progress!.percent).toBe(0.4);
  });

  it("the patch is not a fetch: the tree stays as stale, or as invalid, as it was", async () => {
    await library();
    const at = client.getQueryState(queryKeys.tree)!.dataUpdatedAt;
    await settle(10_000);
    applySavedProgress(client, progress);
    expect(client.getQueryState(queryKeys.tree)!.dataUpdatedAt).toBe(at);
    expect(client.getQueryState(queryKeys.tree)!.isInvalidated).toBe(false);

    await client.invalidateQueries({ queryKey: queryKeys.tree, refetchType: "none" });
    applySavedProgress(client, { ...progress, percent: 0.6, updatedAt: "2026-11-10T12:05:00.000Z" });
    expect(client.getQueryState(queryKeys.tree)!.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.tree)!.dataUpdatedAt).toBe(at);
    // And the patched tree is what the next launch gets.
    await settle();
    const kept = store.entries.get(hashKey(queryKeys.tree))!.data as TreeResponse;
    expect(kept.root.files.find((f) => f.docId === "b")!.doc!.progress!.percent).toBe(0.6);
  });
});

describe("a refresh that fails with the computer out of reach", () => {
  const observe = async (queryFn: () => Promise<unknown>) => {
    const observer = new QueryObserver(client, { queryKey: queryKeys.tree, queryFn, retry: false });
    const off = observer.subscribe(() => {});
    await settle(0);
    off();
    return keepDataWhenAway(observer.getCurrentResult());
  };
  const away = () => Promise.reject(new ApiError(ErrorCodes.unavailable, "The reading service isn't reachable right now.", 503));

  it("keeps showing what was restored: no error over the data", async () => {
    store = memoryCacheStore([stampEntry(), entry(queryKeys.tree, { root: "kept" })]);
    launch();
    await persister.restore();
    const result = await observe(away);
    expect(client.getQueryState(queryKeys.tree)!.status).toBe("error");
    expect(result.data).toEqual({ root: "kept" });
    expect(result.error).toBeNull();
    expect(result.isError).toBe(false);
    expect(result.status).toBe("success");
    // Still marked: the next use asks again.
    expect(client.getQueryState(queryKeys.tree)!.isInvalidated).toBe(true);
    // And the failed refresh didn't touch the stored entry.
    await settle();
    expect(store.entries.get(hashKey(queryKeys.tree))!.data).toEqual({ root: "kept" });
  });

  it("with nothing to show, the error is the page's to show", async () => {
    const result = await observe(away);
    expect(result.data).toBeUndefined();
    expect(result.error).toBeInstanceOf(ApiError);
  });

  it("another failure is passed on, data or not (a book that was removed)", async () => {
    client.setQueryData(queryKeys.tree, { root: "kept" });
    await client.invalidateQueries({ queryKey: queryKeys.tree, refetchType: "none" });
    const result = await observe(() => Promise.reject(new ApiError(ErrorCodes.notFound, "No such document.", 404)));
    expect(result.isError).toBe(true);
    expect((result.error as ApiError).code).toBe(ErrorCodes.notFound);
  });
});
