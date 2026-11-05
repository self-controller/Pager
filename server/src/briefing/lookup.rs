//! Catalogue lookups (Open Library, Crossref, Wikidata) and page fetches, through the Transport.
//! Each run has its own `Lookups`: answers are cached for the run and the number of requests is capped.

use super::transport::{OutError, OutRequest, OutResponse, Transport};
use crate::util::soup::{Doc, NodeId, NodeKind};
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const LOOKUP_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_BODY: usize = 3 * 1024 * 1024;

#[derive(Clone, Debug)]
pub enum Fetched {
    Ok(OutResponse),
    /// 404 or 410: the record or page doesn't exist.
    NotFound,
    /// Couldn't be checked (network, a 5xx, the cap).
    Failed(String),
}

/// A catalogue record, as much as the verifier needs to match it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordInfo {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    pub authors: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<String>,
    /// A page a reader can open.
    pub url: String,
}

/// A page's text, for quote checks.
#[derive(Clone, Debug)]
pub struct PageText {
    pub title: Option<String>,
    pub text: String,
}

pub struct Lookups {
    transport: Arc<dyn Transport>,
    /// The wait before asking again after a 429 or 503.
    pub retry_delay: Duration,
    cache: Mutex<HashMap<String, Fetched>>,
    count: AtomicU32,
    cap: u32,
}

/// Everything but letters, digits and `.-_~` (so a DOI stays readable: 10.1093%2Fmind%2Flix.236.433).
const COMPONENT: &AsciiSet = &NON_ALPHANUMERIC.remove(b'.').remove(b'-').remove(b'_').remove(b'~');

fn enc(s: &str) -> String {
    utf8_percent_encode(s, COMPONENT).to_string()
}

fn str_at<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty())
}

fn year_in(s: &str) -> Option<String> {
    let digits: Vec<char> = s.chars().collect();
    digits.windows(4).find(|w| w.iter().all(|c| c.is_ascii_digit())).map(|w| w.iter().collect())
}

impl Lookups {
    pub fn new(transport: Arc<dyn Transport>, cap: u32) -> Lookups {
        Lookups { transport, retry_delay: Duration::from_secs(2), cache: Mutex::new(HashMap::new()), count: AtomicU32::new(0), cap }
    }

    /// Requests made so far (cache hits don't count).
    pub fn used(&self) -> u32 {
        self.count.load(Ordering::SeqCst).min(self.cap)
    }

    pub async fn get(&self, url: &str) -> Fetched {
        if let Some(hit) = self.cache.lock().unwrap().get(url) {
            return hit.clone();
        }
        if self.count.fetch_add(1, Ordering::SeqCst) >= self.cap {
            return Fetched::Failed("the run's lookup limit was reached".into());
        }
        let req = OutRequest::get(url, LOOKUP_TIMEOUT, MAX_BODY).header("accept", "application/json, text/html;q=0.9, text/plain;q=0.8, */*;q=0.1");
        let mut answer = self.transport.send(req.clone()).await;
        // Wikidata and Crossref throttle bursts: wait a moment and ask once more.
        if matches!(&answer, Ok(r) if r.status == 429 || r.status == 503) && !self.retry_delay.is_zero() {
            tokio::time::sleep(self.retry_delay).await;
            answer = self.transport.send(req).await;
        }
        let out = match answer {
            Ok(r) if (200..300).contains(&r.status) => Fetched::Ok(r),
            Ok(r) if r.status == 404 || r.status == 410 => Fetched::NotFound,
            Ok(r) => Fetched::Failed(format!("HTTP {}", r.status)),
            Err(OutError::Refused) => Fetched::Failed("outbound requests are off".into()),
            Err(e) => Fetched::Failed(e.to_string()),
        };
        self.cache.lock().unwrap().insert(url.to_string(), out.clone());
        out
    }

    async fn json(&self, url: &str) -> Result<Option<Value>, String> {
        match self.get(url).await {
            Fetched::Ok(r) => serde_json::from_slice(&r.body).map(Some).map_err(|_| "the answer wasn't JSON".to_string()),
            Fetched::NotFound => Ok(None),
            Fetched::Failed(m) => Err(m),
        }
    }

    // ---- Open Library ----

    /// `find_book`: Open Library's search, up to `limit` works.
    pub async fn find_book(&self, title: &str, author: Option<&str>, limit: usize) -> Result<Vec<Value>, String> {
        let mut url = format!("https://openlibrary.org/search.json?title={}&limit={limit}&fields=key,title,subtitle,author_name,first_publish_year,isbn,edition_count", enc(title));
        if let Some(a) = author.filter(|a| !a.trim().is_empty()) {
            url.push_str(&format!("&author={}", enc(a)));
        }
        let v = self.json(&url).await?.unwrap_or(Value::Null);
        let docs = v.get("docs").and_then(Value::as_array).cloned().unwrap_or_default();
        Ok(docs
            .iter()
            .take(limit)
            .map(|d| {
                let key = str_at(d, "key").unwrap_or("");
                let olid = key.rsplit('/').next().unwrap_or("").to_string();
                let isbns: Vec<Value> = d.get("isbn").and_then(Value::as_array).map(|a| a.iter().take(3).cloned().collect()).unwrap_or_default();
                serde_json::json!({
                    "olid": olid,
                    "title": str_at(d, "title"),
                    "subtitle": str_at(d, "subtitle"),
                    "authors": d.get("author_name").cloned().unwrap_or(Value::Array(vec![])),
                    "firstPublishYear": d.get("first_publish_year").cloned().unwrap_or(Value::Null),
                    "editionCount": d.get("edition_count").cloned().unwrap_or(Value::Null),
                    "isbns": isbns,
                    "url": format!("https://openlibrary.org{key}"),
                })
            })
            .collect())
    }

    async fn ol_author_names(&self, keys: &[String]) -> Vec<String> {
        let mut out = Vec::new();
        for k in keys.iter().take(2) {
            if let Ok(Some(a)) = self.json(&format!("https://openlibrary.org{k}.json")).await {
                if let Some(n) = str_at(&a, "name").or_else(|| str_at(&a, "personal_name")) {
                    out.push(n.to_string());
                }
            }
        }
        out
    }

    fn author_keys(v: &Value) -> Vec<String> {
        v.get("authors")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|x| x.get("key").or_else(|| x.get("author").and_then(|y| y.get("key"))).and_then(Value::as_str).map(str::to_string)).collect())
            .unwrap_or_default()
    }

    /// An edition by ISBN (`/isbn/<isbn>.json`), with its authors from the edition or its work.
    pub async fn ol_isbn(&self, isbn: &str) -> Result<Option<RecordInfo>, String> {
        let Some(ed) = self.json(&format!("https://openlibrary.org/isbn/{isbn}.json")).await? else { return Ok(None) };
        let mut keys = Self::author_keys(&ed);
        if keys.is_empty() {
            if let Some(w) = ed.get("works").and_then(Value::as_array).and_then(|a| a.first()).and_then(|w| w.get("key")).and_then(Value::as_str) {
                if let Ok(Some(work)) = self.json(&format!("https://openlibrary.org{w}.json")).await {
                    keys = Self::author_keys(&work);
                }
            }
        }
        let authors = self.ol_author_names(&keys).await;
        Ok(str_at(&ed, "title").map(|t| RecordInfo {
            title: t.to_string(),
            subtitle: str_at(&ed, "subtitle").map(str::to_string),
            authors,
            year: str_at(&ed, "publish_date").and_then(year_in),
            url: format!("https://openlibrary.org/isbn/{isbn}"),
        }))
    }

    /// A work (OL…W), an edition (OL…M) or an author (OL…A).
    pub async fn ol_id(&self, olid: &str) -> Result<Option<RecordInfo>, String> {
        let kind = match olid.chars().last() {
            Some('W') => "works",
            Some('M') => "books",
            Some('A') => "authors",
            _ => return Ok(None),
        };
        let Some(v) = self.json(&format!("https://openlibrary.org/{kind}/{olid}.json")).await? else { return Ok(None) };
        let url = format!("https://openlibrary.org/{kind}/{olid}");
        if kind == "authors" {
            return Ok(str_at(&v, "name").map(|n| RecordInfo { title: n.to_string(), subtitle: None, authors: vec![], year: None, url }));
        }
        let authors = self.ol_author_names(&Self::author_keys(&v)).await;
        Ok(str_at(&v, "title").map(|t| RecordInfo {
            title: t.to_string(),
            subtitle: str_at(&v, "subtitle").map(str::to_string),
            authors,
            year: str_at(&v, "first_publish_date").or_else(|| str_at(&v, "publish_date")).and_then(year_in),
            url,
        }))
    }

    // ---- Crossref ----

    fn crossref_record(m: &Value) -> Option<RecordInfo> {
        let first = |k: &str| m.get(k).and_then(Value::as_array).and_then(|a| a.first()).and_then(Value::as_str).map(str::to_string);
        let title = first("title")?;
        let authors = m
            .get("author")
            .and_then(Value::as_array)
            .map(|a| a.iter().map(|p| format!("{} {}", str_at(p, "given").unwrap_or(""), str_at(p, "family").or_else(|| str_at(p, "name")).unwrap_or("")).trim().to_string()).collect())
            .unwrap_or_default();
        let year = m.get("issued").and_then(|i| i.get("date-parts")).and_then(|d| d.get(0)).and_then(|d| d.get(0)).and_then(Value::as_i64).map(|y| y.to_string());
        let doi = str_at(m, "DOI")?.to_string();
        Some(RecordInfo { title, subtitle: first("subtitle"), authors, year, url: format!("https://doi.org/{doi}") })
    }

    pub async fn crossref_doi(&self, doi: &str) -> Result<Option<RecordInfo>, String> {
        let Some(v) = self.json(&format!("https://api.crossref.org/works/{}", enc(doi))).await? else { return Ok(None) };
        Ok(v.get("message").and_then(Self::crossref_record))
    }

    /// `find_article`: Crossref's bibliographic search.
    pub async fn find_article(&self, query: &str, limit: usize) -> Result<Vec<Value>, String> {
        let url = format!("https://api.crossref.org/works?query.bibliographic={}&rows={limit}&select=DOI,title,subtitle,author,issued,container-title,type", enc(query));
        let v = self.json(&url).await?.unwrap_or(Value::Null);
        let items = v.get("message").and_then(|m| m.get("items")).and_then(Value::as_array).cloned().unwrap_or_default();
        Ok(items
            .iter()
            .filter_map(|m| {
                let r = Self::crossref_record(m)?;
                let container = m.get("container-title").and_then(Value::as_array).and_then(|a| a.first()).cloned().unwrap_or(Value::Null);
                Some(serde_json::json!({
                    "doi": str_at(m, "DOI"), "title": r.title, "subtitle": r.subtitle, "authors": r.authors, "year": r.year,
                    "container": container, "type": str_at(m, "type"), "url": r.url,
                }))
            })
            .collect())
    }

    // ---- Wikidata ----

    pub async fn wikidata_search(&self, name: &str, limit: usize) -> Result<Vec<Value>, String> {
        let url = format!("https://www.wikidata.org/w/api.php?action=wbsearchentities&search={}&language=en&limit={limit}&format=json", enc(name));
        let v = self.json(&url).await?.unwrap_or(Value::Null);
        Ok(v.get("search")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|e| {
                        let id = str_at(e, "id")?;
                        Some(serde_json::json!({ "wikidata": id, "label": str_at(e, "label"), "description": str_at(e, "description"), "url": format!("https://www.wikidata.org/wiki/{id}") }))
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    pub async fn wikidata_entity(&self, qid: &str) -> Result<Option<RecordInfo>, String> {
        let url = format!("https://www.wikidata.org/w/api.php?action=wbgetentities&ids={}&props=labels|descriptions&languages=en&format=json", enc(qid));
        let Some(v) = self.json(&url).await? else { return Ok(None) };
        let e = v.get("entities").and_then(|e| e.get(qid));
        let Some(e) = e.filter(|e| e.get("missing").is_none()) else { return Ok(None) };
        let label = e.get("labels").and_then(|l| l.get("en")).and_then(|l| l.get("value")).and_then(Value::as_str);
        let desc = e.get("descriptions").and_then(|l| l.get("en")).and_then(|l| l.get("value")).and_then(Value::as_str);
        Ok(label.map(|l| RecordInfo { title: l.to_string(), subtitle: desc.map(str::to_string), authors: vec![], year: None, url: format!("https://www.wikidata.org/wiki/{qid}") }))
    }

    /// Labels, descriptions, dates and coordinates for many Wikidata items in one SPARQL query.
    /// An item with several values keeps the earliest date.
    pub async fn wikidata_facts(&self, qids: &[String]) -> Result<HashMap<String, WikiFacts>, String> {
        let ids: Vec<&String> = qids.iter().filter(|q| is_qid(q)).take(80).collect();
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        let values: String = ids.iter().map(|q| format!("wd:{q}")).collect::<Vec<_>>().join(" ");
        let query = format!(
            "SELECT ?item ?label ?alias ?desc ?born ?died ?inception ?published ?start ?end ?when ?dissolved ?coord WHERE {{ VALUES ?item {{ {values} }} \
             OPTIONAL {{ ?item rdfs:label ?label FILTER(LANG(?label) = \"en\") }} OPTIONAL {{ ?item skos:altLabel ?alias FILTER(LANG(?alias) = \"en\") }} OPTIONAL {{ ?item schema:description ?desc FILTER(LANG(?desc) = \"en\") }} \
             OPTIONAL {{ ?item wdt:P569 ?born }} OPTIONAL {{ ?item wdt:P570 ?died }} OPTIONAL {{ ?item wdt:P571 ?inception }} OPTIONAL {{ ?item wdt:P577 ?published }} \
             OPTIONAL {{ ?item wdt:P580 ?start }} OPTIONAL {{ ?item wdt:P582 ?end }} OPTIONAL {{ ?item wdt:P585 ?when }} OPTIONAL {{ ?item wdt:P576 ?dissolved }} \
             OPTIONAL {{ ?item wdt:P625 ?coord }} }}"
        );
        let url = format!("https://query.wikidata.org/sparql?format=json&query={}", enc(&query));
        let v = self.json(&url).await?.unwrap_or(Value::Null);
        let rows = v.get("results").and_then(|r| r.get("bindings")).and_then(Value::as_array).cloned().unwrap_or_default();
        // Rows are a cross product of the optional values: keep each field's earliest year.
        const FIELDS: [&str; 8] = ["born", "published", "when", "start", "inception", "died", "end", "dissolved"];
        let mut years: HashMap<String, HashMap<&str, i64>> = HashMap::new();
        let mut out: HashMap<String, WikiFacts> = HashMap::new();
        for row in rows {
            let val = |k: &str| row.get(k).and_then(|x| x.get("value")).and_then(Value::as_str).map(str::to_string);
            let Some(qid) = val("item").and_then(|u| u.rsplit('/').next().map(str::to_string)) else { continue };
            let f = out.entry(qid.clone()).or_insert_with(|| WikiFacts { url: format!("https://www.wikidata.org/wiki/{qid}"), ..WikiFacts::default() });
            if f.label.is_none() {
                f.label = val("label");
            }
            if let Some(a) = val("alias") {
                if !f.aliases.contains(&a) && f.aliases.len() < 20 {
                    f.aliases.push(a);
                }
            }
            if f.description.is_none() {
                f.description = val("desc");
            }
            if f.coordinates.is_none() {
                f.coordinates = val("coord").and_then(|p| parse_point(&p));
            }
            let ys = years.entry(qid).or_default();
            for k in FIELDS {
                if let Some(y) = val(k).as_deref().and_then(year_of).and_then(|y| y.parse::<i64>().ok()) {
                    let e = ys.entry(k).or_insert(y);
                    *e = (*e).min(y);
                }
            }
        }
        for (qid, f) in out.iter_mut() {
            let ys = years.get(qid);
            let first = |keys: &[&str]| keys.iter().find_map(|k| ys.and_then(|y| y.get(k)).map(|n| n.to_string()));
            // A person's life; a work's publication; an event's date or span; an organisation's founding.
            f.start = first(&["born", "published", "when", "start", "inception"]);
            f.end = first(&["died", "end", "dissolved"]);
        }
        Ok(out)
    }

    // ---- Pages ----

    /// A page's text (HTML or plain text). None for a missing page or one that isn't text (a PDF).
    /// Only public http(s) addresses: a cited URL comes from the model, and through it from web
    /// pages, so it must not reach this computer or its network.
    pub async fn page(&self, url: &str) -> Result<Option<PageText>, String> {
        if !public_url(url) {
            return Err("not a public web address".into());
        }
        match self.get(url).await {
            Fetched::Ok(r) => {
                let ct = r.content_type.to_ascii_lowercase();
                let text = crate::ingest::decode::decode_text(&r.body).0;
                if ct.contains("html") || (ct.is_empty() && text.trim_start().starts_with('<')) {
                    Ok(Some(html_to_text(&text)))
                } else if ct.starts_with("text/") || ct.contains("json") || ct.contains("xml") {
                    Ok(Some(PageText { title: None, text }))
                } else {
                    Ok(None)
                }
            }
            Fetched::NotFound => Ok(None),
            Fetched::Failed(m) => Err(m),
        }
    }
}

const SKIP: &[&str] = &["script", "style", "noscript", "template", "svg", "iframe", "object", "head", "button", "select", "textarea"];
const INLINE: &[&str] = &["a", "em", "i", "b", "strong", "span", "sup", "sub", "small", "abbr", "cite", "q", "u", "s", "mark", "code", "font", "dfn", "var", "bdi", "bdo", "time"];

/// The visible text of an HTML page, a space at every block boundary, and its <title>.
pub fn html_to_text(html: &str) -> PageText {
    let doc = Doc::parse_html(html);
    let title = doc.find_all(&|d, id| d.local_name(id) == "title").into_iter().next().map(|t| doc.raw_text(t).split_whitespace().collect::<Vec<_>>().join(" ")).filter(|t| !t.is_empty());
    let mut out = String::with_capacity(html.len() / 3);
    for &r in &doc.roots {
        walk(&doc, r, &mut out);
    }
    PageText { title, text: out }
}

fn walk(doc: &Doc, id: NodeId, out: &mut String) {
    match &doc.nodes[id].kind {
        NodeKind::Text(t) => out.push_str(t),
        NodeKind::Element { .. } => {
            let name = doc.local_name(id);
            if SKIP.contains(&name.as_str()) {
                return;
            }
            let block = !INLINE.contains(&name.as_str());
            if block {
                out.push(' ');
            }
            for &c in doc.children(id) {
                walk(doc, c, out);
            }
            if block {
                out.push(' ');
            }
        }
    }
}

/// An http(s) URL whose host is a public name or address: not localhost, a loopback, private,
/// link-local or unspecified IP, or a local-only name (.local, .internal, .lan, .home.arpa).
pub fn public_url(u: &str) -> bool {
    let Ok(p) = url::Url::parse(u) else { return false };
    if !matches!(p.scheme(), "http" | "https") || !p.username().is_empty() || p.password().is_some() {
        return false;
    }
    match p.host() {
        Some(url::Host::Domain(d)) => {
            let d = d.trim_end_matches('.').to_ascii_lowercase();
            d.contains('.') && !["localhost", ".local", ".internal", ".lan", ".home.arpa", ".localhost"].iter().any(|s| d == s.trim_start_matches('.') || d.ends_with(s))
        }
        Some(url::Host::Ipv4(ip)) => !(ip.is_loopback() || ip.is_private() || ip.is_link_local() || ip.is_unspecified() || ip.is_broadcast() || ip.octets()[0] == 100 && (ip.octets()[1] & 0xc0) == 64),
        Some(url::Host::Ipv6(ip)) => !(ip.is_loopback() || ip.is_unspecified() || (ip.segments()[0] & 0xfe00) == 0xfc00 || (ip.segments()[0] & 0xffc0) == 0xfe80),
        None => false,
    }
}

/// What Wikidata says about an item, for the verifier's entities.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WikiFacts {
    pub label: Option<String>,
    /// Other names ("Fanny Burney" for Frances Burney).
    pub aliases: Vec<String>,
    pub description: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub coordinates: Option<[f64; 2]>,
    pub url: String,
}

pub fn is_qid(q: &str) -> bool {
    q.len() > 1 && q.starts_with('Q') && q[1..].chars().all(|c| c.is_ascii_digit())
}

/// The year of an xsd:dateTime ("1809-02-12T00:00:00Z" → "1809", "-0427-01-01T…" → "-427").
fn year_of(d: &str) -> Option<String> {
    let (neg, rest) = match d.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, d.strip_prefix('+').unwrap_or(d)),
    };
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    let n: i64 = digits.parse().ok()?;
    Some(if neg { format!("-{n}") } else { n.to_string() })
}

/// "Point(lon lat)" → [lat, lon].
fn parse_point(p: &str) -> Option<[f64; 2]> {
    let inner = p.trim().strip_prefix("Point(")?.strip_suffix(')')?;
    let mut it = inner.split_whitespace();
    let lon: f64 = it.next()?.parse().ok()?;
    let lat: f64 = it.next()?.parse().ok()?;
    ((-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon)).then_some([lat, lon])
}

/// ISBN-10 or ISBN-13 with a valid check digit; returns the bare digits.
pub fn valid_isbn(raw: &str) -> Option<String> {
    let s: String = raw.trim().trim_start_matches("urn:isbn:").chars().filter(|c| !matches!(c, '-' | ' ')).collect::<String>().to_ascii_uppercase();
    let b = s.as_bytes();
    match b.len() {
        10 => {
            let mut sum = 0u32;
            for (i, &c) in b.iter().enumerate() {
                let v = match c {
                    b'0'..=b'9' => (c - b'0') as u32,
                    b'X' if i == 9 => 10,
                    _ => return None,
                };
                sum += v * (10 - i as u32);
            }
            (sum % 11 == 0).then_some(s)
        }
        13 => {
            if !b.iter().all(u8::is_ascii_digit) {
                return None;
            }
            let sum: u32 = b.iter().enumerate().map(|(i, &c)| (c - b'0') as u32 * if i % 2 == 0 { 1 } else { 3 }).sum();
            (sum % 10 == 0).then_some(s)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isbn_check_digits() {
        assert_eq!(valid_isbn("978-0-14-043912-0").as_deref(), Some("9780140439120"));
        assert_eq!(valid_isbn("0-14-043912-X"), None);
        assert_eq!(valid_isbn("0140439129").as_deref(), Some("0140439129"));
        assert_eq!(valid_isbn("9780140439129"), None);
        assert_eq!(valid_isbn("12345"), None);
    }

    #[test]
    fn wikidata_values() {
        assert_eq!(year_of("1809-02-12T00:00:00Z").as_deref(), Some("1809"));
        assert_eq!(year_of("-0427-01-01T00:00:00Z").as_deref(), Some("-427"));
        assert_eq!(parse_point("Point(-0.1275 51.5072)"), Some([51.5072, -0.1275]));
        assert_eq!(parse_point("nonsense"), None);
        assert!(is_qid("Q1035") && !is_qid("Q") && !is_qid("P569"));
    }

    #[test]
    fn only_public_addresses_are_fetched() {
        assert!(public_url("https://plato.stanford.edu/entries/darwinism/"));
        assert!(public_url("http://93.184.216.34/page"));
        for u in ["http://localhost:3006/api/export", "http://127.0.0.1/x", "http://10.0.0.5/", "http://192.168.1.1/admin", "http://[::1]/", "http://printer.local/", "http://100.101.102.103/", "file:///etc/passwd", "http://intranet/", "https://user:pw@example.org/"] {
            assert!(!public_url(u), "{u}");
        }
    }

    #[test]
    fn html_text_keeps_block_boundaries() {
        let p = html_to_text("<html><head><title>On Darwin</title><style>p{}</style></head><body><p>One<em>two</em></p><p>Three</p><script>x()</script></body></html>");
        assert_eq!(p.title.as_deref(), Some("On Darwin"));
        assert_eq!(p.text.split_whitespace().collect::<Vec<_>>(), vec!["Onetwo", "Three"]);
    }
}
