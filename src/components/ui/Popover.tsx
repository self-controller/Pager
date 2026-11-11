import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { usePresence } from "@/lib/usePresence";

interface Props {
  /** Renders the trigger; spread the props onto a button. */
  trigger: (props: { "aria-expanded": boolean; "aria-controls": string; onClick: () => void }) => ReactNode;
  /** The panel's announced name. */
  title: string;
  children: ReactNode;
  align?: "start" | "end";
  /** The panel's classes. */
  className?: string;
  /** Told when it opens and when it starts to close. */
  onOpenChange?: (open: boolean) => void;
  /** Closes it when this turns true (the bar it hangs from is going away). */
  forceClosed?: boolean;
}

/** How far a finger may move between landing and lifting for a tap outside to close it, in px. */
const TAP_SLOP = 15;

/**
 * A panel anchored to its button, on every screen. It grows from the corner by the button and
 * shrinks back into it. Not modal: the page behind stays live, and a touch outside closes it only
 * when it is a tap, so the page can still be scrolled with it open. Closes on Esc too.
 */
export function Popover({ trigger, title, children, align = "end", className, onOpenChange, forceClosed }: Props) {
  const [open, setOpen] = useState(false);
  const { shown, leaving } = usePresence(open);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const report = useRef(onOpenChange);
  report.current = onOpenChange;
  const reported = useRef(false);

  useEffect(() => {
    if (open === reported.current) return;
    reported.current = open;
    report.current?.(open);
  }, [open]);
  // Unmounted while open: whoever held something for it lets go.
  useEffect(
    () => () => {
      if (reported.current) report.current?.(false);
    },
    [],
  );

  if (forceClosed && open) setOpen(false);

  useEffect(() => {
    if (!open) return;
    // A press on the trigger is left to its own click, which toggles.
    const outside = (e: Event) => !ref.current?.contains(e.target as Node);
    // A touch outside, until it lifts: a tap closes, a scroll (the browser cancels it) does not.
    let touch: { id: number; x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      touch = null;
      if (!outside(e)) return;
      if (e.pointerType === "mouse") setOpen(false);
      else touch = { id: e.pointerId, x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (touch?.id === e.pointerId && Math.hypot(e.clientX - touch.x, e.clientY - touch.y) <= TAP_SLOP) setOpen(false);
      touch = null;
    };
    const onCancel = () => {
      touch = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger({ "aria-expanded": open, "aria-controls": id, onClick: () => setOpen((o) => !o) })}
      {shown && (
        // While it leaves it is still a dialog, so the reader takes the same tap as a dismissal.
        <div
          id={id}
          role="dialog"
          aria-label={title}
          className={cx(
            "absolute top-full z-30 mt-2 rounded-md bg-elevated elevation",
            align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left",
            leaving ? "pop-out" : "pop-in",
            className,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
