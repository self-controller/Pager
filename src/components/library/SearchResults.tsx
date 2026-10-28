import { useState } from "react";
import { Link } from "react-router";
import { ChevronRight, Search } from "lucide-react";
import type { DocumentSearchResult, SearchHit } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ServiceError } from "@/components/ui/ServiceError";
import { Cover } from "@/components/ui/Tiles";
import { hitHref, readHref } from "@/lib/links";
import { ProgressBar } from "./ProgressBar";
import { parentOf, progressOf, splitRanges } from "./tree";

function Snippet({ hit }: { hit: SearchHit }) {
  return (
    <Link
      to={hitHref(hit)}
      state={{ jump: true }}
      className="flex items-start gap-2 rounded-sm px-3 py-2 font-serif text-[15px] leading-[22px] text-fg-2 transition-hover hover:bg-surface-hover hover:text-fg"
    >
      <ChevronRight size={14} className="mt-1 shrink-0 text-fg-3" aria-hidden />
      <span className="line-clamp-3">
        {splitRanges(hit.snippet, hit.ranges).map((run, i) =>
          run.hit ? (
            <mark key={i} className="rounded-xs bg-accent-bg px-0.5 font-semibold text-fg">
              {run.text}
            </mark>
          ) : (
            <span key={i}>{run.text}</span>
          ),
        )}
      </span>
    </Link>
  );
}

const MATCH_LABEL: Record<DocumentSearchResult["matched"][number], string> = {
  title: "Title matches",
  author: "Author matches",
  fileName: "File name matches",
};

function Group({ result }: { result: DocumentSearchResult }) {
  const [expanded, setExpanded] = useState(false);
  const { doc, hits, totalHits, matched } = result;
  const { percent, label } = progressOf(doc);
  const shown = expanded ? hits : hits.slice(0, 3);
  const folder = doc.relPath ? parentOf(doc.relPath) : "";
  return (
    <section className="border-b border-detail py-3">
      <Link to={readHref(doc)} className="flex items-center gap-3 rounded-sm px-3 py-2 transition-hover hover:bg-surface-hover">
        <Cover title={doc.title} author={doc.author} id={doc.id} coverUrl={doc.coverUrl} className="h-14 w-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-serif text-[17px] leading-6 font-semibold text-fg">{doc.title}</div>
          <div className="truncate text-[13px] leading-[18px] text-fg-2">
            {[doc.author, folder ? folder.replace(/\//g, " › ") : "Library"].filter(Boolean).join(" · ")}
          </div>
          <ProgressBar percent={percent} label={label} className="mt-1.5 max-w-[240px]" />
        </div>
        <div className="shrink-0 text-right font-byline text-[12px] leading-4 text-fg-2">
          {matched.map((m) => (
            <div key={m}>{MATCH_LABEL[m]}</div>
          ))}
          {totalHits > 0 && <div>{totalHits === 1 ? "1 passage" : `${totalHits} passages`}</div>}
        </div>
      </Link>
      {shown.length > 0 && (
        <div className="mt-1 flex flex-col pl-12">
          {shown.map((h, i) => (
            <Snippet key={`${h.sectionId}-${h.blockId}-${i}`} hit={h} />
          ))}
          {hits.length > 3 && !expanded && (
            <Button size="sm" variant="quaternary" className="self-start" onClick={() => setExpanded(true)}>
              Show {hits.length - 3} more
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

interface Props {
  q: string;
  results: DocumentSearchResult[] | undefined;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
}

/** Search across every file: one group per document, best passages underneath. */
export function SearchResults({ q, results, isPending, error, onRetry }: Props) {
  if (q.trim().length < 2) {
    return (
      <EmptyState icon={Search} title="Keep typing">
        Two characters or more search titles, authors and every page of every file.
      </EmptyState>
    );
  }
  if (error) return <ServiceError error={error} onRetry={onRetry} />;
  if (isPending && !results) {
    return (
      <div role="status" aria-label="Searching" className="flex flex-col gap-4 px-3 py-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="skeleton h-14 w-10" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="skeleton h-4 w-1/2" />
              <div className="skeleton h-3 w-1/3" />
              <div className="skeleton h-3 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (!results?.length) {
    return (
      <EmptyState icon={Search} title="Nothing matches">
        No title, author or passage in your files contains “{q.trim()}”.
      </EmptyState>
    );
  }
  return (
    <div className="pb-10">
      <p className="px-3 pt-1 pb-2 font-byline text-[12px] leading-5 text-fg-2">
        {results.length === 1 ? "1 document" : `${results.length} documents`} match “{q.trim()}”
      </p>
      {results.map((r) => (
        <Group key={r.doc.id} result={r} />
      ))}
    </div>
  );
}
