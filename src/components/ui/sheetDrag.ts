// The numbers behind a bottom sheet (Sheet.tsx): how long it slides, and when a drag on its grip
// or header lets it go. Pure, so the rules are tested without a touch screen. The durations are
// repeated in the `.sheet` rules of globals.css: change both.

/** The sheet rises over this long. */
export const SHEET_IN_MS = 300;
/** Closed by a tap (✕, the scrim, Esc, a menu pick, its owner), it leaves this fast… */
export const SHEET_OUT_MS = 150;
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

/** How long the way out takes for what closed it. */
export function sheetExitMs(exit: SheetExit, reducedMotion: boolean): number {
  if (reducedMotion) return SHEET_FADE_MS;
  return exit === "drag" ? SHEET_DRAG_OUT_MS : SHEET_OUT_MS;
}

/** How far the sheet follows a finger that has moved `dy` down: never up past where it rests. */
export function sheetOffset(dy: number): number {
  return Math.max(0, dy);
}

/** What a sheet of `height` does when a drag of `dy` px over `ms` ends: closes, or slides back. */
export function sheetRelease(dy: number, ms: number, height: number): "close" | "stay" {
  if (dy <= 0) return "stay";
  if (dy >= SHEET_DISMISS_FRACTION * height) return "close";
  if (dy >= SHEET_FLICK_MIN_PX && dy / Math.max(1, ms) >= SHEET_FLICK_VELOCITY) return "close";
  return "stay";
}
