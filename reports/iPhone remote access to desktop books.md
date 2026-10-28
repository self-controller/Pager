# Pin the computer's key, then mirror its books

Every product that has solved "my phone reaches my specific computer from anywhere" (Syncthing, RustDesk, TeamViewer, Tailscale, Plex, Synology QuickConnect) splits the problem into three jobs. A **locator** tells a rendezvous service where the computer is right now. A **key** proves that the machine at that address really is your computer. A **ladder of routes** (same LAN, then direct WAN, then hole punching, then a relay) gets packets through NAT and carrier-grade NAT (CGNAT). The soundest "computer ID" for Pager is the hash of a public key the desktop generates on first run, the same idea as Syncthing's device ID, iroh's endpoint ID and Tailscale's node key. The iPhone pairs once by scanning a QR code that carries that fingerprint plus a single-use 128-bit secret, and then holds a per-device credential that the desktop can list and revoke. On iOS, "permanent access" cannot mean a permanent connection. Apple suspends backgrounded apps, and the Syncthing client Möbius Sync gets about 1–2 hours of background activity a day. So permanence has to mean three things: a credential that never needs re-entering, a local mirror of the books, and a delta sync each time the app opens. The fastest working path for Pager is Tailscale on Fedora and on the iPhone plus a QR-paired app. It needs no networking code and is free on the Personal plan. For an app that other people could install, use iroh 1.0, which has official Node and Swift bindings and dials peers by public key with relay fallback, backed by a self-hosted relay. Pager already has the hardest sync pieces: W3C-style anchors with re-anchoring, a sequenced journal, and a live stream that resumes from `Last-Event-ID`. But it binds to loopback and authorizes requests by the `Host` header, so remote access starts with replacing that guard with device authentication. The app can be built from Linux in 2026, with xtool for SwiftUI or macOS CI for a Capacitor wrapper that reuses the React UI. Separately, a $99/year developer account is what stops the installed app itself from expiring every seven days.

## Prior art splits every design into a locator, a key and a relay

Remote-desktop tools, file-sync apps, NAS vendors, media servers and mesh VPNs all end up with the same three layers. Where they differ is who runs the rendezvous and relay, and whether those services are trusted with the traffic. The designs that aged best treat the broker as untrusted and keep authentication end to end.

### Syncthing turned the computer ID into a certificate hash

Syncthing is the closest existing match to "pair by computer ID, no account."

**Identity.** On first start each device generates a keypair (Ed25519 today, ECDSA or RSA in older versions) and a self-signed certificate. Its **device ID is the SHA-256 of that certificate's DER bytes**, base32-encoded with Luhn-mod-32 check digits ([Syncthing docs: Device IDs](https://docs.syncthing.net/dev/device-ids.html)). Because the ID is the fingerprint, it is also the trust anchor. After the mutual TLS handshake, each side computes the peer's ID from its certificate and drops the connection if that ID is not on its configured list. An impostor would therefore need a second preimage, not just a collision ([Syncthing docs](https://docs.syncthing.net/dev/device-ids.html)).

**Untrusted helpers.** Everything else only helps peers find each other. Global discovery accepts an HTTPS POST of a device's addresses and derives the announcer's ID from its TLS client certificate, so announcements cannot be spoofed. Clients look up a peer with `GET ?device=<ID>` ([Global Discovery v3](https://docs.syncthing.net/specs/globaldisco-v3.html)). Relays are used only when a direct connection fails. They carry a normal TLS session they cannot read and are dropped once a direct path works, though relayed throughput is "much lower than a direct connection" ([Syncthing: Relaying](https://docs.syncthing.net/users/relaying.html)). Resilio Sync uses the same split: trackers match peers by a share ID derived from the secret, and relayed data stays encrypted ([Resilio help](https://help.resilio.com/hc/en-us/articles/204754779-What-is-a-Relay-Server)).

**Revocation and weaknesses.** Revocation falls out of the design: delete a device ID from the config and its connections are refused. Syncthing's docs admit two weaknesses. Local discovery is not cryptographically protected, and 56-character IDs are hard to read aloud or type, which is why the docs float shorter IDs or out-of-band PIN pairing ([Syncthing docs](https://docs.syncthing.net/dev/device-ids.html)).

**The iOS warning.** The iOS client Möbius Sync pairs by scanning the desktop's ID as a QR code. It also shows the iOS limit clearly: syncing happens only while the app is open or briefly woken, can take up to 24 hours to start, and settles at "a total of 1-2h of sync activity per day" ([Möbius Sync FAQ](https://mobiussync.com/faq/)). Mobile clients are fragile in general: Syncthing's official Android app was retired with the December 2024 release, citing Google Play permission rules and a lack of maintainers. It lives on as the community Syncthing-Fork ([AlternativeTo](https://alternativeto.net/news/2024/10/the-syncthing-android-app-is-being-discontinued-but-alternatives-remain-available)).

### Remote-desktop tools treat the numeric ID as an address, not a password

TeamViewer, AnyDesk, RustDesk, Chrome Remote Desktop and Parsec all use a short ID to find a machine and something separate to authorize access to it.

**RustDesk** is the open, self-hostable reference. `hbbs` is the ID/rendezvous server and `hbbr` the relay. Clients "constantly ping the ID server" so it knows their current address. hbbs coordinates a hole punch that "succeeds in most cases" and falls back to hbbr ([RustDesk docs: Self-host](https://rustdesk.com/docs/en/self-host/)). Its public protobuf protocol shows how to bind an ID to a key: `RegisterPk{id, uuid, pk}`, `PunchHoleRequest`, `RequestRelay`, and a signed `IdPk{id, pk}` bundle ([rendezvous.proto](https://raw.githubusercontent.com/rustdesk/hbb_common/main/protos/rendezvous.proto)). The server is AGPL-3.0, so reusing its code (as opposed to studying it) inside a networked service brings copyleft obligations ([rustdesk-server](https://github.com/rustdesk/rustdesk-server)).

**TeamViewer** derives IDs from hardware and software characteristics. It reports a direct connection "in 70 percent of all cases", with the rest routed through its relays. It moved to mutually authenticated TLS 1.3 in v15.73, and it throttles password guessing with exponential waits ("17 hours for 24 failed attempts") ([TeamViewer Security Statement](https://www.teamviewer.com/en/global/support/knowledge-base/teamviewer-remote/security/security-statement/)).

**Chrome Remote Desktop** runs WebRTC in Direct, STUN or TURN mode, with TURN traffic relayed through Google data centers. Its access code is "a combination of its Host ID and a secret code" ([Google network guide](https://support.google.com/chrome/a/answer/16364503)).

**Parsec** relies on STUN hole punching. Its docs say host and client must not sit behind double NAT or CGNAT; the on-prem relay that works around this requires an Enterprise licence ([Parsec prerequisites](https://support.parsec.app/hc/en-us/articles/32381058430740-Overview-and-Prerequisites)).

Tailscale's engineers estimate that careful NAT traversal gets a direct path "over 90% of the time". Their design starts on a relay and upgrades to direct when it can ([Tailscale: How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works)).

The lesson for Pager is that split. A short ID works fine as a locator. A static "ID plus password" reachable from the internet is an online brute-force target, which is why TeamViewer needs lockouts measured in hours to defend it.

### Vendor brokers trade convenience for control

**Synology QuickConnect** maps a user-chosen, globally unique ID to a NAS, which keeps registering its current addresses with Synology's cloud. Clients try a direct LAN/WAN connection, then hole punching introduced by Synology's server, then a slow relay ([WunderTech](https://www.wundertech.net/synology-quickconnect-ultimate-setup-guide/)). Synology markets this as end-to-end encrypted ([Synology DSM 7.4 spec](https://www.synology.com/en-global/dsm/7.4/software_spec/network_external_access)). Secondhand accounts of its white paper say otherwise for one path: browser sessions routed through the "Portal" server have their HTTP headers decrypted and modified, while native apps use a virtual tunnel without that behavior. The sources therefore conflict on whether the browser path is truly end to end ([WunderTech](https://www.wundertech.net/synology-quickconnect-ultimate-setup-guide/)).

**Plex** built the most complete vendor stack:
- a 4-character code entered at plex.tv/link ([Plex Support](https://support.plex.tv/articles/203395277-connect-app-to-your-plex-account/))
- automatic UPnP/NAT-PMP port mapping that fails under double NAT ([Plex Support: Remote Access](https://support.plex.tv/articles/200289506-remote-access/))
- a DigiCert wildcard certificate for each server under `*.HASH.plex.direct`, so every LAN or public IP gets valid HTTPS ([Filippo Valsorda](https://words.filippo.io/how-plex-is-doing-https-for-all-its-users/))
- a relay that forum users report caps at roughly 1–2 Mbps ([Plex Forum](https://forums.plex.tv/t/wan-streaming-issue-2mbps-max/786838/2))

That relay became the business lever:
- **April 29, 2025:** the Remote Watch Pass launched at $1.99/month ([BetaNews](https://betanews.com/2025/03/19/plex-2025-price-changes-remote-streaming-new-subscription/)).
- **May 2026:** remote streaming needed a pass even with a working port forward. Plex cited relay infrastructure cost, and Android Authority put the pass at about $30/year, a figure not confirmed on plex.tv ([Android Authority](https://www.androidauthority.com/plex-remote-streaming-free-3663446/)).
- **September 2026:** the paywall reached third-party clients such as Infuse ([Firecore](https://community.firecore.com/t/changes-to-plex-remote-streaming-requirements/60825)).

A September 2025 breach of plex.tv account and authentication data showed the other cost of a central broker ([TechCrunch](https://techcrunch.com/2025/09/09/plex-urges-users-to-change-passwords-after-data-breach/)).

**Emby Connect** sits at the opposite extreme: a free account whose "sole purpose" is to help devices locate the server. "All connections are direct", and remote access must already work before you set it up ([Emby Support](https://emby.media/support/articles/Emby-Connect.html)).

**Apple's Back to My Mac** combined Bonjour, IPsec, Kerberos and router UPnP/NAT-PMP, with no relay described in the sources. Apple dropped it from Mojave and shut it down for all macOS versions on July 1, 2019, pointing users to iCloud Drive instead ([Wikipedia](https://en.wikipedia.org/wiki/Back_to_My_Mac); [iMore](https://imore.com/back-my-mac-being-discontinued-all-versions-macos-july-1)). Apple's surviving device-to-device features, such as Handoff, use the iCloud account as the pairing authority, with identities synced through iCloud Keychain ([Apple Platform Security](https://support.apple.com/guide/security/secf78dbe639/web)). Third-party apps can study that model but cannot use it.

### Pairing ceremonies already proven in the field

Several pairing flows have shipped at scale:
- **Nextcloud Login Flow v2.** The client POSTs anonymously, opens a browser where the user grants access, and polls about once a second. The app password arrives exactly once, and the polling token is valid for 20 minutes. Each client's password can be revoked from the web UI, or by the client itself with `DELETE /ocs/v2.php/core/apppassword` ([Nextcloud Login Flow](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html)).
- **Jellyfin Quick Connect** reverses the direction. The new device shows a 6-digit code that an already signed-in device approves, with a 10-minute timeout and a 32-byte polling secret ([QuickConnectManager.cs](https://github.com/jellyfin/jellyfin/blob/master/Emby.Server.Implementations/QuickConnect/QuickConnectManager.cs)).
- **RFC 8628 (OAuth device grant)** puts numbers on short-code risk. An 8-character base-20 code holds about 34.5 bits, so only about 5 guesses per validity window keep an attacker's odds near 2^-32. It also warns about "remote phishing", where a victim is tricked into approving an attacker's device ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html)).
- **Magic Wormhole** codes such as `7-crossover-clockwork` carry only 16 bits, but they feed SPAKE2, a password-authenticated key exchange (PAKE). A malicious server therefore gets a single 1-in-65,536 guess per code, and a wrong guess is visible to both peers ([magic-wormhole docs](https://magic-wormhole.readthedocs.io/en/latest/welcome.html)).
- **HomeKit** is the most instructive. An 8-digit setup code drives 3072-bit SRP only to exchange long-term Ed25519 keys. After that, every session runs a station-to-station handshake with fresh Curve25519 keys ([Apple Platform Security: HomeKit](https://support.apple.com/guide/security/homekit-communication-security-sec3a881ccb1/web)). HAP-NodeJS refuses further pairing attempts after 100 failures ([HAPServer.ts](https://github.com/homebridge/HAP-NodeJS/blob/latest/src/lib/HAPServer.ts)).
- **Home Assistant** covers the end of a credential's life. Refresh tokens expire after 90 days unused, access tokens last 30 minutes, and `/auth/revoke` kills a refresh token "and every access token it ever created" ([HA auth API](https://contributors.home-assistant.io/core/internals/auth-api/)).
- **KDE Connect and LocalSend** do LAN-only trust-on-first-use, remembering each peer's certificate fingerprint ([LocalSend protocol](https://github.com/localsend/protocol); [oss-security](https://www.openwall.com/lists/oss-security/2020/10/13/4)). That is fine for pairing at home and no help for remote access.

| Product | What the "ID" is | What actually authorizes | Broker and relay | Lesson for Pager |
|---|---|---|---|---|
| Syncthing + Möbius Sync | SHA-256 of device certificate | Mutual TLS pinned to configured IDs | Public or self-hosted discovery and relays, all untrusted | Make the computer ID a key hash |
| RustDesk | Numeric ID | Permanent password plus server Ed25519 key | Self-hostable hbbs/hbbr (AGPL-3.0) | Readable rendezvous protocol |
| TeamViewer / AnyDesk | Numeric ID | Password, trusted devices, lockouts | Vendor servers and relays | The ID is a locator, not a secret |
| Chrome Remote Desktop / Parsec | Host ID / account | Account plus PIN or code | Vendor STUN and TURN | Relays decide CGNAT success |
| Synology QuickConnect | User-chosen global ID | Synology account plus TLS | Synology cloud; not self-hostable | A friendly ID must not be the trust anchor |
| Plex | plex.tv account; 4-character link code | Account token | plex.tv, plex.direct certificates, relay | A vendor relay becomes a paywall |
| Emby Connect | Account | Server credentials | Lookup only, no relay | Minimal ID-to-URL registry |
| Tailscale | Node public key | WireGuard keys | Coordination server plus encrypted DERP relays | Outsource reachability entirely |
| Magic Wormhole | One-time code | SPAKE2 | Self-hostable mailbox and transit relay | Use a PAKE if codes are typed |
| Nextcloud / Jellyfin | Server URL | Per-device app password or token | None; the user exposes the server | Per-device revocable credentials |
| KDE Connect / LocalSend | Certificate fingerprint | Trust on first use, LAN only | None | LAN pairing only |
| Back to My Mac | iCloud account | Kerberos plus IPsec | Router port mapping, no relay | Retired in 2019 |

### Book servers never built a broker, and their iOS clients keep dying

None of the book or comic servers surveyed runs a cloud broker or relay:
- **calibre's content server** expects users to forward port 8080 or run a reverse proxy. Its browser reader needs HTTPS for full offline mode because that mode depends on service workers ([calibre manual](https://manual.calibre-ebook.com/server.html)).
- **Kavita** gives each user an OPDS URL with an embedded auth key, and its wiki says iOS apps require HTTPS for remote connections ([Kavita Wiki: OPDS](https://wiki.kavitareader.com/guides/features/opds/); [Kavita Wiki: Komic](https://wiki.kavitareader.com/guides/3rdparty/komic/)).
- **Komga** issues API keys that are shown once and can be revoked; native iOS clients such as KMReader sign in with them ([Komga Docs: KMReader](https://komga.org/docs/guides/kmreader)).
- **Audiobookshelf's** official app is a NuxtJS + Capacitor codebase, which is a direct precedent for wrapping a web UI. It is still "early beta" on TestFlight, and the beta is full at Apple's 10,000-tester cap ([audiobookshelf-app](https://github.com/advplyr/audiobookshelf-app)). Its move to rotating JWT access and refresh tokens brought repeated logout fixes and CVE-2026-73085, in which refresh tokens were accepted on resource endpoints ([OSV](https://osv.dev/vulnerability/CVE-2026-73085)).

The list of dead or broken iOS clients is long:
- Calibre Companion broke with calibre 5 in 2020 ([MobileRead](https://www.mobileread.com/forums/showthread.php?p=4043150)).
- Marvin disappeared from the App Store around 2023 and now breaks for many users on iOS 26 ([MobileRead](https://www.mobileread.com/forums/showthread.php?p=4570649)).
- KyBook 3's last update was v0.7.8 in February 2019 ([App Store](https://apps.apple.com/app/id1348198785)).
- Readarr was archived on June 27, 2025 ([GitHub](https://github.com/Readarr/Readarr)).
- The Kuboo client for Ubooquity "died" ([MobileRead](https://www.mobileread.com/forums/showthread.php?p=4597787)).

BookLore is in maintenance mode, and **sources disagree about its successor**. BookLore's own README names BookOrbit as the "official successor" and says a native offline-capable iOS app is in development ([BookLore README](https://github.com/booklore-app/booklore)). ElfHosted instead calls Grimmory the community continuation of BookLore and treats BookOrbit as a separate project, and BookOrbit's creator has denied that it is a fork ([ElfHosted](https://docs.elfhosted.com/app/bookorbit/); [Lemmy thread](https://lemmy.amethyst.name/post/1449401/602033)).

The healthiest iOS ebook client in 2026 is Readest, an AGPL-3.0 Tauri app built on foliate-js. It reads OPDS catalogs and supports KOReader sync ([GitHub readest](https://github.com/readest/readest)).

Users of all these servers have settled on the same fix:
- Immich says "Never forward port 2283 directly to the internet" and recommends Tailscale, which works behind NAT with no open port ([Immich Docs](https://docs.immich.app/guides/remote-access/)).
- Jellyfin marks port forwarding "not recommended!" ([Jellyfin Docs](https://jellyfin.org/docs/general/post-install/networking/)).
- Firecore tells Infuse users to use Tailscale instead of Plex Remote Access ([Firecore](https://community.firecore.com/t/changes-to-plex-remote-streaming-requirements/60825)).
- 2026 comparison write-ups recommend Tailscale for your own devices and Cloudflare Tunnel with an access policy for people who cannot install software ([needtoknowit](https://needtoknowit.com.au/blog/tailscale-vs-cloudflare-tunnels-for-remote-access/)).

After setup itself, the most common mobile complaint is the app picking the wrong server URL. Immich's Wi-Fi-name-based URL switching needs "always" precise-location permission to read the network name ([Linuxiac](https://linuxiac.com/immich-1-122-brings-hdr-video-support-in-the-mobile-app/)). It hangs 7–10 seconds when several networks are configured ([immich #21930](https://github.com/immich-app/immich/issues/21930)), and it keeps trying the local URL after leaving home ([immich #15220](https://github.com/immich-app/immich/issues/15220)). No book server ships a pairing code, so a Pager that pairs by QR code and tests its routes automatically would do something this category has not done.

## iOS redefines "permanent access" as a credential plus a local mirror

The most important constraint is that **an iPhone app cannot keep a connection to the PC open**:
- Apple's developer support (DTS) guidance is blunt. iOS suspends an app "shortly after the user has moved it to the background", a background network server is impossible ("You can't"), large transfers belong in a background `URLSession`, and an app the user force-quits is never relaunched in the background ([Apple DTS: iOS Background Execution Limits](https://developer.apple.com/forums/thread/685525)).
- `BGAppRefreshTask` provides "up to 30 seconds" at a time the system chooses. `BGProcessingTask` runs deferrable work, such as overnight while charging ([Apple: Choosing Background Strategies](https://developer.apple.com/tutorials/data/documentation/backgroundtasks/choosing-background-strategies-for-your-app.md)).
- Silent pushes sent "more frequently than three times per hour" are throttled ([Apple: Choosing Background Strategies](https://developer.apple.com/tutorials/data/documentation/backgroundtasks/choosing-background-strategies-for-your-app.md)), against device-wide budgets, and delivery can stop if the user hasn't opened the app for a while ([Apple Developer Forums 660149](https://developer.apple.com/forums/thread/660149)).
- iOS 26 added `BGContinuedProcessingTask`. A task the user starts in the foreground can keep running in the background, with progress shown in a Live Activity, but it is not meant for automatic sync ([Apple: BGContinuedProcessingTask](https://developer.apple.com/tutorials/data/documentation/backgroundtasks/bgcontinuedprocessingtask.md); [Apple Developer Forums 797538](https://developer.apple.com/forums/thread/797538)).

iOS 27 shipped on September 14, 2026, for the same A13-and-newer devices as iOS 26 ([Wikipedia: iOS 27](https://en.wikipedia.org/wiki/IOS_27)). This research found no iOS 27 changes to the background, networking or File Provider APIs.

The tool that does work in the background is the out-of-process background `URLSession`. Downloads continue while the app is suspended. The system relaunches the app to deliver completions, and the downloaded temporary file must be moved before the delegate method returns ([Apple: Downloading files in the background](https://developer.apple.com/documentation/foundation/downloading-files-in-the-background.md)).

This creates the **decisive architectural fork in the whole design**:
- **System-run downloads.** The system executes background sessions, so they can reach only an ordinary URL the OS can route to: a public HTTPS endpoint, a LAN address, or a tailnet address carried by the system Tailscale VPN (that last case is unverified).
- **In-app network stacks.** A stack embedded inside the app process, such as iroh, TailscaleKit or WebRTC, runs only while the app runs. Its downloads happen in the foreground, or (inferred from Apple's description, not tested) during a `BGContinuedProcessingTask` the user started.

Either way, "permanent access" comes down to three durable things:
- **A pairing credential** that never needs re-entering.
- **Local copies of the books** in Application Support with backup exclusion. Caches is the wrong place, because the system can delete it when storage runs low ([Apple Developer Forums 107071](https://developer.apple.com/forums/thread/107071)).
- **A delta sync** of progress and highlights each time the app opens.

Pager's live event stream becomes a foreground speed-up rather than the sync channel.

Two networking rules shape the transport choice:
- **Local Network permission.** Apple's TN3179 (revised October 6, 2026) defines a "local network" as one on a broadcast-capable interface such as Wi-Fi or Ethernet, "but not cellular (WWAN) or VPN". These operations need the user's Local Network permission: outgoing TCP to a LAN address, resolving `.local` names, and every Bonjour operation. There is no API to query that permission, and an app working in the background while the permission is still undetermined is denied silently. Traffic from WKWebView is exempt ([Apple TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)).
- **App Transport Security (ATS).** ATS requires HTTPS for `URLSession`. Since iOS 17 it also blocks connections to raw IP addresses unless the app declares `NSAllowsLocalNetworking` or lists specific IPs or CIDR ranges ([Apple: NSAllowsLocalNetworking](https://developer.apple.com/tutorials/data/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking.md)).

Pager's current server speaks plain HTTP on loopback only, which a phone cannot use under these rules, so every implementation below adds TLS somewhere.

## Seven transport families can carry the iPhone to port 3006

Pager listens only on 127.0.0.1 and ::1 (`server/src/server.ts`), so the question is which path carries phone traffic to that loopback socket. The seven families are:
1. a system overlay VPN
2. an overlay embedded in the app
3. a public HTTPS tunnel
4. an embedded peer-to-peer stack
5. a self-run relay
6. direct exposure of the PC
7. LAN discovery

The home connection is the hard end. A phone on cellular CGNAT can always dial out. If the Fedora PC is also behind CGNAT or double NAT, router port mapping cannot help, because UPnP, NAT-PMP and PCP only reach the nearest NAT ([Tailscale: How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works)).

### Overlay networks need no code but take the phone's only VPN slot

Tailscale is the zero-code answer for a single owner.

**Plans.** The free Personal plan now covers up to 6 users (raised from 3) with unlimited user devices, for non-commercial use. Standard costs $8 and Premium $18 per user per month. This plan structure is new in 2026, so older posts quoting "3 users / 100 devices" are out of date ([Tailscale pricing](https://tailscale.com/pricing)).

**How it gets through NAT.** It hole-punches using STUN and handles one "hard" NAT with birthday-paradox probing. When no direct path exists, it falls back to DERP relays, which forward WireGuard-encrypted traffic they cannot read ([Tailscale: How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works); [Tailscale DERP](https://tailscale.com/kb/1232/derp-servers)). Customer-run peer relays became generally available on February 18, 2026 ([Tailscale blog](https://tailscale.com/blog/peer-relays-ga)). Whether the beta's free allowance of two peer relays survived general availability is unconfirmed.

**Exposing Pager.** `tailscale serve` exposes a local port to the tailnet only, at `device.tailnet.ts.net`, with HTTPS certificates ([Tailscale Serve](https://tailscale.com/kb/1312/serve)). That gives the phone a hostname with a CA-issued certificate, which satisfies ATS without exceptions, and traffic over the VPN does not trigger the Local Network prompt under TN3179's definition. Node keys expire after 180 days by default, but expiry can be disabled per device, which Tailscale recommends for servers ([Tailscale key expiry](https://tailscale.com/kb/1028/key-expiry)).

**Costs.** The phone needs an extra app, and it is subject to the one-VPN rule: only one enterprise VPN configuration can be active at a time, and starting another stops the first ([Apple Developer Forums 675507](https://developer.apple.com/forums/thread/675507); [Tailscale KB](https://tailscale.com/kb/1105/other-vpns)).

**Funnel** would make the server public without any VPN on the phone. It is in beta, limited to ports 443, 8443 and 10000, and subject to unpublished bandwidth limits. Its relays do not decrypt traffic ([Tailscale Funnel](https://tailscale.com/kb/1223/funnel)).

Tailscale can also be **embedded in the app**, so the user never installs it:
- **TailscaleKit**, the Swift package in Tailscale's libtailscale repo, runs a userspace network stack and provides a `URLSession` configuration for tailnet requests. It describes its iOS framework as "suitable for app-store submissions", and its README does not mention needing a VPN entitlement ([TailscaleKit](https://github.com/tailscale/libtailscale/tree/main/swift)).
- A Flutter wrapper around the same tsnet core confirms "no VPN entitlement" on iOS. It also warns that tsnet uploads diagnostic logs to Tailscale unless the app opts out ([pub.dev tailscale](https://pub.dev/packages/tailscale)).
- Channels DVR shipped a TestFlight build with Tailscale embedded for exactly this reason ([Channels community](https://community.getchannels.com/t/new-dvr-server-tailscale-integration-for-easier-away-from-home-access-experimental/33392?page=4)).

The catch is tenancy. Every phone still needs credentials for *some* tailnet, and the Personal plan is non-commercial and capped at six users. Node has no official tsnet binding, so on the Pager side you would use the system daemon or a small Go tsnet sidecar ([Tailscale tsnet](https://tailscale.com/kb/1244/tsnet)). Headscale is a BSD-3-Clause, self-hosted control server that implements a single tailnet for personal use ([headscale](https://github.com/juanfont/headscale)), and the Tailscale iOS app accepts a custom control server URL ([Tailscale docs](https://tailscale.com/kb/1507/custom-control-server?tab=ios)).

The other overlays are weaker fits:
- **ZeroTier.** The official pricing page (effective August 4, 2026) lists the free plan at 10 devices and 1 network ([ZeroTier pricing](https://www.zerotier.com/pricing.md)), and ZeroTier staff say accounts created before the change keep 25 devices ([ZeroTier forum](https://discuss.zerotier.com/t/can-i-increase-device-from-10-to-25-as-like-previously/23892)). A Serverspace post claiming "three networks since Nov 5 2025" contradicts the official page.
- **NetBird** moved its server components to AGPLv3 at v0.53.0 ([WZ-IT](https://wz-it.com/en/blog/netbird-self-hosting-license-commercial-starter/)).
- **Nebula** advertises 100 free devices ([Defined](https://defined.net/blog/introducing-oidc-single-sign-on-for-admins/)).
- **Plain WireGuard** via WireGuardKit needs a Network Extension target and a reachable endpoint, because it does no NAT traversal of its own ([wireguard-apple](https://github.com/WireGuard/wireguard-apple)).

### Public tunnels give a plain HTTPS URL and hand someone else the plaintext

A reverse tunnel gives the phone an ordinary public HTTPS URL. It is the only family that satisfies background `URLSession`, ATS, and App Review's demand for a reachable demo server, all without an SDK in the app.

**Cloudflare Tunnel** is the strongest free option. `cloudflared` makes outbound-only connections, so it works through CGNAT with inbound traffic blocked ([Cloudflare Tunnel docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)), and Cloudflare Access is free for up to 50 users ([Cloudflare blog](https://blog.cloudflare.com:8443/teams-plans)). Four caveats matter for Pager:
- **No SSE on quick tunnels.** Free quick tunnels "do not support Server-Sent Events (SSE)" ([Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)), so Pager's `/stream` needs a named tunnel, which means owning a domain.
- **Cloudflare sees everything.** It terminates TLS at its edge, so it can read books and tokens ([GetPublicIP](https://getpublicip.com/guides/self-hosting/getpublicip-vs-cloudflare-tunnel-vs-tailscale)).
- **Large-file terms.** The CDN terms reserve the right to limit accounts serving "a disproportionate percentage of pictures, audio files, or other large files" ([Cloudflare Service-Specific Terms](https://www.cloudflare.com/service-specific-terms-application-services/)). Community readings conflict on whether this applies to Tunnel: Lumadock calls it a grey zone tolerated for personal use, while IBRACORP calls Plex/Jellyfin streaming over Tunnel a violation ([Lumadock](https://lumadock.com/tutorials/cloudflare-tunnel-jellyfin); [IBRACORP](https://docs.ibracorp.io/docs/networking/cloudflare-tunnel)). EPUBs of a few megabytes are far from the video case.
- **Access breaks native apps.** Cloudflare Access redirects unauthenticated requests to an identity-provider login page, which native apps cannot follow. That is why Audiobookshelf users asked for service-token headers in the app ([audiobookshelf-app #254](https://github.com/advplyr/audiobookshelf-app/issues/254)).

The commercial alternatives are too limited for permanent use:
- **ngrok's** free tier allows 1 GB and 20,000 requests a month and shows an interstitial page; Hobbyist costs $10/month for 5 GB ([ngrok pricing](https://ngrok.com/pricing)).
- **zrok's** free tier was described by a forum moderator as 10 GB per 24 hours ([OpenZiti forum](https://openziti.discourse.group/t/is-there-any-upload-or-download-limit-for-free-accounts/2862)).

The self-hosted tunnels all need a VPS, and they keep TLS ending on the PC only if configured to forward raw TCP:
- frp (Apache-2.0, with an `xtcp` P2P mode) ([frp](https://github.com/fatedier/frp))
- rathole ([rathole](https://github.com/rapiz1/rathole))
- Pangolin ([needtoknowit](https://needtoknowit.com.au/blog/tailscale-vs-cloudflare-tunnels-for-remote-access/))
- bore, which encrypts nothing after the initial handshake ([bore](https://github.com/ekzhang/bore))

### Embedded peer-to-peer makes the computer ID a public key

The embedded stacks turn "pair by computer ID" into a literal implementation.

**Iroh**, from n0, identifies endpoints by Ed25519 public keys and dials them over QUIC. It hole-punches with a design derived from Tailscale's and falls back to relays, and Delta Chat uses it on iOS and Android ([iroh blog](https://iroh.computer/blog/the-road-to-iroh-1-0)). The 1.0 release, which declared the wire format and API stable, has **a release-date conflict**. The announcement post is bylined July 9, 2026, but a release tracker lists v1.0.1 on June 29, 2026 and v1.0.3 on July 20, 2026 ([iroh blog](https://iroh.computer/blog/the-road-to-iroh-1-0); [newreleases v1.0.1](https://newreleases.io/project/github/n0-computer/iroh/release/v1.0.1); [newreleases v1.0.3](https://newreleases.io/project/github/n0-computer/iroh/release/v1.0.3)). The safe statement is that 1.0 shipped in summer 2026, no later than early July.

**Bindings.** Crucially for Pager, iroh-ffi ships official bindings for both ends, dual-licensed Apache-2.0/MIT ([iroh-ffi](https://github.com/n0-computer/iroh-ffi); [iroh docs: languages](https://docs.iroh.computer/languages); [iroh docs: JavaScript](https://docs.iroh.computer/languages/javascript.md)):
- Swift: SwiftPM `IrohLib`, an iOS + macOS xcframework.
- Node.js: `@number0/iroh`, built with napi-rs, requiring Node ≥ 20.3.0, with official Linux glibc support.

They mirror the 1.0 API, though the repo is labelled "tier 2" for review rigor.

**Relays.** n0's public relays are free but rate-limited, with unpublished limits, and are "meant for development and hobby use". A self-hosted `iroh-relay` has no rate limit by default ([iroh docs: rate limiting](https://docs.iroh.computer/relays/rate-limiting)). A managed shared-relay tier at $19/month appeared only in a search summary and is unverified ([iroh blog: shared relays](https://iroh.computer/blog/shared-relays)).

**The engineering cost.** Iroh carries byte streams, not HTTP, so Pager needs a bridge. On the Node side, accept iroh connections on a custom ALPN and pipe them to `127.0.0.1:3006`. On iOS, run a loopback proxy or frame HTTP over the QUIC streams.

The other embedded stacks:
- **WebRTC data channels** are the mature alternative. node-datachannel provides prebuilt Node 22 bindings (MPL-2.0) ([node-datachannel](https://github.com/murat-dogan/node-datachannel)). stasel/WebRTC and LiveKit publish current iOS xcframeworks ([Swift Package Registry: stasel](https://swiftpackageregistry.com/stasel)). Cloudflare offers free STUN, and TURN at $0.05/GB after 1,000 GB a month ([Cloudflare TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/)). WebRTC still needs a signaling service, and it leaves HTTP multiplexing and reconnection to you.
- **Hyperswarm via Bare Kit** runs the same JavaScript on Node and in an iOS worklet. But HyperDHT "does not do any relaying by default" and fails when both peers are behind randomizing NATs unless you add a blind relay, and the iOS host API is Objective-C ([Pear docs: HyperDHT](https://docs.pears.com/building-blocks/hyperdht); [Pear docs: Bare mobile](https://docs.pears.com/guides/making-a-bare-mobile-app)).
- **swift-libp2p** requires iOS 26+ and Swift 6.2, with no evidence of on-device hole-punch testing ([swift-libp2p](https://swiftpackageregistry.com/1amageek/swift-libp2p)).
- **Tor:** Arti on mobile is "quite experimental and not actively maintained" ([Guardian Project](https://tordev.guardianproject.info/tor-on-ios/arti-and-onionmasq-on-ios)).
- **Veilid:** only Flutter access was found, with no Swift binding ([veilid mirror](https://git.hackliberty.org/Git-Mirrors/veilid/src/branch/logging-update/veilid-flutter/example)).

### A self-run relay costs about $2 a month for book-sized traffic

The simplest design with no SDK on either end is a relay you run yourself:
1. Pager dials out to `wss://relay.example/desktop?id=<computerId>`.
2. The phone calls `https://relay.example/c/<computerId>/api/...`.
3. The relay forwards each request as a framed message over the desktop's socket and streams the response back.

This survives any CGNAT and gives the phone a real HTTPS URL that background sessions can use.

**Cost.**
- Fly.io's smallest machine costs $2.19/month plus $0.02/GB egress ([Fly.io pricing](https://docs.fly.io/about/pricing)), so moving 5 GB of books a month costs under $3.
- Hetzner's entry cloud server rose from €3.29 to €4.49 on April 1, 2026. Secondary sources conflict on the server names (SKUs) and on a further June adjustment ([agentdeals](https://agentdeals.dev/hetzner-pricing-2026); [findstack](https://findstack.com/resources/hetzner-price-increase-2026)).
- Cloudflare Durable Objects on the free plan suit the signaling/rendezvous tier, and hibernating WebSockets are not billed for idle time ([Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)).

**Encryption.** The relay operator (you) can read everything unless the app adds its own end-to-end layer. Syncthing's relay, RustDesk's hbbr and `iroh-relay` already provide that layer.

This is where Plex's economics flip. Plex put remote access behind a paywall because relaying video is expensive; Pager relays kilobytes to megabytes of text and JSON.

### Port forwarding and LAN discovery are fast paths, not plans

**Direct exposure.** Port forwarding plus dynamic DNS works only with a public IPv4 address and a cooperative router:
- Starlink residential and many ISPs put customers behind CGNAT ([DishyTech](https://www.dishytech.com/does-starlink-have-port-forwarding/)).
- IPv6 first passed 50% of Google traffic on June 21, 2025 ([Internet Society Pulse](https://pulse.internetsociety.org/en/blog/18-years-later-ipv6-reaches-majority/)), but stateful firewalls still block unsolicited inbound connections ([Tailscale](https://tailscale.com/blog/how-nat-traversal-works)).
- If Pager ever wants an opportunistic direct path, the Node package `node-portmapping` wraps libplum for PCP, NAT-PMP and UPnP ([npm node-portmapping](https://npmjs.com/package/node-portmapping)).

**LAN discovery.** Fedora's Avahi can advertise `_reader._tcp` for the iPhone's `NWBrowser` to find. But the Local Network prompt "cannot be avoided if you want to use Bonjour", the service type must be listed in `NSBonjourServices`, and developers report inconsistent prompt behavior ([Apple Developer Forums 653316](https://developer.apple.com/forums/thread/653316); [Apple Developer Forums 826268](https://developer.apple.com/forums/thread/826268)). A QR code shown in the desktop UI avoids Bonjour entirely.

| Approach | On the iPhone | Change on Fedora | Works with CGNAT at home | Who can read traffic | Background URLSession | 2026 cost | Best use |
|---|---|---|---|---|---|---|---|
| Tailscale app + `tailscale serve` | Tailscale VPN app | Install daemon, one command | Yes (DERP, peer relays) | Endpoints only | Unverified | Free Personal plan | Owner-only MVP |
| TailscaleKit + tsnet sidecar or Headscale | Nothing extra | Go sidecar; tailnet tenancy | Yes | Endpoints only | No (in-process) | Free, or a VPS for Headscale | Power users |
| ZeroTier / NetBird / Nebula | VPN app | Install agent | Yes | Endpoints only | Unverified | Free tiers, limits vary | Tailscale alternatives |
| Cloudflare named tunnel + Access | Nothing extra | `cloudflared`, a domain | Yes | Cloudflare | Yes | Free plus a domain | Owner with a domain |
| Tailscale Funnel | Nothing extra | Tailscale on the PC | Yes | The PC only (TLS ends there) | Yes | Free (beta) | Demos, review server |
| ngrok / zrok | Nothing extra | Agent | Yes | Provider edge (unverified) | Yes | ngrok free 1 GB/month | Testing |
| frp / rathole / Pangolin + VPS | Nothing extra | Agent plus VPS | Yes | Depends on config | Yes | VPS | Self-hosters |
| iroh embedded | Nothing extra | `@number0/iroh` bridge | Yes (relay) | Endpoints only (QUIC) | No (in-process) | Own relay, ~$2–5/month | Distributable app |
| WebRTC data channels | Nothing extra | node-datachannel plus signaling | Yes, with TURN | Endpoints only | No (in-process) | TURN $0.05/GB after 1 TB | Distributable, more code |
| Hyperswarm via Bare | Nothing extra | Hyperswarm plus blind relay | Partly | Endpoints only | No (in-process) | Own blind relay | JS-heavy teams |
| DIY WebSocket relay | Nothing extra | Outbound socket client | Yes | The relay, unless the app adds E2E | Yes | ~$2–5/month plus egress | Distributable app with background downloads |
| Port forward / UPnP / IPv6 + DDNS | Nothing extra | TLS, auth, router setup | No | Endpoints, if TLS is used | Yes | Free | Opportunistic fast path |
| Bonjour on LAN | Local Network permission | Avahi advertisement | LAN only | Endpoints, if TLS is used | Yes, on the LAN | Free | Pairing and home fast path |

## A QR code and a device key beat any typed computer ID

### The QR code carries the fingerprint, the secret and the routes

The camera reading the desktop screen is an authenticated out-of-band channel: an attacker would have to see the screen. A QR code can therefore carry high-entropy material that nobody would ever type. A pairing QR code should carry:
- **The server's public-key fingerprint**, so the phone pins the PC and defeats a man-in-the-middle even on the very first connection.
- **A single-use secret of at least 128 bits.** It authenticates the phone without any PAKE, because it cannot be guessed.
- **Candidate addresses:** LAN IP, tailnet name, and a relay URL or iroh ticket.
- **An expiry** a few minutes out.

A concrete form:

`pager://pair?v=1&sid=<server_id>&fp=<SHA-256 of SPKI>&addr=192.168.1.20:3006,reader-pc.tailnet.ts.net&sec=<secret>&exp=<unix>&name=<pc name>`

This is Syncthing's "the ID is the certificate hash" without the typing. It also follows HomeKit's principle: a pairing secret is used once to bind long-term keys and is then thrown away ([Syncthing](https://docs.syncthing.net/dev/device-ids.html); [Apple Platform Security: HomeKit](https://support.apple.com/guide/security/homekit-communication-security-sec3a881ccb1/web)). Following RFC 8628's anti-phishing guidance, the desktop should also ask "Allow 'David's iPhone'?" before completing the pairing, which also defeats a photographed QR code ([RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628#section-5)).

The alternatives are each weaker:
- **A static "computer ID plus password"** is a permanent, low-entropy secret reachable from the internet. That is why TeamViewer layers exponential lockouts and trusted-device email checks on top of it.
- **A short code typed on the phone**, sent over TLS that hasn't been pinned yet, can be relayed by an active attacker unless a PAKE binds the code to the session.
- **The reverse, Jellyfin-style flow** (phone shows a code, desktop approves) resists remote brute force, because approval happens on the trusted desktop. But it needs a fingerprint comparison to stop an attacker substituting their own key on the first connection.

The PAKE landscape explains why a typed-code fallback is costly on iOS:
- **SPAKE2** is RFC 9382, from September 2023 ([RFC 9382](https://www.rfc-editor.org/rfc/rfc9382.html)).
- **OPAQUE** is RFC 9807. The RFC Editor lists July 2025, though one copy of the text says June ([RFC 9807](https://www.rfc-editor.org/rfc/rfc9807.html)).
- **CPace** draft-21 sits in the RFC Editor queue ([Datatracker](https://datatracker.ietf.org/doc/draft-irtf-cfrg-cpace/)).
- Yet a GitHub search found **no Swift SPAKE2 or OPAQUE implementations at all** ([GitHub search](https://api.github.com/search/repositories?q=spake2+language:swift)).
- **SRP-6a** is the only PAKE with maintained libraries on both ends: `fast-srp-hap` on Node (HAP-NodeJS uses it with 3072-bit/SHA-512 parameters) and `adam-fowler/swift-srp` on iOS. It is the same construction HomeKit uses ([homebridge/fast-srp](https://github.com/homebridge/fast-srp); [swift-srp](https://github.com/adam-fowler/swift-srp)). Interoperability between those two libraries is untested.

### Per-device credentials, revocation and expiry

After pairing, the phone needs a credential that the desktop can list and revoke. There are several options.

**Bearer token (simplest sound option).** A 256-bit random token, the size Latacora recommends ([Latacora](https://www.latacora.com/blog/post-quantum-cryptographic-right-answers/)). The server returns it once and stores only its SHA-256 hash, the same model as Nextcloud app passwords and Komga API keys. Its weakness is that a stolen token works until someone revokes it.

**Secure Enclave device key (stronger).**
- The phone generates a P-256 key in the Secure Enclave, which supports P-256 but not Ed25519 ([Apple CryptoKit SecureEnclave](https://developer.apple.com/documentation/cryptokit/secureenclave)), and registers the public key at pairing.
- At launch, it signs a server challenge to get a 15-minute access token. The long-lived credential never leaves the phone, so it cannot be stolen.
- Node 22's `crypto.verify` checks the resulting ES256 signature natively. Pick CryptoKit's signature encoding deliberately: raw r‖s (verify with `dsaEncoding: 'ieee-p1363'`) or DER (Node's default).

**Mutual TLS (strongest gate).** It lets Node refuse unauthenticated clients before any Hono route runs. The cost is on iOS: a `SecIdentity` can only be built through PKCS#12 import or the keychain, not from a CryptoKit key plus a certificate ([Apple Developer Forums 733534](https://developer.apple.com/forums/thread/733534)).

**Signed requests (RFC 9421).** Per-request HTTP message signatures have a maintained Node library, but the only Swift implementation found has zero stars ([http-message-signatures](https://github.com/dhensby/node-http-message-signatures); [swift-httpsig](https://github.com/hellocoop/swift-httpsig)).

**App Attest** proves the request comes from a genuine build of your app, not that the user authorized it, and its keys do not survive a reinstall ([Apple: App Attest](https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity)).

**Revocation and expiry**, borrowed from Home Assistant:
- a `devices` table with name, created and last-seen times, last IP, and `revoked_at`
- revocation that cascades to every short-lived token
- automatic expiry after 90 idle days
- a "rotate server identity" button that forces every phone to re-pair
- for loaders that cannot attach headers (for example an image request inside WKWebView), Home Assistant-style signed URLs that are valid for seconds to minutes ([HA auth API](https://contributors.home-assistant.io/core/internals/auth-api/))

**Server identity.** On first run, generate a P-256 key and a long-lived self-signed certificate with Node `crypto` plus `@peculiar/x509` ([PeculiarVentures/x509](https://github.com/PeculiarVentures/x509)). Use P-256 rather than Ed25519 because iOS acceptance of Ed25519 TLS certificates is unverified. Derive the computer ID from the hash of the certificate's public key (its SPKI).

**Pinning on the phone.** A `URLSession` delegate answers the server-trust challenge by hashing the presented key and comparing it with the pinned value. Apple's guidance is to pin a public key rather than a single certificate and to keep a set of keys for rotation. It also notes that apps "cannot loosen server trust requirements for an ATS-protected domain" ([Apple: manual server trust](https://developer.apple.com/documentation/foundation/performing-manual-server-trust-authentication)). That rule matters here:
- Pinned self-signed certificates work for LAN IPs and `.local` names under `NSAllowsLocalNetworking`.
- A public DNS name, such as a tunnel hostname, needs a real CA-issued certificate.
- If the transport is iroh or Tailscale, the transport's own key pinning already does this job, and the pinned TLS becomes a second, independent layer.

### Pager's loopback guard must give way to device authentication

Pager's current security model is well built for a single machine and wrong for a phone.

**What it does today.** The server listens only on loopback. A global `app.use("*", localOnly)` middleware in `server/src/http/security.ts` rejects any request whose `Host` is not `localhost`, `127.0.0.1` or `[::1]`, and any change request whose `Origin` or `Sec-Fetch-Site` header is foreign. API.md describes this as protection against DNS rebinding and cross-site requests.

**Why that can't be remote access control.** Every remote transport above ends at a local bridge: `tailscale serve`, `cloudflared`, or an iroh-to-loopback pipe. Such a bridge does one of two things:
- It preserves the external hostname, and the guard returns 403.
- It rewrites `Host` to localhost, and every remote request becomes indistinguishable from a local one and passes through unauthenticated.

**The fix.**
- Keep `localOnly` for the browser UI on loopback.
- Add a separate authenticated surface: a TLS listener or route group whose global middleware requires a paired-device token and checks `revoked_at` on every request.
- Exempt only `POST /pair` and a health route.
- Make the surface an allowlist of reading, progress and annotation routes rather than the whole API. Today `POST /sources` accepts any absolute path on the PC.
- Keep the pairing route closed by default. Open it only while the desktop shows a QR code (five minutes or one successful pairing, whichever comes first), compare secrets in constant time, and close it after a handful of failures. `hono-rate-limiter` and `rate-limiter-flexible` are both current ([npm hono-rate-limiter](https://www.npmjs.com/package/hono-rate-limiter)).

**Known Hono advisories.** Pager's dependency ranges (`hono` ^4.13.13, `@hono/node-server` ^2.1.5) already clear the 2026 advisories:
- the repeated-slash bypass of route-scoped middleware, fixed in hono 4.12.12 and `@hono/node-server` 1.19.13 ([GitLab CVE-2026-39406](https://advisories.gitlab.com/npm/@hono/node-server/CVE-2026-39406/))
- the encoded-backslash path traversal, fixed in hono 4.12.25 and `@hono/node-server` 2.0.5 ([GitLab CVE-2026-54286](https://advisories.gitlab.com/npm/hono/CVE-2026-54286/))

Those advisories are still the argument for global auth middleware, which Pager already uses, rather than middleware scoped to a path prefix.

**One more posture change** deserves an explicit opt-in. API.md promises that "the server makes no other network calls". Any rendezvous heartbeat or relay connection breaks that promise.

## Fedora can build the app, but the stack decides how

### Capacitor reuses the React reader; SwiftUI buys the platform

Pager has an advantage most self-hosted servers lack. The server already parses EPUB, DOCX, Markdown and HTML into one sectioned HTML format with stable block IDs (API.md), so the phone does not need its own EPUB engine. It can mirror the server's rendered sections and show them with the same React components. That makes an app built on WKWebView (Apple's embedded web view) the least-work route.

**Capacitor** wraps the existing Vite build in WKWebView and still allows native Swift plugins and extension targets ([Capacitor iOS docs](https://capacitorjs.com/docs/ios)). Recent and upcoming releases:
- Capacitor 8 made Swift Package Manager the default ([Ionic](https://ionic.io/blog/announcing-capacitor-8)).
- Capacitor 8.5 (July 31, 2026) adopted UIScene, which iOS 27 requires for apps built with the latest SDK ([Ionic: Capacitor 8.5](https://ionic.io/blog/capacitor-8-5-released)).
- Ionic forecasts Capacitor 9 for late November 2026, just before CocoaPods trunk becomes permanently read-only on December 2, 2026 ([Ionic blog](https://ionic.io/blog/?p=6904)).

**Expo** "DOM components" (marked with `'use dom'`) can embed the web reader inside a React Native shell. They are needed because React Native "generally does not support elements like `<div>`" ([Expo DOM components](https://docs.expo.dev/guides/dom-components/)).

**A Home Screen web app (PWA)** reuses everything, with no Mac and no fee:
- iOS 26 opens every site added to the Home Screen as a web app by default ([heise](https://heise.de/-10749652)).
- Home Screen apps escape Safari's 7-day storage cap and get large storage quotas ([WebKit](https://webkit.org/blog/14403/updates-to-storage-policy/)).
- But a PWA gets no background downloads and no Bonjour. Its storage is best-effort and can be evicted unless `navigator.storage.persist()` is granted. Each URL is a separate origin with its own storage, and service workers require HTTPS.

**Native SwiftUI** gives the deepest platform integration, including Readium Swift Toolkit and File Provider extensions, at the price of rebuilding the highlight UI. Readium reached 3.11 in 2026, though some Swift 6 build configurations fail ([Readium blog](https://blog.readium.org/tag/swift/); [Swift Package Index](https://swiftpackageindex.com/builds/C800DC5B-2BE6-462C-9A71-D9F92F6A6D2F)).

**Skip**, now free and open source, matters only if Android also becomes a goal ([Skip blog](https://skip.tools/blog/skip-is-free)).

**Two App Review rules apply to every wrapper.** Guideline 4.2 rejects a "repackaged website", and 2.5.2 forbids downloading code that changes the app's functionality ([App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)). So the UI must be bundled inside the app, never loaded live from `http://pc:3006`.

| Stack | Reuses Pager's React UI | Build route from Fedora | Background downloads and Files integration | Main risk |
|---|---|---|---|---|
| Home Screen PWA | All of it | No build needed | None; Web Push only | Evictable storage; HTTPS needed per origin |
| Capacitor | Nearly all | macOS CI (GitHub Actions, Codemagic) | Custom Swift plugin plus Xcode extension targets | CI dependency; Guideline 4.2 if the app is too thin |
| Expo + DOM components | Pager view as a web-view component | EAS cloud builds | expo-apple-targets for extensions | Two UI layers |
| SwiftUI native (+ Readium) | None | xtool on Linux | Full | Rebuilding the UI |
| Tauri 2 mobile | Most | macOS CI | Smaller plugin ecosystem | Less mature on iOS |
| Flutter / Skip | None | macOS CI | Full | No React reuse |

### Three no-Mac toolchains exist in October 2026

**xtool** is now a credible native-Linux path for SwiftUI. It builds SwiftPM packages into iOS apps, signs them, installs them over USB, and talks to Apple Developer Services. It uses an iOS SDK built from an `Xcode.xip` that you supply yourself ([xtool GitHub](https://github.com/xtool-org/xtool)). Its release log shows steady progress ([xtool releases](https://github.com/xtool-org/xtool/releases)):
- custom entitlements in 1.12.0 (May 2025)
- app extensions in 1.14.0 (July 2025)
- Swift 6.4 support in 1.20.0 (September 2026)
- v1.24.0 on October 26, 2026

It also shows three Apple ID sign-in fixes in October alone, a sign that App Store Connect API keys are the sturdier sign-in path. At its May 2025 announcement it lacked Interface Builder, asset catalogs, integrated debugging and App Store deployment ([Swift Forums](https://forums.swift.org/t/xtool-cross-platform-xcode-replacement-build-ios-apps-on-linux-and-more/79803)). Commentators noted it does not settle questions about Xcode's licence terms ([OSNews](https://www.osnews.com/page/45/?not=apple)).

**Expo EAS** builds in the cloud. Its live pricing page lists 15 free iOS builds a month, which contradicts older snapshots advertising 30; a tracker dates the cut to August 28, 2026 ([Expo pricing](https://expo.dev/pricing); [PricingSaaS](https://pricingsaas.com/companies/expo)). Builds for a physical device still need a paid Apple account ([Expo](https://expo.dev/articles/testing-and-previewing/test-ios-app-without-mac)).

**macOS CI.** Capacitor and Tauri builds need Xcode, which means a macOS machine in CI:
- GitHub Actions macOS runners are free in public repos and $0.062/minute otherwise ([GitHub Docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).
- Codemagic offers 500 free macOS minutes a month ([CI/CD Calculator](https://cicdcalculator.com/codemagic-pricing)).
- AWS EC2 Mac has a 24-hour minimum allocation, which makes it the worst fit for occasional builds ([AWS EC2 Mac FAQ](https://aws.amazon.com/ec2/instance-types/mac/faqs/)).

Since April 28, 2026, every upload to App Store Connect must be built with Xcode 26 or later using the iOS 26 SDK ([Apple: Upcoming requirements](https://developer.apple.com/news/upcoming-requirements/)).

### $99 a year is what makes the install itself permanent

"Permanent access" also applies to the app binary itself.

**Free Apple ID.** Provisioning profiles expire after 7 days. You can have at most 3 apps per device and register 10 App IDs per 7 days ([Apple: Compare memberships](https://developer.apple.com/support/compare-memberships/)). A free build therefore means re-signing every week through xtool, AltStore or SideStore.

**$99/year Developer Program.** Provisioning lasts a year, and TestFlight builds last 90 days for up to 10,000 external testers ([TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview)). The Audiobookshelf team has run its official iOS app on TestFlight for years.

**EU Web Distribution** requires organization-level eligibility that an individual hobbyist will not meet ([Apple: Web Distribution](https://developer.apple.com/support/web-distribution-eu/)).

**The App Store** is reachable but has specific traps for "connect to your own server" apps:
- **Guideline 2.1** requires a working demo account, with the backend live during review ([Guidelines](https://developer.apple.com/app-store/review/guidelines/)). An app that worked only with the user's local Pi-hole was rejected because no public endpoint could be provided ([Apple Developer Forums 815919](https://developer.apple.com/forums/thread/815919)).
- **Guideline 4.2.3** says an app should "work on its own without requiring installation of another app", which makes "install Tailscale first" a review risk.

A public demo instance of Pager with public-domain books behind a tunnel, plus a demo pairing code in the review notes, addresses both rules.

## Pager already owns the hard half of sync

### Zero-app shortcuts trade annotations for speed

Before writing any iOS code, Pager can reach existing iPhone apps through standard protocols:
- **OPDS feed.** Serve OPDS 1.2 (Atom) for the widest client support, optionally OPDS 2.0 (JSON) alongside it, behind HTTP Basic auth. That lets Readest, Panels, Yomu, PocketBook, CaliMob and EverReed browse and download the library ([OPDS 2.0 spec](https://specs.opds.io/opds-2.0.html); [App Store: Readest](https://apps.apple.com/us/app/id6738622779); [CaliMob](https://caliwebapp.com/en/opds-reader)). The draft OPDS Progression API lets a few clients write progress back; the server answers 409 when it holds a newer position ([OPDS Progression 1.0](https://drafts.opds.io/opds-progression-1.0.html)).
- **KOReader-compatible progress sync (kosync).** Routes such as `PUT /syncs/progress` and `GET /syncs/progress/:document` would sync progress with Readest and KOReader devices. crosspoint-sync stores progress per device with newest-wins, to avoid the back-and-forth of stock kosync servers ([crosspoint-sync](https://github.com/crosspoint-reader/crosspoint-sync)). Kavita "strongly advise[s] against" naive automatic sync because it undoes reading progress ([Kavita wiki](https://wiki.kavitareader.com/guides/3rdparty/koreader/)).
- **SMB and WebDAV.** The iOS Files app speaks only SMB to network servers ([Cryptomator docs](https://docs.cryptomator.org/ios/cloud-management/)). Tailscale documents browsing a Mac's SMB shares from Files over the tailnet ([Tailscale docs](https://tailscale.com/docs/reference/troubleshooting/apple/cant-access-macos-from-iphone)); Samba on Fedora should work the same way, though that was not tested. For third-party apps, the Node library Nephele (Apache-2.0, a full RFC 4918 WebDAV implementation) can serve the books folder ([npm nephele](https://npmjs.com/package/nephele)).
- **Cloud folders** work for one-way book transport. rclone's iCloud Drive backend needs two-factor re-authentication about every 30 days ([rclone](https://rclone.org/iclouddrive/)). Syncthing with Möbius Sync stays off the cloud but is held to its 1–2 hours of daily background time.

All of these shortcuts share one limit. DOCX, Markdown and HTML are not formats OPDS readers open, and highlights stay inside the third-party app. None of them delivers Pager's annotations or its re-anchoring.

### A small hand-rolled protocol beats every 2026 sync engine

The drop-in sync engines mostly assume a different server:
- PowerSync, ElectricSQL and Zero require Postgres (or MongoDB/MySQL) ([PowerSync](https://github.com/powersync-ja); [Zero docs](https://zero.rocicorp.dev/docs/connecting-to-postgres)).
- cr-sqlite has been dormant since October 2024 ([ecosyste.ms](https://awesome.ecosyste.ms/projects/github.com%2Fvlcn-io%2Fcr-sqlite)).
- Realm Device Sync reached end of life on September 30, 2025 ([MongoDB](https://mongodb.com/docs/atlas/device-sdks/deprecation)).
- Evolu is TypeScript-only, and Ditto is commercial ([Ditto docs](https://docs.ditto.live/v4-4/ditto-basics)).

CRDTs (data types that merge concurrent edits automatically) are optional. Automerge has the clearest pairing of a JS server with a Swift client, but `automerge-repo-swift` described its API as "far from stable" at 0.2.0 ([Swift Forums](https://forums.swift.org/t/automerge-repo-swift-edition/71467)). Loro's Swift bindings are labelled experimental ([loro-swift](https://github.com/loro-dev/loro-swift)). A CRDT pays off only for note bodies edited on two devices at once.

The proven pattern is smaller:
- **Books** are mirrored on the phone, stored by content hash, from a manifest the phone pulls "since cursor".
- **Progress** is one row per book and device, newest wins. If the newest position is behind this device's own, prompt the user, as OPDS Progression prescribes.
- **Annotations** get UUIDs generated on the device and sync with row-level last-writer-wins plus tombstones for deletions.

Two failure modes to avoid:
- Infuse users report the server's progress overwriting offline progress after reconnecting ([Firecore](https://community.firecore.com/t/sync-offline-watch-progress-of-downloaded-content-to-jellyfin/51353)).
- Audiobookshelf's token churn (above) shows why, for one owner, a long-lived per-device credential beats rotating refresh tokens.

### The journal, anchors and revisions are already a sync API

Pager's existing contract (API.md) already covers most of that protocol:
- **Change cursor.** Every change appends a `JournalEvent` in the same database transaction. `GET /events?after=<seq>` lists events after a cursor, and `/stream` replays from `Last-Event-ID` before following live. An offline phone can therefore catch up by sequence number, which no surveyed book server documents.
- **Safe replay of offline writes.** `POST /documents/:id/annotations` accepts a client-supplied `id` and returns the existing annotation when the same id and payload are sent again. That makes an offline outbox safe to replay.
- **Anchors.** They already follow W3C Web Annotation selectors: a range, a position in the document's text, and the quoted text with 32 characters of context. They re-attach as `anchored`, `moved`, `fuzzy` or `orphaned` and are never deleted, the same quote-plus-context approach Hypothesis uses ([W3C annotation-model](https://www.w3.org/TR/annotation-model/); [Hypothesis](https://web.hypothes.is/blog/fuzzy-anchoring/)). The phone can leave re-anchoring to the server and simply refetch after an `annotations.reanchored` event.
- **Revisions.** Documents carry a `revisionId`, which can key the mirrored copies on the phone.

What is missing is narrow:
- a library manifest with deletions and content hashes, for the phone's mirror
- per-device progress rows
- a timestamp-based conflict rule for progress written offline
- the device authentication described earlier

For Pager, sync is mostly an authorization and transport problem, not a data-modeling one.

## A staged plan takes Pager from personal use to a shippable app

The research supports three stages, each building on the last rather than starting over.

| Stage | Goal | Transport | Pairing and auth | iPhone app | Cost |
|---|---|---|---|---|---|
| 1. Owner only, now | Read the library from anywhere | Tailscale on Fedora and iPhone; `tailscale serve` HTTPS to 127.0.0.1:3006 | Authenticated route allowlist; QR code with tailnet hostname plus one-time secret, exchanged for a per-device token | Home Screen PWA on the ts.net HTTPS name, or a Capacitor build on macOS CI | $0 (PWA) to $99/year |
| 2. Durable personal app | Offline mirror, background downloads | Same, plus a Bonjour LAN fast path; optional Cloudflare named tunnel for when another VPN is active | Secure Enclave P-256 key, challenge exchanged for a 15-minute token; devices page; 90-day idle expiry | Capacitor plus a small Swift plugin for background URLSession, or SwiftUI via xtool | $99/year, plus a domain if using the tunnel |
| 3. App others can install | No Tailscale, no account | Embedded iroh, with the endpoint ID as the computer ID; one or two self-hosted `iroh-relay`s; optional DIY HTTPS relay for background downloads | QR code carries an iroh ticket plus the secret; iroh key pinning plus device token | Same app with IrohLib; demo server for App Review | ~$2–5/month per relay VPS |

**Stage 1** adds no networking code. It only adds device authentication on a remote route allowlist alongside the loopback guard. The PWA variant is the only path that needs no Mac, no CI and no fee: Serve provides a real certificate, so the ts.net origin should count as a secure context for service workers (an inference, not tested). Its limits, evictable storage and no background downloads, are why Stage 2 exists.

**Stage 2** is where the "permanent" promise becomes true:
- The QR fingerprint pins the PC, and the Secure Enclave key identifies the phone.
- The mirror lives in Application Support.
- Background `URLSession` downloads run over whatever route the system can reach.

Test first whether background sessions travel over the Tailscale VPN. That remains unverified, and if they don't, downloads have to happen in the foreground.

**Stage 3** replaces the overlay with iroh. The iPhone app then works on its own (Guideline 4.2.3), the computer ID is literally the desktop's public key, and the relay is the only infrastructure. The price is the HTTP-over-QUIC bridge and losing background `URLSession` for in-app transfers. A user-started "Download library" running as a `BGContinuedProcessingTask` partly makes up for that.

**Across all stages**, the QR payload keeps the same format and just gains route types. The phone tries its saved routes in parallel (LAN address, tailnet name, iroh ticket, tunnel URL) against a health endpoint that proves the server's identity. That avoids both Immich's dependence on the Wi-Fi network name and its timeout hangs.

## Conclusion

The survey changes the shape of the original question. The "computer ID" is best treated not as a name that a server looks up but as a key the desktop owns. Syncthing, Tailscale and iroh show that once the ID is a public-key hash, discovery services and relays can be untrusted, cheap and swappable, and pairing reduces to scanning one QR code. The second shift is economic. Relays are where vendors gain leverage, as Plex showed by putting relayed remote access behind a paywall in 2025–2026. Pager moves megabytes of text, though, so the most expensive part of Plex's model costs Pager a few dollars a month or nothing. The real decision is not which NAT trick to use but a single trade-off. An embedded peer-to-peer stack gives a self-contained, end-to-end-encrypted app and gives up iOS background downloads. An ordinary HTTPS endpoint keeps background downloads and App Review simple, at the price of a public attack surface or a middleman that terminates TLS.

Because Pager already has a sequenced journal, safely replayable annotation writes and server-side re-anchoring, most of the remaining work is the authorization layer its loopback-only design never needed. These questions are still open and worth testing early, since each one could change a stage's design:
- Do background `URLSession` transfers travel over the Tailscale VPN?
- Does iOS accept an Ed25519 TLS certificate?
- How often does iroh hole-punch successfully between home CGNAT and cellular? n0 has not published success rates.
- What terms govern embedding TailscaleKit in a distributed app?
