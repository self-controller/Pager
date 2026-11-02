/**
 * Footnotes: telling a note reference from an ordinary in-document link, and copying a note out of
 * the section for a popover. The server marks the notes it recognises (API.md:
 * `sup.noteref > a[role=doc-noteref]` pointing at `div.note[role=doc-footnote]`); the other rules
 * catch notes it kept as ordinary blocks, such as an endnotes chapter or a web page's numbered
 * references.
 */

const NOTEREF = /\b(noteref|doc-noteref)\b/;
const NOTE_BODY = /\b(footnote|endnote|rearnote|doc-footnote|doc-endnote)\b/;
/** Class names that mark one note ("notes", the list holding them all, is not one). */
const NOTE_CLASS = /^(foot|end|rear)?note$/i;
const BACKLINK = /\b(backlink|doc-backlink)\b/;
const BACKLINK_CLASS = /backref|backlink/i;
const BACKLINK_TEXT = /^\s*(↩︎?|↑|\^|⏎|back|return)\s*$/i;

/** The element's EPUB and ARIA semantics, lowercased: `epub:type` and `role`. */
function semantics(el: Element): string {
  return `${el.getAttribute("epub:type") ?? ""} ${el.getAttribute("role") ?? ""}`.toLowerCase();
}

/** True for an element that is itself a note: a footnote or endnote, an aside, or `.note`/`.footnote`. */
export function isNoteBody(el: Element): boolean {
  return NOTE_BODY.test(semantics(el)) || el.tagName === "ASIDE" || Array.from(el.classList).some((c) => NOTE_CLASS.test(c));
}

/** The note a link target belongs to: the target or its nearest note ancestor below `root`. */
export function noteContainer(target: Element, root?: Element | null): Element | null {
  for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
    if (isNoteBody(el)) return el;
  }
  return null;
}

/** A footnote label as authors print them: "1", "[12]", "(3)", "*", "†", "a", "iv". */
export function looksLikeNoteLabel(text: string): boolean {
  const t = text
    .trim()
    .replace(/^[[(]\s*/, "")
    .replace(/\s*[\])]$/, "");
  return /^(\d{1,4}|[a-z]|[ivx]{1,5}|[*†‡§¶‖#]{1,3})$/i.test(t);
}

/**
 * True when an in-document link opens a note rather than leading somewhere to read on: it is
 * marked as a note reference, its target is (inside) a note, or it is a short label in `<sup>`.
 * `target` is null when it isn't at hand (in another section that hasn't loaded).
 */
export function isNoteRef(link: Element, target: Element | null, root?: Element | null): boolean {
  if (NOTEREF.test(semantics(link)) || link.closest("sup.noteref, [data-note]")) return true;
  if (target && noteContainer(target, root)) return true;
  const sup = link.closest("sup") ?? link.querySelector("sup");
  return Boolean(sup) && looksLikeNoteLabel(link.textContent ?? "");
}

/** The reference's label without brackets: "[12]" → "12". */
export function noteLabel(link: Element): string {
  return (link.textContent ?? "")
    .trim()
    .replace(/^[[(]\s*/, "")
    .replace(/\s*[\])]$/, "");
}

/** Where a note was cited from, so a link back there can be left out of the copy. */
export interface NoteSource {
  /** The reference link's own id, if it has one. */
  id?: string;
  /** The block holding the reference. */
  blockId?: string;
}

function isBackLink(a: Element, from: NoteSource | undefined): boolean {
  if (BACKLINK.test(semantics(a)) || BACKLINK_CLASS.test(a.getAttribute("class") ?? "")) return true;
  if (BACKLINK_TEXT.test(a.textContent ?? "")) return true;
  const href = a.getAttribute("href") ?? "";
  return Boolean(
    from && ((from.id && href === `#${from.id}`) || (from.blockId && a.getAttribute("data-block") === from.blockId)),
  );
}

/**
 * A note's content as HTML for the popover. A copy: without its back-links (↩), its label (the
 * popover shows it) and its ids, so nothing on the page is duplicated and the page is untouched.
 */
export function noteHtml(note: Element, from?: NoteSource): string {
  const copy = note.cloneNode(true) as Element;
  for (const a of Array.from(copy.querySelectorAll("a"))) {
    if (isBackLink(a, from)) a.remove();
  }
  for (const label of Array.from(copy.querySelectorAll(".note-label"))) label.remove();
  for (const el of [copy, ...Array.from(copy.querySelectorAll("[id], [data-b], [tabindex], .is-landing"))]) {
    el.removeAttribute("id");
    el.removeAttribute("data-b");
    el.removeAttribute("tabindex");
    if (el.classList.contains("is-landing")) {
      el.classList.remove("is-landing");
      if (!el.classList.length) el.removeAttribute("class");
    }
  }
  return copy.innerHTML.trim();
}

/**
 * Finds a link target (by id or block id) in the HTML of a section that isn't on screen. DOMParser
 * builds an inert document: nothing in it runs or loads.
 */
export function findInHtml(html: string, id: string): { target: Element; root: Element } | null {
  const root = new DOMParser().parseFromString(html, "text/html").body;
  const esc = CSS.escape(id);
  const target = root.querySelector(`[id="${esc}"]`) ?? root.querySelector(`[data-b="${esc}"]`);
  return target ? { target, root } : null;
}
