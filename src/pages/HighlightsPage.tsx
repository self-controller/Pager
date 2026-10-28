import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Highlighter, Search, Trash2, X } from "lucide-react";
import { useDeleteAnnotation, useDocument, useHighlights, useRestoreAnnotation, useTags } from "@/api/hooks";
import type { HighlightColor, LibraryAnnotation } from "@/api/types";
import { ServiceError } from "@/components/ui/ServiceError";
import { CenterColumn, PageHeader, SectionHeading } from "@/components/shell/Page";
import { Button, IconButton } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SourceIcon } from "@/components/ui/Tiles";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/lib/cx";
import { formatShortDate } from "@/lib/format";

const RULE: Record<HighlightColor, string> = {
  yellow: "var(--hl-yellow-line)",
  green: "var(--hl-green-line)",
  blue: "var(--hl-blue-line)",
  pink: "var(--hl-pink-line)",
  purple: "var(--hl-purple-line)",
};

const meta = "font-byline text-[12px] leading-5 font-medium tracking-[0.02em] uppercase";

function HighlightRow({ item }: { item: LibraryAnnotation }) {
  const remove = useDeleteAnnotation();
  const restore = useRestoreAnnotation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const orphaned = item.anchor.status === "orphaned";
  const quote = orphaned ? item.anchor.originalQuote : item.anchor.quote;

  return (
    <article className="relative border-b border-detail px-5 py-4 transition-hover hover:bg-surface-hover max-md:px-4">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <SourceIcon name={item.docTitle} id={item.docId} size={20} />
          <span className={cx(meta, "truncate text-[13px] text-fg")}>{item.docTitle}</span>
        </div>
        <time dateTime={item.createdAt} className="shrink-0 font-byline text-[12px] leading-5 text-fg-2">
          {formatShortDate(item.createdAt)}
        </time>
      </div>

      <blockquote
        className="mt-3 border-l-[3px] pl-3 font-serif text-[17px] leading-[27px] text-fg"
        style={{ borderColor: RULE[item.color ?? "yellow"] }}
      >
        {orphaned ? (
          <span className="line-clamp-6">{quote}</span>
        ) : (
          <Link to={item.href} state={{ jump: true }} className="stretched-link line-clamp-6">
            {quote}
          </Link>
        )}
      </blockquote>
      {item.body && <p className="mt-2.5 text-[15px] leading-[22px] whitespace-pre-wrap text-fg">{item.body}</p>}

      <div className="mt-2 flex items-center gap-2">
        <span className={cx(meta, "min-w-0 flex-1 truncate text-fg-2")}>
          {[
            item.sectionTitle !== item.docTitle ? item.sectionTitle : null,
            item.anchor.status === "fuzzy" ? "Text changed slightly" : null,
            orphaned ? "Not found in the current file" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {orphaned && (
          <Button
            size="sm"
            variant="secondary-outline"
            className="relative z-[1]"
            onClick={() =>
              navigate(item.href, { state: { reattach: { id: item.id, docId: item.docId, quote: item.anchor.originalQuote } } })
            }
          >
            Reattach
          </Button>
        )}
        <IconButton
          icon={Trash2}
          label="Remove"
          size="sm"
          variant="quaternary"
          className="relative z-[1]"
          onClick={() =>
            remove.mutate(
              { id: item.id, docId: item.docId },
              {
                onSuccess: () =>
                  toast({
                    message: item.body ? "Note removed" : "Highlight removed",
                    action: { label: "Undo", onClick: () => restore.mutate({ id: item.id, docId: item.docId }) },
                  }),
              },
            )
          }
        />
      </div>
    </article>
  );
}

/** Every highlight and note across the library, newest first. */
export function HighlightsPage() {
  const [params, setParams] = useSearchParams();
  const docId = params.get("doc") ?? undefined;
  const tag = params.get("tag") ?? undefined;
  const [q, setQ] = useState(params.get("q") ?? "");
  const [query, setQuery] = useState(q);

  // Debounce typing; keep the URL shareable.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const value = q.trim();
      setQuery(value);
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set("q", value);
          else next.delete("q");
          return next;
        },
        { replace: true },
      );
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, setParams]);

  const highlights = useHighlights({ ...(query ? { q: query } : {}), ...(docId ? { docId } : {}), ...(tag ? { tag } : {}) });
  const tags = useTags();
  const doc = useDocument(docId);

  const clear = (key: string) => {
    const next = new URLSearchParams(params);
    next.delete(key);
    setParams(next, { replace: true });
  };

  const list = highlights.data ?? [];
  const live = list.filter((a) => a.anchor.status !== "orphaned");
  const orphans = list.filter((a) => a.anchor.status === "orphaned");
  const filtered = Boolean(query || docId || tag);

  return (
    <CenterColumn className="pb-10">
      <PageHeader title="Highlights" />

      <div className="flex flex-col gap-3 px-3 pt-3 pb-2">
        <label className="relative block">
          <span className="sr-only">Search highlights and notes</span>
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-2" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search highlights and notes"
            className="h-10 w-full rounded-sm bg-surface pr-3 pl-9 text-[15px] shadow-[inset_0_0_0_1px_var(--detail)] placeholder:text-fg-3 focus-visible:shadow-[inset_0_0_0_1px_var(--accent),var(--focus-ring)]"
          />
        </label>
        {(docId || tag || (tags.data?.length ?? 0) > 0) && (
          <div className="flex flex-wrap gap-2">
            {docId && (
              <span className="inline-flex h-8 items-center gap-1 rounded-full bg-surface-2 pr-1 pl-3 text-[13px] font-medium">
                From {doc.data?.title ?? "one document"}
                <IconButton icon={X} label="All documents" size="sm" className="size-6" onClick={() => clear("doc")} />
              </span>
            )}
            {tags.data?.map((t) => (
              <button
                key={t.tag}
                type="button"
                aria-pressed={tag === t.tag}
                onClick={() => {
                  const next = new URLSearchParams(params);
                  if (tag === t.tag) next.delete("tag");
                  else next.set("tag", t.tag);
                  setParams(next, { replace: true });
                }}
                className={cx(
                  "h-8 rounded-full px-3 text-[13px] font-medium transition-hover",
                  tag === t.tag ? "bg-fg text-surface" : "bg-surface-2 text-fg hover:bg-surface-3",
                )}
              >
                #{t.tag} <span className="opacity-60">{t.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {highlights.isPending ? (
        <div role="status" aria-label="Loading" className="flex flex-col gap-4 px-5 py-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="skeleton h-4 w-40" />
              <div className="skeleton h-14 w-full" />
            </div>
          ))}
        </div>
      ) : highlights.error ? (
        <ServiceError error={highlights.error} onRetry={() => void highlights.refetch()} />
      ) : list.length === 0 ? (
        filtered ? (
          <EmptyState icon={Search} title="Nothing matches">
            {query ? `No highlights or notes contain “${query}”.` : "No highlights here yet."}
          </EmptyState>
        ) : (
          <EmptyState icon={Highlighter} title="No highlights yet">
            Select a passage while reading and choose Highlight or Note. They collect here, with a link back to where you found
            them.
          </EmptyState>
        )
      ) : (
        <>
          {live.map((item) => (
            <HighlightRow key={item.id} item={item} />
          ))}
          {orphans.length > 0 && (
            <>
              <SectionHeading>Couldn't find these</SectionHeading>
              <p className="px-3 pb-2 text-[14px] leading-5 text-fg-2">
                The words around these changed in the file. They are kept as you marked them and reattach by themselves if the
                text comes back, or choose Reattach and select the right words.
              </p>
              {orphans.map((item) => (
                <HighlightRow key={item.id} item={item} />
              ))}
            </>
          )}
        </>
      )}
    </CenterColumn>
  );
}
