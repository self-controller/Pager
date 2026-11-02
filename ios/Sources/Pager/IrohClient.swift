import Foundation
import IrohLib

/// Why a request couldn't reach the computer.
enum Unreachable: Error, LocalizedError {
    /// No pairing link was ever opened on this phone.
    case noComputer
    /// The computer closed the connection: this phone isn't paired, and no pairing window is open.
    case notPaired
    /// The computer closed the connection: this phone was revoked there.
    case revoked
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .noComputer: return "This phone hasn't been paired with a computer yet."
        case .notPaired: return "Your computer doesn't know this phone (not paired)."
        case .revoked: return "Your computer revoked this phone."
        case .failed(let m): return m
        }
    }
}

/// The app's iroh endpoint and its connection to the computer. One endpoint per app run, keyed with the
/// phone's secret key from the Keychain. The connection is dialled on the first request, closed when
/// the app goes to the background, and dialled again on the next request.
actor IrohClient {
    /// iroh-relay's QUIC address discovery port, for your own relay.
    static let relayQuicPort: UInt16 = 7842

    /// A request whose response head arrived; the body is still on `recv`.
    struct Opened {
        let status: Int
        let headers: [String: String]
        let recv: RecvStream
    }

    struct Diagnostics {
        var phoneId: String?
        var computerId: String?
        var relay: String?
        var relayToken: Bool
        var paired: Bool
        var connection: String
        var rtt: String?
        var lastError: String?
    }

    private var endpoint: Endpoint?
    /// The relay setup `endpoint` was bound with; a different one binds a new endpoint.
    private var boundWith: String?
    private var connection: Connection?
    private var dialing: Task<Connection, Error>?
    private var lastError: String?

    /// Forget the connection and the endpoint (a new pairing link: maybe another computer, or relay).
    func reset() async {
        disconnect()
        dialing = nil
        if let e = endpoint {
            try? await e.close()
        }
        endpoint = nil
        boundWith = nil
    }

    /// Close the connection (the app went to the background). The next request dials again.
    func disconnect() {
        try? connection?.close(errorCode: 0, reason: Data("in the background".utf8))
        connection = nil
    }

    // MARK: Requests

    /// Send one `pager/1` request and read the response head.
    func open(method: String, path: String, headers: [String: String], body: Data) async throws -> Opened {
        let conn = try await connected()
        do {
            let bi = try await conn.openBi()
            let send = bi.send()
            let recv = bi.recv()
            try await send.writeAll(buf: try Frame.encode(Frame.RequestHead(method: method, path: path, headers: headers)))
            if !body.isEmpty {
                try await send.writeAll(buf: body)
            }
            try await send.finish()
            let n = Frame.length(try await recv.readExact(size: 4))
            guard n <= Frame.maxHeadBytes else { throw FrameError.badHead }
            let head = try JSONDecoder().decode(Frame.ResponseHead.self, from: try await recv.readExact(size: UInt32(n)))
            return Opened(status: head.status, headers: head.headers ?? [:], recv: recv)
        } catch {
            throw refusal(conn, error)
        }
    }

    /// One request with this phone's token, its body collected (up to `limit` bytes).
    func call(_ method: String, _ path: String, body: Data = Data(), limit: UInt32 = 64 << 20) async throws -> (status: Int, body: Data) {
        var headers = ["accept": "application/json"]
        if let t = Store.token {
            headers["authorization"] = "Bearer \(t)"
        }
        if !body.isEmpty {
            headers["content-type"] = "application/json"
        }
        let o = try await open(method: method, path: path, headers: headers, body: body)
        return (o.status, try await o.recv.readToEnd(sizeLimit: limit))
    }

    /// What a failed request means. When the computer closed the connection, its close code says why
    /// (API.md: 16 not paired, 17 revoked); otherwise it's the error itself.
    func refusal(_ conn: Connection, _ error: Error) -> Unreachable {
        if let u = error as? Unreachable {
            return u
        }
        guard let reason = conn.closeReason() else {
            lastError = Self.message(error)
            return .failed(Self.message(error))
        }
        if connection === conn {
            connection = nil
        }
        lastError = reason
        switch Self.closeCode(reason) {
        case 16: return .notPaired
        case 17: return .revoked
        default: return .failed(reason)
        }
    }

    /// The application close code in a close reason such as "closed by peer: revoked (code 17)".
    static func closeCode(_ reason: String) -> Int? {
        guard let r = reason.range(of: #"\(code [0-9]+\)"#, options: .regularExpression) else { return nil }
        return Int(reason[r].filter(\.isNumber))
    }

    static func message(_ error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? String(describing: error)
    }

    // MARK: The connection

    private func connected() async throws -> Connection {
        if let c = connection, c.closeReason() == nil {
            return c
        }
        connection = nil
        // Requests that arrive while one dial is under way wait for it, rather than dialling again
        // (the computer keeps at most four connections per phone).
        if let d = dialing {
            return try await d.value
        }
        let task = Task { () throws -> Connection in try await self.dial() }
        dialing = task
        defer { dialing = nil }
        do {
            let c = try await task.value
            connection = c
            lastError = nil
            Task { await self.refreshFromHealth() }
            return c
        } catch let u as Unreachable {
            lastError = u.errorDescription
            throw u
        } catch {
            lastError = Self.message(error)
            throw Unreachable.failed("Pager can't reach your computer: \(Self.message(error))")
        }
    }

    private func dial() async throws -> Connection {
        let addr = try computerAddr()
        let e = try await bound()
        return try await e.connect(addr: addr, alpn: Frame.alpn)
    }

    /// The computer's address from its ticket, with the relay health last named in place of the ticket's.
    private func computerAddr() throws -> EndpointAddr {
        guard let t = Store.ticket else { throw Unreachable.noComputer }
        let addr = try EndpointTicket.fromString(str: t).endpointAddr()
        guard let relay = Store.relay, relay != addr.relayUrl() else { return addr }
        return EndpointAddr(id: addr.id(), relayUrl: relay, addresses: addr.directAddresses())
    }

    /// The endpoint, bound for the relay setup in the Keychain: with your relay's token, that relay alone
    /// (it has no n0 discovery), carrying the token; without one, n0's relays and discovery.
    private func bound() async throws -> Endpoint {
        let relay = (try? computerAddr())?.relayUrl()
        let token = Store.relayToken
        let wanted = token.map { "\(relay ?? "")\n\($0)" } ?? "n0"
        if let e = endpoint, boundWith == wanted, !e.isClosed() {
            return e
        }
        if let e = endpoint {
            try? await e.close()
        }
        let key = try Store.secretKey()
        let options: EndpointOptions
        if let token, let relay {
            let map = RelayMap.empty()
            try map.insert(config: RelayConfig(url: relay, quicPort: Self.relayQuicPort, authToken: token))
            options = EndpointOptions(preset: presetMinimal(), secretKey: key, alpns: [Frame.alpn], relayMode: RelayMode.custom(map: map))
        } else {
            options = EndpointOptions(preset: presetN0(), secretKey: key, alpns: [Frame.alpn])
        }
        let e = try await Endpoint.bind(options: options)
        endpoint = e
        boundWith = wanted
        return e
    }

    /// Health names the relay carrying the computer now, and gives a paired phone your relay's token.
    /// Keep both for the next connection, so a moved relay or a new token doesn't strand the phone once
    /// it leaves the computer's Wi-Fi.
    private func refreshFromHealth() async {
        guard let r = try? await call("GET", "/api/health"), r.status == 200,
              let json = try? JSONSerialization.jsonObject(with: r.body) as? [String: Any],
              let remote = json["remote"] as? [String: Any] else { return }
        if let relay = remote["relay"] as? String, let t = Store.ticket, let ticketRelay = try? EndpointTicket.fromString(str: t).endpointAddr().relayUrl() {
            Store.relay = relay == ticketRelay ? nil : relay
        }
        // A paired phone is always told the token while there is one, so none means there's none now.
        if remote["device"] != nil {
            Store.relayToken = remote["relayToken"] as? String
        }
    }

    // MARK: Diagnostics

    func diagnostics() async -> Diagnostics {
        let addr = try? computerAddr()
        var d = Diagnostics(
            phoneId: nil,
            computerId: addr?.id().description,
            relay: addr?.relayUrl(),
            relayToken: Store.relayToken != nil,
            paired: Store.token != nil,
            connection: "not connected",
            rtt: nil,
            lastError: lastError
        )
        if let key = try? Store.secretKey(), let sk = try? SecretKey.fromBytes(bytes: key) {
            d.phoneId = sk.`public`().description
        }
        if let c = connection, c.closeReason() == nil {
            if let path = c.paths().first(where: { $0.isSelected }) {
                d.connection = path.isRelay ? "through the relay" : "direct, \(path.remoteAddr)"
            } else {
                d.connection = "connected"
            }
            d.rtt = c.rtt().map { "\($0) ms" }
        }
        return d
    }

    /// Fetch the largest book (its detail and every section) and time it.
    func timeDownload() async throws -> String {
        let clock = ContinuousClock()
        let start = clock.now
        let m = try await call("GET", "/api/sync/manifest")
        guard m.status == 200, let docs = (try? JSONSerialization.jsonObject(with: m.body) as? [String: Any])?["documents"] as? [[String: Any]] else {
            throw Unreachable.failed("The computer didn't send its library (\(m.status)).")
        }
        guard let doc = docs.max(by: { ($0["size"] as? Int ?? 0) < ($1["size"] as? Int ?? 0) }), let id = doc["id"] as? String else {
            return "The library is empty."
        }
        let d = try await call("GET", "/api/documents/\(Self.segment(id))")
        let toc = (try? JSONSerialization.jsonObject(with: d.body) as? [String: Any])?["toc"] as? [[String: Any]] ?? []
        var bytes = m.body.count + d.body.count
        for entry in toc {
            if let sid = entry["id"] as? String {
                bytes += try await call("GET", "/api/documents/\(Self.segment(id))/sections/\(Self.segment(sid))").body.count
            }
        }
        let seconds = (clock.now - start) / .seconds(1)
        let mb = Double(bytes) / 1_000_000
        let title = doc["title"] as? String ?? id
        return String(format: "%.2f MB (“%@”, %ld sections) in %.2f s: %.2f MB/s", mb, title, toc.count, seconds, mb / max(seconds, 0.001))
    }

    private static func segment(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? s
    }
}
