import { useEffect, useRef, type ReactNode, type RefObject, type TouchEvent, type WheelEvent } from "react";
import { swipeTurn, tapAction, zoneAt } from "./gestures";
import type { Pager } from "./usePagination";
import { selectionOpen, usePressArbiter } from "./usePressArbiter";

interface Props {
  scrollerRef: RefObject<HTMLDivElement | null>;
  pager: Pager;
  onTurn: (direction: 1 | -1) => void;
  /** Whether the reader's chrome shows; touch taps and swipes on the page change it. */
  chrome: boolean;
  onChrome: (visible: boolean) => void;
  children: ReactNode;
}

/** A one-finger touch, for swipes the scroller can't follow itself. */
interface Touch {
  x: number;
  y: number;
  t: number;
  left: number;
  inScroller: boolean;
  skip: boolean;
}

/**
 * The page box: one page wide, one page tall, columns flowing to the right behind it. The scroller
 * scrolls sideways and snaps one page at a time, so a swipe is the platform's own. Every press goes
 * through the arbiter (gestures.ts): one tap does one thing, a press that closes a selection or an
 * overlay does only that, and long presses and scroll ends do nothing. Touch zones turn pages and
 * toggle the chrome; a mouse turns from the outer edges or with the wheel. Text selection is never
 * blocked, and the page holds still while text is selected.
 */
export function PagedView({ scrollerRef, pager, onTurn, chrome, onChrome, children }: Props) {
  const touch = useRef<Touch | null>(null);
  const lastWheel = useRef(0);
  const { pageWidth, pageHeight, pageCount, gap } = pager;

  // While text is selected the page holds still: a selection dragged to the edge never scrolls it.
  useEffect(() => {
    const onSelection = () => {
      const el = scrollerRef.current;
      const sel = window.getSelection();
      el?.toggleAttribute("data-selecting", Boolean(sel && !sel.isCollapsed && sel.anchorNode && el.contains(sel.anchorNode)));
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, [scrollerRef]);

  // Touch zones turn pages and toggle the chrome; a mouse turns from the outer edges.
  const presses = usePressArbiter({
    userScrolledAt: pager.userScrolledAt,
    onTap: (kind, e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const action = tapAction(zoneAt((e.clientX - rect.left) / rect.width, kind), kind, chrome);
      if (action === "prev") onTurn(-1);
      else if (action === "next") onTurn(1);
      else if (action === "toggle-chrome") onChrome(!chrome);
      else if (action === "hide-chrome") onChrome(false);
    },
  });

  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    const t = e.touches[0];
    if (!el || !t || e.touches.length !== 1) {
      touch.current = null;
      return;
    }
    const target = e.target as Element;
    touch.current = {
      x: t.clientX,
      y: t.clientY,
      t: performance.now(),
      left: el.scrollLeft,
      inScroller: el.contains(target),
      skip: Boolean(target.closest?.("[data-reader-overlay]")) || selectionOpen(),
    };
  };

  // A swipe hides the chrome. The scroller follows swipes over the text by itself; this turns the
  // ones it can't: from the side margins, and past the first or last page into the next section.
  const onTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const s = touch.current;
    touch.current = null;
    const el = scrollerRef.current;
    const t = e.changedTouches[0];
    if (!s || !el || !t || s.skip || e.touches.length > 0 || selectionOpen()) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    const swiped = pager.userScrolledAt() > s.t || (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy));
    if (swiped) onChrome(false);
    const direction = swipeTurn(dx, dy, performance.now() - s.t, el.clientWidth);
    if (!direction) return;
    if (s.inScroller) {
      const max = el.scrollWidth - el.clientWidth;
      const atStart = s.left <= 1 && el.scrollLeft <= 1;
      const atEnd = s.left >= max - 1 && el.scrollLeft >= max - 1;
      if (direction === 1 ? !atEnd : !atStart) return;
    }
    onTurn(direction);
  };

  // A vertical wheel turns pages; a sideways one (trackpad) scrolls and snaps like a swipe.
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX) || Math.abs(e.deltaY) < 24) return;
    const now = performance.now();
    if (now - lastWheel.current < 350) return;
    lastWheel.current = now;
    onTurn(e.deltaY > 0 ? 1 : -1);
  };

  const step = pageWidth + gap;
  return (
    <div
      className="reader-stage relative flex min-h-0 flex-1 touch-pan-x touch-pan-y justify-center px-[var(--reader-gutter)] select-text"
      onPointerDown={presses.onPointerDown}
      onPointerUp={presses.onPointerUp}
      onPointerCancel={presses.onPointerCancel}
      onClickCapture={presses.onClickCapture}
      onClick={presses.onClick}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => (touch.current = null)}
      onWheel={onWheel}
    >
      <div
        ref={scrollerRef}
        className="reader-scroller w-full max-w-[var(--size-reader)] py-5 md:py-8"
        style={{
          ["--page-h" as string]: pageHeight > 0 ? `${pageHeight}px` : "100vh",
          ["--page-gap" as string]: `${gap}px`,
        }}
      >
        <div
          className="reader-columns"
          data-columns
          style={{ columnWidth: pageWidth > 0 ? pageWidth : undefined, columnGap: gap }}
        >
          {children}
        </div>
        {/* One snap point per page, outside the text so it never enters its textContent. */}
        {pageWidth > 0 &&
          Array.from({ length: pageCount }, (_, i) => (
            <span key={i} aria-hidden className="page-snap" style={{ left: i * step }} />
          ))}
      </div>
    </div>
  );
}
