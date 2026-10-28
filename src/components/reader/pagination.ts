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

export const clampPage = (page: number, pageCount: number): number => Math.min(Math.max(0, pageCount - 1), Math.max(0, Math.floor(page)));
