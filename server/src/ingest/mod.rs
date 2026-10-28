//! Bytes → ParsedDocument, one converter per format, all finishing through the builder.

pub mod builder;
pub mod context;
pub mod decode;
pub mod detect;
pub mod docx;
pub mod epub;
pub mod html;
pub mod htmldoc;
pub mod markdown;
pub mod text;
pub mod title;
pub mod versions;

use crate::config::limits;
use crate::errors::AppError;
use crate::model::ParsedDocument;
use crate::Result;
pub use context::IngestContext;
pub use detect::{detect_format, DetectedFormat};
pub use versions::Format;

/// Which formats are read (the rest answer `unsupported`).
pub fn check_format(f: DetectedFormat, file_name: &str) -> Result<Format> {
    match f {
        DetectedFormat::Pdf => Err(AppError::new(422, "unsupported", "PDFs can't be opened yet. EPUB, Markdown, plain text, HTML and Word files can.")),
        DetectedFormat::Unknown => Err(AppError::new(
            422,
            "unsupported",
            format!("Pager can't open {}. It reads EPUB, Markdown, plain text, HTML and Word (.docx) files.", if file_name.is_empty() { "this file" } else { file_name }),
        )),
        DetectedFormat::Known(f) => Ok(f),
    }
}

/// Bytes → ParsedDocument. Pure apart from writing images into the asset store.
pub fn parse_file(bytes: &[u8], format: Format, ctx: &IngestContext) -> Result<ParsedDocument> {
    match format {
        Format::Md | Format::Txt | Format::Html => {
            if bytes.len() > limits::TEXT_BYTES {
                return Err(AppError::new(413, "too_large", "This file is too large to open as text (the limit is 20 MB)."));
            }
            let (text, _) = decode::decode_text(bytes);
            match format {
                Format::Md => markdown::parse_markdown(&text, ctx),
                Format::Txt => Ok(text::parse_text(&text, ctx)),
                _ => Ok(htmldoc::parse_html_document(&text, ctx)),
            }
        }
        Format::Epub => epub::parse_epub(bytes, ctx),
        Format::Docx => docx::parse_docx(bytes, ctx),
    }
}
