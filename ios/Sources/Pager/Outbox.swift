import Foundation

/// Changes made while the computer couldn't be reached, in the order they were made (README, "The
/// copy"). The page writes each one as the request it will send and sends the queue itself when the
/// computer is back; this keeps them on disk in between, so they survive the app being closed.
///
/// Unlike the copy, the queue is in backups: it is the only place these changes exist.
actor Outbox {
    enum Refused: Error {
        /// Not an entry: no key, a method or path the queue doesn't take, or too large.
        case invalid(String)
        case full
    }

    static let maxEntries = 5000
    static let maxEntryBytes = 256 * 1024

    /// What may wait: a reading place, a new highlight or note, and a change to or delete of one.
    private static let routes: [(method: String, pattern: String)] = [
        ("PUT", #"^/api/documents/[^/?#]+/progress$"#),
        ("POST", #"^/api/documents/[^/?#]+/annotations$"#),
        ("PATCH", #"^/api/annotations/[^/?#]+$"#),
        ("DELETE", #"^/api/annotations/[^/?#]+$"#),
    ]

    private let file: URL
    private var next = 1
    private var entries: [[String: Any]] = []

    init() {
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent("Pager", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        file = dir.appendingPathComponent("outbox.json")
        if let data = try? Data(contentsOf: file), let stored = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            entries = stored["entries"] as? [[String: Any]] ?? []
            next = max(stored["next"] as? Int ?? 1, (entries.compactMap { $0["seq"] as? Int }.max() ?? 0) + 1)
        }
    }

    var count: Int { entries.count }

    /// The queue as a JSON array, oldest first.
    func list() -> Data {
        (try? JSONSerialization.data(withJSONObject: entries)) ?? Data("[]".utf8)
    }

    /// Add an entry (`{ key, method, path, body?, meta? }`), or put it in place of the one with the
    /// same key, where that one is. Answers `{ seq, at }`.
    func add(_ json: Data) throws -> Data {
        guard json.count <= Self.maxEntryBytes else { throw Refused.invalid("That change is too large to keep.") }
        guard let sent = try? JSONSerialization.jsonObject(with: json) as? [String: Any],
              let key = sent["key"] as? String, !key.isEmpty, key.count <= 200,
              let method = sent["method"] as? String,
              let path = sent["path"] as? String
        else { throw Refused.invalid("An entry needs a key, a method and a path.") }
        let takes = Self.routes.contains { $0.method == method && path.range(of: $0.pattern, options: .regularExpression) != nil }
        guard takes else { throw Refused.invalid("That request can't wait in the queue.") }

        let at = Self.stamp(Date())
        var entry: [String: Any] = ["key": key, "method": method, "path": path, "at": at, "meta": sent["meta"] as? [String: Any] ?? [:]]
        if let body = sent["body"], !(body is NSNull) {
            entry["body"] = body
        }
        let seq: Int
        if let i = entries.firstIndex(where: { $0["key"] as? String == key }) {
            seq = entries[i]["seq"] as? Int ?? next
            entry["seq"] = seq
            entries[i] = entry
        } else {
            guard entries.count < Self.maxEntries else { throw Refused.full }
            seq = next
            next += 1
            entry["seq"] = seq
            entries.append(entry)
        }
        save()
        return (try? JSONSerialization.data(withJSONObject: ["seq": seq, "at": at])) ?? Data("{}".utf8)
    }

    func remove(_ seq: Int) {
        let before = entries.count
        entries.removeAll { $0["seq"] as? Int == seq }
        if entries.count != before {
            save()
        }
    }

    /// Forget everything (the phone was paired with another computer: these changes aren't its).
    func clear() {
        entries = []
        save()
    }

    private func save() {
        guard let data = try? JSONSerialization.data(withJSONObject: ["next": next, "entries": entries]) else { return }
        try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    /// The time as the page writes it: ISO-8601 with milliseconds, UTC.
    static func stamp(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: date)
    }
}
