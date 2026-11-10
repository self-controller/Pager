// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashKey, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DocumentDetail, Section } from "@/api/types";
import { book, fakeBackend, type FakeBackend } from "./offline-fakes";

// The warm pass: it must fetch exactly what the pages' hooks will ask for, and stay out of the way.

const spy = vi.hoisted(() => ({ api: undefined as unknown }));
vi.mock("@/api", async (original) => ({
  ...(await original<typeof import("@/api")>()),
  get api() {
    return spy.api;
  },
}));

const hooks = await import("@/api/hooks");
const { queryKeys, annotationKeys } = hooks;
const { warmTabs, prefetchBook, startTabWarmth, isTabList, WARM_BOOKS } = await import("@/cache/warm");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let backend: FakeBackend;
let client: QueryClient;

const opened = (id: string, title: string, day: number, extra: Partial<DocumentDetail> = {}) =>
  book(id, title, 4, { lastOpenedAt: `2026-11-0${day}T00:00:00.000Z`, ...extra });

/** The fake backend's chapters, linked as the server links them. */
function withNeighbours(b: FakeBackend) {
  const getSection = b.api.getSection;
  b.api.getSection = async (docId, sectionId): Promise<Section> => {
    const section = await getSection(docId, sectionId);
    const toc = b.docs.get(docId)!.toc;
    return { ...section, prevId: toc[section.index - 1]?.id, nextId: toc[section.index + 1]?.id };
  };
  b.api.listTags = async () => (b.calls.push("listTags"), []);
  b.api.listContextBriefings = async () => (b.calls.push("listContextBriefings"), { books: [] }) as never;
}

beforeEach(() => {
  backend = fakeBackend([
    opened("a", "Persuasion", 9, { progress: { docId: "a", sectionId: "a-s2", offset: 0, percent: 0.5, updatedAt: "2026-11-09T00:00:00.000Z" } }),
    opened("b", "Emma", 8),
    opened("c", "Sanditon", 7, { progress: { docId: "c", sectionId: "c-s1", offset: 0, percent: 0.3, updatedAt: "2026-11-07T00:00:00.000Z" } }),
    opened("d", "Lady Susan", 6),
    opened("e", "Evelina", 5),
    opened("f", "Cecilia", 4),
    opened("g", "Camilla", 3),
    book("h", "Never opened", 2),
  ]);
  withNeighbours(backend);
  spy.api = backend.api;
  // The app's own times (App.tsx): fresh for 30 s, kept in memory for a day.
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, gcTime: 24 * 60 * 60_000 } } });
});

afterEach(() => {
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const cached = () => client.getQueryCache().getAll().map((q) => q.queryHash).sort();

describe("warmTabs", () => {
  it("fetches the tabs' lists, the Book tab's book and the next five", async () => {
    await warmTabs(client);
    const expected = [
      queryKeys.tree,
      queryKeys.documents({ history: true }),
      queryKeys.documents({}),
      annotationKeys.highlights({}),
      annotationKeys.tags,
      queryKeys.contextList,
      // The Book tab opens the book read last: its saved chapter, the two beside it, its highlights.
      queryKeys.document("a"),
      queryKeys.section("a", "a-s2"),
      queryKeys.section("a", "a-s1"),
      queryKeys.section("a", "a-s3"),
      annotationKeys.forDoc("a"),
      // The next five: the document and the chapter the reader would open (saved place, else the first).
      queryKeys.document("b"),
      queryKeys.section("b", "b-s0"),
      queryKeys.document("c"),
      queryKeys.section("c", "c-s1"),
      queryKeys.document("d"),
      queryKeys.section("d", "d-s0"),
      queryKeys.document("e"),
      queryKeys.section("e", "e-s0"),
      queryKeys.document("f"),
      queryKeys.section("f", "f-s0"),
    ];
    expect(WARM_BOOKS).toBe(5);
    expect(cached()).toEqual(expected.map((k) => hashKey(k)).sort());
    expect(backend.calls).not.toContain("getDocument g");
    expect(backend.calls).not.toContain("getDocument h");
    expect(client.getQueryData<Section>(queryKeys.section("a", "a-s2"))!.title).toBe("Chapter 3");
  });

  it("the pages' own hooks then ask for nothing: the keys are theirs", async () => {
    await warmTabs(client);
    const before = backend.calls.length;
    const pending: string[] = [];
    function Tabs() {
      const results = {
        tree: hooks.useTree(),
        history: hooks.useDocuments({ history: true }),
        // ContextHome: useDocuments(); HighlightsPage with no filter: useHighlights({}).
        documents: hooks.useDocuments(),
        highlights: hooks.useHighlights({}),
        tags: hooks.useTags(),
        briefings: hooks.useContextBriefings(),
        // The reader, opened from the Book tab.
        document: hooks.useDocument("a"),
        section: hooks.useSection("a", "a-s2"),
        next: hooks.useSection("a", "a-s3"),
        annotations: hooks.useAnnotations("a"),
      };
      for (const [name, r] of Object.entries(results)) if (r.isPending || r.isFetching) pending.push(name);
      return null;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Tabs))));
    await act(async () => {});
    root.unmount();
    expect(pending).toEqual([]);
    expect(backend.calls.slice(before)).toEqual([]);
  });

  it("a second pass fetches nothing while everything is fresh", async () => {
    await warmTabs(client);
    const before = backend.calls.length;
    await warmTabs(client);
    expect(backend.calls.slice(before)).toEqual([]);
  });

  it("onlyInvalid: fetches what was invalidated, whatever the age of the rest", async () => {
    vi.useFakeTimers();
    await warmTabs(client);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await client.invalidateQueries({ queryKey: queryKeys.allDocuments, refetchType: "none" });
    const before = backend.calls.length;
    await warmTabs(client, { onlyInvalid: true });
    expect(backend.calls.slice(before).sort()).toEqual(["listDocuments", "listDocuments history"]);
    // A full pass after ten minutes fetches the lists and the books again, but not the chapters.
    const full = backend.calls.length;
    await warmTabs(client);
    const again = backend.calls.slice(full);
    expect(again).toContain("getTree");
    expect(again).toContain("getDocument a");
    expect(again).toContain("getDocument b");
    expect(again.filter((c) => c.startsWith("getSection"))).toEqual([]);
  });

  it("does nothing while the page is hidden", async () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await warmTabs(client);
    expect(backend.calls).toEqual([]);
    expect(cached()).toEqual([]);
  });

  it("stops after the lists when the page is hidden meanwhile", async () => {
    let hidden = false;
    const listTags = backend.api.listTags;
    backend.api.listTags = async () => {
      hidden = true;
      return listTags();
    };
    await warmTabs(client, { hidden: () => hidden });
    expect(backend.calls.filter((c) => c.startsWith("getDocument"))).toEqual([]);
  });

  it("two calls don't overlap: the second joins the first", async () => {
    const first = warmTabs(client);
    const second = warmTabs(client);
    expect(second).toBe(first);
    await first;
    expect(backend.calls.filter((c) => c === "getTree")).toHaveLength(1);
    expect(backend.calls.filter((c) => c === "getDocument a")).toHaveLength(1);
    // Once it is over, another may start.
    expect(warmTabs(client)).not.toBe(first);
  });

  it("a computer out of reach is not an error, and the next pass tries again", async () => {
    backend.up = false;
    await expect(warmTabs(client)).resolves.toBeUndefined();
    expect(client.getQueryData(queryKeys.tree)).toBeUndefined();
    backend.up = true;
    await warmTabs(client);
    expect(client.getQueryData(queryKeys.tree)).toBeDefined();
    expect(client.getQueryData(queryKeys.section("a", "a-s2"))).toBeDefined();
  });

  it("the Book tab's book is the first that can be opened (computer away: the downloaded one)", async () => {
    await warmTabs(client, { canOpen: (id) => id === "c" });
    expect(backend.calls.filter((c) => c.startsWith("getDocument"))).toEqual(["getDocument c"]);
    expect(client.getQueryData(annotationKeys.forDoc("c"))).toBeDefined();
    expect(client.getQueryData(queryKeys.section("c", "c-s0"))).toBeDefined();
    expect(client.getQueryData(queryKeys.section("c", "c-s2"))).toBeDefined();
  });

  it("loads the Assistant's code", async () => {
    const preload = vi.fn();
    await warmTabs(client, { preload });
    expect(preload).toHaveBeenCalledTimes(1);
  });
});

describe("a press on a book in the Library", () => {
  it("fetches its document and the chapter its link names, at once and side by side", async () => {
    const done = prefetchBook(client, "c", { sectionId: "c-s1" });
    // Both are asked for before either answers: the chapter doesn't wait for the document.
    expect(client.isFetching({ queryKey: queryKeys.document("c") })).toBe(1);
    expect(client.isFetching({ queryKey: queryKeys.section("c", "c-s1") })).toBe(1);
    expect(await done).toBe("c-s1");
    expect(backend.calls.sort()).toEqual(["getDocument c", "getSection c-s1"]);
  });

  it("with no saved place: the document, then its first chapter", async () => {
    expect(await prefetchBook(client, "b")).toBe("b-s0");
    expect(backend.calls).toEqual(["getDocument b", "getSection b-s0"]);
  });
});

describe("when the passes run", () => {
  let warm: ReturnType<typeof vi.fn<(qc: QueryClient, options?: { onlyInvalid?: boolean }) => Promise<void>>>;
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    warm = vi.fn(async () => {});
    stop = startTabWarmth(client, warm);
  });
  afterEach(() => stop());

  it("shortly after the first paint", async () => {
    expect(warm).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1600);
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it("when the page is shown again, not when it is hidden", async () => {
    await vi.advanceTimersByTimeAsync(1600);
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(warm).toHaveBeenCalledTimes(1);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(warm).toHaveBeenCalledTimes(2);
  });

  it("2 s after a tab's list is invalidated with nothing showing it, at most every 20 s", async () => {
    await vi.advanceTimersByTimeAsync(1600);
    warm.mockClear();
    client.setQueryData(queryKeys.documents({}), []);
    client.setQueryData(queryKeys.document("a"), {});
    // A fetch answers (the pass before did it), then a save marks the lists again.
    const invalidate = () => {
      client.setQueryData(queryKeys.documents({}), []);
      return client.invalidateQueries({ queryKey: queryKeys.allDocuments, refetchType: "none" });
    };

    // A chapter or a book's own entry isn't a tab's list.
    await client.invalidateQueries({ queryKey: queryKeys.document("a"), refetchType: "none" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(warm).not.toHaveBeenCalled();

    await invalidate();
    await vi.advanceTimersByTimeAsync(1900);
    expect(warm).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(warm).toHaveBeenCalledTimes(1);
    expect(warm.mock.calls[0]![1]).toEqual({ onlyInvalid: true });

    // Reading: a save every 3 s invalidates the lists each time.
    for (let i = 0; i < 6; i++) {
      await invalidate();
      await vi.advanceTimersByTimeAsync(3000);
    }
    expect(warm).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2100);
    expect(warm).toHaveBeenCalledTimes(2);
  });

  it("not for a list a page is showing (it refetches itself), and not after stop", async () => {
    await vi.advanceTimersByTimeAsync(1600);
    warm.mockClear();
    const { QueryObserver } = await import("@tanstack/react-query");
    const off = new QueryObserver(client, { queryKey: queryKeys.tree, queryFn: async () => ({}) }).subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    await client.invalidateQueries({ queryKey: queryKeys.tree, refetchType: "none" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(warm).not.toHaveBeenCalled();
    off();
    stop();
    await client.invalidateQueries({ queryKey: queryKeys.tree, refetchType: "none" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(warm).not.toHaveBeenCalled();
  });

  it("knows the tabs' lists", () => {
    expect([queryKeys.tree, queryKeys.documents({}), annotationKeys.highlights({}), annotationKeys.tags, queryKeys.contextList].every(isTabList)).toBe(true);
    expect([queryKeys.document("a"), queryKeys.section("a", "s"), queryKeys.contextStatus, queryKeys.health].some(isTabList)).toBe(false);
  });
});
