import { useNavigate } from "react-router";
import { ALargeSmall, ArrowLeft, ListTree, PanelRight } from "lucide-react";
import type { DocumentDetail } from "@/api/types";
import { IconButton } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { Skeleton } from "@/components/ui/Skeleton";
import { cx } from "@/lib/cx";
import { ReadingSettings } from "./ReadingSettings";

interface Props {
  doc?: DocumentDetail;
  chapter?: string;
  percent: number;
  onOpenToc?: () => void;
  toolsOpen: boolean;
  onToggleTools: () => void;
}

/** The bar above the page: back, what is open, contents, type settings, tools, and how far along. */
export function ReaderTopBar({ doc, chapter, percent, onOpenToc, toolsOpen, onToggleTools }: Props) {
  const navigate = useNavigate();

  const goBack = () => {
    // In-app history has an idx > 0; a fresh tab opened on a reading link does not.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/");
  };

  return (
    <header className="relative z-10 shrink-0 border-b border-detail bg-surface">
      <div className="flex h-[var(--size-top-bar)] items-center gap-2 px-2 md:px-4">
        <IconButton icon={ArrowLeft} label="Back" onClick={goBack} />
        <div className="min-w-0 flex-1">
          {doc ? (
            <>
              <div className="truncate font-serif text-[15px] leading-5 font-semibold">{doc.title}</div>
              <div className="truncate text-[13px] leading-[18px] text-fg-2">{chapter ?? doc.author ?? ""}</div>
            </>
          ) : (
            <Skeleton className="h-4 w-40" />
          )}
        </div>
        <div className="flex items-center gap-1">
          {onOpenToc && <IconButton icon={ListTree} label="Contents" onClick={onOpenToc} />}
          <Popover className="w-[300px] p-4" trigger={(props) => <IconButton icon={ALargeSmall} label="Reading settings" {...props} />}>
            <ReadingSettings />
          </Popover>
          <IconButton
            icon={PanelRight}
            label={toolsOpen ? "Hide tools" : "Show tools"}
            aria-pressed={toolsOpen}
            onClick={onToggleTools}
            className={cx(toolsOpen && "bg-surface-2")}
          />
        </div>
      </div>
      <div
        className="absolute bottom-[-1px] left-0 h-0.5 bg-accent transition-[width] duration-200"
        style={{ width: `${Math.round(percent * 1000) / 10}%` }}
        role="progressbar"
        aria-label="Reading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent * 100)}
      />
    </header>
  );
}
