import type { PagerApi } from "./client";
import { createHttpApi } from "./http";
import { createMockApi } from "./mock";
import { copyLink, createOfflineRuntime, type OfflineRuntime } from "../offline";

export interface ApiEnv {
  VITE_API_URL?: string;
  /** Set to "1" to force the mock even when VITE_API_URL is set. */
  VITE_USE_MOCK?: string;
  /** Set to "1" in a production build served by the backend (same origin, no proxy). */
  VITE_USE_HTTP?: string;
}

/** Mock when no backend is configured; otherwise the HTTP client on the relative /api path. */
export function selectApi(env: ApiEnv, mockOptions?: Parameters<typeof createMockApi>[0]): PagerApi {
  if (env.VITE_USE_MOCK === "1") return createMockApi(mockOptions);
  if (env.VITE_API_URL || env.VITE_USE_HTTP === "1") return createHttpApi("/api");
  return createMockApi(mockOptions);
}

/**
 * The API the UI uses. In the iPhone app it is the HTTP client behind the app's copy: answers carry
 * the changes still waiting to be sent, and a place or highlight saved while the computer can't be
 * reached is queued (src/offline). Everywhere else, `selectApi`'s choice as it is.
 */
function build(env: ApiEnv): { api: PagerApi; offline: OfflineRuntime | null } {
  const base = selectApi(env, { latencyMs: 120 });
  const link = base.mode === "http" ? copyLink() : null;
  if (!link) return { api: base, offline: null };
  const offline = createOfflineRuntime(link);
  return { api: offline.api, offline };
}

const built = build(import.meta.env as ApiEnv);

export const api: PagerApi = built.api;
/** The iPhone app's copy (downloads, the queue of waiting changes); null in a browser. */
export const offline: OfflineRuntime | null = built.offline;

export type { PagerApi } from "./client";
export * from "./types";
