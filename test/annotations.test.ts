import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { annotationKeys, applyServerEvent, newAnnotationId, queryKeys } from "@/api/hooks";
import { createHttpApi, followStream, highlightQueryString, streamUrl } from "@/api/http";
import { createMockApi } from "@/api/mock";
import type { JournalEvent } from "@/api/types";
import { blockOffsetOf, indexText, leafBlocks, rangeAtBlockOffset, rangeForOffsets } from "@/components/reader/dom";
import { annotationsAt, highlightName } from "@/components/reader/useHighlightPainting";

function body(html: string): HTMLDivElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe("section offsets ↔ DOM ranges", () => {
  it("maps textContent offsets across element boundaries", () => {
    const root = body("<p>Hello <em>brave</em> world</p><p>Second</p>");
    const index = indexText(root);
    expect(index.length).toBe(root.textContent!.length);
    expect(rangeForOffsets(index, 6, 20)!.toString()).toBe("brave worldSec");
    expect(rangeForOffsets(index, 0, 5)!.toString()).toBe("Hello");
    // Starting exactly at a node boundary begins in the next node.
    const r = rangeForOffsets(index, 6, 11)!;
    expect(r.startContainer.textContent).toBe("brave");
    expect(rangeForOffsets(index, 5, 5)).toBeNull();
    expect(rangeForOffsets(index, 0, 999)).toBeNull();
    root.remove();
  });
});

describe("block points (API.md coordinate rule)", () => {
  it("skips [data-atom] and counts <br> as one character", () => {
    const root = body('<p data-b="b1">Ab<sup data-atom=""><a href="#n1">1</a></sup>cd<br>ef</p>');
    const block = root.querySelector("[data-b]")!;
    const texts = indexText(block).nodes; // "Ab", "1", "cd", "ef"
    expect(blockOffsetOf(block, texts[0]!, 1)).toBe(1);
    expect(blockOffsetOf(block, texts[2]!, 0)).toBe(2); // the footnote label is skipped
    expect(blockOffsetOf(block, texts[3]!, 1)).toBe(6); // "Abcd" + "\n" + "e"
    expect(rangeAtBlockOffset(block, 5)!.toString()).toBe("e");
    expect(rangeAtBlockOffset(block, 99)!.toString()).toBe("f");
    root.remove();
  });

  it("finds leaf blocks only", () => {
    const root = body('<blockquote data-b="q"><p data-b="p1">a</p><p data-b="p2">b</p></blockquote><p data-b="p3">c</p>');
    expect(leafBlocks(root).map((b) => b.getAttribute("data-b"))).toEqual(["p1", "p2", "p3"]);
    root.remove();
  });
});

describe("painting helpers", () => {
  const a = (id: string, start: number, end: number, extra: object = {}) =>
    ({ id, color: "yellow", style: "highlight", anchor: { segments: [{ sectionId: "s0", start, end }] }, ...extra }) as never;

  it("names registry entries by colour and style", () => {
    expect(highlightName({ color: "green", style: "highlight" })).toBe("reader-green");
    expect(highlightName({ color: null, style: "underline" })).toBe("reader-underline-yellow");
    expect(highlightName({ color: "blue", style: "none" })).toBeNull();
  });

  it("hit-tests a click offset against painted segments", () => {
    const list = [a("x", 0, 10), a("y", 5, 15)];
    expect(annotationsAt(list, "s0", 7).map((h: { id: string }) => h.id)).toEqual(["x", "y"]);
    expect(annotationsAt(list, "s0", 12).map((h: { id: string }) => h.id)).toEqual(["y"]);
    expect(annotationsAt(list, "s1", 7)).toEqual([]);
    expect(annotationsAt(list, "s0", 15)).toEqual([]); // end is exclusive
  });

  it("makes client ids the server accepts", () => {
    expect(newAnnotationId()).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});

describe("mock annotations", () => {
  const range = (start: number, end: number) => ({ sectionId: "s0", start, end });

  it("creates, lists, edits, deletes and restores", async () => {
    const api = createMockApi({ storage: null });
    const text = "One dollar and eighty-seven cents.";
    const a = await api.createAnnotation("gift-of-the-magi", {
      id: "client-id-1",
      sectionRange: range(0, 10),
      selectedText: text.slice(0, 10),
    });
    expect(a).toMatchObject({
      id: "client-id-1",
      kind: "highlight",
      color: "yellow",
      anchor: { status: "anchored", quote: "One dollar" },
    });
    expect(a.anchor.segments).toEqual([range(0, 10)]);

    // Same client id again: idempotent.
    expect((await api.createAnnotation("gift-of-the-magi", { id: "client-id-1", sectionRange: range(0, 10) })).id).toBe(
      "client-id-1",
    );
    expect(await api.listAnnotations("gift-of-the-magi")).toHaveLength(1);

    const edited = await api.updateAnnotation("client-id-1", {
      color: "blue",
      body: "Della counts twice.",
      kind: "note",
      tags: ["money"],
    });
    expect(edited).toMatchObject({ color: "blue", body: "Della counts twice.", kind: "note" });

    const lib = await api.listHighlights();
    expect(lib[0]).toMatchObject({
      docTitle: "The Gift of the Magi",
      sectionTitle: "The Gift of the Magi",
      href: "/read/gift-of-the-magi/s0",
    });
    expect(await api.listHighlights({ q: "twice" })).toHaveLength(1);
    expect(await api.listHighlights({ q: "nowhere" })).toHaveLength(0);
    expect(await api.listTags()).toEqual([{ tag: "money", count: 1 }]);

    await api.deleteAnnotation("client-id-1");
    expect(await api.listAnnotations("gift-of-the-magi")).toHaveLength(0);
    expect(await api.listHighlights()).toHaveLength(0);
    await api.restoreAnnotation("client-id-1");
    expect(await api.listAnnotations("gift-of-the-magi")).toHaveLength(1);
  });

  it("rejects a selection whose text does not match", async () => {
    const api = createMockApi({ storage: null });
    await expect(
      api.createAnnotation("gift-of-the-magi", { sectionRange: range(0, 10), selectedText: "Something else" }),
    ).rejects.toMatchObject({ code: "selection_mismatch", status: 409 });
  });

  it("orders a document's annotations by position", async () => {
    const api = createMockApi({ storage: null });
    await api.createAnnotation("jane-eyre", { sectionRange: { sectionId: "s1", start: 5, end: 9 } });
    await api.createAnnotation("jane-eyre", { sectionRange: { sectionId: "s0", start: 20, end: 30 } });
    const list = await api.listAnnotations("jane-eyre");
    expect(list.map((a) => a.anchor.sectionId)).toEqual(["s0", "s1"]);
  });
});

describe("http: annotations and stream", () => {
  it("calls the annotation routes", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    const api = createHttpApi("/api", fetchMock as unknown as typeof fetch);
    await api.listAnnotations("d1");
    await api.createAnnotation("d1", { sectionRange: { sectionId: "s", start: 0, end: 1 } });
    await api.updateAnnotation("a1", { color: "pink" });
    await api.restoreAnnotation("a1");
    await api.listHighlights({ q: "truth", docId: "d1" });
    await api.listTags();
    const calls = fetchMock.mock.calls.map(
      (c) => `${(c as unknown as [string, RequestInit?])[1]?.method ?? "GET"} ${(c as unknown as [string])[0]}`,
    );
    expect(calls).toEqual([
      "GET /api/documents/d1/annotations",
      "POST /api/documents/d1/annotations",
      "PATCH /api/annotations/a1",
      "POST /api/annotations/a1/restore",
      "GET /api/highlights?q=truth&docId=d1",
      "GET /api/tags",
    ]);
    expect(highlightQueryString()).toBe("");
  });

  it("follows the stream, closes while hidden and resumes from the last seq", () => {
    const opened: FakeSource[] = [];
    class FakeSource {
      url: string;
      listeners = new Map<string, (e: MessageEvent) => void>();
      onmessage: ((e: MessageEvent) => void) | null = null;
      closed = false;
      constructor(url: string) {
        this.url = url;
        opened.push(this);
      }
      addEventListener(type: string, fn: (e: MessageEvent) => void) {
        this.listeners.set(type, fn);
      }
      close() {
        this.closed = true;
      }
      emit(type: string, seq: number, data: object) {
        this.listeners.get(type)?.(new MessageEvent(type, { data: JSON.stringify(data), lastEventId: String(seq) }));
      }
    }
    const seen: JournalEvent[] = [];
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);

    const stop = followStream("/api", (e) => seen.push(e), FakeSource as unknown as typeof EventSource);
    expect(opened[0]!.url).toBe("/api/stream");
    opened[0]!.emit("revision.created", 41, { seq: 41, type: "revision.created", docId: "d1" });
    expect(seen.map((e) => e.seq)).toEqual([41]);

    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(opened[0]!.closed).toBe(true);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(opened[1]!.url).toBe(streamUrl("/api", "41"));
    expect(opened[1]!.url).toBe("/api/stream?after=41");

    stop();
    expect(opened[1]!.closed).toBe(true);
    vi.restoreAllMocks();
  });
});

describe("applyServerEvent", () => {
  const event = (type: string, docId: string | null, payload: object = {}) =>
    ({ seq: 1, at: "", origin: "server", type, v: 1, docId, subjectId: null, payload }) as JournalEvent;

  it("refetches the changed sections, the document and its annotations on a new revision", () => {
    const qc = new QueryClient();
    for (const key of [
      queryKeys.section("d1", "s1"),
      queryKeys.section("d1", "s2"),
      queryKeys.document("d1"),
      annotationKeys.forDoc("d1"),
    ]) {
      qc.setQueryData(key, {});
    }
    applyServerEvent(qc, event("revision.created", "d1", { changedSectionIds: ["s1"], removedSectionIds: [] }));
    const stale = (key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated;
    expect(stale(queryKeys.section("d1", "s1"))).toBe(true);
    expect(stale(queryKeys.section("d1", "s2"))).toBe(false);
    expect(stale(queryKeys.document("d1"))).toBe(true);
    expect(stale(annotationKeys.forDoc("d1"))).toBe(true);
  });

  it("refetches annotations when they are re-anchored", () => {
    const qc = new QueryClient();
    qc.setQueryData(annotationKeys.forDoc("d1"), []);
    qc.setQueryData(queryKeys.section("d1", "s1"), {});
    applyServerEvent(qc, event("annotations.reanchored", "d1", { revisionId: "r2", results: [] }));
    expect(qc.getQueryState(annotationKeys.forDoc("d1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(queryKeys.section("d1", "s1"))?.isInvalidated).toBe(false);
  });
});
