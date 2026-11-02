import { afterEach, describe, expect, it, vi } from "vitest";
import { findInHtml, isNoteBody, isNoteRef, looksLikeNoteLabel, noteContainer, noteHtml, noteLabel } from "@/components/reader/footnotes";
import { placePopover } from "@/components/reader/FootnotePopover";
import { flashLanding, LANDING_MS } from "@/components/reader/useReadingProgress";

function body(html: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "markup";
  root.innerHTML = html;
  return root;
}

// What the server renders for a footnote (API.md, "sup.noteref" and "section.notes").
const SERVER = `<p id="b1" data-b="b1">A paragraph with a footnote<sup class="noteref" data-atom="" data-note="n1"><a href="#n1" role="doc-noteref">1</a></sup> and a <a class="internal" href="#b2" data-section="s1" data-block="b2">link</a>.</p><p id="b2" data-b="b2">Another paragraph.</p><section class="notes" data-atom="" role="doc-endnotes"><div class="note" id="n1" role="doc-footnote"><span class="note-label">1</span><p>The first note, with <em>emphasis</em>.</p></div></section>`;

describe("note references", () => {
  it("recognises the server's own note references and notes", () => {
    const root = body(SERVER);
    const ref = root.querySelector('a[role="doc-noteref"]')!;
    const note = root.querySelector("#n1")!;
    expect(isNoteRef(ref, note, root)).toBe(true);
    expect(isNoteRef(ref, null)).toBe(true);
    expect(noteContainer(note, root)).toBe(note);
  });

  it("keeps ordinary in-document links as jumps", () => {
    const root = body(SERVER);
    const link = root.querySelector("a.internal")!;
    expect(isNoteRef(link, root.querySelector("#b2"), root)).toBe(false);
    expect(isNoteRef(link, null)).toBe(false);
  });

  it("recognises EPUB and ARIA semantics on the link", () => {
    const root = body('<p><a epub:type="noteref" href="#x">see</a> <a role="doc-noteref" href="#y">see</a></p>');
    for (const a of Array.from(root.querySelectorAll("a"))) expect(isNoteRef(a, null)).toBe(true);
  });

  it("recognises links whose target is a note", () => {
    const targets = [
      '<aside epub:type="footnote" id="t"><p>x</p></aside>',
      '<ol><li role="doc-endnote" id="t"><p>x</p></li></ol>',
      '<div class="footnote" id="t">x</div>',
      '<aside data-variant="note"><p id="t" data-b="t">inside an aside</p></aside>',
      '<div epub:type="rearnote"><p id="t">inside a rear note</p></div>',
    ];
    for (const html of targets) {
      const root = body(`<p><a href="#t">see here</a></p>${html}`);
      expect(isNoteRef(root.querySelector("a")!, root.querySelector("#t"), root), html).toBe(true);
    }
  });

  it("doesn't take a whole notes list for one note", () => {
    const root = body('<section class="notes"><p id="t">One of many</p></section>');
    const t = root.querySelector("#t")!;
    expect(noteContainer(t, root)).toBeNull();
    expect(isNoteBody(root.querySelector("section")!)).toBe(false);
  });

  it("treats a short label in <sup> as a note reference", () => {
    const root = body(
      '<p id="b1"><sup><a href="#r1">[12]</a></sup> <a href="#r2"><sup>†</sup></a> <sup><a href="#r3">Chapter two</a></sup> <a href="#r4">3</a></p><ol><li id="r1">x</li><li id="r2">x</li><li id="r3">x</li><li id="r4">x</li></ol>',
    );
    const [a, b, c, d] = Array.from(root.querySelectorAll("p a"));
    const target = (id: string) => root.querySelector(`#${id}`);
    expect(isNoteRef(a!, target("r1"), root)).toBe(true);
    expect(isNoteRef(b!, target("r2"), root)).toBe(true);
    expect(isNoteRef(c!, target("r3"), root)).toBe(false);
    expect(isNoteRef(d!, target("r4"), root)).toBe(false);
  });

  it("knows what footnote labels look like", () => {
    for (const label of ["1", "12", "[12]", "(3)", "*", "**", "†", "‡", "a", "iv", " 7 "]) expect(looksLikeNoteLabel(label), label).toBe(true);
    for (const label of ["", "12345", "Chapter two", "see", "1.5"]) expect(looksLikeNoteLabel(label), label).toBe(false);
  });

  it("reads the label without brackets", () => {
    expect(noteLabel(body('<a href="#x">[12]</a>').firstElementChild!)).toBe("12");
    expect(noteLabel(body('<a href="#x"> * </a>').firstElementChild!)).toBe("*");
  });
});

describe("note content", () => {
  it("copies a server note without its label or ids", () => {
    const root = body(SERVER);
    const note = root.querySelector("#n1")!;
    expect(noteHtml(note)).toBe("<p>The first note, with <em>emphasis</em>.</p>");
    // The page itself is untouched.
    expect(note.querySelector(".note-label")).not.toBeNull();
    expect(root.querySelector("#n1")).toBe(note);
  });

  it("leaves out back-links to the reference", () => {
    const root = body(
      '<p id="b1" data-b="b1">Cited<sup><a id="ref1" href="#fn1">1</a></sup></p><ol><li id="fn1"><p id="p9" data-b="p9">The note. <a href="#ref1">^</a> <a class="footnote-backref" href="#x">↩︎</a> <a role="doc-backlink" href="#y">up</a> <a class="internal" href="#b1" data-block="b1">cited here</a> <a class="internal" href="#b7" data-block="b7">see also</a></p></li></ol>',
    );
    const html = noteHtml(root.querySelector("#fn1")!, { id: "ref1", blockId: "b1" });
    expect(html).not.toMatch(/\^|↩|up<|cited here|id=|data-b=/);
    expect(html).toContain("see also");
    expect(html).toContain("The note.");
  });

  it("drops a landing flash caught in the copy", () => {
    const root = body('<div class="note is-landing" id="n1"><p class="is-landing">x</p></div>');
    expect(noteHtml(root.firstElementChild!)).toBe("<p>x</p>");
  });

  it("finds a target in another section's HTML without running it", () => {
    const html = `<p data-b="b9">Endnotes</p><p id="n4" data-b="n4">Fourth note.</p><img src="x" onerror="window.__ran = true"><script>window.__ran = true</script>`;
    const byId = findInHtml(html, "n4");
    expect(byId?.target.textContent).toBe("Fourth note.");
    expect(findInHtml(html, "b9")?.target.textContent).toBe("Endnotes");
    expect(findInHtml(html, "nope")).toBeNull();
    expect((window as unknown as { __ran?: boolean }).__ran).toBeUndefined();
  });
});

describe("footnote popover placement", () => {
  const viewport = { width: 390, height: 800 };
  const ref = (top: number, left = 180) => ({ left, right: left + 10, top, bottom: top + 16 });

  it("opens below the reference when it fits", () => {
    const p = placePopover(ref(100), 350, 200, viewport);
    expect(p.side).toBe("below");
    expect(p.top).toBe(124);
    expect(p.left).toBe(20);
  });

  it("opens above when there's no room below", () => {
    const p = placePopover(ref(700), 350, 200, viewport);
    expect(p.side).toBe("above");
    expect(p.top).toBe(700 - 8 - 200);
  });

  it("stays inside the viewport", () => {
    const wide = { width: 1200, height: 800 };
    expect(placePopover(ref(100, 1190), 460, 200, wide).left).toBe(1200 - 460 - 20);
    expect(placePopover(ref(100, 0), 460, 200, wide).left).toBe(20);
    // Taller than the room on either side: pinned to the top margin.
    expect(placePopover(ref(400), 350, 780, viewport).top).toBe(8);
  });

  it("grows from the reference", () => {
    const p = placePopover(ref(100, 600), 460, 200, { width: 1200, height: 800 });
    expect(p.originX).toBe(605 - p.left);
  });
});

describe("landing flash", () => {
  afterEach(() => vi.useRealTimers());

  it("marks the block without touching its text, then clears", () => {
    vi.useFakeTimers();
    const root = body('<p data-b="b1">Some <em>words</em> here.</p>');
    const p = root.firstElementChild!;
    const before = p.innerHTML;
    flashLanding(p);
    expect(p.classList.contains("is-landing")).toBe(true);
    expect(p.innerHTML).toBe(before);
    vi.advanceTimersByTime(LANDING_MS + 200);
    expect(p.classList.contains("is-landing")).toBe(false);
  });

  it("clears when the animation ends", () => {
    const root = body('<p data-b="b1">x</p>');
    const p = root.firstElementChild!;
    flashLanding(p);
    p.dispatchEvent(new Event("animationend"));
    expect(p.classList.contains("is-landing")).toBe(false);
  });
});
