import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { applyServerEvent, queryKeys } from "@/api/hooks";
import { createHttpApi, followStream, SERVER_EVENT_TYPES } from "@/api/http";
import { createMockApi } from "@/api/mock";
import { ApiError, ErrorCodes, type JournalEvent } from "@/api/types";
import { formatCode } from "@/pages/PairPage";

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("the phone and pairing calls", () => {
  it("calls the device, pairing and app-settings endpoints", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url === "/api/settings" || url === "/api/settings/app" ? jsonResponse(200, { app: { remote: { enabled: true, origin: "https://pc.ts.net" } } }) : jsonResponse(200, {}),
    );
    const api = createHttpApi("/api", fetchMock as unknown as typeof fetch);
    await api.getHealth();
    expect(await api.getAppSettings()).toEqual({ remote: { enabled: true, origin: "https://pc.ts.net" } });
    await api.updateAppSettings({ remote: { enabled: false } });
    await api.openPairing();
    await api.getPairing();
    await api.approvePairing("r1");
    await api.denyPairing("r2");
    await api.cancelPairing();
    await api.listDevices();
    await api.renameDevice("d 1", "Phone");
    await api.revokeDevice("d 1");
    await api.requestPairing("BCDF-GHJK", "iPhone");
    await api.pollPairing({ requestId: "r3", pollSecret: "s3" });
    const calls = fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`);
    expect(calls).toEqual([
      "GET /api/health",
      "GET /api/settings",
      "PATCH /api/settings/app",
      "POST /api/devices/pairing",
      "GET /api/devices/pairing",
      "POST /api/devices/pairing/approve",
      "POST /api/devices/pairing/deny",
      "DELETE /api/devices/pairing",
      "GET /api/devices",
      "PATCH /api/devices/d%201",
      "DELETE /api/devices/d%201",
      "POST /api/pair",
      "POST /api/pair/poll",
    ]);
    const body = (i: number) => JSON.parse(fetchMock.mock.calls[i]![1]!.body as string);
    expect(body(2)).toEqual({ remote: { enabled: false } });
    expect(body(5)).toEqual({ requestId: "r1" });
    expect(body(9)).toEqual({ name: "Phone" });
    expect(body(11)).toEqual({ code: "BCDF-GHJK", name: "iPhone" });
    expect(body(12)).toEqual({ requestId: "r3", pollSecret: "s3" });
  });

  it("reports a missing credential as unauthorized, and a phone asking for app settings as forbidden", async () => {
    const api = createHttpApi("/api", (async (url: string) =>
      url === "/api/settings"
        ? jsonResponse(200, { effective: {}, global: {}, document: null })
        : jsonResponse(401, { error: { code: "unauthorized", message: "Pair this phone with Pager to read your library." } })) as unknown as typeof fetch);
    await expect(api.listDocuments()).rejects.toMatchObject({ code: ErrorCodes.unauthorized, status: 401 });
    await expect(api.getAppSettings()).rejects.toMatchObject({ code: "forbidden" });
  });

  it("is backend only: the mock answers unsupported", async () => {
    const mock = createMockApi({ storage: null, latencyMs: 0 });
    for (const call of [() => mock.getHealth(), () => mock.listDevices(), () => mock.requestPairing("BCDF-GHJK", "iPhone"), () => mock.openPairing()]) {
      await expect(call()).rejects.toBeInstanceOf(ApiError);
      await expect(call()).rejects.toMatchObject({ code: ErrorCodes.unsupported });
    }
  });
});

describe("the live stream on a phone", () => {
  it("stays closed once the browser gives up on it (refused: not paired, or revoked)", () => {
    const opened: FakeSource[] = [];
    class FakeSource {
      url: string;
      readyState = 0;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      closed = false;
      constructor(url: string) {
        this.url = url;
        opened.push(this);
      }
      addEventListener() {}
      close() {
        this.closed = true;
        this.readyState = 2;
      }
    }
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const stop = followStream("/api", () => {}, FakeSource as unknown as typeof EventSource);
    // A dropped connection the browser retries by itself: nothing to do.
    opened[0]!.onerror?.();
    expect(opened[0]!.closed).toBe(false);
    // Refused (401): CLOSED, and it is not reopened when the app comes back to the front.
    opened[0]!.readyState = 2;
    opened[0]!.onerror?.();
    expect(opened[0]!.closed).toBe(true);
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(opened).toHaveLength(1);
    stop();
    vi.restoreAllMocks();
  });

  it("listens for the device and progress events", () => {
    for (const t of ["progress.updated", "device.paired", "device.renamed", "device.revoked", "device.removed"]) expect(SERVER_EVENT_TYPES).toContain(t);
  });
});

describe("applyServerEvent for phones", () => {
  const event = (type: string, docId: string | null) => ({ seq: 1, at: "", origin: "server", type, v: 1, docId, subjectId: null, payload: {} }) as JournalEvent;

  it("refreshes the library and the document when another device moves the reading place", () => {
    const qc = new QueryClient();
    for (const key of [queryKeys.document("d1"), queryKeys.documents({}), queryKeys.document("d2"), queryKeys.devices]) qc.setQueryData(key, {});
    applyServerEvent(qc, event("progress.updated", "d1"));
    const stale = (key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated;
    expect(stale(queryKeys.document("d1"))).toBe(true);
    expect(stale(queryKeys.documents({}))).toBe(true);
    expect(stale(queryKeys.document("d2"))).toBe(false);
    expect(stale(queryKeys.devices)).toBe(false);
    applyServerEvent(qc, event("device.paired", null));
    expect(stale(queryKeys.devices)).toBe(true);
  });
});

describe("the pairing code field", () => {
  it("formats what is typed as the computer shows it", () => {
    expect(formatCode("bcdfghjk")).toBe("BCDF-GHJK");
    expect(formatCode("bcd")).toBe("BCD");
    expect(formatCode("BCDF")).toBe("BCDF");
    expect(formatCode("bcdf g")).toBe("BCDF-G");
    expect(formatCode(" bc-df gh-jk zz ")).toBe("BCDF-GHJK");
    expect(formatCode("12ab34")).toBe("AB");
  });
});
