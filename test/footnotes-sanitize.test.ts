// @vitest-environment jsdom
// DOMPurify does not sanitise correctly under happy-dom; jsdom behaves like a browser here.
import { describe, expect, it } from "vitest";
import { isNoteRef, noteContainer } from "@/components/reader/footnotes";
import { sanitizeHtml } from "@/lib/sanitize";

describe("footnote markup through the sanitiser", () => {
  it("keeps what note detection needs", () => {
    const html = sanitizeHtml(
      '<p data-b="b1">Text<sup class="noteref" data-atom="" data-note="n1"><a href="#n1" role="doc-noteref">1</a></sup></p><section class="notes" data-atom="" role="doc-endnotes"><div class="note" id="n1" role="doc-footnote"><span class="note-label">1</span><p>Note.</p></div></section>',
    );
    const root = document.createElement("div");
    root.innerHTML = html;
    const ref = root.querySelector("a")!;
    expect(ref.getAttribute("role")).toBe("doc-noteref");
    expect(ref.getAttribute("target")).toBeNull();
    const note = root.querySelector("#n1")!;
    expect(note.getAttribute("role")).toBe("doc-footnote");
    expect(isNoteRef(ref, note, root)).toBe(true);
    expect(noteContainer(note, root)).toBe(note);
  });
});
