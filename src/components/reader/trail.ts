/**
 * A visit to a book is one step in the browser's history, however far the reader goes inside it:
 * turning to another chapter, following a link, using Contents or the back pill replaces that step
 * instead of adding one. So a Back from outside the page always leaves the book, for the page it
 * was opened from: the iPhone's swipe in from the left edge (which goes exactly one step, and so
 * used to land on the chapter before), a browser's Back button.
 *
 * The reader's own Back arrow still goes back through the book first, a place at a time, as it did
 * when each of those moves was a step of its own. The places are kept on a trail inside the step's
 * state, so they stay with it through a reload, and through leaving the book and coming back to it
 * with Forward.
 */

/** A place the reader left inside the book: where its Back arrow goes next. */
export interface TrailStep {
  /** The path and hash. */
  to: string;
  /** The state the place was opened with, less its own trail. */
  state: Record<string, unknown> | null;
}

/** The trail keeps this many places, the latest: beyond them the arrow leaves the book. */
export const TRAIL_MAX = 50;

/** Where the reader is: the router's location. */
export interface Here {
  pathname: string;
  hash: string;
  state: unknown;
}

function isStep(value: unknown): value is TrailStep {
  return typeof value === "object" && value !== null && typeof (value as TrailStep).to === "string";
}

/** The places behind a location, oldest first; none for a book just opened. */
export function trailOf(state: unknown): TrailStep[] {
  const trail = typeof state === "object" && state !== null ? (state as { trail?: unknown }).trail : undefined;
  return Array.isArray(trail) ? trail.filter(isStep) : [];
}

/** A location's state as the page opened with it, without the trail; null when nothing is left. */
function ownState(state: unknown): Record<string, unknown> | null {
  if (typeof state !== "object" || state === null) return null;
  const { trail: _trail, ...rest } = state as Record<string, unknown>;
  return Object.keys(rest).length > 0 ? rest : null;
}

function withTrail(state: Record<string, unknown> | null, trail: TrailStep[]): Record<string, unknown> | null {
  if (trail.length === 0) return state;
  return { ...state, trail };
}

/**
 * How to navigate to another place in the open book, `to` (a path, with its hash), opened with
 * `state`: in place of the visit's one history step, with the place being left added to the trail.
 * Opening the place the reader is already at (its chapter in Contents) adds nothing to the trail.
 */
export function moveInside(
  here: Here,
  to: string,
  state: Record<string, unknown> | null = null,
): { replace: true; state: Record<string, unknown> | null } {
  const behind = trailOf(here.state);
  const from = here.pathname + here.hash;
  const trail = to === from ? behind : [...behind, { to: from, state: ownState(here.state) }].slice(-TRAIL_MAX);
  return { replace: true, state: withTrail(state, trail) };
}

/**
 * The Back arrow's step inside the book: the place before this one, opened as it was, with the rest
 * of the trail behind it. Null when there is none: Back then leaves the book.
 */
export function stepBack(state: unknown): { to: string; replace: true; state: Record<string, unknown> | null } | null {
  const trail = trailOf(state);
  const last = trail[trail.length - 1];
  if (!last) return null;
  return { to: last.to, replace: true, state: withTrail(ownState(last.state), trail.slice(0, -1)) };
}
