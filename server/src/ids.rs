use sha2::{Digest, Sha256};

const CROCKFORD: &[u8; 32] = b"0123456789abcdefghjkmnpqrstvwxyz";
const B62: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/// Time-sortable random id (ULID-shaped, lower-case): 10 chars of milliseconds + 10 random chars.
pub fn new_id(now_ms: i64) -> String {
    let mut t = now_ms.max(0) as u64;
    let mut time = [0u8; 10];
    for i in (0..10).rev() {
        time[i] = CROCKFORD[(t % 32) as usize];
        t /= 32;
    }
    let mut bytes = [0u8; 10];
    getrandom::fill(&mut bytes).expect("random bytes");
    let mut s = String::with_capacity(20);
    s.push_str(std::str::from_utf8(&time).unwrap());
    for b in bytes {
        s.push(CROCKFORD[(b % 32) as usize] as char);
    }
    s
}

pub fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

pub fn sha256_bytes(data: &[u8]) -> [u8; 32] {
    Sha256::digest(data).into()
}

/// Short alphanumeric digest (base62 of the first 12 bytes of sha256, least significant digit first),
/// for content-derived ids. Alphanumeric only, so "-2", "-3" suffixes can never be confused with it.
pub fn short_hash(data: &str, length: usize) -> String {
    let bytes = sha256_bytes(data.as_bytes());
    let mut n: u128 = 0;
    for b in &bytes[..12] {
        n = (n << 8) | (*b as u128);
    }
    let mut s = String::with_capacity(length);
    for _ in 0..length {
        s.push(B62[(n % 62) as usize] as char);
        n /= 62;
    }
    s
}

/// Client-supplied ids: 8–64 of [A-Za-z0-9_-].
pub fn is_client_id(s: &str) -> bool {
    (8..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// 256 random bits, base64url: the bearer token (and cookie value) a paired device holds.
pub fn new_secret() -> String {
    use base64::Engine;
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("random bytes");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Compare two sha256 hex digests in constant time.
pub fn same_hash(a: &str, b: &str) -> bool {
    use subtle::ConstantTimeEq;
    let (Ok(x), Ok(y)) = (hex::decode(a), hex::decode(b)) else { return false };
    x.len() == y.len() && !x.is_empty() && bool::from(x.ct_eq(&y))
}

/// `randomInt(n)`.
pub fn random_below(n: u32) -> u32 {
    let mut b = [0u8; 4];
    getrandom::fill(&mut b).expect("random bytes");
    u32::from_le_bytes(b) % n
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_hash_is_base62_and_stable() {
        let a = short_hash("paragraph\u{0}Hello", 11);
        assert_eq!(a.len(), 11);
        assert!(a.bytes().all(|b| b.is_ascii_alphanumeric()));
        assert_eq!(a, short_hash("paragraph\u{0}Hello", 11));
        assert_ne!(a, short_hash("paragraph\u{0}Hello!", 11));
    }

    #[test]
    fn ids_sort_by_time() {
        let a = new_id(1_000);
        let b = new_id(2_000);
        assert_eq!(a.len(), 20);
        assert!(a < b);
    }
}
