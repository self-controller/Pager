import { Outlet } from "react-router";
import { useLiveUpdates } from "@/api/hooks";
import { ToastProvider } from "@/components/ui/Toast";
import { cx } from "@/lib/cx";
import { isNativeApp } from "@/lib/native";
import { BottomTabBar } from "./BottomTabBar";
import { SideNav } from "./SideNav";
import { useNativeTabs } from "./useNativeTabs";

export function AppShell() {
  // Files edited on disk, re-anchored highlights, other tabs: refetch what changed.
  useLiveUpdates();
  // In the iPhone app the tab bar is the system's, at every width.
  useNativeTabs();
  const native = isNativeApp();
  return (
    <ToastProvider>
      <a
        href="#content"
        className="fixed top-2 left-2 z-50 -translate-y-20 rounded-sm bg-elevated px-3 py-2 text-[14px] font-semibold elevation focus:translate-y-0"
      >
        Skip to content
      </a>
      <SideNav />
      <main
        id="content"
        className={cx(
          "min-h-dvh pb-[calc(var(--size-bottom-nav)+env(safe-area-inset-bottom))] md:ml-[var(--size-left-nav)]",
          // From 768px a browser has the side nav instead; the app keeps its tab bar (an iPhone in landscape).
          !native && "md:pb-0",
        )}
      >
        <Outlet />
      </main>
      <BottomTabBar />
    </ToastProvider>
  );
}
