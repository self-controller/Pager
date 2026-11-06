import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { useContextBriefing, useContextRun, useContextStatus, useStartContext } from "@/api/hooks";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { ServiceError } from "@/components/ui/ServiceError";
import { cx } from "@/lib/cx";
import { updateSettings, useSettings } from "@/state/settings";
import type { ToolPanelProps } from "@/tools/types";
import { BriefingView } from "./BriefingView";
import { ConnectionMap } from "./ConnectionMap";
import {
  BOOK_COST,
  costLabel,
  FOCUS_COST,
  generatedLabel,
  LEVEL_LABELS,
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
}: {
  doc: DocumentDetail;
  focus: string | null;
  onWholeBook?: () => void;
  /** The page already names the book above: a focused briefing's header leaves out "in <book>". */
  bookShown?: boolean;
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
      <ConnectionMap briefing={briefing} focus={picked} onFocus={setPicked} maxHeight={maxHeight} />
    ) : briefing && v === "timeline" ? (
      <Timeline briefing={briefing} focus={picked} onFocus={setPicked} />
    ) : briefing && v === "places" ? (
      <PlacesMap briefing={briefing} focus={picked} onFocus={setPicked} maxHeight={maxHeight} />
    ) : null;

  return (
    <div className="flex min-h-full flex-col">
      {focus && <FocusHeader focus={focus} doc={bookShown ? null : doc} onWholeBook={onWholeBook} />}
      {views.length > 1 && (
        <div className="sticky top-0 z-10 border-b border-detail bg-surface px-3 py-2">
          <SegmentedTabs
            label="Context view"
            stretch
            value={shown}
            onChange={setView}
            options={views.map((v) => ({ value: v, label: VIEW_LABELS[v] }))}
          />
        </div>
      )}

      {shown === "briefing" ? (
        <>
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
        </>
      ) : (
        briefing && (
          <div className="flex flex-col pt-2">
            <div className="flex justify-end px-2">
              <IconButton icon={Maximize2} label="Full screen" size="sm" onClick={() => setFull(shown)} />
            </div>
            {graphic(shown)}
            <div className="px-5 pt-4 pb-6">
              {picked && viewShows(briefing, shown, picked) ? (
                <EntityDetail briefing={briefing} id={picked} onRead={read} />
              ) : (
                <Hint view={shown} briefing={briefing} />
              )}
            </div>
          </div>
        )
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
          {full && <FullView briefing={briefing} graphic={graphic} view={full} focus={picked} onRead={read} />}
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

function Hint({ view, briefing }: { view: ContextView; briefing: ContextBriefing }) {
  const text =
    view === "map"
      ? `Tap a name to see how it connects to the book, with sources. ${usableLinks(briefing).length} sourced links.`
      : view === "timeline"
        ? "Dates from Wikidata. Tap a row for its sources."
        : "Places from Wikidata. Tap one for its sources.";
  return <p className="font-sans text-[12.5px] leading-[18px] text-fg-3">{text}</p>;
}

/** A graphic on the whole screen: beside its details when there's room, above them when not. */
function FullView({
  briefing,
  graphic,
  view,
  focus,
  onRead,
}: {
  briefing: ContextBriefing;
  graphic: (v: ContextView, maxHeight?: number) => ReactNode;
  view: ContextView;
  focus: string | null;
  onRead: (ref: ItemRef) => void;
}) {
  const [height, setHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const on = () => setHeight(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return (
    <div className="flex flex-col gap-4 p-4 md:flex-row md:items-start">
      <div className="min-w-0 flex-1">{graphic(view, height - 120)}</div>
      <div className="md:w-[360px] md:shrink-0">
        {focus && viewShows(briefing, view, focus) ? (
          <EntityDetail briefing={briefing} id={focus} onRead={onRead} />
        ) : (
          <Hint view={view} briefing={briefing} />
        )}
      </div>
    </div>
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
