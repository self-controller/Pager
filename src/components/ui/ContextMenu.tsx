import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { Check } from "lucide-react";
import { cx } from "@/lib/cx";
import { useIsPhone } from "@/lib/useIsPhone";
import { Sheet, useSheet } from "./Sheet";

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
  /** What the menu acts on, under the title of the phone sheet (the pointer menu has no title). */
  subtitle?: string;
  at: { x: number; y: number };
  items: MenuEntry[];
}

/**
 * The entries as the phone sheet lists them: actions that destroy go last, after one divider,
 * whatever order they came in, and no divider leads, trails or doubles.
 */
export function sheetMenuOrder(items: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const item of items) {
    if (item === "separator") {
      if (out.length && out[out.length - 1] !== "separator") out.push(item);
    } else if (!item.danger) out.push(item);
  }
  if (out[out.length - 1] === "separator") out.pop();
  const danger = items.filter((item): item is MenuItem => item !== "separator" && Boolean(item.danger));
  if (danger.length && out.length) out.push("separator");
  return [...out, ...danger];
}

interface Props extends MenuState {
  onClose: () => void;
}

/**
 * A menu of actions: on phones (and in the iPhone app) a bottom sheet, otherwise a right-click menu
 * at the pointer. Opened from a right click, a "⋯" button or a long press.
 */
export function ContextMenu(props: Props) {
  return useIsPhone() ? <MenuSheet {...props} /> : <PointerMenu {...props} />;
}

/** The phone menu: a sheet whose pick slides it away before the action runs (and what it opens rises). */
function MenuSheet({ label, subtitle, items, onClose }: Props) {
  return (
    <Sheet open onClose={onClose} title={label} subtitle={subtitle} size="content">
      <SheetMenuList label={label} items={items} />
    </Sheet>
  );
}

function SheetMenuList({ label, items }: { label: string; items: MenuEntry[] }) {
  const sheet = useSheet();
  return <MenuList label={label} items={sheetMenuOrder(items)} phone onPick={(item) => sheet?.close(() => item.onSelect())} />;
}

/**
 * A right-click menu: fixed at the pointer, clamped to the viewport, keyboard-navigable, closed by
 * Esc, an outside press, a resize or a page turn.
 */
function PointerMenu({ label, at, items, onClose }: Props) {
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
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? nodes.length - 1
            : e.key === "ArrowDown"
              ? (i + 1) % nodes.length
              : (i - 1 + nodes.length) % nodes.length;
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
      className="fixed z-40 min-w-[220px] rounded-md bg-elevated p-1.5 elevation"
      style={style}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuList
        label={label}
        items={items}
        phone={false}
        onPick={(item) => {
          onClose();
          item.onSelect();
        }}
      />
    </div>
  );
}

/** The menu's entries; rows grow to a finger's size on phones, where key hints mean nothing. */
function MenuList({
  label,
  items,
  onPick,
  phone,
}: {
  label?: string;
  items: MenuEntry[];
  onPick: (item: MenuItem) => void;
  phone: boolean;
}) {
  return (
    <div role="menu" aria-label={label} className={cx(phone && "px-2 pb-2")}>
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
            onClick={() => onPick(item)}
            className={cx(
              "flex w-full items-center gap-3 rounded-sm px-2.5 text-left leading-5 font-medium transition-hover",
              phone ? "h-12 text-[16px]" : "h-9 text-[14px]",
              item.danger ? "text-error" : "text-fg",
              "hover:bg-surface-2",
              item.disabled && "opacity-50",
            )}
          >
            <span className={cx("flex size-5 shrink-0 items-center justify-center", !(phone && item.danger) && "text-fg-2")}>
              {item.checked ? (
                <Check size={16} aria-hidden />
              ) : item.icon ? (
                <item.icon size={16} strokeWidth={1.75} aria-hidden />
              ) : null}
            </span>
            <span className="flex-1 truncate">{item.label}</span>
            {item.hint && !phone && <span className="font-byline text-[11px] text-fg-3">{item.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}

type PressPoint = { x: number; y: number };
type PressEvent = Pick<React.PointerEvent, "pointerType" | "isPrimary" | "clientX" | "clientY">;

/** How far a finger may drift while it holds, in px: a real finger is never perfectly still. */
export const LONG_PRESS_SLOP = 10;
/** How long after the finger lifts a click still belongs to the press, in ms. */
const CLICK_AFTER_LIFT_MS = 400;

/**
 * A long press (touch), where there is no right button. The finger may drift a little; lifting
 * early, a scroll (the browser cancels the pointer) or a longer move cancels it. The click a browser
 * may send when the finger lifts after the press is swallowed wherever it lands: it would open the
 * row, or close the sheet that rose under the finger. A new touch is never swallowed.
 *
 * The element also needs the `long-press` class (globals.css): without it iOS answers a long press
 * on a link with its own sheet (Open, Copy, Share) and cancels the pointer before this fires.
 */
export function createLongPress(onPress: (at: PressPoint) => void, delayMs = 500) {
  let timer: number | undefined;
  let start: PressPoint = { x: 0, y: 0 };
  let release: (() => void) | undefined;

  const cancel = () => {
    window.clearTimeout(timer);
    timer = undefined;
  };

  const swallowClick = () => {
    release?.();
    let expiry: number | undefined;
    const end = () => {
      window.clearTimeout(expiry);
      window.removeEventListener("click", swallow, true);
      window.removeEventListener("pointerdown", end, true);
      window.removeEventListener("pointerup", lifted, true);
      window.removeEventListener("pointercancel", lifted, true);
      release = undefined;
    };
    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      end();
    };
    const lifted = () => {
      window.clearTimeout(expiry);
      expiry = window.setTimeout(end, CLICK_AFTER_LIFT_MS);
    };
    window.addEventListener("click", swallow, true);
    window.addEventListener("pointerdown", end, true);
    window.addEventListener("pointerup", lifted, true);
    window.addEventListener("pointercancel", lifted, true);
    release = end;
  };

  return {
    handlers: {
      onPointerDown: (e: PressEvent) => {
        if (e.pointerType !== "touch" || !e.isPrimary) return;
        cancel();
        start = { x: e.clientX, y: e.clientY };
        timer = window.setTimeout(() => {
          timer = undefined;
          swallowClick();
          onPress(start);
        }, delayMs);
      },
      onPointerMove: (e: PressEvent) => {
        if (timer !== undefined && Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_SLOP) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
    },
    /** Stops a press that is still counting, and stops swallowing. */
    dispose: () => {
      cancel();
      release?.();
    },
  };
}

/** `createLongPress` for a component: one press across renders, always calling the latest `onPress`. */
export function useLongPress(onPress: (at: PressPoint) => void, delayMs = 500) {
  const latest = useRef(onPress);
  latest.current = onPress;
  const [press] = useState(() => createLongPress((at) => latest.current(at), delayMs));
  useEffect(() => press.dispose, [press]);
  return press.handlers;
}
