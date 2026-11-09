import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Scan } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { cx } from "@/lib/cx";
import {
  clampTransform,
  fit,
  panBy,
  panIntoView,
  sameTransform,
  transformCss,
  zoomAt,
  zoomLimits,
  type Point,
  type Size,
  type Transform,
} from "./zoom";

/** How far one finger or the mouse moves before a press becomes a pan (a tap moves less). */
const PAN_SLOP = 6;
/** The animation back to the fit, or to a card brought into view. */
const SETTLE = "transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1)";

interface Props {
  /** The content's size at scale 1. */
  content: Size;
  /** The viewport's size: what shows of the map. */
  viewport: Size;
  /** The viewport's label (a role="group"). */
  label: string;
  /** A click on the map's ground, not on a card (and not the end of a drag). */
  onBackgroundClick?: () => void;
  /** Over the map and never zoomed: the details. Outside the viewport, so it doesn't pan the map. */
  overlay?: ReactNode;
  /** Where the "Fit the map" button sits. */
  fitCorner?: "top-right" | "bottom-right" | "bottom-left";
  children: ReactNode;
}

type Gesture =
  | { kind: "pan"; start: Point; last: Point; active: boolean; scroller: Element | null }
  | { kind: "pinch"; t0: Transform; mid0: Point; dist0: number };

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * What scrolls around the map: the nearest ancestor with its own vertical scroll (the full-screen
 * dialog's body), else the page. A scroll box with nothing to scroll yet stops the search, so a drag
 * in the dialog never scrolls the page behind it.
 */
function scrollerOf(el: Element): Element | null {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if (y === "auto" || y === "scroll") return p.scrollHeight > p.clientHeight ? p : null;
  }
  return document.scrollingElement;
}

/**
 * A viewport that pinches, pans and ctrl+wheel-zooms its content (the card map). It opens fitted to the
 * whole content. During a gesture the transform goes straight to the layer's style, so React doesn't
 * render on each move; it's committed when the gesture ends. A press that moved never clicks: the
 * click after a drag is swallowed, so a drag never picks a card or clears the pick. The viewport takes
 * every touch (`touch-none`), so a one-finger drag the map can't follow (at its edge, or at the fit)
 * scrolls the page or the dialog instead: the details below the map stay in reach.
 */
export function ZoomPan({ content, viewport, label, onBackgroundClick, overlay, fitCorner = "top-right", children }: Props) {
  const viewRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const home = useMemo(() => fit(content, viewport), [content.w, content.h, viewport.w, viewport.h]);
  const limits = useMemo(() => zoomLimits(content, viewport), [content.w, content.h, viewport.w, viewport.h]);

  const [t, setT] = useState<Transform>(home);
  // The transform shown, ahead of `t` during a gesture.
  const live = useRef<Transform>(home);
  // Still at the fit: a new size fits again; zoomed, it only clamps.
  const fitted = useRef(true);
  // What the native handlers need, fresh each render.
  const env = useRef({ content, viewport, limits, home });
  env.current = { content, viewport, limits, home };

  const clamp = (x: Transform) => {
    const e = env.current;
    return clampTransform(x, e.content, e.viewport, e.limits);
  };
  const apply = (x: Transform, animate = false) => {
    live.current = x;
    const layer = layerRef.current;
    if (!layer) return;
    layer.style.transition = animate && !reducedMotion() ? SETTLE : "none";
    layer.style.transform = transformCss(x);
  };
  // Write first, then commit: the DOM is right even when the state doesn't change.
  const commit = (x: Transform, animate = false) => {
    apply(x, animate);
    fitted.current = sameTransform(x, env.current.home);
    setT(x);
  };

  // A new size: fit again if the map was at the fit, else keep the zoom within the new bounds.
  useLayoutEffect(() => {
    commit(fitted.current ? home : clamp(live.current));
  }, [home, limits]);

  // Pointers down on the map, and the gesture they make.
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const origin = useRef<Point>({ x: 0, y: 0 });
  // Set once a pan or pinch happened: the next click is the gesture's end, not a tap.
  const swallow = useRef(false);

  const local = (e: { clientX: number; clientY: number }): Point => ({
    x: e.clientX - origin.current.x,
    y: e.clientY - origin.current.y,
  });
  const capture = (id: number) => {
    try {
      viewRef.current?.setPointerCapture(id);
    } catch {
      // The pointer is already gone.
    }
  };
  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return;
    gesture.current = {
      kind: "pinch",
      t0: live.current,
      mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      dist0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    };
    swallow.current = true;
    for (const id of pointers.current.keys()) capture(id);
    if (layerRef.current) layerRef.current.style.willChange = "transform";
  };
  const end = () => {
    const g = gesture.current;
    gesture.current = null;
    if (layerRef.current) layerRef.current.style.willChange = "";
    if (g && (g.kind === "pinch" || g.active)) commit(clamp(live.current));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (pointers.current.size === 0) {
      swallow.current = false;
      const r = viewRef.current?.getBoundingClientRect();
      origin.current = { x: r?.left ?? 0, y: r?.top ?? 0 };
    }
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) {
      gesture.current = { kind: "pan", start: p, last: { ...p }, active: false, scroller: null };
    } else if (pointers.current.size === 2) {
      startPinch();
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pan") {
      if (!g.active) {
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) <= PAN_SLOP) return;
        g.active = true;
        swallow.current = true;
        g.scroller = viewRef.current ? scrollerOf(viewRef.current) : null;
        // Captured only now: captured from the press, a tap's click would go to the viewport, not the card.
        capture(e.pointerId);
        if (layerRef.current) layerRef.current.style.willChange = "transform";
      }
      // Step by step, so a move back pans the map again at once rather than first undoing an overshoot.
      const cur = env.current;
      const step = panBy(live.current, { x: p.x - g.last.x, y: p.y - g.last.y }, cur.content, cur.viewport, cur.limits);
      g.last = { ...p };
      apply(step.t);
      // What the map couldn't take scrolls what's around it, which carries the map along under the finger.
      if (step.restY !== 0 && g.scroller) {
        const before = g.scroller.scrollTop;
        g.scroller.scrollBy({ top: -step.restY, behavior: "instant" });
        const moved = g.scroller.scrollTop - before;
        // The map went up the screen that much: the fingers' points follow it, ready for a pinch.
        if (moved !== 0) {
          origin.current = { x: origin.current.x, y: origin.current.y - moved };
          for (const q of pointers.current.values()) q.y += moved;
          g.last.y += moved;
        }
      }
      return;
    }
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const { minScale, maxScale } = env.current.limits;
    const scale = Math.min(maxScale, Math.max(minScale, (g.t0.scale * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist0));
    // The content under the fingers' first midpoint follows the midpoint.
    const cx0 = (g.mid0.x - g.t0.x) / g.t0.scale;
    const cy0 = (g.mid0.y - g.t0.y) / g.t0.scale;
    apply(clamp({ scale, x: mid.x - cx0 * scale, y: mid.y - cy0 * scale }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const left = pointers.current.size;
    if (left === 0) return end();
    const g = gesture.current;
    // One finger of a pinch lifted: the other pans on from where the map is.
    if (g?.kind === "pinch" && left === 1) {
      const [p] = [...pointers.current.values()];
      gesture.current = {
        kind: "pan",
        start: p!,
        last: { ...p! },
        active: true,
        scroller: viewRef.current && scrollerOf(viewRef.current),
      };
    } else if (left >= 2) {
      startPinch();
    }
  };

  // Native listeners: the click after a gesture (in the capture phase, before the card's), the
  // trackpad's pinch (ctrl+wheel, which must be able to preventDefault), Safari's gesture events.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const onClick = (e: MouseEvent) => {
      if (!swallow.current) return;
      swallow.current = false;
      e.stopPropagation();
      e.preventDefault();
    };
    let settle = 0;
    const onWheel = (e: WheelEvent) => {
      // A plain wheel scrolls the page.
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = view.getBoundingClientRect();
      const step = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 0.5 : 0.01;
      const factor = Math.exp(-e.deltaY * step);
      apply(clamp(zoomAt(live.current, factor, { x: e.clientX - r.left, y: e.clientY - r.top }, env.current.limits)));
      window.clearTimeout(settle);
      settle = window.setTimeout(() => commit(live.current), 140);
    };
    // Safari (a Mac's trackpad) pinches with gesture events instead; on an iPhone they come with the
    // pointers, which already pinch, so they're only stopped there.
    let g0: { t: Transform; at: Point } | null = null;
    type GestureEv = Event & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      if (pointers.current.size > 0) return;
      const ev = e as GestureEv;
      const r = view.getBoundingClientRect();
      g0 = { t: live.current, at: { x: ev.clientX - r.left, y: ev.clientY - r.top } };
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (!g0 || pointers.current.size > 0) return;
      apply(clamp(zoomAt(g0.t, (e as GestureEv).scale, g0.at, env.current.limits)));
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      if (!g0) return;
      g0 = null;
      commit(clamp(live.current));
    };
    // Focus on a card can scroll an overflow-hidden box: the transform is the only offset.
    const onScroll = () => {
      view.scrollTop = 0;
      view.scrollLeft = 0;
    };
    view.addEventListener("click", onClick, true);
    view.addEventListener("wheel", onWheel, { passive: false });
    view.addEventListener("gesturestart", onGestureStart);
    view.addEventListener("gesturechange", onGestureChange);
    view.addEventListener("gestureend", onGestureEnd);
    view.addEventListener("scroll", onScroll);
    return () => {
      window.clearTimeout(settle);
      view.removeEventListener("click", onClick, true);
      view.removeEventListener("wheel", onWheel);
      view.removeEventListener("gesturestart", onGestureStart);
      view.removeEventListener("gesturechange", onGestureChange);
      view.removeEventListener("gestureend", onGestureEnd);
      view.removeEventListener("scroll", onScroll);
    };
  }, []);

  // A card reached with the keyboard comes into view.
  const onFocus = (e: React.FocusEvent) => {
    const el = e.target as HTMLElement;
    if (el === viewRef.current || el.offsetParent !== layerRef.current || !el.matches(":focus-visible")) return;
    const rect = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    const next = clamp(panIntoView(live.current, rect, viewport));
    if (!sameTransform(next, live.current)) commit(next, true);
  };

  const atFit = sameTransform(t, home);

  return (
    <div className="relative w-full" style={{ height: viewport.h }}>
      <div
        ref={viewRef}
        role="group"
        aria-label={label}
        className="absolute inset-0 touch-none overflow-hidden select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onFocus={onFocus}
        onClick={onBackgroundClick}
      >
        <div
          ref={layerRef}
          className="absolute top-0 left-0 origin-top-left"
          style={{ width: content.w, height: content.h, transform: transformCss(t) }}
        >
          {children}
        </div>
      </div>
      {overlay}
      {!atFit && (
        <IconButton
          icon={Scan}
          label="Fit the map"
          size="sm"
          variant="secondary"
          className={cx(
            "absolute z-20 elevation",
            fitCorner === "top-right" && "top-2 right-2",
            fitCorner === "bottom-right" && "right-2 bottom-2",
            fitCorner === "bottom-left" && "bottom-2 left-2",
          )}
          onClick={() => commit(env.current.home, true)}
        />
      )}
    </div>
  );
}
