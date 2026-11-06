import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowUpRight, ChevronRight, EyeOff, Globe, Library, Search } from "lucide-react";
import type { ContextBriefing, ContextClaim, ContextLink, ContextMedia, ContextRun, ContextRunStep } from "@/api/types";
import { cx } from "@/lib/cx";
import {
  citationView,
  creditLine,
  distinctCitations,
  elapsedLabel,
  runLine,
  stepCounts,
  stepText,
  entityById,
  entityDates,
  itemsAbout,
  KIND_LABELS,
  linksOf,
  safeHref,
  sectionTitle,
  type ItemRef,
  type NodeImage,
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

/** A small heading inside the card. */
function CardLabel({ children }: { children: ReactNode }) {
  return <span className="font-sans text-[12px] leading-4 font-semibold tracking-wide text-fg-3 uppercase">{children}</span>;
}

/** Longer than this, Wikipedia's intro is cut to a few lines with "More". */
const LONG_EXTRACT = 320;

/** Wikipedia's intro, apart from the checked claims: labelled, linked, and not in the reading face. */
function FromWikipedia({ summary }: { summary: NonNullable<ContextMedia["summary"]> }) {
  const long = summary.extract.length > LONG_EXTRACT;
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1 rounded-sm bg-surface-2 px-3 py-2.5">
      <CardLabel>From Wikipedia</CardLabel>
      <p className={cx("font-sans text-[13.5px] leading-5 text-fg", long && !open && "line-clamp-5")}>{summary.extract}</p>
      <p className="flex flex-wrap gap-x-3 font-sans text-[12.5px] leading-[18px]">
        {long && (
          <button type="button" onClick={() => setOpen(!open)} className="font-semibold text-accent hover:text-accent-hover">
            {open ? "Less" : "More"}
          </button>
        )}
        <ExternalLink href={summary.url}>
          Read on Wikipedia
          <ArrowUpRight size={12} className="ml-0.5 inline align-[-1px]" aria-hidden />
        </ExternalLink>
      </p>
    </div>
  );
}

/**
 * The card for a node on a graphic (Phase 5): its picture, its Wikidata facts, Wikipedia's intro (marked
 * as such), then what the briefing checked: the sourced links, and where the briefing talks about it.
 */
export function EntityDetail({
  briefing,
  id,
  onRead,
  image,
  summary,
}: {
  briefing: ContextBriefing;
  id: string;
  onRead?: (ref: ItemRef) => void;
  image?: NodeImage;
  summary?: ContextMedia["summary"];
}) {
  const e = entityById(briefing, id);
  if (!e) return null;
  const dates = entityDates(e);
  const wikidata =
    safeHref(e.facts?.source) ?? (e.wikidata ? `https://www.wikidata.org/wiki/${encodeURIComponent(e.wikidata)}` : null);
  const record = e.kind === "work" ? safeHref(e.resolvedUrl) : null;
  const links = linksOf(briefing, id);
  const items = itemsAbout(briefing, id);
  const commons = image?.credit ? safeHref(image.credit.page) : null;
  return (
    <section aria-label={e.name} className="flex flex-col gap-3">
      {image && (
        <figure className="flex flex-col items-start gap-1">
          <img
            src={image.url}
            alt={e.name}
            className="max-h-[240px] w-auto max-w-full rounded-sm bg-surface-2 object-contain shadow-[0_0_0_1px_var(--detail)]"
          />
          {image.credit && (
            <figcaption className="font-sans text-[11.5px] leading-4 text-fg-3">
              Picture:{" "}
              {commons ? (
                <ExternalLink href={commons} className="text-fg-2">
                  {creditLine(image.credit)}, Wikimedia Commons
                </ExternalLink>
              ) : (
                creditLine(image.credit)
              )}
            </figcaption>
          )}
        </figure>
      )}
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
      {summary && safeHref(summary.url) && <FromWikipedia summary={{ ...summary, url: safeHref(summary.url)! }} />}
      {links.length > 0 && (
        <div className="flex flex-col gap-3">
          <CardLabel>How it connects</CardLabel>
          {links.map((l, i) => (
            <LinkClaim key={i} briefing={briefing} link={l} />
          ))}
        </div>
      )}
      {items.length > 0 && onRead && (
        <div className="flex flex-col gap-1">
          <CardLabel>In the briefing</CardLabel>
          {items.map((ref) => (
            <button
              key={`${ref.kind}-${ref.index}`}
              type="button"
              onClick={() => onRead(ref)}
              className="-mx-2 flex items-center gap-2 rounded-sm px-2 py-1.5 text-left font-sans text-[13.5px] leading-5 transition-hover hover:bg-surface-hover"
            >
              <span className="min-w-0 flex-1">
                <span className="text-fg-2">{sectionTitle(ref.kind, briefing)}: </span>
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

// ---- A run as it goes (Phase 4) ----

/**
 * The time a run has taken, ticking each second between polls: the server's `elapsedMs` when the run
 * was fetched, plus the time since (so a phone's clock doesn't matter). Null when the run hasn't said.
 */
export function useElapsed(run: ContextRun | undefined, fetchedAt: number): string | null {
  const [now, setNow] = useState(() => Date.now());
  const running = run?.status === "running" && run.elapsedMs !== undefined;
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  if (!running) return null;
  return elapsedLabel(run.elapsedMs! + Math.max(0, now - (fetchedAt || now)));
}

function StepIcon({ kind }: { kind: ContextRunStep["kind"] }) {
  const Icon = kind === "search" ? Search : kind === "read" ? Globe : Library;
  return <Icon size={13} strokeWidth={2} aria-hidden className="shrink-0 text-fg-3" />;
}

/** The run's latest steps, oldest first; earlier ones are counted. */
export function StepList({ steps, max }: { steps: ContextRunStep[] | undefined; max: number }) {
  if (!steps?.length) return null;
  const from = Math.max(0, steps.length - max);
  return (
    <ol aria-label="What it has done so far" className="flex flex-col gap-1 font-sans text-[12.5px] leading-[18px]">
      {from > 0 && <li className="pl-[21px] text-fg-3">{from === 1 ? "1 earlier step" : `${from} earlier steps`}</li>}
      {steps.slice(from).map((s, i) => (
        <li
          key={from + i}
          className={cx("context-step flex min-w-0 items-center gap-2", s.ok ? "text-fg-2" : "text-fg-3")}
          title={s.kind === "read" ? (s.title ? `${s.title}\n${s.url}` : s.url) : undefined}
        >
          <StepIcon kind={s.kind} />
          <span className="min-w-0 truncate">{stepText(s)}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * A run in progress: a moving bar, what it's doing (the stage, or what the checker has before it) with
 * the time so far, the counts, and its latest steps (they stay while it checks; the one-line form drops
 * its step then, as it's no longer what's happening). `lead` goes before the line ("Making a new
 * briefing: "); `steps` is how many to list (0: only the newest, on one line).
 */
export function RunProgress({
  run,
  fetchedAt,
  lead,
  steps,
  children,
}: {
  run: ContextRun | undefined;
  fetchedAt: number;
  lead?: string;
  steps: number;
  children?: ReactNode;
}) {
  const elapsed = useElapsed(run, fetchedAt);
  const line = runLine(run);
  const counts = stepCounts(run?.steps);
  const latest = run?.steps?.at(-1);
  return (
    <div className="flex flex-col">
      <div className="relative h-0.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className="context-progress absolute inset-y-0 w-1/3 rounded-full bg-accent" />
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <p role="status" aria-live="polite" className="font-sans text-[14px] leading-5 font-medium">
          {lead ? `${lead}${line.charAt(0).toLowerCase()}${line.slice(1)}` : line}
        </p>
        {elapsed && (
          <span className="shrink-0 font-sans text-[12.5px] leading-4 text-fg-3 tabular-nums">
            <span className="sr-only">Time so far: </span>
            {elapsed}
          </span>
        )}
      </div>
      {counts && <p className="mt-0.5 font-sans text-[12.5px] leading-[18px] text-fg-3">{counts}</p>}
      {steps > 0 ? (
        run?.steps?.length ? (
          <div className="mt-2.5">
            <StepList steps={run.steps} max={steps} />
          </div>
        ) : null
      ) : (
        latest &&
        run?.stage !== "checking" && (
          <p
            key={run!.steps!.length}
            className="context-step mt-1 flex min-w-0 items-center gap-2 font-sans text-[12.5px] leading-[18px] text-fg-2"
          >
            <StepIcon kind={latest.kind} />
            <span className="min-w-0 truncate">{stepText(latest)}</span>
          </p>
        )
      )}
      {children}
    </div>
  );
}
