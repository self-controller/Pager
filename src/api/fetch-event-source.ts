/**
 * EventSource over fetch, for the iPhone app. Its web view gets `/api` from a scheme handler, and
 * WebKit doesn't promise that an EventSource streams from one; a fetch body does. This keeps the part
 * of EventSource that `followStream` relies on:
 * - named events and `onmessage`, each with `lastEventId`;
 * - a dropped connection, or a stream the server ended, is retried after `retry` ms (3 s unless the
 *   server says otherwise) with `Last-Event-ID`, readyState CONNECTING meanwhile;
 * - an answer that isn't a 200 event stream (401 for a phone that isn't paired) closes it for good:
 *   readyState CLOSED, then `onerror`.
 */
export function fetchEventSource(fetchImpl: typeof fetch = fetch.bind(globalThis)): typeof EventSource {
  class FetchEventSource {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSED = 2;
    readonly url: string;
    readonly withCredentials = false;
    readyState = 0;
    onopen: ((e: Event) => void) | null = null;
    onmessage: ((e: MessageEvent<string>) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    private lastEventId = "";
    private retryMs = 3000;
    private controller: AbortController | null = null;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

    constructor(url: string | URL) {
      this.url = String(url);
      void this.connect();
    }

    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
      if (!listener) return;
      let set = this.listeners.get(type);
      if (!set) this.listeners.set(type, (set = new Set()));
      set.add(listener);
    }

    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
      if (listener) this.listeners.get(type)?.delete(listener);
    }

    close() {
      this.readyState = 2;
      clearTimeout(this.timer);
      this.controller?.abort();
      this.controller = null;
    }

    private async connect() {
      const controller = new AbortController();
      this.controller = controller;
      let res: Response;
      try {
        res = await fetchImpl(this.url, {
          headers: { Accept: "text/event-stream", ...(this.lastEventId ? { "Last-Event-ID": this.lastEventId } : {}) },
          cache: "no-store",
          signal: controller.signal,
        });
      } catch {
        return this.reconnect(controller);
      }
      if (controller.signal.aborted) return;
      if (res.status !== 200 || !res.body || !(res.headers.get("content-type") ?? "").startsWith("text/event-stream")) {
        void res.body?.cancel().catch(() => {});
        this.readyState = 2;
        this.emit(new Event("error"), this.onerror);
        return;
      }
      this.readyState = 1;
      this.emit(new Event("open"), this.onopen);
      try {
        await this.read(res.body, controller);
      } catch {
        // A dropped connection: retried below.
      }
      this.reconnect(controller);
    }

    private reconnect(controller: AbortController) {
      if (controller.signal.aborted || this.readyState === 2) return;
      this.readyState = 0;
      this.emit(new Event("error"), this.onerror);
      if (this.readyState === 2) return; // onerror closed it.
      this.timer = setTimeout(() => void this.connect(), this.retryMs);
    }

    /** The event-stream format: lines of `field: value`, an empty line ends an event, `:` starts a comment. */
    private async read(body: ReadableStream<Uint8Array>, controller: AbortController) {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let data: string[] = [];
      let type = "";
      let pendingCR = false;
      const line = (l: string) => {
        if (l === "") {
          if (data.length) {
            const e = new MessageEvent<string>(type || "message", { data: data.join("\n"), lastEventId: this.lastEventId });
            this.emit(e, e.type === "message" ? this.onmessage : null);
          }
          data = [];
          type = "";
          return;
        }
        if (l.startsWith(":")) return;
        const colon = l.indexOf(":");
        const field = colon < 0 ? l : l.slice(0, colon);
        let value = colon < 0 ? "" : l.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "data") data.push(value);
        else if (field === "event") type = value;
        else if (field === "id" && !value.includes("\0")) this.lastEventId = value;
        else if (field === "retry" && /^\d+$/.test(value)) this.retryMs = Number(value);
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted) return void reader.cancel().catch(() => {});
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        // A \r\n split across two chunks is one line end, not two.
        if (pendingCR && buffer.startsWith("\n")) buffer = buffer.slice(1);
        pendingCR = false;
        let m: RegExpExecArray | null;
        const end = /\r\n|\r|\n/g;
        let start = 0;
        while ((m = end.exec(buffer))) {
          if (m[0] === "\r" && m.index === buffer.length - 1) {
            pendingCR = true;
          }
          line(buffer.slice(start, m.index));
          start = m.index + m[0].length;
        }
        buffer = buffer.slice(start);
      }
    }

    /** Listeners first, then the `on…` handler, as an EventSource does. */
    private emit<E extends Event>(e: E, handler: ((e: E) => void) | null) {
      for (const l of [...(this.listeners.get(e.type) ?? [])]) {
        if (typeof l === "function") l.call(this, e);
        else l.handleEvent(e);
      }
      handler?.call(this, e);
    }
  }
  return FetchEventSource as unknown as typeof EventSource;
}
