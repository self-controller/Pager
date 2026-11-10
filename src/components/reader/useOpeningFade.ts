import { useEffect, useState } from "react";

/** How long the text may wait for its place before it shows anyway. */
export const OPENING_WAIT_MS = 500;
/** The fade (prose.css, "A book opening"), and a little more before the mark comes off. */
const FADE_MS = 150;

/**
 * A book opening: the chapter's text stays hidden until the reader has put it at the saved place,
 * then fades in, so the page that slides in never shows the text jumping. The value goes on the
 * reader as `data-opening`: "wait" hides the text, "in" fades it in, and then it is gone for good,
 * so a chapter turn or a jump never fades. Only the first placement after the reader mounts counts.
 * The text cannot stay hidden: `ready` (placed, or failed) or OPENING_WAIT_MS ends the wait, and the
 * stylesheet's own hold ends after the same time whatever this hook does.
 */
export function useOpeningFade(ready: boolean): "wait" | "in" | undefined {
  const [phase, setPhase] = useState<"wait" | "in" | "done">("wait");
  useEffect(() => {
    if (phase === "done") return;
    if (phase === "wait" && ready) {
      setPhase("in");
      return;
    }
    const t = window.setTimeout(() => setPhase(phase === "wait" ? "in" : "done"), phase === "wait" ? OPENING_WAIT_MS : FADE_MS);
    return () => window.clearTimeout(t);
  }, [phase, ready]);
  return phase === "done" ? undefined : phase;
}
