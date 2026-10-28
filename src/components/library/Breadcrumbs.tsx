import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cx } from "@/lib/cx";
import { breadcrumbsFor } from "./tree";

/** "Library › Novels › Brontë": each earlier crumb goes back up. */
export function Breadcrumbs({ path, onNavigate, trailing }: { path: string; onNavigate: (path: string) => void; trailing?: ReactNode }) {
  const crumbs = [{ name: "Library", path: "" }, ...breadcrumbsFor(path)];
  return (
    <div className="flex min-h-10 items-center gap-3 px-3">
      <nav aria-label="Folder" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-hidden">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={c.path} className="flex shrink-0 items-center gap-1">
              {i > 0 && <ChevronRight size={14} className="text-fg-3" aria-hidden />}
              {last ? (
                <span aria-current="page" className={cx("font-display text-[17px] leading-6 font-semibold text-fg", i === 0 && "text-[19px]")}>
                  {c.name}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate(c.path)}
                  className="rounded-xs px-1 font-display text-[17px] leading-6 font-medium text-fg-2 transition-hover hover:text-fg"
                >
                  {c.name}
                </button>
              )}
            </span>
          );
        })}
      </nav>
      {trailing && <div className="shrink-0 font-byline text-[12px] leading-5 text-fg-2">{trailing}</div>}
    </div>
  );
}
