import { describe, expect, it } from "vitest";
import {
  SHEET_DRAG_OUT_MS,
  SHEET_FADE_MS,
  SHEET_IN_MS,
  SHEET_IN_TALL_MS,
  SHEET_OUT_MS,
  SHEET_OUT_TALL_MS,
  sheetExitMs,
  sheetOffset,
  sheetRelease,
  translateYOf,
} from "@/components/ui/sheetDrag";

describe("sheet timing", () => {
  it("rises over 440 ms, a tall sheet over 480 ms", () => {
    expect(SHEET_IN_MS).toBe(440);
    expect(SHEET_IN_TALL_MS).toBe(480);
  });

  it("leaves in 230 ms after a tap, a tall sheet in 300 ms", () => {
    expect(SHEET_OUT_MS).toBe(230);
    expect(SHEET_OUT_TALL_MS).toBe(300);
    expect(sheetExitMs("tap", false)).toBe(230);
    expect(sheetExitMs("tap", false, "content")).toBe(230);
    expect(sheetExitMs("tap", false, "tall")).toBe(300);
  });

  it("follows through over 250 ms after a drag, whatever its size", () => {
    expect(SHEET_DRAG_OUT_MS).toBe(250);
    expect(sheetExitMs("drag", false)).toBe(250);
    expect(sheetExitMs("drag", false, "tall")).toBe(250);
  });

  it("fades for 200 ms under reduced motion, whatever closed it", () => {
    expect(SHEET_FADE_MS).toBe(200);
    expect(sheetExitMs("tap", true)).toBe(200);
    expect(sheetExitMs("tap", true, "tall")).toBe(200);
    expect(sheetExitMs("drag", true)).toBe(200);
    expect(sheetExitMs("drag", true, "tall")).toBe(200);
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

  it("counts where a rising sheet was caught toward its distance, not toward a flick", () => {
    // Caught 100 px down a 400 px sheet, dragged 20 px more: 120 px is past 30%.
    expect(sheetRelease(20, 2000, 400, 100)).toBe("close");
    expect(sheetRelease(10, 2000, 400, 100)).toBe("stay");
    // A quick touch that barely moved is no flick, however far down it caught the sheet.
    expect(sheetRelease(10, 20, 600, 150)).toBe("stay");
    // Caught and lifted without moving down: it slides back.
    expect(sheetRelease(0, 20, 400, 300)).toBe("stay");
  });
});

describe("reading a computed transform", () => {
  it("reads no offset from none or nothing", () => {
    expect(translateYOf("none")).toBe(0);
    expect(translateYOf("")).toBe(0);
  });

  it("reads the offset of a 2D matrix", () => {
    expect(translateYOf("matrix(1, 0, 0, 1, 0, 180)")).toBe(180);
    expect(translateYOf("matrix(1, 0, 0, 1, 12, 42.5)")).toBe(42.5);
  });

  it("reads the offset of a 3D matrix", () => {
    expect(translateYOf("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 96, 0, 1)")).toBe(96);
  });

  it("reads no offset from anything else", () => {
    expect(translateYOf("translateY(40px)")).toBe(0);
    expect(translateYOf("matrix(1, 0, 0)")).toBe(0);
    expect(translateYOf("matrix(a, b, c, d, e, f)")).toBe(0);
  });
});
