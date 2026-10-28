import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { Check } from "lucide-react";
import { cx } from "@/lib/cx";

export interface MenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** A radio-like entry: shows a check mark when true. */
  checked?: boolean;
  /** A small key hint on the right ("F2"). */
  hint?: string;
}

export type MenuEntry = MenuItem | "separator";

export interface MenuState {
  label: string;
  at: { x: number; y: number };
  items: MenuEntry[];
}

interface Props extends MenuState {
  onClose: () => void;
}

/**
 * A right-click menu: fixed at the pointer, clamped to the viewport, keyboard-navigable, closed by
 * Esc, an outside press, a resize or a page turn. Also opened from a "⋯" button or a long press.
 */
export function ContextMenu({ label, at, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, at.x), window.innerWidth - width - 8);
    const top = Math.min(Math.max(8, at.y), window.innerHeight - height - 8);
    setStyle({ left, top });
    el.querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled=true])")?.focus();
  }, [at]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([aria-disabled=true])") ?? []);
      if (!nodes.length) return;
      const i = nodes.indexOf(document.activeElement as HTMLElement);
      const next =
        e.key === "Home" ? 0 : e.key === "End" ? nodes.length - 1 : e.key === "ArrowDown" ? (i + 1) % nodes.length : (i - 1 + nodes.length) % nodes.length;
      nodes[next]?.focus();
    };
    const t = window.setTimeout(() => document.addEventListener("pointerdown", onDown));
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, { passive: true });
    window.addEventListener("reader:pagechange", onClose);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose);
      window.removeEventListener("reader:pagechange", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="fixed z-40 min-w-[220px] rounded-md bg-elevated p-1.5 elevation"
      style={style}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={`sep-${i}`} role="separator" className="my-1.5 h-px bg-detail" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            aria-disabled={item.disabled || undefined}
            aria-checked={item.checked}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={cx(
              "flex h-9 w-full items-center gap-3 rounded-sm px-2.5 text-left text-[14px] leading-5 font-medium transition-hover",
              item.danger ? "text-error hover:bg-accent-bg/60" : "text-fg hover:bg-surface-2",
              item.disabled && "opacity-50",
            )}
          >
            <span className="flex size-5 shrink-0 items-center justify-center text-fg-2">
              {item.checked ? <Check size={16} aria-hidden /> : item.icon ? <item.icon size={16} strokeWidth={1.75} aria-hidden /> : null}
            </span>
            <span className="flex-1 truncate">{item.label}</span>
            {item.hint && <span className="font-byline text-[11px] text-fg-3">{item.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}

/** Opens a menu on a long press (touch), where there is no right button. */
export function longPressProps(onPress: (at: { x: number; y: number }) => void, delayMs = 500) {
  let timer: number | undefined;
  const cancel = () => window.clearTimeout(timer);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const at = { x: e.clientX, y: e.clientY };
      cancel();
      timer = window.setTimeout(() => onPress(at), delayMs);
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerMove: cancel,
    onPointerLeave: cancel,
  };
}
