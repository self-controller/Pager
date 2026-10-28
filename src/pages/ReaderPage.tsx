import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FileQuestion, Link2 } from "lucide-react";
import { api } from "@/api";
import { queryKeys, useDocument, useSaveProgress, useSection } from "@/api/hooks";
import { ApiError, ErrorCodes, type ProgressUpdate } from "@/api/types";
import { AnnotationPopover, FloatingPanel, NoteEditor } from "@/components/reader/AnnotationPopover";
import { PagedView } from "@/components/reader/PagedView";
import { PageFooter } from "@/components/reader/PageFooter";
import { ReaderBody, ReaderBodySkeleton, type InternalTarget } from "@/components/reader/ReaderBody";
import { ReaderTopBar } from "@/components/reader/ReaderTopBar";
import { SelectionMenu } from "@/components/reader/SelectionMenu";
import { TitlePage } from "@/components/reader/TitlePage";
import { sectionHref, TocDrawer } from "@/components/reader/TocDrawer";
import { ToolPanel } from "@/components/reader/ToolPanel";
import { usePagination } from "@/components/reader/usePagination";
import { useReaderAnnotations } from "@/components/reader/useReaderAnnotations";
import { findTarget, showTarget, useReadingProgress } from "@/components/reader/useReadingProgress";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ServiceError } from "@/components/ui/ServiceError";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { updateSettings, useSettings } from "@/state/settings";
import { useSelection } from "@/tools/useSelection";
import type { ToolContext } from "@/tools/types";

/** Side-by-side tool panel needs room for the nav, a readable column and the panel. */
const WIDE = "(min-width: 1280px)";

function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

type Reattach = { id: string; docId: string; quote: string };
type NavState = { jump?: boolean; page?: number | "last"; reattach?: Reattach } | null;

export function ReaderPage() {
  const { docId, sectionId: routeSectionId } = useParams();
  const navigate = useNavigate();
  const { hash, state } = useLocation();
  const navState = state as NavState;
  const qc = useQueryClient();
  const settings = useSettings();
  const wide = useMediaQuery(WIDE);
  const [tocOpen, setTocOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const docQuery = useDocument(docId);
  const doc = docQuery.data;
  const sectionId = routeSectionId ?? doc?.progress?.sectionId ?? doc?.toc[0]?.id;
  const sectionQuery = useSection(docId, sectionId);
  const section = sectionQuery.data;
  const isBook = Boolean(doc && doc.toc.length > 1);
  const hasTitlePage = section?.index === 0;

  // The side-by-side panel remembers being open; on narrow screens it is a sheet opened on demand.
  const [sheetOpen, setSheetOpen] = useState(false);
  const toolsOpen = wide ? settings.toolPanelOpen : sheetOpen;
  const setToolsOpen = useCallback((open: boolean) => (wide ? updateSettings({ toolPanelOpen: open }) : setSheetOpen(open)), [wide]);

  const pager = usePagination(scrollerRef, section ? `${section.id}:${section.revisionId ?? ""}:${section.html.length}:${hasTitlePage}` : "", [
    settings.fontOffset,
    settings.typeface,
  ]);
  const pagerRef = useRef(pager);
  pagerRef.current = pager;

  const saveProgress = useSaveProgress(docId);
  const save = useCallback((u: ProgressUpdate) => saveProgress.mutate(u), [saveProgress.mutate]);
  const { percent } = useReadingProgress({
    section,
    sectionCount: doc?.toc.length ?? 1,
    initial: doc?.progress,
    bodyRef,
    pager,
    save,
    targetId: hash.length > 1 ? decodeURIComponent(hash.slice(1)) : undefined,
    arrivedByJump: Boolean(navState?.jump),
    initialPage: navState?.page,
  });

  // The URL names the open section. After an edit to the file, an old section id resolves to the
  // section now holding its text; a bare /read/<doc> is pinned where it opened, so a place saved on
  // another device (the stream refetches the document) doesn't move the page under the reader.
  useEffect(() => {
    if (docId && section && section.id !== routeSectionId) {
      navigate(`${sectionHref(docId, section.id)}${hash}`, { replace: true, state: navState });
    }
  }, [docId, section, routeSectionId, hash, navigate, navState]);

  // Links inside the text: same-section targets turn to their page; other sections open at the block.
  const onInternalLink = useCallback(
    ({ id, sectionId: targetSection }: InternalTarget) => {
      if (!docId) return;
      if (targetSection && targetSection !== section?.id) {
        navigate(`${sectionHref(docId, targetSection)}#${encodeURIComponent(id)}`, { state: { jump: true } });
        return;
      }
      const target = bodyRef.current ? findTarget(bodyRef.current, id) : null;
      if (target) showTarget(target, pagerRef.current);
    },
    [docId, section?.id, navigate],
  );

  /** A page forward or back; past the section's last page, the next chapter's first (and the reverse). */
  const turn = useCallback(
    (direction: 1 | -1) => {
      if (!docId || !section) return;
      const p = pagerRef.current;
      if (direction === 1) {
        if (!p.next() && section.nextId) navigate(sectionHref(docId, section.nextId), { state: { page: 0 } });
      } else if (!p.prev() && section.prevId) navigate(sectionHref(docId, section.prevId), { state: { page: "last" } });
    },
    [docId, section, navigate],
  );

  const selection = useSelection(bodyRef, section?.id);
  const notes = useReaderAnnotations(docId, section, bodyRef);

  // Arriving from "Couldn't find these" → Reattach: the next selection moves that highlight.
  const [reattach, setReattach] = useState<Reattach | null>(() => navState?.reattach ?? null);
  useEffect(() => {
    const next = navState?.reattach;
    if (next) setReattach(next);
  }, [navState?.reattach]);

  // Warm both neighbours so turning across chapters is instant.
  useEffect(() => {
    if (!docId) return;
    for (const id of [section?.nextId, section?.prevId]) {
      if (id) void qc.prefetchQuery({ queryKey: queryKeys.section(docId, id), queryFn: () => api.getSection(docId, id), staleTime: Infinity });
    }
  }, [qc, docId, section?.nextId, section?.prevId]);

  // Keys: arrows, Space and Page keys turn pages; Home and End go to the ends; Esc closes the tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector("dialog[open]")) return;
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
  }, [turn, toolsOpen, setToolsOpen]);

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
  const toolPanel = <ToolPanel context={context} onClose={() => setToolsOpen(false)} />;
  const openToc = isBook ? () => setTocOpen(true) : undefined;

  return (
    <div className="reader flex flex-col overflow-hidden" style={{ height: "calc(100dvh - var(--size-bottom-nav-effective) - env(safe-area-inset-bottom))" }}>
      <ReaderTopBar
        doc={doc}
        chapter={isBook ? section?.title : undefined}
        percent={percent}
        onOpenToc={openToc}
        toolsOpen={toolsOpen}
        onToggleTools={() => setToolsOpen(!toolsOpen)}
      />

      {reattach && (
        <div role="status" className="shrink-0 border-b border-detail bg-elevated px-4 py-3">
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
          ) : failure ? (
            <ServiceError
              error={failure}
              onRetry={() => {
                void docQuery.refetch();
                void sectionQuery.refetch();
              }}
            />
          ) : (
            <>
              <PagedView scrollerRef={scrollerRef} pageWidth={pager.pageWidth} pageHeight={pager.pageHeight} onTurn={turn}>
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
              <PageFooter
                chapter={isBook ? section?.title : undefined}
                page={pager.page}
                pageCount={pager.pageCount}
                hasPrev={Boolean(section?.prevId)}
                hasNext={Boolean(section?.nextId)}
                atEnd={Boolean(section && !section.nextId)}
                onTurn={turn}
              />
            </>
          )}
        </div>

        {toolsOpen && wide && (
          <aside aria-label="Tools" className="h-full w-[var(--size-tool-panel)] shrink-0 border-l border-detail bg-surface">
            {toolPanel}
          </aside>
        )}
      </div>

      {!wide && (
        <Dialog open={toolsOpen} onClose={() => setToolsOpen(false)} title="Tools" placement="right" bare>
          {toolPanel}
        </Dialog>
      )}

      {doc && <TocDrawer doc={doc} currentId={section?.id} open={tocOpen} onClose={() => setTocOpen(false)} />}
      {!notes.draft && (
        <SelectionMenu
          selection={selection}
          context={context}
          color={notes.highlightColor}
          onHighlight={notes.highlight}
          onNote={notes.startNote}
          onReattach={reattach ? (sel) => notes.reattachTo(reattach, sel, () => setReattach(null)) : undefined}
        />
      )}
      {notes.draft && (
        <FloatingPanel x={notes.draft.x} y={notes.draft.y} onClose={notes.cancelNote} label="New note">
          <blockquote className="mb-2 line-clamp-3 border-l-2 border-[var(--hl-yellow-line)] pl-2.5 font-serif text-[14px] leading-5 text-fg-2">
            {notes.draft.selection.text}
          </blockquote>
          <NoteEditor initial="" onSave={notes.saveNote} onCancel={notes.cancelNote} />
        </FloatingPanel>
      )}
      {notes.popover && (
        <AnnotationPopover
          annotation={notes.popover.annotation}
          x={notes.popover.x}
          y={notes.popover.y}
          onClose={notes.popover.onClose}
          onColor={notes.popover.onColor}
          onNote={notes.popover.onNote}
          onDelete={notes.popover.onDelete}
          onAcceptAnchor={notes.popover.onAcceptAnchor}
          onTags={notes.popover.onTags}
        />
      )}
    </div>
  );
}
