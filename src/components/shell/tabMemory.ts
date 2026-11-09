import type { NativeTab } from "@/lib/native";

/** A tab's place: the page it was last on (pathname, search, hash) and how far down it was scrolled. */
export interface TabPlace {
  location: string;
  scrollY: number;
}

/** What tab memory needs from the page: the router, the window's scroll, and the clock of frames. */
export interface TabMemoryDeps {
  /** Each tab with its top page, in the bar's order. */
  tabs: readonly { tab: NativeTab; root: string }[];
  navigate(to: string, options?: { state?: unknown }): void;
  scrollY(): number;
  scrollTo(top: number, smooth: boolean): void;
  /** Runs `run` once the page has painted (two animation frames). */
  afterPaint(run: () => void): void;
  reducedMotion(): boolean;
}

/** The location state a tab switch navigates with: a book reopened this way starts with its chrome showing. */
export interface TabSwitchState {
  tabSwitch: true;
}

/** Whether a location's state says it was opened by a tab switch. */
export function isTabSwitch(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as Partial<TabSwitchState>).tabSwitch === true;
}

/**
 * The iPhone app's tabs remember where they were left, as iOS tabs do:
 *  - a tab's top page (`/`, `/highlights`, …) makes that tab current; any other page (a book, a 404)
 *    belongs to the tab that is current, so a book opened from Highlights stays in Highlights;
 *  - tapping another tab saves this tab's scroll, opens that tab's last page (or its top page) and
 *    scrolls it back to where it was;
 *  - tapping the current tab opens its top page, at the top; tapping it again there scrolls to the top.
 * A book's place is the reader's own (its saved progress), so a book is remembered without its `#target`.
 * The memory lasts as long as the page: a cold start opens the library.
 */
export class TabMemory {
  private tab: NativeTab;
  private readonly places = new Map<NativeTab, TabPlace>();
  /** The scroll to restore once the page a tap opened has rendered. */
  private pending: number | null = null;

  constructor(private readonly deps: TabMemoryDeps) {
    this.tab = deps.tabs[0]!.tab;
  }

  /** The tab the page is in. */
  get current(): NativeTab {
    return this.tab;
  }

  /** The tab's last place, if it has been visited. */
  place(tab: NativeTab): TabPlace | undefined {
    return this.places.get(tab);
  }

  /** The location changed (a tap, a link, the back swipe): find its tab and record it as that tab's last. */
  locate({ pathname, search, hash }: { pathname: string; search: string; hash: string }): NativeTab {
    const root = this.deps.tabs.find((t) => t.root === pathname);
    if (root) this.tab = root.tab;
    const book = pathname.startsWith("/read/");
    this.places.set(this.tab, { location: pathname + search + (book ? "" : hash), scrollY: 0 });
    return this.tab;
  }

  /** A tab in the app's bar was tapped. */
  select(tab: NativeTab): void {
    const entry = this.deps.tabs.find((t) => t.tab === tab);
    if (!entry) return;
    if (tab !== this.tab) {
      const leaving = this.places.get(this.tab);
      if (leaving) leaving.scrollY = this.deps.scrollY();
      const place = this.places.get(tab);
      this.tab = tab;
      this.pending = place?.scrollY ?? 0;
      const state: TabSwitchState = { tabSwitch: true };
      this.deps.navigate(place?.location ?? entry.root, { state });
      return;
    }
    const here = this.places.get(tab)?.location ?? entry.root;
    if (here !== entry.root) {
      this.pending = 0;
      this.deps.navigate(entry.root);
      return;
    }
    this.deps.scrollTo(0, !this.deps.reducedMotion());
  }

  /**
   * The page a tap opened has rendered (call it from a layout effect on the location): restore its
   * scroll before it paints, and once more after, in case the page grew. Scrolls as far as it can.
   */
  rendered(): void {
    const top = this.pending;
    if (top === null) return;
    this.pending = null;
    this.deps.scrollTo(top, false);
    if (top === 0) return;
    this.deps.afterPaint(() => {
      if (this.deps.scrollY() !== top) this.deps.scrollTo(top, false);
    });
  }
}
