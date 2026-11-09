import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, BookOpen, KeyRound, Landmark, Maximize2, RefreshCw } from "lucide-react";
import {
  ApiError,
  ErrorCodes,
  type ContextBriefing,
  type ContextLevel,
  type ContextRun,
  type ContextStatus,
  type DocumentDetail,
} from "@/api/types";
import { useContextBriefing, useContextMedia, useContextRun, useContextStatus, useStartContext } from "@/api/hooks";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { ServiceError } from "@/components/ui/ServiceError";
import { cx } from "@/lib/cx";
import { updateSettings, useSettings } from "@/state/settings";
import type { ToolPanelProps } from "@/tools/types";
import { BriefingView } from "./BriefingView";
import { CardMap } from "./CardMap";
import { ConnectionMap } from "./ConnectionMap";
import {
  BOOK_COST,
  costLabel,
  FOCUS_COST,
  generatedLabel,
  LEVEL_LABELS,
  mediaIds,
  mediaSummary,
  nodeImages,
  orderedSections,
  phoneRefreshLine,
  phoneRunsLine,
  usableLinks,
  viewShows,
  viewsFor,
  VIEW_LABELS,
  type ContextView,
  type ItemRef,
} from "./model";
import { EntityDetail, RunProgress } from "./parts";
import { PlacesMap } from "./PlacesMap";
import { clearReveal, setPanelFocus, usePanelFocus, usePendingReveal } from "./store";
import { Timeline } from "./Timeline";

const LEVELS: ContextLevel[] = ["general", "student", "scholar"];

/**
 * Context: a sourced briefing on what's around the open book (prompts/book-context.md, Phase 2), or,
 * from "Context for this" (Phase 3), a focused briefing on one name or work in it.
 */
export function ContextPanel({ context }: ToolPanelProps) {
  const panelFocus = usePanelFocus();
  if (!context.doc) {
    return (
      <EmptyState icon={Landmark} title="Open a book to see its context">
        Context is a short briefing on a book's historical moment, its author's situation and the conversation it joined. Every
        claim links to a source Pager checked.
      </EmptyState>
    );
  }
  const focus = panelFocus?.docId === context.doc.id ? panelFocus.focus : null;
  return <ContextForDocument key={`${context.doc.id}:${focus ?? ""}`} doc={context.doc} focus={focus} />;
}

/**
 * The whole book's briefing, or with `focus` the briefing on that name or work in it. In the reader's
 * panel, and on the Assistant page, whose `onWholeBook` leaves a focused briefing by its own route.
 */
export function ContextForDocument({
  doc,
  focus,
  onWholeBook = () => setPanelFocus(null),
  bookShown = false,
  wide = false,
  page = false,
}: {
  doc: DocumentDetail;
  focus: string | null;
  onWholeBook?: () => void;
  /** The page already names the book above: a focused briefing's header leaves out "in <book>". */
  bookShown?: boolean;
  /**
   * The wide Assistant page (Phase 5): the graphics take the full width with the card beside them,
   * as tall as the window; the briefing's text stays a readable column.
   */
  wide?: boolean;
  /**
   * On the Assistant page, below its phone header: the map is the card map at every width, pinched to
   * zoom on a phone with the tapped card's details below it, and the view tabs stick below the header.
   */
  page?: boolean;
}) {
  const { contextLevel: level } = useSettings();
  const status = useContextStatus();
  const state = useContextBriefing(doc.id, level, focus);
  const start = useStartContext(doc.id);
  const pending = usePendingReveal();
  const [runId, setRunId] = useState<string | undefined>();
  const [view, setView] = useState<ContextView>("briefing");
  // The node tapped on a graphic.
  const [picked, setPicked] = useState<string | null>(null);
  const [reveal, setReveal] = useState<(ItemRef & { nonce: number }) | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [full, setFull] = useState<ContextView | null>(null);

  // Another level is another briefing: forget this one's run, error and tapped node.
  useEffect(() => {
    setRunId(undefined);
    setPicked(null);
    start.reset();
  }, [level]);

  const briefing = state.data?.briefing ?? null;
  // A run this panel started, or one already going on the server (from the phone, or before the app slept).
  const activeRunId = runId ?? state.data?.run?.id;
  const run = useContextRun(activeRunId);
  const running = start.isPending || (Boolean(activeRunId) && run.data?.status !== "done" && run.data?.status !== "failed");
  const failed = run.data?.status === "failed" ? run.data : null;

  const views = useMemo(() => (briefing ? viewsFor(briefing) : (["briefing"] as ContextView[])), [briefing]);
  // Pictures and Wikipedia intros: free, looked up once per briefing; without them the map keeps its shapes.
  const ids = useMemo(() => (briefing ? mediaIds(briefing) : []), [briefing]);
  const media = useContextMedia(ids).data?.media;
  const images = useMemo(
    () => (briefing ? nodeImages(briefing, media, doc.coverUrl) : undefined),
    [briefing, media, doc.coverUrl],
  );
  const windowHeight = useWindowHeight();
  const phone = usePhone();
  const safe = useSafeArea();
  const shown: ContextView = views.includes(view) ? view : "briefing";
  const onMap = useMemo(
    () => new Set(views.includes("map") && briefing ? briefing.entities.map((e) => e.id) : []),
    [views, briefing],
  );

  useEffect(() => setPicked(null), [briefing?.generatedAt]);

  const begin = (refresh: boolean) => {
    setConfirm(false);
    start.mutate({ level, refresh, focus: focus ?? undefined }, { onSuccess: (r) => setRunId(r.run?.id) });
  };
  const showOnMap = (id: string) => {
    setPicked(id);
    setView("map");
  };
  const read = (ref: ItemRef) => {
    setFull(null);
    setView("briefing");
    setReveal({ ...ref, nonce: Date.now() });
  };

  // From the card's "Open in Context" on a name the whole book's briefing covers: the node on the
  // map when there is one, else the item in the text.
  useEffect(() => {
    if (focus || !pending || pending.docId !== doc.id || !briefing) return;
    clearReveal();
    if (pending.entity && views.includes("map") && briefing.entities.some((e) => e.id === pending.entity)) {
      setPicked(pending.entity);
      setView("map");
      return;
    }
    const at = pending.item;
    const item = at && orderedSections(briefing).find((s) => s.kind === at.kind)?.items[at.index];
    if (at && item) {
      setView("briefing");
      setReveal({ kind: at.kind, index: at.index, item, nonce: pending.nonce });
    }
  }, [pending, briefing, views, focus, doc.id]);

  const loadError = status.error ?? state.error;
  if (loadError) return <LoadError error={loadError} onRetry={() => void Promise.all([status.refetch(), state.refetch()])} />;
  if (!status.data || state.isPending) return <PanelSkeleton />;

  const startError =
    start.error instanceof ApiError ? start.error : start.error ? new ApiError("error", String(start.error)) : null;
  const needsKey = !status.data.ready || startError?.code === ErrorCodes.notConfigured;

  const graphic = (v: ContextView, maxHeight?: number) =>
    briefing && v === "map" ? (
      <ConnectionMap briefing={briefing} focus={picked} onFocus={setPicked} maxHeight={maxHeight} images={images} />
    ) : briefing && v === "timeline" ? (
      <Timeline briefing={briefing} focus={picked} onFocus={setPicked} />
    ) : briefing && v === "places" ? (
      <PlacesMap briefing={briefing} focus={picked} onFocus={setPicked} maxHeight={maxHeight} />
    ) : null;
  // The tapped node's details on this graphic, if it shows there.
  const detail = (v: ContextView) => {
    if (!briefing) return null;
    const entity = picked && viewShows(briefing, v, picked) ? briefing.entities.find((e) => e.id === picked) : undefined;
    return entity ? (
      <EntityDetail
        briefing={briefing}
        id={entity.id}
        onRead={read}
        image={images?.get(entity.id)}
        summary={mediaSummary(entity, media)}
      />
    ) : null;
  };
  // Beside or below a graphic: the details, or what to do on it.
  const card = (v: ContextView) => (briefing ? (detail(v) ?? <Hint view={v} briefing={briefing} />) : null);
  // The card map, where there's room (the page, a full screen): the details float over it, or with
  // `below` (a phone) the stage shows them under it.
  const cardMap = (height: number, below = false) =>
    briefing && (
      <CardMap
        briefing={briefing}
        focus={picked}
        onFocus={setPicked}
        height={height}
        images={images}
        detail={below ? null : detail("map")}
      />
    );

  return (
    <div className="flex min-h-full flex-col">
      {focus && <FocusHeader focus={focus} doc={bookShown ? null : doc} onWholeBook={onWholeBook} />}
      {views.length > 1 && (
        <div
          className={cx(
            "sticky z-10 border-b border-detail bg-surface px-3 py-2",
            page ? "top-[var(--size-phone-header)] md:top-0" : "top-0",
          )}
        >
          <div className={cx(wide && "max-w-[560px]")}>
            <SegmentedTabs
              label="Context view"
              stretch
              value={shown}
              onChange={setView}
              options={views.map((v) => ({ value: v, label: VIEW_LABELS[v] }))}
            />
          </div>
        </div>
      )}

      {shown === "briefing" ? (
        <div className={cx(wide && "w-full max-w-[720px]")}>
          <LevelSwitcher level={level} />
          {running && <RunStatus run={run.data} fetchedAt={run.dataUpdatedAt} compact={Boolean(briefing)} />}
          {failed && !running && (
            <Notice tone="error">
              <span className="font-semibold">{briefing ? "The new briefing stopped." : "The briefing stopped."}</span>{" "}
              {failed.error}
              {!briefing && !needsKey && (
                <div className="mt-2">
                  <Button size="sm" variant="secondary" onClick={() => begin(false)}>
                    Try again
                  </Button>
                </div>
              )}
            </Notice>
          )}
          {startError && startError.code !== ErrorCodes.notConfigured && <StartProblem error={startError} />}
          {briefing ? (
            <>
              <BriefingView briefing={briefing} onMap={onMap} onShowOnMap={showOnMap} reveal={reveal} />
              <footer className="flex items-center justify-between gap-3 px-5 pt-4 pb-6">
                {/* The date and nothing more, even for an earlier version of the file (decided 2026-11-05). */}
                <span className="font-sans text-[12.5px] leading-4 text-fg-3">{generatedLabel(briefing.generatedAt)}</span>
                {status.data.ready && (
                  <Button size="sm" variant="tertiary" icon={RefreshCw} disabled={running} onClick={() => setConfirm(true)}>
                    Refresh
                  </Button>
                )}
              </footer>
            </>
          ) : needsKey ? (
            <KeySetup status={status.data} />
          ) : !running && !failed ? (
            <MakeOne level={level} focus={focus} phone={status.data.phone} onMake={() => begin(false)} />
          ) : null}
        </div>
      ) : (
        briefing &&
        ((wide || page) && shown === "map" ? (
          // The map fills the window below the sticky tabs; on a phone, also below the page's header and
          // above the tab bar, so it fits one screen, with the tapped card's details below it.
          <MapStage
            height={
              phone
                ? windowHeight - PHONE_HEADER - safe.top - TABS_HEIGHT - PHONE_TAB_BAR - safe.bottom
                : windowHeight - TABS_HEIGHT
            }
            minHeight={phone ? 320 : 420}
            scrollIn={phone}
            hint={<Hint view="map" briefing={briefing} cards />}
            map={(h) => cardMap(h, phone)}
            below={phone ? detail("map") : undefined}
            picked={picked}
            belowHeader
            onFull={() => setFull("map")}
          />
        ) : (
          <GraphicStage
            mode={wide ? "beside" : "below"}
            // Below the sticky tabs.
            maxHeight={wide ? windowHeight - 140 : undefined}
            cardHeight={windowHeight - TABS_HEIGHT - 16}
            stickyCard={wide}
            belowHeader={page}
            graphic={(h) => graphic(shown, h)}
            card={card(shown)}
            picked={picked}
            onFull={() => setFull(shown)}
          />
        ))
      )}

      <RefreshDialog
        open={confirm}
        briefing={briefing}
        phone={status.data.phone}
        onCancel={() => setConfirm(false)}
        onConfirm={() => begin(true)}
      />

      {briefing && (
        <Dialog
          open={full !== null}
          onClose={() => setFull(null)}
          title={`${full ? VIEW_LABELS[full] : ""} · ${focus ? `${focus}, in ${doc.title}` : doc.title}`}
          placement="full"
        >
          {full && (
            <FullView
              view={full}
              graphic={(h) => graphic(full, h)}
              cardMap={cardMap}
              mapDetail={detail("map")}
              card={card(full)}
              hint={<Hint view={full} briefing={briefing} cards />}
              picked={picked}
            />
          )}
        </Dialog>
      )}
    </div>
  );
}

/** "Written for: General | Student | Scholar". The same setting as in Settings. */
function LevelSwitcher({ level }: { level: ContextLevel }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-detail px-5 py-2.5">
      <span className="font-sans text-[13px] leading-5 text-fg-2">Written for</span>
      <SegmentedTabs<ContextLevel>
        label="Written for"
        value={level}
        onChange={(contextLevel) => updateSettings({ contextLevel })}
        options={LEVELS.map((l) => ({ value: l, label: LEVEL_LABELS[l] }))}
      />
    </div>
  );
}

function RunStatus({ run, fetchedAt, compact }: { run: ContextRun | undefined; fetchedAt: number; compact: boolean }) {
  return (
    <div className={cx("px-5", compact ? "border-b border-detail py-3" : "py-8")}>
      <RunProgress run={run} fetchedAt={fetchedAt} lead={compact ? "Making a new briefing: " : undefined} steps={compact ? 0 : 6}>
        {!compact && (
          <p className="mt-4 font-sans text-[13px] leading-[18px] text-fg-2">
            This takes a minute or two. You can keep reading: the briefing is made on your computer and will be here when it's
            done.
          </p>
        )}
      </RunProgress>
    </div>
  );
}

/** No briefing at this level yet: say what it is, what it costs, and offer to make one. */
function MakeOne({
  level,
  focus,
  phone,
  onMake,
}: {
  level: ContextLevel;
  /** "Context for this": a short briefing on one name or work. */
  focus: string | null;
  phone: ContextStatus["phone"];
  onMake: () => void;
}) {
  const none = phone !== null && phone.left <= 0;
  const runs = phoneRunsLine(phone);
  return (
    <div className="flex flex-col gap-4 px-5 py-6">
      {focus ? (
        <p className="font-serif text-[15px] leading-[1.55] text-fg">
          A short briefing on how {focus} bears on this book and its author, with a small map. Every claim links to a source Pager
          checked; anything it couldn't check is left out.
        </p>
      ) : (
        <div>
          <h3 className="font-display text-[19px] leading-7 font-semibold">What's around this book</h3>
          <p className="mt-1.5 font-serif text-[15px] leading-[1.55] text-fg">
            A short briefing on the book's historical moment, its author's situation and the conversation it joined, with a map of
            the people, works and places around it. Every claim links to a source Pager checked; anything it couldn't check is
            left out.
          </p>
        </div>
      )}
      <div>
        <Button variant="primary" icon={BookOpen} disabled={none} onClick={onMake}>
          {focus ? `Make a briefing on “${focus}”` : `Make a ${LEVEL_LABELS[level].toLowerCase()} briefing`}
        </Button>
      </div>
      <p className="font-sans text-[12.5px] leading-[18px] text-fg-2">
        {focus
          ? `It takes a minute or so and uses the API key on your computer, usually ${FOCUS_COST}.`
          : `It takes a minute or two and uses the API key on your computer, usually ${BOOK_COST} a briefing.`}
        {runs && ` ${runs}`}
      </p>
    </div>
  );
}

/** A focused briefing's header: back to the whole book, then what it is about. */
function FocusHeader({ focus, doc, onWholeBook }: { focus: string; doc: DocumentDetail | null; onWholeBook: () => void }) {
  return (
    <div className="border-b border-detail px-5 pt-2 pb-4">
      <button
        type="button"
        onClick={onWholeBook}
        className="-ml-1.5 inline-flex h-9 items-center gap-1 rounded-sm px-1.5 font-sans text-[13px] leading-4 font-semibold text-accent transition-hover hover:text-accent-hover"
      >
        <ArrowLeft size={14} strokeWidth={2} aria-hidden />
        The whole book
      </button>
      <h2 className="font-display text-[20px] leading-7 font-semibold">{focus}</h2>
      {doc && (
        <p className="font-sans text-[13px] leading-[18px] text-fg-2">
          in <cite className="font-serif text-[14px] text-fg-2 italic">{doc.title}</cite>
        </p>
      )}
    </div>
  );
}

/** No API key on the computer: the setup steps, and no calls. */
function KeySetup({ status }: { status: ContextStatus }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-6">
      <div className="flex items-center gap-2">
        <KeyRound size={18} className="text-fg-2" aria-hidden />
        <h3 className="font-display text-[17px] leading-6 font-semibold">Context needs an API key on the computer</h3>
      </div>
      <ol className="flex list-decimal flex-col gap-2 pl-5 font-sans text-[13.5px] leading-5 text-fg">
        <li>
          On the computer, put your Anthropic API key in <code className="font-mono text-[12.5px]">{status.keyFile}</code> as{" "}
          <code className="font-mono text-[12.5px]">{status.keyVariable}=…</code>
        </li>
        <li>
          Keep it private: <code className="font-mono text-[12.5px]">chmod 600 {status.keyFile}</code>
        </li>
        <li>Restart Pager.</li>
      </ol>
      <p className="font-sans text-[12.5px] leading-[18px] text-fg-2">
        The key stays on the computer. Pager sends the model the book's title page, preface and a few lists of names, never its
        text.
      </p>
    </div>
  );
}

function StartProblem({ error }: { error: ApiError }) {
  if (error.code === ErrorCodes.limitReached) return <Notice tone="info">{error.message}</Notice>;
  if (error.code === ErrorCodes.unavailable)
    return (
      <Notice tone="error">Can't reach the reading service. Check that Pager is running on the computer, then try again.</Notice>
    );
  return <Notice tone="error">{error.message}</Notice>;
}

function Notice({ tone, children }: { tone: "info" | "error"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "mx-5 mt-4 rounded-sm px-3 py-2.5 font-sans text-[13.5px] leading-5",
        tone === "error" ? "text-error shadow-[inset_0_0_0_1px_var(--detail)]" : "bg-surface-2 text-fg",
      )}
    >
      {children}
    </div>
  );
}

function RefreshDialog({
  open,
  briefing,
  phone,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  briefing: ContextBriefing | null;
  phone: ContextStatus["phone"];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cost = costLabel(briefing?.stats.costUsd);
  const none = phone !== null && phone.left <= 0;
  return (
    <Dialog open={open} onClose={onCancel} title="Make a new briefing?">
      <div className="flex flex-col gap-3 px-5 pt-4 pb-5 font-sans text-[14.5px] leading-[21px]">
        <p>
          Pager asks the model again and checks every source.{cost && ` The last one cost about ${cost}.`} This briefing stays
          until the new one is ready.
        </p>
        {phone && <p className="text-fg-2">{phoneRefreshLine(phone)}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="tertiary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={none} onClick={onConfirm} data-autofocus>
            Make a new one
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function Hint({ view, briefing, cards = false }: { view: ContextView; briefing: ContextBriefing; cards?: boolean }) {
  const text =
    view === "map"
      ? cards && coarsePointer()
        ? "Pinch to zoom. Tap a card for its links."
        : `Tap a ${cards ? "card" : "name"} to see how it connects to the book, with sources. ${usableLinks(briefing).length} sourced links.`
      : view === "timeline"
        ? "Dates from Wikidata. Tap a row for its sources."
        : "Places from Wikidata. Tap one for its sources.";
  return <p className="font-sans text-[12.5px] leading-[18px] text-fg-3">{text}</p>;
}

/** The window's height, kept up to date. */
function useWindowHeight(): number {
  const [height, setHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const on = () => setHeight(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return height;
}

/** Below 768 px: the phone layout, with the page's header on top and the tab bar at the bottom. */
function usePhone(): boolean {
  const query = "(max-width: 767px)";
  const [phone, setPhone] = useState(() => typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

/**
 * The safe-area insets (the iPhone's status bar and home indicator) in pixels: CSS knows them only as
 * `env()`, so a hidden probe is padded with them and measured, again on each resize (a rotation).
 */
function useSafeArea(): { top: number; bottom: number } {
  const [insets, setInsets] = useState({ top: 0, bottom: 0 });
  useEffect(() => {
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
      "padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
    document.body.appendChild(probe);
    const read = () => {
      const cs = getComputedStyle(probe);
      const top = parseFloat(cs.paddingTop) || 0;
      const bottom = parseFloat(cs.paddingBottom) || 0;
      setInsets((p) => (p.top === top && p.bottom === bottom ? p : { top, bottom }));
    };
    read();
    window.addEventListener("resize", read);
    return () => {
      window.removeEventListener("resize", read);
      probe.remove();
    };
  }, []);
  return insets;
}

/** A finger, not a mouse: the hint says to pinch. */
function coarsePointer(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The sticky tab bar's height on the Assistant page (8 px padding, the 36 px tabs, its border). */
const TABS_HEIGHT = 53;
/** The row above the card map: the hint and the full-screen button. */
const MAP_TOOLBAR = 36;
/** The phone's page header, less the status bar's inset (`--size-phone-header` is both). */
const PHONE_HEADER = 56;
/** The phone's tab bar, less the home indicator's inset (`--size-bottom-nav`). */
const PHONE_TAB_BAR = 56;

/**
 * The card map's stage (Phase 6): the hint and the full-screen button in a row above it, then the map
 * at `height` less that row. Where there's room the tapped card's details float over the map, so a tap
 * never changes the page's height or its scroll. With `below` (a phone) they show under the map
 * instead and a tap scrolls down to them, as on Timeline and Places; a drag on the map that it can't
 * follow scrolls back up. With `scrollIn` (the phone's page), opening the map scrolls the page so the
 * whole stage shows below the sticky tabs.
 */
function MapStage({
  height,
  minHeight = 420,
  scrollIn = false,
  hint,
  map,
  below,
  picked = null,
  belowHeader = false,
  onFull,
}: {
  height: number;
  minHeight?: number;
  scrollIn?: boolean;
  hint: ReactNode;
  map: (height: number) => ReactNode;
  /** The tapped card's details, shown under the map (null when nothing is tapped). */
  below?: ReactNode;
  picked?: string | null;
  /** On the Assistant page: the phone's header and tab bar are over the page too. */
  belowHeader?: boolean;
  onFull?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const belowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollIn) ref.current?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [scrollIn]);
  useEffect(() => {
    if (!picked) return;
    belowRef.current?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [picked]);
  return (
    <div ref={ref} className={cx("flex flex-col px-3 pb-2", scrollIn && "scroll-mt-[calc(var(--size-phone-header)+53px)]")}>
      <div className="flex shrink-0 items-center justify-between gap-3 px-1" style={{ height: MAP_TOOLBAR }}>
        <div className="min-w-0 truncate">{hint}</div>
        {onFull && <IconButton icon={Maximize2} label="Full screen" size="sm" onClick={onFull} />}
      </div>
      {map(Math.max(minHeight, height - MAP_TOOLBAR - 8))}
      {/* The hint is in the row above, so nothing shows here until a card is tapped. */}
      {below && picked && (
        <div ref={belowRef} className={cx("px-2 pt-4 pb-6", belowScrollMargins(belowHeader))}>
          {below}
        </div>
      )}
    </div>
  );
}

/**
 * Where a card below a graphic stops when scrolled into view: below the sticky tabs, and on the
 * Assistant page also below the phone's header and above its floating tab bar.
 */
function belowScrollMargins(belowHeader: boolean): string {
  return belowHeader
    ? "scroll-mt-[calc(var(--size-phone-header)+64px)] scroll-mb-[calc(var(--size-bottom-nav)+env(safe-area-inset-bottom)+16px)] md:scroll-mt-16 md:scroll-mb-4"
    : "scroll-mt-16 scroll-mb-4";
}

/**
 * A graphic and the card for its tapped node. `beside`: side by side, the card a 360 px column of a
 * fixed height with its own scroll (sticky below the tabs on the Assistant page), so the page's height
 * never follows the card's and a tap never moves the page. `below`: the card under the graphic,
 * scrolled into view on a tap (the reader's panel, narrow places).
 */
function GraphicStage({
  mode,
  maxHeight,
  cardHeight,
  stickyCard = false,
  belowHeader = false,
  graphic,
  card,
  picked,
  onFull,
}: {
  mode: "beside" | "below";
  maxHeight?: number;
  /** The card column's height, beside the graphic. */
  cardHeight: number;
  stickyCard?: boolean;
  /** On the Assistant page: the phone's header is over the page too. */
  belowHeader?: boolean;
  graphic: (maxHeight?: number) => ReactNode;
  card: ReactNode;
  picked: string | null;
  onFull?: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode !== "below" || !picked) return;
    cardRef.current?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [picked, mode]);
  const full = onFull && (
    <div className={cx("flex justify-end", mode === "below" && "px-2")}>
      <IconButton icon={Maximize2} label="Full screen" size="sm" onClick={onFull} />
    </div>
  );
  if (mode === "beside") {
    return (
      <div className="flex items-start gap-6 px-4 pt-2 pb-6">
        <div className="min-w-0 flex-1">
          {full}
          {graphic(maxHeight)}
        </div>
        <div
          ref={cardRef}
          className={cx("w-[360px] shrink-0 overflow-y-auto overscroll-contain pt-10 pb-4", stickyCard && "sticky top-[64px]")}
          style={{ height: cardHeight }}
        >
          {card}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col pt-2">
      {full}
      {graphic(maxHeight)}
      {/* Scrolled to below the sticky tabs (and the phone's header), above the phone's tab bar. */}
      <div ref={cardRef} className={cx("px-5 pt-4 pb-6", belowScrollMargins(belowHeader))}>
        {card}
      </div>
    </div>
  );
}

/**
 * A graphic on the whole screen: the card map at every width (pinched to zoom on a phone, its details
 * below it). From 768 px a timeline or places map beside its card; narrower, the card below.
 */
function FullView({
  view,
  graphic,
  cardMap,
  mapDetail,
  card,
  hint,
  picked,
}: {
  view: ContextView;
  graphic: (maxHeight?: number) => ReactNode;
  cardMap: (height: number, below?: boolean) => ReactNode;
  /** The tapped card's details on the map, shown under it when narrow. */
  mapDetail: ReactNode;
  card: ReactNode;
  hint: ReactNode;
  picked: string | null;
}) {
  const height = useWindowHeight();
  // The dialog pads for the status bar and the home indicator.
  const safe = useSafeArea();
  const [wide, setWide] = useState(() => window.innerWidth >= 768);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= 768);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  // Below the dialog's 56 px title bar.
  if (view === "map")
    return (
      <MapStage
        height={height - 56 - safe.top - safe.bottom}
        minHeight={wide ? 420 : 320}
        hint={hint}
        map={(h) => cardMap(h, !wide)}
        below={wide ? undefined : mapDetail}
        picked={picked}
      />
    );
  return (
    <GraphicStage
      mode={wide ? "beside" : "below"}
      maxHeight={height - 120}
      cardHeight={height - 56 - 8}
      graphic={graphic}
      card={card}
      picked={picked}
    />
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (error instanceof ApiError && error.code === ErrorCodes.unsupported) {
    return (
      <EmptyState icon={Landmark} title="Context needs Pager on your computer">
        {error.message}
      </EmptyState>
    );
  }
  if (error instanceof ApiError && error.code === ErrorCodes.notFound) {
    return <EmptyState icon={Landmark} title="This isn't in your library" />;
  }
  return <ServiceError error={error} onRetry={onRetry} />;
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-5 py-6" aria-busy="true" aria-label="Loading">
      <div className="h-5 w-1/2 animate-pulse rounded-xs bg-surface-2" />
      <div className="h-4 w-full animate-pulse rounded-xs bg-surface-2" />
      <div className="h-4 w-5/6 animate-pulse rounded-xs bg-surface-2" />
    </div>
  );
}
