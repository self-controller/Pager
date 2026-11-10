import CryptoKit
import Foundation

/// The phone's copy of answers from the computer (README, "The copy"): what the page reads from when
/// the computer can't be reached. It knows nothing about books. It keeps whole 200 answers to GETs
/// under their path and query, each with the tags it was kept for, and one JSON record that belongs
/// to the page. The page decides what to download; this stores and returns bytes.
///
/// It lives in Application Support (not Caches, which iOS empties when space is short), is left out of
/// backups (it comes back from the computer), and is readable once the phone has been unlocked.
actor PhoneCopy {
    /// The lists that are always kept, whatever their query. The page's stand-in names the same ones
    /// (`KEPT_LISTS`, src/offline/dev.ts).
    static let lists: Set<String> = [
        "/api/documents", "/api/tree", "/api/highlights", "/api/tags", "/api/health", "/api/settings", "/api/presets",
        "/api/tools/context/briefings",
    ]
    /// The tag of the lists and covers.
    static let shellTag = "shell"
    /// A larger answer is passed on but not kept (the server's own limit for a picture is 30 MB).
    static let maxBody = 48 * 1024 * 1024
    /// A list answer nobody has read for this long is dropped at launch; it comes back when asked for.
    private static let listLife: TimeInterval = 30 * 24 * 60 * 60

    struct Entry: Codable {
        /// The body's file in `blobs/`.
        var file: String
        var type: String
        var size: Int
        var storedAt: Date
        var readAt: Date
        var tags: [String]
    }

    struct Hit {
        let type: String
        let body: Data
        let storedAt: Date
    }

    private let dir: URL
    private var index: [String: Entry] = [:]
    private var generation: String
    private var saving: Task<Void, Never>?

    private var blobs: URL { dir.appendingPathComponent("blobs", isDirectory: true) }
    private var indexFile: URL { dir.appendingPathComponent("index.json") }
    private var clientFile: URL { dir.appendingPathComponent("client.json") }
    private var generationFile: URL { dir.appendingPathComponent("generation") }

    init() {
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        dir = base.appendingPathComponent("Pager", isDirectory: true).appendingPathComponent("copy", isDirectory: true)
        generation = UUID().uuidString
        Self.prepare(dir)
        if let data = try? Data(contentsOf: dir.appendingPathComponent("index.json")), let stored = try? JSONDecoder().decode([String: Entry].self, from: data) {
            index = stored
        }
        let file = dir.appendingPathComponent("generation")
        if let g = try? String(contentsOf: file, encoding: .utf8), !g.isEmpty {
            generation = g
        } else {
            try? Data(generation.utf8).write(to: file, options: .atomic)
        }
    }

    /// The folders, left out of backups and readable after the first unlock (files made inside take
    /// the folder's protection).
    private static func prepare(_ dir: URL) {
        let fm = FileManager.default
        let blobs = dir.appendingPathComponent("blobs", isDirectory: true)
        try? fm.createDirectory(at: blobs, withIntermediateDirectories: true)
        for folder in [dir, blobs] {
            try? fm.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: folder.path)
        }
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var d = dir
        try? d.setResourceValues(values)
    }

    // MARK: Answers

    /// Whether an answer is stored for this path and query.
    func has(_ key: String) -> Bool {
        index[key] != nil
    }

    /// The stored answer. An entry whose body is gone is forgotten.
    func read(_ key: String) -> Hit? {
        guard var entry = index[key] else { return nil }
        guard let body = try? Data(contentsOf: blobs.appendingPathComponent(entry.file)) else {
            index[key] = nil
            save()
            return nil
        }
        // Once an hour is enough to tell what is still in use.
        if Date().timeIntervalSince(entry.readAt) > 3600 {
            entry.readAt = Date()
            index[key] = entry
            save()
        }
        return Hit(type: entry.type, body: body, storedAt: entry.storedAt)
    }

    /// Whether a 200 answer to a GET of `key` (whose path is `path`) is kept: the page asked for it
    /// (`tag`), it is kept already (so it is refreshed), or it is one of the lists.
    func wants(key: String, path: String, tag: String?) -> Bool {
        tag != nil || index[key] != nil || Self.lists.contains(path)
    }

    func store(key: String, path: String, type: String, body: Data, tag: String?) {
        guard body.count <= Self.maxBody else { return }
        let file = Self.name(key)
        do {
            try body.write(to: blobs.appendingPathComponent(file), options: .atomic)
        } catch {
            return
        }
        var tags = Set(index[key]?.tags ?? [])
        if let tag, !tag.isEmpty, tag.count <= 300 {
            tags.insert(tag)
        }
        if Self.lists.contains(path) {
            tags.insert(Self.shellTag)
        }
        let now = Date()
        index[key] = Entry(file: file, type: type, size: body.count, storedAt: now, readAt: now, tags: tags.sorted())
        save()
    }

    /// Take `tag` off every answer; the ones left with no tag are removed.
    func drop(tag: String) {
        for (key, entry) in index where entry.tags.contains(tag) {
            let left = entry.tags.filter { $0 != tag }
            if left.isEmpty {
                try? FileManager.default.removeItem(at: blobs.appendingPathComponent(entry.file))
                index[key] = nil
            } else {
                index[key]?.tags = left
            }
        }
        save()
    }

    /// Remove every answer and the page's record: the downloads are gone. A new generation says so.
    func wipe() {
        saving?.cancel()
        try? FileManager.default.removeItem(at: dir)
        Self.prepare(dir)
        index = [:]
        generation = UUID().uuidString
        try? Data(generation.utf8).write(to: generationFile, options: .atomic)
    }

    // MARK: The page's record

    func client() -> Data? {
        try? Data(contentsOf: clientFile)
    }

    func setClient(_ json: Data) {
        try? json.write(to: clientFile, options: .atomic)
    }

    // MARK: Totals and upkeep

    func totals() -> (generation: String, entries: Int, bytes: Int) {
        (generation, index.count, index.values.reduce(0) { $0 + $1.size })
    }

    /// At launch: forget list answers nobody has read in a month, and bodies the index doesn't name.
    func prune() {
        let old = Date().addingTimeInterval(-Self.listLife)
        for (key, entry) in index where entry.tags == [Self.shellTag] && entry.readAt < old {
            try? FileManager.default.removeItem(at: blobs.appendingPathComponent(entry.file))
            index[key] = nil
        }
        let named = Set(index.values.map(\.file))
        for file in (try? FileManager.default.contentsOfDirectory(atPath: blobs.path)) ?? [] where !named.contains(file) {
            try? FileManager.default.removeItem(at: blobs.appendingPathComponent(file))
        }
        save()
    }

    /// Write the index now (the app is going to the background).
    func flush() {
        saving?.cancel()
        saving = nil
        write()
    }

    /// Write the index shortly: a download stores many answers in a row.
    private func save() {
        saving?.cancel()
        saving = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled else { return }
            await self?.write()
        }
    }

    private func write() {
        guard let data = try? JSONEncoder().encode(index) else { return }
        try? data.write(to: indexFile, options: .atomic)
    }

    /// A file name for a path and query: its SHA-256, in hex.
    private static func name(_ key: String) -> String {
        SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
