import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cx } from "@/lib/cx";
import { IconButton } from "./Button";
import { sheetExitMs, sheetOffset, sheetRelease, translateYOf, type SheetExit, type SheetSize } from "./sheetDrag";

/** A press outside a tray that lifts within this many px of where it landed closes the tray. */
const TRAY_TAP_SLOP = 15;

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** One grey line under the title: what the sheet acts on. */
  subtitle?: string;
  /** Shown in the title row, before the close button (a Save button). */
  action?: ReactNode;
  children: ReactNode;
  /** "content" grows with what it holds (menus, dialogs); "tall" takes 92% of the screen (Contents, Tools). */
  size?: SheetSize;
  /** Hide the title row (the title is still announced); the grip stays. */
  bare?: boolean;
  /**
   * False makes it a tray, for settings you watch take effect: no scrim and no title row, the page
   * behind stays live and scrolls, and a tap outside it closes it. At most 46% of the screen tall.
   */
  modal?: boolean;
  /** Also what a tray's own button names in `aria-controls`, so its press is left to its click. */
  id?: string;
  className?: string;
}

type Phase = "closed" | "open" | "closing";

interface SheetApi {
  /** Sends the sheet away, tells its owner it closed, then runs `then`. */
  close: (then?: () => void) => void;
}

const SheetContext = createContext<SheetApi | null>(null);

/** The sheet this is inside, to close it before doing something; null outside a sheet. */
export function useSheet(): SheetApi | null {
  return useContext(SheetContext);
}

type MarkKind = "modal" | "tray";

const marks: Record<MarkKind, number> = { modal: 0, tray: 0 };

function writeMark(): void {
  const data = document.documentElement.dataset;
  if (marks.modal > 0) data.sheetOpen = "";
  else if (marks.tray > 0) data.sheetOpen = "tray";
  else delete data.sheetOpen;
}

/**
 * Marks <html> with `data-sheet-open` while `shown`: the tab bar hides (globals.css; the app hides
 * its own). Under a modal sheet the mark is empty and the page behind holds still; with only trays
 * open it is "tray" and the page still scrolls. Counted by kind, so one sheet closing doesn't clear
 * another's mark, and a tray left open under a modal sheet gets its own mark back.
 */
export function useSheetOpenMark(shown: boolean, kind: MarkKind = "modal"): void {
  useEffect(() => {
    if (!shown) return;
    marks[kind] += 1;
    writeMark();
    return () => {
      marks[kind] = Math.max(0, marks[kind] - 1);
      writeMark();
    };
  }, [shown, kind]);
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The sheet's entrance, while it is still rising; under reduced motion it is a fade, never this. */
function rising(el: HTMLElement): Animation | undefined {
  if (typeof el.getAnimations !== "function") return undefined;
  return el
    .getAnimations()
    .find((a) => (a as CSSAnimation).animationName === "sheet-in" && a.playState === "running");
}

/** How far below its resting place a rising sheet is now, in px; 0 once it has risen. */
function risingOffset(el: HTMLElement, anim = rising(el)): number {
  if (!anim) return 0;
  return Math.max(0, translateYOf(getComputedStyle(el).transform));
}

/**
 * A bottom sheet: a native <dialog> with showModal() (focus trapping, Esc and an inert page for
 * free) that rises from the bottom edge over the tab bar. It closes with ✕, Esc, a tap on the scrim
 * or a drag down on its grip or title row, and leaves before its owner hears it closed: fast after a
 * tap, following through after a drag. Only its body scrolls; the phone shape of Dialog, Popover and
 * ContextMenu.
 *
 * With `modal={false}` it is a tray: opened with show(), so it is not in the top layer and nothing
 * behind it is inert. It lives in <body>, clear of whatever its owner sits in (the reader's top bar
 * slides away and goes inert under it).
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  action,
  children,
  size = "content",
  bare,
  modal = true,
  id,
  className,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [phase, setPhaseState] = useState<Phase>("closed");
  // What is closing it, for the exit's speed (globals.css reads it from data-closing).
  const [exit, setExit] = useState<SheetExit>("tap");
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

  /** Sends the sheet away; `notify` when the owner doesn't know yet (✕, Esc, the scrim, a drag). */
  const dismiss = useCallback(
    ({ notify, then, by = "tap" }: { notify: boolean; then?: () => void; by?: SheetExit }) => {
      if (phaseRef.current !== "open") return;
      closing.current = { notify, then };
      // Closed while still rising: the exit starts from where the sheet is, not from where it rests.
      // A drag has set its own start.
      const el = ref.current;
      if (el && by !== "drag") {
        const y = risingOffset(el);
        if (y > 0.5) el.style.setProperty("--sheet-y", `${y}px`);
      }
      setExit(by);
      setPhase("closing");
      // In case the exit never runs (a hidden tab, no animations): don't stay stuck half closed.
      timer.current = window.setTimeout(finish, sheetExitMs(by, reducedMotion(), size) + 50);
    },
    [finish, setPhase, size],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      closing.current = null;
      window.clearTimeout(timer.current);
      if (modal) el.showModal();
      else el.show();
      setPhase("open");
      // React's autoFocus runs before the dialog is shown, so it lands nowhere; focus the first field now.
      // Not in a tray: a field there is a side matter (a highlight's tags), and focus on it would
      // raise the phone's keyboard over the page the tray leaves in view. With no field the sheet
      // itself takes focus, so neither show() nor showModal() leaves a focus ring on its first
      // control (a menu's ✕, or a colour that is not the one checked).
      const field = el.querySelector<HTMLElement>(
        modal ? "input:not([type=hidden]), textarea, select, [data-autofocus]" : "[data-autofocus]",
      );
      (field ?? el).focus();
    }
    if (!open && phaseRef.current === "open") dismiss({ notify: false });
  }, [open, modal, dismiss, setPhase]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // A tray has no scrim to tap and, not being modal, gets no `cancel` for Esc: listen for both. A
  // press outside closes it when it lifts where it landed; one that turns into a scroll is cancelled
  // by the browser, so the page scrolls under an open tray. The tray is still `open` through its
  // exit, so the reader's press arbiter (gestures.ts) takes the same press for a dismissal.
  useEffect(() => {
    if (modal || phase !== "open") return;
    let down: { id: number; x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = null;
      const el = ref.current;
      const target = e.target instanceof Element ? e.target : null;
      if (!el || !target || el.contains(target)) return;
      // Its own button closes it with its click; closing here too would let that click reopen it.
      if (id && target.closest("[aria-controls]")?.getAttribute("aria-controls") === id) return;
      down = { id: e.pointerId, x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      const press = down;
      down = null;
      if (!press || press.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > TRAY_TAP_SLOP) return;
      dismiss({ notify: true });
    };
    const onCancel = () => {
      down = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A sheet or dialog opened over the tray takes its own Esc.
      const inside = e.target instanceof Element ? e.target.closest("dialog[open]") : null;
      if (inside && inside !== ref.current) return;
      e.preventDefault();
      dismiss({ notify: true });
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("keydown", onKey);
    };
  }, [modal, phase, id, dismiss]);

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
    // Where the sheet was when the finger landed: below its resting place if it was still rising.
    let base = 0;
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
      // Caught while still rising: stop the rise where it is and let the finger take it from there,
      // or the entrance would keep overriding the drag and the sheet would jump when it ended.
      const anim = rising(el);
      base = risingOffset(el, anim);
      if (anim) {
        anim.cancel();
        el.style.transform = `translateY(${base}px)`;
      }
    };
    const move = (e: TouchEvent) => {
      if (!active) return;
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      dy = touch.clientY - y0;
      el.style.transform = `translateY(${sheetOffset(base + dy)}px)`;
    };
    const end = () => {
      if (!active) return;
      active = false;
      if (sheetRelease(dy, performance.now() - t0, height, base) === "close") {
        // The exit carries on from where the finger let go.
        el.style.setProperty("--sheet-y", `${sheetOffset(base + dy)}px`);
        el.style.transform = "";
        dismiss({ notify: true, by: "drag" });
        return;
      }
      if (sheetOffset(base + dy) > 0) {
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

  // The on-screen keyboard: the sheet rides above it (`--sheet-kb` is its bottom, globals.css). iOS
  // may also pan the page to bring the focused field into view, all the more when the field took
  // focus while the sheet was still on its way up: `--sheet-pan` is that pan, which the sheet's
  // height gives up so that its top stays on screen.
  useEffect(() => {
    const el = ref.current;
    const vv = window.visualViewport;
    if (!shown || !el || !vv) return;
    const update = () => {
      el.style.setProperty("--sheet-kb", `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`);
      el.style.setProperty("--sheet-pan", `${Math.max(0, vv.offsetTop)}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      el.style.removeProperty("--sheet-kb");
      el.style.removeProperty("--sheet-pan");
    };
  }, [shown]);

  useSheetOpenMark(phase === "open", modal ? "modal" : "tray");

  const api = useMemo<SheetApi>(() => ({ close: (then) => dismiss({ notify: true, then }) }), [dismiss]);

  const sheet = (
    <dialog
      ref={ref}
      id={id}
      data-sheet=""
      data-size={size}
      data-tray={modal ? undefined : ""}
      data-closing={phase === "closing" ? exit : undefined}
      // Only while shown: a closed sheet stays in the page, and the reader takes any overlay it finds
      // for an open one (gestures.ts), which would swallow every tap.
      role={shown ? "dialog" : undefined}
      data-reader-overlay={shown ? "" : undefined}
      aria-label={title}
      data-testid="sheet"
      tabIndex={-1}
      className={cx("sheet outline-none", className)}
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
        if (modal && e.target === ref.current) dismiss({ notify: true });
      }}
      onAnimationEnd={(e) => {
        // The scrim's animations end here too, on the same element: wait for the sheet's own.
        const out = e.animationName === "sheet-out" || e.animationName === "sheet-fade-out";
        if (e.target === e.currentTarget && out && phaseRef.current === "closing") finish();
      }}
    >
      {shown && (
        <SheetContext.Provider value={api}>
          <div ref={headRef} className="shrink-0">
            <div data-sheet-grip className="flex h-7 items-center justify-center">
              <span aria-hidden className="h-[5px] w-9 rounded-full bg-fg-3/40" />
            </div>
            {!bare && modal && (
              <div className="flex min-h-12 items-center gap-3 pr-2 pl-5">
                <div className={cx("min-w-0 flex-1", subtitle && "py-1.5")}>
                  <h2 className="truncate font-display text-[17px] leading-6 font-bold">{title}</h2>
                  {subtitle && (
                    <p data-sheet-subtitle className="truncate text-[13px] leading-[18px] text-fg-2">
                      {subtitle}
                    </p>
                  )}
                </div>
                {action}
                <IconButton icon={X} label="Close" onClick={() => dismiss({ notify: true })} />
              </div>
            )}
          </div>
          {/* flex-auto, not flex-1: the sheet has no height of its own (only a max-height), and
              WebKit resolves flex-1's 0% basis to 0 there, so the body would add nothing to the
              sheet's height and collapse to its padding. min-h-0 lets it scroll at the max height. */}
          <div data-sheet-body className="min-h-0 flex-auto">
            {children}
          </div>
        </SheetContext.Provider>
      )}
    </dialog>
  );
  // A tray is not in the top layer, so it must not sit inside its owner's stacking context.
  return modal ? sheet : createPortal(sheet, document.body);
}
