/**
 * Anything a reader attaches to a place in a document (highlights, notes, bookmarks, the reading
 * position, records kept by tools) is held by an anchor. The server computes the anchor's selectors
 * from a range and keeps it attached when the file changes. See API.md, "Anchoring".
 *
 * Type-only module: cross-file imports in shared/ must be `import type`.
 */

export interface BlockPoint {
  blockId: string;
  /** UTF-16 offset into the block's text. */
  offset: number;
}

/** End is exclusive. A collapsed range (start == end) marks a point: a bookmark or a reading place. */
export interface TextRange {
  start: BlockPoint;
  end: BlockPoint;
}

/**
 * The same range expressed the way a DOM selection gives it: character offsets into the
 * `textContent` of one section's served HTML (exactly what `Range.toString().length` counts).
 */
export interface SectionRange {
  sectionId: string;
  start: number;
  end: number;
}

/** How a client says where something goes. Give `range` or `sectionRange`. */
export interface AnchorInput {
  /** The revision the coordinates refer to (`Section.revisionId`). Defaults to the current one. */
  revisionId?: string;
  range?: TextRange;
  sectionRange?: SectionRange;
  /** Optional check: if given and it does not match the text at the range, the server answers 409 selection_mismatch. */
  selectedText?: string;
}

/** W3C Web Annotation-style selectors, computed by the server. */
export interface Selectors {
  revisionId: string;
  range: TextRange;
  /** Character offsets in the revision's document text (leaf texts joined by "\n"). */
  position: { start: number; end: number };
  /** Never truncated. Context is 32 characters a side (48 after a collapsed point). */
  quote: { exact: string; prefix: string; suffix: string };
}

export type AnchorStatus =
  /** Exactly where it was. */
  | "anchored"
  /** Same text, found somewhere else (the file was edited around it). */
  | "moved"
  /** The text itself changed a little; attached to the closest match. */
  | "fuzzy"
  /** The text could not be found. Kept, never deleted; can be reattached. */
  | "orphaned";

/** One section's part of an anchored range, in that section's textContent coordinates. */
export interface SectionSegment {
  sectionId: string;
  start: number;
  end: number;
}

/** Where an anchor is now, in the current revision. */
export interface AnchorView {
  status: AnchorStatus;
  /** 0–1; 1 for anchored/moved. */
  confidence: number;
  /** The current revision when attached; the last revision it was found in when orphaned. */
  revisionId: string;
  /** Null only when orphaned. */
  range: TextRange | null;
  /** Section containing the start; null when orphaned. */
  sectionId: string | null;
  /** For painting: one entry per section the range touches. Empty when orphaned. */
  segments: SectionSegment[];
  /** Position in the document text, for sorting. */
  position: { start: number; end: number };
  /** The text at the anchor now (or the last known text when orphaned). */
  quote: string;
  /** The text as it was when the reader first marked it. Never changes. */
  originalQuote: string;
}

export type AnnotationKind = "highlight" | "note" | "bookmark";
export type HighlightColor = "yellow" | "green" | "blue" | "pink" | "purple";
export type HighlightStyle = "highlight" | "underline" | "none";

export interface Annotation {
  id: string;
  docId: string;
  kind: AnnotationKind;
  color: HighlightColor | null;
  style: HighlightStyle;
  /** The reader's note, Markdown. */
  body: string | null;
  tags: string[];
  anchor: AnchorView;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** An annotation with where it lives, for library-wide lists (GET /api/highlights). */
export interface LibraryAnnotation extends Annotation {
  docTitle: string;
  docAuthor?: string;
  /** Title of the section holding it now (null when orphaned). */
  sectionTitle: string | null;
  /** Deep link for the UI's router: /read/<docId>/<sectionId>#<blockId>. */
  href: string;
}

export interface CreateAnnotation extends AnchorInput {
  /** Client-generated id (8–64 of [A-Za-z0-9_-]) for optimistic UI. Re-sending the same id and payload is safe. */
  id?: string;
  kind?: AnnotationKind;
  color?: HighlightColor | null;
  style?: HighlightStyle;
  body?: string | null;
  tags?: string[];
}

export interface UpdateAnnotation {
  kind?: AnnotationKind;
  color?: HighlightColor | null;
  style?: HighlightStyle;
  body?: string | null;
  tags?: string[];
  /** Move the annotation (or reattach an orphan) to a new range. */
  reattach?: AnchorInput;
  /** Accept a fuzzy match as correct: status becomes "anchored". */
  acceptAnchor?: true;
}

/** Generic records for smart tools: `/api/tools/:toolId/records`. Data is opaque JSON (≤ 64 KB). */
export interface ToolRecord {
  id: string;
  toolId: string;
  docId: string | null;
  /** Present when the record was attached to a place. */
  anchor: AnchorView | null;
  data: unknown;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateToolRecord {
  id?: string;
  docId?: string;
  /** Attach the record to a place (requires docId). */
  anchor?: AnchorInput;
  data: unknown;
}

export interface UpdateToolRecord {
  data?: unknown;
  anchor?: AnchorInput | null;
}
