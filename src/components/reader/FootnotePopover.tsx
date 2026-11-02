import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ArrowRight, X } from "lucide-react";
import { api } from "@/api";
import { queryKeys } from "@/api/hooks";
import type { DocumentDetail, Section } from "@/api/types";
import { IconButton } from "@/components/ui/Button";
import { sanitizeHtml } from "@/lib/sanitize";
import { findInHtml, isNoteRef, noteContainer, noteHtml, noteLabel, type NoteSource } from "./footnotes";
import type { InternalTarget } from "./ReaderBody";
import { onReaderMove } from "./events";
import { findTarget } from "./useReadingProgress";

/** A note open in the popover. */
export interface OpenNote {
  /** Where the note is: the id the reference points at, and its section once known. */
  target: InternalTarget;
  /** The reference as printed: "1", "*". */
  label: string;
  /** The reference's box when it was tapped, in viewport coordinates. */
  anchor: DOMRect;
  /** The note's content (a copy, sanitised again when shown); null while it loads, "" if not found. */
  html: string | null;
  /** The reference link, to give focus back to. */
  ref: HTMLAnchorElement;
}

/** Side margins: the popover is `calc(100vw - 2.5rem)` wide on phones, so 1.25rem each side. */
const MARGIN_X = 20;
const MARGIN_Y = 8;
const GAP = 8;

export interface PopoverPlace {
  left: number;
  top: number;
  side: "below" | "above";
  /** Where the reference sits along the popover's width: the entrance grows from there. */
  originX: number;
}

/** Below the reference when it fits, else above, else on the roomier side; always inside the viewport. */
export function placePopover(
  anchor: { left: number; right: number; top: number; bottom: number },
  width: number,
  height: number,
  viewport: { width: number; height: number },
): PopoverPlace {
  const center = (anchor.left + anchor.right) / 2;
  const left = Math.max(MARGIN_X, Math.min(center - width / 2, viewport.width - width - MARGIN_X));
  const roomBelow = viewport.height - MARGIN_Y - (anchor.bottom + GAP);
  const roomAbove = anchor.top - GAP - MARGIN_Y;
  const side = height <= roomBelow || roomBelow >= roomAbove ? "below" : "above";
  const wanted = side === "below" ? anchor.bottom + GAP : anchor.top - GAP - height;
  const top = Math.max(MARGIN_Y, Math.min(wanted, viewport.height - height - MARGIN_Y));
  return { left, top, side, originX: Math.max(0, Math.min(center - left, width)) };
}

type Hit = { target: Element; root: Element | null; sectionId: string };

/**
 * Finds a note that isn't in the open section: in the section the link names; else in sections
 * already loaded; else, fetching, in earlier sections first (a note is kept with the first section
 * that cites it), then later ones.
 */
async function locateNote(
  qc: QueryClient,
  docId: string,
  doc: DocumentDetail | undefined,
  section: Section,
  target: InternalTarget,
): Promise<Hit | null> {
  const load = (id: string) =>
    qc.fetchQuery({ queryKey: queryKeys.section(docId, id), queryFn: () => api.getSection(docId, id), staleTime: Infinity });
  const look = (s: Section | undefined): Hit | null => {
    const found = s && s.html.includes(target.id) ? findInHtml(s.html, target.id) : null;
    return found && s ? { ...found, sectionId: s.id } : null;
  };
  if (target.sectionId && target.sectionId !== section.id) return look(await load(target.sectionId));
  // Every cached section of this document (the prefix of queryKeys.section).
  for (const [, s] of qc.getQueriesData<Section>({ queryKey: ["section", docId] })) {
    const hit = s && s.id !== section.id ? look(s) : null;
    if (hit) return hit;
  }
  const toc = doc?.toc ?? [];
  const order = [...toc.filter((e) => e.index < section.index).reverse(), ...toc.filter((e) => e.index > section.index)];
  for (const entry of order) {
    const hit = look(await load(entry.id));
    if (hit) return hit;
  }
  return null;
}

/**
 * Note references open their note in a popover instead of jumping. `open` returns false for a link
 * that isn't a note reference (the caller jumps as before).
 */
export function useFootnotes({
  docId,
  doc,
  section,
  bodyRef,
}: {
  docId: string | undefined;
  doc: DocumentDetail | undefined;
  section: Section | undefined;
  bodyRef: RefObject<HTMLElement | null>;
}): { note: OpenNote | null; open: (target: InternalTarget, link: HTMLAnchorElement) => boolean; close: () => void } {
  const qc = useQueryClient();
  const [note, setNote] = useState<OpenNote | null>(null);
  const request = useRef(0);

  const close = useCallback(() => {
    request.current++;
    setNote(null);
  }, []);

  // Another chapter or document closes the note.
  useEffect(() => close(), [docId, section?.id, close]);

  const open = useCallback(
    (target: InternalTarget, link: HTMLAnchorElement): boolean => {
      const body = bodyRef.current;
      if (!docId || !section || !body) return false;
      const elsewhere = target.sectionId && target.sectionId !== section.id ? target.sectionId : undefined;
      let hit: Hit | null = null;
      if (elsewhere) {
        const cached = qc.getQueryData<Section>(queryKeys.section(docId, elsewhere));
        const found = cached ? findInHtml(cached.html, target.id) : null;
        if (found) hit = { ...found, sectionId: elsewhere };
      } else {
        const el = findTarget(body, target.id);
        if (el) hit = { target: el, root: body, sectionId: section.id };
      }
      if (!isNoteRef(link, hit?.target ?? null, hit?.root)) return false;

      const from: NoteSource = {
        id: link.id || undefined,
        blockId: link.closest("[data-b]")?.getAttribute("data-b") ?? undefined,
      };
      const base = { label: noteLabel(link), anchor: link.getBoundingClientRect(), ref: link };
      const shown = (h: Hit | null): OpenNote => ({
        ...base,
        target: h ? { id: target.id, sectionId: h.sectionId } : target,
        html: h ? noteHtml(noteContainer(h.target, h.root) ?? h.target, from) : "",
      });
      const ticket = ++request.current;
      if (hit) {
        setNote(shown(hit));
        return true;
      }
      setNote({ ...base, target, html: null });
      locateNote(qc, docId, doc, section, target).then(
        (h) => request.current === ticket && setNote(shown(h)),
        () => request.current === ticket && setNote(shown(null)),
      );
      return true;
    },
    [qc, docId, doc, section, bodyRef],
  );

  return { note, open, close };
}

/**
 * A footnote in place, beside its reference: 14/21px in the reading face, at most 460px wide and
 * 60vh tall (it scrolls inside). Closes on a tap outside, the X, Esc, or a page turn. "Go to note"
 * makes the real jump. Marked `data-reader-overlay` so a tap outside only closes it.
 */
export function FootnotePopover({
  note,
  onClose,
  onGoTo,
  onLink,
}: {
  note: OpenNote;
  onClose: () => void;
  onGoTo: () => void;
  /** A link inside the note to elsewhere in the document. */
  onLink: (target: InternalTarget) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<PopoverPlace | null>(null);
  const html = useMemo(() => (note.html ? sanitizeHtml(note.html) : note.html), [note.html]);
  const title = note.label ? `Note ${note.label}` : "Note";

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPlace(
      placePopover(note.anchor, el.offsetWidth, el.offsetHeight, { width: window.innerWidth, height: window.innerHeight }),
    );
  }, [note.anchor, html]);

  /** Closes, and with `refocus` gives focus back to the reference (keyboard and X). */
  const dismiss = useCallback(
    (refocus: boolean) => {
      onClose();
      if (refocus && note.ref.isConnected) note.ref.focus({ preventScroll: true });
    },
    [onClose, note.ref],
  );

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) dismiss(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        dismiss(true);
      }
    };
    const onMove = () => dismiss(false);
    let offMove: (() => void) | undefined;
    // Registered after the opening click has finished propagating.
    const t = window.setTimeout(() => {
      document.addEventListener("pointerdown", onDown);
      offMove = onReaderMove(onMove);
      window.addEventListener("resize", onMove);
    });
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("pointerdown", onDown);
      offMove?.();
      window.removeEventListener("resize", onMove);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [dismiss]);

  // Links inside the note: in-document ones jump (with history), outside ones open a new tab.
  const onContentClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as Element).closest?.("a");
    const href = a?.getAttribute("href");
    if (!a || !href?.startsWith("#") || href.length < 2) return;
    e.preventDefault();
    onLink({ id: a.dataset.block ?? decodeURIComponent(href.slice(1)), sectionId: a.dataset.section ?? note.target.sectionId });
  };

  return (
    <div
      ref={ref}
      data-reader-overlay
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      className="footnote-popover fixed z-40 flex flex-col rounded-md bg-elevated elevation outline-none"
      data-side={place?.side}
      style={
        place
          ? { left: place.left, top: place.top, transformOrigin: `${place.originX}px ${place.side === "below" ? "0" : "100%"}` }
          : { left: -9999, top: -9999 }
      }
    >
      <div className="flex shrink-0 items-center justify-between gap-2 pt-1 pr-1 pl-4">
        <span className="font-sans text-[12px] leading-4 font-semibold text-fg-2">{title}</span>
        <IconButton icon={X} label="Close note" size="sm" variant="tertiary" onClick={() => dismiss(true)} />
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-3">
        {html === null ? (
          <div className="flex flex-col gap-2 py-1" role="status" aria-label="Loading note">
            {[96, 100, 64].map((w) => (
              <div key={w} className="skeleton h-3.5" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : html ? (
          <div
            className="markup footnote-popover-text"
            dir="auto"
            onClick={onContentClick}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <p className="font-sans text-[14px] leading-5 text-fg-2">This note couldn't be found in the document.</p>
        )}
      </div>
      {html !== "" && (
        <div className="flex shrink-0 border-t border-detail px-2">
          <button
            type="button"
            onClick={onGoTo}
            disabled={html === null}
            className="inline-flex h-11 items-center gap-1 rounded-sm px-2 font-sans text-[13px] leading-4 font-semibold text-accent transition-hover hover:text-accent-hover disabled:opacity-50"
          >
            Go to note
            <ArrowRight size={14} strokeWidth={2} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
