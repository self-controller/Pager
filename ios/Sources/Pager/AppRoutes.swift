import Foundation

/// The app's own routes for its page, under `/_app` (README, "The copy"). They are answered here and
/// never sent to the computer. Only the app's page can call them: the web view loads nothing else.
///
/// | Route | Does |
/// |---|---|
/// | `GET /_app/copy` | `{ generation, online, lastOnlineAt, bytes, entries, client, outbox }` |
/// | `PUT /_app/copy/client` | Stores the page's own JSON record |
/// | `POST /_app/copy/drop` | `{ tag }`: takes the tag off every answer, removing those left with none |
/// | `DELETE /_app/copy` | Removes every stored answer and the page's record. The queue stays |
/// | `POST /_app/outbox` | Adds a change to the queue, or replaces the one with the same key |
/// | `DELETE /_app/outbox/<seq>` | Removes one |
/// | `POST /_app/probe` | Looks for the computer now |
struct AppRoutes {
    static let maxClientBytes = 256 * 1024

    let client: IrohClient
    let copy: PhoneCopy
    let outbox: Outbox

    /// The status and the JSON body (empty with 204).
    func answer(method: String, path: String, body: Data) async -> (Int, Data) {
        switch (method, path) {
        case ("GET", "/_app/copy"):
            return (200, await state())
        case ("PUT", "/_app/copy/client"):
            guard body.count <= Self.maxClientBytes, (try? JSONSerialization.jsonObject(with: body)) != nil else {
                return Self.refuse(400, "The page's record should be JSON of at most 256 KB.")
            }
            await copy.setClient(body)
            return (204, Data())
        case ("POST", "/_app/copy/drop"):
            guard let tag = (try? JSONSerialization.jsonObject(with: body) as? [String: Any])?["tag"] as? String, !tag.isEmpty else {
                return Self.refuse(400, "Name the tag to drop.")
            }
            await copy.drop(tag: tag)
            return (204, Data())
        case ("DELETE", "/_app/copy"):
            await copy.wipe()
            return (204, Data())
        case ("POST", "/_app/outbox"):
            do {
                return (201, try await outbox.add(body))
            } catch Outbox.Refused.full {
                return Self.refuse(507, "Too many changes are waiting to be sent.")
            } catch Outbox.Refused.invalid(let why) {
                return Self.refuse(400, why)
            } catch {
                return Self.refuse(400, "That change couldn't be kept.")
            }
        case ("POST", "/_app/probe"):
            await client.wake()
            await client.probe()
            return (204, Data())
        default:
            let prefix = "/_app/outbox/"
            if method == "DELETE", path.hasPrefix(prefix), let seq = Int(path.dropFirst(prefix.count)) {
                await outbox.remove(seq)
                return (204, Data())
            }
            return Self.refuse(404, "The app has no such route.")
        }
    }

    private func state() async -> Data {
        let totals = await copy.totals()
        let reach = await client.reach
        var out: [String: Any] = [
            "generation": totals.generation,
            "online": reach == .unknown ? NSNull() : reach == .online,
            "lastOnlineAt": Store.lastOnline.map(Outbox.stamp) ?? NSNull(),
            "bytes": totals.bytes,
            "entries": totals.entries,
            "client": NSNull(),
            "outbox": [],
        ]
        if let record = await copy.client(), let json = try? JSONSerialization.jsonObject(with: record) {
            out["client"] = json
        }
        if let queue = try? JSONSerialization.jsonObject(with: await outbox.list()) {
            out["outbox"] = queue
        }
        return (try? JSONSerialization.data(withJSONObject: out)) ?? Data("{}".utf8)
    }

    private static func refuse(_ status: Int, _ message: String) -> (Int, Data) {
        let body = try? JSONSerialization.data(withJSONObject: ["error": ["code": status == 404 ? "not_found" : "invalid_request", "message": message]])
        return (status, body ?? Data())
    }
}
