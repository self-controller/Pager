import { FONT_OFFSET_MAX, FONT_OFFSET_MIN } from "@/state/settings";

/** The body size before the reader's offset, as tokens.css sets `--font-size-body-base`. */
export const BODY_SIZE_WIDE = 19;
export const BODY_SIZE_NARROW = 17;
/** The floor in `--font-size-body`. */
export const BODY_SIZE_FLOOR = 16;

export function bodyBase(narrow: boolean): number {
  return narrow ? BODY_SIZE_NARROW : BODY_SIZE_WIDE;
}

/** The size the text really has: what `--font-size-body` works out to. */
export function bodySize(base: number, offset: number): number {
  return Math.max(BODY_SIZE_FLOOR, base + offset);
}

/** Whether one step down would still change the text. */
export function canShrink(base: number, offset: number): boolean {
  return offset > FONT_OFFSET_MIN && base + offset > BODY_SIZE_FLOOR;
}

export function canGrow(offset: number): boolean {
  return offset < FONT_OFFSET_MAX;
}

/**
 * The offset one step larger. An offset stored below the floor (set on a wider screen) steps up from
 * the floor, so the press always shows.
 */
export function largerOffset(base: number, offset: number): number {
  return Math.min(FONT_OFFSET_MAX, Math.max(offset, BODY_SIZE_FLOOR - base) + 1);
}

export function smallerOffset(base: number, offset: number): number {
  return canShrink(base, offset) ? offset - 1 : offset;
}
