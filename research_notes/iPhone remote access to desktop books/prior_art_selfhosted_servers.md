# Prior Art: Self-Hosted Book, Comic, and Media Servers with iPhone Companion Apps (Pairing, Remote Access, Auth, Offline)

Research date: 2026-10-26. Scope: how existing self-hosted servers let an iPhone app reach a user's own computer, both at home and away. Relevance target: a Node 22 + Hono + SQLite "Pager" server on Fedora (port 3006) that serves EPUB/DOCX/MD/HTML with highlights, progress, and an SSE/event stream, plus a planned iPhone app that pairs by code and keeps permanent remote access.

Method note: primary docs were fetched where possible. Some claims come from forum threads or third-party blogs and are labeled as such. The Plex Relay support article (support.plex.tv/articles/216766168-accessing-a-server-through-relay/) returned HTTP 403 and could not be read directly.

## Q1. Plex: plex.tv/link code pairing, Remote Access (UPnP/NAT-PMP, plex.direct TLS, Relay), and what happens when port forwarding fails

### Takeaway
Plex is the only mainstream project with a full vendor-run stack: a central account broker (plex.tv) for pairing and server discovery, per-server wildcard TLS certificates under plex.direct, automatic UPnP/NAT-PMP port mapping, and a bandwidth-capped Relay fallback for CGNAT/double-NAT. It works with little setup, but it ties every user to a vendor account. Plex has used that dependency to charge for remote streaming: phased enforcement ran from 2025 through 2026 and reached third-party clients like Infuse in September 2026.

### Cited Findings

**Pairing (4-character link code / PIN flow)**
- Big-screen Plex apps (Android TV, Apple TV, smart TVs) "generally allow you to connect the app to your account by way of a 4-character link code." The user enters it at plex.tv/link, and the player app refreshes itself a few seconds later, linked to the account. — [Plex Support: Connect app to your Plex account](https://support.plex.tv/articles/203395277-connect-app-to-your-plex-account/)
- Developer flow, per Plex's developer docs as quoted on the Plex forum:
  - The app creates a PIN with `POST plex.tv/api/v2/pins`, sending a client identifier and product name, and stores the PIN `id` locally.
  - The user claims the code at plex.tv/link. The app either uses a forwarding URL or polls `GET plex.tv/api/v2/pins/{id}` about once per second.
  - Once the PIN is claimed, the response's `authToken` field holds the user's access token. Until then it stays null. — [Plex Forum: Authenticating with Plex](https://forums.plex.tv/t/authenticating-with-plex/609370)
- PIN lifetime is unclear. One npm package says about 10 minutes, and a Python library author guesses about 15 minutes (unverified). — [plex-pin (npm)](https://www.npmjs.com/package/plex-pin); [plex-api-client (PyPI)](https://pypi.org/project/plex-api-client/0.35.0/)
- Plex now recommends a newer JWT device flow for new integrations. A 2026 forum thread reports that polling a PIN still returned a legacy token, not a JWT. — [Plex Forum: Exchanging PIN for JWT Token](https://forums.plex.tv/t/exchanging-pin-for-jwt-token/941120)

**Remote Access mechanics**
- Remote Access lives under Settings > Server > Remote Access and "requires signing in" to a Plex account.
  - Automatic configuration needs a router that supports UPnP or NAT-PMP. The server tries this by default when "Enable Remote Access" is clicked.
  - The manual alternative is to forward any external port to internal port 32400 and tick "Manually specify public port." The article warns that if you don't tick it, the server keeps attempting automatic mapping, which "will almost certainly fail."
  - Status shows as Successful, Unsuccessful, or Disabled, with a Private/Public/Internet mapping diagram.
  - Listed failure causes are "Double-NAT," a misconfigured manual port forward, and "some other situations." The article was last modified September 8, 2026. — [Plex Support: Remote Access](https://support.plex.tv/articles/200289506-remote-access/)

**plex.direct TLS**
- Plex partnered with DigiCert to issue each user or server a wildcard certificate for `*.HASH.plex.direct`.
  - Hostnames embed the IP with dashes, e.g. `1-2-3-4.<hash>.plex.direct`, and resolve to 1.2.3.4.
  - The certificate is issued when the server first starts, and the server holds the private key.
  - Clients ask plex.tv for the list of servers on the account, then connect to them directly.
  - Because the wildcard covers any IP, clients can use either the LAN or the public address with a valid certificate and no DNS propagation delay.
  - The hash scopes the certificate to one server, so handing out the key is considered safe. (Filippo Valsorda, 6 June 2015) — [Filippo Valsorda: How Plex is doing HTTPS for all its users](https://words.filippo.io/how-plex-is-doing-https-for-all-its-users/)
- Side effect: plex.direct names resolve to RFC 1918 LAN addresses, which router DNS-rebinding protection blocks. The usual fix is a private-domain exception for plex.direct, for example on pfSense/Unbound. — [Bill Mill notes](https://notes.billmill.org/programming/DNS/How_plex_is_doing_HTTPS_for_all_its_users.html); [Netgate forum](https://forum.netgate.com/topic/200853/dns-rebind-issue-maybe/11)
- Clients learn connection candidates from plex.tv's resources endpoint. A forum moderator suggests querying it with relay included and checking for an entry with `relay="1"`. Entries carry a `local` attribute that distinguishes LAN from public routes. Forum sources only; the v2 path's parameters were not confirmed. — [Plex Forum: Different ways to connect to PMS](https://forums.plex.tv/t/different-ways-to-connect-to-pms/574208); [Plex Forum: Plex Relay is Broken](https://forums.plex.tv/t/plex-relay-is-broken/937329)

**Relay fallback**
- When a client can't reach the server directly, the connection goes through Plex Relay and shows as "indirect" on the server dashboard. Common causes are no public IPv4 because of ISP carrier-grade NAT (CGNAT), or double NAT. — [Plex Forum: What is an "indirect connection"?](https://forums.plex.tv/t/what-is-an-indirect-connection/168107); [Plex Forum: Plex quality very low outside wifi](https://forums.plex.tv/t/plex-quality-very-low-outside-wifi/787086)
- Forum reports put the Relay cap at about 1 Mbps without Plex Pass and 2 Mbps with it. This is community-reported and not confirmed from official docs, because the official Relay article returned 403. — [Plex Forum: WAN streaming issue 2mbps max](https://forums.plex.tv/t/wan-streaming-issue-2mbps-max/786838/2); [Plex Forum: Bandwidth capped at 1mbps, no relay](https://forums.plex.tv/t/bandwidth-capped-at-1mbps-no-relay/927313)
- A March–April 2026 thread describes Relay failing intermittently. The poster was behind CGNAT, chose Relay over paying for a public IP, and fell back to Tailscale. Users suggested:
  - checking `plex.tv/api/resources` for a relay entry
  - confirming the relay hostname resolves, and trying public DNS
  - disabling VPNs — [Plex Forum: Plex Relay is Broken (Mar 2026)](https://forums.plex.tv/t/plex-relay-is-broken/937329)

**Policy changes (deprecations and paywalls)**
- **April 29, 2025:** Plex launched the Remote Watch Pass at $1.99/month or $19.99/year. Plex Pass rose to $6.99/month, $69.99/year, and $249.99 lifetime. — [BetaNews, Mar 2025](https://betanews.com/2025/03/19/plex-2025-price-changes-remote-streaming-new-subscription/); [Plex blog: important 2025 Plex updates](https://www.plex.tv/zh/blog/important-2025-plex-updates/)
- **Late November 2025:** Plex required Remote Watch Pass or Plex Pass for remote streaming on Roku, and said the requirement would reach all other TV apps and "any third party clients using the API" in 2026. — [Plex Forum: Changes Coming to Remote Streaming on Roku](https://forums.plex.tv/t/changes-coming-to-remote-streaming-on-roku/933671/1); [BetaNews, Nov 2025](https://betanews.com/2025/11/26/plex-is-clamping-down-on-free-remote-streaming/)
- **March 23, 2026:** The requirement extended to smart TVs (Samsung, LG, Vizio) and PlayStation/Xbox. — [Plex Forum: Changes Coming to Remote Streaming on Smart TVs](https://forums.plex.tv/t/changes-coming-to-remote-streaming-on-smart-tvs/937015.md)
- **May 6, 2026:** Android Authority reports that remote streaming needs a pass even with a working port forward.
  - Plex's stated reason is the cost of its relay infrastructure.
  - The Remote Watch Pass price has risen to about $30/year.
  - Suggested workarounds are Tailscale (add 100.64.0.0/10 to Plex's "LAN Networks" and add a manual connection to `100.x.x.x:32400`) and Plezy, an open-source third-party client. — [Android Authority, May 2026](https://www.androidauthority.com/plex-remote-streaming-free-3663446/)
- **September 21, 2026:** Firecore (maker of Infuse) relayed a Plex notice that "beginning later this week, remote streaming from a Plex server will require a paid Plex license," and that this "now includes videos played through 3rd-party apps like Infuse." Local playback is unaffected. Firecore suggests Tailscale or a VPN instead. — [Firecore Community, Sept 21 2026](https://community.firecore.com/t/changes-to-plex-remote-streaming-requirements/60825)
- **September 2025 breach:** Plex disclosed a breach of emails, usernames, hashed passwords, and authentication data, and told users to reset passwords and sign out connected devices. It separately urged upgrading Plex Media Server to 1.42.1 for CVE-2025-34158. — [BleepingComputer](https://bleepingcomputer.com/news/security/plex-tells-users-to-reset-passwords-after-new-data-breach); [TechCrunch, Sept 9 2025](https://techcrunch.com/2025/09/09/plex-urges-users-to-change-passwords-after-data-breach/); [Help Net Security](https://www.helpnetsecurity.com/2025/09/09/plex-tells-users-to-change-passwords-due-to-data-breach-pushes-server-owners-to-upgrade/)

### Inferences
- Plex's design has four parts the user could copy at small scale:
  1. a rendezvous service that maps an account or computer ID to a list of candidate URLs (LAN, public, relay)
  2. per-device certificates so every candidate URL is valid HTTPS
  3. automatic router port mapping
  4. a relay of last resort

  The relay is the expensive part. Plex's own justification for the paywall is relay bandwidth cost, so a small project should avoid running a relay or use a third-party overlay such as Tailscale.
- The plex.direct trick (a wildcard DNS name that resolves to the IP embedded in the hostname, plus a wildcard certificate per server) is how a vendor gets valid HTTPS on LAN IPs. It needs a domain the developer controls and an ACME provider that issues wildcards (DNS-01). The DNS-rebinding side effect will hit some users' routers.
- Unverified (training knowledge, not confirmed in sources this session): the 4-character code comes from `POST /api/v2/pins` with `strong=false`, and `strong=true` returns the long code used in the app.plex.tv/auth forwarding flow. Verify against the python-plexapi `MyPlexPinLogin` source before relying on it.
- A desktop-only Pager app that pairs a phone needs no vendor account. Plex's model is useful as a pattern to copy, not as an example of the business arrangement to adopt.

### Gaps
- Could not read the official Plex Relay article (403), so the Relay bitrate caps and encryption details are from forum posts only.
- No official documentation was found for how plex.tv tests reachability, i.e. its NAT reachability probe.
- The exact current Remote Watch Pass price (the "about $30/year" figure) was not confirmed on plex.tv.

## Q2. Jellyfin / Emby: Quick Connect, expected remote-access setup, and iOS clients (Swiftfin, Infuse)

### Takeaway
Jellyfin has no cloud broker or relay. It provides LAN discovery (UDP 7359) and Quick Connect, a 6-character code that a signed-in device approves, and leaves remote access to the user. Its docs discourage direct port forwarding and point to a reverse proxy with Let's Encrypt, a VPN, or a VPS proxy. Emby adds "Emby Connect," a vendor account that only looks up the server's address. It never relays traffic, so remote access must already work.

### Cited Findings

**Jellyfin Quick Connect (pairing)**
- Quick Connect is on by default and can be disabled under Dashboard > General ("Enable Quick Connect on this server").
  - The new device shows a 6-character code. The user enters it on an already signed-in device under Settings > Quick Connect, and the new device logs in automatically.
  - An invalid or expired code shows an error.
  - Clients that can log in with it include Android, Android TV, iOS, Roku, Web, WebOS, Xbox, and Swiftfin (iOS and tvOS).
  - Clients that can authorize other devices include Android, Media Player, iOS, Web, WebOS, Xbox, and Swiftfin iOS.
  - The docs don't state code expiry. — [Jellyfin Docs: Quick Connect](https://jellyfin.org/docs/general/server/quick-connect/)
- API flow from the SDK docs:
  1. The client checks that Quick Connect is enabled, then calls `initiate()`, which returns a code and a secret.
  2. The client polls `state(secret)`.
  3. The approving device calls `authorize(code)` with an optional user ID.
  4. The new client exchanges the secret via `authenticateWithQuickConnect(secret)` for an AuthenticationResult that contains the access token. — [Jellyfin Kotlin SDK: authentication guide](https://kotlin-sdk.jellyfin.org/guide/authentication.html); [Kotlin SDK: authenticateWithQuickConnect](https://kotlin-sdk.jellyfin.org/dokka/jellyfin-api/org.jellyfin.sdk.api.client.extensions/authenticate-with-quick-connect.html); [TypeScript SDK: QuickConnectApi](https://typescript-sdk.jellyfin.org/functions/generated-client.QuickConnectApiFp.html); [dart_jellyfin docs](https://pub.dev/documentation/dart_jellyfin/0.2.0/)

**Jellyfin networking and remote access guidance**
- Ports are 8096/TCP for HTTP, 8920/TCP for HTTPS (unused unless enabled), and 7359/UDP for client discovery. Discovery "will not work outside your local subnet" and "should not be exposed externally." — [Jellyfin Docs: Networking](https://jellyfin.org/docs/general/post-install/networking/)
- Listed ways to reach the server from outside:
  - forwarding ports directly, marked "not recommended!"
  - a reverse proxy
  - a VPN into the home network
  - a VPS acting as a reverse proxy

  Self-signed certificates are "strongly discouraged." The docs recommend terminating HTTPS at the reverse proxy and say reverse-proxy access works only if "known proxies" are configured. Per-user remote access can be toggled. — [Jellyfin Docs: Networking](https://jellyfin.org/docs/general/post-install/networking/)

**Emby Connect**
- Emby Connect is an optional free central account. "The sole purpose of the Emby Connect feature is to help your devices locate your Emby Server," and "all connections are direct from your devices to your Emby Server."
  - Remote access must already be working and tested before Emby Connect remote setup.
  - Admins link an Emby Connect username to a local user, and that user can then sign in with either set of credentials. — [Emby Support: Emby Connect](https://emby.media/support/articles/Emby-Connect.html)
- Community description: Emby Connect is "basically just a lookup service," unlike Plex, which routes traffic, and it works like dynamic DNS. — [Emby Community: How does Emby Connect actually work](https://emby.media/community/topic/106829-how-does-emby-connect-actually-work)

**iOS clients**
- Swiftfin, the official native client, is on the App Store for iOS 18+ and tvOS, with a TestFlight beta. The README excerpt said nothing about offline downloads. — [GitHub: jellyfin/Swiftfin](https://github.com/jellyfin/Swiftfin)
- Jellyfin forum, May 2025: downloads are "not yet supported on IOS." No source found showing that this changed by October 2026. Swiftfin 1.4 (January 2026, per a third-party blog) lists navigation, Jellyfin 10.11 support, and player and subtitle changes, with no downloads. — [Jellyfin Forum: download on iOS devices](https://forum.jellyfin.org/t-download-on-ios-devices); [JellyWatch blog (third-party)](https://jellywatch.app/blog/jellyfin-swiftfin-ios-apple-tv-setup-guide-2026)
- Infuse (Firecore) is a paid client for Plex, Emby, and Jellyfin. Firecore said in 2021 that offline progress sync for downloaded content was added in 6.4.7. 2024 user reports say server progress overwrote offline progress after reconnecting, and that Direct Mode forgot offline watch history. No fix was confirmed. — [Firecore: Offline watched status sync](https://community.firecore.com/t/offline-downloaded-content-watched-status-sync-to-emby-jellyfin-plex/34124); [Firecore: Sync offline watch progress to Jellyfin](https://community.firecore.com/t/sync-offline-watch-progress-of-downloaded-content-to-jellyfin/51353); [Firecore: Plex downloaded content sync issue](https://community.firecore.com/t/infuse-plex-downloaded-content-sync-issue/19249)

### Inferences
- Quick Connect is the closest analog to "pair the phone with a code." For the user's case, invert it: the desktop shows the code (or a QR code) and the phone enters or scans it. The Jellyfin flow is a public code plus a private polling secret, approval on a trusted device, and exchange of the secret for a long-lived token. It maps directly onto a Hono endpoint pair.
- Emby Connect shows a middle ground: a tiny lookup service that maps an ID to the current URLs, with no relay. That is the minimal "computer ID" broker the user's design implies. It still leaves NAT traversal unsolved.
- The Infuse bug reports show that "server wins on reconnect" loses offline reading progress. Reconciliation must compare timestamps per item.

### Gaps
- Quick Connect code TTL and character set are not documented.
- Swiftfin's offline-download status as of October 2026 is not confirmed beyond the May 2025 forum answer.
- Jellyfin's own Tailscale doc page was not fetched.

## Q3. Book-specific servers and their iOS clients (Calibre, Calibre-Web/CWA, Kavita, Komga, Audiobookshelf, Readarr, Stump, BookLore, Booklogr, Ubooquity, COPS, KOReader/kosync)

### Takeaway
None of the book servers runs a cloud broker or relay. Every one expects the user to provide a reachable HTTPS URL (reverse proxy, port forward, or VPN/Tailscale), and the phone authenticates with username and password, per-user API keys, or OPDS credentials. The most mature "native iOS app with offline downloads and progress sync" is in audio (Audiobookshelf and its many third-party iOS clients). For ebooks and comics, the dominant pattern is generic OPDS readers (Panels, Chunky, KyBook, Yomu) plus KOReader-style progress-sync protocols. Several notable apps are gone or retired: Readarr (archived June 27, 2025), Marvin (pulled from the App Store around 2023, per a user report), and Calibre Companion (broke with calibre 5.0 in 2020). BookLore is in maintenance mode.

### Cited Findings

**Calibre Content Server**
- Built into calibre. Phones on the same network use the address in the Connect/share menu, e.g. `http://192.168.1.5:8080`, and the `/mobile` path serves old browsers. — [calibre manual: The calibre Content server](https://manual.calibre-ebook.com/server.html)
- Authentication:
  - Users are created via Preferences > Sharing, or with `calibre-server --userdb ... --manage-users` plus `--enable-auth`.
  - Digest auth is the default, and `--auth-mode=basic` is recommended once SSL is in place.
  - Credentials can be put in the URL for e-ink browsers.
  - The manual warns to require a password before exposing the server to the internet. — [calibre manual](https://manual.calibre-ebook.com/server.html)
- Offline: the browser reader stores the book being read in an offline cache. Full offline mode needs HTTPS because it uses service workers.
- Progress: reading position syncs across devices when the server is running, with a manual "Sync" action.
- Remote access: forward port 8080, or use a reverse proxy with `--listen-on 127.0.0.1` and `--url-prefix /calibre`. The manual gives nginx and Apache examples. — [calibre manual](https://manual.calibre-ebook.com/server.html)
- **Calibre Companion (iOS):** After calibre 5.0.1 (October 2020), users reported Calibre Companion for iOS could no longer open books to transfer them, and downgrading to calibre 4.23 fixed it. No developer response was found. — [MobileRead thread](https://www.mobileread.com/forums/showthread.php?p=4043150); [MobileRead](https://www.mobileread.com/forums/showthread.php?p=4043416)
- **Marvin (iOS reader):** A May 2023 MobileRead post reports Marvin "disappeared from the App Store." A 2025 post describes recovering it with iMazing from old backups (unofficial). Alternatives mentioned were MapleRead and BookFusion. — [MobileRead](https://www.mobileread.com/forums/showthread.php?p=4321579)

**Calibre-Web Automated (CWA) / Calibre-Web**
- CWA has a built-in KOReader sync (KOSync) server.
  - It auto-generates KOReader-compatible checksums and authenticates existing CWA accounts with HTTP Basic auth.
  - The KOReader plugin is downloadable from `/kosync`.
  - Progress flows from KOReader to CWA reading status to Kobo. — [GitHub: crocodilestick/Calibre-Web-Automated](https://github.com/crocodilestick/Calibre-Web-Automated)
- Other features:
  - Kobo sync (stock Calibre-Web), an OPDS feed at `/opds`, and send-to-eReader by email
  - "Magic Link" login for e-readers
  - OAuth2/OIDC with auto-discovery
  - `TRUSTED_PROXY_COUNT` for running behind Cloudflare Tunnel or a reverse proxy
  - The only mobile app is Calibre Web Companion, an unofficial Flutter app on Google Play, F-Droid, and GitHub; no iOS app is mentioned. — [GitHub: CWA](https://github.com/crocodilestick/Calibre-Web-Automated)

**Kavita**
- OPDS is enabled by default. Each user gets "a unique URL and Auth key," copied from the UI, and the URL uses the admin-set hostname if one is configured. — [Kavita Wiki: OPDS](https://wiki.kavitareader.com/guides/features/opds/)
- iOS client matrix from the Kavita wiki:

  | Client | OPDS | OPDS-PS | EPUB | Progress sync | API |
  |---|---|---|---|---|---|
  | Chunky | yes | yes | no | yes | no |
  | Panels | yes | yes | no | yes | no |
  | Yomu | yes | no | yes | no | no |
  | Paperback | no | no | no | per chapter | yes |
  | Aidoku | no | no | no | per chapter | yes |

  — [Kavita Wiki: OPDS](https://wiki.kavitareader.com/guides/features/opds/)
- The Kavita wiki's Komic guide says iOS requires HTTPS for remote connections, so remote use needs a reverse proxy with SSL. The wiki provides Caddy, NGINX, NPM, SWAG, Apache, and HAProxy examples. — [Kavita Wiki: Komic](https://wiki.kavitareader.com/guides/3rdparty/komic/); [Kavita Wiki: OPDS](https://wiki.kavitareader.com/guides/features/opds/)
- Panels' App Store listing says it can "stream, search and download comics from your OPDS compatible server" and names Kavita. — [App Store: Panels](https://apps.apple.com/app/panels-comic-reader/id1236567663)

**Komga**
- Users generate API keys in Account Settings; each key is shown once.
- KOReader sync:
  - The user needs the `KOREADER_SYNC` role.
  - KOReader's custom sync server is set to `<komga>/koreader`, with the API key as the username and any dummy password.
  - Document matching must be set to Binary.
  - EPUB progress is tracked at chapter starts only, so mid-chapter progress is lost when switching between KOReader and Komga. — [Komga Docs: KOReader](https://komga.org/docs/guides/koreader)
- Native iOS clients:
  - KMReader: API-key sign-in, Komga 1.19.0+, API v1/v2 — [Komga Docs: KMReader](https://komga.org/docs/guides/kmreader); [App Store: KMReader](https://apps.apple.com/app/id6755198424)
  - Komic: added API-key sign-in in 1.22.1 — [App Store: Komic](https://apps.apple.com/no/app/id6744676973)

**Audiobookshelf (ABS)**
- The official mobile app is NuxtJS + Capacitor, sharing one codebase for iOS and Android. Android is "beta" on Google Play. iOS is "early beta" via TestFlight, and the beta is full at Apple's 10k-tester cap. — [GitHub: advplyr/audiobookshelf-app](https://github.com/advplyr/audiobookshelf-app)
- The audiobookshelf.org App Store badge links to a TestFlight invite, not a public App Store listing (as of October 2026). — [audiobookshelf.org](https://www.audiobookshelf.org/)
- The official app is still versioned "beta" (v0.14.2-beta, 27 Sep).
  - v0.10.0-beta added "support for the new authentication system with automatic token refresh."
  - v0.10.1 fixed iOS refresh tokens not being saved and OIDC re-login errors.
  - v0.14.1 fixed transient token-refresh logouts.
  - v0.14.0 added Android background downloads with resume.
  - v0.11.0 fixed a sync issue when disconnecting with the player open. — [GitHub: audiobookshelf-app releases](https://github.com/advplyr/audiobookshelf-app/releases)
- Server auth:
  - v2.26.0 introduced a JWT access/refresh token system.
  - API keys are "designed for server-to-server communication and automation scripts." Third-party apps should use the standard JWT flow. — [audiobookshelf.org: API keys guide](https://www.audiobookshelf.org/guides/api-keys/); [releasebot: ABS release notes](https://releasebot.io/updates/advplyraaudiobookshelf/audiobookshelf)
  - v2.35.0 added an access-token refresh grace period to fix frequent re-logins.
  - CVE-2026-73085: before 2.36.0, refresh tokens could authenticate on resource endpoints such as `/api/me`. — [OSV: CVE-2026-73085](https://osv.dev/vulnerability/CVE-2026-73085)
- Legacy API (docs marked out-of-date):
  - `POST /login` with username and password returns `user.token`. Calls then use `Authorization: Bearer <token>`, or `?token=` on GET.
  - Login is rate-limited to 10 attempts per 600 s.
  - The Sessions section lists "Sync a Local Session" and "Sync Local Sessions." The Me section lists "Sync Local Media Progress."
  - The media-progress object includes `currentTime`, `progress`, `isFinished`, and a millisecond `lastUpdate` timestamp. — [Audiobookshelf API docs](https://api.audiobookshelf.org/)
- Reverse-proxy gotcha: CORS middleware on the proxy causes "Unknown Error" at app login, and WebSocket upgrade headers are required. — [GitHub: advplyr/audiobookshelf README](https://github.com/advplyr/audiobookshelf)
- A proposal to send custom headers (e.g. Cloudflare Access service tokens) on every app request was discussed; shipping was not confirmed. — [GitHub issue: audiobookshelf-app #254](https://github.com/advplyr/audiobookshelf-app/issues/254)
- Third-party iOS clients on the App Store fill the gap left by the TestFlight-only official app:
  - ShelfPlayer: offline downloads (premium), progress and session sync, CarPlay; latest 3.3.1 requires iOS 26 — [App Store: ShelfPlayer](https://apps.apple.com/app/id6475221163)
  - AudioBooth: "independent client," offline downloads, CarPlay, Apple Watch — [App Store: AudioBooth](https://apps.apple.com/app/id6753017503)
  - SoundLeaf: first released April 23, 2025 — [terminalbytes: SoundLeaf launch](https://terminalbytes.com/soundleaf-ios-client-audiobookshelf-launch)
  - Audiary — [App Store: Audiary](https://apps.apple.com/es/app/audiary/id6757362410)
  - LAAB: syncs progress and bookmarks to ABS — [App Store: LAAB](https://apps.apple.com/app/id6450146951)

**KOReader + kosync server**
- Authenticated requests carry `x-auth-user` and `x-auth-key`, where the key is an MD5 of the password computed on the client.
- Documents are identified by a 32-character MD5; the server stores no filename or content.
- Stored fields are `percentage`, `progress`, and `device`, and the server keeps the furthest progress per document.
- Endpoints include `GET /users/auth`, `PUT /users/password`, `DELETE /users/me`, and `GET /healthcheck`.
- Docker image `koreader/kosync`: HTTPS on port 7200 with a self-signed certificate, or 17200 behind a TLS-terminating proxy. — [GitHub: koreader/koreader-sync-server](https://github.com/koreader/koreader-sync-server)
- KOReader's "Binary" matching hashes sampled parts of the file, not the whole file (third-party implementations mention an "exponential sampling algorithm"). Forum users report the same file sometimes getting different checksums on different devices. Kosync syncs progress only, not highlights or notes. — [BookBridge v6.1.0 release](https://newreleases.io/project/github/cporcellijr/bookbridge/release/v6.1.0); [MobileRead](https://www.mobileread.com/forums/showthread.php?p=4468576); [Readest Docs: Sync](https://readest.com/docs/sync)

**Readarr (retired)**
- The repo was archived on June 27, 2025. The README cites unusable metadata, a stalled move to Open Library, and no maintainer time, and advises users to seek alternatives. Readarr is an acquisition and library manager, not a reading server or iOS client. — [GitHub: Readarr/Readarr](https://github.com/Readarr/Readarr)

**Stump**
- "Beta software until it reaches a stable 1.0." Features include OPDS 1.2 (with OPDS-PSE) and 2.0, KOReader and Kobo sync, OIDC, and multi-user permissions. The repo includes `apps/expo/`, a React Native app; platforms and release status are not stated. — [GitHub: stumpapp/stump](https://github.com/stumpapp/stump)

**BookLore (maintenance mode)**
- Features include Kobo sync, OPDS, KOReader progress sync, send to Kindle/email, and local or OIDC auth.
- The README says "BookLore is entering maintenance mode" and calls BookOrbit "BookLore's official successor," with a "native offline-capable iOS app" plus Apple Watch audiobook playback "in development." — [GitHub: booklore-app/booklore](https://github.com/booklore-app/booklore)
- Conflict: ElfHosted describes "Grimmory" as the community continuation of BookLore and BookOrbit as a separate project. BookOrbit's creator has denied that it is a fork. — [ElfHosted: BookOrbit](https://docs.elfhosted.com/app/bookorbit/); [Lemmy thread](https://lemmy.amethyst.name/post/1449401/602033)
- AlternativeTo lists BookOrbit on iPhone, Apple Watch, web, Kobo, and KOReader as "Works Offline"; this was not verified against an App Store listing. — [AlternativeTo: BookOrbit](https://alternativeto.net/software/bookorbit/about/)

**Booklogr**
- A self-hosted reading tracker, not a file server: OpenLibrary lookup, reading lists, current-page tracking, notes and quotes, Mastodon sharing, SQLite or Postgres. No iOS app. — [GitHub: mozzo1000/booklogr](https://github.com/mozzo1000/booklogr)

**COPS / Ubooquity**
- COPS is a lightweight, read-only PHP OPDS/web front-end for a calibre library (source is marketing pages). — [Hostinger: COPS](https://www.hostinger.com/uk/applications/cops); [AlternativeTo: COPS](https://alternativeto.net/software/cops/about)
- Ubooquity is a free-for-personal-use, proprietary home server for comics and ebooks. A 2026 MobileRead post says the Kuboo mobile client "died" and nothing replaced it. — [AlternativeTo: COPS alternatives](https://alternativeto.net/software/cops); [MobileRead](https://www.mobileread.com/forums/showthread.php?p=4597787)

### Inferences
- **Industry default.** Every book server pushes reachability onto the user. The phone stores a base URL and a credential (password session, API key, or an OPDS URL with an embedded key). None ships a pairing code for book apps. A pairing flow would set the user's Pager apart from these projects.
- **Komga-style API keys fit device pairing best.** Each key is per user, shown once, revocable, and usable as a bearer credential. The pairing step would mint a per-device key, stored in the iOS Keychain, so the phone never sees a password.
- **Token-refresh complexity has caused bugs.** ABS's move to access/refresh JWTs produced repeated "unexpected logout" fixes and a CVE. For one owner and a few devices, a long-lived per-device token with server-side revocation is simpler and less fragile than rotating refresh tokens.
- **Progress sync design.** Two working models exist:
  - kosync: the server keeps the furthest position per document hash. This is simple but loses intentional backward jumps.
  - ABS: progress objects carry a millisecond `lastUpdate`, and the client uploads local sessions after reconnecting, which supports last-write-wins.
  - For highlights and notes, which kosync doesn't sync, per-record timestamps or IDs and merge (not overwrite) are needed, given the Infuse "server overwrote offline progress" reports.
- **Document identity.** Hashing file content (kosync) survives renames but breaks if the file is edited and can differ across devices. A server-assigned stable book ID plus a content hash for change detection is more robust for EPUB/DOCX/MD/HTML.
- **Distribution.** ABS shows that a TestFlight-only official app (capped at 10k testers) creates demand for paid third-party clients. A personal project can live on TestFlight or a dev certificate, but App Store review matters if the app is distributed widely.
- **Offline.** Successful clients (Panels, ShelfPlayer, AudioBooth, Infuse) download whole files into the app sandbox and play or read locally. Calibre's browser reader also caches the current book offline but needs HTTPS for service workers. HTTPS is a prerequisite for both iOS App Transport Security and web offline modes.

### Gaps
- KyBook 3's current App Store status and OPDS behavior were not found.
- Calibre Companion's formal discontinuation or removal date was not found; only the 2020 breakage reports.
- No primary source confirmed whether the official ABS iOS app ever shipped publicly on the App Store; as of October 2026 the official site still links to TestFlight.
- The exact ABS local-session sync endpoint paths (e.g. `/api/session/local`) were not visible in the truncated API page.
- The exact KOReader binary-hash algorithm was not confirmed from KOReader source.
- Kavita's and Komga's own remote-access guide pages were not fetched in full.
- Stump mobile app platforms and release status are unknown.

## Q4. Music/photo analogs with good iOS apps (Navidrome/Subsonic clients, Immich, PhotoPrism) and 2025–2026 remote-access recommendations

### Takeaway
Music and photo projects follow the same no-broker model. Two details are worth copying:
- **Immich:** an ordered list of endpoints in the app ("Automatic URL switching": a local URL on a named Wi-Fi SSID, then external URLs tried in order) and docs that explicitly recommend Tailscale or a VPN over port forwarding.
- **The Subsonic/OpenSubsonic API:** a stable, client-agnostic protocol with salted-token or API-key auth that dozens of iOS apps implement.

### Cited Findings

**Navidrome / Subsonic**
- Navidrome recommends running behind a reverse proxy (Caddy, Nginx, Traefik, Apache) for security and SSL, and binding to localhost. — [Navidrome Docs: Security Considerations](https://navidrome.org/docs/usage/security)
- Reverse-proxy auth reads a `Remote-User` header from trusted proxies. Most proxy auth services don't support the Subsonic auth scheme, so `/rest/*` is usually exempted and authenticated by Navidrome itself, and `/share/*` must be whitelisted. — [Navidrome Docs: Reverse proxy authentication](https://navidrome.org/docs/usage/reverse-proxy); [Navidrome Docs: Externalized Authentication](https://navidrome.org/docs/usage/integration/authentication/)
- Subsonic token auth:
  - The client sends `t = md5(password + salt)` and `s = salt`, with a random salt of at least six characters (8 in Sublime Music).
  - It requires Subsonic API 1.13.0+, and clients fall back to plaintext password auth on error 41 (e.g. LDAP users). — [Ampache: Subsonic API](https://ampache.org/docs/configuration/subsonic); [Sublime Music commit](https://git.uninsane.org/colin/sublime-music/commit/84e2a0e23c4d9c013e839b331c649c0b875983dd)
  - The OpenSubsonic API-key extension lets clients use `apiKey` instead of username and password. — [GitHub: explodingcamera/subsonic-api](https://github.com/explodingcamera/subsonic-api)
- Amperfy (iOS/iPadOS/macOS, Swift) supports Ampache and Subsonic, multiple accounts, offline mode, and CarPlay. — [GitHub: BLeeEZ/amperfy](https://github.com/BLeeEZ/amperfy)

**Immich**
- The docs warn: "Never forward port 2283 directly to the internet without additional configuration." Three options are listed:
  - **VPN (WireGuard/OpenVPN):** needs DDNS and an open port.
  - **Tailscale:** peer-to-peer WireGuard that works behind NAT with no open port, "protected against Immich zero-day vulnerabilities." Cons: the client runs as root, and it is a paid service with a free personal tier.
  - **Reverse proxy:** Nginx plus Let's Encrypt, optionally Cloudflare to hide the IP and Cloudflare Access to restrict the web UI. Cons: complex, and the API is exposed.

  — [Immich Docs: Remote Access](https://docs.immich.app/guides/remote-access/)
- Automatic URL switching (mobile app v1.122.0) works as follows:
  - On a configured home Wi-Fi SSID the app uses the local URL.
  - Elsewhere it tries the listed external URLs top to bottom and uses the first that responds.
  - Reading the SSID requires "always" precise-location permission. — [Linuxiac: Immich 1.122](https://linuxiac.com/immich-1-122-brings-hdr-video-support-in-the-mobile-app/); [Immich commit mirror](https://ark.sudovanilla.org/Infrastructure/immich/commit/055f1fc72fd1b3cecd00a5110e1f830a71a41945)
- Known bugs:
  - With multiple SSIDs, the app hangs 7–10 s on the splash screen before falling back, reported against v1.142.0 in September 2025. — [GitHub: immich #21930](https://github.com/immich-app/immich/issues/21930)
  - The iOS app tries the local URL away from home until restarted. — [GitHub: immich #15220](https://github.com/immich-app/immich/issues/15220)
  - External URLs aren't saved if they are unreachable when entered. — [GitHub: immich #16749](https://github.com/immich-app/immich/issues/16749)

**PhotoPrism**
- No official iOS app. The web UI is an installable PWA, and PhotoPrism recommends the third-party PhotoSync app over WebDAV, with SSL enabled. The docs warn that WebDAV outside the private network must use HTTPS, or the password is sent "in clear text, over the Internet." — [PhotoPrism Docs: Mobile devices](https://docs.photoprism.app/user-guide/sync/mobile-devices/); [PhotoPrism Docs: WebDAV](https://docs.photoprism.app/user-guide/sync/webdav/)
- PhotoSync can back up to PhotoPrism and view and download from it. — [PhotoSync 4.5 release notes](https://www.photosync-app.com/support/release-notes/photosync-4-5-for-ios-released)

### Inferences
- Immich's endpoint list is the most directly reusable mobile pattern. Avoid its SSID dependency: an iOS app needs location permission to read the SSID. A better approach:
  1. Probe all known endpoints in parallel (LAN mDNS or IP, Tailscale 100.x or MagicDNS, public or tunnel URL) against a cheap `/health` endpoint that returns the server's identity.
  2. Pick the fastest responder whose identity matches the paired computer ID.
  3. Re-probe on network change, using Network.framework path updates.

  This avoids both the SSID permission and the hang-on-timeout bugs.
- Each endpoint should prove which computer it is, for example by signing the health response or pinning the certificate. A LAN IP can belong to a different machine on a different Wi-Fi.
- Subsonic's success shows the value of a small, documented HTTP API: many independent iOS clients exist because the protocol is stable. If the Pager exposes OPDS 1.2/2.0 alongside its own API, existing iOS OPDS readers (Panels, Chunky, KyBook, Yomu) could connect for free.

### Gaps
- play:Sub and substreamer offline and auth details were not retrieved.
- Navidrome's native API-key support status was not confirmed from Navidrome docs; only the OpenSubsonic extension via a client library.
- Immich's current official mobile networking doc page was not found, and fixes for the bugs above were not confirmed.

## Q5. Vendor-run broker/relay vs. self-configured networking: who does what, costs, and privacy trade-offs

### Takeaway
Only Plex runs a full broker plus relay. Emby runs a lookup-only broker. Every other project (Jellyfin, ABS, Kavita, Komga, calibre, CWA, Stump, BookLore, Navidrome, Immich, PhotoPrism, kosync) requires the user to set up networking. The community fills the gap with third-party overlays: Tailscale (vendor coordination, end-to-end-encrypted relays, client app on each device) or Cloudflare Tunnel (no client app, but Cloudflare terminates TLS and sees plaintext). Plex shows the long-run cost of a vendor relay: bandwidth bills become a reason to paywall remote access, and the central account becomes a breach target.

### Cited Findings

**Spectrum of approaches**
- **Plex (account broker + certificates + relay):** a plex.tv account is required for Remote Access. — [Plex Support: Remote Access](https://support.plex.tv/articles/200289506-remote-access/)
  - plex.tv lists servers and connections, and the per-server certificates are issued via DigiCert. — [Filippo Valsorda](https://words.filippo.io/how-plex-is-doing-https-for-all-its-users/)
  - Relay is the fallback, and Plex cites relay bandwidth cost as the reason for the remote paywall. — [Android Authority, May 2026](https://www.androidauthority.com/plex-remote-streaming-free-3663446/)
- **Emby Connect (lookup only):** "all connections are direct," and remote access must already work. — [Emby Support: Emby Connect](https://emby.media/support/articles/Emby-Connect.html)
- **Jellyfin (no broker):** the user must expose the server themselves. — [Jellyfin Docs: Networking](https://jellyfin.org/docs/general/post-install/networking/)
- **Immich (no broker):** recommends VPN, Tailscale, or a reverse proxy. — [Immich Docs: Remote Access](https://docs.immich.app/guides/remote-access/)

**Tailscale (third-party overlay)**
- Both Tailscale and Cloudflare Tunnel work behind CGNAT because both connect outbound. Tailscale falls back to relays when a direct path fails, and relayed traffic stays end-to-end encrypted. — [needtoknowit: Tailscale vs Cloudflare Tunnel (2026)](https://needtoknowit.com.au/blog/tailscale-vs-cloudflare-tunnels-for-remote-access/); [datahoarder.io](https://datahoarder.io/tailscale-vs-cloudflare-tunnels/)
- iOS and Android allow only one active VPN at a time. On iOS/macOS only one VPN app can have On Demand enabled, and connecting another VPN disables On Demand for Tailscale. — [Tailscale KB: Can I use Tailscale alongside other VPNs?](https://tailscale.com/kb/1105/other-vpns); [Tailscale KB: VPN On Demand for iOS](https://tailscale.com/kb/1291/ios-vpn-on-demand)
- The free Personal plan lists up to 6 users with unlimited user devices, for non-commercial use (from search snippet; page not fetched directly). A third-party newsletter says the free tier "just doubled" in 2026. — [Tailscale pricing](https://tailscale.com/pricing/); [Tailscale pricing FAQ](https://tailscale.com/kb/1251/pricing-faq); [ITSG newsletter](https://thisisanitsupportgroup.beehiiv.com/p/tailscale-s-free-tier-just-doubled-if-you-ve-been-putting-it-off-today-s-the-morning)

**Cloudflare Tunnel**
- Free, but HTTP/HTTPS only, and Cloudflare terminates TLS at its edge. Cloudflare's own docs say it must decrypt traffic to cache and filter it. — [GetPublicIP comparison](https://getpublicip.com/guides/self-hosting/getpublicip-vs-cloudflare-tunnel-vs-tailscale); [needtoknowit](https://needtoknowit.com.au/blog/tailscale-vs-cloudflare-tunnels-for-remote-access/)
- Video streaming through Cloudflare's CDN/Tunnel is a terms-of-service grey area. Service-specific terms steer video and large files to paid products (Stream, R2), and enforcement reportedly targets large public sites. Sources are a blog and community threads; Cloudflare's terms were not fetched. — [Lumadock: Cloudflare Tunnel + Jellyfin](https://lumadock.com/tutorials/cloudflare-tunnel-jellyfin); [Lemmy thread](https://lemmy.4d2.org/post/606742); [Jellyfin Forum](https://forum.jellyfin.org/printthread.php?tid=60)
- Pangolin is a self-hosted Cloudflare-Tunnel-style alternative: an outbound tunnel to a relay server the user controls. — [needtoknowit](https://needtoknowit.com.au/blog/tailscale-vs-cloudflare-tunnels-for-remote-access/)

**Privacy and security incidents in the broker model**
- Plex's September 2025 breach exposed emails, usernames, hashed passwords, and authentication data. — [TechCrunch](https://techcrunch.com/2025/09/09/plex-urges-users-to-change-passwords-after-data-breach/)
- At the same time, Plex warned of a remotely exploitable PMS vulnerability, CVE-2025-34158, fixed in 1.42.1. — [Help Net Security](https://www.helpnetsecurity.com/2025/09/09/plex-tells-users-to-change-passwords-due-to-data-breach-pushes-server-owners-to-upgrade/)

### Inferences
Cost and privacy comparison for the user's Pager:

| Approach | Developer effort | Vendor cost | Who sees traffic | Who must install what |
|---|---|---|---|---|
| Plex-style (own broker + relay + certificates) | Very high | Ongoing bandwidth and certificate cost | You, the vendor, see relayed traffic unless it is end-to-end encrypted | Nothing extra for the user |
| Emby-style lookup broker | Low (a tiny ID-to-URL registry) | Negligible | Nobody | The user still needs a reachable path |
| Tailscale | Near zero | Free personal tier | End-to-end encrypted | Tailscale on the Fedora PC and the iPhone; conflicts with other VPNs on iOS |
| Cloudflare Tunnel | Low | Free | Cloudflare sees plaintext | Nothing on the phone; needs a domain |
| Port forward + DDNS + Let's Encrypt | Medium | Free | Nobody | Fails behind CGNAT; exposes the server to scans |

- Books are small (KB–MB), unlike video, so relay bandwidth and Cloudflare's video ToS concerns largely don't apply. A Plex-like relay for a few-MB EPUB plus JSON sync is cheap. This argues that a self-run or embedded relay option, such as Pangolin or a small VPS, is viable for books where it is unaffordable for Plex video.
- Plex's 2025–2026 history is a cautionary tale for any vendor-brokered design. Once remote access depends on the vendor, the vendor can meter it. A design where the iPhone talks directly to the user's computer over any of several user-controlled paths avoids that lock-in.
- A pragmatic hybrid for "permanent remote access":
  1. Pairing on the LAN (QR code with computer ID, LAN URLs, a one-time secret, and a certificate fingerprint).
  2. The desktop advertises all of its reachable URLs (LAN, Tailscale MagicDNS if Tailscale is installed, optional tunnel URL) to the phone.
  3. The phone keeps that list and probes it.
  4. Optional later: a tiny lookup service like Emby Connect for when the URLs change.

### Gaps
- Tailscale's iOS behavior with MagicDNS and HTTPS certificates (`tailscale cert`) was not researched here.
- Cloudflare's current ToS text was not fetched.
- No measured relay costs for any project were found.

## Q6. User complaints about remote-access setup (Reddit/forums/GitHub) and the solutions people converge on

### Takeaway
The recurring pain points are:
- CGNAT or double NAT breaking port forwarding (Plex Relay and its caps, or nothing at all for Jellyfin and others)
- reverse-proxy, certificate, and CORS/WebSocket misconfiguration
- family members who won't install a VPN app
- mobile apps choosing the wrong URL when switching networks
- Plex's paywall

The community has converged on Tailscale for personal-device access (especially behind CGNAT), plus a reverse proxy or Cloudflare Tunnel with an access policy for people who can't install anything. Direct port forwarding without a proxy is consistently discouraged.

### Cited Findings
- **CGNAT pushes users from Plex Relay to Tailscale:** a 2026 Plex forum user behind CGNAT relied on Relay, hit outages, and fell back to Tailscale. — [Plex Forum: Plex Relay is Broken](https://forums.plex.tv/t/plex-relay-is-broken/937329)
- **The Plex paywall pushes users to Tailscale:**
  - Firecore tells Infuse users to use Tailscale or a VPN instead of Plex Remote Access. — [Firecore, Sept 2026](https://community.firecore.com/t/changes-to-plex-remote-streaming-requirements/60825)
  - Android Authority gives a Tailscale recipe (add 100.64.0.0/10 as a LAN network, manual connection to `100.x.x.x:32400`). — [Android Authority, May 2026](https://www.androidauthority.com/plex-remote-streaming-free-3663446/)
- **Jellyfin plus Tailscale:**
  - Tailscale "is a good solution if all the devices you watch on remotely can install the Tailscale client." Devices that can't install it (e.g. a Roku at a friend's house) need a reverse proxy with certificates. — [Jellyfin Forum](https://forum.jellyfin.org/printthread.php?tid=2775)
  - An iPhone user was surprised to have to enable Jellyfin's remote-connections setting to reach it over the Tailscale 100.x address. — [feddit.it thread](https://feddit.it/post/2345301/2939349)
  - In a September 2025 thread, a user still couldn't connect remotely via Tailscale after allowing remote connections. — [Jellyfin Forum: can't remote connect using tailscale](https://forum.jellyfin.org/t-can-t-remote-connect-using-tailscale)
- **Wrong URL on network change:** the Immich iOS app uses the local URL away from home, or hangs 7–10 s with multiple SSIDs. — [GitHub: immich #15220](https://github.com/immich-app/immich/issues/15220); [GitHub: immich #21930](https://github.com/immich-app/immich/issues/21930)
- **Reverse-proxy breakage:**
  - Audiobookshelf says CORS headers on the proxy break app login, and WebSocket upgrade headers are required. — [GitHub: audiobookshelf README](https://github.com/advplyr/audiobookshelf)
  - CWA needs `TRUSTED_PROXY_COUNT` behind Cloudflare Tunnel or a proxy to avoid session-protection warnings. — [GitHub: CWA](https://github.com/crocodilestick/Calibre-Web-Automated)
  - Jellyfin requires "known proxies" for proxied remote access. — [Jellyfin Docs: Networking](https://jellyfin.org/docs/general/post-install/networking/)
- **Cloudflare Access breaks native apps:** Cloudflare redirects unauthenticated requests to an identity provider, which native apps can't follow. Users asked ABS for custom service-token headers in the app. — [GitHub: audiobookshelf-app #254](https://github.com/advplyr/audiobookshelf-app/issues/254)
- **iOS requires HTTPS remotely:** per Kavita's wiki, remote access from iOS apps requires a reverse proxy with SSL. — [Kavita Wiki: Komic](https://wiki.kavitareader.com/guides/3rdparty/komic/)
- **Converged pattern in 2026 write-ups:** Tailscale for reaching your own devices, Cloudflare Tunnel plus an Access policy for apps used by others who can't install software, with admin surfaces kept tailnet-only. Pangolin is cited for self-hosted control. — [techfuelhq: Tailscale vs Cloudflare Tunnel (2026)](https://techfuelhq.com/networking/tailscale-vs-cloudflare-tunnel-2026/); [needtoknowit (2026)](https://needtoknowit.com.au/blog/tailscale-vs-cloudflare-tunnels-for-remote-access/); [Fraser McLean](https://frasermclean.com/posts/remotely-accessing-self-hosted-applications)
- **Don't expose ports directly:** Immich ("Never forward port 2283 directly...") and Jellyfin ("not recommended!") both warn against bare port forwarding. — [Immich Docs](https://docs.immich.app/guides/remote-access/); [Jellyfin Docs](https://jellyfin.org/docs/general/post-install/networking/)
- **App churn:** clients have broken or disappeared over time:
  - Calibre Companion broke with calibre 5 — [MobileRead](https://www.mobileread.com/forums/showthread.php?p=4043150)
  - Marvin vanished from the App Store — [MobileRead](https://www.mobileread.com/forums/showthread.php?p=4321579)
  - Kuboo for Ubooquity "died" — [MobileRead](https://www.mobileread.com/forums/showthread.php?p=4597787)
  - Readarr was archived — [GitHub: Readarr](https://github.com/Readarr/Readarr)

### Inferences
- For a single-owner Pager, the target user is mostly the owner on their own iPhone, so Tailscale's main drawback (every device needs the client) barely applies. Tailscale is the lowest-effort way to get "permanent remote access from anywhere, even behind CGNAT" without building a relay. The app can detect a Tailscale address or MagicDNS name on the desktop and include it in the pairing payload.
- The iOS one-VPN limit is real: a user on a corporate VPN or a privacy VPN loses Tailscale. An optional second path, such as a Cloudflare Tunnel or Pangolin URL with a device-token header (native apps can't do Cloudflare Access's browser redirect), covers that case.
- Build URL selection into the app from day one: parallel probing, identity check, fallback order, and re-probing on network change. Wrong-URL bugs are the most common mobile complaint after setup itself.
- Ship a strong default so the user never needs a reverse proxy:
  - The Hono server issues itself a certificate (self-signed, pinned at pairing by fingerprint) for LAN/Tailscale use.
  - Optionally, a real certificate via the Tailscale or tunnel provider.
  - Pinning the fingerprint exchanged in the QR code sidesteps both "self-signed strongly discouraged" (a browser concern) and iOS ATS, but only for the native app with custom trust evaluation. That needs verification in iOS-specific research.
- Every successful client keeps working offline from a local copy and syncs later. Server-side change events (the Pager's live event stream) should be replayable by cursor or sequence number, so a phone that was offline can catch up instead of missing events. None of the researched projects documents this well. ABS uses socket.io for live events plus explicit local-session sync on reconnect.

### Gaps
- Direct Reddit threads (r/selfhosted, r/Plex, r/jellyfin, r/Calibre) did not appear in search results. The complaint themes above come from project forums, Lemmy/feddit mirrors, GitHub issues, and 2026 blog comparisons, which likely reflect but do not quote Reddit consensus.
- No Hacker News threads were retrieved.
- No quantitative data (e.g. the share of users behind CGNAT) was found.
