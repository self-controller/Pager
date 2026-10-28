//! A standalone HTML file (a saved article, an exported note, a hand-written page). The page's own
//! structure is kept; site chrome is trimmed by landmarks only: the single <main> or <article> if
//! there is one, otherwise the body without nav, header, footer, forms and complementary asides.

use super::builder::{DocBuilder, DraftDocument, SplitMode};
use super::context::{resolve_local_image, IngestContext};
use super::html::{decode_safe, external_url, text_content, Href, HtmlHost, HtmlWalker, Opts};
use super::title::title_from_file_name;
use super::versions::Format;
use crate::model::*;
use crate::util::soup::{Doc, NodeId};

struct DocHost<'a> {
    ctx: &'a IngestContext,
}

impl HtmlHost for DocHost<'_> {
    fn key(&self, id: &str) -> String {
        format!("#{id}")
    }

    fn href(&self, raw: &str) -> Href {
        if let Some(frag) = raw.strip_prefix('#') {
            return Href::Internal(if frag.is_empty() { "#".to_string() } else { format!("#{}", decode_safe(frag)) });
        }
        match external_url(raw) {
            Some(u) => Href::External(u),
            None => Href::Drop,
        }
    }

    fn image(&mut self, builder: &mut DocBuilder, src: &str, alt: &str, title: Option<&str>) -> Option<ImageRef> {
        resolve_local_image(self.ctx, builder, src, alt, title)
    }
}

pub fn parse_html_document(html: &str, ctx: &IngestContext) -> ParsedDocument {
    let dom = Doc::parse_html(html);
    let mut builder = DocBuilder::new("html", Format::Html.parser_version());
    let mut host = DocHost { ctx };
    let by_name = |name: &str| dom.find_all(&|d, id| d.local_name(id) == name);
    let body = by_name("body").into_iter().next();
    let mains = by_name("main");
    let articles = by_name("article");
    let roots: Vec<NodeId> = if mains.len() == 1 {
        dom.children(mains[0]).to_vec()
    } else if articles.len() == 1 {
        dom.children(articles[0]).to_vec()
    } else {
        trim_chrome(&dom, body.map(|b| dom.children(b).to_vec()).unwrap_or_else(|| dom.roots.clone()))
    };
    let mut meta = read_meta(&dom);
    let (blocks, notes) = {
        let mut walker = HtmlWalker::new(&mut host, &mut builder, Vec::new());
        let blocks = walker.blocks(&dom, &roots, Opts::default());
        (blocks, walker.notes)
    };
    if meta.title.is_empty() {
        let h1 = by_name("h1").into_iter().next();
        let t = h1.map(|h| text_content(&dom, h).split_whitespace().collect::<Vec<_>>().join(" ")).unwrap_or_default();
        meta.title = if t.is_empty() { title_from_file_name(&ctx.file_name) } else { t };
    }
    builder.finalize(DraftDocument::flat(meta, blocks, notes, SplitMode::Headings))
}

fn trim_chrome(dom: &Doc, nodes: Vec<NodeId>) -> Vec<NodeId> {
    nodes
        .into_iter()
        .filter(|&n| {
            if !dom.is_element(n) {
                return true;
            }
            let name = dom.local_name(n);
            let role = dom.attr(n, "role").unwrap_or("").to_lowercase();
            if matches!(name.as_str(), "nav" | "header" | "footer" | "form") {
                return false;
            }
            if matches!(role.as_str(), "navigation" | "banner" | "contentinfo" | "search") {
                return false;
            }
            !(name == "aside" && role == "complementary")
        })
        .collect()
}

fn read_meta(dom: &Doc) -> DocumentMeta {
    let metas = dom.find_all(&|d, id| d.local_name(id) == "meta");
    let get = |names: &[&str]| -> Option<String> {
        for &m in &metas {
            let key = dom.attr(m, "name").or_else(|| dom.attr(m, "property")).unwrap_or("").to_lowercase();
            if names.contains(&key.as_str()) {
                if let Some(c) = dom.attr(m, "content") {
                    if !c.trim().is_empty() {
                        return Some(c.trim().to_string());
                    }
                }
            }
        }
        None
    };
    let title_el = dom.find_all(&|d, id| d.local_name(id) == "title").into_iter().next();
    let html_el = dom.find_all(&|d, id| d.local_name(id) == "html").into_iter().next();
    let title = get(&["og:title", "dc.title", "citation_title"]).unwrap_or_else(|| title_el.map(|t| text_content(dom, t).split_whitespace().collect::<Vec<_>>().join(" ")).unwrap_or_default());
    let author = get(&["author", "article:author", "dc.creator", "citation_author"]);
    let mut meta = DocumentMeta { title, authors: author.map(|a| vec![a]).unwrap_or_default(), ..Default::default() };
    if let Some(h) = html_el {
        if let Some(lang) = dom.attr(h, "lang").or_else(|| dom.attr(h, "xml:lang")) {
            meta.language = Some(lang.to_string());
        }
    }
    meta.published_at = get(&["article:published_time", "date", "dc.date", "citation_publication_date"]);
    meta.description = get(&["description", "og:description"]);
    meta
}
