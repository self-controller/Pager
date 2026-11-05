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
1. **The book in one paragraph:** what it is, when and where it was written, and what kind
   of book it is (novel, treatise, polemic, reply to someone, …).
2. **Historical moment:** the events, institutions and debates of the author's time that the
   book assumes the reader knows.
3. **The author's conversation:** people, works and movements the author was reading,
   answering, attacking or building on. Say what the relationship was: "replies to",
   "borrows from", "satirises".
4. **Read first?** Works that help with this book. Put each in one of three tiers:
   - **Essential:** the book doesn't make sense without it. Give the specific reason.
   - **Helpful:** it adds a lot, but you can skip it.
   - **Optional / later:** for after the book, or for deeper study.
   For each one, say *what* to read (the whole work, one chapter, or a summary is enough)
   and roughly how long it takes.
5. **Key terms and names** the book uses without explaining them.
6. **Further reading:** a few respected scholarly treatments (a standard biography, a
   major critical study, an accessible introduction), each with one line on who it suits.

The briefing should be short: a reader takes it in within about 3 minutes, and each section
expands for more.

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
  3. **Research and draft** (the model): web search, web fetch and two client tools,
     `find_book` (Open Library search) and `find_article` (Crossref search), so works are
     cited by real identifiers rather than remembered ones. The model hands back the
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
   - how strict "Essential" is (a scholar gets fewer essentials, but primary sources and
     critical debates);
   - which further reading is chosen (accessible introductions vs. standard monographs
     and journal articles).
   Cache per book *and* level; switching level loads that level's cached briefing or
   offers to generate it.

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
- **Phase 2: reader UI and phone.** The `context` `PagerTool` and its Panel: sections,
  tiers, citation links, spoiler folds, Refresh, the "generated at" stamp, the
  reader-level setting, the "not much is known" note, and the error, no-key and offline
  states. Add the routes to `REMOTE_ALLOW` with the per-device daily limit, and check the
  panel at phone width.
- **Phase 3: selection action.** "Context for this" on a selected name or work, reusing
  the Phase 1 pipeline with a narrowed query, and caching per item. A selection longer
  than 120 characters is refused ("Select a name or a title"). The iPhone app's text menu
  is a fixed list (`NativeMenuItem` in `src/lib/native.ts`, mirrored in Swift), so the
  action is web-only until the app adds an item.
- **Phase 4 (optional): polish.** Cost and latency measurements, streaming sections in as
  they're verified, and the Assistant page entry.

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
  The user runs it with their key at the end of a phase. Don't run it yourself unless the
  user says so. `--dry-run` prints the exact payload that would be sent; it needs no key
  and makes no network calls, so it is safe to run.

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
- On the 3 test books, in the user's live check, every recommended work resolves to a real record, every link opens, and
  no section shows an unsourced claim.
- A test feeds the verifier a made-up citation, and it is rejected.
- A failed search or no network shows a clear error, never an unsourced briefing.
- An obscure book gets the "not much is known" note, with no padded items.
- The same book at General and Scholar levels gives noticeably different "Essential" and
  further-reading lists.
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
