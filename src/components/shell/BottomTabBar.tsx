import { Link, useLocation } from "react-router";
import { isNativeApp } from "@/lib/native";
import { NAV } from "./nav";
import { isNavActive, useNavTargets } from "./useBookTab";

/** Width of one tab in the pill, in px. The bubble moves by this much per tab. */
const TAB_WIDTH = 64;

/**
 * Below 768px the side nav becomes a floating glass pill of icons near the bottom of the screen.
 * The outer box keeps the old bar's size and place (the reader hides it, the page pads for it),
 * but it is see-through and lets taps through around the pill. The iPhone app draws the system tab
 * bar instead (useNativeTabs).
 */
export function BottomTabBar() {
  return isNativeApp() ? null : <GlassTabBar />;
}

function GlassTabBar() {
  const items = NAV.filter((n) => n.mobile);
  const { pathname } = useLocation();
  const target = useNavTargets();
  // "/" only exactly, the others as a prefix; the Book tab on any open book.
  const active = items.findIndex((item) => isNavActive(item, pathname));
  return (
    <nav
      aria-label="Main navigation"
      data-tab-bar // hidden with the reader's chrome (globals.css)
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 h-[calc(var(--size-bottom-nav)+env(safe-area-inset-bottom))] md:hidden"
    >
      <div className="glass-tab-bar pointer-events-auto absolute bottom-[max(4px,calc(env(safe-area-inset-bottom)-10px))] left-1/2 flex h-[52px] -translate-x-1/2 rounded-full p-1">
        <span
          aria-hidden
          className="glass-tab-bubble absolute top-1 left-1 h-11 rounded-full"
          style={{
            width: TAB_WIDTH,
            transform: `translateX(${Math.max(active, 0) * TAB_WIDTH}px)`,
            opacity: active < 0 ? 0 : 1,
          }}
        />
        {items.map((item, i) => {
          const Icon = item.icon;
          const on = i === active;
          return (
            // A Link, not a NavLink: the state comes from `active`, which knows the Book tab's routes.
            <Link
              key={item.to}
              to={target(item)}
              viewTransition // the tabs' faint crossfade (globals.css)
              aria-label={item.label}
              aria-current={on ? "page" : undefined}
              // The Book tab on an open book: already there, so the reader isn't sent anywhere.
              onClick={item.match && on ? (e) => e.preventDefault() : undefined}
              className="relative flex h-11 items-center justify-center rounded-full"
              style={{ width: TAB_WIDTH }}
            >
              <Icon
                size={24}
                strokeWidth={on ? 2 : 1.75}
                fill={on && item.fill ? "currentColor" : "none"}
                className={on ? "text-fg" : "text-fg-2"}
                aria-hidden
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
