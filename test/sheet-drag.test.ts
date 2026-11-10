import { describe, expect, it } from "vitest";
import {
  SHEET_DRAG_OUT_MS,
  SHEET_FADE_MS,
  SHEET_IN_MS,
  SHEET_OUT_MS,
  sheetExitMs,
  sheetOffset,
  sheetRelease,
} from "@/components/ui/sheetDrag";

describe("sheet timing", () => {
  it("leaves at least twice as fast as it arrives, after a tap", () => {
    expect(SHEET_IN_MS).toBe(300);
    expect(SHEET_OUT_MS).toBe(150);
    expect(sheetExitMs("tap", false)).toBe(150);
  });

  it("follows through for longer after a drag", () => {
    expect(SHEET_DRAG_OUT_MS).toBe(250);
    expect(sheetExitMs("drag", false)).toBe(250);
  });

  it("fades for 200 ms under reduced motion, whatever closed it", () => {
    expect(SHEET_FADE_MS).toBe(200);
    expect(sheetExitMs("tap", true)).toBe(200);
    expect(sheetExitMs("drag", true)).toBe(200);
  });
});

describe("sheet drag", () => {
  it("follows a finger down, never up", () => {
    expect(sheetOffset(-30)).toBe(0);
    expect(sheetOffset(0)).toBe(0);
    expect(sheetOffset(42)).toBe(42);
  });

  it("closes past 30% of the sheet's height", () => {
    expect(sheetRelease(120, 2000, 400)).toBe("close");
    expect(sheetRelease(116, 2000, 400)).toBe("stay");
  });

  it("closes on a flick that went far enough", () => {
    expect(sheetRelease(50, 50, 600)).toBe("close");
    expect(sheetRelease(30, 30, 600)).toBe("stay");
  });

  it("stays when dragged up or not at all", () => {
    expect(sheetRelease(0, 10, 400)).toBe("stay");
    expect(sheetRelease(-200, 50, 400)).toBe("stay");
  });
});
