import { useSyncExternalStore } from "react";
import type { PagerTool, SelectionAction } from "./types";

/**
 * Tool registry. Empty by design in this pass. To add a tool, create it under src/tools/ and
 * register it at startup (e.g. in src/tools/index.ts, imported from main.tsx):
 *
 *   registerTool({ id: "define", label: "Define", icon: BookA, selectionActions: [...] });
 */

let tools: readonly PagerTool[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/** Registers a tool and returns a function that unregisters it. Re-registering an id replaces it. */
export function registerTool(tool: PagerTool): () => void {
  tools = [...tools.filter((t) => t.id !== tool.id), tool];
  emit();
  return () => {
    tools = tools.filter((t) => t !== tool);
    emit();
  };
}

export function getTools(): readonly PagerTool[] {
  return tools;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTools(): readonly PagerTool[] {
  return useSyncExternalStore(subscribe, getTools, getTools);
}

/** Every selection action across registered tools, in registration order. */
export function useSelectionActions(): { tool: PagerTool; action: SelectionAction }[] {
  const all = useTools();
  return all.flatMap((tool) => (tool.selectionActions ?? []).map((action) => ({ tool, action })));
}

// ---- Opening the tool panel from a tool (an Overlay's "Open in Context") ----

let requested: { toolId: string; nonce: number } | null = null;
const panelListeners = new Set<() => void>();

/** Opens the reader's tool panel on this tool. The reader opens the panel; the panel selects the tool. */
export function openToolPanel(toolId: string): void {
  requested = { toolId, nonce: (requested?.nonce ?? 0) + 1 };
  panelListeners.forEach((l) => l());
}

/** The last tool asked for (each request is a new object), or null. */
export function getRequestedTool(): { toolId: string; nonce: number } | null {
  return requested;
}

/** Calls `listener` on each `openToolPanel`; returns the unsubscribe. */
export function onToolPanelRequest(listener: () => void): () => void {
  panelListeners.add(listener);
  return () => panelListeners.delete(listener);
}

export function useRequestedTool(): { toolId: string; nonce: number } | null {
  return useSyncExternalStore(onToolPanelRequest, getRequestedTool, getRequestedTool);
}
