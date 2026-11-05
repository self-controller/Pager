//! The verifier: deterministic, no model. It keeps what it can check and drops the rest.
//!
//! - A recommended work keeps its place only if its record resolves (Open Library, Crossref,
//!   Wikidata, or a page that answers) and the record's title (and author, where there is one)
//!   matches the work as named.
//! - A page citation survives only if its quote is on the page: in the text the run fetched, in a
//!   search citation's snippet, or in the computer's own fetch of the URL.
//! - A record citation survives if the record resolves and its title matches.
//! - A claim needs one surviving citation that isn't Wikipedia; a disagreement needs two sides that
//!   keep a claim each. Items and sections left empty go.

use super::lookup::{valid_isbn, Lookups, PageText, RecordInfo};
use super::schema::*;
use super::text_match::{author_matches, quote_found, quote_words, title_matches, tokens, QUOTE_MAX_WORDS, QUOTE_MIN_WORDS};
use futures::stream::{self, StreamExt};
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

/// Most citations kept per claim, items per section.
pub const MAX_CITATIONS: usize = 3;
pub const MAX_ITEMS: usize = 8;
/// Fewer kept claims than this outside the overview means "not much is known".
pub const LITTLE_KNOWN_BELOW: u32 = 3;
const CONCURRENCY: usize = 6;

/// What the run itself retrieved: fetched pages' text, search results, search citations' snippets.
#[derive(Clone, Debug, Default)]
pub struct Evidence {
    pub fetched: HashMap<String, String>,
    pub found: HashMap<String, String>,
    pub snippets: HashMap<String, Vec<String>>,
}

/// A URL compared loosely: https, host without "www.", no fragment, no trailing slash.
pub fn norm_url(u: &str) -> String {
    match url::Url::parse(u.trim()) {
        Ok(mut p) => {
            p.set_fragment(None);
            let host = p.host_str().unwrap_or("").to_ascii_lowercase();
            let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
            let path = p.path().trim_end_matches('/').to_string();
            let query = p.query().map(|q| format!("?{q}")).unwrap_or_default();
            format!("https://{host}{path}{query}")
        }
        Err(_) => u.trim().to_string(),
    }
}

fn is_wikipedia(u: &str) -> bool {
    url::Url::parse(u).ok().and_then(|p| p.host_str().map(|h| h.to_ascii_lowercase())).map(|h| h == "wikipedia.org" || h.ends_with(".wikipedia.org")).unwrap_or(false)
}

impl Evidence {
    /// Gather evidence from a response's content blocks (nested results included).
    pub fn collect(&mut self, v: &Value) {
        match v {
            Value::Object(o) => {
                match o.get("type").and_then(Value::as_str) {
                    Some("web_search_tool_result") => {
                        if let Some(results) = o.get("content").and_then(Value::as_array) {
                            for r in results {
                                if let Some(u) = r.get("url").and_then(Value::as_str) {
                                    self.found.insert(norm_url(u), r.get("title").and_then(Value::as_str).unwrap_or("").to_string());
                                }
                            }
                        }
                    }
                    Some("web_fetch_tool_result") => {
                        if let Some(c) = o.get("content").filter(|c| c.get("type").and_then(Value::as_str) == Some("web_fetch_result")) {
                            let url = c.get("url").and_then(Value::as_str).unwrap_or("");
                            let source = c.get("content").and_then(|d| d.get("source"));
                            if let Some(text) = source.filter(|s| s.get("type").and_then(Value::as_str) == Some("text")).and_then(|s| s.get("data")).and_then(Value::as_str) {
                                if !url.is_empty() {
                                    self.fetched.insert(norm_url(url), text.to_string());
                                }
                            }
                        }
                    }
                    Some("text") => {
                        if let Some(cs) = o.get("citations").and_then(Value::as_array) {
                            for c in cs {
                                if c.get("type").and_then(Value::as_str) == Some("web_search_result_location") {
                                    if let (Some(u), Some(t)) = (c.get("url").and_then(Value::as_str), c.get("cited_text").and_then(Value::as_str)) {
                                        self.snippets.entry(norm_url(u)).or_default().push(t.to_string());
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
                for child in o.values() {
                    if child.is_object() || child.is_array() {
                        self.collect(child);
                    }
                }
            }
            Value::Array(a) => {
                for x in a {
                    self.collect(x);
                }
            }
            _ => {}
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Dropped {
    pub what: String,
    pub reason: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub claims_kept: u32,
    pub claims_dropped: u32,
    pub works_kept: u32,
    pub works_dropped: u32,
    pub dropped: Vec<Dropped>,
}

pub struct Verified {
    pub sections: Vec<Section>,
    pub little_known: bool,
    pub report: Report,
}

/// What the lookups found, by record and by URL.
struct Resolved {
    records: HashMap<Record, Result<Option<RecordInfo>, String>>,
    pages: HashMap<String, Result<Option<PageText>, String>>,
}

async fn resolve_record(lookups: &Lookups, r: &Record) -> Result<Option<RecordInfo>, String> {
    let v = r.value.trim();
    match r.kind {
        RecordKind::Isbn => match valid_isbn(v) {
            Some(isbn) => lookups.ol_isbn(&isbn).await,
            None => Err("the ISBN's check digit is wrong".into()),
        },
        RecordKind::Olid => {
            let id = v.trim_start_matches("/works/").trim_start_matches("/books/").trim_start_matches("/authors/").trim_start_matches("https://openlibrary.org").rsplit('/').next().unwrap_or(v).to_string();
            lookups.ol_id(&id).await
        }
        RecordKind::Doi => {
            let doi = v.trim_start_matches("https://doi.org/").trim_start_matches("http://doi.org/").trim_start_matches("doi:");
            lookups.crossref_doi(doi).await
        }
        RecordKind::Wikidata => {
            let q = v.rsplit('/').next().unwrap_or(v);
            if q.starts_with('Q') && q[1..].chars().all(|c| c.is_ascii_digit()) && q.len() > 1 {
                lookups.wikidata_entity(q).await
            } else {
                Err("that isn't a Wikidata ID".into())
            }
        }
        RecordKind::Url => match lookups.page(v).await {
            Ok(Some(p)) => Ok(Some(RecordInfo { title: p.title.unwrap_or_default(), subtitle: Some(p.text.chars().take(20_000).collect()), authors: vec![], year: None, url: v.to_string() })),
            Ok(None) => Ok(None),
            Err(e) => Err(e),
        },
    }
}

struct Ctx<'a> {
    evidence: &'a Evidence,
    resolved: &'a Resolved,
    page_tokens: HashMap<String, Vec<String>>,
    report: Report,
}

fn short(s: &str, n: usize) -> String {
    let t: String = s.chars().take(n).collect();
    if t.chars().count() < s.chars().count() {
        format!("{t}…")
    } else {
        t
    }
}

impl Ctx<'_> {
    fn drop(&mut self, what: String, reason: impl Into<String>) {
        self.report.dropped.push(Dropped { what, reason: reason.into() });
    }

    fn tokens_for(&mut self, key: &str, text: &str) -> &Vec<String> {
        self.page_tokens.entry(key.to_string()).or_insert_with(|| tokens(text))
    }

    /// Ok when the citation checks out (and sets `check`); Err with the reason when it doesn't.
    fn check_citation(&mut self, c: &mut Citation) -> Result<(), String> {
        match c.kind {
            CitationKind::Page => {
                let url = c.url.clone().filter(|u| !u.trim().is_empty()).ok_or("no URL")?;
                let quote = c.quote.clone().filter(|q| !q.trim().is_empty()).ok_or("no quote")?;
                let n = quote_words(&quote);
                if n < QUOTE_MIN_WORDS {
                    return Err("the quote is too short to check".into());
                }
                if n > QUOTE_MAX_WORDS {
                    return Err("the quote is too long".into());
                }
                let key = norm_url(&url);
                if let Some(text) = self.evidence.fetched.get(&key) {
                    let text = text.clone();
                    if quote_found(&quote, self.tokens_for(&format!("fetched:{key}"), &text)) {
                        c.check = Some(Check::Quoted);
                        return Ok(());
                    }
                }
                if let Some(snips) = self.evidence.snippets.get(&key) {
                    if snips.iter().any(|s| quote_found(&quote, &tokens(s))) {
                        c.check = Some(Check::Quoted);
                        return Ok(());
                    }
                }
                match self.resolved.pages.get(&url) {
                    Some(Ok(Some(p))) => {
                        let text = p.text.clone();
                        if quote_found(&quote, self.tokens_for(&format!("page:{url}"), &text)) {
                            c.check = Some(Check::Quoted);
                            Ok(())
                        } else {
                            Err("the quote isn't on the page".into())
                        }
                    }
                    Some(Ok(None)) => Err("the page is missing, or isn't text (a PDF)".into()),
                    Some(Err(e)) => Err(format!("couldn't fetch the page ({e})")),
                    None => Err("the quote isn't in what the run read".into()),
                }
            }
            CitationKind::Record => {
                let r = c.record.clone().ok_or("no record")?;
                if r.kind == RecordKind::Url {
                    return Err("a web page needs a page citation with a quote".into());
                }
                match self.resolved.records.get(&r) {
                    Some(Ok(Some(info))) => {
                        if title_matches(&c.title, &info.title, info.subtitle.as_deref()) || title_matches(&info.title, &c.title, None) {
                            c.check = Some(Check::Record);
                            if c.url.is_none() {
                                c.url = Some(info.url.clone());
                            }
                            Ok(())
                        } else {
                            Err(format!("the record is \"{}\"", short(&info.title, 60)))
                        }
                    }
                    Some(Ok(None)) => Err("no such record".into()),
                    Some(Err(e)) => Err(format!("couldn't check the record ({e})")),
                    None => Err("the record wasn't looked up".into()),
                }
            }
        }
    }

    /// Keep the claim if a non-Wikipedia citation survives. Drops are reported under `place`.
    fn check_claim(&mut self, place: &str, mut claim: Claim) -> Option<Claim> {
        let what = format!("{place}: \"{}\"", short(&claim.text, 70));
        let mut kept = Vec::new();
        let mut reasons = Vec::new();
        for mut c in std::mem::take(&mut claim.citations).into_iter().take(MAX_CITATIONS) {
            match self.check_citation(&mut c) {
                Ok(()) => kept.push(c),
                Err(r) => reasons.push(format!("{} ({})", short(c.url.as_deref().unwrap_or(&c.title), 60), r)),
            }
        }
        if kept.is_empty() {
            self.report.claims_dropped += 1;
            let reason = if reasons.is_empty() { "no citations".to_string() } else { reasons.join("; ") };
            self.drop(what, reason);
            return None;
        }
        if kept.iter().all(|c| c.kind == CitationKind::Page && c.url.as_deref().map(is_wikipedia).unwrap_or(false)) {
            self.report.claims_dropped += 1;
            self.drop(what, "its only source is Wikipedia");
            return None;
        }
        self.report.claims_kept += 1;
        claim.citations = kept;
        Some(claim)
    }

    fn check_work(&mut self, w: &mut Work) -> Result<(), String> {
        match self.resolved.records.get(&w.record) {
            Some(Ok(Some(info))) => {
                let title_ok = if w.record.kind == RecordKind::Url {
                    // A page: its title, or its text, names the work.
                    let words: Vec<String> = tokens(&w.title);
                    let page: HashSet<String> = tokens(&format!("{} {}", info.title, info.subtitle.as_deref().unwrap_or(""))).into_iter().collect();
                    !words.is_empty() && words.iter().filter(|x| x.len() > 3).all(|x| page.contains(x))
                } else {
                    title_matches(&w.title, &info.title, info.subtitle.as_deref())
                };
                if !title_ok {
                    return Err(format!("the record is \"{}\"", short(&info.title, 60)));
                }
                if !author_matches(&w.authors, &info.authors) {
                    return Err(format!("the record's author is {}", info.authors.join(", ")));
                }
                w.resolved_url = Some(info.url.clone());
                Ok(())
            }
            Some(Ok(None)) => Err("no such record".into()),
            Some(Err(e)) => Err(format!("couldn't check the record ({e})")),
            None => Err("the record wasn't looked up".into()),
        }
    }

    fn check_item(&mut self, kind: SectionKind, mut item: Item) -> Option<Item> {
        let place = format!("{} › {}", kind.as_str(), short(&item.heading, 50));
        let claim_count = item.claims.len() + item.disagreement.as_ref().map(|d| d.sides.iter().map(|s| s.claims.len()).sum()).unwrap_or(0);
        let mut work_ok = false;
        if let Some(w) = item.work.as_mut() {
            if let Err(reason) = self.check_work(w) {
                self.report.works_dropped += 1;
                self.report.claims_dropped += claim_count as u32;
                self.drop(format!("{place} (work)"), reason);
                return None;
            }
            self.report.works_kept += 1;
            work_ok = true;
        }
        item.claims = std::mem::take(&mut item.claims).into_iter().filter_map(|c| self.check_claim(&place, c)).collect();
        if let Some(mut d) = item.disagreement.take() {
            let sides: Vec<Side> = std::mem::take(&mut d.sides)
                .into_iter()
                .filter_map(|mut s| {
                    s.claims = std::mem::take(&mut s.claims).into_iter().filter_map(|c| self.check_claim(&place, c)).collect();
                    (!s.claims.is_empty()).then_some(s)
                })
                .collect();
            if sides.len() >= 2 {
                d.sides = sides;
                item.disagreement = Some(d);
            } else {
                // The side that survived isn't shown either.
                let orphaned: u32 = sides.iter().map(|s| s.claims.len() as u32).sum();
                self.report.claims_kept -= orphaned;
                self.report.claims_dropped += orphaned;
                self.drop(format!("{place} (disagreement)"), "fewer than two sides kept a sourced claim");
            }
        }
        let has_claims = !item.claims.is_empty() || item.disagreement.is_some();
        let keep = has_claims || (kind == SectionKind::FurtherReading && work_ok);
        if !keep {
            if work_ok {
                self.report.works_kept -= 1;
                self.report.works_dropped += 1;
            }
            self.drop(place, "nothing in it could be checked");
            return None;
        }
        Some(item)
    }
}

/// Check a draft against its evidence. Lookups run up to six at a time.
pub async fn verify(draft: Draft, evidence: &Evidence, lookups: &Lookups) -> Verified {
    // What needs looking up: every record, and the pages whose quotes the run didn't already read.
    let mut records: HashSet<Record> = HashSet::new();
    let mut pages: HashSet<String> = HashSet::new();
    let note_citation = |c: &Citation, records: &mut HashSet<Record>, pages: &mut HashSet<String>| match c.kind {
        CitationKind::Record => {
            if let Some(r) = &c.record {
                records.insert(r.clone());
            }
        }
        CitationKind::Page => {
            if let (Some(u), Some(q)) = (&c.url, &c.quote) {
                let key = norm_url(u);
                let in_fetched = evidence.fetched.get(&key).map(|t| quote_found(q, &tokens(t))).unwrap_or(false);
                let in_snippet = evidence.snippets.get(&key).map(|s| s.iter().any(|s| quote_found(q, &tokens(s)))).unwrap_or(false);
                if !in_fetched && !in_snippet && url::Url::parse(u).map(|p| matches!(p.scheme(), "http" | "https")).unwrap_or(false) {
                    pages.insert(u.clone());
                }
            }
        }
    };
    for s in &draft.sections {
        for it in &s.items {
            if let Some(w) = &it.work {
                records.insert(w.record.clone());
            }
            let side_claims = it.disagreement.iter().flat_map(|d| d.sides.iter().flat_map(|s| s.claims.iter()));
            for c in it.claims.iter().chain(side_claims) {
                for cit in c.citations.iter().take(MAX_CITATIONS) {
                    note_citation(cit, &mut records, &mut pages);
                }
            }
        }
    }
    let record_results: HashMap<Record, Result<Option<RecordInfo>, String>> = stream::iter(records.into_iter()).map(|r| async move { let out = resolve_record(lookups, &r).await; (r, out) }).buffer_unordered(CONCURRENCY).collect().await;
    let page_results: HashMap<String, Result<Option<PageText>, String>> = stream::iter(pages.into_iter()).map(|u| async move { let out = lookups.page(&u).await; (u, out) }).buffer_unordered(CONCURRENCY).collect().await;
    let resolved = Resolved { records: record_results, pages: page_results };

    let mut ctx = Ctx { evidence, resolved: &resolved, page_tokens: HashMap::new(), report: Report::default() };
    let mut by_kind: HashMap<SectionKind, Vec<Item>> = HashMap::new();
    for s in draft.sections {
        for it in s.items {
            if let Some(kept) = ctx.check_item(s.kind, it) {
                by_kind.entry(s.kind).or_default().push(kept);
            }
        }
    }
    let mut sections = Vec::new();
    let mut outside_overview = 0u32;
    for kind in SectionKind::ORDER {
        if let Some(mut items) = by_kind.remove(&kind) {
            items.truncate(if kind == SectionKind::Overview { 1 } else { MAX_ITEMS });
            if kind != SectionKind::Overview {
                outside_overview += items.iter().map(|i| i.claims.len() as u32 + i.disagreement.as_ref().map(|d| d.sides.iter().map(|s| s.claims.len() as u32).sum()).unwrap_or(0)).sum::<u32>();
            }
            sections.push(Section { kind, items });
        }
    }
    let little_known = draft.little_known || outside_overview < LITTLE_KNOWN_BELOW;
    Verified { sections, little_known, report: ctx.report }
}
