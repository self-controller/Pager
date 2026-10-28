import { describe, expect, it } from "vitest";
import { isDuplicateTitle, normalizeTitle } from "@/components/reader/ReaderBody";

describe("duplicate title detection", () => {
  it("normalises punctuation, case and spacing", () => {
    expect(normalizeTitle("  Chapter I. ")).toBe("chapter i");
    expect(normalizeTitle("The Great Gatsby\nby\nF. Scott")).toBe("the great gatsby by f scott");
  });

  it("hides headings that repeat the header title", () => {
    expect(isDuplicateTitle("Chapter I.", "Chapter I")).toBe(true);
    expect(isDuplicateTitle("Welcome to Pager", "Welcome to Pager")).toBe(true);
    expect(isDuplicateTitle("The Great Gatsby by F. Scott Fitzgerald", "The Great Gatsby")).toBe(true);
  });

  it("keeps headings that say something else", () => {
    expect(isDuplicateTitle("I hope Mr. Bingley will like it. CHAPTER II.", "Chapter II")).toBe(false);
    expect(isDuplicateTitle("Chapter II", "Chapter I")).toBe(false);
    expect(isDuplicateTitle("", "Anything")).toBe(false);
  });
});
