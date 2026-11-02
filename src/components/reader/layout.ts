import { rectForPoint, type ReadingPoint } from "./dom";

/** Anything with a viewport rectangle: an element, a range, or a measured point. */
export type Measurable = Element | Range | { getBoundingClientRect(): DOMRect };

export type LayoutKind = "paged" | "scroll";

/**
 * What the reader's place-keeping (useReadingProgress, useJumpHistory, the footer, the keys) needs
 * from a layout, whichever it is: CSS-column pages (usePagination) or one chapter scrolled top to
 * bottom (useChapterScroll). In the scroll layout a "page" is a screenful.
 */
export interface ReaderLayout {
  readonly kind: LayoutKind;
  /** Paged: the page on screen. Scroll: the screenful in view. */
  page: number;
  pageCount: number;
  /** Counts layouts; 0 until the first measurement, so callers can wait for one. */
  version: number;
  /** Changes each time the view comes to rest somewhere new; progress is saved on it. */
  rest: number;
  /** Where the view is in the section, 0–1. */
  offset(): number;
  /** Shows a page (a screenful) at once. */
  goTo(page: number): void;
  goToOffset(offset: number): void;
  toStart(): void;
  toEnd(): void;
  /** Brings a target into view: its page, or scrolled to `at` px below the top of the reading box. */
  reveal(target: Measurable, options?: { at?: number }): void;
  /** Puts words back where they were after a relayout (`delta` px below the top). */
  restore(target: Measurable, delta: number, options?: { force?: boolean }): void;
  inView(target: Measurable): boolean;
  pageOf(target: Measurable): number;
  /** The words at the reading place, to find it again after a relayout or on another device. */
  readingPoint(root: Element): ReadingPoint | null;
  /** The visible reading area, in viewport coordinates. */
  box(): DOMRect | null;
  relayout(): void;
  /** When a person last scrolled (not a move made by code), in performance.now() time; 0 if never. */
  userScrolledAt(): number;
}

/** Changes when the layout is measured again, or when it is another layout altogether. */
export const layoutStamp = (l: Pick<ReaderLayout, "kind" | "version">): string => `${l.kind}:${l.version}`;

export const measurable = (rect: DOMRect): Measurable => ({ getBoundingClientRect: () => rect });

/** Brings a block point into view. False when its block is gone. */
export function placeAtPoint(root: Element, point: { blockId: string; offset: number }, layout: ReaderLayout): boolean {
  const rect = rectForPoint(root, point);
  if (!rect) return false;
  layout.reveal(measurable(rect));
  return true;
}
