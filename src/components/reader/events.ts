/** Dispatched on `window` whenever the page being shown changes (paged layout). Popovers and selections listen. */
export const PAGE_CHANGE_EVENT = "reader:pagechange";

/**
 * Dispatched on `window` when the chapter scrolls (scroll layout), at most once a frame, and when a
 * chapter turn starts (`cause: "turn"`). An inner scroller's scroll events don't reach `window`.
 */
export const READER_SCROLL_EVENT = "reader:scroll";

export interface ReaderScrollDetail {
  cause: "scroll" | "turn";
}

export function dispatchReaderScroll(cause: ReaderScrollDetail["cause"]): void {
  window.dispatchEvent(new CustomEvent<ReaderScrollDetail>(READER_SCROLL_EVENT, { detail: { cause } }));
}

/** Calls `handler` whenever the text moves under a floating panel: a page turn, a scroll, a chapter turn. */
export function onReaderMove(handler: () => void): () => void {
  window.addEventListener(PAGE_CHANGE_EVENT, handler);
  window.addEventListener(READER_SCROLL_EVENT, handler);
  return () => {
    window.removeEventListener(PAGE_CHANGE_EVENT, handler);
    window.removeEventListener(READER_SCROLL_EVENT, handler);
  };
}
