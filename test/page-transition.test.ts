import { describe, expect, it } from "vitest";
import { MARK_GIVE_UP_MS, TransitionMark, type PageTransition } from "@/lib/pageTransition";

/** A fake page: the mark on <html>, timers run by hand, and the router's reports. */
function page() {
  let now = 0;
  let timers: { id: number; at: number; run: () => void }[] = [];
  let ids = 0;
  const p = {
    /** What is on <html> now. */
    vt: null as PageTransition | null,
    writes: [] as (PageTransition | null)[],
    mark: undefined as unknown as TransitionMark,
    /** Lets time pass. */
    wait(ms: number) {
      now += ms;
      const due = timers.filter((t) => t.at <= now);
      timers = timers.filter((t) => t.at > now);
      due.forEach((t) => t.run());
    },
    /** The router rendered: a transition runs or not, at this location. */
    at(location: string, transitioning = false) {
      p.mark.report({ transitioning, location });
    },
  };
  p.mark = new TransitionMark({
    write(kind) {
      p.vt = kind;
      p.writes.push(kind);
    },
    setTimeout(run, ms) {
      timers.push({ id: ++ids, at: now + ms, run });
      return ids;
    },
    clearTimeout(id) {
      timers = timers.filter((t) => t.id !== id);
    },
  });
  p.at("library");
  return p;
}

describe("a marked navigation with a transition", () => {
  it("is marked from before the navigation until its transition ends", () => {
    const p = page();
    p.mark.mark("push");
    expect(p.vt).toBe("push");
    p.at("library", true); // the transition is asked for
    expect(p.vt).toBe("push");
    p.at("book", true); // the new page renders inside it
    expect(p.vt).toBe("push");
    p.at("book"); // it ends
    expect(p.vt).toBeNull();
    expect(p.mark.active).toBe(false);
  });

  it("a pop is marked the same way", () => {
    const p = page();
    p.at("book");
    p.mark.mark("pop");
    p.at("book", true);
    p.at("library", true);
    expect(p.vt).toBe("pop");
    p.at("library");
    expect(p.vt).toBeNull();
  });

  it("is not taken off by the timer while a long transition runs", () => {
    const p = page();
    p.mark.mark("push");
    p.at("library", true);
    p.wait(MARK_GIVE_UP_MS * 3);
    expect(p.vt).toBe("push");
    p.at("book", true);
    p.at("book");
    expect(p.vt).toBeNull();
  });

  it("leaves nothing for the tab switch that follows", () => {
    const p = page();
    p.mark.mark("push");
    p.at("library", true);
    p.at("book", true);
    p.at("book");
    // A tab switch: a transition nobody marked.
    p.at("book", true);
    expect(p.vt).toBeNull();
    p.at("highlights", true);
    p.at("highlights");
    expect(p.writes).toEqual(["push", null]);
  });
});

describe("a marked navigation with no transition", () => {
  it("is cleared when the location changes (no View Transitions API, or a Back with none)", () => {
    const p = page();
    p.at("book");
    p.mark.mark("pop");
    p.at("library");
    expect(p.vt).toBeNull();
  });

  it("is cleared after a second when nothing happens at all", () => {
    const p = page();
    p.mark.mark("push");
    p.wait(MARK_GIVE_UP_MS - 1);
    expect(p.vt).toBe("push");
    p.wait(1);
    expect(p.vt).toBeNull();
    // A tab switch later is not a push.
    p.at("library", true);
    p.at("highlights", true);
    expect(p.vt).toBeNull();
  });

  it("clear() takes it off at once (the shell unmounts)", () => {
    const p = page();
    p.mark.mark("push");
    p.mark.clear();
    expect(p.vt).toBeNull();
    p.wait(MARK_GIVE_UP_MS);
    expect(p.writes).toEqual(["push", null]);
  });
});

describe("interrupted", () => {
  it("a mark set during a tab's crossfade waits for its own transition", () => {
    const p = page();
    p.at("library", true); // a tab switch runs
    p.at("highlights", true);
    p.mark.mark("push"); // a highlight is tapped before it ends
    p.at("highlights"); // the crossfade ends (the router skipped it)
    expect(p.vt).toBe("push");
    p.at("highlights", true); // the push starts
    p.at("book", true);
    p.at("book");
    expect(p.vt).toBeNull();
  });

  it("a mark set during a transition is cleared at its end when the navigation ran without one", () => {
    const p = page();
    p.at("book");
    p.at("book", true); // a tab switch runs
    p.mark.mark("pop");
    p.at("library", true); // Back landed with no transition of its own
    p.at("library"); // the tab's transition ends
    expect(p.vt).toBeNull();
  });

  it("a second mark replaces the first, and the first transition's end leaves it", () => {
    const p = page();
    p.mark.mark("push");
    p.at("library", true);
    p.at("book", true);
    p.mark.mark("pop"); // Back, before the push has ended
    expect(p.vt).toBe("pop");
    p.at("book"); // the push ends (skipped)
    expect(p.vt).toBe("pop");
    p.at("book", true); // the pop starts
    p.at("library", true);
    p.at("library");
    expect(p.vt).toBeNull();
  });

  it("a mark whose transition never comes is cleared by the timer, even set during another", () => {
    const p = page();
    p.at("library", true);
    p.mark.mark("push");
    p.at("library");
    expect(p.vt).toBe("push");
    p.wait(MARK_GIVE_UP_MS);
    expect(p.vt).toBeNull();
  });
});
