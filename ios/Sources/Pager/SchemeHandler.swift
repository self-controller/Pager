import Foundation
import IrohLib
import UniformTypeIdentifiers
import WebKit

/// The web view's one way out. On `pager-app://localhost/` it serves the UI bundled in the app, and
/// carries `/api/*` to the computer as `pager/1` requests over iroh, adding this phone's bearer
/// token. The page never holds the token: the app keeps it from the pairing answer.
///
/// It also keeps the phone's copy (README, "The copy"). Answers the page asked to keep, and the
/// lists every page opens with, are stored as they pass; when the computer can't be reached, a GET
/// with a stored answer gets that answer. `/_app/*` is the app's own (AppRoutes), never forwarded.
@MainActor
final class PagerSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "pager-app"
    /// The page's note on a request: keep the answer, under this tag. Never sent to the computer.
    static let keepHeader = "x-pager-keep"
    /// How long a request that has a stored answer waits for the connection before taking that answer.
    private static let dialPatience: TimeInterval = 2.5
    /// And how long it then waits for the computer's answer to begin (a computer that went to sleep
    /// leaves the connection open, and silent, for a while).
    private static let headPatience: TimeInterval = 4

    private let client: IrohClient
    private let copy: PhoneCopy
    private let routes: AppRoutes
    private let web: URL?
    /// Requests the web view hasn't stopped. WebKit raises if a stopped task is answered.
    private var live: [ObjectIdentifier: Forward] = [:]
    /// Live streams opened while the computer couldn't be reached: held open, saying nothing, and
    /// ended when it can be, so the page opens a real one from the last event it saw.
    private var held: [ObjectIdentifier: WKURLSchemeTask] = [:]

    /// One `/api` request in flight: its Swift task, and the stream to stop when the page hangs up.
    private final class Forward {
        var work: Task<Void, Never>?
        var recv: RecvStream?
    }

    init(client: IrohClient, copy: PhoneCopy, outbox: Outbox) {
        self.client = client
        self.copy = copy
        self.routes = AppRoutes(client: client, copy: copy, outbox: outbox)
        self.web = Bundle.module.url(forResource: "web", withExtension: nil)
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        if url.path == "/api" || url.path.hasPrefix("/api/") {
            forward(task, url)
        } else if url.path == "/_app" || url.path.hasPrefix("/_app/") {
            app(task, url)
        } else {
            serveFile(task, url)
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        held.removeValue(forKey: ObjectIdentifier(task))
        guard let f = live.removeValue(forKey: ObjectIdentifier(task)) else { return }
        f.work?.cancel()
        // A live stream waits in `read` until the next event; stopping the stream ends that wait, and
        // tells the computer to end the request.
        if let recv = f.recv {
            Task { try? await recv.stop(errorCode: 0) }
        }
    }

    // MARK: The bundled UI

    private func serveFile(_ task: WKURLSchemeTask, _ url: URL) {
        guard let web else {
            return respond(task, url, status: 500, headers: ["Content-Type": "text/plain"], body: Data("This build has no web UI: run ios/build-web.sh, then build again.".utf8))
        }
        let path = url.path.isEmpty ? "/" : url.path
        var file = web.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        var isDir: ObjCBool = false
        // Inside web/ only; a route of the React app (no extension) gets index.html.
        let inside = file.path.hasPrefix(web.standardizedFileURL.path)
        if !inside || !FileManager.default.fileExists(atPath: file.path, isDirectory: &isDir) || isDir.boolValue {
            guard inside, file.pathExtension.isEmpty else {
                return respond(task, url, status: 404, headers: ["Content-Type": "text/plain"], body: Data("Not found".utf8))
            }
            file = web.appendingPathComponent("index.html")
        }
        guard let data = try? Data(contentsOf: file) else {
            return respond(task, url, status: 404, headers: ["Content-Type": "text/plain"], body: Data("Not found".utf8))
        }
        var type = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        if type.hasPrefix("text/") || type == "application/javascript" || type == "application/json" {
            type += "; charset=utf-8"
        }
        respond(task, url, status: 200, headers: ["Content-Type": type, "Cache-Control": "no-cache"], body: data)
    }

    // MARK: The app's own routes

    private func app(_ task: WKURLSchemeTask, _ url: URL) {
        let request = task.request
        let method = request.httpMethod ?? "GET"
        let body = request.httpBody ?? Self.readAll(request.httpBodyStream)
        let id = ObjectIdentifier(task)
        let f = Forward()
        live[id] = f
        let routes = routes
        f.work = Task { [weak self] in
            let (status, json) = await routes.answer(method: method, path: url.path, body: body)
            self?.finish(task, id, url, status: status, headers: ["Content-Type": "application/json", "Cache-Control": "no-store"], body: json)
        }
    }

    // MARK: /api over iroh, and the copy

    private func forward(_ task: WKURLSchemeTask, _ url: URL) {
        let request = task.request
        let method = request.httpMethod ?? "GET"
        // Still percent-encoded, as the server routes it.
        let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let apiPath = parts?.percentEncodedPath ?? url.path
        var path = apiPath
        if let q = parts?.percentEncodedQuery {
            path += "?\(q)"
        }
        var headers: [String: String] = [:]
        var keep: String?
        for (name, value) in request.allHTTPHeaderFields ?? [:] {
            let n = name.lowercased()
            // The app's credential is the only one: nothing the page sets stands in for it.
            if n == "cookie" || n == "authorization" || n == "host" { continue }
            if n == Self.keepHeader {
                keep = value
                continue
            }
            headers[n] = value
        }
        if let token = Store.token {
            headers["authorization"] = "Bearer \(token)"
        }
        let body = request.httpBody ?? Self.readAll(request.httpBodyStream)
        let isStream = method == "GET" && apiPath == "/api/stream"
        // Answers that may be kept, and read back: GETs, but never the stream or pairing.
        let keeps = method == "GET" && !isStream && !apiPath.hasPrefix("/api/pair")
        let key = path
        let id = ObjectIdentifier(task)
        let f = Forward()
        live[id] = f
        let client = client
        let copy = copy
        f.work = Task { [weak self] in
            guard let self else { return }
            let stored = keeps ? await copy.has(key) : false
            if stored, !(await client.ready(within: Self.dialPatience)) {
                await self.answerFromCopy(task, id, url, key)
                return
            }
            if !stored, await client.reach == .offline {
                // Known to be out of reach: answer now rather than after a dial. The app keeps looking.
                if isStream {
                    self.hold(task, id, url)
                } else {
                    self.fail(task, id, url, Unreachable.failed("Your computer can't be reached right now."))
                }
                return
            }
            do {
                let opened: IrohClient.Opened
                if stored {
                    let answer = await withDeadline(
                        Self.headPatience,
                        { try await client.open(method: method, path: path, headers: headers, body: body) },
                        late: { try? await $0.recv.stop(errorCode: 0) }
                    )
                    guard let answer else {
                        await client.suspect(after: Self.headPatience)
                        await self.answerFromCopy(task, id, url, key)
                        return
                    }
                    opened = try answer.get()
                } else {
                    opened = try await client.open(method: method, path: path, headers: headers, body: body)
                }
                guard self.live[id] != nil else {
                    try? await opened.recv.stop(errorCode: 0)
                    return
                }
                f.recv = opened.recv
                if method == "POST", path == "/api/pair/poll", opened.status == 200 {
                    // The answer that carries the credential: keep it, and pass the rest on.
                    let answer = try await opened.recv.readToEnd(sizeLimit: 1 << 20)
                    self.finish(task, id, url, status: 200, headers: opened.headers, body: Self.keepToken(answer))
                    return
                }
                self.begin(task, id, url, status: opened.status, headers: opened.headers)
                var kept: Data?
                if keeps, opened.status == 200, await copy.wants(key: key, path: apiPath, tag: keep) {
                    kept = Data()
                }
                while !Task.isCancelled {
                    let chunk = try await opened.recv.read(sizeLimit: 64 * 1024)
                    if chunk.isEmpty { break }
                    guard self.live[id] != nil else { return }
                    task.didReceive(chunk)
                    if kept != nil {
                        kept!.append(chunk)
                        if kept!.count > PhoneCopy.maxBody {
                            kept = nil
                        }
                    }
                }
                // Only an answer the page got whole is kept.
                guard self.live.removeValue(forKey: id) != nil else { return }
                task.didFinish()
                if let kept {
                    let type = opened.headers["content-type"] ?? opened.headers["Content-Type"] ?? "application/octet-stream"
                    await copy.store(key: key, path: apiPath, type: type, body: apiPath == "/api/health" ? Self.withoutRelayToken(kept) : kept, tag: keep)
                }
            } catch {
                // Not reached, and nothing sent to the page yet: the stored answer, or a held stream.
                // A phone the computer refused (not paired, revoked) gets that refusal instead.
                if f.recv == nil, !Self.refused(error) {
                    if stored {
                        await self.answerFromCopy(task, id, url, key)
                        return
                    }
                    if isStream {
                        self.hold(task, id, url)
                        return
                    }
                }
                self.fail(task, id, url, error)
            }
        }
    }

    /// The computer came within reach (true) or went out of it. Held streams end, so the page opens
    /// real ones.
    func reachChanged(_ online: Bool) {
        guard online else { return }
        for (id, task) in held where live.removeValue(forKey: id) != nil {
            task.didFinish()
        }
        held.removeAll()
    }

    /// Answer a GET from the phone's copy, marked as such.
    private func answerFromCopy(_ task: WKURLSchemeTask, _ id: ObjectIdentifier, _ url: URL, _ key: String) async {
        guard let hit = await copy.read(key) else {
            fail(task, id, url, Unreachable.failed("Your computer can't be reached right now."))
            return
        }
        let headers = ["Content-Type": hit.type, "Cache-Control": "no-store", "x-pager-offline": "1", "x-pager-stored-at": Outbox.stamp(hit.storedAt)]
        finish(task, id, url, status: 200, headers: headers, body: hit.body)
    }

    /// Open the live stream and say nothing: the page's stream waits (it retries a failed one every
    /// 3 s, and closes for good on an error answer). `reachChanged` ends it.
    private func hold(_ task: WKURLSchemeTask, _ id: ObjectIdentifier, _ url: URL) {
        guard live[id] != nil, let res = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/event-stream", "Cache-Control": "no-store"]) else { return }
        task.didReceive(res)
        task.didReceive(Data(": waiting for your computer\n\n".utf8))
        held[id] = task
    }

    /// Whether the computer answered and turned this phone away (so the copy must not stand in).
    private static func refused(_ error: Error) -> Bool {
        switch error as? Unreachable {
        case .notPaired?, .revoked?, .noComputer?: return true
        default: return false
        }
    }

    /// Health without your relay's token: the token stays in the Keychain, not in the copy.
    private static func withoutRelayToken(_ health: Data) -> Data {
        guard var json = try? JSONSerialization.jsonObject(with: health) as? [String: Any], var remote = json["remote"] as? [String: Any], remote["relayToken"] != nil else {
            return health
        }
        remote.removeValue(forKey: "relayToken")
        json["remote"] = remote
        return (try? JSONSerialization.data(withJSONObject: json)) ?? health
    }

    /// Answer a request whose head hasn't been sent yet with what went wrong, in API.md's error shape,
    /// so the UI shows it as it would any server error. A dropped body mid-stream fails the task.
    private func fail(_ task: WKURLSchemeTask, _ id: ObjectIdentifier, _ url: URL, _ error: Error) {
        if case .revoked? = error as? Unreachable {
            // Revoked on the computer: this phone may no longer read the library, so its downloads go.
            // Changes still waiting stay: they are sent if the same computer pairs this phone again.
            let copy = copy
            Task { await copy.wipe() }
        }
        guard let f = live.removeValue(forKey: id) else { return }
        if f.recv != nil {
            task.didFailWithError(URLError(.networkConnectionLost))
            return
        }
        let (status, code, message) = Self.answer(for: error)
        let body = (try? JSONSerialization.data(withJSONObject: ["error": ["code": code, "message": message]])) ?? Data()
        respond(task, url, status: status, headers: ["Content-Type": "application/json"], body: body)
    }

    /// The status, error code and message the UI gets for a request that didn't reach the computer.
    private static func answer(for error: Error) -> (Int, String, String) {
        switch error as? Unreachable {
        case .notPaired?:
            return (401, "unauthorized", "Pair this phone with Pager to read your library.")
        case .revoked?:
            Store.token = nil
            return (401, "unauthorized", "Your computer revoked this phone. Pair it again to read your library.")
        case .noComputer?:
            return (503, "unavailable", "Scan the code your computer shows to pair this phone.")
        default:
            return (503, "unavailable", "Pager can't reach your computer right now. Is it on, with remote access turned on? (\(IrohClient.message(error)))")
        }
    }

    private func begin(_ task: WKURLSchemeTask, _ id: ObjectIdentifier, _ url: URL, status: Int, headers: [String: String]) {
        guard live[id] != nil, let res = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else { return }
        task.didReceive(res)
    }

    private func finish(_ task: WKURLSchemeTask, _ id: ObjectIdentifier, _ url: URL, status: Int, headers: [String: String], body: Data) {
        guard live.removeValue(forKey: id) != nil else { return }
        var h = headers
        h["content-length"] = String(body.count)
        respond(task, url, status: status, headers: h, body: body)
    }

    private func respond(_ task: WKURLSchemeTask, _ url: URL, status: Int, headers: [String: String], body: Data) {
        guard let res = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.cannotParseResponse))
            return
        }
        task.didReceive(res)
        task.didReceive(body)
        task.didFinish()
    }

    /// Save `token` from the pairing answer to the Keychain and take it out of the JSON.
    private static func keepToken(_ answer: Data) -> Data {
        guard var json = try? JSONSerialization.jsonObject(with: answer) as? [String: Any], let token = json["token"] as? String else {
            return answer
        }
        Store.token = token
        json.removeValue(forKey: "token")
        return (try? JSONSerialization.data(withJSONObject: json)) ?? Data("{}".utf8)
    }

    private static func readAll(_ stream: InputStream?) -> Data {
        guard let stream else { return Data() }
        stream.open()
        defer { stream.close() }
        var out = Data()
        var buf = [UInt8](repeating: 0, count: 64 * 1024)
        while stream.hasBytesAvailable {
            let n = stream.read(&buf, maxLength: buf.count)
            if n <= 0 { break }
            out.append(buf, count: n)
        }
        return out
    }
}
