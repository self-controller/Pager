//! The structured document model: what a file becomes after parsing (shared/src/document.ts).
//!
//! Coordinate rule: every text-bearing block ("leaf") has an `id` and a plain `text`. The plain text of
//! its `content` equals `text` exactly, where a `br` counts as one "\n" and atoms (note references,
//! images) count as nothing. Every place a reader marks is a `{ blockId, offset }` into that text
//! (UTF-16 code units).
//!
//! Draft trees carry a hidden `tid` on every anchorable thing (blocks, list items, leaves, notes): the
//! builder tracks link targets by it, as the TypeScript builder did by object identity.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mark {
    Code,
    Em,
    Mark,
    Smallcaps,
    Strike,
    Strong,
    Sub,
    Sup,
    Underline,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TextRun {
    pub text: String,
    /// Sorted, unique.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marks: Option<Vec<Mark>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ImageRef {
    /// `/api/assets/<sha>.<ext>` for local images; the original URL when `remote` is true.
    pub src: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub remote: bool,
    pub alt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ImageInline {
    pub image: ImageRef,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum LinkTarget {
    Internal { section_id: String, block_id: String },
    External { url: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LinkInline {
    pub target: LinkTarget,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub children: Vec<Inline>,
    /// Draft only: the key this internal link resolves at finalize time.
    #[serde(skip)]
    pub pending: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRefInline {
    pub note_id: String,
    /// What the author printed: "1", "*", "†". Not part of the block's text.
    pub label: String,
    /// Draft only: the note this reference points at.
    #[serde(skip)]
    pub note_tid: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum Inline {
    Text(TextRun),
    Link(LinkInline),
    NoteRef(NoteRefInline),
    Image(ImageInline),
    Br,
}

impl Inline {
    pub fn text(text: impl Into<String>) -> Inline {
        Inline::Text(TextRun { text: text.into(), marks: None })
    }

    pub fn text_marked(text: impl Into<String>, marks: &[Mark]) -> Inline {
        Inline::Text(TextRun { text: text.into(), marks: sort_marks(marks) })
    }

    pub fn image(image: ImageRef) -> Inline {
        Inline::Image(ImageInline { image })
    }
}

/// Sorted, unique marks; None when empty.
pub fn sort_marks(marks: &[Mark]) -> Option<Vec<Mark>> {
    let mut v: Vec<Mark> = marks.to_vec();
    v.sort();
    v.dedup();
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Align {
    Center,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CellAlign {
    Left,
    Center,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ParagraphVariant {
    Verse,
}

/// What every leaf (heading, paragraph, code, cell, caption) shares.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct Leaf {
    pub id: String,
    pub text: String,
    pub content: Vec<Inline>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<Align>,
    /// Source line (Markdown/TXT), 1-based.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(skip)]
    pub tid: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HeadingBlock {
    #[serde(flatten)]
    pub leaf: Leaf,
    pub level: u8,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ParagraphBlock {
    #[serde(flatten)]
    pub leaf: Leaf,
    /// "verse": line breaks and indentation are the author's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<ParagraphVariant>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CodeBlock {
    #[serde(flatten)]
    pub leaf: Leaf,
    pub lang: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum CellTag {
    #[default]
    #[serde(rename = "cell")]
    Cell,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCell {
    #[serde(rename = "type", default)]
    pub kind: CellTag,
    #[serde(flatten)]
    pub leaf: Leaf,
    pub header: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub colspan: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rowspan: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell_align: Option<CellAlign>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum CaptionTag {
    #[default]
    #[serde(rename = "caption")]
    Caption,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CaptionBlock {
    #[serde(rename = "type", default)]
    pub kind: CaptionTag,
    #[serde(flatten)]
    pub leaf: Leaf,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ListItem {
    pub id: String,
    /// Task lists: true/false; absent for ordinary items.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked: Option<bool>,
    pub blocks: Vec<Block>,
    #[serde(skip)]
    pub tid: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ListBlock {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<Align>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    pub ordered: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<i64>,
    pub items: Vec<ListItem>,
    #[serde(skip)]
    pub tid: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BlockquoteBlock {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<Align>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    pub blocks: Vec<Block>,
    #[serde(skip)]
    pub tid: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AsideBlock {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<Align>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    /// "note", "tip", "warning", "sidebar", ...
    pub variant: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub blocks: Vec<Block>,
    #[serde(skip)]
    pub tid: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TableRow {
    pub header: bool,
    pub cells: Vec<TableCell>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TableBlock {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<Align>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caption: Option<CaptionBlock>,
    pub rows: Vec<TableRow>,
    #[serde(skip)]
    pub tid: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FigureBlock {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<Align>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    pub images: Vec<ImageRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caption: Option<CaptionBlock>,
    #[serde(skip)]
    pub tid: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RuleBlock {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(skip)]
    pub tid: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Block {
    Heading(HeadingBlock),
    Paragraph(ParagraphBlock),
    Code(CodeBlock),
    List(ListBlock),
    Blockquote(BlockquoteBlock),
    Aside(AsideBlock),
    Table(TableBlock),
    Figure(FigureBlock),
    Hr(RuleBlock),
}

impl Block {
    pub fn id(&self) -> &str {
        match self {
            Block::Heading(b) => &b.leaf.id,
            Block::Paragraph(b) => &b.leaf.id,
            Block::Code(b) => &b.leaf.id,
            Block::List(b) => &b.id,
            Block::Blockquote(b) => &b.id,
            Block::Aside(b) => &b.id,
            Block::Table(b) => &b.id,
            Block::Figure(b) => &b.id,
            Block::Hr(b) => &b.id,
        }
    }

    pub fn tid(&self) -> u32 {
        match self {
            Block::Heading(b) => b.leaf.tid,
            Block::Paragraph(b) => b.leaf.tid,
            Block::Code(b) => b.leaf.tid,
            Block::List(b) => b.tid,
            Block::Blockquote(b) => b.tid,
            Block::Aside(b) => b.tid,
            Block::Table(b) => b.tid,
            Block::Figure(b) => b.tid,
            Block::Hr(b) => b.tid,
        }
    }

    pub fn is_heading(&self) -> bool {
        matches!(self, Block::Heading(_))
    }

    pub fn heading_level(&self) -> Option<u8> {
        match self {
            Block::Heading(h) => Some(h.level),
            _ => None,
        }
    }

    /// The leaf of a heading, paragraph or code block.
    pub fn leaf(&self) -> Option<&Leaf> {
        match self {
            Block::Heading(b) => Some(&b.leaf),
            Block::Paragraph(b) => Some(&b.leaf),
            Block::Code(b) => Some(&b.leaf),
            _ => None,
        }
    }

    pub fn leaf_mut(&mut self) -> Option<&mut Leaf> {
        match self {
            Block::Heading(b) => Some(&mut b.leaf),
            Block::Paragraph(b) => Some(&mut b.leaf),
            Block::Code(b) => Some(&mut b.leaf),
            _ => None,
        }
    }
}

/// A footnote or endnote: out of the reading flow and outside the annotation coordinate space.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub label: String,
    pub blocks: Vec<Block>,
    #[serde(skip)]
    pub tid: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DocSection {
    pub id: String,
    pub title: String,
    /// Nesting depth from the author's table of contents, starting at 0.
    pub depth: u32,
    /// True when the section was cut for size rather than by the author's structure.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub synthetic: bool,
    pub blocks: Vec<Block>,
    pub notes: Vec<Note>,
}

/// One heading or table-of-contents entry, for navigation within and across sections.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineEntry {
    pub title: String,
    pub depth: u32,
    pub section_id: String,
    pub block_id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMeta {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    pub authors: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    /// EPUB dc:identifier, ISBN, ...
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identifier: Option<String>,
    /// ISO date or bare year.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// /api/assets/...
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
}

/// Bump when the shape of ParsedDocument changes (cached revisions are re-parsed).
pub const MODEL_VERSION: u32 = 1;

/// What a converter hands back once finalised; also what is cached per revision.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedDocument {
    pub model_version: u32,
    pub parser_version: u32,
    pub format: String,
    pub meta: DocumentMeta,
    pub sections: Vec<DocSection>,
    pub outline: Vec<OutlineEntry>,
    pub warnings: Vec<String>,
    pub word_count: u64,
    /// Length of the document text (leaf texts joined by "\n"), in UTF-16 units.
    pub doc_chars: usize,
    /// Asset files (sha.ext) this document references.
    pub assets: Vec<String>,
}

/// Depth-first leaves of a block list, including table cells and captions.
pub fn leaves_of<'a>(blocks: &'a [Block], out: &mut Vec<&'a Leaf>) {
    for b in blocks {
        leaves_of_block(b, out);
    }
}

pub fn leaves_of_block<'a>(b: &'a Block, out: &mut Vec<&'a Leaf>) {
    match b {
        Block::Heading(x) => out.push(&x.leaf),
        Block::Paragraph(x) => out.push(&x.leaf),
        Block::Code(x) => out.push(&x.leaf),
        Block::List(l) => {
            for it in &l.items {
                leaves_of(&it.blocks, out);
            }
        }
        Block::Blockquote(q) => leaves_of(&q.blocks, out),
        Block::Aside(a) => leaves_of(&a.blocks, out),
        Block::Table(t) => {
            if let Some(c) = &t.caption {
                out.push(&c.leaf);
            }
            for r in &t.rows {
                for c in &r.cells {
                    out.push(&c.leaf);
                }
            }
        }
        Block::Figure(f) => {
            if let Some(c) = &f.caption {
                out.push(&c.leaf);
            }
        }
        Block::Hr(_) => {}
    }
}

pub fn all_leaves(blocks: &[Block]) -> Vec<&Leaf> {
    let mut out = Vec::new();
    leaves_of(blocks, &mut out);
    out
}

pub fn first_leaf(blocks: &[Block]) -> Option<&Leaf> {
    for b in blocks {
        let mut out = Vec::new();
        leaves_of_block(b, &mut out);
        if let Some(l) = out.into_iter().next() {
            return Some(l);
        }
    }
    None
}

/// Mutable depth-first leaves (same order as `leaves_of`).
pub fn leaves_of_mut<'a>(blocks: &'a mut [Block], out: &mut Vec<&'a mut Leaf>) {
    for b in blocks {
        match b {
            Block::Heading(x) => out.push(&mut x.leaf),
            Block::Paragraph(x) => out.push(&mut x.leaf),
            Block::Code(x) => out.push(&mut x.leaf),
            Block::List(l) => {
                for it in &mut l.items {
                    leaves_of_mut(&mut it.blocks, out);
                }
            }
            Block::Blockquote(q) => leaves_of_mut(&mut q.blocks, out),
            Block::Aside(a) => leaves_of_mut(&mut a.blocks, out),
            Block::Table(t) => {
                if let Some(c) = &mut t.caption {
                    out.push(&mut c.leaf);
                }
                for r in &mut t.rows {
                    for c in &mut r.cells {
                        out.push(&mut c.leaf);
                    }
                }
            }
            Block::Figure(f) => {
                if let Some(c) = &mut f.caption {
                    out.push(&mut c.leaf);
                }
            }
            Block::Hr(_) => {}
        }
    }
}

/// The plain text of inline content: text runs, link text, "\n" per br; atoms count as nothing.
pub fn plain_text(content: &[Inline]) -> String {
    let mut s = String::new();
    plain_text_into(content, &mut s);
    s
}

fn plain_text_into(content: &[Inline], s: &mut String) {
    for c in content {
        match c {
            Inline::Text(t) => s.push_str(&t.text),
            Inline::Br => s.push('\n'),
            Inline::Link(l) => plain_text_into(&l.children, s),
            _ => {}
        }
    }
}
