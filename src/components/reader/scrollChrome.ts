/**
 * The Scroll layout's chrome follows the scroll, as YouVersion's reader does: scrolling down a little
 * hides the bars, scrolling up a little brings them back, and at the top of a chapter they always
 * show. Pure, so the rule can be tested; useScrollChrome feeds it scroll positions.
 */

/** Scrolling this far one way, without turning back, hides (down) or shows (up) the chrome. */
export const CHROME_SCROLL_PX = 10;
/** After a chapter turn the chrome stays shown this long, while the new chapter settles. */
export const CHROME_HOLD_MS = 500;

export interface ChromeScroll {
  /** The last scrollTop seen, clamped into the scroll range. */
  last: number;
  /** Distance scrolled in one direction since it last changed (+ down, − up). */
  acc: number;
  /** Until then, scrolling neither hides nor shows. */
  holdUntil: number;
}

export const initialChromeScroll = (top = 0): ChromeScroll => ({ last: Math.max(0, top), acc: 0, holdUntil: 0 });

/**
 * One scroll position: whether the chrome should now show (true), hide (false), or stay (null).
 * `top` at or above 0 (rubber-banding past the top included) always shows. Positions past `max`
 * count as `max`, so the bounce back from the bottom isn't taken for scrolling up.
 */
export function chromeStep(
  state: ChromeScroll,
  e: { top: number; max: number; now: number },
): { state: ChromeScroll; show: boolean | null } {
  const top = Math.min(e.top, Math.max(0, e.max));
  if (e.now < state.holdUntil) return { state: { ...state, last: Math.max(0, top), acc: 0 }, show: null };
  if (top <= 0) return { state: { ...state, last: 0, acc: 0 }, show: true };
  const d = top - state.last;
  if (d === 0) return { state, show: null };
  const acc = state.acc === 0 || Math.sign(d) === Math.sign(state.acc) ? state.acc + d : d;
  if (acc >= CHROME_SCROLL_PX) return { state: { ...state, last: top, acc: 0 }, show: false };
  if (acc <= -CHROME_SCROLL_PX) return { state: { ...state, last: top, acc: 0 }, show: true };
  return { state: { ...state, last: top, acc }, show: null };
}

/** Holds the chrome as it is for `ms`. */
export function holdChrome(state: ChromeScroll, now: number, ms = CHROME_HOLD_MS): ChromeScroll {
  return { ...state, acc: 0, holdUntil: now + ms };
}
