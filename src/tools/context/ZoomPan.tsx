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
  { kind: "pan"; start: Point; last: Point; active: boolean } | { kind: "pinch"; t0: Transform; mid0: Point; dist0: number };

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A viewport that pinches, pans and ctrl+wheel-zooms its content (the card map). It opens fitted to the
 * whole content. During a gesture the transform goes straight to the layer's style, so React doesn't
 * render on each move; it's committed when the gesture ends. A press that moved never clicks: the
 * click after a drag is swallowed, so a drag never picks a card or clears the pick.
 *
 * Exactly one thing moves on a touch, and the page is never scrolled from here. At the fit a one-finger
 * drag is the page's (or the dialog's) own scroll, with its glide, so the details below the map stay
 * in reach; the map doesn't move. Zoomed in, the map takes the touch: its default is cancelled, so the
 * iPhone neither scrolls the page under the map (WKWebView scrolls through `touch-action: none`) nor
 * clicks, a drag moves only the map and stops at its edge, and a tap is clicked here. A pinch is
 * always the map's.
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
  // At the fit nothing can pan: the content is centred on both axes.
  const atHome = () => sameTransform(live.current, env.current.home);
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
    swallow.current = true;
    // The map has moved on the screen since the first finger came down: the browser is scrolling
    // this touch, so the fingers don't pinch (their points would slide with the page).
    const r = viewRef.current?.getBoundingClientRect();
    if (r && (Math.abs(r.left - origin.current.x) > 1 || Math.abs(r.top - origin.current.y) > 1)) {
      gesture.current = null;
      return;
    }
    gesture.current = {
      kind: "pinch",
      t0: live.current,
      mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      dist0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    };
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
      gesture.current = { kind: "pan", start: p, last: { ...p }, active: false };
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
      const home = atHome();
      if (!g.active) {
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) <= PAN_SLOP) return;
        g.active = true;
        swallow.current = true;
        if (!home) {
          // Captured only now: captured from the press, a tap's click would go to the viewport, not the card.
          capture(e.pointerId);
          if (layerRef.current) layerRef.current.style.willChange = "transform";
        }
      }
      const from = g.last;
      g.last = { ...p };
      // At the fit the map can't move: on a touch screen this drag is the page's own scroll.
      if (home) return;
      // Step by step, so a move back pans the map again at once rather than first undoing an overshoot.
      const cur = env.current;
      apply(panBy(live.current, { x: p.x - from.x, y: p.y - from.y }, cur.content, cur.viewport, cur.limits));
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
      gesture.current = { kind: "pan", start: p!, last: { ...p! }, active: true };
    } else if (left >= 2) {
      startPinch();
    }
  };

  // Native listeners: the click after a gesture (in the capture phase, before the card's), the
  // trackpad's pinch (ctrl+wheel, which must be able to preventDefault), Safari's gesture events, and
  // the touches the map takes (which must be able to preventDefault too).
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
    // A touch the map takes (zoomed in at its first finger, or a second finger: a pinch) has its default
    // cancelled, from its touchstart: the iPhone then neither scrolls the page under the map nor
    // clicks, so a tap is clicked here. At the fit one finger is left to the browser, which scrolls.
    let owned = false;
    // Whether the first finger's touchstart was cancelled (so no click of the browser's follows), and
    // the most fingers on the map at once: a tap is one finger that never became a drag.
    let took = false;
    let most = 0;
    const onMap = (e: TouchEvent) =>
      Array.from(e.touches).filter((t) => t.target instanceof Node && view.contains(t.target)).length;
    const onTouchStart = (e: TouchEvent) => {
      const n = onMap(e);
      // The only finger on the map: a new touch, whatever an earlier one left behind.
      if (n <= 1) {
        owned = false;
        took = false;
        most = 0;
      }
      const first = most === 0;
      most = Math.max(most, n);
      if (n >= 2 || !atHome()) owned = true;
      if (!owned || !e.cancelable) return;
      e.preventDefault();
      if (first) took = true;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (owned && e.cancelable) e.preventDefault();
    };
    const onTouchEnd = (e: TouchEvent) => {
      const left = onMap(e);
      if (owned && e.cancelable) e.preventDefault();
      if (left > 0) return;
      // The pointer events came first: `swallow` says whether this touch panned or pinched.
      const tap = e.type === "touchend" && owned && took && most === 1 && !swallow.current;
      owned = false;
      took = false;
      most = 0;
      if (tap && e.target instanceof HTMLElement && view.contains(e.target)) e.target.click();
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
    view.addEventListener("touchstart", onTouchStart, { passive: false });
    view.addEventListener("touchmove", onTouchMove, { passive: false });
    view.addEventListener("touchend", onTouchEnd, { passive: false });
    view.addEventListener("touchcancel", onTouchEnd);
    view.addEventListener("scroll", onScroll);
    return () => {
      window.clearTimeout(settle);
      view.removeEventListener("click", onClick, true);
      view.removeEventListener("wheel", onWheel);
      view.removeEventListener("gesturestart", onGestureStart);
      view.removeEventListener("gesturechange", onGestureChange);
      view.removeEventListener("gestureend", onGestureEnd);
      view.removeEventListener("touchstart", onTouchStart);
      view.removeEventListener("touchmove", onTouchMove);
      view.removeEventListener("touchend", onTouchEnd);
      view.removeEventListener("touchcancel", onTouchEnd);
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
        // At the fit a vertical drag scrolls the page (in Chrome too); zoomed in, every touch is the map's.
        className={cx("absolute inset-0 overflow-hidden select-none", atFit ? "touch-pan-y" : "touch-none")}
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
