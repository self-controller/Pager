import { describe, expect, it } from "vitest";
import { sheetOffset, sheetRelease } from "@/components/ui/sheetDrag";

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
