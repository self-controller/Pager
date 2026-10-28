import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "@/components/ui/Button";

interface Props {
  chapter?: string;
  page: number;
  pageCount: number;
  /** Whether a previous/next chapter exists beyond this section's pages. */
  hasPrev: boolean;
  hasNext: boolean;
  atEnd: boolean;
  onTurn: (direction: 1 | -1) => void;
}

/** Page controls and "p. 4 of 17" under the page. */
export function PageFooter({ chapter, page, pageCount, hasPrev, hasNext, atEnd, onTurn }: Props) {
  const first = page === 0 && !hasPrev;
  const last = page >= pageCount - 1 && !hasNext;
  return (
    <footer className="flex h-[var(--size-page-footer)] shrink-0 items-center gap-2 px-2 md:px-4" aria-label="Pages">
      <IconButton icon={ChevronLeft} label="Previous page" size="sm" variant="quaternary" disabled={first} onClick={() => onTurn(-1)} />
      <div className="flex min-w-0 flex-1 items-center justify-center gap-3 font-byline text-[12px] leading-4 text-fg-2">
        {chapter && <span className="hidden min-w-0 truncate md:block">{chapter}</span>}
        {chapter && <span className="hidden text-fg-3 md:block">·</span>}
        <span className="shrink-0 tabular-nums" aria-live="polite">
          {atEnd && last ? "The end" : `p. ${page + 1} of ${pageCount}`}
        </span>
      </div>
      <IconButton icon={ChevronRight} label="Next page" size="sm" variant="quaternary" disabled={last} onClick={() => onTurn(1)} />
    </footer>
  );
}
