import { NavLink } from "react-router";
import { cx } from "@/lib/cx";
import { NAV, type NavEntry } from "./nav";

function NavItem({ item }: { item: NavEntry }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      aria-label={item.label}
      title={item.label}
      className="flex min-h-12 min-w-12 items-center gap-1 rounded-md transition-hover select-none pressable hover:bg-surface-hover"
    >
      {({ isActive }) => (
        <>
          <span className="flex size-12 shrink-0 items-center justify-center">
            <Icon
              size={24}
              strokeWidth={isActive ? 2 : 1.75}
              fill={isActive && item.fill ? "currentColor" : "none"}
              className={isActive ? "text-fg" : "text-fg-2"}
              aria-hidden
            />
          </span>
          <span
            className={cx(
              "hidden flex-1 text-[15px] leading-5 lg:block",
              isActive ? "font-semibold text-fg" : "font-medium text-fg-2",
            )}
          >
            {item.label}
          </span>
        </>
      )}
    </NavLink>
  );
}

/** Left navigation: a 232px column, an icon rail between 768 and 1023px, hidden on phones. */
export function SideNav() {
  return (
    <nav
      aria-label="Main navigation"
      className="fixed inset-y-0 left-0 z-20 hidden w-[var(--size-left-nav)] flex-col bg-surface p-2 md:flex"
    >
      <div className="flex h-16 shrink-0 items-center px-3">
        <span className="hidden font-serif text-[22px] leading-7 font-semibold tracking-tight text-fg lg:block" aria-hidden>
          Pager
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2">
        {NAV.map((item) => (
          <NavItem key={item.to} item={item} />
        ))}
      </div>
    </nav>
  );
}
