mod common;

use common::*;
use pager_server::anchoring::doctext::DocIndex;
use pager_server::anchoring::matcher::{appears_once, locate};
use pager_server::anchoring::normalise::similarity;
use pager_server::anchoring::selectors::selectors_for_span;
use pager_server::ingest::markdown::parse_markdown;
use pager_server::model::AnchorStatus;
use pager_server::util::utf16::{from_u16, to_u16};
use std::sync::atomic::{AtomicUsize, Ordering};

static REV: AtomicUsize = AtomicUsize::new(0);

fn index(paras: &[String]) -> DocIndex {
    let text = paras.join("\n\n");
    let doc = parse_markdown(&text, &ingest_ctx(None, "t.md")).unwrap();
    let n = REV.fetch_add(1, Ordering::SeqCst);
    DocIndex::new(doc, &format!("rev{n:017}"))
}

fn at(idx: &DocIndex, needle: &str, nth: usize) -> usize {
    let t = idx.text();
    let n = to_u16(needle);
    let mut from = 0;
    let mut i = 0;
    loop {
        let pos = pager_server::util::utf16::find16(t, &n, from).expect("needle present");
        if i == nth {
            return pos;
        }
        i += 1;
        from = pos + 1;
    }
}

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

#[test]
fn does_not_follow_a_repeated_paragraphs_id_onto_the_wrong_copy() {
    let a = index(&s(&["Intro words here for context.", "Yes.", "Some middle text between them.", "Yes.", "Closing words at the end."]));
    let second = at(&a, "Yes.", 1);
    let sel = selectors_for_span(&a, second, second + 4).unwrap();
    let b = index(&s(&["Yes.", "Intro words here for context.", "Yes.", "Some middle text between them.", "Yes.", "Closing words at the end."]));
    let found = locate(&sel, a.length(), &b).unwrap();
    assert_eq!(found.doc_start, at(&b, "Yes.", 2));
}

#[test]
fn survives_typographic_changes() {
    let a = index(&s(&["She said “don’t go”—and then left the room quietly."]));
    let q = "“don’t go”—and then left";
    let st = at(&a, q, 0);
    let sel = selectors_for_span(&a, st, st + to_u16(q).len()).unwrap();
    let b = index(&s(&["She said \"don't go\" -- and then left the room quietly."]));
    let found = locate(&sel, a.length(), &b).unwrap();
    assert_ne!(found.status, AnchorStatus::Orphaned);
    assert_eq!(b.slice(found.doc_start, found.doc_end), "\"don't go\" -- and then left");
}

#[test]
fn orphans_a_deleted_paragraph() {
    let a = index(&s(&["Keep this paragraph about rivers and fields.", "The lantern swung in the orchard wind all night.", "Another paragraph that stays."]));
    let q = "lantern swung in the orchard";
    let st = at(&a, q, 0);
    let sel = selectors_for_span(&a, st, st + q.len()).unwrap();
    let b = index(&s(&["Keep this paragraph about rivers and fields.", "Another paragraph that stays."]));
    assert!(locate(&sel, a.length(), &b).is_none());
}

#[test]
fn finds_a_long_passage_whose_middle_was_rewritten() {
    let long = "It was the kind of evening that seems to go on forever, the light lying low across the fields and the river holding the colour of the sky long after the sun had gone. ".repeat(4).trim().to_string();
    let a = index(&s(&["Opening line.", &long, "Closing line."]));
    let st = at(&a, &long, 0);
    let sel = selectors_for_span(&a, st, st + long.len()).unwrap();
    let edited = long.replacen("holding the colour of the sky long after", "keeping the colour of the evening sky well after", 1);
    let b = index(&s(&["Opening line.", &edited, "Closing line."]));
    let found = locate(&sel, a.length(), &b).unwrap();
    assert_eq!(found.status, AnchorStatus::Fuzzy);
    assert_eq!(found.doc_start, at(&b, &edited, 0));
    assert!((found.doc_end as i64 - (at(&b, &edited, 0) + edited.len()) as i64).abs() <= 3);
}

#[test]
fn keeps_a_bookmark_when_text_before_it_is_deleted() {
    let a = index(&s(&["First paragraph that will go away entirely.", "Second paragraph, where the reader stopped.", "Third."]));
    let st = at(&a, "Second paragraph", 0);
    let sel = selectors_for_span(&a, st, st).unwrap();
    let b = index(&s(&["Second paragraph, where the reader stopped.", "Third."]));
    assert_eq!(locate(&sel, a.length(), &b).unwrap().doc_start, 0);
}

// ---- A small property check with a deterministic generator (in place of fast-check) ----

const VOCAB: &str = "the a of and to in was he it with as his on be at by had for not but what all were when we there can an your which their said if do will each about how up out them then she many some so these would other into has more her two like him see time could no make than first been its who now people my made over did down only way find use may water long little very after words called just where most know get through back much before go good new write our used me man too any day same right look think also around another came come work three word must because does part even place well such here take why things help put years different away again off went old number great tell men say small every found still between name should home big give air line set own under read last never us left end along while might next sound below saw something thought both few those always looked show large often together don’t isn’t “quoted” well— —then heron river lantern orchard";

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

fn sentence(rng: &mut Rng, words: &[&str]) -> String {
    let n = 5 + rng.below(36);
    let s: Vec<&str> = (0..n).map(|_| words[rng.below(words.len())]).collect();
    let s = s.join(" ");
    let mut c = s.chars();
    let first: String = c.next().unwrap().to_uppercase().collect();
    format!("{first}{}.", c.as_str())
}

/// Characters of the document text are tagged by their original index; edits keep tags on surviving characters.
fn tagged_text(paras: &[Vec<(char, Option<usize>)>]) -> Vec<String> {
    paras.iter().map(|p| p.iter().map(|(c, _)| *c).collect()).collect()
}

fn positions(paras: &[Vec<(char, Option<usize>)>]) -> std::collections::HashMap<usize, usize> {
    let mut m = std::collections::HashMap::new();
    let mut pos = 0;
    for (i, p) in paras.iter().enumerate() {
        if i > 0 {
            pos += 1;
        }
        for (c, tag) in p {
            if let Some(t) = tag {
                m.insert(*t, pos);
            }
            pos += c.len_utf16();
        }
    }
    m
}

#[test]
fn follows_exact_text_through_edits_elsewhere_and_finds_it_unchanged() {
    let words: Vec<&str> = VOCAB.split(' ').collect();
    let mut rng = Rng(20261025);
    let mut checked = 0;
    for _ in 0..150 {
        let n = 5 + rng.below(26);
        let paras: Vec<String> = (0..n).map(|_| sentence(&mut rng, &words)).collect();
        let mut tag = 0;
        let doc: Vec<Vec<(char, Option<usize>)>> = paras
            .iter()
            .map(|p| {
                p.chars()
                    .map(|c| {
                        let t = tag;
                        tag += 1;
                        (c, Some(t))
                    })
                    .collect()
            })
            .collect();
        let before = index(&tagged_text(&doc));
        // A word-aligned range inside one paragraph.
        let p = rng.below(doc.len());
        let text: String = doc[p].iter().map(|(c, _)| *c).collect();
        let bounds: Vec<usize> = std::iter::once(0).chain(text.match_indices(' ').map(|(i, _)| i + 1)).collect();
        let si = rng.below(bounds.len());
        let start = bounds[si];
        let end_word = (si + 2 + rng.below(10)).min(bounds.len() - 1);
        let end = if end_word + 1 < bounds.len() { bounds[end_word + 1] - 1 } else { text.len() };
        let end = end.max((start + 1).min(text.len()));
        let (s_char, e_char) = (text[..start].chars().count(), text[..end].chars().count());
        let pos0 = positions(&doc);
        let s0 = pos0[&doc[p][s_char].1.unwrap()];
        let e0 = pos0[&doc[p][e_char - 1].1.unwrap()] + doc[p][e_char - 1].0.len_utf16();
        let sel = selectors_for_span(&before, s0, e0).unwrap();
        // Unchanged: found exactly where it was.
        let again = index(&tagged_text(&doc));
        let found = locate(&sel, before.length(), &again).unwrap();
        assert_eq!((found.status, found.doc_start, found.doc_end), (AnchorStatus::Anchored, s0, e0));
        // Edits away from the range (40 characters of clearance): the words are followed.
        let near: std::collections::HashSet<usize> = pos0.iter().filter(|(_, &q)| q + 40 >= s0 && q < e0 + 40).map(|(t, _)| *t).collect();
        let mut after = doc.clone();
        let mut applied = 0;
        for _ in 0..(1 + rng.below(6)) {
            let pi = rng.below(after.len());
            let para_text: String = after[pi].iter().map(|(c, _)| *c).collect();
            let touches = |q: &Vec<(char, Option<usize>)>| q.iter().any(|(_, t)| t.map(|t| near.contains(&t)).unwrap_or(false));
            match rng.below(3) {
                0 => {
                    // insert a paragraph before pi
                    if !touches(&after[pi]) && (pi == 0 || !touches(&after[pi - 1])) {
                        let fresh: Vec<(char, Option<usize>)> = sentence(&mut rng, &words).chars().map(|c| (c, None)).collect();
                        after.insert(pi, fresh);
                        applied += 1;
                    }
                }
                1 => {
                    // delete a paragraph that doesn't touch the range
                    if after.len() > 2 && !touches(&after[pi]) {
                        after.remove(pi);
                        applied += 1;
                    }
                }
                _ => {
                    // insert a word at a word boundary not near the range
                    let starts: Vec<usize> = std::iter::once(0).chain(para_text.match_indices(' ').map(|(i, _)| i + 1)).collect();
                    let at_b = starts[rng.below(starts.len())];
                    let ci = para_text[..at_b].chars().count();
                    let ok = |i: usize| after[pi].get(i).map(|(_, t)| t.map(|t| !near.contains(&t)).unwrap_or(true)).unwrap_or(true);
                    if ok(ci) && ok(ci.saturating_sub(1)) {
                        let w = format!("{} ", words[rng.below(words.len())]);
                        let fresh: Vec<(char, Option<usize>)> = w.chars().map(|c| (c, None)).collect();
                        let mut v = after[pi].clone();
                        v.splice(ci..ci, fresh);
                        after[pi] = v;
                        applied += 1;
                    }
                }
            }
        }
        if applied == 0 {
            continue;
        }
        let idx = index(&tagged_text(&after));
        let pos = positions(&after);
        let tags: Vec<usize> = doc[p][s_char..e_char].iter().map(|(_, t)| t.unwrap()).collect();
        let surviving: Vec<usize> = tags.iter().filter_map(|t| pos.get(t).copied()).collect();
        if surviving.len() != tags.len() || !appears_once(idx.text(), &sel.exact) {
            continue;
        }
        let want = (*surviving.iter().min().unwrap(), surviving.iter().max().unwrap() + doc[p][e_char - 1].0.len_utf16());
        let found = locate(&sel, before.length(), &idx).unwrap_or_else(|| panic!("quote {:?} not found", sel.exact));
        assert_eq!((found.doc_start, found.doc_end), want, "quote {:?}", sel.exact);
        assert!(matches!(found.status, AnchorStatus::Anchored | AnchorStatus::Moved));
        checked += 1;
        // Precision: whatever is found after arbitrary edits reads like the quote.
        let got = from_u16(&idx.text()[found.doc_start..found.doc_end]);
        assert!(similarity(&to_u16(&got.to_lowercase()), &to_u16(&sel.exact.to_lowercase())) >= 0.75);
    }
    assert!(checked > 30, "only {checked} cases were checked");
}
