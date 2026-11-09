import { Link, useLocation } from "react-router";
import { cx } from "@/lib/cx";
import { isNativeApp } from "@/lib/native";
import { NAV, type NavEntry } from "./nav";
import { isNavActive, useNavTargets } from "./useBookTab";

function NavItem({ item, to, active }: { item: NavEntry; to: string; active: boolean }) {
  const Icon = item.icon;
  return (
    // A Link, not a NavLink: `active` knows the Book tab's routes (any open book), as the tab bar does.
    <Link
      to={to}
      viewTransition // the tabs' faint crossfade (globals.css)
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      // The Book entry on an open book: already there, so the reader isn't sent anywhere.
      onClick={item.match && active ? (e) => e.preventDefault() : undefined}
      title={item.label}
      className="flex min-h-12 min-w-12 items-center gap-1 rounded-md transition-hover select-none pressable hover:bg-surface-hover"
    >
      <span className="flex size-12 shrink-0 items-center justify-center">
        <Icon
          size={24}
          strokeWidth={active ? 2 : 1.75}
          fill={active && item.fill ? "currentColor" : "none"}
          className={active ? "text-fg" : "text-fg-2"}
          aria-hidden
        />
      </span>
      <span
        className={cx(
          "hidden flex-1 text-[15px] leading-5 lg:block",
          active ? "font-semibold text-fg" : "font-medium text-fg-2",
        )}
      >
        {item.label}
      </span>
    </Link>
  );
}

/**
 * Left navigation: a 232px column, an icon rail between 768 and 1023px, hidden on phones. Never in the
 * iPhone app, which keeps its tab bar at every width.
 */
export function SideNav() {
  return isNativeApp() ? null : <SideNavBar />;
}

function SideNavBar() {
  const { pathname } = useLocation();
  const target = useNavTargets();
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
          <NavItem key={item.to} item={item} to={target(item)} active={isNavActive(item, pathname)} />
        ))}
      </div>
    </nav>
  );
}
