import Foundation
import Security

/// What the app keeps between runs. Where the computer is (its ticket) goes in UserDefaults: it isn't
/// secret. The phone's secret key, its bearer token and your relay's token go in the Keychain,
/// readable once the phone has been unlocked after a restart, and never copied off this device.
enum Store {
    private static let defaults = UserDefaults.standard

    /// The computer's iroh ticket, from the pairing link.
    static var ticket: String? {
        get { defaults.string(forKey: "ticket") }
        set { defaults.set(newValue, forKey: "ticket") }
    }

    /// The relay health last named, when it differs from the ticket's.
    static var relay: String? {
        get { defaults.string(forKey: "relay") }
        set { defaults.set(newValue, forKey: "relay") }
    }

    /// The page colour the web UI last sent (`#rrggbb`), so a cold start paints it before the page loads.
    static var pageColor: String? {
        get { defaults.string(forKey: "page-color") }
        set { defaults.set(newValue, forKey: "page-color") }
    }

    /// The bearer token the computer gave this phone when it was paired.
    static var token: String? {
        get { Keychain.string("token") }
        set { Keychain.set("token", newValue.map { Data($0.utf8) }) }
    }

    /// Your own relay's token, from the pairing link (`rt`) or from health.
    static var relayToken: String? {
        get { Keychain.string("relay-token") }
        set { Keychain.set("relay-token", newValue.map { Data($0.utf8) }) }
    }

    /// This phone's 32-byte iroh secret key, made on first use. Its public half is the phone's endpoint
    /// ID, which the computer binds the token to, so it must survive relaunches.
    static func secretKey() throws -> Data {
        if let key = Keychain.data("endpoint-key"), key.count == 32 {
            return key
        }
        var key = Data(count: 32)
        let status = key.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
        guard status == errSecSuccess, Keychain.set("endpoint-key", key) else {
            throw StoreError.keychain(status)
        }
        return key
    }
}

enum StoreError: Error, LocalizedError {
    case keychain(OSStatus)

    var errorDescription: String? {
        switch self {
        case .keychain(let s): return "The Keychain refused to keep this phone's key (\(s))."
        }
    }
}

/// Generic passwords for this app alone.
enum Keychain {
    private static let service = "dev.pager.Pager"

    private static func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    static func data(_ account: String) -> Data? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
    }

    static func string(_ account: String) -> String? {
        data(account).flatMap { String(data: $0, encoding: .utf8) }
    }

    /// Replace the item, or delete it when `value` is nil.
    @discardableResult
    static func set(_ account: String, _ value: Data?) -> Bool {
        SecItemDelete(query(account) as CFDictionary)
        guard let value else { return true }
        var add = query(account)
        add[kSecValueData as String] = value
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }
}
