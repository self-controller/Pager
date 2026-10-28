//! Text normalisation with an offset map back to the original: quotes, dashes, diacritics, invisible
//! characters, whitespace and case are folded so that typographic edits ("—" for "--", curly for
//! straight quotes) don't break an anchor. Everything is in UTF-16 units.

use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Debug, Default)]
pub struct Normalised {
    pub norm: Vec<u16>,
    /// map[i] = index in the original of the char that produced norm[i]
    pub map: Vec<usize>,
    /// orig_len[i] = length (UTF-16 units) of that original char
    pub orig_len: Vec<usize>,
}

fn is_invisible(c: char) -> bool {
    matches!(c, '\u{ad}' | '\u{200b}' | '\u{200c}' | '\u{200d}' | '\u{feff}')
}

fn is_single_quote(c: char) -> bool {
    matches!(c, '‘' | '’' | '‚' | '‛' | '′' | '`' | '´')
}

fn is_double_quote(c: char) -> bool {
    matches!(c, '“' | '”' | '„' | '‟' | '″' | '«' | '»')
}

fn is_dash(c: char) -> bool {
    matches!(c, '‐' | '‑' | '‒' | '–' | '—' | '―' | '−' | '⸺' | '⸻')
}

pub fn normalise(s: &[u16]) -> Normalised {
    let mut out = Normalised::default();
    let mut i = 0;
    let mut buf = [0u16; 2];
    for ch in char::decode_utf16(s.iter().copied()) {
        let ch = ch.unwrap_or('\u{fffd}');
        let len = ch.len_utf16();
        let r: String = if is_invisible(ch) {
            String::new()
        } else if ch.is_whitespace() {
            " ".to_string()
        } else if is_single_quote(ch) {
            "'".to_string()
        } else if is_double_quote(ch) {
            "\"".to_string()
        } else if is_dash(ch) {
            "-".to_string()
        } else if ch == '…' {
            "...".to_string()
        } else {
            ch.to_string().nfkd().filter(|c| !is_combining_mark(*c)).collect::<String>().to_lowercase()
        };
        for c in r.chars() {
            let last = out.norm.last().copied();
            if c == ' ' {
                if last.is_none() || last == Some(b' ' as u16) || last == Some(b'-' as u16) {
                    continue;
                }
            } else if c == '-' {
                if last == Some(b'-' as u16) {
                    continue;
                }
                if last == Some(b' ' as u16) {
                    out.norm.pop();
                    out.map.pop();
                    out.orig_len.pop();
                }
            }
            for u in c.encode_utf16(&mut buf) {
                out.norm.push(*u);
                out.map.push(i);
                out.orig_len.push(len);
            }
        }
        i += len;
    }
    while out.norm.last() == Some(&(b' ' as u16)) {
        out.norm.pop();
        out.map.pop();
        out.orig_len.pop();
    }
    out
}

/// Normalised units only.
pub fn normalise_units(s: &[u16]) -> Vec<u16> {
    normalise(s).norm
}

pub fn normalise_str(s: &str) -> Vec<u16> {
    normalise(&crate::util::utf16::to_u16(s)).norm
}

/// Original [start, end) for normalised [ns, ne).
pub fn to_original(n: &Normalised, ns: usize, ne: usize, original_length: usize) -> (usize, usize) {
    if n.map.is_empty() {
        return (0, 0);
    }
    let start = if ns < n.map.len() { n.map[ns] } else { original_length };
    let last = ne.min(n.map.len()) as isize - 1;
    let end = if last >= ns as isize && last >= 0 { n.map[last as usize] + n.orig_len[last as usize] } else { start };
    (start, end)
}

/// Similarity in [0, 1] by Levenshtein distance (two-row DP; inputs are short context strings).
pub fn similarity(a: &[u16], b: &[u16]) -> f64 {
    if a == b {
        return 1.0;
    }
    if a.is_empty() || b.is_empty() {
        return if a.len() == b.len() { 1.0 } else { 0.0 };
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur: Vec<usize> = vec![0; b.len() + 1];
    for i in 1..=a.len() {
        cur[0] = i;
        for j in 1..=b.len() {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    1.0 - prev[b.len()] as f64 / a.len().max(b.len()) as f64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::utf16::{from_u16, to_u16};

    #[test]
    fn folds_typography() {
        let n = normalise(&to_u16("She said “don’t go”—and  then\tleft…"));
        assert_eq!(from_u16(&n.norm), "she said \"don't go\"-and then left...");
        let (s, e) = to_original(&n, 9, 18, 36);
        assert_eq!(from_u16(&to_u16("She said “don’t go”—and  then\tleft…")[s..e]), "“don’t go");
        let (s, e) = to_original(&n, 10, 18, 36);
        assert_eq!(from_u16(&to_u16("She said “don’t go”—and  then\tleft…")[s..e]), "don’t go");
    }

    #[test]
    fn similarity_is_symmetric_enough() {
        assert_eq!(similarity(&to_u16("abc"), &to_u16("abc")), 1.0);
        assert!((similarity(&to_u16("kitten"), &to_u16("sitting")) - 0.5714).abs() < 0.001);
    }
}
