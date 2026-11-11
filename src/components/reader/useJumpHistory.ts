import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Section } from "@/api/types";
import { layoutStamp, placeAtPoint, type ReaderLayout } from "./layout";
import { sectionHref } from "./TocDrawer";
import { flashLanding, pageForPoint } from "./useReadingProgress";

/** A place in the document to come back to. */
export interface Place {
  sectionId: string;
  /** Position in reading order, to count pages across a chapter boundary. */
  sectionIndex: number;
  /** The chapter's title, for "Back to p. 42 · Chapter 3". */
  title: string;
  /** Pages, or in the scroll layout screenfuls. */
  page: number;
  pageCount: number;
  /** The words at the reading place: the place is found again from them after a relayout. */
  point: { blockId: string; offset: number } | null;
}

/**
 * The back pill's memory, a two-state toggle like Apple Books' "Undo Page Skip". After a jump it
 * offers the place the reader left ("back"); used, it offers the place it was used from ("return"),
 * and so on. Kept in memory for the open document only.
 */
export interface Jump {
  docId: string;
  kind: "back" | "return";
  /** Where the pill goes. */
  to: Place;
  /** The other end: where the jump landed. Null until it has. */
  from: Place | null;
  /** The chapter a jump is headed for, when it's another: only a position there is its landing. */
  toward?: string;
}

/** Turning (or scrolling) this many pages away from both ends of a jump retires the pill. */
export const AWAY_PAGES = 3;

type Where = Pick<Place, "sectionId" | "sectionIndex" | "page" | "pageCount">;

function samePage(a: Where, b: Where): boolean {
  return a.sectionId === b.sectionId && a.page === b.page;
}

/** Page turns between two places; across one chapter boundary too, beyond that "far". */
export function pagesBetween(a: Where, b: Where): number {
  if (a.sectionId === b.sectionId) return Math.abs(a.page - b.page);
  const [first, second] = a.sectionIndex < b.sectionIndex ? [a, b] : [b, a];
  if (second.sectionIndex - first.sectionIndex !== 1) return Infinity;
  return first.pageCount - first.page + second.page;
}

/** A jump is about to leave `origin`, for chapter `toward` when it's another. */
export function jumped(docId: string, origin: Place, toward?: string): Jump {
  return { docId, kind: "back", to: origin, from: null, ...(toward && toward !== origin.sectionId ? { toward } : {}) };
}

/**
 * The reader is now at `here` (a landing or a page turn). The first position after a jump (in the
 * chapter it's headed for) is its landing; a jump that landed where it started is dropped, and so
 * is one left far behind.
 */
export function seen(jump: Jump | null, here: Where): Jump | null {
  if (!jump) return null;
  if (!jump.from) {
    // A late page change in the chapter being left (a slide settling) isn't the landing.
    if (jump.toward && here.sectionId !== jump.toward) return jump;
    return samePage(here, jump.to) ? null : { ...jump, from: { ...here, title: "", point: null } };
  }
  return pagesBetween(here, jump.to) >= AWAY_PAGES && pagesBetween(here, jump.from) >= AWAY_PAGES ? null : jump;
}

/** The pill was used at `here`: it flips, now offering the way back to `here`. Both ends are known. */
export function used(jump: Jump, here: Place): Jump {
  return { docId: jump.docId, kind: jump.kind === "back" ? "return" : "back", to: here, from: jump.to };
}

/** After a relayout of a section, its places move to the pages now holding their words. */
export function repaged(
  jump: Jump,
  sectionId: string,
  pageCount: number,
  pageOf: (point: NonNullable<Place["point"]>) => number | null,
): Jump {
  const move = (p: Place): Place => {
    if (p.sectionId !== sectionId) return p;
    const page = p.point ? pageOf(p.point) : null;
    return { ...p, pageCount, page: page ?? Math.min(p.page, pageCount - 1) };
  };
  return { ...jump, to: move(jump.to), from: jump.from && move(jump.from) };
}

export interface Pill {
  kind: "back" | "return";
  /** 1-based, within its chapter, as the footer counts. Absent in the scroll layout, which has no page numbers. */
  page?: number;
  /** Set when the place is in another chapter. */
  chapter?: string;
}

/**
 * What the pill says, if it shows: only once a jump has landed, and never for the page in view.
 * `units` is "none" in the scroll layout, whose screenfuls aren't numbered for the reader.
 */
export function pillFor(
  jump: Jump | null,
  docId: string | undefined,
  here: Where | null,
  units: "page" | "none" = "page",
): Pill | null {
  if (!jump || jump.docId !== docId || !jump.from || !here || samePage(here, jump.to)) return null;
  return {
    kind: jump.kind,
    ...(units === "page" ? { page: jump.to.page + 1 } : {}),
    chapter: here.sectionId !== jump.to.sectionId ? jump.to.title || undefined : undefined,
  };
}

/** The pill's two parts: "Back to p. 42" and "Chapter 3"; "Back" or "Back to" + "Chapter 3" without pages. */
export function pillParts(pill: Pill): { lead: string; chapter?: string } {
  const verb = pill.kind === "back" ? "Back" : "Return";
  if (pill.page !== undefined) return { lead: `${verb} to p. ${pill.page}`, chapter: pill.chapter };
  return { lead: pill.chapter ? `${verb} to` : verb, chapter: pill.chapter };
}

/** "Back to p. 42", "Return to p. 87 · Chapter 3"; in the scroll layout "Back", "Return to Chapter 3". */
export function pillText(pill: Pill): string {
  const { lead, chapter } = pillParts(pill);
  if (!chapter) return lead;
  return pill.page !== undefined ? `${lead} · ${chapter}` : `${lead} ${chapter}`;
}

/**
 * The reader's jump history and back pill. Call `record()` just before a non-linear jump (a link, a
 * note, the contents), with the chapter it goes to when that's another; ordinary page turns, across
 * chapters too, are not jumps. `go()` uses the pill.
 * `placed` says the open section has been put on its page (useReadingProgress), so positions seen
 * while a section is still loading don't count.
 */
export function useJumpHistory({
  docId,
  section,
  layout,
  bodyRef,
  placed,
  move,
}: {
  docId: string | undefined;
  section: Section | undefined;
  layout: ReaderLayout;
  bodyRef: RefObject<HTMLElement | null>;
  placed: boolean;
  /** Goes to another chapter of the open book, opened with `state` (the reader's `move`, trail.ts). */
  move: (to: string, state: Record<string, unknown>) => void;
}): { pill: Pill | null; record: (toward?: string) => void; go: () => void } {
  const [jump, setJump] = useState<Jump | null>(null);
  const latest = useRef({ jump, section, layout, placed, docId });
  latest.current = { jump, section, layout, placed, docId };

  /** The current place, with the words at the reading place. Null until the section is placed. */
  const capture = useCallback((): Place | null => {
    const { section: s, layout: p, placed: ready } = latest.current;
    const body = bodyRef.current;
    if (!s || !ready) return null;
    const point = body ? p.readingPoint(body) : null;
    return {
      sectionId: s.id,
      sectionIndex: s.index,
      title: s.title,
      page: p.page,
      pageCount: p.pageCount,
      point: point && { blockId: point.blockId, offset: point.offset },
    };
  }, [bodyRef]);

  // Leaving the document forgets its places.
  useEffect(() => setJump(null), [docId]);

  // Watch the position: the jump lands, a relayout moves its places, the reader turns away.
  const sectionId = section?.id;
  const sectionIndex = section?.index ?? 0;
  const { page, pageCount, kind } = layout;
  const stamp = layoutStamp(layout);
  const lastStamp = useRef("");
  useEffect(() => {
    if (!placed || !sectionId) return;
    let next = latest.current.jump;
    const body = bodyRef.current;
    if (next && body && stamp !== lastStamp.current) {
      const p = latest.current.layout;
      next = repaged(next, sectionId, pageCount, (point) => pageForPoint(body, point, p));
    }
    lastStamp.current = stamp;
    next = seen(next, { sectionId, sectionIndex, page, pageCount });
    if (next !== latest.current.jump) setJump(next);
  }, [placed, sectionId, sectionIndex, page, pageCount, stamp, bodyRef]);

  const record = useCallback(
    (toward?: string) => {
      const origin = capture();
      const id = latest.current.docId;
      if (origin && id) setJump(jumped(id, origin, toward));
    },
    [capture],
  );

  const go = useCallback(() => {
    const { jump: j, section: s, layout: p, docId: id } = latest.current;
    const here = capture();
    if (!j || !here || !s || !id) return;
    setJump(used(j, here));
    const { to } = j;
    if (to.sectionId !== s.id) {
      move(sectionHref(id, to.sectionId), { jump: true, page: to.page, point: to.point ?? undefined });
      return;
    }
    const body = bodyRef.current;
    if (body && to.point && placeAtPoint(body, to.point, p))
      flashLanding(body.querySelector(`[data-b="${CSS.escape(to.point.blockId)}"]`));
    else p.goTo(to.page);
  }, [capture, move, bodyRef]);

  const pill = pillFor(
    jump,
    docId,
    sectionId && placed ? { sectionId, sectionIndex, page, pageCount } : null,
    kind === "scroll" ? "none" : "page",
  );
  return { pill, record, go };
}
