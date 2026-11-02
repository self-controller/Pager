import Foundation

/// `pager/1` (API.md, "Phones over iroh"): one request per bidirectional QUIC stream. Each side
/// writes a u32 big-endian length, a JSON head of at most 16 KB, then the body, then finishes.
/// Mirrors server/src/remote/protocol.rs.
enum Frame {
    static let alpn = Data("pager/1".utf8)
    static let maxHeadBytes = 16 * 1024

    struct RequestHead: Encodable {
        let v = 1
        let method: String
        /// The path and query inside the app, still percent-encoded: `/api/documents?limit=5`.
        let path: String
        /// Lower-case names.
        let headers: [String: String]
    }

    struct ResponseHead: Decodable {
        let status: Int
        let headers: [String: String]?
    }

    static func encode(_ head: RequestHead) throws -> Data {
        let json = try JSONEncoder().encode(head)
        guard json.count <= maxHeadBytes else { throw FrameError.headTooLarge }
        var out = Data()
        withUnsafeBytes(of: UInt32(json.count).bigEndian) { out.append(contentsOf: $0) }
        out.append(json)
        return out
    }

    /// The u32 big-endian length in front of a head.
    static func length(_ bytes: Data) -> Int {
        bytes.reduce(0) { $0 << 8 | Int($1) }
    }
}

enum FrameError: Error, LocalizedError {
    case headTooLarge
    case badHead

    var errorDescription: String? {
        switch self {
        case .headTooLarge: return "A request head was over 16 KB."
        case .badHead: return "The computer's answer wasn't a pager/1 head."
        }
    }
}
