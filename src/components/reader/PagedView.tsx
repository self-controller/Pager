import { useRef, type MouseEvent, type PointerEvent, type ReactNode, type RefObject, type WheelEvent } from "react";
import { cx } from "@/lib/cx";
import { PAGE_GAP } from "./usePagination";

interface Props {
  scrollerRef: RefObject<HTMLDivElement | null>;
  pageWidth: number;
  pageHeight: number;
  onTurn: (direction: 1 | -1) => void;
  children: ReactNode;
}

function selectionOpen(): boolean {
  const sel = window.getSelection();
  return Boolean(sel && !sel.isCollapsed);
}

/**
 * The page box: one page wide, one page tall, columns flowing to the right behind it. Turns pages
 * on a click near either edge, a horizontal swipe, or a wheel nudge. Text selection is left alone.
 */
export function PagedView({ scrollerRef, pageWidth, pageHeight, onTurn, children }: Props) {
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastWheel = useRef(0);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0 || selectionOpen()) return;
    const target = e.target as Element;
    if (target.closest("a, button, input, textarea, [contenteditable='true']")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    if (x < 0.18) onTurn(-1);
    else if (x > 0.82) onTurn(1);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    touch.current = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = touch.current;
    touch.current = null;
    if (!start || selectionOpen()) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (performance.now() - start.t > 600 || Math.abs(dx) < 40 || Math.abs(dy) > 60) return;
    onTurn(dx < 0 ? 1 : -1);
  };

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(delta) < 24) return;
    const now = performance.now();
    if (now - lastWheel.current < 350) return;
    lastWheel.current = now;
    onTurn(delta > 0 ? 1 : -1);
  };

  return (
    <div
      className="reader-stage relative flex min-h-0 flex-1 justify-center px-4 [touch-action:pan-y] select-text md:px-8"
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (touch.current = null)}
      onWheel={onWheel}
    >
      <div
        ref={scrollerRef}
        className={cx("reader-scroller w-full max-w-[var(--size-reader)] py-5 md:py-8")}
        style={{
          columnWidth: pageWidth > 0 ? pageWidth : undefined,
          columnGap: PAGE_GAP,
          ["--page-h" as string]: pageHeight > 0 ? `${pageHeight}px` : "100vh",
          ["--page-gap" as string]: `${PAGE_GAP}px`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
