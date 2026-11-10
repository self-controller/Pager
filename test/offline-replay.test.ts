import { beforeEach, describe, expect, it } from "vitest";
import { ApiError, ErrorCodes } from "@/api/types";
import { createOfflineApi } from "@/offline/api";
import type { NewAnnotation } from "@/offline/ops";
import { memoryPort, type MemoryPort } from "@/offline/port";
import { replayOutbox } from "@/offline/replay";
import { createOfflineStore, type OfflineStore } from "@/offline/state";
import { book, clock, fakeBackend, highlight, type FakeBackend } from "./offline-fakes";

let backend: FakeBackend;
let port: MemoryPort;
let store: OfflineStore;

const fresh = (id: string, text: string, extra: Partial<NewAnnotation> = {}): NewAnnotation => ({
  id,
  revisionId: "r1",
  sectionRange: { sectionId: "a-s0", start: 0, end: text.length },
  selectedText: text,
  ...extra,
});

/** Make changes with the computer away, as the reader would, then bring it back. */
async function whileAway(work: (api: ReturnType<typeof createOfflineApi>) => Promise<void>) {
  const api = createOfflineApi(backend.api, port, store, { now: clock("2026-11-10T11:00:00.000Z") });
  backend.up = false;
  store.set({ online: false });
  await work(api);
  backend.up = true;
  store.set({ online: true });
  backend.calls.length = 0;
}

const replay = () => replayOutbox(backend.api, port, store, clock("2026-11-10T13:00:00.000Z"));

beforeEach(() => {
  backend = fakeBackend();
  backend.annotations.set("a", [highlight("h1", "a", "from before")]);
  backend.made.set("h1", "{}");
  port = memoryPort(clock());
  store = createOfflineStore({ available: true, online: true });
});

describe("replayOutbox", () => {
  it("sends what waited, oldest first, and empties the queue", async () => {
    await whileAway(async (api) => {
      await api.saveProgress("a", { sectionId: "a-s1", offset: 0.5, percent: 0.6 });
      await api.createAnnotation("a", fresh("a-offline01", "new words"));
      await api.createAnnotation("a", fresh("a-offline02", "more words"));
      await api.deleteAnnotation("a-offline02");
    });
    const result = await replay();
    expect(result).toEqual({ sent: 4, failed: 0, stopped: false });
    expect(backend.calls).toEqual([
      "saveProgress a",
      "createAnnotation a-offline01",
      "createAnnotation a-offline02",
      "deleteAnnotation a-offline02",
    ]);
    expect(port.outbox).toEqual([]);
    expect(store.get().outbox).toEqual([]);
    expect(backend.docs.get("a")?.progress).toMatchObject({ percent: 0.6, updatedAt: "2026-11-10T11:00:00.000Z" });
    expect(backend.annotations.get("a")?.map((a) => a.id)).toEqual(["h1", "a-offline01"]);
  });

  it("stops when the computer goes away again and keeps the rest, in order", async () => {
    await whileAway(async (api) => {
      await api.createAnnotation("a", fresh("a-offline01", "new words"));
      await api.createAnnotation("a", fresh("a-offline02", "more words"));
    });
    backend.fail.set("createAnnotation a-offline02", new ApiError(ErrorCodes.unavailable, "gone", 503));
    expect(await replay()).toEqual({ sent: 1, failed: 0, stopped: true });
    expect(port.outbox.map((e) => e.key)).toEqual(["create:a-offline02"]);
    backend.fail.clear();
    expect(await replay()).toEqual({ sent: 1, failed: 0, stopped: false });
    expect(port.outbox).toEqual([]);
  });

  it("keeps everything when this phone isn't paired any more", async () => {
    await whileAway((api) => api.createAnnotation("a", fresh("a-offline01", "new words")).then(() => {}));
    backend.fail.set("createAnnotation a-offline01", new ApiError(ErrorCodes.unauthorized, "Pair this phone.", 401));
    expect(await replay()).toMatchObject({ sent: 0, stopped: true });
    expect(port.outbox).toHaveLength(1);
  });

  it("a place the computer has a newer one for is let go", async () => {
    await whileAway((api) => api.saveProgress("a", { sectionId: "a-s1", offset: 0.5, percent: 0.6 }).then(() => {}));
    // Read further on the computer, later, while the phone was away.
    const later = { docId: "a", sectionId: "a-s1", offset: 0.9, percent: 0.9, updatedAt: "2026-11-10T12:30:00.000Z" };
    backend.docs.set("a", book("a", "Persuasion", 2, { progress: later }));
    expect(await replay()).toEqual({ sent: 1, failed: 0, stopped: false });
    expect(backend.docs.get("a")?.progress?.percent).toBe(0.9);
    expect(port.outbox).toEqual([]);
    expect(store.get().client.failed).toEqual([]);
  });

  it("a change or delete of something already gone on the computer is let go", async () => {
    const api = createOfflineApi(backend.api, port, store);
    await api.listAnnotations("a");
    await whileAway(async (away) => {
      await away.listAnnotations("a").catch(() => {});
    });
    backend.up = false;
    store.set({ online: false });
    await api.updateAnnotation("h1", { color: "blue" });
    backend.up = true;
    backend.annotations.set("a", []);
    expect(await replay()).toEqual({ sent: 1, failed: 0, stopped: false });
    expect(store.get().client.failed).toEqual([]);
  });

  it("a highlight that reached the computer before, then changed, is sent as a change", async () => {
    // The first send arrived but its answer was lost, so it stayed in the queue; then the note was added.
    await whileAway(async (api) => {
      await api.createAnnotation("a", fresh("a-offline01", "new words"));
    });
    await backend.api.createAnnotation("a", fresh("a-offline01", "new words"));
    backend.calls.length = 0;
    const api = createOfflineApi(backend.api, port, store);
    await api.updateAnnotation("a-offline01", { body: "my note" });
    expect(port.outbox).toHaveLength(1);
    expect(await replay()).toEqual({ sent: 1, failed: 0, stopped: false });
    expect(backend.calls).toEqual(["createAnnotation a-offline01", "updateAnnotation a-offline01"]);
    expect(backend.annotations.get("a")?.find((a) => a.id === "a-offline01")?.body).toBe("my note");
  });

  it("a highlight the computer refuses for good is kept with its words, and the rest still goes", async () => {
    await whileAway(async (api) => {
      await api.createAnnotation("a", fresh("a-offline01", "words that changed"));
      await api.createAnnotation("a", fresh("a-offline02", "words still there"));
    });
    backend.fail.set(
      "createAnnotation a-offline01",
      new ApiError("stale_revision", "That passage has changed since the page was loaded.", 409),
    );
    expect(await replay()).toEqual({ sent: 1, failed: 1, stopped: false });
    expect(port.outbox).toEqual([]);
    const failed = store.get().client.failed;
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      code: "stale_revision",
      at: "2026-11-10T13:00:00.000Z",
      entry: { key: "create:a-offline01", body: { selectedText: "words that changed" } },
    });
    // Stored in the app, so it survives a restart.
    expect((port.client as { failed: unknown[] }).failed).toHaveLength(1);
    expect(backend.annotations.get("a")?.map((a) => a.id)).toEqual(["h1", "a-offline02"]);
  });

  it("an entry it can't read is dropped rather than blocking the queue", async () => {
    await port.enqueue({ key: "odd", method: "POST", path: "/api/files", body: {}, meta: { docId: "" } });
    store.set({ outbox: (await port.state()).outbox });
    expect(await replay()).toEqual({ sent: 0, failed: 0, stopped: false });
    expect(port.outbox).toEqual([]);
  });
});
