//! `localeCompare` stand-ins for sorting folder listings.

use std::cmp::Ordering;

/// Case-insensitive, numeric-aware ordering ("file 2" before "file 10"), like
/// `localeCompare(undefined, { numeric: true, sensitivity: "base" })`.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        if a[i].is_ascii_digit() && b[j].is_ascii_digit() {
            let si = i;
            while i < a.len() && a[i].is_ascii_digit() {
                i += 1;
            }
            let sj = j;
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            let na: String = a[si..i].iter().collect();
            let nb: String = b[sj..j].iter().collect();
            let na = na.trim_start_matches('0');
            let nb = nb.trim_start_matches('0');
            match na.len().cmp(&nb.len()).then_with(|| na.cmp(nb)) {
                Ordering::Equal => continue,
                o => return o,
            }
        }
        let ca: String = a[i].to_lowercase().collect();
        let cb: String = b[j].to_lowercase().collect();
        match ca.cmp(&cb) {
            Ordering::Equal => {
                i += 1;
                j += 1;
            }
            o => return o,
        }
    }
    (a.len() - i).cmp(&(b.len() - j)).then_with(|| a.cmp(&b))
}

/// Plain `localeCompare`: case-insensitive first, then by code point so the order is total.
pub fn locale_cmp(a: &str, b: &str) -> Ordering {
    let la = a.to_lowercase();
    let lb = b.to_lowercase();
    la.cmp(&lb).then_with(|| a.cmp(b))
}
