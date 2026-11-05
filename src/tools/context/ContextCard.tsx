import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, BookOpen, X } from "lucide-react";
import { useContextBriefing, useContextRun, useContextStatus, useStartContext } from "@/api/hooks";
import { ApiError, ErrorCodes, type ContextBriefing, type DocumentDetail } from "@/api/types";
import { Button, IconButton } from "@/components/ui/Button";
import { onReaderMove } from "@/components/reader/events";
import { placePopover, type PopoverPlace } from "@/components/reader/FootnotePopover";
import { cx } from "@/lib/cx";
import { useSettings } from "@/state/settings";
import { openToolPanel } from "@/tools/registry";
import {
  entityById,
  entityDates,
  findInBriefing,
  focusName,
  FOCUS_COST,
  FOCUS_REFUSED,
  KIND_LABELS,
  matchClaim,
  normalizeFocus,
  orderedSections,
  phoneRunsLine,
  relationLine,
  sectionTitle,
  STAGE_TEXT,
  type BriefingMatch,
  type FocusText,
} from "./model";
import { Claim, LinkClaim, SpoilerFold } from "./parts";
import { closeCard, revealInPanel, setPanelFocus, type ContextCardState } from "./store";

/**
 * "Context for this": a card beside the selection, like a footnote (prompts/book-context.md, Phase 3,
 * Decision 11). The first tap never spends money: it shows a focused briefing already made, else what
 * the book's own briefing says about the name, else an offer to make one. "Open in Context" opens the
 * tool panel on the same thing, in full. Closes on a tap outside, ✕, Esc, a page turn or a scroll.
 */
export function ContextCard({ card, doc }: { card: ContextCardState; doc: DocumentDetail }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<PopoverPlace | null>(null);
  const focus = useMemo(() => normalizeFocus(card.text), [card.text]);

  // Beside the selection, placed again as the card grows (loading → content).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = card.rect;
    const mid = window.innerWidth / 2;
    const anchor = r
      ? { left: r.left, right: r.left + r.width, top: r.top, bottom: r.top + r.height }
      : { left: mid, right: mid, top: 72, bottom: 72 };
    // Never over the words it is about: at most as tall as the roomier side (it scrolls inside).
    const room = Math.max(window.innerHeight - anchor.bottom - 16, anchor.top - 16, 180);
    el.style.maxHeight = `${Math.min(window.innerHeight * 0.6, room)}px`;
    const measure = () =>
      setPlace(placePopover(anchor, el.offsetWidth, el.offsetHeight, { width: window.innerWidth, height: window.innerHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [card.rect]);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeCard();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) {
        e.stopPropagation();
        closeCard();
      }
    };
    let offMove: (() => void) | undefined;
    // Registered after the opening click has finished propagating.
    const t = window.setTimeout(() => {
      document.addEventListener("pointerdown", onDown);
      offMove = onReaderMove(closeCard);
      window.addEventListener("resize", closeCard);
    });
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("pointerdown", onDown);
      offMove?.();
      window.removeEventListener("resize", closeCard);
      document.removeEventListener("keydown", onKey, true);
    };
  }, []);

  return (
    <div
      ref={ref}
      data-reader-overlay
      role="dialog"
      aria-label={focus ? `Context for ${focus.text}` : "Context"}
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
        <span className="font-sans text-[12px] leading-4 font-semibold text-fg-2">Context</span>
        <IconButton icon={X} label="Close" size="sm" variant="tertiary" onClick={closeCard} />
      </div>
      {focus ? (
        <CardContent doc={doc} focus={focus} />
      ) : (
        <Body>
          <Title>{FOCUS_REFUSED}</Title>
          <Meta>Context for this works on a name, a work or a term, up to 120 characters.</Meta>
        </Body>
      )}
    </div>
  );
}

function CardContent({ doc, focus }: { doc: DocumentDetail; focus: FocusText }) {
  const { contextLevel: level } = useSettings();
  const status = useContextStatus();
  const focused = useContextBriefing(doc.id, level, focus.text);
  const whole = useContextBriefing(doc.id, level, null);
  const start = useStartContext(doc.id);
  const [runId, setRunId] = useState<string | undefined>();
  const activeRunId = runId ?? focused.data?.run?.id;
  const run = useContextRun(activeRunId);

  const make = useCallback(
    () => start.mutate({ level, focus: focus.text }, { onSuccess: (r) => setRunId(r.run?.id) }),
    [start, level, focus.text],
  );
  /** The tool panel on this focused briefing: made, being made, or (no key) the setup steps. */
  const openFocused = useCallback(() => {
    setPanelFocus({ docId: doc.id, focus: focus.text });
    openToolPanel("context");
    closeCard();
  }, [doc.id, focus.text]);
  /** The tool panel on the whole book's briefing, with the map on the node or the text on the item. */
  const openWhole = useCallback(
    (m: BriefingMatch) => {
      setPanelFocus(null);
      const first = m.items[0];
      revealInPanel({ docId: doc.id, entity: m.entity?.id, item: first && { kind: first.kind, index: first.index } });
      openToolPanel("context");
      closeCard();
    },
    [doc.id],
  );

  const loadError = status.error ?? focused.error ?? whole.error;
  if (loadError)
    return (
      <LoadProblem error={loadError} onRetry={() => void Promise.all([status.refetch(), focused.refetch(), whole.refetch()])} />
    );
  const finished = run.data?.status === "done";
  if (!status.data || focused.isPending || whole.isPending || (finished && !focused.data?.briefing)) return <Skeleton />;

  const briefing = focused.data?.briefing ?? null;
  if (briefing) return <FocusedView briefing={briefing} onOpen={openFocused} />;

  const running = start.isPending || (Boolean(activeRunId) && run.data?.status !== "done" && run.data?.status !== "failed");
  if (running) {
    return (
      <>
        <Body>
          <Title>{focus.text}</Title>
          <div role="status" aria-live="polite" className="pt-1">
            <div className="relative h-0.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div className="context-progress absolute inset-y-0 w-1/3 rounded-full bg-accent" />
            </div>
            <p className="mt-3 font-sans text-[14px] leading-5 font-medium">{STAGE_TEXT[run.data?.stage ?? "queued"]}</p>
            <p className="mt-1 font-sans text-[13px] leading-[18px] text-fg-2">
              You can close this; it will be here when it's done.
            </p>
          </div>
        </Body>
        <Footer>
          <OpenLink onClick={openFocused} />
        </Footer>
      </>
    );
  }

  if (run.data?.status === "failed") {
    return (
      <Body>
        <Title>{focus.text}</Title>
        <p role="alert" className="font-sans text-[13.5px] leading-5 text-error">
          <span className="font-semibold">The briefing stopped.</span> {run.data.error}
        </p>
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setRunId(undefined);
              make();
            }}
          >
            Try again
          </Button>
        </div>
      </Body>
    );
  }

  const startError =
    start.error instanceof ApiError ? start.error : start.error ? new ApiError("error", String(start.error)) : null;
  const needsKey = !status.data.ready || startError?.code === ErrorCodes.notConfigured;
  const phone = status.data.phone;
  const none = phone !== null && phone.left <= 0;
  const problem = startError && startError.code !== ErrorCodes.notConfigured && <StartProblem error={startError} />;
  const costLine = (
    <Meta>
      It takes a minute or so and uses the API key on your computer, usually {FOCUS_COST}. {phoneRunsLine(phone)}
    </Meta>
  );

  const book = whole.data?.briefing ?? null;
  const match = book ? findInBriefing(book, focus.text) : null;
  if (book && match) {
    return (
      <>
        <MatchView briefing={book} match={match} text={focus.text}>
          {problem}
          {!needsKey && (
            <div className="flex flex-col gap-2 border-t border-detail pt-3">
              <div>
                <Button size="sm" variant="secondary" disabled={none || start.isPending} onClick={make}>
                  Go deeper on “{focus.text}”
                </Button>
              </div>
              {costLine}
            </div>
          )}
        </MatchView>
        <Footer>
          <OpenLink onClick={() => openWhole(match)} />
        </Footer>
      </>
    );
  }

  if (needsKey) {
    return (
      <>
        <Body>
          <Title>{focus.text}</Title>
          <p className="font-sans text-[13.5px] leading-5">Context needs an API key on the computer.</p>
        </Body>
        <Footer>
          <OpenLink onClick={openFocused} label="Open in Context for the steps" />
        </Footer>
      </>
    );
  }

  return (
    <Body>
      <Title>{focus.text}</Title>
      <p className="font-serif text-[14.5px] leading-[1.5]">
        A short briefing on how {focus.text} bears on this book and its author, with a small map. Every claim links to a source
        Pager checked.
      </p>
      {problem}
      <div>
        <Button variant="primary" icon={BookOpen} disabled={none || start.isPending} onClick={make}>
          Make a briefing on “{focus.text}”
        </Button>
      </div>
      {costLine}
    </Body>
  );
}

/** A focused briefing, compact: who or what it is, then how it bears on the book. The panel has the rest. */
function FocusedView({ briefing, onOpen }: { briefing: ContextBriefing; onOpen: () => void }) {
  const sections = orderedSections(briefing);
  const overview = sections.find((s) => s.kind === "overview")?.items[0];
  const conversation = sections.find((s) => s.kind === "conversation")?.items ?? [];
  const e = entityById(briefing, "focus");
  const author = entityById(briefing, "author")?.name ?? "The author";
  const meta = e ? [KIND_LABELS[e.kind], entityDates(e)].filter(Boolean).join(" · ") : null;
  return (
    <>
      <Body>
        <div>
          <Title>{focusName(briefing)}</Title>
          {meta && <Meta>{meta}</Meta>}
          {e?.facts?.description && <Meta>{e.facts.description}</Meta>}
        </div>
        {briefing.littleKnown && (
          <p className="rounded-sm bg-surface-2 px-3 py-2 font-sans text-[13px] leading-[18px]">
            Not much is known about {focusName(briefing)} in connection with this book.
          </p>
        )}
        {overview && (
          <Spoiled spoiler={overview.spoiler}>
            {overview.claims.map((c, i) => (
              <Claim key={i} claim={c} size="sm" />
            ))}
          </Spoiled>
        )}
        {conversation.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="font-sans text-[11.5px] leading-4 font-semibold tracking-wide text-fg-2 uppercase">
              {sectionTitle("conversation", briefing)}
            </p>
            {conversation.map((item, i) => (
              <div key={i} className="flex flex-col gap-1">
                {relationLine(briefing, item, author) && <Meta>{relationLine(briefing, item, author)}</Meta>}
                <p className="font-sans text-[13.5px] leading-5 font-semibold">{item.heading}</p>
                {item.claims[0] && (
                  <Spoiled spoiler={item.spoiler}>
                    <Claim claim={item.claims[0]} size="sm" />
                  </Spoiled>
                )}
              </div>
            ))}
          </div>
        )}
      </Body>
      <Footer>
        <OpenLink onClick={onOpen} />
      </Footer>
    </>
  );
}

/** What the whole book's briefing already says about the name: free, no run. */
function MatchView({
  briefing,
  match,
  text,
  children,
}: {
  briefing: ContextBriefing;
  match: BriefingMatch;
  /** The selection, to pick the claim that names it. */
  text: string;
  children?: ReactNode;
}) {
  const e = match.entity;
  const first = match.items[0];
  const title = e?.name ?? first?.item.heading ?? "";
  const meta = e
    ? [KIND_LABELS[e.kind], entityDates(e)].filter(Boolean).join(" · ")
    : first && sectionTitle(first.kind, briefing);
  const shown = matchClaim(briefing, match, text);
  return (
    <Body>
      <div>
        <p className="pb-1 font-sans text-[11.5px] leading-4 font-semibold tracking-wide text-fg-3 uppercase">
          From this book's briefing
        </p>
        <Title>{title}</Title>
        {meta && <Meta>{meta}</Meta>}
        {e?.facts?.description && <Meta>{e.facts.description}</Meta>}
      </div>
      {shown?.link ? (
        <LinkClaim briefing={briefing} link={shown.link} />
      ) : shown ? (
        <Spoiled spoiler={shown.spoiler}>
          <Claim claim={shown.claim} size="sm" />
        </Spoiled>
      ) : null}
      {children}
    </Body>
  );
}

function Spoiled({ spoiler, children }: { spoiler: boolean; children: ReactNode }) {
  const body = <div className="flex flex-col gap-3">{children}</div>;
  return spoiler ? <SpoilerFold>{body}</SpoilerFold> : body;
}

function Body({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pt-0.5 pb-4">{children}</div>;
}

function Title({ children }: { children: ReactNode }) {
  return <h3 className="font-display text-[18px] leading-6 font-semibold">{children}</h3>;
}

function Meta({ children }: { children: ReactNode }) {
  return <p className="font-sans text-[12.5px] leading-[18px] text-fg-2">{children}</p>;
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 border-t border-detail px-2">{children}</div>;
}

function OpenLink({ onClick, label = "Open in Context" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-11 items-center gap-1 rounded-sm px-2 font-sans text-[13px] leading-4 font-semibold text-accent transition-hover hover:text-accent-hover"
    >
      {label}
      <ArrowRight size={14} strokeWidth={2} aria-hidden />
    </button>
  );
}

function StartProblem({ error }: { error: ApiError }) {
  const calm = error.code === ErrorCodes.limitReached;
  const text =
    error.code === ErrorCodes.unavailable
      ? "Can't reach the reading service. Check that Pager is running on the computer, then try again."
      : error.message;
  return (
    <p
      role={calm ? "status" : "alert"}
      className={cx(
        "rounded-sm px-3 py-2 font-sans text-[13px] leading-[18px]",
        calm ? "bg-surface-2 text-fg" : "text-error shadow-[inset_0_0_0_1px_var(--detail)]",
      )}
    >
      {text}
    </p>
  );
}

function LoadProblem({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const code = error instanceof ApiError ? error.code : null;
  if (code === ErrorCodes.unsupported) {
    return (
      <Body>
        <Title>Context needs Pager on your computer</Title>
        <Meta>{(error as ApiError).message}</Meta>
      </Body>
    );
  }
  return (
    <Body>
      <p role="alert" className="font-sans text-[13.5px] leading-5 text-error">
        {code === ErrorCodes.unavailable
          ? "Can't reach the reading service. Check that Pager is running on the computer, then try again."
          : error instanceof Error
            ? error.message
            : "Something went wrong."}
      </p>
      <div>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </Body>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-2 px-4 pt-1 pb-4" role="status" aria-label="Loading">
      {[55, 100, 92, 64].map((w) => (
        <div key={w} className="skeleton h-3.5" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}
