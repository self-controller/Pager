# File-Access Protocols, Ebook Catalog Standards, and Sync Strategies for an iPhone Companion to a Desktop Pager (as of October 2026)

Context: the user's desktop "Pager" is a Node 22 + Hono HTTP server with SQLite (port 3006) and a React/Vite frontend on Fedora Linux. It serves EPUB/DOCX/Markdown/HTML, keeps highlights and notes anchored to text (re-anchored when files change), tracks reading progress, and has a live server event stream. These notes cover (1) OPDS catalogs and which iOS apps consume them, (2) file protocols (WebDAV/SMB/SFTP) and the iOS Files app, (3) existing progress/annotation sync protocols, (4) offline-first architecture (mirror vs. stream, conflicts, CRDTs, local-first), (5) drop-in sync engines, and (6) third-party cloud storage as a transport.

## Q1. OPDS 1.2 / OPDS 2.0 catalogs (PSE, Authentication, Progression): spec details, iOS app support in 2026, and how to add a feed to the Node server

### Takeaway
OPDS is the lowest-effort way to get books from the desktop onto an iPhone without writing an app. Serve an OPDS 1.2 (Atom XML) feed for the widest client support, add OPDS 2.0 (JSON) alongside it if you like, and protect both with HTTP Basic auth. In Oct 2026 the strongest actively maintained iOS client is **Readest** (free, open source, OPDS + OPDS-PSE + KOReader sync + WebDAV), followed by **Panels** for comics, **Yomu**, **PocketBook**, and newer entrants **CaliMob** and **EverReed**. **KyBook 3** has not been updated since 2019. **Marvin 3** breaks for many users on iOS 26. **KOReader** has no official iOS app. Only a few clients (Cantook/Aldiko, ComicVerse) use the draft OPDS Progression API to sync progress back to the server.

### Cited Findings

**Spec status and structure**
- OPDS 2.0 is the "Living Standard". Earlier releases: OPDS 1.2 (Nov 11, 2018), 1.1 (Jun 27, 2011), 1.0 (Aug 30, 2010) — [specs.opds.io](https://specs.opds.io/)
- OPDS 2.0 builds on the Readium Web Publication Manifest model, where everything is a collection with `metadata` and `links`. Its media types are `application/opds+json` (feeds) and `application/opds-publication+json` (publications). Top-level roles are `navigation`, `publications`, `groups`, `facets` and `images`. Acquisition rels are `acquisition`, `borrow`, `buy`, `download` (open access), `preview` and `subscribe`. Search uses a `rel: "search"` URI template with a required `query` parameter. Pagination uses `numberOfItems`/`itemsPerPage`/`currentPage` plus `first`/`previous`/`next`/`last` links. The core has been "stable since 2017"; editor is Hadrien Gardeur — [OPDS 2.0 spec](https://specs.opds.io/opds-2.0.html)
- The active OPDS drafts are Authentication 1.0, **Progression 1.0**, ODL 1.0 and User Profile 1.0 — [drafts.opds.io](https://drafts.opds.io/)
- **Authentication for OPDS 1.0**: the server returns HTTP 401 with an Authentication Document (`application/opds-authentication+json`) as the body, or points to one via a `Link` header with `rel="http://opds-spec.org/auth/document"`. The document itself must not require auth. Supported types are Basic (`http://opds-spec.org/auth/basic`, which the spec calls the weakest and says to minimize), OAuth implicit (`.../auth/oauth/implicit`, callback `opds://authorize/`) and OAuth password grant (`.../auth/oauth/password`). Optional links are `authenticate`, `refresh`, `logo`, `register` and `help` — [Authentication for OPDS 1.0](https://drafts.opds.io/authentication-for-opds-1.0.html)
- **OPDS Progression 1.0 (draft)**:
  - Advertised by a link with `rel="http://opds-spec.org/progression"` and type `application/opds-progression+json`. Works in OPDS 1.x and 2.0 feeds.
  - GET returns the last-known position. PUT sends the client's position, and the server decides whether to accept it (200/201). Errors are 400 (invalid), 403 (wrong user or locked) and **409 (a more recent progression already exists)**.
  - Document fields: `modified` (ISO 8601, required), `device` {`id` URI, `name`} (required), `progression` (float 0–1, required), `title` (optional), and `references` (optional array of URI refs such as text fragments that refine the position).
  - If the server's copy is newer, the client should ask the user before jumping.
  - No publication date is given — [OPDS Progression 1.0](https://drafts.opds.io/opds-progression-1.0.html)
- **OPDS-PSE 1.2** (Page Streaming Extension, unofficial, published Mar 5, 2023):
  - Lets a client request one page image at a time instead of the whole file. Designed for comics.
  - Namespace `http://vaemendis.net/opds-pse/ns`; link rel `http://vaemendis.net/opds-pse/stream`.
  - Required: `type` (image/jpeg, gif or png), `pse:count`, and an `href` template with `{pageNumber}` (optionally `{maxWidth}`).
  - Optional `pse:lastRead` and `pse:lastReadDate` give primitive progress. Pages are numbered 0..N-1, and the server must not split images — [OPDS-PSE 1.2](https://anansi-project.github.io/docs/opds-pse/specs/v1.2)
- Forum users argue that PSE "is at best a stopgap solution for syncing progress" because EPUB has no fixed pages (opinion) — [Komga/Readium search summary, discuss.mschae23.de](https://discuss.mschae23.de/comment/109042)

**iOS app support (status as of 2026)**
- **Readest** (Bilingify LLC; free with Plus/Pro subscriptions; iOS 16.4+):
  - Lists OPDS catalogs "including OPDS-PSE streaming", Calibre/Calibre-Web, and KOReader progress sync.
  - Sync goes through Readest Cloud or your own iCloud, Google Drive, OneDrive, WebDAV or S3 storage.
  - Has highlights, notes, export and Audiobookshelf support.
  - Version 0.12.16 notes include "Sync fixes for KOReader, WebDAV". The listing shows conflicting dates for this version (Oct 14 vs. a copy labeled 0.9.92 11/18/2025) — [App Store](https://apps.apple.com/us/app/id6738622779)
- Readest is AGPL-3.0, built on Next.js 16 + Tauri v2, and is a rewrite of Foliate on foliate-js. It runs on iOS/iPadOS (App Store + TestFlight), Android, macOS, Windows, Linux and web — [GitHub readest/readest](https://github.com/readest/readest)
- Readest's own comparison page (verified Aug 28, 2026, against v0.12.1):
  - Official KOSync tracks **progress only**. Readest's KOReader plugin can also move files, bookmarks, highlights, notes and stats.
  - OPDS catalogs and credentials sync across devices.
  - Which storage backends you get depends on plan and platform — [readest.com compare](https://readest.com/compare/readest-vs-koreader)
- **Marvin 3**: no official discontinuation notice found. MobileRead users report it broke on iOS 26/26.2, with a white screen on iMazing-restored installs, while some App Store installs still work on iOS 26.3/26.4 beta (posts Dec 2025–Mar 2026). Users are moving to BookFusion, Readest and Yomu — [MobileRead thread](https://www.mobileread.com/forums/showthread.php?p=4570649); [MobileRead](https://www.mobileread.com/forums/showthread.php?p=4556679)
- **KyBook 3**: still listed and still advertises OPDS (incl. custom catalogs such as a Calibre content server, and .onion catalogs), SMB/CIFS and WebDAV sources. However, the **latest version is v0.7.8 from 02/23/2019**; a 2022 reviewer notes no updates in years. Sync requires a subscription. Minimum iOS 11 — [App Store KyBook 3](https://apps.apple.com/app/id1348198785)
- **KOReader**: no official App Store app. An unofficial fork, hezi/koreader-ios, can be sideloaded via Xcode; a free Apple ID cert lasts 7 days — [GitHub hezi/koreader-ios](https://github.com/hezi/koreader-ios); [Lemmy thread](https://lemmy.world/post/37897587/20163542)
- **Komga's OPDS compatibility table** for iOS:
  - OPDS v2: Cantook by Aldiko (progress sync yes, covers buggy), TritonPanels, ComicVerse (sync + streaming).
  - OPDS v1.2: ComicVerse (PSE 1.2), JustRead, KyBook 3, Longbox (PSE 1.0), Panels (PSE 1.0 from v2.8.0, PSE 1.1 from v2.9.7, OpenSearch from v3.0.0), TritonPanels.
  - **Chunky Comic Reader doesn't work with Komga 1.4.0+**.
  - Komga serves `/opds/v1.2/catalog` and `/opds/v2/catalog` — [Komga OPDS guide](https://komga.org/docs/guides/opds/)
- **Panels** (comics) appears active. It advertises OPDS streaming, search and download from Komga, Kavita and Codex, and recent notes include iOS 26 fixes. **Chunky** reviews say it has not been updated in years (likely abandoned) — [Panels App Store](https://apps.apple.com/app/id1236567663); [Chunky listing tracker](https://mwm.ai/es/apps/chunky-comic-reader/663567628)
- **Yomu**: imports from OPDS and Calibre plus iCloud Drive, Dropbox and Google Drive. The Pro "Cloud Library" syncs books and annotations via iCloud (same Apple ID) — [App Store Yomu](https://apps.apple.com/us/app/yomu-ebook-reader/id562211012)
- **PocketBook Reader** (iOS) supports OPDS catalogs. The free PocketBook Cloud syncs books, positions, notes and bookmarks — [App Store PocketBook](https://apps.apple.com/app/id805488884)
- **BookFusion**: syncs via its cloud plus a Calibre plugin that keeps progress, highlights and bookmarks in sync. OPDS support was **not confirmed** — [BookFusion Calibre docs](https://docs.bookfusion.com/docs/Calibre/); [App Store BookFusion](https://apps.apple.com/app/id1141834096)
- **Thorium Reader (EDRLab)** has an iOS App Store listing (iOS 26.0+; EPUB/PDF/CBZ; Readium LCP). The listing does not mention OPDS, although desktop Thorium supports OPDS 1 and 2 with authentication — [App Store Thorium](https://apps.apple.com/app/id6745025189); [EDRLab Thorium](https://www.edrlab.org/software/thorium-reader/); [W3C list, Feb 2026](https://lists.w3.org/Archives/Public/public-pm-wg/2026Feb/0019.html)
- **CaliMob** (free, iOS/Android) is an OPDS client for Calibre, Calibre-Web, Komga and Kavita. It supports Basic auth and cloud-folder Calibre libraries (Drive, Dropbox, OneDrive, WebDAV, FTP/SFTP). Its page does not mention progress sync — [CaliMob OPDS page](https://caliwebapp.com/en/opds-reader)
- **EverReed** is another iOS/Android OPDS reader (EPUB/KEPUB, PDF, MOBI/AZW3, CBZ/CBR) — [EverReed](https://everreed.app/opds-reader)
- **Komga** exposes the OPDS Progression API: 1.9.0 added the Readium Progression and Positions APIs, and 1.11.0 made Progression "discoverable, used by Aldiko/Cantook" and added OPDS authentication — [Komga 1.9.0](https://newreleases.io/project/github/gotson/komga/release/1.9.0); [Komga 1.11.0](https://newreleases.io/project/github/gotson/komga/release/1.11.0); [Komga WebPub Manifest API](https://komga.org/docs/openapi/web-pub-manifest)

### Inferences
- **Adding OPDS to the Hono server** (based on the specs above):
  1. Add `GET /opds` (OPDS 1.2 Atom, `application/atom+xml;profile=opds-catalog`) and/or `GET /opds/v2` (`application/opds+json`) routes that list books from the existing SQLite library.
  2. Give each entry an acquisition link (`http://opds-spec.org/acquisition` in 1.2, `download` in 2.0) pointing at the existing file-serving route, plus a cover `image` link and a search URI template.
  3. Use HTTP Basic auth, because every iOS client surveyed supports it; serve over HTTPS when the server is reachable remotely.
  4. Optionally add an OPDS Progression link per publication so Cantook/ComicVerse-class clients can write progress back. Map its `progression` float and `modified` timestamp onto the Pager's existing progress table.
  5. DOCX/Markdown/HTML are not formats OPDS clients read. Convert them to EPUB on the fly (or serve HTML) for those entries.
- Generating OPDS by hand is simple: it is just Atom XML or JSON templates. No mature Node OPDS *server* library turned up in this research, so plan on templates.
- Even with OPDS, highlights stay inside the third-party app. None of the iOS OPDS clients found would push the Pager's highlights back to the server. OPDS solves file access, plus progress at best, not annotation sync.

### Gaps
- No primary-source list of Marvin 3's last App Store update date; status rests on forum reports.
- Could not confirm whether Thorium iOS, BookFusion or Aldiko's current iOS app support OPDS (Cantook by Aldiko appears in Komga's table, but its current iOS availability was not verified).
- No authoritative per-app list of which iOS clients implement Authentication for OPDS (beyond Basic) or the OPDS Progression draft, apart from Komga's notes on Cantook.
- Did not find a maintained Node/TypeScript library for *generating* OPDS feeds.

## Q2. WebDAV, SMB and SFTP: iOS Files app support, third-party apps, limits over the internet, and Node WebDAV server libraries

### Takeaway
The iOS Files app's "Connect to Server" speaks **SMB only (SMB 2.0+)**. It cannot mount WebDAV, so WebDAV requires a third-party app: Readest, KyBook 3, Documents by Readdle, Owlfiles (formerly FE File Explorer), or a custom app. SMB over the open internet is not advisable; the documented remote path is a VPN/overlay such as Tailscale. For a custom app, the native way to expose desktop books inside Files with offline copies is a **File Provider extension** (`NSFileProviderReplicatedExtension`, iOS 16+). On the Node side, **Nephele** (Apache-2.0, RFC 4918) is the maintained WebDAV server framework; `webdav-server` (OpenMarshal) looks stale.

### Cited Findings
- The Files app has supported SMB server connections since iOS 13. It requires SMB enabled on the server, version 2.0 or higher — [TechRepublic](https://www.techrepublic.com/article/how-to-use-the-files-app-to-connect-to-a-network-server-from-your-iphone-or-ipad/); [9to5Mac (iOS 13 beta 2 SMB)](https://9to5mac.com/2019/06/17/ios-13-beta-2-enables-smb-server-connectivity-in-the-files-app/)
- Community reports agree the Files app does not support WebDAV:
  - A cPanel moderator "confirmed the 'Files' app does not seem to support the protocols necessary for webdav" — [cPanel community](https://support.cpanel.net/hc/en-us/community/posts/19148826919575-Accessing-Web-Disk-on-IOS)
  - A Keenetic user reports Files says a WebDAV "URL is not supported" — [Keenetic forum](https://forum.keenetic.ru/topic/18995-webdav-connection-fails-with-ios/)
  - Cryptomator docs describe the Files network option as SMB-only — [Cryptomator docs](https://docs.cryptomator.org/ios/cloud-management/)
  - No official Apple statement was found.
- Remote access over Tailscale: in Files > Connect to Server, enter the Mac's Tailscale IP to browse its shares over SMB (doc validated Feb 2026) — [Tailscale docs](https://tailscale.com/docs/reference/troubleshooting/apple/cant-access-macos-from-iphone). A user on cellular + Tailscale reported "Socket is not connected" errors (anecdotal) — [Unraid forum](https://forums.unraid.net/profile/276934-dfishocc/content/). ZeroTier IPs could not be added in Files (anecdotal) — [ZeroTier forum](https://discuss.zerotier.com/t/is-it-possible-to-see-a-zt-member-in-the-ios-files-app/28262)
- Third-party WebDAV/SFTP clients on iOS:
  - **Owlfiles** (App Store ID formerly "FE File Explorer") accesses NFS, WebDAV, FTP and SFTP — [App Store Owlfiles](https://apps.apple.com/app/fe-file-explorer-file-manager/id510282524)
  - **Documents by Readdle** has WebDAV transfer docs — [Readdle support](https://support.readdle.com/documents/transfer-share-your-files/transfer-files-to-another-ios-device-with-webdav)
  - **KyBook 3** reads from SMB/CIFS and WebDAV with "transparent caching" — [App Store KyBook 3](https://apps.apple.com/app/id1348198785)
  - **Readest** can use WebDAV as a sync backend — [App Store Readest](https://apps.apple.com/us/app/id6738622779)
- **File Provider**: `NSFileProviderReplicatedExtension` (macOS 11+, iOS 16+) lets the system manage local copies while your sync logic moves changes both ways. The older non-replicated `NSFileProviderExtension` dates from iOS 11. You must implement `NSFileProviderEnumerating` — [Apple: Replicated File Provider extension](https://developer.apple.com/documentation/fileprovider/replicated-file-provider-extension); [Apple FileProvider](https://developer.apple.com/documentation/fileprovider)
- Blink Shell ships a replicated File Provider over SFTP with offline support, a working real-world example of "remote server in Files" — [Blink docs](https://docs.blink.sh/advanced/files-app)
- Developers have reported confusing placeholder and callback behavior with the non-replicated File Provider — [Apple dev forums](https://origin-devforums.apple.com/forums/profile/jbehrens94)
- **Nephele**: pluggable WebDAV server for Node.js/Express (TypeScript, Apache-2.0). It "fully implements RFC 4918" and is still described as a work in progress. `nephele-serve` and a Docker image serve a local filesystem or S3 with no code. Commits continue into 2026 — [npm nephele](https://npmjs.com/package/nephele); [SciActive Forge](https://forge.sciactive.com/sciactive/nephele); [SciActive blog](https://sciactive.com/2022/09/03/instant-webdav-server-with-nephele/)
- **webdav-server** (OpenMarshal, v2.x): repo last pushed 2023-12-03, so maintenance is unclear — [ecosyste.ms](https://awesome.ecosyste.ms/projects/github.com%2FOpenMarshal%2Fnpm-WebDAV-Server); [npm webdav-server](https://www.npmjs.org/package/webdav-server)

### Inferences
- **WebDAV option**: mount Nephele next to Hono (it is Express-based, so on its own port or path behind a reverse proxy), read-only over the books directory. Readest or KyBook 3 can then read the library directly. Upside: almost no new code. Downside: highlights and progress stay in those apps.
- **SMB option**: Samba on Fedora + Tailscale lets the stock Files app browse the books with no custom code. But Files' SMB browsing is an online view, not a persistent offline mirror. This research found no source on Files offline-caching SMB items, so that is a gap. SMB also does nothing for annotations.
- **SFTP option**: useful only with third-party apps (Owlfiles, or Blink as a model). It adds nothing over WebDAV for a reader workflow.
- **Custom app**: a replicated File Provider is the "proper" way to make the desktop library appear under Files with persistent local copies. It is substantial work, and a reader app can manage its own sandboxed mirror without it.

### Gaps
- No Apple primary documentation found explicitly stating Files supports SMB only, or describing Files' offline behavior for SMB items.
- No sourced data on ISP blocking of TCP 445 or on SMB performance over high-latency links (well known, but not verified in this research).
- Nephele's compatibility with Hono (as opposed to Express) was not verified.

## Q3. Reading-progress and annotation sync protocols in the wild (kosync, Readest, Moon+, Calibre, Kavita/Komga, Audiobookshelf, Readwise, Apple Books, Readium Locator, W3C Web Annotation)

### Takeaway
Existing *progress* sync protocols are tiny: kosync is a few REST endpoints keyed by an MD5 document hash with a position string plus percentage, and OPDS Progression is GET/PUT of a `progression` float plus timestamp. *Annotation* sync has no interoperable wire protocol in the ebook world; every app uses its own cloud. The best portable data models are the **Readium Locator** (href + progression/totalProgression/position + `text.before/highlight/after`) and **W3C Web Annotation selectors** (TextQuoteSelector + TextPositionSelector), and these match the Pager's existing text-anchored, re-anchoring design. Implementing a kosync-compatible endpoint on the Node server would give progress sync with Readest (iOS) and KOReader devices for free.

### Cited Findings

**kosync (KOReader)**
- Official server: Docker image `koreader/kosync:latest`, header `Accept: application/vnd.koreader.v1+json`. Auth uses `x-auth-user` and `x-auth-key` (an MD5 of the password). Endpoints include `/healthcheck`, `GET /users/auth`, `PUT /users/password` and `DELETE /users/me`. The server keeps "the furthest reading progress for each document", and each document is identified by a 32-hex MD5. The README points to a third-party "kosync-conformance" project as the observational spec — [koreader-sync-server](https://github.com/koreader/koreader-sync-server)
- crosspoint-sync works with stock KOReader by changing the URL. It uses "the same endpoints as sync.koreader.rocks" (`POST /users/create`, `GET /users/auth`, `PUT /syncs/progress`, `GET /syncs/progress/:document`), and the password field is the MD5 of the password. It stores progress **per device with newest-wins** to avoid the "ping-pong you get with stock kosync servers". It also adds delta sync for bookmarks and clippings with tombstones, and connectors to Hardcover, Audiobookshelf and Readwise Reader — [crosspoint-sync](https://github.com/crosspoint-reader/crosspoint-sync)
- The kosyncrs (Rust) schema stores document, progress string, percentage, device name, device ID and timestamp — [kosyncrs README](https://git.rustysoft.de/martin/kosyncrs/raw/tag/v2.2.0/README.md)
- kosync-dotnet must use MD5 password hashes because it reuses KOReader's user structure. Its records hold `documentHash`, `progress`, `percentage`, `device`, `deviceId` and `timestamp` — [kosync-dotnet](https://github.com/jberlyn/kosync-dotnet)
- KOReader's kosync plugin can match documents by **binary (partial MD5 of file content) or filename** (commit #7840) — [KOReader commit](https://git.blob42.xyz/Archives/koreader/commits/commit/5ac9463c09d4eafb1eb256e26d27beb9e3d1da7f/plugins/kosync.koplugin). Kavita devs say "Koreader uses the MD5 hash of the book (or filename as a secondary option)" — [Kavita PR #3025](https://github.com/Kareadita/Kavita/pull/3025)
- Readest's KOReader sync maps its CFI positions to KOReader XPointers, using percentage as the shared value — [search summary of Readest commit](https://git.gay/WattDownload/readest-epub-reader-cross-platform/src/branch/main/.prettierrc.json) (weak source; corroborated by [readest.com compare](https://readest.com/compare/readest-vs-koreader))

**Kavita / Komga**
- **Kavita** implements a KOReader sync endpoint at `/api/koreader/{API-KEY}/syncs/progress`. Its wiki warns "automatic sync can potentially undo reading progress. We strongly advise against using it". Users report 400/404 errors on v0.8.9.1 and v0.9.0 — [Kavita wiki KOReader](https://wiki.kavitareader.com/guides/3rdparty/koreader/); [Kavita issue #4518](https://github.com/Kareadita/Kavita/issues/4518); [Kavita issue #4676](https://github.com/Kareadita/Kavita/issues/4676)
- **Komga** supports KOReader Sync for users with the `KOREADER_SYNC` role. For regular EPUBs, progress is tracked only at chapter starts, so "mid-chapter read progress will be lost" when switching between Komga and KOReader. Komga also offers Readium Positions and Progression APIs (see Q1) — [Komga KOReader guide](https://komga.org/docs/guides/koreader)

**Other apps and services**
- **Moon+ Reader** (Android) syncs reading positions via Dropbox and Google Drive, and books via WebDAV (Nextcloud). One user reports WebDAV not syncing annotations back. No official source states it is Android-only, but every source is Android context — [MobileRead](https://www.mobileread.com/forums/showthread.php?p=4009047); [MobileRead 2017](https://www.mobileread.com/forums/showthread.php?p=3530712)
- **Calibre**: native annotations arrived in calibre 5.0. Highlights live in the `annotations` table (JSON `annot_data`), OPF and viewer config, and are merged by timestamp (forum description). 5.9.0 added Markdown export and Content server highlight export. A 2023 user reports desktop-to-server sync works but not the reverse — [MobileRead](https://www.mobileread.com/forums/showthread.php?p=4388980); [Neowin calibre 5.9.0](https://www.neowin.net/news/calibre-590); [calibre-viewer-annotation (archived)](https://github.com/whacked/calibre-viewer-annotation)
- **Audiobookshelf** API has Get, Create/Update, Batch Create/Update and "Sync Local Media Progress" endpoints. The MediaProgress object includes `progress`, `currentTime`, `isFinished`, `lastUpdate` (ms epoch), `startedAt` and `finishedAt` — [Audiobookshelf API](https://api.audiobookshelf.org/). Readest supports Audiobookshelf — [App Store Readest](https://apps.apple.com/us/app/id6738622779)
- **Readwise API**:
  - Auth: `Authorization: Token ...`.
  - `POST /api/v2/highlights/` accepts `text`, `title`, `author`, `source_url`, `source_type`, `category`, `location`/`location_type`, `highlighted_at` and `note`, and dedupes on title+author+text+source_url.
  - `GET /api/v2/export/` supports `updatedAfter` and `pageCursor` for incremental sync, so the API is two-way (read, update, delete).
  - Rate limits: 240 req/min, 20/min for LIST endpoints — [Readwise API](https://readwise.io/api_deets)
- **Apple Books**: no export feature or API. Highlights sit in local SQLite (`AEAnnotation`; metadata in `BKLibrary`) under the iBooksX container on macOS, and community tools read them directly. These are community sources; no Apple documentation exists — [DEV Community](https://dev.to/eristoddle/exporting-mac-osx-book-highlights-into-an-obsidian-vault-or-markdown-files-40lg); [mjtsai 2013](https://mjtsai.com/blog/2013/11/06/the-problem-with-ibooks/)

**Portable position and annotation models**
- **Readium Locator**:
  - Fields: `href` (resource, no fragment), `type`, optional `title`, `locations` {`fragments`[], `progression` 0–1 within the resource, `position` int, `totalProgression` 0–1}, and `text` {`before`, `highlight`, `after`}.
  - Uses: progress, bookmarks, highlights, search results and shareable references. It is extensible (HTML extension) — [Readium Locator model](https://github.com/readium/architecture/tree/master/models/locators)
- **W3C Web Annotation Data Model** (Recommendation, Feb 23, 2017):
  - JSON-LD with `body` and `target`.
  - Motivations include `highlighting`, `commenting`, `bookmarking` and `tagging`.
  - Selectors: TextQuoteSelector (`exact`/`prefix`/`suffix`), TextPositionSelector (`start`/`end`), FragmentSelector, CssSelector, XPathSelector, RangeSelector and `refinedBy`.
  - States (`TimeState`, `HttpRequestState`) pin a resource version.
  - Transport is defined separately by the Web Annotation Protocol — [W3C annotation-model](https://www.w3.org/TR/annotation-model/)
- **Hypothesis fuzzy anchoring**: re-attaches annotations by loosely matching stored prefix/suffix context (TextQuoteSelector). Matching runs faster when it starts near the stored position, so storing the original offset helps. Annotator's older DOM-range anchoring broke on small edits — [Hypothesis blog: Fuzzy Anchoring](https://web.hypothes.is/blog/fuzzy-anchoring/); [annotator-dev list](https://lists-archive.okfn.org/pipermail/annotator-dev/2017-September/006756.html)

### Inferences
- **Cheapest progress interoperability**: add kosync-compatible routes to Hono (`POST /users/create`, `GET /users/auth`, `PUT /syncs/progress`, `GET /syncs/progress/:document`) with `x-auth-user`/`x-auth-key`, keyed by KOReader's partial-MD5 document hash. Readest on iOS and any KOReader e-ink device could then push and pull progress to the desktop Pager. Store progress per device and resolve newest-wins (crosspoint-sync's fix). Keep a "furthest" view as a fallback, because Kavita's warnings show that naive auto-sync undoes progress.
- The Pager's anchors map naturally to Web Annotation: TextQuoteSelector with prefix/suffix, TextPositionSelector as a hint, and a content hash in a State or custom field to record the file version. Using that as the canonical on-disk and on-wire format keeps annotations exportable (e.g., to Readwise via its API) and survives file edits through fuzzy re-anchoring.
- For an iOS app built on Readium Swift Toolkit, the Locator's `text.before/highlight/after` is effectively a TextQuoteSelector. Converting between the two is direct.

### Gaps
- The exact KOReader partial-MD5 algorithm (which byte offsets are sampled) was not found in a primary source. Check KOReader's `frontend/util.lua` (`partialMD5`).
- The exact kosync JSON wire field names (`document`, `progress`, `percentage`, `device`, `device_id`, `timestamp`) are inferred from third-party implementations and were not seen in an official spec.
- Readest's own (non-KOReader) sync protocol and its backend (Supabase or otherwise), and whether it can be self-hosted, were not documented in the sources found.
- No source found for the Audiobookshelf ebook-specific progress fields (e.g., `ebookLocation`/`ebookProgress`); the API page was truncated.

## Q4. Offline-first architecture: mirror vs. stream, delta sync, content addressing, handling desktop edits, conflict resolution, CRDTs (JS + Swift), local-first patterns

### Takeaway
For "permanent, persistent, offline" access, **mirror** rather than stream:
- **Books**: keep the server as the source of truth, give each file a content hash, store files on the phone by hash, and sync a manifest (book ID to current hash) plus diffs of that manifest. Download in the background with `URLSession` background sessions.
- **Progress**: per-device last-writer-wins with timestamps is enough.
- **Annotations**: use an append-only operation log (or per-annotation LWW with tombstones) keyed by stable IDs. Each annotation records the content hash of the file version it was made against, so the phone or server re-anchors when the hash changes.
- **CRDTs** (Automerge has the most mature JS-server/Swift-client story) are optional. They pay off mainly for concurrently edited note *bodies*, not for highlights or progress.

### Cited Findings
- Ink & Switch, "Local-first software" (Kleppmann, Wiggins, van Hardenberg, McGranaghan, Apr 2019):
  - Seven ideals: fast, multi-device, offline, collaboration, longevity, privacy, user control.
  - CRDTs merge concurrent changes without a central server; conflicts only arise on the same property at the same time.
  - Servers should act as "cloud peers" for backup and forwarding, not as the source of truth.
  - Open challenges: history growth and networking — [Ink & Switch essay](https://www.inkandswitch.com/essay/local-first/)
- **Automerge**:
  - Built for JS and Rust with Swift, Python, C and Java ports — [automerge.org](https://automerge.org/)
  - Automerge 3.0 cut memory use "by over 10x" with the same file format as v2 and a nearly backward-compatible API — [Automerge 3.0 blog](https://automerge.org/blog/automerge-3/)
  - `automerge-swift` brings Automerge to iOS, macOS and Catalyst — [Swift Forums](https://forums.swift.org/t/introducing-automerge-enable-collaborative-asynchronous-syncing-for-your-data-structures/67985); [rhonabwy.com](https://rhonabwy.com/2023/10/21/automerge-for-swift/)
  - `automerge-repo-swift` ports JS automerge-repo and syncs peer-to-peer or **over WebSocket to a JS automerge-repo server**. Its API is "far from stable" (0.2.0, May 2024) — [Swift Forums: Automerge Repo Swift](https://forums.swift.org/t/automerge-repo-swift-edition/71467); [Swift Package Registry](https://swiftpackageregistry.com/automerge/automerge-repo-swift)
  - The MeetingNotes demo shows iOS/macOS sync — [GitHub MeetingNotes](https://github.com/automerge/MeetingNotes)
- **Loro**:
  - `loro-swift` is described as "experimental" Swift bindings, generated with UniFFI via the `loro-ffi` crate. Version 1.13.3 built for iOS (iOS 13+) with Swift 6.2/6.3 in July 2026 — [GitHub loro-swift](https://github.com/loro-dev/loro-swift); [lib.rs loro-ffi](https://lib.rs/crates/loro-ffi); [Swift Package Index builds](https://swiftpackageindex.com/builds/54C20297-7B5B-4B9C-845A-090F29D1EF4D)
- **Yjs**:
  - `yswift` (Swift over Yrs, the Rust port of Yjs) is a work in progress, and "not all features ... are exposed". It is built as a UniFFI XCFramework; v0.2.x added an undo manager — [GitHub yswift](https://github.com/y-crdt/yswift); [yswift releases](https://github.com/y-crdt/yswift/releases)
- **Syncthing BEP**, a block-level, hash-based delta transfer model to borrow from:
  - Each device shares a model of file metadata and block hashes, and peers request only missing or outdated blocks.
  - Blocks are power-of-two sizes from 128 KiB to 16 MiB, constant within a file — [Syncthing BEP v1](https://docs.syncthing.net/specs/bep-v1)
- **iOS background downloads**: background `URLSession` download tasks "continue to run even when your app is suspended", and the app is relaunched for completion events. A user force-quit cancels them (per the AVAssetDownloadURLSession docs) — [Apple: Downloading files in the background](https://developer.apple.com/documentation/foundation/downloading-files-in-the-background); [Apple URLSessionDownloadTask](https://developer.apple.com/documentation/foundation/urlsessiondownloadtask); [Apple AVAssetDownloadURLSession](https://developer.apple.com/documentation/avfoundation/avassetdownloadurlsession)
- **Last-writer-wins and timestamps in practice**:
  - Turso Sync uses "last push wins" — [Turso docs](https://docs.turso.tech/sync)
  - crosspoint-sync uses per-device newest-wins plus tombstones for bookmark deltas — [crosspoint-sync](https://github.com/crosspoint-reader/crosspoint-sync)
  - OPDS Progression uses a 409 when the server has newer progress, and the client asks the user before jumping — [OPDS Progression](https://drafts.opds.io/opds-progression-1.0.html)
  - Calibre merges highlights from multiple stores by timestamp — [MobileRead](https://www.mobileread.com/forums/showthread.php?p=4388980)
- **Re-anchoring after edits**: TextQuoteSelector with fuzzy prefix/suffix matching (Hypothesis), and W3C `State` to record which version an annotation targets — [Hypothesis](https://web.hypothes.is/blog/fuzzy-anchoring/); [W3C annotation-model](https://www.w3.org/TR/annotation-model/)
- **Partial sync of large text**: sqlite-sync's "Block-Level LWW" splits text columns into lines and merges them independently, a middle ground between LWW and full CRDTs for note bodies — [everydev sqlite-sync](https://www.everydev.ai/tools/sqlite-sync)

### Inferences
**Recommended model for the user's Pager** (synthesis of the cited patterns):
- **Books (server-authoritative, read-mostly)**:
  - Library manifest: the phone calls `GET /sync/library?since=<cursor>`, which returns `{bookId, title, format, contentHash (SHA-256), size, mtime, deleted}` rows. A monotonically increasing server change counter makes the cursor cheap.
  - The phone stores blobs content-addressed (`/books/<sha256>.epub`) and keeps the old blob until any annotations made against it are re-anchored.
  - When a desktop edit changes a hash, the phone fetches the new blob via background URLSession. Whole-file re-download is fine for EPUB-sized files; Syncthing-style block deltas are only worth it for large PDFs.
  - Streaming-only (OPDS-PSE style) does not meet the offline requirement and suits image comics, not reflowable text.
  - Hybrid: mirror the books the user pins or opened recently (or the whole library if it is small); stream or download the rest on demand.
- **Progress**: one row per (book, device) holding `{locator, totalProgression, updatedAt, deviceId}`. "Current" is the newest `updatedAt`. If the newest position is behind this device's own, prompt the user, as in OPDS Progression. No CRDT needed.
- **Highlights and notes**:
  - Each annotation has a UUID created on the device. The record is `{uuid, bookId, contentHashAtCreation, selectors: TextQuote + TextPosition (+ Readium Locator), color, noteBody, createdAt, updatedAt, deletedAt}`.
  - Sync as an operation log or row-level LWW with tombstones.
  - Edits to the same annotation on two devices are rare. If note-body merging matters, use line-level LWW or embed an Automerge/Loro text object only for `noteBody`.
  - On hash change, the desktop (which already re-anchors) or the phone (with the same fuzzy algorithm) updates the selectors and `contentHashAtCreation`. Orphans are flagged, never deleted.
- **Transport**: reuse the existing Hono server: REST pull/push endpoints, with the existing live event stream (SSE) as a "something changed, pull now" signal while the app is foregrounded. When offline, the phone queues mutations in its local SQLite outbox. This is the local-first "server as cloud peer" pattern without adopting a framework.
- **CRDT choice if desired**: Automerge has the clearest JS-server/Swift-client pairing (automerge-repo on Node with WebSocket, automerge-repo-swift on iOS), but the Swift repo API is unstable. Loro has fresher Swift builds but labels itself experimental. yswift is the least complete.

### Gaps
- No benchmark sources on Automerge/Loro document size or performance for annotation-scale data on iOS.
- No source confirming automerge-swift is updated for Automerge 3.0 (the Swift material found predates 3.0).
- No primary source evaluating content-defined chunking for EPUB delta sync; the recommendation to re-download whole files is an inference.

## Q5. Drop-in sync engines: which work with SQLite on both a Node server and an iOS client without a cloud service?

### Takeaway
**Almost none fit "SQLite on a Node server + native iOS client + no cloud" out of the box.**
- PowerSync, ElectricSQL and Zero all require a **Postgres** (or MongoDB/MySQL) backend.
- Turso Sync and sqlite-sync (sqliteai) target their own clouds or Postgres.
- cr-sqlite is dormant since late 2024.
- Realm Device Sync is end-of-life (Sep 30, 2025).
- Replicache is in maintenance mode, and Triplit's founder joined Supabase.
- Evolu is TypeScript-only (self-hostable relay, no Swift).
- Ditto has a Swift SDK and peer-to-peer LAN sync but is commercial.

The realistic choices are (a) a hand-rolled sync protocol over the existing Hono + SQLite (recommended), (b) Automerge/automerge-repo for annotation documents, or (c) PowerSync Open Edition if the user is willing to add Postgres.

### Cited Findings
- **PowerSync**:
  - Cloud, free source-available self-hosted **Open Edition** (FSL license for the service; Apache-2.0 SDKs, runs via Docker), and Enterprise.
  - Backends: Postgres and MongoDB (stable), MySQL (alpha); the marketing site also lists SQL Server.
  - The Swift SDK embeds SQLite. From v1.14 it is native Swift over a Rust core (the Kotlin dependency was removed).
  - Writes queue locally and upload through your backend connector — [PowerSync GitHub org](https://github.com/powersync-ja); [PowerSync docs Swift](https://docs.powersync.com/client-sdks/reference/swift); [powersync.com](https://powersync.com/)
- **ElectricSQL**: "sync engine for Postgres" (read path over HTTP shapes). Clients are TypeScript and Elixir, plus an unofficial Dart port. **No Swift client found**. Elixir package 1.4.x shipped in Mar 2026 — [Electric repo docs](https://docsearch.algolia.com/mcp/docs/repo/electric-sql/electric); [hex.pm electric](https://www.hex.pm/packages/electric/1.4.8); [electric_dart](https://github.com/SkillDevs/electric_dart)
- **Zero (Rocicorp)**: "today only Postgres is supported", v15+ with logical replication — [Zero docs](https://zero.rocicorp.dev/docs/connecting-to-postgres). **Replicache** is in maintenance mode, open-sourced and free; users should migrate to Zero (quoted from replicache.dev via a forum page) — [basehub forum](https://forums.basehub.com/rocicorp/mono/1)
- **cr-sqlite** (vlcn, Matt Wonlaw): loadable SQLite/libSQL extension that merges independently written databases via CRDTs. Last push 2024-10-25 and npm 0.16.3, with no 2025 releases found — [cr-sqlite README](https://cdn.jsdelivr.net/gh/vlcn-io/cr-sqlite@main/README.md); [ecosyste.ms](https://awesome.ecosyste.ms/projects/github.com%2Fvlcn-io%2Fcr-sqlite); [Simon Willison TIL](https://til.simonwillison.net/sqlite/cr-sqlite-macos)
- **Turso**: Turso recommends **Turso Sync** for offline writes (local reads and writes, explicit `push()`/`pull()`, "last push wins"). Older Embedded Replicas send writes to the remote primary, which is not suitable for offline writes. Bindings exist for React Native; **no Swift SDK found** — [Turso Sync docs](https://docs.turso.tech/sync); [Turso local-first guide](https://turso.tech/blog/building-local-first-apps-the-complete-guide-to-offline-first-database-sync); [Turso RN bindings](https://turso.tech/blog/react-native-bindings-for-turso)
- **sqlite-sync (SQLite AI / SQLite Cloud, Inc.)**:
  - CRDT SQLite extension (Causal-Length Set, Delete-Wins, Add-Wins, G-Set, Block-Level LWW).
  - Builds for Linux, macOS, Windows, iOS, Android and WASM.
  - Syncs with **SQLite Cloud, PostgreSQL or Supabase**.
  - Swift package details are unverified — [everydev sqlite-sync](https://www.everydev.ai/tools/sqlite-sync); [Marco Bambini blog](https://marcobambini.substack.com/p/the-secret-life-of-a-local-first)
- **Realm / Atlas Device Sync**: deprecated Sep 2024 and **end-of-life Sep 30, 2025**. The on-device Realm DB continues as open source; MongoDB pointed users to partners including Ditto and PowerSync — [MongoDB Device SDKs deprecation](https://mongodb.com/docs/atlas/device-sdks/deprecation); [MongoDB forum EOL notice](https://mongodb.com/community/forums/t/atlas-device-sync-end-of-life-and-deprecation/296687)
- **Ditto**: P2P sync over Bluetooth, Wi-Fi Direct and LAN, with an optional "Big Peer" cloud. Swift SDK for iOS 13+/macOS 11+; connects to a Big Peer by `host:port` TCP or `wss://`. No pricing or self-host detail found — [Ditto docs](https://docs.ditto.live/v4-4/ditto-basics); [DittoSwift API](https://software.ditto.live/cocoa/DittoSwift/4.14.6/api-reference/Setting%20Up%20DittoSwift.html); [apis.io Ditto](https://apis.io/providers/ditto-live/)
- **Evolu**: MIT TypeScript local-first library (SQLite, Kysely, CRDT merge, E2EE, mnemonic keys). Self-hostable **Evolu Relay** via Docker/Node (port 4000, SQLite file). No Swift support found — [GitHub evoluhq/evolu](https://fr.github.com/evoluhq/evolu); [Docker Hub evolu](https://hub.docker.com/r/evoluhq/evolu)
- **Triplit**: on Oct 8, 2025, Supabase announced Triplit co-founder Matt Linkous was joining. Triplit is "largely open source", with further open-sourcing planned; Supabase will not fold the product into its platform. The future of Triplit's hosted service is unclear — [Supabase blog](https://supabase.com/blog/triplit-joins-supabase)
- **CouchDB / PouchDB**: Couchbase Lite (Swift, 4.0.x requires iOS 15+) is the native option in this family. The sources found did not confirm whether it replicates with Apache CouchDB; only its predecessor TouchDB documented CouchDB replication — [Couchbase Lite docs](https://docs.couchbase.com/mobile/4.0.3/couchbase-lite-objc); [TouchDB replication wiki](https://github.com/couchbaselabs/TouchDB-iOS/wiki/Replication-Algorithm)

### Inferences
- With an existing Node + SQLite server, adopting PowerSync/Electric/Zero would mean migrating the server's source of truth to Postgres. That is disproportionate for a single-user book library.
- cr-sqlite is the only option that is "SQLite on both ends, no cloud". It is dormant, though, and on iOS you would have to bundle your own SQLite build to load extensions. iOS's system SQLite is generally understood not to allow loadable extensions; this is background knowledge, not verified here.
- A hand-rolled protocol is small for this domain: change counters, LWW rows, tombstones, an outbox on the phone, and pull/push endpoints. It is easier to reason about than adopting a framework, and it fits the Pager's existing event stream.

### Gaps
- Could not confirm whether Turso Sync can target a self-hosted libSQL/sqld server or only Turso Cloud.
- No current confirmation of Couchbase Lite to CouchDB/PouchDB compatibility.
- Ditto pricing and self-hosting status of the Big Peer are unknown.
- Evolu's React Native and Electron support status conflicts between sources.

## Q6. Third-party cloud storage as transport (iCloud Drive, Dropbox, Google Drive, Syncthing + Möbius Sync)

### Takeaway
Cloud folders are a reasonable transport for **book files**: one-way desktop-to-phone, with large immutable blobs. They are a poor transport for **annotations and progress**, which have many small concurrent writes and need merge logic. iCloud Drive has no official Linux client; rclone's `iclouddrive` backend (v1.69+) works but needs 2FA re-auth about every 30 days and has Advanced Data Protection limits. Syncthing + Möbius Sync avoids any cloud, but iOS background limits cap syncing to roughly 1–2 hours/day and only while the app is opened or woken. Several existing iOS readers (Readest, Yomu, KyBook, Moon+ on Android) already use these clouds for book and position sync.

### Cited Findings
- **rclone `iclouddrive`** (added v1.69, Tier 4): uses your regular Apple ID password + 2FA (app-specific passwords are not accepted). The trust token lasts about 30 days, then you must run `rclone reconnect`. It covers Drive and Photos. ADP was originally unsupported; newer docs describe a PCS-cookie workaround that may need approval on a trusted device. A Fedora user hit a crash with shared folders on v1.69.1 — [rclone iclouddrive docs](https://rclone.org/iclouddrive/); [rclone tip docs](https://tip.rclone.org/iclouddrive); [rclone forum](https://forum.rclone.org/t/iclouddrive-backup-running-slow-zone-busy-warnings/50220)
- **Möbius Sync** (closed-source iOS wrapper for Syncthing):
  - No iOS app runs continuously in the background, so syncing happens only while the app is open, shortly after, or when iOS briefly wakes it. It may take 24h to start, after which you can expect "a total of 1–2h of sync activity per day" — [Möbius Sync FAQ](https://mobiussync.com/faq/)
  - Files must be moved through the Files app between apps — [Möbius Sync FAQ](https://mobiussync.com/faq/)
  - Users report syncing stops until the app is reopened — [Syncthing forum](https://forum.syncthing.net/t/mobius-sync-background-refresh/16372); [Obsidian forum](https://forum.obsidian.md/t/sync-mac-pc-and-ios-using-syncthing-mobius-sync/72022)
- **Existing readers using cloud transports**:
  - Readest syncs via Readest Cloud or your own iCloud, Google Drive, OneDrive, WebDAV or S3 — [App Store Readest](https://apps.apple.com/us/app/id6738622779)
  - Yomu Pro syncs books and annotations via iCloud — [App Store Yomu](https://apps.apple.com/us/app/yomu-ebook-reader/id562211012)
  - KyBook 3 stores books in iCloud Drive, Google Drive, OneDrive, Dropbox or Yandex — [App Store KyBook 3](https://apps.apple.com/app/id1348198785)
  - Moon+ Reader syncs positions via Dropbox or Google Drive, and books via WebDAV, with reported annotation-sync gaps — [MobileRead](https://www.mobileread.com/forums/showthread.php?p=4009047)
  - CaliMob reads Calibre libraries from Drive, Dropbox, OneDrive, WebDAV or FTP/SFTP folders — [CaliMob](https://caliwebapp.com/en/opds-reader)
- The local-first essay argues servers (or clouds) should be "cloud peers" for backup and forwarding, not the authority — [Ink & Switch](https://www.inkandswitch.com/essay/local-first/)

### Inferences
- **iCloud Drive**: attractive for a native iOS app, which gets free iCloud ubiquity containers and background sync handled by the OS. On Fedora, though, the Pager server would have to push files via rclone with 30-day re-auth, which makes it fragile as the primary transport. It is fine as a secondary "drop a copy for offline" mechanism.
- **Dropbox / Google Drive**: official HTTP APIs plus rclone make Linux-side push robust, and many iOS readers can read from them. Using them for annotations would mean inventing file-level merge logic (e.g., one JSON file per device, merged by the reader), which is how Moon+ Reader-style "sync via Dropbox" works in practice.
- **Syncthing + Möbius**: keeps data private and off-cloud. But the background limits make it unreliable for "always current" progress, and the file-sharing dance through Files makes it awkward for books that another reader app has to open.
- **Overall**: direct connection to the Hono server (over Tailscale or similar) for metadata, progress and annotations, with mirrored book blobs in the app sandbox, gives the most control. A cloud folder is best kept as an optional fallback for book files only.

### Gaps
- Did not research Dropbox and Google Drive API specifics (rate limits, delta/cursor APIs such as Dropbox `list_folder/continue`) in this pass.
- No source found for an official Apple iCloud Drive client or API usable from Linux (none is believed to exist; only rclone's reverse-engineered backend was found).
- Möbius Sync pricing and its current (2026) version were not checked.
