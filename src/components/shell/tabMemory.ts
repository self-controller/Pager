import type { NativeTab } from "@/lib/native";

/** A tab's place: the page it was last on (pathname, search, hash) and how far down it was scrolled. */
export interface TabPlace {
  location: string;
  scrollY: number;
}

/** A tab in the bar: its top page, and for the Book tab (`match`) every page under that prefix. */
export interface TabEntry {
  tab: NativeTab;
  root: string;
  match?: string;
}

/** What tab memory needs from the page: the router, the window's scroll, and the clock of frames. */
export interface TabMemoryDeps {
  /** Each tab, in the bar's order. */
  tabs: readonly TabEntry[];
  /** Where a tap on the Book tab goes: the book read last, or the library before any (useBookTab). */
  link(tab: NativeTab): string;
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

function owns(entry: TabEntry, pathname: string): boolean {
  return entry.match ? pathname === entry.match || pathname.startsWith(`${entry.match}/`) : pathname === entry.root;
}

/**
 * The iPhone app's tabs remember where they were left, as iOS tabs do:
 *  - a tab's top page (`/`, `/highlights`, …) makes that tab current, and any open book makes the
 *    Book tab current; any other page (a 404) belongs to the tab that is current. So a book opened
 *    from Highlights selects Book, and Highlights keeps its list and its scroll;
 *  - tapping another tab saves this tab's scroll, opens that tab's last page (or its top page) and
 *    scrolls it back to where it was. The Book tab always opens the book read last, with no section,
 *    so the reader resumes at its saved place, which may have moved on another device;
 *  - tapping the current tab opens its top page, at the top; tapping it again there scrolls to the
 *    top. On the Book tab it does nothing: the book is already open.
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
    const owner = this.deps.tabs.find((t) => owns(t, pathname));
    if (owner) this.tab = owner.tab;
    this.places.set(this.tab, { location: pathname + search + hash, scrollY: 0 });
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
      const state: TabSwitchState = { tabSwitch: true };
      if (entry.match) {
        this.pending = 0;
        this.deps.navigate(this.deps.link(tab), { state });
        return;
      }
      this.pending = place?.scrollY ?? 0;
      this.deps.navigate(place?.location ?? entry.root, { state });
      return;
    }
    if (entry.match) return;
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
