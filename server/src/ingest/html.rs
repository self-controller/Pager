//! Structure-preserving HTML → blocks. Used for EPUB chapters, standalone HTML files and raw HTML
//! inside Markdown. Only structure and inline semantics are kept; no markup, styles or scripts from
//! the file ever reach the reader.

use super::builder::DocBuilder;
use crate::model::*;
use crate::util::soup::{Doc, NodeId};
use regex::Regex;
use std::sync::OnceLock;

pub enum Href {
    Internal(String),
    External(String),
    Drop,
}

/// What a converter supplies: how element ids become anchor keys, what links and images mean.
pub trait HtmlHost {
    /// Element id → anchor key (EPUB: "<path>#<id>").
    fn key(&self, id: &str) -> String;
    /// Link href → internal anchor key, external URL, or drop (keep its text).
    fn href(&self, raw: &str) -> Href;
    fn image(&mut self, builder: &mut DocBuilder, src: &str, alt: &str, title: Option<&str>) -> Option<ImageRef>;
}

pub const SKIP: &[&str] = &[
    "script", "style", "noscript", "template", "head", "title", "meta", "link", "base", "video", "audio", "iframe", "object", "embed", "canvas", "button", "input", "select",
    "textarea", "form", "nav", "rp", "rt", "param", "source", "track", "map", "area", "dialog",
];

const BLOCK: &[&str] = &[
    "address", "article", "aside", "blockquote", "body", "center", "dd", "details", "dialog", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "h1", "h2", "h3",
    "h4", "h5", "h6", "header", "hgroup", "hr", "html", "legend", "li", "main", "menu", "ol", "p", "pre", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr",
    "ul", "caption", "colgroup", "col", "nav", "form",
];

fn inline_mark(name: &str) -> Option<Mark> {
    Some(match name {
        "em" | "i" | "cite" | "dfn" | "var" => Mark::Em,
        "strong" | "b" => Mark::Strong,
        "code" | "kbd" | "samp" | "tt" => Mark::Code,
        "sup" => Mark::Sup,
        "sub" => Mark::Sub,
        "s" | "strike" | "del" => Mark::Strike,
        "u" | "ins" => Mark::Underline,
        "mark" => Mark::Mark,
        _ => return None,
    })
}

macro_rules! re {
    ($name:ident, $pat:expr) => {
        fn $name() -> &'static Regex {
            static RE: OnceLock<Regex> = OnceLock::new();
            RE.get_or_init(|| Regex::new($pat).unwrap())
        }
    };
}

re!(backlink_text, r"(?i)^\s*(↩︎?|↑|\^|⏎|back|return)\s*$");
re!(noteref_re, r"\bnoteref\b|doc-noteref");
re!(notebody_re, r"\b(footnote|endnote|rearnote|doc-footnote|doc-endnote)\b");
re!(pagebreak_re, r"\bpagebreak\b|doc-pagebreak");
re!(backlink_re, r"\bbacklink\b|doc-backlink");
re!(align_class, r"\balign-(center|right)\b");
re!(center_class, r"(?i)\b(center|centered|centre|centred|figcenter|text-?center)\b");
re!(text_align, r"text-align\s*:\s*(center|right)");
re!(cell_align_re, r"(?i)text-align\s*:\s*(left|center|right)");
re!(verse_class, r"(?i)\b(poem|poetry|verse|stanza|lyrics?|song)\b");
re!(smallcaps_class, r"(?i)\b(small-?caps|smcap|sc)\b");
re!(smallcaps_style, r"(?i)font-variant\s*:\s*small-caps");
re!(lang_class, r"\b(?:language|lang)-([\w+#.-]+)");
re!(aside_variant, r"(?i)\b(note|tip|warning|important|caution)\b");

pub fn is_skip(name: &str) -> bool {
    SKIP.contains(&name)
}

fn is_block(name: &str) -> bool {
    BLOCK.contains(&name)
}

fn semantics(doc: &Doc, el: NodeId) -> String {
    format!("{} {}", doc.attr(el, "epub:type").unwrap_or(""), doc.attr(el, "role").unwrap_or("")).to_lowercase()
}

pub fn is_note_ref(doc: &Doc, el: NodeId) -> bool {
    noteref_re().is_match(&semantics(doc, el))
}

fn is_note_body(doc: &Doc, el: NodeId) -> bool {
    notebody_re().is_match(&semantics(doc, el))
}

fn is_page_break(doc: &Doc, el: NodeId) -> bool {
    pagebreak_re().is_match(&semantics(doc, el))
}

fn is_backlink(doc: &Doc, el: NodeId) -> bool {
    backlink_re().is_match(&semantics(doc, el))
}

fn align_of(doc: &Doc, el: NodeId) -> Option<Align> {
    if doc.local_name(el) == "center" {
        return Some(Align::Center);
    }
    let classes = doc.attr(el, "class").unwrap_or("");
    if let Some(m) = align_class().captures(classes) {
        return match &m[1] {
            "center" => Some(Align::Center),
            "right" => Some(Align::Right),
            _ => None,
        };
    }
    if center_class().is_match(classes) {
        return Some(Align::Center);
    }
    let a = doc.attr(el, "align").unwrap_or("").to_lowercase();
    let style = doc.attr(el, "style").unwrap_or("").to_lowercase();
    let v = text_align().captures(&style).map(|m| m[1].to_string()).unwrap_or(a);
    match v.as_str() {
        "center" => Some(Align::Center),
        "right" => Some(Align::Right),
        _ => None,
    }
}

fn is_verse_class(doc: &Doc, el: NodeId) -> bool {
    verse_class().is_match(doc.attr(el, "class").unwrap_or(""))
}

fn is_small_caps(doc: &Doc, el: NodeId) -> bool {
    smallcaps_class().is_match(doc.attr(el, "class").unwrap_or("")) || smallcaps_style().is_match(doc.attr(el, "style").unwrap_or(""))
}

/// Text under a node, skipping scripts, styles and the like.
pub fn text_content(doc: &Doc, node: NodeId) -> String {
    let mut s = String::new();
    doc.collect_text(node, &mut s, &|name| is_skip(&local(name)));
    s
}

fn local(name: &str) -> String {
    let n = match name.rfind(':') {
        Some(i) => &name[i + 1..],
        None => name,
    };
    n.to_ascii_lowercase()
}

/// Does this subtree contain a block-level element (so it can't be treated as inline)?
fn has_block_descendant(doc: &Doc, el: NodeId) -> bool {
    for &c in doc.children(el) {
        if doc.is_element(c) {
            let n = doc.local_name(c);
            if is_skip(&n) {
                continue;
            }
            if is_block(&n) || has_block_descendant(doc, c) {
                return true;
            }
        }
    }
    false
}

fn find_first(doc: &Doc, el: NodeId, pred: &dyn Fn(&Doc, NodeId) -> bool) -> Option<NodeId> {
    for &c in doc.children(el) {
        if !doc.is_element(c) {
            continue;
        }
        if pred(doc, c) {
            return Some(c);
        }
        if let Some(f) = find_first(doc, c, pred) {
            return Some(f);
        }
    }
    None
}

#[derive(Clone, Copy, Default)]
pub struct Opts {
    pub align: Option<Align>,
    pub verse: bool,
    /// Inside a footnote body: drop back-links.
    pub in_note: bool,
}

pub struct HtmlWalker<'a, H: HtmlHost> {
    pub host: &'a mut H,
    pub builder: &'a mut DocBuilder,
    /// Footnote/endnote bodies found while walking (out of the reading flow).
    pub notes: Vec<Note>,
    pending_ids: Vec<String>,
}

impl<'a, H: HtmlHost> HtmlWalker<'a, H> {
    pub fn new(host: &'a mut H, builder: &'a mut DocBuilder, notes: Vec<Note>) -> HtmlWalker<'a, H> {
        HtmlWalker { host, builder, notes, pending_ids: Vec::new() }
    }

    /// Mark an anchor key (e.g. "<file path>") to attach to the next leaf produced.
    pub fn pend_anchor(&mut self, key: &str) {
        self.pending_ids.push(key.to_string());
    }

    fn take_ids(&mut self, target: u32) {
        let ids = std::mem::take(&mut self.pending_ids);
        for k in ids {
            self.builder.anchor(&k, target);
        }
    }

    fn element_id(doc: &Doc, el: NodeId) -> Option<String> {
        if let Some(id) = doc.attr(el, "id") {
            return Some(id.to_string());
        }
        if doc.local_name(el) == "a" {
            if let Some(n) = doc.attr(el, "name") {
                return Some(n.to_string());
            }
        }
        None
    }

    fn note_id(&mut self, doc: &Doc, el: NodeId) {
        if let Some(id) = Self::element_id(doc, el) {
            if !id.is_empty() {
                self.pending_ids.push(self.host.key(&id));
            }
        }
    }

    /// Walk a list of nodes in block context.
    pub fn blocks(&mut self, doc: &Doc, nodes: &[NodeId], opts: Opts) -> Vec<Block> {
        let mut out = Vec::new();
        let mut buffer: Vec<NodeId> = Vec::new();
        for &node in nodes {
            if !doc.is_element(node) {
                buffer.push(node);
                continue;
            }
            let name = doc.local_name(node);
            if is_skip(&name) || is_page_break(doc, node) {
                continue;
            }
            if is_note_body(doc, node) && name != "a" {
                self.flush(doc, &mut buffer, opts, &mut out);
                self.collect_note(doc, node);
                continue;
            }
            if !is_block(&name) && !has_block_descendant(doc, node) {
                if name == "br" && buffer.is_empty() {
                    continue;
                }
                buffer.push(node);
                continue;
            }
            self.flush(doc, &mut buffer, opts, &mut out);
            out.extend(self.block(doc, node, opts));
        }
        self.flush(doc, &mut buffer, opts, &mut out);
        out
    }

    fn flush(&mut self, doc: &Doc, buffer: &mut Vec<NodeId>, opts: Opts, out: &mut Vec<Block>) {
        if buffer.is_empty() {
            return;
        }
        let nodes = std::mem::take(buffer);
        let content = self.inlines(doc, &nodes, &[], opts);
        if content.is_empty() {
            return;
        }
        let p = self.builder.paragraph(content, opts.align, None, opts.verse);
        self.take_ids(p.tid());
        out.push(p);
    }

    fn collect_note(&mut self, doc: &Doc, el: NodeId) {
        let id = doc.attr(el, "id").map(str::to_string);
        // Ids waiting for the next leaf belong to the flow, not to this note's insides.
        let pending = std::mem::take(&mut self.pending_ids);
        let blocks = self.blocks(doc, doc.children(el), Opts { in_note: true, ..Default::default() });
        self.pending_ids = pending;
        let note = self.builder.note("", blocks);
        // The note and every id inside it point at the note (overriding leaf registrations made while walking it).
        if let Some(id) = &id {
            let key = self.host.key(id);
            self.builder.anchor_set(&key, note.tid);
        }
        for d in doc.descendants(el, &|_, _| true) {
            if let Some(nid) = Self::element_id(doc, d) {
                if !nid.is_empty() && Some(&nid) != id.as_ref() {
                    let key = self.host.key(&nid);
                    self.builder.anchor_set(&key, note.tid);
                }
            }
        }
        self.notes.push(note);
    }

    fn block(&mut self, doc: &Doc, el: NodeId, parent: Opts) -> Vec<Block> {
        let name = doc.local_name(el);
        let align = align_of(doc, el).or(parent.align);
        let opts = Opts { align, verse: parent.verse || is_verse_class(doc, el), in_note: parent.in_note };
        if name.len() == 2 && name.starts_with('h') && name.as_bytes()[1].is_ascii_digit() && name.as_bytes()[1] != b'0' && name.as_bytes()[1] <= b'6' {
            self.note_id(doc, el);
            let content = self.inlines(doc, doc.children(el), &[], opts);
            let h = self.builder.heading((name.as_bytes()[1] - b'0') as i64, content, align, None);
            self.take_ids(h.tid());
            return vec![h];
        }
        match name.as_str() {
            "p" => {
                self.note_id(doc, el);
                if has_block_descendant(doc, el) {
                    return self.blocks(doc, doc.children(el), opts);
                }
                let content = self.inlines(doc, doc.children(el), &[], opts);
                let p = self.builder.paragraph(content, align, None, opts.verse);
                self.take_ids(p.tid());
                vec![p]
            }
            "pre" => {
                self.note_id(doc, el);
                let code = doc.children(el).iter().copied().find(|&c| doc.is_element(c) && doc.local_name(c) == "code");
                let cls = format!("{} {}", code.and_then(|c| doc.attr(c, "class")).unwrap_or(""), doc.attr(el, "class").unwrap_or(""));
                let lang = lang_class().captures(&cls).map(|m| m[1].to_string());
                let b = self.builder.code(&text_content(doc, el), lang, None);
                self.take_ids(b.tid());
                vec![b]
            }
            "hr" => vec![self.builder.hr(None)],
            "ul" | "ol" | "menu" => vec![self.list(doc, el, opts)],
            "dl" => self.definition_list(doc, el, opts),
            "blockquote" => {
                self.note_id(doc, el);
                let blocks = self.blocks(doc, doc.children(el), opts);
                if blocks.is_empty() {
                    vec![]
                } else {
                    vec![self.builder.blockquote(blocks, align, None)]
                }
            }
            "aside" => {
                self.note_id(doc, el);
                let blocks = self.blocks(doc, doc.children(el), opts);
                let variant = if semantics(doc, el).contains("sidebar") {
                    "sidebar".to_string()
                } else {
                    aside_variant().captures(doc.attr(el, "class").unwrap_or("")).map(|m| m[1].to_lowercase()).unwrap_or_else(|| "sidebar".to_string())
                };
                if blocks.is_empty() {
                    vec![]
                } else {
                    vec![self.builder.aside(&variant, None, blocks, None)]
                }
            }
            "table" => self.table(doc, el, opts),
            "figure" => self.figure(doc, el, opts),
            "img" => {
                let Some(img) = self.image_of(doc, el) else { return vec![] };
                let p = self.builder.paragraph(vec![Inline::image(img)], align, None, false);
                self.take_ids(p.tid());
                vec![p]
            }
            "dt" => {
                let content = self.inlines(doc, doc.children(el), &[Mark::Strong], opts);
                let p = self.builder.paragraph(content, align, None, false);
                self.take_ids(p.tid());
                vec![p]
            }
            _ => {
                // div, section, article, header, footer, li outside a list, figcaption alone, center, ...
                self.note_id(doc, el);
                if !is_block(&name) && !has_block_descendant(doc, el) {
                    let content = self.inlines(doc, &[el], &[], opts);
                    let p = self.builder.paragraph(content, align, None, false);
                    self.take_ids(p.tid());
                    return vec![p];
                }
                self.blocks(doc, doc.children(el), opts)
            }
        }
    }

    fn list(&mut self, doc: &Doc, el: NodeId, opts: Opts) -> Block {
        self.note_id(doc, el);
        let ordered = doc.local_name(el) == "ol";
        let mut items: Vec<ListItem> = Vec::new();
        let mut stray: Vec<NodeId> = Vec::new();
        for &c in doc.children(el) {
            let cname = if doc.is_element(c) { doc.local_name(c) } else { String::new() };
            if cname == "li" {
                self.flush_stray(doc, &mut stray, opts, &mut items);
                if is_note_body(doc, c) {
                    self.collect_note(doc, c);
                    continue;
                }
                self.note_id(doc, c);
                // Task-list checkbox (GFM-rendered HTML).
                let checked = doc
                    .children(c)
                    .iter()
                    .copied()
                    .find(|&n| doc.is_element(n) && doc.local_name(n) == "input" && doc.attr(n, "type").unwrap_or("") == "checkbox")
                    .map(|n| doc.has_attr(n, "checked"));
                let blocks = self.blocks(doc, doc.children(c), opts);
                items.push(self.builder.item(blocks, checked));
            } else if cname == "ul" || cname == "ol" {
                // A nested list placed directly in the list (invalid but common): attach to the last item.
                self.flush_stray(doc, &mut stray, opts, &mut items);
                let nested = self.list(doc, c, opts);
                match items.last_mut() {
                    Some(last) => last.blocks.push(nested),
                    None => {
                        let it = self.builder.item(vec![nested], None);
                        items.push(it);
                    }
                }
            } else {
                stray.push(c);
            }
        }
        self.flush_stray(doc, &mut stray, opts, &mut items);
        let mut list = self.builder.list(ordered, items, None);
        if let Block::List(l) = &mut list {
            if ordered {
                if let Some(start) = doc.attr(el, "start").and_then(|s| s.trim().parse::<i64>().ok()) {
                    if start != 1 {
                        l.start = Some(start);
                    }
                }
            }
        }
        list
    }

    fn flush_stray(&mut self, doc: &Doc, stray: &mut Vec<NodeId>, opts: Opts, items: &mut Vec<ListItem>) {
        if stray.is_empty() {
            return;
        }
        let nodes = std::mem::take(stray);
        let blocks = self.blocks(doc, &nodes, opts);
        if blocks.is_empty() {
            return;
        }
        match items.last_mut() {
            Some(last) => last.blocks.extend(blocks),
            None => {
                let it = self.builder.item(blocks, None);
                items.push(it);
            }
        }
    }

    fn definition_list(&mut self, doc: &Doc, el: NodeId, opts: Opts) -> Vec<Block> {
        let mut out = Vec::new();
        for &c in doc.children(el) {
            if !doc.is_element(c) {
                continue;
            }
            let n = doc.local_name(c);
            if n == "dt" {
                out.extend(self.block(doc, c, opts));
            } else if n == "dd" {
                self.note_id(doc, c);
                let blocks = self.blocks(doc, doc.children(c), opts);
                if !blocks.is_empty() {
                    out.push(self.builder.blockquote(blocks, None, None));
                }
            } else if n == "div" {
                out.extend(self.definition_list(doc, c, opts));
            }
        }
        out
    }

    fn table(&mut self, doc: &Doc, el: NodeId, opts: Opts) -> Vec<Block> {
        self.note_id(doc, el);
        let mut rows: Vec<TableRow> = Vec::new();
        let mut caption: Option<CaptionBlock> = None;
        self.table_visit(doc, el, false, opts, &mut rows, &mut caption);
        if rows.is_empty() {
            return vec![];
        }
        vec![self.builder.table(rows, caption, None)]
    }

    fn table_visit(&mut self, doc: &Doc, node: NodeId, in_head: bool, opts: Opts, rows: &mut Vec<TableRow>, caption: &mut Option<CaptionBlock>) {
        for &c in doc.children(node) {
            if !doc.is_element(c) {
                continue;
            }
            let n = doc.local_name(c);
            match n.as_str() {
                "caption" => {
                    let content = self.inlines(doc, doc.children(c), &[], opts);
                    *caption = Some(self.builder.caption(content));
                }
                "thead" => self.table_visit(doc, c, true, opts, rows, caption),
                "tbody" | "tfoot" => self.table_visit(doc, c, false, opts, rows, caption),
                "tr" => {
                    let mut cells: Vec<TableCell> = Vec::new();
                    for &cell in doc.children(c) {
                        if !doc.is_element(cell) {
                            continue;
                        }
                        let cn = doc.local_name(cell);
                        if cn != "td" && cn != "th" {
                            continue;
                        }
                        self.note_id(doc, cell);
                        let content = self.cell_inlines(doc, cell, opts);
                        let mut tc = self.builder.cell(content, cn == "th" || in_head);
                        if let Some(cs) = doc.attr(cell, "colspan").and_then(|s| s.trim().parse::<u32>().ok()) {
                            if cs > 1 {
                                tc.colspan = Some(cs.min(1000));
                            }
                        }
                        if let Some(rs) = doc.attr(cell, "rowspan").and_then(|s| s.trim().parse::<u32>().ok()) {
                            if rs > 1 {
                                tc.rowspan = Some(rs.min(65534));
                            }
                        }
                        let ca = doc
                            .attr(cell, "align")
                            .map(str::to_string)
                            .or_else(|| cell_align_re().captures(doc.attr(cell, "style").unwrap_or("")).map(|m| m[1].to_string()))
                            .unwrap_or_default()
                            .to_lowercase();
                        tc.cell_align = match ca.as_str() {
                            "left" => Some(CellAlign::Left),
                            "center" => Some(CellAlign::Center),
                            "right" => Some(CellAlign::Right),
                            _ => None,
                        };
                        self.take_ids(tc.leaf.tid);
                        cells.push(tc);
                    }
                    if !cells.is_empty() {
                        let header = in_head || cells.iter().all(|x| x.header);
                        rows.push(TableRow { header, cells });
                    }
                }
                "colgroup" | "col" => {}
                _ => self.table_visit(doc, c, in_head, opts, rows, caption),
            }
        }
    }

    /// A cell's content as one run of inlines; block children are separated by line breaks.
    fn cell_inlines(&mut self, doc: &Doc, cell: NodeId, opts: Opts) -> Vec<Inline> {
        if !has_block_descendant(doc, cell) {
            return self.inlines(doc, doc.children(cell), &[], opts);
        }
        let mut out: Vec<Inline> = Vec::new();
        for b in self.blocks(doc, doc.children(cell), opts) {
            let parts = block_inlines(&b);
            if parts.is_empty() {
                continue;
            }
            if !out.is_empty() {
                out.push(Inline::Br);
            }
            out.extend(parts);
        }
        out
    }

    fn figure(&mut self, doc: &Doc, el: NodeId, opts: Opts) -> Vec<Block> {
        self.note_id(doc, el);
        let mut images: Vec<ImageRef> = Vec::new();
        let mut caption_el: Option<NodeId> = None;
        let mut other = false;
        self.figure_visit(doc, el, &mut images, &mut caption_el, &mut other);
        if images.is_empty() || other {
            // A figure that wraps a quote, code or a table: keep the content, caption as a paragraph.
            return self.blocks(doc, doc.children(el), opts);
        }
        let caption = match caption_el {
            Some(c) => {
                let content = self.inlines(doc, doc.children(c), &[], opts);
                Some(self.builder.caption(content))
            }
            None => None,
        };
        let fig = self.builder.figure(images, caption, opts.align);
        self.take_ids(fig.tid());
        vec![fig]
    }

    fn figure_visit(&mut self, doc: &Doc, el: NodeId, images: &mut Vec<ImageRef>, caption_el: &mut Option<NodeId>, other: &mut bool) {
        for &n in doc.children(el) {
            if !doc.is_element(n) {
                if doc.text(n).map(|t| !t.trim().is_empty()).unwrap_or(false) {
                    *other = true;
                }
                continue;
            }
            let name = doc.local_name(n);
            if name == "figcaption" {
                *caption_el = Some(n);
            } else if name == "img" || name == "image" || name == "svg" {
                if let Some(img) = self.image_of(doc, n) {
                    images.push(img);
                }
            } else if is_block(&name) && name != "div" && name != "p" {
                *other = true;
            } else {
                self.figure_visit(doc, n, images, caption_el, other);
            }
        }
    }

    fn image_of(&mut self, doc: &Doc, el: NodeId) -> Option<ImageRef> {
        let name = doc.local_name(el);
        if name == "svg" {
            let image = find_first(doc, el, &|d, n| d.local_name(n) == "image")?;
            return self.image_of(doc, image);
        }
        let src = doc.attr(el, "src").or_else(|| doc.attr(el, "xlink:href")).or_else(|| doc.attr(el, "href")).unwrap_or("");
        if src.is_empty() {
            return None;
        }
        let alt = doc.attr(el, "alt").or_else(|| doc.attr(el, "title")).unwrap_or("").to_string();
        let title = doc.attr(el, "title").map(str::to_string);
        self.host.image(self.builder, src, &alt, title.as_deref())
    }

    /// Walk nodes in inline context.
    pub fn inlines(&mut self, doc: &Doc, nodes: &[NodeId], marks: &[Mark], opts: Opts) -> Vec<Inline> {
        let mut out: Vec<Inline> = Vec::new();
        for &node in nodes {
            if let Some(t) = doc.text(node) {
                out.push(run(t, marks));
                continue;
            }
            let name = doc.local_name(node);
            if is_skip(&name) || is_page_break(doc, node) {
                continue;
            }
            if Self::element_id(doc, node).map(|s| !s.is_empty()).unwrap_or(false) {
                self.note_id(doc, node);
            }
            match name.as_str() {
                "br" => out.push(Inline::Br),
                "wbr" => {}
                "img" | "svg" | "image" => {
                    if let Some(img) = self.image_of(doc, node) {
                        out.push(Inline::image(img));
                    }
                }
                "math" => {
                    let alt = doc.attr(node, "alttext").map(str::to_string).unwrap_or_else(|| text_content(doc, node));
                    if !alt.trim().is_empty() {
                        out.push(run(&alt, marks));
                        self.builder.warn("Some equations are shown as plain text.");
                    }
                }
                "ruby" => {
                    let kids: Vec<NodeId> = doc.children(node).iter().copied().filter(|&c| !(doc.is_element(c) && matches!(doc.local_name(c).as_str(), "rt" | "rp"))).collect();
                    out.extend(self.inlines(doc, &kids, marks, opts));
                }
                "q" => {
                    out.push(run("“", marks));
                    out.extend(self.inlines(doc, doc.children(node), marks, opts));
                    out.push(run("”", marks));
                }
                "a" => out.extend(self.link(doc, node, marks, opts)),
                _ => {
                    let mark = inline_mark(&name).or_else(|| if is_small_caps(doc, node) { Some(Mark::Smallcaps) } else { None });
                    let next: Vec<Mark> = match mark {
                        Some(m) if !marks.contains(&m) => {
                            let mut v = marks.to_vec();
                            v.push(m);
                            v
                        }
                        _ => marks.to_vec(),
                    };
                    if is_block(&name) {
                        // Block inside inline context (only reached for table cells etc.): separate with a break.
                        if !out.is_empty() {
                            out.push(Inline::Br);
                        }
                    }
                    out.extend(self.inlines(doc, doc.children(node), &next, opts));
                }
            }
        }
        out
    }

    fn link(&mut self, doc: &Doc, el: NodeId, marks: &[Mark], opts: Opts) -> Vec<Inline> {
        let href = doc.attr(el, "href").or_else(|| doc.attr(el, "xlink:href")).unwrap_or("").trim().to_string();
        if opts.in_note && (is_backlink(doc, el) || backlink_text().is_match(&text_content(doc, el))) {
            return vec![];
        }
        let children: Vec<Inline> = self.inlines(doc, doc.children(el), marks, opts).into_iter().filter(|c| matches!(c, Inline::Text(_) | Inline::Image(_) | Inline::Br)).collect();
        if href.is_empty() {
            return children;
        }
        let title = doc.attr(el, "title").filter(|t| !t.is_empty());
        match self.host.href(&href) {
            Href::Drop => children,
            Href::Internal(key) => vec![self.builder.internal_link(&key, children, title)],
            Href::External(url) => vec![Inline::Link(LinkInline { target: LinkTarget::External { url }, title: title.map(str::to_string), children, pending: None })],
        }
    }
}

fn run(text: &str, marks: &[Mark]) -> Inline {
    if marks.is_empty() {
        Inline::text(text)
    } else {
        Inline::Text(TextRun { text: text.to_string(), marks: Some(marks.to_vec()) })
    }
}

/// All inline content of a block (for flattening block content into table cells).
fn block_inlines(b: &Block) -> Vec<Inline> {
    match b {
        Block::Heading(_) | Block::Paragraph(_) | Block::Code(_) => b.leaf().unwrap().content.clone(),
        Block::List(_) | Block::Blockquote(_) | Block::Aside(_) => {
            let inner: Vec<&Block> = match b {
                Block::List(l) => l.items.iter().flat_map(|i| i.blocks.iter()).collect(),
                Block::Blockquote(q) => q.blocks.iter().collect(),
                Block::Aside(a) => a.blocks.iter().collect(),
                _ => unreachable!(),
            };
            let mut out = Vec::new();
            for x in inner {
                let parts = block_inlines(x);
                if parts.is_empty() {
                    continue;
                }
                if !out.is_empty() {
                    out.push(Inline::Br);
                }
                out.extend(parts);
            }
            out
        }
        Block::Figure(f) => f.images.iter().map(|i| Inline::image(i.clone())).collect(),
        _ => vec![],
    }
}

/// Safe external URL, or None.
pub fn external_url(href: &str) -> Option<String> {
    let u = url::Url::parse(href).ok()?;
    match u.scheme() {
        "http" | "https" | "mailto" => Some(u.to_string()),
        _ => None,
    }
}

pub fn decode_safe(s: &str) -> String {
    percent_encoding::percent_decode_str(s).decode_utf8().map(|c| c.into_owned()).unwrap_or_else(|_| s.to_string())
}
