/**
 * The reader's touch arbiter: pure rules for what one press on the page does. PagedView gathers the
 * facts (where, how long, whether the pages scrolled, what was open) and asks here. One tap does one
 * thing, and a doubtful press does nothing. Thresholds follow Readest's (15 px slop, 500 ms hold).
 */

import type { PageTurn } from "@/state/settings";

/** A release within this many px of the press is still a tap. */
export const TAP_SLOP = 15;
/** Held this long, a press is a long press: it never turns or toggles anything. */
export const LONG_PRESS_MS = 500;
/** A release this soon after the pages stopped scrolling ends the scroll; it isn't a tap. */
export const SCROLL_SETTLE_MS = 150;
/** A swipe the pages can't follow themselves (from the margin, past either end) turns after this far. */
export const SWIPE_MIN = 40;
/** …and within this long, unless it travelled across 30% of the page. */
export const SWIPE_MAX_MS = 600;

/** Floating reader UI: popovers, menus, drawers. Each carries `data-reader-overlay`. */
export const OVERLAY_SELECTOR = "[data-reader-overlay], [role='dialog']";
/** Targets that act on a click themselves; the page zones leave them alone. */
export const INTERACTIVE_SELECTOR = "a, button, input, textarea, select, label, [contenteditable='true'], [data-reader-overlay]";

export type PointerKind = "mouse" | "touch" | "pen";

export function pointerKind(type: string): PointerKind {
  return type === "touch" || type === "pen" ? type : "mouse";
}

/** What was known when a press went down and came up. */
export interface Press {
  kind: PointerKind;
  dx: number;
  dy: number;
  ms: number;
  /** A person scrolled the pages between press and release. */
  scrolled: boolean;
  /** Milliseconds from the last scroll a person made to the release; Infinity when none. */
  sinceScroll: number;
  /** A text selection was open when the press began. */
  hadSelection: boolean;
  /** A reader overlay was open when the press began. */
  hadOverlay: boolean;
}

/**
 * "tap": free to act. "dismiss": it only closed a selection or an overlay. "ignore": not a tap at all
 * (it moved, ended a scroll, or was held). Anything but "tap" does nothing else, links included.
 * A mouse press has no long-press rule: a slow click is still a click.
 */
export function judgePress(p: Press): "tap" | "dismiss" | "ignore" {
  if (p.hadSelection || p.hadOverlay) return "dismiss";
  if (Math.hypot(p.dx, p.dy) > TAP_SLOP) return "ignore";
  if (p.kind !== "mouse" && p.ms >= LONG_PRESS_MS) return "ignore";
  if (p.scrolled || p.sinceScroll < SCROLL_SETTLE_MS) return "ignore";
  return "tap";
}

export type Zone = "prev" | "centre" | "next";

/**
 * Where across the page (0–1) a tap landed. Touch and pen: the left 37.5% goes back, the right 37.5%
 * forward, the band between is the chrome toggle. Mouse: only the outer 18% on each side turns.
 */
export function zoneAt(fraction: number, kind: PointerKind): Zone | null {
  if (kind === "mouse") return fraction < 0.18 ? "prev" : fraction > 0.82 ? "next" : null;
  return fraction < 0.375 ? "prev" : fraction > 0.625 ? "next" : "centre";
}

/**
 * The Scroll layout has no turning zones: any touch or pen tap is the centre's (the chrome toggle),
 * so a tap never changes chapter by accident. A mouse click on the page does nothing.
 */
export function scrollZone(kind: PointerKind): Zone | null {
  return kind === "mouse" ? null : "centre";
}

export type TapAction = "prev" | "next" | "toggle-chrome" | "hide-chrome";

/**
 * What a tap in a zone does. The centre band toggles the chrome; while the chrome shows, a touch tap
 * anywhere else only hides it ("the first tap only hides"). A mouse never hides the chrome.
 */
export function tapAction(zone: Zone | null, kind: PointerKind, chromeVisible: boolean): TapAction | null {
  if (!zone) return null;
  if (kind === "mouse") return zone === "centre" ? null : zone;
  if (zone === "centre") return "toggle-chrome";
  return chromeVisible ? "hide-chrome" : zone;
}

/** A horizontal swipe as a page turn: 1 forward (finger moving left), -1 back, 0 not a swipe. */
export function swipeTurn(dx: number, dy: number, ms: number, width: number): 1 | -1 | 0 {
  const ax = Math.abs(dx);
  if (ax < SWIPE_MIN || ax < 1.5 * Math.abs(dy)) return 0;
  if (ms > SWIPE_MAX_MS && ax < 0.3 * width) return 0;
  return dx < 0 ? 1 : -1;
}

/** How a tap or key turn moves: the setting, except that reduced motion makes every turn a cut. */
export function turnMotion(setting: PageTurn, reducedMotion: boolean): PageTurn {
  return reducedMotion ? "none" : setting;
}
