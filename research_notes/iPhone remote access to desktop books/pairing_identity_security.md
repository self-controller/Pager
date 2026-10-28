# Secure Device Pairing and Persistent Authorization: iPhone app to desktop "Pager" (Node 22 + Hono + SQLite)

Research date: 2026-10-26. Library maintenance data was pulled live from the GitHub REST API and the npm registry on that date. "pushed" is the repository's last push date, and "npm latest" is the newest published version and its date. Context: a single-user, self-hosted file server (books and articles) on Fedora, port 3006, and an iPhone client that needs durable, revocable access, including remote access.

## 1. Pairing UX patterns and their security properties

### Takeaway
The best fit for this project is a QR code shown on the desktop and scanned by the phone. A QR code can carry high-entropy material: the server's key fingerprint plus a one-time secret of at least 128 bits. That authenticates both sides at once, so no PAKE is needed. Typed short codes, static "computer ID + password", and account/cloud-brokered flows (RFC 8628, Nextcloud Login Flow v2, Plex PIN) are weaker or need extra machinery. A typed short code over an unauthenticated channel either needs a PAKE or needs strict attempt limits plus fingerprint comparison.

### Cited Findings
- **RFC 8628 (OAuth Device Authorization Grant), user-code entropy.** User codes have "less entropy than a device code," and the RFC recommends rate-limiting attempts. With an 8-character base-20 code (charset "BCDFGHJKLMNPQRSTVWXZ", about 34.5 bits), the rate limit and validity period "would need to only allow 5 attempts" to keep the chance of a correct guess at 2^-32. A 9-digit numeric code (10^9) is offered as "a good choice for usability" in some locales. — [RFC 8628 §5.1, §6.1](https://datatracker.ietf.org/doc/html/rfc8628#section-5)
- **RFC 8628, other device-flow threats.** The device code itself (never shown to the user) "SHOULD" be very high entropy. Clients should tell users they are authorizing a device ("remote phishing", §5.4). Code lifetime should be short enough to limit phishing. Shoulder-surfing ("session spying", §5.5) is called out. Polling must respect `interval` (default 5 s) and `slow_down` (+5 s). Device clients should be treated as public clients (§5.6). — [RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628#section-5)
- **Magic-wormhole code phrases.** The default code (for example `7-crossover-clockwork`) is a "16-bit code," giving an attacker a 1-in-65536 chance per attempt. Codes are single-use, so a malicious mailbox server gets one guess per attempt, and a wrong guess makes the legitimate peer fail with a "crowded"/"scary" error. The code needs no IP addresses because a rendezvous ("mailbox") server relays the PAKE messages. — [magic-wormhole docs](https://magic-wormhole.readthedocs.io/en/latest/welcome.html)
- **Magic-wormhole uses SPAKE2 for the shared secret.** Traffic is then end-to-end encrypted with NaCl "secretbox" using keys derived from the PAKE secret. The transit relay "carries only encrypted data." — [magic-wormhole docs](https://magic-wormhole.readthedocs.io/en/latest/welcome.html)
- **Jellyfin Quick Connect (reverse flow).** The new device displays a "6-character code," and a user already signed in on another client enters it under Settings > Quick Connect. The new device is then "logged in automatically." The feature can be disabled server-wide. — [Jellyfin docs](https://jellyfin.org/docs/general/server/quick-connect/)
- **Jellyfin source details.** `CodeLength = 6` (numeric, generated with `RandomNumberGenerator`), `Timeout = 10` (minutes). The polling secret is 32 random bytes, hex-encoded. — [QuickConnectManager.cs](https://github.com/jellyfin/jellyfin/blob/master/Emby.Server.Implementations/QuickConnect/QuickConnectManager.cs)
- **Nextcloud Login Flow v2 (browser-approval flow).** The client POSTs anonymously to `/index.php/login/v2` and gets a `poll.token`, a `poll.endpoint`, and a `login` URL. The user logs in (including 2FA) in a browser. The client polls `/login/v2/poll` about once per second, which returns 404 until done. The token is valid for 20 minutes, and the 200 response containing `server`, `loginName` and `appPassword` "will only be returned once." — [Nextcloud Login Flow docs](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html)
- **Plex PIN linking (cloud-brokered).** The client does `POST https://plex.tv/api/v2/pins` (`strong=true`, `X-Plex-Client-Identifier`) and gets `id` and `code`. The user claims it at the plex.tv auth URL, and the client polls `GET /api/v2/pins/<id>` about once per second until `authToken` is populated. The PIN is "time-limited." — [Plex forum: Authenticating with Plex](https://forums.plex.tv/t/authenticating-with-plex/609370)
- **Syncthing's long, unwieldy device IDs.** Its own docs say long device IDs are hard to read aloud, type or verify, and suggest shorter IDs with verification or out-of-band PIN pairing as possible improvements. — [Syncthing device IDs](https://docs.syncthing.net/dev/device-ids.html)

### Inferences
- **QR code (recommended).** The camera reading the desktop screen is an authenticated out-of-band channel: an attacker must see the screen. A QR code can therefore carry (a) the server's TLS public-key/cert fingerprint, so the phone pins the server and defeats MITM even on the very first connection, (b) a one-time pairing secret of at least 128 bits, which authenticates the phone to the server without a PAKE because it can't be brute-forced, and (c) candidate addresses (LAN IP:port, overlay/VPN name). This is the same idea as Syncthing's "device ID = cert hash," delivered without typing.
- **Short numeric code typed on the phone.** Without a PAKE, a 6-digit code over TLS with a not-yet-pinned cert is open to an active MITM, who can terminate TLS and relay the code. With a PAKE, the attacker gets one online guess per pairing attempt (magic-wormhole's model). Either way, pairing mode should be a short-lived window the user opens on the desktop.
- **"Computer ID + password" (TeamViewer style).** This is a persistent low-entropy secret that is reachable from the internet. It invites online brute force and phishing, and it needs OPAQUE/SRP plus lockout to be sound. It is not recommended for a file server.
- **Reverse flow (phone shows code, desktop approves, Jellyfin style).** Remote attackers can't brute-force it, because the code must be typed or approved on the trusted desktop UI. However, a MITM on the first connection could substitute its own device key unless the desktop also shows a fingerprint/SAS of the phone's key for the user to compare.
- **RFC 8628 / Login Flow v2 / Plex PIN** all assume a separate authorization server or browser login. For a single-user desktop with no account system, they add infrastructure without adding security over a QR code. They make sense only if a cloud relay/account service is added later.

### Gaps
- No primary documentation on TeamViewer's current ID/password authentication internals was fetched, so no claims are made about it.
- The default expiry of Plex PINs and the meaning of `strong=true` are not documented in the source found.

## 2. PAKE protocols for low-entropy codes, and maintained JS/Node and Swift implementations

### Takeaway
SPAKE2 (RFC 9382) and OPAQUE (RFC 9807) are now RFCs, and CPace (draft-21) is in the RFC Editor queue. On iOS, though, none of the three has a maintained native Swift library. SRP-6a is the only PAKE with maintained libraries on both Node (`fast-srp-hap`, as used by HAP-NodeJS) and Swift (`adam-fowler/swift-srp`), plus a battle-tested reference protocol (HomeKit). For this project, a PAKE is only needed if a typed-code fallback is added. The QR flow does not need one.

### Cited Findings
- **SPAKE2:** RFC 9382, September 2023, Informational. A protocol for two parties that share a password to derive a strong shared key without disclosing the password. — [RFC 9382](https://www.rfc-editor.org/rfc/rfc9382.html)
- **OPAQUE:** RFC 9807, an augmented (asymmetric) PAKE for client-server mutual authentication "without reliance on PKI." It is Informational (IRTF CFRG), with authors from AWS, Meta and Cloudflare, and specifies one 3DH-based instantiation. Datatracker/RFC Editor list July 2025, while one copy of the text says June 2025. — [RFC 9807](https://www.rfc-editor.org/rfc/rfc9807.html); [Datatracker](https://datatracker.ietf.org/doc/rfc9807)
- **CPace:** the latest revision is draft-irtf-cfrg-cpace-21 (2026-04-22), intended as Informational in the IRTF stream. State is "Sent to the RFC Editor" / "IESG Review Completed," and the RFC Editor status is "Awaiting First editor." The abstract describes a balanced PAKE "tailored for constrained devices." — [Datatracker CPace](https://datatracker.ietf.org/doc/draft-irtf-cfrg-cpace/)
- **CPace implementations seen.** A Go package internal to rsc.io (`rsc.io/cmd/mote/internal/cpace`, following rev 21) and a Python `cpace` package on PyPI (checked against rev 21). — [pkg.go.dev](https://pkg.go.dev/rsc.io/cmd/mote/internal/cpace); [PyPI cpace](https://pypi.org/project/cpace/)
- **TypeScript CPace.** The only one found, `slava-nikulin/cpace-ts`, has 0 stars (pushed 2026-10-14, MIT), so it is experimental. — [GitHub](https://github.com/slava-nikulin/cpace-ts)
- **SPAKE2 in JS.** No maintained pure-JS package claiming RFC 9382 conformance was found. `spake2-wasm` is unmaintained: last push 2021-09-08, npm 0.2.0 from 2021-08-11. — [GitHub okdistribute/spake2-wasm](https://github.com/okdistribute/spake2-wasm); [npm](https://www.npmjs.com/package/spake2-wasm)
- **SPAKE2 in Rust.** `pakery-spake2` says it implements RFC 9382, and could be WASM/UniFFI-compiled. — [docs.rs pakery-spake2](https://docs.rs/pakery-spake2)
- **OPAQUE in JS.** `@serenity-kit/opaque` is at npm 1.1.0 (2026-02-01), MIT, with an active repo (pushed 2026-10-23). — [GitHub serenity-kit/opaque](https://github.com/serenity-kit/opaque); [npm](https://www.npmjs.com/package/@serenity-kit/opaque)
- **`@cloudflare/opaque-ts` (stale npm release).** The repo shows activity (pushed 2026-09-13, BSD-3-Clause), but the npm latest is 0.7.5 from 2022-02-15, which predates the final RFC. — [GitHub cloudflare/opaque-ts](https://github.com/cloudflare/opaque-ts); [npm](https://www.npmjs.com/package/@cloudflare/opaque-ts)
- **OPAQUE in Rust.** `facebook/opaque-ke` is Apache-2.0 and active (pushed 2026-06-23). — [GitHub](https://github.com/facebook/opaque-ke)
- **OPAQUE on mobile.** `serenity-kit/react-native-opaque` was last pushed 2024-10-25, so it is stale. — [GitHub](https://github.com/serenity-kit/react-native-opaque)
- **GitHub search found no Swift-language SPAKE2 or OPAQUE repositories.** (Queries: `spake2 language:swift`, `opaque pake language:swift`.) — [GitHub search API](https://api.github.com/search/repositories?q=spake2+language:swift)
- **SRP in Node: `fast-srp-hap`.** Pure Node.js SRP-6a, MIT. The npm latest is 2.0.4 (2021-10-07), but the repo is still maintained (pushed 2026-04-02). It defines a `hap` parameter set with `N_length_bits: 3072` and `hash: "sha512"`. — [GitHub homebridge/fast-srp](https://github.com/homebridge/fast-srp); [params.ts](https://github.com/homebridge/fast-srp/blob/master/src/params.ts); [npm](https://www.npmjs.com/package/fast-srp-hap)
- **HAP-NodeJS uses that parameter set.** It calls `SRP.params.hap` and `new SrpServer(srpParams, salt, "Pair-Setup", pincode, key)`. — [HAPServer.ts](https://github.com/homebridge/HAP-NodeJS/blob/latest/src/lib/HAPServer.ts)
- **SRP in Swift.** `adam-fowler/swift-srp` is Apache-2.0 and active (pushed 2026-08-14). `Bouke/SRP` is stale (last push 2022-11-24, MIT). — [GitHub adam-fowler/swift-srp](https://github.com/adam-fowler/swift-srp); [GitHub Bouke/SRP](https://github.com/Bouke/SRP)
- **Other HAP implementations** (Rust `hap-crypto`, Perl `Protocol::HAP::SRP`) describe Pair-Setup as SRP-6a over the RFC 5054 3072-bit group with SHA-512 and HKDF-SHA-512. — [docs.rs hap-crypto](https://docs.rs/hap-crypto); [metacpan Protocol::HAP::SRP](https://metacpan.org/pod/Protocol::HAP::SRP)
- **Latacora's crypto "right answers" (PQ edition, last updated 2026-06-24) don't discuss PAKEs.** For password storage they recommend "argon2id, scrypt, bcrypt, and PBKDF2 only if FIPS compliance is forcing you." — [Latacora](https://www.latacora.com/blog/post-quantum-cryptographic-right-answers/)

### Inferences
- **Balanced vs. augmented.** Balanced PAKEs (SPAKE2, CPace) fit one-time pairing codes, where both sides know the code. Augmented PAKEs (OPAQUE, SRP) fit a persistent password where the server should store only a verifier. This is why HomeKit uses SRP with the accessory holding a verifier for its setup code.
- **Why PAKEs are hard on iOS.** CryptoKit exposes high-level P-256 and Curve25519 operations but not the raw point addition or hash-to-curve that SPAKE2, CPace or OPAQUE need. A Swift PAKE would realistically mean bundling a Rust crate (opaque-ke, a spake2 crate) via UniFFI/XCFramework, or hand-rolling crypto. Hand-rolling is discouraged. SRP needs only bignum modexp and SHA-512, which is why maintained Swift SRP exists.
- **From background knowledge, not re-verified this session:** CPace and OPAQUE were the CFRG's 2020 PAKE-selection winners. That makes them the forward-looking choices once mature Swift libraries exist.
- **Practical guidance.** If a typed-code fallback is ever needed, copy HAP's construction: SRP-6a 3072/SHA-512 with `fast-srp-hap` on the server and `swift-srp` on iOS, exchanging long-term public keys inside the SRP-derived encrypted channel. Otherwise, skip PAKEs and use QR.

### Gaps
- Interoperability between `fast-srp-hap`'s `hap` params and `swift-srp` was not tested. Both implement SRP-6a, but padding/hash-of-N details must match, so verify with test vectors.
- No audit reports were found for `@serenity-kit/opaque` or `swift-srp` in this session.

## 3. Identity and credential mechanisms (pinned self-signed certs, mTLS on iOS, Ed25519/P-256 signed requests, Noise, bearer/refresh tokens, App Attest)

### Takeaway
The minimal sound pattern has two parts. The server proves itself with a pinned self-signed key, Syncthing style: identity = hash of the certificate/public key, with no CA. The phone proves itself with a long-lived device credential that the server can revoke. That credential can be either (a) a high-entropy bearer token stored hashed on the server (simplest, like Nextcloud app passwords or HA tokens), or (b) a non-exportable Secure Enclave P-256 key used to sign requests (RFC 9421) or a token-exchange challenge (stronger). mTLS is the strongest gate but has the roughest iOS ergonomics. Noise lacks mature, maintained libraries on both sides. App Attest proves app integrity, not user authorization.

### Cited Findings
- **Syncthing device IDs.** "The SHA-256 hash of the certificate data in DER form is calculated," then base32-encoded with check digits and dashes. Keys are "Currently ... a 256 bit Ed25519 key (384 bit ECDSA prior to v2.0.0 and 3072 bit RSA prior to v0.12.5)." Certs are self-signed (`CN=syncthing`), and the docs say the self-signing "doesn't actually add any security or functionality." — [Syncthing device IDs](https://docs.syncthing.net/dev/device-ids.html); [docs source](https://github.com/syncthing/docs/blob/main/dev/device-ids.rst)
- **Syncthing connection acceptance.** After a mutual TLS handshake, each side computes the remote device ID from the presented cert, drops it if it is its own ID or a duplicate, checks the ID is in its configuration, checks the CN, then accepts. There is no CA; trust is pure pinning. Local discovery is not cryptographically protected. — [Syncthing device IDs](https://docs.syncthing.net/dev/device-ids.html)
- **RFC 9421 (HTTP Message Signatures).** Standards Track, February 2024. It defines signature parameters `created` (inclusion "RECOMMENDED"), `expires`, `nonce`, `alg`, `keyid` and `tag`. Algorithms covered include rsa-pss-sha512, rsa-v1_5-sha256, hmac-sha256, ecdsa-p256-sha256, ecdsa-p384-sha384, Ed25519 and JWS algorithms. `@authority` "SHOULD be used instead of signing the Host header." Body content is covered via the Digest spec (`Content-Digest`), not directly. — [RFC 9421](https://www.rfc-editor.org/rfc/rfc9421.html)
- **RFC 9421 libraries.**
  - Node: `http-message-signatures` (dhensby), npm 1.0.6 (2026-06-04), ISC, repo pushed 2026-10-23. — [GitHub](https://github.com/dhensby/node-http-message-signatures); [npm](https://www.npmjs.com/package/http-message-signatures)
  - Swift: the only one found is `hellocoop/swift-httpsig` (0 stars, no license declared, pushed 2026-09-07), so it is immature. — [GitHub](https://github.com/hellocoop/swift-httpsig)
- **WireGuard's Noise handshake.** WireGuard uses "Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s." The server "does not even respond at all to an unauthorized client; it is silent and invisible." A cookie reply mechanism mitigates DoS: cookies expire after two minutes and are a MAC of the sender IP. — [WireGuard protocol](https://www.wireguard.com/protocol/)
- **Noise libraries.**
  - JS:
    - `noise-protocol` (emilbayes), npm 3.0.2 (2023-01-12), last push 2023-04-02. Stale.
    - `@chainsafe/libp2p-noise` 17.0.0 (2025-09-25), which is libp2p-specific.
  - Swift:
    - `swift-libp2p/swift-noise` (4 stars, pushed 2026-08-08).
    - `samueltangz/swift-noise-protocol` (last push 2021). Stale.
  - Sources: [emilbayes/noise-protocol](https://github.com/emilbayes/noise-protocol); [ChainSafe/js-libp2p-noise](https://github.com/ChainSafe/js-libp2p-noise); [swift-libp2p/swift-noise](https://github.com/swift-libp2p/swift-noise); [samueltangz/swift-noise-protocol](https://github.com/samueltangz/swift-noise-protocol)
- **mTLS on iOS needs the Security framework (Apple DTS, Quinn).**
  - "CryptoKit doesn't have any support for certificates, and hence digital identities." The Security framework can protect a private key with the Secure Enclave, and "a digital identity that includes such a private key should work with URLSession."
  - "There's no way to create [a SecIdentity] from a SecKey and SecCertificate combo... There's only two ways to create a digital identity on iOS: Using SecPKCS12Import... Using SecItemCopyMatching, which gets it from the keychain."
  - Source: [Apple Developer Forums thread 733534](https://developer.apple.com/forums/thread/733534)
- **URLSession client-cert challenge.** URLSession supports mTLS through the `NSURLAuthenticationMethodClientCertificate` challenge, answered with a credential that contains a `SecIdentity` (typically fetched from the keychain via SecItem). — [Apple Developer Forums thread 761031](https://developer.apple.com/forums/thread/761031)
- **Known pitfalls with self-inserted identities.** Errors such as -50 have been reported, and Quinn advises sticking to APIs available on both macOS and iOS. — [Apple Developer Forums thread 723516](https://developer.apple.com/forums/thread/723516)
- **App Attest.** `DCAppAttestService` creates "a hardware-based, cryptographic key that uses Apple servers to certify that the key belongs to a valid instance of your app," and assertions then sign requests. Attestation embeds the hash of a one-time server challenge of at least 16 bytes. `attestKey` "accesses a remote Apple server." Keys "don't survive app reinstallation, device migration, or restoration of a device from a backup." Not all devices or extension types are supported, so check `isSupported`. — [Apple: Establishing your app's integrity](https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity)
- **Latacora (updated 2026-06-24).** "Plain Ed25519" is fine for short-lived keys. For "long-standing keys and signatures, we'd recommend Ed25519+ML-DSA-65." Key exchange: "X25519+ML-KEM-768." Client-server: TLS 1.3, avoiding TLS below 1.3 by default. Random tokens: "Use 256-bit random numbers" from the OS CSPRNG. — [Latacora PQ right answers](https://www.latacora.com/blog/post-quantum-cryptographic-right-answers/)
- **Supporting libraries (live status 2026-10-26):**
  - `@noble/curves` 2.4.0 (2026-08-27, MIT, "Audited & minimal JS" ECC). — [GitHub](https://github.com/paulmillr/noble-curves)
  - `jose` (panva, MIT, pushed 2026-10-21) for JWT/JWS/JWK. — [GitHub](https://github.com/panva/jose)
  - `@peculiar/x509` 2.2.0 (2026-10-15, MIT) for generating and parsing X.509 in Node. — [GitHub](https://github.com/PeculiarVentures/x509)
  - `apple/swift-certificates` (Apache-2.0, pushed 2026-10-07), X.509 for Swift, usable for CSRs. — [GitHub](https://github.com/apple/swift-certificates)
  - `apple/swift-crypto` (Apache-2.0). — [GitHub](https://github.com/apple/swift-crypto)
  - `jedisct1/swift-sodium` (ISC, pushed 2026-05-04). — [GitHub](https://github.com/jedisct1/swift-sodium)

### Inferences
- **Bearer token (simplest sound option).** At pairing, the server mints 256 random bits and returns it once. The server stores only SHA-256(token) plus a device row in SQLite. The phone keeps the token in the Keychain with a `ThisDeviceOnly` accessibility class. Over pinned TLS this matches the Nextcloud app-password / HA long-lived-token model. Its weakness is that a stolen token works until it is revoked.
- **Device-key proof of possession (recommended upgrade).** The phone generates a P-256 key in the Secure Enclave and registers the public key at pairing. Afterwards it either signs each request (an RFC 9421 profile covering `@method`, `@target-uri`, `created`, `nonce`, `keyid`), or, more simply, signs a server challenge at app start to obtain a short-lived (for example 15-minute) access token. This mirrors HomeKit (long-term keys plus per-session proof) and the HA refresh/access split, but the "refresh credential" can't be exfiltrated.
  - Note: OAuth DPoP (RFC 9449, https://www.rfc-editor.org/rfc/rfc9449.html) standardizes this proof-of-possession idea. It was not researched in detail here.
- **Signature encoding gotcha.** Node 22's `crypto.verify` verifies ES256 natively. CryptoKit's `P256.Signing.ECDSASignature` offers `rawRepresentation` (r||s, which needs Node's `dsaEncoding: 'ieee-p1363'`) and `derRepresentation` (Node's default). Pick one deliberately.
- **mTLS (strongest but heaviest).** The server acts as a private CA: it signs the phone's CSR at pairing, and Node's `https.createServer({ requestCert: true, rejectUnauthorized: true, ca })` then refuses unauthenticated clients before any Hono route runs, similar to WireGuard's "silent to unauthorized." Revocation is a fingerprint check against the device table on each connection.
  - Cost: iOS identity plumbing (key in SE, then cert into the keychain via `SecItemAdd`, then `SecItemCopyMatching` for `kSecClassIdentity`). It also likely won't automatically apply to non-URLSession loaders (WKWebView, AVPlayer) without extra delegate work.
  - It is worth it if the server must be reachable from the open internet. It is optional behind an overlay VPN.
- **Noise IK** would give WireGuard-like silence and identity hiding, but it would replace HTTP/TLS tooling, and neither the npm nor the Swift libraries are mature or maintained. Prefer TLS 1.3 plus pinning, or use an existing WireGuard-based overlay (Tailscale/WireGuard) for transport.
- **App Attest** proves "genuine app on genuine Apple hardware" and needs Apple's servers plus server-side attestation verification. For a single-user self-hosted server it adds little over device-key pairing. It is optional hardening at pairing time only.
- **Server key type.** Prefer an ECDSA P-256 server certificate over Ed25519 for maximum compatibility with Apple's TLS stack (see Gaps). Node can generate one with `crypto.generateKeyPairSync('ec', {namedCurve: 'P-256'})` plus `@peculiar/x509`.

### Gaps
- Whether iOS URLSession/Network.framework accepts Ed25519 TLS server certificates was not verified. Assume P-256 is safest.
- RFC 9421 §7.2.2 ("Signature Replay") was not read in full; the fetch was truncated. Replay protection via `created`/`nonce` windows is application-defined.
- How Plex's newer JWT/device-key authentication works could not be verified from primary sources. Only a September 2025 forum mention exists. — [Plex forum JWT thread](https://forums.plex.tv/t/jwt-authentication/931646)

## 4. How Apple's own protocols pair (HomeKit HAP, AirPlay, Apple TV Remote/Companion)

### Takeaway
HomeKit pairing is a two-phase design worth copying in spirit. Phase one (Pair-Setup) runs a one-time PAKE (SRP-6a 3072-bit, SHA-512) on an 8-digit code, only to exchange long-term Ed25519 public keys inside an encrypted channel. Phase two (Pair-Verify) authenticates every session with ephemeral X25519 plus Ed25519 signatures (station-to-station), giving mutual authentication and forward secrecy. Revocation means removing a controller's public key from the accessory's pairing list. Apple TV Companion and AirPlay 2 reuse the same HAP-style pairing and ChaCha20-Poly1305 framing.

### Cited Findings
- **HomeKit key exchange (Apple Platform Security).** "HomeKit identity and security are based on Ed25519 public-private key pairs." During pairing, "keys are exchanged using the Secure Remote Password (3072-bit) protocol" with "an eight-digit code provided by the accessory's manufacturer," then "encrypted using ChaCha20-Poly1305 AEAD with HKDF-SHA-512 derived keys." — [Apple Platform Security: HomeKit communication security](https://support.apple.com/guide/security/homekit-communication-security-sec3a881ccb1/web)
- **HomeKit sessions and storage.** "Each session is established using the Station-to-Station protocol and is encrypted with HKDF-SHA-512 derived keys based on per-session Curve25519 keys," and each side "authenticates the other using the keys exchanged in the above process." Long-term keys are "stored in keychain," included only in encrypted backups, and synced through iCloud Keychain. A factory reset generates a new accessory key pair. — [Apple Platform Security](https://support.apple.com/guide/security/homekit-communication-security-sec3a881ccb1/web)
- **HAP-NodeJS Pair-Setup implementation.**
  - SRP uses `SRP.params.hap` (3072-bit, SHA-512 per fast-srp) with username "Pair-Setup."
  - The M5/M6 encryption key is HKDF-SHA512 with salt "Pair-Setup-Encrypt-Salt" and info "Pair-Setup-Encrypt-Info." ChaCha20-Poly1305 nonces are "PS-Msg05"/"PS-Msg06."
  - The controller's Ed25519 proof uses HKDF salt/info "Pair-Setup-Controller-Sign-Salt/Info." The accessory's proof uses "Pair-Setup-Accessory-Sign-Salt/Info."
  - Source: [HAPServer.ts](https://github.com/homebridge/HAP-NodeJS/blob/latest/src/lib/HAPServer.ts)
- **HAP-NodeJS Pair-Verify implementation.** It generates an ephemeral Curve25519 key pair, computes the shared secret, derives a key with HKDF salt "Pair-Verify-Encrypt-Salt" and info "Pair-Verify-Encrypt-Info," and signs with the accessory's long-term Ed25519 key. Session traffic keys use salt "Control-Salt" and info "Control-Read-Encryption-Key"/"Control-Write-Encryption-Key." — [HAPServer.ts](https://github.com/homebridge/HAP-NodeJS/blob/latest/src/lib/HAPServer.ts)
- **HAP-NodeJS brute-force limit.** "After 100 unsuccessful attempts the server won't accept any further attempts. Will currently be reset on a reboot," returning TLV error `MAX_TRIES`. The pair-setup handler also gates on `accessoryInfo.paired()`, so it refuses ordinary new pair-setup once paired. — [HAPServer.ts](https://github.com/homebridge/HAP-NodeJS/blob/latest/src/lib/HAPServer.ts)
- **HAP-NodeJS project status:** Apache-2.0, 2.7k stars, pushed 2026-10-25, npm `hap-nodejs` 0.14.3 (2026-03-29). — [GitHub](https://github.com/homebridge/HAP-NodeJS)
- **Apple TV Companion pairing (pyatv).** Pair-Setup runs M1–M6 with `PS_Start` and a PIN shown on screen. M5 carries an encrypted TLV with identifier, public key and signature. Pair-Verify runs M1–M4 with a new session public key. The channel uses "Chacha20Poly1305 ... (just like HAP)" with HKDF info strings `ServerEncrypt-main`/`ClientEncrypt-main`, a 12-byte little-endian counter nonce per direction, and the frame header as AAD. AirPlay 2 derives per-channel keys with salts like `Events-Salt` and `DataStream-Salt<seed>`. — [pyatv protocol docs](https://pyatv.dev/documentation/protocols/)
- **pyatv status:** MIT, pushed 2026-08-14. — [GitHub postlund/pyatv](https://github.com/postlund/pyatv)

### Inferences
- **What Pager can take from HAP:**
  - (1) A pairing secret is used once, to bind long-term public keys, and is then thrown away.
  - (2) Every later session is authenticated by those keys, never by the pairing code.
  - (3) A device list is the revocation mechanism.
  - (4) Hard caps on failed pairing attempts.
- **Using TLS instead of HAP's custom crypto.** TLS 1.3 with a pinned server key gives the session-layer properties (ephemeral ECDHE, server authentication). A device-key signature or client certificate gives client authentication. That reproduces HAP's guarantees with standard tooling, without porting HAP's custom TLV and crypto.
- **HAP-NodeJS as a reference.** It is a readable, maintained Node reference for SRP + HKDF + Ed25519 if a typed-code fallback is ever built.

### Gaps
- Apple's official HAP specification (the non-commercial PDF) was not fetched. The constants above come from HAP-NodeJS source, which is a reverse-engineered/compatible implementation, and Apple's Platform Security guide.
- AirPlay 2 pairing is marked incomplete ("TBD") in pyatv docs.

## 5. How Syncthing, Home Assistant, Nextcloud, Plex and Jellyfin persist authorization and allow revocation

### Takeaway
All five use the same core model: a durable per-device credential, listed and revocable from the server UI.
- Syncthing: per-device pinned cert IDs.
- Home Assistant: an OAuth-style refresh token (expires after 90 days unused) plus 30-minute access tokens, or 10-year long-lived tokens, with a revoke endpoint that kills all derived tokens.
- Nextcloud: per-client app passwords, revocable from the web UI or by the client.
- Plex: account tokens brokered by plex.tv.
- Jellyfin: device access tokens created via Quick Connect.

Pager should copy the "device list + per-device credential + idle expiry + one-click revoke" pattern.

### Cited Findings
- **Syncthing.** A connection is accepted only if the peer's cert-derived device ID "is in its configuration." Trust is the configured device list, with no CA. — [Syncthing device IDs](https://docs.syncthing.net/dev/device-ids.html)
- **Syncthing relays.** Through a relay, the "connection between two devices is still end to end encrypted." The relay "knows your IP and device ID," and the operator "can see the amount of traffic flowing between devices." — [Syncthing relaying](https://docs.syncthing.net/users/relaying.html)
- **Home Assistant auth flow.** The `client_id` is the app's website URL, and the redirect URI must share host and port. PKCE is supported (S256 only). The token response shows `expires_in: 1800` for access tokens, refreshed via `grant_type=refresh_token`. — [HA auth API](https://contributors.home-assistant.io/core/internals/auth-api/)
- **Home Assistant token lifetimes.** "A refresh token expires when it has not been used for 90 days." Long-lived access tokens are "valid for 10 years," cannot be displayed again, and are created from the profile Security page or via WebSocket `auth/long_lived_access_token`. — [HA auth API](https://contributors.home-assistant.io/core/internals/auth-api/)
- **Home Assistant revocation.** POSTing the refresh token to `/auth/revoke` "revokes the refresh token and every access token it ever created." It always returns 200. — [HA auth API](https://contributors.home-assistant.io/core/internals/auth-api/)
- **Home Assistant signed paths.** URLs with an `authSig` parameter, created via `auth/sign_path` (default expiry 30 seconds), let clients fetch a resource without an Authorization header. They stop working if the refresh token or user is deleted, or on restart. The signature is checked only at request start, so a long download can continue past expiry. — [HA auth API](https://contributors.home-assistant.io/core/internals/auth-api/)
- **Nextcloud.** Login Flow v2 yields an `appPassword` separate from the user's real password. Users can revoke access per client from the web. A client removing an account should send `DELETE /ocs/v2.php/core/apppassword` (with `OCS-APIREQUEST: true`) and should remove the account locally even on non-200. — [Nextcloud Login Flow](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html)
- **Plex.** The PIN flow yields an `authToken` sent as `X-Plex-Token`. A token is validated with `GET https://plex.tv/api/v2/user` (200 means valid, 401 invalid). The app appears in the user's "Authorized Devices." Clients should generate one stable `X-Plex-Client-Identifier` per install. — [Plex forum: Authenticating with Plex](https://forums.plex.tv/t/authenticating-with-plex/609370)
- **Jellyfin.** After Quick Connect approval, the waiting device is signed in with an `AuthenticationResult` (polled using a 32-byte secret). Requests time out after 10 minutes. The docs describe only a server-wide disable, not per-session revocation. — [Jellyfin Quick Connect docs](https://jellyfin.org/docs/general/server/quick-connect/); [QuickConnectManager.cs](https://github.com/jellyfin/jellyfin/blob/master/Emby.Server.Implementations/QuickConnect/QuickConnectManager.cs)

### Inferences
- **Design choices to borrow:**
  - (a) A per-device record with name, created/last-seen time, and revoke button (Nextcloud, Plex Authorized Devices, Syncthing device list).
  - (b) Idle expiry: HA's 90-day unused refresh-token expiry is a good default for "permanent until revoked," because a lost and forgotten phone eventually loses access automatically.
  - (c) Revoking the long-lived credential must cascade to all short-lived tokens (HA `/auth/revoke`).
  - (d) Short-lived signed URLs (HA `authSig`) for media/file loaders that can't attach headers (AVPlayer, WKWebView, QuickLook).
- **Plex's design depends on a cloud identity provider (plex.tv).** It is not a fit unless Pager adds a hosted account service.

### Gaps
- Jellyfin per-device token revocation (the Dashboard Devices page) was not confirmed from documentation in this session.
- Plex token lifetime and revocation semantics are not documented in the source found.

## 6. iOS specifics: Keychain and Secure Enclave, ATS for self-signed or IP-address HTTPS, local network privacy, pinning

### Takeaway
- **Keys:** use a P-256 Secure Enclave key; Ed25519 isn't available in the SE, so `Curve25519.Signing` keys are software-only. Persist CryptoKit's opaque, device-bound `dataRepresentation` in the Keychain.
- **ATS:** set `NSAllowsLocalNetworking = YES` so the app may connect to IP addresses and `.local` names. Since iOS 17, ATS otherwise blocks IP connections by default.
- **Self-signed server cert:** handle the `NSURLAuthenticationMethodServerTrust` challenge yourself and compare the server's public key/cert hash with the pinned value from the QR code.
- **`NSPinnedDomains`** is not a substitute: it only adds pins on named domains and doesn't loosen trust evaluation.
- **Local network privacy:** add `NSLocalNetworkUsageDescription` (and `NSBonjourServices` if using Bonjour). Connections over VPN/cellular don't count as "local network."

### Cited Findings
- **CryptoKit `SecureEnclave` contents.** The namespace lists `P256` ("NIST P-256 signatures and key agreement within the Secure Enclave"), `MLKEM768`, `MLKEM1024`, `MLDSA65` and `MLDSA87`, available since iOS 13 for P-256. No Curve25519/Ed25519 type is listed. — [Apple CryptoKit SecureEnclave](https://developer.apple.com/documentation/cryptokit/secureenclave)
- **Persisting a CryptoKit SE key.** A new CryptoKit Secure Enclave key is not persisted automatically. The app must store `dataRepresentation`, typically in the Keychain. Re-importing works on the same device, but the blob can't be used on another device. — [Apple Developer Forums thread 708749](https://developer.apple.com/forums/thread/708749); [thread 119315](https://developer.apple.com/forums/thread/119315)
- **SE keys and `SecIdentity`.** For TLS client identities, use Security-framework SE keys (`kSecAttrTokenIDSecureEnclave`) and get the `SecIdentity` via `SecItemCopyMatching`. A SecIdentity can't be built from a CryptoKit key plus a cert directly. — [Apple Developer Forums thread 733534](https://developer.apple.com/forums/thread/733534)
- **`NSAllowsLocalNetworking`.** It "controls whether ATS allows your app to connect to unqualified domains, `.local` domains, and IP addresses." "In iOS 17, iPadOS 17, and macOS 14, ATS no longer allows connections to IP addresses by default," and specific IPs/CIDRs can be added in `NSExceptionDomains`. The local-networking key "enable[s] access to unqualified domains, `.local` domains, and IP addresses that they would otherwise restrict." Apple suggests setting it to YES "as a declaration of intent." — [Apple: NSAllowsLocalNetworking](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking)
- **Manual server trust evaluation (Apple).**
  - Manual server-trust evaluation via `urlSession(_:didReceive:completionHandler:)` for `NSURLAuthenticationMethodServerTrust` is appropriate to "accept server credentials that would otherwise be rejected," for example "a self-signed certificate," or to "pin" to keys you control.
  - Return `.useCredential` with `URLCredential(trust:)` if valid, `.cancelAuthenticationChallenge` if not.
  - "You cannot loosen server trust requirements for an ATS-protected domain, but you can tighten them."
  - Apple recommends comparing against a public key rather than a single cert, so certs can be reissued, and using a set of keys for rotation.
  - Source: [Apple: Performing manual server trust authentication](https://developer.apple.com/documentation/foundation/performing-manual-server-trust-authentication)
- **`NSPinnedDomains` (iOS 14+)** pins CA and/or leaf identities for named domains. "Pinning a certificate for a given domain has no impact on other security requirements," and it doesn't change anchor evaluation. — [Apple: NSPinnedDomains](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nspinneddomains)
- **`NSAllowsLocalNetworking` alone doesn't make a self-signed cert work.** Forum reports confirm that standard trust evaluation still fails until a custom trust handler validates against a pinned copy. — [Apple Developer Forums thread 66417](https://developer.apple.com/forums/thread/66417); [QBurst 2025 guide](https://www.qburst.com/blog/2025/02/securing-accessory-communication-in-ios-apps-with-self-signed-certificates/)
- **Local network privacy: what counts as local.** TN3179 defines a local network as "an IP network associated with a broadcast-capable network interface. Such interfaces include Wi-Fi and Ethernet, but not cellular (WWAN) or VPN." Outgoing TCP to a local address requires the Local Network privilege. Resolving `.local` names and all Bonjour operations require it. — [TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)
- **Local network privacy: app setup.** Add `NSLocalNetworkUsageDescription`, plus `NSBonjourServices` for Bonjour service types. If the alert appears, the system "may deny the operation immediately," so use `waitsForConnectivity` or Network.framework. A background app in the undetermined state is denied without a prompt. — [TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)
- **Local network privacy: detection.** There is no API to query local network access. `NWConnection` reports `.localNetworkDenied` as an unsatisfied reason. — [TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)

### Inferences
- **Phone key storage.** Store the device private key as a Security-framework or CryptoKit SE P-256 key, with Keychain accessibility `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. That allows background refresh after first unlock, and the key never leaves the device or restores to another phone.
  - Optionally add `SecAccessControl` `.userPresence` for Face ID gating. That trades off background sync and SSE reconnects.
- **Pin target.** Pin the SHA-256 of the server's SubjectPublicKeyInfo (or Syncthing-style full-cert DER) received in the QR code.
- **Trust delegate steps.**
  - (1) Check `authenticationMethod == ServerTrust` and that the host is one of the paired server's known addresses.
  - (2) Take the leaf cert from `SecTrustCopyCertificateChain`.
  - (3) Hash it and compare in constant time with the stored pin.
  - (4) Ignore hostname/CA validity, because the pin is the trust anchor.
  - Apply it on every URLSession used, including background download sessions.
- **When ATS gets in the way.** Connecting by literal IP (LAN, or a VPN overlay's IP) or `.local` name falls under `NSAllowsLocalNetworking`, so custom trust can accept the self-signed cert. Connecting to an arbitrary public DNS name (for example a user's dynamic-DNS host) with a self-signed cert is "ATS-protected," and manual trust can't loosen it. That would need a per-domain ATS exception known at build time or `NSAllowsArbitraryLoads`, which is an App Review risk. Alternatively, use a real CA-issued cert for the remote hostname.
- **Local network privacy prompts.** LAN access will trigger the prompt (needs `NSLocalNetworkUsageDescription`). Access through a VPN overlay interface won't, per TN3179's "not ... VPN."

### Gaps
- The exact behavior of `NSExceptionDomains` + `NSExceptionAllowsInsecureHTTPLoads` for allowing a self-signed cert on a named public domain with custom trust was not verified from Apple primary docs in this session.
- Whether App Review accepts `NSAllowsArbitraryLoads` for this use case is undetermined. Apple's Quinn defers to App Review. — [Apple Developer Forums thread 6205](https://developer.apple.com/forums/thread/6205?page=4)

## 7. Threat model for exposing a home file server

### Takeaway
The main risks:
- Online guessing of pairing codes.
- Unauthenticated access to any route, including the web UI and the event stream.
- Path traversal and middleware-bypass bugs in the HTTP stack. Hono and `@hono/node-server` have had several, including 2026 advisories.
- Token theft or a lost phone.
- Relays or tunnels that terminate TLS and so can see books and tokens.

Mitigations: a pairing window opened by the user on the desktop, high-entropy single-use secrets, attempt caps, auth applied globally (not by path prefix), serving files by DB ID rather than by URL path, upgraded Hono, a per-device revocation list checked on every request, idle expiry, and end-to-end TLS pinned to the server key, even through relays.

### Cited Findings
- **Brute force math.** At 34.5 bits, a code needs about 5 allowed attempts per lifetime to keep success at 2^-32 (RFC 8628 §5.1). HAP-NodeJS caps failed pair-setup attempts at 100 before refusing. Magic-wormhole's PAKE design limits an attacker to one guess per code use and makes failures visible. — [RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628#section-5); [HAPServer.ts](https://github.com/homebridge/HAP-NodeJS/blob/latest/src/lib/HAPServer.ts); [magic-wormhole](https://magic-wormhole.readthedocs.io/en/latest/welcome.html)
- **Hono and `@hono/node-server` advisories:**
  - GHSA-rjq5-w47x-x359 / CVE-2024-23340: `@hono/node-server` 1.3.0–1.4.0 did not resolve `..` in serveStatic. Fixed in 1.4.1. — [GitLab advisory](https://advisories.gitlab.com/pkg/npm/@hono/node-server/CVE-2024-23340/)
  - GHSA-3mpf-rcc7-5347 / CVE-2024-32869: serveStatic directory traversal on Deno (`%2e%2e`). Fixed in hono 4.2.7. — [GitHub advisory](https://github.com/advisories/GHSA-3mpf-rcc7-5347)
  - CVE-2026-39406 / CVE-2026-39407: repeated slashes (`//`) can bypass route-based middleware such as `/admin/*`. Fixed in `@hono/node-server` 1.19.13 and hono 4.12.12. — [GitLab @hono/node-server CVE-2026-39406](https://advisories.gitlab.com/npm/@hono/node-server/CVE-2026-39406/); [GitLab hono CVE-2026-39407](https://advisories.gitlab.com/npm/hono/CVE-2026-39407/)
  - GHSA-frvp-7c67-39w9 and CVE-2026-54286: an encoded backslash (`%5C`) on Windows reaches nested files. Fixed in `@hono/node-server` 2.0.5 and hono 4.12.25. — [GitLab GHSA-frvp-7c67-39w9](https://advisories.gitlab.com/npm/@hono/node-server/GHSA-frvp-7c67-39w9/); [GitLab CVE-2026-54286](https://advisories.gitlab.com/npm/hono/CVE-2026-54286/)
- **Current Hono versions (2026-10-26):** `hono` 4.13.14 (2026-10-25) and `@hono/node-server` 2.1.5 (2026-10-13). — [npm hono](https://www.npmjs.com/package/hono); [npm @hono/node-server](https://www.npmjs.com/package/@hono/node-server)
- **Rate-limiting libraries:** `hono-rate-limiter` 0.5.4 (2026-09-06, MIT) and `rate-limiter-flexible` 11.2.3 (2026-10-17, ISC). — [npm hono-rate-limiter](https://www.npmjs.com/package/hono-rate-limiter); [npm rate-limiter-flexible](https://www.npmjs.com/package/rate-limiter-flexible)
- **Replay.** App Attest requires a one-time server challenge of at least 16 bytes to resist replay. HA signed paths default to a 30-second expiry. RFC 9421 provides `created`/`expires`/`nonce` parameters. — [Apple App Attest](https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity); [HA auth API](https://contributors.home-assistant.io/core/internals/auth-api/); [RFC 9421](https://www.rfc-editor.org/rfc/rfc9421.html)
- **Lost device and revocation precedents.** HA `/auth/revoke` cascades to all access tokens, and unused refresh tokens expire after 90 days. Nextcloud revokes per client. App Attest and SE keys don't migrate to new devices or restores. — [HA](https://contributors.home-assistant.io/core/internals/auth-api/); [Nextcloud](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html); [Apple App Attest](https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity)
- **Relays and end-to-end encryption.** Syncthing relays forward end-to-end encrypted traffic but see IPs, device IDs and traffic volume. The magic-wormhole transit relay "carries only encrypted data." WireGuard servers stay silent to unauthenticated packets. — [Syncthing relaying](https://docs.syncthing.net/users/relaying.html); [magic-wormhole](https://magic-wormhole.readthedocs.io/en/latest/welcome.html); [WireGuard](https://www.wireguard.com/protocol/)
- **Unauthenticated local discovery.** Syncthing local discovery is not cryptographically protected, so a device can announce any ID and receive connections. Pinning is what keeps this safe. — [Syncthing device IDs](https://docs.syncthing.net/dev/device-ids.html)

### Inferences
- **Pairing endpoint:**
  - Disabled by default.
  - Enabled only while the desktop UI shows the QR (for example 5 minutes or one successful pairing, whichever comes first).
  - The secret is single-use and compared in constant time.
  - Strictly rate-limited per IP and globally, for example 5 failures and the window closes. That limit only matters for a short-code fallback, since a 128-bit secret can't be guessed.
  - Optionally, a desktop-side "Allow 'David's iPhone'?" confirmation, which also defeats a photographed QR.
- **Auth everywhere.** Apply the auth middleware at app level (`app.use('*', auth)`) with an explicit allowlist (the pairing endpoint, a health endpoint). Don't rely on prefix-scoped middleware, given the `//` bypass advisories. Normalize/reject paths containing `//`, `%2e`, `%5c` or NUL. The server-sent event stream and the web frontend need the same protection. Today's LAN-only, no-auth setup becomes unsafe as soon as port 3006 is reachable from outside.
- **File serving:**
  - Never map URL paths to the filesystem. Serve `/books/:id/file` by looking up the path in SQLite.
  - If a path must be resolved, use `fs.realpath`, check it is under the library root (with a trailing separator), and reject symlinks that escape.
  - Set `Content-Disposition` and `X-Content-Type-Options: nosniff` for HTML/EPUB content, to avoid serving active content.
- **Revocation:**
  - The device table holds `id`, `name`, `pubkey`/`token_hash`, `created_at`, `last_seen_at`, `revoked_at` and `last_ip`. It is checked on every request, or at most every access-token lifetime (15 min) if tokens are exchanged.
  - The desktop UI lists devices with a "Revoke" button and shows `last_seen`.
  - Auto-expire devices unused for N days (HA uses 90).
  - Also offer "revoke all and rotate server key" for a suspected server compromise. That forces re-pairing because the pins change.
- **Relays and tunnels.** Any relay must forward bytes (TCP/UDP) while TLS terminates on the Fedora box, pinned by the phone. HTTP reverse-proxy tunnels that terminate TLS at a third party would expose book content and bearer tokens to that third party. Device-key signatures (rather than bearer tokens) limit the damage from token capture at such a point.
- **Defense in depth.** Bind the Pager server to localhost or LAN plus overlay interfaces only, not `0.0.0.0` on a port-forwarded WAN, unless mTLS gating is used. Run it as an unprivileged user with read-only access to the library directory (Fedora: systemd `ProtectHome`/`ReadOnlyPaths`). These are standard hardening steps and were not specifically sourced here.

### Gaps
- No primary source was found on Cloudflare Tunnel, ngrok and similar services terminating TLS. This is a general property of HTTP reverse-proxy tunnels, but it was not cited here; the connectivity research should cover it.
- Fedora/systemd sandboxing directives were not researched in this session.

## 8. Recommended minimal-but-sound design for Pager (desktop) and iPhone

### Takeaway
Use **QR pairing** carrying `{server key fingerprint, addresses, one-time 128-bit secret, expiry}`. The phone pins the server's self-signed P-256 TLS key, generates a **Secure Enclave P-256 device key**, and registers its public key using the secret. Afterwards, the phone authenticates by **signing a server challenge to get a short-lived access token**, with a **per-device revocation list** in SQLite and a desktop "Devices" page. Remote reachability should come from a transport that keeps TLS end-to-end: ideally a WireGuard-based overlay, never a TLS-terminating tunnel. A PAKE (SRP via `fast-srp-hap` + `swift-srp`, à la HomeKit) is only needed for an optional typed-code fallback.

### Cited Findings (basis for each design choice)
- **Server identity = hash of its own self-signed cert/key, pinned by peers, no CA.** — [Syncthing device IDs](https://docs.syncthing.net/dev/device-ids.html)
- **Pin the public key (not a single cert), and keep a set of pins for rotation.** — [Apple manual server trust](https://developer.apple.com/documentation/foundation/performing-manual-server-trust-authentication)
- **One-time pairing exchanges long-term public keys; every session is authenticated by them; revocation = remove the key.** — [Apple Platform Security HomeKit](https://support.apple.com/guide/security/homekit-communication-security-sec3a881ccb1/web); [HAPServer.ts](https://github.com/homebridge/HAP-NodeJS/blob/latest/src/lib/HAPServer.ts)
- **SE supports P-256, not Ed25519; persist the SE key blob in the Keychain.** — [CryptoKit SecureEnclave](https://developer.apple.com/documentation/cryptokit/secureenclave); [Forum 708749](https://developer.apple.com/forums/thread/708749)
- **Short-lived access plus revocable long-lived credential, idle expiry 90 days, cascade revoke.** — [HA auth API](https://contributors.home-assistant.io/core/internals/auth-api/)
- **Per-client credential revocable from the server UI.** — [Nextcloud Login Flow](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html)
- **Signed requests standard and Node library.** — [RFC 9421](https://www.rfc-editor.org/rfc/rfc9421.html); [http-message-signatures](https://github.com/dhensby/node-http-message-signatures)
- **ATS and local network keys.** — [NSAllowsLocalNetworking](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking); [TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)
- **Random tokens 256-bit from the OS CSPRNG; TLS 1.3.** — [Latacora](https://www.latacora.com/blog/post-quantum-cryptographic-right-answers/)
- **Patched Hono versions.** — [GitLab advisories](https://advisories.gitlab.com/npm/hono/CVE-2026-54286/)

### Inferences (concrete design; the author's synthesis of the sources above)

**Server (Node 22 + Hono + SQLite)**
1. **First run.**
   - Generate a P-256 key pair and a long-lived self-signed X.509 cert (Node `crypto` + `@peculiar/x509`). Store it in `~/.local/share/reader/` with mode 0600.
   - Compute `server_id = base32(SHA-256(SPKI DER))`, or the full cert DER Syncthing-style, and show it in Settings.
   - Serve HTTPS (TLS 1.3 minimum) with `@hono/node-server` using Node's `https.createServer` with `{key, cert, minVersion: 'TLSv1.3'}`.
   - Keep `hono` ≥4.12.25 and `@hono/node-server` ≥2.0.5 (current: 4.13.14 / 2.1.5).
2. **Tables.**
   - `devices(id TEXT PK, name, public_key_jwk, created_at, last_seen_at, last_ip, revoked_at)`.
   - `pairing_sessions(secret_hash, expires_at, used_at)`.
   - `access_tokens(token_hash, device_id, expires_at)`. Alternatively make tokens stateless (HMAC/JWS via `jose` with a 15-minute expiry) and check `devices.revoked_at` on each request.
3. **Pairing (desktop UI "Pair iPhone").**
   - Create a 128–256-bit secret (`crypto.randomBytes(32)`) with a 5-minute expiry.
   - Render a QR code (npm `qrcode`, 1.5.4 from 2024-08, stable but not recently released) containing, for example: `pager://pair?v=1&sid=<server_id>&fp=<b64url SHA-256 SPKI>&addr=192.168.1.20:3006,100.x.y.z:3006,reader-pc.local:3006&sec=<b64url secret>&exp=<unix>&name=<pc name>`.
4. **`POST /pair`** (the only unauthenticated route besides health):
   - Body: `{secret, device_name, device_public_key (P-256 JWK or X9.63), attestation?}`.
   - Constant-time compare of `SHA-256(secret)`, single-use, unexpired. Rate-limited: for example 5 failures, then the window closes.
   - Optionally require desktop click-to-approve.
   - Insert a device row and return `{device_id, server_name}`.
5. **Session.**
   - `POST /auth/challenge` → `{nonce, expires_in: 60}`.
   - `POST /auth/token` with `{device_id, nonce, signature over (nonce ‖ server_id ‖ device_id ‖ timestamp)}` → verify ES256 with Node `crypto.verify` → issue a 15-minute access token.
   - Every other route requires `Authorization: Bearer <access>` via global middleware that also checks `revoked_at`. Update `last_seen_at`.
   - Alternative: sign every request per RFC 9421 (`http-message-signatures`), covering `@method @target-uri content-digest created nonce`. This is more robust but costs more client work.
6. **Files and streams.** Serve by DB ID. For loaders that can't send headers (AVPlayer, WKWebView), mint HA-style short-lived signed URLs (HMAC of path + device_id + exp, about 60 s to 5 min).
7. **Devices page.** List devices with last-seen time and IP, plus Revoke (sets `revoked_at` and kills tokens). Auto-revoke after 90 days idle (configurable). Offer "Rotate server identity" (forces re-pairing).

**iPhone (Swift)**
1. **Scan and pin.** Scan the QR code (AVFoundation/VisionKit) and parse it. Store `{server_id, fp, addresses}` in the Keychain or app storage; the pin is not secret, only its integrity matters.
2. **Device key.** Create a P-256 key in the Secure Enclave, either CryptoKit `SecureEnclave.P256.Signing.PrivateKey(accessControl:)` with `dataRepresentation` saved to the Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`), or a Security-framework `SecKeyCreateRandomKey` with `kSecAttrTokenIDSecureEnclave`. Fall back to a software P-256 key in the Keychain on the Simulator.
3. **URLSessionDelegate.** For `NSURLAuthenticationMethodServerTrust` on known paired addresses: extract the leaf cert, compute the SHA-256 of the SPKI, compare it with `fp`, and return `.useCredential` or `.cancelAuthenticationChallenge`. Apply this to foreground and background sessions.
4. **Info.plist.**
   - `NSAppTransportSecurity` → `NSAllowsLocalNetworking = YES`.
   - `NSLocalNetworkUsageDescription`.
   - `NSBonjourServices = ["_reader._tcp"]`, if the desktop advertises via Avahi for LAN discovery and address changes.
   - `NSCameraUsageDescription` for QR scanning.
5. **Session.** Call `POST /pair` once. Afterwards, at launch or on 401, run challenge → sign (SE key) → access token, kept in memory only. Use `waitsForConnectivity`. Try the LAN address first, then overlay addresses.
6. **Optional hardening.**
   - App Attest at pairing time (prove a genuine app build). It needs Apple servers and adds server-side verification work; low value for a single user.
   - Face ID (`.userPresence`) on the SE key for opening the app. It may block background sync.

**Remote access (interface to the connectivity research)**
- Keep the application-layer TLS pinned end-to-end regardless of the path.
- Prefer an overlay VPN (WireGuard/Tailscale-style, Noise IK, silent to unauthenticated peers) so port 3006 is never on the public internet. The pinned TLS plus device-key auth then serve as a second, independent layer.
- If a relay is used, it must forward encrypted bytes only (Syncthing/magic-wormhole model).
- If the server must be publicly reachable, gate it with mTLS (`requestCert: true`, a private CA, a device-cert fingerprint check) so unauthenticated clients never reach Hono.

**Optional typed-code fallback (no camera, or pairing over the phone)**
- Option A: a HAP-style PAKE (SRP-6a 3072/SHA-512, `fast-srp-hap` ↔ `swift-srp`), deriving an HKDF key that encrypts the exchange of `{device pubkey ↔ server SPKI fingerprint}`, with a 100-failure (HAP) or stricter cap.
- Option B: the reverse flow (Jellyfin Quick Connect style). The phone shows a 6–8-character code, and the user approves it on the desktop UI, which also shows a short fingerprint of the phone's key for the user to compare on the phone.

### Gaps
- `fast-srp-hap` ↔ `swift-srp` interoperability (padding and k/u computation) is untested.
- iOS acceptance of Ed25519 TLS server certs is unverified, which is why P-256 is recommended.
- A maintained Swift RFC 9421 library doesn't exist (only an immature 0-star repo), so per-request signing would need a small custom implementation on iOS. The challenge→token design avoids this.
- Connectivity choices (Tailscale/WireGuard/relay/DDNS/IPv6) and their ATS interactions are out of scope for these notes and should come from the connectivity research.
