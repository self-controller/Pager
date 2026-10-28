import { describe, expect, it, vi } from "vitest";
import { selectApi } from "@/api";
import { createHttpApi, documentQueryString } from "@/api/http";
import { ApiError, ErrorCodes } from "@/api/types";

describe("selectApi", () => {
  it("uses the mock unless a backend is configured", () => {
    expect(selectApi({}, { storage: null }).mode).toBe("mock");
    expect(selectApi({ VITE_API_URL: "http://localhost:3006" }).mode).toBe("http");
    expect(selectApi({ VITE_USE_HTTP: "1" }).mode).toBe("http");
    expect(selectApi({ VITE_API_URL: "http://localhost:3006", VITE_USE_MOCK: "1" }, { storage: null }).mode).toBe("mock");
  });
});

describe("documentQueryString", () => {
  it("omits empty values", () => {
    expect(documentQueryString()).toBe("");
    expect(documentQueryString({ kind: "book", saved: false, sort: "title", q: "eyre" })).toBe(
      "?kind=book&saved=false&sort=title&q=eyre",
    );
    expect(documentQueryString({ history: true })).toBe("?history=true");
  });
});

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("http client", () => {
  it("calls the contract endpoints", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, []));
    const api = createHttpApi("/api", fetchMock as unknown as typeof fetch);
    await api.listDocuments({ kind: "article" });
    await api.getSection("a b", "s/1");
    await api.saveProgress("doc", { sectionId: "s0", offset: 0.5, percent: 0.25 });
    await api.getTree();
    await api.createFile({ dir: "Essays", title: "Notes" });
    await api.createFolder("", "Poetry");
    await api.moveEntry("a.md", "b/a.md");
    await api.deleteEntry("b/a.md");
    await api.importPath("", "~/Books");
    await api.searchDocuments("café au lait");

    const calls = fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`);
    expect(calls).toEqual([
      "GET /api/documents?kind=article",
      "GET /api/documents/a%20b/sections/s%2F1",
      "PUT /api/documents/doc/progress",
      "GET /api/tree",
      "POST /api/files",
      "POST /api/folders",
      "POST /api/files/move",
      "DELETE /api/files?path=b%2Fa.md",
      "POST /api/files/import",
      "GET /api/search/documents?q=caf%C3%A9%20au%20lait",
    ]);
    const body = (i: number) => JSON.parse(fetchMock.mock.calls[i]![1]!.body as string);
    expect(body(4)).toEqual({ dir: "Essays", title: "Notes" });
    expect(body(5)).toEqual({ dir: "", name: "Poetry" });
    expect(body(6)).toEqual({ from: "a.md", to: "b/a.md" });
    expect(body(8)).toEqual({ dir: "", path: "~/Books" });
  });

  it("turns the error envelope into an ApiError", async () => {
    const api = createHttpApi("/api", (async () =>
      jsonResponse(404, { error: { code: "not_found", message: "No such document" } })) as unknown as typeof fetch);
    await expect(api.getDocument("x")).rejects.toMatchObject({ code: "not_found", message: "No such document", status: 404 });
  });

  it("reports an unreachable backend as 'unavailable'", async () => {
    const down = createHttpApi("/api", (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    await expect(down.listDocuments()).rejects.toMatchObject({ code: ErrorCodes.unavailable });

    const proxy502 = createHttpApi("/api", (async () => new Response("Bad Gateway", { status: 502 })) as unknown as typeof fetch);
    const err = await proxy502.getTree().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(ErrorCodes.unavailable);
  });

  it("uploads multipart without forcing a JSON content type", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(202, { id: "j1", status: "queued", documentIds: [] }),
    );
    const api = createHttpApi("/api", fetchMock as unknown as typeof fetch);
    const job = await api.uploadFile(new File(["x"], "a.txt"));
    expect(job.status).toBe("queued");
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/uploads");
    await api.uploadFile(new File(["x"], "a.txt"), "Essays/Bacon");
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/uploads?dir=Essays%2FBacon");
  });

  it("accepts 204 No Content", async () => {
    const api = createHttpApi("/api", (async () => new Response(null, { status: 204 })) as unknown as typeof fetch);
    await expect(api.deleteDocument("x")).resolves.toBeUndefined();
  });
});
