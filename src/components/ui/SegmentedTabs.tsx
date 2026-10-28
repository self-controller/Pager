import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { cx } from "@/lib/cx";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
  /** Stretch segments to fill the track (settings controls) instead of hugging labels. */
  stretch?: boolean;
}

/**
 * A filter tab bar: small quaternary buttons in an outlined track, with a
 * highlight that slides to the active segment.
 */
export function SegmentedTabs<T extends string>({ options, value, onChange, label, className, stretch }: Props<T>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState<{ x: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const active = track.querySelector<HTMLButtonElement>('[aria-selected="true"]');
      if (active) setHighlight({ x: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, [value, options]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length];
    if (next) {
      onChange(next.value);
      trackRef.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
    }
  };

  return (
    <div
      className={cx("relative min-w-0 overflow-hidden rounded-sm bg-surface shadow-[inset_0_0_0_1px_var(--detail)]", className)}
    >
      <div
        ref={trackRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="scrollbar-hidden relative flex gap-1 overflow-x-auto p-1"
      >
        {highlight && (
          <div
            aria-hidden
            className="absolute top-1 left-0 h-8 rounded-xs bg-surface-2"
            style={{
              width: highlight.width,
              transform: `translateX(${highlight.x}px)`,
              transition: "transform var(--duration-fast) var(--ease-smooth), width var(--duration-fast) var(--ease-smooth)",
            }}
          />
        )}
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="tab"
              data-value={o.value}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(o.value)}
              className={cx(
                "relative z-[1] h-8 shrink-0 rounded-xs px-2 text-[13px] leading-5 font-semibold whitespace-nowrap transition-hover",
                stretch && "flex-1",
                active ? "text-fg" : "text-fg-2 hover:text-fg",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
