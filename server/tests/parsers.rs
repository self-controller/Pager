mod common;

use common::*;
use pager_server::anchoring::doctext::DocIndex;
use pager_server::ids::sha256_hex;
use pager_server::ingest::decode::decode_text;
use pager_server::ingest::detect::{detect_format, DetectedFormat};
use pager_server::ingest::docx::parse_docx;
use pager_server::ingest::epub::parse_epub;
use pager_server::ingest::htmldoc::parse_html_document;
use pager_server::ingest::markdown::{parse_front_matter, parse_markdown, FrontValue};
use pager_server::ingest::text::{is_heading_line, parse_text};
use pager_server::ingest::Format;
use pager_server::model::*;
use pager_server::util::utf16::from_u16;

fn book_with_everything() -> Vec<u8> {
    make_epub(EpubSpec {
        title: "A Structured Book".into(),
        authors: vec!["Anne Author".into(), "Bea Writer".into()],
        images: vec![("img/plate.png".into(), png_1px()), ("img/cover.png".into(), png_1px())],
        cover: Some("img/cover.png".into()),
        files: vec![
            file("part1.xhtml", "<h1>Part One</h1><p class=\"epigraph\" style=\"text-align:center\">An epigraph.</p>"),
            file(
                "ch1.xhtml",
                "<h2>Chapter 1</h2><p>First<a id=\"anchor-a\"/> paragraph&#160;with a non-breaking space and an anchor.</p>
               <p>See <a href=\"ch3.xhtml#later\">the later passage</a> and <a href=\"https://example.com/x\">the web</a>.</p>
               <figure><img src=\"img/plate.png\" alt=\"A plate\"/><figcaption>Plate <em>one</em>.</figcaption></figure>
               <div class=\"poem\"><p>Line one<br/>line two</p></div>
               <ul><li>alpha<ul><li>nested</li></ul></li><li><p>beta</p></li></ul>
               <span epub:type=\"pagebreak\" title=\"12\">12</span>
               <table><thead><tr><th>H</th></tr></thead><tbody><tr><td rowspan=\"2\">cell</td></tr></tbody></table>",
            ),
            file("ch2.xhtml", "<h2>Chapter 2</h2><p>Second chapter with a note.<a epub:type=\"noteref\" href=\"#fn1\">1</a></p><aside epub:type=\"footnote\" id=\"fn1\"><p>An in-file footnote.</p></aside><blockquote><p>Quoted.</p></blockquote><pre><code class=\"language-py\">x  = 1\n  y = 2</code></pre>"),
            file("part2.xhtml", "<h1>Part Two</h1>"),
            file(
                "ch3.xhtml",
                "<h2>Chapter 3</h2><section id=\"later\"><p>The later passage itself.</p></section><p>An endnote here.<a href=\"notes.xhtml#n2\"><sup>2</sup></a> And <script>alert(1)</script>no script.</p><p><a href=\"javascript:alert(1)\">bad link</a></p>",
            ),
            nonlinear("notes.xhtml", "<h1>Notes</h1><p id=\"n2\">2. An endnote from a non-linear file.</p><p id=\"n3\">3. Never cited.</p>"),
        ],
        toc: Some(vec![
            toc_with("Part One", "part1.xhtml", vec![toc("Chapter 1", "ch1.xhtml"), toc("Chapter 2", "ch2.xhtml")]),
            toc_with("Part Two", "part2.xhtml", vec![toc("Chapter 3", "ch3.xhtml")]),
        ]),
        ..Default::default()
    })
}

#[test]
fn epub_keeps_the_authors_structure() {
    let doc = parse_epub(&book_with_everything(), &ingest_ctx(None, "test.epub")).unwrap();
    assert_eq!(validate_document(&doc), Vec::<String>::new());
    assert_eq!(validate_render(&doc), Vec::<String>::new());
    assert_eq!(doc.meta.title, "A Structured Book");
    assert_eq!(doc.meta.authors, vec!["Anne Author", "Bea Writer"]);
    assert_eq!(doc.meta.language.as_deref(), Some("en"));
    assert_eq!(doc.meta.identifier.as_deref(), Some("urn:isbn:9780000000002"));
    assert_eq!(doc.meta.published_at.as_deref(), Some("1817"));
    let cover = doc.meta.cover.clone().unwrap();
    assert!(cover.starts_with("/api/assets/") && cover.ends_with(".png") && cover.len() == "/api/assets/".len() + 64 + 4);
    let titles: Vec<(String, u32)> = doc.sections.iter().map(|s| (s.title.clone(), s.depth)).collect();
    assert_eq!(titles, vec![("Part One".into(), 0), ("Chapter 1".into(), 1), ("Chapter 2".into(), 1), ("Part Two".into(), 0), ("Chapter 3".into(), 1)]);
    let epigraph = find_leaf(&doc, "An epigraph").unwrap();
    assert_eq!(epigraph.align, Some(Align::Center));
    assert_eq!(find_leaf(&doc, "First").unwrap().text, "First paragraph\u{a0}with a non-breaking space and an anchor.");
    let ch1 = &doc.sections[1].blocks;
    let fig = ch1.iter().find_map(|b| if let Block::Figure(f) = b { Some(f) } else { None }).unwrap();
    assert_eq!(fig.images[0].alt, "A plate");
    assert_eq!(fig.caption.as_ref().unwrap().leaf.text, "Plate one.");
    let verse = find_leaf(&doc, "Line one").unwrap();
    assert_eq!(verse.text, "Line one\nline two");
    let verse_block = ch1.iter().find(|b| b.leaf().map(|l| l.text.starts_with("Line one")).unwrap_or(false)).unwrap();
    assert!(matches!(verse_block, Block::Paragraph(p) if p.variant == Some(ParagraphVariant::Verse)));
    let list = ch1.iter().find_map(|b| if let Block::List(l) = b { Some(l) } else { None }).unwrap();
    assert_eq!(list.items.len(), 2);
    assert!(list.items[0].blocks.iter().any(|b| matches!(b, Block::List(_))));
    assert!(!doc.sections.iter().flat_map(|s| leaves(&s.blocks)).any(|l| l.text == "12"));
    let table = ch1.iter().find_map(|b| if let Block::Table(t) = b { Some(t) } else { None }).unwrap();
    assert!(table.rows[0].header);
    assert_eq!(table.rows[1].cells[0].leaf.text, "cell");
    assert_eq!(table.rows[1].cells[0].rowspan, Some(2));
    let code = doc.sections[2].blocks.iter().find_map(|b| if let Block::Code(c) = b { Some(c) } else { None }).unwrap();
    assert_eq!(code.lang.as_deref(), Some("py"));
    assert_eq!(code.leaf.text, "x  = 1\n  y = 2");
    assert!(doc.sections[2].blocks.iter().any(|b| matches!(b, Block::Blockquote(_))));
}

#[test]
fn epub_links_notes_and_scripts() {
    let doc = parse_epub(&book_with_everything(), &ingest_ctx(None, "test.epub")).unwrap();
    let see = find_leaf(&doc, "See the later passage").unwrap();
    let target = find_leaf(&doc, "The later passage itself.").unwrap();
    let internal = see.content.iter().find_map(|c| if let Inline::Link(l) = c { if let LinkTarget::Internal { section_id, block_id } = &l.target { Some((section_id.clone(), block_id.clone())) } else { None } } else { None }).unwrap();
    assert_eq!(internal, (doc.sections[4].id.clone(), target.id.clone()));
    let external = see.content.iter().find_map(|c| if let Inline::Link(l) = c { if let LinkTarget::External { url } = &l.target { Some(url.clone()) } else { None } } else { None }).unwrap();
    assert_eq!(external, "https://example.com/x");
    assert_eq!(find_leaf(&doc, "no script").unwrap().text, "An endnote here. And no script.");
    let bad = find_leaf(&doc, "bad link").unwrap();
    assert!(!bad.content.iter().any(|c| matches!(c, Inline::Link(_))));

    let ch2 = &doc.sections[2];
    assert_eq!(ch2.notes.iter().map(|n| (n.label.clone(), first_leaf(&n.blocks).unwrap().text.clone())).collect::<Vec<_>>(), vec![("1".to_string(), "An in-file footnote.".to_string())]);
    assert!(!leaves(&ch2.blocks).iter().any(|l| l.text.contains("in-file footnote")));
    let ch3 = &doc.sections[4];
    assert_eq!(ch3.notes.iter().map(|n| first_leaf(&n.blocks).unwrap().text.clone()).collect::<Vec<_>>(), vec!["2. An endnote from a non-linear file."]);
    let r = find_leaf(&doc, "An endnote here").unwrap().content.iter().find_map(|c| if let Inline::NoteRef(r) = c { Some(r) } else { None }).unwrap();
    assert_eq!(r.label, "2");
    assert_eq!(r.note_id, ch3.notes[0].id);
    assert!(!doc.sections.iter().flat_map(|s| s.notes.iter()).any(|n| first_leaf(&n.blocks).map(|l| l.text.contains("Never cited")).unwrap_or(false)));
}

#[test]
fn epub_splits_files_at_toc_fragments_ncx() {
    let epub = make_epub(EpubSpec {
        title: "Two Per File".into(),
        ncx: true,
        files: vec![file("a.xhtml", "<h2 id=\"c1\">One</h2><p>first</p><h2 id=\"c2\">Two</h2><p>second</p>"), file("b.xhtml", "<h2 id=\"c3\">Three</h2><p>third</p>")],
        toc: Some(vec![toc("CHAPTER I.", "a.xhtml#c1"), toc("CHAPTER II.", "a.xhtml#c2"), toc("An illustration caption. CHAPTER III.", "b.xhtml#c3")]),
        ..Default::default()
    });
    let doc = parse_epub(&epub, &ingest_ctx(None, "t.epub")).unwrap();
    assert_eq!(doc.sections.iter().map(|s| s.title.clone()).collect::<Vec<_>>(), vec!["Chapter I", "Chapter II", "Chapter III"]);
    assert_eq!(validate_document(&doc), Vec::<String>::new());
}

#[test]
fn epub_refuses_drm_non_epubs_and_empty_books() {
    let ctx = ingest_ctx(None, "x.epub");
    let drm = make_epub(EpubSpec { title: "x".into(), drm: true, files: vec![file("a.xhtml", "<p>x</p>")], ..Default::default() });
    assert_eq!(parse_epub(&drm, &ctx).unwrap_err().code, "drm_protected");
    assert_eq!(parse_epub(b"not a zip", &ctx).unwrap_err().code, "not_epub");
    let empty = make_epub(EpubSpec { title: "x".into(), files: vec![nonlinear("a.xhtml", "")], ..Default::default() });
    assert_eq!(parse_epub(&empty, &ctx).unwrap_err().code, "empty_document");
}

#[test]
fn gutenberg_samples_are_golden() {
    let dir = fixtures().join("epub");
    let golden: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("golden.json")).unwrap()).unwrap();
    let parser_version = golden["parserVersion"].as_u64().unwrap() as u32;
    for (name, want) in golden["books"].as_object().unwrap() {
        let bytes = std::fs::read(dir.join(name)).unwrap();
        let doc = parse_epub(&bytes, &ingest_ctx(None, name)).unwrap();
        assert_eq!(validate_document(&doc), Vec::<String>::new(), "{name}");
        assert_eq!(validate_render(&doc), Vec::<String>::new(), "{name}");
        assert_eq!(doc.sections.len() as u64, want["sections"].as_u64().unwrap(), "{name}: sections");
        assert_eq!(doc.sections[0].title, want["first"].as_str().unwrap(), "{name}");
        assert_eq!(doc.sections.last().unwrap().title, want["last"].as_str().unwrap(), "{name}");
        let chapter_titles: Vec<&str> = want["chapterTitles"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
        let found: Vec<String> = doc.sections.iter().map(|s| s.title.clone()).filter(|t| chapter_titles.contains(&t.as_str())).collect();
        assert_eq!(found, chapter_titles, "{name}: chapter titles");
        let idx = DocIndex::new(doc, &"x".repeat(20));
        let hash = sha256_hex(from_u16(idx.text()).as_bytes());
        if Format::Epub.parser_version() == parser_version {
            assert_eq!(hash, want["textHash"].as_str().unwrap(), "{name}: EPUB text changed: bump the parser version and update golden.json");
        }
    }
}

// ---- Markdown ----

fn parse_fixture() -> ParsedDocument {
    let dir = temp_dir("pager-md-");
    std::fs::copy(fixtures().join("md/everything.md"), dir.join("everything.md")).unwrap();
    std::fs::write(dir.join("pixel.png"), png_1px()).unwrap();
    let text = std::fs::read_to_string(dir.join("everything.md")).unwrap();
    parse_markdown(&text, &ingest_ctx(Some(&dir), "everything.md")).unwrap()
}

fn find<'a>(blocks: &'a [Block], text: &str) -> Option<&'a Leaf> {
    leaves(blocks).into_iter().find(|l| l.text.contains(text))
}

#[test]
fn markdown_fixture_is_read_faithfully() {
    let doc = parse_fixture();
    let blocks = &doc.sections[0].blocks;
    assert_eq!(validate_document(&doc), Vec::<String>::new());
    assert_eq!(validate_render(&doc), Vec::<String>::new());
    // front matter
    assert_eq!(doc.meta.title, "Everything: a test");
    assert_eq!(doc.meta.authors, vec!["Ada Lovelace", "Charles Babbage"]);
    assert_eq!(doc.meta.language.as_deref(), Some("en-GB"));
    assert_eq!(doc.meta.published_at.as_deref(), Some("1843-10-01"));
    // headings
    let hs: Vec<(u8, String)> = blocks.iter().filter_map(|b| if let Block::Heading(h) = b { Some((h.level, h.leaf.text.clone())) } else { None }).collect();
    assert_eq!(hs, vec![(1, "Setext Title".into()), (2, "Sub heading".into())]);
    // inline marks, links and breaks
    let p = find(blocks, "Intro with").unwrap();
    assert!(p.text.contains("Intro with emphasis, strong, both, gone, code, a link, a reference link,"));
    let marks: Vec<(String, String)> = p.content.iter().filter_map(|c| if let Inline::Text(t) = c { Some((t.text.clone(), t.marks.as_ref().map(|m| m.iter().map(|x| format!("{x:?}").to_lowercase()).collect::<Vec<_>>().join("+")).unwrap_or_default())) } else { None }).collect();
    assert!(marks.contains(&("emphasis".into(), "em".into())));
    assert!(marks.contains(&("both".into(), "em+strong".into())));
    assert!(marks.contains(&("gone".into(), "strike".into())));
    assert!(marks.contains(&("code".into(), "code".into())));
    assert!(marks.contains(&("superscript".into(), "sup".into())));
    assert!(marks.contains(&("2".into(), "sub".into())));
    let links: Vec<String> = p.content.iter().filter_map(|c| if let Inline::Link(l) = c { if let LinkTarget::External { url } = &l.target { Some(url.clone()) } else { None } } else { None }).collect();
    assert_eq!(links, vec!["https://example.com/", "https://example.org/ref", "https://auto.example.org/"]);
    assert_eq!(find(blocks, "Line one").unwrap().text, "Line one with a hard break\nline two after it.");
    // lists
    let lists: Vec<&ListBlock> = blocks.iter().filter_map(|b| if let Block::List(l) = b { Some(l) } else { None }).collect();
    assert_eq!(lists.len(), 3);
    assert!(lists[0].ordered);
    assert_eq!(lists[0].items.len(), 3);
    let nested = lists[0].items[1].blocks.iter().find_map(|b| if let Block::List(l) = b { Some(l) } else { None }).unwrap();
    assert_eq!(nested.items[1].blocks.len(), 2);
    assert_eq!(lists[1].start, Some(5));
    assert_eq!(lists[2].items.iter().map(|i| i.checked).collect::<Vec<_>>(), vec![Some(false), Some(true)]);
    // quotes and callouts
    let q = blocks.iter().find_map(|b| if let Block::Blockquote(q) = b { Some(q) } else { None }).unwrap();
    assert!(q.blocks.iter().any(|b| matches!(b, Block::Blockquote(_))));
    let callout = blocks.iter().find_map(|b| if let Block::Aside(a) = b { Some(a) } else { None }).unwrap();
    assert_eq!(callout.variant, "warning");
    assert_eq!(callout.title.as_deref(), Some("Careful now"));
    assert_eq!(leaves(&callout.blocks)[0].text, "Callout body.");
    // tables
    let t = blocks.iter().find_map(|b| if let Block::Table(t) = b { Some(t) } else { None }).unwrap();
    assert!(t.rows[0].header);
    assert_eq!(t.rows[0].cells.iter().map(|c| c.cell_align).collect::<Vec<_>>(), vec![Some(CellAlign::Left), Some(CellAlign::Center), Some(CellAlign::Right)]);
    let z = &t.rows[2].cells[2];
    assert!(matches!(&z.leaf.content[0], Inline::Link(l) if matches!(l.target, LinkTarget::Internal { .. })));
    // code
    let code: Vec<(Option<String>, String)> = blocks.iter().filter_map(|b| if let Block::Code(c) = b { Some((c.lang.clone(), c.leaf.text.clone())) } else { None }).collect();
    assert_eq!(code, vec![(Some("js".into()), "function hi() {\n  return  \"spaced\";\n}".into()), (None, "indented code".into())]);
    // footnotes
    let p = find(blocks, "A paragraph with a footnote").unwrap();
    let refs: Vec<String> = p.content.iter().filter_map(|c| if let Inline::NoteRef(r) = c { Some(r.label.clone()) } else { None }).collect();
    assert_eq!(refs, vec!["1", "2", "1"]);
    assert_eq!(p.text, "A paragraph with a footnote and another, and the first again. Jump to the sub heading or nowhere or a file.");
    let notes = &doc.sections[0].notes;
    assert_eq!(notes.iter().map(|n| n.label.clone()).collect::<Vec<_>>(), vec!["1", "2"]);
    assert_eq!(leaves(&notes[1].blocks).iter().map(|l| l.text.clone()).collect::<Vec<_>>(), vec!["The second note.", "With an indented second paragraph."]);
    // heading links
    let jump = find(blocks, "Jump to").unwrap();
    let links: Vec<&LinkInline> = jump.content.iter().filter_map(|c| if let Inline::Link(l) = c { Some(l) } else { None }).collect();
    assert_eq!(links.len(), 1);
    let sub = blocks.iter().find_map(|b| if let Block::Heading(h) = b { if h.leaf.text == "Sub heading" { Some(h) } else { None } } else { None }).unwrap();
    assert!(matches!(&links[0].target, LinkTarget::Internal { block_id, .. } if *block_id == sub.leaf.id));
    // raw html
    let raw = find(blocks, "Raw HTML block").unwrap();
    assert_eq!(raw.align, Some(Align::Center));
    assert!(raw.content.iter().any(|c| matches!(c, Inline::Text(t) if t.text == "HTML" && t.marks.as_ref().map(|m| m.contains(&Mark::Strong)).unwrap_or(false))));
    assert!(!leaves(blocks).iter().any(|l| l.text.contains("comment")));
    // images
    let fig = blocks.iter().find_map(|b| if let Block::Figure(f) = b { Some(f) } else { None }).unwrap();
    assert_eq!(fig.images[0].alt, "A pixel");
    assert_eq!(fig.images[0].title.as_deref(), Some("Pixel title"));
    assert!(fig.images[0].src.starts_with("/api/assets/") && fig.images[0].src.ends_with(".png"));
    let inl = find(blocks, "Inline image").unwrap();
    assert!(inl.content.iter().any(|c| matches!(c, Inline::Image(i) if i.image.remote && i.image.src == "https://example.com/x.png")));
    assert_eq!(doc.assets.len(), 1);
    // deterministic
    assert_eq!(parse_fixture(), doc);
}

#[test]
fn markdown_ids_follow_text() {
    let ctx = ingest_ctx(None, "t.md");
    let a = parse_markdown("# T\n\nOne.\n\nTwo.\n\nThree.\n", &ctx).unwrap();
    let b = parse_markdown("# T\n\nOne.\n\nInserted.\n\nTwo.\n\nThree, edited.\n", &ctx).unwrap();
    let ida: std::collections::HashMap<String, String> = leaves(&a.sections[0].blocks).iter().map(|l| (l.text.clone(), l.id.clone())).collect();
    let idb: std::collections::HashMap<String, String> = leaves(&b.sections[0].blocks).iter().map(|l| (l.text.clone(), l.id.clone())).collect();
    assert_eq!(idb["One."], ida["One."]);
    assert_eq!(idb["Two."], ida["Two."]);
    assert_ne!(idb["Three, edited."], ida["Three."]);
    let d = parse_markdown("Yes.\n\nNo.\n\nYes.\n", &ctx).unwrap();
    let ids: Vec<String> = leaves(&d.sections[0].blocks).iter().map(|l| l.id.clone()).collect();
    assert_eq!(ids.iter().collect::<std::collections::HashSet<_>>().len(), 3);
    assert_eq!(ids[2], format!("{}-2", ids[0]));
}

#[test]
fn markdown_splits_long_documents() {
    let ctx = ingest_ctx(None, "t.md");
    let para = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(40);
    let long = ["# Book", "", &para, "", "## One", "", &para.repeat(5), "", "## Two", "", &para.repeat(5), "", "## Three", "", &para.repeat(5)].join("\n");
    let d = parse_markdown(&long, &ctx).unwrap();
    assert_eq!(d.sections.iter().map(|s| s.title.clone()).collect::<Vec<_>>(), vec!["Book", "One", "Two", "Three"]);
    assert_eq!(validate_document(&d), Vec::<String>::new());
    let short = parse_markdown("# A\n\ntext\n\n## B\n\ntext\n\n## C\n\ntext", &ctx).unwrap();
    assert_eq!(short.sections.len(), 1);
    let para = "Words upon words upon words, and then some more words to fill a line. ";
    let big: String = (0..2500).map(|i| format!("{para} {i}.")).collect::<Vec<_>>().join("\n\n");
    let d = parse_markdown(&big, &ctx).unwrap();
    assert!(d.sections.len() > 3);
    assert!(d.sections[1..].iter().all(|s| s.synthetic));
    assert_eq!(validate_document(&d), Vec::<String>::new());
}

#[test]
fn front_matter_subset() {
    let fm = parse_front_matter("title: \"A: B\"\nauthor: X and Y\ntags: [a, b]\nlist:\n  - one\n  - two\n");
    assert_eq!(fm["title"], FrontValue::Str("A: B".into()));
    assert_eq!(fm["author"], FrontValue::Str("X and Y".into()));
    assert_eq!(fm["tags"], FrontValue::List(vec!["a".into(), "b".into()]));
    assert_eq!(fm["list"], FrontValue::List(vec!["one".into(), "two".into()]));
}

// ---- Plain text ----

fn prose(n: usize) -> String {
    (0..n).map(|i| format!("It was a long paragraph number {i}, wrapped\nat seventy columns the way old texts are, and it goes on for a while\nbefore it stops.")).collect::<Vec<_>>().join("\n\n")
}

fn gutenberg() -> String {
    [
        "The Project Gutenberg eBook of A Test Book",
        "",
        "Title: A Test Book",
        "Author: Jane Doe and John Roe",
        "Release date: May 1, 1998 [eBook #9999]",
        "Original publication: London: Someone, 1847.",
        "Language: English",
        "",
        "*** START OF THE PROJECT GUTENBERG EBOOK A TEST BOOK ***",
        "",
        "                         A TEST BOOK",
        "",
        "CHAPTER I.",
        "The Beginning",
        "",
        &prose(120),
        "",
        "        Roses are red,",
        "        violets are blue,",
        "        this is centred.",
        "",
        "The rain it raineth",
        "every day upon",
        "the just and unjust",
        "",
        "* * *",
        "",
        "- apples",
        "- pears",
        "",
        "Part of me wanted to go.",
        "",
        "CHAPTER II.",
        "",
        &prose(120),
        "",
        "*** END OF THE PROJECT GUTENBERG EBOOK A TEST BOOK ***",
        "",
        "Updated editions will replace the previous one.",
    ]
    .join("\n")
}

#[test]
fn plain_text_structure() {
    let doc = parse_text(&gutenberg(), &ingest_ctx(None, "test.txt"));
    assert_eq!(validate_document(&doc), Vec::<String>::new());
    assert_eq!(validate_render(&doc), Vec::<String>::new());
    assert_eq!(doc.meta.title, "A Test Book");
    assert_eq!(doc.meta.authors, vec!["Jane Doe", "John Roe"]);
    assert_eq!(doc.meta.language.as_deref(), Some("en"));
    assert_eq!(doc.meta.published_at.as_deref(), Some("1847"));
    assert_eq!(doc.sections[0].title, "Project Gutenberg header");
    assert_eq!(doc.sections.last().unwrap().title, "Project Gutenberg licence");
    let titles: Vec<String> = doc.sections.iter().map(|s| s.title.clone()).collect();
    assert!(titles.contains(&"CHAPTER I.\nThe Beginning".to_string()));
    assert!(titles.contains(&"CHAPTER II.".to_string()));
    let all: Vec<&Block> = doc.sections.iter().flat_map(|s| s.blocks.iter()).collect();
    let lv: Vec<&Leaf> = doc.sections.iter().flat_map(|s| leaves(&s.blocks)).collect();
    assert!(lv.iter().any(|l| l.text == "It was a long paragraph number 0, wrapped at seventy columns the way old texts are, and it goes on for a while before it stops."));
    let centred = lv.iter().find(|l| l.text.starts_with("Roses")).unwrap();
    assert_eq!(centred.align, Some(Align::Center));
    assert_eq!(centred.text, "Roses are red,\nviolets are blue,\nthis is centred.");
    let rain = all.iter().find(|b| b.leaf().map(|l| l.text.starts_with("The rain")).unwrap_or(false)).unwrap();
    assert!(matches!(rain, Block::Paragraph(p) if p.variant == Some(ParagraphVariant::Verse) && p.leaf.text == "The rain it raineth\nevery day upon\nthe just and unjust"));
    assert!(all.iter().any(|b| matches!(b, Block::Hr(_))));
    assert!(all.iter().any(|b| matches!(b, Block::List(l) if l.items.len() == 2)));
    assert!(all.iter().any(|b| matches!(b, Block::Paragraph(p) if p.leaf.text == "Part of me wanted to go.")));
    assert!(all.iter().any(|b| matches!(b, Block::Heading(h) if h.leaf.text == "A TEST BOOK" && h.leaf.align == Some(Align::Center))));
    let first = leaves(&doc.sections[1].blocks)[0];
    assert_eq!(first.line, Some(11));
    assert!(is_heading_line("CHAPTER XII."));
    assert!(is_heading_line("Chapter 3: The Ball"));
    assert!(!is_heading_line("Part of me wanted to go."));
    assert!(is_heading_line("Book the First"));
}

#[test]
fn bylines() {
    let doc = parse_text("THE GIFT OF THE MAGI\n\nby O. Henry (1905)\n\nOne dollar and eighty-seven cents. That was all.", &ingest_ctx(None, "magi.txt"));
    assert_eq!(doc.meta.title, "The Gift of the Magi");
    assert_eq!(doc.meta.authors, vec!["O. Henry"]);
    assert_eq!(doc.meta.published_at.as_deref(), Some("1905"));
    assert!(doc.sections.iter().flat_map(|s| leaves(&s.blocks)).any(|l| l.text == "by O. Henry (1905)"));
}

#[test]
fn decoding_and_detection() {
    assert_eq!(decode_text("café\r\nnext".as_bytes()), ("café\nnext".to_string(), "utf-8"));
    assert_eq!(decode_text("\u{feff}café".as_bytes()).0, "café");
    let mut le = vec![0xff, 0xfe];
    for u in "naïve\r\n".encode_utf16() {
        le.extend_from_slice(&u.to_le_bytes());
    }
    assert_eq!(decode_text(&le), ("naïve\n".to_string(), "utf-16le"));
    assert_eq!(decode_text(&[0x63, 0x61, 0x66, 0xe9, 0x20, 0x93, 0x71, 0x94]), ("café “q”".to_string(), "windows-1252"));
    assert_eq!(detect_format(b"%PDF-1.7", "x.pdf"), DetectedFormat::Pdf);
    assert_eq!(detect_format(b"# hi", "notes.md"), DetectedFormat::Known(Format::Md));
    assert_eq!(detect_format(b"<!DOCTYPE html><p>x", "page"), DetectedFormat::Known(Format::Html));
    assert_eq!(detect_format(b"plain words", "README"), DetectedFormat::Known(Format::Txt));
    assert_eq!(detect_format(&[0, 1, 2, 3], "blob.bin"), DetectedFormat::Unknown);
    assert_eq!(detect_format(b"plain", "photo.jpg"), DetectedFormat::Unknown);
}

// ---- Standalone HTML ----

const PAGE: &str = r##"<!doctype html><html lang="fr"><head><title>Site name | An Article</title>
<meta property="og:title" content="An Article"><meta name="author" content="Jo Writer">
<meta property="article:published_time" content="2024-05-06T07:08:09Z">
<style>body{color:red}</style><script>window.evil = 1</script></head>
<body><header><nav><a href="/">Home</a></nav></header>
<main><article>
<h1>An Article</h1>
<p onclick="steal()">Hello <q>quoted</q> <ruby>漢<rt>kan</rt></ruby> <math alttext="x^2"><mi>x</mi></math> &amp; <a href="javascript:steal()">no</a> <a href="#sec2">jump</a>.</p>
<img src="pic.png" alt="Local picture"><iframe src="https://ads.example"></iframe>
<dl><dt>Term</dt><dd>Definition.</dd></dl>
<figure><blockquote><p>A quote in a figure.</p></blockquote><figcaption>Someone</figcaption></figure>
<h2 id="sec2">Second</h2><center>Old centring</center>
<aside class="note"><p>Side note.</p></aside>
<pre class="lang-sh">$ echo  hi</pre>
</article></main><footer>© Site</footer></body></html>"##;

#[test]
fn standalone_html() {
    let dir = temp_dir("pager-html-");
    std::fs::write(dir.join("pic.png"), png_1px()).unwrap();
    let doc = parse_html_document(PAGE, &ingest_ctx(Some(&dir), "saved.html"));
    assert_eq!(validate_document(&doc), Vec::<String>::new());
    assert_eq!(validate_render(&doc), Vec::<String>::new());
    assert_eq!(doc.meta.title, "An Article");
    assert_eq!(doc.meta.authors, vec!["Jo Writer"]);
    assert_eq!(doc.meta.language.as_deref(), Some("fr"));
    assert_eq!(doc.meta.published_at.as_deref(), Some("2024-05-06T07:08:09Z"));
    let blocks = &doc.sections[0].blocks;
    let texts: Vec<String> = leaves(blocks).iter().map(|l| l.text.clone()).collect();
    assert!(!texts.contains(&"Home".to_string()));
    assert!(!texts.iter().any(|t| t.contains('©')));
    let hello = leaves(blocks).into_iter().find(|l| l.text.starts_with("Hello")).unwrap();
    assert_eq!(hello.text, "Hello “quoted” 漢 x^2 & no jump.");
    let links: Vec<&LinkInline> = hello.content.iter().filter_map(|c| if let Inline::Link(l) = c { Some(l) } else { None }).collect();
    assert_eq!(links.len(), 1);
    assert!(matches!(links[0].target, LinkTarget::Internal { .. }));
    assert!(blocks.iter().any(|b| matches!(b, Block::Figure(f) if f.images[0].alt == "Local picture")));
    assert!(texts.contains(&"Term".to_string()));
    let term = leaves(blocks).into_iter().find(|l| l.text == "Term").unwrap();
    assert!(matches!(&term.content[0], Inline::Text(t) if t.marks == Some(vec![Mark::Strong])));
    assert!(texts.contains(&"A quote in a figure.".to_string()));
    assert_eq!(leaves(blocks).into_iter().find(|l| l.text == "Old centring").unwrap().align, Some(Align::Center));
    assert!(blocks.iter().any(|b| matches!(b, Block::Aside(a) if a.variant == "note")));
    assert!(blocks.iter().any(|b| matches!(b, Block::Code(c) if c.lang.as_deref() == Some("sh") && c.leaf.text == "$ echo  hi")));
    assert!(doc.warnings.contains(&"Some equations are shown as plain text.".to_string()));

    let doc = parse_html_document("<html><body><nav>menu</nav><p>One</p><article><p>A</p></article><article><p>B</p></article><footer>foot</footer></body></html>", &ingest_ctx(None, "x.html"));
    assert_eq!(leaves(&doc.sections[0].blocks).iter().map(|l| l.text.clone()).collect::<Vec<_>>(), vec!["One", "A", "B"]);
}

// ---- DOCX ----

#[test]
fn docx_keeps_styles_as_structure() {
    let body = [
        p("The Report", POpts { style: Some("Title"), ..Default::default() }),
        p("Introduction", POpts { style: Some("Heading1"), ..Default::default() }),
        p("", POpts { runs: Some(format!("{}{}{}{}{}{}", r("Plain then ", false, false), r("bold", true, false), r(" and ", false, false), r("italic", false, true), r(".", false, false), footnote_ref(1))), ..Default::default() }),
        p("bullet one", POpts { num: Some((1, 0)), ..Default::default() }),
        p("nested bullet", POpts { num: Some((1, 1)), ..Default::default() }),
        p("bullet two", POpts { num: Some((1, 0)), ..Default::default() }),
        p("step one", POpts { num: Some((2, 0)), ..Default::default() }),
        p("step two", POpts { num: Some((2, 0)), ..Default::default() }),
        table(&[vec!["spans two"], vec!["a", "b"]], Some(0)),
        p("Wise words.", POpts { style: Some("Quote"), ..Default::default() }),
        p("Centred.", POpts { jc: Some("center"), ..Default::default() }),
        p("", POpts { runs: Some(image("rImg0", "A pixel")), ..Default::default() }),
        p("Details", POpts { style: Some("Heading2"), ..Default::default() }),
    ]
    .join("");
    let bytes = make_docx(DocxSpec { body, footnotes: vec![(1, "A footnote in Word.".into())], title: "The Report".into(), creator: "R. Author; S. Second".into(), images: vec![("p.png".into(), png_1px())] });
    let doc = parse_docx(&bytes, &ingest_ctx(None, "report.docx")).unwrap();
    assert_eq!(validate_document(&doc), Vec::<String>::new());
    assert_eq!(validate_render(&doc), Vec::<String>::new());
    assert_eq!(doc.meta.title, "The Report");
    assert_eq!(doc.meta.authors, vec!["R. Author", "S. Second"]);
    assert_eq!(doc.meta.published_at.as_deref(), Some("2025-03-04"));
    let blocks = &doc.sections[0].blocks;
    let hs: Vec<(u8, String)> = blocks.iter().filter_map(|b| if let Block::Heading(h) = b { Some((h.level, h.leaf.text.clone())) } else { None }).collect();
    assert_eq!(hs, vec![(1, "The Report".into()), (1, "Introduction".into()), (2, "Details".into())]);
    let para = leaves(blocks).into_iter().find(|l| l.text.starts_with("Plain then")).unwrap();
    assert_eq!(para.text, "Plain then bold and italic.");
    assert!(para.content.iter().any(|c| matches!(c, Inline::Text(t) if t.text == "bold" && t.marks.as_ref().map(|m| m.contains(&Mark::Strong)).unwrap_or(false))));
    assert!(para.content.iter().any(|c| matches!(c, Inline::NoteRef(r) if r.label == "1")));
    assert_eq!(doc.sections[0].notes.iter().map(|n| leaves(&n.blocks)[0].text.clone()).collect::<Vec<_>>(), vec!["A footnote in Word."]);
    let lists: Vec<&ListBlock> = blocks.iter().filter_map(|b| if let Block::List(l) = b { Some(l) } else { None }).collect();
    assert_eq!(lists.iter().map(|l| l.ordered).collect::<Vec<_>>(), vec![false, true]);
    assert!(lists[0].items[0].blocks.iter().any(|b| matches!(b, Block::List(_))));
    let t = blocks.iter().find_map(|b| if let Block::Table(t) = b { Some(t) } else { None }).unwrap();
    assert_eq!(t.rows[0].cells[0].leaf.text, "spans two");
    assert_eq!(t.rows[0].cells[0].colspan, Some(2));
    assert!(blocks.iter().any(|b| matches!(b, Block::Blockquote(_))));
    assert_eq!(leaves(blocks).into_iter().find(|l| l.text == "Centred.").unwrap().align, Some(Align::Center));
    assert!(blocks.iter().any(|b| matches!(b, Block::Figure(f) if f.images[0].alt == "A pixel")));
    assert_eq!(doc.assets.len(), 1);
}

#[test]
fn docx_reads_a_libreoffice_file_and_refuses_others() {
    let bytes = std::fs::read(fixtures().join("docx/libreoffice.docx")).unwrap();
    let doc = parse_docx(&bytes, &ingest_ctx(None, "t.docx")).unwrap();
    assert_eq!(validate_document(&doc), Vec::<String>::new());
    assert_eq!(doc.meta.title, "Doc Title");
    assert!(leaves(&doc.sections[0].blocks).iter().any(|l| l.text == "Heading One"));
    assert_eq!(parse_docx(b"nope", &ingest_ctx(None, "x.docx")).unwrap_err().code, "unsupported");
}
