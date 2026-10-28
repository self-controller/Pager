import type { PagerApi } from "./client";
import { createHttpApi } from "./http";
import { createMockApi } from "./mock";

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

export const api: PagerApi = selectApi(import.meta.env as ApiEnv, { latencyMs: 120 });

export type { PagerApi } from "./client";
export * from "./types";
