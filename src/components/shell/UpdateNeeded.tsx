import { API_VERSION, type Health } from "@/api/types";

/** Which side is behind when this UI and the server speak different API versions, or null when they match. */
export function outdatedSide(health: Pick<Health, "apiVersion"> | undefined): "app" | "computer" | null {
  if (!health || health.apiVersion === API_VERSION) return null;
  return health.apiVersion > API_VERSION ? "app" : "computer";
}

/**
 * Shown instead of the app when the server speaks another API version. Only the iPhone app, which
 * carries its own copy of this UI, can meet that; the computer serves the UI that matches it.
 */
export function UpdateNeeded({ side }: { side: "app" | "computer" }) {
  return (
    <main className="flex min-h-dvh justify-center px-5 pt-[max(48px,env(safe-area-inset-top))] pb-[max(32px,env(safe-area-inset-bottom))]">
      <div className="flex w-full max-w-[400px] flex-col gap-4" role="alert">
        <p className="font-display text-[28px] leading-9 font-bold">Pager</p>
        <h1 className="font-display text-[22px] leading-7 font-semibold">Update Pager</h1>
        <p className="text-[15px] leading-6 text-fg-2">
          {side === "app"
            ? "Pager on your computer is newer than this app. Update the app on this phone to keep reading."
            : "This app is newer than Pager on your computer. Update Pager on your computer to keep reading."}
        </p>
      </div>
    </main>
  );
}
