//! Markdown (CommonMark + GFM: tables, task lists, footnotes, strikethrough, autolinks) with YAML
//! front matter. Obsidian/GitHub callouts (`> [!note] Title`) become asides. Raw HTML goes through the
//! HTML walker. Source line numbers are kept on blocks.

use super::builder::{DocBuilder, DraftDocument, SplitMode};
use super::context::{resolve_local_image, IngestContext};
use super::html::{decode_safe, external_url, Href, HtmlHost, HtmlWalker, Opts};
use super::title::title_from_file_name;
use super::versions::Format;
use crate::model::*;
use crate::util::soup::Doc;
use crate::Result;
use comrak::nodes::{AstNode, ListType, NodeValue, TableAlignment};
use comrak::{parse_document, Arena, Options};
use regex::Regex;
use std::collections::HashMap;
use std::sync::OnceLock;

fn callout_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\[!([A-Za-z][\w-]*)\][+-]?[ \t]*").unwrap())
}

/// GitHub-style heading slug.
pub fn slugify(text: &str) -> String {
    static STRIP: OnceLock<Regex> = OnceLock::new();
    let strip = STRIP.get_or_init(|| Regex::new(r"[^\p{L}\p{N}\s_-]").unwrap());
    let t = text.to_lowercase();
    let t = strip.replace_all(t.trim(), "");
    t.chars().map(|c| if c.is_whitespace() { '-' } else { c }).collect()
}

struct MdHost<'a> {
    ctx: &'a IngestContext,
}

impl HtmlHost for MdHost<'_> {
    fn key(&self, id: &str) -> String {
        format!("#{id}")
    }

    fn href(&self, raw: &str) -> Href {
        md_href(raw)
    }

    fn image(&mut self, builder: &mut DocBuilder, src: &str, alt: &str, title: Option<&str>) -> Option<ImageRef> {
        resolve_local_image(self.ctx, builder, src, alt, title)
    }
}

fn md_href(raw: &str) -> Href {
    if let Some(frag) = raw.strip_prefix('#') {
        return Href::Internal(format!("#{}", decode_safe(frag)));
    }
    match external_url(raw) {
        Some(u) => Href::External(u),
        None => Href::Drop,
    }
}

pub fn parse_markdown(text: &str, ctx: &IngestContext) -> Result<ParsedDocument> {
    let arena = Arena::new();
    let mut options = Options::default();
    options.extension.table = true;
    options.extension.strikethrough = true;
    options.extension.tasklist = true;
    options.extension.footnotes = true;
    options.extension.autolink = true;
    options.extension.front_matter_delimiter = Some("---".to_string());
    let root = parse_document(&arena, text, &options);
    let builder = DocBuilder::new("md", Format::Md.parser_version());
    let mut conv = MdConverter { b: builder, host: MdHost { ctx }, footnotes: Vec::new(), note_index: HashMap::new(), note_numbers: HashMap::new(), slugs: HashMap::new(), html_notes: Vec::new() };
    let fm = root
        .children()
        .find_map(|c| match &c.data.borrow().value {
            NodeValue::FrontMatter(s) => Some(s.clone()),
            _ => None,
        })
        .map(|s| parse_front_matter(&strip_delimiters(&s)))
        .unwrap_or_default();
    conv.collect_definitions(root);
    let blocks = conv.blocks(root.children());
    let notes = conv.notes();
    let first_h1 = find_heading(&blocks, 1);
    let str_of = |v: Option<&FrontValue>| -> Option<String> {
        let s = match v? {
            FrontValue::Str(s) => s.clone(),
            FrontValue::List(l) => l.join(", "),
        };
        let s = s.trim().to_string();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    };
    let list_of = |v: Option<&FrontValue>| -> Vec<String> {
        static SPLIT: OnceLock<Regex> = OnceLock::new();
        let split = SPLIT.get_or_init(|| Regex::new(r"\s*(?:;|\band\b|&)\s*").unwrap());
        match v {
            None => vec![],
            Some(FrontValue::List(l)) => l.iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
            Some(FrontValue::Str(s)) => split.split(s).map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect(),
        }
    };
    let mut meta = DocumentMeta { title: str_of(fm.get("title")).or(first_h1).unwrap_or_else(|| title_from_file_name(&ctx.file_name)), authors: list_of(fm.get("authors").or(fm.get("author"))), ..Default::default() };
    meta.subtitle = str_of(fm.get("subtitle"));
    meta.language = str_of(fm.get("lang").or(fm.get("language")));
    meta.published_at = str_of(fm.get("date").or(fm.get("published")));
    meta.description = str_of(fm.get("description").or(fm.get("summary")));
    Ok(conv.b.finalize(DraftDocument::flat(meta, blocks, notes, SplitMode::Headings)))
}

fn strip_delimiters(s: &str) -> String {
    let mut lines: Vec<&str> = s.lines().collect();
    if lines.first().map(|l| l.trim() == "---").unwrap_or(false) {
        lines.remove(0);
    }
    while lines.last().map(|l| l.trim().is_empty()).unwrap_or(false) {
        lines.pop();
    }
    if lines.last().map(|l| l.trim() == "---").unwrap_or(false) {
        lines.pop();
    }
    lines.join("\n")
}

fn find_heading(blocks: &[Block], level: u8) -> Option<String> {
    for b in blocks {
        if let Block::Heading(h) = b {
            if h.level == level {
                let t: String = h
                    .leaf
                    .content
                    .iter()
                    .map(|c| match c {
                        Inline::Text(t) => t.text.clone(),
                        Inline::Link(l) => l.children.iter().map(|x| if let Inline::Text(t) = x { t.text.clone() } else { String::new() }).collect(),
                        _ => String::new(),
                    })
                    .collect::<String>();
                let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
                return if t.is_empty() { None } else { Some(t) };
            }
        }
    }
    None
}

struct Footnote<'a> {
    tid: u32,
    label: String,
    def: &'a AstNode<'a>,
}

struct MdConverter<'a> {
    b: DocBuilder,
    host: MdHost<'a>,
    /// Footnote definitions in document order.
    footnotes: Vec<Footnote<'a>>,
    note_index: HashMap<String, usize>,
    /// Footnotes are numbered in order of first reference, as GitHub renders them.
    note_numbers: HashMap<String, String>,
    slugs: HashMap<String, u32>,
    html_notes: Vec<Note>,
}

fn line_of<'a>(n: &'a AstNode<'a>) -> Option<u32> {
    let l = n.data.borrow().sourcepos.start.line;
    if l > 0 {
        Some(l as u32)
    } else {
        None
    }
}

fn plain<'a>(n: &'a AstNode<'a>) -> String {
    let mut s = String::new();
    plain_into(n, &mut s);
    s
}

fn plain_into<'a>(n: &'a AstNode<'a>, s: &mut String) {
    let v = n.data.borrow().value.clone();
    match v {
        NodeValue::Text(t) => s.push_str(&t),
        NodeValue::HtmlInline(t) => s.push_str(&t),
        NodeValue::Code(c) => s.push_str(&c.literal),
        NodeValue::SoftBreak => s.push('\n'),
        _ => {}
    }
    for c in n.children() {
        plain_into(c, s);
    }
}

fn html_mark(name: &str) -> Option<Mark> {
    Some(match name {
        "sup" => Mark::Sup,
        "sub" => Mark::Sub,
        "mark" => Mark::Mark,
        "u" | "ins" => Mark::Underline,
        "s" | "del" | "strike" => Mark::Strike,
        "em" | "i" | "cite" => Mark::Em,
        "strong" | "b" => Mark::Strong,
        "kbd" | "code" => Mark::Code,
        _ => return None,
    })
}

impl<'a> MdConverter<'a> {
    fn collect_definitions(&mut self, root: &'a AstNode<'a>) {
        for n in root.descendants() {
            let v = n.data.borrow().value.clone();
            if let NodeValue::FootnoteDefinition(def) = v {
                let id = def.name.to_lowercase();
                if self.note_index.contains_key(&id) {
                    continue;
                }
                let tid = self.b.tid();
                self.b.anchor(&format!("fn:{id}"), tid);
                self.note_index.insert(id, self.footnotes.len());
                self.footnotes.push(Footnote { tid, label: def.name.clone(), def: n });
            }
        }
    }

    fn notes(&mut self) -> Vec<Note> {
        let mut out = Vec::new();
        let defs: Vec<(u32, String, &'a AstNode<'a>)> = self.footnotes.iter().map(|f| (f.tid, f.label.clone(), f.def)).collect();
        for (tid, label, def) in defs {
            let blocks = self.blocks(def.children());
            out.push(Note { id: String::new(), label, blocks, tid });
        }
        out.extend(std::mem::take(&mut self.html_notes));
        out
    }

    fn slug(&mut self, text: &str) -> String {
        let base = slugify(text);
        let n = self.slugs.entry(base.clone()).or_insert(0);
        let cur = *n;
        *n += 1;
        if cur == 0 {
            base
        } else {
            format!("{base}-{cur}")
        }
    }

    fn blocks(&mut self, nodes: impl Iterator<Item = &'a AstNode<'a>>) -> Vec<Block> {
        let mut out = Vec::new();
        for n in nodes {
            out.extend(self.block(n));
        }
        out
    }

    fn block(&mut self, n: &'a AstNode<'a>) -> Vec<Block> {
        let v = n.data.borrow().value.clone();
        match v {
            NodeValue::Paragraph => {
                let content = self.inlines(n.children(), &[]);
                vec![self.b.paragraph(content, None, line_of(n), false)]
            }
            NodeValue::Heading(h) => {
                let content = self.inlines(n.children(), &[]);
                let block = self.b.heading(h.level as i64, content, None, line_of(n));
                let slug = self.slug(&plain(n));
                self.b.anchor(&format!("#{slug}"), block.tid());
                vec![block]
            }
            NodeValue::ThematicBreak => vec![self.b.hr(line_of(n))],
            NodeValue::BlockQuote => vec![self.blockquote(n)],
            NodeValue::List(l) => vec![self.list(n, &l)],
            NodeValue::CodeBlock(c) => {
                let lang = c.info.split_whitespace().next().map(str::to_string).filter(|s| !s.is_empty());
                let lang = if c.fenced { lang } else { None };
                vec![self.b.code(&c.literal, lang, line_of(n))]
            }
            NodeValue::Table(t) => vec![self.table(n, &t.alignments)],
            NodeValue::HtmlBlock(h) => self.raw_html(&h.literal),
            _ => vec![],
        }
    }

    fn blockquote(&mut self, n: &'a AstNode<'a>) -> Block {
        let children: Vec<&'a AstNode<'a>> = n.children().collect();
        if let Some(first) = children.first() {
            if matches!(first.data.borrow().value, NodeValue::Paragraph) {
                let kids: Vec<&'a AstNode<'a>> = first.children().collect();
                if let Some(t) = kids.first() {
                    let first_text = match &t.data.borrow().value {
                        NodeValue::Text(s) => Some(s.clone()),
                        _ => None,
                    };
                    if let Some(text) = first_text {
                        if let Some(m) = callout_re().captures(&text) {
                            let title = text[m.get(0).unwrap().end()..].trim().to_string();
                            let variant = m[1].to_lowercase();
                            let rest: Vec<&'a AstNode<'a>> = match kids.get(1).map(|k| k.data.borrow().value.clone()) {
                                Some(NodeValue::SoftBreak) | Some(NodeValue::LineBreak) => kids[2..].to_vec(),
                                _ => vec![],
                            };
                            let mut body: Vec<Block> = Vec::new();
                            if !rest.is_empty() {
                                let content = self.inlines(rest.into_iter(), &[]);
                                body.push(self.b.paragraph(content, None, line_of(first), false));
                            }
                            body.extend(self.blocks(children[1..].iter().copied()));
                            if body.is_empty() && !title.is_empty() {
                                body.push(self.b.paragraph(vec![Inline::text(title.clone())], None, None, false));
                            }
                            return self.b.aside(&variant, if title.is_empty() { None } else { Some(title) }, body, line_of(n));
                        }
                    }
                }
            }
        }
        let blocks = self.blocks(children.into_iter());
        self.b.blockquote(blocks, None, line_of(n))
    }

    fn list(&mut self, n: &'a AstNode<'a>, l: &comrak::nodes::NodeList) -> Block {
        let mut items = Vec::new();
        for li in n.children() {
            let checked = match &li.data.borrow().value {
                NodeValue::TaskItem(c) => Some(c.symbol.is_some()),
                _ => None,
            };
            let blocks = self.blocks(li.children());
            items.push(self.b.item(blocks, checked));
        }
        let ordered = l.list_type == ListType::Ordered;
        let mut list = self.b.list(ordered, items, line_of(n));
        if let Block::List(lb) = &mut list {
            if ordered && l.start != 1 {
                lb.start = Some(l.start as i64);
            }
        }
        list
    }

    fn table(&mut self, n: &'a AstNode<'a>, alignments: &[TableAlignment]) -> Block {
        let mut rows = Vec::new();
        for (ri, row) in n.children().enumerate() {
            let header = ri == 0;
            let mut cells = Vec::new();
            for (ci, cell) in row.children().enumerate() {
                let content = self.inlines(cell.children(), &[]);
                let mut tc = self.b.cell(content, header);
                tc.cell_align = match alignments.get(ci) {
                    Some(TableAlignment::Left) => Some(CellAlign::Left),
                    Some(TableAlignment::Center) => Some(CellAlign::Center),
                    Some(TableAlignment::Right) => Some(CellAlign::Right),
                    _ => None,
                };
                cells.push(tc);
            }
            rows.push(TableRow { header, cells });
        }
        self.b.table(rows, None, line_of(n))
    }

    fn raw_html(&mut self, value: &str) -> Vec<Block> {
        static COMMENT: OnceLock<Regex> = OnceLock::new();
        static LONE: OnceLock<Regex> = OnceLock::new();
        static KEEP: OnceLock<Regex> = OnceLock::new();
        let comment = COMMENT.get_or_init(|| Regex::new(r"(?s)^<!--.*-->$").unwrap());
        let lone = LONE.get_or_init(|| Regex::new(r"(?i)^</?[a-z][\w-]*(\s[^>]*)?>$").unwrap());
        let keep = KEEP.get_or_init(|| Regex::new(r"(?i)^<(img|hr|br)\b").unwrap());
        let trimmed = value.trim();
        if trimmed.is_empty() || comment.is_match(trimmed) {
            return vec![];
        }
        // A lone opening or closing tag (e.g. "<details>" around Markdown) carries no content.
        if lone.is_match(trimmed) && !keep.is_match(trimmed) {
            return vec![];
        }
        let doc = Doc::parse_html(value);
        let notes = std::mem::take(&mut self.html_notes);
        let mut walker = HtmlWalker::new(&mut self.host, &mut self.b, notes);
        let blocks = walker.blocks(&doc, &doc.roots.clone(), Opts::default());
        self.html_notes = walker.notes;
        blocks
    }

    fn inlines(&mut self, nodes: impl Iterator<Item = &'a AstNode<'a>>, marks: &[Mark]) -> Vec<Inline> {
        static TAG: OnceLock<Regex> = OnceLock::new();
        let tag_re = TAG.get_or_init(|| Regex::new(r"(?i)^<(/)?([a-z][a-z0-9]*)\b[^>]*?(/)?>$").unwrap());
        let mut out: Vec<Inline> = Vec::new();
        // Inline raw HTML arrives as separate open/close tag nodes; keep a stack of marks they open.
        let mut stack: Vec<Mark> = Vec::new();
        for n in nodes {
            let cur: Vec<Mark> = marks.iter().copied().chain(stack.iter().copied()).collect();
            let v = n.data.borrow().value.clone();
            match v {
                NodeValue::Text(t) => out.push(Inline::text_marked(t, &cur)),
                NodeValue::SoftBreak => out.push(Inline::text_marked("\n", &cur)),
                NodeValue::Emph => out.extend(self.inlines(n.children(), &with(&cur, Mark::Em))),
                NodeValue::Strong => out.extend(self.inlines(n.children(), &with(&cur, Mark::Strong))),
                NodeValue::Strikethrough => out.extend(self.inlines(n.children(), &with(&cur, Mark::Strike))),
                NodeValue::Code(c) => out.push(Inline::text_marked(c.literal, &with(&cur, Mark::Code))),
                NodeValue::LineBreak => out.push(Inline::Br),
                NodeValue::Link(l) => {
                    let children = self.inlines(n.children(), &cur);
                    out.extend(self.link(&l.url, if l.title.is_empty() { None } else { Some(&l.title) }, children));
                }
                NodeValue::Image(l) => {
                    let alt = plain(n);
                    if let Some(img) = resolve_local_image(self.host.ctx, &mut self.b, &l.url, &alt, if l.title.is_empty() { None } else { Some(&l.title) }) {
                        out.push(Inline::image(img));
                    }
                }
                NodeValue::FootnoteReference(r) => {
                    let id = r.name.to_lowercase();
                    match self.note_index.get(&id).copied() {
                        Some(i) => {
                            let num = match self.note_numbers.get(&id) {
                                Some(n) => n.clone(),
                                None => {
                                    let num = (self.note_numbers.len() + 1).to_string();
                                    self.note_numbers.insert(id.clone(), num.clone());
                                    self.footnotes[i].label = num.clone();
                                    num
                                }
                            };
                            let key = format!("fn:{id}");
                            out.push(self.b.internal_link(&key, vec![Inline::text(num)], None));
                        }
                        None => out.push(Inline::text_marked(format!("[^{}]", r.name), &cur)),
                    }
                }
                NodeValue::HtmlInline(h) => {
                    let Some(m) = tag_re.captures(h.trim()) else { continue };
                    let name = m[2].to_lowercase();
                    if name == "br" {
                        out.push(Inline::Br);
                        continue;
                    }
                    if name == "img" {
                        let doc = Doc::parse_html(&h);
                        let notes = std::mem::take(&mut self.html_notes);
                        let mut walker = HtmlWalker::new(&mut self.host, &mut self.b, notes);
                        out.extend(walker.inlines(&doc, &doc.roots.clone(), &cur, Opts::default()));
                        self.html_notes = walker.notes;
                        continue;
                    }
                    let Some(mark) = html_mark(&name) else { continue };
                    if m.get(1).is_some() {
                        if let Some(i) = stack.iter().rposition(|&x| x == mark) {
                            stack.remove(i);
                        }
                    } else if m.get(3).is_none() {
                        stack.push(mark);
                    }
                }
                _ => {}
            }
        }
        out
    }

    fn link(&mut self, url: &str, title: Option<&str>, children: Vec<Inline>) -> Vec<Inline> {
        let kids: Vec<Inline> = children.iter().filter(|c| matches!(c, Inline::Text(_) | Inline::Image(_) | Inline::Br)).cloned().collect();
        match md_href(url) {
            Href::Drop => children,
            Href::Internal(key) => vec![self.b.internal_link(&key, kids, title)],
            Href::External(u) => vec![Inline::Link(LinkInline { target: LinkTarget::External { url: u }, title: title.map(str::to_string), children: kids, pending: None })],
        }
    }
}

fn with(marks: &[Mark], m: Mark) -> Vec<Mark> {
    let mut v = marks.to_vec();
    v.push(m);
    v
}

// ---------------------------------------------------------------------------------------------
// A small YAML subset for front matter: `key: value`, quoted strings, `key: [a, b]`, and
// `key:` followed by `- item` lines. Anything else is ignored.

#[derive(Clone, Debug, PartialEq)]
pub enum FrontValue {
    Str(String),
    List(Vec<String>),
}

pub fn parse_front_matter(src: &str) -> HashMap<String, FrontValue> {
    static COMMENT: OnceLock<Regex> = OnceLock::new();
    static ITEM: OnceLock<Regex> = OnceLock::new();
    static ITEM_FLUSH: OnceLock<Regex> = OnceLock::new();
    static KV: OnceLock<Regex> = OnceLock::new();
    let comment = COMMENT.get_or_init(|| Regex::new(r"\s+#.*$").unwrap());
    let item = ITEM.get_or_init(|| Regex::new(r"^\s+-\s+(.*)$").unwrap());
    let item_flush = ITEM_FLUSH.get_or_init(|| Regex::new(r"^-\s+(.*)$").unwrap());
    let kv = KV.get_or_init(|| Regex::new(r"^([A-Za-z_][\w-]*)\s*:\s*(.*)$").unwrap());
    let mut out: HashMap<String, FrontValue> = HashMap::new();
    let mut list_key: Option<String> = None;
    for raw in src.split('\n') {
        let line = comment.replace(raw, "").trim_end().to_string();
        if line.trim().is_empty() {
            continue;
        }
        let it = item.captures(&line).or_else(|| if list_key.is_some() { item_flush.captures(&line) } else { None });
        if let (Some(it), Some(key)) = (it, &list_key) {
            let v = unquote(&it[1]);
            match out.get_mut(key) {
                Some(FrontValue::List(l)) => l.push(v),
                _ => {
                    out.insert(key.clone(), FrontValue::List(vec![v]));
                }
            }
            continue;
        }
        let Some(m) = kv.captures(&line) else { continue };
        let key = m[1].to_lowercase();
        let value = m[2].trim().to_string();
        list_key = None;
        if value.is_empty() {
            list_key = Some(key);
            continue;
        }
        if value.starts_with('[') && value.ends_with(']') {
            let items: Vec<String> = value[1..value.len() - 1].split(',').map(|s| unquote(s.trim())).filter(|s| !s.is_empty()).collect();
            out.insert(key, FrontValue::List(items));
        } else {
            out.insert(key, FrontValue::Str(unquote(&value)));
        }
    }
    out
}

fn unquote(s: &str) -> String {
    let t = s.trim();
    if t.len() >= 2 && ((t.starts_with('"') && t.ends_with('"')) || (t.starts_with('\'') && t.ends_with('\''))) {
        return t[1..t.len() - 1].to_string();
    }
    t.to_string()
}
