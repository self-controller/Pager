//! What kind of file is this? Magic bytes first, then the extension.

use super::versions::Format;
use regex::Regex;
use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DetectedFormat {
    Known(Format),
    Pdf,
    Unknown,
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).unwrap())
}

static MD_EXT: OnceLock<Regex> = OnceLock::new();
static HTML_EXT: OnceLock<Regex> = OnceLock::new();
static TXT_EXT: OnceLock<Regex> = OnceLock::new();
static ANY_EXT: OnceLock<Regex> = OnceLock::new();

fn contains(b: &[u8], s: &[u8], from: usize) -> bool {
    from < b.len() && memchr::memmem::find(&b[from..], s).is_some()
}

pub fn detect_format(bytes: &[u8], file_name: &str) -> DetectedFormat {
    let md = re(&MD_EXT, r"(?i)\.(md|markdown|mdown|mkd|mkdn|mdwn|mdtxt|mdtext)$");
    let html = re(&HTML_EXT, r"(?i)\.(html?|xhtml|xht|shtml)$");
    let txt = re(&TXT_EXT, r"(?i)\.(txt|text|asc|log|rst|org|adoc)$");
    let any = re(&ANY_EXT, r"(?i)\.[a-z0-9]{1,8}$");
    if bytes.starts_with(b"%PDF-") {
        return DetectedFormat::Pdf;
    }
    if bytes.starts_with(b"PK\x03\x04") {
        // EPUB: the first entry is an uncompressed "mimetype" file. File names in the central
        // directory are stored uncompressed, so a byte search finds DOCX's word/document.xml.
        if bytes.len() >= 30 + 28 && &bytes[30..30 + 28] == b"mimetypeapplication/epub+zip" {
            return DetectedFormat::Known(Format::Epub);
        }
        let tail = bytes.len().saturating_sub(2 * 1024 * 1024);
        if contains(bytes, b"META-INF/container.xml", tail) || file_name.to_ascii_lowercase().ends_with(".epub") {
            return DetectedFormat::Known(Format::Epub);
        }
        if contains(bytes, b"word/document.xml", tail) || file_name.to_ascii_lowercase().ends_with(".docx") {
            return DetectedFormat::Known(Format::Docx);
        }
        return DetectedFormat::Unknown;
    }
    // Binary? (NUL bytes in the first 8 KB, unless UTF-16 with a BOM.)
    let head = &bytes[..bytes.len().min(8192)];
    let utf16 = bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]);
    if !utf16 && head.contains(&0) {
        return DetectedFormat::Unknown;
    }
    if md.is_match(file_name) {
        return DetectedFormat::Known(Format::Md);
    }
    if html.is_match(file_name) {
        return DetectedFormat::Known(Format::Html);
    }
    if txt.is_match(file_name) {
        return DetectedFormat::Known(Format::Txt);
    }
    let start: String = String::from_utf8_lossy(head).trim_start().chars().take(200).collect::<String>().to_lowercase();
    if start.starts_with("<!doctype html") || start.starts_with("<html") || (start.starts_with("<?xml") && start.contains("<html")) {
        return DetectedFormat::Known(Format::Html);
    }
    if any.is_match(file_name) {
        return DetectedFormat::Unknown;
    }
    DetectedFormat::Known(Format::Txt)
}
