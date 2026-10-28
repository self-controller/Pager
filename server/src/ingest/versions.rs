/// Per-format parser versions. Bump one whenever that converter's output changes (text, ids or
/// structure): cached revisions are re-parsed lazily on open and annotations re-anchored, exactly as
/// if the file had been edited. A golden test fails if output changes without a bump.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Format {
    Md,
    Txt,
    Html,
    Epub,
    Docx,
}

impl Format {
    pub fn parser_version(self) -> u32 {
        match self {
            Format::Md => 2,
            Format::Txt => 4,
            Format::Html => 2,
            Format::Epub => 3,
            Format::Docx => 2,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Format::Md => "md",
            Format::Txt => "txt",
            Format::Html => "html",
            Format::Epub => "epub",
            Format::Docx => "docx",
        }
    }

    pub fn parse(s: &str) -> Option<Format> {
        match s {
            "md" => Some(Format::Md),
            "txt" => Some(Format::Txt),
            "html" => Some(Format::Html),
            "epub" => Some(Format::Epub),
            "docx" => Some(Format::Docx),
            _ => None,
        }
    }

    /// Formats whose files people edit: watched, live-reloaded, and snapshotted per revision.
    pub fn is_live(self) -> bool {
        matches!(self, Format::Md | Format::Txt | Format::Html | Format::Docx)
    }

    pub fn is_snapshotted(self) -> bool {
        matches!(self, Format::Md | Format::Txt | Format::Html)
    }
}
