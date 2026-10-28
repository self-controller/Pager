# ReadEra: how its sync works, and what Pager can take from it

Written 2026-10-27. Target: **ReadEra 26.10.18+2330 for Android** (`org.readera`, free build, 6.8 MB,
sha256 `beba3353…566e70`, from APKPure), plus the public listings of **ReadEra for iOS 1.2.3**.
Method: the APK's two dex files were inventoried with a purpose-written DEX parser, decompiled with
Ghidra 12.1.4 (Dalvik, headless), and the app's encrypted strings (a Paranoid-style obfuscator,
class `p9/b`) were decrypted with a reimplementation so that SQL, file names and work names read in
clear. Nothing was run; every statement below is static evidence unless it says *inferred*.

## 1. The short answer

- **ReadEra for iOS has no cloud sync at all.** The App Store listing (version history 1.0 → 1.2.3,
  Jan 2024 → Jun 2026) never mentions sync; the description says it works offline with no purchases;
  the privacy policy says the app transfers nothing; reviews ask for iCloud sync. There is nothing to
  reverse engineer on the iOS side for sync. What exists on iOS: formats, TTS, quotes/notes/bookmarks,
  "About Document", Collections, Reviews, import from Files/iCloud Drive, Share-with-ReadEra.
- **Sync is Android-only, in ReadEra Premium, through the user's own Google Drive** (Huawei Drive on
  AppGallery builds). Identity comes from **ReadEra's own account server** (`readera.org/api/v1/…`,
  certificate-pinned), which also verifies the Premium purchase. The free APK ships the whole data model
  and the change-log / backup engine, but the Drive client, the sync device id and the sync manager
  are **stubs that return null** (`y9/v`, `y9/e.c`, `na/k5.c`, `w9/v3`), so the on-the-wire layout on
  Drive is *inferred* from the local side, not observed.
- **The design worth copying is not "Google Drive".** It is: documents identified by content hash;
  every synced write appended to a local change log as `{action, uri, data, time}`; change batches cut
  into per-device "sync points" named `<xmax>-<xmin>-<deviceId>`; a full snapshot ("backup") that
  carries a per-device watermark vector; and a "place from another device" prompt in the reader.
  Pager already has half of this (journal with `seq`, progress with `deviceId`/`updatedAt` and the
  409 rule, sync manifest with `contentHash`, export/import). Section 5 says what to add and when.

## 2. What the Android app does (observed)

### 2.1 Data model (SQLite, schema version 111)

Tables that matter for sync, from `xa/g`, `xa/b0`, `xa/c0`, `xa/i…l` and the Doc model `fa/l`:

| Table | Purpose |
|---|---|
| `docs` | One row per document: `doc_uri` (the identity, a sha1-based URI once hashed; "doc.isSha1Uri()"), `doc_sha1`, `doc_md5`, `doc_position` (JSON place), **`doc_outdated_position`** (JSON place + `device` + `time` from another device), `doc_active`, `doc_delete_time`, reading-list times (`doc_activity_time` = Reading now, `doc_favorites_time`, `doc_to_read_time`, `doc_have_read_time`), `doc_last_read_time`, user metadata (`user_title`, `user_authors`, `user_series`, `user_langs`, `user_annotation`), `doc_rating`, `doc_review_time`, `doc_prefs`… |
| `aliases` | `(doc_id, doc_uri)`: every URI a document was ever known by (path-based before hashing, sha1 after). Lets a change addressed by an old URI still find the row. |
| `notes` | Bookmarks, citations (highlights with notes) and reviews, by `note_type` (1 = review, 2 = bookmark, 3 = citation), each with its own `note_uri`, `note_index`, `note_insert_time`, `note_modified_time`, `note_body`, `note_data`, `note_page`. |
| `colls`, `docs_to_colls` | Collections (bookshelves), with `coll_uri`. |
| `dict_words`, `dict_contexts`, `dict_forms` | The "My words" dictionary tool, each with a URI. |
| **`changes`** | `change_id, change_action, change_uri, change_data (JSON), change_time, change_stat, sync_point_id`. |
| **`sync_points`** | `sync_point_id, sync_point_devid, sync_point_xmax, sync_point_xmin, sync_point_prev`; unique on `(devid, xmax)`. |
| `links` | Cloud copies of files: `link_uri` (`gdrive://ReadEra/Books/<fileId>[#0]`), `doc_id`, `file_size`, `file_name`, `file_created_time`, `file_upload_time`, `link_broken`. |
| `tasks` | Cloud work queue: `doc_id`, `task_type` (1 = download, 2 = upload), `task_time`. |

### 2.2 The change log (`xa/f.v1` / `w1`)

Every mutating DB method that is synced calls `v1(db, action, uri, contentValues)`, which, **only when
sync is enabled** (`pref sync_enabled`), serialises the ContentValues to JSON and inserts
`changes(action, uri, data, now, stat = 1, sync_point_id = NULL)`. The URI is the entity's own URI
(document, note, collection, link, word), never a row id, so it is meaningful on another device.
Actions found in the free build:

- documents: `docActivate`, `docTrashPut`, `docTrashRestore`, `docUpdateUri`, `docUpdateFilename`,
  `docMigrateUriToSha1`, `docMigrateFull`, **`docUpdateReadingState`** (the place: `doc_position` plus
  `device`), `docUpdateReadingTime`, `docUpdateUserTitle/Authors/Series/Langs/Annotation`,
  `docToggleReadingNow/Favorites/ToRead/HaveRead`;
- notes: `noteInsert`, `noteUpdateBookmark`, `noteUpdateCitation`, `noteUpdateReview`, `noteDelete`,
  `noteRestore`;
- collections: `collInsert`, `collRename`, `collDelete`, `collRestore`, `collChild`, `collItem-…`;
- cloud files: `linkInsert`, `linkBroken`, `linkDelete`;
- dictionary: `dictWordInsert/Delete`, `dictContextInsert-/Delete-`, `dictFormInsert-/Delete-`.

Serialised form of one change (`fa/d.b`): `{ "i": id, "a": action, "u": uri, "d": data, "t": time }`.
Changes compare by time (`fa/d.compareTo`), so replay is in time order, last write wins.

### 2.3 Sync points: cutting the log into per-device batches (`na/s.i`, `xa/f.x1`)

Run on every backup (`BackupUtils exportChanges`):

1. Read pending changes: `SELECT * FROM changes WHERE sync_point_id IS NULL ORDER BY change_id`.
2. Find this device's last point: `SELECT * FROM sync_points WHERE sync_point_devid = ? ORDER BY
   sync_point_xmax DESC LIMIT 1`.
3. No last point, or "break chain" requested → a point with `xmax = now, xmin = 0` (a full baseline).
   Otherwise, if there are pending changes → a point with `xmax = time of the last pending change,
   xmin = previous point's xmax`, and `sync_point_prev` = the id of the `(devid, xmin)` row (the chain).
4. `UPDATE changes SET sync_point_id = ? WHERE change_id BETWEEN first AND last`.
5. If `xmin > 0`, the batch is written to a file named **`<xmax>-<xmin>-<devid>`** (a zip holding one
   JSON array entry of the serialised changes; `xa/f.z1` → `na/h6.f`). A baseline (`xmin = 0`) writes no
   file: the full snapshot carries everything.
6. After a sync (`type == TYPE_SYNC`), every device's latest point gets `sync_point_prev = NULL`
   (chain compaction).

The name parser (`fa/h0.a`) accepts `<xmax>-<devid>` (2 parts) or `<xmax>-<xmin>-<devid>` (3 parts),
rejects `xmin > xmax` and empty device ids. Device ids therefore cannot contain `-`. The id used for
sync points comes from `SyncManager.c()`, which **returns null in the free build** (Premium-only;
*inferred*: a per-installation UUID). The id written into backups is the device *name*
(`Build.MANUFACTURER + " " + Build.MODEL`), and that is the string shown in the reader's dialog.

Receiving the other direction (`xa/f.A7`): insert a sync point for a foreign device and its changes with
`stat = 0`, inside one transaction. Adopting watermarks without changes is how a restored backup
seeds the vector (below).

### 2.4 Backups are the snapshot layer (`na/s`, `BackupWorker`)

A backup is a zip renamed **`ReadEra_<yyyy-MM-dd_HH.mm>[_auto].bak`** containing: `meta.json`,
`stats.json`, `prefs.xml`, `search-history.xml`, `colls.json`, `words.json`, and `docs_0001.json …`
(1000 documents per chunk; each document carries nested `aliases`, `bookmarks`, `citations`, `reviews`,
`links`, written by `BackupDocsManager`). Book files are **never** in a backup (the UI says so).

`meta.json` keys: `date`, `type` (0 auto, 1 manual, 2 sync), `database` (schema version, 111),
`device`, `version`, `appname`, and **`state`**: an array of `"<xmax>-<devid>"` strings, one per device
known locally — the vector clock. On restore (`na/s.M` → `F`), every entry whose device is unknown
locally, or whose `xmax` is newer than the local one, is inserted as a sync point, so the restored
library knows which batches it has already absorbed. Restore migrates old backups by version
(`< 92, < 97, < 102, < 110`), imports documents with a *merge* flag, restores prefs only when
`meta.device` equals this device, then shows "Data successfully restored".

Scheduling: `SyncManager.fire()` → WorkManager unique work **`backup`** (`BackupWorker`, 10 s delay).
The worker refuses to run while a scan is running or any activity is in the foreground and
re-enqueues itself a minute later; otherwise it creates an auto backup, prunes the list (keep the newest
per day, at most 7 auto backups), and posts events. A second unique work **`check_network`**
(`NetworkChecker`, constraint = connected, or *unmetered* when "Via Wi-Fi only" is on) wakes the
`CloudManager` thread.

### 2.5 Files in the cloud (`y9/t` CloudManager, `y9/g0` SyncHelper)

A single background thread drains `tasks` ordered by `task_time`. **Upload** (`type 2`): pick the
document's main file; archives (zip/rar with the book inside) go as-is; plain text is zipped first
(`<name>.zip`, link fragment `#0`); otherwise the file is sent unchanged. The provider returns a
`fileId`; a `links` row is written as `gdrive://ReadEra/Books/<fileId>` with size, name and times.
**Download** (`type 1`): for a document with no local file but links, fetch through each link until one
works (broken links are marked `link_broken`); then import the file and **verify that the imported
document's identity equals the expected one** ("doc not found by file", "txt bad hash") — the hash is the
contract. Failures are typed (`CloudAuthException`, `CloudChecksumException`, `CloudConnectException`,
`CloudFileNotFound`, `CloudAbusiveFile`, `CloudRequestCancelled`). Scopes known to the app:
`DRIVE_APPDATA`, `DRIVE_FILE`, `DRIVE_READONLY`; the visible folder is `ReadEra/Books` (*inferred*:
backups and change files go to the hidden `appDataFolder`, which is what `DRIVE_APPDATA` is for).

User-visible policy strings: "Automatically sync reading progress with %s cloud", "Automatically sync
books, documents and reading progress", "Sync all book and document files" or only the files in
"Reading now, Favorites, To Read, Have Read, Collections", or per-book Upload/Download buttons;
"Via Wi-Fi only"; "Sending/Receiving reading progress: %d%%"; "Sending/Receiving backups";
"Trash bin sync"; "Restore the file from %s cloud?".

### 2.6 The "place from another device" prompt (`sa/h3`, `ReadActivity.c2`)

When a document is opened and `doc_outdated_position` is set, the reader shows a bottom sheet:
"Source: *<device>* - *<time>* (synchronization)" and "page *N*", with two buttons. One jumps to that
place (a jump of type 4, then the column is cleared with `UPDATE docs SET doc_outdated_position = NULL`);
the other just clears it. The place is `{ …position, "device", "time" }` (`ca/q`, a position plus device
and time). *Inferred*: the column is filled when a remote `docUpdateReadingState` is applied while the
local place is also newer than the last common point, so the user, not a timestamp, decides.

### 2.7 Accounts and Premium

Sign-in sends a Google id token (web client id `793202449954-…apps.googleusercontent.com`) or a
Huawei token to `POST /api/v1/auth/google|huawei` with `android_id`, `device`, `locale`, `currency`;
the server answers with ReadEra's own `access_token` / `refresh_token` / `expires_at` / `user_id` /
`email` (`y9/w`). Other routes: `/auth/refresh`, `/auth/logout`, `/whoami`, `/confirm_email`
(code by email, so an account can be used on other devices), `/del_account`, `/inapp/google|huawei`
(purchase verification; the app also verifies an RS512 JWT with `java-jwt`). TLS is pinned to
`sha256//1y/dzcHImqjSeAROQMXzz57Ik+7lbXoqLtQU75quK8=` with server failover. Premium is sold as a
separate package (`org.readera.premium`); the free app exposes its data to it through
`TierFreeProvider`/`TierFreeService` guarded by the `org.readera.permission.TierSync` permission, which
is how "Data and settings are automatically copied from the free version".

### 2.8 Not in the free build (limits of this analysis)

The Drive HTTP client, the sync device id, the SyncManager body, the merge of downloaded change files
into the local DB, and the exact names/folders used on Drive are absent (stubbed). Everything in 2.2–2.4
is complete on the local side; how files are named *on Drive* and how conflicts between two devices'
`docUpdateReadingState` are resolved beyond "newer time wins, else ask" is inferred. The engines
(`eraepub`, `erapdf`, `eradjvu`, `eramobi`, `eracomic`) are GPL ("The OpenReadEra Project",
readera.org/book-reader/OpenReadEra).

## 3. Feature inventory: ReadEra vs Pager (today)

| Feature | ReadEra (Android / iOS) | Pager today |
|---|---|---|
| Formats | EPUB, PDF, DjVu, MOBI/AZW3, FB2, DOC/DOCX/RTF/ODT, TXT, CBZ/CBR, CHM, MD; archives read in place | EPUB, Markdown, HTML, text, Word. No PDF/MOBI/FB2/DjVu/comics |
| Library | auto-scan of the device, folders, Authors/Series/Formats sections, reading lists (Reading now, Favorites, To Read, Have Read), Collections, Kids mode, duplicates by hash | folder = library, search, sort, progress; no lists/collections/authors views |
| Place | per device, synced, "from another device" prompt | one place per document, `deviceId` + `updatedAt`, 409 on older writes; no prompt |
| Annotations | bookmarks, quotes with notes and colours, reviews, "Quotes and Notes" hub | highlights, notes, bookmarks with re-anchoring, tags, Highlights page, Markdown mirror |
| Dictionary / translate | "My words", lookups in any dictionary app, Translate on iOS | smart-tools seam (empty) |
| TTS | yes (both) | no |
| Backup | `.bak` zips, auto daily (keep 7), restore with merge | `GET /export` / `POST /import` exist on the server, not in the UI |
| Sync | Android Premium only: Google Drive, change log + snapshots; **iOS: none** | phone reads the desktop live over Tailscale (iroh in progress); no offline writes |
| Accounts | ReadEra server, Google/Huawei sign-in | none (pairing codes) |

## 4. What to take, what to leave

**Take**

1. The change-record shape `{ id, action, uri, data, time }` and the rule "log the change at the DB
   write, only when sync is on" — it makes an offline client trivial to write and replay.
2. Identity by content hash with an alias table, and *verifying the hash after a download*. Pager's
   manifest already carries `contentHash`; aliases are what make renames/moves and old URIs harmless.
3. The "place from another device" prompt instead of silently moving the reader.
4. Snapshot + delta: a full export that carries per-device watermarks, so a fresh device bootstraps from
   one file and then only pulls deltas.
5. Scheduling discipline: never sync while the user is reading; Wi-Fi-only switch; daily rotated backups.
6. Reading lists and collections as first-class, synced entities with their own URIs.

**Leave**

- Drive as a dumb store with per-device chains and vector clocks. Pager has a smart server (the
  desktop) and a journal with a total order (`seq`); a star topology is simpler and already half built.
  Only revisit this if the phone must sync while the computer is off (section 5, phase D).
- An account server and purchase verification: irrelevant for a personal tool.
- GPL engines: cannot be linked into the Rust backend without relicensing the project.

## 5. When and how, against the current plan

The iroh plan (prompts/iroh-migration.md) is at Phase 1 done, Phase 2 (iPhone app) next. The items
below slot around it; estimates are working days for one person.

### A. Now, on the desktop side (before Phase 2) — about 5 days

1. **Place from another device** (1 day). Web app: remember per document the last place *this*
   client wrote or accepted (localStorage). On open, if `progress.deviceId` is another device and
   `updatedAt` is newer than that, show a bar "p. 12 on *iPhone*, 2 h ago — Go / Keep mine"; "Go"
   jumps, both dismiss. The journal event `progress.updated` already fires only when another device
   writes, so the live case needs no new server work.
2. **A batch change endpoint for offline clients** (2–3 days). `POST /sync/changes` taking
   `[{ id, action, subject, data, time }]` with actions mapped onto existing semantics:
   `progress.put` (the 409 rule returns `conflict` + current place per item instead of failing the
   batch), `annotation.create|update|delete|restore` (client `id` already makes create idempotent),
   `record.put`. Answer per item `{ id, status: applied|conflict|rejected, result }` plus the journal
   `cursor`. Store applied client change ids (`device_id, change_id`) so a replayed batch is a no-op.
3. **Backups in the UI** (1 day). Settings → Backup: "Create backup" (`GET /export` to a dated file
   under `<data>/backups/reader_<yyyy-MM-dd_HH.mm>.json`), "Restore", auto backup daily keeping 7
   (`BackupWorker`'s rule), and the ReadEra line "backups do not include your files".
4. **Reading lists** (1 day, optional now). `to-read`, `reading`, `have-read`, `favorite` as timestamps
   on the document (ReadEra's `doc_*_time` columns), toggled from the library menu, journalled, and
   accepted by the batch endpoint. Collections can wait: folders cover most of it.

### B. Phase 2, the iPhone app — the sync parts, about 6–8 days on top of the shell

1. **Mirror + local log.** The app keeps a SQLite mirror filled from `GET /sync/manifest` (bootstrap
   full, then `after=cursor`), downloads files by `contentHash` and verifies the hash before use (the
   ReadEra "doc not found by file" check). Every local write (place, highlight, note, bookmark, list
   toggle) goes into a local `changes` table first, with a client id and time, then to the UI.
2. **Replay.** When the desktop is reachable: push pending changes in order through
   `POST /sync/changes`, mark them by status, then pull the journal from the saved cursor and apply
   remote events to the mirror. Conflicts on the place become the "from another device" prompt (A.1)
   on the phone too; annotation conflicts follow the server's "newer wins".
3. **Discipline.** No replay while a page is open and being read (ReadEra waits a minute after the
   reader stops); Wi-Fi-only switch for file downloads; a manual "Sync now" with "last synced" text.
4. **Snapshot bootstrap.** A fresh phone can also import a desktop backup file (A.3) to avoid a long
   first pull.

### C. After Phase 3 (Tailscale gone) — polish, 2–3 days each

- Collections with their own ids, synced like lists.
- Reviews/ratings per document (one `annotation` kind `review`, or a document field).
- TTS in the web app (Web Speech API; on the phone, `AVSpeechSynthesizer` in the shell) — ReadEra's
  most-requested iOS feature after sync.
- "My words": a smart tool on the existing seam, with its own records and the batch endpoint.

### D. Only if the phone must sync with the computer off — 2–3 weeks, not recommended now

This is the one place where ReadEra's design applies as-is: both sides write to a dumb store (an
iCloud Drive folder on the phone, the same folder via `rclone`/`icloudpd` or a WebDAV mount on the
desktop). Each device appends change files named `<xmax>-<xmin>-<deviceId>`, publishes a snapshot
with a `state` vector, and pulls others' chains in order, applying `{action, uri, data, time}` with
last-write-wins and the place prompt. It needs stable per-device ids (UUIDs without `-`), chain-gap
detection (`sync_point_prev`), and a compaction rule. Build it as a transport behind the same change
records as B so that nothing in the app changes.

## 6. Evidence index (for re-checking)

Scratchpad for this session (temporary): `/tmp/claude-1000/-home-david-Desktop-projects-Reader/98cf5f2c-4ea0-4adb-b792-60f84bc895ac/scratchpad/`
— `apk/org.readera_26.10.18_2330.apk`, `apk/raw/*.inv.json` and `all.refs.json` (class/string/call
inventories), `ghidra/decR/*.c` (decompiled, strings resolved), `tools/dexinv.py`, `tools/dexrefs.py`,
`tools/paranoid.py` (decryptor), `tools/ghidra_scripts/ExportDecomp.java`.

| Claim | Where |
|---|---|
| Schema of `changes`, `sync_points`, `links`, `tasks`, `doc_outdated_position` | `xa/g.a` |
| Change-log writer, `stat = 1`, JSON data | `xa/f.v1`, `xa/f.w1`, `xa/f.P7` |
| Action names | string literals of the `xa/f` methods calling `v1` |
| Pending-changes query, sync-point select/insert, chain update | `xa/f.y1`, `B7`, `x1`, `A7`, `E7`, `C7`, `D7` |
| Sync-point naming and parsing | `fa/h0.a/c/d` |
| Change serialisation `{i,a,u,d,t}` | `fa/d.b` |
| Change file written as zip | `xa/f.z1` → `na/h6.f` |
| Backup layout, meta keys, `state` vector, rotation, restore | `na/s.d`, `m`, `w`, `g`, `M`, `F`, `z` |
| Backup JSON per document | `xa/a.a/b/f/h/i` |
| Work names `backup`, `check_network`, Wi-Fi constraint | `za/v.f/g/e` |
| Backup worker's "not while reading" rule | `BackupWorker.p` |
| Cloud task loop, upload/download, hash verification | `y9/t.run/G/x/y/z`, `y9/g0.p/r/s/t/u` |
| Link URI | `fa/s`, `y9/g0.a` |
| Account routes and pinning | `org/readera/auth/i`, `i$b`, `j`, `k`, `g`, `d`, `o` |
| Stubs in the free build | `y9/v.a`, `y9/e.c`, `na/k5.c`, `w9/v3.a/b` |
| Other-device dialog | `sa/h3`, `ReadActivity.c2`, `ca/q` |
| iOS: no sync | App Store listing id1669188337 (version history, description), readera.org/privacy-ios |
| Android sync is Premium + Google Drive | readera.org/premium, resource strings in `resources.arsc` |
