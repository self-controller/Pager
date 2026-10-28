import { useLayoutEffect, useMemo, type MouseEvent, type RefObject } from "react";
import { sanitizeHtml } from "@/lib/sanitize";

/** Lowercase letters and digits only, single-spaced: "Chapter I." → "chapter i". */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** True when a body heading just repeats the title already shown in the post header. */
export function isDuplicateTitle(heading: string, title: string): boolean {
  const h = normalizeTitle(heading);
  const t = normalizeTitle(title);
  return Boolean(h && t) && (h === t || h.startsWith(`${t} `) || t.startsWith(`${h} `));
}

/** Where an in-document link points: a block id, and its section when that is known. */
export interface InternalTarget {
  id: string;
  sectionId?: string;
}

interface Props {
  html: string;
  /** The title shown in the header; a leading body heading repeating it is hidden. */
  title: string;
  bodyRef: RefObject<HTMLDivElement | null>;
  /** In-document link (`#id`, `a.internal`, footnote refs). External links open in a new tab. */
  onInternalLink: (target: InternalTarget) => void;
  /** A plain click on the text (not a link, not the end of a selection), at viewport coordinates. True when it opened something. */
  onTextClick?: (x: number, y: number) => boolean | void;
}

/**
 * The document body in the reader's `.markup` typography. HTML is sanitised before render and
 * otherwise left exactly as the server sent it: hiding a duplicate title uses a class, so the
 * section's textContent (the coordinate space for selections and annotations) never changes.
 */
export function ReaderBody({ html, title, bodyRef, onInternalLink, onTextClick }: Props) {
  const clean = useMemo(() => sanitizeHtml(html), [html]);

  useLayoutEffect(() => {
    const first = bodyRef.current?.firstElementChild;
    if (first && /^H[1-6]$/.test(first.tagName)) {
      first.classList.toggle("is-duplicate-title", isDuplicateTitle(first.textContent ?? "", title));
    }
  }, [clean, title, bodyRef]);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = (e.target as Element).closest?.("a");
    if (!link) {
      const sel = window.getSelection();
      if (onTextClick && (!sel || sel.isCollapsed) && onTextClick(e.clientX, e.clientY)) e.preventDefault();
      return;
    }
    const href = link.getAttribute("href");
    if (!href?.startsWith("#") || href.length < 2) return;
    e.preventDefault();
    onInternalLink({ id: link.dataset.block ?? decodeURIComponent(href.slice(1)), sectionId: link.dataset.section });
  };

  return <div ref={bodyRef} className="markup" dir="auto" onClick={onClick} dangerouslySetInnerHTML={{ __html: clean }} />;
}

export function ReaderBodySkeleton() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading">
      {[92, 100, 96, 88, 60, 0, 98, 94, 100, 72].map((w, i) =>
        w === 0 ? <div key={i} className="h-4" /> : <div key={i} className="skeleton h-[18px]" style={{ width: `${w}%` }} />,
      )}
    </div>
  );
}
