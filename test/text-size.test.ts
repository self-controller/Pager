import { describe, expect, it } from "vitest";
import { bodyBase, bodySize, canGrow, canShrink, largerOffset, smallerOffset } from "@/components/reader/textSize";
import { FONT_OFFSET_MAX, FONT_OFFSET_MIN } from "@/state/settings";

describe("text size", () => {
  const phone = bodyBase(true);
  const desktop = bodyBase(false);

  it("starts at 17px under 768px and 19px otherwise", () => {
    expect(phone).toBe(17);
    expect(desktop).toBe(19);
    expect(bodySize(phone, 0)).toBe(17);
    expect(bodySize(desktop, 0)).toBe(19);
    expect(bodySize(phone, 4)).toBe(21);
  });

  it("never reads below the 16px floor", () => {
    expect(bodySize(phone, -1)).toBe(16);
    expect(bodySize(phone, -2)).toBe(16);
    expect(bodySize(phone, FONT_OFFSET_MIN)).toBe(16);
    expect(bodySize(desktop, FONT_OFFSET_MIN)).toBe(16);
  });

  it("stops Smaller at the floor", () => {
    expect(canShrink(phone, 0)).toBe(true);
    expect(smallerOffset(phone, 0)).toBe(-1);
    expect(canShrink(phone, -1)).toBe(false);
    expect(canShrink(phone, FONT_OFFSET_MIN)).toBe(false);
    expect(smallerOffset(phone, -1)).toBe(-1);
    // A desktop reaches the floor at the lowest offset.
    expect(canShrink(desktop, -2)).toBe(true);
    expect(canShrink(desktop, FONT_OFFSET_MIN)).toBe(false);
  });

  it("grows by one step you can see, from the floor when the stored offset is below it", () => {
    expect(largerOffset(phone, 0)).toBe(1);
    expect(largerOffset(phone, -1)).toBe(0);
    for (const below of [-2, FONT_OFFSET_MIN]) {
      const next = largerOffset(phone, below);
      expect(next).toBe(0);
      expect(bodySize(phone, next)).toBe(17);
    }
    expect(largerOffset(desktop, FONT_OFFSET_MIN)).toBe(-2);
    expect(bodySize(desktop, -2)).toBe(17);
  });

  it("stops Larger at the highest offset", () => {
    expect(canGrow(FONT_OFFSET_MAX - 1)).toBe(true);
    expect(canGrow(FONT_OFFSET_MAX)).toBe(false);
    expect(largerOffset(phone, FONT_OFFSET_MAX)).toBe(FONT_OFFSET_MAX);
  });
});
