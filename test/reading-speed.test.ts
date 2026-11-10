import { afterEach, describe, expect, it } from "vitest";
import {
  availableFormats,
  FOOTER_FORMATS,
  nextFormat,
  progressLabel,
  shownFormat,
  type ProgressFacts,
} from "@/components/reader/PageFooter";
import {
  addSample,
  bookWordsLeft,
  chapterWordsLeft,
  countWords,
  createDwellTracker,
  ESTIMATE_WPM,
  getReadingSpeed,
  MAX_SAMPLES,
  pageSample,
  parseSamples,
  recordPageRead,
  resetReadingSpeed,
  speedFrom,
} from "@/components/reader/readingSpeed";
import { formatDuration } from "@/lib/format";

describe("reading time", () => {
  it("formats minutes short and spoken", () => {
    expect(formatDuration(0)).toBe("< 1 min");
    expect(formatDuration(0.6)).toBe("< 1 min");
    expect(formatDuration(Number.NaN)).toBe("< 1 min");
    expect(formatDuration(1)).toBe("1 min");
    expect(formatDuration(6.4)).toBe("6 min");
    expect(formatDuration(59.6)).toBe("1 h");
    expect(formatDuration(65)).toBe("1 h 5 min");
    expect(formatDuration(192)).toBe("3 h 12 min");
    expect(formatDuration(0.2, true)).toBe("less than a minute");
    expect(formatDuration(1, true)).toBe("1 minute");
    expect(formatDuration(65, true)).toBe("1 hour 5 minutes");
    expect(formatDuration(120, true)).toBe("2 hours");
  });
});

describe("reading speed samples", () => {
  it("keeps pages that look like reading", () => {
    expect(pageSample(250, 60_000)).toBe(250);
    expect(pageSample(300, 45_000)).toBe(400);
  });

  it("drops glances, idle gaps, skims and empty pages", () => {
    expect(pageSample(30, 3_000)).toBeNull(); // under 4 s
    expect(pageSample(250, 4 * 60_000)).toBeNull(); // idle
    expect(pageSample(300, 10_000)).toBeNull(); // 1800 wpm: a skim
    expect(pageSample(10, 60_000)).toBeNull(); // 10 wpm
    expect(pageSample(0, 60_000)).toBeNull();
    expect(pageSample(250, Number.NaN)).toBeNull();
  });

  it("keeps the newest samples and reads the median once there are enough", () => {
    let s: number[] = [];
    for (let i = 0; i < 4; i++) s = addSample(s, 200 + i);
    expect(speedFrom(s)).toBeNull();
    s = addSample(s, 900); // one outlier barely moves a median
    expect(speedFrom(s)).toBe(202);
    s = addSample(s, 210);
    expect(speedFrom(s)).toBe((202 + 203) / 2);
    for (let i = 0; i < 40; i++) s = addSample(s, 300);
    expect(s).toHaveLength(MAX_SAMPLES);
    expect(speedFrom(s)).toBe(300);
  });

  it("reads stored samples defensively", () => {
    expect(parseSamples(null)).toEqual([]);
    expect(parseSamples("not json")).toEqual([]);
    expect(parseSamples("null")).toEqual([]);
    expect(parseSamples('{"samples":"x"}')).toEqual([]);
    expect(parseSamples('{"samples":[250,"300",null,5000,10,280]}')).toEqual([250, 280]);
  });

  afterEach(() => resetReadingSpeed());

  it("learns from recorded pages and persists them", () => {
    resetReadingSpeed();
    expect(getReadingSpeed()).toBeNull();
    for (let i = 0; i < 4; i++) expect(recordPageRead(250, 60_000)).toBe(250);
    expect(recordPageRead(250, 1_000)).toBeNull();
    expect(getReadingSpeed()).toBeNull();
    recordPageRead(250, 60_000);
    expect(getReadingSpeed()).toBe(250);
    expect(parseSamples(localStorage.getItem("pager.readingSpeed"))).toEqual([250, 250, 250, 250, 250]);
    resetReadingSpeed();
    expect(localStorage.getItem("pager.readingSpeed")).toBeNull();
  });
});

describe("page dwell", () => {
  function tracker() {
    let t = 0;
    const d = createDwellTracker(() => t);
    return { d, at: (ms: number) => (t = ms) };
  }

  it("times only forward single-page turns within one layout", () => {
    const { d, at } = tracker();
    expect(d.show("a", 0)).toBeNull();
    at(30_000);
    expect(d.show("a", 1)).toBe(30_000);
    at(40_000);
    expect(d.show("a", 3)).toBeNull(); // a jump
    at(50_000);
    expect(d.show("a", 2)).toBeNull(); // backwards
    at(60_000);
    expect(d.show("a", 3)).toBe(10_000);
    at(70_000);
    expect(d.show("b", 4)).toBeNull(); // another section or layout
  });

  it("leaves out time the tab was hidden", () => {
    const { d, at } = tracker();
    d.show("a", 0);
    at(10_000);
    d.hide();
    at(600_000);
    d.reveal();
    at(620_000);
    expect(d.show("a", 1)).toBe(30_000);
    // Hidden across a turn: the new page starts counting hidden time from the turn.
    at(630_000);
    d.hide();
    at(640_000);
    d.show("a", 2);
    at(700_000);
    d.reveal();
    at(720_000);
    expect(d.show("a", 3)).toBe(20_000);
  });
});

describe("time left", () => {
  it("counts the current page and the ones after it", () => {
    expect(countWords("  One two\nthree  ")).toBe(3);
    expect(countWords("")).toBe(0);
    expect(chapterWordsLeft(1000, 0, 10)).toBe(1000);
    expect(chapterWordsLeft(1000, 9, 10)).toBe(100);
    expect(chapterWordsLeft(1000, 4, 10)).toBe(600);
    expect(chapterWordsLeft(0, 4, 10)).toBe(0);
  });

  it("estimates the rest of the book from its length, never below the chapter", () => {
    expect(bookWordsLeft(0.25, 100, 10_000, undefined)).toBe(7500);
    expect(bookWordsLeft(0.25, 100, undefined, 10)).toBe(10 * ESTIMATE_WPM * 0.75);
    expect(bookWordsLeft(1, 120, 10_000, 40)).toBe(120);
    expect(bookWordsLeft(0.5, 0, undefined, undefined)).toBeNull();
    expect(bookWordsLeft(0.5, 0, 0, 0)).toBeNull();
  });
});

describe("footer formats", () => {
  const facts: ProgressFacts = {
    page: 3,
    pageCount: 17,
    theEnd: false,
    words: 4250,
    percent: 0.42,
    isBook: true,
    wordCount: 60_000,
    wpm: 250,
  };

  it("cycles through every format for a book", () => {
    const all = availableFormats(facts);
    expect(all).toEqual(FOOTER_FORMATS);
    const seen = [];
    let f = shownFormat("page", all);
    for (let i = 0; i < 5; i++) {
      seen.push(f);
      f = nextFormat(f, all);
    }
    expect(seen).toEqual(["page", "chapter-time", "book-time", "percent", "off"]);
    expect(f).toBe("page");
  });

  it("skips time left in book for an article or a book without a length", () => {
    const article = availableFormats({ isBook: false, wordCount: 3000 });
    expect(article).not.toContain("book-time");
    expect(nextFormat("chapter-time", article)).toBe("percent");
    expect(shownFormat("book-time", article)).toBe("percent");
    expect(availableFormats({ isBook: true })).not.toContain("book-time");
    expect(availableFormats({ isBook: true, estimatedMinutes: 30 })).toContain("book-time");
    expect(shownFormat("bogus" as never, article)).toBe("page");
  });

  it("labels each format", () => {
    expect(progressLabel("page", facts)).toEqual({ text: "p. 4 of 17", spoken: "Page 4 of 17" });
    expect(progressLabel("page", { ...facts, theEnd: true }).text).toBe("The end");
    // 4250 words over 17 pages, 14 pages left: 3500 words at 250 wpm.
    expect(progressLabel("chapter-time", facts)).toEqual({
      text: "14 min left in chapter",
      spoken: "14 minutes left in chapter",
    });
    expect(progressLabel("chapter-time", { ...facts, isBook: false }).text).toBe("14 min left");
    // 60,000 × 0.58 = 34,800 words: 139 min.
    expect(progressLabel("book-time", facts).text).toBe("2 h 19 min left in book");
    expect(progressLabel("percent", facts)).toEqual({ text: "42%", spoken: "42% read" });
    expect(progressLabel("off", facts).text).toBe("");
  });

  it("counts chapters, not pages, in the scroll layout", () => {
    const scroll = { ...facts, scroll: true, chapterIndex: 2, chapterCount: 12 };
    expect(progressLabel("page", scroll)).toEqual({ text: "Chapter 3 of 12", spoken: "Chapter 3 of 12" });
    expect(progressLabel("page", { ...scroll, theEnd: true }).text).toBe("The end");
    expect(availableFormats(scroll)).toContain("page");
    // One section: no chapters to count, so the footer starts at the time left.
    const article = availableFormats({ isBook: false, wordCount: 3000, scroll: true });
    expect(article).not.toContain("page");
    expect(shownFormat("page", article)).toBe("chapter-time");
  });

  it("guesses at an average speed, marked, until yours is known", () => {
    // 3500 words at 238 wpm: 14.7 min.
    const chapter = progressLabel("chapter-time", { ...facts, wpm: null });
    expect(chapter.text).toMatch(/^~1[45] min left in chapter$/);
    expect(chapter.spoken).toMatch(/^About 1[45] minutes left in chapter$/);
    expect(progressLabel("book-time", { ...facts, wpm: null }).text).toMatch(/^~2 h \d+ min left in book$/);
    expect(progressLabel("page", { ...facts, wpm: null }).text).toBe("p. 4 of 17");
  });

  it("leaves the guess mark off less than a minute", () => {
    // The last page of a short chapter: 10 words left.
    const last = { ...facts, words: 170, page: facts.pageCount - 1, wpm: null };
    expect(progressLabel("chapter-time", last)).toEqual({
      text: "< 1 min left in chapter",
      spoken: "less than a minute left in chapter",
    });
    expect(progressLabel("book-time", { ...last, percent: 1 }).text).toBe("< 1 min left in book");
    // A learned speed never had the mark.
    expect(progressLabel("chapter-time", { ...last, wpm: 250 }).text).toBe("< 1 min left in chapter");
  });
});
