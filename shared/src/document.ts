/**
 * The structured document model: what a file becomes after parsing. The server keeps this as the
 * source of truth and renders HTML from it (see API.md, "HTML vocabulary"); clients get it with
 * `?include=blocks`.
 *
 * Coordinate rule: every text-bearing block ("leaf") has an `id` and a plain `text`. The plain text of
 * its `content` equals `text` exactly, where a `br` counts as one "\n" and atoms (note references,
 * images) count as nothing. Every place a reader marks is a `{ blockId, offset }` into that text
 * (UTF-16 code units).
 *
 * Type-only module: cross-file imports in shared/ must be `import type`.
 */

export type Mark = "em" | "strong" | "code" | "sup" | "sub" | "strike" | "underline" | "smallcaps" | "mark";

export interface TextRun {
  t: "text";
  text: string;
  /** Sorted, unique. */
  marks?: Mark[];
}

export interface ImageRef {
  /** `/api/assets/<sha>.<ext>` for local images; the original URL when `remote` is true. */
  src: string;
  remote?: boolean;
  alt: string;
  title?: string;
  width?: number;
  height?: number;
}

export interface ImageInline {
  t: "image";
  image: ImageRef;
}

export interface BreakInline {
  t: "br";
}

export type LinkTarget =
  | { kind: "internal"; sectionId: string; blockId: string }
  | { kind: "external"; url: string };

export interface LinkInline {
  t: "link";
  target: LinkTarget;
  title?: string;
  children: Array<TextRun | ImageInline | BreakInline>;
}

export interface NoteRefInline {
  t: "noteRef";
  noteId: string;
  /** What the author printed: "1", "*", "†". Not part of the block's text. */
  label: string;
}

export type Inline = TextRun | LinkInline | NoteRefInline | ImageInline | BreakInline;

export type Align = "center" | "right";

interface BlockBase {
  id: string;
  align?: Align;
  /** Source line (Markdown/TXT), 1-based, for "open in editor" and diffs. */
  line?: number;
}

/** A block that carries text and can be annotated. */
export interface LeafBase extends BlockBase {
  text: string;
  content: Inline[];
}

export interface HeadingBlock extends LeafBase {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface ParagraphBlock extends LeafBase {
  type: "paragraph";
  /** "verse": line breaks and indentation are the author's; render with care. */
  variant?: "verse";
}

export interface CodeBlock extends LeafBase {
  type: "code";
  /** Whitespace is verbatim; content is a single text run. */
  lang: string | null;
}

export interface TableCell extends LeafBase {
  type: "cell";
  header: boolean;
  colspan?: number;
  rowspan?: number;
  cellAlign?: "left" | "center" | "right";
}

export interface CaptionBlock extends LeafBase {
  type: "caption";
}

export type LeafBlock = HeadingBlock | ParagraphBlock | CodeBlock | TableCell | CaptionBlock;

export interface ListItem {
  id: string;
  /** Task lists: true/false; undefined for ordinary items. */
  checked?: boolean;
  blocks: Block[];
}

export interface ListBlock extends BlockBase {
  type: "list";
  ordered: boolean;
  start?: number;
  items: ListItem[];
}

export interface BlockquoteBlock extends BlockBase {
  type: "blockquote";
  blocks: Block[];
}

export interface AsideBlock extends BlockBase {
  type: "aside";
  /** "note", "tip", "warning", "sidebar", ... (Markdown callouts, EPUB sidebars). */
  variant: string;
  title?: string;
  blocks: Block[];
}

export interface TableRow {
  header: boolean;
  cells: TableCell[];
}

export interface TableBlock extends BlockBase {
  type: "table";
  caption?: CaptionBlock;
  rows: TableRow[];
}

export interface FigureBlock extends BlockBase {
  type: "figure";
  images: ImageRef[];
  caption?: CaptionBlock;
}

export interface RuleBlock extends BlockBase {
  type: "hr";
}

export type Block =
  | HeadingBlock
  | ParagraphBlock
  | CodeBlock
  | ListBlock
  | BlockquoteBlock
  | AsideBlock
  | TableBlock
  | FigureBlock
  | RuleBlock;

/** A footnote or endnote: out of the reading flow and outside the annotation coordinate space. */
export interface Note {
  id: string;
  label: string;
  blocks: Block[];
}

export interface DocSection {
  id: string;
  title: string;
  /** Nesting depth from the author's table of contents, starting at 0. */
  depth: number;
  /** True when the section was cut for size rather than by the author's structure. */
  synthetic?: boolean;
  blocks: Block[];
  notes: Note[];
}

/** One heading or table-of-contents entry, for navigation within and across sections. */
export interface OutlineEntry {
  title: string;
  depth: number;
  sectionId: string;
  blockId: string;
}
