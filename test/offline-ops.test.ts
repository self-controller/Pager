import { describe, expect, it } from "vitest";
import type { LibraryAnnotation, TreeResponse } from "@/api/types";
import {
  annotationPath,
  annotationsPath,
  createKey,
  deleteKey,
  docTag,
  overlayAnnotations,
  overlayHighlights,
  overlayProgress,
  overlayTree,
  parseEntry,
  patchKey,
  pendingOps,
  percentAt,
  progressKey,
  progressPath,
  textLength,
} from "@/offline/ops";
import type { OutboxEntry } from "@/offline/port";
import { book, highlight } from "./offline-fakes";

const AT = "2026-11-10T10:00:00.000Z";

function progressEntry(seq: number, docId: string, updatedAt: string, percent = 0.5): OutboxEntry {
  return {
    seq,
    at: updatedAt,
    key: progressKey(docId),
    method: "PUT",
    path: progressPath(docId),
    body: { sectionId: `${docId}-s1`, offset: 0.2, percent, updatedAt },
    meta: { docId },
  };
}

function createEntry(seq: number, docId: string, id: string, text: string, extra: object = {}): OutboxEntry {
  return {
    seq,
    at: AT,
    key: createKey(id),
    method: "POST",
    path: annotationsPath(docId),
    body: { id, sectionRange: { sectionId: `${docId}-s0`, start: 3, end: 3 + text.length }, selectedText: text, ...extra },
    meta: { docId, docTitle: "Persuasion", sectionTitle: "Chapter 1" },
  };
}

const patchEntry = (seq: number, id: string, body: object): OutboxEntry => ({
  seq,
  at: AT,
  key: patchKey(id),
  method: "PATCH",
  path: annotationPath(id),
  body,
  meta: { docId: "a" },
});
const deleteEntry = (seq: number, id: string): OutboxEntry => ({
  seq,
  at: AT,
  key: deleteKey(id),
  method: "DELETE",
  path: annotationPath(id),
  meta: { docId: "a" },
});

describe("queue entries", () => {
  it("are read back as what they do", () => {
    const ops = pendingOps([
      progressEntry(1, "a b", AT),
      createEntry(2, "a b", "a-12345678", "words"),
      patchEntry(3, "x/1", { color: "blue" }),
      deleteEntry(4, "x/1"),
    ]);
    expect(ops.map((o) => o.type)).toEqual(["progress", "create", "patch", "delete"]);
    expect(ops[0]).toMatchObject({ docId: "a b", update: { percent: 0.5, updatedAt: AT } });
    expect(ops[1]).toMatchObject({ docId: "a b", id: "a-12345678" });
    expect(ops[2]).toMatchObject({ id: "x/1", patch: { color: "blue" } });
    expect(ops[3]).toMatchObject({ id: "x/1" });
  });

  it("an entry this page doesn't know is skipped, not guessed at", () => {
    expect(
      parseEntry({ seq: 1, at: AT, key: "k", method: "POST", path: "/api/files", body: {}, meta: { docId: "" } }),
    ).toBeNull();
    // A place with no time can't be weighed against the computer's.
    expect(parseEntry({ ...progressEntry(1, "a", AT), body: { sectionId: "s", offset: 0, percent: 0 } })).toBeNull();
    expect(parseEntry({ ...progressEntry(1, "a", AT), path: "/api/documents/%E0%A4%A/progress" })).toBeNull();
  });

  it("a book's tag is plain ASCII, as it travels in a header", () => {
    expect(docTag("café/1")).toBe("doc:caf%C3%A9%2F1");
  });
});

describe("overlayAnnotations", () => {
  const list = [highlight("h1", "a", "first"), highlight("h2", "a", "second")];

  it("returns the same list when nothing waits for it", () => {
    expect(overlayAnnotations(list, [], "a")).toBe(list);
    expect(overlayAnnotations(list, pendingOps([progressEntry(1, "a", AT), createEntry(2, "b", "a-otherbook", "x")]), "a")).toBe(
      list,
    );
  });

  it("adds a waiting highlight, last, with its words and place", () => {
    const out = overlayAnnotations(list, pendingOps([createEntry(1, "a", "a-newone01", "third", { color: "green" })]), "a");
    expect(out.map((a) => a.id)).toEqual(["h1", "h2", "a-newone01"]);
    expect(out[2]).toMatchObject({
      color: "green",
      createdAt: AT,
      anchor: { quote: "third", sectionId: "a-s0", segments: [{ sectionId: "a-s0", start: 3, end: 8 }] },
    });
    expect(list).toHaveLength(2);
  });

  it("doesn't add one the computer already lists", () => {
    const out = overlayAnnotations(list, pendingOps([createEntry(1, "a", "h1", "first")]), "a");
    expect(out.map((a) => a.id)).toEqual(["h1", "h2"]);
  });

  it("applies a waiting change and a waiting delete", () => {
    const out = overlayAnnotations(
      list,
      pendingOps([patchEntry(1, "h1", { color: "pink", body: "a note" }), deleteEntry(2, "h2")]),
      "a",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "h1", color: "pink", body: "a note", updatedAt: AT });
    expect(list[0]!.color).toBe("yellow");
  });

  it("a delete that follows its own create hides it", () => {
    const out = overlayAnnotations(
      list,
      pendingOps([createEntry(1, "a", "a-newone01", "third"), deleteEntry(2, "a-newone01")]),
      "a",
    );
    expect(out.map((a) => a.id)).toEqual(["h1", "h2"]);
  });
});

describe("overlayHighlights", () => {
  const rows: LibraryAnnotation[] = [
    { ...highlight("h1", "a", "first"), docTitle: "Persuasion", sectionTitle: "Chapter 1", href: "/read/a/a-s0" },
  ];

  it("puts a waiting highlight first, with its book and chapter", () => {
    const out = overlayHighlights(rows, pendingOps([createEntry(1, "a", "a-newone01", "third")]));
    expect(out.map((a) => a.id)).toEqual(["a-newone01", "h1"]);
    expect(out[0]).toMatchObject({ docTitle: "Persuasion", sectionTitle: "Chapter 1", href: "/read/a/a-s0" });
  });

  it("keeps to the page's filter", () => {
    const ops = pendingOps([
      createEntry(1, "a", "a-newone01", "third", { tags: ["love"] }),
      createEntry(2, "b", "a-newone02", "other"),
    ]);
    expect(overlayHighlights(rows, ops, { docId: "b" }).map((a) => a.id)).toEqual(["a-newone02", "h1"]);
    expect(overlayHighlights([], ops, { tag: "love" }).map((a) => a.id)).toEqual(["a-newone01"]);
    expect(overlayHighlights([], ops, { q: "OTH" }).map((a) => a.id)).toEqual(["a-newone02"]);
  });

  it("leaves bookmarks out and returns the same list when nothing applies", () => {
    expect(overlayHighlights(rows, pendingOps([createEntry(1, "a", "a-newone01", "", { kind: "bookmark" })]))).toEqual(rows);
    expect(overlayHighlights(rows, pendingOps([progressEntry(1, "a", AT)]))).toBe(rows);
  });
});

describe("how far through the book", () => {
  // A short title page, a short contents page, then the chapters: as real books are.
  const weights: Array<[string, number]> = [
    ["title", 100],
    ["contents", 100],
    ["one", 4900],
    ["two", 4900],
  ];

  it("is by characters, as the computer counts it, not by chapter", () => {
    expect(percentAt(weights, "title", 0)).toBe(0);
    expect(percentAt(weights, "one", 0)).toBeCloseTo(0.02);
    expect(percentAt(weights, "one", 0.5)).toBeCloseTo(0.265);
    expect(percentAt(weights, "two", 1)).toBe(1);
    expect(percentAt(weights, "two", 7)).toBe(1);
  });

  it("is unknown for a section it has no length for", () => {
    expect(percentAt(weights, "three", 0.5)).toBeNull();
    expect(percentAt([["a", 0]], "a", 0.5)).toBeNull();
  });

  it("a section's length is its text, without the tags", () => {
    expect(textLength('<p data-b="b1">One <em>two</em></p><img src="/api/assets/x.png" alt="">')).toBe(7);
    expect(textLength("")).toBe(0);
  });
});

describe("reading places", () => {
  it("a waiting place shows when it is the newer one", () => {
    const doc = book("a", "Persuasion", 2, {
      progress: { docId: "a", sectionId: "a-s0", offset: 0, percent: 0.1, updatedAt: "2026-11-10T09:00:00.000Z" },
    });
    const out = overlayProgress(doc, pendingOps([progressEntry(1, "a", AT, 0.6)]));
    expect(out.progress).toMatchObject({ sectionId: "a-s1", percent: 0.6, updatedAt: AT });
    expect(out.lastOpenedAt).toBe(AT);
    expect(doc.progress!.percent).toBe(0.1);
  });

  it("an older waiting place doesn't hide a newer one from the computer", () => {
    const doc = book("a", "Persuasion", 2, {
      progress: { docId: "a", sectionId: "a-s0", offset: 0, percent: 0.9, updatedAt: "2026-11-10T11:00:00.000Z" },
    });
    expect(overlayProgress(doc, pendingOps([progressEntry(1, "a", AT)]))).toBe(doc);
    expect(overlayProgress(doc, pendingOps([progressEntry(1, "b", AT)]))).toBe(doc);
  });

  it("the library tree carries it on the book, and is the same tree when nothing waits", () => {
    const a = book("a", "Persuasion");
    const b = book("b", "Emma");
    const file = (d: typeof a) => ({
      kind: "file" as const,
      name: d.title,
      path: d.title,
      format: "epub",
      size: 1,
      modifiedAt: AT,
      docId: d.id,
      doc: d,
    });
    const tree: TreeResponse = {
      truncated: false,
      root: {
        kind: "folder",
        name: "",
        path: "",
        fileCount: 2,
        files: [file(a)],
        folders: [{ kind: "folder", name: "Austen", path: "Austen", fileCount: 1, folders: [], files: [file(b)] }],
      },
    };
    expect(overlayTree(tree, [])).toBe(tree);
    expect(overlayTree(tree, pendingOps([progressEntry(1, "zzz", AT)]))).toBe(tree);
    const out = overlayTree(tree, pendingOps([progressEntry(1, "b", AT, 0.4)]));
    expect(out.root.files[0]).toBe(tree.root.files[0]);
    expect(out.root.folders[0]!.files[0]!.doc!.progress!.percent).toBe(0.4);
    expect(tree.root.folders[0]!.files[0]!.doc!.progress).toBeUndefined();
  });
});
