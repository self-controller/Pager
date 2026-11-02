/**
 * Page arithmetic for the column-paged reader. The section's HTML flows into CSS columns that are
 * exactly one page wide; page N is shown by scrolling the column box to N × (width + gap).
 */

/** How many columns the content made, from the column box's scrollWidth. */
export function pageCountFor(scrollWidth: number, pageWidth: number, gap: number): number {
  if (pageWidth <= 0) return 1;
  return Math.max(1, Math.round((scrollWidth + gap) / (pageWidth + gap)));
}

/** Which page a point at `contentLeft` (x inside the column box's scrollable content) is on. */
export function pageForLeft(contentLeft: number, pageWidth: number, gap: number): number {
  if (pageWidth <= 0) return 0;
  return Math.max(0, Math.floor((contentLeft + gap / 2) / (pageWidth + gap)));
}

/** Where the scroll box must sit to show a page. */
export function scrollLeftFor(page: number, pageWidth: number, gap: number): number {
  return Math.max(0, page) * (pageWidth + gap);
}

/** The page nearest a scroll position (where the snap lands). */
export function pageAtScroll(scrollLeft: number, pageWidth: number, gap: number, pageCount: number): number {
  if (pageWidth <= 0) return 0;
  return clampPage(Math.round(scrollLeft / (pageWidth + gap)), pageCount);
}

/** The section's 0–1 reading offset for a page: 0 on the first page, 1 on the last. */
export function offsetFromPage(page: number, pageCount: number): number {
  if (pageCount <= 1) return 1;
  return Math.min(1, Math.max(0, page / (pageCount - 1)));
}

/** The page that a saved 0–1 offset points at. */
export function pageFromOffset(offset: number, pageCount: number): number {
  if (pageCount <= 1) return 0;
  const o = Math.min(1, Math.max(0, Number.isFinite(offset) ? offset : 0));
  return Math.min(pageCount - 1, Math.round(o * (pageCount - 1)));
}

export const clampPage = (page: number, pageCount: number): number =>
  Math.min(Math.max(0, pageCount - 1), Math.max(0, Math.floor(page)));

/*
 * The Scroll layout counts "pages" as screenfuls of one chapter scrolled top to bottom: screen 0 at
 * the top, the last screen wherever the scroll ends. `maxTop` is scrollHeight − clientHeight.
 */

/** How many screenfuls a chapter takes: the top, one more per `step`, and the end. */
export function screenCount(maxTop: number, step: number): number {
  if (maxTop <= 0 || step <= 0) return 1;
  return Math.ceil(maxTop / step - 0.001) + 1;
}

/** The screenful at a scroll position; at the end it is the last, however short. */
export function screenAt(top: number, maxTop: number, step: number): number {
  const count = screenCount(maxTop, step);
  if (count === 1) return 0;
  if (top >= maxTop - 1) return count - 1;
  return Math.min(count - 2, Math.max(0, Math.floor((top + 1) / step)));
}

/** Where to scroll to show a screenful. */
export function scrollTopForScreen(screen: number, maxTop: number, step: number): number {
  const count = screenCount(maxTop, step);
  if (screen >= count - 1) return Math.max(0, maxTop);
  return Math.min(Math.max(0, maxTop), Math.max(0, Math.floor(screen) * step));
}

/** The chapter's 0–1 reading offset at a scroll position; 1 when it fits on one screen (as offsetFromPage). */
export function scrollOffset(top: number, maxTop: number): number {
  if (maxTop <= 0) return 1;
  return Math.min(1, Math.max(0, top / maxTop));
}

/** The scroll position a saved 0–1 offset points at. */
export function scrollTopForOffset(offset: number, maxTop: number): number {
  const o = Math.min(1, Math.max(0, Number.isFinite(offset) ? offset : 0));
  return Math.max(0, maxTop) * o;
}

/** An arrow key scrolls this far. */
export const KEY_LINE_PX = 40;

/** Space and Page Down scroll a screen less two lines, so the last lines stay in sight. */
export function pageStep(viewHeight: number): number {
  return Math.max(viewHeight / 2, viewHeight - 2 * KEY_LINE_PX);
}
