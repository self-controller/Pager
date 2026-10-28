/**
 * In-browser implementation of PagerApi. Serves the seed library laid out as a small folder tree,
 * plus anything dropped or created in the app (.txt, .md, .html), and keeps saved/progress/history
 * in localStorage. It cannot read paths on disk; that is the backend's job, and the UI says so.
 */

import type { PagerApi } from "./client";
import { buildSeed, READS_SOURCE, type SeedDocument } from "./seed";
import { formatFromName, parseFile, parseMarkdown, type ParsedDocument } from "./text-to-html";
import {
  ApiError,
  ErrorCodes,
  type Annotation,
  type CreateFileResult,
  type DocumentDetail,
  type DocumentQuery,
  type DocumentSearchResult,
  type DocumentSummary,
  type IngestJob,
  type LibraryAnnotation,
  type MoveEntryResult,
  type ReadingProgress,
  type SearchHit,
  type Section,
  type SectionRange,
  type TagCount,
  type TreeFolder,
  type TreeResponse,
} from "./types";

const STORAGE_KEY = "pager.mock.v1";
/** The mock never edits files, so every section stays on its first revision. */
const REVISION = "r1";
const WORDS_PER_MINUTE = 238;
const READABLE = /\.(epub|md|markdown|mdown|mkd|txt|text|html?|xhtml|docx)$/i;

interface StoredUpload {
  id: string;
  format: string;
  parsed: ParsedDocument;
  addedAt: string;
  /** Where the file sits in the pretend folder; older saves without it sit in the root. */
  relPath?: string;
}

interface PersistedState {
  version: 1;
  /** Per-document reader state, keyed by document id. */
  docs: Record<string, { saved?: boolean; progress?: ReadingProgress; lastOpenedAt?: string }>;
  uploads: StoredUpload[];
  /** Seed documents the user removed. */
  removed: string[];
  /** Highlights and notes, including soft-deleted ones (restorable). */
  annotations: Annotation[];
  /** Folders made in the app (also the only way an empty folder exists). */
  folders: string[];
  /** Where documents moved to, by id; absent means where they started. */
  paths: Record<string, string>;
}

interface Entry {
  summary: Omit<DocumentSummary, "saved" | "progress" | "lastOpenedAt" | "relPath">;
  sections: Section[];
  isUpload: boolean;
  /** The file's path unless `state.paths` says otherwise. */
  homePath: string;
}

export interface MockApiOptions {
  /** localStorage by default; pass null for a purely in-memory store (tests). */
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  now?: () => Date;
  /** Artificial delay so loading states are visible in development. */
  latencyMs?: number;
}

function emptyState(): PersistedState {
  return { version: 1, docs: {}, uploads: [], removed: [], annotations: [], folders: [], paths: {} };
}

function toEntry(
  id: string,
  format: string,
  parsed: ParsedDocument,
  meta: { addedAt: string; author?: string; publishedAt?: string },
  isUpload: boolean,
  homePath: string,
): Entry {
  const sections: Section[] = parsed.sections.map((s, index) => ({
    id: `s${index}`,
    docId: id,
    index,
    title: s.title,
    html: s.html,
    prevId: index > 0 ? `s${index - 1}` : undefined,
    nextId: index < parsed.sections.length - 1 ? `s${index + 1}` : undefined,
    revisionId: REVISION,
  }));
  return {
    summary: {
      id,
      kind: parsed.kind,
      format,
      title: parsed.title,
      subtitle: parsed.subtitle,
      author: meta.author ?? parsed.author,
      sourceId: READS_SOURCE.id,
      sourceName: READS_SOURCE.name,
      excerpt: parsed.excerpt,
      wordCount: parsed.wordCount,
      estimatedMinutes: Math.max(1, Math.round(parsed.wordCount / WORDS_PER_MINUTE)),
      sectionCount: sections.length,
      addedAt: meta.addedAt,
      publishedAt: meta.publishedAt ?? (parsed.year ? String(parsed.year) : undefined),
    },
    sections,
    isUpload,
    homePath,
  };
}

function seedEntry(seed: SeedDocument): Entry {
  return toEntry(seed.id, seed.format, seed.parsed, { addedAt: seed.addedAt, author: seed.author, publishedAt: seed.publishedAt }, false, seed.relPath);
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .slice(0, 48) || "document"
  );
}

/** The section body's textContent, the coordinate space of SectionRange (API.md). */
function sectionText(html: string): string {
  if (typeof DOMParser === "undefined") return html.replace(/<[^>]+>/g, "");
  return new DOMParser().parseFromString(`<div>${html}</div>`, "text/html").body.textContent ?? "";
}

function compareRecent(a: DocumentSummary, b: DocumentSummary): number {
  const ta = a.lastOpenedAt && a.lastOpenedAt > a.addedAt ? a.lastOpenedAt : a.addedAt;
  const tb = b.lastOpenedAt && b.lastOpenedAt > b.addedAt ? b.lastOpenedAt : b.addedAt;
  return tb.localeCompare(ta);
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** A file or folder name the pretend folder accepts (the same rule as the backend). */
export function safeName(raw: string, fallback?: string): string {
  const cleaned = raw
    .replace(/[\u0000-\u001f<>:"|?*\\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120)
    .trim();
  if (cleaned) return cleaned;
  if (fallback) return fallback;
  throw new ApiError(ErrorCodes.invalid, "That name can't be used.", 400);
}

/** Normalises a relative path and refuses anything that leaves the folder. */
export function cleanPath(rel: string): string {
  const parts = rel.replace(/\\/g, "/").split("/").filter(Boolean);
  for (const p of parts) {
    if (p === "." || p === ".." || p.startsWith(".") || /[\u0000-\u001f<>:"|?*]/.test(p)) {
      throw new ApiError(ErrorCodes.invalid, "That path can't be used.", 400);
    }
  }
  return parts.join("/");
}

const parentOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
const baseOf = (rel: string) => (rel.includes("/") ? rel.slice(rel.lastIndexOf("/") + 1) : rel);
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

export function createMockApi(options: MockApiOptions = {}): PagerApi {
  const storage = options.storage === undefined ? (typeof localStorage === "undefined" ? null : localStorage) : options.storage;
  const now = options.now ?? (() => new Date());
  const latency = options.latencyMs ?? 0;

  let state = load();
  const seeds = buildSeed();
  const entries = new Map<string, Entry>();
  for (const seed of seeds) if (!state.removed.includes(seed.id)) entries.set(seed.id, seedEntry(seed));
  for (const up of state.uploads) entries.set(up.id, uploadEntry(up));
  const jobs = new Map<string, IngestJob>();
  let jobCounter = 0;

  function load(): PersistedState {
    if (!storage) return emptyState();
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      return parsed.version === 1 ? { ...emptyState(), ...parsed } : emptyState();
    } catch {
      return emptyState();
    }
  }

  function persist(): void {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage full or unavailable: keep working in memory for this session.
    }
  }

  function uploadEntry(up: StoredUpload): Entry {
    const home = up.relPath ?? `${slug(up.parsed.title)}.${up.format}`;
    return toEntry(up.id, up.format, up.parsed, { addedAt: up.addedAt }, true, home);
  }

  async function delay<T>(value: T): Promise<T> {
    if (latency > 0) await new Promise((r) => setTimeout(r, latency));
    return value;
  }

  function pathOf(entry: Entry): string {
    return state.paths[entry.summary.id] ?? entry.homePath;
  }

  function summarize(entry: Entry): DocumentSummary {
    const s = state.docs[entry.summary.id] ?? {};
    return { ...entry.summary, saved: s.saved ?? false, progress: s.progress, lastOpenedAt: s.lastOpenedAt, relPath: pathOf(entry) };
  }

  function getEntry(id: string): Entry {
    const entry = entries.get(id);
    if (!entry) throw new ApiError(ErrorCodes.notFound, "That document isn't in your library.", 404);
    return entry;
  }

  function entryAt(rel: string): Entry | undefined {
    for (const e of entries.values()) if (pathOf(e) === rel) return e;
    return undefined;
  }

  function folderExists(rel: string): boolean {
    if (!rel) return true;
    if (state.folders.includes(rel)) return true;
    const prefix = `${rel}/`;
    if (state.folders.some((f) => f.startsWith(prefix))) return true;
    for (const e of entries.values()) if (pathOf(e).startsWith(prefix)) return true;
    return false;
  }

  function requireFolder(rel: string): string {
    const dir = cleanPath(rel);
    if (!folderExists(dir)) throw new ApiError(ErrorCodes.notFound, "That folder isn't in your library.", 404);
    return dir;
  }

  function uniquePath(dir: string, name: string): string {
    const taken = (rel: string) => Boolean(entryAt(rel)) || folderExists(rel);
    if (!taken(join(dir, name))) return join(dir, name);
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let n = 2; ; n++) {
      const candidate = join(dir, `${stem} ${n}${ext}`);
      if (!taken(candidate)) return candidate;
    }
  }

  function uniqueId(base: string): string {
    let id = base;
    for (let n = 2; entries.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  function removeEntry(entry: Entry): void {
    const id = entry.summary.id;
    entries.delete(id);
    delete state.docs[id];
    delete state.paths[id];
    if (entry.isUpload) state.uploads = state.uploads.filter((u) => u.id !== id);
    else state.removed = [...state.removed, id];
  }

  function buildTree(): TreeResponse {
    const root: TreeFolder = { kind: "folder", name: "", path: "", folders: [], files: [], fileCount: 0 };
    const ensureFolder = (rel: string): TreeFolder => {
      let cur = root;
      if (!rel) return cur;
      let acc = "";
      for (const part of rel.split("/")) {
        acc = join(acc, part);
        let next = cur.folders.find((f) => f.name === part);
        if (!next) {
          next = { kind: "folder", name: part, path: acc, folders: [], files: [], fileCount: 0 };
          cur.folders.push(next);
        }
        cur = next;
      }
      return cur;
    };
    for (const f of state.folders) ensureFolder(f);
    for (const entry of entries.values()) {
      const rel = pathOf(entry);
      const s = summarize(entry);
      ensureFolder(parentOf(rel)).files.push({
        kind: "file",
        name: baseOf(rel),
        path: rel,
        format: s.format,
        size: Math.round((s.wordCount ?? 0) * 6),
        modifiedAt: s.addedAt,
        docId: s.id,
        doc: s,
      });
    }
    const finish = (f: TreeFolder): number => {
      f.folders.sort(byName);
      f.files.sort(byName);
      f.fileCount = f.files.length + f.folders.reduce((n, sub) => n + finish(sub), 0);
      return f.fileCount;
    };
    finish(root);
    return { root, truncated: false };
  }

  let annotationCounter = 0;

  function findAnnotation(id: string, includeDeleted = false): Annotation {
    const a = state.annotations.find((x) => x.id === id && (includeDeleted || !x.deletedAt));
    if (!a) throw new ApiError(ErrorCodes.notFound, "That highlight isn't here any more.", 404);
    return a;
  }

  function replaceAnnotation(next: Annotation): void {
    state.annotations = state.annotations.map((a) => (a.id === next.id ? next : a));
    persist();
  }

  /** Anchors a SectionRange exactly where it is: the mock's files never change. */
  function anchorFor(docId: string, range: SectionRange | undefined, selectedText: string | undefined): Annotation["anchor"] {
    if (!range) throw new ApiError(ErrorCodes.invalid, "The preview build anchors highlights by sectionRange.", 400);
    const section = getEntry(docId).sections.find((s) => s.id === range.sectionId);
    if (!section) throw new ApiError(ErrorCodes.invalid, "Unknown section.", 400);
    const quote = sectionText(section.html).slice(range.start, range.end);
    if (selectedText !== undefined && selectedText !== quote) {
      throw new ApiError("selection_mismatch", "The selected text doesn't match the document.", 409);
    }
    const base = section.index * 10_000_000;
    return {
      status: "anchored",
      confidence: 1,
      revisionId: REVISION,
      range: { start: { blockId: section.id, offset: range.start }, end: { blockId: section.id, offset: range.end } },
      sectionId: section.id,
      segments: [{ sectionId: section.id, start: range.start, end: range.end }],
      position: { start: base + range.start, end: base + range.end },
      quote,
      originalQuote: quote,
    };
  }

  function addUpload(parsed: ParsedDocument, format: string, relPath: string): Entry {
    const id = uniqueId(slug(parsed.title));
    const upload: StoredUpload = { id, format, parsed, addedAt: now().toISOString(), relPath };
    state.uploads = [...state.uploads, upload];
    const entry = uploadEntry(upload);
    entries.set(id, entry);
    persist();
    return entry;
  }

  return {
    mode: "mock",

    async listDocuments(query: DocumentQuery = {}) {
      let list = [...entries.values()].map(summarize);
      if (query.kind) list = list.filter((d) => d.kind === query.kind);
      if (query.saved !== undefined) list = list.filter((d) => d.saved === query.saved);
      if (query.q) {
        const q = query.q.toLowerCase();
        list = list.filter((d) => [d.title, d.author, d.subtitle, d.relPath && baseOf(d.relPath)].some((f) => f?.toLowerCase().includes(q)));
      }
      if (query.history) {
        list = list.filter((d) => d.lastOpenedAt).sort((a, b) => b.lastOpenedAt!.localeCompare(a.lastOpenedAt!));
        return delay(list);
      }
      const sort = query.sort ?? "recent";
      if (sort === "title") list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
      else if (sort === "added") list.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
      else list.sort(compareRecent);
      return delay(list);
    },

    async getDocument(id) {
      const entry = getEntry(id);
      const detail: DocumentDetail = {
        ...summarize(entry),
        toc: entry.sections.map((s) => ({ id: s.id, title: s.title, index: s.index, depth: 0 })),
      };
      return delay(detail);
    },

    async getSection(docId, sectionId) {
      const section = getEntry(docId).sections.find((s) => s.id === sectionId);
      if (!section) throw new ApiError(ErrorCodes.notFound, "That section doesn't exist.", 404);
      return delay(section);
    },

    async updateDocument(id, patch) {
      const entry = getEntry(id);
      if (patch.saved !== undefined) {
        state.docs[id] = { ...state.docs[id], saved: patch.saved };
        persist();
      }
      return delay(summarize(entry));
    },

    async deleteDocument(id) {
      removeEntry(getEntry(id));
      persist();
      return delay(undefined);
    },

    async saveProgress(id, update) {
      const entry = getEntry(id);
      if (!entry.sections.some((s) => s.id === update.sectionId)) {
        throw new ApiError(ErrorCodes.invalid, "Unknown section.", 400);
      }
      const at = now().toISOString();
      const progress: ReadingProgress = {
        docId: id,
        sectionId: update.sectionId,
        offset: Math.min(1, Math.max(0, update.offset)),
        percent: Math.min(1, Math.max(0, update.percent)),
        updatedAt: at,
      };
      state.docs[id] = { ...state.docs[id], progress, lastOpenedAt: at };
      persist();
      return delay(progress);
    },

    // ---- The pretend reads folder ----

    async getTree() {
      return delay(buildTree());
    },

    async createFile(input) {
      const title = input.title.replace(/\s+/g, " ").trim();
      if (!title) throw new ApiError(ErrorCodes.invalid, "Give the file a title.", 400);
      const author = input.author?.replace(/\s+/g, " ").trim() || undefined;
      const dir = requireFolder(input.dir);
      const relPath = uniquePath(dir, `${safeName(title, "Untitled")}.md`);
      const parsed = { ...parseMarkdown(baseOf(relPath), `# ${title}\n\n`, { splitOnH2: false }), title, author };
      const entry = addUpload(parsed, "md", relPath);
      const result: CreateFileResult = { path: relPath, document: summarize(entry) };
      return delay(result);
    },

    async createFolder(dir, name) {
      const parent = requireFolder(dir);
      const rel = join(parent, safeName(name));
      if (folderExists(rel) || entryAt(rel)) throw new ApiError("conflict", `There is already something called ${baseOf(rel)} here.`, 409);
      state.folders = [...state.folders, rel];
      persist();
      return delay({ path: rel });
    },

    async moveEntry(from, to) {
      const src = cleanPath(from);
      const dest = cleanPath(to);
      if (!src) throw new ApiError(ErrorCodes.invalid, "The library folder itself can't be moved.", 400);
      if (!dest) throw new ApiError(ErrorCodes.invalid, "Say where to move it.", 400);
      const file = entryAt(src);
      const isFolder = !file && folderExists(src);
      if (!file && !isFolder) throw new ApiError(ErrorCodes.notFound, "That file or folder isn't in your library.", 404);
      const result: MoveEntryResult = { path: dest };
      if (src === dest) {
        if (file) result.document = summarize(file);
        return delay(result);
      }
      if (dest.startsWith(`${src}/`)) throw new ApiError(ErrorCodes.invalid, "A folder can't be moved into itself.", 400);
      if (entryAt(dest) || (isFolder ? folderExists(dest) : state.folders.includes(dest))) {
        throw new ApiError("conflict", "There is already something with that name there.", 409);
      }
      if (!folderExists(parentOf(dest))) throw new ApiError(ErrorCodes.notFound, "That folder isn't in your library.", 404);
      if (file) {
        if (!READABLE.test(baseOf(dest))) throw new ApiError(ErrorCodes.invalid, "Keep the file's extension so Pager can still open it.", 400);
        state.paths[file.summary.id] = dest;
        result.document = summarize(file);
      } else {
        const prefix = `${src}/`;
        for (const e of entries.values()) {
          const p = pathOf(e);
          if (p.startsWith(prefix)) state.paths[e.summary.id] = dest + p.slice(src.length);
        }
        state.folders = state.folders.map((f) => (f === src ? dest : f.startsWith(prefix) ? dest + f.slice(src.length) : f));
        if (!state.folders.includes(dest)) state.folders = [...state.folders, dest];
      }
      persist();
      return delay(result);
    },

    async deleteEntry(path) {
      const rel = cleanPath(path);
      if (!rel) throw new ApiError(ErrorCodes.invalid, "The library folder itself can't be deleted.", 400);
      const file = entryAt(rel);
      if (file) removeEntry(file);
      else if (folderExists(rel)) {
        const prefix = `${rel}/`;
        for (const e of [...entries.values()]) if (pathOf(e).startsWith(prefix)) removeEntry(e);
        state.folders = state.folders.filter((f) => f !== rel && !f.startsWith(prefix));
      } else throw new ApiError(ErrorCodes.notFound, "That file or folder isn't in your library.", 404);
      persist();
      return delay(undefined);
    },

    async importPath() {
      throw new ApiError(
        ErrorCodes.unsupported,
        "Copying files from a path needs the backend. Until it's connected, drop a .txt, .md or .html file here instead.",
      );
    },

    async uploadFile(file, dir = "") {
      const jobId = `job-${++jobCounter}`;
      const format = formatFromName(file.name);
      if (!format) {
        const ext = file.name.split(".").pop()?.toUpperCase() ?? "This";
        const job: IngestJob = {
          id: jobId,
          status: "error",
          documentIds: [],
          error: `${ext} files need the backend. The preview build reads .txt, .md and .html.`,
        };
        jobs.set(jobId, job);
        return delay(job);
      }
      const folder = requireFolder(dir);
      const text = await file.text();
      const parsed = parseFile(file.name, text, format);
      const entry = addUpload(parsed, format, uniquePath(folder, safeName(file.name, `upload.${format}`)));
      const job: IngestJob = { id: jobId, status: "done", documentIds: [entry.summary.id] };
      jobs.set(jobId, job);
      return delay(job);
    },

    async getJob(id) {
      const job = jobs.get(id);
      if (!job) throw new ApiError(ErrorCodes.notFound, "Unknown job.", 404);
      return delay(job);
    },

    async searchDocuments(q) {
      const needle = q.trim().toLowerCase();
      if (!needle) return delay([]);
      const results: DocumentSearchResult[] = [];
      for (const entry of entries.values()) {
        const doc = summarize(entry);
        const matched: DocumentSearchResult["matched"] = [];
        if (doc.title.toLowerCase().includes(needle)) matched.push("title");
        if (doc.author?.toLowerCase().includes(needle)) matched.push("author");
        if (!matched.length && baseOf(pathOf(entry)).toLowerCase().includes(needle)) matched.push("fileName");
        const hits: SearchHit[] = [];
        let totalHits = 0;
        for (const section of entry.sections) {
          const text = sectionText(section.html);
          const lower = text.toLowerCase();
          for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, i + needle.length)) {
            totalHits++;
            if (hits.length >= 3) continue;
            const start = Math.max(0, i - 60);
            const end = Math.min(text.length, i + needle.length + 60);
            const lead = start > 0 ? "…" : "";
            const snippet = `${lead}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
            const at = lead.length + (i - start);
            hits.push({ docId: doc.id, docTitle: doc.title, sectionId: section.id, blockId: "", snippet, ranges: [[at, at + needle.length]] });
          }
        }
        if (matched.length || totalHits) results.push({ doc, matched, hits, totalHits });
      }
      results.sort((a, b) => Number(b.matched.length > 0) - Number(a.matched.length > 0) || b.totalHits - a.totalHits);
      return delay(results);
    },

    async listAnnotations(docId) {
      getEntry(docId);
      const list = state.annotations
        .filter((a) => a.docId === docId && !a.deletedAt)
        .sort((a, b) => a.anchor.position.start - b.anchor.position.start);
      return delay(list);
    },

    async createAnnotation(docId, input) {
      const existing = input.id ? state.annotations.find((a) => a.id === input.id) : undefined;
      if (existing) return delay(existing);
      const at = now().toISOString();
      const annotation: Annotation = {
        id: input.id ?? `a${Date.now().toString(36)}${(++annotationCounter).toString(36)}`,
        docId,
        kind: input.kind ?? (input.body ? "note" : "highlight"),
        color: input.color === undefined ? "yellow" : input.color,
        style: input.style ?? "highlight",
        body: input.body ?? null,
        tags: input.tags ?? [],
        anchor: anchorFor(docId, input.sectionRange, input.selectedText),
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      };
      state.annotations = [...state.annotations, annotation];
      persist();
      return delay(annotation);
    },

    async updateAnnotation(id, patch) {
      const current = findAnnotation(id);
      const next: Annotation = {
        ...current,
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.style !== undefined ? { style: patch.style } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        anchor: patch.reattach
          ? anchorFor(current.docId, patch.reattach.sectionRange, patch.reattach.selectedText)
          : patch.acceptAnchor
            ? { ...current.anchor, status: "anchored", confidence: 1 }
            : current.anchor,
        updatedAt: now().toISOString(),
      };
      replaceAnnotation(next);
      return delay(next);
    },

    async deleteAnnotation(id) {
      replaceAnnotation({ ...findAnnotation(id), deletedAt: now().toISOString() });
      return delay(undefined);
    },

    async restoreAnnotation(id) {
      const restored = { ...findAnnotation(id, true), deletedAt: null };
      replaceAnnotation(restored);
      return delay(restored);
    },

    async listHighlights(query = {}) {
      const q = query.q?.toLowerCase();
      const list: LibraryAnnotation[] = state.annotations
        .filter((a) => !a.deletedAt && a.kind !== "bookmark" && entries.has(a.docId))
        .filter((a) => !query.docId || a.docId === query.docId)
        .filter((a) => !query.tag || a.tags.includes(query.tag))
        .filter((a) => !q || a.anchor.quote.toLowerCase().includes(q) || (a.body ?? "").toLowerCase().includes(q))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((a) => {
          const entry = entries.get(a.docId)!;
          const section = entry.sections.find((s) => s.id === a.anchor.sectionId);
          return {
            ...a,
            docTitle: entry.summary.title,
            docAuthor: entry.summary.author,
            sectionTitle: section?.title ?? null,
            href: `/read/${encodeURIComponent(a.docId)}${section ? `/${encodeURIComponent(section.id)}` : ""}`,
          };
        });
      return delay(list);
    },

    async listTags() {
      const counts = new Map<string, number>();
      for (const a of state.annotations) if (!a.deletedAt) for (const t of a.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
      const tags: TagCount[] = [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
      return delay(tags);
    },

    subscribe() {
      return () => {};
    },

    // The server and paired phones exist only with the backend.
    getHealth: backendOnly,
    getAppSettings: backendOnly,
    updateAppSettings: backendOnly,
    openPairing: backendOnly,
    getPairing: backendOnly,
    approvePairing: backendOnly,
    denyPairing: backendOnly,
    cancelPairing: backendOnly,
    listDevices: backendOnly,
    renameDevice: backendOnly,
    revokeDevice: backendOnly,
    requestPairing: backendOnly,
    pollPairing: backendOnly,
  };
}

async function backendOnly(): Promise<never> {
  throw new ApiError(ErrorCodes.unsupported, "Reading from a phone needs the backend; the preview runs in this browser only.");
}
