//! Word (.docx), read straight from its XML: paragraph styles become headings, quotes and code;
//! numbering becomes nested lists; runs keep bold, italic, strike, super/subscript and code;
//! footnotes, endnotes, hyperlinks, bookmarks, images and tables are kept. Title and author come
//! from the document properties.

use super::builder::{DocBuilder, DraftDocument, SplitMode};
use super::context::IngestContext;
use super::html::external_url;
use super::title::title_from_file_name;
use super::versions::Format;
use crate::errors::AppError;
use crate::library::assets::asset_url;
use crate::model::*;
use crate::util::soup::{Doc, NodeId};
use crate::Result;
use std::collections::HashMap;
use std::io::{Cursor, Read};

fn unreadable() -> AppError {
    AppError::new(422, "unsupported", "This file isn't a readable Word document.")
}

struct Package {
    files: HashMap<String, Vec<u8>>,
}

impl Package {
    fn open(data: &[u8]) -> Result<Package> {
        let mut zip = zip::ZipArchive::new(Cursor::new(data)).map_err(|_| unreadable())?;
        let mut files = HashMap::new();
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).map_err(|_| unreadable())?;
            if f.is_dir() {
                continue;
            }
            let name = f.name().map(|n| n.trim_start_matches('/').to_string()).map_err(|_| unreadable())?;
            let mut bytes = Vec::new();
            f.read_to_end(&mut bytes).map_err(|_| unreadable())?;
            files.insert(name, bytes);
        }
        if !files.contains_key("word/document.xml") {
            return Err(unreadable());
        }
        Ok(Package { files })
    }

    fn xml(&self, name: &str) -> Option<Doc> {
        self.files.get(name).map(|b| Doc::parse_xml(&String::from_utf8_lossy(b)))
    }
}

#[derive(Clone, Debug, Default)]
struct Style {
    name: String,
    num: Option<(String, u32)>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ParaKind {
    Heading(u8),
    Quote,
    Code,
    Plain,
}

struct Converter<'a> {
    b: DocBuilder,
    ctx: &'a IngestContext,
    pkg: &'a Package,
    styles: HashMap<String, Style>,
    /// numId → abstractNumId
    nums: HashMap<String, String>,
    /// abstractNumId → ilvl → numFmt
    levels: HashMap<String, HashMap<u32, String>>,
    rels: HashMap<String, (String, String, bool)>,
    note_count: usize,
    pending_ids: Vec<String>,
}

fn ln(doc: &Doc, id: NodeId) -> String {
    doc.local_name(id)
}

fn child(doc: &Doc, id: NodeId, name: &str) -> Option<NodeId> {
    let want = name.to_ascii_lowercase();
    doc.children(id).iter().copied().find(|&c| doc.is_element(c) && ln(doc, c) == want)
}

fn attr_val(doc: &Doc, id: NodeId) -> Option<String> {
    doc.attr(id, "w:val").map(str::to_string)
}

fn toggle_on(doc: &Doc, rpr: NodeId, name: &str) -> bool {
    match child(doc, rpr, name) {
        None => false,
        Some(el) => !matches!(attr_val(doc, el).as_deref(), Some("0") | Some("false") | Some("off")),
    }
}

impl<'a> Converter<'a> {
    fn load_styles(&mut self) {
        let Some(doc) = self.pkg.xml("word/styles.xml") else { return };
        for s in doc.find_all(&|d, id| d.local_name(id) == "style") {
            let Some(id) = doc.attr(s, "w:styleId") else { continue };
            let name = child(&doc, s, "name").and_then(|n| attr_val(&doc, n)).unwrap_or_default();
            let num = child(&doc, s, "pPr").and_then(|p| child(&doc, p, "numPr")).and_then(|np| Self::num_pr(&doc, np));
            self.styles.insert(id.to_string(), Style { name, num });
        }
    }

    fn num_pr(doc: &Doc, np: NodeId) -> Option<(String, u32)> {
        let num_id = child(doc, np, "numId").and_then(|n| attr_val(doc, n))?;
        let ilvl = child(doc, np, "ilvl").and_then(|n| attr_val(doc, n)).and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
        Some((num_id, ilvl))
    }

    fn load_numbering(&mut self) {
        let Some(doc) = self.pkg.xml("word/numbering.xml") else { return };
        for a in doc.find_all(&|d, id| d.local_name(id) == "abstractnum") {
            let Some(id) = doc.attr(a, "w:abstractNumId") else { continue };
            let mut lvls = HashMap::new();
            for l in doc.children(a).iter().copied().filter(|&c| doc.is_element(c) && ln(&doc, c) == "lvl") {
                let Some(ilvl) = doc.attr(l, "w:ilvl").and_then(|v| v.parse::<u32>().ok()) else { continue };
                let fmt = child(&doc, l, "numFmt").and_then(|n| attr_val(&doc, n)).unwrap_or_else(|| "decimal".to_string());
                lvls.insert(ilvl, fmt);
            }
            self.levels.insert(id.to_string(), lvls);
        }
        for n in doc.find_all(&|d, id| d.local_name(id) == "num") {
            let Some(id) = doc.attr(n, "w:numId") else { continue };
            if let Some(abs) = child(&doc, n, "abstractNumId").and_then(|x| attr_val(&doc, x)) {
                self.nums.insert(id.to_string(), abs);
            }
        }
    }

    fn load_rels(&mut self) {
        let Some(doc) = self.pkg.xml("word/_rels/document.xml.rels") else { return };
        for r in doc.find_all(&|d, id| d.local_name(id) == "relationship") {
            let (Some(id), Some(target)) = (doc.attr(r, "Id"), doc.attr(r, "Target")) else { continue };
            let kind = doc.attr(r, "Type").unwrap_or("").rsplit('/').next().unwrap_or("").to_string();
            let external = doc.attr(r, "TargetMode") == Some("External");
            self.rels.insert(id.to_string(), (target.to_string(), kind, external));
        }
    }

    fn is_ordered(&self, num_id: &str, ilvl: u32) -> bool {
        let fmt = self.nums.get(num_id).and_then(|a| self.levels.get(a)).and_then(|l| l.get(&ilvl)).map(String::as_str).unwrap_or("decimal");
        fmt != "bullet" && fmt != "none"
    }

    fn paragraph_kind(&self, style_id: Option<&str>) -> ParaKind {
        let Some(id) = style_id else { return ParaKind::Plain };
        let name = self.styles.get(id).map(|s| s.name.to_lowercase()).unwrap_or_default();
        let lid = id.to_lowercase();
        if name == "title" || lid == "title" {
            return ParaKind::Heading(1);
        }
        if name == "subtitle" || lid == "subtitle" {
            return ParaKind::Heading(2);
        }
        for n in 1..=6u8 {
            if name == format!("heading {n}") || lid == format!("heading{n}") {
                return ParaKind::Heading(n);
            }
        }
        match name.as_str() {
            "quote" | "intense quote" | "block text" => ParaKind::Quote,
            "code" | "source code" | "preformatted text" => ParaKind::Code,
            _ => ParaKind::Plain,
        }
    }

    fn run_style_marks(&self, style_id: &str) -> Vec<Mark> {
        let name = self.styles.get(style_id).map(|s| s.name.to_lowercase()).unwrap_or_default();
        match name.as_str() {
            "code" | "source text" => vec![Mark::Code],
            "strong" => vec![Mark::Strong],
            "emphasis" => vec![Mark::Em],
            _ => vec![],
        }
    }

    fn image(&mut self, rid: &str, alt: &str) -> Option<ImageRef> {
        let (target, _, external) = self.rels.get(rid)?.clone();
        if external {
            return None;
        }
        let path = if let Some(t) = target.strip_prefix('/') { t.to_string() } else { format!("word/{target}") };
        let bytes = self.pkg.files.get(&path)?;
        let file = self.ctx.assets.put(bytes)?;
        self.b.assets.insert(file.clone());
        Some(ImageRef { src: asset_url(&file), remote: false, alt: alt.to_string(), title: None, width: None, height: None })
    }

    /// Inline content of a run container (a paragraph, hyperlink, ins, sdt...).
    fn inlines(&mut self, doc: &Doc, parent: NodeId, marks: &[Mark]) -> Vec<Inline> {
        let mut out = Vec::new();
        for &c in doc.children(parent) {
            if !doc.is_element(c) {
                continue;
            }
            match ln(doc, c).as_str() {
                "r" => out.extend(self.run(doc, c, marks)),
                "hyperlink" => {
                    let children: Vec<Inline> = self.inlines(doc, c, marks).into_iter().filter(|x| matches!(x, Inline::Text(_) | Inline::Image(_) | Inline::Br)).collect();
                    if let Some(anchor) = doc.attr(c, "w:anchor") {
                        out.push(self.b.internal_link(&format!("#{anchor}"), children, None));
                    } else if let Some(url) = doc.attr(c, "r:id").and_then(|rid| self.rels.get(rid)).map(|(t, _, _)| t.clone()).and_then(|t| external_url(&t)) {
                        out.push(Inline::Link(LinkInline { target: LinkTarget::External { url }, title: None, children, pending: None }));
                    } else {
                        out.extend(children);
                    }
                }
                "ins" | "smarttag" | "sdt" | "sdtcontent" | "customxml" | "fldsimple" => out.extend(self.inlines(doc, c, marks)),
                "bookmarkstart" => {
                    if let Some(name) = doc.attr(c, "w:name") {
                        if !name.starts_with("_") {
                            self.pending_ids.push(format!("#{name}"));
                        }
                    }
                }
                "omath" | "omathpara" => self.b.warn("Some of this Word document's formatting couldn't be kept."),
                _ => {}
            }
        }
        out
    }

    fn run(&mut self, doc: &Doc, r: NodeId, marks: &[Mark]) -> Vec<Inline> {
        let mut m: Vec<Mark> = marks.to_vec();
        if let Some(rpr) = child(doc, r, "rPr") {
            if let Some(style) = child(doc, rpr, "rStyle").and_then(|s| attr_val(doc, s)) {
                m.extend(self.run_style_marks(&style));
            }
            if toggle_on(doc, rpr, "b") {
                m.push(Mark::Strong);
            }
            if toggle_on(doc, rpr, "i") {
                m.push(Mark::Em);
            }
            if toggle_on(doc, rpr, "strike") || toggle_on(doc, rpr, "dstrike") {
                m.push(Mark::Strike);
            }
            if toggle_on(doc, rpr, "smallCaps") {
                m.push(Mark::Smallcaps);
            }
            match child(doc, rpr, "vertAlign").and_then(|v| attr_val(doc, v)).as_deref() {
                Some("superscript") => m.push(Mark::Sup),
                Some("subscript") => m.push(Mark::Sub),
                _ => {}
            }
        }
        let mut out = Vec::new();
        for &c in doc.children(r) {
            if !doc.is_element(c) {
                continue;
            }
            match ln(doc, c).as_str() {
                "t" => out.push(Inline::text_marked(doc.raw_text(c), &m)),
                "tab" => out.push(Inline::text_marked("\t", &m)),
                "br" => {
                    if doc.attr(c, "w:type") != Some("page") {
                        out.push(Inline::Br);
                    }
                }
                "nobreakhyphen" => out.push(Inline::text_marked("\u{2011}", &m)),
                "softhyphen" => out.push(Inline::text_marked("\u{ad}", &m)),
                "sym" => {
                    if let Some(ch) = doc.attr(c, "w:char").and_then(|h| u32::from_str_radix(h, 16).ok()).and_then(char::from_u32) {
                        out.push(Inline::text_marked(ch.to_string(), &m));
                    }
                }
                "footnotereference" | "endnotereference" => {
                    let kind = ln(doc, c);
                    if let Some(id) = doc.attr(c, "w:id") {
                        let key = format!("fn:{}:{id}", if kind == "footnotereference" { "f" } else { "e" });
                        self.note_count += 1;
                        let num = self.note_count.to_string();
                        out.push(self.b.internal_link(&key, vec![Inline::text(num)], None));
                    }
                }
                "drawing" | "pict" | "object" => {
                    let alt = doc.find_under(c, &|d, id| d.local_name(id) == "docpr").into_iter().next().and_then(|p| doc.attr(p, "descr").or_else(|| doc.attr(p, "title"))).unwrap_or("").to_string();
                    let rid = doc
                        .find_under(c, &|d, id| matches!(d.local_name(id).as_str(), "blip" | "imagedata"))
                        .into_iter()
                        .next()
                        .and_then(|b| doc.attr(b, "r:embed").or_else(|| doc.attr(b, "r:id")).or_else(|| doc.attr(b, "r:link")))
                        .map(str::to_string);
                    match rid.and_then(|rid| self.image(&rid, &alt)) {
                        Some(img) => out.push(Inline::image(img)),
                        None => self.b.warn("Some of this Word document's formatting couldn't be kept."),
                    }
                }
                _ => {}
            }
        }
        out
    }

    fn para_style(doc: &Doc, p: NodeId) -> Option<String> {
        child(doc, p, "pPr").and_then(|pp| child(doc, pp, "pStyle")).and_then(|s| attr_val(doc, s))
    }

    fn para_numbering(&self, doc: &Doc, p: NodeId, style: Option<&str>) -> Option<(String, u32)> {
        if let Some(np) = child(doc, p, "pPr").and_then(|pp| child(doc, pp, "numPr")) {
            if let Some(n) = Self::num_pr(doc, np) {
                return Some(n);
            }
        }
        style.and_then(|s| self.styles.get(s)).and_then(|s| s.num.clone())
    }

    fn para_align(doc: &Doc, p: NodeId) -> Option<Align> {
        match child(doc, p, "pPr").and_then(|pp| child(doc, pp, "jc")).and_then(|j| attr_val(doc, j)).as_deref() {
            Some("center") => Some(Align::Center),
            Some("right") | Some("end") => Some(Align::Right),
            _ => None,
        }
    }

    /// One paragraph as a block (with its pending bookmark ids attached).
    fn paragraph_block(&mut self, doc: &Doc, p: NodeId, kind: ParaKind, align: Option<Align>) -> Block {
        let content = self.inlines(doc, p, &[]);
        let block = match kind {
            ParaKind::Heading(level) => self.b.heading(level as i64, content, align, None),
            ParaKind::Code => {
                let text = plain_text(&content);
                self.b.code(&text, None, None)
            }
            _ => self.b.paragraph(content, align, None, false),
        };
        let ids = std::mem::take(&mut self.pending_ids);
        for k in ids {
            self.b.anchor(&k, block.tid());
        }
        block
    }

    /// The blocks of a body-like container: paragraphs (grouped into lists and quotes) and tables.
    fn body(&mut self, doc: &Doc, container: NodeId) -> Vec<Block> {
        let mut out: Vec<Block> = Vec::new();
        // Open lists: (level, ordered, items) from the outermost in.
        let mut lists: Vec<(u32, bool, Vec<ListItem>)> = Vec::new();
        let mut code_lines: Vec<String> = Vec::new();

        fn close_to(c: &mut Converter, lists: &mut Vec<(u32, bool, Vec<ListItem>)>, depth: usize, out: &mut Vec<Block>) {
            while lists.len() > depth {
                let (_, ordered, items) = lists.pop().unwrap();
                let block = c.b.list(ordered, items, None);
                match lists.last_mut() {
                    Some(parent) => match parent.2.last_mut() {
                        Some(item) => item.blocks.push(block),
                        None => {
                            let it = c.b.item(vec![block], None);
                            parent.2.push(it);
                        }
                    },
                    None => out.push(block),
                }
            }
        }
        fn flush_code(c: &mut Converter, code_lines: &mut Vec<String>, out: &mut Vec<Block>) {
            if code_lines.is_empty() {
                return;
            }
            let text = code_lines.join("\n");
            code_lines.clear();
            out.push(c.b.code(&text, None, None));
        }

        for &c in doc.children(container) {
            if !doc.is_element(c) {
                continue;
            }
            let name = ln(doc, c);
            match name.as_str() {
                "p" => {
                    let style = Self::para_style(doc, c);
                    let kind = self.paragraph_kind(style.as_deref());
                    let numbering = self.para_numbering(doc, c, style.as_deref());
                    let align = if style.is_none() { Self::para_align(doc, c) } else { None };
                    if kind == ParaKind::Code {
                        close_to(self, &mut lists, 0, &mut out);
                        let content = self.inlines(doc, c, &[]);
                        let ids = std::mem::take(&mut self.pending_ids);
                        for k in ids {
                            // Bookmarks in code land on the block that follows.
                            self.pending_ids.push(k);
                        }
                        code_lines.push(plain_text(&content));
                        continue;
                    }
                    flush_code(self, &mut code_lines, &mut out);
                    match numbering {
                        Some((num_id, ilvl)) if kind == ParaKind::Plain => {
                            let ordered = self.is_ordered(&num_id, ilvl);
                            // Pop deeper lists; a list at this level of another kind is closed too.
                            while let Some(top) = lists.last() {
                                if top.0 > ilvl || (top.0 == ilvl && top.1 != ordered) {
                                    let depth = lists.len() - 1;
                                    close_to(self, &mut lists, depth, &mut out);
                                } else {
                                    break;
                                }
                            }
                            if lists.last().map(|t| t.0 < ilvl).unwrap_or(true) {
                                lists.push((ilvl, ordered, Vec::new()));
                            }
                            let block = self.paragraph_block(doc, c, ParaKind::Plain, align);
                            let item = self.b.item(vec![block], None);
                            lists.last_mut().unwrap().2.push(item);
                        }
                        _ => {
                            close_to(self, &mut lists, 0, &mut out);
                            let block = self.paragraph_block(doc, c, kind, align);
                            if kind == ParaKind::Quote {
                                // Consecutive quote paragraphs share one blockquote, as mammoth's "blockquote > p:fresh" does.
                                if let Some(Block::Blockquote(q)) = out.last_mut() {
                                    q.blocks.push(block);
                                } else {
                                    let q = self.b.blockquote(vec![block], None, None);
                                    out.push(q);
                                }
                            } else {
                                out.push(block);
                            }
                        }
                    }
                }
                "tbl" => {
                    flush_code(self, &mut code_lines, &mut out);
                    close_to(self, &mut lists, 0, &mut out);
                    if let Some(t) = self.table(doc, c) {
                        out.push(t);
                    }
                }
                "sdt" => {
                    if let Some(content) = child(doc, c, "sdtContent") {
                        flush_code(self, &mut code_lines, &mut out);
                        close_to(self, &mut lists, 0, &mut out);
                        out.extend(self.body(doc, content));
                    }
                }
                "bookmarkstart" => {
                    if let Some(name) = doc.attr(c, "w:name") {
                        if !name.starts_with('_') {
                            self.pending_ids.push(format!("#{name}"));
                        }
                    }
                }
                "sectpr" | "bookmarkend" | "prooferr" => {}
                _ => {}
            }
        }
        flush_code(self, &mut code_lines, &mut out);
        close_to(self, &mut lists, 0, &mut out);
        out
    }

    fn table(&mut self, doc: &Doc, tbl: NodeId) -> Option<Block> {
        let mut rows: Vec<TableRow> = Vec::new();
        // Column → (row index, cell index) of the cell a vertical merge continues.
        let mut spans: HashMap<usize, (usize, usize)> = HashMap::new();
        for tr in doc.children(tbl).iter().copied().filter(|&c| doc.is_element(c) && ln(doc, c) == "tr") {
            let header = child(doc, tr, "trPr").and_then(|p| child(doc, p, "tblHeader")).is_some();
            let mut cells: Vec<TableCell> = Vec::new();
            let mut col = 0usize;
            for tc in doc.children(tr).iter().copied().filter(|&c| doc.is_element(c) && ln(doc, c) == "tc") {
                let pr = child(doc, tc, "tcPr");
                let colspan = pr.and_then(|p| child(doc, p, "gridSpan")).and_then(|g| attr_val(doc, g)).and_then(|v| v.parse::<u32>().ok()).unwrap_or(1).max(1);
                let vmerge = pr.and_then(|p| child(doc, p, "vMerge")).map(|v| attr_val(doc, v).unwrap_or_else(|| "continue".to_string()));
                if vmerge.as_deref() == Some("continue") {
                    if let Some(&(ri, ci)) = spans.get(&col) {
                        if let Some(cell) = rows.get_mut(ri).and_then(|r| r.cells.get_mut(ci)) {
                            cell.rowspan = Some(cell.rowspan.unwrap_or(1) + 1);
                        }
                    }
                    col += colspan as usize;
                    continue;
                }
                let mut content: Vec<Inline> = Vec::new();
                for block in self.body(doc, tc) {
                    let parts = block_inlines_flat(&block);
                    if parts.is_empty() {
                        continue;
                    }
                    if !content.is_empty() {
                        content.push(Inline::Br);
                    }
                    content.extend(parts);
                }
                let mut cell = self.b.cell(content, header);
                if colspan > 1 {
                    cell.colspan = Some(colspan.min(1000));
                }
                if vmerge.as_deref() == Some("restart") {
                    spans.insert(col, (rows.len(), cells.len()));
                } else {
                    spans.remove(&col);
                }
                cells.push(cell);
                col += colspan as usize;
            }
            if !cells.is_empty() {
                rows.push(TableRow { header, cells });
            }
        }
        if rows.is_empty() {
            return None;
        }
        Some(self.b.table(rows, None, None))
    }

    fn notes(&mut self, part: &str, prefix: &str, element: &str) -> Vec<Note> {
        let mut out = Vec::new();
        let Some(doc) = self.pkg.xml(part) else { return out };
        for n in doc.find_all(&|d, id| d.local_name(id) == element) {
            let Some(id) = doc.attr(n, "w:id") else { continue };
            if matches!(doc.attr(n, "w:type"), Some("separator") | Some("continuationSeparator")) {
                continue;
            }
            let blocks = self.body(&doc, n);
            let note = self.b.note("", blocks);
            self.b.anchor(&format!("fn:{prefix}:{id}"), note.tid);
            out.push(note);
        }
        out
    }
}

/// All inline content of a block, for flattening into a table cell.
fn block_inlines_flat(b: &Block) -> Vec<Inline> {
    match b {
        Block::Heading(_) | Block::Paragraph(_) | Block::Code(_) => b.leaf().unwrap().content.clone(),
        Block::List(l) => join_br(l.items.iter().flat_map(|i| i.blocks.iter()).map(block_inlines_flat)),
        Block::Blockquote(q) => join_br(q.blocks.iter().map(block_inlines_flat)),
        Block::Aside(a) => join_br(a.blocks.iter().map(block_inlines_flat)),
        Block::Figure(f) => f.images.iter().map(|i| Inline::image(i.clone())).collect(),
        _ => vec![],
    }
}

fn join_br(parts: impl Iterator<Item = Vec<Inline>>) -> Vec<Inline> {
    let mut out = Vec::new();
    for p in parts {
        if p.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push(Inline::Br);
        }
        out.extend(p);
    }
    out
}

pub fn parse_docx(data: &[u8], ctx: &IngestContext) -> Result<ParsedDocument> {
    let pkg = Package::open(data)?;
    let mut conv = Converter {
        b: DocBuilder::new("docx", Format::Docx.parser_version()),
        ctx,
        pkg: &pkg,
        styles: HashMap::new(),
        nums: HashMap::new(),
        levels: HashMap::new(),
        rels: HashMap::new(),
        note_count: 0,
        pending_ids: Vec::new(),
    };
    conv.load_styles();
    conv.load_numbering();
    conv.load_rels();
    let doc = pkg.xml("word/document.xml").ok_or_else(unreadable)?;
    let body = doc.find_all(&|d, id| d.local_name(id) == "body").into_iter().next().ok_or_else(unreadable)?;
    let mut notes = conv.notes("word/footnotes.xml", "f", "footnote");
    notes.extend(conv.notes("word/endnotes.xml", "e", "endnote"));
    let blocks = conv.body(&doc, body);
    let meta = read_core_props(&pkg, &ctx.file_name);
    Ok(conv.b.finalize(DraftDocument::flat(meta, blocks, notes, SplitMode::Headings)))
}

fn read_core_props(pkg: &Package, file_name: &str) -> DocumentMeta {
    let mut meta = DocumentMeta { title: String::new(), authors: Vec::new(), ..Default::default() };
    if let Some(doc) = pkg.xml("docProps/core.xml") {
        let get = |name: &str| -> String {
            doc.find_all(&|d, id| d.name(id).map(|n| n.eq_ignore_ascii_case(name)).unwrap_or(false))
                .into_iter()
                .next()
                .map(|el| doc.raw_text(el).split_whitespace().collect::<Vec<_>>().join(" "))
                .unwrap_or_default()
        };
        meta.title = get("dc:title");
        let creator = get("dc:creator");
        if !creator.is_empty() {
            meta.authors = creator.split(';').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
        }
        let lang = get("dc:language");
        if !lang.is_empty() {
            meta.language = Some(lang);
        }
        let created = get("dcterms:created");
        if !created.is_empty() {
            meta.published_at = Some(created.chars().take(10).collect());
        }
        let description = get("dc:description");
        if !description.is_empty() {
            meta.description = Some(description);
        }
    }
    if meta.title.is_empty() {
        meta.title = title_from_file_name(file_name);
    }
    meta
}
