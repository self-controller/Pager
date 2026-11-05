import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowUpRight, ChevronRight, EyeOff } from "lucide-react";
import type { ContextBriefing, ContextClaim, ContextLink } from "@/api/types";
import { cx } from "@/lib/cx";
import {
  citationView,
  distinctCitations,
  entityById,
  entityDates,
  itemsAbout,
  KIND_LABELS,
  linksOf,
  safeHref,
  SECTION_TITLES,
  type ItemRef,
} from "./model";

/** A link out of Pager: a new tab in a browser, Safari in the iPhone app (it sends `_blank` there). */
export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cx("text-accent hover:text-accent-hover hover:underline", className)}
    >
      {children}
    </a>
  );
}

export const INFERRED_NOTE = "Drawn from the sources rather than stated in them.";

export function InferredMark() {
  return (
    <span
      title={INFERRED_NOTE}
      className="ml-1.5 inline-block translate-y-[-1px] rounded-xs px-1 align-middle font-sans text-[10.5px] leading-4 font-semibold tracking-wide text-fg-2 uppercase shadow-[inset_0_0_0_1px_var(--detail)]"
    >
      Inferred<span className="sr-only">: {INFERRED_NOTE}</span>
    </span>
  );
}

/** Sources under a claim: title (a link), then author and year. A `book` citation names the part of the book it quotes. */
export function Citations({ claim }: { claim: ContextClaim }) {
  const list = distinctCitations(claim.citations);
  if (list.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-col gap-0.5 font-sans text-[12.5px] leading-[18px]" aria-label="Sources">
      {list.map((c, i) => {
        const v = citationView(c);
        return (
          <li key={i} className="flex gap-1.5 text-fg-2">
            <span aria-hidden className="shrink-0 text-fg-3">
              ↳
            </span>
            <span className="min-w-0">
              {v.fromBook ? (
                <>
                  From the book: <span className="text-fg">{v.title}</span>
                </>
              ) : v.href ? (
                <ExternalLink href={v.href} className="break-words">
                  {v.title}
                  <ArrowUpRight size={12} className="ml-0.5 inline align-[-1px]" aria-hidden />
                </ExternalLink>
              ) : (
                <span className="text-fg">{v.title}</span>
              )}
              {v.meta && <span className="text-fg-3"> · {v.meta}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** One sourced sentence or two, in the reading face, with its sources beneath. */
export function Claim({ claim, size = "md" }: { claim: ContextClaim; size?: "md" | "sm" }) {
  const body = (
    <div>
      <p className={cx("font-serif text-fg", size === "md" ? "text-[15.5px] leading-[1.55]" : "text-[14.5px] leading-[1.5]")}>
        {claim.text}
        {claim.inferred && <InferredMark />}
      </p>
      <Citations claim={claim} />
    </div>
  );
  return claim.spoiler ? <SpoilerFold>{body}</SpoilerFold> : body;
}

/** Hides what gives the book away until the reader asks. */
export function SpoilerFold({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (open) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left font-sans text-[13px] leading-5 text-fg-2 shadow-[inset_0_0_0_1px_var(--detail)] transition-hover hover:bg-surface-hover"
    >
      <EyeOff size={15} aria-hidden className="shrink-0" />
      <span className="flex-1">Contains spoilers</span>
      <span className="font-semibold text-accent">Show</span>
    </button>
  );
}

/** "Charles Darwin read Thomas Malthus", with the claim and its sources. */
export function LinkClaim({ briefing, link }: { briefing: ContextBriefing; link: ContextLink }) {
  const from = entityById(briefing, link.from)?.name ?? link.from;
  const to = entityById(briefing, link.to)?.name ?? link.to;
  return (
    <div className="flex flex-col gap-1">
      <p className="font-sans text-[13px] leading-[18px] text-fg-2">
        <span className="font-semibold text-fg">{from}</span> {link.relation} <span className="font-semibold text-fg">{to}</span>
      </p>
      <Claim claim={link.claim} size="sm" />
    </div>
  );
}

/** What the map knows about a node: its Wikidata facts, its sourced links, and where the briefing talks about it. */
export function EntityDetail({
  briefing,
  id,
  onRead,
}: {
  briefing: ContextBriefing;
  id: string;
  onRead?: (ref: ItemRef) => void;
}) {
  const e = entityById(briefing, id);
  if (!e) return null;
  const dates = entityDates(e);
  const wikidata =
    safeHref(e.facts?.source) ?? (e.wikidata ? `https://www.wikidata.org/wiki/${encodeURIComponent(e.wikidata)}` : null);
  const record = e.kind === "work" ? safeHref(e.resolvedUrl) : null;
  const links = linksOf(briefing, id);
  const items = itemsAbout(briefing, id);
  return (
    <section aria-label={e.name} className="flex flex-col gap-3">
      <div>
        <h4 className="font-display text-[17px] leading-6 font-semibold">{e.name}</h4>
        <p className="font-sans text-[12.5px] leading-[18px] text-fg-2">
          {[KIND_LABELS[e.kind], dates].filter(Boolean).join(" · ")}
          {record && record !== wikidata && (
            <>
              {" · "}
              <ExternalLink href={record}>Catalogue record</ExternalLink>
            </>
          )}
          {wikidata && (
            <>
              {" · "}
              <ExternalLink href={wikidata}>Wikidata</ExternalLink>
            </>
          )}
        </p>
        {e.facts?.description && <p className="mt-1 font-sans text-[13px] leading-[18px] text-fg-2">{e.facts.description}</p>}
      </div>
      {links.length > 0 && (
        <div className="flex flex-col gap-3">
          {links.map((l, i) => (
            <LinkClaim key={i} briefing={briefing} link={l} />
          ))}
        </div>
      )}
      {items.length > 0 && onRead && (
        <div className="flex flex-col gap-1">
          <span className="font-sans text-[12px] leading-4 font-semibold tracking-wide text-fg-3 uppercase">In the briefing</span>
          {items.map((ref) => (
            <button
              key={`${ref.kind}-${ref.index}`}
              type="button"
              onClick={() => onRead(ref)}
              className="-mx-2 flex items-center gap-2 rounded-sm px-2 py-1.5 text-left font-sans text-[13.5px] leading-5 transition-hover hover:bg-surface-hover"
            >
              <span className="min-w-0 flex-1">
                <span className="text-fg-2">{SECTION_TITLES[ref.kind]}: </span>
                <span className="font-medium text-accent">{ref.item.heading}</span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-fg-3" aria-hidden />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** The width of a box, kept up to date. */
export function useWidth<T extends HTMLElement>(fallback: number): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(200, Math.round(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
