import { useContext, useEffect, type MouseEvent } from "react";
import { UNSAFE_ViewTransitionContext as ViewTransitionContext, useLocation } from "react-router";

/** A change of place: `push` opens a book from a list, `pop` goes back out of it. */
export type PageTransition = "push" | "pop";

/** How long a mark waits for its transition to start before it is taken off. */
export const MARK_GIVE_UP_MS = 1000;

export interface TransitionMarkDeps {
  /** Puts the mark on the page (`data-vt` on <html>), or takes it off. */
  write(kind: PageTransition | null): void;
  setTimeout(run: () => void, ms: number): number;
  clearTimeout(id: number | undefined): void;
}

/**
 * The mark that tells a page slide from a tab's crossfade. Both are react-router view transitions
 * of the root, and the router has no way to name one, so the kind is written on <html> just before
 * the navigation (globals.css, "Opening a book") and taken off when that navigation's transition
 * ends. A mark left behind would make the next tab switch slide, so it also comes off when:
 *  - the location changes with no transition (no View Transitions API, or a Back the router has no
 *    transition for);
 *  - the transition that was running when it was set ends and the location has changed since;
 *  - nothing starts within a second (the navigation never happened).
 * `report` is told what the router shows after every render: whether a transition runs, and where.
 */
export class TransitionMark {
  /** The mark on the page: a new number for every `mark`, so an older transition's end can't clear it. */
  private marked: number | null = null;
  /** The mark the running transition started with. */
  private running: number | null = null;
  private count = 0;
  private moved = false;
  private transitioning = false;
  private location: string | null = null;
  private timer: number | undefined;

  constructor(private readonly deps: TransitionMarkDeps) {}

  /** Whether a mark is on the page. */
  get active(): boolean {
    return this.marked !== null;
  }

  /** Call just before the navigation. */
  mark(kind: PageTransition): void {
    this.deps.clearTimeout(this.timer);
    this.marked = ++this.count;
    this.moved = false;
    this.deps.write(kind);
    this.timer = this.deps.setTimeout(() => this.clear(), MARK_GIVE_UP_MS);
  }

  report({ transitioning, location }: { transitioning: boolean; location: string }): void {
    const started = transitioning && !this.transitioning;
    const ended = !transitioning && this.transitioning;
    if (this.location !== null && location !== this.location) this.moved = true;
    this.transitioning = transitioning;
    this.location = location;
    if (this.marked === null) {
      this.running = null;
      return;
    }
    if (started) {
      this.running = this.marked;
      // Its end clears the mark now.
      this.deps.clearTimeout(this.timer);
    } else if (ended) {
      // A mark set during another transition waits for its own, unless the page already moved on.
      if (this.running === this.marked || this.moved) this.clear();
      this.running = null;
    } else if (!transitioning && this.moved) {
      this.clear();
    }
  }

  clear(): void {
    this.deps.clearTimeout(this.timer);
    if (this.marked === null) return;
    this.marked = null;
    this.running = null;
    this.deps.write(null);
  }
}

const mark = new TransitionMark({
  write(kind) {
    if (kind) document.documentElement.dataset.vt = kind;
    else delete document.documentElement.dataset.vt;
  },
  setTimeout: (run, ms) => window.setTimeout(run, ms),
  clearTimeout: (id) => window.clearTimeout(id),
});

/** Names the navigation about to be made. Ask the router for a view transition as well. */
export function markTransition(kind: PageTransition): void {
  mark.mark(kind);
}

/**
 * Props for a `Link` that opens a book from a list: `<Link to={href} {...pushLink}>`. Only a plain
 * click is marked: a modified one opens a new tab, and the page stays where it is.
 */
export const pushLink = {
  viewTransition: true,
  onClick(e: MouseEvent) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    markTransition("push");
  },
};

/** Keeps the mark in step with the router. Mounted once, in the app's shell. */
export function usePageTransitionMark(): void {
  const { isTransitioning } = useContext(ViewTransitionContext);
  const { key } = useLocation();
  useEffect(() => {
    mark.report({ transitioning: isTransitioning, location: key });
  }, [isTransitioning, key]);
  useEffect(() => () => mark.clear(), []);
}
