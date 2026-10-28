import { describe, expect, it } from "vitest";
import { createMockApi } from "@/api/mock";
import { ApiError, ErrorCodes } from "@/api/types";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const at = (iso: string) => () => new Date(iso);

describe("mock api: library", () => {
  it("serves the seed library", async () => {
    const api = createMockApi({ storage: null });
    const docs = await api.listDocuments();
    expect(docs.map((d) => d.id).sort()).toEqual(["bacon-of-studies", "bacon-of-truth", "gift-of-the-magi", "jane-eyre"]);
    expect(api.mode).toBe("mock");
  });

  it("filters by kind and sorts by title or date added", async () => {
    const api = createMockApi({ storage: null });
    expect((await api.listDocuments({ kind: "book" })).map((d) => d.id)).toEqual(["jane-eyre"]);
    expect((await api.listDocuments({ sort: "title" })).map((d) => d.title)).toEqual([
      "Jane Eyre",
      "Of Studies",
      "Of Truth",
      "The Gift of the Magi",
    ]);
    expect((await api.listDocuments({ sort: "added" }))[0]!.id).toBe("jane-eyre");
  });

  it("searches title, author and source", async () => {
    const api = createMockApi({ storage: null });
    expect((await api.listDocuments({ q: "bacon" })).length).toBe(2);
    expect((await api.listDocuments({ q: "magi" })).map((d) => d.id)).toEqual(["gift-of-the-magi"]);
  });

  it("returns a table of contents and linked sections", async () => {
    const api = createMockApi({ storage: null });
    const doc = await api.getDocument("jane-eyre");
    expect(doc.toc.map((t) => t.title)).toEqual(["Chapter I", "Chapter II", "Chapter III"]);
    expect(doc.sectionCount).toBe(3);
    const s1 = await api.getSection("jane-eyre", "s1");
    expect(s1.prevId).toBe("s0");
    expect(s1.nextId).toBe("s2");
    await expect(api.getSection("jane-eyre", "s9")).rejects.toMatchObject({ code: ErrorCodes.notFound });
    await expect(api.getDocument("nope")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("mock api: reader state", () => {
  it("saves and filters saved documents", async () => {
    const api = createMockApi({ storage: null });
    await api.updateDocument("gift-of-the-magi", { saved: true });
    expect((await api.listDocuments({ saved: true })).map((d) => d.id)).toEqual(["gift-of-the-magi"]);
  });

  it("round-trips progress and builds history, most recent first", async () => {
    const storage = memoryStorage();
    let now = "2026-10-24T10:00:00.000Z";
    const api = createMockApi({ storage, now: () => new Date(now) });
    await api.saveProgress("jane-eyre", { sectionId: "s1", offset: 0.4, percent: 0.47 });
    now = "2026-10-24T11:00:00.000Z";
    await api.saveProgress("bacon-of-truth", { sectionId: "s0", offset: 2, percent: -1 });

    const history = await api.listDocuments({ history: true });
    expect(history.map((d) => d.id)).toEqual(["bacon-of-truth", "jane-eyre"]);
    expect(history[1]!.progress).toMatchObject({ sectionId: "s1", offset: 0.4, percent: 0.47 });
    expect(history[0]!.progress).toMatchObject({ offset: 1, percent: 0 }); // clamped

    // A fresh instance on the same storage sees the same state.
    const again = createMockApi({ storage });
    const doc = await again.getDocument("jane-eyre");
    expect(doc.progress?.sectionId).toBe("s1");
    expect(doc.lastOpenedAt).toBe("2026-10-24T10:00:00.000Z");
  });

  it("rejects progress for an unknown section", async () => {
    const api = createMockApi({ storage: null });
    await expect(api.saveProgress("jane-eyre", { sectionId: "s7", offset: 0, percent: 0 })).rejects.toMatchObject({
      code: ErrorCodes.invalid,
    });
  });

  it("orders 'recent' by the later of opened and added", async () => {
    const api = createMockApi({ storage: null, now: at("2026-10-24T12:00:00.000Z") });
    await api.saveProgress("bacon-of-studies", { sectionId: "s0", offset: 0.1, percent: 0.1 });
    expect((await api.listDocuments({ sort: "recent" }))[0]!.id).toBe("bacon-of-studies");
  });
});

describe("mock api: adding and removing", () => {
  it("ingests a dropped Markdown file as an upload", async () => {
    const storage = memoryStorage();
    const api = createMockApi({ storage, now: at("2026-10-24T09:00:00.000Z") });
    const job = await api.uploadFile(new File(["# My Essay\n\nA subtitle\n\nBody text here."], "essay.md"));
    expect(job.status).toBe("done");
    expect(job.documentIds).toEqual(["my-essay"]);
    expect(await api.getJob(job.id)).toEqual(job);

    const doc = await api.getDocument("my-essay");
    expect(doc).toMatchObject({ title: "My Essay", subtitle: "A subtitle", format: "md", relPath: "essay.md" });
    expect((await api.getTree()).root.files.map((f) => f.name)).toEqual(["essay.md"]);

    // Uploads persist.
    expect((await createMockApi({ storage }).listDocuments()).some((d) => d.id === "my-essay")).toBe(true);
  });

  it("gives uploads unique ids", async () => {
    const api = createMockApi({ storage: null });
    await api.uploadFile(new File(["# Same\n\nx"], "a.md"));
    const second = await api.uploadFile(new File(["# Same\n\ny"], "b.md"));
    expect(second.documentIds).toEqual(["same-2"]);
  });

  it("reports formats it cannot read as a failed job, not a crash", async () => {
    const api = createMockApi({ storage: null });
    const job = await api.uploadFile(new File(["PK"], "book.epub"));
    expect(job.status).toBe("error");
    expect(job.error).toMatch(/EPUB files need the backend/);
  });

  it("explains that paths need the backend", async () => {
    const api = createMockApi({ storage: null });
    await expect(api.importPath("", "~/Books")).rejects.toMatchObject({ code: ErrorCodes.unsupported });
  });

  it("puts uploads into the folder asked for", async () => {
    const api = createMockApi({ storage: null });
    const job = await api.uploadFile(new File(["# Notes\n\ntext"], "notes.md"), "Essays");
    expect(job.status).toBe("done");
    expect((await api.getDocument(job.documentIds[0]!)).relPath).toBe("Essays/notes.md");
    await expect(api.uploadFile(new File(["x"], "x.md"), "Nowhere")).rejects.toMatchObject({ code: ErrorCodes.notFound });
  });

  it("removes seed documents and remembers it", async () => {
    const storage = memoryStorage();
    const api = createMockApi({ storage });
    await api.deleteDocument("bacon-of-truth");
    const ids = (await createMockApi({ storage }).listDocuments()).map((d) => d.id);
    expect(ids).not.toContain("bacon-of-truth");
    expect(ids).toHaveLength(3);
  });

});

describe("mock api: the pretend folder", () => {
  it("lays the seed library out in folders", async () => {
    const api = createMockApi({ storage: null });
    const { root, truncated } = await api.getTree();
    expect(truncated).toBe(false);
    expect(root.folders.map((f) => f.name)).toEqual(["Essays", "Novels", "Stories"]);
    expect(root.files).toEqual([]);
    expect(root.fileCount).toBe(4);
    const bacon = root.folders[0]!.folders[0]!;
    expect(bacon).toMatchObject({ name: "Bacon", path: "Essays/Bacon", fileCount: 2 });
    expect(bacon.files.map((f) => f.path)).toEqual(["Essays/Bacon/Of Studies.md", "Essays/Bacon/Of Truth.md"]);
    expect(bacon.files[0]!.doc).toMatchObject({ id: "bacon-of-studies", relPath: "Essays/Bacon/Of Studies.md" });
  });

  it("creates files and folders, renames and moves them, and deletes them", async () => {
    const storage = memoryStorage();
    const api = createMockApi({ storage, now: at("2026-10-24T09:00:00.000Z") });
    expect(await api.createFolder("", "Poetry")).toEqual({ path: "Poetry" });
    await expect(api.createFolder("", "Poetry")).rejects.toMatchObject({ code: "conflict" });
    const made = await api.createFile({ dir: "Poetry", title: "Odes", author: "Keats" });
    expect(made.path).toBe("Poetry/Odes.md");
    expect(made.document).toMatchObject({ title: "Odes", author: "Keats", relPath: "Poetry/Odes.md", format: "md" });
    expect((await api.createFile({ dir: "Poetry", title: "Odes" })).path).toBe("Poetry/Odes 2.md");
    await expect(api.createFile({ dir: "Nowhere", title: "x" })).rejects.toMatchObject({ code: ErrorCodes.notFound });

    const moved = await api.moveEntry("Poetry/Odes.md", "Poetry/Great Odes.md");
    expect(moved).toMatchObject({ path: "Poetry/Great Odes.md", document: { id: made.document.id, relPath: "Poetry/Great Odes.md" } });
    await expect(api.moveEntry("Poetry/Great Odes.md", "Poetry/Great Odes")).rejects.toMatchObject({ code: ErrorCodes.invalid });

    await api.moveEntry("Poetry", "Novels/Verse");
    const tree = await api.getTree();
    expect(tree.root.folders.map((f) => f.name)).toEqual(["Essays", "Novels", "Stories"]);
    const verse = tree.root.folders[1]!.folders.find((f) => f.name === "Verse")!;
    expect(verse.files.map((f) => f.path)).toEqual(["Novels/Verse/Great Odes.md", "Novels/Verse/Odes 2.md"]);
    await expect(api.moveEntry("Novels", "Novels/Inside")).rejects.toMatchObject({ code: ErrorCodes.invalid });

    // Everything survives a reload.
    const later = createMockApi({ storage });
    expect((await later.getDocument(made.document.id)).relPath).toBe("Novels/Verse/Great Odes.md");

    await later.deleteEntry("Novels/Verse");
    await expect(later.getDocument(made.document.id)).rejects.toMatchObject({ code: ErrorCodes.notFound });
    expect((await later.getTree()).root.folders[1]!.folders).toEqual([]);
    await expect(later.deleteEntry("")).rejects.toMatchObject({ code: ErrorCodes.invalid });
    await expect(later.deleteEntry("Nope")).rejects.toMatchObject({ code: ErrorCodes.notFound });
  });

  it("searches titles, authors and passages across every file", async () => {
    const api = createMockApi({ storage: null });
    const results = await api.searchDocuments("magi");
    expect(results[0]!.doc.id).toBe("gift-of-the-magi");
    expect(results[0]!.matched).toEqual(["title"]);
    expect(results[0]!.totalHits).toBeGreaterThan(0);
    const [a, b] = results[0]!.hits[0]!.ranges[0]!;
    expect(results[0]!.hits[0]!.snippet.slice(a, b).toLowerCase()).toBe("magi");
    const bacon = await api.searchDocuments("bacon");
    expect(bacon.map((r) => r.matched)).toEqual([["author"], ["author"]]);
    expect(await api.searchDocuments("")).toEqual([]);
    expect(await api.searchDocuments("zzzzqqq")).toEqual([]);
    const bessie = await api.searchDocuments("Bessie");
    expect(bessie.map((r) => r.doc.id)).toEqual(["jane-eyre"]);
    expect(bessie[0]!.matched).toEqual([]);
    expect(bessie[0]!.hits.length).toBeLessThanOrEqual(3);
    expect(bessie[0]!.hits.length).toBeGreaterThan(0);
  });
});
