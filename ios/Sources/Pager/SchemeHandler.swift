import Foundation
import IrohLib
import UniformTypeIdentifiers
import WebKit

/// The web view's one way out. On `pager-app://localhost/` it serves the UI bundled in the app, and
/// carries `/api/*` to the computer as `pager/1` requests over iroh, adding this phone's bearer
/// token. The page never holds the token: the app keeps it from the pairing answer.
@MainActor
final class PagerSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "pager-app"

    private let client: IrohClient
    private let web: URL?
    /// Requests the web view hasn't stopped. WebKit raises if a stopped task is answered.
    private var live: [ObjectIdentifier: Forward] = [:]

    /// One `/api` request in flight: its Swift task, and the stream to stop when the page hangs up.
    private final class Forward {
        var work: Task<Void, Never>?
        var recv: RecvStream?
    }

    init(client: IrohClient) {
        self.client = client
        self.web = Bundle.module.url(forResource: "web", withExtension: nil)
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        if url.path == "/api" || url.path.hasPrefix("/api/") {
            forward(task, url)
        } else {
            serveFile(task, url)
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
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

    // MARK: /api over iroh

    private func forward(_ task: WKURLSchemeTask, _ url: URL) {
        let request = task.request
        let method = request.httpMethod ?? "GET"
        // Still percent-encoded, as the server routes it.
        let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
        var path = parts?.percentEncodedPath ?? url.path
        if let q = parts?.percentEncodedQuery {
            path += "?\(q)"
        }
        var headers: [String: String] = [:]
        for (name, value) in request.allHTTPHeaderFields ?? [:] {
            let n = name.lowercased()
            // The app's credential is the only one: nothing the page sets stands in for it.
            if n == "cookie" || n == "authorization" || n == "host" { continue }
            headers[n] = value
        }
        if let token = Store.token {
            headers["authorization"] = "Bearer \(token)"
        }
        let body = request.httpBody ?? Self.readAll(request.httpBodyStream)
        let id = ObjectIdentifier(task)
        let f = Forward()
        live[id] = f
        let client = client
        f.work = Task { [weak self] in
            do {
                let opened = try await client.open(method: method, path: path, headers: headers, body: body)
                guard let self, self.live[id] != nil else {
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
                while !Task.isCancelled {
                    let chunk = try await opened.recv.read(sizeLimit: 64 * 1024)
                    if chunk.isEmpty { break }
                    guard self.live[id] != nil else { return }
                    task.didReceive(chunk)
                }
                if self.live.removeValue(forKey: id) != nil {
                    task.didFinish()
                }
            } catch {
                self?.fail(task, id, url, error)
            }
        }
    }

    /// Answer a request whose head hasn't been sent yet with what went wrong, in API.md's error shape,
    /// so the UI shows it as it would any server error. A dropped body mid-stream fails the task.
    private func fail(_ task: WKURLSchemeTask, _ id: ObjectIdentifier, _ url: URL, _ error: Error) {
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
