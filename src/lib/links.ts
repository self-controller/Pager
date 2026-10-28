import type { DocumentSummary, SearchHit } from "@/api/types";

/** Where to open a document: its saved place when there is one. */
export function readHref(doc: Pick<DocumentSummary, "id" | "progress">): string {
  const base = `/read/${encodeURIComponent(doc.id)}`;
  return doc.progress ? `${base}/${encodeURIComponent(doc.progress.sectionId)}` : base;
}

/** A search hit opens the section at the matching block (`/read/<doc>/<section>#<block>`). */
export function hitHref(hit: Pick<SearchHit, "docId" | "sectionId" | "blockId">): string {
  const base = `/read/${encodeURIComponent(hit.docId)}/${encodeURIComponent(hit.sectionId)}`;
  return hit.blockId ? `${base}#${encodeURIComponent(hit.blockId)}` : base;
}
