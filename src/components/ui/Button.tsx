import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "@/lib/cx";

/** Button priorities, strongest first. */
export type ButtonVariant = "primary" | "secondary" | "secondary-outline" | "tertiary" | "quaternary";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center whitespace-nowrap select-none font-semibold leading-5 transition-hover pressable disabled:opacity-50 disabled:pointer-events-none";

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-2 gap-1.5 text-[13px] rounded-sm",
  md: "h-10 px-4 gap-2 text-[15px] rounded-sm",
  lg: "h-11 px-4 gap-3 text-[17px] rounded-md",
};

const variants: Record<ButtonVariant, string> = {
  primary: "bg-[var(--button-primary-bg)] text-[var(--button-primary-fg)] hover:bg-[var(--button-primary-bg-hover)]",
  secondary: "bg-[var(--button-secondary-bg)] text-[var(--button-secondary-fg)] hover:bg-[var(--button-secondary-bg-hover)]",
  "secondary-outline": "bg-transparent text-fg shadow-[inset_0_0_0_1px_var(--detail)] hover:bg-surface-2",
  tertiary: "bg-transparent text-[var(--button-tertiary-fg)] hover:bg-[var(--button-tertiary-bg-hover)]",
  quaternary: "bg-transparent text-[var(--button-quaternary-fg)] hover:text-[var(--button-quaternary-fg-hover)]",
};

export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string): string {
  return cx(base, sizes[size], variants[variant], extra);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  grow?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon: Icon, grow, className, children, type = "button", ...rest },
  ref,
) {
  const iconSize = size === "lg" ? 20 : size === "md" ? 18 : 16;
  return (
    <button ref={ref} type={type} className={buttonClasses(variant, size, cx(grow && "w-full", className))} {...rest}>
      {Icon && <Icon size={iconSize} strokeWidth={2} aria-hidden />}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Fill the icon (the active/pressed style). */
  filled?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, variant = "tertiary", size = "md", filled, className, type = "button", ...rest },
  ref,
) {
  const box = size === "lg" ? "size-11 rounded-md" : size === "md" ? "size-10 rounded-sm" : "size-8 rounded-sm";
  const iconSize = size === "sm" ? 18 : 20;
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(base, box, "p-0", variants[variant], className)}
      {...rest}
    >
      <Icon size={iconSize} strokeWidth={filled ? 2 : 1.75} fill={filled ? "currentColor" : "none"} aria-hidden />
    </button>
  );
});
