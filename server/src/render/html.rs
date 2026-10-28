//! Block model → the HTML vocabulary in API.md, plus a map between the section's `textContent`
//! offsets (what a DOM selection measures) and block points (what anchors store).
//!
//! Every text node we emit is recorded as a piece: its offset in the section's textContent, its
//! length, and which block offset it starts at (None for atoms: note labels, aside titles, notes).
//! No whitespace is ever emitted between tags, so the browser's textContent equals the pieces.

use crate::model::*;
use crate::util::utf16::len16;
use regex::Regex;
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Clone, Debug, PartialEq)]
pub struct Piece {
    /// Offset in the section's textContent.
    pub s: usize,
    pub len: usize,
    pub block_id: Option<String>,
    /// Offset in the block's text where this piece starts.
    pub bo: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Bias {
    Start,
    End,
}

#[derive(Debug)]
pub struct SectionTextMap {
    pub pieces: Vec<Piece>,
    pub length: usize,
    by_block: HashMap<String, Vec<usize>>,
}

impl SectionTextMap {
    pub fn new(pieces: Vec<Piece>, length: usize) -> SectionTextMap {
        let mut by_block: HashMap<String, Vec<usize>> = HashMap::new();
        for (i, p) in pieces.iter().enumerate() {
            if let Some(b) = &p.block_id {
                by_block.entry(b.clone()).or_default().push(i);
            }
        }
        SectionTextMap { pieces, length, by_block }
    }

    pub fn has_block(&self, block_id: &str) -> bool {
        self.by_block.contains_key(block_id)
    }

    /// textContent offset → block point. `Start` bias: a boundary belongs to the following text;
    /// `End` bias: to the preceding text. Offsets inside atoms snap outward to the nearest block text.
    pub fn to_point(&self, offset: usize, bias: Bias) -> Option<BlockPoint> {
        let ps: Vec<&Piece> = self.pieces.iter().filter(|p| p.block_id.is_some()).collect();
        if ps.is_empty() {
            return None;
        }
        match bias {
            Bias::Start => {
                for p in &ps {
                    if offset < p.s + p.len {
                        return Some(BlockPoint { block_id: p.block_id.clone().unwrap(), offset: p.bo + offset.saturating_sub(p.s) });
                    }
                }
                let last = ps[ps.len() - 1];
                Some(BlockPoint { block_id: last.block_id.clone().unwrap(), offset: last.bo + last.len })
            }
            Bias::End => {
                for p in ps.iter().rev() {
                    if offset > p.s {
                        return Some(BlockPoint { block_id: p.block_id.clone().unwrap(), offset: p.bo + p.len.min(offset - p.s) });
                    }
                }
                let first = ps[0];
                Some(BlockPoint { block_id: first.block_id.clone().unwrap(), offset: first.bo })
            }
        }
    }

    /// Block point → textContent offset (None if the block isn't in this section).
    pub fn to_offset(&self, point: &BlockPoint, bias: Bias) -> Option<usize> {
        let arr = self.by_block.get(&point.block_id)?;
        for &i in arr {
            let p = &self.pieces[i];
            if point.offset < p.bo {
                return Some(p.s); // inside a <br> gap: next text
            }
            if point.offset < p.bo + p.len || (bias == Bias::End && point.offset == p.bo + p.len) {
                return Some(p.s + (point.offset - p.bo));
            }
        }
        let last = &self.pieces[*arr.last().unwrap()];
        Some(last.s + last.len)
    }

    /// The textContent range of a whole block.
    pub fn block_range(&self, block_id: &str) -> Option<(usize, usize)> {
        let arr = self.by_block.get(block_id)?;
        let first = &self.pieces[*arr.first()?];
        let last = &self.pieces[*arr.last()?];
        Some((first.s, last.s + last.len))
    }

    /// The textContent range of all block text (excludes the notes at the end).
    pub fn flow_range(&self) -> (usize, usize) {
        let ps: Vec<&Piece> = self.pieces.iter().filter(|p| p.block_id.is_some()).collect();
        match (ps.first(), ps.last()) {
            (Some(f), Some(l)) => (f.s, l.s + l.len),
            _ => (0, 0),
        }
    }
}

pub struct RenderedSection {
    pub html: String,
    pub map: SectionTextMap,
}

const MARK_ORDER: [Mark; 9] = [Mark::Strong, Mark::Em, Mark::Underline, Mark::Strike, Mark::Smallcaps, Mark::Mark, Mark::Sup, Mark::Sub, Mark::Code];

fn mark_open(m: Mark) -> &'static str {
    match m {
        Mark::Strong => "<strong>",
        Mark::Em => "<em>",
        Mark::Underline => "<u>",
        Mark::Strike => "<s>",
        Mark::Smallcaps => "<span class=\"smallcaps\">",
        Mark::Mark => "<mark>",
        Mark::Sup => "<sup>",
        Mark::Sub => "<sub>",
        Mark::Code => "<code>",
    }
}

fn mark_close(m: Mark) -> &'static str {
    match m {
        Mark::Strong => "</strong>",
        Mark::Em => "</em>",
        Mark::Underline => "</u>",
        Mark::Strike => "</s>",
        Mark::Smallcaps => "</span>",
        Mark::Mark => "</mark>",
        Mark::Sup => "</sup>",
        Mark::Sub => "</sub>",
        Mark::Code => "</code>",
    }
}

pub fn escape_text(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

pub fn escape_attr(s: &str) -> String {
    s.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;").replace('>', "&gt;")
}

struct Writer {
    html: String,
    pos: usize,
    pieces: Vec<Piece>,
}

impl Writer {
    fn raw(&mut self, s: &str) {
        self.html.push_str(s);
    }

    fn text(&mut self, s: &str, block_id: Option<&str>, bo: usize) {
        if s.is_empty() {
            return;
        }
        self.html.push_str(&escape_text(s));
        let len = len16(s);
        self.pieces.push(Piece { s: self.pos, len, block_id: block_id.map(str::to_string), bo });
        self.pos += len;
    }
}

/// `attrs([("k", Some("v")), ...])`: attributes in order, skipping None; `Some("")` renders as `k=""`.
fn attrs(a: &[(&str, Option<String>)]) -> String {
    let mut s = String::new();
    for (k, v) in a {
        if let Some(v) = v {
            s.push(' ');
            s.push_str(k);
            s.push_str("=\"");
            s.push_str(&escape_attr(v));
            s.push('"');
        }
    }
    s
}

fn align_class(align: Option<Align>, extra: &[&str]) -> Option<String> {
    let mut cls: Vec<String> = extra.iter().map(|s| s.to_string()).collect();
    if let Some(a) = align {
        cls.push(format!("align-{}", match a {
            Align::Center => "center",
            Align::Right => "right",
        }));
    }
    if cls.is_empty() {
        None
    } else {
        Some(cls.join(" "))
    }
}

fn image_tag(img: &ImageRef) -> String {
    let num = |n: Option<u32>| n.map(|x| x.to_string());
    if img.remote {
        format!("<img{}>", attrs(&[("data-remote-src", Some(img.src.clone())), ("alt", Some(img.alt.clone())), ("title", img.title.clone()), ("width", num(img.width)), ("height", num(img.height))]))
    } else {
        format!(
            "<img{}>",
            attrs(&[("src", Some(img.src.clone())), ("alt", Some(img.alt.clone())), ("title", img.title.clone()), ("width", num(img.width)), ("height", num(img.height)), ("loading", Some("lazy".to_string()))])
        )
    }
}

/// Emit inline content. `block_id` None renders text as atom (notes, titles). Returns block offset reached.
fn write_inlines(w: &mut Writer, content: &[Inline], block_id: Option<&str>, mut bo: usize) -> usize {
    for c in content {
        match c {
            Inline::Text(run) => bo = write_run(w, run, block_id, bo),
            Inline::Br => {
                w.raw("<br>");
                bo += 1;
            }
            Inline::Image(i) => w.raw(&image_tag(&i.image)),
            Inline::NoteRef(r) => {
                w.raw(&format!("<sup{}><a{}>", attrs(&[("class", Some("noteref".into())), ("data-atom", Some(String::new())), ("data-note", Some(r.note_id.clone()))]), attrs(&[("href", Some(format!("#{}", r.note_id))), ("role", Some("doc-noteref".into()))])));
                w.text(&r.label, None, 0);
                w.raw("</a></sup>");
            }
            Inline::Link(l) => {
                match &l.target {
                    LinkTarget::External { url } => w.raw(&format!("<a{}>", attrs(&[("href", Some(url.clone())), ("title", l.title.clone()), ("rel", Some("noopener noreferrer".into()))]))),
                    LinkTarget::Internal { section_id, block_id: bid } => w.raw(&format!(
                        "<a{}>",
                        attrs(&[("class", Some("internal".into())), ("href", Some(format!("#{bid}"))), ("data-section", Some(section_id.clone())), ("data-block", Some(bid.clone())), ("title", l.title.clone())])
                    )),
                }
                bo = write_inlines(w, &l.children, block_id, bo);
                w.raw("</a>");
            }
        }
    }
    bo
}

fn write_run(w: &mut Writer, run: &TextRun, block_id: Option<&str>, bo: usize) -> usize {
    let marks: Vec<Mark> = MARK_ORDER.iter().copied().filter(|m| run.marks.as_ref().map(|ms| ms.contains(m)).unwrap_or(false)).collect();
    for m in &marks {
        w.raw(mark_open(*m));
    }
    w.text(&run.text, block_id, bo);
    for m in marks.iter().rev() {
        w.raw(mark_close(*m));
    }
    bo + len16(&run.text)
}

fn write_leaf(w: &mut Writer, l: &Leaf, tag: &str, extra: &[(&str, Option<String>)], in_note: bool, code_lang: Option<Option<&str>>) {
    let id = if in_note { None } else { Some(l.id.clone()) };
    let mut a: Vec<(&str, Option<String>)> = vec![("id", id.clone()), ("data-b", id)];
    a.extend(extra.iter().cloned());
    w.raw(&format!("<{tag}{}>", attrs(&a)));
    let bid = if in_note { None } else { Some(l.id.as_str()) };
    if let Some(lang) = code_lang {
        w.raw(&format!("<code{}>", attrs(&[("class", lang.map(|x| format!("language-{x}")))])));
        w.text(&l.text, bid, 0);
        w.raw("</code>");
    } else {
        write_inlines(w, &l.content, bid, 0);
    }
    w.raw(&format!("</{tag}>"));
}

fn write_blocks(w: &mut Writer, blocks: &[Block], in_note: bool) {
    for b in blocks {
        write_block(w, b, in_note);
    }
}

fn write_block(w: &mut Writer, b: &Block, in_note: bool) {
    match b {
        Block::Heading(h) => write_leaf(w, &h.leaf, &format!("h{}", h.level), &[("class", align_class(h.leaf.align, &[]))], in_note, None),
        Block::Paragraph(p) => write_leaf(w, &p.leaf, "p", &[("class", align_class(p.leaf.align, if p.variant.is_some() { &["verse"] } else { &[] }))], in_note, None),
        Block::Code(c) => write_leaf(w, &c.leaf, "pre", &[], in_note, Some(c.lang.as_deref())),
        Block::Hr(_) => w.raw("<hr>"),
        Block::List(l) => {
            let tag = if l.ordered { "ol" } else { "ul" };
            let is_task = l.items.iter().any(|i| i.checked.is_some());
            w.raw(&format!("<{tag}{}>", attrs(&[("start", if l.ordered { l.start.map(|s| s.to_string()) } else { None }), ("class", if is_task { Some("tasks".into()) } else { None })])));
            for it in &l.items {
                w.raw(&format!("<li{}>", attrs(&[("data-checked", it.checked.map(|c| c.to_string()))])));
                write_blocks(w, &it.blocks, in_note);
                w.raw("</li>");
            }
            w.raw(&format!("</{tag}>"));
        }
        Block::Blockquote(q) => {
            w.raw(&format!("<blockquote{}>", attrs(&[("class", align_class(q.align, &[]))])));
            write_blocks(w, &q.blocks, in_note);
            w.raw("</blockquote>");
        }
        Block::Aside(a) => {
            w.raw(&format!("<aside{}>", attrs(&[("class", Some("callout".into())), ("data-variant", Some(a.variant.clone()))])));
            if let Some(t) = &a.title {
                w.raw(&format!("<p{}>", attrs(&[("class", Some("aside-title".into())), ("data-atom", Some(String::new()))])));
                w.text(t, None, 0);
                w.raw("</p>");
            }
            write_blocks(w, &a.blocks, in_note);
            w.raw("</aside>");
        }
        Block::Table(t) => {
            w.raw("<table>");
            if let Some(c) = &t.caption {
                write_leaf(w, &c.leaf, "caption", &[], in_note, None);
            }
            let mut i = 0;
            while i < t.rows.len() && t.rows[i].header {
                i += 1;
            }
            let (head, body) = t.rows.split_at(i);
            let rows = |w: &mut Writer, rs: &[TableRow]| {
                for r in rs {
                    w.raw("<tr>");
                    for c in &r.cells {
                        let cls = c.cell_align.map(|a| format!("align-{}", match a {
                            CellAlign::Left => "left",
                            CellAlign::Center => "center",
                            CellAlign::Right => "right",
                        }));
                        write_leaf(w, &c.leaf, if c.header { "th" } else { "td" }, &[("colspan", c.colspan.map(|x| x.to_string())), ("rowspan", c.rowspan.map(|x| x.to_string())), ("class", cls)], in_note, None);
                    }
                    w.raw("</tr>");
                }
            };
            if !head.is_empty() {
                w.raw("<thead>");
                rows(w, head);
                w.raw("</thead>");
            }
            if !body.is_empty() {
                w.raw("<tbody>");
                rows(w, body);
                w.raw("</tbody>");
            }
            w.raw("</table>");
        }
        Block::Figure(f) => {
            w.raw(&format!("<figure{}>", attrs(&[("class", align_class(f.align, &[]))])));
            for img in &f.images {
                w.raw(&image_tag(img));
            }
            if let Some(c) = &f.caption {
                write_leaf(w, &c.leaf, "figcaption", &[], in_note, None);
            }
            w.raw("</figure>");
        }
    }
}

fn write_notes(w: &mut Writer, notes: &[Note]) {
    if notes.is_empty() {
        return;
    }
    w.raw(&format!("<section{}>", attrs(&[("class", Some("notes".into())), ("data-atom", Some(String::new())), ("role", Some("doc-endnotes".into()))])));
    for n in notes {
        w.raw(&format!("<div{}>", attrs(&[("class", Some("note".into())), ("id", Some(n.id.clone())), ("role", Some("doc-footnote".into()))])));
        let first = first_leaf(&n.blocks);
        if !n.label.is_empty() && !first.map(|f| f.text.trim_start().starts_with(&n.label)).unwrap_or(false) {
            w.raw("<span class=\"note-label\">");
            w.text(&n.label, None, 0);
            w.raw("</span>");
        }
        write_blocks(w, &n.blocks, true);
        w.raw("</div>");
    }
    w.raw("</section>");
}

pub fn render_section(section: &DocSection) -> RenderedSection {
    let mut w = Writer { html: String::new(), pos: 0, pieces: Vec::new() };
    write_blocks(&mut w, &section.blocks, false);
    write_notes(&mut w, &section.notes);
    let length = w.pos;
    RenderedSection { html: w.html, map: SectionTextMap::new(w.pieces, length) }
}

/// Plain-text excerpt (about `max` characters): the first real prose paragraph of the body, skipping
/// boilerplate, front matter, contents pages, headings, lists and tables. Falls back to any text.
pub fn excerpt_of(sections: &[DocSection], max: usize) -> String {
    static NOT_BODY: OnceLock<Regex> = OnceLock::new();
    static NON_WORD: OnceLock<Regex> = OnceLock::new();
    static BY: OnceLock<Regex> = OnceLock::new();
    static ENDS: OnceLock<Regex> = OnceLock::new();
    static TRAIL: OnceLock<Regex> = OnceLock::new();
    let not_body = NOT_BODY.get_or_init(|| Regex::new(r"(?i)^(project gutenberg|front matter|(table of )?contents|list of illustrations|illustrations|copyright|title page|cover|dedication)\b").unwrap());
    let non_word = NON_WORD.get_or_init(|| Regex::new(r"^[\W\d]*$").unwrap());
    let by = BY.get_or_init(|| Regex::new(r"(?i)^by\s").unwrap());
    let ends = ENDS.get_or_init(|| Regex::new(r#"[.!?…"”’)]$"#).unwrap());
    let trail = TRAIL.get_or_init(|| Regex::new(r"[\s,;:.-]+$").unwrap());
    let pick = |strict: bool| -> String {
        let mut s = String::new();
        for sec in sections {
            if strict && not_body.is_match(sec.title.trim()) {
                continue;
            }
            for b in &sec.blocks {
                let is_para = matches!(b, Block::Paragraph(_));
                if !is_para && !(matches!(b, Block::Blockquote(_)) && !strict) {
                    continue;
                }
                let mut leaves = Vec::new();
                leaves_of_block(b, &mut leaves);
                for l in leaves {
                    let words = l.text.split_whitespace().count();
                    if strict {
                        let skip = words < 12
                            || non_word.is_match(&l.text)
                            || by.is_match(&l.text)
                            || !ends.is_match(&l.text)
                            || match b {
                                Block::Paragraph(p) => p.variant.is_some() || p.leaf.align == Some(Align::Center),
                                _ => false,
                            };
                        if skip {
                            continue;
                        }
                    }
                    if !s.is_empty() {
                        s.push(' ');
                    }
                    s.push_str(&l.text.split_whitespace().collect::<Vec<_>>().join(" "));
                    // One real paragraph is the excerpt; short fallbacks may gather a few.
                    if strict || s.chars().count() >= max {
                        return s;
                    }
                }
            }
            if !s.is_empty() {
                return s;
            }
        }
        s
    };
    let mut s = pick(true);
    if s.is_empty() {
        s = pick(false);
    }
    if s.chars().count() <= max {
        return s;
    }
    let cut: String = s.chars().take(max).collect();
    let sp = cut.rfind(' ');
    let head = match sp {
        Some(i) if cut[..i].chars().count() as f64 > max as f64 * 0.6 => &cut[..i],
        _ => &cut[..],
    };
    format!("{}…", trail.replace(head, ""))
}
