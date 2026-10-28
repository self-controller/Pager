//! Plain text. The structure is inferred, conservatively, from how the text is laid out:
//! - blank lines separate paragraphs; hard-wrapped lines are joined;
//! - short single lines in capitals, or starting with a chapter word, are headings;
//! - paragraphs of short lines are verse (line breaks kept); indented short paragraphs are centred;
//! - "* * *" style lines are scene breaks; runs of list-like lines are lists;
//! - a Project Gutenberg header and licence become their own sections.

use super::builder::{DocBuilder, DraftDocument, DraftSection, SplitMode};
use super::context::IngestContext;
use super::title::{title_case, title_from_file_name};
use super::versions::Format;
use crate::model::*;
use regex::Regex;
use std::sync::OnceLock;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        fn $name() -> &'static Regex {
            static RE: OnceLock<Regex> = OnceLock::new();
            RE.get_or_init(|| Regex::new($pat).unwrap())
        }
    };
}

re!(list_line, r"^\s*(?:[-*•+]|\d{1,3}[.)]|[a-z][.)])\s+\S");
re!(list_mark, r"^\s*(?:[-*•+]|\d{1,3}[.)]|[a-z][.)])\s+");
re!(ordered_mark, r"^\s*\d{1,3}[.)]\s+");
re!(scene_break, r"^\s*([*~#=_\-•·]\s*){3,}\s*$|^\s*[*~•]\s*$");
re!(gutenberg_start, r"(?im)^\s*\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG.*$");
re!(gutenberg_end, r"(?im)^\s*\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG.*$");
re!(standalone, r"(?i)^(prologue|epilogue|preface|introduction|foreword|afterword|appendix|contents)\b");
re!(roman, r"^[IVXLCDM]+\.?$");
re!(ends_punct, r"[,;!?]$");
re!(ends_comma, r"[,;]$");
re!(ends_dot, r"[.,;:]$");
re!(byline, r"(?i)^by\s+([^,(]{2,60})");
re!(byline_year, r"\((1[5-9]\d\d|20\d\d)\)|,\s*(1[5-9]\d\d|20\d\d)\s*$");
re!(year, r"\b(1[5-9]\d\d|20\d\d)\b");

fn numbered() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        let words = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|the\\s+\\w+";
        Regex::new(&format!(
            r"(?i)^(chapter|book|part|volume|act|scene|canto|stave|letter|appendix|kapitel|chapitre|capítulo|capitolo|teil|livre|parte)\s+([\dIVXLCDMivxlcdm]+\b|(?:{words})\b)"
        ))
        .unwrap()
    })
}

pub fn is_chapter_heading(text: &str) -> bool {
    let t = text.trim();
    numbered().is_match(t) || standalone().is_match(t) || roman().is_match(t)
}

pub fn is_heading_line(line: &str) -> bool {
    let t = line.trim();
    if t.is_empty() || t.chars().count() > 80 {
        return false;
    }
    let words = t.split_whitespace().count();
    if words <= 10 && numbered().is_match(t) {
        return true;
    }
    if words <= 6 && standalone().is_match(t) && !ends_punct().is_match(t) {
        return true;
    }
    let letters: String = t.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.chars().count() < 2 {
        return roman().is_match(t);
    }
    let upper = letters == letters.to_uppercase() && letters != letters.to_lowercase();
    upper && words <= 8 && !ends_comma().is_match(t)
}

struct Para {
    lines: Vec<String>,
    line: u32,
}

fn paragraphs(text: &str, first_line: u32) -> Vec<Para> {
    let mut out = Vec::new();
    let mut cur: Vec<String> = Vec::new();
    let mut start = first_line;
    for (i, l) in text.split('\n').enumerate() {
        if l.trim().is_empty() {
            if !cur.is_empty() {
                out.push(Para { lines: std::mem::take(&mut cur), line: start });
            }
            continue;
        }
        if cur.is_empty() {
            start = first_line + i as u32;
        }
        cur.push(l.replace('\t', "    "));
    }
    if !cur.is_empty() {
        out.push(Para { lines: cur, line: start });
    }
    out
}

fn indent_of(l: &str) -> usize {
    l.chars().count() - l.trim_start().chars().count()
}

pub fn text_to_blocks(b: &mut DocBuilder, text: &str, first_line: u32) -> Vec<Block> {
    let mut blocks = Vec::new();
    for p in paragraphs(text, first_line) {
        let lines = &p.lines;
        let line = Some(p.line);
        if lines.len() == 1 && scene_break().is_match(&lines[0]) {
            blocks.push(b.hr(line));
            continue;
        }
        if lines.len() > 1 && lines.iter().all(|l| list_line().is_match(l)) {
            let ordered = lines.iter().all(|l| ordered_mark().is_match(l));
            let mut items = Vec::new();
            for l in lines {
                let text = list_mark().replace(l, "").into_owned();
                let para = b.paragraph(vec![Inline::text(text)], None, None, false);
                items.push(b.item(vec![para], None));
            }
            blocks.push(b.list(ordered, items, line));
            continue;
        }
        let first = &lines[0];
        if lines.len() == 1 && is_heading_line(first) {
            let align = if indent_of(first) >= 8 { Some(Align::Center) } else { None };
            let level = if is_chapter_heading(first) { 2 } else { 1 };
            blocks.push(b.heading(level, vec![Inline::text(first.trim())], align, line));
            continue;
        }
        // "CHAPTER I." over a short title line: one heading with a line break.
        if lines.len() == 2 && is_heading_line(first) && is_chapter_heading(first) && lines[1].trim().chars().count() <= 60 && !ends_dot().is_match(lines[1].trim()) {
            blocks.push(b.heading(2, vec![Inline::text(first.trim()), Inline::Br, Inline::text(lines[1].trim())], None, line));
            continue;
        }
        let mut rest: &[String] = lines;
        if lines.len() > 1 && is_heading_line(first) && is_chapter_heading(first) {
            blocks.push(b.heading(2, vec![Inline::text(first.trim())], None, line));
            rest = &lines[1..];
        }
        let all_indented = rest.iter().all(|l| indent_of(l) >= 8);
        let short = rest.iter().all(|l| l.trim().chars().count() < 50);
        if rest.len() >= 2 && short {
            let mut content = Vec::new();
            for (i, l) in rest.iter().enumerate() {
                if i > 0 {
                    content.push(Inline::Br);
                }
                content.push(Inline::text(l.trim()));
            }
            let para = if all_indented { b.paragraph(content, Some(Align::Center), line, false) } else { b.paragraph(content, None, line, true) };
            blocks.push(para);
            continue;
        }
        let joined = rest.iter().map(|l| l.trim()).collect::<Vec<_>>().join(" ");
        let align = if all_indented && rest.len() <= 3 { Some(Align::Center) } else { None };
        blocks.push(b.paragraph(vec![Inline::text(joined)], align, line, false));
    }
    blocks
}

fn line_of_index(text: &str, index: usize) -> u32 {
    1 + text.as_bytes()[..index.min(text.len())].iter().filter(|&&c| c == b'\n').count() as u32
}

fn plain_of(b: &Block) -> String {
    match b {
        Block::Heading(_) | Block::Paragraph(_) => {
            let content = &b.leaf().unwrap().content;
            content
                .iter()
                .map(|c| match c {
                    Inline::Text(t) => t.text.clone(),
                    Inline::Br => " ".to_string(),
                    _ => String::new(),
                })
                .collect::<String>()
                .trim()
                .to_string()
        }
        _ => String::new(),
    }
}

pub fn language_code(name: &str) -> String {
    let k = name.trim().to_lowercase();
    let code = match k.as_str() {
        "english" => "en",
        "french" => "fr",
        "german" => "de",
        "spanish" => "es",
        "italian" => "it",
        "portuguese" => "pt",
        "dutch" => "nl",
        "latin" => "la",
        "finnish" => "fi",
        "swedish" => "sv",
        "danish" => "da",
        "norwegian" => "no",
        "russian" => "ru",
        "greek" => "el",
        "chinese" => "zh",
        "japanese" => "ja",
        "polish" => "pl",
        "hungarian" => "hu",
        "czech" => "cs",
        _ => return name.trim().to_string(),
    };
    code.to_string()
}

fn field(header: &str, name: &str) -> Option<String> {
    let re = Regex::new(&format!(r"(?im)^{}:\s*(.+)$", regex::escape(name))).unwrap();
    re.captures(header).map(|c| c[1].trim().to_string())
}

pub fn parse_text(text: &str, ctx: &IngestContext) -> ParsedDocument {
    let mut b = DocBuilder::new("txt", Format::Txt.parser_version());
    let start = gutenberg_start().find(text);
    let end = gutenberg_end().find(text);
    let mut meta = DocumentMeta { title: String::new(), authors: Vec::new(), ..Default::default() };
    let mut sections: Vec<DraftSection> = Vec::new();
    let mut body: &str = text;
    let mut body_line = 1;
    let gutenberg = match (start, end) {
        (Some(s), Some(e)) if e.start() > s.start() => Some((s, e)),
        _ => None,
    };
    if let Some((s, e)) = gutenberg {
        let header = &text[..s.end()];
        let title = field(header, "Title");
        let author = field(header, "Author");
        let lang = field(header, "Language");
        // "Release date" is the ebook's; only an original publication year says when the book appeared.
        let date = field(header, "Original publication").or_else(|| field(header, "Original Publication"));
        if let Some(t) = title {
            meta.title = t;
        }
        if let Some(a) = author {
            let split = Regex::new(r"\s+and\s+|;\s*").unwrap();
            meta.authors = split.split(&a).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
        }
        if let Some(l) = lang {
            meta.language = Some(language_code(&l));
        }
        if let Some(d) = date {
            if let Some(y) = year().captures(&d) {
                meta.published_at = Some(y[1].to_string());
            }
        }
        let header_blocks = text_to_blocks(&mut b, header, 1);
        sections.push(DraftSection::new("Project Gutenberg header", 0, header_blocks));
        body = &text[s.end()..e.start()];
        body_line = line_of_index(text, s.end());
    }
    let body_blocks = text_to_blocks(&mut b, body, body_line);
    if meta.title.is_empty() {
        let h = body_blocks.iter().find(|x| x.is_heading() && !is_chapter_heading(&plain_of(x)));
        meta.title = match h {
            Some(h) => title_case(&plain_of(h)),
            None => title_from_file_name(&ctx.file_name),
        };
    }
    if meta.authors.is_empty() {
        for blk in body_blocks.iter().take(6) {
            let p = plain_of(blk);
            if let Some(m) = byline().captures(&p) {
                meta.authors = vec![m[1].trim().to_string()];
                // "by O. Henry (1905)": the year is the book's. The byline itself stays in the text.
                if meta.published_at.is_none() {
                    if let Some(y) = byline_year().captures(&p) {
                        meta.published_at = y.get(1).or(y.get(2)).map(|m| m.as_str().to_string());
                    }
                }
                break;
            }
        }
    }
    let mut main = DraftSection::new(meta.title.clone(), 0, body_blocks);
    main.split = Some(SplitMode::Chapters);
    sections.push(main);
    if let Some((_, e)) = gutenberg {
        let licence = text_to_blocks(&mut b, &text[e.start()..], line_of_index(text, e.start()));
        sections.push(DraftSection::new("Project Gutenberg licence", 0, licence));
    }
    let draft = DraftDocument { meta, blocks: None, sections: Some(sections), notes: Vec::new(), warnings: Vec::new(), split: SplitMode::Chapters, is_chapter_heading: Some(is_chapter_heading) };
    b.finalize(draft)
}
