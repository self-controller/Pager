import type { RefObject } from "react";
import { ArrowDownUp, LayoutGrid, Rows3, Search, X } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { cx } from "@/lib/cx";
import type { LibrarySort, LibraryView } from "@/state/settings";

const SORTS: { value: LibrarySort; label: string }[] = [
  { value: "recent", label: "Recently read" },
  { value: "name", label: "Name" },
  { value: "added", label: "Date added" },
  { value: "progress", label: "Progress" },
];

interface Props {
  q: string;
  onQ: (value: string) => void;
  view: LibraryView;
  onView: (view: LibraryView) => void;
  sort: LibrarySort;
  onSort: (sort: LibrarySort) => void;
  searchRef: RefObject<HTMLInputElement | null>;
}

/** The search bar is always there; next to it, the view and the order. */
export function LibraryToolbar({ q, onQ, view, onView, sort, onSort, searchRef }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 pt-4 pb-3 max-md:pt-3">
      <label className="relative block min-w-[220px] flex-1">
        <span className="sr-only">Search your library</span>
        <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-2" aria-hidden />
        <input
          ref={searchRef}
          type="search"
          value={q}
          onChange={(e) => onQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && q) {
              e.preventDefault();
              onQ("");
            }
          }}
          placeholder="Search your library"
          autoComplete="off"
          className="h-10 w-full rounded-sm bg-surface pr-9 pl-9 text-[15px] shadow-[inset_0_0_0_1px_var(--detail)] placeholder:text-fg-3 focus-visible:shadow-[inset_0_0_0_1px_var(--accent),var(--focus-ring)] [&::-webkit-search-cancel-button]:hidden"
        />
        {q && (
          <IconButton
            icon={X}
            label="Clear search"
            size="sm"
            variant="quaternary"
            className="absolute top-1/2 right-1 -translate-y-1/2"
            onClick={() => onQ("")}
          />
        )}
      </label>
      <div className="flex shrink-0 items-center gap-2">
        <div role="group" aria-label="View" className="flex h-10 items-center rounded-sm p-0.5 shadow-[inset_0_0_0_1px_var(--detail)]">
          <IconButton
            icon={Rows3}
            label="Compact view"
            size="sm"
            variant="tertiary"
            aria-pressed={view === "compact"}
            onClick={() => onView("compact")}
            className={cx("size-9", view === "compact" && "bg-surface-2 text-fg")}
          />
          <IconButton
            icon={LayoutGrid}
            label="Detailed view"
            size="sm"
            variant="tertiary"
            aria-pressed={view === "detailed"}
            onClick={() => onView("detailed")}
            className={cx("size-9", view === "detailed" && "bg-surface-2 text-fg")}
          />
        </div>
        <Select label="Sort by" icon={ArrowDownUp} options={SORTS} value={sort} onChange={(e) => onSort(e.target.value as LibrarySort)} />
      </div>
    </div>
  );
}
