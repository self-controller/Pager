import type { DocumentSummary, TreeFile, TreeFolder } from "@/api/types";
import type { LibrarySort } from "@/state/settings";

/** A folder path from the URL: forward slashes, no empty, dot or parent segments. */
export function cleanRel(rel: string): string {
  return rel
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .join("/");
}

export const parentOf = (rel: string): string => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
export const baseOf = (rel: string): string => (rel.includes("/") ? rel.slice(rel.lastIndexOf("/") + 1) : rel);
export const joinPath = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);

/** "Jane Eyre.txt" → { stem: "Jane Eyre", ext: ".txt" }. */
export function stemOf(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: "" };
}

export function folderAt(root: TreeFolder, rel: string): TreeFolder | undefined {
  let cur: TreeFolder | undefined = root;
  for (const part of rel ? rel.split("/") : []) cur = cur?.folders.find((f) => f.name === part);
  return cur;
}

/** Every folder, root first, in reading order. */
export function allFolders(root: TreeFolder): TreeFolder[] {
  const out: TreeFolder[] = [];
  const walk = (f: TreeFolder) => {
    out.push(f);
    f.folders.forEach(walk);
  };
  walk(root);
  return out;
}

export function breadcrumbsFor(rel: string): Array<{ name: string; path: string }> {
  const crumbs: Array<{ name: string; path: string }> = [];
  let acc = "";
  for (const part of rel ? rel.split("/") : []) {
    acc = joinPath(acc, part);
    crumbs.push({ name: part, path: acc });
  }
  return crumbs;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const titleOf = (f: TreeFile) => f.doc?.title ?? stemOf(f.name).stem;
const lastRead = (f: TreeFile) => f.doc?.lastOpenedAt ?? f.doc?.addedAt ?? f.modifiedAt;

export function sortFiles(files: TreeFile[], sort: LibrarySort): TreeFile[] {
  const list = [...files];
  switch (sort) {
    case "recent":
      return list.sort((a, b) => lastRead(b).localeCompare(lastRead(a)) || byName(titleOf(a), titleOf(b)));
    case "added":
      return list.sort((a, b) => (b.doc?.addedAt ?? b.modifiedAt).localeCompare(a.doc?.addedAt ?? a.modifiedAt) || byName(titleOf(a), titleOf(b)));
    case "progress":
      return list.sort((a, b) => (b.doc?.progress?.percent ?? -1) - (a.doc?.progress?.percent ?? -1) || byName(titleOf(a), titleOf(b)));
    default:
      return list.sort((a, b) => byName(titleOf(a), titleOf(b)));
  }
}

/** How far a document has been read, as the library shows it. */
export function progressOf(doc: DocumentSummary | undefined): { percent?: number; label: string } {
  const pct = doc?.progress?.percent;
  if (pct === undefined || !doc?.lastOpenedAt) return { label: "New" };
  if (pct >= 0.995) return { percent: 1, label: "Finished" };
  return { percent: pct, label: `${Math.max(1, Math.round(pct * 100))}%` };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 folders · 12 books" */
export function describeFolder(folder: TreeFolder): string {
  const parts: string[] = [];
  if (folder.folders.length) parts.push(plural(folder.folders.length, "folder", "folders"));
  parts.push(plural(folder.fileCount, "book", "books"));
  return parts.join(" · ");
}

/** Splits a snippet into plain and matching runs, so matches can be marked without HTML. */
export function splitRanges(text: string, ranges: Array<[number, number]>): Array<{ text: string; hit: boolean }> {
  const out: Array<{ text: string; hit: boolean }> = [];
  let pos = 0;
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const s = Math.max(pos, Math.min(start, text.length));
    const e = Math.max(s, Math.min(end, text.length));
    if (s > pos) out.push({ text: text.slice(pos, s), hit: false });
    if (e > s) out.push({ text: text.slice(s, e), hit: true });
    pos = e;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), hit: false });
  return out;
}
