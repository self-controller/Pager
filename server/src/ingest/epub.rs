//! EPUB 2/3 → sections in the author's order.
//!
//! Sections follow the table of contents (EPUB 3 nav, else NCX), which may cut one spine file into
//! several chapters; with no usable TOC, one section per spine file. Nesting depth comes from the TOC
//! tree. Project Gutenberg's header and licence become their own sections. Footnotes marked as such,
//! and passages in non-linear files that the text links to, become notes.

use super::builder::{normalize_prose, DocBuilder, DraftDocument, DraftSection, SplitMode};
use super::context::IngestContext;
use super::html::{decode_safe, external_url, text_content, Href, HtmlHost, HtmlWalker, Opts};
use super::versions::Format;
use crate::config::limits;
use crate::errors::AppError;
use crate::library::assets::{asset_url, AssetStore};
use crate::model::*;
use crate::util::soup::{Doc, NodeId};
use crate::Result;
use regex::Regex;
use std::collections::{BTreeMap, HashMap};
use std::io::{Cursor, Read};
use std::sync::OnceLock;

const FONT_OBFUSCATION: &[&str] = &["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"];
/// TOC entries deeper than this become outline entries, not sections of their own.
const MAX_SECTION_DEPTH: u32 = 2;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        fn $name() -> &'static Regex {
            static RE: OnceLock<Regex> = OnceLock::new();
            RE.get_or_init(|| Regex::new($pat).unwrap())
        }
    };
}

re!(gutenberg_start, r"(?i)^\*{3}\s*START OF (THE|THIS) PROJECT GUTENBERG");
re!(gutenberg_end, r"(?i)^\*{3}\s*END OF (THE|THIS) PROJECT GUTENBERG");
re!(scheme_re, r"(?i)^[a-z][a-z0-9+.-]*:");
re!(xhtml_type, r"(?i)x?html");
re!(xhtml_ext, r"(?i)\.x?html?$");
re!(image_type, r"(?i)^image/");
re!(cover_prop, r"\bcover-image\b");
re!(nav_prop, r"\bnav\b");
re!(toc_word, r"\btoc\b");
re!(isbn_scheme, r"(?i)isbn");
re!(isbn_value, r"(?i)^(urn:isbn:)?97[89]\d{10}$");
re!(pub_event, r"(?i)publication|original");
re!(gutenberg_word, r"(?i)gutenberg");
re!(four_digits, r"^\d{4}$");
re!(tags_re, r"<[^>]+>");
re!(title_re, r"(?i)\b(chapter|letter|part|book|volume|act|scene|canto|stave)\s*([0-9]+|[ivxlcdm]+)\b(.*)$");
re!(all_digits, r"^\d+$");
re!(mixed_num, r"^\S+\d|[A-Za-z][IVXLCDM]");
re!(dots_ws, r"^[.\s]*$");
re!(dot_only, r"^\.\s*$");
re!(project_gutenberg, r"Project Gutenberg");
re!(not_body_title, r"^Project Gutenberg|^Front matter$");

#[derive(Clone, Debug)]
struct ManifestItem {
    href: String,
    media_type: String,
    properties: String,
}

#[derive(Clone, Debug)]
struct TocEntry {
    label: String,
    path: String,
    fragment: Option<String>,
    depth: u32,
}

/// The archive, read once into memory (EPUBs are small; the limits guard the rest).
struct Archive {
    files: HashMap<String, Vec<u8>>,
}

impl Archive {
    fn open(data: &[u8]) -> Result<Archive> {
        let not_epub = |msg: &str| AppError::new(422, "not_epub", msg);
        let mut zip = zip::ZipArchive::new(Cursor::new(data)).map_err(|_| not_epub("This file isn't a readable EPUB (it isn't a zip archive)."))?;
        if zip.len() > limits::ZIP_ENTRIES {
            return Err(AppError::new(422, "unsupported", "This file holds too many parts to be a book Pager can open."));
        }
        let mut total: u64 = 0;
        let mut files = HashMap::new();
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).map_err(|_| not_epub("This file isn't a readable EPUB (one of its parts can't be read)."))?;
            total += f.size();
            if total > limits::ZIP_UNCOMPRESSED_BYTES {
                return Err(AppError::new(413, "too_large", "This file unpacks to more than Pager will open."));
            }
            if f.is_dir() {
                continue;
            }
            let name = f.name().map(|n| n.into_owned()).map_err(|_| not_epub("This file isn't a readable EPUB (one of its parts can't be read)."))?;
            let mut bytes = Vec::with_capacity(f.size() as usize);
            f.read_to_end(&mut bytes).map_err(|_| not_epub("This file isn't a readable EPUB (one of its parts can't be read)."))?;
            files.insert(name, bytes);
        }
        Ok(Archive { files })
    }

    fn get(&self, p: &str) -> Option<&Vec<u8>> {
        self.files.get(p).or_else(|| self.files.get(&decode_safe(p)))
    }

    fn text(&self, p: &str) -> Option<String> {
        self.get(p).map(|b| super::decode::decode_text(b).0)
    }
}

/// Zip sanity for the limits test (entries and unpacked size).
pub fn guard_zip(entries: usize, uncompressed: u64) -> Result<()> {
    if entries > limits::ZIP_ENTRIES {
        return Err(AppError::new(422, "unsupported", "This file holds too many parts to be a book Pager can open."));
    }
    if uncompressed > limits::ZIP_UNCOMPRESSED_BYTES {
        return Err(AppError::new(413, "too_large", "This file unpacks to more than Pager will open."));
    }
    Ok(())
}

struct EpubHost<'a> {
    current_path: String,
    images: &'a HashMap<String, Vec<u8>>,
    assets: &'a AssetStore,
}

impl EpubHost<'_> {
    fn image_at(&self, builder: &mut DocBuilder, p: &str, alt: &str, title: Option<&str>) -> Option<ImageRef> {
        let bytes = self.images.get(p)?;
        let file = self.assets.put(bytes)?;
        builder.assets.insert(file.clone());
        Some(ImageRef { src: asset_url(&file), remote: false, alt: alt.to_string(), title: title.filter(|t| !t.is_empty()).map(str::to_string), width: None, height: None })
    }
}

impl HtmlHost for EpubHost<'_> {
    fn key(&self, id: &str) -> String {
        format!("{}#{id}", self.current_path)
    }

    fn href(&self, raw: &str) -> Href {
        if let Some(ext) = external_url(raw) {
            return Href::External(ext);
        }
        if scheme_re().is_match(raw) {
            return Href::Drop;
        }
        let (p, frag) = split_href(raw);
        let target = if p.is_empty() { self.current_path.clone() } else { resolve_path(&dirname(&self.current_path), &p) };
        Href::Internal(match frag {
            Some(f) => format!("{target}#{f}"),
            None => target,
        })
    }

    fn image(&mut self, builder: &mut DocBuilder, src: &str, alt: &str, title: Option<&str>) -> Option<ImageRef> {
        if src.to_ascii_lowercase().starts_with("data:") || external_url(src).is_some() {
            return None;
        }
        let p = resolve_path(&dirname(&self.current_path), &split_href(src).0);
        self.image_at(builder, &p, alt, title)
    }
}

pub fn parse_epub(data: &[u8], ctx: &IngestContext) -> Result<ParsedDocument> {
    let zip = Archive::open(data)?;
    let mut builder = DocBuilder::new("epub", Format::Epub.parser_version());

    let container = zip.text("META-INF/container.xml").ok_or_else(|| AppError::new(422, "not_epub", "This file isn't a readable EPUB (it has no META-INF/container.xml)."))?;
    let container_doc = Doc::parse_xml(&container);
    let rootfile = find_xml(&container_doc, "rootfile").into_iter().next();
    let opf_path = rootfile.and_then(|r| container_doc.attr(r, "full-path")).map(str::to_string).ok_or_else(|| AppError::new(422, "not_epub", "This EPUB doesn't say where its package file is."))?;
    let opf_xml = zip.text(&opf_path).ok_or_else(|| AppError::new(422, "not_epub", format!("This EPUB is missing its package file ({opf_path}).")))?;
    let opf = Doc::parse_xml(&opf_xml);
    let opf_dir = dirname(&opf_path);
    assert_no_drm(&zip)?;

    // Manifest and spine.
    let mut manifest: BTreeMap<String, ManifestItem> = BTreeMap::new();
    let mut manifest_order: Vec<String> = Vec::new();
    for item in find_xml(&opf, "item") {
        let (Some(id), Some(href)) = (opf.attr(item, "id"), opf.attr(item, "href")) else { continue };
        if id.is_empty() || href.is_empty() {
            continue;
        }
        manifest.insert(
            id.to_string(),
            ManifestItem { href: resolve_path(&opf_dir, href), media_type: opf.attr(item, "media-type").unwrap_or("").to_string(), properties: opf.attr(item, "properties").unwrap_or("").to_string() },
        );
        manifest_order.push(id.to_string());
    }
    let in_order: Vec<&ManifestItem> = manifest_order.iter().filter_map(|id| manifest.get(id)).collect();
    let spine_el = find_xml(&opf, "spine").into_iter().next();
    let mut linear: Vec<ManifestItem> = Vec::new();
    let mut non_linear: Vec<ManifestItem> = Vec::new();
    for r in find_xml(&opf, "itemref") {
        let Some(item) = opf.attr(r, "idref").and_then(|id| manifest.get(id)) else { continue };
        if !xhtml_type().is_match(&item.media_type) && !xhtml_ext().is_match(&item.href) {
            continue;
        }
        if opf.attr(r, "linear") == Some("no") {
            non_linear.push(item.clone());
        } else {
            linear.push(item.clone());
        }
    }
    if linear.is_empty() {
        return Err(AppError::new(422, "empty_document", "This EPUB has no readable chapters."));
    }

    // Metadata.
    let mut meta = read_meta(&opf);
    // Images: read once, stored as assets only when the text (or the cover) uses them.
    let mut image_bytes: HashMap<String, Vec<u8>> = HashMap::new();
    for m in &in_order {
        if !image_type().is_match(&m.media_type) {
            continue;
        }
        if let Some(b) = zip.get(&m.href) {
            image_bytes.insert(m.href.clone(), b.clone());
        }
    }
    let cover_item = in_order
        .iter()
        .find(|m| cover_prop().is_match(&m.properties))
        .copied()
        .or_else(|| find_xml(&opf, "meta").into_iter().find(|&m| opf.attr(m, "name") == Some("cover")).and_then(|m| opf.attr(m, "content")).and_then(|id| manifest.get(id)));
    let mut host = EpubHost { current_path: String::new(), images: &image_bytes, assets: &ctx.assets };
    if let Some(c) = cover_item {
        if let Some(img) = host.image_at(&mut builder, &c.href, "Cover", None) {
            meta.cover = Some(img.src);
        }
    }

    // Table of contents: EPUB 3 nav first, then NCX.
    let mut toc: Vec<TocEntry> = Vec::new();
    if let Some(nav) = in_order.iter().find(|m| nav_prop().is_match(&m.properties)) {
        toc = read_nav_toc(&zip, &nav.href);
    }
    if toc.is_empty() {
        let ncx_id = spine_el.and_then(|s| opf.attr(s, "toc"));
        let ncx = ncx_id.and_then(|id| manifest.get(id)).or_else(|| in_order.iter().find(|m| m.media_type == "application/x-dtbncx+xml").copied());
        if let Some(ncx) = ncx {
            toc = read_ncx_toc(&zip, &ncx.href);
        }
    }

    // Walk the spine into one flat list of top-level blocks.
    let mut blocks: Vec<Block> = Vec::new();
    let mut doc_start: HashMap<String, usize> = HashMap::new();
    let mut doc_first_heading: Vec<(usize, Option<String>)> = Vec::new();
    let mut top_of: HashMap<u32, usize> = HashMap::new();
    let mut notes: Vec<Note> = Vec::new();
    for item in &linear {
        let Some(markup) = zip.text(&item.href) else {
            builder.warn("Part of this book's text is missing from the file.");
            continue;
        };
        host.current_path = item.href.clone();
        let dom = Doc::parse_html(&markup);
        let body = dom.find_all(&|d, id| d.local_name(id) == "body").into_iter().next();
        let roots: Vec<NodeId> = body.map(|b| dom.children(b).to_vec()).unwrap_or_else(|| dom.roots.clone());
        let start = blocks.len();
        doc_start.insert(item.href.clone(), start);
        let doc_blocks = {
            let mut walker = HtmlWalker::new(&mut host, &mut builder, std::mem::take(&mut notes));
            walker.pend_anchor(&item.href);
            let out = walker.blocks(&dom, &roots, Opts::default());
            notes = walker.notes;
            out
        };
        for (i, b) in doc_blocks.iter().enumerate() {
            collect_targets(b, start + i, &mut top_of);
        }
        let h = doc_blocks.iter().find(|b| b.is_heading()).map(rough_text);
        doc_first_heading.push((start, h));
        blocks.extend(doc_blocks);
    }
    if blocks.is_empty() && notes.is_empty() {
        return Err(AppError::new(422, "empty_document", "This EPUB contains no text."));
    }

    // Non-linear files (endnotes, glossaries, pop-ups): passages the text links to become notes.
    for item in &non_linear {
        let Some(markup) = zip.text(&item.href) else { continue };
        host.current_path = item.href.clone();
        let dom = Doc::parse_html(&markup);
        let body = dom.find_all(&|d, id| d.local_name(id) == "body").into_iter().next();
        let roots: Vec<NodeId> = body.map(|b| dom.children(b).to_vec()).unwrap_or_else(|| dom.roots.clone());
        let doc_blocks = {
            let mut walker = HtmlWalker::new(&mut host, &mut builder, std::mem::take(&mut notes));
            let out = walker.blocks(&dom, &roots, Opts::default());
            notes = walker.notes;
            out
        };
        let mut local: HashMap<u32, usize> = HashMap::new();
        for (i, b) in doc_blocks.iter().enumerate() {
            collect_targets(b, i, &mut local);
        }
        let prefix = format!("{}#", item.href);
        let mut keys_by_top: BTreeMap<usize, Vec<String>> = BTreeMap::new();
        let mut anchor_keys: Vec<(String, u32)> = builder.anchors.iter().map(|(k, v)| (k.clone(), *v)).collect();
        anchor_keys.sort();
        for (key, target) in anchor_keys {
            if !key.starts_with(&prefix) {
                continue;
            }
            let Some(&i) = local.get(&target) else { continue };
            if !builder.is_linked(&key) {
                continue;
            }
            keys_by_top.entry(i).or_default().push(key);
        }
        let mut doc_blocks: Vec<Option<Block>> = doc_blocks.into_iter().map(Some).collect();
        for (i, keys) in keys_by_top {
            let Some(block) = doc_blocks[i].take() else { continue };
            let note = builder.note("", vec![block]);
            for k in keys {
                builder.anchor_set(&k, note.tid);
            }
            notes.push(note);
        }
    }

    // Section boundaries from the TOC (monotonic, first label wins), else one per spine file.
    #[derive(Clone)]
    struct Boundary {
        index: usize,
        title: Option<String>,
        depth: u32,
    }
    let mut boundaries: Vec<Boundary> = Vec::new();
    for entry in &toc {
        if entry.depth > MAX_SECTION_DEPTH {
            continue;
        }
        let mut idx: Option<usize> = None;
        if let Some(frag) = &entry.fragment {
            if let Some(target) = builder.anchors.get(&format!("{}#{frag}", entry.path)) {
                idx = top_of.get(target).copied();
            }
        }
        if idx.is_none() {
            idx = doc_start.get(&entry.path).copied();
        }
        let Some(idx) = idx else { continue };
        if idx >= blocks.len() {
            continue;
        }
        if let Some(prev) = boundaries.last() {
            if idx <= prev.index {
                continue;
            }
        }
        boundaries.push(Boundary { index: idx, title: Some(clean_title(&entry.label)), depth: entry.depth });
    }
    if boundaries.is_empty() {
        boundaries = doc_first_heading.iter().map(|(start, h)| Boundary { index: *start, title: h.as_ref().map(|t| clean_title(t)), depth: 0 }).collect();
        if !toc.is_empty() {
            builder.warn("The table of contents didn't match the text, so each file is its own section.");
        }
    }
    // Gutenberg boilerplate gets its own sections.
    let mut extra: Vec<Boundary> = Vec::new();
    for (i, b) in blocks.iter().enumerate() {
        let t = rough_text(b);
        if gutenberg_start().is_match(&t) && i + 1 < blocks.len() {
            extra.push(Boundary { index: 0, title: Some("Project Gutenberg header".to_string()), depth: 0 });
            extra.push(Boundary { index: i + 1, title: None, depth: 0 });
        }
        if gutenberg_end().is_match(&t) {
            extra.push(Boundary { index: i, title: Some("Project Gutenberg licence".to_string()), depth: 0 });
        }
    }
    if !extra.is_empty() {
        let mut by_index: BTreeMap<usize, Boundary> = BTreeMap::new();
        for b in boundaries {
            by_index.insert(b.index, b);
        }
        for e in extra {
            match by_index.get_mut(&e.index) {
                None => {
                    by_index.insert(e.index, e);
                }
                Some(existing) => {
                    if e.title.as_ref().map(|t| project_gutenberg().is_match(t)).unwrap_or(false) {
                        existing.title = e.title;
                    }
                }
            }
        }
        boundaries = by_index.into_values().collect();
        if let Some(licence) = boundaries.iter().find(|b| b.title.as_deref() == Some("Project Gutenberg licence")).map(|b| b.index) {
            boundaries.retain(|b| b.index <= licence);
        }
    }
    if boundaries.first().map(|b| b.index > 0).unwrap_or(true) {
        boundaries.insert(0, Boundary { index: 0, title: Some("Front matter".to_string()), depth: 0 });
    }
    // Depths relative to the shallowest TOC level in use.
    let min_depth = boundaries.iter().map(|b| b.depth).min().unwrap_or(0);

    let mut sections: Vec<DraftSection> = Vec::new();
    let mut remaining: Vec<Option<Block>> = blocks.into_iter().map(Some).collect();
    let total = remaining.len();
    for i in 0..boundaries.len() {
        let start = boundaries[i].index;
        let end = if i + 1 < boundaries.len() { boundaries[i + 1].index } else { total };
        if end <= start {
            continue;
        }
        let part: Vec<Block> = remaining[start..end].iter_mut().filter_map(|b| b.take()).collect();
        if part.is_empty() {
            continue;
        }
        let heading = part.iter().find(|p| p.is_heading());
        let first_line = rough_text(&part[0]).split('\n').next().unwrap_or("").trim().to_string();
        let title = boundaries[i]
            .title
            .clone()
            .or_else(|| heading.map(rough_text).filter(|t| t.chars().count() <= 80).map(|t| clean_title(&t)))
            .or_else(|| if !first_line.is_empty() && first_line.chars().count() <= 60 { Some(clean_title(&first_line)) } else { None })
            .unwrap_or_else(|| if sections.iter().all(|x| not_body_title().is_match(&x.title)) { "Front matter".to_string() } else { format!("Section {}", sections.len() + 1) });
        sections.push(DraftSection::new(title, boundaries[i].depth - min_depth, part));
    }
    let draft = DraftDocument { meta, blocks: None, sections: Some(sections), notes, warnings: Vec::new(), split: SplitMode::None, is_chapter_heading: None };
    Ok(builder.finalize(draft))
}

fn collect_targets(b: &Block, index: usize, out: &mut HashMap<u32, usize>) {
    out.insert(b.tid(), index);
    match b {
        Block::List(l) => {
            for it in &l.items {
                out.insert(it.tid, index);
                for x in &it.blocks {
                    collect_targets(x, index, out);
                }
            }
        }
        Block::Blockquote(q) => {
            for x in &q.blocks {
                collect_targets(x, index, out);
            }
        }
        Block::Aside(a) => {
            for x in &a.blocks {
                collect_targets(x, index, out);
            }
        }
        _ => {
            let mut leaves = Vec::new();
            leaves_of_block(b, &mut leaves);
            for l in leaves {
                out.insert(l.tid, index);
            }
        }
    }
}

/// Text of a draft block (before finalize computes texts).
fn rough_text(b: &Block) -> String {
    let mut leaves = Vec::new();
    leaves_of_block(b, &mut leaves);
    leaves.iter().map(|l| plain_text(&normalize_prose(l.content.clone()))).collect::<Vec<_>>().join("\n")
}

fn one_line(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn find_xml(doc: &Doc, name: &str) -> Vec<NodeId> {
    let want = name.to_ascii_lowercase();
    doc.find_all(&|d, id| d.local_name(id) == want)
}

fn read_meta(opf: &Doc) -> DocumentMeta {
    let first = |name: &str| find_xml(opf, name).into_iter().next().map(|n| one_line(&opf.raw_text(n))).unwrap_or_default();
    let creators = find_xml(opf, "creator");
    let authors: Vec<String> = creators
        .iter()
        .filter(|&&c| {
            let role = opf.attr(c, "opf:role").or_else(|| opf.attr(c, "role"));
            role.map(|r| r == "aut").unwrap_or(true)
        })
        .map(|&c| one_line(&opf.raw_text(c)))
        .filter(|s| !s.is_empty())
        .collect();
    let pkg = find_xml(opf, "package").into_iter().next();
    let uid = pkg.and_then(|p| opf.attr(p, "unique-identifier"));
    let ids = find_xml(opf, "identifier");
    let isbn = ids.iter().copied().find(|&i| isbn_scheme().is_match(opf.attr(i, "opf:scheme").unwrap_or("")) || isbn_value().is_match(opf.raw_text(i).trim()));
    let identifier = isbn.or_else(|| ids.iter().copied().find(|&i| opf.attr(i, "id") == uid && uid.is_some())).or_else(|| ids.first().copied()).map(|i| one_line(&opf.raw_text(i))).unwrap_or_default();
    let title = first("title");
    let mut meta = DocumentMeta {
        title: if title.is_empty() { "Untitled".to_string() } else { title },
        authors: if authors.is_empty() { creators.iter().map(|&c| one_line(&opf.raw_text(c))).filter(|s| !s.is_empty()).take(1).collect() } else { authors },
        ..Default::default()
    };
    let language = first("language");
    if !language.is_empty() {
        meta.language = Some(language);
    }
    if !identifier.is_empty() {
        meta.identifier = Some(identifier.clone());
    }
    // Prefer a date marked as publication; Project Gutenberg's dc:date is the ebook's release, not the book's.
    let dates = find_xml(opf, "date");
    let pub_date = dates.iter().copied().find(|&d| pub_event().is_match(opf.attr(d, "opf:event").or_else(|| opf.attr(d, "event")).unwrap_or("")));
    let is_gutenberg = gutenberg_word().is_match(&format!("{identifier} {} {}", first("source"), first("publisher")));
    let date = if is_gutenberg { String::new() } else { pub_date.or_else(|| dates.first().copied()).map(|d| one_line(&opf.raw_text(d))).unwrap_or_default() };
    if !date.is_empty() {
        meta.published_at = Some(if four_digits().is_match(&date) { date } else { date.chars().take(10).collect() });
    }
    let description = tags_re().replace_all(&first("description"), "").into_owned();
    if !description.is_empty() {
        meta.description = Some(description.chars().take(1000).collect());
    }
    meta
}

fn assert_no_drm(zip: &Archive) -> Result<()> {
    let drm = || AppError::new(422, "drm_protected", "This EPUB is DRM-protected. Pager opens DRM-free books.");
    if zip.get("META-INF/rights.xml").is_some() {
        return Err(drm());
    }
    let Some(enc) = zip.text("META-INF/encryption.xml") else { return Ok(()) };
    let doc = Doc::parse_xml(&enc);
    for m in find_xml(&doc, "EncryptionMethod") {
        let alg = doc.attr(m, "Algorithm").or_else(|| doc.attr(m, "algorithm")).unwrap_or("");
        if !FONT_OBFUSCATION.contains(&alg) {
            return Err(drm());
        }
    }
    Ok(())
}

fn read_nav_toc(zip: &Archive, nav_path: &str) -> Vec<TocEntry> {
    let Some(markup) = zip.text(nav_path) else { return vec![] };
    let doc = Doc::parse_html(&markup);
    let navs = doc.find_all(&|d, id| d.local_name(id) == "nav");
    let toc_nav = navs.iter().copied().find(|&n| toc_word().is_match(doc.attr(n, "epub:type").unwrap_or("")) || toc_word().is_match(doc.attr(n, "role").unwrap_or(""))).or_else(|| navs.first().copied());
    let Some(toc_nav) = toc_nav else { return vec![] };
    let dir = dirname(nav_path);
    let mut out = Vec::new();
    fn walk_list(doc: &Doc, ol: NodeId, depth: u32, dir: &str, nav_path: &str, out: &mut Vec<TocEntry>) {
        for &li in doc.children(ol) {
            if !doc.is_element(li) || doc.local_name(li) != "li" {
                continue;
            }
            for &c in doc.children(li) {
                if !doc.is_element(c) {
                    continue;
                }
                let n = doc.local_name(c);
                if n == "a" {
                    if let Some(href) = doc.attr(c, "href") {
                        if !href.is_empty() {
                            let (p, frag) = split_href(href);
                            out.push(TocEntry { label: one_line(&text_content(doc, c)), path: if p.is_empty() { nav_path.to_string() } else { resolve_path(dir, &p) }, fragment: frag, depth });
                        }
                    }
                } else if n == "ol" || n == "ul" {
                    walk_list(doc, c, depth + 1, dir, nav_path, out);
                }
            }
        }
    }
    let top = doc.children(toc_nav).iter().copied().find(|&c| doc.is_element(c) && matches!(doc.local_name(c).as_str(), "ol" | "ul"));
    match top {
        Some(top) => walk_list(&doc, top, 0, &dir, nav_path, &mut out),
        None => {
            for a in doc.find_under(toc_nav, &|d, id| d.local_name(id) == "a" && d.attr(id, "href").map(|h| !h.is_empty()).unwrap_or(false)) {
                let (p, frag) = split_href(doc.attr(a, "href").unwrap());
                out.push(TocEntry { label: one_line(&text_content(&doc, a)), path: if p.is_empty() { nav_path.to_string() } else { resolve_path(&dir, &p) }, fragment: frag, depth: 0 });
            }
        }
    }
    out
}

fn read_ncx_toc(zip: &Archive, ncx_path: &str) -> Vec<TocEntry> {
    let Some(xml) = zip.text(ncx_path) else { return vec![] };
    let doc = Doc::parse_xml(&xml);
    let dir = dirname(ncx_path);
    let mut out = Vec::new();
    fn walk(doc: &Doc, el: NodeId, depth: u32, dir: &str, out: &mut Vec<TocEntry>) {
        for &c in doc.children(el) {
            if !doc.is_element(c) || doc.local_name(c) != "navpoint" {
                continue;
            }
            let label = doc.children(c).iter().copied().find(|&x| doc.is_element(x) && doc.local_name(x) == "navlabel");
            let content = doc.children(c).iter().copied().find(|&x| doc.is_element(x) && doc.local_name(x) == "content");
            if let Some(src) = content.and_then(|x| doc.attr(x, "src")) {
                if !src.is_empty() {
                    let (p, frag) = split_href(src);
                    out.push(TocEntry { label: one_line(&label.map(|l| text_content(doc, l)).unwrap_or_default()), path: resolve_path(dir, &p), fragment: frag, depth });
                }
            }
            walk(doc, c, depth + 1, dir, out);
        }
    }
    if let Some(nav_map) = find_xml(&doc, "navMap").into_iter().next() {
        walk(&doc, nav_map, 0, &dir, &mut out);
    }
    out
}

/// Tidy TOC labels: "He rode a black horse. CHAPTER III." → "Chapter III".
pub fn clean_title(raw: &str) -> String {
    let mut t = one_line(raw);
    if let Some(m) = title_re().captures(&t) {
        let word = &m[1];
        let num = if all_digits().is_match(&m[2]) { m[2].to_string() } else { m[2].to_uppercase() };
        let rest = &m[3];
        let rest = if dot_only().is_match(rest) { "" } else { rest };
        let label_word = if word == word.to_uppercase() {
            let mut cs = word.chars();
            let f: String = cs.next().map(|c| c.to_string()).unwrap_or_default();
            format!("{f}{}", cs.as_str().to_lowercase())
        } else {
            word.to_string()
        };
        let label = format!("{label_word} {num}");
        let whole = m.get(0).unwrap();
        if whole.start() > 0 || mixed_num().is_match(whole.as_str()) || rest.is_empty() || dots_ws().is_match(rest) {
            t = if rest.trim().is_empty() { label } else { format!("{label}{rest}") };
        }
    }
    if t.chars().count() > 120 {
        format!("{}…", t.chars().take(117).collect::<String>())
    } else {
        t
    }
}

fn split_href(href: &str) -> (String, Option<String>) {
    match href.find('#') {
        None => (decode_safe(href), None),
        Some(i) => {
            let frag = decode_safe(&href[i + 1..]);
            (decode_safe(&href[..i]), if frag.is_empty() { None } else { Some(frag) })
        }
    }
}

fn dirname(p: &str) -> String {
    match p.rfind('/') {
        Some(i) => p[..i].to_string(),
        None => String::new(),
    }
}

pub fn resolve_path(base: &str, rel: &str) -> String {
    let decoded = decode_safe(rel);
    if let Some(rest) = decoded.strip_prefix('/') {
        return rest.to_string();
    }
    let joined = if base.is_empty() { decoded } else { format!("{base}/{decoded}") };
    let mut out: Vec<&str> = Vec::new();
    for part in joined.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            out.pop();
        } else {
            out.push(part);
        }
    }
    out.join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_are_tidied() {
        assert_eq!(clean_title("He rode a black horse. CHAPTER III."), "Chapter III");
        assert_eq!(clean_title("CHAPTER I."), "Chapter I");
        assert_eq!(clean_title("Chapter 1: The Boy Who Lived"), "Chapter 1: The Boy Who Lived");
        assert_eq!(clean_title("An illustration caption. CHAPTER III."), "Chapter III");
    }

    #[test]
    fn paths_resolve() {
        assert_eq!(resolve_path("OEBPS", "../img/a.png"), "img/a.png");
        assert_eq!(resolve_path("OEBPS/text", "ch1.xhtml"), "OEBPS/text/ch1.xhtml");
        assert_eq!(resolve_path("", "/abs.xhtml"), "abs.xhtml");
    }
}
