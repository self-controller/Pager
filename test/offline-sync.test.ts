import { beforeEach, describe, expect, it } from "vitest";
import { ApiError, ErrorCodes } from "@/api/types";
import { createOfflineApi } from "@/offline/api";
import { emptyClient, memoryPort, readClient, type MemoryPort } from "@/offline/port";
import { createOfflineStore, canOpen, keptState, type OfflineStore } from "@/offline/state";
import { createSync, type SyncReport } from "@/offline/sync";
import { book, clock, fakeBackend, type FakeBackend } from "./offline-fakes";

let backend: FakeBackend;
let port: MemoryPort;
let store: OfflineStore;
let walked: string[];
let reports: SyncReport[];
let sync: ReturnType<typeof createSync>;

const kept = (revisionId: string, complete = true) => ({
  revisionId,
  title: "t",
  sections: 2,
  at: "2026-11-09T00:00:00.000Z",
  complete,
});

beforeEach(() => {
  backend = fakeBackend([
    book("a", "Persuasion", 2, { coverUrl: "/api/assets/cover-a.jpg" }),
    book("b", "Emma", 2, { coverUrl: "/api/assets/cover-b.jpg" }),
    book("c", "Sanditon", 1),
  ]);
  port = memoryPort(clock());
  store = createOfflineStore({ available: true, online: true });
  walked = [];
  reports = [];
  sync = createSync({
    inner: backend.api,
    port,
    store,
    now: clock("2026-11-10T11:00:00.000Z"),
    onDone: (r) => reports.push(r),
    walker: (tag) => ({
      api: {
        getDocument: (id) => (walked.push(`${tag}: getDocument ${id}`), backend.api.getDocument(id)),
        getSection: (d, s) => (walked.push(`${tag}: getSection ${s}`), backend.api.getSection(d, s)),
        listAnnotations: (id) => (walked.push(`${tag}: listAnnotations ${id}`), backend.api.listAnnotations(id)),
      },
      asset: async (url) => {
        if (!backend.up) throw new ApiError(ErrorCodes.unavailable, "gone", 503);
        walked.push(`${tag}: asset ${url}`);
      },
    }),
  });
});

describe("a sync pass", () => {
  it("with nothing downloaded: the lists and every cover, and the time", async () => {
    await sync.request("start");
    expect(backend.calls).toEqual([
      "getSyncManifest",
      "getTree",
      "listDocuments",
      "listDocuments history",
      "listHighlights",
      "listTags",
      "getHealth",
      "listContextBriefings",
    ]);
    expect(walked).toEqual(["shell: asset /api/assets/cover-a.jpg", "shell: asset /api/assets/cover-b.jpg"]);
    expect(store.get().client).toMatchObject({
      covers: { a: "/api/assets/cover-a.jpg", b: "/api/assets/cover-b.jpg" },
      lastSyncedAt: "2026-11-10T11:00:00.000Z",
    });
    expect(readClient(port.client).lastSyncedAt).toBe("2026-11-10T11:00:00.000Z");
    expect(reports).toEqual([{ reason: "start", sent: 0, changed: [] }]);
    expect(store.get().syncing).toBe(false);
  });

  it("fetches a cover once, and again only when the book's cover changed", async () => {
    await sync.request("start");
    walked.length = 0;
    await sync.request("online");
    expect(walked).toEqual([]);
    backend.docs.set("a", book("a", "Persuasion", 2, { coverUrl: "/api/assets/cover-a2.jpg" }));
    await sync.request("online");
    expect(walked).toEqual(["shell: asset /api/assets/cover-a2.jpg"]);
  });

  it("sends what waited before it looks at anything", async () => {
    const api = createOfflineApi(backend.api, port, store);
    backend.up = false;
    store.set({ online: false });
    await api.saveProgress("a", { sectionId: "a-s1", offset: 0.5, percent: 0.6 });
    backend.up = true;
    store.set({ online: true });
    await sync.request("online");
    expect(backend.calls.slice(0, 2)).toEqual(["saveProgress a", "getSyncManifest"]);
    expect(port.outbox).toEqual([]);
    expect(reports[0]).toMatchObject({ reason: "online", sent: 1 });
  });

  it("stops when sending finds the computer gone, and leaves the copy as it was", async () => {
    const api = createOfflineApi(backend.api, port, store);
    backend.up = false;
    store.set({ online: false });
    await api.saveProgress("a", { sectionId: "a-s1", offset: 0.5, percent: 0.6 });
    await sync.request("online");
    expect(backend.calls).toEqual([]);
    expect(port.outbox).toHaveLength(1);
    expect(reports).toEqual([]);
    expect(store.get().client.lastSyncedAt).toBeNull();
    expect(store.get().syncing).toBe(false);
  });

  it("checks each downloaded book against the computer's files", async () => {
    store.set({ client: { ...emptyClient(), kept: { a: kept("r1"), b: kept("r0"), c: kept("r1", false), gone: kept("r1") } } });
    backend.revisions.set("b", "r2");
    await sync.request("online");
    // a is as it was: its place and highlights again. b's file changed: all of it again.
    expect(walked.filter((w) => w.startsWith("doc:a: "))).toEqual(["doc:a: getDocument a", "doc:a: listAnnotations a"]);
    expect(walked.filter((w) => w.startsWith("doc:b: ")).sort()).toEqual([
      "doc:b: asset /api/assets/cover-b.jpg",
      "doc:b: getDocument b",
      "doc:b: getSection b-s0",
      "doc:b: getSection b-s1",
      "doc:b: listAnnotations b",
    ]);
    // c was cut short last time: finished now. "gone" left the library: taken out of the copy.
    expect(walked).toContain("doc:c: getSection c-s0");
    expect(port.dropped).toEqual(["doc:gone"]);
    const client = store.get().client;
    expect(Object.keys(client.kept).sort()).toEqual(["a", "b", "c"]);
    expect(client.kept.b).toMatchObject({ revisionId: "r2", complete: true });
    expect(client.kept.c).toMatchObject({ revisionId: "r1", complete: true });
    expect(reports[0]?.changed.sort()).toEqual(["b", "c", "gone"]);
  });

  it("one book's own trouble doesn't stop the others", async () => {
    store.set({ client: { ...emptyClient(), kept: { a: kept("r0"), b: kept("r0") } } });
    backend.fail.set("getSection a-s1", new ApiError("unprocessable", "The file couldn't be read.", 422));
    await sync.request("online");
    expect(store.get().client.kept.a?.complete).toBe(false);
    expect(store.get().client.kept.b?.complete).toBe(true);
    expect(store.get().client.lastSyncedAt).not.toBeNull();
  });

  it("the computer going away mid-pass stops it; the next pass finishes", async () => {
    store.set({ client: { ...emptyClient(), kept: { a: kept("r0"), b: kept("r0") } } });
    backend.fail.set("getSection a-s1", new ApiError(ErrorCodes.unavailable, "gone", 503));
    await sync.request("online");
    expect(store.get().client.kept.a?.complete).toBe(false);
    expect(store.get().client.kept.b).toEqual(kept("r0"));
    expect(reports).toEqual([]);
    backend.fail.clear();
    await sync.request("online");
    expect(store.get().client.kept.a).toMatchObject({ revisionId: "r1", complete: true });
    expect(store.get().client.kept.b).toMatchObject({ revisionId: "r1", complete: true });
    expect(reports).toHaveLength(1);
  });

  it("asked again while it runs, it runs once more afterwards, not twice at once", async () => {
    const first = sync.request("event");
    const second = sync.request("online");
    const third = sync.request("event");
    expect(second).toBe(first);
    expect(third).toBe(first);
    await first;
    // The pass that refreshes everything on screen isn't replaced by a lesser reason.
    expect(reports.map((r) => r.reason)).toEqual(["event", "online"]);
    expect(backend.calls.filter((c) => c === "getSyncManifest")).toHaveLength(2);
  });
});

describe("what can be opened", () => {
  it("everything while the computer may be reachable; only finished downloads when it isn't", () => {
    const client = { ...emptyClient(), kept: { a: kept("r1"), c: kept("r1", false) } };
    const browser = createOfflineStore().get();
    expect(canOpen(browser, "b")).toBe(true);
    const online = createOfflineStore({ available: true, online: true, client }).get();
    const unknown = createOfflineStore({ available: true, online: null, client }).get();
    const offline = createOfflineStore({ available: true, online: false, client }).get();
    expect([canOpen(online, "b"), canOpen(unknown, "b")]).toEqual([true, true]);
    expect([canOpen(offline, "a"), canOpen(offline, "b"), canOpen(offline, "c")]).toEqual([true, false, false]);
    expect([keptState(offline, "a"), keptState(offline, "b"), keptState(offline, "c")]).toEqual(["kept", false, "partial"]);
  });
});
