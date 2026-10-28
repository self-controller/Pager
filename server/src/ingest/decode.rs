//! Bytes → text: a BOM decides (UTF-8, UTF-16 LE/BE); otherwise strict UTF-8; otherwise
//! windows-1252 (which also covers Latin-1). Line endings become "\n".

pub fn decode_text(bytes: &[u8]) -> (String, &'static str) {
    let (text, encoding): (String, &'static str) = if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        (String::from_utf8_lossy(&bytes[3..]).into_owned(), "utf-8")
    } else if bytes.starts_with(&[0xff, 0xfe]) {
        (encoding_rs::UTF_16LE.decode_without_bom_handling(&bytes[2..]).0.into_owned(), "utf-16le")
    } else if bytes.starts_with(&[0xfe, 0xff]) {
        (encoding_rs::UTF_16BE.decode_without_bom_handling(&bytes[2..]).0.into_owned(), "utf-16be")
    } else {
        match std::str::from_utf8(bytes) {
            Ok(s) => (s.to_string(), "utf-8"),
            Err(_) => (encoding_rs::WINDOWS_1252.decode_without_bom_handling(bytes).0.into_owned(), "windows-1252"),
        }
    };
    let text = text.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(text);
    (text.replace("\r\n", "\n").replace('\r', "\n"), encoding)
}
