//! Pictures and Wikipedia intros for the map's entities (Phase 5): free lookups, apart from the
//! briefing and its checks. For each Wikidata item: its English Wikipedia article (the intro's first
//! sentences and the article's free lead image) and its Wikidata image (P18) when the article has
//! none. Thumbnails go into the content-addressed asset store, so the app (and a phone) loads them
//! from the computer, never from Wikimedia. Results are cached per item for 30 days; an item with
//! nothing found is cached too, a failed lookup never.

use super::lookup::{html_to_text, is_qid, Fetched, Lookups};
use crate::app::App;
use crate::clock::iso_ms;
use crate::library::assets::{asset_url, sniff_image};
use crate::Result;
use futures::stream::{self, StreamExt};
use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// At most this many items in one request.
pub const MAX_IDS: usize = 40;
/// A cached entry is looked up again after this long.
const FRESH_MS: i64 = 30 * 24 * 60 * 60 * 1000;
/// Requests for one call of `media`: the item query, two Wikipedia batches, two Commons batches and
/// a thumbnail per item, with room to spare.
const LOOKUP_CAP: u32 = 60;
/// The thumbnail's width: sharp in the card (at most ~350 px wide) on a 2x screen.
const THUMB_WIDTH: u32 = 480;
const SENTENCES: u32 = 3;
const ARTIST_CHARS: usize = 80;
/// Thumbnails come from Wikimedia's media hosts and nowhere else.
const MEDIA_HOSTS: [&str; 2] = ["https://thumb.wikimedia.org/", "https://upload.wikimedia.org/"];

fn media_host(url: &str) -> bool {
    MEDIA_HOSTS.iter().any(|h| url.starts_with(h))
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    pub image: Option<MediaImage>,
    pub summary: Option<MediaSummary>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaImage {
    /// `/api/assets/<sha>.<ext>`, on the computer.
    pub url: String,
    pub width: u32,
    pub height: u32,
    pub credit: MediaCredit,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaCredit {
    /// Plain text, at most 80 characters ("Thomas Phillips").
    pub artist: Option<String>,
    /// "Public domain", "CC BY-SA 4.0", …
    pub license: Option<String>,
    /// The file's page on Wikimedia Commons.
    pub page: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSummary {
    /// The article's title.
    pub title: String,
    /// The intro's first sentences, plain text.
    pub extract: String,
    pub url: String,
}

/// A parsed `ids` list: Wikidata items, without repeats. Err for a bad id or too many.
pub fn parse_ids(raw: Option<&str>) -> std::result::Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for id in raw.unwrap_or("").split(',').map(str::trim).filter(|s| !s.is_empty()) {
        if id.len() > 12 || !is_qid(id) {
            return Err(format!("ids is a comma-separated list of Wikidata items (Q1035); “{}” isn't one.", id.chars().take(24).collect::<String>()));
        }
        if seen.insert(id.to_string()) {
            out.push(id.to_string());
        }
    }
    if out.len() > MAX_IDS {
        return Err(format!("ids has at most {MAX_IDS} items."));
    }
    Ok(out)
}

/// The media for these items: cached ones at once, the rest looked up (one request at a time, so
/// two callers never fetch the same thing twice). Items that couldn't be looked up are left out.
pub async fn media(app: &Arc<App>, qids: Vec<String>) -> Result<HashMap<String, Media>> {
    let mut out = cached(app, &qids).await?;
    if qids.iter().all(|q| out.contains_key(q)) {
        return Ok(out);
    }
    let _one_at_a_time = app.briefing.media_lock.lock().await;
    // Someone else may have just looked them up.
    out.extend(cached(app, &qids).await?);
    let missing: Vec<String> = qids.iter().filter(|q| !out.contains_key(*q)).cloned().collect();
    if missing.is_empty() {
        return Ok(out);
    }
    let lookups = Lookups::new(app.briefing.transport.clone(), LOOKUP_CAP);
    let found = look_up(app, &lookups, &missing).await;
    let now = iso_ms(app.clock.now_ms());
    let rows: Vec<(String, String)> = found.iter().filter(|(_, f)| f.complete).map(|(q, f)| (q.clone(), serde_json::to_string(&f.media).unwrap_or_default())).collect();
    if !rows.is_empty() {
        app.run(move |c| {
            for (q, data) in &rows {
                c.media_save(q, data, &now)?;
            }
            Ok(())
        })
        .await?;
    }
    for (q, f) in found {
        out.insert(q, f.media);
    }
    Ok(out)
}

/// Fresh cache entries whose picture is still on disk.
async fn cached(app: &Arc<App>, qids: &[String]) -> Result<HashMap<String, Media>> {
    let since = iso_ms(app.clock.now_ms() - FRESH_MS);
    let ids = qids.to_vec();
    let rows = app.run(move |c| c.media_cached(&ids, &since)).await?;
    let assets = app.lock().assets.clone();
    Ok(rows
        .into_iter()
        .filter_map(|(q, data)| {
            let m: Media = serde_json::from_str(&data).ok()?;
            if let Some(img) = &m.image {
                let file = img.url.strip_prefix("/api/assets/")?;
                if !assets.path(file).is_some_and(|p| p.exists()) {
                    return None;
                }
            }
            Some((q, m))
        })
        .collect())
}

struct Found {
    media: Media,
    /// Every lookup it needed answered (found or not found): safe to cache.
    complete: bool,
}

/// Commons file names: spaces, not underscores, no "File:".
fn file_name(s: &str) -> String {
    let s = percent_decode_str(s).decode_utf8_lossy().replace('_', " ");
    let s = s.trim();
    s.strip_prefix("File:").unwrap_or(s).trim().to_string()
}

/// Everything but letters, digits and `.-_~`.
const COMPONENT: &AsciiSet = &NON_ALPHANUMERIC.remove(b'.').remove(b'-').remove(b'_').remove(b'~');

fn enc(s: &str) -> String {
    utf8_percent_encode(s, COMPONENT).to_string()
}

async fn json(lookups: &Lookups, url: &str) -> std::result::Result<Value, ()> {
    match lookups.get(url).await {
        Fetched::Ok(r) => serde_json::from_slice(&r.body).map_err(|_| ()),
        Fetched::NotFound => Ok(Value::Null),
        Fetched::Failed(_) => Err(()),
    }
}

fn s<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty())
}

/// `{ normalized, redirects }` of an Action API answer, as one map from the asked title to the page's.
fn renames(q: &Value) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for key in ["normalized", "redirects"] {
        for r in q.get(key).and_then(Value::as_array).into_iter().flatten() {
            if let (Some(from), Some(to)) = (s(r, "from"), s(r, "to")) {
                map.insert(from.to_string(), to.to_string());
            }
        }
    }
    map
}

fn resolve<'a>(renames: &'a HashMap<String, String>, title: &'a str) -> &'a str {
    let mut t = title;
    // A title may be normalized, then redirected.
    for _ in 0..3 {
        match renames.get(t) {
            Some(next) if next != t => t = next,
            _ => break,
        }
    }
    t
}

/// Wikipedia's plain intro, tidied: one space between words, no empty brackets left by a removed
/// pronunciation, no space before punctuation.
pub fn tidy_extract(text: &str) -> String {
    let mut t = text.split_whitespace().collect::<Vec<_>>().join(" ");
    for (from, to) in [("( ", "("), (" )", ")"), ("(; ", "("), ("(, ", "("), (" ,", ","), (" ;", ";"), (" .", "."), ("()", "")] {
        while t.contains(from) {
            t = t.replace(from, to);
        }
    }
    t.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Where the first element styled `display: none` opens.
fn hidden_element(h: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(j) = h[from..].find('<') {
        let i = from + j;
        let tag_end = h[i..].find('>').map(|k| i + k)?;
        let tag = h[i..tag_end].to_ascii_lowercase().replace(' ', "");
        if !tag.starts_with("</") && tag.contains("display:none") {
            return Some(i);
        }
        from = tag_end;
    }
    None
}

/// The artist field is HTML: its text, at most 80 characters. A derivative's list keeps its first
/// entry, without the source file's name ("Charles_Darwin_seated.jpg: Henry Maull …"); footnote marks go.
pub fn plain_artist(html: &str) -> Option<String> {
    let mut h = html.to_string();
    if let Some(i) = h.find("<li") {
        let rest = &h[i..];
        let body = rest.find('>').map(|j| &rest[j + 1..]).unwrap_or("");
        h = body[..body.find("</li>").unwrap_or(body.len())].to_string();
    }
    while let Some(i) = h.find("<sup") {
        let end = h[i..].find("</sup>").map(|j| i + j + "</sup>".len()).unwrap_or(h.len());
        h.replace_range(i..end, "");
    }
    // Hidden copies ("Unknown author<span style=\"display: none;\">Unknown author</span>").
    while let Some(i) = hidden_element(&h) {
        let name: String = h[i + 1..].chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
        let close = format!("</{name}>");
        let end = h[i..].find(&close).map(|j| i + j + close.len()).unwrap_or(h.len());
        h.replace_range(i..end, "");
    }
    let text = html_to_text(&h).text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut text = text.trim();
    if let Some((head, tail)) = text.split_once(": ") {
        let lower = head.to_ascii_lowercase();
        if !head.contains(' ') && [".jpg", ".jpeg", ".png", ".tif", ".tiff", ".gif", ".svg", ".webp"].iter().any(|e| lower.ends_with(e)) {
            text = tail.trim();
        }
    }
    let text = text.trim_end_matches(['.', ',', ';']).trim();
    if text.is_empty() {
        return None;
    }
    Some(if text.chars().count() > ARTIST_CHARS { format!("{}…", text.chars().take(ARTIST_CHARS - 1).collect::<String>().trim_end()) } else { text.to_string() })
}

async fn look_up(app: &Arc<App>, lookups: &Lookups, qids: &[String]) -> HashMap<String, Found> {
    // 1. Wikidata: each item's image and English article.
    let values: String = qids.iter().map(|q| format!("wd:{q}")).collect::<Vec<_>>().join(" ");
    let query = format!(
        "SELECT ?item ?image ?article WHERE {{ VALUES ?item {{ {values} }} OPTIONAL {{ ?item wdt:P18 ?image }} \
         OPTIONAL {{ ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }} }}"
    );
    let Ok(v) = json(lookups, &format!("https://query.wikidata.org/sparql?format=json&query={}", enc(&query))).await else {
        return HashMap::new();
    };
    let mut p18: HashMap<String, String> = HashMap::new();
    let mut article: HashMap<String, String> = HashMap::new();
    for row in v.get("results").and_then(|r| r.get("bindings")).and_then(Value::as_array).into_iter().flatten() {
        let val = |k: &str| row.get(k).and_then(|x| x.get("value")).and_then(Value::as_str).map(str::to_string);
        let Some(qid) = val("item").and_then(|u| u.rsplit('/').next().map(str::to_string)) else { continue };
        if let Some(img) = val("image").and_then(|u| u.rsplit('/').next().map(file_name)).filter(|f| !f.is_empty()) {
            p18.entry(qid.clone()).or_insert(img);
        }
        if let Some(title) = val("article").and_then(|u| u.strip_prefix("https://en.wikipedia.org/wiki/").map(file_name)).filter(|t| !t.is_empty()) {
            article.entry(qid).or_insert(title);
        }
    }

    // 2. Wikipedia: the intro and the free lead image, 20 articles a request (the extracts' limit).
    let mut complete: HashMap<String, bool> = qids.iter().map(|q| (q.clone(), true)).collect();
    let mut summary: HashMap<String, MediaSummary> = HashMap::new();
    let mut lead: HashMap<String, String> = HashMap::new();
    let with_article: Vec<(&String, &String)> = qids.iter().filter_map(|q| article.get(q).map(|t| (q, t))).collect();
    for chunk in with_article.chunks(20) {
        let titles = chunk.iter().map(|(_, t)| t.as_str()).collect::<Vec<_>>().join("|");
        let url = format!(
            "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=extracts%7Cpageimages%7Cinfo&inprop=url&exintro=1&explaintext=1&exsentences={SENTENCES}&exlimit=20&piprop=name&pilicense=free&titles={}",
            enc(&titles)
        );
        let Ok(v) = json(lookups, &url).await else {
            for (q, _) in chunk {
                complete.insert((*q).clone(), false);
            }
            continue;
        };
        let q = v.get("query").cloned().unwrap_or(Value::Null);
        let renames = renames(&q);
        let pages: HashMap<String, &Value> =
            q.get("pages").and_then(Value::as_array).into_iter().flatten().filter(|p| p.get("missing").is_none()).filter_map(|p| Some((s(p, "title")?.to_string(), p))).collect();
        for (qid, title) in chunk {
            let Some(p) = pages.get(resolve(&renames, title)) else { continue };
            let extract = s(p, "extract").map(tidy_extract).unwrap_or_default();
            let page_url = s(p, "fullurl").map(str::to_string).unwrap_or_else(|| format!("https://en.wikipedia.org/wiki/{}", enc(&title.replace(' ', "_"))));
            if !extract.is_empty() {
                summary.insert((*qid).clone(), MediaSummary { title: s(p, "title").unwrap_or(title).to_string(), extract, url: page_url });
            }
            if let Some(f) = s(p, "pageimage").map(file_name).filter(|f| !f.is_empty()) {
                lead.insert((*qid).clone(), f);
            }
        }
    }

    // 3. Commons: a thumbnail and the credit for each candidate file (the lead image, then P18).
    let candidates: HashMap<String, Vec<String>> = qids
        .iter()
        .map(|q| {
            let mut c: Vec<String> = lead.get(q).into_iter().chain(p18.get(q)).cloned().collect();
            c.dedup();
            (q.clone(), c)
        })
        .collect();
    let mut files: Vec<String> = candidates.values().flatten().cloned().collect();
    files.sort();
    files.dedup();
    let mut info: HashMap<String, (String, u32, u32, MediaCredit)> = HashMap::new();
    let mut commons_ok = true;
    for chunk in files.chunks(50) {
        let titles = chunk.iter().map(|f| format!("File:{f}")).collect::<Vec<_>>().join("|");
        let url = format!(
            "https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=url%7Csize%7Cextmetadata&iiurlwidth={THUMB_WIDTH}&iiextmetadatafilter=Artist%7CLicenseShortName&titles={}",
            enc(&titles)
        );
        let Ok(v) = json(lookups, &url).await else {
            commons_ok = false;
            continue;
        };
        let q = v.get("query").cloned().unwrap_or(Value::Null);
        let renames = renames(&q);
        let pages: HashMap<String, &Value> = q.get("pages").and_then(Value::as_array).into_iter().flatten().filter_map(|p| Some((s(p, "title")?.to_string(), p))).collect();
        for f in chunk {
            let asked = format!("File:{f}");
            let Some(ii) = pages.get(resolve(&renames, &asked)).and_then(|p| p.get("imageinfo")).and_then(Value::as_array).and_then(|a| a.first()) else { continue };
            let Some(thumb) = s(ii, "thumburl").filter(|u| media_host(u)) else { continue };
            let meta = |k: &str| ii.get("extmetadata").and_then(|m| m.get(k)).and_then(|m| m.get("value")).and_then(Value::as_str);
            let credit = MediaCredit {
                artist: meta("Artist").and_then(plain_artist),
                license: meta("LicenseShortName").map(|l| html_to_text(l).text.split_whitespace().collect::<Vec<_>>().join(" ")).filter(|l| !l.is_empty()),
                page: s(ii, "descriptionurl").map(str::to_string).unwrap_or_else(|| format!("https://commons.wikimedia.org/wiki/File:{}", enc(&f.replace(' ', "_")))),
            };
            let w = ii.get("thumbwidth").and_then(Value::as_u64).unwrap_or(0) as u32;
            let h = ii.get("thumbheight").and_then(Value::as_u64).unwrap_or(0) as u32;
            info.insert(f.clone(), (thumb.to_string(), w, h, credit));
        }
    }

    // 4. The thumbnails, four at a time, into the asset store.
    let wanted: Vec<(String, String)> = qids.iter().filter_map(|q| candidates[q].iter().find(|f| info.contains_key(*f)).map(|f| (q.clone(), f.clone()))).collect();
    let assets = app.lock().assets.clone();
    // `None`: nothing to show, for good (an SVG answer, a page, a 404); `Some(Err)`: ask again next time.
    type Got = Option<std::result::Result<String, ()>>;
    let fetched: Vec<(String, String, Got)> = stream::iter(wanted.into_iter().map(|(q, f)| {
        let thumb = info[&f].0.clone();
        let assets = assets.clone();
        async move {
            let got: Got = match lookups.get(&thumb).await {
                Fetched::Ok(r) if !r.truncated && matches!(sniff_image(&r.body), Some("jpg" | "png" | "webp" | "gif")) => assets.put(&r.body).map(Ok),
                Fetched::Ok(_) | Fetched::NotFound => None,
                Fetched::Failed(_) => Some(Err(())),
            };
            (q, f, got)
        }
    }))
    .buffer_unordered(4)
    .collect()
    .await;

    let mut image: HashMap<String, MediaImage> = HashMap::new();
    for (q, f, got) in fetched {
        match got {
            Some(Ok(file)) => {
                let (_, w, h, credit) = info[&f].clone();
                image.insert(q, MediaImage { url: asset_url(&file), width: w, height: h, credit });
            }
            Some(Err(())) => {
                complete.insert(q, false);
            }
            None => {}
        }
    }
    if !commons_ok {
        // An item with a file the credits couldn't be read for: ask again next time.
        for (q, c) in &candidates {
            if !c.is_empty() && !image.contains_key(q) {
                complete.insert(q.clone(), false);
            }
        }
    }

    qids.iter().map(|q| (q.clone(), Found { media: Media { image: image.remove(q), summary: summary.remove(q) }, complete: complete[q] })).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids() {
        assert_eq!(parse_ids(Some("Q1035, Q5333,Q1035,,")).unwrap(), vec!["Q1035", "Q5333"]);
        assert_eq!(parse_ids(None).unwrap(), Vec::<String>::new());
        assert!(parse_ids(Some("Q1035,P18")).is_err());
        assert!(parse_ids(Some("Q1234567890123")).is_err());
        let many = (1..=41).map(|i| format!("Q{i}")).collect::<Vec<_>>().join(",");
        assert!(parse_ids(Some(&many)).is_err());
    }

    #[test]
    fn names_and_text() {
        assert_eq!(file_name("Charles%20Darwin_seated_crop.jpg"), "Charles Darwin seated crop.jpg");
        assert_eq!(file_name("File:Down_House.jpg"), "Down House.jpg");
        assert_eq!(tidy_extract("Charles Robert Darwin  ( DAR-win; 12 February 1809 – 19 April 1882) was an English naturalist ."), "Charles Robert Darwin (DAR-win; 12 February 1809 – 19 April 1882) was an English naturalist.");
        assert_eq!(tidy_extract("Thomas Robert Malthus () was an English economist"), "Thomas Robert Malthus was an English economist");
        assert_eq!(plain_artist("<bdi><a href=\"https://www.wikidata.org/wiki/Q1\">John Linnell</a>\n</bdi>").as_deref(), Some("John Linnell"));
        assert_eq!(plain_artist("<span>  </span>"), None);
        let derivative = "<ul><li><a href=\"//commons.wikimedia.org/wiki/File:Charles_Darwin_seated.jpg\">Charles_Darwin_seated.jpg</a>: <a href=\"https://en.wikipedia.org/wiki/Henry_Maull\">Henry Maull</a> (1829–1914) and <a href=\"x\">John Fox</a> (1832–1907) (Maull &amp; Fox) <sup id=\"cite_ref-3\" class=\"reference\"><a href=\"#cite_note-3\"><span>[</span>3<span>]</span></a></sup></li>\n<li>derivative work: <a href=\"x\">Bea</a><b>o</b></li></ul>";
        assert_eq!(plain_artist(derivative).as_deref(), Some("Henry Maull (1829–1914) and John Fox (1832–1907) (Maull & Fox)"));
        assert_eq!(plain_artist("John Murray, Publisher").as_deref(), Some("John Murray, Publisher"));
        assert_eq!(plain_artist("Unknown author<span style=\"display: none;\">Unknown author</span>").as_deref(), Some("Unknown author"));
        assert_eq!(plain_artist("<span style=\"display:none\">x</span>Ann <b>Lee</b>").as_deref(), Some("Ann Lee"));
        assert!(media_host("https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6d/Down_House.jpg/500px-Down_House.jpg"));
        assert!(!media_host("https://example.org/Down_House.jpg") && !media_host("http://upload.wikimedia.org/x.jpg"));
        assert_eq!(plain_artist(&"x".repeat(200)).unwrap().chars().count(), 80);
    }
}
