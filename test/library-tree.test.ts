import { describe, expect, it } from "vitest";
import type { TreeFile, TreeFolder } from "@/api/types";
import { breadcrumbsFor, cleanRel, describeFolder, folderAt, progressOf, sortFiles, splitRanges, stemOf } from "@/components/library/tree";

const file = (name: string, path: string, doc?: Partial<TreeFile["doc"]>): TreeFile => ({
  kind: "file",
  name,
  path,
  format: "md",
  size: 1,
  modifiedAt: "2026-10-01T00:00:00.000Z",
  ...(doc
    ? {
        docId: "d",
        doc: { id: "d", kind: "article", format: "md", title: stemOf(name).stem, sourceId: "reads", sourceName: "Reads", addedAt: "2026-10-01T00:00:00.000Z", saved: false, ...doc },
      }
    : {}),
});

const folder = (name: string, path: string, folders: TreeFolder[] = [], files: TreeFile[] = []): TreeFolder => ({
  kind: "folder",
  name,
  path,
  folders,
  files,
  fileCount: files.length + folders.reduce((n, f) => n + f.fileCount, 0),
});

describe("library tree helpers", () => {
  it("cleans folder paths from the URL", () => {
    expect(cleanRel("")).toBe("");
    expect(cleanRel("/Novels//Brontë/")).toBe("Novels/Brontë");
    expect(cleanRel("../etc/./x")).toBe("etc/x");
    expect(cleanRel("a\\b")).toBe("a/b");
  });

  it("finds folders and builds breadcrumbs", () => {
    const root = folder("", "", [folder("Novels", "Novels", [folder("Brontë", "Novels/Brontë")])]);
    expect(folderAt(root, "")).toBe(root);
    expect(folderAt(root, "Novels/Brontë")?.name).toBe("Brontë");
    expect(folderAt(root, "Novels/Austen")).toBeUndefined();
    expect(breadcrumbsFor("Novels/Brontë")).toEqual([
      { name: "Novels", path: "Novels" },
      { name: "Brontë", path: "Novels/Brontë" },
    ]);
    expect(breadcrumbsFor("")).toEqual([]);
    expect(describeFolder(folder("", "", [folder("A", "A", [], [file("x.md", "A/x.md")])], [file("y.md", "y.md")]))).toBe("1 folder · 2 books");
  });

  it("sorts books by name, recency, date added and progress", () => {
    const a = file("Beta.md", "Beta.md", { title: "Beta", addedAt: "2026-10-02T00:00:00.000Z", lastOpenedAt: "2026-10-05T00:00:00.000Z", progress: { docId: "d", sectionId: "s", offset: 0, percent: 0.2, updatedAt: "" } });
    const b = file("alpha.md", "alpha.md", { title: "alpha", addedAt: "2026-10-03T00:00:00.000Z" });
    const c = file("Gamma.md", "Gamma.md", { title: "Gamma", addedAt: "2026-10-01T00:00:00.000Z", lastOpenedAt: "2026-10-04T00:00:00.000Z", progress: { docId: "d", sectionId: "s", offset: 0, percent: 0.9, updatedAt: "" } });
    const names = (list: TreeFile[]) => list.map((f) => f.name);
    expect(names(sortFiles([a, b, c], "name"))).toEqual(["alpha.md", "Beta.md", "Gamma.md"]);
    expect(names(sortFiles([a, b, c], "recent"))).toEqual(["Beta.md", "Gamma.md", "alpha.md"]);
    expect(names(sortFiles([a, b, c], "added"))).toEqual(["alpha.md", "Beta.md", "Gamma.md"]);
    expect(names(sortFiles([a, b, c], "progress"))).toEqual(["Gamma.md", "Beta.md", "alpha.md"]);
  });

  it("labels progress as New, a percentage, or Finished", () => {
    expect(progressOf(undefined)).toEqual({ label: "New" });
    expect(progressOf({ id: "d", kind: "article", format: "md", title: "t", sourceId: "r", sourceName: "R", addedAt: "", saved: false })).toEqual({ label: "New" });
    const base = { id: "d", kind: "article" as const, format: "md", title: "t", sourceId: "r", sourceName: "R", addedAt: "", saved: false, lastOpenedAt: "x" };
    expect(progressOf({ ...base, progress: { docId: "d", sectionId: "s", offset: 0, percent: 0.004, updatedAt: "" } })).toEqual({ percent: 0.004, label: "1%" });
    expect(progressOf({ ...base, progress: { docId: "d", sectionId: "s", offset: 0, percent: 0.42, updatedAt: "" } })).toEqual({ percent: 0.42, label: "42%" });
    expect(progressOf({ ...base, progress: { docId: "d", sectionId: "s", offset: 1, percent: 0.999, updatedAt: "" } })).toEqual({ percent: 1, label: "Finished" });
  });

  it("splits snippets at the match ranges and keeps extensions apart", () => {
    expect(splitRanges("the café opened", [[4, 8]])).toEqual([
      { text: "the ", hit: false },
      { text: "café", hit: true },
      { text: " opened", hit: false },
    ]);
    expect(splitRanges("ab", [[5, 9]])).toEqual([{ text: "ab", hit: false }]);
    expect(splitRanges("abcd", [[2, 4], [0, 1]])).toEqual([
      { text: "a", hit: true },
      { text: "b", hit: false },
      { text: "cd", hit: true },
    ]);
    expect(stemOf("Jane Eyre.txt")).toEqual({ stem: "Jane Eyre", ext: ".txt" });
    expect(stemOf(".hidden")).toEqual({ stem: ".hidden", ext: "" });
    expect(stemOf("README")).toEqual({ stem: "README", ext: "" });
  });
});
