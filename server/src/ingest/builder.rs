//! Converters build a draft (shared Block types with empty ids and texts), then `finalize` turns it
//! into a ParsedDocument:
//!
//!   1. link fix-up: links to notes become note references, links to nowhere are unwrapped;
//!   2. normalise every leaf's inline content and compute its plain `text` (the coordinate space);
//!   3. prune empty blocks; an image-only paragraph becomes a figure;
//!   4. split into sections (unless the converter already did, as EPUB does), then by size;
//!   5. assign content-derived ids; resolve internal links to {sectionId, blockId};
//!   6. collect the outline, word count and assets.
//!
//! The invariant every later stage relies on: plain_text(leaf.content) == leaf.text.

use crate::config::limits;
use crate::ids::short_hash;
use crate::model::*;
use crate::util::utf16::len16;
use regex::Regex;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::OnceLock;

fn control_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new("[\u{0000}-\u{0008}\u{000b}\u{000c}\u{000e}-\u{001f}\u{007f}-\u{009f}]").unwrap())
}

fn ws_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new("[ \t\n\r\u{000c}\u{000b}]+").unwrap())
}

pub fn count_words(text: &str) -> u64 {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"[\p{L}\p{N}][\p{L}\p{N}'’\-]*").unwrap());
    re.find_iter(text).count() as u64
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SplitMode {
    Headings,
    Chapters,
    None,
}

/// A section a converter hands in (EPUB), or one the builder makes by splitting.
#[derive(Clone, Debug)]
pub struct DraftSection {
    pub id: Option<String>,
    pub title: String,
    pub depth: u32,
    pub blocks: Vec<Block>,
    pub notes: Vec<Note>,
    pub synthetic: bool,
    /// Ask for the same structural split a flat list gets (TXT's chapters).
    pub split: Option<SplitMode>,
}

impl DraftSection {
    pub fn new(title: impl Into<String>, depth: u32, blocks: Vec<Block>) -> DraftSection {
        DraftSection { id: None, title: title.into(), depth, blocks, notes: Vec::new(), synthetic: false, split: None }
    }
}

pub struct DraftDocument {
    pub meta: DocumentMeta,
    /// Either a flat block list (split by headings here) or ready-made sections (EPUB).
    pub blocks: Option<Vec<Block>>,
    pub sections: Option<Vec<DraftSection>>,
    /// Document-level notes (Markdown/DOCX footnotes); attached to the section that first cites them.
    pub notes: Vec<Note>,
    pub warnings: Vec<String>,
    pub split: SplitMode,
    /// For "chapters": is this heading a chapter start?
    pub is_chapter_heading: Option<fn(&str) -> bool>,
}

impl DraftDocument {
    pub fn flat(meta: DocumentMeta, blocks: Vec<Block>, notes: Vec<Note>, split: SplitMode) -> DraftDocument {
        DraftDocument { meta, blocks: Some(blocks), sections: None, notes, warnings: Vec::new(), split, is_chapter_heading: None }
    }
}

pub struct DocBuilder {
    pub format: String,
    pub parser_version: u32,
    /// Element ids, heading slugs, footnote labels → the thing they name (a tid).
    pub anchors: HashMap<String, u32>,
    pub warnings: Vec<String>,
    pub assets: BTreeSet<String>,
    pending_links: HashMap<u32, String>,
    linked_keys: HashSet<String>,
    next_tid: u32,
    next_link: u32,
}

impl DocBuilder {
    pub fn new(format: &str, parser_version: u32) -> DocBuilder {
        DocBuilder {
            format: format.to_string(),
            parser_version,
            anchors: HashMap::new(),
            warnings: Vec::new(),
            assets: BTreeSet::new(),
            pending_links: HashMap::new(),
            linked_keys: HashSet::new(),
            next_tid: 1,
            next_link: 1,
        }
    }

    /// A fresh identity for a draft block, list item, leaf or note.
    pub fn tid(&mut self) -> u32 {
        let t = self.next_tid;
        self.next_tid += 1;
        t
    }

    pub fn warn(&mut self, message: &str) {
        if !self.warnings.iter().any(|w| w == message) {
            self.warnings.push(message.to_string());
        }
    }

    /// Register an element id (or Markdown heading slug, footnote label...) as a link target.
    pub fn anchor(&mut self, key: &str, target: u32) {
        if !key.is_empty() && !self.anchors.contains_key(key) {
            self.anchors.insert(key.to_string(), target);
        }
    }

    /// Point a key at a target even if it was registered before (a note overrides its insides).
    pub fn anchor_set(&mut self, key: &str, target: u32) {
        self.anchors.insert(key.to_string(), target);
    }

    /// A link to a key resolved at finalize time.
    pub fn internal_link(&mut self, key: &str, children: Vec<Inline>, title: Option<&str>) -> Inline {
        let id = self.next_link;
        self.next_link += 1;
        self.pending_links.insert(id, key.to_string());
        self.linked_keys.insert(key.to_string());
        Inline::Link(LinkInline {
            target: LinkTarget::Internal { section_id: String::new(), block_id: String::new() },
            title: title.filter(|t| !t.is_empty()).map(str::to_string),
            children,
            pending: Some(id),
        })
    }

    /// Has any link so far pointed at this key?
    pub fn is_linked(&self, key: &str) -> bool {
        self.linked_keys.contains(key)
    }

    // ---- Leaf constructors (ids and texts are filled in by finalize) ----

    fn leaf(&mut self, content: Vec<Inline>) -> Leaf {
        Leaf { id: String::new(), text: String::new(), content, align: None, line: None, tid: self.tid() }
    }

    pub fn paragraph(&mut self, content: Vec<Inline>, align: Option<Align>, line: Option<u32>, verse: bool) -> Block {
        let mut leaf = self.leaf(content);
        leaf.align = align;
        leaf.line = line;
        Block::Paragraph(ParagraphBlock { leaf, variant: if verse { Some(ParagraphVariant::Verse) } else { None } })
    }

    pub fn heading(&mut self, level: i64, content: Vec<Inline>, align: Option<Align>, line: Option<u32>) -> Block {
        let mut leaf = self.leaf(content);
        leaf.align = align;
        leaf.line = line;
        Block::Heading(HeadingBlock { leaf, level: level.clamp(1, 6) as u8 })
    }

    pub fn code(&mut self, text: &str, lang: Option<String>, line: Option<u32>) -> Block {
        let mut leaf = self.leaf(vec![Inline::text(text)]);
        leaf.line = line;
        Block::Code(CodeBlock { leaf, lang })
    }

    pub fn caption(&mut self, content: Vec<Inline>) -> CaptionBlock {
        CaptionBlock { kind: CaptionTag::Caption, leaf: self.leaf(content) }
    }

    pub fn cell(&mut self, content: Vec<Inline>, header: bool) -> TableCell {
        TableCell { kind: CellTag::Cell, leaf: self.leaf(content), header, colspan: None, rowspan: None, cell_align: None }
    }

    pub fn hr(&mut self, line: Option<u32>) -> Block {
        Block::Hr(RuleBlock { id: String::new(), line, tid: self.tid() })
    }

    pub fn list(&mut self, ordered: bool, items: Vec<ListItem>, line: Option<u32>) -> Block {
        Block::List(ListBlock { id: String::new(), align: None, line, ordered, start: None, items, tid: self.tid() })
    }

    pub fn item(&mut self, blocks: Vec<Block>, checked: Option<bool>) -> ListItem {
        ListItem { id: String::new(), checked, blocks, tid: self.tid() }
    }

    pub fn blockquote(&mut self, blocks: Vec<Block>, align: Option<Align>, line: Option<u32>) -> Block {
        Block::Blockquote(BlockquoteBlock { id: String::new(), align, line, blocks, tid: self.tid() })
    }

    pub fn aside(&mut self, variant: &str, title: Option<String>, blocks: Vec<Block>, line: Option<u32>) -> Block {
        Block::Aside(AsideBlock { id: String::new(), align: None, line, variant: variant.to_string(), title, blocks, tid: self.tid() })
    }

    pub fn table(&mut self, rows: Vec<TableRow>, caption: Option<CaptionBlock>, line: Option<u32>) -> Block {
        Block::Table(TableBlock { id: String::new(), align: None, line, caption, rows, tid: self.tid() })
    }

    pub fn figure(&mut self, images: Vec<ImageRef>, caption: Option<CaptionBlock>, align: Option<Align>) -> Block {
        Block::Figure(FigureBlock { id: String::new(), align, line: None, images, caption, tid: self.tid() })
    }

    pub fn note(&mut self, label: &str, blocks: Vec<Block>) -> Note {
        Note { id: String::new(), label: label.to_string(), blocks, tid: self.tid() }
    }

    // ---- Finalize ----

    pub fn finalize(mut self, draft: DraftDocument) -> ParsedDocument {
        for w in &draft.warnings {
            self.warn(w);
        }
        let DraftDocument { meta, blocks, sections, notes: doc_notes, split, is_chapter_heading, .. } = draft;

        // Every note's identity and original label, so links can become note references.
        let mut note_labels: HashMap<u32, String> = HashMap::new();
        for n in &doc_notes {
            note_labels.insert(n.tid, n.label.clone());
        }
        if let Some(secs) = &sections {
            for s in secs {
                for n in &s.notes {
                    note_labels.insert(n.tid, n.label.clone());
                }
            }
        }
        // Leaves of every container, in order, before anything is pruned (for links to containers).
        let mut container_leaves: HashMap<u32, Vec<u32>> = HashMap::new();
        {
            let walk_blocks = |bs: &[Block], cl: &mut HashMap<u32, Vec<u32>>| collect_container_leaves(bs, cl);
            if let Some(bs) = &blocks {
                walk_blocks(bs, &mut container_leaves);
            }
            if let Some(secs) = &sections {
                for s in secs {
                    walk_blocks(&s.blocks, &mut container_leaves);
                }
            }
        }

        let mut st = Finalizer {
            pending_links: std::mem::take(&mut self.pending_links),
            anchors: std::mem::take(&mut self.anchors),
            note_labels,
            order: Vec::new(),
            pruned: HashSet::new(),
            leaf_types: HashMap::new(),
        };

        // 2 + 3. Normalise leaves, prune empties.
        let mut draft_sections: Vec<DraftSection> = match sections {
            Some(secs) => {
                let mut out = Vec::new();
                for s in secs {
                    let blocks = st.norm_blocks(s.blocks);
                    let s_notes: Vec<Note> = s.notes.into_iter().map(|n| st.norm_note(n)).collect();
                    match s.split {
                        None => out.push(DraftSection { id: s.id, title: s.title, depth: s.depth, blocks, notes: s_notes, synthetic: s.synthetic, split: None }),
                        Some(mode) => {
                            let mut parts = split_by_structure(blocks, &s.title, mode, is_chapter_heading);
                            for p in &mut parts {
                                p.depth += s.depth;
                            }
                            parts[0].notes = s_notes;
                            out.extend(parts);
                        }
                    }
                }
                out
            }
            None => {
                let blocks = st.norm_blocks(blocks.unwrap_or_default());
                split_by_structure(blocks, &meta.title, split, is_chapter_heading)
            }
        };
        let doc_notes: Vec<Note> = doc_notes.into_iter().map(|n| st.norm_note(n)).filter(|n| !n.blocks.is_empty()).collect();
        let total = draft_sections.len();
        let mut kept: Vec<DraftSection> = Vec::new();
        for (i, s) in draft_sections.drain(..).enumerate() {
            if !s.blocks.is_empty() || (i == 0 && total == 1) {
                kept.push(s);
            }
        }
        if kept.is_empty() {
            kept.push(DraftSection::new(meta.title.clone(), 0, Vec::new()));
        }
        let draft_sections: Vec<DraftSection> = kept.into_iter().flat_map(split_by_size).collect();

        // 5. Ids. Leaves: hash of type + text, "-2", "-3" for repeats. Containers: hash of their children.
        let mut ids = IdAssigner { used: HashMap::new() };
        let mut final_sections: Vec<DocSection> = Vec::new();
        let mut leaf_section: HashMap<u32, String> = HashMap::new();
        let mut leaf_ids: HashMap<u32, String> = HashMap::new();
        let mut section_ids: HashMap<String, u32> = HashMap::new();
        for mut s in draft_sections {
            ids.assign_blocks(&mut s.blocks);
            for l in all_leaves(&s.blocks) {
                leaf_ids.insert(l.tid, l.id.clone());
            }
            let first = first_leaf(&s.blocks);
            let base = format!("s{}", short_hash(s.id.as_deref().or(first.map(|l| l.id.as_str())).unwrap_or(&s.title), 10));
            let n = section_ids.entry(base.clone()).or_insert(0);
            *n += 1;
            let id = if *n == 1 { base } else { format!("{base}-{n}") };
            for l in all_leaves(&s.blocks) {
                leaf_section.insert(l.tid, id.clone());
            }
            let title = if !s.title.is_empty() {
                s.title.clone()
            } else if let Some(f) = first {
                let t: String = f.text.chars().take(80).collect();
                if t.is_empty() {
                    meta.title.clone()
                } else {
                    t
                }
            } else {
                meta.title.clone()
            };
            final_sections.push(DocSection { id, title, depth: s.depth, synthetic: s.synthetic, blocks: s.blocks, notes: s.notes });
        }

        // Notes: ids, then attach document-level notes to the section that first cites them.
        let mut doc_notes = doc_notes;
        for n in doc_notes.iter_mut() {
            st.apply_note_label(n);
            let block_ids = ids.assign_blocks(&mut n.blocks);
            n.id = ids.unique(&format!("n{}", short_hash(&format!("{}\u{0}{}", n.label, block_ids.join(",")), 11)));
        }
        let mut note_ids: HashMap<u32, String> = HashMap::new();
        for n in &doc_notes {
            note_ids.insert(n.tid, n.id.clone());
        }
        for s in final_sections.iter_mut() {
            for n in s.notes.iter_mut() {
                st.apply_note_label(n);
                let block_ids = ids.assign_blocks(&mut n.blocks);
                n.id = ids.unique(&format!("n{}", short_hash(&format!("{}\u{0}{}", n.label, block_ids.join(",")), 11)));
                note_ids.insert(n.tid, n.id.clone());
            }
        }

        // Resolve note references and internal links.
        let last_index = final_sections.len() - 1;
        let mut note_section: HashMap<u32, usize> = HashMap::new();
        let resolver = Resolver { st: &st, leaf_section: &leaf_section, leaf_ids: &leaf_ids, note_ids: &note_ids, container_leaves: &container_leaves };
        for si in 0..final_sections.len() {
            let mut leaves = Vec::new();
            leaves_of_mut(&mut final_sections[si].blocks, &mut leaves);
            for l in leaves {
                l.content = resolver.resolve_content(std::mem::take(&mut l.content), si, &mut note_section);
            }
        }
        for n in doc_notes.iter_mut() {
            let si = note_section.get(&n.tid).copied().unwrap_or(last_index);
            let mut leaves = Vec::new();
            leaves_of_mut(&mut n.blocks, &mut leaves);
            for l in leaves {
                l.content = resolver.resolve_content(std::mem::take(&mut l.content), si, &mut note_section);
            }
        }
        for si in 0..final_sections.len() {
            let mut notes = std::mem::take(&mut final_sections[si].notes);
            for n in notes.iter_mut() {
                let nsi = note_section.get(&n.tid).copied().unwrap_or(last_index);
                let mut leaves = Vec::new();
                leaves_of_mut(&mut n.blocks, &mut leaves);
                for l in leaves {
                    l.content = resolver.resolve_content(std::mem::take(&mut l.content), nsi, &mut note_section);
                }
            }
            final_sections[si].notes = notes;
        }
        // Notes referenced from inside notes may only now have a section.
        for n in doc_notes {
            let si = note_section.get(&n.tid).copied().unwrap_or(last_index);
            final_sections[si].notes.push(n);
        }

        // 6. Outline, counts, assets.
        let mut outline: Vec<OutlineEntry> = Vec::new();
        let mut words: u64 = 0;
        let mut chars: usize = 0;
        let mut first_leaf_seen = false;
        for s in &final_sections {
            let mut saw_heading = false;
            for b in &s.blocks {
                outline_walk(b, s, &mut outline, &mut saw_heading, &mut words, &mut chars, &mut first_leaf_seen);
            }
        }
        ParsedDocument {
            model_version: MODEL_VERSION,
            parser_version: self.parser_version,
            format: self.format.clone(),
            meta,
            sections: final_sections,
            outline,
            warnings: self.warnings.clone(),
            word_count: words,
            doc_chars: chars,
            assets: self.assets.iter().cloned().collect(),
        }
    }
}

fn outline_walk(b: &Block, s: &DocSection, outline: &mut Vec<OutlineEntry>, saw_heading: &mut bool, words: &mut u64, chars: &mut usize, first: &mut bool) {
    let mut leaves = Vec::new();
    leaves_of_block(b, &mut leaves);
    for l in leaves {
        *chars += if *first { l.text_len16() + 1 } else { l.text_len16() };
        *first = true;
        *words += count_words(&l.text);
    }
    if let Block::Heading(h) = b {
        let depth = s.depth + if *saw_heading { (h.level as u32).saturating_sub(1).max(1) } else { 0 };
        outline.push(OutlineEntry { title: h.leaf.text.clone(), depth, section_id: s.id.clone(), block_id: h.leaf.id.clone() });
        *saw_heading = true;
    } else {
        // Headings nested in containers count too (leavesOf order), as the original walked leaves.
        let mut leaves = Vec::new();
        leaves_of_block(b, &mut leaves);
        for l in leaves {
            if let Some(level) = heading_level_of_leaf(b, l) {
                let depth = s.depth + if *saw_heading { (level as u32).saturating_sub(1).max(1) } else { 0 };
                outline.push(OutlineEntry { title: l.text.clone(), depth, section_id: s.id.clone(), block_id: l.id.clone() });
                *saw_heading = true;
            }
        }
    }
}

/// The heading level of a leaf nested somewhere inside `b`, if that leaf is a heading.
fn heading_level_of_leaf(b: &Block, leaf: &Leaf) -> Option<u8> {
    match b {
        Block::Heading(h) => (h.leaf.tid == leaf.tid).then_some(h.level),
        Block::List(l) => l.items.iter().flat_map(|it| it.blocks.iter()).find_map(|x| heading_level_of_leaf(x, leaf)),
        Block::Blockquote(q) => q.blocks.iter().find_map(|x| heading_level_of_leaf(x, leaf)),
        Block::Aside(a) => a.blocks.iter().find_map(|x| heading_level_of_leaf(x, leaf)),
        _ => None,
    }
}

impl Leaf {
    pub fn text_len16(&self) -> usize {
        len16(&self.text)
    }
}

fn collect_container_leaves(blocks: &[Block], out: &mut HashMap<u32, Vec<u32>>) {
    for b in blocks {
        match b {
            Block::List(l) => {
                let mut mine = Vec::new();
                for it in &l.items {
                    let mut item_leaves = Vec::new();
                    leaves_of(&it.blocks, &mut item_leaves);
                    let tids: Vec<u32> = item_leaves.iter().map(|x| x.tid).collect();
                    out.insert(it.tid, tids.clone());
                    mine.extend(tids);
                    collect_container_leaves(&it.blocks, out);
                }
                out.insert(l.tid, mine);
            }
            Block::Blockquote(q) => {
                out.insert(q.tid, all_leaves(&q.blocks).iter().map(|x| x.tid).collect());
                collect_container_leaves(&q.blocks, out);
            }
            Block::Aside(a) => {
                out.insert(a.tid, all_leaves(&a.blocks).iter().map(|x| x.tid).collect());
                collect_container_leaves(&a.blocks, out);
            }
            Block::Table(t) => {
                let mut v = Vec::new();
                leaves_of_block(b, &mut v);
                out.insert(t.tid, v.iter().map(|x| x.tid).collect());
            }
            Block::Figure(f) => {
                let mut v = Vec::new();
                leaves_of_block(b, &mut v);
                out.insert(f.tid, v.iter().map(|x| x.tid).collect());
            }
            Block::Hr(r) => {
                out.insert(r.tid, Vec::new());
            }
            _ => {}
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum LeafType {
    Heading,
    Paragraph,
    Code,
    Cell,
    Caption,
}

struct Finalizer {
    pending_links: HashMap<u32, String>,
    anchors: HashMap<String, u32>,
    /// Note tid → its label (updated as links name it).
    note_labels: HashMap<u32, String>,
    /// Every leaf (pruned or not) in document order.
    order: Vec<u32>,
    pruned: HashSet<u32>,
    leaf_types: HashMap<u32, LeafType>,
}

impl Finalizer {
    fn is_note(&self, tid: u32) -> bool {
        self.note_labels.contains_key(&tid)
    }

    /// 1. Link fix-up (before text is computed: turning a link into a note reference changes text).
    fn fix_links(&mut self, content: Vec<Inline>) -> Vec<Inline> {
        let mut out = Vec::with_capacity(content.len());
        for c in content {
            let Inline::Link(link) = c else {
                out.push(c);
                continue;
            };
            let Some(key) = link.pending.and_then(|p| self.pending_links.get(&p)).cloned() else {
                out.push(Inline::Link(link));
                continue;
            };
            match self.anchors.get(&key).copied() {
                None => out.extend(link.children),
                Some(target) if self.is_note(target) => {
                    let current = self.note_labels.get(&target).cloned().unwrap_or_default();
                    let mut label = plain_text(&link.children).trim().to_string();
                    if label.starts_with('[') && label.ends_with(']') && label.len() >= 2 {
                        label = label[1..label.len() - 1].to_string();
                    }
                    if label.is_empty() {
                        label = current.clone();
                    }
                    if current.is_empty() {
                        self.note_labels.insert(target, label.clone());
                    }
                    out.push(Inline::NoteRef(NoteRefInline { note_id: String::new(), label, note_tid: Some(target) }));
                }
                Some(_) => out.push(Inline::Link(link)),
            }
        }
        out
    }

    fn apply_note_label(&self, n: &mut Note) {
        if let Some(l) = self.note_labels.get(&n.tid) {
            n.label = l.clone();
        }
    }

    /// Normalise a leaf; returns whether it has anything to show (text or atoms).
    fn norm_leaf(&mut self, leaf: &mut Leaf, kind: LeafType) -> bool {
        self.order.push(leaf.tid);
        self.leaf_types.insert(leaf.tid, kind);
        let content = std::mem::take(&mut leaf.content);
        leaf.content = if kind == LeafType::Code { normalize_code(&content) } else { normalize_prose(self.fix_links(content)) };
        leaf.text = plain_text(&leaf.content);
        let keep = !leaf.text.is_empty() || has_atoms(&leaf.content);
        if !keep {
            self.pruned.insert(leaf.tid);
        }
        keep
    }

    fn norm_caption(&mut self, c: Option<CaptionBlock>) -> Option<CaptionBlock> {
        let mut c = c?;
        let keep = self.norm_leaf(&mut c.leaf, LeafType::Caption);
        if keep && !c.leaf.text.is_empty() {
            Some(c)
        } else {
            self.pruned.insert(c.leaf.tid);
            None
        }
    }

    fn norm_note(&mut self, mut n: Note) -> Note {
        n.blocks = self.norm_blocks(std::mem::take(&mut n.blocks));
        n
    }

    fn norm_blocks(&mut self, blocks: Vec<Block>) -> Vec<Block> {
        let mut out = Vec::with_capacity(blocks.len());
        for b in blocks {
            match b {
                Block::Heading(mut h) => {
                    if self.norm_leaf(&mut h.leaf, LeafType::Heading) && !h.leaf.text.is_empty() {
                        out.push(Block::Heading(h));
                    } else {
                        self.pruned.insert(h.leaf.tid);
                    }
                }
                Block::Code(mut c) => {
                    if self.norm_leaf(&mut c.leaf, LeafType::Code) && !c.leaf.text.is_empty() {
                        out.push(Block::Code(c));
                    } else {
                        self.pruned.insert(c.leaf.tid);
                    }
                }
                Block::Paragraph(mut p) => {
                    if !self.norm_leaf(&mut p.leaf, LeafType::Paragraph) {
                        continue;
                    }
                    if p.leaf.text.is_empty() {
                        let images = images_of(&p.leaf.content);
                        self.pruned.insert(p.leaf.tid);
                        if !images.is_empty() {
                            out.push(Block::Figure(FigureBlock { id: String::new(), align: p.leaf.align, line: None, images, caption: None, tid: p.leaf.tid }));
                        }
                        continue;
                    }
                    out.push(Block::Paragraph(p));
                }
                Block::List(mut l) => {
                    let items = std::mem::take(&mut l.items);
                    l.items = items
                        .into_iter()
                        .map(|mut it| {
                            it.blocks = self.norm_blocks(std::mem::take(&mut it.blocks));
                            it
                        })
                        .filter(|it| !it.blocks.is_empty() || it.checked.is_some())
                        .collect();
                    if !l.items.is_empty() {
                        out.push(Block::List(l));
                    }
                }
                Block::Blockquote(mut q) => {
                    q.blocks = self.norm_blocks(std::mem::take(&mut q.blocks));
                    if !q.blocks.is_empty() {
                        out.push(Block::Blockquote(q));
                    }
                }
                Block::Aside(mut a) => {
                    a.blocks = self.norm_blocks(std::mem::take(&mut a.blocks));
                    if !a.blocks.is_empty() {
                        out.push(Block::Aside(a));
                    }
                }
                Block::Table(mut t) => {
                    t.caption = self.norm_caption(t.caption.take());
                    for r in t.rows.iter_mut() {
                        for c in r.cells.iter_mut() {
                            self.norm_leaf(&mut c.leaf, LeafType::Cell);
                        }
                    }
                    t.rows.retain(|r| !r.cells.is_empty());
                    if !t.rows.is_empty() {
                        out.push(Block::Table(t));
                    }
                }
                Block::Figure(mut f) => {
                    f.caption = self.norm_caption(f.caption.take());
                    if !f.images.is_empty() || f.caption.is_some() {
                        out.push(Block::Figure(f));
                    }
                }
                Block::Hr(r) => out.push(Block::Hr(r)),
            }
        }
        out
    }
}

struct Resolver<'a> {
    st: &'a Finalizer,
    leaf_section: &'a HashMap<u32, String>,
    leaf_ids: &'a HashMap<u32, String>,
    note_ids: &'a HashMap<u32, String>,
    container_leaves: &'a HashMap<u32, Vec<u32>>,
}

impl Resolver<'_> {
    fn first_survivor(&self, tid: u32) -> Option<u32> {
        if !self.st.pruned.contains(&tid) {
            return Some(tid);
        }
        let i = self.st.order.iter().position(|&t| t == tid)?;
        self.st.order[i + 1..].iter().copied().find(|t| !self.st.pruned.contains(t) && self.leaf_section.contains_key(t))
    }

    fn target_leaf(&self, target: u32) -> Option<u32> {
        if self.st.is_note(target) {
            return None;
        }
        if self.st.leaf_types.contains_key(&target) {
            return self.first_survivor(target);
        }
        let leaves = self.container_leaves.get(&target)?;
        leaves.iter().copied().find_map(|l| self.first_survivor(l))
    }

    fn resolve_content(&self, content: Vec<Inline>, section_index: usize, note_section: &mut HashMap<u32, usize>) -> Vec<Inline> {
        let mut out = Vec::with_capacity(content.len());
        for c in content {
            match c {
                Inline::NoteRef(mut r) => {
                    if let Some(tid) = r.note_tid {
                        if let Some(id) = self.note_ids.get(&tid) {
                            r.note_id = id.clone();
                        }
                        note_section.entry(tid).or_insert(section_index);
                    }
                    out.push(Inline::NoteRef(r));
                }
                Inline::Link(mut link) => {
                    let internal = matches!(link.target, LinkTarget::Internal { .. });
                    let key = link.pending.and_then(|p| self.st.pending_links.get(&p));
                    match (internal, key) {
                        (true, Some(key)) => {
                            let leaf = self.st.anchors.get(key).and_then(|&t| self.target_leaf(t));
                            let resolved = leaf.and_then(|l| Some((self.leaf_section.get(&l)?.clone(), self.leaf_ids.get(&l)?.clone())));
                            match resolved {
                                Some((section_id, block_id)) => {
                                    link.target = LinkTarget::Internal { section_id, block_id };
                                    link.pending = None;
                                    out.push(Inline::Link(link));
                                }
                                None => out.extend(link.children),
                            }
                        }
                        _ => out.push(Inline::Link(link)),
                    }
                }
                other => out.push(other),
            }
        }
        out
    }
}

struct IdAssigner {
    used: HashMap<String, u32>,
}

impl IdAssigner {
    fn unique(&mut self, base: &str) -> String {
        let n = self.used.entry(base.to_string()).or_insert(0);
        *n += 1;
        if *n == 1 {
            base.to_string()
        } else {
            format!("{base}-{n}")
        }
    }

    fn leaf_key(kind: &str, leaf: &Leaf) -> String {
        if !leaf.text.is_empty() {
            format!("{kind}\u{0}{}", leaf.text)
        } else {
            format!("{kind}\u{0}{}", images_of(&leaf.content).iter().map(|i| i.src.as_str()).collect::<Vec<_>>().join("|"))
        }
    }

    fn assign_blocks(&mut self, blocks: &mut [Block]) -> Vec<String> {
        let mut ids: Vec<String> = Vec::with_capacity(blocks.len());
        for b in blocks.iter_mut() {
            match b {
                Block::Heading(h) => h.leaf.id = self.unique(&format!("b{}", short_hash(&Self::leaf_key("heading", &h.leaf), 11))),
                Block::Paragraph(p) => p.leaf.id = self.unique(&format!("b{}", short_hash(&Self::leaf_key("paragraph", &p.leaf), 11))),
                Block::Code(c) => c.leaf.id = self.unique(&format!("b{}", short_hash(&Self::leaf_key("code", &c.leaf), 11))),
                Block::List(l) => {
                    for it in l.items.iter_mut() {
                        let inner = self.assign_blocks(&mut it.blocks);
                        let checked = match it.checked {
                            Some(true) => "true",
                            Some(false) => "false",
                            None => "",
                        };
                        it.id = self.unique(&format!("i{}", short_hash(&format!("{}{}", inner.join(","), checked), 11)));
                    }
                    let item_ids: Vec<&str> = l.items.iter().map(|i| i.id.as_str()).collect();
                    l.id = self.unique(&format!("c{}", short_hash(&format!("list,{}", item_ids.join(",")), 11)));
                }
                Block::Blockquote(q) => {
                    let inner = self.assign_blocks(&mut q.blocks);
                    q.id = self.unique(&format!("c{}", short_hash(&format!("blockquote,{}", inner.join(",")), 11)));
                }
                Block::Aside(a) => {
                    let inner = self.assign_blocks(&mut a.blocks);
                    a.id = self.unique(&format!("c{}", short_hash(&format!("aside,{}", inner.join(",")), 11)));
                }
                Block::Table(t) => {
                    let mut cell_ids: Vec<String> = Vec::new();
                    if let Some(c) = &mut t.caption {
                        c.leaf.id = self.unique(&format!("b{}", short_hash(&Self::leaf_key("caption", &c.leaf), 11)));
                        cell_ids.push(c.leaf.id.clone());
                    }
                    for r in t.rows.iter_mut() {
                        for c in r.cells.iter_mut() {
                            c.leaf.id = self.unique(&format!("b{}", short_hash(&Self::leaf_key("cell", &c.leaf), 11)));
                            cell_ids.push(c.leaf.id.clone());
                        }
                    }
                    t.id = self.unique(&format!("c{}", short_hash(&format!("table,{}", cell_ids.join(",")), 11)));
                }
                Block::Figure(f) => {
                    if let Some(c) = &mut f.caption {
                        c.leaf.id = self.unique(&format!("b{}", short_hash(&Self::leaf_key("caption", &c.leaf), 11)));
                    }
                    let srcs: Vec<&str> = f.images.iter().map(|i| i.src.as_str()).collect();
                    f.id = self.unique(&format!("c{}", short_hash(&format!("figure,{}{}", srcs.join("|"), f.caption.as_ref().map(|c| c.leaf.id.as_str()).unwrap_or("")), 11)));
                }
                Block::Hr(r) => {
                    r.id = self.unique(&format!("c{}", short_hash(&format!("hr,{}", ids.last().map(String::as_str).unwrap_or("")), 11)));
                }
            }
            ids.push(b.id().to_string());
        }
        ids
    }
}

// ---------------------------------------------------------------------------------------------
// Inline normalisation

pub fn is_leaf(b: &Block) -> bool {
    matches!(b, Block::Heading(_) | Block::Paragraph(_) | Block::Code(_))
}

fn has_atoms(content: &[Inline]) -> bool {
    content.iter().any(|c| match c {
        Inline::Image(_) | Inline::NoteRef(_) => true,
        Inline::Link(l) => has_atoms(&l.children),
        _ => false,
    })
}

pub fn images_of(content: &[Inline]) -> Vec<ImageRef> {
    let mut out = Vec::new();
    for c in content {
        match c {
            Inline::Image(i) => out.push(i.image.clone()),
            Inline::Link(l) => out.extend(images_of(&l.children)),
            _ => {}
        }
    }
    out
}

enum PieceKind {
    Text { text: String, marks: Option<Vec<Mark>> },
    Br,
    Atom(Inline),
}

struct Piece {
    kind: PieceKind,
    link: Option<usize>,
}

/// Collapse whitespace, trim the leaf, merge runs. Returns new content.
pub fn normalize_prose(content: Vec<Inline>) -> Vec<Inline> {
    let mut pieces: Vec<Piece> = Vec::new();
    let mut links: Vec<LinkInline> = Vec::new();
    fn flatten(items: Vec<Inline>, link: Option<usize>, pieces: &mut Vec<Piece>, links: &mut Vec<LinkInline>) {
        for c in items {
            match c {
                Inline::Text(t) => {
                    let text = control_re().replace_all(&t.text, "");
                    let text = ws_re().replace_all(&text, " ").into_owned();
                    pieces.push(Piece { kind: PieceKind::Text { text, marks: sort_marks(t.marks.as_deref().unwrap_or(&[])) }, link });
                }
                Inline::Br => pieces.push(Piece { kind: PieceKind::Br, link }),
                Inline::Link(mut l) => {
                    let children = std::mem::take(&mut l.children);
                    links.push(l);
                    let idx = links.len() - 1;
                    flatten(children, Some(idx), pieces, links);
                }
                other => pieces.push(Piece { kind: PieceKind::Atom(other), link }),
            }
        }
    }
    flatten(content, None, &mut pieces, &mut links);

    // Forward: no leading space at the start or after a break; no double spaces across pieces.
    let mut space = true;
    for p in pieces.iter_mut() {
        match &mut p.kind {
            PieceKind::Text { text, .. } => {
                if space && text.starts_with(' ') {
                    text.remove(0);
                }
                if !text.is_empty() {
                    space = text.ends_with(' ');
                }
            }
            PieceKind::Br => space = true,
            PieceKind::Atom(_) => {}
        }
    }
    // Backward: no trailing space at the end or before a break.
    space = true;
    for p in pieces.iter_mut().rev() {
        match &mut p.kind {
            PieceKind::Text { text, .. } => {
                if space && text.ends_with(' ') {
                    text.pop();
                }
                if !text.is_empty() {
                    space = false;
                }
            }
            PieceKind::Br => space = true,
            PieceKind::Atom(_) => {}
        }
    }
    // Drop empty runs and breaks with no text before or after them.
    let kept: Vec<Piece> = pieces.into_iter().filter(|p| !matches!(&p.kind, PieceKind::Text { text, .. } if text.is_empty())).collect();
    let mut has_text_before = Vec::with_capacity(kept.len());
    let mut seen = false;
    for p in &kept {
        has_text_before.push(seen);
        if matches!(p.kind, PieceKind::Text { .. }) {
            seen = true;
        }
    }
    seen = false;
    let mut keep = vec![true; kept.len()];
    for i in (0..kept.len()).rev() {
        match kept[i].kind {
            PieceKind::Br => {
                if !seen || !has_text_before[i] {
                    keep[i] = false;
                }
            }
            PieceKind::Text { .. } => seen = true,
            PieceKind::Atom(_) => {}
        }
    }
    let kept: Vec<Piece> = kept.into_iter().zip(keep).filter(|(_, k)| *k).map(|(p, _)| p).collect();

    // Regroup into inline content: consecutive pieces of one link become that link; merge runs.
    fn push_run(target: &mut Vec<Inline>, p: Piece) {
        match p.kind {
            PieceKind::Text { text, marks } => {
                if let Some(Inline::Text(last)) = target.last_mut() {
                    if last.marks == marks {
                        last.text.push_str(&text);
                        return;
                    }
                }
                target.push(Inline::Text(TextRun { text, marks }));
            }
            PieceKind::Br => target.push(Inline::Br),
            PieceKind::Atom(a) => target.push(a),
        }
    }
    let mut out: Vec<Inline> = Vec::new();
    let mut used: HashSet<usize> = HashSet::new();
    let mut i = 0;
    let n = kept.len();
    let mut kept: Vec<Option<Piece>> = kept.into_iter().map(Some).collect();
    while i < n {
        let link = kept[i].as_ref().unwrap().link;
        let Some(link_idx) = link else {
            push_run(&mut out, kept[i].take().unwrap());
            i += 1;
            continue;
        };
        let mut children: Vec<Inline> = Vec::new();
        while i < n && kept[i].as_ref().unwrap().link == Some(link_idx) {
            // Note references never live inside links: hoist them out after the link.
            if matches!(&kept[i].as_ref().unwrap().kind, PieceKind::Atom(Inline::NoteRef(_))) {
                break;
            }
            push_run(&mut children, kept[i].take().unwrap());
            i += 1;
        }
        if !children.is_empty() {
            let mut l = links[link_idx].clone();
            l.children = children;
            used.insert(link_idx);
            out.push(Inline::Link(l));
        }
        while i < n && kept[i].as_ref().unwrap().link == Some(link_idx) {
            push_run(&mut out, kept[i].take().unwrap());
            i += 1;
        }
    }
    out
}

/// Code keeps its whitespace; only control characters and trailing blank lines go.
pub fn normalize_code(content: &[Inline]) -> Vec<Inline> {
    let text = plain_text(content).replace("\r\n", "\n").replace('\r', "\n");
    let text = control_re().replace_all(&text, "").into_owned();
    let text = text.trim_start_matches('\n');
    let text = text.trim_end();
    if text.is_empty() {
        Vec::new()
    } else {
        vec![Inline::text(text)]
    }
}

// ---------------------------------------------------------------------------------------------
// Sections

fn section_chars(blocks: &[Block]) -> usize {
    all_leaves(blocks).iter().map(|l| l.text_len16() + 1).sum()
}

fn copy_shape(s: &DraftSection) -> DraftSection {
    DraftSection { id: s.id.clone(), title: s.title.clone(), depth: s.depth, blocks: Vec::new(), notes: Vec::new(), synthetic: s.synthetic, split: None }
}

/// The author's units: for "headings", split at H1 when there are at least two, else at H2 when
/// there are at least two; for "chapters", at chapter-like headings. Short documents stay whole.
pub fn split_by_structure(blocks: Vec<Block>, title: &str, mode: SplitMode, is_chapter_heading: Option<fn(&str) -> bool>) -> Vec<DraftSection> {
    if mode == SplitMode::None || section_chars(&blocks) < limits::SPLIT_MIN_CHARS {
        return vec![DraftSection::new(title, 0, blocks)];
    }
    let is_break: Box<dyn Fn(&Block) -> bool> = match mode {
        SplitMode::Headings => {
            let count = |lvl: u8| blocks.iter().filter(|b| b.heading_level() == Some(lvl)).count();
            let level = if count(1) >= 2 {
                1
            } else if count(2) >= 2 {
                2
            } else {
                0
            };
            if level == 0 {
                return vec![DraftSection::new(title, 0, blocks)];
            }
            Box::new(move |b: &Block| b.heading_level() == Some(level))
        }
        _ => {
            let test = is_chapter_heading.unwrap_or(|_| true);
            let f = move |b: &Block| match b {
                Block::Heading(h) => test(&h.leaf.text),
                _ => false,
            };
            if blocks.iter().filter(|b| f(b)).count() < 2 {
                return vec![DraftSection::new(title, 0, blocks)];
            }
            Box::new(f)
        }
    };
    let mut out: Vec<DraftSection> = Vec::new();
    let mut cur = DraftSection::new("", 0, Vec::new());
    for b in blocks {
        if is_break(&b) && !cur.blocks.is_empty() {
            out.push(std::mem::replace(&mut cur, DraftSection::new("", 0, Vec::new())));
        }
        if is_break(&b) && cur.title.is_empty() {
            if let Block::Heading(h) = &b {
                cur.title = h.leaf.text.clone();
            }
        }
        cur.blocks.push(b);
    }
    if !cur.blocks.is_empty() {
        out.push(cur);
    }
    // Leading material without a heading of its own: title it from its first heading or the document.
    if let Some(first) = out.first_mut() {
        if first.title.is_empty() {
            first.title = first.blocks.iter().find_map(|b| b.leaf().filter(|_| b.is_heading()).map(|l| l.text.clone())).unwrap_or_else(|| title.to_string());
        }
    }
    out
}

/// Sections over the size limit split at their next heading level, else into synthetic parts.
pub fn split_by_size(s: DraftSection) -> Vec<DraftSection> {
    if section_chars(&s.blocks) <= limits::SECTION_CHARS {
        return vec![s];
    }
    let mut levels: Vec<u8> = s.blocks.iter().filter_map(|b| b.heading_level()).collect();
    levels.sort();
    levels.dedup();
    // The section's own opening heading doesn't count as a split point.
    let first_is_heading = s.blocks.first().map(|b| b.is_heading()).unwrap_or(false);
    for level in levels {
        let breaks: HashSet<u32> = s.blocks.iter().enumerate().filter(|(i, b)| b.heading_level() == Some(level) && !(*i == 0 && first_is_heading)).map(|(_, b)| b.tid()).collect();
        if breaks.is_empty() {
            continue;
        }
        let mut parts: Vec<DraftSection> = Vec::new();
        let mut cur = copy_shape(&s);
        let mut blocks = s.blocks.clone();
        for b in blocks.drain(..) {
            if breaks.contains(&b.tid()) && !cur.blocks.is_empty() {
                let title = match &b {
                    Block::Heading(h) => h.leaf.text.clone(),
                    _ => s.title.clone(),
                };
                parts.push(std::mem::replace(&mut cur, DraftSection { id: None, title, depth: s.depth + 1, blocks: Vec::new(), notes: Vec::new(), synthetic: false, split: None }));
            }
            cur.blocks.push(b);
        }
        parts.push(cur);
        if parts.len() > 1 {
            parts[0].notes = s.notes.clone();
            return parts.into_iter().flat_map(split_by_size).collect();
        }
    }
    let mut parts: Vec<DraftSection> = Vec::new();
    let mut cur = copy_shape(&s);
    cur.notes = s.notes.clone();
    let mut size = 0;
    let mut n = 1;
    for b in s.blocks {
        let len = section_chars(std::slice::from_ref(&b));
        if size + len > limits::SYNTHETIC_PART_CHARS && !cur.blocks.is_empty() {
            n += 1;
            parts.push(std::mem::replace(&mut cur, DraftSection { id: None, title: format!("{} ({n})", s.title), depth: s.depth, blocks: Vec::new(), notes: Vec::new(), synthetic: true, split: None }));
            size = 0;
        }
        cur.blocks.push(b);
        size += len;
    }
    parts.push(cur);
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prose_normalisation_trims_collapses_and_merges() {
        let out = normalize_prose(vec![Inline::text("  Hello  "), Inline::text("world \n"), Inline::Br, Inline::text_marked(" x ", &[Mark::Em])]);
        assert_eq!(plain_text(&out), "Hello world\nx");
        assert_eq!(out.len(), 3);
    }

    #[test]
    fn breaks_without_text_around_them_go() {
        let out = normalize_prose(vec![Inline::Br, Inline::text("a"), Inline::Br, Inline::Br, Inline::text("b"), Inline::Br]);
        assert_eq!(plain_text(&out), "a\n\nb");
    }
}
