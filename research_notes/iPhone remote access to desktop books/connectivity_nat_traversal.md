# Connectivity and NAT traversal: letting an iPhone app reach the Pager desktop server (Node 22 + Hono on port 3006, Fedora) from anywhere, as of October 2026

Context for the report writer: the Pager server is a plain HTTP API on port 3006 with a live server-event stream (SSE-style). It serves EPUB/DOCX/Markdown/HTML files, which are usually small (a few MB). The phone has to reach it from cellular or from other Wi-Fi networks, often across CGNAT. Research was done 2026-10-26. Prices and limits change often, and every one below is marked with what its source says.

## 1. Mesh VPNs: Tailscale (plans, Serve/Funnel, embedding via tsnet/libtailscale/TailscaleKit), Headscale, ZeroTier, NetBird, Nebula, plain WireGuard. How do they handle CGNAT?

### Takeaway
For a single user, Tailscale is the lowest-effort option. You install it on Fedora and the iPhone, and the phone reaches `machine.tailnet.ts.net:3006` from anywhere. CGNAT is handled by NAT traversal, with fallback to Tailscale's DERP relays or to your own "peer relays". Your own iOS app can also join a tailnet without the Tailscale VPN app. Tailscale's own libtailscale repo ships a Swift package, TailscaleKit, with an iOS framework described as "suitable for app-store submissions". It runs a userspace network stack, so it needs no VPN entitlement. You still have to solve per-user authentication (auth keys or a login URL) and tenancy (whose tailnet?), which makes it awkward for an app distributed to strangers.

### Cited Findings

**Tailscale plans (current pricing page, new plan structure)**
- The free Personal plan is "Free forever". It allows up to 6 users (raised from 3), unlimited user devices, 50 tagged resources (extra ones $1/month each), 1,000 ephemeral-resource minutes per month, and 3 ACL groups. It includes MagicDNS, ACLs, subnet routers, exit nodes and Funnel. It is for non-commercial use, and tailnets on public email domains (Gmail, Apple, GitHub) are automatically placed on Personal. — [Tailscale pricing](https://tailscale.com/pricing)
- Paid plans are Standard at $8/user/month and Premium at $18/user/month, plus Enterprise at custom pricing. Personal Plus, Starter, Team and similar plans are now "legacy". Personal and Personal Plus can stay on legacy plans "for the foreseeable future". Overage limits on tagged and ephemeral resources are "not currently enforced", and the page says enforcement will come "over the next few months" without giving a date. — [Tailscale pricing](https://tailscale.com/pricing)
  - **Flag:** this plan structure is new (2026), and older blog posts quoting "3 users / 100 devices" are outdated. The page does not say when the not-yet-enforced limits start.

**How Tailscale crosses NAT and CGNAT**
- STUN discovers the public `ip:port` mapping, and peers then do simultaneous transmission (hole punching). "The major distinction we care about is Symmetric versus anything else", meaning endpoint-independent versus endpoint-dependent ("hard") NAT. One hard NAT on the path is enough to block simple hole punching. — [Tailscale: How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works)
- With one hard NAT, a "birthday paradox" probing technique still works: about 50% success after ~174 probes and 99.9% after 2048. With two hard NATs it becomes impractical. — [Tailscale: How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works)
- CGNAT adds a second NAT layer at the ISP. Peers behind the same CGNAT depend on hairpinning, which many devices do not support. UPnP, NAT-PMP and PCP only affect the nearest NAT, so double NAT defeats them. — [Tailscale: How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works)
- DERP relays guarantee connectivity when direct paths fail, for example on networks that block outbound UDP. DERP runs over HTTP and also acts as the coordination side channel. Connections start on the relay and upgrade to a direct path when one is found. — [Tailscale: How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works)
- DERP traffic is end-to-end encrypted: "Tailscale encrypts all data sent between devices using a DERP relayed connection using WireGuard". Private keys never leave the devices. Custom DERP servers (`cmd/derper`) are possible but discouraged. — [Tailscale DERP servers](https://tailscale.com/kb/1232/derp-servers)
- Peer relays (customer-run relays on any Tailscale node) became generally available on Feb 18, 2026. Tailscale tries any available peer relay before falling back to DERP. — [Tailscale blog: Peer Relays GA](https://tailscale.com/blog/peer-relays-ga); [Tailscale Peer Relays docs](https://tailscale.com/docs/features/peer-relay)
- In the October 2025 beta, peer relays were available on all plans including free, with two peer relays at no cost. I could not confirm whether that free allowance still applies after GA. — [Tailscale blog: Peer relays beta](https://tailscale.com/blog/peer-relays-beta)

**Tailscale Serve and Funnel**
- Serve shares a local service with the rest of the tailnet only, at `device-name.tailnet-name.ts.net` with HTTPS certificates, and reverse-proxies to a local port. Following the page's pattern, `tailscale serve 3006` would proxy to `http://127.0.0.1:3006`. — [Tailscale Serve](https://tailscale.com/kb/1312/serve)
- Funnel exposes a service to the public internet. It is "available for all plans" but "currently in beta". It can only listen on ports 443, 8443 and 10000, and "Traffic sent over a Funnel is subject to non-configurable bandwidth limits" (no figures published). It only uses `*.ts.net` names, and TLS terminates on your device: "Funnel relay servers do not decrypt the traffic." — [Tailscale Funnel](https://tailscale.com/kb/1223/funnel)

**Embedding Tailscale in your own app**
- tsnet is a Go library that embeds Tailscale in a Go program with a "userspace TCP/IP networking stack". Without an auth key, `Server.Start` produces a "Tailscale authentication URL" for login. An auth key can "pre-approve a device". Each `tsnet.Server` is its own device on the tailnet. — [Tailscale tsnet](https://tailscale.com/kb/1244/tsnet)
- libtailscale is "a C library that embeds Tailscale into a process … entirely from userspace". It is built with Go, licensed BSD-3-Clause, and has `swift`, `python` and `ruby` folders. No published releases are shown. — [libtailscale GitHub](https://github.com/tailscale/libtailscale)
- **TailscaleKit (libtailscale/swift):**
  - It is a Swift 6, async/await package that provides an embedded network interface plus a `URLSession` extension (`URLSessionConfiguration.tailscaleSession`) for requests to tailnet nodes.
  - It builds frameworks for macOS, iOS and the iOS Simulator. The iOS framework is "suitable for app-store submissions".
  - Nodes authorize with `config.authKey` or a `browseToURL` value for web login. LocalAPI is "functional (though somewhat incomplete)". `Examples/TailscaleKitHello` demonstrates proxied HTTP.
  - It requires Xcode 16.1 or newer. The frameworks are unsigned, so you sign them when embedding.
  - The README does not mention needing a Network Extension or VPN entitlement.
  - Source: [libtailscale/swift (TailscaleKit)](https://github.com/tailscale/libtailscale/tree/main/swift)
- **Third-party confirmation that this works on iOS without the Tailscale app:**
  - The Dart/Flutter `tailscale` package (v0.9.0, pre-1.0, unverified uploader danReynolds) "embeds upstream Go `tsnet`". On iOS it is "Userspace tsnet, no VPN entitlement". "Your app authenticates as its own node on the tailnet — users never install or configure a Tailscale client." Networking is per-process, not system-wide.
  - It supports Headscale.
  - Caveats: embedded tsnet uploads diagnostic logs to Tailscale by default (opt out with `noLogsNoSupport`), and Serve/Funnel are qualified only for desktop/server.
  - Source: [pub.dev tailscale package](https://pub.dev/packages/tailscale)
- Other examples:
  - `tsnet_flutter` runs a userspace WireGuard tunnel with a localhost TCP proxy. — [pub.dev tsnet_flutter](https://pub.dev/packages/tsnet_flutter)
  - The App Store SSH client NovaAccess says it needs no VPN permissions. — [NovaAccess on the App Store](https://apps.apple.com/app/id6749938291)
- No official Node.js binding for tsnet turned up in search. — (search found only the unrelated Pulumi provider: [npm @pulumi/tailscale](https://npmjs.com/package/@pulumi/tailscale))

**Headscale (self-hosted Tailscale control server)**
- Headscale is "An open source, self-hosted implementation of the Tailscale control server". It "implements a narrow scope, a _single_ Tailscale network (tailnet)" and is aimed at personal use and small open-source organizations.
- It is BSD-3-Clause and not affiliated with Tailscale Inc., though one active maintainer "is employed by Tailscale".
- The maintainers do not support running it behind reverse proxies or in containers.
- Source: [headscale GitHub](https://github.com/juanfont/headscale)
- The official Tailscale iOS app supports a custom control server URL, and Tailscale's docs tell headscale users to enter their instance's URL. — [Tailscale: custom control server (iOS)](https://tailscale.com/kb/1507/custom-control-server?tab=ios)
- Headscale's older docs describe an iOS Settings field, "Alternate Coordination Server URL". — [headscale Apple client docs (mirror)](https://git.laurivan.com/Mirrors/juanfont.headscale/blame/branch/main/docs/usage/connect/apple.md)

**ZeroTier**
- The official pricing page, effective 4 August 2026, lists the free Personal plan at 10 devices, 1 network and 1 network admin. — [ZeroTier pricing](https://www.zerotier.com/pricing.md)
- ZeroTier staff say the limit is account-wide, and accounts created before the change keep 25 free devices. — [ZeroTier forum](https://discuss.zerotier.com/t/can-i-increase-device-from-10-to-25-as-like-previously/23892)
- A Serverspace blog claims "10 devices and up to three networks since Nov 5 2025", which contradicts the official page. — [Serverspace](https://serverspace.io/about/blog/how-to-set-up-your-own-zerotier-server/)
- **Flag:** the free tier was cut from 25 to 10 devices in 2025–2026. Older guides are outdated.

**NetBird** (third-party sources only; netbird.io/pricing was not fetched)
- NetBird moved its server components (management, signal, relay, dashboard) from BSD-3 to AGPLv3 starting with v0.53.0. A Commercial Starter self-hosting licence costs €2,000/year for up to 50 users and 500 devices (as of July 2026). — [WZ-IT](https://wz-it.com/en/blog/netbird-self-hosting-license-commercial-starter/); [NetBird enterprise licence docs](https://docs.netbird.io/selfhosted/enterprise)
- Cloud free tier: one source says up to 5 users and 100 machines. Sources conflict on paid per-user prices (~$6/$12 versus ~$12). — [WZ-IT Tailscale pricing 2026](https://wz-it.com/en/blog/tailscale-pricing-2026-headscale-netbird-self-hosted/)

**Nebula (Slack/Defined Networking)**
- Mobile Nebula is free on the App Store and requires iOS 14+. v0.10.0 added Always On, custom DNS and inbound firewall rules on iOS. — [Mobile Nebula App Store](https://apps.apple.com/us/app/-/id1509587936); [Defined blog: managed lighthouses](https://www.defined.net/blog/announcing-managed-lighthouses)
- Defined says "connect up to 100 devices free". New Managed Nebula networks include a free managed lighthouse, and you can self-host a lighthouse or relay instead. The 100-device post is undated. — [Defined blog](https://defined.net/blog/introducing-oidc-single-sign-on-for-admins/); [Defined blog: managed lighthouses](https://www.defined.net/blog/announcing-managed-lighthouses)

**Plain WireGuard / WireGuardKit**
- WireGuardKit (MIT) is added via SwiftPM plus an External Build System target for the Go bridge (`Sources/WireGuardKitGo`). It is linked into your network extension target and the main app. The official repo is git.zx2c4.com, and GitHub is a mirror. — [wireguard-apple](https://github.com/WireGuard/wireguard-apple)
- `NEPacketTunnelProvider` needs the `com.apple.developer.networking.networkextension` entitlement. An Apple DTS engineer says there is no approval process for packet tunnel providers and any paid developer can use them. — [Apple Developer Forums: Packet Tunnel Provider entitlement](https://developer.apple.com/forums/thread/819032)
- Plain WireGuard has no NAT traversal of its own. One side needs a reachable endpoint, so a home PC behind CGNAT needs a public relay or VPS. — [Tailscale: How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works) (general NAT discussion; WireGuard-specific statement inferred)

### Inferences
- **Easiest personal setup.** Install Tailscale on Fedora and the official Tailscale iOS app. The user's iPhone app then calls `http://<pc>.<tailnet>.ts.net:3006`, or HTTPS via `tailscale serve 3006`. This needs no code changes and is free on the Personal plan. CGNAT on either end is handled by DERP or peer relays.
- **Embedded, no-install route.** TailscaleKit in the iOS app, plus either the Tailscale daemon or a tsnet sidecar on the PC, means end users never install the Tailscale app. But each phone needs credentials for *some* tailnet.
  - For a distributed app, the realistic options are: each user creates their own Tailscale account, and the app runs a browser login via `browseToURL`; or the developer runs a Headscale server shared across users, with ACLs isolating them.
  - The Personal plan is non-commercial and limited to 6 users, so a shared developer tailnet on tailscale.com does not scale to strangers.
- **Node side has no native binding.** The Pager server cannot embed tsnet directly. The practical paths are the system Tailscale daemon, a small Go tsnet sidecar binary that reverse-proxies to `127.0.0.1:3006`, or loading libtailscale through FFI (for example koffi or ffi-napi; untested).
- Funnel would let the phone reach the server without any VPN or SDK, but it exposes the Pager server to the public internet. The server would then need strong app-level auth, and Funnel's unpublished bandwidth limits apply.
- **(Unverified, from general iOS knowledge.)** iOS allows only one active VPN configuration at a time. Relying on the Tailscale VPN app therefore conflicts with users who run another VPN. The embedded userspace approach avoids this.

### Gaps
- No published bandwidth or rate limits for Tailscale DERP or Funnel.
- Whether the free peer-relay allowance (two relays) survived GA was not confirmed.
- Official Tailscale statement on the terms for embedding TailscaleKit in a distributed third-party app: not found.
- TailscaleKit latest commit date and maintenance cadence were not visible on the fetched page.
- Official NetBird pricing page and current headscale release version were not retrieved.

## 2. Tunnels and reverse proxies: Cloudflare Tunnel (+ Access), ngrok, frp, rathole, bore, Pinggy, zrok/OpenZiti, Tailscale Funnel. Free tiers, ToS, domain needs

### Takeaway
A tunnel gives the phone a normal public HTTPS URL, so the iOS app needs no SDK. That also works with iOS background `URLSession` downloads. The trade-off is that the server becomes internet-facing, so you need auth.

Cloudflare Tunnel is the strongest free option. It is outbound-only, works through CGNAT, and is free with a domain on Cloudflare. Cloudflare Access (free for up to 50 users) can gate it. Two caveats:
- Cloudflare's CDN terms let it limit accounts that serve "video or a disproportionate percentage of pictures, audio files, or other large files". Whether this applies to Tunnel is disputed in the community. Small EPUB files are much lower risk than video.
- Free quick tunnels do not support SSE, which the Pager live event stream needs.

ngrok's free tier is too small for regular use (1 GB/month). frp and rathole are self-hosted and need a VPS. bore does not encrypt traffic.

### Cited Findings
**Cloudflare Tunnel**
- "`cloudflared` runs in your infrastructure and opens outbound connections to Cloudflare". It "uses an outbound-only connection model to enable bidirectional communication", so no public IP is needed and inbound traffic can be blocked. — [Cloudflare Tunnel docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
- Quick tunnels (TryCloudflare):
  - "up to 200 in-flight requests" (more get a 429)
  - "Quick Tunnels do not support Server-Sent Events (SSE)"
  - "no uptime guarantee"
  - "for testing and development"
  - "You do not need a Cloudflare account or domain"
  - the hostname changes each time
  - Source: [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
- Named tunnels need a domain added to your Cloudflare account, per third-party setup guides. I did not verify this in Cloudflare's own docs. — [cubepath guide](https://cubepath.com/docs/cloud-integration/cloudflare-tunnels-for-secure-server-access); [domainindia guide](https://domainindia.com/support/kb/cloudflare-zero-trust-access-internal-apps)
- Cloudflare's Zero Trust (Access) Free plan covers up to 50 users, per Cloudflare's 2020 announcement. — [Cloudflare blog: Teams plans](https://blog.cloudflare.com:8443/teams-plans)
- **ToS:** the Service-Specific Terms' CDN section says Cloudflare "reserves the right to disable or limit your access to or use of the CDN" if it is used "to serve video or a disproportionate percentage of pictures, audio files, or other large files" without the relevant paid products. The page does not mention Tunnel. — [Cloudflare Service-Specific Terms](https://www.cloudflare.com/service-specific-terms-application-services/)
- Community readings conflict:
  - One guide calls media streaming via Tunnel a "genuine terms-of-service grey zone" and reports that Cloudflare staff told individuals personal streaming is OK. — [Lumadock](https://lumadock.com/tutorials/cloudflare-tunnel-jellyfin)
  - IBRACORP states that Plex/Jellyfin over Tunnel violates the ToS. — [IBRACORP docs](https://docs.ibracorp.io/docs/networking/cloudflare-tunnel)
- Free/Pro plans reject request bodies over 100 MB with HTTP 413 (an upload limit), per a third-party guide. — [Localtonet blog](https://localtonet.com/blog/cloudflare-tunnel-alternative)

**ngrok** (current pricing page)
- **Free:** $5 one-time usage credit, 3 online endpoints, "Up to 1GB data transfer", "Up to 20k HTTP/S requests", one dev domain, an interstitial page on HTTP/S endpoints, and TCP only with card verification.
- **Hobbyist:** $10/month for 5 GB, 100k requests, no interstitial and 10 ngrok-branded domains.
- **Pay-as-you-go:** $20/month with bring-your-own domain; extra transfer is $0.10/GB.
- Source: [ngrok pricing](https://ngrok.com/pricing)

**frp**
- 110k stars, Apache-2.0. It supports TCP, UDP, HTTP and HTTPS, and has an `xtcp` P2P mode that still needs an `frps` server and "may not work with all NAT types" (`stcp` is the fallback).
- The author says v2 development happens "during fragmented time periods", and v1 will move to bug-fix-only once mature.
- Source: [frp GitHub](https://github.com/fatedier/frp)

**rathole**
- A Rust reverse proxy for NAT traversal ("An alternative to frp and ngrok") with Noise and TLS transports. Apache-2.0, 14.4k stars, 77 open issues and 21 open PRs.
- The repo appears to have moved to `rathole-org/rathole`. The fetched page did not show enough to judge maintenance activity.
- Source: [rathole GitHub](https://github.com/rapiz1/rathole)

**bore**
- A tiny Rust TCP tunnel (~400 lines) with a public instance at `bore.pub` and optional HMAC secret auth. The secret "is only used for the initial handshake, and no further traffic is encrypted by default".
- MIT, 11.6k stars.
- Source: [bore GitHub](https://github.com/ekzhang/bore)

**zrok / OpenZiti (NetFoundry)**
- Limits depend on your myzrok plan. Bandwidth is measured over a rolling 24 hours, and exceeding it disables shares. Public shares are rate-limited at 2000 requests per 300 s per IP and 7500 per 300 s per share. — [NetFoundry zrok service limits](https://netfoundry.io/docs/zrok/myzrok/service-limits)
- A forum moderator said the free tier has "a 10GB per 24 hour period limit" (undated). — [OpenZiti forum](https://openziti.discourse.group/t/is-there-any-upload-or-download-limit-for-free-accounts/2862)
- The pricing page lists a free open-source (self-hosted) tier, a free hosted tier, a $5/month tier and Enterprise. — [zrok pricing](https://zrok.io/pricing)

**Pinggy**
- The pricing page returned 404, so its limits were not verified. — (attempted [pinggy.io/pricing](https://pinggy.io/pricing/))

**Tailscale Funnel**
- See section 1: beta, ports 443/8443/10000, non-configurable bandwidth limits, `*.ts.net` names only, TLS terminated on your device. — [Tailscale Funnel](https://tailscale.com/kb/1223/funnel)

### Inferences
- **Personal use with a domain.** Cloudflare Tunnel with a named tunnel is free, persistent and CGNAT-proof.
  - It gives a stable `reader.example.com`, and named tunnels are not subject to the quick-tunnel SSE limitation.
  - Book files are small, so the large-file clause is probably low-risk. Bulk transfers of large PDFs or audio would carry more risk.
  - Cloudflare terminates TLS at its edge, so this is **not end-to-end encrypted**: Cloudflare can see the plaintext HTTP.
- **Native-app auth with Cloudflare Access.** Access is browser-oriented. A native iOS app would need an Access service token sent as headers, or the cloudflared/WARP login flow. Service-token availability on the free plan was not confirmed.
- **Tunnels for a distributed app.** Every end user would need their own Cloudflare account and domain, or the developer runs a shared tunnel or relay service. The first is too much setup for non-technical users. The second turns into "build your own relay" (section 5).
- ngrok's free 1 GB/month cap and its interstitial page make it unsuitable for persistent use. The interstitial page is a browser warning that would also confuse a non-browser client unless it is bypassed; how to bypass it was not verified.

### Gaps
- No official Cloudflare statement found on whether the CDN large-file clause applies to Tunnel traffic. The Tunnel FAQ was not retrieved.
- Pinggy's limits and prices could not be verified (404).
- Current rathole release and commit dates, and bore.pub's operational status, could not be determined.
- Free-plan availability of Cloudflare Access service tokens was not confirmed.

## 3. Peer-to-peer libraries embeddable in both a Node desktop app and an iOS app: WebRTC, libp2p, Iroh, Holepunch/Hyperswarm/Bare, Syncthing relays, Veilid, Tor

### Takeaway
Iroh by n0 is the best match for "pair with a computer ID":
- It reached **1.0 on July 9, 2026**, with a stable wire format and API.
- Peers dial each other by Ed25519 public key over QUIC, with Tailscale-style hole punching and a relay fallback.
- It has **official Swift (iOS + macOS xcframework) and Node.js (napi-rs) bindings** via iroh-ffi.
- n0's public relays are free but rate-limited and explicitly "for development and hobby use". Production apps should self-host `iroh-relay` or pay for managed relays.

WebRTC data channels are the mature alternative, with node-datachannel on Node and stasel or LiveKit WebRTC builds for iOS. They need a signaling server plus TURN, and are more work to build.

Hyperswarm via Bare Kit is JS on both ends, but it has no relay by default and the iOS host API is Objective-C. libp2p's Swift implementation is a young community project. Tor and Veilid are niche or experimental on iOS.

### Cited Findings
**Iroh (n0)**
- **Release:** "It is done. After four years of work and various pivots we have released iroh 1.0". The blog byline is July 9, 2026. "Iroh 1.0 just means that the wire format and API are stable." — [iroh blog: The road to iroh 1.0](https://iroh.computer/blog/the-road-to-iroh-1-0)
- **How it connects:**
  - Endpoints are identified by Ed25519 public keys, and connections are "just direct connections dialed by endpoint id".
  - It runs on QUIC; n0 forked quinn into "noq" for multipath.
  - Hole punching is based on Tailscale's design: "In most normal circumstances we punched holes almost immediately".
  - When punching is impossible (some corporate networks), "at least we could still transfer data via relays".
  - Address lookup uses a pkarr-based service, with an opt-in BitTorrent mainline DHT.
  - It is used in Delta Chat on iOS and Android.
  - Source: [iroh blog: The road to iroh 1.0](https://iroh.computer/blog/the-road-to-iroh-1-0)
- **Release-date conflict:**
  - A release listing shows v1.0.1 dated 2026-06-29, before the July 9 blog date. — [newreleases v1.0.1](https://newreleases.io/project/github/n0-computer/iroh/release/v1.0.1)
  - v1.0.3 is dated 2026-07-20. — [newreleases v1.0.3](https://newreleases.io/project/github/n0-computer/iroh/release/v1.0.3)
- **Bindings (iroh-ffi):**
  - Python, Swift (SwiftPM and CocoaPods `IrohLib`), Kotlin, and Node.js (npm `@number0/iroh`). Dual-licensed Apache-2.0/MIT.
  - The bindings "mirror the stabilized iroh 1.0 surface (endpoints, connections, paths, tickets, relays, services)".
  - `cargo make swift-xcframework` builds a "Full Apple xcframework (iOS + macOS)".
  - Higher-level protocols (iroh-blobs, iroh-docs, iroh-gossip) are out of scope.
  - Source: [iroh-ffi GitHub](https://github.com/n0-computer/iroh-ffi)
- **Platform table:**
  - Swift is Official for iOS (device and simulator) and macOS arm64. macOS x86_64 is not supported.
  - JavaScript/Node is Official ("Node.js via N-API") on Linux glibc and musl, macOS arm64, Windows and Android.
  - Go bindings are community-maintained and lag behind.
  - Source: [iroh docs: languages](https://docs.iroh.computer/languages)
- **JS binding details:**
  - Built with napi-rs, prebuilt binaries, Node ≥ 20.3.0.
  - `Endpoint.bind` uses the n0 preset (public discovery + default relays) by default.
  - The iroh-ffi repo is labelled "tier 2" (less review rigor than tier-1 repos).
  - Source: [iroh docs: JavaScript](https://docs.iroh.computer/languages/javascript.md)
- **Relays:**
  - Public n0 relays are free and rate-limited per connection. "The exact rate limits aren't published today". "public infrastructure is meant for development and hobby use. Do not rely on it for production workloads".
  - A self-hosted `iroh-relay` has rate limiting off by default; configure it with `[limits.client.rx] bytes_per_second`.
  - Shared managed relays have "far fewer tenants per machine and higher per-connection limits". Dedicated relays have "no rate limits at all".
  - Source: [iroh docs: relay rate limiting](https://docs.iroh.computer/relays/rate-limiting)
- Search results summarised an Iroh Services pricing table as: shared relay tier $19/month with a 5 MB/s rate limit and 100 GB egress; dedicated relays $199/region plus a Pro plan. I did not verify this on the page directly. — [iroh blog: shared relays](https://iroh.computer/blog/shared-relays); [iroh docs: add a relay](https://docs.iroh.computer/add-a-relay)

**WebRTC data channels**
- **node-datachannel:**
  - Node/Electron bindings for libdatachannel, adding WebRTC data channels plus a WebSocket client and server.
  - N-API 8, Node ≥ 18.20 (20/22/24+).
  - Polyfills for libraries like simple-peer.
  - Prebuilt Linux x64/arm64 glibc and musl (~8 MB).
  - MPL-2.0, 1,029 commits, 421 stars.
  - Source: [node-datachannel GitHub](https://github.com/murat-dogan/node-datachannel)
- **iOS WebRTC binaries:**
  - stasel/WebRTC is a community distribution of up-to-date WebRTC xcframeworks; the Swift Package Index shows M155 building on 13 Oct 2026.
  - LiveKit's LiveKitWebRTC (from livekit/webrtc-xcframework) was at M144 in July 2026.
  - LiveKit says CocoaPods support is deprecated and goes read-only in 2027.
  - Source: [stasel packages](https://swiftpackageregistry.com/stasel); [LiveKit packages](https://swiftpackageregistry.com/livekit)
- **STUN/TURN:**
  - Cloudflare STUN (`stun.cloudflare.com`) is free and unlimited.
  - Cloudflare TURN costs $0.05/GB, with 1,000 GB/month free shared with the SFU, billed on data from Cloudflare to the client.
  - Source: [Cloudflare Realtime TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/); [Cloudflare Realtime pricing](https://developers.cloudflare.com/realtime/pricing/)

**libp2p**
- Circuit Relay v2 relays carry a `limit` with `duration` and `data` fields. Limited relays exist to support hole punching ("doesn't require an unlimited relay connection") and small-scale traffic, so they are not meant for bulk transfer. — [libp2p circuit-v2 spec](https://github.com/libp2p/specs/blob/master/relay/circuit-v2.md)
- DCUtR needs an existing relayed connection to synchronise simultaneous dials. — [libp2p hole-punching spec](https://github.com/libp2p/specs/blob/master/connections/hole-punching.md)
- ProbeLab found that go-libp2p and rust-libp2p interoperate at 100% across punchable NATs in a testbed; that study did not cover JS or Swift. — [ProbeLab](https://probelab.io/blog/can-libp2p-punch-through-nats/)
- js-libp2p is actively released, with packages and releases dated Feb–Mar 2026. — [libp2p release notes](https://docs.libp2p.io/releases/2026-02-28-js-libp2p-3-0-11); [socket.dev libp2p](https://socket.dev/npm/package/libp2p/overview/3.3.4)
- swift-libp2p (1amageek, community project) claims Circuit Relay v2, AutoNAT, DCUtR and others, and **requires iOS 26+ and Swift 6.2+**. I found no evidence of on-device hole-punch testing. — [swift-libp2p](https://swiftpackageregistry.com/1amageek/swift-libp2p)

**Holepunch: Hyperswarm/HyperDHT, Bare, Pear**
- Bare Kit embeds the Bare JS runtime in native apps as isolated "worklets" that talk to the host over IPC. The iOS API is Objective-C (`BareWorklet`). — [Pear docs: making a Bare mobile app](https://docs.pears.com/guides/making-a-bare-mobile-app)
- Mobile builds bundle code with `bare-pack --linked`, because iOS needs native addons linked ahead of time. Bare has suspend/resume hooks for the mobile lifecycle. — [Pear docs: making a Bare mobile app](https://docs.pears.com/guides/making-a-bare-mobile-app); [Pear docs: Bare on native](https://docs.pears.com/explanation/bare-on-native/)
- HyperDHT dials by public key. "holepunching will fail if both the client peer and the server peer are on randomizing NATs … HyperDHT does not do any relaying by default." — [Pear docs: HyperDHT](https://docs.pears.com/building-blocks/hyperdht)
- A blind relay (a third machine forwarding encrypted streams) is the fallback, built into the CLI since Pear 3.4.0 (`pear blind-relay start`). — [Pear docs (preview mirror): blind relay](https://pear-docs-published-i1yp5-commit-a510a9a.kinsta.page/how-to/connect-to-peers/relay-connections-through-a-blind-relay/)

**Tor onion services**
- Tor issue #461: iOS restricts background execution, so there is "no obvious way" to keep an onion service running in the background on iOS. — [Arti issue #461](https://gitlab.torproject.org/tpo/core/arti/-/issues/461)
- Arti on mobile is "quite experimental and not actively maintained". Orbot iOS uses C-Tor. Tor.framework (CocoaPods) includes an experimental OnionMasq build. — [Guardian Project: Arti and Onionmasq on iOS](https://tordev.guardianproject.info/tor-on-ios/arti-and-onionmasq-on-ios)

**Veilid**
- Only mirrors were found. The veilid-flutter example shows a 0.5.1 release commit dated 2025-12-22. I found no Swift binding; access is Flutter-based. — [veilid mirror](https://git.hackliberty.org/Git-Mirrors/veilid/src/branch/logging-update/veilid-flutter/example)

### Inferences
- **Why iroh fits.** iroh's endpoint ID (a public key) maps directly to the user's "computer ID or pairing code" idea. A QR code or pairing string can carry an iroh "ticket" (endpoint ID plus relay URL and addresses).
  - The Node server would run `@number0/iroh` next to Hono.
  - It accepts iroh connections on a custom ALPN and pipes each bidirectional stream to `127.0.0.1:3006`, or speaks a small request/response protocol.
  - The iOS app uses IrohLib.
  - End users install nothing extra, and traffic is end-to-end encrypted over QUIC/TLS between the two keys, including through relays.
- **iroh caveat.** iroh carries streams, not HTTP. Hono routes would have to be bridged: either a local loopback HTTP proxy on iOS, or HTTP/1.1 framed over the QUIC stream. A JSR package `@momics/iroh-http-shared` appeared in search results, but I did not evaluate it.
- **WebRTC needs more infrastructure.** You need a signaling channel (for example a Cloudflare Worker or Durable Object), STUN (free), and TURN for the cases where hole punching fails (Cloudflare TURN or coturn). DTLS encryption of data channels is standard WebRTC behaviour, but no source was fetched for it here. Background reconnection and multiplexing HTTP-like requests over data channels are also left to you.
- **Hyperswarm/Bare** fits a JS-heavy codebase: the same hyperswarm code runs in the Node server and in an iOS Bare worklet. But it needs a self-run blind relay for double-randomizing-NAT cases (for example phone on CGNAT cellular plus home on CGNAT), and Objective-C/Swift glue.
- swift-libp2p's iOS 26+ minimum excludes users on older iOS, and its hole punching is unproven on iOS. js-libp2p is fine on Node, but the Swift side is the weak link.
- **Tor** works in principle: an onion service on the desktop (C-Tor on Fedora) and an embedded Tor client in the iOS app. The background restriction only matters for hosting an onion service on iOS, and the phone is the client here. Expect high latency and slow, multi-second-to-minute startup. Not recommended except for privacy-maximalist users.
- **Syncthing relays:** no sources were retrieved. They are protocol-specific to Syncthing and not a general-purpose embedding option. Treat this as an unsourced inference.

### Gaps
- Hole-punch success rates for iroh: the blog says "almost immediately" but gives no number. No measured throughput or latency for iroh relays.
- Iroh Services managed-relay pricing was only seen in a search summary, not verified on the page.
- Whether `@number0/iroh` has prebuilt Linux arm64 binaries and its current version number were not checked.
- No source found for the HyperDHT `relayThrough` option, or for a reference iOS Hyperswarm app.
- No WebRTC.org primary source fetched on encryption or ICE behaviour.
- Syncthing relay pool terms of use were not researched.

## 4. Direct approaches: UPnP/NAT-PMP/PCP, IPv6, dynamic DNS, and why CGNAT breaks them

### Takeaway
Direct exposure, meaning port forwarding plus DDNS, only works when the home connection has a public IPv4 address and a cooperative router, or working inbound IPv6. CGNAT (common on mobile carriers, many ISPs and Starlink residential) adds an ISP-side NAT that UPnP, NAT-PMP and PCP cannot open. IPv6 avoids NAT, but stateful firewalls still block inbound connections, and deployment is around 50% globally. Use these as an optimisation, not as the main path.

### Cited Findings
- Port mapping protocols (UPnP IGD, NAT-PMP, PCP) ask the gateway to forward a port. They are "often disabled by default or by policy", and double NAT breaks them because they only affect the nearest NAT. CGNAT is exactly such a second NAT layer. — [Tailscale: How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works)
- IPv6 removes NAT, but "stateful firewalls still block unsolicited inbound traffic", deployment is uneven, and NAT64 networks need extra handling. — [Tailscale: How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works)
- **Node libraries:**
  - `node-portmapping`: bindings for libplum, which implements PCP, NAT-PMP and UPnP and auto-detects which to use. — [npm node-portmapping](https://npmjs.com/package/node-portmapping)
  - `port-mapper`: a complete UPnP-IGD/NAT-PMP/PCP stack; "APIs may change before v1.0". — [port-mapper GitHub](https://github.com/colocohen/port-mapper)
  - `@silentbot1/nat-api`: UPnP + NAT-PMP, both off by default in its settings. — [@silentbot1/nat-api README](https://unpkg.com/@silentbot1/nat-api@0.4.8/README.md)
  - `@xmcl/nat-api`: a TypeScript UPnP-focused fork. — [npm @xmcl/nat-api](https://npmjs.com/package/@xmcl/nat-api)
  - `nat-pmp`: NAT-PMP only. — [npm nat-pmp](https://npmjs.com/package/nat-pmp)
- **IPv6 adoption:**
  - Google's global IPv6 share first passed 50% on 21 June 2025. — [Internet Society Pulse](https://pulse.internetsociety.org/en/blog/18-years-later-ipv6-reaches-majority/)
  - Google measured 50.1% on 28 March 2026, while Cloudflare and APNIC show lower figures. — [threatcluster](https://threatcluster.io/cluster/ipv6-traffic-surges-to-50-for-a-day-highlighting-adoption-tr-0aee1b51)
  - The US is roughly half, per Wikipedia (undated). — [Wikipedia: IPv6 deployment](https://en.wikipedia.org/wiki/IPv6_deployment)
- **Starlink:**
  - Residential and Roam plans sit behind CGNAT, so inbound IPv4 port forwarding fails. A public IPv4 address is only available on Priority-tier plans with your own router in bypass mode. — [DishyTech](https://www.dishytech.com/does-starlink-have-port-forwarding/); [natchecker](https://natchecker.com/blog/starlink-vpn)
  - Starlink can assign public IPv6. Users report inbound IPv6 failing despite a global address, and prefix changes making it unreliable. — [Latenode community](https://community.latenode.com/t/ipv6-reverse-proxy-setup-issues-with-starlink-and-cgnat/25023); [Homey community](https://community.homey.app/t/starlink-unifi-homey-pro-how-to-enable-direct-connection-via-ipv6-bypassing-cgnat/147192)
  - These sources are vendor and forum posts.

### Inferences
- **Opportunistic direct path.** A desktop app can try `node-portmapping` (PCP/NAT-PMP/UPnP) at startup and report a public `ip:port` (and/or a global IPv6 address) to the phone. Mesh and P2P stacks such as Tailscale already do this internally, so hand-rolling it mostly helps a "no third party at all" design.
- Port forwarding exposes the HTTP server directly to internet scanners. You would need TLS (a certificate for a DDNS name) and strong auth, which is a support burden for non-technical users.
- **DDNS (DuckDNS or similar)** only names an address. It does nothing when the home is behind CGNAT, and it needs a client updating the record. (No DDNS sources were fetched; this is general reasoning.)
- The phone's own CGNAT on cellular does not matter for outbound connections to a reachable home server. Only the *home* side needs reachability. When both sides are behind NAT, hole punching or a relay is needed.

### Gaps
- No primary source on the share of US/EU home ISPs using CGNAT in 2026.
- No measured success rate for UPnP/PCP on consumer routers.
- DuckDNS's current status and terms were not checked.
- `bonjour-service` (npm) was not researched.

## 5. Building your own relay or rendezvous: TURN (coturn) on a VPS, a WebSocket relay (desktop dials out, phone dials in), and costs

### Takeaway
A self-run relay is the simplest no-SDK-on-desktop design, and it works through any CGNAT. The desktop keeps an outbound WebSocket (or HTTP/2) connection to your server, and the phone connects to the same server, which pipes requests through.

Costs are small for personal use:
- Fly.io: about $2.19/month for the smallest machine plus $0.02/GB egress.
- Hetzner: roughly €4.49/month after its 2026 price increase, with reported availability problems.
- Cloudflare Durable Objects: usable on the free plan for signaling. Hibernatable WebSockets avoid duration billing.

The downsides are that you operate the service, all bytes cross your server (bandwidth cost scales with users), and you must add your own end-to-end encryption if the relay shouldn't see book contents.

### Cited Findings
- **Fly.io:**
  - shared-cpu-1x 256 MB costs $2.19/month (billed per second while running; iad/ewr pricing)
  - outbound transfer is $0.02/GB in North America and Europe; inbound is free
  - dedicated IPv4 is $2/month; shared IPv4 and IPv6 are free
  - "New organizations don't have a free tier"; the trial is 2 hours of machine runtime or 7 days
  - Source: [Fly.io pricing](https://docs.fly.io/about/pricing)
- **Hetzner:**
  - Cloud price increases took effect April 1, 2026, with the CX22 (2 vCPU, 4 GB) EU going from €3.29 to €4.49 (+36%, excluding VAT). — [agentdeals Hetzner 2026](https://agentdeals.dev/hetzner-pricing-2026)
  - Another source says a further adjustment came on June 15, 2026. — [findstack](https://findstack.com/resources/hetzner-price-increase-2026)
  - Cost-Optimized models were reported as "unavailable" in the public catalog as of Sept 7, 2026. — [falcao.org](https://falcao.org/posts/hetzner-not-cheap-anymore/); [Northflank](https://northflank.com/blog/hetzner-cloud-server-price-increases)
  - **Flag:** SKU naming (CX22 versus CX23) and dates conflict across these secondary sources.
- **Cloudflare Durable Objects:**
  - Available on Workers Free (SQLite backend only): 100,000 requests/day and 13,000 GB-s/day.
  - Paid: 1M requests/month included, then $0.15/M; 400,000 GB-s included, then $12.50/M GB-s; $5/month minimum.
  - WebSocket creation counts as 1 request. Incoming WebSocket messages are billed 20:1, and outgoing messages are free.
  - Hibernation: "Idle objects eligible for hibernation are not billed for duration". In Cloudflare's example, 100 objects × 100 hibernatable WebSockets cost $20.65/month versus $419.30/month without hibernation.
  - Source: [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- **Managed TURN instead of coturn:** Cloudflare TURN costs $0.05/GB after 1,000 GB/month free (shared with the SFU). Cloudflare STUN is free. — [Cloudflare Realtime TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/)
- **Self-hosted relay software for the P2P stacks:**
  - `iroh-relay` (ACME TLS built in; n0 recommends at least two regions). — [iroh docs: add a relay](https://docs.iroh.computer/add-a-relay); [iroh rate limiting](https://docs.iroh.computer/relays/rate-limiting)
  - Tailscale `derper` and peer relays. — [Tailscale DERP servers](https://tailscale.com/kb/1232/derp-servers)
  - Pear blind relay. — [Pear blind relay docs](https://pear-docs-published-i1yp5-commit-a510a9a.kinsta.page/how-to/connect-to-peers/relay-connections-through-a-blind-relay/)
  - frps/rathole servers. — [frp](https://github.com/fatedier/frp); [rathole](https://github.com/rapiz1/rathole)

### Inferences
- **Minimal custom relay design.**
  - The Pager server opens `wss://relay.example/desktop?id=<computerId>` and authenticates with a keypair generated at pairing.
  - The phone calls `https://relay.example/c/<computerId>/api/...`.
  - The relay forwards each HTTP request as a framed message over the desktop's socket and streams back the response; SSE passes through as a long-lived response.
  - This gives the iOS app a plain HTTPS URL, which works with background `URLSession`.
- **Encryption.** Without app-layer encryption, the relay operator (you) can read traffic. For a distributed app, add end-to-end encryption, for example a Noise or libsodium session keyed from the pairing QR code, or use iroh, whose relays only see ciphertext.
- **Rough personal cost.** One Fly.io machine (~$2.19) plus transfer at $0.02/GB means a reader moving 5 GB/month of books pays well under $3/month. These figures are derived from the cited prices.
- **Cloudflare Workers/Durable Objects** are a natural *signaling/rendezvous* tier: tiny messages and a free plan. Using a Worker to pipe book bytes runs into the CPU/duration billing model, and possibly the large-file ToS clause. Whether that clause applies to Workers WebSocket payloads is unknown (see Gaps).
- **Relay versus P2P throughput.** Relayed throughput is capped by the VPS NIC or egress pricing and the home uplink. Direct P2P paths are capped only by the home uplink. In both cases home upload bandwidth (often 10–50 Mbps on cable) is the practical ceiling. That upload range is general knowledge and was not sourced.

### Gaps
- No primary Hetzner price page fetched; SKU and traffic allowance are unconfirmed.
- No coturn resource-use benchmarks gathered.
- Whether Cloudflare's large-file clause applies to Workers/Durable Objects WebSocket relaying was not found.
- No published latency figures comparing a DIY relay with DERP or iroh relays.

## 6. Local network: Bonjour/mDNS discovery and the iOS Local Network privacy permission

### Takeaway
On the same Wi-Fi, the app can discover the PC with Bonjour (Node advertises `_reader._tcp`, iOS browses with `NWBrowser`). This works as a fast path and for first-time pairing. Since iOS 14 it triggers the Local Network privacy prompt, which requires `NSLocalNetworkUsageDescription` plus every service type declared in `NSBonjourServices`. There is no public API to query the permission state, and developers report inconsistent prompt behaviour.

### Cited Findings
- On iOS 14+, the Local Network prompt "cannot be avoided if you want to use Bonjour". Adding the usage description and Bonjour service types to Info.plist fixed one developer's discovery problem (Apple DTS). — [Apple forums thread 653316](https://developer.apple.com/forums/thread/653316)
- There is "no dedicated public API to explicitly request Local Network permission or to reliably determine the current authorization state". — [Apple forums thread 826268](https://developer.apple.com/forums/thread/826268); [nonstrict.eu blog](https://nonstrict.eu/blog/2024/request-and-check-for-local-network-permission/)
- NWBrowser reports `.ready` regardless of Local Network permission state. This was filed as feedback, and Quinn (DTS) referenced testing it for TN3179. — [Apple forums thread 770563](https://developer.apple.com/forums/thread/770563)
- A third-party package says the browsed type must appear in `NSBonjourServices` "otherwise NWBrowser silently fails". — [pub.dev local_network_rwx](https://pub.dev/packages/local_network_rwx)
- Developers report the prompt sometimes never appears. One report after Xcode 16.4 had NWBrowser returning PolicyDenied even with the keys present. — [Apple forums thread 826268](https://developer.apple.com/forums/thread/826268)
- A developer reported `NSLocalNetworkUsageDescription` "seems to be mandatory on iOS 18.1 now". — [Apple forums thread 777657](https://developer.apple.com/forums/thread/777657) (attribution per search summary; thread not opened)
- Apple TN3179 ("Understanding local network privacy") is the primary reference, but its body did not render when fetched. — [Apple TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)

### Inferences
- **Recommended flow:**
  - Use Bonjour once, during pairing, or as a fast LAN path.
  - Persist the remote identifier (iroh endpoint ID, tailnet hostname, or relay ID) as the primary route.
  - A QR code shown in the desktop web UI can avoid Bonjour, and so the permission prompt, entirely.
- Connections to public IPs or through relays should not need the Local Network permission. Whether traffic to a tailnet `100.x` address or over a userspace stack's own UDP sockets triggers it was **not confirmed**; TN3179 could not be read.

### Gaps
- TN3179's exact rules (exempt interfaces, error codes on denial, behaviour of direct LAN IP connections without Bonjour) could not be retrieved.
- Node `bonjour-service` maintenance status was not checked.

## 7. Cross-cutting: which options need nothing extra installed, end-to-end encryption, and iOS constraints that affect the choice

### Takeaway
Only three families give "install only my app" on the iPhone *and* work across CGNAT:
1. Embedded P2P SDKs: iroh, TailscaleKit/tsnet, WebRTC, Bare/Hyperswarm.
2. A public HTTPS endpoint: Cloudflare Tunnel, Funnel, ngrok, or your own relay.
3. Your own relay service.

End-to-end encryption (no third party can read the books) comes built in with Tailscale/WireGuard (including via DERP), iroh (QUIC between keys), WebRTC (DTLS) and Hyperswarm (Noise, via blind relays). Cloudflare Tunnel and similar proxies terminate TLS at the provider. Funnel terminates TLS on your device. A DIY relay depends on what you build.

iOS suspends apps shortly after they go to the background. No embedded network stack runs in the background, so large background book downloads need a background `URLSession`, which only works against a normal reachable URL.

### Cited Findings
- iOS "default behaviour is to suspend your app shortly after the user has moved it to the background". For a background network server: "You can't." For large transfers: "use an URLSession background session". To wake on server events, use silent push. A force-quit app cannot be relaunched in the background. — [Apple DTS: iOS Background Execution Limits](https://developer.apple.com/forums/thread/685525)
- TailscaleKit and the Dart tsnet wrapper run userspace and per-process, with "no VPN entitlement", so no separate Tailscale app is needed. — [TailscaleKit](https://github.com/tailscale/libtailscale/tree/main/swift); [pub.dev tailscale](https://pub.dev/packages/tailscale)
- A WireGuardKit embed needs a Network Extension target (system VPN). — [wireguard-apple](https://github.com/WireGuard/wireguard-apple)
- Tailscale DERP relays cannot read traffic (WireGuard end-to-end). — [Tailscale DERP](https://tailscale.com/kb/1232/derp-servers)
- Funnel relays "do not decrypt"; TLS terminates on your device. — [Tailscale Funnel](https://tailscale.com/kb/1223/funnel)
- A HyperDHT blind relay forwards encrypted streams and stores nothing. — [Pear blind relay docs](https://pear-docs-published-i1yp5-commit-a510a9a.kinsta.page/how-to/connect-to-peers/relay-connections-through-a-blind-relay/)
- Cloudflare Tunnel proxies traffic through Cloudflare's edge, with outbound-only `cloudflared`. — [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
- bore does not encrypt traffic by default. — [bore](https://github.com/ekzhang/bore)

### Inferences
- **Design implication for offline reading.** Because the embedded stacks (iroh, TailscaleKit, WebRTC, Bare) only run while the app is in the foreground or in a short background task, the app should cache or download books while it is open. "Permanent, persistent access" in practice means syncing a local copy plus progress and highlights, not streaming from the PC on demand.
- **When background downloads work.** Background `URLSession` downloads work with a public HTTPS endpoint (Cloudflare Tunnel, Funnel, a DIY relay). They probably also work with the system Tailscale VPN app, since system daemons' traffic would route over the VPN, but that is unverified. They will not work with in-process userspace stacks.
- **E2E summary:**
  - E2E by default: Tailscale (any path), iroh, WebRTC, Hyperswarm, Nebula, ZeroTier, plain WireGuard.
  - Provider sees plaintext: Cloudflare Tunnel, ngrok (TLS terminated at ngrok edge, inferred and not verified), zrok public shares (not verified).
  - Encrypted only if you add it: DIY relay, frp/rathole (TLS/Noise configurable), port forwarding plus TLS.
- **Security posture on the PC.** Currently the Hono server on :3006 likely has no auth, being localhost/LAN only. Any option that exposes a public URL must add authentication. P2P/mesh options can keep the server bound to localhost and gate access by cryptographic peer identity.

### Gaps
- Whether background `URLSession` traffic routes through a third-party system VPN (Tailscale app) on current iOS was not verified with a source.
- Encryption specifics for ngrok and zrok edge termination were not fetched.

## 8. Recommendations: (a) single-user personal setup, (b) distributable app for non-technical users

### Takeaway
**(a) Personal:** install Tailscale (free Personal plan) on the Fedora PC and the official Tailscale iOS app, and point the app at `http(s)://<pc>.<tailnet>.ts.net` (optionally via `tailscale serve 3006`). There is zero networking code to write, it is CGNAT-proof and end-to-end encrypted, and it is free.
- Runner-up if you own a domain: a Cloudflare named tunnel plus Access, giving a normal HTTPS URL that also allows background downloads. It is not end-to-end encrypted, and the large-file ToS is a grey area for big files.

**(b) Distributable:** embed **iroh** (1.0 stable; official Node `@number0/iroh` and Swift `IrohLib`). Pair by QR code or code containing the desktop's endpoint ID, and run your own `iroh-relay` (about $2–5/month VPS) rather than relying on n0's rate-limited public relays.
- Alternatives:
  - TailscaleKit + tsnet with Headscale, which is strong technically but awkward for multi-tenant auth.
  - A DIY WebSocket relay with app-layer E2E encryption: simplest to reason about, and it gives HTTPS URLs for background downloads, but you carry all bandwidth.
  - WebRTC with Cloudflare signaling and TURN: mature but most code.

### Cited Findings
- Tailscale Personal: free, 6 users, unlimited user devices, MagicDNS, non-commercial. — [Tailscale pricing](https://tailscale.com/pricing)
- Tailscale Serve is tailnet-only HTTPS proxying to a local port. — [Tailscale Serve](https://tailscale.com/kb/1312/serve)
- iroh 1.0 has a stable API and wire format, dial-by-public-key, and relay fallback. — [iroh 1.0 blog](https://iroh.computer/blog/the-road-to-iroh-1-0)
- iroh has official Swift (iOS) and Node bindings. — [iroh languages](https://docs.iroh.computer/languages); [iroh-ffi](https://github.com/n0-computer/iroh-ffi)
- n0's public relays are "meant for development and hobby use". Self-hosted relays have no rate limit by default. — [iroh rate limiting](https://docs.iroh.computer/relays/rate-limiting)
- The smallest Fly.io machine costs $2.19/month with $0.02/GB egress. — [Fly.io pricing](https://docs.fly.io/about/pricing)
- TailscaleKit's iOS framework is "suitable for app-store submissions". — [TailscaleKit](https://github.com/tailscale/libtailscale/tree/main/swift)
- Headscale is single-tailnet and aimed at personal use and small organizations. — [headscale](https://github.com/juanfont/headscale)
- Quick tunnels lack SSE and are dev-only. — [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)

### Inferences

**Comparison matrix.** This synthesises the findings above. Ratings are judgement calls, not measured values.

| Approach | End-user setup | Cost (2026) | CGNAT both ends | Embeddable (no extra app) | E2E encryption | iOS notes | Fit |
|---|---|---|---|---|---|---|---|
| Tailscale app on PC + iPhone | Install 2 apps, log in | Free (Personal, non-commercial, 6 users) | Yes (DERP / peer relays) | No (VPN app) | Yes (WireGuard) | System VPN, one VPN at a time (unverified) | Best for (a) |
| TailscaleKit (iOS) + tsnet/daemon (PC) | In-app login or auth key | Free / Headscale self-host | Yes | Yes (userspace) | Yes | Foreground only; logs to Tailscale by default (Dart wrapper notes) | Good for (a) power users; (b) only with Headscale or a per-user tailnet |
| Headscale + Tailscale apps | Self-host server; set custom control URL | VPS cost | Yes (needs DERP) | No / Yes with TailscaleKit | Yes | Custom control URL supported on iOS | Hobbyist |
| ZeroTier | Install apps, join network | Free 10 devices, 1 network | Yes (relays) | No (VPN app) | Yes | – | Alt for (a) |
| NetBird / Nebula | Install apps | Free tiers (NetBird ~5 users/100 machines; Defined 100 devices) | Yes (relays/lighthouses) | No | Yes | Mobile Nebula iOS 14+ | Alt for (a) |
| Plain WireGuard + VPS | Configure keys, VPS endpoint | VPS ~$2–5/month | Yes via VPS | Only with NE extension (system VPN) | Yes | Needs NE entitlement | Tinkerers |
| Cloudflare Tunnel + Access | Own domain, Cloudflare account, cloudflared | Free | Yes | Yes (plain HTTPS) | No (Cloudflare terminates TLS) | Background URLSession OK | Runner-up for (a) |
| Tailscale Funnel | Tailscale on PC only | Free (beta) | Yes | Yes (public HTTPS) | TLS to your device | Public exposure; bandwidth limits | Quick demos |
| ngrok / zrok / Pinggy | Account + agent | ngrok free 1 GB/month; zrok free ~10 GB/day (forum) | Yes | Yes | Provider edge (unverified) | – | Testing only |
| frp / rathole / bore + VPS | Self-host server | VPS | Yes | Yes | frp/rathole configurable; bore none | – | Tinkerers |
| iroh embedded (Node + Swift) | None beyond pairing | Free (dev relays) / own relay ~$2–5/month / managed | Yes (relay fallback) | Yes | Yes (QUIC) | Foreground only; HTTP bridging needed | Best for (b) |
| WebRTC (node-datachannel + iOS WebRTC) | None | Signaling (free DO tier) + TURN ($0.05/GB after 1 TB) | Yes with TURN | Yes | Yes (DTLS, standard; not sourced here) | Large binary; complex | Viable for (b) |
| Hyperswarm via Bare Kit | None | Own blind relay | Partial (needs blind relay) | Yes | Yes | ObjC host API | JS-centric (b) |
| libp2p (js + swift-libp2p) | None | Own relay | Yes with relay | Yes | Yes | swift-libp2p needs iOS 26+; immature | Not recommended |
| DIY WebSocket relay | None | ~$2–5/month VPS + egress | Yes | Yes (plain HTTPS) | Only if you add it | Background URLSession OK | Viable for (b) |
| UPnP/PCP + DDNS / IPv6 | Router support | Free | No | Yes | Only with TLS | – | Opportunistic only |
| Tor onion service | Bundle Tor on iOS | Free | Yes | Yes (heavy) | Yes | Arti iOS experimental; slow | Niche |
| Bonjour LAN | None (permission prompt) | Free | LAN only | Yes | Add TLS | Local Network prompt | Pairing / fast path |

**Suggested architecture for (b).**
- The desktop generates a persistent iroh secret key, so the endpoint ID is the "computer ID".
- The desktop UI shows a QR code or pairing code containing the iroh ticket plus a one-time pairing secret. The phone scans it, and both sides store each other's public keys.
- The Node side bridges iroh streams to Hono on `127.0.0.1:3006`, which stays bound to localhost.
- The phone syncs books into local storage while foregrounded, using Bonjour or a direct LAN path when available.
- Ship with 1–2 self-hosted `iroh-relay` instances.
- Optionally add a DIY HTTPS relay later if background downloads become important.

**Practical shortcut for (a).** No code changes. Run `tailscale serve 3006` on Fedora, install Tailscale on the iPhone, and build the iOS app against the `ts.net` URL. Upgrade to embedded TailscaleKit later if you want to drop the separate VPN app.

### Gaps
- No head-to-head benchmarks (latency or throughput) of iroh against Tailscale against WebRTC found in sources.
- No 2025–2026 Hacker News or Reddit (r/selfhosted, r/homelab) comparison threads were retrieved within the search budget, so community sentiment is only represented by the forum posts cited above.
