import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  type WheelEvent,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Section } from "@/api/types";
import { cx } from "@/lib/cx";
import { haptic, prepareHaptic } from "@/lib/native";
import {
  BUTTON_TURN_MS,
  canStartDrag,
  CHAPTER_GAP,
  dragIntent,
  dragOffset,
  dragOutcome,
  FADE_TURN_MS,
  initialWheel,
  releaseVelocity,
  settleDuration,
  SNAP_BACK_MS,
  TURN_EASE,
  turnTarget,
  wheelTurn,
} from "./chapterTurn";
import { dispatchReaderScroll } from "./events";
import { OVERLAY_SELECTOR, pointerKind, scrollZone, tapAction } from "./gestures";
import { ReaderBodySkeleton } from "./ReaderBody";
import type { ChapterScroll } from "./useChapterScroll";
import { selectionOpen, usePressArbiter } from "./usePressArbiter";

export type PaneRole = "prev" | "live" | "next";

/** If the router hasn't moved to the new chapter this long after a turn, the turn is undone. */
const TURN_TIMEOUT_MS = 1000;

const reducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Props {
  scrollerRef: RefObject<HTMLDivElement | null>;
  layout: ChapterScroll;
  /** The open section; undefined while it loads. */
  current: Section | undefined;
  /** The neighbours: null when there is none that way, undefined while one loads. */
  prev: Section | null | undefined;
  next: Section | null | undefined;
  /** A section's text, for the live pane or a neighbour peeking in. Keep it stable. */
  renderSection: (section: Section, role: PaneRole) => ReactNode;
  /** A turn landed: open the chapter that way (the slide has already shown it). */
  onTurn: (direction: 1 | -1) => void;
  /** Set by the view: turns with the same slide as a drag (buttons and keys). */
  turnRef: RefObject<((direction: 1 | -1) => void) | null>;
  chrome: boolean;
  onChrome: (visible: boolean) => void;
  /** The chapter buttons step aside (the chrome is hidden, or a menu or panel is open). */
  controlsHidden: boolean;
  /** The back pill, between the chapter buttons. */
  pill?: ReactNode;
  footer: ReactNode;
}

/** A chapter drag in progress, from pointerdown. */
interface Drag {
  id: number;
  x: number;
  y: number;
  t: number;
  state: "pending" | "drag";
  /** How far the finger had gone when the drag took hold: the track starts moving from there. */
  slop: number;
  /** The finger's travel since the press: what a release is judged on. */
  dx: number;
  samples: { x: number; t: number }[];
  width: number;
  canPrev: boolean;
  canNext: boolean;
}

/** Where the track is for a drag: the finger's travel less the slop it took to start, so it never jumps. */
const trackAt = (d: Drag) => dragOffset(d.dx - d.slop, d.width, d.canPrev, d.canNext);

/** One chapter on the track. Memoised: a turn changes only its role, never its text. */
const ChapterPane = memo(function ChapterPane({
  role,
  section,
  render,
  paneRef,
}: {
  role: PaneRole;
  section: Section | undefined;
  render: (section: Section, role: PaneRole) => ReactNode;
  paneRef?: RefObject<HTMLDivElement | null>;
}) {
  const live = role === "live";
  return (
    <div ref={paneRef} className="chapter-pane" data-role={role} inert={!live} aria-hidden={live ? undefined : true}>
      <div className="chapter-column">
        <div className="chapter-text" data-chapter-text>
          {section ? (
            render(section, role)
          ) : (
            <div className="pt-10">
              <ReaderBodySkeleton />
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

/**
 * The scroll layout: the open chapter scrolls top to bottom in the middle pane of a three-pane
 * track, with the previous chapter (pinned to its end) to the left and the next (at its top) to the
 * right. A sideways drag slides the whole track with the finger; let go past 30% of the width, or
 * with a flick, and the neighbour slides the rest of the way in and opens. The ‹ › buttons and the
 * arrow keys run the same slide. Panes are keyed by section, so when a turn lands the neighbour's
 * DOM simply becomes the live pane: nothing is re-laid out, and nothing flashes.
 *
 * Every tap goes through the arbiter (gestures.ts) as in the paged layout, but here a touch tap
 * anywhere is the chrome toggle: only a drag or a button changes chapter.
 */
export function ScrollView({
  scrollerRef,
  layout,
  current,
  prev,
  next,
  renderSection,
  onTurn,
  turnRef,
  chrome,
  onChrome,
  controlsHidden,
  pill,
  footer,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const wheel = useRef(initialWheel());
  const frame = useRef(0);
  const anim = useRef<Animation | null>(null);
  /** A turn on its way: set when its slide is decided, cleared when the new chapter is on screen. */
  const turning = useRef<{ dir: 1 | -1; fade: boolean } | null>(null);
  const settling = useRef(false);
  const timeout = useRef<number | undefined>(undefined);
  const canPrev = prev !== null;
  const canNext = next !== null;
  const latest = useRef({ canPrev, canNext, onTurn });
  latest.current = { canPrev, canNext, onTurn };

  const presses = usePressArbiter({
    userScrolledAt: layout.userScrolledAt,
    onTap: (kind) => {
      const action = tapAction(scrollZone(kind), kind, chrome);
      if (action === "toggle-chrome") onChrome(!chrome);
    },
  });

  const setTrack = (x: number) => {
    const track = trackRef.current;
    if (track) track.style.transform = x ? `translate3d(${x}px, 0, 0)` : "";
  };

  /** Puts the track back at rest, with the open chapter in view. */
  const reset = useCallback(() => {
    window.clearTimeout(timeout.current);
    anim.current?.cancel();
    anim.current = null;
    turning.current = null;
    settling.current = false;
    const track = trackRef.current;
    if (track) {
      track.style.transform = "";
      track.style.willChange = "";
    }
    stageRef.current?.removeAttribute("data-turning");
    scrollerRef.current?.removeAttribute("data-dragging");
  }, [scrollerRef]);

  /** The turn's slide has shown the neighbour: open it. Undone if the router never gets there. */
  const land = useCallback(
    (dir: 1 | -1) => {
      latest.current.onTurn(dir);
      window.clearTimeout(timeout.current);
      timeout.current = window.setTimeout(reset, TURN_TIMEOUT_MS);
    },
    [reset],
  );

  /**
   * Slides the track from `from` to rest (dir 0) or to the neighbour (dir ±1) and opens it. With
   * reduced motion nothing slides: the neighbour opens and fades in.
   */
  const settle = useCallback(
    (dir: 1 | -1 | 0, from: number, duration?: number) => {
      const stage = stageRef.current;
      const track = trackRef.current;
      if (!stage || !track) return;
      cancelAnimationFrame(frame.current);
      if (dir !== 0) {
        turning.current = { dir, fade: reducedMotion() };
        haptic("selection");
        dispatchReaderScroll("turn");
      }
      if (reducedMotion() || typeof track.animate !== "function") {
        if (dir === 0) reset();
        else land(dir);
        return;
      }
      const width = stage.clientWidth;
      const to = dir === 0 ? 0 : turnTarget(dir, width);
      const ms = duration ?? (dir === 0 ? SNAP_BACK_MS : settleDuration(to - from, width + CHAPTER_GAP));
      settling.current = true;
      stage.setAttribute("data-turning", "");
      track.style.transform = "";
      track.style.willChange = "transform";
      anim.current?.cancel();
      const a = track.animate([{ transform: `translate3d(${from}px, 0, 0)` }, { transform: `translate3d(${to}px, 0, 0)` }], {
        duration: ms,
        easing: TURN_EASE,
        fill: "forwards",
      });
      anim.current = a;
      a.finished.then(
        () => {
          if (anim.current !== a) return;
          if (dir === 0) reset();
          // The end frame holds (fill: forwards) until the new chapter is rendered in its place.
          else land(dir);
        },
        () => {},
      );
    },
    [reset, land],
  );

  /** A turn from a button or a key: the same slide, the whole way. */
  const turn = useCallback(
    (dir: 1 | -1) => {
      if (turning.current || settling.current || drag.current?.state === "drag") return;
      if (!(dir === 1 ? latest.current.canNext : latest.current.canPrev)) return;
      settle(dir, 0, BUTTON_TURN_MS);
    },
    [settle],
  );
  useLayoutEffect(() => {
    turnRef.current = turn;
    return () => {
      turnRef.current = null;
    };
  }, [turnRef, turn]);

  // The new chapter is on screen, in the very pane that slid in: put the track back under it before
  // paint. A reduced-motion turn fades it in instead.
  const currentId = current?.id;
  useLayoutEffect(() => {
    const t = turning.current;
    reset();
    if (t?.fade) scrollerRef.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_TURN_MS, easing: "ease-out" });
  }, [currentId, reset, scrollerRef]);

  useEffect(() => () => window.clearTimeout(timeout.current), []);

  // A selection starting under a pending drag (a long press) ends the drag.
  useEffect(() => {
    const onSelection = () => {
      const d = drag.current;
      if (!d || !selectionOpen()) return;
      drag.current = null;
      if (d.state === "drag") settle(0, trackAt(d));
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, [settle]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    presses.onPointerDown(e);
    const stage = stageRef.current;
    const target = e.target as Element;
    const ok =
      stage &&
      canStartDrag({
        kind: pointerKind(e.pointerType),
        primary: e.isPrimary,
        x: e.clientX,
        inOverlay: Boolean(target.closest?.("[data-reader-overlay], .chapter-controls, input, textarea, select")),
        hadSelection: selectionOpen(),
        hadOverlay: Boolean(document.querySelector(OVERLAY_SELECTOR)),
        zoom: window.visualViewport?.scale ?? 1,
        turning: Boolean(turning.current) || settling.current,
      });
    const { canPrev: p, canNext: n } = latest.current;
    drag.current = ok
      ? {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          t: performance.now(),
          state: "pending",
          slop: 0,
          dx: 0,
          samples: [],
          width: stage.clientWidth,
          canPrev: p,
          canNext: n,
        }
      : null;
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const now = performance.now();
    if (d.state === "pending") {
      const intent = dragIntent(e.clientX - d.x, e.clientY - d.y, now - d.t);
      if (intent === "pending") return;
      if (intent !== "drag") {
        drag.current = null;
        return;
      }
      d.state = "drag";
      d.slop = e.clientX - d.x;
      stageRef.current?.setPointerCapture?.(e.pointerId);
      scrollerRef.current?.setAttribute("data-dragging", "");
      if (trackRef.current) trackRef.current.style.willChange = "transform";
      prepareHaptic("selection");
    }
    d.dx = e.clientX - d.x;
    d.samples.push({ x: e.clientX, t: now });
    if (d.samples.length > 12) d.samples.shift();
    if (reducedMotion()) return;
    const x = trackAt(d);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setTrack(x));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    presses.onPointerUp(e);
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.state !== "drag") return;
    stageRef.current?.releasePointerCapture?.(e.pointerId);
    const dir = dragOutcome({
      dx: d.dx,
      velocity: releaseVelocity(d.samples, performance.now()),
      width: d.width,
      canPrev: d.canPrev,
      canNext: d.canNext,
    });
    settle(dir, reducedMotion() ? 0 : trackAt(d));
  };

  // The browser took the touch for a vertical scroll (touch-action: pan-y), or the touch was lost.
  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    presses.onPointerCancel();
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.state === "drag") settle(0, trackAt(d));
  };

  // A sideways trackpad swipe turns once; the vertical wheel scrolls the chapter as usual.
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey) return;
    const r = wheelTurn(wheel.current, { dx: e.deltaX, dy: e.deltaY, now: performance.now() });
    wheel.current = r.state;
    if (r.turn) turn(r.turn);
  };

  const panes: { key: string; role: PaneRole; section: Section | undefined }[] = [];
  if (prev !== null) panes.push({ key: prev?.id ?? "loading-prev", role: "prev", section: prev });
  panes.push({ key: current?.id ?? "loading-live", role: "live", section: current });
  if (next !== null) panes.push({ key: next?.id ?? "loading-next", role: "next", section: next });

  return (
    <div className="chapter-view relative min-h-0 flex-1">
      <div
        ref={stageRef}
        className="chapter-stage select-text"
        style={{ ["--page-h" as string]: layout.viewHeight > 0 ? `${layout.viewHeight}px` : "100vh" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
        onClickCapture={presses.onClickCapture}
        onClick={presses.onClick}
      >
        <div ref={trackRef} className="chapter-track">
          {panes.map((p) => (
            <ChapterPane
              key={p.key}
              role={p.role}
              section={p.section}
              render={renderSection}
              paneRef={p.role === "live" ? scrollerRef : undefined}
            />
          ))}
        </div>
      </div>
      <div className="chapter-dock">
        <div className="chapter-controls">
          <ChapterButton direction={-1} section={prev} hidden={controlsHidden} onClick={() => turn(-1)} />
          <div className="flex min-w-0 flex-1 justify-center">{pill}</div>
          <ChapterButton direction={1} section={next} hidden={controlsHidden} onClick={() => turn(1)} />
        </div>
        {footer}
      </div>
    </div>
  );
}

/** A floating ‹ or › circle, as in YouVersion's reader: 44px, page-coloured, a small shadow. */
function ChapterButton({
  direction,
  section,
  hidden,
  onClick,
}: {
  direction: 1 | -1;
  section: Section | null | undefined;
  hidden: boolean;
  onClick: () => void;
}) {
  if (section === null) return <span className="size-11 shrink-0" aria-hidden />;
  const Icon = direction === 1 ? ChevronRight : ChevronLeft;
  const label = direction === 1 ? "Next chapter" : "Previous chapter";
  return (
    <button
      type="button"
      className={cx("chapter-button", hidden && "is-hidden")}
      aria-label={label}
      title={section?.title ? `${label}: ${section.title}` : label}
      inert={hidden}
      onPointerDown={() => prepareHaptic("selection")}
      onClick={onClick}
    >
      <Icon size={16} strokeWidth={2.25} aria-hidden />
    </button>
  );
}
