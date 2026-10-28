//! Every coordinate the API exposes (block offsets, document positions, section textContent offsets)
//! counts UTF-16 code units, as a browser does. These helpers keep that arithmetic in one place.

/// Length of `s` in UTF-16 code units.
pub fn len16(s: &str) -> usize {
    s.encode_utf16().count()
}

pub fn to_u16(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

pub fn from_u16(u: &[u16]) -> String {
    String::from_utf16_lossy(u)
}

/// `s.slice(a, b)` in JavaScript terms (clamped, UTF-16 units).
pub fn slice16(s: &str, a: usize, b: usize) -> String {
    let units = to_u16(s);
    let a = a.min(units.len());
    let b = b.min(units.len()).max(a);
    from_u16(&units[a..b])
}

/// `hay.indexOf(needle, from)` over UTF-16 units.
pub fn find16(hay: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    if needle.is_empty() {
        return Some(from.min(hay.len()));
    }
    if hay.len() < needle.len() {
        return None;
    }
    let first = needle[0];
    let last_start = hay.len() - needle.len();
    let mut i = from;
    while i <= last_start {
        if hay[i] == first && hay[i..i + needle.len()] == *needle {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// Every occurrence of `needle` in `hay`, as `split(needle).length - 1` would count them (non-overlapping).
pub fn count16(hay: &[u16], needle: &[u16]) -> usize {
    if needle.is_empty() {
        return 0;
    }
    let mut n = 0;
    let mut from = 0;
    while let Some(i) = find16(hay, needle, from) {
        n += 1;
        from = i + needle.len();
    }
    n
}
