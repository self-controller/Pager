import { useLayoutEffect, useRef } from "react";

/**
 * The Assistant page's list and a book's Context are two places on one page: only `?doc=` changes
 * between them, so nothing else moves the scroll. A book's Context opens at its top, and the list
 * comes back where it was left.
 *
 * Both in layout effects, so the page is at its place before it paints. Left to itself the page kept
 * its offset: a briefing opened from a scrolled list started part-way down, and the short list that
 * replaced a scrolled briefing arrived with an offset past its end, which the iPhone app's scroll
 * view put right a frame later (a flash on "All briefings").
 *
 * Nothing happens on the first render: a tab switch restores its own scroll (tabMemory.ts).
 */
export function useListScroll(docId: string | null): void {
  const list = useRef(0);
  const shown = useRef(docId);

  // The list's offset, kept while the list shows. A layout effect, so the listener is gone in the
  // same commit that swaps the page, before the scroll below (or the browser's own) can report.
  useLayoutEffect(() => {
    if (docId !== null) return;
    const keep = () => {
      list.current = window.scrollY;
    };
    window.addEventListener("scroll", keep, { passive: true });
    return () => window.removeEventListener("scroll", keep);
  }, [docId]);

  useLayoutEffect(() => {
    if (shown.current === docId) return;
    shown.current = docId;
    window.scrollTo({ top: docId === null ? list.current : 0, behavior: "instant" });
  }, [docId]);
}
