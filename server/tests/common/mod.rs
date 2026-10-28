#![allow(dead_code)]
//! Shared helpers: temp folders, fixtures, in-memory EPUB and DOCX builders.

use pager_server::ingest::IngestContext;
use pager_server::library::assets::AssetStore;
use std::io::Write;
use std::path::{Path, PathBuf};

pub fn temp_dir(prefix: &str) -> PathBuf {
    tempfile::Builder::new().prefix(prefix).tempdir().unwrap().keep()
}

pub fn ingest_ctx(base_dir: Option<&Path>, file_name: &str) -> IngestContext {
    IngestContext::new(file_name, base_dir, AssetStore::new(&temp_dir("pager-assets-")))
}

pub fn write_temp(name: &str, content: &[u8]) -> PathBuf {
    let dir = temp_dir("pager-files-");
    let p = dir.join(name);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(&p, content).unwrap();
    p
}

/// A 1×1 transparent PNG.
pub fn png_1px() -> Vec<u8> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=").unwrap()
}

pub fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures")
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

pub struct EpubFile {
    pub href: &'static str,
    pub body: String,
    pub linear: bool,
}

pub fn file(href: &'static str, body: &str) -> EpubFile {
    EpubFile { href, body: body.to_string(), linear: true }
}

pub fn nonlinear(href: &'static str, body: &str) -> EpubFile {
    EpubFile { href, body: body.to_string(), linear: false }
}

pub struct TocNode {
    pub label: String,
    pub href: String,
    pub children: Vec<TocNode>,
}

pub fn toc(label: &str, href: &str) -> TocNode {
    TocNode { label: label.to_string(), href: href.to_string(), children: vec![] }
}

pub fn toc_with(label: &str, href: &str, children: Vec<TocNode>) -> TocNode {
    TocNode { label: label.to_string(), href: href.to_string(), children }
}

#[derive(Default)]
pub struct EpubSpec {
    pub title: String,
    pub authors: Vec<String>,
    pub files: Vec<EpubFile>,
    pub toc: Option<Vec<TocNode>>,
    pub ncx: bool,
    pub drm: bool,
    pub images: Vec<(String, Vec<u8>)>,
    pub cover: Option<String>,
    pub language: Option<String>,
}

pub fn xhtml(body: &str, title: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?><!DOCTYPE html><html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\"><head><title>{}</title><style>p{{margin:0}}</style></head><body>{}</body></html>",
        esc(title),
        body
    )
}

/// Build an EPUB in memory (EPUB 3 nav or EPUB 2 NCX). Paths are relative to OEBPS/.
pub fn make_epub(o: EpubSpec) -> Vec<u8> {
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut buf);
        let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        let deflated = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("mimetype", stored).unwrap();
        zip.write_all(b"application/epub+zip").unwrap();
        zip.start_file("META-INF/container.xml", deflated).unwrap();
        zip.write_all(br#"<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#).unwrap();
        if o.drm {
            zip.start_file("META-INF/encryption.xml", deflated).unwrap();
            zip.write_all(br#"<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></enc:EncryptedData></encryption>"#).unwrap();
        }
        let mut manifest: Vec<String> = Vec::new();
        let mut spine: Vec<String> = Vec::new();
        for (i, f) in o.files.iter().enumerate() {
            zip.start_file(format!("OEBPS/{}", f.href), deflated).unwrap();
            zip.write_all(xhtml(&f.body, "x").as_bytes()).unwrap();
            manifest.push(format!("<item id=\"f{i}\" href=\"{}\" media-type=\"application/xhtml+xml\"/>", f.href));
            spine.push(format!("<itemref idref=\"f{i}\"{}/>", if f.linear { "" } else { " linear=\"no\"" }));
        }
        for (i, (href, bytes)) in o.images.iter().enumerate() {
            zip.start_file(format!("OEBPS/{href}"), deflated).unwrap();
            zip.write_all(bytes).unwrap();
            let props = if o.cover.as_deref() == Some(href.as_str()) { " properties=\"cover-image\"" } else { "" };
            manifest.push(format!("<item id=\"img{i}\" href=\"{href}\" media-type=\"image/png\"{props}/>"));
        }
        let toc: Vec<TocNode> = o.toc.unwrap_or_else(|| o.files.iter().filter(|f| f.linear).map(|f| self::toc(f.href, f.href)).collect());
        if !o.ncx {
            fn ol(nodes: &[TocNode]) -> String {
                format!("<ol>{}</ol>", nodes.iter().map(|n| format!("<li><a href=\"{}\">{}</a>{}</li>", n.href, esc(&n.label), if n.children.is_empty() { String::new() } else { ol(&n.children) })).collect::<String>())
            }
            zip.start_file("OEBPS/nav.xhtml", deflated).unwrap();
            zip.write_all(xhtml(&format!("<nav epub:type=\"toc\"><h1>Contents</h1>{}</nav>", ol(&toc)), "nav").as_bytes()).unwrap();
            manifest.push("<item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>".to_string());
        } else {
            fn points(nodes: &[TocNode], n: &mut usize) -> String {
                let mut s = String::new();
                for x in nodes {
                    *n += 1;
                    let id = *n;
                    s.push_str(&format!("<navPoint id=\"np{id}\" playOrder=\"{id}\"><navLabel><text>{}</text></navLabel><content src=\"{}\"/>", esc(&x.label), x.href));
                    s.push_str(&points(&x.children, n));
                    s.push_str("</navPoint>");
                }
                s
            }
            let mut n = 0;
            zip.start_file("OEBPS/toc.ncx", deflated).unwrap();
            zip.write_all(format!("<?xml version=\"1.0\"?><ncx xmlns=\"http://www.daisy.org/z3986/2005/ncx/\" version=\"2005-1\"><navMap>{}</navMap></ncx>", points(&toc, &mut n)).as_bytes()).unwrap();
            manifest.push("<item id=\"ncx\" href=\"toc.ncx\" media-type=\"application/x-dtbncx+xml\"/>".to_string());
        }
        let authors = if o.authors.is_empty() { vec!["A. Author".to_string()] } else { o.authors.clone() };
        let creators: String = authors.iter().map(|a| format!("<dc:creator>{}</dc:creator>", esc(a))).collect();
        zip.start_file("OEBPS/content.opf", deflated).unwrap();
        zip.write_all(
            format!(
                "<?xml version=\"1.0\"?><package xmlns=\"http://www.idpf.org/2007/opf\" version=\"{}\" unique-identifier=\"id\"><metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:identifier id=\"id\">urn:isbn:9780000000002</dc:identifier><dc:title>{}</dc:title>{}<dc:language>{}</dc:language><dc:date>1817</dc:date></metadata><manifest>{}</manifest><spine{}>{}</spine></package>",
                if o.ncx { "2.0" } else { "3.0" },
                esc(&o.title),
                creators,
                o.language.as_deref().unwrap_or("en"),
                manifest.join(""),
                if o.ncx { " toc=\"ncx\"" } else { "" },
                spine.join("")
            )
            .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();
    }
    buf.into_inner()
}

// ---- DOCX ----

const W: &str = "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"";

#[derive(Default)]
pub struct POpts {
    pub style: Option<&'static str>,
    pub num: Option<(u32, u32)>,
    pub jc: Option<&'static str>,
    pub runs: Option<String>,
}

pub fn p(text: &str, o: POpts) -> String {
    format!(
        "<w:p><w:pPr>{}{}{}</w:pPr>{}</w:p>",
        o.style.map(|s| format!("<w:pStyle w:val=\"{s}\"/>")).unwrap_or_default(),
        o.num.map(|(id, lvl)| format!("<w:numPr><w:ilvl w:val=\"{lvl}\"/><w:numId w:val=\"{id}\"/></w:numPr>")).unwrap_or_default(),
        o.jc.map(|j| format!("<w:jc w:val=\"{j}\"/>")).unwrap_or_default(),
        o.runs.unwrap_or_else(|| r(text, false, false))
    )
}

pub fn r(text: &str, b: bool, i: bool) -> String {
    let rpr = if b || i { format!("<w:rPr>{}{}</w:rPr>", if b { "<w:b/>" } else { "" }, if i { "<w:i/>" } else { "" }) } else { String::new() };
    format!("<w:r>{rpr}<w:t xml:space=\"preserve\">{}</w:t></w:r>", esc(text))
}

pub fn footnote_ref(id: u32) -> String {
    format!("<w:r><w:rPr><w:rStyle w:val=\"FootnoteReference\"/></w:rPr><w:footnoteReference w:id=\"{id}\"/></w:r>")
}

pub fn image(rid: &str, alt: &str) -> String {
    format!("<w:r><w:drawing><wp:inline><wp:extent cx=\"9525\" cy=\"9525\"/><wp:docPr id=\"1\" name=\"Picture 1\" descr=\"{}\"/><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><pic:pic><pic:nvPicPr><pic:cNvPr id=\"0\" name=\"p.png\"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed=\"{rid}\"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>", esc(alt))
}

pub fn table(rows: &[Vec<&str>], span_first_of_row: Option<usize>) -> String {
    let body: String = rows
        .iter()
        .enumerate()
        .map(|(ri, row)| {
            format!(
                "<w:tr>{}</w:tr>",
                row.iter().enumerate().map(|(ci, c)| format!("<w:tc><w:tcPr>{}</w:tcPr>{}</w:tc>", if span_first_of_row == Some(ri) && ci == 0 { "<w:gridSpan w:val=\"2\"/>" } else { "" }, p(c, POpts::default()))).collect::<String>()
            )
        })
        .collect();
    format!("<w:tbl><w:tblPr/>{body}</w:tbl>")
}

pub struct DocxSpec {
    pub body: String,
    pub footnotes: Vec<(u32, String)>,
    pub title: String,
    pub creator: String,
    pub images: Vec<(String, Vec<u8>)>,
}

pub fn make_docx(o: DocxSpec) -> Vec<u8> {
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut buf);
        let opt = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let mut put = |name: &str, content: &[u8]| {
            zip.start_file(name, opt).unwrap();
            zip.write_all(content).unwrap();
        };
        put("[Content_Types].xml", br#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#);
        put("_rels/.rels", br#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#);
        let image_rels: String = o.images.iter().enumerate().map(|(i, (name, _))| format!("<Relationship Id=\"rImg{i}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/{name}\"/>")).collect();
        put("word/_rels/document.xml.rels", format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rStyles\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>{image_rels}</Relationships>").as_bytes());
        for (name, bytes) in &o.images {
            put(&format!("word/media/{name}"), bytes);
        }
        let style = |id: &str, name: &str, kind: &str| format!("<w:style w:type=\"{kind}\" w:styleId=\"{id}\"><w:name w:val=\"{name}\"/></w:style>");
        put("word/styles.xml", format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><w:styles {W}>{}{}{}{}{}{}{}</w:styles>", style("Normal", "Normal", "paragraph"), style("Title", "Title", "paragraph"), style("Heading1", "Heading 1", "paragraph"), style("Heading2", "Heading 2", "paragraph"), style("Quote", "Quote", "paragraph"), style("Code", "Code", "paragraph"), style("FootnoteReference", "footnote reference", "character")).as_bytes());
        let lvl = |ilvl: u32, fmt: &str| format!("<w:lvl w:ilvl=\"{ilvl}\"><w:start w:val=\"1\"/><w:numFmt w:val=\"{fmt}\"/><w:lvlText w:val=\"{}\"/></w:lvl>", if fmt == "bullet" { "•".to_string() } else { format!("%{}.", ilvl + 1) });
        put("word/numbering.xml", format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><w:numbering {W}><w:abstractNum w:abstractNumId=\"0\">{}{}</w:abstractNum><w:abstractNum w:abstractNumId=\"1\">{}</w:abstractNum><w:num w:numId=\"1\"><w:abstractNumId w:val=\"0\"/></w:num><w:num w:numId=\"2\"><w:abstractNumId w:val=\"1\"/></w:num></w:numbering>", lvl(0, "bullet"), lvl(1, "bullet"), lvl(0, "decimal")).as_bytes());
        let notes: String = o.footnotes.iter().map(|(id, text)| format!("<w:footnote w:id=\"{id}\"><w:p>{}</w:p></w:footnote>", r(text, false, false))).collect();
        put("word/footnotes.xml", format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><w:footnotes {W}><w:footnote w:type=\"separator\" w:id=\"-1\"><w:p/></w:footnote><w:footnote w:type=\"continuationSeparator\" w:id=\"0\"><w:p/></w:footnote>{notes}</w:footnotes>").as_bytes());
        put("word/document.xml", format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><w:document {W}><w:body>{}</w:body></w:document>", o.body).as_bytes());
        put("docProps/core.xml", format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\"><dc:title>{}</dc:title><dc:creator>{}</dc:creator><dcterms:created>2025-03-04T10:00:00Z</dcterms:created></cp:coreProperties>", esc(&o.title), esc(&o.creator)).as_bytes());
        zip.finish().unwrap();
    }
    buf.into_inner()
}

// ---- Invariants ----

use pager_server::model::*;
use pager_server::render::html::render_section;
use pager_server::util::soup::Doc;
use std::collections::{HashMap, HashSet};

/// Everything later stages rely on. Returns a list of problems (empty = valid).
pub fn validate_document(doc: &ParsedDocument) -> Vec<String> {
    let mut errors: Vec<String> = Vec::new();
    let mut ids: HashMap<String, String> = HashMap::new();
    let mut leaf_ids: HashMap<String, String> = HashMap::new();
    let mut internal: Vec<(String, String, String)> = Vec::new();
    let mut note_refs: Vec<(String, String)> = Vec::new();
    fn claim(ids: &mut HashMap<String, String>, errors: &mut Vec<String>, id: &str, what: &str) {
        if id.is_empty() {
            errors.push(format!("empty id on {what}"));
        } else if let Some(prev) = ids.get(id) {
            errors.push(format!("duplicate id {id} ({what} and {prev})"));
        } else {
            ids.insert(id.to_string(), what.to_string());
        }
    }
    fn check_inlines(content: &[Inline], where_: &str, errors: &mut Vec<String>, internal: &mut Vec<(String, String, String)>, note_refs: &mut Vec<(String, String)>) {
        for c in content {
            match c {
                Inline::Link(l) => {
                    if l.children.is_empty() {
                        errors.push(format!("{where_}: empty link"));
                    }
                    match &l.target {
                        LinkTarget::External { url } => {
                            if !(url.starts_with("http:") || url.starts_with("https:") || url.starts_with("mailto:")) {
                                errors.push(format!("{where_}: unsafe link {url}"));
                            }
                        }
                        LinkTarget::Internal { section_id, block_id } => internal.push((where_.to_string(), section_id.clone(), block_id.clone())),
                    }
                    check_inlines(&l.children, where_, errors, internal, note_refs);
                }
                Inline::NoteRef(r) => note_refs.push((where_.to_string(), r.note_id.clone())),
                Inline::Image(i) => {
                    if !i.image.remote && !i.image.src.starts_with("/api/assets/") {
                        errors.push(format!("{where_}: local image not in assets: {}", i.image.src));
                    }
                }
                Inline::Text(t) => {
                    if t.text.is_empty() {
                        errors.push(format!("{where_}: empty text run"));
                    }
                }
                Inline::Br => {}
            }
        }
    }
    fn check_leaf(l: &Leaf, kind: &str, where_: &str, ids: &mut HashMap<String, String>, errors: &mut Vec<String>, internal: &mut Vec<(String, String, String)>, note_refs: &mut Vec<(String, String)>) {
        claim(ids, errors, &l.id, &format!("{kind} in {where_}"));
        let t = plain_text(&l.content);
        if t != l.text {
            errors.push(format!("{}: plain_text(content) {:?} != text {:?}", l.id, t.chars().take(40).collect::<String>(), l.text.chars().take(40).collect::<String>()));
        }
        if kind != "code" {
            if l.text.starts_with([' ', '\t']) || l.text.ends_with([' ', '\t']) {
                errors.push(format!("{}: untrimmed text {:?}", l.id, l.text.chars().take(40).collect::<String>()));
            }
            if l.text.contains("  ") {
                errors.push(format!("{}: double space", l.id));
            }
            if l.text.contains(['\t', '\r']) {
                errors.push(format!("{}: tab or CR in prose", l.id));
            }
        }
        if l.text.chars().any(|c| matches!(c, '\u{0}'..='\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}')) {
            errors.push(format!("{}: control character", l.id));
        }
        check_inlines(&l.content, &l.id, errors, internal, note_refs);
    }
    fn walk(blocks: &[Block], where_: &str, ids: &mut HashMap<String, String>, errors: &mut Vec<String>, internal: &mut Vec<(String, String, String)>, note_refs: &mut Vec<(String, String)>) {
        for b in blocks {
            match b {
                Block::Heading(h) => check_leaf(&h.leaf, "heading", where_, ids, errors, internal, note_refs),
                Block::Paragraph(p) => check_leaf(&p.leaf, "paragraph", where_, ids, errors, internal, note_refs),
                Block::Code(c) => check_leaf(&c.leaf, "code", where_, ids, errors, internal, note_refs),
                Block::List(l) => {
                    claim(ids, errors, &l.id, &format!("list in {where_}"));
                    for it in &l.items {
                        claim(ids, errors, &it.id, &format!("item in {where_}"));
                        walk(&it.blocks, where_, ids, errors, internal, note_refs);
                    }
                }
                Block::Blockquote(q) => {
                    claim(ids, errors, &q.id, &format!("blockquote in {where_}"));
                    if q.blocks.is_empty() {
                        errors.push(format!("{}: empty blockquote", q.id));
                    }
                    walk(&q.blocks, where_, ids, errors, internal, note_refs);
                }
                Block::Aside(a) => {
                    claim(ids, errors, &a.id, &format!("aside in {where_}"));
                    if a.blocks.is_empty() {
                        errors.push(format!("{}: empty aside", a.id));
                    }
                    walk(&a.blocks, where_, ids, errors, internal, note_refs);
                }
                Block::Table(t) => {
                    claim(ids, errors, &t.id, &format!("table in {where_}"));
                    if let Some(c) = &t.caption {
                        check_leaf(&c.leaf, "caption", where_, ids, errors, internal, note_refs);
                    }
                    for r in &t.rows {
                        for c in &r.cells {
                            check_leaf(&c.leaf, "cell", where_, ids, errors, internal, note_refs);
                        }
                    }
                }
                Block::Figure(f) => {
                    claim(ids, errors, &f.id, &format!("figure in {where_}"));
                    if let Some(c) = &f.caption {
                        check_leaf(&c.leaf, "caption", where_, ids, errors, internal, note_refs);
                    }
                }
                Block::Hr(r) => claim(ids, errors, &r.id, &format!("hr in {where_}")),
            }
        }
    }
    let mut section_ids: HashSet<String> = HashSet::new();
    let mut all_notes: HashSet<String> = HashSet::new();
    for s in &doc.sections {
        if !section_ids.insert(s.id.clone()) {
            errors.push(format!("duplicate section id {}", s.id));
        }
        walk(&s.blocks, &format!("section {}", s.id), &mut ids, &mut errors, &mut internal, &mut note_refs);
        for l in all_leaves(&s.blocks) {
            leaf_ids.insert(l.id.clone(), s.id.clone());
        }
        for n in &s.notes {
            claim(&mut ids, &mut errors, &n.id, &format!("note in {}", s.id));
            all_notes.insert(n.id.clone());
            walk(&n.blocks, &format!("note {}", n.id), &mut ids, &mut errors, &mut internal, &mut note_refs);
        }
    }
    for (w, sid, bid) in &internal {
        if !section_ids.contains(sid) {
            errors.push(format!("{w}: link to missing section {sid}"));
        } else if leaf_ids.get(bid) != Some(sid) {
            errors.push(format!("{w}: link to block {bid} not in section {sid}"));
        }
    }
    for (w, nid) in &note_refs {
        if !all_notes.contains(nid) {
            errors.push(format!("{w}: note reference to missing note {nid}"));
        }
    }
    for o in &doc.outline {
        if leaf_ids.get(&o.block_id) != Some(&o.section_id) {
            errors.push(format!("outline entry {} points nowhere", o.title));
        }
    }
    let mut chars = 0;
    let mut first = true;
    for s in &doc.sections {
        for l in all_leaves(&s.blocks) {
            chars += if first { 0 } else { 1 } + l.text.encode_utf16().count();
            first = false;
        }
    }
    if chars != doc.doc_chars {
        errors.push(format!("docChars {} != {chars}", doc.doc_chars));
    }
    errors
}

const TAGS: &[&str] = &["h1", "h2", "h3", "h4", "h5", "h6", "p", "pre", "code", "blockquote", "aside", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "caption", "figure", "figcaption", "img", "hr", "em", "strong", "sup", "sub", "s", "u", "mark", "span", "br", "a", "section", "div"];
const ATTRS: &[&str] = &["id", "data-b", "class", "href", "rel", "title", "data-section", "data-block", "data-atom", "data-note", "role", "src", "alt", "loading", "width", "height", "data-remote-src", "start", "data-checked", "colspan", "rowspan", "data-variant"];

/// The coordinate rule: text of a [data-b] element, skipping [data-atom], "\n" per <br>.
fn block_text_of(dom: &Doc, el: usize) -> String {
    let mut s = String::new();
    fn walk(dom: &Doc, n: usize, s: &mut String) {
        if let Some(t) = dom.text(n) {
            s.push_str(t);
        } else {
            if dom.has_attr(n, "data-atom") {
                return;
            }
            if dom.name(n) == Some("br") {
                s.push('\n');
            }
            for &c in dom.children(n) {
                walk(dom, c, s);
            }
        }
    }
    for &c in dom.children(el) {
        walk(dom, c, &mut s);
    }
    s
}

/// Render every section and check vocabulary, the coordinate rule and the text map.
pub fn validate_render(doc: &ParsedDocument) -> Vec<String> {
    let mut errors = Vec::new();
    let mut texts: HashMap<String, String> = HashMap::new();
    for s in &doc.sections {
        for l in all_leaves(&s.blocks) {
            texts.insert(l.id.clone(), l.text.clone());
        }
    }
    for s in &doc.sections {
        let r = render_section(s);
        let dom = Doc::parse_html(&r.html);
        let mut seen: HashSet<String> = HashSet::new();
        for n in dom.find_all(&|_, _| true) {
            let name = dom.name(n).unwrap();
            if !TAGS.contains(&name) {
                errors.push(format!("{}: tag <{name}> outside the vocabulary", s.id));
            }
            for (a, _) in dom.attrs(n) {
                if !ATTRS.contains(&a.as_str()) {
                    errors.push(format!("{}: attribute {a} on <{name}>", s.id));
                }
            }
            if let Some(h) = dom.attr(n, "href") {
                if !(h.starts_with('#') || h.starts_with("http:") || h.starts_with("https:") || h.starts_with("mailto:")) {
                    errors.push(format!("{}: unsafe href {h}", s.id));
                }
            }
            if let Some(b) = dom.attr(n, "data-b") {
                seen.insert(b.to_string());
                let got = block_text_of(&dom, n);
                match texts.get(b) {
                    None => errors.push(format!("{}: data-b {b} is not a block", s.id)),
                    Some(want) if *want != got => errors.push(format!("{}: block {b} renders {:?}, text is {:?}", s.id, got.chars().take(50).collect::<String>(), want.chars().take(50).collect::<String>())),
                    _ => {}
                }
            }
        }
        for l in all_leaves(&s.blocks) {
            if !seen.contains(&l.id) {
                errors.push(format!("{}: block {} not rendered", s.id, l.id));
            }
        }
        let mut tc = String::new();
        for &root in &dom.roots {
            dom.collect_text(root, &mut tc, &|_| false);
        }
        let tc16: Vec<u16> = tc.encode_utf16().collect();
        if tc16.len() != r.map.length {
            errors.push(format!("{}: textContent length {} != map length {}", s.id, tc16.len(), r.map.length));
        }
        for p in &r.map.pieces {
            let Some(b) = &p.block_id else { continue };
            let want: Vec<u16> = texts[b].encode_utf16().skip(p.bo).take(p.len).collect();
            let got: Vec<u16> = tc16.iter().copied().skip(p.s).take(p.len).collect();
            if got != want {
                errors.push(format!("{}: piece at {} doesn't match block {b}", s.id, p.s));
            }
        }
    }
    errors
}

pub fn find_leaf<'a>(doc: &'a ParsedDocument, text: &str) -> Option<&'a Leaf> {
    doc.sections.iter().flat_map(|s| all_leaves(&s.blocks)).find(|l| l.text.contains(text))
}

pub fn leaves(blocks: &[Block]) -> Vec<&Leaf> {
    all_leaves(blocks)
}

// ---- HTTP harness: both apps in process, driven with tower's oneshot ----

use axum::body::Body;
use axum::http::{Method, Request, Response};
use http_body_util::BodyExt;
use pager_server::app::{App, AppOptions};
use pager_server::clock::Clock;
use pager_server::http::{local_app, remote::remote_app};
use serde_json::Value;
use std::sync::Arc;
use tower::ServiceExt;

pub struct TestApp {
    pub app: Arc<App>,
    pub local: axum::Router,
    pub remote: axum::Router,
    pub clock: Clock,
    pub data_dir: PathBuf,
    pub reads_dir: PathBuf,
}

pub struct Answer {
    pub status: u16,
    pub body: Value,
    pub text: String,
    pub headers: axum::http::HeaderMap,
}

pub struct Call<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub json: Option<Value>,
    pub headers: Vec<(&'a str, String)>,
    pub raw: Option<(String, Vec<u8>)>,
}

impl<'a> Call<'a> {
    pub fn get(path: &'a str) -> Call<'a> {
        Call { method: "GET", path, json: None, headers: vec![], raw: None }
    }
    pub fn new(method: &'a str, path: &'a str) -> Call<'a> {
        Call { method, path, json: None, headers: vec![], raw: None }
    }
    pub fn json(mut self, v: Value) -> Self {
        self.json = Some(v);
        self
    }
    pub fn header(mut self, k: &'a str, v: impl Into<String>) -> Self {
        self.headers.push((k, v.into()));
        self
    }
    pub fn token(self, t: &str) -> Self {
        self.header("Authorization", format!("Bearer {t}"))
    }
    pub fn cookie(self, t: &str) -> Self {
        self.header("Cookie", format!("pager_device={t}"))
    }
}

pub fn make_app_with(clock: Clock, web: Option<PathBuf>, suggest: Option<String>) -> TestApp {
    let data_dir = temp_dir("pager-test-");
    let mut o = AppOptions::new(data_dir.clone());
    o.clock = clock.clone();
    o.mirror_delay_ms = 10;
    o.web = web;
    o.suggest_origin = Some(Arc::new(move || suggest.clone()));
    let app = App::new(o).unwrap();
    let reads_dir = app.reads_dir.clone();
    TestApp { local: local_app(&app), remote: remote_app(&app), app, clock, data_dir, reads_dir }
}

pub fn make_app() -> TestApp {
    make_app_with(Clock::fake("2026-10-24T12:00:00Z"), None, None)
}

async fn send(router: &axum::Router, host: &str, c: Call<'_>) -> Answer {
    let mut req = Request::builder().method(Method::from_bytes(c.method.as_bytes()).unwrap()).uri(format!("http://{host}{}", c.path));
    let mut has_host = false;
    for (k, v) in &c.headers {
        if k.eq_ignore_ascii_case("host") {
            has_host = true;
        }
        req = req.header(*k, v);
    }
    if !has_host {
        req = req.header("Host", host);
    }
    let body = if let Some((ct, bytes)) = c.raw {
        req = req.header("Content-Type", ct);
        Body::from(bytes)
    } else if let Some(j) = &c.json {
        req = req.header("Content-Type", "application/json");
        Body::from(serde_json::to_vec(j).unwrap())
    } else {
        Body::empty()
    };
    let res: Response<Body> = router.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = res.status().as_u16();
    let headers = res.headers().clone();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let body = serde_json::from_str(&text).unwrap_or(Value::Null);
    Answer { status, body, text, headers }
}

impl TestApp {
    pub async fn call(&self, c: Call<'_>) -> Answer {
        send(&self.local, "localhost:3006", c).await
    }

    pub async fn json(&self, method: &str, path: &str, json: Option<Value>) -> Answer {
        let mut c = Call::new(method, path);
        c.json = json;
        self.call(c).await
    }

    pub async fn get(&self, path: &str) -> Answer {
        self.call(Call::get(path)).await
    }

    pub async fn remote_call(&self, c: Call<'_>) -> Answer {
        send(&self.remote, "127.0.0.1:3007", c).await
    }

    /// A streaming response (SSE), not collected.
    pub async fn stream(&self, router: &axum::Router, host: &str, c: Call<'_>) -> Response<Body> {
        let mut req = Request::builder().method(Method::from_bytes(c.method.as_bytes()).unwrap()).uri(format!("http://{host}{}", c.path)).header("Host", host);
        for (k, v) in &c.headers {
            req = req.header(*k, v);
        }
        router.clone().oneshot(req.body(Body::empty()).unwrap()).await.unwrap()
    }

    pub fn write(&self, rel: &str, content: &str) -> PathBuf {
        let p = self.reads_dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, content).unwrap();
        p
    }

    pub fn events(&self, kind: &str) -> Vec<Value> {
        let c = self.app.lock();
        c.events_since(0, 10_000).unwrap().into_iter().filter(|e| e.kind == kind).map(|e| serde_json::to_value(e).unwrap()).collect()
    }

    pub fn last_seq(&self) -> i64 {
        self.app.lock().events_since(0, 100_000).unwrap().last().map(|e| e.seq).unwrap_or(0)
    }

    pub fn db_count(&self, sql: &str) -> i64 {
        self.app.lock().count(sql, &[]).unwrap()
    }

    pub fn db_exec(&self, sql: &str) {
        self.app.lock().db.execute_batch(sql).unwrap();
    }

    /// Add a file through the deprecated sources route; returns its document id.
    pub async fn add_file(&self, path: &Path) -> String {
        let r = self.json("POST", "/api/sources", Some(serde_json::json!({ "path": path.to_string_lossy() }))).await;
        assert_eq!(r.status, 201, "{}", r.text);
        r.body["job"]["documentIds"][0].as_str().unwrap().to_string()
    }

    pub async fn wait_job(&self, id: &str) -> Value {
        for _ in 0..300 {
            let j = self.get(&format!("/api/jobs/{id}")).await.body;
            let s = j["status"].as_str().unwrap_or("");
            if s == "done" || s == "error" {
                return j;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        panic!("job never finished");
    }
}

/// Read an SSE body for up to `ms` (or until `until` says so); returns the text and whether the server ended it.
pub async fn read_stream(res: Response<Body>, ms: u64, until: Option<fn(&str) -> bool>) -> (String, bool) {
    let mut body = res.into_body();
    let mut text = String::new();
    let mut ended = false;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(ms);
    loop {
        let now = tokio::time::Instant::now();
        if now >= deadline {
            break;
        }
        match tokio::time::timeout(deadline - now, body.frame()).await {
            Err(_) => break,
            Ok(None) => {
                ended = true;
                break;
            }
            Ok(Some(Ok(frame))) => {
                if let Some(data) = frame.data_ref() {
                    text.push_str(&String::from_utf8_lossy(data));
                }
                if let Some(u) = until {
                    if u(&text) {
                        break;
                    }
                }
            }
            Ok(Some(Err(_))) => {
                ended = true;
                break;
            }
        }
    }
    (text, ended)
}

pub fn sse_types(text: &str) -> Vec<String> {
    text.lines().filter_map(|l| l.strip_prefix("event: ")).map(str::to_string).collect()
}

pub fn multipart(field: &str, file_name: &str, content: &[u8]) -> (String, Vec<u8>) {
    let boundary = "----pagerboundary42";
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{file_name}\"\r\nContent-Type: application/octet-stream\r\n\r\n").as_bytes());
    body.extend_from_slice(content);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}
