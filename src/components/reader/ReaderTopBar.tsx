import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { ALargeSmall, ArrowLeft, ChevronDown, ListTree, PanelRight } from "lucide-react";
import type { DocumentDetail } from "@/api/types";
import { IconButton } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { Skeleton } from "@/components/ui/Skeleton";
import { cx } from "@/lib/cx";
import { markTransition } from "@/lib/pageTransition";
import { useIsPhone } from "@/lib/useIsPhone";
import { ReadingSettings } from "./ReadingSettings";
import { stepBack } from "./trail";

interface Props {
  doc?: DocumentDetail;
  chapter?: string;
  percent: number;
  onOpenToc?: () => void;
  toolsOpen: boolean;
  onToggleTools: () => void;
  /** Hidden with the rest of the chrome: it shrinks to a compact label at the top (globals.css), its space kept. */
  hidden?: boolean;
  /** Floats over the text (the scroll layout), which runs under it, instead of taking its own space. */
  overlay?: boolean;
  /** Shown after the compact label while the chrome is hidden (the Scroll layout's progress readout). */
  compact?: ReactNode;
  /** Told when Reading settings opens and closes: the bars hold while it hangs from them. */
  onSettingsOpenChange?: (open: boolean) => void;
}

/**
 * The bar above the page: back, what is open, contents, type settings, tools, and how far along.
 * For a book the title and chapter are one button that opens Contents; phones have no other.
 */
export function ReaderTopBar({
  doc,
  chapter,
  percent,
  onOpenToc,
  toolsOpen,
  onToggleTools,
  hidden,
  overlay,
  compact,
  onSettingsOpenChange,
}: Props) {
  const navigate = useNavigate();
  const { state } = useLocation();
  const phone = useIsPhone();
  const pill = Boolean(doc && onOpenToc && chapter);
  // What the compact label says: the chapter the pill shows, or the title when there is no pill.
  const label = pill ? chapter : doc?.title;
  // What glides up to it, for the distance it has to go (globals.css): the pill, a title with a
  // line under it, or a title alone, which sits in the middle of the bar.
  const second = chapter ?? doc?.author;
  const glides = pill ? "pill" : second ? "title" : "title-only";

  const goBack = () => {
    // Inside the book first: the chapter or place before this one, with a cut. The book's moves
    // don't add history steps (trail.ts), so the way back through them is the trail's.
    const step = stepBack(state);
    if (step) {
      navigate(step.to, { replace: true, state: step.state });
      return;
    }
    // Out of the book. In-app history has an idx > 0; a fresh tab opened on a reading link does not.
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
        // Below the status bar on an iPhone (the app draws to the screen's top edge). Hidden, it stays
        // put and becomes its compact label; the parts that leave are styled in globals.css.
        "reader-top-bar pt-[env(safe-area-inset-top)]",
        overlay ? "absolute inset-x-0 top-0 z-20" : "relative z-10 shrink-0",
      )}
      data-label={glides}
    >
      {/* The bar's ground and its edge, apart from the content so they can fade on their own. */}
      <div className="top-bar-ground absolute inset-0 border-b border-detail bg-surface">
        <div
          className="absolute bottom-[-1px] left-0 h-0.5 bg-accent transition-[width] duration-200"
          style={{ width: `${Math.round(percent * 1000) / 10}%` }}
          role="progressbar"
          aria-label="Reading progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent * 100)}
        />
      </div>
      <div className="top-bar-row relative flex h-[var(--size-top-bar)] items-center gap-2 px-2 md:px-4" inert={hidden}>
        <div className="top-bar-icons flex">
          <IconButton icon={ArrowLeft} label="Back" onClick={goBack} />
        </div>
        <div className="min-w-0 flex-1">
          {doc && pill ? (
            // A book's title block is one button: the chapter, drawn as a pill, opens Contents.
            <button
              type="button"
              aria-label={`Contents: ${chapter}`}
              aria-haspopup="dialog"
              onClick={onOpenToc}
              className="top-bar-pill-button flex min-h-11 max-w-full min-w-0 flex-col items-start justify-center gap-0.5 rounded-sm text-left"
            >
              <span className="top-bar-title block max-w-full truncate font-serif text-[15px] leading-5 font-semibold">
                {doc.title}
              </span>
              {/* Its fill is a layer of its own (globals.css), so it can fade while the name glides up. */}
              <span
                data-chapter-pill
                className="top-bar-glide flex h-6 max-w-full items-center gap-1 rounded-full pr-2 pl-2.5 text-[13px] leading-[18px] text-fg"
              >
                <span className="top-bar-label truncate">{chapter}</span>
                <ChevronDown size={12} strokeWidth={2.25} className="top-bar-chevron shrink-0" aria-hidden />
              </span>
            </button>
          ) : doc ? (
            <>
              <div className="top-bar-glide">
                <div className="top-bar-label truncate font-serif text-[15px] leading-5 font-semibold">{doc.title}</div>
              </div>
              <div className="top-bar-title truncate text-[13px] leading-[18px] text-fg-2">{second ?? ""}</div>
            </>
          ) : (
            <Skeleton className="top-bar-title h-4 w-40" />
          )}
        </div>
        <div className="top-bar-icons flex items-center gap-1">
          {/* On a phone the chapter pill is the way to Contents, and the bar has no room to spare. */}
          {onOpenToc && !phone && <IconButton icon={ListTree} label="Contents" onClick={onOpenToc} />}
          <Popover
            title="Reading settings"
            // On phones it reaches to 8px from the screen's edge and grows from the button (globals.css).
            className={phone ? "settings-pop p-4" : "w-[300px] p-4"}
            onOpenChange={onSettingsOpenChange}
            // It hangs from the bar: if the bar hides, it goes too.
            forceClosed={hidden}
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
      {/* The compact line under the status bar: what is open, and the readout. While the bars show it
          only repeats the pill, so it is hidden from screen readers and can't be reached. */}
      <div
        className="top-bar-compact absolute inset-x-0 top-[env(safe-area-inset-top)] flex h-[var(--progress-line-h)] items-center pr-4 text-[13px] leading-[18px]"
        aria-hidden={hidden ? undefined : true}
        inert={!hidden}
      >
        <div className="top-bar-compact-content flex h-full min-w-0 items-center">
          {label && <span className="min-w-0 truncate text-fg">{label}</span>}
          {compact}
        </div>
      </div>
    </header>
  );
}
