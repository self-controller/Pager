//! Approximate string matching (Myers' bit-parallel algorithm with blocks), after the
//! `approx-string-match` library: the end positions whose edit distance to the pattern is the
//! lowest found within `max_errors`, each with the leftmost start that achieves it.

use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Match {
    pub start: usize,
    pub end: usize,
    pub errors: usize,
}

const W: usize = 64;

fn find_match_ends(text: &[u16], pattern: &[u16], max_errors: usize) -> Vec<Match> {
    if pattern.is_empty() {
        return vec![];
    }
    let mut max_errors = max_errors.min(pattern.len());
    let m = pattern.len();
    let blocks = m.div_ceil(W);
    let mut peq: HashMap<u16, Vec<u64>> = HashMap::new();
    for (i, &c) in pattern.iter().enumerate() {
        peq.entry(c).or_insert_with(|| vec![0; blocks])[i / W] |= 1u64 << (i % W);
    }
    let zero = vec![0u64; blocks];
    let mut pv = vec![!0u64; blocks];
    let mut mv = vec![0u64; blocks];
    let last_bit = 1u64 << ((m - 1) % W);
    let mut score = m as i64;
    let mut out = Vec::new();
    for (j, &c) in text.iter().enumerate() {
        let eqv = peq.get(&c).unwrap_or(&zero);
        let mut hin: i32 = 0;
        for b in 0..blocks {
            let mut eq = eqv[b];
            if hin < 0 {
                eq |= 1;
            }
            let pvb = pv[b];
            let mvb = mv[b];
            let xv = eq | mvb;
            let xh = (((eq & pvb).wrapping_add(pvb)) ^ pvb) | eq;
            let mut ph = mvb | !(xh | pvb);
            let mut mh = pvb & xh;
            let top = if b == blocks - 1 { last_bit } else { 1u64 << (W - 1) };
            let hout = if ph & top != 0 {
                1
            } else if mh & top != 0 {
                -1
            } else {
                0
            };
            ph <<= 1;
            mh <<= 1;
            if hin < 0 {
                mh |= 1;
            } else if hin > 0 {
                ph |= 1;
            }
            pv[b] = mh | !(xv | ph);
            mv[b] = ph & xv;
            hin = hout;
        }
        score += hin as i64;
        if score <= max_errors as i64 {
            // Only the matches with the fewest errors are reported: a better one discards the
            // earlier, worse ones, and the threshold ratchets down for the rest of the text.
            if score < max_errors as i64 {
                out.clear();
            }
            out.push(Match { start: 0, end: j + 1, errors: score.max(0) as usize });
            max_errors = score.max(0) as usize;
        }
    }
    out
}

pub fn search(text: &[u16], pattern: &[u16], max_errors: usize) -> Vec<Match> {
    let ends = find_match_ends(text, pattern, max_errors);
    if ends.is_empty() {
        return ends;
    }
    let pat_rev: Vec<u16> = pattern.iter().rev().copied().collect();
    ends.into_iter()
        .map(|m| {
            // Find start of each match by reversing the pattern and matching the text preceding the
            // match end in reverse. If there are several possible starts, take the leftmost.
            let min_start = m.end.saturating_sub(pattern.len() + m.errors);
            let text_rev: Vec<u16> = text[min_start..m.end].iter().rev().copied().collect();
            let start = find_match_ends(&text_rev, &pat_rev, m.errors).into_iter().fold(m.end, |min, rm| min.min(m.end - rm.end));
            Match { start, end: m.end, errors: m.errors }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::utf16::to_u16;

    #[test]
    fn finds_exact_and_close_matches() {
        let text = to_u16("the quick brown fox jumps over the lazy dog");
        let exact = search(&text, &to_u16("brown fox"), 0);
        assert!(exact.iter().any(|m| m.start == 10 && m.end == 19 && m.errors == 0));
        let close = search(&text, &to_u16("brwn fox"), 2);
        assert!(close.iter().any(|m| m.start == 10 && m.end == 19 && m.errors == 1));
        assert!(search(&text, &to_u16("zzzzzzzz"), 1).is_empty());
    }

    #[test]
    fn long_patterns_use_several_blocks() {
        let pat: String = "abcdefghij".repeat(10);
        let text = format!("xxxx{}yyyy", pat.replacen("abcdefghijabcdefghij", "abcdefghiXabcdefghij", 1));
        let m = search(&to_u16(&text), &to_u16(&pat), 5);
        assert!(m.iter().any(|m| m.start == 4 && m.end == 104 && m.errors == 1));
    }
}

#[cfg(test)]
mod dp_tests {
    use super::*;

    /// The plain O(nm) dynamic programme the bit-parallel version must agree with.
    fn dp_ends(text: &[u16], pat: &[u16], k: usize) -> Vec<(usize, usize)> {
        let m = pat.len();
        let mut prev: Vec<usize> = (0..=m).collect();
        let mut out = vec![];
        for (j, &c) in text.iter().enumerate() {
            let mut cur = vec![0; m + 1];
            for i in 1..=m {
                let cost = if pat[i - 1] == c { 0 } else { 1 };
                cur[i] = (prev[i] + 1).min(cur[i - 1] + 1).min(prev[i - 1] + cost);
            }
            if cur[m] <= k {
                out.push((j + 1, cur[m]));
            }
            prev = cur;
        }
        let best = out.iter().map(|&(_, e)| e).min();
        out.into_iter().filter(|&(_, e)| Some(e) == best).collect()
    }

    #[test]
    fn agrees_with_the_plain_dp_across_block_boundaries() {
        let mut x: u64 = 0x9E3779B97F4A7C15;
        let mut next = move || {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            x
        };
        for case in 0..200 {
            let alphabet = if case % 2 == 0 { 3 } else { 8 };
            let m = 1 + (next() % 200) as usize;
            let n = m + (next() % 300) as usize;
            let pat: Vec<u16> = (0..m).map(|_| b'a' as u16 + (next() % alphabet) as u16).collect();
            let text: Vec<u16> = (0..n).map(|_| b'a' as u16 + (next() % alphabet) as u16).collect();
            let k = (next() % (m as u64 + 1)) as usize;
            let got: Vec<(usize, usize)> = find_match_ends(&text, &pat, k).iter().map(|m| (m.end, m.errors)).collect();
            assert_eq!(got, dp_ends(&text, &pat, k), "pattern length {m}, {k} errors");
        }
    }
}
