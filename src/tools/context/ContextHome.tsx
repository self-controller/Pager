import { useLayoutEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, BookOpen, ChevronRight, Landmark, Library, Search } from "lucide-react";
import { ApiError, ErrorCodes, type DocumentSummary } from "@/api/types";
import { useContextBriefings, useDocument, useDocuments } from "@/api/hooks";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ServiceError } from "@/components/ui/ServiceError";
import { ContextForDocument } from "./ContextPanel";
import { groupBriefings, LEVEL_LABELS, normalizeFocus, type BookBriefings } from "./model";
import { setPanelFocus } from "./store";

/**
 * Context's section of the Assistant page (Phase 4): the books with briefings, and any book's Context
 * at the page's width. The book and focus live in the address (`?doc=…&focus=…`), so Back works.
 */
export function ContextHome() {
  const [params, setParams] = useSearchParams();
  const docId = params.get("doc");
  const focus = normalizeFocus(params.get("focus") ?? "")?.text ?? null;
  const show = (doc: string | null, f?: string | null) => setParams(doc ? (f ? { doc, focus: f } : { doc }) : {});
  const [box, width] = useBoxWidth();
  return (
    <div ref={box}>
      {docId ? (
        <BookContext key={docId} docId={docId} focus={focus} show={show} wide={width >= WIDE} />
      ) : (
        <BriefingList show={show} />
      )}
    </div>
  );
}

/** From this width the page puts a graphic and its card side by side (Phase 5). */
const WIDE = 960;

/** An element's width, measured again whenever it resizes. A callback ref, so it can attach late. */
function useBoxWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setWidth(Math.round(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width];
}

type Show = (doc: string | null, focus?: string | null) => void;

/** "Charles Darwin · General, Scholar" */
function bookMeta(doc: DocumentSummary | undefined, b: BookBriefings | undefined): string {
  const levels = b?.levels.map((l) => LEVEL_LABELS[l]).join(", ");
  return [doc?.author, levels].filter(Boolean).join(" · ");
}

function BriefingList({ show }: { show: Show }) {
  const list = useContextBriefings();
  const docs = useDocuments();
  const [choosing, setChoosing] = useState(false);
  const byId = useMemo(() => new Map((docs.data ?? []).map((d) => [d.id, d])), [docs.data]);
  const books = useMemo(() => groupBriefings(list.data?.briefings ?? []), [list.data]);

  if (list.error) {
    if (list.error instanceof ApiError && list.error.code === ErrorCodes.unsupported) {
      return (
        <EmptyState icon={Landmark} title="Context needs Pager on your computer">
          {list.error.message}
        </EmptyState>
      );
    }
    return <ServiceError error={list.error} onRetry={() => void list.refetch()} />;
  }
  if (list.isPending || docs.isPending) return <ListSkeleton />;

  const chooser = (
    <ChooseBook open={choosing} docs={docs.data ?? []} onClose={() => setChoosing(false)} onPick={(id) => show(id)} />
  );
  if (books.length === 0) {
    return (
      <>
        <EmptyState
          icon={Landmark}
          title="No briefings yet"
          action={
            <Button variant="primary" icon={Library} onClick={() => setChoosing(true)}>
              Choose a book
            </Button>
          }
        >
          A briefing covers a book's historical moment, its author's situation and the conversation it joined. Make one here, or
          from Context beside the text while you read.
        </EmptyState>
        {chooser}
      </>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
        <h3 className="font-sans text-[12px] leading-4 font-semibold tracking-wide text-fg-3 uppercase">Your briefings</h3>
        <Button size="sm" variant="tertiary" icon={Library} onClick={() => setChoosing(true)}>
          Choose a book
        </Button>
      </div>
      <ul className="flex flex-col pb-2" aria-label="Books with briefings">
        {books.map((b) => {
          const doc = byId.get(b.docId);
          const meta = bookMeta(doc, b);
          return (
            <li key={b.docId} className="border-t border-detail first:border-t-0">
              <button
                type="button"
                onClick={() => show(b.docId)}
                className="flex w-full items-center gap-3 px-4 pt-3 pb-1 text-left transition-hover hover:bg-surface-hover"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[16px] leading-6 font-semibold">
                    {doc?.title ?? "A book"}
                  </span>
                  {meta && <span className="block truncate font-sans text-[13px] leading-[18px] text-fg-2">{meta}</span>}
                </span>
                <ChevronRight size={18} className="shrink-0 text-fg-3" aria-hidden />
              </button>
              {b.focuses.length > 0 ? (
                <p className="px-4 pt-1 pb-3 font-sans text-[13px] leading-[20px] text-fg-2">
                  Context for this:{" "}
                  {b.focuses.map((f, i) => (
                    <span key={f.focus}>
                      {i > 0 && <span className="text-fg-3"> · </span>}
                      <button
                        type="button"
                        onClick={() => show(b.docId, f.focus)}
                        className="font-medium text-accent hover:text-accent-hover hover:underline"
                      >
                        {f.focus}
                      </button>
                    </span>
                  ))}
                </p>
              ) : (
                <div className="pb-2" />
              )}
            </li>
          );
        })}
      </ul>
      {chooser}
    </div>
  );
}

/** One book's Context: the whole book's briefing, or with `focus` a "Context for this" one. */
function BookContext({ docId, focus, show, wide }: { docId: string; focus: string | null; show: Show; wide: boolean }) {
  const doc = useDocument(docId);
  const list = useContextBriefings();
  const navigate = useNavigate();
  const mine = useMemo(() => groupBriefings(list.data?.briefings ?? []).find((b) => b.docId === docId), [list.data, docId]);
  const others = (mine?.focuses ?? []).filter((f) => f.focus.toLowerCase() !== focus?.toLowerCase());

  const back = (
    <button
      type="button"
      onClick={() => show(null)}
      className="-ml-1.5 inline-flex h-9 items-center gap-1 rounded-sm px-1.5 font-sans text-[13px] leading-4 font-semibold text-accent transition-hover hover:text-accent-hover"
    >
      <ArrowLeft size={14} strokeWidth={2} aria-hidden />
      All briefings
    </button>
  );
  if (doc.error) {
    const missing = doc.error instanceof ApiError && doc.error.code === ErrorCodes.notFound;
    return (
      <div className="px-4 pt-2">
        {back}
        {missing ? (
          <EmptyState icon={Landmark} title="This isn't in your library" />
        ) : (
          <ServiceError error={doc.error} onRetry={() => void doc.refetch()} />
        )}
      </div>
    );
  }
  if (!doc.data) return <ListSkeleton />;
  const d = doc.data;
  const open = () => {
    // The reader's panel opens on the same view: this focused briefing, or the whole book's.
    setPanelFocus(focus ? { docId: d.id, focus } : null);
    navigate(`/read/${encodeURIComponent(d.id)}`, { state: { openTool: "context" } });
  };

  return (
    <div className="flex flex-col">
      <div className="border-b border-detail px-5 pt-2 pb-4">
        {back}
        <h3 className="mt-1 font-display text-[22px] leading-7 font-semibold">{d.title}</h3>
        {d.author && <p className="font-sans text-[13.5px] leading-5 text-fg-2">{d.author}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button size="sm" variant="secondary" icon={BookOpen} onClick={open}>
            Open the book
          </Button>
          {others.length > 0 && (
            <p className="font-sans text-[13px] leading-5 text-fg-2">
              Context for this:{" "}
              {others.map((f, i) => (
                <span key={f.focus}>
                  {i > 0 && <span className="text-fg-3"> · </span>}
                  <button
                    type="button"
                    onClick={() => show(d.id, f.focus)}
                    className="font-medium text-accent hover:text-accent-hover hover:underline"
                  >
                    {f.focus}
                  </button>
                </span>
              ))}
            </p>
          )}
        </div>
      </div>
      <ContextForDocument key={focus ?? ""} doc={d} focus={focus} onWholeBook={() => show(d.id)} bookShown wide={wide} page />
    </div>
  );
}

/** Any book in the library, by title or author. */
function ChooseBook({
  open,
  docs,
  onClose,
  onPick,
}: {
  open: boolean;
  docs: DocumentSummary[];
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = docs.filter((d) => {
      const hay = `${d.title} ${d.author ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    return hits.slice(0, 60);
  }, [docs, q]);
  return (
    <Dialog open={open} onClose={onClose} title="Choose a book">
      <div className="flex flex-col">
        <label className="relative mx-4 mt-4 mb-2 block">
          <span className="sr-only">Find a book by title or author</span>
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-2" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Title or author"
            autoComplete="off"
            className="h-10 w-full rounded-sm bg-surface pr-3 pl-9 text-[15px] shadow-[inset_0_0_0_1px_var(--detail)] placeholder:text-fg-3 focus-visible:shadow-[inset_0_0_0_1px_var(--accent),var(--focus-ring)] [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
        {shown.length === 0 ? (
          <p className="px-5 py-6 font-sans text-[14px] leading-5 text-fg-2">
            {docs.length === 0 ? "Your library is empty." : "Nothing in your library matches."}
          </p>
        ) : (
          <ul className="flex flex-col pb-3" aria-label="Books">
            {shown.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onPick(d.id);
                  }}
                  className="flex w-full flex-col px-5 py-2 text-left transition-hover hover:bg-surface-hover"
                >
                  <span className="truncate font-sans text-[14.5px] leading-5 font-medium">{d.title}</span>
                  {d.author && <span className="truncate font-sans text-[12.5px] leading-[18px] text-fg-2">{d.author}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-5 py-6" aria-busy="true" aria-label="Loading">
      <div className="h-5 w-1/2 animate-pulse rounded-xs bg-surface-2" />
      <div className="h-4 w-1/3 animate-pulse rounded-xs bg-surface-2" />
      <div className="h-5 w-2/3 animate-pulse rounded-xs bg-surface-2" />
    </div>
  );
}
