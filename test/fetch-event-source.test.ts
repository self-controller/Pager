import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEventSource } from "@/api/fetch-event-source";
import { createHttpApi, followStream } from "@/api/http";
import { API_VERSION, type JournalEvent } from "@/api/types";
import { outdatedSide } from "@/components/shell/UpdateNeeded";

/** A response whose body the test writes to as it goes. */
function streamResponse(status = 200, contentType = "text/event-stream") {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  const enc = new TextEncoder();
  return {
    response: new Response(body, { status, headers: { "Content-Type": contentType } }),
    write: (text: string) => controller.enqueue(enc.encode(text)),
    end: () => controller.close(),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the fetch EventSource (iPhone app)", () => {
  it("delivers named events and messages with their ids, whatever the chunking", async () => {
    const s = streamResponse();
    const fetchMock = vi.fn(async () => s.response);
    const Source = fetchEventSource(fetchMock as unknown as typeof fetch);
    const es = new Source("/api/stream");
    const got: string[] = [];
    es.addEventListener("annotation.created", (e) =>
      got.push(`named ${(e as MessageEvent).data} #${(e as MessageEvent).lastEventId}`),
    );
    es.onmessage = (e) => got.push(`message ${e.data} #${e.lastEventId}`);
    await tick();
    expect(es.readyState).toBe(1);
    s.write(": keep-alive\r\n\r\nid: 7\r");
    s.write('\nevent: annotation.created\ndata: {"a":1}\n\n');
    s.write("id: 8\ndata: line one\ndata: line two\n\n");
    s.write("data:no-space\n\nevent: ignored\n\n");
    await tick();
    expect(got).toEqual(['named {"a":1} #7', "message line one\nline two #8", "message no-space #8"]);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toEqual({ Accept: "text/event-stream" });
    es.close();
    expect(es.readyState).toBe(2);
  });

  it("reconnects after a dropped stream with Last-Event-ID, after the server's retry delay", async () => {
    vi.useFakeTimers();
    const first = streamResponse();
    const second = streamResponse();
    const fetchMock = vi.fn().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
    const Source = fetchEventSource(fetchMock as unknown as typeof fetch);
    const es = new Source("/api/stream?after=3");
    const errors: number[] = [];
    es.onerror = () => errors.push(es.readyState);
    await vi.advanceTimersByTimeAsync(0);
    first.write("retry: 500\nid: 12\ndata: x\n\n");
    first.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toEqual([0]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/stream?after=3");
    expect(init.headers).toEqual({ Accept: "text/event-stream", "Last-Event-ID": "12" });
    expect(es.readyState).toBe(1);
    es.close();
  });

  it("retries when the computer can't be reached, and closes for good when it refuses", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "unauthorized", message: "Pair this phone" } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      );
    const Source = fetchEventSource(fetchMock as unknown as typeof fetch);
    const es = new Source("/api/stream");
    const errors: number[] = [];
    es.onerror = () => errors.push(es.readyState);
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toEqual([0]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(errors).toEqual([0, 2]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a 200 that isn't an event stream as a refusal", async () => {
    const fetchMock = vi.fn(async () => new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } }));
    const es = new (fetchEventSource(fetchMock as unknown as typeof fetch))("/api/stream");
    await tick();
    expect(es.readyState).toBe(2);
  });

  it("drives followStream: events arrive, and a refused stream stays closed", async () => {
    const s = streamResponse();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(s.response)
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const events: JournalEvent[] = [];
    const stop = followStream("/api", (e) => events.push(e), fetchEventSource(fetchMock as unknown as typeof fetch));
    await tick();
    s.write(`id: 5\nevent: document.updated\ndata: ${JSON.stringify({ seq: 5, type: "document.updated" })}\n\n`);
    await tick();
    expect(events.map((e) => e.seq)).toEqual([5]);
    stop();
  });
});

describe("the API version check", () => {
  it("names the side that is behind", () => {
    expect(outdatedSide(undefined)).toBeNull();
    expect(outdatedSide({ apiVersion: API_VERSION })).toBeNull();
    expect(outdatedSide({ apiVersion: API_VERSION + 1 })).toBe("app");
    expect(outdatedSide({ apiVersion: API_VERSION - 1 })).toBe("computer");
  });
});

describe("pairing in the iPhone app", () => {
  it("passes on a poll answer whose token the app kept", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ device: { id: "d1", name: "iPhone" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const api = createHttpApi("/api", fetchMock as unknown as typeof fetch);
    const answer = await api.pollPairing({ requestId: "r1", pollSecret: "s1" });
    expect("device" in answer && answer.device.name).toBe("iPhone");
    expect("token" in answer).toBe(false);
  });
});
