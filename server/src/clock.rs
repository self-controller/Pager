//! Everything time-dependent takes a Clock so tests can control it.

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use time::format_description::well_known::Rfc3339;
use time::{Date, OffsetDateTime, PrimitiveDateTime, Time};

#[derive(Clone, Debug)]
pub enum Clock {
    System,
    Fake(Arc<AtomicI64>),
}

impl Clock {
    pub fn fake(start: &str) -> Clock {
        Clock::Fake(Arc::new(AtomicI64::new(parse_iso(start).expect("a valid start time"))))
    }

    pub fn now_ms(&self) -> i64 {
        match self {
            Clock::System => OffsetDateTime::now_utc().unix_timestamp_nanos() as i64 / 1_000_000,
            Clock::Fake(t) => t.load(Ordering::SeqCst),
        }
    }

    pub fn iso(&self) -> String {
        iso_ms(self.now_ms())
    }

    pub fn set(&self, at: &str) {
        if let Clock::Fake(t) = self {
            t.store(parse_iso(at).expect("a valid time"), Ordering::SeqCst);
        }
    }

    pub fn advance(&self, ms: i64) {
        if let Clock::Fake(t) = self {
            t.fetch_add(ms, Ordering::SeqCst);
        }
    }
}

/// `new Date(ms).toISOString()`: always with milliseconds, always UTC.
pub fn iso_ms(ms: i64) -> String {
    let t = OffsetDateTime::from_unix_timestamp_nanos(ms as i128 * 1_000_000).unwrap_or(OffsetDateTime::UNIX_EPOCH);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        t.year(),
        t.month() as u8,
        t.day(),
        t.hour(),
        t.minute(),
        t.second(),
        t.millisecond()
    )
}

/// `Date.parse` for the shapes the app meets: RFC 3339, a bare date, or a date-time without a zone (UTC).
pub fn parse_iso(s: &str) -> Option<i64> {
    let s = s.trim();
    if let Ok(t) = OffsetDateTime::parse(s, &Rfc3339) {
        return Some((t.unix_timestamp_nanos() / 1_000_000) as i64);
    }
    let date_fmt = time::macros::format_description!("[year]-[month]-[day]");
    if let Ok(d) = Date::parse(s, &date_fmt) {
        return Some(d.with_time(Time::MIDNIGHT).assume_utc().unix_timestamp() * 1000);
    }
    for fmt in [
        time::macros::format_description!("[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond]"),
        time::macros::format_description!("[year]-[month]-[day]T[hour]:[minute]:[second]"),
        time::macros::format_description!("[year]-[month]-[day]T[hour]:[minute]"),
    ] {
        if let Ok(t) = PrimitiveDateTime::parse(s, &fmt) {
            return Some((t.assume_utc().unix_timestamp_nanos() / 1_000_000) as i64);
        }
    }
    None
}

/// The stamp used in file names: ISO with ':' and '.' replaced by '-'.
pub fn file_stamp(ms: i64) -> String {
    iso_ms(ms).replace([':', '.'], "-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_like_javascript() {
        assert_eq!(iso_ms(0), "1970-01-01T00:00:00.000Z");
        let c = Clock::fake("2026-10-24T12:00:00Z");
        assert_eq!(c.iso(), "2026-10-24T12:00:00.000Z");
        c.advance(60_000);
        assert_eq!(c.iso(), "2026-10-24T12:01:00.000Z");
        assert_eq!(parse_iso("2026-10-26T12:10:00Z"), Some(1_793_016_600_000));
        assert_eq!(parse_iso("yesterday"), None);
        assert!(parse_iso("2026-10-26").is_some());
    }
}
