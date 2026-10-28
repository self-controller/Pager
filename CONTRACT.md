# Pager API contract (UI side)

The routes and shapes the web app relies on. `src/api/types.ts` is the same contract as TypeScript and
`src/api/http.ts` is the client that calls it. Shapes for the reads folder and search are imported from
`shared/src/api.ts` as they are. The backend's other additions (annotations, tool records, settings,
events, stream, block model) are documented in [API.md](API.md); everything there is additive.

## Basics

- **Base path:** the UI only calls the relative path `/api`. In dev, Vite (port 5176) proxies `/api` to
  `VITE_API_URL` (the backend suggests `http://localhost:3006`), so CORS is never involved. In production
  the backend serves the built `dist/` and `/api` from one origin (build with `VITE_USE_HTTP=1`). A phone
  uses the same build from the remote listener's origin (API.md: Phones).
- **JSON** request and response bodies; timestamps are ISO-8601 UTC strings.
- **Errors:** `{ "error": { "code": string, "message": string } }`. `message` may be shown to the reader
  as-is, so write it as a calm sentence.

| Code | UI behaviour |
|---|---|
| `not_found` | "This isn't in your library" state; no retries. |
| `unsupported` | Shown as an info note, not an error (e.g. a path the preview build can't read). No retries. |
| `unauthorized` | Only from the remote listener (a phone not paired, revoked or expired). Any query or mutation failing with it sends the app to `/pair`; no retries. |
| `gone` | Only while pairing: the pairing page explains it and offers Start again. |
| `invalid_request`, `conflict`, `forbidden` | Shown inline (in the dialog that asked). |
| anything else | Shown inline. |
| network failure, or a 5xx with no JSON body (proxy 502/504) | Treated as `unavailable`: "Can't reach the reading service", with a Try again button. |

## Routes

| Method & path | Body | Returns | Notes |
|---|---|---|---|
| `GET /documents` | | `DocumentSummary[]` | Query: `kind=article\|book`, `saved=true\|false`, `history=true`, `sort=recent\|title\|added`, `q`. |
| `GET /documents/:id` | | `DocumentDetail` | `toc` lists sections in reading order; an article has one entry. |
| `GET /documents/:id/sections/:sectionId` | | `Section` | `html` must already be sanitised. The client sanitises again with DOMPurify. |
| `PATCH /documents/:id` | `{ saved?: boolean }` | `DocumentSummary` | |
| `DELETE /documents/:id` | | 204 | Removes it from the library; never touches the file. |
| `PUT /documents/:id/progress` | `ProgressUpdate` | `ReadingProgress` | Must set `lastOpenedAt`. |
| `GET /tree` | | `TreeResponse` | The reads folder: folders (empty ones too) and readable files, each file with its `docId` and `DocumentSummary`. |
| `POST /files` | `CreateFileInput { dir, title, author? }` | 201 `CreateFileResult { path, document }` | A Markdown file with front matter; read into the library before answering. |
| `POST /folders` | `{ dir, name }` | 201 `{ path }` | 409 `conflict` when the name is taken. |
| `POST /files/move` | `{ from, to }` | `MoveEntryResult { path, document? }` | Rename or move a file or folder; `to` is the full new path. |
| `DELETE /files?path=` | | 204 | Into the library's trash; the documents leave the library. |
| `POST /files/import` | `{ dir, path }` | 201 `IngestJob` | Copies a file (done) or a folder's readable files (async job) from a path on the machine. |
| `POST /uploads?dir=` | multipart, field `file` | 201 `IngestJob` | Written into `reads/<dir>/`. The UI does not set Content-Type (the browser adds the boundary). |
| `GET /jobs/:id` | | `IngestJob` | The UI polls every second until `done` or `error`, then refetches the library. |
| `GET /search/documents?q=` | | `DocumentSearchResult[]` | Title/author/file-name matches plus text hits, grouped per document; `[]` for an empty query. |
| `GET /health` | | `Health` | `remote.device` set means the app runs on a paired phone (remote mode). `remote.suggestedOrigin` (computer only) is offered in Settings → Phone. |
| `GET /settings`, `PATCH /settings/app` | `AppSettingsPatch` | `SettingsResponse` | The UI reads and writes `app.remote` only (Settings → Phone). Computer only. |
| `POST /devices/pairing`, `GET /devices/pairing`, `POST /devices/pairing/approve`, `POST /devices/pairing/deny`, `DELETE /devices/pairing` | `{ requestId }` for approve and deny | `PairingWindow`, `PairingState`, `DeviceView` | The pairing dialog; it polls `GET` every 2 s while open, and cancels an open window when closed. Computer only. |
| `GET /devices`, `PATCH /devices/:id`, `DELETE /devices/:id` | `{ name }` | `DeviceView[]`, `DeviceView`, 204 | The paired phones list: rename, Revoke (active), Remove (revoked or expired). Computer only. |
| `POST /pair`, `POST /pair/poll` | `{ code, name }`, `{ requestId, pollSecret }` | `PairRequestResult`, then `{ status: "pending" }` (202) or `{ token, device }` | The phone's `/pair` page, every 2 s. The cookie that comes with the token is the credential; the page ignores the token in the body. Remote listener only. |

**Paths** are relative to the reads folder, POSIX separators, no leading slash; `""` is the root. The
server refuses `..`, hidden segments and anything that resolves outside the folder.

**Reserved:** `/api/highlights*` and `/api/tools/*` belong to the smart tools. API.md defines what lives
there. `/api/sources*` is deprecated and unused by the UI. `/api/pair*` and `/api/devices*` belong to
pairing phones.

## Semantics the UI depends on

- **`sort=recent`** orders by the later of `lastOpenedAt` and `addedAt`, newest first. `added` orders by `addedAt` desc. `title`
  orders case-insensitively A to Z.
- **`history=true`** returns only documents with `lastOpenedAt`, most recently opened first. `sort` is ignored.
- **`relPath`** on a summary is the file's path inside the reads folder; the library's search results use it
  to show the folder.
- **Progress:** the reader is paged. `offset` is the page as a 0–1 fraction of the section
  (`page / (pageCount − 1)`, 1 for a one-page section). `percent` is 0–1 over the document; the client sends
  `(sectionIndex + offset) / sectionCount` and the server may replace it with something character-weighted.
  The UI saves progress once when a section opens, then on page turns with a 1 s debounce, and again when the
  tab is hidden or closed. Clamp values to 0–1 and do not reject them.
- **Section ids** are stable within a document; `prevId` and `nextId` link reading order. The router uses
  `/read/:docId/:sectionId?`, and the CLI may open `/read/<docId>`.
- **Deep links:** `/read/<docId>/<sectionId>#<blockId>` opens the section on the page holding that block (by `id`
  or `[data-b]`) instead of the saved position. In-text links are routed by the UI: an `a.internal` whose
  `data-section` differs from the open section navigates to that deep link; same-section `#id` links and
  footnote refs turn to the page in place without changing the URL.
- **Title page:** the first section of every document is preceded by a title page (title, subtitle, author,
  date, chapter count) rendered outside the section body. If the section's first element is a heading that
  repeats the document title, the UI hides it with a class (`is-duplicate-title`). It is never removed, so
  `textContent` offsets are unchanged.
- **`publishedAt`** may be a bare year (`"1847"`) or an ISO date.
- **Card fields:** `sectionCount`, `excerpt` (about 200 characters of plain text) and `coverUrl` are optional; the
  UI degrades without them. Books without `coverUrl` get a generated cover. `estimatedMinutes` is sent but not shown.
- **Selections** (for tools and highlights) are `{ sectionId, start, end }` offsets into the section
  body's `textContent`. Text the UI injects into the body will carry `data-atom` so it can be left out;
  none is injected today (the title page sits outside the body). Highlights are painted with the CSS Custom
  Highlight API, not by wrapping text, so the section DOM stays exactly as the server sent it.

## On a phone (remote mode)

- **Pairing** is the `/pair` route, outside the app shell (no navigation). It reads `#code=` from the QR
  link or takes a typed code (formatted as `XXXX-XXXX`) and a device name ("iPhone"), posts it, shows
  "Waiting for approval on your computer…" and polls. On success it asks for persistent storage
  (`navigator.storage.persist()`, result ignored) and reloads at `/`. When `navigator.standalone` is
  false (Safari, not the Home Screen app) it says to add Pager to the Home Screen and pair from there,
  since the installed app has its own cookies.
- **Remote mode** is `health.remote.device`. Until health answers, the file actions stay hidden. In
  remote mode the library has no Add a book, New file, New folder, Rename, Move or Delete (toolbar,
  context menus, the `⋯` menu, F2 and Delete keys, the empty folder's buttons) and no file drop;
  Settings → Connection says "Reading from your computer as <name>" and there is no Phone section. The
  server refuses all of these anyway.
- **No service worker** in this stage: the app needs the computer to be reachable.
- **Over iroh** the same UI runs inside the phone app, whose scheme handler carries `/api` requests
  as `pager/1` frames (API.md, Phones over iroh) with a bearer token the app keeps; the UI's `/api`
  base stays relative and it never holds the credential. On the computer, Settings → Phone shows this
  computer's ID and relay from `health.remote`, and each paired phone says "over iroh" when it is.

## How the UI uses the backend's additions (API.md)

- **Highlights and notes:**
  - `POST /documents/:id/annotations` with a client `id`, `revisionId` from the section, `sectionRange` (the
    selection's textContent offsets), `selectedText`, `color` and, for notes, `kind: "note"` plus `body`.
  - `GET /documents/:id/annotations` feeds painting; segments are painted only for the open section.
  - `PATCH` handles colour, note, `tags` and `acceptAnchor`, plus `reattach` (`revisionId`, `sectionRange` and
    `selectedText` of the new selection) for moving an orphan by hand. `DELETE` then `POST …/restore` backs Undo.
  - `GET /highlights?q&tag&docId` and `GET /tags` feed the Highlights page; orphans are listed under "Couldn't
    find these".
- **Progress:** every `PUT …/progress` also sends `point` (the leaf `[data-b]` block at the top-left of the
  page and the character offset there), plus `revisionId`. `reason: "jump"` marks arrival by contents, an
  in-text link or a deep link. Resume prefers `point` unless `anchor` is `orphaned`, then falls back to `offset`.
- **Live stream:** one `EventSource('/api/stream')`, opened at startup only in backend mode. It is closed while the tab
  is hidden and reopened with `?after=<last seq>`. When it errors with `readyState === CLOSED` (the server refused it: a
  phone not paired or revoked) it is not reopened; pairing reloads the app.
  - `revision.created` refetches the document, its changed and removed sections, and its annotations. The open
    section keeps the same words on the page.
  - `annotation.*` and `annotations.reanchored` refetch the document's annotations and the Highlights lists.
  - `document.*`, `source.*`, `job.updated`, `document.merged`, `import.applied` and `tree.changed` refetch the
    library: the document lists, the tree and any search.
  - `progress.updated` (another device, or another section) refetches the document and the document lists, so the
    library's progress and a book opened next show the new place. An open reader page doesn't move: the reader's URL
    always names the open section (`/read/<doc>` is replaced with `/read/<doc>/<section>` once it opens).
  - `device.*` refetch the paired phones list.
  - If an old section id now resolves to a different section, the UI replaces the URL with the new id.

## Mock adapter differences

With `VITE_API_URL` unset, `src/api/mock.ts` implements this contract in the browser:

- It serves four public-domain texts laid out as `Novels/`, `Stories/` and `Essays/Bacon/`.
- It reads dropped or created `.txt`, `.md` and `.html` files; `POST /files/import` answers `unsupported`.
- It keeps state in `localStorage` under `pager.mock.v1` (documents, uploads, folders, moves, annotations).
- Its Markdown sectioning is simpler than the backend's: it splits on `##` when there are two or more.
- Its search is a case-insensitive substring match with ±60-character snippets; hits carry no `blockId`.
- Its annotations are anchored by `sectionRange` only and never re-anchor, since its files never change. It has no
  live stream.
- It has no server: health, app settings, pairing and devices answer `unsupported`, and Settings has no Phone section.
