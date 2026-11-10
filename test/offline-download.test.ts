import { beforeEach, describe, expect, it } from "vitest";
import { ApiError, ErrorCodes } from "@/api/types";
import { assetUrls, downloadBook, pool, refreshBook, removeDownload, type DownloadDeps } from "@/offline/download";
import { memoryPort, type MemoryPort } from "@/offline/port";
import { createOfflineStore, type OfflineStore } from "@/offline/state";
import { book, clock, fakeBackend, type FakeBackend } from "./offline-fakes";

let backend: FakeBackend;
let port: MemoryPort;
let store: OfflineStore;
let deps: DownloadDeps;
/** Every request a walk made, as "tag: call". */
let walked: string[];

beforeEach(() => {
  backend = fakeBackend([book("a", "Persuasion", 3, { coverUrl: "/api/assets/cover-a.jpg" }), book("b", "Emma", 1)]);
  backend.html.set("a-s0", '<p>One <img src="/api/assets/abc123.png" alt=""> and <img src="/api/assets/def456.jpg"></p>');
  backend.html.set("a-s2", '<p>Again <img src="/api/assets/abc123.png"> and elsewhere <img src="https://example.com/x.png"></p>');
  port = memoryPort(clock());
  store = createOfflineStore({ available: true, online: true });
  walked = [];
  deps = {
    port,
    store,
    now: clock("2026-11-10T11:00:00.000Z"),
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
  };
});

describe("assetUrls", () => {
  it("finds the computer's own images, once each", () => {
    expect(assetUrls(backend.html.get("a-s0")! + backend.html.get("a-s2")!)).toEqual([
      "/api/assets/abc123.png",
      "/api/assets/def456.jpg",
    ]);
    expect(assetUrls("<p>No pictures</p>")).toEqual([]);
  });
});

describe("pool", () => {
  it("runs a few at a time and stops at the first failure", async () => {
    let running = 0;
    let most = 0;
    const done: number[] = [];
    await pool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      most = Math.max(most, ++running);
      await Promise.resolve();
      done.push(n);
      running -= 1;
    });
    expect(most).toBe(2);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6]);
    const started: number[] = [];
    await expect(
      pool([1, 2, 3, 4, 5, 6], 1, async (n) => {
        started.push(n);
        if (n === 2) throw new Error("no");
      }),
    ).rejects.toThrow("no");
    expect(started).toEqual([1, 2]);
  });
});

describe("downloadBook", () => {
  it("fetches the whole book under its tag: detail, every section, its pictures, its cover, its highlights", async () => {
    const kept = await downloadBook(deps, "a");
    expect(walked.every((w) => w.startsWith("doc:a: "))).toBe(true);
    const calls = walked.map((w) => w.slice("doc:a: ".length));
    expect(calls[0]).toBe("getDocument a");
    expect(calls.filter((c) => c.startsWith("getSection")).sort()).toEqual([
      "getSection a-s0",
      "getSection a-s1",
      "getSection a-s2",
    ]);
    expect(calls.filter((c) => c.startsWith("asset")).sort()).toEqual([
      "asset /api/assets/abc123.png",
      "asset /api/assets/cover-a.jpg",
      "asset /api/assets/def456.jpg",
    ]);
    expect(calls.at(-1)).toBe("listAnnotations a");
    // Each section's text length, in reading order: "One  and " (the tags don't count), "Chapter 2", "Again  and elsewhere ".
    expect(kept).toEqual({
      revisionId: "r1",
      title: "Persuasion",
      sections: 3,
      weights: [
        ["a-s0", 9],
        ["a-s1", 9],
        ["a-s2", 21],
      ],
      at: "2026-11-10T11:00:01.000Z",
      complete: true,
    });
    expect(store.get().client.kept).toEqual({ a: kept });
    expect((port.client as { kept: object }).kept).toEqual({ a: kept });
    expect(store.get().downloads).toEqual({});
  });

  it("says how far it is while it runs", async () => {
    const seen: string[] = [];
    store.subscribe(() => {
      const d = store.get().downloads.a;
      if (d) seen.push(`${d.done}/${d.total}`);
    });
    await downloadBook(deps, "a");
    expect(seen[0]).toBe("0/3");
    expect(seen).toContain("3/3");
  });

  it("cut short, the book stays marked unfinished for the next sync", async () => {
    backend.fail.set("getSection a-s1", new ApiError(ErrorCodes.unavailable, "gone", 503));
    await expect(downloadBook(deps, "a")).rejects.toMatchObject({ code: ErrorCodes.unavailable });
    expect(store.get().client.kept.a).toMatchObject({ complete: false, title: "Persuasion" });
    expect((port.client as { kept: { a: { complete: boolean } } }).kept.a.complete).toBe(false);
    expect(store.get().downloads).toEqual({});
  });

  it("a book that isn't in the library isn't marked at all", async () => {
    await expect(downloadBook(deps, "nope")).rejects.toMatchObject({ code: ErrorCodes.notFound });
    expect(store.get().client.kept).toEqual({});
  });
});

describe("refreshBook and removeDownload", () => {
  it("a refresh fetches the place and the highlights again, under the book's tag", async () => {
    await refreshBook(deps, "b");
    expect(walked).toEqual(["doc:b: getDocument b", "doc:b: listAnnotations b"]);
  });

  it("removing takes the book's answers out of the app and forgets it", async () => {
    await downloadBook(deps, "a");
    await downloadBook(deps, "b");
    await removeDownload(deps, "a");
    expect(port.dropped).toEqual(["doc:a"]);
    expect(Object.keys(store.get().client.kept)).toEqual(["b"]);
    expect(Object.keys((port.client as { kept: object }).kept)).toEqual(["b"]);
  });
});
