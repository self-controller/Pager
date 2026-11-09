import { beforeEach, describe, expect, it, vi } from "vitest";
import { NATIVE_TABS, NAV } from "@/components/shell/nav";
import { isTabSwitch, TabMemory } from "@/components/shell/tabMemory";

/** A fake page: a location, a window scroll that a page can reach up to `max`, and frames run by hand. */
function page() {
  let scroll = 0;
  let frames: (() => void)[] = [];
  const p = {
    max: 10_000,
    navigate: vi.fn<(to: string, options?: { state?: unknown }) => void>(),
    scrollTo: vi.fn((top: number, _smooth: boolean) => {
      scroll = Math.min(top, p.max);
    }),
    reduced: false,
    /** The Book tab's link: the book read last, or the library before any. */
    book: "/read/doc",
    get scroll() {
      return scroll;
    },
    set scroll(v: number) {
      scroll = v;
    },
    paint() {
      const run = frames;
      frames = [];
      run.forEach((f) => f());
    },
    memory: undefined as unknown as TabMemory,
  };
  p.memory = new TabMemory({
    tabs: NATIVE_TABS,
    link: () => p.book,
    navigate: p.navigate,
    scrollY: () => scroll,
    scrollTo: p.scrollTo,
    afterPaint: (run) => frames.push(run),
    reducedMotion: () => p.reduced,
  });
  return p;
}

/** A location as the router gives it. */
function at(url: string) {
  const u = new URL(url, "pager-app://localhost");
  return { pathname: u.pathname, search: u.search, hash: u.hash };
}

let p: ReturnType<typeof page>;

beforeEach(() => {
  p = page();
});

/** Follow the last navigation the memory asked for, as the router and the layout effect would. */
function follow() {
  const call = p.navigate.mock.calls.at(-1)!;
  const tab = p.memory.locate(at(call[0]));
  p.memory.rendered();
  return { tab, to: call[0], state: call[1]?.state };
}

describe("the tabs", () => {
  it("are NAV's mobile entries with a tab, in the bar's order (PagerTab in TabsController.swift)", () => {
    const order = ["library", "book", "highlights", "assistant", "settings"];
    expect(NATIVE_TABS.map((t) => t.tab)).toEqual(order);
    expect(NATIVE_TABS.map((t) => t.root)).toEqual(["/", "/read", "/highlights", "/assistant", "/settings"]);
    expect(NATIVE_TABS.filter((t) => t.match).map((t) => t.tab)).toEqual(["book"]);
    // Only mobile entries are app tabs; a browser-only entry (no `tab`) isn't one.
    expect(NAV.filter((n) => n.tab && !n.mobile)).toEqual([]);
    expect(NAV.filter((n) => n.mobile && n.tab).map((n) => n.tab)).toEqual(order);
  });
});

describe("tab memory", () => {
  it("starts in the library", () => {
    expect(p.memory.current).toBe("library");
  });

  it("puts a tab's top page in that tab, a book in Book, and any other page in the current tab", () => {
    expect(p.memory.locate(at("/highlights?tag=x"))).toBe("highlights");
    expect(p.memory.locate(at("/nowhere"))).toBe("highlights");
    expect(p.memory.locate(at("/read/doc/s2#note-4"))).toBe("book");
    expect(p.memory.locate(at("/readme"))).toBe("book"); // a 404 in the book's tab, not a book
    expect(p.memory.locate(at("/settings#phone"))).toBe("settings");
    expect(p.memory.locate(at("/?path=Essays"))).toBe("library");
    expect(p.memory.place("highlights")?.location).toBe("/nowhere");
    expect(p.memory.place("book")?.location).toBe("/readme");
    expect(p.memory.place("settings")?.location).toBe("/settings#phone");
    expect(p.memory.place("library")?.location).toBe("/?path=Essays");
  });

  it("switches to another tab's last page and scroll, and back", () => {
    p.memory.locate(at("/?path=Essays"));
    p.scroll = 1200;
    p.memory.select("highlights");
    // Never visited: its top page, at the top.
    expect(follow()).toEqual({ tab: "highlights", to: "/highlights", state: { tabSwitch: true } });
    expect(p.scroll).toBe(0);

    p.scroll = 640;
    p.memory.select("library");
    expect(follow()).toEqual({ tab: "library", to: "/?path=Essays", state: { tabSwitch: true } });
    expect(p.scroll).toBe(1200);

    p.memory.select("highlights");
    expect(follow().to).toBe("/highlights");
    expect(p.scroll).toBe(640);
  });

  it("restores the scroll before paint, and again after if the page was still short", () => {
    p.memory.locate(at("/"));
    p.scroll = 900;
    p.memory.select("settings");
    follow();
    p.memory.select("library");
    p.max = 300; // the list hasn't all rendered yet
    follow();
    expect(p.scroll).toBe(300);
    p.max = 5000;
    p.paint();
    expect(p.scroll).toBe(900);
  });

  it("selects Book for a book opened from Highlights, and Highlights keeps its list and scroll", () => {
    p.memory.locate(at("/"));
    p.memory.select("highlights");
    follow();
    p.scroll = 700;
    // A link on the Highlights page; the reader is a fixed page.
    p.memory.locate(at("/read/doc/s1"));
    expect(p.memory.current).toBe("book");

    p.scroll = 0;
    p.memory.select("highlights");
    expect(follow()).toEqual({ tab: "highlights", to: "/highlights", state: { tabSwitch: true } });
    expect(p.scroll).toBe(0); // the scroll is saved when a tap leaves a tab, not by a link
  });

  it("opens the book read last on a tap of Book, with no section, at the top", () => {
    p.memory.locate(at("/"));
    p.scroll = 300;
    p.book = "/read/other";
    p.memory.select("book");
    expect(follow()).toEqual({ tab: "book", to: "/read/other", state: { tabSwitch: true } });
    expect(p.scroll).toBe(0);
    p.memory.select("library");
    expect(follow().to).toBe("/");
    expect(p.scroll).toBe(300);
  });

  it("opens the library on a tap of Book before any book was read", () => {
    p.memory.locate(at("/settings"));
    p.book = "/";
    p.memory.select("book");
    expect(follow()).toEqual({ tab: "library", to: "/", state: { tabSwitch: true } });
  });

  it("does nothing on a tap of Book in the book", () => {
    p.memory.locate(at("/read/doc/s4"));
    p.memory.select("book");
    expect(p.navigate).not.toHaveBeenCalled();
    expect(p.scrollTo).not.toHaveBeenCalled();
  });

  it("goes to a tab's top page on a tap of the current tab, then scrolls to the top", () => {
    p.memory.locate(at("/"));
    p.memory.locate(at("/?path=Essays"));
    p.memory.locate(at("/nowhere"));
    p.scroll = 0;
    p.memory.select("library");
    expect(p.navigate).toHaveBeenLastCalledWith("/");
    expect(follow().tab).toBe("library");

    p.scroll = 2000;
    p.navigate.mockClear();
    p.memory.select("library");
    expect(p.navigate).not.toHaveBeenCalled();
    expect(p.scrollTo).toHaveBeenLastCalledWith(0, true);
    expect(p.scroll).toBe(0);
  });

  it("scrolls to the top at once under reduced motion", () => {
    p.memory.locate(at("/settings"));
    p.reduced = true;
    p.memory.select("settings");
    expect(p.scrollTo).toHaveBeenLastCalledWith(0, false);
  });

  it("treats a tab never visited as at its top page on a second tap", () => {
    p.memory.select("library");
    expect(p.navigate).not.toHaveBeenCalled();
    expect(p.scrollTo).toHaveBeenCalledWith(0, true);
  });

  it("restores nothing on a location it didn't ask for", () => {
    p.memory.locate(at("/"));
    p.scroll = 400;
    p.memory.locate(at("/?path=Essays"));
    p.memory.rendered();
    expect(p.scrollTo).not.toHaveBeenCalled();
  });
});

describe("isTabSwitch", () => {
  it("reads only a tab switch's state", () => {
    expect(isTabSwitch({ tabSwitch: true })).toBe(true);
    expect(isTabSwitch({ tabSwitch: "yes" })).toBe(false);
    expect(isTabSwitch({ page: 0 })).toBe(false);
    expect(isTabSwitch(null)).toBe(false);
    expect(isTabSwitch(undefined)).toBe(false);
  });
});
