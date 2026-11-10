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

/// Whether the computer can be reached, as far as the app knows.
enum Reach: String {
    /// Not tried yet (a cold start, or back from the background).
    case unknown
    case online
    /// The last dial failed. Requests are answered from the copy at once; the app keeps trying.
    case offline
}

/// The app's iroh endpoint and its connection to the computer. One endpoint per app run, keyed with the
/// phone's secret key from the Keychain. The connection is dialled on the first request, closed when
/// the app goes to the background, and dialled again on the next request.
///
/// It also keeps whether the computer can be reached (`reach`), which decides when the scheme handler
/// answers from the phone's copy. IrohLib's async calls can't be cancelled, so nothing here waits on
/// one for longer than it should: a dial runs on its own and marks the outcome when it ends.
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
        var reach: Reach
        var lastOnline: Date?
    }

    /// A dial under way: which one, its task, and when it started.
    private struct Dial {
        let id: UUID
        let task: Task<Connection, Error>
        let started: Date
    }

    /// A dial that hasn't ended after this long is given up on (it may still end, and is used if it does).
    private static let dialPatience: TimeInterval = 12

    private var endpoint: Endpoint?
    /// The relay setup `endpoint` was bound with; a different one binds a new endpoint.
    private var boundWith: String?
    private var connection: Connection?
    private var dialing: Dial?
    private var lastError: String?

    private(set) var reach: Reach = .unknown
    /// Told when the computer becomes reachable (true) or stops being (false).
    private var onReach: (@Sendable (Bool) -> Void)?
    /// The wait before looking again while offline: 15 s, doubling to 2 min.
    private var backoff: TimeInterval = 15
    private var probing: Task<Void, Never>?
    /// False while the app is in the background: nothing dials then.
    private var active = true
    /// When the computer last answered anything on the open connection.
    private var lastHeard = Date.distantPast
    /// A dial that already kept one request waiting its full patience: the next ones don't wait for it.
    private var slowDial: UUID?

    func setOnReach(_ handler: @escaping @Sendable (Bool) -> Void) {
        onReach = handler
    }

    /// Forget the connection and the endpoint (a new pairing link: maybe another computer, or relay).
    func reset() async {
        closeConnection()
        dialing = nil
        probing?.cancel()
        reach = .unknown
        backoff = 15
        if let e = endpoint {
            try? await e.close()
        }
        endpoint = nil
        boundWith = nil
    }

    /// The app went to the background: close the connection and stop looking. The next request, or
    /// `wake`, dials again.
    func disconnect() {
        active = false
        probing?.cancel()
        closeConnection()
        if reach == .online {
            // Not known any more, and not worth telling the page: it finds out on the way back.
            reach = .unknown
        }
    }

    /// The app is in front (a launch, or back from the background): look for the computer now, without
    /// waiting for the page to ask for something. Reaching it is what starts the page's sync.
    func wake() {
        active = true
        backoff = 15
        if openConnection == nil {
            probe()
        }
    }

    /// The network changed (Wi-Fi joined, signal back): worth another look.
    func networkChanged() {
        guard active, reach == .offline else { return }
        backoff = 15
        probe()
    }

    private func closeConnection() {
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
            lastHeard = Date()
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
        default:
            // The connection died under the request (the computer went to sleep): look again now.
            probe()
            return .failed(reason)
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

    /// The connection, while it is open.
    private var openConnection: Connection? {
        guard let c = connection, c.closeReason() == nil else { return nil }
        return c
    }

    private func connected() async throws -> Connection {
        if let c = openConnection {
            return c
        }
        connection = nil
        // Requests that arrive while one dial is under way wait for it, rather than dialling again
        // (the computer keeps at most four connections per phone). None waits past the dial's patience:
        // a dial can't be cancelled, and a request must get its answer.
        let task = startDial()
        guard let dial = dialing else {
            return try await task.value
        }
        let left = max(0.5, Self.dialPatience - Date().timeIntervalSince(dial.started))
        guard let outcome = await withDeadline(left, { try await task.value }) else {
            giveUp(dial.id)
            throw Unreachable.failed("Pager can't reach your computer: it didn't answer.")
        }
        return try outcome.get()
    }

    /// The dial under way, or a new one. It marks its own outcome, so it needn't be awaited.
    @discardableResult
    private func startDial() -> Task<Connection, Error> {
        if let d = dialing {
            return d.task
        }
        let id = UUID()
        let task = Task { () throws -> Connection in
            do {
                let c = try await self.dial()
                self.dialed(id, c)
                return c
            } catch {
                throw self.dialFailed(id, error)
            }
        }
        dialing = Dial(id: id, task: task, started: Date())
        return task
    }

    private func dialed(_ id: UUID, _ c: Connection) {
        if dialing?.id == id {
            dialing = nil
        }
        if openConnection != nil {
            // A dial given up on that ended after another had: one connection is enough.
            try? c.close(errorCode: 0, reason: Data("another connection is open".utf8))
            return
        }
        connection = c
        lastError = nil
        lastHeard = Date()
        setReach(.online)
        Task { await self.refreshFromHealth() }
        // Notice a connection that dies (the computer went to sleep) without waiting for a request.
        Task {
            let reason = await c.closed()
            self.connectionClosed(c, reason)
        }
    }

    private func dialFailed(_ id: UUID, _ error: Error) -> Unreachable {
        if dialing?.id == id {
            dialing = nil
        }
        if let u = error as? Unreachable {
            lastError = u.errorDescription
            return u
        }
        lastError = Self.message(error)
        if openConnection == nil {
            setReach(.offline)
        }
        return .failed("Pager can't reach your computer: \(Self.message(error))")
    }

    /// A connection ended on its own: the computer closed it, or stopped answering.
    private func connectionClosed(_ c: Connection, _ reason: String) {
        guard connection === c else { return }
        connection = nil
        guard active else { return }
        lastError = reason
        // Paired or not, the computer answered; a silence means look again, now.
        switch Self.closeCode(reason) {
        case 16, 17, 18, 19: break
        default: probe()
        }
    }

    // MARK: Whether the computer can be reached

    private func setReach(_ now: Reach) {
        guard now != reach else { return }
        reach = now
        switch now {
        case .online:
            Store.lastOnline = Date()
            backoff = 15
            probing?.cancel()
            onReach?(true)
        case .offline:
            onReach?(false)
            scheduleProbe()
        case .unknown:
            break
        }
    }

    /// Whether a connection is open, waiting up to `seconds` for a dial when the computer isn't known
    /// to be out of reach. False means: answer from the copy.
    func ready(within seconds: TimeInterval) async -> Bool {
        if openConnection != nil {
            return true
        }
        if reach == .offline || Store.ticket == nil {
            return false
        }
        giveUpStaleDial()
        startDial()
        guard let dial = dialing?.id, dial != slowDial else { return false }
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            try? await Task.sleep(nanoseconds: 50_000_000)
            if openConnection != nil {
                return true
            }
            if reach == .offline || dialing == nil {
                return false
            }
        }
        // Still dialling: the requests behind this one take the copy at once. The dial carries on, and
        // the page is told when it ends.
        slowDial = dial
        return false
    }

    /// Dial now, and look again later if that fails.
    func probe() {
        guard active, Store.ticket != nil else { return }
        if openConnection != nil {
            setReach(.online)
            return
        }
        giveUpStaleDial()
        startDial()
        scheduleProbe()
    }

    /// A request got no answer within `seconds` on the open connection. If nothing else was heard from
    /// the computer in that time either, it has gone quiet (asleep, with the connection not yet timed
    /// out): close the connection, so the next request dials afresh. One slow answer on a live
    /// connection changes nothing.
    func suspect(after seconds: TimeInterval) {
        guard connection != nil, Date().timeIntervalSince(lastHeard) >= seconds else { return }
        closeConnection()
        lastError = "The computer stopped answering."
        probe()
    }

    private func giveUpStaleDial() {
        guard let d = dialing, Date().timeIntervalSince(d.started) >= Self.dialPatience else { return }
        giveUp(d.id)
    }

    /// Stop counting on a dial that has taken too long. It isn't stopped (it can't be): if it ends in
    /// a connection after all, `dialed` takes it.
    private func giveUp(_ id: UUID) {
        if dialing?.id == id {
            dialing = nil
        }
        guard openConnection == nil else { return }
        lastError = "The computer didn't answer."
        setReach(.offline)
    }

    /// Look again after the backoff, for as long as the computer stays out of reach.
    private func scheduleProbe() {
        probing?.cancel()
        guard active else { return }
        let wait = backoff
        backoff = min(backoff * 2, 120)
        probing = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await self?.probeIfOffline()
        }
    }

    private func probeIfOffline() {
        if reach != .online {
            probe()
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
            lastError: lastError,
            reach: reach,
            lastOnline: Store.lastOnline
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
