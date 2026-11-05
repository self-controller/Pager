//! Matching quotes against pages and titles against catalogue records, forgiving typography
//! (case, punctuation, curly quotes, dashes, spacing, ligatures) and nothing else.

use std::collections::HashSet;
use unicode_normalization::UnicodeNormalization;

/// Words of `s`: NFKC, lower case, split on anything that isn't a letter or a digit.
pub fn tokens(s: &str) -> Vec<String> {
    let norm: String = s.nfkc().collect::<String>().to_lowercase();
    norm.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_string).collect()
}

/// The shortest and longest quote the verifier accepts, in words.
pub const QUOTE_MIN_WORDS: usize = 6;
pub const QUOTE_MAX_WORDS: usize = 60;

/// Is the quote on the page? Ellipses split a quote into parts; each part of three words or more
/// must be found, in order, and the parts together must be 6–60 words. A part matches exactly, or
/// with at least 90% of its words in one stretch of the page (a dropped "the", a changed word).
pub fn quote_found(quote: &str, page: &[String]) -> bool {
    let parts: Vec<Vec<String>> = split_ellipses(quote).iter().map(|p| tokens(p)).filter(|t| t.len() >= 3).collect();
    let total: usize = parts.iter().map(Vec::len).sum();
    if parts.is_empty() || !(QUOTE_MIN_WORDS..=QUOTE_MAX_WORDS).contains(&total) {
        return false;
    }
    let mut from = 0;
    for part in &parts {
        match find_part(part, page, from) {
            Some(end) => from = end,
            None => return false,
        }
    }
    true
}

/// Word count of a quote as the verifier counts it.
pub fn quote_words(quote: &str) -> usize {
    split_ellipses(quote).iter().map(|p| tokens(p)).filter(|t| t.len() >= 3).map(|t| t.len()).sum()
}

fn split_ellipses(q: &str) -> Vec<String> {
    q.replace('…', "...").split("...").map(str::to_string).collect()
}

/// Where the part ends in `page` (at or after `from`), if it is there.
fn find_part(part: &[String], page: &[String], from: usize) -> Option<usize> {
    let n = part.len();
    if page.len() < from + 1 {
        return None;
    }
    // Exact.
    let mut i = from;
    while i + n <= page.len() {
        if page[i] == part[0] && page[i..i + n] == *part {
            return Some(i + n);
        }
        i += 1;
    }
    // Near: anchor on any of three word pairs (start, middle, end), then compare a window.
    let need = (n * 9).div_ceil(10);
    let anchors: Vec<usize> = [0, n / 2, n.saturating_sub(2)].into_iter().filter(|&a| a + 1 < n).collect::<HashSet<_>>().into_iter().collect();
    for (pos, w) in page.windows(2).enumerate().skip(from) {
        for &a in &anchors {
            if w[0] == part[a] && w[1] == part[a + 1] {
                let start = pos.saturating_sub(a + 2).max(from);
                let end = (pos + (n - a) + 2).min(page.len());
                if lcs(part, &page[start..end]) >= need {
                    return Some(end);
                }
            }
        }
    }
    None
}

fn lcs(a: &[String], b: &[String]) -> usize {
    let mut prev = vec![0usize; b.len() + 1];
    let mut cur = vec![0usize; b.len() + 1];
    for x in a {
        for (j, y) in b.iter().enumerate() {
            cur[j + 1] = if x == y { prev[j] + 1 } else { cur[j].max(prev[j + 1]) };
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

const ARTICLES: &[&str] = &["the", "a", "an", "le", "la", "les", "der", "die", "das", "el", "il", "lo"];

/// Title words that carry meaning: the main title (before a colon or a dash), without a leading article.
fn title_words(t: &str) -> Vec<String> {
    let main = t.split([':', '—', '–']).next().unwrap_or(t);
    let mut w = tokens(main);
    if w.len() > 1 && ARTICLES.contains(&w[0].as_str()) {
        w.remove(0);
    }
    w
}

/// Does the claimed title name the record's work? Every word of the claimed main title appears in
/// the record's title (with its subtitle), or the two main titles share most of their words.
pub fn title_matches(claimed: &str, record_title: &str, record_subtitle: Option<&str>) -> bool {
    let c = title_words(claimed);
    if c.is_empty() {
        return false;
    }
    let full: HashSet<String> = tokens(&format!("{record_title} {}", record_subtitle.unwrap_or(""))).into_iter().collect();
    if c.iter().all(|w| full.contains(w)) {
        return true;
    }
    let r: HashSet<String> = title_words(record_title).into_iter().collect();
    let cs: HashSet<String> = c.into_iter().collect();
    let inter = cs.intersection(&r).count() as f64;
    let union = cs.union(&r).count() as f64;
    union > 0.0 && inter / union >= 0.6
}

/// A person's surname: "Darwin, Charles" → darwin; "Charles Robert Darwin" → darwin.
fn surname(name: &str) -> Option<String> {
    let n = name.trim();
    let part = if let Some((last, _)) = n.split_once(',') { last } else { n.split_whitespace().last().unwrap_or("") };
    tokens(part).into_iter().last()
}

/// Does any claimed author share a surname with the record's authors? True when either side names none.
pub fn author_matches(claimed: &[String], record: &[String]) -> bool {
    if claimed.is_empty() || record.is_empty() {
        return true;
    }
    let names: HashSet<String> = record.iter().flat_map(|a| tokens(a)).collect();
    claimed.iter().filter_map(|a| surname(a)).any(|s| names.contains(&s))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(s: &str) -> Vec<String> {
        tokens(s)
    }

    #[test]
    fn quotes_match_through_typography() {
        let p = page("In October 1838, that is, fifteen months after I had begun my systematic inquiry, I happened to read for amusement “Malthus on Population”.");
        assert!(quote_found("I happened to read for amusement \"Malthus on Population\"", &p));
        assert!(quote_found("fifteen months after I had begun my systematic inquiry", &p));
        assert!(!quote_found("I happened to read with great care Malthus", &p));
        assert!(!quote_found("read for amusement", &p), "too short");
    }

    #[test]
    fn near_quotes_and_ellipses() {
        let p = page("The struggle for existence inevitably follows from the high rate at which all organic beings tend to increase.");
        assert!(quote_found("The struggle for existence follows from the high rate at which all organic beings tend to increase", &p));
        assert!(quote_found("The struggle for existence inevitably follows … all organic beings tend to increase", &p));
        assert!(!quote_found("The struggle for survival is caused by the low rate of decrease in organic beings", &p));
    }

    #[test]
    fn titles_and_authors() {
        assert!(title_matches("The Origin of Species", "On the origin of species by means of natural selection", None));
        assert!(title_matches("Principles of Geology", "Principles of geology", Some("being an attempt to explain")));
        assert!(!title_matches("Principles of Geology", "The Voyage of the Beagle", None));
        assert!(author_matches(&["Charles Lyell".into()], &["Lyell, Charles, Sir".into()]));
        assert!(!author_matches(&["Charles Lyell".into()], &["Alfred Russel Wallace".into()]));
    }
}
