import Foundation

/// What the computer's QR code carries: `pager://pair?v=1&t=<ticket>&code=XXXX-XXXX[&rt=<relay token>]`
/// (server/src/remote/client.rs parses the same link for the fake phone).
struct PairLink: Equatable {
    let ticket: String
    let code: String
    /// Your own relay's token, when the computer runs one.
    let relayToken: String?

    init?(_ url: URL) {
        guard url.scheme == "pager", url.host == "pair", let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else {
            return nil
        }
        func value(_ name: String) -> String? {
            guard let v = items.first(where: { $0.name == name })?.value, !v.isEmpty else { return nil }
            return v
        }
        guard value("v") == "1", let ticket = value("t"), let code = value("code") else { return nil }
        self.ticket = ticket
        self.code = code
        self.relayToken = value("rt")
    }
}
