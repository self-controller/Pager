import { useNavigate } from "react-router";
import { ALargeSmall, ArrowLeft, ListTree, PanelRight } from "lucide-react";
import type { DocumentDetail } from "@/api/types";
import { IconButton } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { Skeleton } from "@/components/ui/Skeleton";
import { cx } from "@/lib/cx";
import { markTransition } from "@/lib/pageTransition";
import { ReadingSettings } from "./ReadingSettings";

interface Props {
  doc?: DocumentDetail;
  chapter?: string;
  percent: number;
  onOpenToc?: () => void;
  toolsOpen: boolean;
  onToggleTools: () => void;
  /** Hidden with the rest of the chrome: slid away (globals.css), its space kept, and inert. */
  hidden?: boolean;
  /** Floats over the text (the scroll layout), which runs under it, instead of taking its own space. */
  overlay?: boolean;
}

/** The bar above the page: back, what is open, contents, type settings, tools, and how far along. */
export function ReaderTopBar({ doc, chapter, percent, onOpenToc, toolsOpen, onToggleTools, hidden, overlay }: Props) {
  const navigate = useNavigate();

  const goBack = () => {
    // In-app history has an idx > 0; a fresh tab opened on a reading link does not.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    // Back slides the book away (globals.css). The router runs a transition for navigate(-1) only
    // when the way in had one (a book opened from a list); otherwise the mark comes off and it cuts.
    markTransition("pop");
    if (idx > 0) navigate(-1);
    else navigate("/", { viewTransition: true });
  };

  return (
    <header
      className={cx(
        // Below the status bar on an iPhone (the app draws to the screen's top edge); hidden, it slides
        // its full height, padding included, up behind the status bar's scrim.
        "reader-top-bar border-b border-detail bg-surface pt-[env(safe-area-inset-top)]",
        overlay ? "absolute inset-x-0 top-0 z-20" : "relative z-10 shrink-0",
      )}
      inert={hidden}
    >
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
          <Popover
            title="Reading settings"
            className="w-[300px] p-4"
            // On phones a tray, so the text above it changes as the settings do.
            tray
            trigger={(props) => <IconButton icon={ALargeSmall} label="Reading settings" {...props} />}
          >
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
