import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { useIsPhone } from "@/lib/useIsPhone";
import { Sheet } from "./Sheet";

interface Props {
  /** Renders the trigger; spread the props onto a button. */
  trigger: (props: { "aria-expanded": boolean; "aria-controls": string; onClick: () => void }) => ReactNode;
  /** The sheet's title on phones, and the panel's announced name. */
  title: string;
  children: ReactNode;
  align?: "start" | "end";
  /** The floating panel's classes (not the phone sheet's). */
  className?: string;
  /**
   * On phones, a tray instead of a modal sheet (Sheet's `modal={false}`): no scrim, and the page
   * behind stays live. For settings whose effect shows on the page.
   */
  tray?: boolean;
}

/** Anchored panel that closes on outside click and Esc; a bottom sheet on phones. */
export function Popover({ trigger, title, children, align = "end", className, tray }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const phone = useIsPhone();

  useEffect(() => {
    // A sheet closes itself (✕, Esc, the scrim or a tap outside a tray, a drag down).
    if (!open || phone) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, phone]);

  return (
    <div ref={ref} className="relative">
      {trigger({ "aria-expanded": open, "aria-controls": id, onClick: () => setOpen((o) => !o) })}
      {phone ? (
        <Sheet id={id} open={open} onClose={() => setOpen(false)} title={title} size="content" modal={!tray}>
          <div className="px-5 pt-1 pb-4">{children}</div>
        </Sheet>
      ) : (
        open && (
          <div
            id={id}
            role="dialog"
            aria-label={title}
            className={cx(
              "absolute top-full z-30 mt-2 rounded-md bg-elevated elevation",
              align === "end" ? "right-0" : "left-0",
              className,
            )}
          >
            {children}
          </div>
        )
      )}
    </div>
  );
}
