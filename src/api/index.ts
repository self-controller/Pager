import type { PagerApi } from "./client";
import { createHttpApi } from "./http";
import { createMockApi } from "./mock";
import { copyLink, createOfflineRuntime, type OfflineRuntime } from "../offline";

export interface ApiEnv {
  VITE_API_URL?: string;
  /** Set to "1" to force the mock even when VITE_API_URL is set. */
  VITE_USE_MOCK?: string;
  /** Set to "1" to use the backend without VITE_API_URL (a dev server behind a proxy of its own). */
  VITE_USE_HTTP?: string;
  /** Vite's flag for a production build. */
  PROD?: boolean;
}

/**
 * The HTTP client on the relative /api path when a backend is configured, and always in a
 * production build: every build is served by the backend or bundled into the iPhone app, and a
 * mock build in `dist/` would show the pretend library at localhost:3006 (`VITE_USE_MOCK=1` still
 * makes one on purpose). The mock in a dev server with no backend.
 */
export function selectApi(env: ApiEnv, mockOptions?: Parameters<typeof createMockApi>[0]): PagerApi {
  if (env.VITE_USE_MOCK === "1") return createMockApi(mockOptions);
  if (env.VITE_API_URL || env.VITE_USE_HTTP === "1" || env.PROD) return createHttpApi("/api");
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
