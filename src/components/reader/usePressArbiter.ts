import { useRef, type MouseEvent, type PointerEvent } from "react";
import { INTERACTIVE_SELECTOR, judgePress, OVERLAY_SELECTOR, pointerKind, type PointerKind } from "./gestures";

export function selectionOpen(): boolean {
  const sel = window.getSelection();
  return Boolean(sel && !sel.isCollapsed);
}

/** A press on the page, from pointerdown; `up` once it lifts. */
interface Press {
  id: number;
  kind: PointerKind;
  x: number;
  y: number;
  t: number;
  hadSelection: boolean;
  hadOverlay: boolean;
  up?: { x: number; y: number; t: number };
}

/**
 * The page's press handlers, shared by both layouts: every press goes through the arbiter
 * (gestures.ts), so one tap does one thing, a press that closes a selection or an overlay does only
 * that, and long presses and scroll ends do nothing. `onTap` gets the presses left over: free taps
 * on the page that no link, highlight or control took.
 */
export function usePressArbiter({
  userScrolledAt,
  onTap,
}: {
  userScrolledAt: () => number;
  onTap: (kind: PointerKind, e: MouseEvent<HTMLDivElement>) => void;
}) {
  const press = useRef<Press | null>(null);

  // Taken at pointerdown: iOS has already cleared the selection by the time the click arrives.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const inOverlay = (e.target as Element).closest?.("[data-reader-overlay]");
    press.current =
      e.isPrimary && !inOverlay
        ? {
            id: e.pointerId,
            kind: pointerKind(e.pointerType),
            x: e.clientX,
            y: e.clientY,
            t: performance.now(),
            hadSelection: selectionOpen(),
            hadOverlay: Boolean(document.querySelector(OVERLAY_SELECTOR)),
          }
        : null;
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (p?.id === e.pointerId) p.up = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onPointerCancel = () => {
    press.current = null;
  };

  // Before the text sees the click: a press that wasn't a free tap does nothing else, links included.
  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return;
    const up = p.up ?? { x: e.clientX, y: e.clientY, t: performance.now() };
    const scrolledAt = userScrolledAt();
    const verdict = judgePress({
      kind: p.kind,
      dx: up.x - p.x,
      dy: up.y - p.y,
      ms: up.t - p.t,
      scrolled: scrolledAt > p.t,
      sinceScroll: scrolledAt > 0 ? up.t - scrolledAt : Infinity,
      hadSelection: p.hadSelection,
      hadOverlay: p.hadOverlay,
    });
    if (verdict !== "tap") {
      press.current = null;
      e.preventDefault();
    }
  };

  // After the text: links and highlights have had their turn (and prevented the default).
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const p = press.current;
    press.current = null;
    if (!p || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if ((e.target as Element).closest?.(INTERACTIVE_SELECTOR)) return;
    onTap(p.kind, e);
  };

  return { onPointerDown, onPointerUp, onPointerCancel, onClickCapture, onClick };
}
