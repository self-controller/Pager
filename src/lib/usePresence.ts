import { useEffect, useState } from "react";

/** How long a popup takes to leave, in ms: mirrors `--pop-out` in tokens.css. */
export const POP_OUT_MS = 180;
/** The plain fade that takes its place under reduced motion (globals.css, `.pop-out`). */
const REDUCED_OUT_MS = 150;

/** How long a leaving popup stays: its own exit, or the shorter fade under reduced motion. */
export function exitDuration(exitMs = POP_OUT_MS): number {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? REDUCED_OUT_MS : exitMs;
}

/**
 * Keeps a popup in the page while it leaves: `shown` stays true for the exit after `open` turns
 * false, with `leaving` true meanwhile. Opening again during the exit cancels it.
 */
export function usePresence(open: boolean, exitMs = POP_OUT_MS): { shown: boolean; leaving: boolean } {
  const [leaving, setLeaving] = useState(false);
  // Whether it has been open: a popup that never opened has nothing to leave.
  const [wasOpen, setWasOpen] = useState(open);

  if (open && !wasOpen) setWasOpen(true);
  if (!open && wasOpen && !leaving) {
    setWasOpen(false);
    setLeaving(true);
  }
  if (open && leaving) setLeaving(false);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(false), exitDuration(exitMs));
    return () => window.clearTimeout(timer);
  }, [leaving, exitMs]);

  return { shown: open || leaving, leaving: leaving && !open };
}
