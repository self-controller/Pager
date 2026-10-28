import { Outlet } from "react-router";
import { useLiveUpdates } from "@/api/hooks";
import { ToastProvider } from "@/components/ui/Toast";
import { BottomTabBar } from "./BottomTabBar";
import { SideNav } from "./SideNav";

export function AppShell() {
  // Files edited on disk, re-anchored highlights, other tabs: refetch what changed.
  useLiveUpdates();
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
        className="min-h-dvh pb-[calc(var(--size-bottom-nav)+env(safe-area-inset-bottom))] md:ml-[var(--size-left-nav)] md:pb-0"
      >
        <Outlet />
      </main>
      <BottomTabBar />
    </ToastProvider>
  );
}
