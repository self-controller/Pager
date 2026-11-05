import { useSyncExternalStore } from "react";
import type { ContextSectionKind } from "@/api/types";

/**
 * What "Context for this" hands from the card beside the text to the tool panel: the card itself
 * (the selection it was opened on), the panel's focus (a focused briefing to show in place of the
 * whole book's), and a pending reveal for the whole-book view (a node to focus on the map, or an item
 * to scroll to). Small and eager: the panel and the card load lazily.
 */

export interface CardRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ContextCardState {
  /** A new card for each selection, so nothing carries over from the last one. */
  id: number;
  docId: string;
  /** The selection as made; the card cleans it (normalizeFocus). */
  text: string;
  rect: CardRect | null;
}

export interface PanelFocus {
  docId: string;
  /** The cleaned selection ("Malthus"). */
  focus: string;
}

export interface PendingReveal {
  docId: string;
  /** A node to focus on the connection map. */
  entity?: string;
  /** Else an item to open, scroll to and flash. */
  item?: { kind: ContextSectionKind; index: number };
  nonce: number;
}

interface State {
  card: ContextCardState | null;
  panel: PanelFocus | null;
  reveal: PendingReveal | null;
}

let state: State = { card: null, panel: null, reveal: null };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

let cards = 0;

export function openCard(card: Omit<ContextCardState, "id">): void {
  set({ card: { ...card, id: ++cards } });
}

export function closeCard(): void {
  if (state.card) set({ card: null });
}

/** Show a focused briefing in the panel (null: the whole book). */
export function setPanelFocus(panel: PanelFocus | null): void {
  set({ panel });
}

export function revealInPanel(reveal: Omit<PendingReveal, "nonce">): void {
  set({ reveal: { ...reveal, nonce: Date.now() } });
}

/** The panel has shown the reveal. */
export function clearReveal(): void {
  if (state.reveal) set({ reveal: null });
}

const card = () => state.card;
const panel = () => state.panel;
const reveal = () => state.reveal;

export function useContextCard(): ContextCardState | null {
  return useSyncExternalStore(subscribe, card, card);
}

export function usePanelFocus(): PanelFocus | null {
  return useSyncExternalStore(subscribe, panel, panel);
}

export function usePendingReveal(): PendingReveal | null {
  return useSyncExternalStore(subscribe, reveal, reveal);
}
