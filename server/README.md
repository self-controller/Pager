# Pager — the backend

Pager is a local reading service. Your library is a folder (`reads/`, see below); every readable
file in it is read the way the author structured it: chapters, headings, lists, quotes, tables,
figures and footnotes. The service then remembers everything the reader does with it (highlights,
notes, bookmarks, where you stopped, display settings, and anything a tool wants to keep), and keeps
all of that attached when the file changes.

The UI lives at the Pager root (`src/`, Vite on 5176). The API contract is in
[`../CONTRACT.md`](../CONTRACT.md), which is the UI's base, and [`../API.md`](../API.md), which
covers everything this server adds. Wire types are in [`../shared/src/`](../shared/src).

## Run it

A stable Rust toolchain is needed (https://rustup.rs).

```sh
cargo run --bin pager-server           # :3006, library in ../reads, data in ~/.local/share/pager
cargo test                             # 113 tests, fixtures in tests/fixtures
cargo build --release                  # target/release/{pager-server,pager}
cargo run --release --example iroh-bench      # Phase 0 gate: iroh throughput and latency on loopback
cargo run --example fake-phone -- '<appUrl>'  # a phone in Rust: pairs over iroh and reads
```

With the UI running against it: `npm run dev:server` (data in `server/.data-dev`) and
`npm run dev:api` in the Pager root.

### The `pager` command

```sh
ln -s ~/Desktop/projects/Pager/bin/pager ~/.local/bin/pager   # once
pager ~/Books/persuasion.epub   # starts the service if needed, copies the file into the library, opens it
pager ~/Books                   # copies a folder's books in
pager                           # opens the library
pager --status | --stop | --no-open | --port 4000
```

- `bin/pager` builds `target/release/pager` when it is missing or older than the sources, then
  runs it.
- The command starts the service in the background, logging to `<data>/logs/server.log`. A service
  started this way stops itself after six hours with no open tabs; the time is set in
  `PATCH /api/settings/app { idleShutdownMinutes }`.
- It opens the Vite dev UI if that is running. Otherwise it opens the server's own origin, which
  serves `../dist` once the UI is built with `VITE_USE_HTTP=1 npm run build`.

**Environment variables:**

| Variable | Effect |
|---|---|
| `PAGER_DATA_DIR` | data folder (default `$XDG_DATA_HOME/pager`, i.e. `~/.local/share/pager`) |
| `PAGER_READS_DIR` | the library folder (default `<repository>/reads`) |
| `PAGER_PORT` | port (default 3006) |
| `PAGER_REMOTE_PORT` | the remote listener for paired phones (default 3007, on 127.0.0.1 only; listening only while `app.remote.enabled` is on) |
| `PAGER_WEB_DIR` | where the built UI is (default `../dist`, served when it has an `index.html`) |
| `PAGER_BACKGROUND=1` | stop after six idle hours (set by the `pager` command) |

## What it reads

| Format | How | Structure kept |
|---|---|---|
| EPUB 2/3 | `zip`, plus the HTML walker (container/OPF/TOC logic from `reader-apps/margin`) | Sections from the table of contents, with depth from its nesting; files cut at TOC fragments; footnotes (EPUB 3 asides, and passages in non-linear files that the text links to); images; cover; internal links; Gutenberg header and licence set apart |
| Markdown | `comrak` (CommonMark + GFM) with front matter | Headings, nested and task lists, tables with alignment, code, quotes, `> [!note]` callouts, footnotes (numbered as GitHub numbers them), reference links, local images, raw HTML (parsed, never passed through) |
| Plain text | heuristics (after `reader-apps/cadence`) | Paragraphs, chapter headings, verse, centred lines, scene breaks, lists, Gutenberg sections; UTF-8, UTF-16 and Windows-1252 |
| HTML | the same HTML walker | Landmark trimming only (`<main>`/`<article>`, else body minus nav, header and footer); no Readability, so the author's structure stays |
| Word (.docx) | `zip`, read straight from its XML | Heading styles, lists, tables with merged cells, footnotes, images, alignment, document properties |

The HTML walker sits on `util/soup.rs`, a small forgiving tag-soup parser shaped like htmlparser2,
so EPUB, HTML, Markdown's raw HTML and Word's XML are all read the same way. PDF answers
`unsupported`.

**Limits** (`config.rs`):
- files up to 200 MB, text up to 20 MB, images up to 30 MB;
- zip archives up to 1 GB unpacked and 5,000 entries.

## The reads folder

The library *is* a folder. On start the service makes `reads/` if it is missing, copies
`samples/welcome.md` into it once when it is empty, registers it as the folder source "Reads", scans it
and watches it. `GET /api/tree` lists it (empty folders too) with each file's document; `POST /api/files`,
`POST /api/folders`, `POST /api/files/move`, `DELETE /api/files` and `POST /api/files/import` make, rename,
move, trash and copy things in (`src/library/reads.rs`). Every path is resolved inside the folder and
refused if it would leave it. Deletions go to `reads/.trash/<timestamp>/`, and a file put back brings its
document back. Renames keep the document, its anchors and its place; a title that only came from the
file name follows the name.

The watcher follows changes made outside Pager too: a file that appears is read, a file that vanishes
leaves the library (and returns if it comes back), and a coalesced `tree.changed` event tells the UI.

Pager writes only inside this folder and its data directory. It never edits the contents of a file
you wrote, and never writes to files anywhere else.

## How it works

```
file ─ detect ─ converter ─ Block tree ─ sections ─ HTML (data-b on every text block)
                               │
                 content-hash block ids, plain text per block
                               │
           revision (cached JSON) ── anchors re-attached on every new revision
```

- **One block model for every format** (`src/model/document.rs`, mirroring `shared/src/document.ts`).
  The server renders HTML from it in a fixed vocabulary, so nothing from a file reaches the page
  unfiltered. The block's plain text is the coordinate space for everything attached to the document.
- **Block ids are content hashes:** `b` plus base62 of sha256(type + text), with `-2`, `-3` for
  repeats. An unchanged paragraph keeps its id across edits.
- **Every parse is a revision** of a document. Identity follows the path, then the bytes:
  - a moved file is the same document;
  - a second copy of a book is the same book;
  - a copy of a file you edit is a new document.
- **Live reload.** Files you edit (Markdown, text, HTML, Word) are watched through their parent
  folder, so atomic saves count. A change makes a new revision and re-anchors everything. Each step
  is announced on `GET /api/stream`.

## How it remembers

The question was how the app can remember annotations, and later anything else the reader does. The
answer has three tiers, and one rule:

> Anything attached to a **place** in a document holds an **anchor**, and one engine keeps every
> anchor attached when the file changes.

**Anchors** (`src/anchoring/`) are multi-selectors in the style of the W3C Web Annotation model:
- the block range (`{blockId, offset}` at each end);
- the position in the document's text;
- the quoted words, with 32 characters of context on each side.

When a document gets a new revision, `locate()` tries these in order:
1. **The same place.** Same ids, same text, and the context agrees, so it is `anchored`. Repeated
   paragraphs are never trusted by id alone.
2. **The same words elsewhere.** These are scored by context and by distance from where they were,
   giving `moved`.
3. **A close match.** For quotes of 16 or more normalised characters, Myers approximate search finds
   the passage, edges are refined by the quote's surviving first and last words, and long quotes are
   located by chunk voting. The result is `fuzzy`, with a confidence.
4. **Otherwise `orphaned`.** It is kept, with its original words, and can be reattached. If the text
   comes back, it reattaches by itself.

Quotes are compared after folding curly and straight quotes, dashes, accents and spacing. Wrong
attachments are worse than orphans, so the thresholds are conservative. A property suite checks this
against a character-tagging oracle; see `tests/reanchor.rs`.

**Tier 1: first-class state.**
- Annotations: highlight, note and bookmark, with color, tags, soft delete and undo, and idempotent
  client ids.
- The reading place, stored as a re-anchored point, so a font change or an edit doesn't lose it.
- Per-document and global settings: opaque JSON owned by the UI, with presets.
- **Tool records** (`/api/tools/:toolId/records`): opaque JSON, optionally anchored. This is where
  "eventually other things" go (looked-up words, saved answers, flashcards, links between passages),
  and none of them needs a schema change.

**Tier 2: the journal** (`events`).
- An append-only log, written in the same transaction as each change. It feeds the live stream (the
  SSE id is the sequence number, so reconnects lose nothing), history, and later sync or undo.
- The UI records its own interactions with `POST /api/events`.
- Each category has a recording switch, and "off" means nothing is written. `DELETE /api/events`
  forgets.
- Projections are added only when something needs them: reading sessions, and the jump history for
  "go back".

**Tier 3: portable copies.**
- **A Markdown mirror** of each document's annotations, in `<data>/notes/` or any folder (for
  example an Obsidian vault). It is byte-stable and debounced, carries `^block` ids, and lists
  orphans in their own section. It never overwrites a file you edited: your version is moved aside
  first.
- **`pager-export/1` JSON** (`GET /api/export`, `POST /api/import`). Anchors travel as words and
  context, and documents are matched by the hash of any version Pager has seen. Imports for files
  that aren't in the library yet wait, and attach as soon as the file is added.

## Data folder

```
pager.db           SQLite (WAL): sources, documents, revisions, anchors, annotations, tool_records,
                    progress (with device_id: who wrote the place), settings, presets, events, FTS5
                    indexes, reading_sessions, mirror_files, devices (paired phones: name, sha256 of
                    the token, last seen, revoked_at, endpoint_id for phones over iroh)
cache/<rev>.json    parsed revisions (rebuildable from the file or its snapshot)
files/              snapshots of the last 3 revisions of small text files
assets/             images, content-addressed (<sha256>.<ext>)
notes/              the Markdown mirror
backups/            a copy of pager.db before each schema upgrade
logs/               background server log
remote/endpoint.key this computer's iroh identity
server.json         pid/port of the running server (for the CLI)
```

Migrations (`src/db/migrations.rs`) are append-only, applied by `PRAGMA user_version`. A newer
database is refused rather than damaged. v1–v5 are the schema of the earlier TypeScript server this
crate was ported from (deleted 2026-10-28); v6 (`devices.endpoint_id`) is this crate's own.

## Security

- The server binds only to loopback.
- Requests whose `Host` isn't a loopback name are refused, which guards against DNS rebinding.
- Changes from another origin are refused.
- No CORS headers are sent.
- Images are served `nosniff` and sandboxed by CSP.
- The only network access is a remote image, and only when the UI chooses to load it, and iroh
  while remote access is on. (Settings → Phone may run `tailscale status --json`, a local command,
  to suggest the phone's address.)
- **Phones** (off by default; setup in [`../docs/iphone.md`](../docs/iphone.md)). Turning on
  `app.remote` starts a second listener on 127.0.0.1:3007 for `tailscale serve` and an iroh endpoint,
  and turning it off stops them, without a restart. Both run their own router (`src/http/remote.rs`)
  in front of the same API:
  - every `/api` request needs a paired device: a 256-bit token, as an `HttpOnly; Secure;
    SameSite=Strict` cookie or a bearer header, stored as a sha256, refused once revoked or after 90
    idle days (401 `unauthorized`); over iroh the bearer header is the only credential, and the
    token is bound to the phone's endpoint;
  - cookie-authenticated changes must prove same origin (`Sec-Fetch-Site` or `Origin` = `app.remote.origin`);
  - routes are denied by default; `REMOTE_ALLOW` opens reading, progress, highlights, tool records,
    search, reading settings, the stream, images, the tree and the sync manifest, and a test fails if
    a new route is on neither `REMOTE_ALLOW` nor `REMOTE_DENY`;
  - no absolute path is sent to a device: detail `path`, settings `app` and `source.*` events are left
    out, and error messages keep only file names;
  - pairing is RFC 8628's device flow (an 8-letter code, five tries, five minutes, approved on the
    desktop); device management exists on 3006 only.

## Layout

```
src/ingest/      detect, decode, html walker, markdown, text, htmldoc, epub, docx, builder (ids, links, sections)
src/render/      blocks → section HTML
src/anchoring/   normalise, selectors, matcher and approx (Myers search, locate), store, doctext
src/library/     identity & revisions, assets, watcher, folders, reads (the library folder), jobs, merge, manifest
src/devices/     paired devices (tokens, expiry, revocation), the pairing window, the tailnet name
src/remote/      phones over iroh: the identity key, the pager/1 protocol, the endpoint, the bridge
                 into the remote app, and the client the tests and fake phone use
src/annotations.rs src/records.rs src/settings.rs src/journal/ src/search.rs src/mirror/ src/export.rs src/sessions.rs
src/http/        routes (library, files, remember, keep, system, sync, devices), the local-only guard,
                 remote (the phones' listener and its allowlist), the live stream, static web serving
src/cli.rs       the `pager` command (bin/pager)
tests/           10 files, 97 tests (16 more are unit tests in src/): parsers (with the Gutenberg
                 golden hashes; files in tests/fixtures), the reads folder, the watcher, re-anchoring,
                 the remote listener's allowlist, no-paths and pairing, phones over iroh, sync
```

The dev profile in `Cargo.toml` trims debug info and turns off incremental compilation so `target/`
stays small.

**Reused from `../../reader-apps`:**
- margin: EPUB container, TOC and Gutenberg logic, `normalise()`, locator ideas;
- cadence: TXT heuristics, noteref rules;
- ebb: migrations and clock;
- commonplace: atomic, byte-stable writes and own-write detection.

## Not done (yet)

- PDF.
- An in-app editor (the reads folder is meant for your own editor; files are watched).
- A two-way mirror (editing notes in Obsidian and reading them back): the ids are already embedded.
- Multi-device sync: uuid-like ids, `updated_at`, tombstones, the journal, bearer tokens, the progress
  conflict rule and `GET /api/sync/manifest` are in place for it; the offline mirror (stage 2) isn't built.
- A "what changed since you last read" view: source snapshots are kept for it.
- W3C JSON-LD export.
- Using publisher CSS or embedded fonts.
- Sentence-level features (cadence's segmenter is ready to reuse).
