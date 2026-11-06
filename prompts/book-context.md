# Build: "Context", a sourced background briefing for the open book

## Branch
This is a new AI feature. Work on the branch `ai-book-context`, which already exists. It
was cut from `main` on 2026-11-05, after `reader-ux-ios` was merged into `main`. Never
commit to `main` or `reader-ux-ios`. Commit on `ai-book-context` per phase, and leave
merging and pushing to the user.

## Goal
From the reader's Tools panel (and the Assistant page), the reader taps **Context** on the
open book and gets a briefing on what they need to know *around* this book before or while
reading it. Every claim links to a real, checkable source. If a claim has no source, it
isn't shown.

## What the briefing covers (sections, in this order)
Revised 2026-11-05 after the first live run, at the user's direction:
- **The briefing replaces homework.** Most of it is historical and situational context.
  It explains in place whatever the book assumes, rather than sending the reader to read
  something first.
- **Pre-reading only when the book can't be followed without it.** Each suggestion
  invites the reader to go back one more step before starting, and the models tend to keep
  adding such steps. So there are no "helpful" or "optional" tiers.
- **The page connects ideas, people, places and readings.** It does so with a connection
  map (a tree or network), plus a timeline and a map where the data supports them.

1. **The book in one paragraph** (`overview`): what it is, when and where it was
   written, and what kind of book it is (novel, treatise, polemic, reply to someone, …).
2. **Read first** (`readFirst`): usually absent. An item appears only when the book can't be
   followed without it, for example a direct reply to, sequel to, or commentary on one
   specific text that the book assumes and doesn't restate. Rules for an item:
   - at most one, two at the very most;
   - the narrowest scope that works ("chapter 1 only", "a two-page summary is enough"),
     with a time estimate and a claim giving the specific reason;
   - never reading for the reading;
   - never an item saying that nothing is needed;
   - it must name a real work, or the verifier drops it.
3. **Historical moment** (`moment`): the events, institutions, debates and assumptions of
   the author's time that the book takes for granted. 2–4 items.
4. **The author's situation** (`situation`): where the author was in life and work, why
   and for whom the book was written, the circumstances of writing, and how it first
   appeared and was received. 2–4 items.
5. **The author's conversation** (`conversation`): people, works and movements the
   author was reading, answering, attacking or building on, each with its relation
   ("replies to", "borrows from", "satirises"). 2–5 items.
6. **Key terms and names** (`terms`) the book uses without explaining them, and that the
   sections above don't already explain. 0–6 items.
7. **Further reading** (`furtherReading`): for *after* the book. At most 3 items, each with
   a record and one line on who it suits.

**The connection map:**
- **Entities:** 6–15 people, works, ideas, movements, institutions, places and events.
  The book is `book` and the author is `author`. Each has a Wikidata ID where there is
  one, and a catalogue record for works.
- **Links:** 5–20 relations between entities ("read", "replied to", "studied under",
  "lived in"). Each is a claim cited and verified like any other.
- **Dates and coordinates** come from Wikidata, fetched by the verifier, never written by
  the model. That gives a timeline (births and deaths, publication, events) and a map
  (places) that are sourced too.

**Length:** a reader takes it in within about 3 minutes, about 12–20 claims. The verifier
caps the sections at 24 claims (links aside), trimming the last items of terms, then
conversation, then situation, then moment.

## Sourcing rules (the core requirement)
- Run a retrieval step: web search plus bibliographic lookups (Open Library, Crossref,
  Wikidata, publisher and university pages, SEP/IEP, JSTOR landing pages). Draft each
  claim from what was retrieved, not from model memory alone.
- Every book or article you recommend must resolve to a real record: an ISBN, DOI,
  Open Library ID, Wikidata ID, or a stable URL that the computer fetched and checked.
  If no record resolves, drop the item. Never invent a citation, a page number or a quote.
- Each claim gets 1–3 citations: title, author, year, link. Prefer scholarly and
  reference sources over blogs; use Wikipedia only to get your bearings, never as the
  only source.
- **Every web citation carries a short verbatim quote** from the cited page (decided
  2026-11-05). The computer checks that the quote appears on that page; if it doesn't,
  the citation is dropped.
- Where scholars disagree (for example about the author's influences), say so and cite
  both sides. Don't flatten the disagreement.
- Put a confidence mark on anything that is inferred rather than stated by a source. An
  inferred claim still cites the sources it was inferred from.

### What "verified" means (the verifier applies these rules mechanically, without a model)
| What | Kept when |
|---|---|
| A recommended work with an ISBN | The checksum is valid, Open Library's `/isbn/<isbn>.json` answers, and its title and author match the work as named. |
| A work with an Open Library, DOI or Wikidata ID | The record resolves (Open Library, Crossref, Wikidata), and its title (and its author, where the record names one) matches. |
| A work given only as a URL | The URL answers 2xx, and the page's title or text contains the work's title. |
| A page citation on a claim | Its quote is found on that page: first in the text the run itself fetched, otherwise in the computer's own fetch of the URL. Matching ignores case, punctuation, curly quotes and spacing. A quote is 6–60 words. |
| A record citation on a claim | Allowed only for bibliographic facts (what a work is, who wrote it, when). The record resolves and matches. |

- A map entity keeps its Wikidata ID only if Wikidata's label or one of its aliases matches
  the name. Its dates and coordinates then come from Wikidata (one SPARQL query per run).
  A work entity's record is checked like any work. A link survives only if its claim does
  and both ends exist. Entities nothing points at are dropped, except the book and the
  author.
- Pre-reading without a work is dropped. Titles are compared without bracketed text, and
  one changed letter in a word of five or more letters is allowed ("Thus Spoke" against
  "Thus spake").
- A claim with no surviving citation is dropped. A claim whose only surviving
  citations are on wikipedia.org is dropped.
- A disagreement with a side that has no surviving citation is dropped whole.
- Items, and sections, left empty after drops are removed. The model never sees the
  verifier's output, so nothing is re-drafted to fill the gaps.

## Input from the book
- Use metadata (title, author, date, publisher) and front matter (preface, introduction,
  translator's note, bibliography, the notes) as signals. Names and works cited in the
  book itself are strong leads for section 3.
- Extract locally, on the computer: pull names, works and terms from the notes,
  bibliography, italic or quoted titles, and recurring capitalized names. Send the model
  only these short lists plus metadata and front matter, never chapters of body text. The briefing is
  about the book's context, not its plot. Spoiler rule: never reveal plot events. If a
  context item gives away the ending, hide it behind a marked "contains spoilers" fold.
- EPUB ingest keeps title, authors, one identifier, language, date and description, but
  drops publisher, translators, editors and subjects. The extractor reads the OPF again
  for those, without changing ingest.
- Front matter means the sections before the first chapter-like heading, plus any
  section titled like a preface, introduction, foreword, translator's or editor's note,
  "note on the text", advertisement, "to the reader" or "historical sketch" (the
  "Historical Sketch" in later editions of Darwin's *Origin* counts; the first edition,
  our test book, has none). It is capped at 4,000 characters per section and 12,000
  in total. Sections titled like notes, a bibliography, works cited, references or a
  glossary feed the name and work lists. Project Gutenberg licence sections are skipped.
- List caps: 60 names, 40 works, 30 terms.

## Architecture (Pager)
- Register a `PagerTool` (id `context`) in `src/tools/registry.ts` with a `Panel`. Also
  add a selection action, "Context for this", which runs the same pipeline on a selected
  name or work, narrowed to that one item.
- The backend does the work in the Rust server under `/api/tools/context/*` (see
  CONTRACT.md): it calls the LLM with a search tool, then a verification pass that
  resolves every citation, then stores the result.
- The pipeline, in order:
  1. **Extract** (local): metadata, front matter and the name, work and term lists.
  2. **Seed lookups** (no model): the book on Open Library, the author on Wikidata.
  3. **Research and draft** (the model): web search, web fetch and three client tools,
     `find_book` (Open Library search), `find_article` (Crossref search) and
     `find_entity` (Wikidata search), so works and map nodes carry real identifiers
     rather than remembered ones. The model hands back the
     briefing by calling a strict `submit_briefing` tool.
  4. **Verify** (no model): the rules above.
  5. **Store**, and log the run's counts.
- Cache the result per book (keyed by book ID + content hash) so it costs money once.
  Offer "Refresh", and show when the briefing was generated. When the book's file
  changes (a new content hash), keep showing the newest older briefing, with no extra
  note, only its creation date (decided 2026-11-05). Refresh makes a new one.
- A run lives on the server. It survives a closed connection, but not a server restart:
  runs still marked running at startup become failed ("interrupted"). At most 2 runs at
  once, across all books.
- Briefings are a cache: they are not part of Pager's export.
- Return structured JSON (sections → items → claims → citations[]), not prose, so the UI
  can render tiers, links and folds, and the verifier can check each citation.
- The UI follows DESIGN.md: black and white plus ink blue, no chat bubbles. The briefing is
  a document. Each citation opens in the system browser.

## Decisions (made by the user, 2026-11-05)
1. **Cloud AI: yes, limited.** Send book metadata, front matter and short extracted
   name/term lists to the cloud model and web search. Never send the full text.
2. **Provider and model: the Claude API, Sonnet by default** (`claude-sonnet-5-5`), with
   Anthropic's server-side web search tool. Read the `claude-api` skill for current model
   IDs, tool names and parameters; don't rely on memory. Keep the model ID in one place so
   it can be changed later.
3. **API key: a server environment variable** (`ANTHROPIC_API_KEY`), read only by the Rust
   server. The key lives in `~/.config/pager/secrets.env` (folder mode 700, file mode 600,
   outside the repository; the user has created it). At startup the server loads that
   file (`dotenvy` or a few lines of parsing). A variable already set in the environment
   wins over the file. Refuse to load the file, with a warning, if it can be read by group
   or others. Never read, print or copy the file's contents in your own work; to check
   whether a key is present, test only whether the variable is non-empty. The key never reaches the web client, the phone, logs or API responses. If the key
   isn't set, the tool shows "Context needs an API key on the computer" plus setup steps,
   and makes no calls. Document the variable and the secrets file in the server README.
4. **When it runs:** only when the reader taps it. Nothing runs when a book is imported.
5. **Scope:** the whole book first; the "Context for this" selection action is Phase 3.
6. **Cost limits:** cap each briefing at a fixed number of searches and output tokens
   (constants in one place; choose sensible values and report them). Log the token and
   search counts for each run on the server, so the cost can be checked.
   Chosen values (in `server/src/briefing/mod.rs`):
   - per run: 12 API calls, 40,000 output tokens, 800,000 input tokens, 60 catalogue
     lookups for the model and 150 for the verifier, 10 minutes;
   - searches and fetches: `max_uses` is per API call, so each call allows 5 searches and
     5 fetches (each fetch capped at 8,000 tokens). That value stays the same on every
     call, so the tool list and the prompt cache never change. The model is told its
     budget (10 searches, 8 fetches); once that is spent, the next tool result tells it to
     hand in. A run that passes 16 searches or 14 fetches fails;
   - per call: `max_tokens` 16,000 and a 300 s timeout.
   A run that hits any cap fails and stores nothing. The expected cost is about
   $0.30–0.70 a briefing, and at most about $2.50 with every cap hit. Each run's tokens,
   cache reads, searches, fetches and estimated cost are logged and stored with the run.
7. **iPhone: yes, the phone gets Context and can start briefings.**
   - Add the `/api/tools/context/*` routes to `REMOTE_ALLOW` in
     `server/src/http/remote.rs` and extend its test.
   - Starting a briefing from the phone spends money through the computer's key, so put a
     limit on paid runs per paired device (default 10, a server setting, over a rolling
     24 hours). Every run that calls the API counts: a new briefing and a Refresh alike
     (decided 2026-11-05). Opening a cached briefing never counts. Over the limit, the
     phone shows a clear message. Desktop requests are not limited.
   - A briefing runs on the server, not on the phone. If the phone sleeps or the
     connection drops, the run continues. The phone picks up the result when it reconnects
     (poll or stream by run ID). Two requests for the same book share one run.
8. **Little known about the book:** when retrieval finds little real scholarship (personal
   PDFs, recent self-published books, obscure articles), show a short note: "Not much is
   known about this book's context." Below it, show only what *was* verified, even if
   that's just the author and date. Never pad the briefing with weak or unverified items.
9. **Reader level setting:** add a "Context written for" setting: **General reader**
   (default), **Student**, or **Scholar**. Store it with the other settings
   (`shared/src/settings.ts`, `src/state/settings.ts`) and show it in Settings and as a
   small switcher in the Context panel. It changes:
   - how much background is assumed;
   - how deep the situation and the debates go (a scholar gets the textual history, the
     sources and the positions in each debate). Pre-reading stays rare at every level;
   - which further reading is chosen (accessible introductions vs. standard monographs
     and journal articles).
   Cache per book *and* level; switching level loads that level's cached briefing or
   offers to generate it.
10. **Phase 2's UI** (asked 2026-11-05, before the panel was built):
   - the connection map is a **radial tree** rooted at the book, in hand-made SVG (no new
     dependency);
   - the graphics live in **tabs in the panel** (Briefing | Map | Timeline | Places, each only
     when the data supports it), and each opens **full screen** when asked;
   - the places map draws on a **bundled outline** (Natural Earth, public domain), so no tile
     server learns what is being read;
   - **Refresh asks first**, naming the last run's cost (left out when it is $0) and, on a
     phone, how many of its runs a day are left.

11. **Phase 3, "Context for this"** (asked 2026-11-05, before it was built):
   - **The first tap never spends money: look first, then offer.** A focused briefing already made
     for that selection shows at once. Else, if the whole book's briefing (at the current level)
     already covers the name (a map entity or an item), that shows, free, with "Go deeper on X", its
     cost ("usually $0.10–0.30") and, on a phone, the runs left. Else an offer ("Make a briefing on
     X") with the cost.
   - **A focused briefing is short and about the link:** about 5–10 claims (the verifier keeps at
     most 12): who or what it is; how it bears on this book and its author; a disagreement if
     scholars have one; at most 2 further readings. No pre-reading and no terms. A small map centred
     on the item (entity `focus`). A smaller research budget: 5 searches, 4 fetches.
   - **Placement: a card by the text**, beside the selection like the footnote popover, with a
     compact version and "Open in Context →", which opens the tool panel on the full focused
     briefing.
   - Also decided: a selection over 120 characters is refused ("Select a name or a title"); web only
     (the iPhone app's text menu is a fixed list); a phone's browser shows the web menu, and focused
     runs count toward the phone's daily limit like any paid run.

12. **Phase 4, polish** (asked 2026-11-06, before it was built):
   - **Streaming: show the research live, don't stream the answer.** No change to how the API is
     called. While a briefing is made, the panel (and the card) show each step: the searches run,
     the pages read, the catalogue lookups, then "Checking 31 sources behind 22 claims…", with the
     time so far. Streaming the model's answer section by section was offered and declined: it would
     change every API call (SSE, a field per section, no strict validation while streaming), and
     only a paid run could test it. Per the streaming docs, a tool input arrives one whole top-level
     key at a time, so with today's `sections` array nothing would arrive before the whole briefing.
   - **Measurements: the server's log only.** Each run records where its time went (reading, seed
     lookups, each API call, the model's lookups, checking) in its log line and its stored usage; no
     usage line on screen, and the cost lines stay the fixed estimates.
   - **The Assistant page: briefings by book.** The books with briefings (whole-book levels and
     "Context for this" names); tapping one shows it at the page's width, with "Open the book"; a
     "Choose a book" picker makes one for any book in the library.
13. **Phase 5, a wide Assistant page, pictures and a card** (asked 2026-11-06, after the user asked
   for a bigger window and map, images, and a card with sources and more information on a tap):
   - **Layout: the window's width.** The Assistant page fills the window. The Briefing tab stays a
     readable column; Map, Timeline and Places take the full width: a large graphic, as tall as the
     window, with the card beside it.
   - **The card's extra information: the image and Wikipedia's intro.** The Wikipedia lead image and
     the first sentences of the article, labelled "From Wikipedia" with a link and the image's credit,
     kept apart from the checked claims and their sources below. (Image only was the alternative.)
   - **Where the card opens: beside, or below.** Beside the graphic on the wide page and in full
     screen; in the reader's narrow panel and on phones, below it, scrolled into view.
   - **Pictures on the map: in the nodes, in colour.** Round for people, ideas and movements; a
     rounded square for works, places, events and institutions; the book with the library's own
     cover; the shapes stay for nodes with no picture. (Greyscale, and pictures only in the card,
     were the alternatives.)

## API facts (checked against Anthropic's docs on 2026-11-05)
There is no official Rust SDK, so the server calls `POST https://api.anthropic.com/v1/messages`
over raw HTTP with `reqwest` (already in the dependency tree through iroh).
- Headers: `x-api-key`, `anthropic-version: 2026-10-21`, `content-type: application/json`.
- Model `claude-sonnet-5-5`: $2 per million input tokens, $10 per million output, $0.20
  per million cache reads. Adaptive thinking is the default (leave `thinking` out);
  `output_config.effort` is `medium`.
- Tools:
  - `web_search_20260318` with `max_uses`: $10 per 1,000 searches;
  - `web_fetch_20260318` with `max_uses` and `max_content_tokens`: no charge beyond
    tokens. It can only fetch URLs already in the conversation (the user message, a
    client tool result, or an earlier search or fetch result).
  Both filter their results with code on Anthropic's side (dynamic filtering), at no
  extra charge.
- Counts come back in `usage.server_tool_use.web_search_requests` and
  `usage.server_tool_use.web_fetch_requests`, alongside `input_tokens`, `output_tokens`,
  `cache_read_input_tokens` and `cache_creation_input_tokens`.
- Search results carry `url`, `title`, `page_age` and an `encrypted_content` the server
  can't read; fetch results carry the page text. Both must be sent back unchanged on the
  next call.
- `stop_reason`:
  - `pause_turn`: send the conversation back unchanged to continue.
  - `tool_use` when a client tool is called: if a search was asked for in the same
    group, it runs after the client results are returned.
  - `refusal`: the run fails.
- Sonnet 5.5 rejects a forced `tool_choice` (`any` or `tool`) with a 400. The briefing
  therefore comes back through a client tool, `submit_briefing`, with `strict: true` and
  `tool_choice: auto`, and the prompt says to call it. Structured outputs
  (`output_config.format`) can't be combined with citations, so they aren't used.
- Prompt caching: a top-level `cache_control: {"type": "ephemeral"}` caches the growing
  conversation, so each call in the loop re-reads the earlier part at the cache price.
- Refusal fallback: `fallbacks: "default"` with the header
  `anthropic-beta: server-side-fallback-2026-07-01` is on by default. If a call is
  declined, the API retries it on another model, billed at that model's rates. The
  model that answered is logged.

## Privacy
- To the model and web search: metadata, front matter (capped) and the extracted lists.
  Never body text.
- From the computer: lookups to openlibrary.org, api.crossref.org and wikidata.org, and
  the verifier's fetches of cited pages. These use a generic User-Agent,
  `Pager/0.1 (personal reading app)`, and never the user's email (Crossref's "polite
  pool" asks for one; it is not given).

## Phases (split the work if it's too big for one pass)
If the whole feature doesn't fit cleanly in one pass, build it in phases. Commit each
phase on the branch, and end each one with passing tests and a short Progress note in
this file (what was built, what's left, what was verified and how). Don't start a phase
until the previous one works. After Phase 1, stop: the user runs the live check on the 3
test books, and Phase 2's UI is built against that real output (decided 2026-11-05).

- **Phase 1: backend pipeline, no UI.** The `/api/tools/context/*` route, the
  retrieval → draft → verify pipeline, the JSON schema, and the cache. Tests include a
  made-up citation that the verifier must reject. Check the output by hand on the 3 test
  books. The routes go in `REMOTE_DENY` for now; Phase 2 moves them to `REMOTE_ALLOW`
  together with the per-device limit.
- **Phase 2: reader UI and phone.** The `context` `PagerTool` and its Panel:
  - **Context first.** The overview, the historical moment and the author's situation
    lead; conversation, terms and further reading sit behind section folds so the reader
    isn't overwhelmed. Pre-reading, when there is any, shows right after the overview.
  - **Graphics, each only when the data supports it** (decide in the UI from counts):
    - a **connection map**: a tree or network rooted at the book, from `entities` and
      `links`; tapping a node shows its claim and sources, and an item's `entity` ties the
      text to its node;
    - a **timeline** of entities with Wikidata dates (at least three);
    - a **map** of places with Wikidata coordinates (at least two).
  - Also: citation links, spoiler folds, Refresh, the "generated at" stamp, the
    reader-level setting, the "not much is known" note, and the error, no-key and offline
    states.
  - Add the routes to `REMOTE_ALLOW` with the per-device daily limit, and check the panel
    at phone width.
- **Phase 3: selection action.** "Context for this" on a selected name or work, reusing
  the Phase 1 pipeline with a narrowed query, and caching per item. A selection longer
  than 120 characters is refused ("Select a name or a title"). The iPhone app's text menu
  is a fixed list (`NativeMenuItem` in `src/lib/native.ts`, mirrored in Swift), so the
  action is web-only until the app adds an item.
- **Phase 4 (optional): polish.** Cost and latency measurements, streaming sections in as
  they're verified, and the Assistant page entry. (Built 2026-11-06 as Decision 12 chose: the
  research shown live instead of streamed sections, timings in the log.)
- **Phase 5: a wide Assistant page, pictures and a card** (Decision 13, built 2026-11-06).

If one phase turns out to be large, split it again rather than leaving it half done.

## Testing without spending money
- Every automated test (`cargo test`, `npm test`) uses a mocked model and mocked lookups,
  with recorded responses stored as fixtures. They make no network calls and need no key.
  All outbound HTTP goes through one `Transport` seam; the app's default transport
  refuses every request, so a test can't reach the network by accident.
- Real responses can't be recorded without spending money, so the first fixtures are
  built by hand from the documented response shapes. `context-live --record DIR` saves
  real responses to refresh them later.
- Real API calls happen only in a separate check started by hand:
  `cargo run --release --example context-live -- <book.epub> [--level scholar]`. It
  prints the token and search counts, the cost, and what was kept and dropped and why.
  Only the user runs it, with their key. `--dry-run` prints the exact payload that would
  be sent; it needs no key and makes no network calls, so it is safe to run.

### Testing with Claude Code agents (the default, decided 2026-11-05)
The user doesn't want to run paid checks or read the outputs. Claude Code tests the prompt
itself, with agents standing in for the API model, and judges the results:
1. `context-live <book.epub> --level L --prompt-dir DIR` writes `system.md`, `user.md`
   (with live seed lookups), `schema.json` and `tools.md`. No key; only catalogue lookups.
2. An agent on Sonnet follows `system.md` and `user.md` with stand-ins for the tools:
   - `web_search`: the agent's WebSearch;
   - `web_fetch`: a small script that prints a page's visible text, capped like
     `max_content_tokens`. Not the WebFetch tool, which summarises, so quotes from it
     wouldn't match;
   - `find_book`, `find_article`, `find_entity`: the same Open Library, Crossref and
     Wikidata queries as `lookup.rs`.
   The agent writes `submit_briefing`'s input to `DIR/draft.json`.
3. `context-live <book.epub> --level L --draft DIR/draft.json --out FILE` runs the draft
   through the real verifier (live lookups and page fetches, no key) and prints what was
   kept and dropped and why.
4. Read the results and judge them against this prompt: context first, pre-reading only
   when necessary, length, levels, the connection map. Fix the prompt or the verifier, and
   run again.
The stand-ins differ from the API in two ways. WebSearch returns summaries, not quotable
results, so every quote costs a fetch. And four agents at once hit Wikidata's rate limit,
which a single run rarely does.

## Test books
All three are in `reads/context-test/` (the library folder, which git ignores), downloaded
2026-11-05. Pride and Prejudice is the illustrated edition (about 25 MB), which also tests
a large EPUB.
- **Classic novel:** Jane Austen, *Pride and Prejudice*, the Project Gutenberg EPUB
  (ebook #1342).
- **Philosophy:** Friedrich Nietzsche, *Thus Spoke Zarathustra*, translated by Thomas
  Common, the Project Gutenberg EPUB (ebook #1998).
- **Nonfiction:** Charles Darwin, *On the Origin of Species* (1859, first edition), the
  Project Gutenberg EPUB (ebook #1228). Its reception, Darwin's sources (Malthus, Lyell,
  Wallace) and the later scholarship give the "author's conversation" and "where scholars
  disagree" rules plenty to work with.

## The phone
The iOS app isn't compiled yet. Check phone behaviour with a narrow browser window
(390 px) and with the fake phone in `server/examples/fake-phone.rs` and the remote tests.
Don't claim it was checked on a device.

## Done when
- On the 3 test books (agent runs, see "Testing with Claude Code agents"), every
  recommended work resolves to a real record, every link opens, and no section shows an
  unsourced claim.
- A test feeds the verifier a made-up citation, and it is rejected.
- A failed search or no network shows a clear error, never an unsourced briefing.
- An obscure book gets the "not much is known" note, with no padded items.
- The same book at General and Scholar levels gives noticeably different depth and
  further-reading lists. Pre-reading stays rare at both.
- No key set → no API calls and a clear setup message. The key never appears in any
  response or log. A test with a sentinel key checks that it is sent only in `x-api-key`
  to api.anthropic.com, never to a lookup host, and never appears in a response, a
  database row or a log line.
- A quote that isn't on its page is rejected (test).
- A `pause_turn` answer is resumed (test).
- A run that hits a cap fails and stores no partial briefing (test).
- A paired phone can start a briefing, and the per-device limit blocks the 11th new one
  in a day (tested in `server/tests/remote.rs` or a new test).
- All work is on the `ai-book-context` branch, committed per phase.

## Progress

### Phase 1: backend pipeline (built 2026-11-05)
**Built** (`server/src/briefing/`, routes in `server/src/http/routes/context.rs`):
- The key loader (`secrets.rs`), and one `Transport` seam for all outbound HTTP
  (`LiveTransport` in the server, `NoTransport` by default, a fake in tests). `reqwest` and
  `rustls` reuse the ring provider already in the tree: no new crates in `Cargo.lock`.
- Local extraction (`extract.rs`): metadata, plus translators, publisher and subjects read
  again from the OPF; front matter (capped); names, works, terms and the bibliography.
- Catalogue lookups (`lookup.rs`): Open Library, Crossref and Wikidata, and page text. Only
  public http(s) addresses are fetched, so a cited URL can't reach this computer or its
  network.
- The prompt and tools (`prompt.rs`): web search and web fetch (`_20260318`), `find_book`,
  `find_article`, and a strict `submit_briefing`.
- The research loop (`run.rs`): `pause_turn`, client tools, one nudge, retries for a busy
  API, caps, usage and cost.
- The verifier (`verify.rs`): the rules in "What verified means".
- The cache and runs (`store.rs`, migration v7), interrupted runs at startup, two runs at
  once, and requests that share one run.
- `GET /tools/context/status`, `GET|POST /tools/context/briefings/:docId`,
  `GET /tools/context/runs/:runId` (`REMOTE_DENY` for now); error code `not_configured`.
- The types in `shared/src/context.ts`, and docs in API.md, CONTRACT.md and server/README.md.
- `cargo run --release --example context-live -- <book.epub> [--level scholar] [--record DIR]
  [--out FILE] [--dry-run]`.

**Verified:**
- `cargo test`: 12 new tests in `server/tests/briefing.rs`, against fixtures built by hand
  from the documented response shapes (`server/tests/fixtures/context/`):
  - the happy path with a search, a fetch, a search snippet, `find_book` and a `pause_turn`;
  - a made-up DOI, a bad ISBN check digit (rejected with no request), someone else's ISBN,
    a quote not on its page, a Wikipedia-only claim and a one-sided disagreement, all
    dropped;
  - body text never in a request;
  - the sentinel key only in `x-api-key` to api.anthropic.com, and never in a response or
    the database;
  - no key means no request of any kind;
  - the cache, shared runs, levels and Refresh;
  - a changed file keeps its briefing, marked stale;
  - the call cap, a refusal, silence, network and 401/529 errors and `max_tokens` each
    fail and save nothing;
  - interrupted runs; tool records for `context` still work; a phone gets 403.
  The whole server suite and `npm test` pass.
- `--dry-run` on the 3 test books: sensible names (Darcy, Bennet, Lyell, Hooker, Wagner,
  Schopenhauer), works (*Advancement of Learning*, *Bridgewater Treatise*), terms
  (*tête-à-tête*, *hauteur*), and front matter (Origin's 1859 title page and Introduction,
  Saintsbury's preface, Förster-Nietzsche's introduction). No chapter text in the request.
  The first user message is about 10–11k characters.
- The server binary with no key: `status.ready` is false, and POST answers 503
  `not_configured` with the setup message.

**Not verified yet (the user's live check):** real API calls. Things that may need
adjusting then:
- whether the strict `submit_briefing` schema is accepted as written;
- whether dynamic-filtering fetch results come back as `web_fetch_tool_result` blocks the
  verifier can read (if not, it fetches the pages itself, which costs lookups but works);
- how many quotes survive;
- the real cost.
Run, with your key, `cargo run --release --example context-live -- "reads/context-test/<book>.epub"`
for each book, plus `--level scholar` on Darwin, and add `--record DIR` to save the real
responses as fixtures.

**Left:** Phase 2 (the reader panel, the level setting, the phone, its per-device limit),
Phase 3 (the selection action) and Phase 4 (polish).

### Phase 1b: context first, the connection map, agent testing (2026-11-05)
**Why:** the user's live run on Darwin (General) passed every check: 16 claims kept and
none dropped, 3 calls, 4 searches, 5 fetches, $0.23, 80 s, and the strict schema was
accepted. It also showed the pull toward pre-reading: a "Read first: Malthus [Optional]"
item, plus a claim that nothing was essential. The user asked for:
- minimal pre-reading, so the reader isn't sent back again and again before starting;
- mostly historical and situational context;
- a page that connects ideas, people, places and readings in trees and other graphics;
- testing with Claude Code agents, not the API, with Claude judging the outputs.

**Built** (schema version 2):
- A `situation` section. `readFirst` loses its tiers: it needs a real work, and allows two
  items at most.
- Per-section limits, and a cap of 24 claims in the sections, trimmed from terms first.
- `entities` and `links` (`find_entity` searches Wikidata). One SPARQL query brings each
  entity's label, aliases, description, dates and coordinates. Dates go only to people,
  works, events, movements and institutions; coordinates only to places.
- `book` citations, quoted from the front matter that was sent.
- Title matching ignores bracketed text and allows one changed letter in long words.
- A catalogue 429 or 503 gets one retry.
- A prompt rewritten around "the briefing replaces homework".
- `context-live --prompt-dir` and `--draft`.
- 14 Context tests (2 new: the length cap and front-matter citations).

**Verified with agents** (Sonnet subagents with the tool stand-ins, drafts through the real
verifier; section claims, then drops):

| Run | Section claims | Dropped | Notes |
|---|---|---|---|
| Darwin, General, round 1 | 9 | 7 claims (Wikipedia-only) | moment section lost |
| Darwin, General, round 2 | 22 | none | after the sourcing guidance |
| Darwin, Scholar | 19 | none | the Wallace-letter date dispute, Peckham vs Shillingsburg on the editions, 3 DOIs/records |
| Austen, General | 21 | none | marriage law, entails, the militia; one biography |
| Nietzsche, General, round 1 | 15 | 5 | |
| Nietzsche, General, round 2 | 16 | none | |

No run produced pre-reading. General and Scholar differ clearly in depth and in further
reading. The maps had 7–10 nodes and 6–10 links, with dates from Wikidata (and a few
places).

**Limits of the stand-ins:**
- WebSearch returns summaries, so every quote costs a fetch.
- Britannica answers 403 to the tool script.
- Four agents at once hit Wikidata's 429s.
The real API run (`web_search` results and `web_fetch` text in the conversation) should
fare at least as well.

**Left:** Phase 2 (the panel: context first, the connection map, the timeline and map when
the data supports them, the phone and its limit), Phase 3, Phase 4.

### Phase 2: the reader panel, the graphics, the phone (2026-11-05)
**Asked first** (one AskUserQuestion, see Decision 10): a radial tree, tabs in the panel with full
screen, a bundled outline for the places map, and a Refresh dialog with the last cost and the phone's
runs left.

**Built:**
- **The `context` tool** (`src/tools/context/`, registered in `src/tools/index.tsx`), whose Panel shows
  in the reader's tool panel (titled "Context" while it is the only tool) and on the Assistant page:
  - Context first: the book, then the rare pre-reading, the historical moment and the author's
    situation, open; the author's conversation, terms and further reading folded, each with its count.
  - Claims in Spectral, each with its sources beneath: title (a link that opens in a new tab, or Safari
    in the iPhone app), author and year; a `book` citation reads "From the book: <part>". The same page
    cited twice for one claim shows once. An "Inferred" mark with a one-line key at the end, spoiler
    folds (items and claims), disagreements with both sides and their own sources, the work's record
    for read-first and further-reading items. In the conversation, the relation reads as a phrase
    above the name ("Jane Austen took her title from / Fanny Burney").
  - "Not much is known about this book's context." when `littleKnown`; "Generated 5 November 2026" and
    nothing more, stale or not.
  - States: no document (the Assistant page); loading; no key (the setup steps from `keyFile` and
    `keyVariable`; a cached briefing still shows, without Refresh); none at this level (what it is,
    "Make a general briefing", its cost, and on a phone the runs left); running (the stage, polled
    every 2 s, picked up again from `state.run` after the app sleeps; a Refresh keeps the old briefing
    under a "Making a new briefing" line); failed (`run.error` as is, Try again); 429 `limit_reached`
    as a calm note; offline (`unavailable`, Try again); the mock (`unsupported`: "Context needs Pager on
    your computer").
  - Refresh asks first: "Make a new briefing?", the last cost (`stats.costUsd`, left out at $0), and on
    a phone "This phone has 7 of its 10 runs a day left" (the button is off at 0).
- **Graphics**, decided from counts (`viewsFor` in `model.ts`): the map at 3 entities and 2 usable
  links, the timeline at 3 dated entities, places at 2 with coordinates. All four samples get Map and
  Timeline; only Austen gets Places (Chawton and Steventon; Nietzsche's Sils has no coordinates).
  - **Connection map** (`ConnectionMap.tsx`): a breadth-first tree over the links from the book; the
    author always hangs from the book and sits at the top (Darwin's links never join them, so that
    edge comes from the book itself, unlabelled); leftover links are faint dashed curves; entities no
    link reaches (Nietzsche's "God is dead") hang dotted from the book. Shapes by kind, so it reads in
    black and white; the tapped node and its lines in ink blue. Tapping shows the detail card: kind,
    Wikidata dates and description, links, each link as "X relation Y" with its claim and sources, and
    "In the briefing" buttons that open the fold, scroll to the item and flash it. An item with an
    `entity` gets "On the map".
  - **Timeline** (`Timeline.tsx`): rows by start, lives as bars, works and events as marks, one scale
    with round ticks, the book's year as a blue line.
  - **Places** (`PlacesMap.tsx`): equirectangular, scaled by the cosine of the middle latitude, at
    least 4° high so two villages still show their region; labels placed so they don't overlap. The
    outline is Natural Earth 1:50m land and borders, simplified to 0.05° (`world.ts`, 143 KB, a
    dynamic import loaded only when a places map shows).
  - Full screen: a `Dialog` placement `full`, the graphic beside its detail card (below it on a phone).
- **The level setting**, `contextLevel` in `src/state/settings.ts` (default General) and in
  `ReadingSettingsSuggestion`; Settings → Context ("General reader | Student | Scholar") and a
  switcher in the panel. Each level loads its own briefing or offers to make one.
- **The phone:** the 4 routes moved to `REMOTE_ALLOW`. `briefing_phone_allowance` counts the runs a
  phone started in the last 24 hours against the app setting `context.phoneDailyLimit` (default 10,
  0–100, validated; Settings → Context on the computer). The check runs in the same core step that
  records the run, so two requests can't both slip past. A cache hit or joining a running run never
  counts. Over the limit: 429 `limit_reached`, "This phone has started 10 new briefings in the last
  24 hours, the most it can in a day. You can start another in about 12 hours. …", or for a limit of
  0, that new briefings are made on the computer. `status.phone` is `{ used, limit, left }` on a phone.
  The desktop is never limited. CONTRACT.md's error table and routes, API.md and server/README.md
  updated.
- **Dev only:** `context-live <book.epub> --briefing <sample>.briefing.json --store server/.data-dev`
  stores a verified sample for the matching document (by content hash) with no network;
  `--draft FILE --store DIR` verifies first. Not in the server's API. The four samples are stored in
  the dev library (the `reads/context-test/` books).

**Verified:**
- `cargo test`: all suites pass. New: `a_phone_can_start_briefings_up_to_its_daily_limit` (status
  counts, a cache hit free, 9 Refreshes, the 11th refused for a Refresh and for a new level with no
  call made and no run recorded, the computer unlimited, still refused 12 h later and free just past
  24 h, a limit of 0, a phone can't change the setting) and `the_phone_limit_is_a_checked_app_setting`.
  The remote suite's no-paths test now calls the three Context GETs from a phone; the allowlist and
  deny tests pass with the routes moved.
- `npm test`: 25 new tests in `test/context.test.ts`, against the four real samples: the 4 client
  methods (the http adapter's URLs, bodies, a 202 and the 429/503 codes; the mock's `unsupported`),
  section order and folds, which graphics show and their thresholds, the radial layout (the author
  edge, loose nodes, every sourced link kept, deterministic, a cycle and a self-link), labels, the
  timeline scale, the places view and the outline transform agreeing with the points, label overlap,
  citation links (http(s) only), cost and date. `npm run typecheck` passes.
- In a browser (Playwright's Chromium driven by REA, against the dev server with the samples
  stored; the dev server ran with `XDG_CONFIG_HOME` pointed at an empty folder, so the real key
  file was never read):
  - 1440 px, panel beside the text: Briefing, an opened fold, the Scholar disagreements, Map with a
    node tapped and "In the briefing" (switches to the text, opens the fold, scrolls, flashes),
    Timeline, Places, Settings → Context, and the Assistant page with no book open.
  - 390 px, the panel as a sheet: Briefing, Map with a node tapped, Places, full screen, and the
    Refresh dialog (cancelled, never confirmed).
  - The run path, with a dummy key that Anthropic refuses at no cost: "Make a student briefing" →
    "Reading the book's front matter…" → "The briefing stopped. Anthropic refused the API key…" with
    Try again. With no key: the setup steps where there is no briefing yet, and a stored briefing
    still shown, without Refresh.
  - Fixed on the way: place labels overlapping (now on the side away from the nearest place), a
    cut-off timeline label, relation labels crowding the small map (now only in full screen), long
    names running off the map's edge (now wrapped to the room on their side), and Escape in the full
    screen view also closing the tool sheet (React passes a nested `<dialog>`'s close up to the outer
    one's handler; `Dialog` now answers only its own). The panel is a lazy chunk (39 KB) so the main
    bundle stays under its 700 KB warning; the outline is its own chunk (143 KB, 62 KB gzipped).
  - No page errors in any run.
- Not on a device: the iOS app isn't compiled.

**Left:**
- The real API on schema v2 (the user's paid check, when they choose).
- Phase 3 (the "Context for this" selection action) and Phase 4 (polish: streaming sections,
  measurements).

### Phase 3: "Context for this" (2026-11-05)
**Asked first** (see Decision 11): look first, then offer; short and about the link; a card by the text.

**Built:**
- **Server** (`server/src/briefing/focus.rs`, and `focus` threaded through `mod.rs`, `run.rs`,
  `prompt.rs`, `verify.rs`, `store.rs` and the routes):
  - `GET …/briefings/:id?level=&focus=` and `POST { level, refresh, focus }`. The selection is cleaned
    (spaces collapsed; clinging quotes, punctuation and unbalanced brackets dropped; a possessive ’s
    removed) and cached per document, level, file version and focus, compared without case. Over 120
    characters, no letter, or not a string: 400 `invalid_request` ("Select a name or a title …").
  - The run key includes the focus, so a focused run and the whole book's never share. A focused run
    from a phone goes through the same allowance check, so it counts like any paid run.
  - One system prompt for both kinds of run (so it caches), with a "# A focused briefing" section that
    replaces the counts, budget and research plan for a focused run; the user message puts the
    selection in `<focus>…</focus>`, as data. The model is told 5 searches and 4 fetches; the hard caps
    and tool list are unchanged.
  - The verifier's `Shape::Focus`: at most 1 overview item, no pre-reading ("a focused briefing has no
    pre-reading"), 2 each of moment, situation, terms and further reading, 3 conversation items, 12
    claims, and the `focus` entity kept even with no link.
  - `context-live --focus TEXT` for the live run, `--dry-run`, `--prompt-dir`, `--draft` and the file
    name; `--briefing FILE --store DIR` keeps the briefing's own focus.
  - Two prompt changes from the agent runs below: the focused section now says it replaces the general
    counts and gives its own research plan; and an `inferred` claim "only joins what the cited passages
    say: it adds no fact of its own" (both kinds of briefing).
- **Web** (`src/tools/context/`):
  - The selection action "Context for this" (Landmark) opens a card beside the selection and clears the
    selection. Web only; the iPhone app's `NativeMenuItem` list is unchanged.
  - `ContextCard.tsx`, the tool's new `Overlay` (lazy, 10 KB): the footnote popover's box and entrance,
    at most as tall as the roomier side so it never covers the words; closes on a tap outside, ✕, Esc,
    a page turn, a scroll, a resize, or another chapter. States in order: "Select a name or a title";
    loading; offline and the mock's `unsupported`; a focused briefing already made (who or what it is,
    its overview claims, the first claim of each "And this book" item, then "Open in Context →"); a run
    going (the stage every 2 s, "You can close this; it will be here when it's done"); a failed run with
    Try again; a match in the whole book's briefing ("From this book's briefing": the node's name, kind,
    dates and description, and the claim that names the selection, else the node's sourced link, else
    the item's first claim; "Open in Context →" opens the panel with the map on that node or the text on
    that item; "Go deeper on “X”" with the cost and a phone's runs left, not without a key); nothing
    found (the offer, "Make a briefing on “X”"); no key ("Context needs an API key on the computer." and
    "Open in Context for the steps"); 429 as a calm note.
  - The panel's focus view: "← The whole book", the selection and "in <book>", then the same tabs,
    level switcher, Refresh and graphics; sections titled for the focus (the overview is its name, the
    conversation "And this book", nothing folded); a relation line ending with the focus ("Charles
    Darwin read Malthus"); "Not much is known about X in connection with this book."; the map centred on
    `focus`.
  - Seams: `PagerTool.Overlay`, rendered by `ReaderPage`; `openToolPanel(toolId)` in the registry
    (the reader opens the panel, `ToolPanel` selects the tool); `store.ts` for the card, the panel's
    focus and a pending reveal.
  - `model.ts`: `normalizeFocus` (the server's cleaning, same cases), `findInBriefing` (a node's name,
    a person's surname, a name without its brackets or the bracketed name, accents ignored, item
    headings, one inflected word retried without its ending; nothing for 1–2 letters or stopwords),
    `matchClaim`, `sectionTitle`, `focusName`, `relationLine`, `mapRoot`, `phoneRunsLine`, and
    `radialLayout`'s optional root.
  - The selection menu now stays 8px inside the viewport and its labels don't wrap: at 390 px, with a
    third action, it ran off the right edge.

**Verified:**
- `cargo test`: all suites pass (147). New in `server/tests/briefing.rs`: a focused run end to end (202
  then done; `<focus>Malthus</focus>` in the first request; `briefing.focus` "Malthus"; no pre-reading;
  the `focus` node and its link; its own cache, which "“Malthus’s”" and "  malthus. " hit with no call,
  apart from the whole book's; 400 for 121 characters, a number, an array and "1859", over POST and
  GET); `Shape::Focus` on a long draft (12 kept, 7 dropped, the reasons, the focus node kept where the
  book shape drops it); a focused run from a paired phone counted, opened again for free, and refused
  at the limit with no call. `focus.rs` unit tests ("It's" stays; "Ross's" → "Ross").
- `npm test`: 228 pass, `npm run typecheck` passes. New in `test/context.test.ts`: the adapter's
  `?focus=` and POST body, the query key, `normalizeFocus` with the server's cases, `findInBriefing` on
  the real samples (Darwin: "Malthus", "Wallace", "Darwin", "Murray", "Whewell"; Austen: "entail",
  "entailed", "pin-money", "war"; Nietzsche: "Übermensch", "Rée"; null for "the", "of", "Mr", "1859",
  "species", "power", "Lamarck"), `matchClaim`, the focused samples' shape, section titles and folds,
  the relation line, the map's focus root.
- **Agent runs** (Sonnet subagents with the tool stand-ins, drafts through the real verifier, all
  General):

  | Run | Section claims | Links | Dropped | Notes |
  |---|---|---|---|---|
  | Darwin, "Malthus" | 9 | 6 | none | Darwin's reading (the Autobiography's "for amusement"), the Origin's own "doctrine of Malthus" line, Wallace; a marginal 1834 Poor Law item |
  | Austen, "Fanny Burney" | 7 | 7 | none | *Cecilia* and the title, the burlesque reading, Austen's subscription to *Camilla*, *Northanger Abbey*'s praise |
  | Nietzsche, "Wagner", round 1 | 9 | 7 | none | an inferred claim added facts its quote didn't hold (Wagner "dead while Nietzsche wrote Zarathustra") → the `inferred` rule above |
  | Nietzsche, "Wagner", round 2 | 7 | 7 | none | dates right (Part I in January 1883, Wagner dead in February); the Magician in Part Four (LitCharts, a weak source) |

  Every map was centred on `focus` with 6–7 nodes, no run produced pre-reading, and each spent 2–3
  searches and 4–5 fetches. The three good ones are samples (`*-malthus-general`, `*-burney-general`,
  `*-wagner-general`) and are stored in the dev library.
- In a browser (Playwright's Chromium, against the dev server with an empty `XDG_CONFIG_HOME` and a
  dummy key; REA's click can't aim at one word inside a paragraph, so a small CDP script double-clicked
  the word at its Range's box): at 1440 px, "Malthus" in the Origin's Introduction → the cached focused
  card → "Open in Context" → the focus view, its map centred on Malthus, back to the whole book;
  "Wallace" → the free match with Go deeper → the map on Wallace; "naturalist" → the offer; a whole
  paragraph → "Select a name or a title"; Esc and a click outside close the card; Austen's "entail" →
  the map on Entail; "Make a briefing" with the dummy key → the stage, then "Anthropic refused the API
  key" with Try again (no cost). With no key: the match without Go deeper, the offer replaced by the
  key note, and the setup steps in the focus view. At 390 px: the menu fits, the card (350 px) sits
  above the word, the sheet opens on the focus view, the match and the offer. No page errors.

**Not verified:**
- The real API on a focused run (the cost line, $0.10–0.30, is an estimate).
- A paired phone in a browser (the runs-left line and the 429 note in the card): covered by the server
  test and a unit test, not seen on screen. Touch selection on a device; the dark theme.

**Left:** Phase 4 (polish: streaming sections, cost and latency measurements, the Assistant page
entry). The iPhone app could add a "Context for this" item to its native menu later.

### Phase 4: polish (2026-11-06)
**Asked first** (see Decision 12): the research shown live, not streamed sections; timings in the
server's log only; briefings by book on the Assistant page.

**Built:**
- **The research, live** (`server/src/briefing/run.rs`, `mod.rs`):
  - `generate` reports `Progress`: the stage, each `RunStep` and, once the draft is in, `Checking
    { sources, claims }` (`verify::draft_counts`: distinct pages by normalised URL, records, the
    book's front matter and works named; every claim, links included).
  - Steps: the two seed lookups; each API answer's `web_search` and `web_fetch` uses
    (`run::steps_in`, paired with their results: an `error_code` marks one failed, a paused turn's
    pending result counts as done); the model's `find_book` / `find_entity` / `find_article` as they
    run. At most 100 per run.
  - `RunView` gains `steps`, `checking` and `elapsedMs` (by the computer's clock, so a phone's doesn't
    matter), served only while the run goes; the stored row keeps the outcome.
  - Web: `RunProgress` and `StepList` (`parts.tsx`). The panel shows the stage (or the checking line)
    with the time so far ticking between polls, the counts ("4 searches · 3 pages read · 3 catalogue
    lookups") and the newest six steps, earlier ones counted; they stay while it checks. A Refresh's
    compact line and the card show the counts and the newest step on one line. A new step slides in
    (not with reduced motion).
- **Measurements** (`run::Timings` in `Usage`): reading, seed lookups, each API call (retries
  included), the model's catalogue lookups and the checking; in the log line ("time: reading 0.1 s,
  seed lookups 0.7 s, API calls 8.0 + 8.0 + 8.0 s, catalogue lookups 0.2 s, checking 0.6 s"), in
  `context_runs.usage` and `context_briefings.usage` (`timings`), and in `context-live`'s output,
  which also prints each step as it happens. Failed runs record theirs too. Not in any response.
- **The Assistant page** (`ContextHome.tsx`, through a new `PagerTool.Page` seam):
  - `GET /tools/context/briefings` (in `REMOTE_ALLOW`): the newest briefing per document, level and
    focus, for documents still in the library, newest first.
  - "Your briefings": each book with its levels and its "Context for this" names (links); "Choose a
    book" (a dialog filtering the library by title or author). A book opens at the page's width
    (`?doc=…&focus=…` in the address, so Back works), with "← All briefings", the title and author,
    "Open the book" (the reader opens with the panel on the same view: `openTool` in the reader's
    navigation state, and the panel's focus set) and its other "Context for this" names. It is the
    same `ContextForDocument` as the panel, so every state works there (making one, Refresh, levels,
    graphics, full screen); a focused briefing's header leaves out "in <book>" there.
  - The Assistant page's tool sections have a real border, clipped without making a scroll box (the
    sticky tabs painted over the old inset-shadow outline).
- **Fixed on the way:** the timeline's grid and book-year line ran through the labels. The labels now
  sit on the page colour (`.context-label`; the elevated colour in full screen), and a tapped row
  shows by its blue label, dates and bar instead of a tint, which would have clashed with the label's
  box.
- **Dev only:** `cargo run --example context-replay` serves Pager with Anthropic's API answered from
  the test fixtures, 8 s a call (`REPLAY_DELAY_MS`, `REPLAY_FETCH_DELAY_MS`); a placeholder instead
  of a key, nothing sent to the API. Its briefing is the fixtures' Darwin one for any book, so run it
  on a copy of the dev data.

**Verified:**
- `cargo test`: all suites pass. New in `server/tests/briefing.rs`: `steps_in` on the fixture and on
  failed, paused and other server tools; `draft_counts` (the same page with and without "www." and a
  trailing slash is one source); a run's progress through `generate` (the stages in order, the seed
  lookups, each answer's search and reads, the model's lookup, the checking counts just before the
  checking stage, three call timings); a run held at its first call by a gate (the seed steps and
  `elapsedMs` over GET run and the book's state, the clock advanced 65 s, the first answer's steps,
  then the stored outcome with no steps and the timings in the run's row, none in the briefing's
  stats); a failed run's timings; the list route (empty, a whole-book and a focused briefing with the
  focus as shown, a Refresh replacing its entry, a deleted book dropping out). The remote suite's
  no-paths test covers the new GET from a phone.
- `npm test`: 232 pass; `npm run typecheck` and `npm run build` pass (the main bundle 679 KB; the
  Assistant page's part a 7 KB lazy chunk). New: the fifth client method (http and mock), step lines,
  counts, the time label, the checking line, and grouping the list by book.
- In a browser (Playwright's Chromium over CDP, against `context-replay` on a scratch copy of the dev
  data, with an empty `XDG_CONFIG_HOME` and no key): at 1440 px, a new Student briefing in the panel
  (the seed lookups at 0:02, the first answer's steps at 0:11 with a failed search and a failed read
  greyed, "Checking 11 sources behind 19 claims…" at 0:34, then the briefing); a Refresh's compact
  line through to "checking"; the card's run on "naturalist"; the Assistant page's list, a focused
  briefing from it, the whole book, the map, the picker filtering to "zara", making a briefing from
  the page, and "Open the book" landing in the reader with the panel on the same focused view. At
  390 px: the Assistant list, book and focus views with the sticky tabs, and a run in the tool sheet.
  The dark theme: the list, a run, the briefing, the map, the timeline and the places map. No page
  errors.
- **A paired phone, in a browser** (left open since Phase 2): a browser paired over the remote
  listener on the scratch data (the device cookie set over CDP, the app built with `VITE_USE_HTTP=1`),
  at 390 px. The Refresh dialog and the card's offer with one run left; the limit lowered to 0 on the
  computer, then "Make a briefing": the calm 429 note; a run started, counted at once (`used` 2 of 2);
  then the card's offer and the Refresh dialog with none left, their buttons off. The phone also gets
  the new list route (401 without its token). Two fixes from it: after a refused start the phone's
  status is fetched again (the card had kept saying "can start 1 more today" under the 429 note), and
  the phone lines read right for a limit of 1 ("its one run") and of 0 ("New briefings are made on the
  computer; this phone can open them.") instead of "its 1 runs" (`phoneRunsLine`, `phoneRefreshLine`).

**Not verified:** the live steps against the real API (the replay's answers have the documented
shapes; a real run's searches and reads arrive per call, so the list grows in a few jumps); a real
device.

**Left:** Phase 5 (asked for after Phase 4). The real API on schema v2 and on a focused run stays the
user's paid check. Later ideas: streaming sections (Decision 12 says why not now), the iPhone app's
native "Context for this" item.

### Phase 5: a wide Assistant page, pictures and a card (2026-11-06)
**Asked first** (see Decision 13): the page at the window's width with the graphics beside their card;
Wikipedia's image and intro in the card, apart from the checked claims; the card beside the graphic,
or below it in narrow places; colour pictures in the nodes.

**Built:**
- **Pictures and intros, free** (`server/src/briefing/media.rs`; the briefing schema and the verifier
  are unchanged, so every stored briefing gets them):
  - `GET /tools/context/media?ids=` (at most 40 Wikidata ids; in `REMOTE_ALLOW`): for each item, one
    SPARQL query gives its English article and its P18 image; one Wikipedia request gives the intro's
    first three sentences (plain text, tidied: "Darwin ( DAR-win;" → "Darwin (DAR-win;") and the
    article's free lead image; one Commons request gives a ~480 px thumbnail, the artist (HTML to
    text, a derivative's first source, hidden copies and footnote marks dropped, 80 characters at
    most) and the licence. The lead image wins over P18.
  - Thumbnails are downloaded only from `thumb.wikimedia.org` (where Commons serves them now) or
    `upload.wikimedia.org`, at most 3 MB, must sniff as JPEG, PNG, WebP or GIF, and go into the
    asset store, so the app and a phone load them from the computer.
  - Migration v8, `context_media`: per item for 30 days, "nothing found" included; a failed lookup
    (network, outbound requests off) is never cached and is asked again. One lookup at a time
    (`BriefingService::media_lock`), so two requests don't fetch twice. Entities with no Wikidata id
    get nothing (no guessing by name).
- **Web** (`src/tools/context/`):
  - `useContextMedia` (one query per briefing, by sorted ids, an hour fresh, errors quiet);
    `mediaIds`, `nodeImages` (the book's own `coverUrl` first), `mediaSummary`, `nodeRadius`,
    `creditLine`, `PICTURE_MAP_MIN` in `model.ts`; `radialLayout` takes an optional smallest first
    ring; `labelPlacement` takes the node's radius and can put the centre's name above it;
    `wrapLabel` takes a line count.
  - **The map** (`ConnectionMap.tsx`): as wide as its box, at most `maxHeight` tall (the rings fit the
    height, a wider box gives side names more room, no empty bands when the width limits it). From
    420 px tall, pictures fill the nodes, clipped to the kind's shape (round or a rounded square),
    cropped from the top for people and works, with a ring (blue when tapped); a picture that fails
    falls back to its shape. Nodes grow with the map (14 px at 420–480, 24 at 720, 30 from 1000; the
    centre 18 → 40), the first ring clears the centre's picture and its name (now above the centre,
    toward the author), and side names may take three lines. Smaller maps (the reader's panel, a
    phone) keep the Phase 2 layout and shapes exactly; their card still has the picture.
  - **The card** (`EntityDetail` in `parts.tsx`): the picture (at most 240 px tall) with "Picture:
    artist · licence, Wikimedia Commons" linking to the file's page; the name, kind, dates, catalogue
    record and Wikidata; the Wikidata description; "From Wikipedia" (the intro on a grey ground, cut
    to five lines with More when long, and "Read on Wikipedia"); "How it connects" (the checked links
    and their sources); "In the briefing".
  - **`GraphicStage`** (`ContextPanel.tsx`), used by the panel, the full-screen dialog and the page:
    the graphic and the card side by side (a 360 px card, sticky below the tabs on the page), or the
    card below, scrolled into view on a tap (`scroll-mt-16`, so not under the sticky tabs; smooth
    unless reduced motion).
  - **The Assistant page**: `FullColumn` (the window's width, at most 1680 px) instead of the 600 px
    column; `ContextHome` measures itself (a callback ref) and, from 960 px, passes `wide` to
    `ContextForDocument`: graphics up to the window's height less 140 px, the Briefing tab, level
    switcher and notices in a 720 px column, the tabs at most 560 px.

**Verified:**
- `cargo test`: all suites pass. New in `server/tests/briefing.rs`, against Wikimedia's answers
  recorded on 2026-11-06 (`media-sparql.json`, `media-wikipedia.json`, `media-commons.json`, trimmed):
  one request per service and a thumbnail per item, the lead image over P18 and only the chosen file
  downloaded, the credits ("Henry Maull (1829–1914) and John Fox (1832–1907) (Maull & Fox)"), the
  tidied intro, nothing found as nulls, the thumbnail served from `/api/assets` as `image/jpeg`, a
  second and a partial request from the cache with no request, looked up again after 30 days, a
  failed thumbnail not cached (the intro kept, the picture fetched next time, the cached item not
  asked again), Wikidata down and no transport giving `{ media: {} }` with nothing cached, a
  thumbnail URL off Wikimedia (a private address) never fetched, an HTML answer for a thumbnail
  refused, and 400 for bad ids and 41. Unit tests for the ids, file names, the intro and the credits.
  The remote suite's no-paths test covers the new GET from a phone.
- `npm test`: 238 pass; `npm run typecheck` and `npm run build` pass (the main bundle 679 KB, the
  panel's chunk 30 KB). New: the adapter's URL and the mock's `unsupported`, `mediaIds` on the real
  samples (Paley, Murray and Huxley have no id), the cover first, node radii, label offsets with a
  radius and above the centre, three-line labels, the first ring kept clear (and unchanged by
  default), the credit line, the query key.
- Live, free: the dev server's media route for Darwin's map against the real Wikimedia, with the
  server's User-Agent: 7 pictures and intros in 0.6 s, then 17 ms from the cache. It showed two
  things the fixtures then gained: thumbnails now come from `thumb.wikimedia.org`, and an artist
  can carry a hidden copy ("Unknown author<span style="display: none;">Unknown author</span>").
- In a browser (Playwright's Chromium over CDP, the dev server on a scratch copy of the dev data with
  an empty `XDG_CONFIG_HOME` and no key): at 1440 and 1920 px, the Assistant list and Darwin's map
  with portraits of Darwin, Wallace, Lyell, Hooker and Malthus, Down House, the library's cover on the
  book and shapes for Paley, Murray and Huxley; Malthus's and Wallace's cards beside the map; "In the
  briefing" from the card (switches to the text and flashes the item); the Timeline and Austen's
  Places with the card beside them (Chawton's photograph); Austen's and Nietzsche's maps; the focused
  Malthus map (his portrait at the centre); the Briefing tab as a 720 px column; the dark theme; the
  reader's panel (shapes, the card below with its picture, scrolled below the tabs) and its full
  screen (pictures); at 390 px the page stacked and a tap scrolling to the card; the media route
  blocked (only the library cover, no errors). No page errors.
- Fixed on the way: the centre's name and picture colliding with the first ring (Nietzsche), cut
  side names ("Alfred Russel…"), the card's picture hidden under the sticky tabs, and the panel's
  map crowded by pictures (hence the 420 px threshold).

**Not verified:** a real device; Wikimedia's answers for every kind of entity (an idea's lead image
can be its author's portrait: "God is dead" shows Nietzsche, as Wikipedia does).

**Left:** nothing planned. The real API on schema v2 and on a focused run stays the user's paid check.
Later ideas: streaming sections (Decision 12 says why not now), the iPhone app's native "Context for
this" item.
