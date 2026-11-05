//! Local extraction, on the computer: metadata, front matter (capped) and short lists of names,
//! works and terms that occur in the book. This is all the model ever sees of the book: never
//! chapters of body text.

use crate::core::Core;
use crate::errors::AppError;
use crate::model::*;
use crate::util::soup::Doc;
use crate::Result;
use regex::Regex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::Path;
use std::sync::OnceLock;

pub const FRONT_PART_CHARS: usize = 4_000;
pub const FRONT_TOTAL_CHARS: usize = 12_000;
pub const MAX_FRONT_PARTS: usize = 5;
pub const MAX_NAMES: usize = 60;
pub const MAX_WORKS: usize = 40;
pub const MAX_TERMS: usize = 30;
pub const MAX_BIBLIOGRAPHY: usize = 40;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        fn $name() -> &'static Regex {
            static RE: OnceLock<Regex> = OnceLock::new();
            RE.get_or_init(|| Regex::new($pat).unwrap())
        }
    };
}

// Boilerplate sections that are neither the author's text nor useful context.
re!(not_body, r"(?i)^\s*(the\s+)?(project gutenberg|front matter|list of illustrations|illustrations|copyright|title page|cover|dedication|colophon|imprint)\b|\bcontents\b");
// Titled like front matter wherever it sits.
re!(front_title, r"(?i)\b(preface|introduction|introductory|foreword|prefatory|translator'?s?|editor'?s?|note on|notes on the text|advertisement|to the reader|historical sketch|biographical|memoir)\b");
// The book's own text has begun.
re!(chapter_title, r"(?i)^\s*((chapter|book|part|canto|letter|volume|act|stave|section)\b|[ivxlcdm]+\.?\s*$|\d+\.?\s*$|first part\b)");
// Back matter that names works and people.
re!(back_title, r"(?i)\b(notes|endnotes|bibliography|works cited|references|sources|further reading|glossary|appendix)\b");
re!(biblio_title, r"(?i)\b(bibliography|works cited|references|sources|further reading)\b");
re!(gutenberg_word, r"(?i)gutenberg");

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Counted {
    pub text: String,
    pub count: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FrontPart {
    pub title: String,
    pub text: String,
}

/// What goes to the model about the book.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookInput {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    pub authors: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub translators: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub editors: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    /// The edition's date when the file gives one (not an ebook release date).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub identifiers: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub subjects: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// e.g. "a Project Gutenberg ebook".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edition: Option<String>,
    pub format: String,
    pub word_count: u64,
    pub section_titles: Vec<String>,
    pub front_matter: Vec<FrontPart>,
    pub names: Vec<Counted>,
    pub works: Vec<Counted>,
    pub terms: Vec<Counted>,
    pub bibliography: Vec<String>,
    pub note_count: usize,
}

pub struct Extracted {
    pub doc_id: String,
    pub content_hash: String,
    pub input: BookInput,
}

/// Metadata EPUB ingest doesn't keep, read again from the OPF.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct OpfMeta {
    pub publisher: Option<String>,
    pub translators: Vec<String>,
    pub editors: Vec<String>,
    pub subjects: Vec<String>,
    pub identifiers: Vec<String>,
    pub source: Option<String>,
}

impl Core {
    /// The current revision's content hash (the file's sha256), after checking the file on disk.
    pub fn briefing_content_hash(&mut self, doc_id: &str) -> Result<String> {
        self.fresh(doc_id)?;
        let row = self.live_row(doc_id)?;
        let rev = row.current_revision_id.as_deref().ok_or_else(|| AppError::new(409, "conflict", "This document hasn't been read yet."))?;
        Ok(self.revision_row(rev)?.ok_or_else(|| AppError::new(409, "conflict", "This document hasn't been read yet."))?.content_hash)
    }

    pub fn briefing_extract(&mut self, doc_id: &str) -> Result<Extracted> {
        let content_hash = self.briefing_content_hash(doc_id)?;
        let idx = self.index(doc_id)?;
        let row = self.live_row(doc_id)?;
        let opf = if row.format == "epub" { read_opf(Path::new(&row.path)) } else { None };
        let title = row.title_override.clone().unwrap_or_else(|| row.title.clone());
        let authors = match &row.author_override {
            Some(a) if !a.trim().is_empty() => vec![a.trim().to_string()],
            _ => row.authors(),
        };
        let mut input = extract_lists(&idx.doc);
        input.title = title;
        input.subtitle = row.subtitle.clone();
        input.authors = authors;
        input.language = row.language.clone();
        input.date = row.published_at.clone();
        input.description = idx.doc.meta.description.clone();
        input.format = row.format.clone();
        input.word_count = idx.doc.word_count;
        if let Some(id) = &row.identifier {
            input.identifiers.push(id.clone());
        }
        if let Some(o) = opf {
            let gutenberg = o.identifiers.iter().chain(o.source.iter()).chain(o.publisher.iter()).any(|s| gutenberg_word().is_match(s));
            if gutenberg {
                input.edition = Some("a Project Gutenberg ebook (public-domain text)".into());
            }
            input.publisher = o.publisher;
            input.translators = o.translators;
            input.editors = o.editors;
            input.subjects = o.subjects.into_iter().take(12).collect();
            for i in o.identifiers {
                if !input.identifiers.contains(&i) {
                    input.identifiers.push(i);
                }
            }
        }
        Ok(Extracted { doc_id: doc_id.to_string(), content_hash, input })
    }
}

fn one_line(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Publisher, translators, editors, subjects and identifiers from an EPUB's OPF (EPUB 2 roles and
/// EPUB 3 `refines` roles).
pub fn read_opf(path: &Path) -> Option<OpfMeta> {
    let file = std::fs::File::open(path).ok()?;
    let mut zip = zip::ZipArchive::new(file).ok()?;
    let mut read = |name: &str| -> Option<String> {
        let mut f = zip.by_name(name).ok()?;
        if f.size() > 4 * 1024 * 1024 {
            return None;
        }
        let mut b = Vec::new();
        f.read_to_end(&mut b).ok()?;
        Some(crate::ingest::decode::decode_text(&b).0)
    };
    let container = Doc::parse_xml(&read("META-INF/container.xml")?);
    let root = container.find_all(&|d, id| d.local_name(id) == "rootfile").into_iter().next()?;
    let opf_path = container.attr(root, "full-path")?.to_string();
    let opf = Doc::parse_xml(&read(&opf_path)?);
    Some(opf_meta(&opf))
}

pub fn opf_meta(opf: &Doc) -> OpfMeta {
    let all = |name: &str| opf.find_all(&|d, id| d.local_name(id) == name);
    let mut refined_roles: HashMap<String, String> = HashMap::new();
    for m in all("meta") {
        if opf.attr(m, "property") == Some("role") {
            if let Some(r) = opf.attr(m, "refines") {
                refined_roles.insert(r.trim_start_matches('#').to_string(), one_line(&opf.raw_text(m)));
            }
        }
    }
    let mut o = OpfMeta::default();
    for el in all("creator").into_iter().chain(all("contributor")) {
        let role = opf
            .attr(el, "opf:role")
            .or_else(|| opf.attr(el, "role"))
            .map(str::to_string)
            .or_else(|| opf.attr(el, "id").and_then(|id| refined_roles.get(id).cloned()))
            .unwrap_or_default();
        let name = one_line(&opf.raw_text(el));
        if name.is_empty() {
            continue;
        }
        match role.as_str() {
            "trl" => o.translators.push(name),
            "edt" => o.editors.push(name),
            _ => {}
        }
    }
    o.publisher = all("publisher").into_iter().map(|p| one_line(&opf.raw_text(p))).find(|s| !s.is_empty());
    o.subjects = all("subject").into_iter().map(|p| one_line(&opf.raw_text(p))).filter(|s| !s.is_empty()).collect();
    o.identifiers = all("identifier").into_iter().map(|p| one_line(&opf.raw_text(p))).filter(|s| !s.is_empty()).collect();
    o.source = all("source").into_iter().map(|p| one_line(&opf.raw_text(p))).find(|s| !s.is_empty());
    o
}

/// Text leaves, leaving out figure captions (in illustrated editions they repeat the text or carry
/// boilerplate such as a copyright line).
fn text_leaves(blocks: &[Block]) -> Vec<&Leaf> {
    let mut out = Vec::new();
    for b in blocks {
        match b {
            Block::Figure(_) => {}
            Block::List(l) => {
                for it in &l.items {
                    out.extend(text_leaves(&it.blocks));
                }
            }
            Block::Blockquote(q) => out.extend(text_leaves(&q.blocks)),
            Block::Aside(a) => out.extend(text_leaves(&a.blocks)),
            other => out.extend(all_leaves(std::slice::from_ref(other))),
        }
    }
    out
}

fn section_text(s: &DocSection) -> String {
    all_leaves(&s.blocks).iter().map(|l| l.text.trim()).filter(|t| !t.is_empty()).collect::<Vec<_>>().join("\n")
}

/// Cut at a sentence end before `max` characters when there is one in the last third.
fn cap_text(t: &str, max: usize) -> String {
    if t.chars().count() <= max {
        return t.to_string();
    }
    let cut: String = t.chars().take(max).collect();
    match cut.rfind(['.', '!', '?']) {
        Some(i) if i > cut.len() * 2 / 3 => format!("{} […]", &cut[..=i]),
        _ => format!("{} […]", cut.trim_end()),
    }
}

/// Front matter, the name, work and term lists and the bibliography, from the parsed document.
pub fn extract_lists(doc: &ParsedDocument) -> BookInput {
    let mut input = BookInput {
        section_titles: doc.sections.iter().filter(|s| s.depth == 0 && !s.synthetic).map(|s| one_line(&s.title)).filter(|t| !t.is_empty() && !not_body().is_match(t)).take(80).collect(),
        ..BookInput::default()
    };

    // Front matter: sections before the first chapter-like heading, plus any titled like front matter.
    let mut before_body = true;
    let mut total = 0;
    for s in &doc.sections {
        let title = one_line(&s.title);
        if not_body().is_match(&title) {
            continue;
        }
        let looks_front = front_title().is_match(&title);
        if chapter_title().is_match(&title) && !looks_front {
            before_body = false;
        }
        if (before_body || looks_front) && !back_title().is_match(&title) && input.front_matter.len() < MAX_FRONT_PARTS && total < FRONT_TOTAL_CHARS {
            let text = section_text(s);
            if text.chars().count() < 80 || looks_like_contents(&text) {
                continue;
            }
            let text = cap_text(&text, FRONT_PART_CHARS.min(FRONT_TOTAL_CHARS - total));
            total += text.chars().count();
            input.front_matter.push(FrontPart { title: if title.is_empty() { "(untitled)".into() } else { title.clone() }, text });
        }
    }

    // Lists, over every section's text and notes (boilerplate skipped).
    let mut scan = Scan::default();
    let mut bibliography = Vec::new();
    for s in &doc.sections {
        let title = one_line(&s.title);
        if not_body().is_match(&title) {
            continue;
        }
        let back = back_title().is_match(&title);
        let biblio = biblio_title().is_match(&title);
        for leaf in text_leaves(&s.blocks) {
            scan.leaf(leaf, back);
            if biblio && bibliography.len() < MAX_BIBLIOGRAPHY {
                let t = one_line(&leaf.text);
                if (12..=240).contains(&t.chars().count()) {
                    bibliography.push(t);
                }
            }
        }
        for n in &s.notes {
            input.note_count += 1;
            for leaf in text_leaves(&n.blocks) {
                scan.leaf(leaf, true);
            }
        }
    }
    let back_names = scan.back.finish(&scan.lower);
    let body_names = scan.body.finish(&scan.lower);
    let mut name_list: Vec<Counted> = back_names.top(20, 1);
    let mut seen: HashSet<String> = name_list.iter().map(|c| c.text.clone()).collect();
    for c in body_names.top(usize::MAX, 3) {
        if name_list.len() >= MAX_NAMES {
            break;
        }
        if seen.insert(c.text.clone()) {
            name_list.push(c);
        }
    }
    input.names = name_list;
    // A "work" that is really a person ("Mr. Darcy", "Jane Austen") or a date isn't one.
    let known: HashSet<&str> = body_names.0.keys().chain(back_names.0.keys()).map(String::as_str).collect();
    // A person: up to three capitalised words, each a name the book uses on its own.
    let person = |t: &str| {
        let ws: Vec<&str> = t.split_whitespace().map(|w| w.trim_end_matches('.')).filter(|w| !HONORIFICS.contains(w)).collect();
        !ws.is_empty() && ws.len() <= 3 && ws.iter().all(|w| is_capitalised(w) && known.contains(w))
    };
    input.works = scan
        .works
        .top(usize::MAX, 1)
        .into_iter()
        .filter(|c| {
            let ws: Vec<&str> = c.text.split_whitespace().collect();
            let first = ws.first().map(|w| w.trim_end_matches(['.', ','])).unwrap_or("");
            let last = ws.last().copied().unwrap_or("");
            !STOP_NAMES.contains(&first) && !FUNCTION_WORDS.contains(&last) && !person(&c.text)
        })
        .take(MAX_WORKS)
        .collect();
    input.terms = scan.terms.top(usize::MAX, 2).into_iter().filter(|c| is_term(&c.text, &scan.plain)).take(MAX_TERMS).collect();
    input.bibliography = bibliography;
    input
}

/// A contents page: many short lines.
fn looks_like_contents(text: &str) -> bool {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines.len() >= 15 && text.chars().count() > 1500 && lines.iter().map(|l| l.chars().count()).sum::<usize>() / lines.len() < 60
}

#[derive(Default)]
struct Counter(HashMap<String, u32>);

impl Counter {
    fn add(&mut self, s: String) {
        self.add_n(s, 1);
    }

    fn add_n(&mut self, s: String, n: u32) {
        *self.0.entry(s).or_insert(0) += n;
    }

    fn top(&self, n: usize, min: u32) -> Vec<Counted> {
        let mut v: Vec<Counted> = self.0.iter().filter(|(_, &c)| c >= min).map(|(t, &c)| Counted { text: t.clone(), count: c }).collect();
        v.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.text.cmp(&b.text)));
        v.truncate(n);
        v
    }
}

/// Runs of capitalised words, counted apart by whether they began a sentence; cleaned at the end,
/// once every lower-case word in the book is known.
#[derive(Default)]
struct Names {
    mid: Counter,
    start: Counter,
}

impl Names {
    fn finish(&self, lower: &HashSet<String>) -> Counter {
        let mut out = Counter::default();
        for (bucket, at_start) in [(&self.mid, false), (&self.start, true)] {
            for (run, &n) in &bucket.0 {
                if let Some(name) = clean_name(run, at_start, lower) {
                    out.add_n(name, n);
                }
            }
        }
        out
    }
}

/// Drop what isn't part of a name: a sentence's first word that the book also writes in lower case
/// ("But", "When"), vocatives and honorifics in front, particles at either end. A single word must
/// be at least three letters and never written in lower case.
fn clean_name(run: &str, at_start: bool, lower: &HashSet<String>) -> Option<String> {
    let mut ws: Vec<&str> = run.split(' ').collect();
    if at_start && ws.first().map(|w| lower.contains(&w.to_lowercase())).unwrap_or(false) {
        ws.remove(0);
    }
    while ws.first().map(|w| STOP_NAMES.contains(w) || DETERMINERS.contains(w) || (ws.len() > 1 && (HONORIFICS.contains(&w.trim_end_matches('.')) || PARTICLES.contains(w)))).unwrap_or(false) {
        ws.remove(0);
    }
    while ws.last().map(|w| PARTICLES.contains(w)).unwrap_or(false) {
        ws.pop();
    }
    if ws.is_empty() || ws.len() > 4 {
        return None;
    }
    if ws.len() == 1 {
        let w = ws[0];
        // Adverbs and participles that start a sentence after a quote mark ("Fundamentally", "Applying").
        let inflected = w.ends_with("ly") || w.ends_with("ing");
        if w.chars().filter(|c| c.is_alphanumeric()).count() < 3 || inflected || HONORIFICS.contains(&w) || STOP_NAMES.contains(&w) || lower.contains(&w.to_lowercase()) {
            return None;
        }
    }
    Some(ws.join(" "))
}

/// A term is italic and unusual: a word the book never writes outside italics (emphasis on an
/// ordinary word doesn't count), or a short phrase with one such word.
fn is_term(t: &str, plain: &HashSet<String>) -> bool {
    let ws: Vec<String> = t.split_whitespace().map(|w| w.to_lowercase()).collect();
    if ws.len() == 1 && STOP_TERMS.contains(&ws[0].as_str()) {
        return false;
    }
    ws.iter().any(|w| w.chars().count() >= 3 && !plain.contains(w.trim_matches(|c: char| !c.is_alphanumeric())))
}

const STOP_NAMES: &[&str] = &[
    "I", "O", "Oh", "Ah", "Chapter", "Book", "Part", "Volume", "Letter", "Note", "See", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November",
    "December", "Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sept", "Sep", "Oct", "Nov", "Dec", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Yes", "No", "Thou",
    "Thee", "Thy", "Ye", "Summary", "Introduction", "Conclusion", "Contents", "Preface", "Index", "Appendix", "Copyright", "Heading", "Illustration", "Illustrations", "Tis", "Twas", "Hush", "Hark",
    "Amen", "Lo", "Alas", "Behold", "Selah", "Verily", "Ay", "Aye", "Nay",
];
/// Capitalised at a sentence start or in a title, never part of a name.
const DETERMINERS: &[&str] = &["The", "A", "An", "This", "That", "These", "Those", "My", "Our", "His", "Her", "Their", "Your", "Its"];
/// A title doesn't end on one of these.
const FUNCTION_WORDS: &[&str] = &["by", "of", "and", "the", "to", "with", "in", "on", "for", "a", "an", "from"];
const HONORIFICS: &[&str] = &["Mr", "Mrs", "Miss", "Ms", "Dr", "Sir", "Lady", "Lord", "St", "Rev", "Prof", "Captain", "Colonel", "General", "Professor", "Mme", "Mlle", "M"];
const PARTICLES: &[&str] = &["de", "da", "di", "del", "della", "du", "des", "la", "le", "van", "von", "der", "den", "of", "the", "y", "bin", "ibn"];
const STOP_TERMS: &[&str] = &[
    "very", "not", "must", "will", "should", "would", "could", "this", "that", "there", "here", "then", "now", "have", "had", "said", "was", "were", "been", "never", "ever", "all", "any", "only", "much",
    "more", "most", "less", "what", "which", "who", "whom", "whose", "when", "where", "why", "how", "him", "her", "his", "hers", "they", "them", "she", "you", "your", "can", "did", "does", "done", "is",
    "are", "be", "do", "so", "too", "my", "me", "we", "us", "our", "one", "it", "its", "if", "but", "and", "or", "nor", "yet", "no", "yes", "am", "an", "a", "the", "to", "of", "in", "on", "at", "by",
];

/// A word that can be part of a name: capitalised (not ALL CAPS, not "I"), or an initial ("F.").
fn is_name_word(w: &str) -> bool {
    if w == "I" {
        return false;
    }
    let cs: Vec<char> = w.chars().collect();
    if cs.len() == 2 && cs[0].is_uppercase() && cs[1] == '.' {
        return true;
    }
    is_capitalised(w)
}

fn is_capitalised(w: &str) -> bool {
    let mut cs = w.chars();
    match cs.next() {
        Some(c) if c.is_uppercase() => {
            let rest: Vec<char> = cs.collect();
            // Not ALL CAPS (headings), unless it's a single letter.
            rest.is_empty() || rest.iter().any(|c| c.is_lowercase())
        }
        _ => false,
    }
}

struct Word {
    core: String,
    /// Punctuation before the word: a run of names can't continue into it.
    lead_break: bool,
    /// Punctuation after it: the run ends here.
    trail_break: bool,
    /// The next word starts a sentence.
    ends_sentence: bool,
}

/// Words of a leaf's text, with the punctuation around each. An honorific or an initial followed by
/// a full stop ("Mr.", "F.") neither ends a run nor a sentence.
fn words_of(text: &str) -> Vec<Word> {
    let mut out: Vec<Word> = Vec::new();
    for raw in text.split_whitespace() {
        let core = raw.trim_start_matches(|c: char| !c.is_alphanumeric()).trim_end_matches(|c: char| !c.is_alphanumeric());
        let core = core.strip_suffix("'s").or_else(|| core.strip_suffix("\u{2019}s")).unwrap_or(core);
        if core.is_empty() {
            // A dash or a lone mark between words.
            if let Some(last) = out.last_mut() {
                last.trail_break = true;
            }
            continue;
        }
        let initial = core.chars().count() == 1 && core.chars().all(char::is_uppercase) && raw.ends_with('.') && core != "I";
        let abbrev = (HONORIFICS.contains(&core) && raw.ends_with('.')) || initial;
        let closing = raw.trim_end_matches(['"', '\u{201d}', '\u{2019}', '\'', ')', ']']);
        out.push(Word {
            core: if initial { format!("{core}.") } else { core.to_string() },
            lead_break: raw.starts_with(|c: char| !c.is_alphanumeric()),
            trail_break: raw.ends_with(|c: char| !c.is_alphanumeric()) && !abbrev,
            ends_sentence: closing.ends_with(['.', '!', '?']) && !abbrev,
        });
    }
    out
}

/// What one pass over the book collects.
#[derive(Default)]
struct Scan {
    body: Names,
    /// Names in notes and back matter.
    back: Names,
    works: Counter,
    terms: Counter,
    /// Every word the book writes in lower case.
    lower: HashSet<String>,
    /// Lower-case words outside italics.
    plain: HashSet<String>,
}

impl Scan {
    fn add_run(&mut self, run: &mut Vec<String>, back: bool, at_start: bool) {
        if !run.is_empty() && run.len() <= 6 {
            let names = if back { &mut self.back } else { &mut self.body };
            let bucket = if at_start { &mut names.start } else { &mut names.mid };
            bucket.add(run.join(" "));
        }
        run.clear();
    }

    fn leaf(&mut self, leaf: &Leaf, back: bool) {
        // Capitalised runs: names.
        let mut run: Vec<String> = Vec::new();
        let mut run_at_start = false;
        let mut sentence_start = true;
        for w in words_of(&leaf.text) {
            if w.lead_break {
                self.add_run(&mut run, back, run_at_start);
            }
            let name_word = is_name_word(&w.core);
            if w.core.chars().next().map(char::is_lowercase).unwrap_or(false) {
                self.lower.insert(w.core.to_lowercase());
            }
            let particle = !run.is_empty() && PARTICLES.contains(&w.core.as_str());
            if name_word || particle {
                if run.is_empty() {
                    // After an opening quote or bracket a capital may just start the quoted sentence.
                    run_at_start = sentence_start || w.lead_break;
                }
                run.push(w.core.clone());
            } else {
                self.add_run(&mut run, back, run_at_start);
            }
            if w.trail_break {
                self.add_run(&mut run, back, run_at_start);
            }
            sentence_start = w.ends_sentence;
        }
        self.add_run(&mut run, back, run_at_start);

        // Italic runs: titles of works (title case, 2–12 words) and terms (1–3 words). A whole line in
        // italics is a caption or a heading, not a title cited in the text.
        let leaf_len = leaf.text.trim().chars().count().max(1);
        // Segments, each with whether any plain text came before it (italic that opens a paragraph is a
        // run-in heading, "Divergence of Character.—", not a title cited in the text).
        let mut italic: Vec<(String, bool)> = Vec::new();
        let mut em = String::new();
        let is_em = |r: &TextRun| r.marks.as_ref().map(|m| m.contains(&Mark::Em)).unwrap_or(false);
        let mut plain_text = String::new();
        for inline in &leaf.content {
            match inline {
                Inline::Text(r) if is_em(r) => em.push_str(&r.text),
                Inline::Text(r) => {
                    italic.push((std::mem::take(&mut em), !plain_text.trim().is_empty()));
                    plain_text.push_str(&r.text);
                    plain_text.push(' ');
                }
                Inline::Link(l) => {
                    for c in &l.children {
                        match c {
                            Inline::Text(r) if is_em(r) => em.push_str(&r.text),
                            Inline::Text(r) => {
                                italic.push((std::mem::take(&mut em), !plain_text.trim().is_empty()));
                                plain_text.push_str(&r.text);
                                plain_text.push(' ');
                            }
                            _ => italic.push((std::mem::take(&mut em), !plain_text.trim().is_empty())),
                        }
                    }
                }
                _ => italic.push((std::mem::take(&mut em), !plain_text.trim().is_empty())),
            }
        }
        italic.push((em, !plain_text.trim().is_empty()));
        for w in plain_text.split(|c: char| !c.is_alphanumeric()).filter(|w| w.chars().next().map(char::is_lowercase).unwrap_or(false)) {
            self.plain.insert(w.to_lowercase());
        }
        for (seg, after_text) in italic {
            let t = one_line(seg.trim_matches(|c: char| !c.is_alphanumeric() && c != '\'' && c != '\u{2019}'));
            if t.is_empty() || t.chars().count() * 10 >= leaf_len * 8 {
                continue;
            }
            if !after_text {
                continue;
            }
            let ws: Vec<&str> = t.split_whitespace().collect();
            let significant: Vec<&&str> = ws.iter().filter(|w| w.chars().count() >= 4).collect();
            let titled = significant.iter().filter(|w| is_capitalised(w)).count();
            if (2..=12).contains(&ws.len()) && is_capitalised(ws[0]) && !significant.is_empty() && titled * 2 >= significant.len() {
                self.works.add(t);
            } else if (1..=3).contains(&ws.len()) && t.chars().count() >= 4 {
                self.terms.add(t);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opf_roles_from_refines() {
        let opf = Doc::parse_xml(
            r##"<package><metadata>
              <dc:creator id="author_0">Friedrich Wilhelm Nietzsche</dc:creator>
              <meta property="role" refines="#author_0">aut</meta>
              <dc:contributor id="author_1">Thomas Common</dc:contributor>
              <meta property="role" refines="#author_1" scheme="marc:relators">trl</meta>
              <dc:creator opf:role="edt">An Editor</dc:creator>
              <dc:publisher>A Press</dc:publisher>
              <dc:subject>Philosophy, German</dc:subject>
              <dc:identifier>http://www.gutenberg.org/1998</dc:identifier>
            </metadata></package>"##,
        );
        let o = opf_meta(&opf);
        assert_eq!(o.translators, vec!["Thomas Common"]);
        assert_eq!(o.editors, vec!["An Editor"]);
        assert_eq!(o.publisher.as_deref(), Some("A Press"));
        assert_eq!(o.subjects, vec!["Philosophy, German"]);
    }

    #[test]
    fn capped_text_ends_at_a_sentence() {
        let t = "One sentence here. Another sentence there. And a third one that runs on and on";
        let c = cap_text(t, 50);
        assert!(c.ends_with("there. […]"), "{c}");
    }
}
