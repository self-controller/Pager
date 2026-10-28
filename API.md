# Pager backend API

The backend half of the contract. The UI's `src/api/types.ts` and `src/api/http.ts` (CONTRACT.md)
define the base routes and shapes. This file adopts them unchanged and documents what the backend
adds. Wire types live in `shared/src/` (type-only TypeScript, safe to import from the UI). The
server lives in `server/` (Rust). It was ported from an earlier TypeScript server, which was the
oracle its parser tests were checked against and was deleted on 2026-10-28.

- **Base URL:** `http://localhost:3006/api` (`PAGER_PORT` overrides). In dev, Vite on 5176 proxies `/api`
  when `VITE_API_URL=http://localhost:3006` is set.
- **JSON everywhere.** Timestamps are ISO-8601 UTC strings.
- **Errors:** `{ "error": { "code", "message" } }`. `message` is a calm sentence that can be shown to the
  reader. Codes are listed in [Errors](#errors).
- **Everything is additive.** A field marked *added* can be ignored by a client that doesn't know it.

## Status

| Milestone | What | State |
|---|---|---|
| M0 | Routes the UI already calls; Markdown + TXT; HTML rendering; health; CLI | done |
| M1 | EPUB, HTML, DOCX; images; footnotes; TOC tree | done |
| M2 | Annotations, progress points, tool records, settings, presets, journal, `/stream` | done |
| M3 | Live reload of edited files; re-anchoring | done |
| M4 | Folder sources; full-text search | done |
| M5 | Markdown mirror of annotations; export/import; history; production serving | done |
| M6 | Phones: a second, device-authenticated loopback listener; pairing; progress conflicts; sync manifest | done |

---

## Documents, sections, sources (the base contract)

Each route behaves as `src/api/http.ts` expects.

| Route | Notes |
|---|---|
| `GET /documents?kind&saved&history&sort&q&sourceId` | Bare array of `DocumentSummary`. Deleted documents are left out. |
| `GET /documents/:id` | `DocumentDetail`. It checks that the file on disk is unchanged first; if it changed, it re-parses and re-anchors (M3). `path` is sent on the local listener only, never to a paired device. |
| `GET /documents/:id/sections/:sid[?include=blocks,annotations]` | `Section`. An unknown `sid` from an older revision resolves to the section that now holds its first block. Use `section.id` from the response. |
| `PATCH /documents/:id` | `{ saved?, title?, author? }` (title and author are *added*). Returns `DocumentSummary`. |
| `DELETE /documents/:id` | Soft delete. Annotations are kept and come back if the file is added again. 204. |
| `PUT /documents/:id/progress` | `ProgressUpdate` returns `ReadingProgress`. Sets `lastOpenedAt`. |
| `GET /sources` | `Source[]` (the reads folder is the one named "Reads"). |
| `POST /sources` | **Deprecated.** `{ path }`: watches a file or folder in place, outside the reads folder. The UI no longer calls it; use `POST /files/import` to copy things in. |
| `DELETE /sources/:id` | **Deprecated.** Its documents are soft-deleted. 204. |
| `POST /uploads?dir=` | multipart `file`. The file is written into `reads/<dir>/` under its own name (made unique) and read like any file there. The same bytes already in the library return that document instead. Returns `IngestJob` (done). |
| `GET /jobs/:id` | `IngestJob`. Jobs are in memory for an hour. |

**Added fields:**
- `DocumentSummary`: `relPath`, the file's path inside the reads folder (POSIX, no leading slash) when it lives there.
- `DocumentDetail`: `revisionId`, `live`, `authors`, `language`, `path` (local listener only), `pathStatus`, `warnings`, `outline`.
- `Section`: `revisionId`, `blocks`, `notes`, `annotations`.
- `TocEntry`: `blockId`.
- `ProgressUpdate`: `point`, `revisionId`, `reason`, `updatedAt`.
- `ReadingProgress`: `point`, `anchor`, `deviceId`.

`kind` is `"book"` for an EPUB or for any document with more than one section, and `"article"` otherwise.
`estimatedMinutes` is words ÷ 238, rounded up.

**Sections** are the author's units: EPUB table-of-contents entries; H1s in Markdown, DOCX and HTML when
there are at least two, otherwise H2s; chapter headings in TXT. A section over about 120,000 characters is
split at its next heading level, or into parts marked `synthetic`. `toc` lists sections in reading
order, with `depth` from the author's nesting. `outline` (*added*) lists every heading, including
those inside sections.

## The reads folder

The library is a folder: `PAGER_READS_DIR`, else `<repository>/reads`. On start the server makes it if
missing, copies `samples/welcome.md` into it once when it is empty, registers it as the folder source
"Reads", scans it, and watches it (files that appear are read, files that vanish leave the library and
return with their highlights if they come back, renames keep the document). Files elsewhere that were
added through the deprecated `/sources` routes stay in the library and in search, but only the reads
folder is browsed.

Paths in these routes are relative to the folder, with `/` separators and no leading slash; `""` is the
root. A path with `..`, a hidden segment (leading `.`), path characters in a name, or a real location
outside the folder (through a symlink) is refused with `invalid_request` or `forbidden`.

| Route | |
|---|---|
| `GET /tree` | `TreeResponse { root: TreeFolder, truncated }`. Folders carry `folders`, `files` and a recursive `fileCount`; empty folders are listed. Each readable file carries `format`, `size`, `modifiedAt`, and, once read, `docId` and its `DocumentSummary` (`error` says why when it could not be read). Files the library hasn't seen are read before the answer, so a folder is never half indexed. Depth 6, 2,000 files. |
| `POST /files` | `{ dir, title, author? }` → 201 `{ path, document }`. Writes `<safe title>.md` (made unique) with `title`, `author` and `created` in YAML front matter and a first heading, and reads it at once. |
| `POST /folders` | `{ dir, name }` → 201 `{ path }`; 409 `conflict` if taken. |
| `POST /files/move` | `{ from, to }` → `{ path, document? }`. Renames or moves a file or folder (`to` is the full new path). Documents keep their ids, anchors and progress; a title that came from the file name follows the name (the file's own metadata is read again to tell). A file keeps its extension. 409 if the target exists. |
| `DELETE /files?path=` | 204. Moves the file or folder into `reads/.trash/<timestamp>/` and soft-deletes its documents. Putting the file back brings the document back, highlights and all. |
| `POST /files/import` | `{ dir, path }` → 201 `IngestJob`. Copies a file from anywhere on the machine (`~` is expanded) into `reads/<dir>/`, or a folder's readable files with their structure (an async job: poll `GET /jobs/:id`). The original is untouched. The same bytes already in the library return that document instead of a copy. |
| `GET /search/documents?q&limit` | `DocumentSearchResult[]`: for each document, `matched` (`title`, `author`, `fileName`), up to three `hits` (the FTS passages below, in rank order) and `totalHits`. Title, author and file-name matches come first. An empty or unsearchable query answers `[]`. |

Every change through these routes, and every change the watcher sees in the folder (debounced), is
journalled as `tree.changed { reason: "created" | "moved" | "deleted" | "external", path? }` and goes
out on the stream, so an open library view refreshes.

The CLI's `pager <file>` uses `POST /files/import` with `dir: ""` and opens the document.

## HTML vocabulary

`Section.html` is generated from the parsed block model, never passed through from the file, so it
contains only the vocabulary below. It has no inter-tag whitespace, no `style` attributes, and no
scripts or event handlers.

| Element | Meaning |
|---|---|
| `h1`–`h6`, `p`, `pre > code[class=language-x]` | text blocks. **Every text block has `data-b="<blockId>"`** |
| `p.verse` | verse: the line breaks are the author's |
| `blockquote`, `aside[data-variant]` (`> [!note]` callouts, EPUB sidebars), `aside > p.aside-title` | containers |
| `ul`, `ol[start]`, `li` (`li[data-checked=true\|false]` for task lists; the item's content is always in block elements) | lists |
| `table > thead/tbody > tr > th/td[data-b][colspan][rowspan]`, `table > caption[data-b]` | tables |
| `figure > img + figcaption[data-b]`, `hr` | figures, rules |
| `em strong code sup sub s u mark span.smallcaps br` | inline |
| `a[href][rel="noopener noreferrer"]` | external link (http, https and mailto only) |
| `a.internal[href="#<blockId>"][data-section][data-block]` | link inside the document. Intercept it and navigate to that section and block. |
| `sup.noteref[data-atom][data-note="<noteId>"] > a[href="#<noteId>"]` | footnote reference |
| `section.notes[data-atom][role=doc-endnotes] > div.note[id=<noteId>][role=doc-footnote]` | the section's notes, at the end. Plain `#` jumps work; a UI can turn them into popovers. |
| `img[src="/api/assets/<sha>.<ext>"][alt]` | local image (content-addressed, cached forever) |
| `img[data-remote-src][alt]` | a remote image, not loaded unless the reader allows remote images |
| `.align-center`, `.align-right` | alignment the author set |

Block ids are derived from the block's text, so an unchanged paragraph keeps its id when the file is
edited. They work as React keys and for "keep my scroll position" after a live reload.

### Coordinate rule (the server guarantees it; a test enforces it)

A **block point** is `{ blockId, offset }`, where `offset` is a UTF-16 offset into the block's text. The
block's text is all text-node data inside its `[data-b]` element, in document order. It skips anything
inside a `[data-atom]` element (note reference labels), and each `<br>` counts as one `"\n"`.

A UI has two ways to say where a selection is. Both are accepted everywhere an `AnchorInput` is taken:

1. **`sectionRange`** gives `{ sectionId, start, end }` as offsets into the `textContent` of the section's
   HTML, exactly as `src/tools/useSelection.ts` computes them today. The server maps these offsets back
   to block points. This only works if the DOM text is unchanged: don't insert text into the body.
2. **`range`** gives `{ start: BlockPoint, end: BlockPoint }`, found by walking up to the nearest `[data-b]`
   element. This is more robust and survives UI-injected elements, as long as they are marked `data-atom`.

Send `revisionId` (from `Section.revisionId`) along with either one. If the file changed in between,
the server translates the coordinates. It answers `409 stale_revision` only when the old revision can
no longer be rebuilt. Send `selectedText` too, and the server checks it, answering
`409 selection_mismatch` if the text differs.

**Painting:** each anchored item has `anchor.segments` = `[{ sectionId, start, end }]` in the same
`textContent` coordinates. Paint them with the CSS Custom Highlight API (`new Highlight(range)`)
rather than by wrapping text, which would shift every later offset.

---

## Anchoring: how the app remembers places (M2/M3)

Every highlight, note, bookmark, reading place and tool record that points into a document holds an
**anchor**. The server computes its selectors (W3C Web Annotation style): the range, its position in
the whole document's text, and the quoted text with 32 characters of context on each side. When the
file changes, the server re-attaches every anchor:

1. **Same block, same text, same context** gives `anchored`; if the text is somewhere else, `moved`.
2. **The exact quote found elsewhere**, scored by its context and by how close it is to the old
   position, gives `moved`.
3. **A close match** (the quote was edited a little; only for quotes of 16 characters or more) gives
   `fuzzy`, with a `confidence`.
4. **Otherwise** `orphaned`. The item is kept and shown with its original words, and can be reattached
   by hand. If a later edit brings the text back, it reattaches by itself.

Nothing is ever deleted or silently moved to unrelated text. `anchor.originalQuote` never changes.

## Annotations (M2)

| Route | Body → result |
|---|---|
| `GET /documents/:id/annotations[?include=deleted]` | `Annotation[]` in reading order. Orphans come last. |
| `POST /documents/:id/annotations` | `CreateAnnotation` (an `AnchorInput` plus kind, color, style, body, tags, and an optional client `id`) returns `201 Annotation`. Re-sending the same `id` with the same payload returns 200 and the existing annotation. |
| `PATCH /annotations/:id` | `UpdateAnnotation` returns `Annotation`. `reattach` moves the annotation or rescues an orphan; `acceptAnchor` confirms a fuzzy match. |
| `DELETE /annotations/:id` | Soft delete, 204. |
| `POST /annotations/:id/restore` | Undo a delete. Returns `Annotation`. |
| `GET /annotations?q&tag&kind&docId&before&limit` | Across the library, newest first: `LibraryAnnotation[]`, which adds `docTitle`, `docAuthor`, `sectionTitle` and `href` (`/read/<doc>/<section>#<block>`). |
| `GET /highlights?q&tag&docId` | The same list, highlights and notes only. This feeds the Highlights page. |
| `GET /tags` | `{ tag, count }[]` |

Kinds:
- `highlight`: color + style.
- `note`: a highlight with a Markdown `body`, or a note on a point.
- `bookmark`: usually a collapsed range.

Colors are `yellow green blue pink purple` (or null). Styles are `highlight underline none`.

## Reading progress

`PUT /documents/:id/progress` takes the base `{ sectionId, offset, percent }`. With `point`, the block at
the top of the viewport, the place survives font changes and edits to the file, because `point` is
re-anchored like any annotation. `reason: "jump"` (TOC, internal link, search result) is recorded so a
"go back" can be offered from `GET /documents/:id/history` (M5).

**More than one device (M6).** There is one place per document. `deviceId` (*added*) says which paired
device wrote it; `null` is the computer.
- `updatedAt` (*added*, optional) is the client's time for the place. If the stored place is newer,
  nothing is written and the answer is `409 { error: { code: "progress_conflict", message }, progress }`,
  where `progress` is the current place (the OPDS Progression draft's rule). A newer place is stored
  with the client's time, never later than the server's clock. The web app never sends `updatedAt`, so
  for it the last write wins; it is for an app that saves places while offline.
- `progress.updated { sectionId, percent, deviceId }` is journalled when the place moves to another
  section or a different device writes it, not on every page turn. The web app refetches the document
  and the library on it; an open page doesn't move.

## Tool records: memory for smart tools (M2)

A tool (the UI's `src/tools/registry.ts`) persists anything it likes under its own id:

| Route | |
|---|---|
| `GET /tools/:toolId/records?docId&include=deleted` | `ToolRecord[]` |
| `POST /tools/:toolId/records` | `CreateToolRecord { id?, docId?, anchor?: AnchorInput, data }` returns `201 ToolRecord` |
| `GET /tools/:toolId/records/:rid` | `ToolRecord` |
| `PATCH /tools/:toolId/records/:rid` | `{ data?, anchor? }` |
| `DELETE /tools/:toolId/records/:rid` | soft delete, 204 |

`data` is opaque JSON up to 64 KB. Records with an anchor are re-anchored like annotations. This is
the intended home for things like looked-up words, saved answers, flashcards and links between
passages. A new tool needs no backend change.

## Settings and presets (M2)

Reading settings are **UI-owned**. The server stores opaque JSON objects and does not validate their keys.
There are two scopes: `global`, and one per document. The effective value is a shallow merge,
document over global. In a PATCH, a key set to `null` removes it from that scope. App settings
(the mirror folder, recording switches, idle shutdown, remote access) control the server. They are
local-listener only: a paired device never receives `app` (`mirror.dir` is a path on the computer) in
any settings response and cannot `PATCH /settings/app`.

| Route | |
|---|---|
| `GET /settings[?docId]` | `SettingsResponse { effective, global, document, app }`. `app` is sent on the local listener only. |
| `PATCH /settings/global` | patch returns `SettingsResponse` |
| `PATCH /settings/documents/:id` | patch returns `SettingsResponse` |
| `DELETE /settings/documents/:id` | resets the document to global, 204 |
| `PATCH /settings/app` | deep patch of `AppSettings` returns `SettingsResponse`. `remote: { enabled, origin }` turns the remote listener on and off at once, without a restart (see [Phones](#phones-the-remote-listener-m6)). |
| `GET /presets`, `POST /presets {name, values}`, `PATCH /presets/:id`, `DELETE /presets/:id` | named snapshots. Apply one by PATCHing its values into a scope. |

`shared/src/settings.ts` suggests a starting vocabulary (`ReadingSettingsSuggestion`).

## Journal and live stream (M2)

The server appends a `JournalEvent` in the same transaction as every change it makes. The event
types are listed in `ServerEventPayloads` in `shared/src/events.ts`. The UI can record its own
interactions:

| Route | |
|---|---|
| `POST /events` | `ClientEventInput[]` (up to 100 per call, each payload ≤ 4 KB) returns `PostEventsResult`. A category switched off in `app.record` is dropped, not stored. |
| `GET /events?docId&type&after&limit` | `JournalEvent[]` |
| `DELETE /events?docId&category` | purge, 204 |
| `GET /stream` | Server-Sent Events: `event: <type>`, `id: <seq>`, `data: <JournalEvent>`, plus a heartbeat comment every 20 s |

**Live reload:**
1. On `revision.created`, refetch the document detail and the `changedSectionIds`.
2. Keep the top visible `[data-b]` in place.
3. Then refetch annotations; an `annotations.reanchored` event follows.

Close the `EventSource` while the tab is hidden. It resumes with Last-Event-ID, so nothing is lost,
and browsers allow only 6 connections per origin.

On the remote listener the stream leaves out `source.*` events (their payloads carry paths on the
computer; `tree.changed` and `document.*` say the same thing to a UI), and it ends the moment its device
is revoked or remote access is switched off. Reconnecting then answers 401, which an `EventSource`
reports as `readyState === CLOSED`.

## Search, export, history (M4/M5)

| Route | |
|---|---|
| `GET /search?q&docId&in=text\|annotations` | `SearchHit[]` (FTS5, accent-insensitive), one per block |
| `GET /search/documents?q` | the same hits grouped per document, with title/author/file-name matches (see The reads folder) |
| `GET /documents/:id/export?format=md\|json` | One document's annotations |
| `GET /export` | `pager-export/1` JSON of the whole library: documents, revisions' identities, annotations, records, progress, settings, presets |
| `POST /import` | The same JSON. Returns `ImportResult`. Matching is by file hash (any version) or identifier. Imports for files not yet in the library wait and attach when the file is added. Local settings win, and newer annotations win. |
| `GET /documents/:id/history` | `HistoryEntry[]`: jumps, reading sessions, file edits and re-anchoring, newest first |
| `GET /documents/:id/sessions` | `ReadingSession[]` (kept only while `app.record.sessions` is on) |
| `POST /documents/:id/merge` | `{ intoId }`: move this document's annotations, records, place and settings onto another edition, then remove this one. Returns `{ moved, orphaned, document }`. |
| `POST /documents/:id/reload` | Re-read the file now |
| `GET /documents/:id/locate?blockId=` | `{ sectionId }` |
| `POST /mirror/rebuild` | Rewrite the Markdown mirror |

**Markdown mirror (M5).** One file per document goes in `<data>/notes/` (configurable, for example an
Obsidian vault). It holds front matter, `## Section` headings, and for each annotation the quote, the
note, its fields, a link back, and an Obsidian `^block-id`. The mirror is byte-stable and never
overwrites a file you edited; your version is moved aside first.

## Sync manifest (M6)

`GET /sync/manifest[?after=<seq>]` is what an offline copy of the library pulls (stage 2 of the iPhone
plan builds the mirror on it). It answers `SyncManifest`:

```
{ cursor: number, full: boolean,
  documents: [{ id, title, author?, format, relPath?, revisionId, contentHash, size, sectionCount, updatedAt }],
  deleted: [{ id, deletedAt }] }
```

- `cursor` is the journal's latest seq; send it back as `after` next time.
- Without `after`, the whole library: `full: true`, `deleted: []`.
- With `after`, only documents touched by `document.*`, `revision.created`, `document.merged` (both
  documents) and `import.applied` events since then; soft-deleted ones are in `deleted`.
- When the journal no longer reaches back to `after` (recorded interactions were purged from before the
  oldest surviving event) or `after` is beyond `cursor` (another database), the whole library again,
  with `full: true`.
- `contentHash` (sha256) and `size` (bytes) are the current revision's file.

## Phones: the remote listener (M6)

Remote access is **off by default**. With `PATCH /settings/app { remote: { enabled: true, origin } }`
the server starts a second listener on **127.0.0.1** only (`PAGER_REMOTE_PORT`, default 3007), meant
to sit behind `tailscale serve` (setup: [docs/iphone.md](docs/iphone.md)), and binds an iroh endpoint
for the phone app ([Phones over iroh](#phones-over-iroh) below). Both stop again when the setting is
turned off, closing their open streams. Port 3006 and its Host guard are unchanged.

- **`origin`** is the exact address the phone uses, e.g. `https://fedora.tail1234.ts.net` (https, or
  http on a loopback name for trying it out). The QR link and the CSRF check use it; the server never
  guesses it from `Host` or `X-Forwarded-*`. Enabling without it answers 400. On the local listener,
  `GET /health` adds `remote: { suggestedOrigin }` when `tailscale status --json` knows this computer's
  MagicDNS name.
- **`relay`** is your own iroh relay (`https://…`), or null for n0's public relays. Changing it
  restarts the endpoint.
- **Same app, same origin.** The remote listener serves the built web app and `/api` together. The app
  shell is served without a credential (it holds no user data); `/api` needs a paired device, except
  `GET /api/health`, `POST /api/pair` and `POST /api/pair/poll`.
- **Credential.** A paired device holds a 256-bit random token; the server stores only its sha256 and
  compares hashes in constant time. The web app holds it as a cookie, `pager_device` (`HttpOnly;
  Secure; SameSite=Strict; Path=/; Max-Age` 90 days, renewed on every cookie-authenticated answer),
  because `EventSource` and `<img>` can't send headers. A native app sends `Authorization: Bearer
  <token>`; an Authorization header always wins over the cookie.
- **Refused with 401 `unauthorized`:** no credential, an unknown one, a revoked device, or one unseen for
  90 days (`expired`; `last_seen_at` is written at most once a minute).
- **CSRF.** A change (anything but GET, HEAD, OPTIONS) authenticated by the cookie must carry
  `Sec-Fetch-Site: same-origin`, or no `Sec-Fetch-Site` and an `Origin` equal to `remote.origin`;
  otherwise 403. Bearer requests skip this: nothing sends them on the user's behalf.
- **Deny by default.** Only the routes below reach their handlers; everything else answers 403
  `forbidden` ("That isn't available from a phone.") before any handler runs. A test fails if a route is
  added to the server without being put on one of these lists.
- **No path on the computer leaves it.** `GET /documents/:id` leaves out `path`, settings responses leave
  out `app`, `/stream` leaves out `source.*`, `/tree` file errors and every error message name files,
  not where they are, and `/health` is replaced. A test calls every allowed GET route and the stream's
  replay and checks no answer contains the data folder, the reads folder, the mirror folder or `/home/`.

| Allowed from a paired device | |
|---|---|
| `GET /documents`, `GET /documents/:id`, `GET /documents/:id/sections/:sid`, `GET /documents/:id/locate`, `PATCH /documents/:id`, `PUT /documents/:id/progress`, `GET /documents/:id/history`, `GET /documents/:id/sessions` | reading; `PATCH` sets `saved` and the title and author overrides (database only) |
| `GET/POST /documents/:id/annotations`, `GET/PATCH/DELETE /annotations/:aid`, `POST /annotations/:aid/restore`, `GET /annotations`, `GET /highlights`, `GET /tags` | highlights and notes |
| `GET/POST /tools/:tool/records`, `GET/PATCH/DELETE /tools/:tool/records/:rid` | tool records |
| `GET /search`, `GET /search/documents` | search |
| `GET /settings`, `PATCH /settings/global`, `PATCH /settings/documents/:id`, `DELETE /settings/documents/:id`, `GET /presets` | reading settings |
| `POST /events`, `GET /stream`, `GET /assets/:file`, `GET /tree`, `GET /sync/manifest` | the journal (recording switches apply), the stream, images, the folder tree, the manifest |
| `GET /health` | answered by the remote listener itself: `{ app, apiVersion, version, remote: { device: { id, name } } \| null }` |

Refused: `PATCH /settings/app` and changes to presets; `GET /events` and `DELETE /events`; `/sources*`;
`POST /uploads`, `POST /files`, `POST /folders`, `POST /files/move`, `DELETE /files`, `POST /files/import`,
`GET /jobs/:id`; `DELETE /documents/:id`, `POST /documents/:id/reload`, `POST /documents/:id/merge`;
`GET /export`, `POST /import`, `GET /documents/:id/export`, `POST /mirror/rebuild`; `POST /shutdown`. The
device routes below don't exist on the remote listener at all.

**Pairing** follows RFC 8628's device flow, approved on the computer. The desktop opens a window (five
minutes, one waiting phone at a time) with an 8-letter code from RFC 8628's base-20 alphabet, shown as
`XXXX-XXXX` and compared case-insensitively, without dashes or spaces, in constant time against its
hash. Five wrong codes, approval, expiry or cancelling close it; a denial doesn't, so the right phone
can try again with the same code. The window lives in memory: a restart cancels it.

| On the remote listener, no credential | Body → result |
|---|---|
| `POST /pair` | `{ code, name }` (name 1–64 characters) → 201 `{ requestId, pollSecret }`. Wrong code → 400 (counts toward the five). No window → 404. Window closed (five wrong codes, expired, cancelled, used) or already taken by another phone → 410 `gone`. |
| `POST /pair/poll` | `{ requestId, pollSecret }` → 202 `{ status: "pending" }` until the desktop answers; then 200 `{ token, device: { id, name } }` with the cookie set, exactly once. Denied, expired, closed or already collected → 410. Poll every 2 s. |

Both refuse a request whose `Sec-Fetch-Site` is another site's or whose `Origin` isn't `remote.origin`
(403), so a page elsewhere can't spend the window's attempts.

| On the local listener only | |
|---|---|
| `POST /devices/pairing` | opens a window → 201 `{ code, url, expiresAt }`, where `url` is `${origin}/pair#code=XXXX-XXXX` (the fragment never reaches a server). 409 if one is open; 400 if remote access is off. |
| `GET /devices/pairing` | `{ open, code?, url?, expiresAt?, attempts, pending: { requestId, name, ip, at } \| null }`. `ip` is `X-Forwarded-For` as the bridge sent it (informational). |
| `POST /devices/pairing/approve` | `{ requestId }` → 201 `DeviceView`; the window closes |
| `POST /devices/pairing/deny` | `{ requestId }` → 204; the window stays open |
| `DELETE /devices/pairing` | closes the window, 204 |
| `GET /devices` | `DeviceView[] { id, name, createdAt, lastSeenAt, lastIp, endpointId, status: "active" \| "revoked" \| "expired" }`, newest first; `endpointId` is the phone's iroh endpoint, null for a phone paired over Tailscale |
| `PATCH /devices/:id` | `{ name }` → `DeviceView` |
| `DELETE /devices/:id` | revokes an active device (its next request is refused and its streams close), 204. On a device already revoked or expired, removes it from the list. |

`device.paired`, `device.renamed`, `device.revoked` and `device.removed` (payload `{ name }`, subject:
the device) are journalled; the pairing window is not.

### Phones over iroh

While remote access is on, the server also binds an **iroh endpoint** (the `iroh` crate, in the
process). This computer's ID is an Ed25519 public key whose secret lives at
`<data>/remote/endpoint.key` (mode 0600, made the first time remote access is turned on; deleting it
gives the computer a new ID, and every phone pairs again). A phone dials the ID and connects directly
when it can, through a relay when it can't. No socket listens for phones on this path: every QUIC
stream is handed to the remote app inside the process, and the peer's identity reaches the app as a
request extension, never as a header.

**`pager/1`** (the ALPN): one request per bidirectional stream.
- The client writes a u32 big-endian length, a JSON head `{ v: 1, method, path, headers }` of at most
  16 KB (`path` is the path and query inside the app, starting with `/`; `headers` an object of
  lower-case names to strings), then the body, then finishes its side.
- The server writes a u32 length, a JSON head `{ status, headers }` (repeated headers joined with
  `", "`), then the body, then finishes.
- A bad head resets the stream: 1 `BAD_HEAD` (not JSON, no method, or a method, path or header that
  isn't one), 2 `HEAD_TOO_LARGE`, 3 `BAD_VERSION`; 4 `INTERNAL` if the server fails while answering.
- A client that stops reading the response ends the request on the server; that is how a live stream
  is hung up.

**The accept gate.** After the handshake the server reads the peer's endpoint ID and closes the
connection at once (code 16 `NOT_PAIRED`) unless the ID belongs to an active device or a pairing
window is open. A phone keeps at most four connections (the oldest is closed, 19) with 32 requests in
flight on each. Revoking a device closes its connections (17); turning remote access off closes them
all (18).

**Credential.** Over iroh the only credential is `Authorization: Bearer <token>`, and it is accepted
only from the endpoint the device was paired from (`devices.endpoint_id`): a copied token is useless
from any other phone, and over the Tailscale path. A token paired over Tailscale (no endpoint) is
likewise refused over iroh. Cookies, CSRF and the pairing origin check don't apply: no browser is
involved. `lastIp` and the pairing request's `ip` show where the connection came from (`ip:port`, or
`relay`); `X-Forwarded-For` is ignored.

**Pairing over iroh.** `POST /api/pair` records the asking phone's endpoint ID with the request
(`pending.endpointId` on the desktop), and approval writes it to the device. A phone pairing again
replaces its earlier device: the old row is revoked, journalled as `device.revoked` with
`replaced: true`. While iroh is on, `POST /devices/pairing` and `GET /devices/pairing` also carry
`appUrl`, `pager://pair?v=1&t=<EndpointTicket>&code=XXXX-XXXX`: the link the phone app opens, whose
ticket holds this computer's ID, its relay and its current direct addresses. `url` stays the Home
Screen app's link.

**Health.** Over iroh, `GET /api/health` answers `remote: { device?, endpointId, relay? }`: this
computer's ID and the relay carrying it once one is reached, so the phone can refresh the ticket it
saved. The desktop's `GET /health` carries the same two fields while iroh is on.

A phone in Rust, for trying the whole path before the app exists: in `server/`,
`cargo run --example fake-phone -- '<appUrl>'` pairs and reads; `--relay-only` goes through the relay.

## Other routes

| Route | |
|---|---|
| `GET /health` | `Health { app: "pager", apiVersion: 1, version, pid, port, dataDir, readsDir, startedAt, remote? }` (the CLI uses it to recognise the server). On the remote listener: `{ app, apiVersion, version, remote }` only. |
| `GET /assets/<sha>.<ext>` | Images extracted from documents. Immutable, `nosniff`, sandboxed by CSP. |
| `POST /shutdown` | Stops the server. Used by `pager --stop`. |

## Errors

| Code | HTTP | When |
|---|---|---|
| `invalid_request` | 400 | Bad body or query; a wrong pairing code |
| `unauthorized` | 401 | Remote listener: no valid device credential. "Pair this phone with Pager to read your library." |
| `forbidden` | 403 | Host or Origin check failed; a cookie change without same-origin proof; a route a paired device may not call |
| `not_found` | 404 | No such document, section, annotation or path |
| `conflict` | 409 | Same client id, different payload |
| `stale_revision` | 409 | Coordinates refer to a revision that can no longer be rebuilt |
| `selection_mismatch` | 409 | `selectedText` doesn't match the range |
| `progress_conflict` | 409 | `updatedAt` is older than the stored place; the body carries `progress`, the current place |
| `too_large` | 413 | File over the limit |
| `unsupported` | 415/422 | A format not read yet (PDF), or a folder before M4 |
| `not_epub` / `drm_protected` / `empty_document` | 422 | The file can't be read as a book |
| `source_missing` | 410 | The file has moved or been deleted, and no cached copy is available |
| `gone` | 410 | A pairing code or request that is no longer valid: start again |
| `internal` | 500 | A bug. The message says so. |

## Security model

- The server binds only to loopback (127.0.0.1 and ::1).
- **Host check:** every request to the main listener (3006) must have a `Host` of `localhost`,
  `127.0.0.1` or `[::1]`, which protects against DNS rebinding.
- **Mutating requests:** `Origin` and `Sec-Fetch-Site`, when present, must be same-origin. The CLI
  sends neither and is allowed.
- **Remote access is off by default.** When it is on, a second listener, on 127.0.0.1 only (3007),
  answers paired devices behind `tailscale serve`, never Funnel or anything public, and an iroh
  endpoint answers the phone app, closing any connection that isn't a paired phone's (or a phone
  asking to pair while a window is open). The same app authenticates every `/api` request by device
  (cookie or bearer token, stored as a hash, revocable, 90-day idle expiry; over iroh a bearer token
  only, bound to the phone's endpoint), checks same-origin for cookie-authenticated changes, allows
  only the reading surface listed under [Phones](#phones-the-remote-listener-m6) (deny by default),
  answers a missing credential with 401 `unauthorized`, and sends no absolute path to a device. Device
  management and app settings exist on the main listener only.
- The server sends no CORS headers.
- **Pager writes only inside its reads folder and its data directory.** In the reads folder it creates
  the files and folders you ask for, renames and moves what you ask it to, and moves deletions into
  `.trash/`; it never edits the contents of a file you wrote. Everything else the app keeps is in its
  data directory (`$PAGER_DATA_DIR`, else `~/.local/share/pager`) and in the mirror folder. Files
  outside the reads folder are never written to.
- Remote images are not fetched unless allowed. While remote access is on, the iroh endpoint talks to
  its relay and to n0's discovery services, or only to `remote.relay` when that is set. Otherwise the
  server makes no other network calls. (To suggest the phone's address it runs `tailscale status
  --json`, a local command that asks the Tailscale daemon on this computer; it opens no connection
  itself.)

## CLI

- `pager <file>` starts the server in the background if it isn't running, copies the file into the
  reads folder, and opens `http://localhost:<port>/read/<docId>`. `pager <folder>` copies the folder's
  readable files in and opens the library.
- `pager` on its own opens the library.
- Flags: `--no-open`, `--port <n>`, `--stop`, `--status`.
