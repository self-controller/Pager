import { beforeEach, describe, expect, it } from "vitest";
import type { PagerApi } from "@/api/client";
import { ApiError, ErrorCodes } from "@/api/types";
import { createOfflineApi } from "@/offline/api";
import type { NewAnnotation } from "@/offline/ops";
import { memoryPort, type MemoryPort } from "@/offline/port";
import { createOfflineStore, type OfflineStore } from "@/offline/state";
import { book, clock, fakeBackend, highlight, T0, type FakeBackend } from "./offline-fakes";

let backend: FakeBackend;
let port: MemoryPort;
let store: OfflineStore;
let api: PagerApi;

const place = { sectionId: "a-s1", offset: 0.25, percent: 0.6 };
const fresh = (id: string, text: string, extra: Partial<NewAnnotation> = {}): NewAnnotation => ({
  id,
  revisionId: "r1",
  sectionRange: { sectionId: "a-s0", start: 0, end: text.length },
  selectedText: text,
  ...extra,
});

/** The computer can't be reached, and the app has told the page so. */
function goOffline() {
  backend.up = false;
  store.set({ online: false });
}

beforeEach(() => {
  backend = fakeBackend();
  port = memoryPort(clock());
  store = createOfflineStore({ available: true, online: true });
  api = createOfflineApi(backend.api, port, store, { now: clock("2026-11-10T11:00:00.000Z") });
});

describe("while the computer is reachable", () => {
  it("everything goes straight through and nothing is queued", async () => {
    await api.saveProgress("a", place);
    const made = await api.createAnnotation("a", fresh("a-online001", "words"));
    await api.updateAnnotation(made.id, { color: "blue" });
    await api.deleteAnnotation(made.id);
    expect(backend.calls).toEqual([
      "saveProgress a",
      "createAnnotation a-online001",
      "updateAnnotation a-online001",
      "deleteAnnotation a-online001",
    ]);
    expect(port.outbox).toEqual([]);
    expect(store.get().outbox).toEqual([]);
  });

  it("gives a new annotation an id when the caller sent none, so a resend is safe", async () => {
    const { id: _id, ...noId } = fresh("unused", "words");
    const made = await api.createAnnotation("a", noId);
    expect(made.id).toMatch(/^a-[A-Za-z0-9_-]{8,}$/);
  });

  it("other failures are the caller's to see", async () => {
    backend.fail.set("saveProgress a", new ApiError(ErrorCodes.invalid, "No.", 400));
    await expect(api.saveProgress("a", place)).rejects.toMatchObject({ code: ErrorCodes.invalid });
    expect(port.outbox).toEqual([]);
  });
});

describe("a reading place saved while the computer is away", () => {
  beforeEach(goOffline);

  it("waits in the queue with its time, and is answered as saved", async () => {
    const saved = await api.saveProgress("a", place);
    expect(saved).toMatchObject({ docId: "a", sectionId: "a-s1", percent: 0.6, updatedAt: "2026-11-10T11:00:00.000Z" });
    expect(port.outbox).toHaveLength(1);
    expect(port.outbox[0]).toMatchObject({
      key: "progress:a",
      method: "PUT",
      path: "/api/documents/a/progress",
      body: { ...place, updatedAt: "2026-11-10T11:00:00.000Z" },
    });
    expect(store.get().outbox).toEqual(port.outbox);
    expect(backend.calls).toEqual([]);
  });

  it("for a downloaded book, carries the percent the computer will give it (by characters)", async () => {
    const kept = {
      revisionId: "r1",
      title: "Persuasion",
      sections: 2,
      at: T0,
      complete: true,
      weights: [
        ["a-s0", 100],
        ["a-s1", 900],
      ] as Array<[string, number]>,
    };
    store.set({ client: { v: 1, kept: { a: kept }, covers: {}, lastSyncedAt: null, failed: [] } });
    // The reader's own count says 60% (chapter 2 of 2); by characters it is 10% + a quarter of 90%.
    const saved = await api.saveProgress("a", place);
    expect(saved.percent).toBeCloseTo(0.325);
    expect((port.outbox[0]!.body as { percent: number }).percent).toBeCloseTo(0.325);
    // A book that isn't downloaded has no lengths: the reader's count stands until the computer answers.
    expect((await api.saveProgress("b", { sectionId: "b-s0", offset: 0, percent: 0.1 })).percent).toBe(0.1);
  });

  it("keeps one waiting place per book: the latest", async () => {
    await api.saveProgress("a", place);
    await api.saveProgress("a", { ...place, percent: 0.7 });
    await api.saveProgress("b", { sectionId: "b-s0", offset: 0, percent: 0.1 });
    expect(port.outbox.map((e) => [e.key, (e.body as { percent: number }).percent])).toEqual([
      ["progress:a", 0.7],
      ["progress:b", 0.1],
    ]);
  });

  it("is also queued when the page hadn't been told yet and the send finds the computer gone", async () => {
    store.set({ online: true });
    const saved = await api.saveProgress("a", place);
    expect(saved.percent).toBe(0.6);
    expect(port.outbox).toHaveLength(1);
  });
});

describe("what the lists show while a place waits", () => {
  it("the book, the documents list and the tree carry it", async () => {
    goOffline();
    await api.saveProgress("a", place);
    backend.up = true; // the copy answers reads; here the fake backend stands in for it
    expect((await api.getDocument("a")).progress).toMatchObject({ percent: 0.6 });
    expect((await api.getDocument("b")).progress).toBeUndefined();
    expect((await api.listDocuments()).find((d) => d.id === "a")?.lastOpenedAt).toBe("2026-11-10T11:00:00.000Z");
    expect((await api.getTree()).root.files.find((f) => f.docId === "a")?.doc?.progress?.percent).toBe(0.6);
  });

  it("the Book tab's history has a book first opened offline, last read first", async () => {
    backend.docs.set(
      "b",
      book("b", "Emma", 2, {
        lastOpenedAt: "2026-11-09T00:00:00.000Z",
        progress: { docId: "b", sectionId: "b-s0", offset: 0, percent: 0.2, updatedAt: "2026-11-09T00:00:00.000Z" },
      }),
    );
    goOffline();
    await api.saveProgress("a", place);
    backend.up = true;
    const history = await api.listDocuments({ history: true });
    expect(history.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("a later save that reaches the computer drops the older waiting place", async () => {
    goOffline();
    await api.saveProgress("a", place);
    backend.up = true;
    store.set({ online: true });
    await api.saveProgress("a", { ...place, percent: 0.8 });
    expect(port.outbox).toEqual([]);
    expect(backend.docs.get("a")?.progress?.percent).toBe(0.8);
  });
});

describe("highlights made while the computer is away", () => {
  beforeEach(() => {
    backend.annotations.set("a", [highlight("h1", "a", "kept from before")]);
  });

  it("a new one waits as it was sent, and shows in the book and in Highlights", async () => {
    await api.listAnnotations("a");
    goOffline();
    backend.up = true; // reads come from the copy
    store.set({ online: false });
    const made = await api.createAnnotation("a", fresh("a-offline01", "new words", { color: "green" }));
    expect(made).toMatchObject({ id: "a-offline01", color: "green", anchor: { quote: "new words" } });
    expect(port.outbox[0]).toMatchObject({
      key: "create:a-offline01",
      method: "POST",
      path: "/api/documents/a/annotations",
      body: { id: "a-offline01", selectedText: "new words" },
      meta: { docId: "a", docTitle: "Persuasion", sectionTitle: "Chapter 1" },
    });
    expect(backend.calls).not.toContain("createAnnotation a-offline01");
    expect((await api.listAnnotations("a")).map((a) => a.id)).toEqual(["h1", "a-offline01"]);
    const rows = await api.listHighlights();
    expect(rows[0]).toMatchObject({ id: "a-offline01", docTitle: "Persuasion", sectionTitle: "Chapter 1" });
  });

  it("changing a waiting one changes what will be sent", async () => {
    goOffline();
    await api.createAnnotation("a", fresh("a-offline01", "new words"));
    const changed = await api.updateAnnotation("a-offline01", { body: "my note", color: "pink" });
    expect(changed).toMatchObject({ id: "a-offline01", body: "my note", color: "pink" });
    expect(port.outbox).toHaveLength(1);
    expect(port.outbox[0]).toMatchObject({
      key: "create:a-offline01",
      body: { selectedText: "new words", body: "my note", color: "pink" },
    });
  });

  it("deleting a waiting one hides it, and undo brings it back", async () => {
    goOffline();
    await api.createAnnotation("a", fresh("a-offline01", "new words"));
    await api.deleteAnnotation("a-offline01");
    expect(port.outbox.map((e) => e.key)).toEqual(["create:a-offline01", "delete:a-offline01"]);
    backend.up = true;
    expect((await api.listAnnotations("a")).map((a) => a.id)).toEqual(["h1"]);
    const back = await api.restoreAnnotation("a-offline01");
    expect(back.anchor.quote).toBe("new words");
    expect(port.outbox.map((e) => e.key)).toEqual(["create:a-offline01"]);
    expect((await api.listAnnotations("a")).map((a) => a.id)).toEqual(["h1", "a-offline01"]);
  });

  it("a change to one the computer has waits as one change, the fields merged", async () => {
    await api.listAnnotations("a");
    goOffline();
    await api.updateAnnotation("h1", { color: "blue" });
    const changed = await api.updateAnnotation("h1", { body: "later thought" });
    expect(changed).toMatchObject({ id: "h1", color: "blue", body: "later thought" });
    expect(port.outbox).toHaveLength(1);
    expect(port.outbox[0]).toMatchObject({
      key: "patch:h1",
      method: "PATCH",
      path: "/api/annotations/h1",
      body: { color: "blue", body: "later thought" },
    });
    backend.up = true;
    expect((await api.listAnnotations("a"))[0]).toMatchObject({ color: "blue", body: "later thought" });
  });

  it("deleting one the computer has waits, hides it, and undo takes the delete back", async () => {
    await api.listAnnotations("a");
    goOffline();
    await api.deleteAnnotation("h1");
    expect(port.outbox[0]).toMatchObject({
      key: "delete:h1",
      method: "DELETE",
      path: "/api/annotations/h1",
      meta: { docId: "a" },
    });
    backend.up = true;
    expect(await api.listAnnotations("a")).toEqual([]);
    expect((await api.restoreAnnotation("h1")).id).toBe("h1");
    expect(port.outbox).toEqual([]);
  });

  it("moving a highlight, or bringing back one deleted earlier, needs the computer", async () => {
    await api.listAnnotations("a");
    goOffline();
    await expect(
      api.updateAnnotation("h1", { reattach: { sectionRange: { sectionId: "a-s0", start: 1, end: 2 } } }),
    ).rejects.toMatchObject({ code: ErrorCodes.unavailable });
    await expect(api.updateAnnotation("h1", { acceptAnchor: true })).rejects.toMatchObject({ code: ErrorCodes.unavailable });
    await expect(api.restoreAnnotation("h-gone")).rejects.toMatchObject({ code: ErrorCodes.unavailable });
    expect(port.outbox).toEqual([]);
  });

  it("once back online, a change to a highlight still waiting goes behind it, in order", async () => {
    goOffline();
    await api.createAnnotation("a", fresh("a-offline01", "new words"));
    backend.up = true;
    store.set({ online: true });
    await api.deleteAnnotation("a-offline01");
    expect(port.outbox.map((e) => e.key)).toEqual(["create:a-offline01", "delete:a-offline01"]);
    expect(backend.calls).not.toContain("deleteAnnotation a-offline01");
  });
});

describe("the queue read from the app", () => {
  it("reads and writes wait for it, so the first lists already carry what waited", async () => {
    port.outbox = [
      {
        seq: 4,
        at: T0,
        key: "progress:a",
        method: "PUT",
        path: "/api/documents/a/progress",
        body: { ...place, updatedAt: T0 },
        meta: { docId: "a" },
      },
    ];
    let loaded!: () => void;
    const ready = new Promise<void>((resolve) => (loaded = resolve));
    const late = createOfflineApi(backend.api, port, store, { ready });
    const pending = late.getDocument("a");
    store.set({ outbox: port.outbox });
    loaded();
    expect((await pending).progress?.percent).toBe(0.6);
  });

  it("the live stream's events also reach the copy's sync", () => {
    const seen: string[] = [];
    let emit: (e: never) => void = () => {};
    const inner = {
      ...backend.api,
      subscribe: (onEvent: (e: never) => void) => ((emit = onEvent), () => {}),
    } as unknown as PagerApi;
    const wrapped = createOfflineApi(inner, port, store, { onEvent: (e) => seen.push(`sync ${e.type}`) });
    wrapped.subscribe((e) => seen.push(`ui ${e.type}`));
    emit({ type: "tree.changed" } as never);
    expect(seen).toEqual(["ui tree.changed", "sync tree.changed"]);
  });
});
