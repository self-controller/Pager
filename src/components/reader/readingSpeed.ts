import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

/**
 * Learns how fast you read, in words per minute, from how long you stay on each page (as Kindle
 * does). Each turn to the next page of the same layout is one sample: an average
 * page's words over the time it was on screen while the tab was visible. Glances, skims and idle gaps
 * are dropped; the speed is the median of the newest samples, kept in localStorage.
 */

const KEY = "pager.readingSpeed";
/** Less than this on a page is a glance, not reading. */
export const MIN_DWELL_MS = 4_000;
/** More than this, the reader looked away. */
export const MAX_DWELL_MS = 3 * 60_000;
/** Outside this band the page was skimmed, or held almost no words. */
export const MIN_WPM = 60;
export const MAX_WPM = 1000;
export const MAX_SAMPLES = 30;
/** Samples needed before a time is shown. */
export const MIN_SAMPLES = 5;
/** The speed the backend's `estimatedMinutes` assumes: used to turn it back into words, and as the guess shown until yours is learned. */
export const ESTIMATE_WPM = 238;

export function countWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

/** Words per minute for one page read, or null when it was a glance, a skim or an idle gap. */
export function pageSample(words: number, dwellMs: number): number | null {
  if (!(words > 0) || !(dwellMs >= MIN_DWELL_MS) || dwellMs > MAX_DWELL_MS) return null;
  const wpm = words / (dwellMs / 60_000);
  return wpm >= MIN_WPM && wpm <= MAX_WPM ? wpm : null;
}

/** Adds a sample, keeping the newest. */
export function addSample(samples: readonly number[], wpm: number): number[] {
  return [...samples, Math.round(wpm)].slice(-MAX_SAMPLES);
}

/** The learned speed, the median sample; null while there are too few to trust. */
export function speedFrom(samples: readonly number[]): number | null {
  if (samples.length < MIN_SAMPLES) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Samples from storage; anything malformed or out of range is dropped. */
export function parseSamples(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const value = (JSON.parse(raw) as { samples?: unknown } | null)?.samples;
    if (!Array.isArray(value)) return [];
    return value.filter((n): n is number => typeof n === "number" && n >= MIN_WPM && n <= MAX_WPM).slice(-MAX_SAMPLES);
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();
let samples: number[] = load();
let speed = speedFrom(samples);

function load(): number[] {
  try {
    return parseSamples(typeof localStorage === "undefined" ? null : localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

/** The learned words per minute, or null while still learning. */
export function getReadingSpeed(): number | null {
  return speed;
}

/** Counts one page read if it looks like reading. Returns the sample, or null when it was dropped. */
export function recordPageRead(words: number, dwellMs: number): number | null {
  const wpm = pageSample(words, dwellMs);
  if (wpm === null) return null;
  samples = addSample(samples, wpm);
  speed = speedFrom(samples);
  try {
    localStorage.setItem(KEY, JSON.stringify({ samples }));
  } catch {
    // Private mode or full storage: the speed is learned for this session only.
  }
  listeners.forEach((l) => l());
  return wpm;
}

/** Forgets every sample (tests, and a future "reset reading speed"). */
export function resetReadingSpeed(): void {
  samples = [];
  speed = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored to remove.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReadingSpeed(): number | null {
  return useSyncExternalStore(subscribe, getReadingSpeed, getReadingSpeed);
}

/**
 * Times how long each page is on screen, leaving out time the tab spends hidden. `show` returns the
 * time spent on the page before only when the new page is the next one in the same layout.
 */
export function createDwellTracker(now: () => number = () => performance.now()) {
  let key = "";
  let page = -1;
  let since = 0;
  let away = 0;
  let hiddenAt: number | null = null;
  return {
    show(nextKey: string, nextPage: number): number | null {
      const t = now();
      const hidden = away + (hiddenAt === null ? 0 : t - hiddenAt);
      const dwell = nextKey === key && nextPage === page + 1 ? t - since - hidden : null;
      key = nextKey;
      page = nextPage;
      since = t;
      away = 0;
      if (hiddenAt !== null) hiddenAt = t;
      return dwell;
    },
    hide(): void {
      if (hiddenAt === null) hiddenAt = now();
    },
    reveal(): void {
      if (hiddenAt === null) return;
      away += now() - hiddenAt;
      hiddenAt = null;
    },
  };
}

/**
 * Samples the reading speed on page turns. `layoutKey` names the section and its current layout
 * (empty until laid out), so turns across chapters, relayouts and jumps never count.
 */
export function usePageDwell(layoutKey: string, page: number, wordsPerPage: number): void {
  const [tracker] = useState(() => createDwellTracker());
  const words = useRef(wordsPerPage);
  words.current = wordsPerPage;

  useEffect(() => {
    if (!layoutKey) return;
    const dwell = tracker.show(layoutKey, page);
    if (dwell !== null) recordPageRead(words.current, dwell);
  }, [tracker, layoutKey, page]);

  useEffect(() => {
    const onVisibility = () => (document.visibilityState === "hidden" ? tracker.hide() : tracker.reveal());
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [tracker]);
}

/** Words in the rendered section, counted again whenever `layoutKey` changes (0 while it is empty). */
export function useSectionWords(bodyRef: RefObject<HTMLElement | null>, layoutKey: string): number {
  const [words, setWords] = useState(0);
  useEffect(() => {
    setWords(layoutKey ? countWords(bodyRef.current?.textContent ?? "") : 0);
  }, [bodyRef, layoutKey]);
  return words;
}

/** Words left in the section: the current page and the ones after it, at the section's average page. */
export function chapterWordsLeft(words: number, page: number, pageCount: number): number {
  if (pageCount < 1 || words <= 0) return 0;
  return (words / pageCount) * Math.min(pageCount, Math.max(1, pageCount - page));
}

/**
 * Words left in the document: its word count (or the backend's minutes, turned back into words) times
 * the share not yet read, and never less than what's left in this chapter. Null when the document
 * has no length.
 */
export function bookWordsLeft(
  percent: number,
  chapterLeft: number,
  wordCount: number | undefined,
  estimatedMinutes: number | undefined,
): number | null {
  const total =
    wordCount && wordCount > 0 ? wordCount : estimatedMinutes && estimatedMinutes > 0 ? estimatedMinutes * ESTIMATE_WPM : 0;
  if (!total) return null;
  const read = Math.min(1, Math.max(0, Number.isFinite(percent) ? percent : 0));
  return Math.max(chapterLeft, total * (1 - read));
}
