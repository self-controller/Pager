import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetSpot,
  MAX_BOOKS,
  MAX_CHAPTERS,
  parseSpots,
  rememberSpot,
  resetChapterSpots,
  spotFor,
} from "@/components/reader/chapterSpots";

// A chapter turn opens the chapter where the reader last was in it, on this device.

describe("chapter spots", () => {
  beforeEach(() => resetChapterSpots());
  afterEach(() => vi.useRealTimers());

  it("tells a spot, the chapter's start and a chapter not read yet apart", () => {
    rememberSpot("d1", "s1", { blockId: "b7", offset: 42 });
    rememberSpot("d1", "s2", null);
    expect(spotFor("d1", "s1")).toEqual({ blockId: "b7", offset: 42 });
    expect(spotFor("d1", "s2")).toBeNull();
    expect(spotFor("d1", "s3")).toBeUndefined();
    expect(spotFor("d2", "s1")).toBeUndefined();
  });

  it("keeps the latest spot, and forgets one on request", () => {
    rememberSpot("d1", "s1", { blockId: "b1", offset: 0 });
    rememberSpot("d1", "s1", { blockId: "b9", offset: 3 });
    expect(spotFor("d1", "s1")).toEqual({ blockId: "b9", offset: 3 });
    forgetSpot("d1", "s1");
    expect(spotFor("d1", "s1")).toBeUndefined();
  });

  it("stores the spots, and reads them back past anything malformed", () => {
    rememberSpot("d1", "s1", { blockId: "b2", offset: 5 });
    const raw = localStorage.getItem("pager.chapterSpots");
    expect(parseSpots(raw)).toMatchObject({ d1: { spots: { s1: { blockId: "b2", offset: 5 } } } });
    expect(parseSpots("not json")).toEqual({});
    expect(parseSpots("[1]")).toEqual({});
    expect(
      parseSpots(JSON.stringify({ d1: { at: 1, spots: { s1: { blockId: 3 }, s2: null, s3: { blockId: "b", offset: 1 } } }, d2: 7 })),
    ).toEqual({ d1: { at: 1, spots: { s2: null, s3: { blockId: "b", offset: 1 } } } });
  });

  it("keeps the most recent chapters of a book", () => {
    for (let i = 0; i < MAX_CHAPTERS + 5; i++) rememberSpot("d1", `s${i}`, null);
    expect(spotFor("d1", "s0")).toBeUndefined();
    expect(spotFor("d1", "s4")).toBeUndefined();
    expect(spotFor("d1", "s5")).toBeNull();
    expect(spotFor("d1", `s${MAX_CHAPTERS + 4}`)).toBeNull();
  });

  it("keeps the most recently read books", () => {
    vi.useFakeTimers();
    for (let i = 0; i < MAX_BOOKS + 2; i++) {
      vi.setSystemTime(1000 + i);
      rememberSpot(`d${i}`, "s1", null);
    }
    // Reading the first kept book again makes it the newest.
    vi.setSystemTime(5000);
    rememberSpot("d2", "s1", null);
    vi.setSystemTime(5001);
    rememberSpot("dNew", "s1", null);
    expect(spotFor("d0", "s1")).toBeUndefined();
    expect(spotFor("d1", "s1")).toBeUndefined();
    expect(spotFor("d2", "s1")).toBeNull();
    expect(spotFor("d3", "s1")).toBeUndefined();
    expect(spotFor("dNew", "s1")).toBeNull();
  });
});
