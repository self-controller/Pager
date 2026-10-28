import { Link } from "react-router";
import type { DocumentDetail } from "@/api/types";
import { Dialog } from "@/components/ui/Dialog";
import { cx } from "@/lib/cx";

export function sectionHref(docId: string, sectionId: string): string {
  return `/read/${encodeURIComponent(docId)}/${encodeURIComponent(sectionId)}`;
}

export function TocDrawer({
  doc,
  currentId,
  open,
  onClose,
}: {
  doc: DocumentDetail;
  currentId?: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Contents" placement="left">
      <div className="px-5 pt-4 pb-2">
        <div className="font-display text-[15px] leading-5 font-semibold">{doc.title}</div>
        {doc.author && <div className="text-[13px] leading-[18px] text-fg-2">{doc.author}</div>}
      </div>
      <ol className="flex flex-col p-2">
        {doc.toc.map((entry) => {
          const current = entry.id === currentId;
          return (
            <li key={entry.id}>
              <Link
                to={sectionHref(doc.id, entry.id)}
                state={{ jump: true }}
                onClick={onClose}
                aria-current={current ? "page" : undefined}
                className={cx(
                  "flex items-baseline gap-3 rounded-sm px-3 py-2.5 text-[15px] leading-5 transition-hover hover:bg-surface-hover",
                  current ? "bg-surface-2 font-semibold text-fg" : "font-medium text-fg-2",
                )}
                style={{ paddingLeft: 12 + entry.depth * 16 }}
              >
                <span className="w-5 shrink-0 font-byline text-[12px] tabular-nums text-fg-3">{entry.index + 1}</span>
                <span className="min-w-0 flex-1">{entry.title}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </Dialog>
  );
}
