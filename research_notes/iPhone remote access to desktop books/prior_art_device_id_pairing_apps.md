# Prior art: apps that pair a phone to a specific computer by device ID, pairing code or QR code and keep remote access to its files

Scope: how these products handle identity, discovery/rendezvous, NAT traversal, relays, pairing persistence and revocation. Research date: 2026-10-26. Discontinued products and changed behavior are flagged inline. Every claim has a source. Anything unverified is listed under Gaps.

## Q1. Syncthing: Device ID derivation, global/local discovery, relays, the Möbius Sync iOS client, and the Android app discontinuation

### Takeaway
Syncthing is the closest fit to a "computer ID" design that needs no account. Each device's identity is the SHA-256 of its own self-signed TLS certificate. That hash is base32-encoded with Luhn-mod-32 check digits, giving a 56-character ID with dashes. Discovery (a global HTTPS server, plus LAN broadcast) and relays are untrusted helpers that only map ID to address. Mutual TLS pinned to the expected device ID authenticates every connection, including connections tunneled through a relay. On iOS, Möbius Sync shows the hard limit: no app can keep a connection open in the background, so syncing happens mainly while the app is open, and Möbius quotes about 1-2 hours of opportunistic background activity per day.

### Cited Findings
**Identity / Device ID**
- On first start, Syncthing generates a keypair, currently Ed25519 (older versions used ECDSA or RSA), and stores it as `key.pem` and a self-signed `cert.pem`. — [Syncthing docs: Understanding Device IDs](https://docs.syncthing.net/dev/device-ids.html)
- "To form a device ID the SHA-256 hash of the certificate data in DER form is calculated." The 256-bit hash is base32-encoded, which yields 52 characters after padding is stripped. It is then split into four groups, each gets check digits, and dashes are added for display. — [Syncthing docs: Device IDs](https://docs.syncthing.net/dev/device-ids.html); [syncthing-device-ids(7) man page](https://man.archlinux.org/man/syncthing-device-ids.7.en)
- The check digits use "the Luhn mod N algorithm with N being 32 and the digits being the base32 alphabet" (introduced in v0.9.0). — [Syncthing forum: v0.9.0 New node ID format](https://forum.syncthing.net/t/v0-9-0-new-node-id-format/478)
- Syncthing's Luhn variant is nonstandard: it iterates in a different order from Wikipedia's description, and the maintainer conceded that an early port was wrong. Standard tools cannot reproduce the final formatted ID without Syncthing's own code or its REST API. — [Syncthing forum thread](https://forum.syncthing.net/t/v0-9-0-new-node-id-format/478/5); [Syncthing forum: calculate DeviceID via command line](https://forum.syncthing.net/t/how-to-calculate-deviceid-via-command-line/12222)
- Authentication sequence after the TLS handshake: (1) compute the remote device ID from the presented cert; (2) drop the connection if it is our own ID or one already connected; (3) "If it is not a device ID we are expecting to talk to, drop the connection"; (4) check the cert CommonName (default `syncthing`); (5) accept. — [Syncthing docs: Device IDs](https://docs.syncthing.net/dev/device-ids.html)
- Security argument: an attacker needs a second preimage, meaning a valid DER certificate that hashes to exactly the victim's ID, not merely a collision. — [Syncthing docs: Device IDs](https://docs.syncthing.net/dev/device-ids.html)
- Known weaknesses the docs acknowledge: local discovery is not cryptographically protected, so any device can announce another device's ID. Long IDs are also hard to read aloud or type, and the docs float shorter IDs or out-of-band PIN pairing as alternatives. — [Syncthing docs: Device IDs](https://docs.syncthing.net/dev/device-ids.html)

**Global discovery (v3)**
- A device announces itself with an HTTPS POST of its address list (`tcp://...`, `relay://...`). "The device ID of the announcing device is not part of the announcement". The server derives the ID from the TLS client certificate, which prevents spoofed announcements. — [Global Discovery v3 spec](https://docs.syncthing.net/specs/globaldisco-v3.html)
- Lookup is `GET ?device=<ID>`, returning 200/400/404/429. Announcements return 204, or 403 if no certificate was presented. The server sets `Reannounce-After` / `Retry-After` headers; there is no fixed TTL. — [Global Discovery v3 spec](https://docs.syncthing.net/specs/globaldisco-v3.html)
- Clients pin the discovery server's certificate with an `id=` parameter on the server URL, so a CA is not required. The public network runs at `discovery.syncthing.net`. — [Global Discovery v3 spec](https://docs.syncthing.net/specs/globaldisco-v3.html)

**Local discovery (v4)**
- UDP port 21027. IPv4 broadcast (link broadcast or 255.255.255.255) and IPv6 multicast `ff12::8384`. Each packet is a magic word `0x2EA7D90B` followed by a protobuf containing `id` (32-byte SHA-256 of the cert), `addresses`, and `instance_id` (random per start, to detect restarts). Recommended interval is 30-60 seconds, plus immediate sends on change. — [Local Discovery v4 spec](https://docs.syncthing.net/specs/localdisco-v4.html)

**Relays**
- The relay protocol v1 runs on one TCP port. A first byte of 0x16 (TLS) selects "protocol mode", where the relay sees each device's ID via TLS; any other first byte selects "session mode". A device stays joined in permanent mode. A peer sends a ConnectRequest, and the relay sends both sides a SessionInvitation containing a random session key and an address, with a `ServerSocket` flag that tells each side which TLS role to take. — [Relay Protocol v1](https://docs.syncthing.net/specs/relay-v1.html)
- After the session is set up, the two devices run a normal BEP TLS handshake through the relay, so relayed data is "completely meaningless to the relay". Forward-secret cipher suites protect recorded traffic. — [Relay Protocol v1](https://docs.syncthing.net/specs/relay-v1.html)
- Relays are on by default but used only when a direct connection fails. Syncthing keeps retrying direct connections and drops the relay once one succeeds. Relay throughput is "much lower than a direct connection". A relay learns the IP and device ID of devices registered with it and sees traffic volume, not content. Users can pin private relays with `relay://host:port/?id=<relay device ID>`, and listed relays are then used exclusively. — [Syncthing docs: Relaying](https://docs.syncthing.net/users/relaying.html)

**Current state (2025-2026)**
- Syncthing 2.0 (August 2025) moved the database from LevelDB to SQLite, made multiple connections between v2 devices standard, removed rolling-hash detection, reworked the CLI, and dropped some prebuilt platforms. The coverage found does not describe any change to the discovery or relay protocols. — [AlternativeTo news, Aug 2025](https://alternativeto.net/news/2025/8/syncthing-2-0-debuts-with-sqlite-migration-new-logs-platform-changes-and-much-more); [Neowin](https://www.neowin.net/news/syncthing-20-released-with-major-changes-switching-from-leveldb-to-sqlite/); [GitHub release v2.0.13](https://github.com/syncthing/syncthing/releases/tag/v2.0.13)
- Sources disagree on how long deleted items are retained in 2.0: news coverage says 6 months by default, while the v2.0.13 release notes say 15 months. — [Neowin](https://www.neowin.net/news/syncthing-20-released-with-major-changes-switching-from-leveldb-to-sqlite/) vs. [GitHub v2.0.13](https://github.com/syncthing/syncthing/releases/tag/v2.0.13)
- **Discontinued:** the official Syncthing Android app was retired, with its final release alongside the December 2024 Syncthing version. Reasons were Google Play publishing difficulties (the "all files access" permission is no longer allowed except in special cases) and lack of maintainers. The community "Syncthing-Fork" continues on GitHub/F-Droid, now under new maintainers, and Syncthing's download page still lists it. BasicSync is another option. — [AlternativeTo news, Oct 2024](https://alternativeto.net/news/2024/10/the-syncthing-android-app-is-being-discontinued-but-alternatives-remain-available); [Privacy Guides forum](https://discuss.privacyguides.net/t/syncthing-fork-syncthing-wrapper-for-android/21672); [BasicSync issue](https://github.com/chenxiaolong/BasicSync/issues/1)

**Möbius Sync (third-party iOS client)**
- "No iOS app can run continuously in the background. This means that Möbius Sync can only connect to other devices whilst the app is open, for a short time thereafter, and whenever it is triggered to run briefly in the background." iOS scheduling is "adaptive and not predictable". Sync may take up to 24 hours to start, then "a total of 1-2h of sync activity per day once stable". — [Möbius Sync FAQ](https://mobiussync.com/faq/)
- Synced folders live in the app sandbox and appear in the Files app. Syncing a folder from another app's sandbox ("Pick External Folder") is labelled "DANGEROUS", and iCloud folders are not supported. — [Möbius Sync FAQ](https://mobiussync.com/faq/)
- Pairing uses the Syncthing Device ID. The FAQ recommends setting up the non-iOS devices first, then scanning their QR code from iOS and accepting the request on the other device. Switching between the Pro and standard app variants creates a new Device ID. — [Möbius Sync FAQ](https://mobiussync.com/faq/)
- Business model: free up to 20 MB, then a one-time in-app purchase. The iOS app is closed source; its modifications to the MPL-2.0 Syncthing core are published on GitHub. — [Möbius Sync FAQ](https://mobiussync.com/faq/)
- User reports vary. Some users see devices drop to "Disconnected" as soon as they switch apps; others report large overnight syncs. — [Syncthing forum: Mobius Sync & Background Refresh](https://forum.syncthing.net/t/mobius-sync-background-refresh/16372); [Syncthing forum: Syncthing for iOS](https://forum.syncthing.net/t/syncthing-for-ios/16045)

### Inferences
- Because the Device ID is the certificate hash, the ID itself is the trust anchor. A QR code holding the ID (fingerprint) lets the phone pin the PC's TLS certificate with no CA and no vendor account. This maps directly onto a Pager "computer ID".
- The pairing is persisted as each side's own key/cert plus the list of peer device IDs in config. Revoking a device means deleting its ID from the config, because connections from unknown IDs are dropped at step 3. This follows from the cited authentication sequence; I did not find a dedicated revocation doc.
- Syncthing's split is reusable as-is: discovery is untrusted (ID to addresses), the relay is untrusted (a byte pipe), and authentication is end to end (mutual pinned TLS). The discovery server and relay can be swapped or self-hosted without changing the trust model.
- Möbius Sync's experience suggests a Pager iPhone app should not count on a persistent background connection. A better model is persistent pairing credentials, an on-demand connection when the app is in the foreground, and locally cached downloaded books.

### Gaps
- I did not fetch the Syncthing docs for `stdiscosrv` (self-hosted discovery) or `strelaysrv` (self-hosted relay), or the public relay pool endpoint. Their existence is implied by the relaying doc but not detailed here.
- I could not confirm which iOS background mechanisms Möbius uses (BGTaskScheduler, location, etc.). The FAQ only says "various methods".
- No source found on how Syncthing rotates or replaces device keys. Replacing the cert changes the ID, which is inferred from the derivation.

## Q2. Synology QuickConnect: how a QuickConnect ID resolves to a NAS from anywhere, and lessons for a "computer ID"

### Takeaway
QuickConnect is a vendor-run, account-tied name registry. A user-chosen globally unique ID maps to a NAS, which keeps registering its current addresses with Synology's cloud. Clients try direct LAN/WAN first, then server-introduced hole punching, then a Synology relay. The relay is slow, and in the browser "Portal" path Synology's server decrypts traffic to rewrite HTTP headers, so it is not end to end in that case. Synology's apps use a "virtual tunnel" instead. It cannot be self-hosted.

### Cited Findings
- Synology says QuickConnect uses "Synology global cloud infrastructure and hole punching technology" to give access "from any browsers or mobile devices". — [Synology DSM network management](https://www.synology.com/en-global/dsm/feature/network_management)
- Synology's DSM 7.4 spec page says QuickConnect uses end-to-end encryption when SSL is enabled, and can fall back to the QuickConnect relay service when no direct route exists. — [Synology DSM 7.4 spec: Network and External Access](https://www.synology.com/en-global/dsm/7.4/software_spec/network_external_access)
- The ID is user-chosen and unique across all Synology NAS units. Clients use it instead of an IP, and Synology's servers find where the NAS currently is. Stages attributed to the white paper (secondhand): (1) the client fetches the NAS's registered LAN/WAN addresses and tries a direct connection; (2) hole punching, where "Synology's server introduces them", with performance close to DDNS plus port forwarding; (3) the relay, which "can cause a significant delay in data delivery", has limited bandwidth that shrinks as usage grows, and is forced by CGNAT or restrictive NAT. — [WunderTech QuickConnect guide](https://www.wundertech.net/synology-quickconnect-ultimate-setup-guide/)
- Encryption caveat (secondhand, citing the white paper): when a browser session cannot be redirected to the NAS directly, traffic passes through Synology's Portal Server, which "decrypts and modifies specific HTTP headers before passing the data on". Mobile and desktop app connections use a virtual tunnel and do not have this behavior. A forum user likewise says the relay uses a different certificate on each leg, which would mean TLS termination at the relay; this contradicts Synology's "end-to-end" marketing. — [WunderTech](https://www.wundertech.net/synology-quickconnect-ultimate-setup-guide/); [SynoForum thread](https://www.synoforum.com/threads/quickconnect.5222/post-23720)
- QuickConnect "only works with Synology's own applications" and cannot reach third-party services such as Plex or Docker containers. — [WunderTech](https://www.wundertech.net/synology-quickconnect-ultimate-setup-guide/)
- The relay can be disabled in DSM while QuickConnect stays on. When both devices are on the same LAN, the connection switches to local right after the server's introduction. — [SynoForum](https://www.synoforum.com/threads/quickconnect.5222/post-23720); [heimnetz.de forum](https://forum.heimnetz.de/threads/synology-quickconnect.74/post-798)
- Past vulnerability: CVE-2020-27653 (Talos) allowed an attacker to downgrade a QuickConnect HTTPS connection to HTTP in SRM 1.2.3 and DSM 6.2.3. — [Talos TALOS-2020-1061](https://talosintelligence.com/vulnerability_reports/TALOS-2020-1061)

### Inferences
- The lesson for Pager: a human-friendly ID works well as a lookup key, but it should not be the trust anchor. QuickConnect relies on Synology's account system and TLS certs. A Pager design should bind the friendly ID to a pinned key fingerprint (Syncthing-style) so the broker cannot impersonate the PC.
- The connection ladder (LAN, then direct WAN, then hole-punch, then relay) is the same pattern RustDesk, TeamViewer, Chrome Remote Desktop and Tailscale use (see Q3 and Q4), so it is effectively the industry standard.
- Avoid the Portal-style design where the relay terminates TLS. A native iOS app can run its own pinned TLS through a dumb relay, which Synology's browser path cannot.

### Gaps
- The official QuickConnect white paper PDF was not retrievable: both guessed URLs on global.download.synology.com and global.synologydownload.com returned 404. Stage details are secondhand via WunderTech.
- No primary source on how the NAS authenticates to Synology's registry, how often it re-registers, or how a QuickConnect ID is released or transferred.

## Q3. Remote-desktop products: TeamViewer, AnyDesk, RustDesk (reference implementation), Chrome Remote Desktop, Parsec

### Takeaway
All five follow the same three-part pattern: (1) a device keeps an outbound registration or heartbeat to a vendor rendezvous/"master" server keyed by a numeric ID; (2) the server brokers a direct connection via STUN/hole punching; (3) a relay carries traffic when that fails (TeamViewer reports about 30% of sessions). Session crypto is end to end between endpoints. RustDesk is the open, self-hostable reference: `hbbs` handles ID, rendezvous and signaling, `hbbr` relays, the server holds an Ed25519 key, and the protobuf rendezvous protocol is public (AGPL-3.0).

### Cited Findings
**RustDesk (open source, self-hostable)**
- Two server binaries: `hbbs` is the "ID/Rendezvous server" and `hbbr` is the "relay server". The server repo is AGPL-3.0. Options include `-k/KEY` ("hbbs loads/generates one by default"), `-r` for relay addresses, and `ALWAYS_USE_RELAY=Y`, which "disables direct connections". — [rustdesk-server GitHub](https://github.com/rustdesk/rustdesk-server)
- How it works: each client "constantly pings the ID server" so hbbs knows its current IP and port. When A wants B, A asks hbbs, and hbbs attempts NAT hole punching. If that fails, the peers go through hbbr. Hole punching "succeeds in most cases". — [RustDesk docs: Self-host](https://rustdesk.com/docs/en/self-host/)
- Ports: TCP 21115 (NAT type test), TCP/UDP 21116 (registration, heartbeat, hole punching), TCP 21117 (relay), TCP 21118/21119 (WebSocket), TCP 21114 (Pro API). A 443-only WSS mode exists but disables P2P. — [RustDesk docs: Self-host](https://rustdesk.com/docs/en/self-host/)
- OSS vs Pro: OSS is free with manual configuration. Pro adds a web console, API, OIDC/LDAP, 2FA, device management, access control, multi-relay, and an address book. — [RustDesk docs: Self-host](https://rustdesk.com/docs/en/self-host/)
- Client setup needs the ID server and Key. The Key is the server's public key, "usually generated on the first run of hbbs and stored in id_ed25519.pub", and is needed "to establish an encrypted connection to your self-hosted server". Configuration can be exported/imported or passed as `rustdesk.exe --config <config-string>`. Pro can generate custom pre-configured clients. — [RustDesk docs: Client configuration](https://rustdesk.com/docs/en/self-host/client-configuration/)
- WebSocket ports trust unvalidated `X-Real-IP`/`X-Forwarded-For` headers, so the docs say to expose them only behind a reverse proxy. — [RustDesk docs: OSS install](https://rustdesk.com/docs/en/self-host/rustdesk-server-oss/install/)
- Rendezvous protocol messages (protobuf, `rendezvous.proto`):
  - `RegisterPeer{id, serial}` returns `RegisterPeerResponse{request_pk}`.
  - `RegisterPk{id, uuid, pk, old_id}` returns `RegisterPkResponse{result: OK | UUID_MISMATCH | ID_EXISTS | TOO_FREQUENT | INVALID_ID_FORMAT…, keep_alive}`.
  - `PunchHoleRequest{id, nat_type, conn_type, token, udp_port, force_relay, upnp_port, socket_addr_v6, webrtc_sdp_offer}` leads to `PunchHole` being sent to the target and `PunchHoleSent`/`PunchHoleResponse{socket_addr, pk, failure: ID_NOT_EXIST | OFFLINE…, relay_server, is_local}` being returned.
  - `FetchLocalAddr`/`LocalAddr` are used when both peers are on the same LAN.
  - `RequestRelay{id, uuid, relay_server, secure}` returns `RelayResponse{uuid, relay_server, pk…}`.
  - Also defined: `TestNatRequest`, `OnlineRequest`, `ConfigUpdate`, `KeyExchange{keys, version, signed_params}`, `KxParams` (server-signed ephemeral key), and `IdPk{id, pk, dtls_fingerprint}` (a signed identity bundle).
  — [hbb_common rendezvous.proto](https://raw.githubusercontent.com/rustdesk/hbb_common/main/protos/rendezvous.proto)
- Secondary sources say RustDesk uses NaCl primitives (Curve25519 key exchange, XSalsa20-Poly1305, Ed25519 signatures), with session keys negotiated between the clients and relays carrying only ciphertext. — [wz-it.com RustDesk explainer](https://wz-it.com/en/knowledge/remote-access/self-hosted-teamviewer-alternative/)
- Persistence: a client can have a "permanent password" set (`--password` CLI), and `--get-id` prints the ID. A third-party vendor FAQ says the ID stays the same unless the app is fully uninstalled or its config files are deleted. — [RustDesk client deployment docs](https://rustdesk.com/docs/en/client/client-deployment); [PointDev FAQ](https://www.pointdev.com/en/faq/faq--how-use-rustdesk-remote-control-ideal-remote-windows-id-1194.html)

**TeamViewer (proprietary, vendor-run)**
- "TeamViewer IDs are based on various hardware and software characteristics and are automatically generated by TeamViewer". — [TeamViewer Security Statement](https://www.teamviewer.com/en/global/support/knowledge-base/teamviewer-remote/security/security-statement/)
- After a handshake via master servers, a direct UDP/TCP connection "is established in 70 percent of all cases", even behind NATs and firewalls. The rest go through TeamViewer's router network (TCP or HTTP tunneling), and no inbound ports are needed. Clients carry "a certificate of the master cluster". — [TeamViewer Security Statement](https://www.teamviewer.com/en/global/support/knowledge-base/teamviewer-remote/security/security-statement/)
- Crypto: the legacy scheme is RSA-4096 key exchange with AES-256 sessions. From v15.73 it is mutually authenticated TLS 1.3 with PFS and AES-256-GCM. "the private key never leaves the client computer", and TeamViewer as router operator cannot read the traffic. The statement page was last modified May 29, 2026. — [TeamViewer Security Statement](https://www.teamviewer.com/en/global/support/knowledge-base/teamviewer-remote/security/security-statement/)
- Brute-force protection uses exponentially growing waits ("17 hours for 24 failed attempts"). Trusted Devices requires email authorization of new devices or browsers. Easy Access gives password-less unattended access. AllowList and BlockList control who can connect. — [TeamViewer Security Statement](https://www.teamviewer.com/en/global/support/knowledge-base/teamviewer-remote/security/security-statement/)

**AnyDesk (proprietary, vendor-run, with an on-prem option)**
- The AnyDesk ID is a numeric address assigned to a device. An alias is a named address within a namespace. AnyDesk's cloud database is queried to find where a target client is and who owns it. An address book stores devices after a first connection. — [AnyDesk glossary](https://support.anydesk.com/knowledge/glossary)
- An on-premises appliance lets devices connect through a local server without internet access. — [AnyDesk on-premises](https://support.anydesk.com/docs/on-premises.md)
- Unverified third-party claim: clients try direct UDP/TCP first and fall back to AnyDesk relays over ports 80, 443 and 6568. — [USRO blog](https://blog.usro.net/2025/06/how-anydesk-works-across-devices-ports/)

**Chrome Remote Desktop (proprietary, Google-run)**
- Clients first make web requests to Google services, then establish a P2P session using ICE/WebRTC. The mode "is either Direct, STUN, or TURN/relay". TURN traffic is "relayed through Google data center(s)", preferring UDP and falling back to TCP. It needs TCP 443 and TCP/UDP 3478, plus a dynamic UDP range that the `RemoteAccessHostUdpPortRange` policy can restrict. Domains include `remotedesktop.google.com`, `remotedesktop-pa.googleapis.com` and `instantmessaging-pa.googleapis.com`. A fixed signaling IP (74.125.247.128) supports TURN/STUN. — [Google: Network guide for Chrome Remote Desktop](https://support.google.com/chrome/a/answer/16364503)
- In the managed ChromeOS flow, the host "registers a new support host instance with the Chrome Remote Desktop service using an OAuth access token" and returns an access code that is "a combination of its Host ID and a secret code". — [Google network guide](https://support.google.com/chrome/a/answer/16364503)
- The `RemoteAccessHostFirewallTraversal` policy (on by default) controls STUN/relay use. When it is off and outbound UDP is filtered, the host accepts only LAN connections. The DISA STIG recommends disabling it. — [STIG Viewer V-221558](https://www.stigviewer.com/stigs/google_chrome_current_windows/2025-05-15/finding/V-221558)

**Parsec (proprietary, vendor-run; on-prem relay for Enterprise)**
- A STUN server lets client and host discover their public address and port for UDP hole punching, and a websocket "Signal API" exchanges the candidates. "If UPnP is enabled and functioning properly, or UDP hole punching (leverages STUN) is successful, Parsec will work out-of-the-box." Ports: TCP 443, STUN UDP 3478, and configurable P2P UDP ranges. — [Parsec: Components and Connection Sequence](https://support.parsec.app/hc/en-us/articles/32361410290324-Components-and-Connection-Sequence); [Parsec Connectivity Requirements](https://support.parsec.app/hc/en-us/articles/32381460716180-Parsec-Connectivity-Requirements)
- Host and client must not sit behind double NAT or CGNAT. The on-prem High-Performance Relay (HPR) is part of the Parsec for Teams Enterprise license. Without `app_force_relay`, hosts fall back to Parsec's public STUN if local relays are unreachable. — [Parsec Overview and Prerequisites](https://support.parsec.app/hc/en-us/articles/32381058430740-Overview-and-Prerequisites); [Configure Parsec Relay Server](https://support.parsec.app/hc/en-us/articles/4421486318093-Configure-Parsec-Relay-Server)

### Inferences
- RustDesk's `hbbs` is a minimal rendezvous for a Pager-style design: the PC registers its ID and public key, then heartbeats over UDP 21116; the phone looks up the ID; the server coordinates a hole punch or hands out a relay. The `IdPk` / `KeyExchange` / `signed_params` messages show how to bind a numeric ID to a public key so the rendezvous server is not blindly trusted. Because the code is AGPL-3.0, reusing it (as opposed to studying it) inside a networked service would carry copyleft obligations.
- Numeric IDs (TeamViewer, AnyDesk, RustDesk) are short enough to read over the phone. In all three, the ID is only a locator, and access requires an additional secret: a password, a permanent password, or account-based trust. The same split suits Pager: a short locator ID plus a one-time pairing secret, which then becomes a long-lived device credential.
- TeamViewer's 70% direct-connection figure suggests a relay is needed for roughly 30% of sessions. This is a vendor figure, and it is not comparable across products.
- On iOS a remote-desktop-style always-on heartbeat is only needed on the PC side. The phone only initiates connections, which fits iOS background limits.

### Gaps
- The RustDesk wiki page "How does RustDesk work?" is mostly diagrams, and its text could not be extracted. The exact crypto handshake (how `id_ed25519` signs `IdPk`, and what happens when the Key is wrong) was not confirmed from primary docs.
- How RustDesk assigns IDs (a hash of something, or random 9-digit) was not found in official docs.
- No official AnyDesk whitepaper on relays or ports was retrieved.
- Chrome Remote Desktop PIN storage, "remember PIN" client pairing (`RemoteAccessHostAllowClientPairing`), and how hosts are revoked were not documented in primary sources. Only third-party AnyViewer guides were found.
- TeamViewer and Parsec do not document how a paired or trusted device is revoked beyond BlockList and account management.

## Q4. File sync and transfer apps: Resilio Sync, Nextcloud and Seafile iOS, Pushbullet, KDE Connect (incl. iOS), LocalSend, Magic Wormhole / Warp, Blip, Taildrop (Tailscale)

### Takeaway
Three families exist. (a) **Secret- or key-addressed P2P** (Resilio, Magic Wormhole/Warp, Tailscale): a secret or key both locates and authorizes, and vendor or self-hostable trackers, mailboxes and relays handle reachability. (b) **Server-URL plus per-device token** (Nextcloud, Seafile): no broker at all, the user must make the server reachable, and pairing produces a revocable per-client app password. Nextcloud's Login Flow v2 is a polished browser-based device-grant pattern. (c) **LAN-only TOFU pairing** (KDE Connect, LocalSend): self-signed certs plus fingerprint memory, with no remote access. Tailscale/Taildrop shows that "remote access from anywhere" can be outsourced to a mesh VPN with 180-day key expiry.

### Cited Findings
**Resilio Sync (proprietary; formerly BitTorrent Sync)**
- Sync first downloads a `sync.conf` over HTTPS to learn tracker and relay addresses. The tracker matches peers sharing the same ID. If no direct connection is possible, traffic goes through a relay server, and relayed data stays encrypted. — [Resilio help: What is a Relay Server](https://help.resilio.com/hc/en-us/articles/204754779-What-is-a-Relay-Server); [Resilio help article 204754759](https://help.resilio.com/hc/en-us/articles/204754759)
- The share ID announced to the tracker is derived from the secret but "cannot be used to compute the secret". LAN discovery uses multicast/broadcast on UDP 3838. DHT is a fallback when trackers are down. Predefined hosts (manual IP:port) allow tracker-less operation. These are older forum sources, from around 2013 onward. — [Resilio forum: how do machines find each other via the secret](https://forum.resilio.com/topic/19434-solved-how-do-the-machines-find-each-other-via-the-secret-code/); [Resilio forum: relay and tracker](https://forum.resilio.com/topic/41923-what-is-the-function-of-relay-and-tracker); [Resilio forum: without tracker](https://forum.resilio.com/topic/25667-how-to-find-peer-each-other-without-tracker-server/)

**Nextcloud (open-source self-hosted server; iOS app)**
- Login Flow v1: a one-time webview opens `/index.php/login/flow` with `OCS-APIREQUEST: true`. The server redirects to `nc://login/server:<server>&user:<loginname>&password:<password>`, the values being PHP-urlencoded. — [Nextcloud Login Flow docs](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html)
- Login Flow v2: an anonymous `POST /index.php/login/v2` returns `{poll:{token, endpoint}, login}`. The client opens `login` in the system browser and polls `POST /login/v2/poll` (about once per second) until it gets a 200 carrying `{server, loginName, appPassword}`, which "will only be returned once". The token is valid for 20 minutes, and the browser grant session lasts 5 minutes. — [Nextcloud Login Flow docs](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html)
- "A client never stores the password of the user". Each client gets its own app password that the user can revoke per client from the web UI. The client self-revokes with `DELETE /ocs/v2.php/core/apppassword`. `/ocs/v2.php/core/getapppassword` converts old password logins into app passwords. — [Nextcloud Login Flow docs](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html)

**Seafile (open-source self-hosted server)**
- Clients obtain an API token by form-POSTing username and password to `https://<server>/api2/auth-token/`, and the JSON reply includes `token`. This comes from third-party client code; the official Web API doc is at download.seafile.com/published/web-api. — [Apache OpenDAL Seafile core](https://opendal.apache.org/docs/rust/src/opendal/services/seafile/core.rs.html); [Locoia Seafile connector](https://docs.locoia.com/connectors/connectors/seafile)
- The 2017 iOS SDK guide shows login with server URL, username, password and support for two-step verification. — [seafile-iOS SDK guide (mirror)](https://openharmony.gitee.com/lins05/seafile-iOS/blob/master/Seafile%20iOS%20SDK%20User%20Guide.md)

**Pushbullet (proprietary, vendor cloud)**
- In 2015 Pushbullet added optional end-to-end encryption for notification mirroring, universal copy/paste and SMS. The key is derived from a user-chosen password that is never stored. — [Android Authority, 2015](https://www.androidauthority.com/pushbullet-supports-end-to-end-encryption-sms-notification-mirroring-633075/)

**KDE Connect (open source; iOS app)**
- Both ends use self-signed certificates. Unknown peers connect despite validation errors and stay untrusted until paired. A 2020 audit noted that pairing is just a pair request accepted by the user, with no further authentication. — [oss-security, Oct 2020](https://www.openwall.com/lists/oss-security/2020/10/13/4)
- The protocol uses TOFU (trust on first use) "as is common with SSH". Users can compare certificate fingerprints on both ends. — [ComputerBase, 2016](https://www.computerbase.de/2016-08/linux-kde-connect-1.0-verbindet-desktop-und-smartphone/); [Privacy Guides forum](https://discuss.privacyguides.net/t/add-kde-connect-to-file-sharing-and-sync/13976)
- After pairing, the stored peer certificate is loaded as the trust root, so a MITM presenting a different self-signed cert fails. — [KDE mailing list, 2015](https://mail.kde.org/pipermail/kdeconnect/2015-July/001084.html)
- Third-party implementations identify devices by the cert's SHA-256 fingerprint, require the cert CommonName to equal the device ID, and expose a "verification" fingerprint for out-of-band checks. — [kcd Go package docs](https://pkg.go.dev/github.com/bethropolis/kcd@v1.14.0/internal/cert)
- iOS: the app was rewritten in Swift/SwiftUI during GSoC 2021 and reached the App Store in 2022 (after TestFlight) with a subset of the Android features: clipboard, file and URL sharing. The repo (invent.kde.org/network/kdeconnect-ios) shows 309 commits and 1 release. — [It's FOSS](https://itsfoss.com/news/kde-connect-ios/); [KDE GSoC 2021 report](https://community.kde.org/GSoC/2021/StatusReports/LucasWang); [invent.kde.org kdeconnect-ios](https://invent.kde.org/network/kdeconnect-ios)

**LocalSend (open source, Apache-2.0; LAN only)**
- Protocol v2.2 is "a simple REST protocol that does not rely on any external servers". Discovery uses multicast UDP to 224.0.0.167:53317, with peers answering via an HTTP `register` call; a legacy mode scans all local IPs over HTTP. With HTTPS the fingerprint is "the SHA-256 hash of the certificate" and is used to remember devices. Uploads go `POST /api/localsend/v2/prepare-upload`, then `/upload?sessionId&fileId&token`, with optional `?pin=`. — [LocalSend protocol repo](https://github.com/localsend/protocol)
- The app is Apache-2.0, works "over your local network" without internet, and runs on iOS 13+. — [LocalSend GitHub](https://github.com/localsend/localsend)

**Magic Wormhole and GNOME Warp (open source)**
- Codes like `7-crossover-clockwork` are single-use: a numeric nameplate plus words from a phonetically distinct wordlist. SPAKE2 PAKE turns the short code into a strong key, and all later traffic is encrypted with keys derived from it (NaCl secretbox). The default is a 16-bit code, so a malicious server gets a single 1-in-65536 guess per use, and a failed guess is visible to the peers. — [magic-wormhole docs: Welcome](https://magic-wormhole.readthedocs.io/en/latest/welcome.html)
- The rendezvous server's "Mailbox" is a WebSocket relay of small messages. Nameplates are short numbers the server allocates "as short as possible", pointing to mailboxes with long random IDs, and are released for reuse. Except for PAKE setup, message bodies are encrypted, so the server cannot read them. The server sees IDs, timing and "crowded"/"lonely" moods. — [magic-wormhole server protocol](https://magic-wormhole.readthedocs.io/en/latest/server-protocol.html)
- Transfer path: direct LAN, then direct to a public IP, then the Transit Relay ("the moral equivalent of a TURN server"). Both mailbox and transit URLs can be overridden (`--relay-url`, `--transit-helper`), so they are self-hostable. — [magic-wormhole docs](https://magic-wormhole.readthedocs.io/en/latest/welcome.html)
- GNOME Warp uses the Magic Wormhole protocol, shows the code as both text and a QR code, and interoperates with the CLI. An internet connection is required. GNOME Apps locale pages disagree on the latest version: 0.9.2 (2025-03-26) on one, 1.0.0 (2026-03-27) on others. — [GNOME Apps: Warp](https://apps.gnome.org/ja/Warp/); [It's FOSS](https://itsfoss.com/news/warp-file-sharing/)

**Blip (proprietary)**
- Marketed as P2P with "no intermediate servers", encrypted in transit and auto-resuming, on macOS, iOS, iPadOS and Android. A TidBITS reader suspected relayed traffic, which is unconfirmed. — [TidBITS, Sep 2024](https://tidbits.com/2024/09/06/appbits-use-blip-to-send-large-files-directly/); [Cult of Mac](https://www.cultofmac.com/reviews/blip-file-transfer-awesome-apps)

**Taildrop and Tailscale (client open source; coordination server vendor-run)**
- Taildrop is still "alpha" and admin-enabled ("Send Files"). It works only between devices owned by the same user, not tagged nodes. On iPhone, files are sent from the Share sheet and received into the Tailscale section of the Files app, over encrypted P2P "using the fastest available path". — [Tailscale docs: Taildrop](https://tailscale.com/kb/1106/taildrop?tab=ios)
- The Tailscale coordination server is "essentially, a shared drop box for public keys" plus a policy store. The control plane is hub-and-spoke and the data plane is a mesh. "the private key never, ever leaves its node". DERP relays "blindly forward already-encrypted traffic". Node software and DERP code are open source. — [Tailscale: How Tailscale works](https://tailscale.com/blog/how-tailscale-works)
- Node keys expire after 180 days by default. Expiry can be disabled per device, which is recommended for servers. `tailscale up --force-reauth` renews keys. Auth keys last 1-90 days, and devices stay authorized until their node key expires. — [Tailscale docs: Key expiry](https://tailscale.com/kb/1028/key-expiry); [Tailscale docs: Auth keys](https://tailscale.com/kb/1085/auth-keys/)
- NAT traversal lessons: "packets must flow out before packets can flow back in". Run STUN on the same socket. The hard case is endpoint-dependent ("symmetric") NAT. The birthday-paradox trick helps with one hard NAT, while two hard NATs are impractical. "I'd estimate you could get a direct connection over 90% of the time". Start on a relay and upgrade to direct, and encrypt and authenticate end to end. — [Tailscale: How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works)

### Inferences
- For Pager, Nextcloud Login Flow v2 is the best UX template for turning a one-time human approval into a long-lived per-device credential. The phone starts the flow and the PC user clicks "Grant". The phone receives an app password exactly once, the PC lists it under "paired devices", and either side can revoke it. A QR code shown on the PC can carry the server and pairing token, similar to the `nc://login/...` deep link.
- The Magic Wormhole model (short code plus PAKE through an untrusted mailbox) is the strongest way to pair remotely by code without the user typing a long fingerprint. A one-time code could bootstrap an exchange of long-term public keys, after which Syncthing-style pinned mTLS takes over.
- A pragmatic shortcut for "access from anywhere" is to have the PC and iPhone join a Tailscale tailnet or a self-hosted Headscale; Pager then serves on the tailnet IP. The trade-offs are an extra app or VPN profile on iOS and 180-day key expiry, though expiry can be disabled for the PC.
- LocalSend and KDE Connect show that LAN-only TOFU is easy but does not meet the "remotely" requirement. They are still useful as a LAN fast path and for local pairing.

### Gaps
- Resilio's current official docs were blocked (HTTP 403). The tracker, DHT and key details come from older forums.
- Pushbullet's status in 2025-2026 is unverified: no recent official source found on maintenance or iOS support.
- Whether the current KDE Connect iOS app is actively maintained in 2026 is unconfirmed. Latest commit and release dates were not visible.
- No current official Seafile iOS docs. The token endpoint is confirmed only through third-party client code.
- Not verified this session (from background knowledge only): Nextcloud's security settings page can show a QR code for a new app password; Headscale is an open-source, self-hostable Tailscale control server; magic-wormhole is MIT-licensed; KDE Connect is GPL. These should be confirmed before relying on them.
- Blip's architecture (true P2P or relayed) is unconfirmed.

## Q5. Apple: how Continuity, Handoff and Universal Clipboard work, why Back to My Mac was retired, and what replaced it

### Takeaway
Apple's device-to-device features ride on the iCloud account as the pairing authority. Devices pair BLE out-of-band via APNs and keep per-device AES-256 keys in the Keychain. A TLS-over-Wi-Fi connection then derives trust from an identity synced via iCloud Keychain. These are proximity features, not remote access. Back to My Mac was Apple's remote access to Macs (Bonjour plus IPsec plus Kerberos plus UPnP/NAT-PMP). It was dropped from macOS Mojave in 2018 and shut down for all macOS versions on July 1, 2019, with no official technical reason given. Apple pointed users to iCloud Drive, Screen Sharing and Apple Remote Desktop instead.

### Cited Findings
- Handoff: when a user signs into iCloud on a second device, "the two devices establish a Bluetooth Low Energy (BLE) 4.2 pairing out-of-band using APNs", with messages "encrypted much like messages in iMessage are". Each device generates a 256-bit AES key stored in the Keychain. That key encrypts and authenticates BLE advertisements "using AES-256 in GCM mode, with replay protection". The receiver then opens a Wi-Fi connection "encrypted (with TLS)" that "derives trust through an identity shared through iCloud Keychain". — [Apple Platform Security: Handoff](https://support.apple.com/guide/security/secf78dbe639/web)
- Back to My Mac was introduced in Mac OS X Leopard (10.5). It worked with Bonjour-enabled services, required a router with UPnP or NAT-PMP, used UDP 4500 for point-to-point IPsec, and enabled a local KDC for Kerberos authentication. It moved from MobileMe to iCloud, which made it free. — [Wikipedia: Back to My Mac](https://en.wikipedia.org/wiki/Back_to_My_Mac)
- **Discontinued:** Apple said in August 2018 that Back to My Mac would not be part of macOS Mojave (10.14). A May 31, 2019 update said it would be discontinued "for all other versions of macOS as of July 1, 2019". — [Wikipedia](https://en.wikipedia.org/wiki/Back_to_My_Mac); [iMore](https://imore.com/back-my-mac-being-discontinued-all-versions-macos-july-1)
- Apple's suggested replacements were iCloud Drive for files, Screen Sharing, and Apple Remote Desktop. Commentators noted that BTMM "always was a bit on the unreliable side" (Six Colors). Laptop Mag said it was "unclear why" Apple dropped it, and iMore suggested setup complexity. — [TechRadar](https://www.techradar.com/news/back-to-my-mac-killed-in-all-versions-of-macos); [Six Colors](https://sixcolors.com/?p=3264); [Laptop Mag](https://www.laptopmag.com/articles/apple-back-to-my-mac-removed); [iMore](https://imore.com/back-my-mac-being-discontinued-all-versions-macos-july-1)

### Inferences
- Back to My Mac relied on UPnP/NAT-PMP port mapping and IPsec, with no relay fallback mentioned in the sources. That design is fragile under double NAT or CGNAT, which fits the "unreliable" reputation. Apple's replacement was effectively "put the files in the cloud" (iCloud Drive), not a better tunnel. For Pager, that argues for a relay fallback rather than depending on router port mapping.
- Handoff's pattern (an account-level broker distributes keys, then devices talk directly with TLS pinned to synced identities) is the same control-plane/data-plane split Tailscale uses.
- A third-party iOS app cannot use Continuity or APNs pairing for this purpose, so Apple's design is a conceptual model only.

### Gaps
- Apple never published a technical reason for retiring Back to My Mac.
- Wikipedia does not describe BTMM's wide-area Bonjour or dynamic DNS registration, or whether it used IPv6 or relays. I did not find a primary Apple technical doc.
- Universal Clipboard's specific security description was not separately fetched. It presumably shares the Continuity/Handoff mechanism, which is unverified.

## Q6. Plex-style claim tokens and the OAuth 2.0 Device Authorization Grant (RFC 8628)

### Takeaway
Both patterns use a short-lived, low-entropy code typed or scanned by a human, exchanged for a long-lived credential. In RFC 8628 the device shows a `user_code`, polls with a high-entropy `device_code`, and receives tokens. In Plex, the user fetches a short-lived claim token from plex.tv/claim and gives it to the server on first run, and the server trades it for a real server token. RFC 8628 also documents the main security considerations: rate-limiting user codes, about 34.5 bits of entropy from an 8-character base-20 alphabet, and remote phishing.

### Cited Findings
- RFC 8628 flow:
  1. The client POSTs its client_id to the device authorization endpoint.
  2. It receives `device_code`, `user_code`, `verification_uri`, optional `verification_uri_complete` (for QR or NFC; the user_code must still be displayed), `expires_in`, and `interval` (default 5 seconds).
  3. The client polls the token endpoint and gets `authorization_pending`, `slow_down` (add 5 seconds to the interval permanently), `access_denied`, or `expired_token`.
  — [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html)
- For `device_code`, "a very high entropy code SHOULD be used". The `user_code` example is "WDJB-MJHT". The RFC recommends an 8-character base-20 code (no vowels, no confusable characters), about 34.5 bits, together with rate-limiting, so that roughly 5 guesses per validity window keep success odds near 2^-32. — [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html)
- RFC 8628 security considerations: remote phishing, where an attacker sends a victim a URL and code to approve the attacker's device (mitigated by telling users they are authorizing a device and asking them to confirm the code matches the device); user-code and device-code brute force; session spying; and treating devices as public clients. — [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html)
- Plex: the claim token comes from `https://www.plex.tv/claim` and is "The claim token for the server to obtain a real server token". `PLEX_CLAIM` is a first-run-only parameter, ignored if the server is already logged in. Without it, setup needs an SSH tunnel. — [plexinc/pms-docker README](https://github.com/plexinc/pms-docker)
- Plex documents no official claim-token lifetime. Community sources say 4 minutes most often, but also 3 or 5. — [Umbrel community](https://community.umbrel.com/t/fixing-plexs-not-authorized-error/10523.md); [Pocketables](https://pocketables.com/?p=135038); [TrueNAS forum](https://forums.truenas.com/t/how-to-install-plex-server-on-dragonfish/10386/3)

### Inferences
- If Pager ever adds a cloud account or broker, RFC 8628 is the off-the-shelf way to link the iPhone: the PC shows a code or QR, the phone approves it (or the reverse), and the result is a refreshable token. Without a cloud account, the same idea collapses to a PC-local pairing endpoint: the PC displays a short code with a few minutes' TTL, the phone POSTs it, and the PC issues a per-device credential, with rate-limiting per the RFC's entropy guidance.
- The claim-token pattern (server-side, first-run, short TTL) corresponds to the PC "claiming" a Pager cloud ID, if a hosted rendezvous is used.
- The RFC's remote-phishing warning applies to a Pager pairing code: the PC should show which device is pairing (name, model) and require local confirmation.

### Gaps
- Plex's own `plex.tv/link` PIN flow for TVs and players was not researched. Its similarity to RFC 8628 is assumed, not verified.
- No official Plex documentation of claim-token TTL was found.

## Q7. Cross-cutting: central broker vs self-hosting, how pairing is persisted, how a paired device is revoked, and which projects are open source (license)

### Takeaway
Every product that works "from anywhere" behind NAT runs some rendezvous/discovery service and a relay. The difference is who runs it and whether it is trusted. Syncthing, RustDesk, Magic Wormhole and (via its open DERP code) Tailscale let you self-host and treat the broker as untrusted. QuickConnect, TeamViewer, Chrome Remote Desktop and Parsec require the vendor's infrastructure. Pairing is persisted either as pinned public keys/certs (Syncthing, KDE Connect, LocalSend, Tailscale node keys, Apple Keychain identities) or as per-device bearer credentials (Nextcloud app passwords, OAuth tokens, RustDesk permanent passwords). Revocation is easiest when each phone has its own credential.

### Cited Findings
**Broker and self-hosting matrix**

| Product | Broker / relay operator | Self-hostable? | Source |
|---|---|---|---|
| Syncthing | Public discovery (`discovery.syncthing.net`) and community relays | Yes; pin your own discovery and relay | [Global Discovery v3](https://docs.syncthing.net/specs/globaldisco-v3.html); [Relaying](https://docs.syncthing.net/users/relaying.html) |
| RustDesk | Public servers, or your own hbbs/hbbr | Yes (OSS, AGPL-3.0; Pro paid) | [rustdesk-server](https://github.com/rustdesk/rustdesk-server); [Self-host docs](https://rustdesk.com/docs/en/self-host/) |
| Synology QuickConnect | Synology cloud plus relay | No | [Synology](https://www.synology.com/en-global/dsm/feature/network_management) |
| TeamViewer | TeamViewer master servers and router network | No self-hosting found | [Security Statement](https://www.teamviewer.com/en/global/support/knowledge-base/teamviewer-remote/security/security-statement/) |
| AnyDesk | AnyDesk cloud | On-prem appliance option | [AnyDesk on-prem](https://support.anydesk.com/docs/on-premises.md) |
| Chrome Remote Desktop | Google signaling plus TURN in Google data centers | No | [Google network guide](https://support.google.com/chrome/a/answer/16364503) |
| Parsec | Parsec STUN and Signal API | Relay only (HPR, Enterprise) | [Parsec relay](https://support.parsec.app/hc/en-us/articles/4421486318093-Configure-Parsec-Relay-Server) |
| Resilio | Resilio tracker and relay | Partial: disable and use predefined hosts | [Resilio forum](https://forum.resilio.com/topic/25667-how-to-find-peer-each-other-without-tracker-server/) |
| Magic Wormhole | Public mailbox and transit relay | Yes (`--relay-url`, `--transit-helper`) | [magic-wormhole docs](https://magic-wormhole.readthedocs.io/en/latest/welcome.html) |
| Tailscale / Taildrop | Tailscale coordination server plus DERP | DERP code open source | [How Tailscale works](https://tailscale.com/blog/how-tailscale-works) |
| Nextcloud / Seafile | None; the user's own server must be reachable | Self-hosted by design | [Nextcloud Login Flow](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html) |
| LocalSend / KDE Connect | None (LAN only) | N/A | [LocalSend protocol](https://github.com/localsend/protocol); [oss-security](https://www.openwall.com/lists/oss-security/2020/10/13/4) |
| Apple Handoff | iCloud/APNs | No | [Apple Platform Security](https://support.apple.com/guide/security/secf78dbe639/web) |

**Persistence and revocation**
- Syncthing persists its own `key.pem`/`cert.pem` and the peer device IDs it expects, and drops connections from IDs it is not expecting. — [Syncthing Device IDs](https://docs.syncthing.net/dev/device-ids.html)
- Nextcloud issues a per-client app password, revocable per client from the web UI or by the client itself with `DELETE /ocs/v2.php/core/apppassword`. — [Nextcloud Login Flow](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html)
- Tailscale node keys expire after 180 days by default (can be disabled per device). Auth keys last at most 90 days. — [Tailscale key expiry](https://tailscale.com/kb/1028/key-expiry); [Tailscale auth keys](https://tailscale.com/kb/1085/auth-keys/)
- TeamViewer uses Trusted Devices (email approval), AllowList/BlockList, and Easy Access. — [TeamViewer Security Statement](https://www.teamviewer.com/en/global/support/knowledge-base/teamviewer-remote/security/security-statement/)
- KDE Connect stores the paired peer's certificate and uses it as the trust root. — [KDE mailing list](https://mail.kde.org/pipermail/kdeconnect/2015-July/001084.html)
- LocalSend uses the cert SHA-256 fingerprint "to remember devices". — [LocalSend protocol](https://github.com/localsend/protocol)
- Apple Handoff keeps per-device AES keys in the Keychain and synced identities in iCloud Keychain. — [Apple Platform Security](https://support.apple.com/guide/security/secf78dbe639/web)
- RFC 8628 ends with OAuth access tokens, and the device is treated as a public client. — [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html)

**Open source and licenses (verified this session)**
- Syncthing core is MPL-2.0, and Möbius publishes its core modifications. The Möbius iOS app itself is closed. — [Möbius Sync FAQ](https://mobiussync.com/faq/)
- The RustDesk server is AGPL-3.0. — [rustdesk-server GitHub](https://github.com/rustdesk/rustdesk-server)
- LocalSend is Apache-2.0. — [LocalSend GitHub](https://github.com/localsend/localsend)
- Tailscale's node software and DERP server code are open source. — [How Tailscale works](https://tailscale.com/blog/how-tailscale-works)
- The KDE Connect iOS source is public at invent.kde.org; its license file was not readable in the fetch. — [invent.kde.org](https://invent.kde.org/network/kdeconnect-ios)
- The magic-wormhole protocol and server are documented publicly, with self-hostable servers. — [magic-wormhole docs](https://magic-wormhole.readthedocs.io/en/latest/server-protocol.html)
- Proprietary: TeamViewer, AnyDesk, Chrome Remote Desktop, Parsec, QuickConnect, Resilio, Blip, Pushbullet, Möbius iOS app (per the sources above).

### Inferences
A recommended architecture for Pager, synthesized from the patterns above:
1. **Identity:** On first run, the PC generates an Ed25519 or ECDSA keypair and a self-signed TLS cert. The computer ID is SHA-256(cert DER), shown in base32 with check digits as in Syncthing. A short display alias, like a QuickConnect or RustDesk ID, can be used purely as a lookup key.
2. **Pairing UX:**
   - LAN or in person: the PC shows a QR code containing the fingerprint, LAN addresses, a rendezvous/relay hint and a one-time pairing secret with a TTL of a few minutes (the claim-token and RFC 8628 TTL idea). The phone scans it, as Möbius scans Syncthing QR codes.
   - Remote pairing without a QR code: use a Magic Wormhole-style short code with PAKE over an untrusted mailbox.
   - Either way, the PC user confirms the request, which follows the RFC 8628 phishing guidance.
3. **Persistence:** The phone generates its own keypair and cert, stored in the iOS Keychain. The PC stores the phone's fingerprint in SQLite as a "paired device" row, and the phone stores the PC's fingerprint. All later connections use mutual TLS pinned to both fingerprints, as in Syncthing. If raw mTLS is awkward with Hono, an alternative is a per-device revocable bearer token in the style of Nextcloud app passwords, issued over a pinned-TLS channel.
4. **Reachability:** Try LAN first (mDNS or a cached IP), then a rendezvous lookup, then a hole punch, then a relay.
   - The rendezvous can be a tiny service in the Syncthing global-discovery style: the PC POSTs its addresses authenticated by client cert, and the phone GETs them by ID. The relay can follow Syncthing's relay or RustDesk's hbbr.
   - Because the phone's TLS runs end to end through the relay, the relay is untrusted, unlike QuickConnect's Portal path.
   - The lowest-effort alternative is a Tailscale or Headscale tailnet (with key expiry disabled for the PC).
5. **iOS reality:** Expect no persistent background socket (Möbius: about 1-2 hours per day of opportunistic background time). Treat "permanent access" as a permanent credential with on-demand reconnection, and cache downloaded books, highlights and progress locally for offline use. Only the PC side should keep a heartbeat to the rendezvous, as RustDesk clients "constantly ping" hbbs.
6. **Revocation:** The PC UI lists paired devices with last-seen times and deletes the row or fingerprint. The phone offers "unpair", which calls a revoke endpoint as Nextcloud does with `DELETE apppassword`. Optional expiry follows Tailscale's 180-day default.
7. **Ops cost:** A self-run rendezvous plus relay is a small always-on VPS. A direct connection is expected in most cases (TeamViewer about 70%, Tailscale estimates over 90%), but relay bandwidth for book downloads must still be budgeted. EPUB and DOCX files are small compared with remote-desktop video.

### Gaps
- No primary sources found on bandwidth or cost figures for running Syncthing community relays or RustDesk public servers.
- Licenses not verified this session (background knowledge only, needs confirmation): magic-wormhole (MIT), Tailscale client (BSD-3-Clause), Headscale (BSD-3-Clause), KDE Connect (GPL-2.0+/GPL-3.0), Nextcloud iOS (GPL-3.0), Seafile iOS (Apache-2.0 or GPL), RustDesk client (AGPL-3.0).
- Revocation flows are not documented for Chrome Remote Desktop, AnyDesk, Parsec or RustDesk OSS. RustDesk OSS appears to rely on changing the permanent password, which is inferred and not verified.
- Cloudflare Tunnel, ngrok and similar reverse-tunnel products, and WebRTC data channels from iOS, were outside this assignment and not researched here.
