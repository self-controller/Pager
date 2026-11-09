import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "@/lib/cx";
import { IconButton } from "./Button";
import { SHEET_OUT_MS, sheetOffset, sheetRelease } from "./sheetDrag";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** "content" grows with what it holds (menus, dialogs); "tall" takes 92% of the screen (Contents, Tools). */
  size?: "content" | "tall";
  /** Hide the title row (the title is still announced); the grip stays. */
  bare?: boolean;
  id?: string;
  className?: string;
}

type Phase = "closed" | "open" | "closing";

interface SheetApi {
  /** Slides the sheet away, tells its owner it closed, then runs `then`. */
  close: (then?: () => void) => void;
}

const SheetContext = createContext<SheetApi | null>(null);

/** The sheet this is inside, to close it before doing something; null outside a sheet. */
export function useSheet(): SheetApi | null {
  return useContext(SheetContext);
}

let marks = 0;

/**
 * Marks <html> with `data-sheet-open` while `shown`: the tab bar hides (globals.css; the app hides
 * its own) and the page behind holds still. Counted, so a second sheet closing doesn't clear the
 * first one's mark.
 */
export function useSheetOpenMark(shown: boolean): void {
  useEffect(() => {
    if (!shown) return;
    marks += 1;
    document.documentElement.dataset.sheetOpen = "";
    return () => {
      marks = Math.max(0, marks - 1);
      if (marks === 0) delete document.documentElement.dataset.sheetOpen;
    };
  }, [shown]);
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A bottom sheet: a native <dialog> with showModal() (focus trapping, Esc and an inert page for
 * free) that rises from the bottom edge over the tab bar. It closes with ✕, Esc, a tap on the scrim
 * or a drag down on its grip or title row, and slides away before its owner hears it closed. Only
 * its body scrolls; the phone shape of Dialog, Popover and ContextMenu.
 */
export function Sheet({ open, onClose, title, children, size = "content", bare, id, className }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [phase, setPhaseState] = useState<Phase>("closed");
  // The phase as of now, for event handlers and timers that outlive a render.
  const phaseRef = useRef<Phase>("closed");
  const onCloseRef = useRef(onClose);
  const closing = useRef<{ notify: boolean; then?: () => void } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const finish = useCallback(() => {
    const job = closing.current;
    if (!job) return;
    closing.current = null;
    window.clearTimeout(timer.current);
    // Before close(), so the close event it fires reads as ours.
    setPhase("closed");
    const el = ref.current;
    if (el) {
      if (el.open) el.close();
      el.style.removeProperty("--sheet-y");
    }
    if (job.notify) onCloseRef.current();
    job.then?.();
  }, [setPhase]);

  /** Slides the sheet away; `notify` when the owner doesn't know yet (✕, Esc, the scrim, a drag). */
  const dismiss = useCallback(
    ({ notify, then }: { notify: boolean; then?: () => void }) => {
      if (phaseRef.current !== "open") return;
      closing.current = { notify, then };
      if (reducedMotion()) {
        finish();
        return;
      }
      setPhase("closing");
      // In case the exit never runs (a hidden tab, no animations): don't stay stuck half closed.
      timer.current = window.setTimeout(finish, SHEET_OUT_MS + 50);
    },
    [finish, setPhase],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      closing.current = null;
      window.clearTimeout(timer.current);
      el.showModal();
      setPhase("open");
      // React's autoFocus runs before the dialog is shown, so it lands nowhere; focus the first field now.
      el.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select, [data-autofocus]")?.focus();
    }
    if (!open && phaseRef.current === "open") dismiss({ notify: false });
  }, [open, dismiss, setPhase]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const shown = open || phase !== "closed";

  // Drag down on the grip or the title row. Native listeners, since React's touch handlers are
  // passive and a passive touchmove can't keep the page from scrolling. The sheet follows the finger
  // through its style, not React state. Only touches: in the iPhone app's web view CSS touch-action
  // is ignored and a scroll set from script during a touch fights the system's own, so nothing here
  // scrolls; the body scrolls natively.
  useEffect(() => {
    const el = ref.current;
    const head = headRef.current;
    if (!shown || !el || !head) return;
    let y0 = 0;
    let t0 = 0;
    let height = 0;
    let dy = 0;
    let active = false;
    const settle = () => {
      el.style.transition = "";
      el.removeEventListener("transitionend", settle);
    };
    const start = (e: TouchEvent) => {
      active = e.touches.length === 1 && phaseRef.current === "open";
      if (!active) return;
      settle();
      y0 = e.touches[0]?.clientY ?? 0;
      t0 = performance.now();
      height = el.offsetHeight;
      dy = 0;
    };
    const move = (e: TouchEvent) => {
      if (!active) return;
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      dy = touch.clientY - y0;
      el.style.transform = `translateY(${sheetOffset(dy)}px)`;
    };
    const end = () => {
      if (!active) return;
      active = false;
      if (sheetRelease(dy, performance.now() - t0, height) === "close") {
        // The exit slides on from where the finger let go.
        el.style.setProperty("--sheet-y", `${sheetOffset(dy)}px`);
        el.style.transform = "";
        dismiss({ notify: true });
        return;
      }
      if (sheetOffset(dy) > 0) {
        el.style.transition = "transform 250ms cubic-bezier(0.19, 1, 0.22, 1)";
        el.addEventListener("transitionend", settle);
      }
      el.style.transform = "";
    };
    head.addEventListener("touchstart", start, { passive: true });
    head.addEventListener("touchmove", move, { passive: false });
    head.addEventListener("touchend", end);
    head.addEventListener("touchcancel", end);
    return () => {
      head.removeEventListener("touchstart", start);
      head.removeEventListener("touchmove", move);
      head.removeEventListener("touchend", end);
      head.removeEventListener("touchcancel", end);
      settle();
      el.style.transform = "";
    };
  }, [shown, dismiss]);

  // The on-screen keyboard: the sheet rides above it (`--sheet-kb` is its bottom, globals.css).
  useEffect(() => {
    const el = ref.current;
    const vv = window.visualViewport;
    if (!shown || !el || !vv) return;
    const update = () => {
      el.style.setProperty("--sheet-kb", `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      el.style.removeProperty("--sheet-kb");
    };
  }, [shown]);

  useSheetOpenMark(phase === "open");

  const api = useMemo<SheetApi>(() => ({ close: (then) => dismiss({ notify: true, then }) }), [dismiss]);

  return (
    <dialog
      ref={ref}
      id={id}
      data-sheet=""
      data-size={size}
      data-closing={phase === "closing" ? "" : undefined}
      role="dialog"
      data-reader-overlay=""
      aria-label={title}
      data-testid="sheet"
      className={cx("sheet", className)}
      // React passes a nested dialog's close and cancel up to this one's handlers: answer only this
      // dialog's own.
      onClose={(e) => {
        if (e.target !== e.currentTarget || phaseRef.current === "closed") return;
        // Closed by something else (a form with method="dialog"): it is gone already, so no exit.
        closing.current = { notify: true };
        finish();
      }}
      onCancel={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        dismiss({ notify: true });
      }}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself, outside its content) closes it.
        if (e.target === ref.current) dismiss({ notify: true });
      }}
      onAnimationEnd={(e) => {
        // The scrim's animations end here too, on the same element: wait for the sheet's own.
        if (e.target === e.currentTarget && e.animationName === "sheet-out" && phaseRef.current === "closing") finish();
      }}
    >
      {shown && (
        <SheetContext.Provider value={api}>
          <div ref={headRef} className="shrink-0">
            <div data-sheet-grip className="flex h-7 items-center justify-center">
              <span aria-hidden className="h-[5px] w-9 rounded-full bg-fg-3/40" />
            </div>
            {!bare && (
              <div className="flex h-12 items-center justify-between gap-3 pr-2 pl-5">
                <h2 className="truncate font-display text-[17px] leading-6 font-bold">{title}</h2>
                <IconButton icon={X} label="Close" onClick={() => dismiss({ notify: true })} />
              </div>
            )}
          </div>
          <div data-sheet-body className="min-h-0 flex-1">
            {children}
          </div>
        </SheetContext.Provider>
      )}
    </dialog>
  );
}
