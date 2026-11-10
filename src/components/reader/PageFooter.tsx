import { useId } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { formatDuration, formatPercent } from "@/lib/format";
import { haptic, prepareHaptic } from "@/lib/native";
import { updateSettings, useSettings, type FooterFormat } from "@/state/settings";
import { bookWordsLeft, chapterWordsLeft, ESTIMATE_WPM, useReadingSpeed } from "./readingSpeed";

/** The order a tap on the footer moves through. */
export const FOOTER_FORMATS: readonly FooterFormat[] = ["page", "chapter-time", "book-time", "percent", "off"];

/** What the reader can be told about where they are. */
export interface ProgressFacts {
  page: number;
  pageCount: number;
  /** The last page of the last section. */
  theEnd: boolean;
  /** Words in the open section (0 until counted). */
  words: number;
  /** 0–1 through the whole document. */
  percent: number;
  /** More than one section. */
  isBook: boolean;
  wordCount?: number;
  estimatedMinutes?: number;
  /** Learned words per minute; null while still learning. */
  wpm: number | null;
  /** The scroll layout numbers chapters, not pages ("Chapter 3 of 12"). */
  scroll?: boolean;
  /** 0-based position of the open section, and how many there are. */
  chapterIndex?: number;
  chapterCount?: number;
}

/**
 * The formats a document can show: time left in the book needs chapters and a known length; in the
 * scroll layout the "page" format counts chapters, so it needs more than one.
 */
export function availableFormats(
  facts: Pick<ProgressFacts, "isBook" | "wordCount" | "estimatedMinutes" | "scroll">,
): FooterFormat[] {
  const book = facts.isBook && Boolean(facts.wordCount || facts.estimatedMinutes);
  return FOOTER_FORMATS.filter((f) => (f !== "book-time" || book) && (f !== "page" || !facts.scroll || facts.isBook));
}

/** The format to show for a saved choice: itself, or the next one this document can show. */
export function shownFormat(saved: FooterFormat, available: readonly FooterFormat[]): FooterFormat {
  const start = Math.max(0, FOOTER_FORMATS.indexOf(saved));
  for (let i = 0; i < FOOTER_FORMATS.length; i++) {
    const f = FOOTER_FORMATS[(start + i) % FOOTER_FORMATS.length]!;
    if (available.includes(f)) return f;
  }
  return "page";
}

/** The format after this one, skipping those this document can't show. */
export function nextFormat(current: FooterFormat, available: readonly FooterFormat[]): FooterFormat {
  const i = FOOTER_FORMATS.indexOf(current);
  return shownFormat(FOOTER_FORMATS[(i + 1) % FOOTER_FORMATS.length]!, available);
}

/** The footer's text for a format, and the same said in full for a screen reader. */
export function progressLabel(format: FooterFormat, facts: ProgressFacts): { text: string; spoken: string } {
  const { page, pageCount, wpm } = facts;
  switch (format) {
    case "page":
      if (facts.theEnd) return { text: "The end", spoken: "The end" };
      if (facts.scroll) {
        const n = `${(facts.chapterIndex ?? 0) + 1} of ${facts.chapterCount ?? 1}`;
        return { text: `Chapter ${n}`, spoken: `Chapter ${n}` };
      }
      return { text: `p. ${page + 1} of ${pageCount}`, spoken: `Page ${page + 1} of ${pageCount}` };
    case "chapter-time":
    case "book-time": {
      const chapter = chapterWordsLeft(facts.words, page, pageCount);
      const words =
        format === "book-time" ? bookWordsLeft(facts.percent, chapter, facts.wordCount, facts.estimatedMinutes) : chapter;
      const where = format === "book-time" ? " in book" : facts.isBook ? " in chapter" : "";
      // Until your own speed is learned, an average reader's, marked as a guess.
      const minutes = (words ?? 0) / (wpm ?? ESTIMATE_WPM);
      // "< 1 min" is already a rough answer: no "~" in front of it.
      const [about, aboutSpoken] = wpm === null && minutes >= 1 ? ["~", "About "] : ["", ""];
      return {
        text: `${about}${formatDuration(minutes)} left${where}`,
        spoken: `${aboutSpoken}${formatDuration(minutes, true)} left${where}`,
      };
    }
    case "percent": {
      const pct = formatPercent(facts.percent);
      return { text: pct, spoken: `${pct} read` };
    }
    case "off":
      return { text: "", spoken: "" };
  }
}

/** The button's name: what it shows, and that a tap changes it. */
function controlName(format: FooterFormat, isBook: boolean, scroll: boolean): string {
  if (format === "off") return "Show reading progress";
  const what = {
    page: scroll ? "Chapter number" : "Page number",
    "chapter-time": isBook ? "Time left in chapter" : "Time left",
    "book-time": "Time left in book",
    percent: "Percent read",
  }[format];
  return `${what}. Tap to change`;
}

/** What the progress readout needs to know: shared by the Pages footer and the Scroll line. */
interface ProgressProps {
  page: number;
  pageCount: number;
  /** Whether a next chapter exists beyond this section's pages. */
  hasNext: boolean;
  atEnd: boolean;
  /** Words in the open section, for the time estimates. */
  words: number;
  percent: number;
  isBook: boolean;
  wordCount?: number;
  estimatedMinutes?: number;
  chapterIndex?: number;
  chapterCount?: number;
}

/**
 * The readout's state: the format shown, its text, its name for a screen reader, and the tap that
 * moves to the next format (a haptic, then the setting).
 */
function useProgressReadout(p: ProgressProps & { scroll: boolean }) {
  const { footerFormat } = useSettings();
  const wpm = useReadingSpeed();
  const valueId = useId();
  const last = p.page >= p.pageCount - 1 && !p.hasNext;
  const facts: ProgressFacts = {
    page: p.page,
    pageCount: p.pageCount,
    theEnd: p.atEnd && last,
    words: p.words,
    percent: p.percent,
    isBook: p.isBook,
    wordCount: p.wordCount,
    estimatedMinutes: p.estimatedMinutes,
    wpm,
    scroll: p.scroll,
    chapterIndex: p.chapterIndex,
    chapterCount: p.chapterCount,
  };
  const available = availableFormats(facts);
  const format = shownFormat(footerFormat, available);
  const { text, spoken } = progressLabel(format, facts);
  return {
    format,
    text,
    spoken,
    valueId,
    name: controlName(format, p.isBook, p.scroll),
    prepare: () => prepareHaptic("selection"),
    cycle: () => {
      haptic("selection");
      updateSettings({ footerFormat: nextFormat(format, available) });
    },
  };
}

interface Props extends ProgressProps {
  chapter?: string;
  /** Whether a previous chapter exists before this section's pages. */
  hasPrev: boolean;
  onTurn: (direction: 1 | -1) => void;
}

/**
 * Page controls under the page (the Pages layout), and one wide button between them that cycles what
 * it shows: the page, time left in the chapter, time left in the book, percent read, or nothing. The
 * choice is a setting; a tap switches at once.
 */
export function PageFooter({ chapter, hasPrev, onTurn, ...progress }: Props) {
  const r = useProgressReadout({ ...progress, scroll: false });
  const first = progress.page === 0 && !hasPrev;
  const last = progress.page >= progress.pageCount - 1 && !progress.hasNext;

  return (
    <footer className="flex h-[var(--size-page-footer)] shrink-0 items-center gap-2 px-2 md:px-4" aria-label="Pages">
      <IconButton
        icon={ChevronLeft}
        label="Previous page"
        size="sm"
        variant="quaternary"
        disabled={first}
        onClick={() => onTurn(-1)}
      />
      <button
        type="button"
        aria-label={r.name}
        aria-describedby={r.valueId}
        onPointerDown={r.prepare}
        onClick={r.cycle}
        className="flex h-full min-w-0 flex-1 items-center justify-center gap-3 rounded-sm font-byline text-[13px] leading-4 text-fg-2 transition-hover select-none hover:text-fg"
      >
        {chapter && <span className="hidden min-w-0 truncate md:block">{chapter}</span>}
        {chapter && r.text && <span className="hidden text-fg-3 md:block">·</span>}
        <span className="shrink-0 tabular-nums">{r.text}</span>
      </button>
      <span id={r.valueId} className="sr-only" aria-live="polite">
        {r.spoken}
      </span>
      <IconButton
        icon={ChevronRight}
        label="Next page"
        size="sm"
        variant="quaternary"
        disabled={last}
        onClick={() => onTurn(1)}
      />
    </footer>
  );
}

/**
 * The Scroll layout's progress readout: a slim line in the page colour across the top of the
 * chapter, under the top bar, which rides up under the status bar when the chrome hides (prose.css
 * `.progress-line`). It is always there: text scrolling up passes under it. A tap cycles it as the
 * footer does: "Chapter 3 of 12", time left in the chapter, in the book, percent, nothing. Set to
 * nothing it stays, empty but tappable, so the text never moves.
 */
export function ProgressLine(props: ProgressProps) {
  const r = useProgressReadout({ ...props, scroll: true });
  return (
    <div className="progress-line" role="group" aria-label="Reading progress">
      <button
        type="button"
        aria-label={r.name}
        aria-describedby={r.valueId}
        onPointerDown={r.prepare}
        onClick={r.cycle}
        className="flex h-full w-full items-center justify-center px-4 font-byline text-[13px] leading-4 text-fg-2 transition-hover select-none hover:text-fg"
      >
        <span className="min-w-0 truncate tabular-nums">{r.text}</span>
      </button>
      <span id={r.valueId} className="sr-only" aria-live="polite">
        {r.spoken}
      </span>
    </div>
  );
}
