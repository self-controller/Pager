import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CloudOff, FileQuestion, Link2 } from "lucide-react";
import { api } from "@/api";
import { queryKeys, useDocument, useSaveProgress, useSection } from "@/api/hooks";
import { ApiError, ErrorCodes, type ProgressUpdate, type Section } from "@/api/types";
import { AnnotationEditors } from "@/components/reader/AnnotationEditors";
import { BackPill } from "@/components/reader/BackPill";
import { forgetSpot, rememberSpot, spotFor } from "@/components/reader/chapterSpots";
import { FootnotePopover, useFootnotes } from "@/components/reader/FootnotePopover";
import { PagedView } from "@/components/reader/PagedView";
import { CompactReadout, PageFooter, ProgressLine } from "@/components/reader/PageFooter";
import { usePageDwell, useSectionWords } from "@/components/reader/readingSpeed";
import { ReaderBody, ReaderBodySkeleton, type InternalTarget } from "@/components/reader/ReaderBody";
import { ReaderTopBar } from "@/components/reader/ReaderTopBar";
import { ScrollView, type PaneRole } from "@/components/reader/ScrollView";
import { SelectionMenu } from "@/components/reader/SelectionMenu";
import { TitlePage } from "@/components/reader/TitlePage";
import { sectionHref, TocDrawer } from "@/components/reader/TocDrawer";
import { ToolPanel } from "@/components/reader/ToolPanel";
import { moveInside } from "@/components/reader/trail";
import { useJumpHistory } from "@/components/reader/useJumpHistory";
import type { ReaderLayout } from "@/components/reader/layout";
import { KEY_LINE_PX, pageStep } from "@/components/reader/pagination";
import { useChapterScroll } from "@/components/reader/useChapterScroll";
import { usePagination } from "@/components/reader/usePagination";
import { useNativeMenu } from "@/components/reader/useNativeMenu";
import { useReaderAnnotations } from "@/components/reader/useReaderAnnotations";
import { useReaderChrome, useScrollChrome } from "@/components/reader/useReaderChrome";
import { findTarget, showTarget, useReadingProgress } from "@/components/reader/useReadingProgress";
import { useOpeningFade } from "@/components/reader/useOpeningFade";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ServiceError } from "@/components/ui/ServiceError";
import { cx } from "@/lib/cx";
import { isNativeApp } from "@/lib/native";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { canOpen, useOffline } from "@/offline";
import { updateSettings, useSettings } from "@/state/settings";
import { onToolPanelRequest, openToolPanel, useTools } from "@/tools/registry";
import { useSelection } from "@/tools/useSelection";
import type { ToolContext } from "@/tools/types";

/** Side-by-side tool panel needs room for the nav, a readable column and the panel. */
const WIDE = "(min-width: 1280px)";

function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

/**
 * How a chapter turn opens its chapter: where the reader last was in it on this device; a chapter
 * not read yet at its start going forward and at its end going back.
 */
function turnState(docId: string, sectionId: string, direction: 1 | -1): Record<string, unknown> {
  const resume = spotFor(docId, sectionId);
  return { page: direction === 1 ? 0 : "last", ...(resume !== undefined ? { resume } : {}) };
}

type Reattach = { id: string; docId: string; quote: string };
const noop = () => {};
type NavState = {
  jump?: boolean;
  page?: number | "last";
  /** The back pill's place in another chapter: opened there, on the page holding these words. */
  point?: { blockId: string; offset: number };
  /** A chapter turn: where the reader last was in that chapter on this device (null: its start). */
  resume?: { blockId: string; offset: number } | null;
  reattach?: Reattach;
  /** Opened from a tool's page (the Assistant page's "Open the book"): open the tool panel on it. */
  openTool?: string;
} | null;

export function ReaderPage() {
  const { docId, sectionId: routeSectionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { hash, state } = location;
  const navState = state as NavState;
  // A move to another place in the book: it takes the place of the visit's one history step, so one
  // Back from outside the page (the iPhone's edge swipe) leaves the book; the place left goes on the
  // trail the reader's own Back arrow follows (trail.ts).
  const hereRef = useRef(location);
  hereRef.current = location;
  const move = useCallback(
    (to: string, moveState: Record<string, unknown>) => navigate(to, moveInside(hereRef.current, to, moveState)),
    [navigate],
  );
  const qc = useQueryClient();
  const settings = useSettings();
  const wide = useMediaQuery(WIDE);
  const [tocOpen, setTocOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // The scroll layout: its live pane, the neighbours' bodies beside it, and its turn.
  const chapterScrollerRef = useRef<HTMLDivElement>(null);
  const prevBodyRef = useRef<HTMLDivElement>(null);
  const nextBodyRef = useRef<HTMLDivElement>(null);
  const turnRef = useRef<((direction: 1 | -1) => void) | null>(null);
  const scrollMode = settings.layout === "scroll";

  const docQuery = useDocument(docId);
  const doc = docQuery.data;
  const sectionId = routeSectionId ?? doc?.progress?.sectionId ?? doc?.toc[0]?.id;
  const sectionQuery = useSection(docId, sectionId);
  const section = sectionQuery.data;
  const isBook = Boolean(doc && doc.toc.length > 1);
  const hasTitlePage = section?.index === 0;
  // The scroll layout keeps both neighbours rendered, for a turn to slide in: null when there is none.
  const prevQuery = useSection(docId, scrollMode ? section?.prevId : undefined);
  const nextQuery = useSection(docId, scrollMode ? section?.nextId : undefined);
  const prevSection = section?.prevId ? prevQuery.data : null;
  const nextSection = section?.nextId ? nextQuery.data : null;

  // The side-by-side panel remembers being open; on narrow screens it is a sheet opened on demand.
  const [sheetOpen, setSheetOpen] = useState(false);
  const toolsOpen = wide ? settings.toolPanelOpen : sheetOpen;
  const setToolsOpen = useCallback(
    (open: boolean) => (wide ? updateSettings({ toolPanelOpen: open }) : setSheetOpen(open)),
    [wide],
  );
  // A tool's overlay asked for its panel ("Open in Context").
  useEffect(() => onToolPanelRequest(() => setToolsOpen(true)), [setToolsOpen]);
  // Arriving from a tool's page: the panel open on that tool, once.
  const openTool = navState?.openTool;
  useEffect(() => {
    if (!openTool) return;
    openToolPanel(openTool);
  }, [openTool]);
  const overlays = useTools().filter((t) => t.Overlay);

  // Arriving from "Couldn't find these" → Reattach: the next selection moves that highlight.
  const [reattach, setReattach] = useState<Reattach | null>(() => navState?.reattach ?? null);
  useEffect(() => {
    const next = navState?.reattach;
    if (next) setReattach(next);
  }, [navState?.reattach]);

  // Both layouts are always called; the one not shown gets no content and stays idle.
  const contentKey = section ? `${section.id}:${section.revisionId ?? ""}:${section.html.length}:${hasTitlePage}` : "";
  const typeDeps = [settings.fontOffset, settings.typeface];
  const pager = usePagination(scrollerRef, scrollMode ? "" : contentKey, typeDeps, settings.pageTurn);
  const [chrome, setChrome] = useReaderChrome(docId, scrollMode ? "scroll" : "paged");
  // Reading settings hangs from the top bar, so the bars hold while it is open.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // In the scroll layout the chrome follows the scroll; not while the reattach banner asks for a
  // selection, nor while Reading settings is open.
  const scrollChrome = useScrollChrome(setChrome, scrollMode && !reattach && !settingsOpen);
  const chapter = useChapterScroll(chapterScrollerRef, scrollMode ? contentKey : "", typeDeps, scrollChrome.onScroll);
  const layout: ReaderLayout = scrollMode ? chapter : pager;
  const pagerRef = useRef(pager);
  pagerRef.current = pager;
  const chapterRef = useRef(chapter);
  chapterRef.current = chapter;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const saveProgress = useSaveProgress(docId);
  // Each save also notes the chapter's spot on this device, for a chapter turn to come back to.
  const save = useCallback(
    (u: ProgressUpdate) => {
      // No words at the reading place: the chapter's start when at its top, else not known.
      if (docId && u.point) rememberSpot(docId, u.sectionId, u.point);
      else if (docId && u.offset <= 0.001) rememberSpot(docId, u.sectionId, null);
      else if (docId) forgetSpot(docId, u.sectionId);
      saveProgress.mutate(u);
    },
    [docId, saveProgress.mutate],
  );
  const { percent, placed } = useReadingProgress({
    section,
    sectionCount: doc?.toc.length ?? 1,
    initial: doc?.progress,
    bodyRef,
    layout,
    save,
    targetId: hash.length > 1 ? decodeURIComponent(hash.slice(1)) : undefined,
    arrivedByJump: Boolean(navState?.jump),
    initialPage: navState?.page,
    initialPoint: navState?.point,
    resumePoint: navState?.resume,
  });
  const jumps = useJumpHistory({ docId, section, layout, bodyRef, placed, move });
  const footnotes = useFootnotes({ docId, doc, section, bodyRef });

  // The footer's time estimates: the section's words, and a reading speed learned from page turns
  // (screenfuls scrolled, in the scroll layout; a new section, text, layout or page count starts the
  // timing afresh).
  const layoutKey = section && layout.version ? `${layout.kind}:${section.id}:${section.html.length}:${layout.pageCount}` : "";
  const sectionWords = useSectionWords(bodyRef, layoutKey);
  usePageDwell(layoutKey, layout.page, sectionWords / layout.pageCount);

  // The URL names the open section. After an edit to the file, an old section id resolves to the
  // section now holding its text; a bare /read/<doc> is pinned where it opened, so a place saved on
  // another device (the stream refetches the document) doesn't move the page under the reader.
  useEffect(() => {
    if (docId && section && section.id !== routeSectionId) {
      navigate(`${sectionHref(docId, section.id)}${hash}`, { replace: true, state: navState });
    }
  }, [docId, section, routeSectionId, hash, navigate, navState]);

  // Jumps inside the document: same-section targets turn to their page; other sections open at the
  // block. Each remembers where it left from, for the back pill.
  const { record } = jumps;
  const jumpTo = useCallback(
    ({ id, sectionId: targetSection }: InternalTarget) => {
      if (!docId) return;
      if (targetSection && targetSection !== section?.id) {
        record(targetSection);
        move(`${sectionHref(docId, targetSection)}#${encodeURIComponent(id)}`, { jump: true });
        return;
      }
      const target = bodyRef.current ? findTarget(bodyRef.current, id) : null;
      if (!target) return;
      if (!layoutRef.current.inView(target)) record();
      showTarget(target, layoutRef.current);
    },
    [docId, section?.id, move, record],
  );

  // Links inside the text: a note reference opens its note in place; anything else jumps.
  const { open: openNote, close: closeNote } = footnotes;
  const onInternalLink = useCallback(
    (target: InternalTarget, link: HTMLAnchorElement) => {
      if (!openNote(target, link)) jumpTo(target);
    },
    [openNote, jumpTo],
  );

  /**
   * A page forward or back; past the section's last page, the next chapter's first (and the
   * reverse). In the scroll layout, a chapter: the same slide as a drag.
   */
  const turn = useCallback(
    (direction: 1 | -1) => {
      if (!docId || !section) return;
      if (scrollMode) {
        turnRef.current?.(direction);
        return;
      }
      const p = pagerRef.current;
      if (direction === 1) {
        if (!p.next() && section.nextId) move(sectionHref(docId, section.nextId), turnState(docId, section.nextId, 1));
      } else if (!p.prev() && section.prevId) move(sectionHref(docId, section.prevId), turnState(docId, section.prevId, -1));
    },
    [docId, section, move, scrollMode],
  );

  /**
   * A chapter turn in the scroll layout has slid the neighbour in: open it, at its top going
   * forward and at its end going back, with the chrome shown while it settles (as YouVersion does).
   */
  const { hold: holdChrome } = scrollChrome;
  const landTurn = useCallback(
    (direction: 1 | -1) => {
      const target = direction === 1 ? section?.nextId : section?.prevId;
      if (!docId || !target) return;
      setChrome(true);
      holdChrome();
      move(sectionHref(docId, target), turnState(docId, target, direction));
    },
    [docId, section?.nextId, section?.prevId, setChrome, holdChrome, move],
  );

  const selection = useSelection(bodyRef, section?.id);
  const notes = useReaderAnnotations(docId, section, bodyRef, {
    peeks: scrollMode
      ? [
          { ref: prevBodyRef, sectionId: prevSection?.id, html: prevSection?.html },
          { ref: nextBodyRef, sectionId: nextSection?.id, html: nextSection?.html },
        ]
      : [],
    surfaceKey: layout.kind,
  });

  // In the iPhone app its own selection menu offers these, in place of SelectionMenu.
  useNativeMenu(bodyRef, section?.id, {
    highlight: notes.highlight,
    note: notes.startNote,
    reattach: reattach ? (sel) => notes.reattachTo(reattach, sel, () => setReattach(null)) : undefined,
  });

  // Warm both neighbours so turning across chapters is instant; in the scroll layout, theirs too, as
  // the panes beside the next chapter once it opens.
  const farNext = scrollMode ? nextSection?.nextId : undefined;
  const farPrev = scrollMode ? prevSection?.prevId : undefined;
  useEffect(() => {
    if (!docId) return;
    for (const id of [section?.nextId, section?.prevId, farNext, farPrev]) {
      if (id)
        void qc.prefetchQuery({
          queryKey: queryKeys.section(docId, id),
          queryFn: () => api.getSection(docId, id),
          staleTime: Infinity,
        });
    }
  }, [qc, docId, section?.nextId, section?.prevId, farNext, farPrev]);

  // The scroll layout shows the chrome at the top of a chapter, opening the book included.
  useEffect(() => {
    if (scrollMode && placed && chapterRef.current.atTop()) setChrome(true);
  }, [scrollMode, placed, section?.id, setChrome]);

  // Keys: arrows, Space and Page keys turn pages; Home and End go to the ends; Esc closes the tools.
  // In the scroll layout ← and → turn chapters and the rest scroll the chapter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector("dialog[open]")) return;
      if (scrollMode) {
        const c = chapterRef.current;
        switch (e.key) {
          case "ArrowRight":
          case "ArrowLeft":
            if (!e.repeat) turn(e.key === "ArrowRight" ? 1 : -1);
            break;
          case "ArrowDown":
          case "ArrowUp":
            c.scrollBy(e.key === "ArrowDown" ? KEY_LINE_PX : -KEY_LINE_PX);
            break;
          case " ":
          case "PageDown":
          case "PageUp":
            c.scrollBy((e.key === "PageUp" || (e.key === " " && e.shiftKey) ? -1 : 1) * pageStep(c.viewHeight));
            break;
          case "Home":
          case "End":
            c.scrollToEdge(e.key === "Home" ? "start" : "end");
            break;
          case "Escape":
            if (toolsOpen) setToolsOpen(false);
            return;
          default:
            return;
        }
        e.preventDefault();
        return;
      }
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
          turn(1);
          break;
        case " ":
          turn(e.shiftKey ? -1 : 1);
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
          turn(-1);
          break;
        case "Home":
          pagerRef.current.goTo(0);
          break;
        case "End":
          pagerRef.current.goTo(pagerRef.current.pageCount - 1);
          break;
        case "Escape":
          if (toolsOpen) setToolsOpen(false);
          return;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [turn, toolsOpen, setToolsOpen, scrollMode]);

  useEffect(() => {
    document.title = doc ? `${section && isBook ? `${section.title} · ` : ""}${doc.title} · Pager` : "Pager";
    return () => {
      document.title = "Pager";
    };
  }, [doc, section, isBook]);

  const context: ToolContext = useMemo(
    () => ({ doc: doc ?? null, section: section ?? null, selection, progress: doc?.progress }),
    [doc, section, selection],
  );

  const notFound =
    (docQuery.error instanceof ApiError && docQuery.error.code === ErrorCodes.notFound) ||
    (sectionQuery.error instanceof ApiError && sectionQuery.error.code === ErrorCodes.notFound);
  const failure = docQuery.error ?? sectionQuery.error;
  // The text fades in once it is at the saved place, so the page sliding in never shows it jump.
  const opening = useOpeningFade(placed || Boolean(failure));
  // In the iPhone app, with the computer out of reach: only downloaded books open.
  const copy = useOffline();
  const away = Boolean(failure) && Boolean(docId) && !canOpen(copy, docId!);
  const toolPanel = <ToolPanel context={context} onClose={() => setToolsOpen(false)} />;
  const openToc = useMemo(() => (isBook ? () => setTocOpen(true) : undefined), [isBook]);

  // One section's text in the scroll layout: the live pane's is the reader's, the neighbours' only
  // look the same (the title rule and the title page's button included, so nothing moves on a turn).
  const onTextClick = notes.onTextClick;
  const renderSection = useCallback(
    (s: Section, role: PaneRole) => {
      const live = role === "live";
      const titled = s.index === 0 && doc;
      return (
        <>
          {titled && <TitlePage doc={doc} onOpenToc={live ? openToc : openToc && noop} />}
          <ReaderBody
            bodyRef={live ? bodyRef : role === "prev" ? prevBodyRef : nextBodyRef}
            html={s.html}
            title={titled ? doc.title : ""}
            onInternalLink={live ? onInternalLink : noop}
            onTextClick={live ? onTextClick : undefined}
          />
        </>
      );
    },
    [doc, openToc, onInternalLink, onTextClick],
  );

  const peekSpot = useCallback((id: string) => (docId ? spotFor(docId, id) : undefined), [docId]);

  const pill = jumps.pill && <BackPill pill={jumps.pill} onClick={jumps.go} />;
  // What the reader is told about where they are: under the page in Pages, a line at the top in Scroll.
  const progress = {
    page: layout.page,
    pageCount: layout.pageCount,
    hasNext: Boolean(section?.nextId),
    atEnd: Boolean(section && !section.nextId),
    words: sectionWords,
    percent,
    isBook,
    wordCount: doc?.wordCount,
    estimatedMinutes: doc?.estimatedMinutes,
    chapterIndex: section?.index,
    chapterCount: doc?.toc.length,
  };
  const controlsHidden =
    !chrome || Boolean(selection) || Boolean(notes.popover) || Boolean(notes.draft) || Boolean(footnotes.note);

  return (
    <div
      className={cx("reader flex flex-col overflow-hidden", scrollMode && "relative")}
      data-opening={opening}
      // The scroll layout runs under the tab bar and the top bar, which float over it.
      style={{ height: scrollMode ? "100dvh" : "calc(100dvh - var(--size-bottom-nav-effective) - env(safe-area-inset-bottom))" }}
    >
      {scrollMode && <div className="reader-status-scrim" aria-hidden />}
      <ReaderTopBar
        doc={doc}
        chapter={isBook ? section?.title : undefined}
        percent={percent}
        onOpenToc={openToc}
        toolsOpen={toolsOpen}
        onToggleTools={() => setToolsOpen(!toolsOpen)}
        hidden={!chrome}
        overlay={scrollMode}
        compact={scrollMode ? <CompactReadout {...progress} /> : undefined}
        onSettingsOpenChange={setSettingsOpen}
      />

      {reattach && (
        <div
          role="status"
          className={cx(
            "shrink-0 border-b border-detail bg-elevated px-4 py-3",
            scrollMode && "absolute inset-x-0 top-[calc(env(safe-area-inset-top)+var(--size-top-bar))] z-20",
          )}
        >
          <div className="mx-auto flex max-w-[var(--size-reader)] items-start gap-3">
            <Link2 size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] leading-5 font-semibold">Select the words this highlight belongs to</div>
              <div className="mt-0.5 line-clamp-2 font-serif text-[14px] leading-5 text-fg-2">You marked: “{reattach.quote}”</div>
            </div>
            <Button size="sm" variant="tertiary" onClick={() => setReattach(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {scrollMode && (notFound || failure) && <div className="h-[calc(env(safe-area-inset-top)+var(--size-top-bar))] shrink-0" />}
          {notFound ? (
            <EmptyState
              icon={FileQuestion}
              title="This isn't in your library"
              action={
                <Link to="/" className={buttonClasses("secondary", "md")}>
                  Go to the library
                </Link>
              }
            >
              It may have been removed, or the file moved.
            </EmptyState>
          ) : away ? (
            <EmptyState
              icon={CloudOff}
              title="This book isn't on your iPhone"
              action={
                <Link to="/" className={buttonClasses("secondary", "md")}>
                  Go to the library
                </Link>
              }
            >
              Pager can't reach your computer right now. When it can, open the book's menu in the Library and choose Download to keep it on this iPhone.
            </EmptyState>
          ) : failure ? (
            <ServiceError
              error={failure}
              onRetry={() => {
                void docQuery.refetch();
                void sectionQuery.refetch();
              }}
            />
          ) : scrollMode ? (
            <ScrollView
              scrollerRef={chapterScrollerRef}
              layout={chapter}
              current={doc ? section : undefined}
              prev={section ? prevSection : null}
              next={section ? nextSection : null}
              renderSection={renderSection}
              spotFor={peekSpot}
              onTurn={landTurn}
              turnRef={turnRef}
              chrome={chrome}
              onChrome={setChrome}
              controlsHidden={controlsHidden}
              pill={pill}
              progress={<ProgressLine {...progress} />}
            />
          ) : (
            <>
              <PagedView scrollerRef={scrollerRef} pager={pager} onTurn={turn} chrome={chrome} onChrome={setChrome}>
                {doc && section ? (
                  <>
                    {hasTitlePage && <TitlePage doc={doc} onOpenToc={openToc} />}
                    <ReaderBody
                      bodyRef={bodyRef}
                      html={section.html}
                      title={hasTitlePage ? doc.title : ""}
                      onInternalLink={onInternalLink}
                      onTextClick={notes.onTextClick}
                    />
                  </>
                ) : (
                  <div className="pt-10">
                    <ReaderBodySkeleton />
                  </div>
                )}
              </PagedView>
              {pill && (
                // Docked on the page's bottom edge, lined up with the text column's left edge.
                <div className="relative h-0 shrink-0">
                  <div className="pointer-events-none absolute inset-x-0 bottom-0.5 z-30 flex justify-center px-[var(--reader-gutter)]">
                    <div className="flex w-full max-w-[var(--size-reader)]">{pill}</div>
                  </div>
                </div>
              )}
              <PageFooter
                {...progress}
                chapter={isBook ? section?.title : undefined}
                hasPrev={Boolean(section?.prevId)}
                onTurn={turn}
              />
            </>
          )}
        </div>

        {toolsOpen && wide && (
          <aside
            aria-label="Tools"
            className={cx(
              "h-full w-[var(--size-tool-panel)] shrink-0 border-l border-detail bg-surface",
              scrollMode && "pt-[calc(env(safe-area-inset-top)+var(--size-top-bar))]",
            )}
          >
            {toolPanel}
          </aside>
        )}
      </div>

      {!wide && (
        <Dialog open={toolsOpen} onClose={() => setToolsOpen(false)} title="Tools" placement="right" bare>
          {toolPanel}
        </Dialog>
      )}

      {doc && (
        <TocDrawer
          doc={doc}
          currentId={section?.id}
          open={tocOpen}
          onClose={() => setTocOpen(false)}
          onJump={record}
          linkOptions={(to, linkState) => moveInside(location, to, linkState)}
        />
      )}
      {/* The iPhone app shows its own menu instead (useNativeMenu): never two at once. */}
      {!notes.draft && !isNativeApp() && (
        <SelectionMenu
          selection={selection}
          context={context}
          color={notes.highlightColor}
          onHighlight={notes.highlight}
          onNote={notes.startNote}
          onReattach={reattach ? (sel) => notes.reattachTo(reattach, sel, () => setReattach(null)) : undefined}
        />
      )}
      {/* A highlight's editor and the note editor: floating cards, or a tray and a sheet on a phone. */}
      <AnnotationEditors notes={notes} bodyRef={bodyRef} sectionId={section?.id} chapter={scrollMode ? chapter : null} />
      {/* Tools' cards over the text ("Context for this"): each renders nothing until it has something to show. */}
      {overlays.map((t) => {
        const Overlay = t.Overlay!;
        return <Overlay key={t.id} context={context} />;
      })}
      {footnotes.note && (
        <FootnotePopover
          note={footnotes.note}
          onClose={closeNote}
          onGoTo={() => {
            const at = footnotes.note?.target;
            closeNote();
            if (at) jumpTo(at);
          }}
          onLink={(target) => {
            closeNote();
            jumpTo(target);
          }}
        />
      )}
    </div>
  );
}
