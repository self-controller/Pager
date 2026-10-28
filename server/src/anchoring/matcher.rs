//! Find where an anchor's text is in a (possibly edited) revision. Hypothesis-style:
//!
//!  a. same block, same offsets, same text, and either the block is unique or its context still
//!     matches → anchored;
//!  b. the exact (normalised) quote elsewhere, scored by context (prefix/suffix) and by distance
//!     from where it was → moved;
//!  c. a close match (quotes of 16+ normalised characters only), Myers approximate search, scored by
//!     quote similarity, context and distance → fuzzy, with that score as confidence;
//!  d. nothing → None (the caller marks it orphaned; it is never deleted).
//!
//! Wrong attachments are worse than orphans, so thresholds are conservative.

use super::approx::search;
use super::doctext::DocIndex;
use super::normalise::{normalise_str, normalise_units, similarity, to_original, Normalised};
use super::selectors::{is_repeated, StoredSelectors, CONTEXT, CONTEXT_AFTER_POINT};
use crate::model::AnchorStatus;
use crate::util::utf16::{count16, find16, to_u16};
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Located {
    pub status: AnchorStatus,
    pub confidence: f64,
    pub doc_start: usize,
    pub doc_end: usize,
}

pub const MIN_FUZZY: usize = 16;
const LONG: usize = 512;
const MAX_CANDIDATES: usize = 1000;

/// Normalised index of the first normalised char produced at or after original offset `pos`.
fn norm_index_at(n: &Normalised, pos: usize) -> usize {
    n.map.partition_point(|&m| m < pos)
}

fn ctx_sim(want: &[u16], got: &[u16]) -> f64 {
    if want.is_empty() {
        return if got.is_empty() { 1.0 } else { 0.5 };
    }
    similarity(want, got)
}

fn is_word(c: Option<&u16>) -> bool {
    match c {
        Some(&u) => char::from_u32(u as u32).map(|c| c.is_alphanumeric()).unwrap_or(u >= 0xd800 && u <= 0xdfff),
        None => false,
    }
}

fn round3(n: f64) -> f64 {
    (n * 1000.0).round() / 1000.0
}

/// The selectors with their strings as UTF-16, as the matcher needs them.
struct Sel16 {
    exact: Vec<u16>,
    prefix: Vec<u16>,
    suffix: Vec<u16>,
}

/// Move a fuzzy match's edges to word boundaries when the original quote sat on them.
fn snap(text: &[u16], sel: &Sel16, mut s: usize, mut e: usize) -> (usize, usize) {
    let started_on_boundary = !is_word(sel.prefix.last()) || !is_word(sel.exact.first());
    let ended_on_boundary = !is_word(sel.suffix.first()) || !is_word(sel.exact.last());
    if started_on_boundary {
        for _ in 0..3 {
            if s > 0 && is_word(text.get(s - 1)) && is_word(text.get(s)) {
                s -= 1;
            } else {
                break;
            }
        }
    }
    if ended_on_boundary {
        for _ in 0..3 {
            if e > 0 && is_word(text.get(e)) && is_word(text.get(e - 1)) {
                e += 1;
            } else {
                break;
            }
        }
    }
    (s, e.max(s))
}

/// Does the text around [a, b) still read exactly as it did (each side)?
fn context_matches(text: &[u16], sel: &Sel16, a: usize, b: usize, collapsed: bool) -> (bool, bool) {
    let after = if collapsed { CONTEXT_AFTER_POINT } else { CONTEXT };
    let pl = sel.prefix.len();
    let sl = sel.suffix.len();
    let prefix = a >= pl.min(a) && text[a.saturating_sub(pl)..a] == sel.prefix[..] && (pl >= CONTEXT || a == pl);
    let suffix = text.get(b..(b + sl).min(text.len())).map(|t| t == &sel.suffix[..]).unwrap_or(false) && (sl >= after || b + sl == text.len());
    (prefix, suffix)
}

#[derive(Clone, Copy, Debug)]
struct Cand {
    ns: usize,
    ne: usize,
    q: f64,
    pre: f64,
    suf: f64,
    pos: usize,
}

pub fn locate(sel: &StoredSelectors, old_length: usize, idx: &DocIndex) -> Option<Located> {
    let text = idx.text();
    let s16 = Sel16 { exact: to_u16(&sel.exact), prefix: to_u16(&sel.prefix), suffix: to_u16(&sel.suffix) };
    let collapsed = sel.doc_start == sel.doc_end;
    let new_length = idx.length();
    let expected = if old_length > 0 { ((sel.doc_start as f64 * new_length as f64) / old_length as f64).round() as usize } else { sel.doc_start };

    // a. Same place: same block ids and offsets, same text, and the surrounding text agrees on at least
    // one side. (Block ids alone aren't trusted: repeated paragraphs share a base id, and deleting or
    // inserting a copy shifts the "-2" suffixes onto a different paragraph.)
    let sa = idx.leaf(&sel.start.block_id);
    let sb = idx.leaf(&sel.end.block_id);
    let repeated = sel.ambiguous || is_repeated(idx, &sel.start.block_id) || is_repeated(idx, &sel.end.block_id);
    let mut same_place: Option<(usize, usize)> = None;
    if let (Some(sa), Some(sb)) = (sa, sb) {
        if sel.start.offset <= sa.len && sel.end.offset <= sb.len {
            let a = sa.start + sel.start.offset;
            let b = sb.start + sel.end.offset;
            if a <= b && text[a..b] == s16.exact[..] {
                same_place = Some((a, b));
            }
            if !repeated {
                if let Some((a, b)) = same_place {
                    let (p, s) = context_matches(text, &s16, a, b, collapsed);
                    if p || s {
                        return Some(Located { status: AnchorStatus::Anchored, confidence: 1.0, doc_start: a, doc_end: b });
                    }
                }
            }
        }
    }

    let n = idx.normalised();
    let window = (20_000usize).max((new_length as f64 * 0.1).round() as usize);
    if collapsed {
        return locate_point(sel, idx, n, expected, window);
    }

    let needle = normalise_units(&s16.exact);
    if needle.is_empty() {
        return None;
    }
    let pre = normalise_units(&s16.prefix);
    let suf = normalise_units(&s16.suffix);
    let prox = |pos: usize| 1.0 - (1.0f64).min((pos as f64 - expected as f64).abs() / (new_length.max(1)) as f64);
    let context_at = |ns: usize, ne: usize| -> (f64, f64) {
        let p = &n.norm[ns.saturating_sub(pre.len())..ns];
        let s = &n.norm[ne..(ne + suf.len()).min(n.norm.len())];
        (ctx_sim(&pre, p), ctx_sim(&suf, s))
    };
    let cand = |ns: usize, ne: usize, q: f64| -> Cand {
        let (p, s) = context_at(ns, ne);
        Cand { ns, ne, q, pre: p, suf: s, pos: to_original(n, ns, ne, text.len()).0 }
    };
    // One score for exact and close matches alike: the quote, its context, and where it is.
    let combined = |c: &Cand| 0.5 * c.q + 0.2 * c.pre + 0.2 * c.suf + 0.1 * prox(c.pos);

    // b. The exact (normalised) quote elsewhere.
    let mut exact: Vec<Cand> = Vec::new();
    let mut from = 0;
    while exact.len() < MAX_CANDIDATES {
        let Some(i) = find16(&n.norm, &needle, from) else { break };
        exact.push(cand(i, i + needle.len(), 1.0));
        from = i + 1;
    }
    let near = |c: &Cand| (c.pos as f64 - expected as f64).abs();
    exact.sort_by(|x, y| combined(y).partial_cmp(&combined(x)).unwrap_or(std::cmp::Ordering::Equal).then_with(|| near(x).partial_cmp(&near(y)).unwrap_or(std::cmp::Ordering::Equal)));
    let best_exact = exact.first().copied();
    let ctx_of = |c: &Cand| (c.pre + c.suf) / 2.0;
    let as_moved = |c: &Cand| -> Located {
        let (os, oe) = to_original(n, c.ns, c.ne, text.len());
        // Chosen by search, but it is exactly where the stored ids point: nothing moved.
        if same_place == Some((os, oe)) {
            let (p, s) = context_matches(text, &s16, os, oe, false);
            if p && s {
                return Located { status: AnchorStatus::Anchored, confidence: 1.0, doc_start: os, doc_end: oe };
            }
        }
        let confidence = if exact.len() == 1 { 1.0 } else { combined(c).clamp(0.6, 0.99) };
        Located { status: AnchorStatus::Moved, confidence: round3(confidence), doc_start: os, doc_end: oe }
    };
    // Good context settles it, unless the passage was in a repeated paragraph: then an untouched copy
    // may have good context too, and the edited original must be considered.
    if let Some(b) = &best_exact {
        if ctx_of(b) >= 0.5 && (!sel.ambiguous || needle.len() < MIN_FUZZY) {
            return Some(as_moved(b));
        }
    }
    // Short quotes ("Yes.") are only ever placed by context.
    if needle.len() < MIN_FUZZY {
        return None;
    }

    // c. A close match, with exact copies masked so an edited original can still be found next to an
    // untouched duplicate. The best of exact and close candidates wins on the combined score.
    let fuzzy = |ws: usize, we: usize| -> Vec<Cand> {
        let mut hay: Vec<u16> = n.norm[ws..we].to_vec();
        for e in &exact {
            if e.ne <= ws || e.ns >= we {
                continue;
            }
            let a = e.ns.saturating_sub(ws);
            let b = (e.ne - ws).min(hay.len());
            for u in hay.iter_mut().take(b).skip(a) {
                *u = 0;
            }
        }
        if needle.len() <= LONG {
            let max_errors = (needle.len() as f64 * 0.25).floor() as usize;
            let mut out = Vec::new();
            let mut seen: HashSet<usize> = HashSet::new();
            for m in search(&hay, &needle, max_errors).into_iter().take(50) {
                if !seen.insert(m.start) {
                    continue;
                }
                // Equal-error matches can end anywhere in an edited stretch; when the quote's own first and
                // last words are still there, the passage runs from one to the other.
                match refine_edges(&hay, &needle, m.start, m.end) {
                    Some((a, b)) => out.push(cand(ws + a, ws + b, similarity(&needle, &hay[a..b]))),
                    None => out.push(cand(ws + m.start, ws + m.end, 1.0 - m.errors as f64 / needle.len() as f64)),
                }
            }
            return out;
        }
        long_candidates(&hay, &needle).into_iter().map(|(s, e)| cand(ws + s, ws + e, similarity(&needle, &hay[s..e]))).collect()
    };
    let exp = norm_index_at(n, expected);
    let ws = exp.saturating_sub(window);
    let we = n.norm.len().min(exp + needle.len() + window);
    let mut found = fuzzy(ws, we);
    if found.is_empty() && (ws > 0 || we < n.norm.len()) {
        found = fuzzy(0, n.norm.len());
    }
    let mut best: Option<Cand> = None;
    for c in &found {
        if c.q >= 0.75 && combined(c) >= 0.65 && best.map(|b| combined(c) > combined(&b)).unwrap_or(true) {
            best = Some(*c);
        }
    }

    // Near-ties between an exact copy and a close match go to whichever is nearer where it was.
    if let Some(be) = &best_exact {
        let exact_wins = match &best {
            None => true,
            Some(b) => {
                if (combined(be) - combined(b)).abs() < 0.05 {
                    near(be) <= near(b)
                } else {
                    combined(be) > combined(b)
                }
            }
        };
        if exact_wins {
            // A lone exact copy (or one clearly ahead of the others) is still the quote's own words.
            let second = exact.get(1);
            if exact.len() == 1 || ctx_of(be) >= 0.3 || combined(be) - second.map(combined).unwrap_or(0.0) >= 0.02 {
                return Some(as_moved(be));
            }
        }
    }
    let best = best?;
    let (os, oe) = to_original(n, best.ns, best.ne, text.len());
    let (s0, e0) = snap(text, &s16, os, oe);
    Some(Located { status: AnchorStatus::Fuzzy, confidence: round3(combined(&best)), doc_start: s0, doc_end: e0 })
}

/// Find the quote's head and tail verbatim near an approximate match; None if either is gone.
fn refine_edges(hay: &[u16], needle: &[u16], start: usize, end: usize) -> Option<(usize, usize)> {
    let slack = (needle.len() as f64 * 0.3).ceil() as usize + 8;
    let nearest = |piece: &[u16], from: isize, to: isize, target: isize| -> Option<usize> {
        let mut best: Option<usize> = None;
        let mut i = find16(hay, piece, from.max(0) as usize);
        while let Some(pos) = i {
            if pos as isize > to {
                break;
            }
            if best.map(|b| (pos as isize - target).abs() < (b as isize - target).abs()).unwrap_or(true) {
                best = Some(pos);
            }
            i = find16(hay, piece, pos + 1);
        }
        best
    };
    // Shorter probes survive edits nearer the edges.
    let sizes: Vec<usize> = [12usize, 8, 5].into_iter().filter(|k| k * 2 <= needle.len()).collect();
    let (start, end) = (start as isize, end as isize);
    let mut h: Option<usize> = None;
    for &k in &sizes {
        h = nearest(&needle[..k], start - slack as isize, start + slack as isize, start);
        if h.is_some() {
            break;
        }
    }
    let h = h?;
    let mut e: Option<usize> = None;
    for &k in &sizes {
        let t = nearest(&needle[needle.len() - k..], ((h + k) as isize).max(end - slack as isize - k as isize), end + slack as isize, end - k as isize);
        if let Some(t) = t {
            e = Some(t + k);
            break;
        }
    }
    let e = e?;
    if e <= h {
        return None;
    }
    let len = (e - h) as f64;
    if len < needle.len() as f64 * 0.7 || len > needle.len() as f64 * 1.3 {
        return None;
    }
    Some((h, e))
}

/// Long quotes: every 64-character chunk of the quote found verbatim votes for where the quote would
/// start; the densest clusters of votes become candidate spans.
fn long_candidates(hay: &[u16], needle: &[u16]) -> Vec<(usize, usize)> {
    const CH: usize = 64;
    #[derive(Clone, Copy)]
    struct Vote {
        start: isize,
        first: usize,
        first_off: usize,
        last: usize,
        last_off: usize,
    }
    let mut votes: Vec<Vote> = Vec::new();
    let mut o = 0;
    while o + CH <= needle.len() {
        let chunk = &needle[o..o + CH];
        let mut cnt = 0;
        let mut i = find16(hay, chunk, 0);
        while let Some(pos) = i {
            if cnt >= 200 {
                break;
            }
            votes.push(Vote { start: pos as isize - o as isize, first: pos, first_off: o, last: pos, last_off: o });
            cnt += 1;
            i = find16(hay, chunk, pos + 1);
        }
        o += CH;
    }
    if votes.is_empty() {
        return vec![];
    }
    votes.sort_by_key(|v| v.start);
    let gap = (32.0f64).max(needle.len() as f64 * 0.15);
    struct Cluster {
        count: usize,
        first: usize,
        first_off: usize,
        last: usize,
        last_off: usize,
    }
    let mut clusters: Vec<Cluster> = Vec::new();
    for v in votes {
        match clusters.last_mut() {
            Some(c) if (v.start - (c.first as isize - c.first_off as isize)) as f64 <= gap => {
                c.count += 1;
                if v.first_off < c.first_off {
                    c.first = v.first;
                    c.first_off = v.first_off;
                }
                if v.last_off > c.last_off {
                    c.last = v.last;
                    c.last_off = v.last_off;
                }
            }
            _ => clusters.push(Cluster { count: 1, first: v.first, first_off: v.first_off, last: v.last, last_off: v.last_off }),
        }
    }
    let chunks = needle.len() / CH;
    let min_count = (2usize).max(((chunks as f64) * 0.3).ceil() as usize);
    let mut good: Vec<Cluster> = clusters.into_iter().filter(|c| c.count >= min_count).collect();
    good.sort_by(|a, b| b.count.cmp(&a.count));
    good.into_iter()
        .take(5)
        .map(|c| {
            let s = c.first.saturating_sub(c.first_off);
            let e = hay.len().min(c.last + CH + (needle.len() - (c.last_off + CH)));
            (s, e.max(s))
        })
        .collect()
}

/// A bookmark or reading place: the join of its prefix and suffix.
fn locate_point(sel: &StoredSelectors, idx: &DocIndex, n: &Normalised, expected: usize, window: usize) -> Option<Located> {
    let text = idx.text();
    // The prefix's share of the joined context (normalising alone would trim its trailing space).
    let pre_len = normalise_str(&format!("{}\u{1}", sel.prefix)).len().saturating_sub(1);
    let pre = normalise_str(&sel.prefix);
    let suf = normalise_str(&sel.suffix);
    let joined = normalise_str(&format!("{}{}", sel.prefix, sel.suffix));
    let prox = |pos: usize| 1.0 - (1.0f64).min((pos as f64 - expected as f64).abs() / idx.length().max(1) as f64);
    let at = |norm_join: usize| to_original(n, norm_join, norm_join, text.len()).0;

    // The whole context, then what came after (a reading place is about what comes next), then before.
    let mut tries: Vec<(&[u16], Box<dyn Fn(usize) -> usize>, bool)> = Vec::new();
    if joined.len() >= 8 {
        let pl = joined.len().min(pre_len);
        tries.push((&joined, Box::new(move |i| i + pl), true));
    }
    if suf.len() >= MIN_FUZZY {
        tries.push((&suf, Box::new(|i| i), false));
    }
    if pre.len() >= MIN_FUZZY {
        let pl = pre.len();
        tries.push((&pre, Box::new(move |i| i + pl), false));
    }
    for (needle, offset, is_joined) in &tries {
        let mut best: Option<(usize, f64)> = None;
        let mut count = 0;
        let mut from = 0;
        while count < MAX_CANDIDATES {
            let Some(i) = find16(&n.norm, needle, from) else { break };
            count += 1;
            let pos = at(offset(i));
            let score = prox(pos);
            if best.map(|b| score > b.1).unwrap_or(true) {
                best = Some((pos, score));
            }
            from = i + 1;
        }
        if let Some((pos, _)) = best {
            let (status, confidence) = if *is_joined { (AnchorStatus::Moved, if count == 1 { 1.0 } else { 0.8 }) } else { (AnchorStatus::Fuzzy, 0.7) };
            return Some(Located { status, confidence: round3(confidence), doc_start: pos, doc_end: pos });
        }
    }
    // Fuzzy on the joined context.
    if joined.len() >= MIN_FUZZY {
        let exp = norm_index_at(n, expected);
        let ws = exp.saturating_sub(window);
        let hay = &n.norm[ws..n.norm.len().min(exp + window)];
        let matches = search(hay, &joined, (joined.len() as f64 * 0.25).floor() as usize);
        let mut best: Option<(usize, f64)> = None;
        for m in matches.into_iter().take(50) {
            let q = 1.0 - m.errors as f64 / joined.len() as f64;
            let pos = at(ws + m.start + ((((m.end - m.start) * pre_len) as f64) / (joined.len().max(1)) as f64).round() as usize);
            let score = 0.7 * q + 0.3 * prox(pos);
            if q >= 0.75 && best.map(|b| score > b.1).unwrap_or(true) {
                best = Some((pos, score));
            }
        }
        if let Some((pos, score)) = best {
            return Some(Located { status: AnchorStatus::Fuzzy, confidence: round3(score), doc_start: pos, doc_end: pos });
        }
    }
    None
}

/// `text.split(exact).length === 2`: the quote appears exactly once.
pub fn appears_once(text: &[u16], exact: &str) -> bool {
    count16(text, &to_u16(exact)) == 1
}
