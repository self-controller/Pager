import { NavLink } from "react-router";
import { NAV } from "./nav";

/** Below 768px the side nav becomes a 56px bottom bar (icons only). */
export function BottomTabBar() {
  const items = NAV.filter((n) => n.mobile);
  return (
    <nav
      aria-label="Main navigation"
      className="fixed inset-x-0 bottom-0 z-20 flex h-[calc(var(--size-bottom-nav)+env(safe-area-inset-bottom))] items-start border-t border-detail bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex h-[var(--size-bottom-nav)] w-full items-center">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              aria-label={item.label}
              className="flex h-full flex-1 items-center justify-center"
            >
              {({ isActive }) => (
                <Icon
                  size={24}
                  strokeWidth={isActive ? 2 : 1.75}
                  fill={isActive && item.fill ? "currentColor" : "none"}
                  className={isActive ? "text-fg" : "text-fg-2"}
                  aria-hidden
                />
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
