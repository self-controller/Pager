import { cx } from "@/lib/cx";

/** An on/off switch, labelled for screen readers (the visible label sits beside it). */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-6 w-10 shrink-0 rounded-full transition-hover disabled:opacity-50",
        checked ? "bg-accent" : "bg-surface-3 shadow-[inset_0_0_0_1px_var(--detail)]",
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 left-0.5 size-5 rounded-full bg-elevated shadow-sm transition-transform",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}
