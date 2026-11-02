import { describe, expect, it } from "vitest";
import { AWAY_PAGES, jumped, pagesBetween, pillFor, pillText, repaged, seen, used, type Place } from "@/components/reader/useJumpHistory";

const place = (sectionId: string, sectionIndex: number, page: number, pageCount = 20, title = `Chapter ${sectionIndex + 1}`): Place => ({
  sectionId,
  sectionIndex,
  title,
  page,
  pageCount,
  point: { blockId: `${sectionId}-b${page}`, offset: 0 },
});

describe("pages between places", () => {
  it("counts within a chapter", () => {
    expect(pagesBetween(place("a", 0, 3), place("a", 0, 7))).toBe(4);
    expect(pagesBetween(place("a", 0, 7), place("a", 0, 7))).toBe(0);
  });

  it("counts across one chapter boundary", () => {
    // Last page of chapter 1 to the first of chapter 2 is one turn.
    expect(pagesBetween(place("a", 0, 19), place("b", 1, 0))).toBe(1);
    expect(pagesBetween(place("b", 1, 2), place("a", 0, 18))).toBe(4);
  });

  it("calls anything further far", () => {
    expect(pagesBetween(place("a", 0, 19), place("c", 2, 0))).toBe(Infinity);
  });
});

describe("jump history", () => {
  const origin = place("a", 0, 41);

  it("shows nothing until the jump lands", () => {
    const j = jumped("doc", origin);
    expect(pillFor(j, "doc", place("a", 0, 41))).toBeNull();
    const landed = seen(j, place("c", 2, 3))!;
    expect(landed.from?.sectionId).toBe("c");
    expect(pillFor(landed, "doc", place("c", 2, 3))).toEqual({ kind: "back", page: 42, chapter: "Chapter 1" });
  });

  it("waits for a jump to another chapter to land there", () => {
    const j = jumped("doc", origin, "c");
    // A slide in chapter a settling after the jump started isn't its landing.
    expect(seen(j, place("a", 0, 44))).toBe(j);
    expect(seen(j, place("c", 2, 0))?.from?.sectionId).toBe("c");
    expect(jumped("doc", origin, "a").toward).toBeUndefined();
  });

  it("forgets a jump that landed where it started", () => {
    expect(seen(jumped("doc", origin), place("a", 0, 41))).toBeNull();
  });

  it("stays while the reader is near either end, and goes 3 pages away from both", () => {
    let j = seen(jumped("doc", origin), place("a", 0, 86));
    j = seen(j, place("a", 0, 87));
    j = seen(j, place("a", 0, 88));
    expect(j).not.toBeNull();
    j = seen(j, place("a", 0, 86 + AWAY_PAGES));
    expect(j).toBeNull();
  });

  it("counts turning back towards the origin as near", () => {
    let j = seen(jumped("doc", origin), place("a", 0, 45));
    j = seen(j, place("a", 0, 43));
    expect(j).not.toBeNull();
    expect(pillFor(j, "doc", place("a", 0, 43))?.page).toBe(42);
  });

  it("flips between back and return", () => {
    const landed = seen(jumped("doc", origin), place("a", 0, 86))!;
    const target = place("a", 0, 86);
    const back = used(landed, target);
    expect(back.kind).toBe("return");
    expect(back.to).toBe(target);
    expect(back.from).toBe(origin);
    const arrived = seen(back, place("a", 0, 41));
    expect(pillFor(arrived, "doc", place("a", 0, 41))).toEqual({ kind: "return", page: 87 });

    const again = used(arrived!, place("a", 0, 41));
    expect(again.kind).toBe("back");
    expect(pillFor(seen(again, place("a", 0, 86)), "doc", place("a", 0, 86))).toEqual({ kind: "back", page: 42 });
  });

  it("hides on the page it would go to and in another document", () => {
    const landed = seen(jumped("doc", origin), place("a", 0, 86));
    expect(pillFor(landed, "doc", place("a", 0, 41))).toBeNull();
    expect(pillFor(landed, "other", place("a", 0, 86))).toBeNull();
    expect(pillFor(landed, "doc", null)).toBeNull();
  });

  it("moves its places after a relayout", () => {
    const landed = seen(jumped("doc", origin), place("c", 2, 3))!;
    const moved = repaged(landed, "a", 30, (point) => (point.blockId === "a-b41" ? 60 : null));
    expect(moved.to.page).toBe(60);
    expect(moved.to.pageCount).toBe(30);
    // The landing in another chapter is left alone.
    expect(moved.from).toEqual(landed.from);
    // A place without words to find keeps its page, inside the new count.
    const bare = repaged({ ...landed, to: { ...origin, point: null } }, "a", 10, () => null);
    expect(bare.to.page).toBe(9);
  });
});

describe("pill text", () => {
  it("names the page, and the chapter when it's another", () => {
    expect(pillText({ kind: "back", page: 42 })).toBe("Back to p. 42");
    expect(pillText({ kind: "return", page: 87, chapter: "Chapter 3" })).toBe("Return to p. 87 · Chapter 3");
  });

  it("has no page numbers in the scroll layout", () => {
    expect(pillText({ kind: "back" })).toBe("Back");
    expect(pillText({ kind: "return", chapter: "Chapter 3" })).toBe("Return to Chapter 3");
    const j = seen(jumped("doc", place("a", 0, 41)), place("c", 2, 3))!;
    expect(pillFor(j, "doc", place("c", 2, 3), "none")).toEqual({ kind: "back", chapter: "Chapter 1" });
    expect(pillFor(j, "doc", place("c", 2, 3), "none")?.page).toBeUndefined();
  });
});
