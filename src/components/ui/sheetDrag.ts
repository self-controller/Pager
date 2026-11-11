// The numbers behind a bottom sheet (Sheet.tsx): how long it slides, and when a drag on its grip
// or header lets it go. Pure, so the rules are tested without a touch screen. The durations are
// repeated in tokens.css (`--sheet-*`): change both.

/** The sheet rises over this long, settling like a spring… */
export const SHEET_IN_MS = 440;
/** …and a tall one, with further to travel, a little longer. */
export const SHEET_IN_TALL_MS = 480;
/** Closed by a tap (✕, the scrim, Esc, a menu pick, its owner), it leaves this fast… */
export const SHEET_OUT_MS = 230;
/** …and a tall one over this long, so it doesn't streak off the screen. */
export const SHEET_OUT_TALL_MS = 300;
/** …but let go after a drag, it follows through from under the finger over this long. */
export const SHEET_DRAG_OUT_MS = 250;
/** Under reduced motion it fades in and out over this long, and never slides. */
export const SHEET_FADE_MS = 200;
/** Dragged down past this share of its height, a released sheet closes. */
export const SHEET_DISMISS_FRACTION = 0.3;
/** A flick down at this speed (px per ms) closes it too… */
export const SHEET_FLICK_VELOCITY = 0.5;
/** …once it has moved at least this far, so a twitch doesn't. */
export const SHEET_FLICK_MIN_PX = 40;

/** What closed a sheet: a tap of any kind, or a drag that let go. */
export type SheetExit = "tap" | "drag";

/** "content" grows with what it holds; "tall" takes most of the screen. A tray is always "content". */
export type SheetSize = "content" | "tall";

/** How long the way out takes for what closed it, and how far it has to go. */
export function sheetExitMs(exit: SheetExit, reducedMotion: boolean, size: SheetSize = "content"): number {
  if (reducedMotion) return SHEET_FADE_MS;
  if (exit === "drag") return SHEET_DRAG_OUT_MS;
  return size === "tall" ? SHEET_OUT_TALL_MS : SHEET_OUT_MS;
}

/**
 * The vertical offset in a computed `transform` ("none", `matrix(…)` or `matrix3d(…)`), in px; 0
 * for anything else. By hand, since not every DOM has DOMMatrix.
 */
export function translateYOf(transform: string): number {
  const m = /^matrix(3d)?\(([^)]*)\)$/.exec(transform.trim());
  if (!m) return 0;
  const parts = (m[2] ?? "").split(",").map(Number);
  const ty = m[1] ? parts.length === 16 && parts[13] : parts.length === 6 && parts[5];
  return typeof ty === "number" && Number.isFinite(ty) ? ty : 0;
}

/** How far the sheet follows a finger that has moved `dy` down: never up past where it rests. */
export function sheetOffset(dy: number): number {
  return Math.max(0, dy);
}

/**
 * What a sheet of `height` does when a drag of `dy` px over `ms` ends: closes, or slides back.
 * `from` is how far below its resting place the drag caught it (still rising). It counts toward
 * how far down the sheet is, but not toward a flick: a finger that lands on a rising sheet and
 * lifts at once has not flicked it.
 */
export function sheetRelease(dy: number, ms: number, height: number, from = 0): "close" | "stay" {
  if (dy <= 0) return "stay";
  if (from + dy >= SHEET_DISMISS_FRACTION * height) return "close";
  if (dy >= SHEET_FLICK_MIN_PX && dy / Math.max(1, ms) >= SHEET_FLICK_VELOCITY) return "close";
  return "stay";
}
