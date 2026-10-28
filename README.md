# Pager

A personal reading room. Your books live as files in a folder, `reads/`, and Pager shows that folder
as your library: open a book, add one, start a new file, make folders. Books are read page by page in
a calm, paper-coloured column. This folder holds the **web app** (this README) and, in `server/`
(Rust) and `shared/` (wire types), the local backend (see [API.md](API.md) and
[server/README.md](server/README.md)).

## Run it

```sh
npm install
npm run dev:server   # backend on :3006 (server/, built by cargo on first run), library in ./reads
npm run dev:api      # web app on :5176, proxying /api to :3006
```

The backend needs a stable Rust toolchain (https://rustup.rs). `dev:server` keeps its data in
`server/.data-dev`.

Preview mode, with no backend (`npm run dev`), serves four public-domain texts laid out as a pretend
folder; anything you drop or create is kept in the browser.

Other scripts: `npm test`, `npm run typecheck`, `npm run build`, `npm run format`; `cargo test` in
`server/` runs the backend's tests.

## The library is a folder

- Books live in `reads/` next to this README (`PAGER_READS_DIR` moves it). Folders inside it are
  folders in the app; empty ones show too. A `Welcome to Pager.md` is dropped in on first run.
- **Right-click** (or long-press, or the `⋯` on an item) to add a book, start a new file, make a
  folder, rename, move, or delete. Deleting moves the file into `reads/.trash/`, so nothing is lost.
- **Add a book** copies a file (EPUB, Markdown, HTML, plain text, Word) into the open folder: drop it
  anywhere on the library page, choose it, or type a path. `pager <file>` from a terminal does the same.
- **New file** writes a Markdown file with its title and author in the front matter and opens it.
  Write in it with any editor; the reader follows your edits and keeps your place and highlights.
- The **search bar** is always there and looks through every file: titles, authors, file names and
  the text itself, grouped per book with the matching passages. A passage opens the book on its page.
- **Compact** rows or **detailed** cards, sorted by name, when you last read, when added, or progress.
  Every book shows how much of it you have read.
- Edits made outside Pager (a file dropped into the folder in Finder, a rename, a deletion) show up
  on their own: the folder is watched.

## Reading

- Every book opens on a **title page**: title, subtitle, author, date, chapter count.
- The text is read **page by page**: click near either edge, press `→` `←` `Space` `PageDown`
  `PageUp` `Home` `End`, swipe on a phone, or nudge the wheel. Past a chapter's last page comes the
  next chapter's first; the footer says "p. 4 of 17".
- Your place is saved as the paragraph and character at the top of the page, so it survives a
  different text size, a resized window and edits to the file.
- Select words for a **highlight** or a **note**; click painted text to change, tag or remove it.
  Highlights are painted with the CSS Custom Highlight API, so the text the server sent is never changed.
- **Contents** (books), text size, serif or sans, light, dark or system theme, and a tool panel for
  smart tools (empty until tools are registered in `src/tools/index.tsx`).
- The **Highlights** page collects every highlight and note, with a link back to its page.

## What's here

| Area | Files |
|---|---|
| Design tokens (paper and ink, light and dark) | `src/styles/tokens.css`, `globals.css` (Tailwind v4 mapping), `prose.css` (reading typography, pages, title page). See [DESIGN.md](DESIGN.md) |
| App shell: left nav, icon rail, mobile bottom bar | `src/components/shell/` |
| UI primitives: buttons, context menu, dialog, popover, select, tiles, toast | `src/components/ui/` |
| Library: toolbar and search bar, breadcrumbs, folder view (compact and detailed items), search results, dialogs, add-book dialog, file drop | `src/pages/LibraryPage.tsx`, `src/components/library/` |
| Reader: paged view, pagination, title page, page footer, top bar, body, progress in page coordinates | `src/pages/ReaderPage.tsx`, `src/components/reader/` |
| Highlights and notes: selection bar, painting, popover, Undo toast | `src/components/reader/useReaderAnnotations.ts`, `useHighlightPainting.ts`, `AnnotationPopover.tsx`, `SelectionMenu.tsx` |
| Live reload from the backend's stream | `useLiveUpdates` / `applyServerEvent` in `src/api/hooks.ts`, `followStream` in `src/api/http.ts` |
| API contract, HTTP client, mock adapter, React Query hooks | `src/api/`, [CONTRACT.md](CONTRACT.md) |
| Phones: Settings → Phone (remote access, pairing dialog with QR code, paired phones), the `/pair` page, the Home Screen manifest and icons | `src/components/settings/`, `src/pages/PairPage.tsx`, `public/`, [docs/iphone.md](docs/iphone.md) |
| Smart-tools seam | `src/tools/` |

## Data modes

| Mode | When | Data |
|---|---|---|
| Preview (mock) | `VITE_API_URL` unset (`npm run dev`) | Four public-domain seed texts (`src/api/seed/`, see its `LICENSE.md`) in a pretend folder, plus anything dropped or created. State is in `localStorage` (`pager.mock.v1`) and can be reset in Settings. |
| Backend | `VITE_API_URL=http://localhost:3006` (`npm run dev:api`) | The `reads/` folder, read by the server. A production build served by the backend uses `VITE_USE_HTTP=1`. |

Pager settings (theme, text size, typeface, library view and sort, tool panel) are in `localStorage`
under `pager.settings`.

## Adding a smart tool

Register it in `src/tools/index.tsx`, which is imported once at startup:

```ts
import { BookA } from "lucide-react";
import { registerTool } from "./registry";

registerTool({
  id: "define",
  label: "Define",
  icon: BookA,
  Panel: ({ context }) => <div className="p-4">{context.selection?.text ?? "Select a word"}</div>,
  selectionActions: [{ id: "define", label: "Define", run: ({ selection }) => console.log(selection.text) }],
});
```

- A `Panel` appears in the reader's tool panel and on the Assistant page.
- `selectionActions` appear in a small bar over selected text.
- Tools get `{ doc, section, selection, progress }`. `selection` is `{ text, sectionId, start, end }` as
  offsets into the section's `textContent`, the same coordinates the backend's annotation API takes.
- Persist tool data through the backend's `/api/tools/:toolId/records`.

## On your iPhone

Pager can be read from your iPhone anywhere, over Tailscale, as a Home Screen app: off by default,
paired phones only, approved on this computer. Setup: [docs/iphone.md](docs/iphone.md). How it is
secured: API.md, "Phones: the remote listener".

## Stubbed or not built yet

- **Assistant:** a placeholder until tools are registered.
- **Preview mode limits:** it can't copy files from a path; EPUB and Word need the backend; its
  highlights never re-anchor because its files never change; its search is a plain substring match.
- **Not used yet from the backend:** export/import, reading history, settings sync and the interaction journal.
- **Not built:** an in-app editor (write in your own editor; the file is watched), PDF.

## Verified

- `npm run typecheck` is clean; `npm run build` succeeds.
- `npm test` passes 76 tests (mock adapter incl. the pretend folder and search; HTTP client routes;
  live stream; DOM coordinates; sanitiser; page arithmetic; library tree helpers; duplicate-title rule;
  tag rules; pairing and device calls). `cd server && cargo test` passes 113 (parsers incl. the
  Gutenberg golden hashes shared with the TypeScript parser, the reads folder, identity and moves,
  the watcher, re-anchoring incl. a randomised edit check, annotations, search, mirror, export and
  import, sessions, merging, the CLI, and the phones' listener: credentials, pairing, CSRF, the
  allowlist, no paths leaving it, progress conflicts, the sync manifest, phones over iroh).
- Run side by side with the earlier TypeScript server (deleted 2026-10-28) on copies of `reads/`, the Rust backend answered
  alike for the library list, the tree, every section of the three EPUBs and two Markdown files,
  seven searches, an annotation and its Markdown export (only ids, timestamps and ports differed).
- Driven in headless Chromium (the Playwright build in `~/.cache/ms-playwright`) at 1440×900 and
  390×844, light and dark, against the real backend with three Gutenberg EPUBs and a Markdown file in
  `reads/`: library in both views and inside a folder; item and background context menus; New file →
  the file is written and opens on its title page; search for a word in two books with marked
  passages; the title page; page turns; the last page of a chapter into the next and back; progress
  saved as a page and a block point; a highlight that stays painted after turning away and back; the
  tool panel; dark mode; the phone layout with a swipe. Preview mode: the pretend folder, reading,
  search and creating a file. Phones: at 390×844 on the remote listener, unpaired → `/pair` → code →
  approved on the desktop → library (Open is the only item action) → read → highlight (it shows on the
  desktop) → Settings names the device → revoked on the desktop → back to `/pair`; on the desktop,
  Settings → Phone: the switch starts and stops the listener, the QR dialog, Allow, rename, revoke, remove.
