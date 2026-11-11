/**
 * The chapter turn in the Scroll layout: pure rules for the sideways drag that slides one chapter
 * out and its neighbour in, as a page turn. ScrollView gathers the pointer facts and asks here.
 * Timings follow UIPageViewController's feel; YouVersion's own reader only has buttons
 * (research_notes/iOS reading app UI patterns/youversion.md).
 */

import { LONG_PRESS_MS, type PointerKind } from "./gestures";

/** Space between two chapters while both are on screen. */
export const CHAPTER_GAP = 24;
/** A press decides between a sideways drag and a vertical scroll once it has moved this far. */
export const DRAG_ENGAGE_PX = 10;
/** …and it is a drag only when this many times more sideways than up or down. */
export const DRAG_AXIS_RATIO = 2;
/** Presses this close to the left edge belong to the back swipe: the iPhone app's, or a browser's. It leaves the book. */
export const EDGE_GUARD_PX = 24;
/** A drag past this share of the width turns when released. */
export const COMMIT_FRACTION = 0.3;
/** A flick this fast (px/ms) turns too, once it has travelled FLING_MIN_PX. */
export const FLING_VELOCITY = 0.4;
export const FLING_MIN_PX = 40;
/** Toward a side with no chapter the page moves this much per px of drag, and always comes back. */
export const RUBBER_BAND = 0.35;
/** After release, the rest of a turn takes this long, scaled by the distance left. */
export const SETTLE_MIN_MS = 220;
export const SETTLE_MAX_MS = 320;
export const SNAP_BACK_MS = 250;
/** A turn from a button or a key slides the whole way in this long. */
export const BUTTON_TURN_MS = 280;
/** With reduced motion the new chapter fades in instead of sliding. */
export const FADE_TURN_MS = 150;
export const TURN_EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
/** Release velocity is measured over the last stretch of the drag. */
export const VELOCITY_WINDOW_MS = 100;

/** What was known when a press went down. */
export interface DragStart {
  kind: PointerKind;
  primary: boolean;
  /** Viewport x of the press. */
  x: number;
  /** The press is on a floating panel or a control of its own. */
  inOverlay: boolean;
  hadSelection: boolean;
  hadOverlay: boolean;
  /** visualViewport.scale: a pinch-zoomed page pans instead. */
  zoom: number;
  /** A turn is still settling. */
  turning: boolean;
}

/** Whether a press may become a chapter drag. A mouse never drags: it selects text. */
export function canStartDrag(s: DragStart): boolean {
  return (
    s.kind !== "mouse" &&
    s.primary &&
    !s.inOverlay &&
    !s.hadSelection &&
    !s.hadOverlay &&
    s.zoom <= 1.01 &&
    s.x >= EDGE_GUARD_PX &&
    !s.turning
  );
}

/**
 * What a press that may drag has become: still undecided, a sideways drag, a vertical scroll, or a
 * long press (the start of a text selection), which never drags.
 */
export function dragIntent(dx: number, dy: number, ms: number): "pending" | "drag" | "scroll" | "hold" {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < DRAG_ENGAGE_PX) return ms >= LONG_PRESS_MS ? "hold" : "pending";
  return ax >= DRAG_AXIS_RATIO * ay ? "drag" : "scroll";
}

/** How far the track moves for a drag of `dx`: one to one, rubber-banded toward a missing chapter. */
export function dragOffset(dx: number, width: number, canPrev: boolean, canNext: boolean): number {
  const open = dx > 0 ? canPrev : canNext;
  const x = open ? dx : dx * RUBBER_BAND;
  const span = width + CHAPTER_GAP;
  return Math.max(-span, Math.min(span, x));
}

/** The finger's speed at release, in px/ms (signed like dx); 0 when it had stopped. */
export function releaseVelocity(samples: readonly { x: number; t: number }[], now: number): number {
  const recent = samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS);
  if (recent.length < 2) return 0;
  const first = recent[0]!;
  const last = recent[recent.length - 1]!;
  const dt = last.t - first.t;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}

/**
 * Whether a released drag turns: 1 to the next chapter (finger moved left), -1 to the previous, 0
 * back where it was. It turns past COMMIT_FRACTION of the width, or on a quick flick; a quick flick
 * back toward the start cancels, as in UIKit.
 */
export function dragOutcome(o: { dx: number; velocity: number; width: number; canPrev: boolean; canNext: boolean }): 1 | -1 | 0 {
  const { dx, velocity, width } = o;
  if (dx === 0) return 0;
  const dir = dx < 0 ? 1 : -1;
  if (!(dir === 1 ? o.canNext : o.canPrev)) return 0;
  const along = Math.sign(velocity) === Math.sign(dx);
  if (!along && Math.abs(velocity) >= FLING_VELOCITY) return 0;
  if (Math.abs(dx) > COMMIT_FRACTION * width) return dir;
  if (along && Math.abs(velocity) >= FLING_VELOCITY && Math.abs(dx) >= FLING_MIN_PX) return dir;
  return 0;
}

/** The rest of a turn: longer the more is left, between SETTLE_MIN_MS and SETTLE_MAX_MS. */
export function settleDuration(remaining: number, span: number): number {
  const f = span > 0 ? Math.min(1, Math.max(0, Math.abs(remaining) / span)) : 1;
  return Math.round(SETTLE_MIN_MS + (SETTLE_MAX_MS - SETTLE_MIN_MS) * f);
}

/** Where the track stops with the neighbour fully in view. */
export function turnTarget(dir: 1 | -1, width: number): number {
  return dir === 1 ? -(width + CHAPTER_GAP) : width + CHAPTER_GAP;
}

/** A sideways trackpad swipe turns once it has gone this far… */
export const WHEEL_TURN_PX = 80;
/** …then the wheel is ignored this long, */
export const WHEEL_LOCK_MS = 600;
/** …and until it has been still this long, so a swipe's momentum never turns twice. */
export const WHEEL_QUIET_MS = 200;

export interface WheelState {
  acc: number;
  last: number;
  lockedUntil: number;
}

export const initialWheel = (): WheelState => ({ acc: 0, last: -Infinity, lockedUntil: 0 });

/** One wheel event: mostly sideways ones add up to a turn (positive deltaX is toward the next chapter). */
export function wheelTurn(
  state: WheelState,
  e: { dx: number; dy: number; now: number },
): { state: WheelState; turn: 1 | -1 | 0 } {
  const { dx, dy, now } = e;
  if (Math.abs(dx) <= Math.abs(dy)) return { state: { ...state, acc: 0, last: now }, turn: 0 };
  // Still moving: momentum from the swipe that turned keeps the lock on.
  if (now < state.lockedUntil)
    return { state: { acc: 0, last: now, lockedUntil: Math.max(state.lockedUntil, now + WHEEL_QUIET_MS) }, turn: 0 };
  const acc = (now - state.last > WHEEL_QUIET_MS ? 0 : state.acc) + dx;
  if (Math.abs(acc) < WHEEL_TURN_PX) return { state: { ...state, acc, last: now }, turn: 0 };
  return { state: { acc: 0, last: now, lockedUntil: now + WHEEL_LOCK_MS }, turn: acc > 0 ? 1 : -1 };
}
