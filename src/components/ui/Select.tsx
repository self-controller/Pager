import type { SelectHTMLAttributes } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cx } from "@/lib/cx";

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  icon?: LucideIcon;
  options: { value: string; label: string }[];
  label: string;
}

/** A "Sort by" select: outlined, md height, leading icon. */
export function Select({ icon: Icon, options, label, className, ...rest }: Props) {
  return (
    <div className={cx("relative shrink-0", className)}>
      {Icon && <Icon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-2" aria-hidden />}
      <select
        aria-label={label}
        className={cx(
          "h-10 appearance-none rounded-sm bg-surface pr-8 text-[14px] font-medium text-fg shadow-[inset_0_0_0_1px_var(--detail)] transition-hover hover:bg-surface-2",
          Icon ? "pl-9" : "pl-3",
        )}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={16} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-fg-2" aria-hidden />
    </div>
  );
}
