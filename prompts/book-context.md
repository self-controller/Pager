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
  Open Library or WorldCat ID, or a stable URL that you fetched and checked. If no record
  resolves, drop the item. Never invent a citation, a page number or a quote.
- Each claim gets 1–3 citations: title, author, year, link. Prefer scholarly and
  reference sources over blogs; use Wikipedia only to get your bearings, never as the
  only source.
- Where scholars disagree (for example about the author's influences), say so and cite
  both sides. Don't flatten the disagreement.
- Put a confidence mark on anything that is inferred rather than stated by a source.

## Input from the book
- Use metadata (title, author, date, publisher) and front matter (preface, introduction,
  translator's note, bibliography, the notes) as signals. Names and works cited in the
  book itself are strong leads for section 3.
- Extract locally, on the computer: pull names, works and terms from the notes,
  bibliography, italic or quoted titles, and recurring capitalized names. Send the model
  only these short lists plus metadata and front matter, never chapters of body text. The briefing is
  about the book's context, not its plot. Spoiler rule: never reveal plot events. If a
  context item gives away the ending, hide it behind a marked "contains spoilers" fold.

## Architecture (Pager)
- Register a `PagerTool` (id `context`) in `src/tools/registry.ts` with a `Panel`. Also
  add a selection action, "Context for this", which runs the same pipeline on a selected
  name or work, narrowed to that one item.
- The backend does the work in the Rust server under `/api/tools/context/*` (see
  CONTRACT.md): it calls the LLM with a search tool, then a verification pass that
  resolves every citation, then stores the result.
- Cache the result per book (keyed by book ID + content hash) so it costs money once.
  Offer "Refresh", and show when the briefing was generated.
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
7. **iPhone: yes, the phone gets Context and can start briefings.**
   - Add the `/api/tools/context/*` routes to `REMOTE_ALLOW` in
     `server/src/http/remote.rs` and extend its test.
   - Starting a briefing from the phone spends money through the computer's key, so put a
     limit on new briefings per paired device per day (default 10, a server setting).
     Cached briefings and refreshes still inside the cache don't count. Over the limit, the
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

## Phases (split the work if it's too big for one pass)
If the whole feature doesn't fit cleanly in one pass, build it in phases. Commit each
phase on the branch, and end each one with passing tests and a short Progress note in
this file (what was built, what's left, what was verified and how). Don't start a phase
until the previous one works.

- **Phase 1: backend pipeline, no UI.** The `/api/tools/context/*` route, the
  retrieval → draft → verify pipeline, the JSON schema, and the cache. Tests include a
  made-up citation that the verifier must reject. Check the output by hand on the 3 test
  books.
- **Phase 2: reader UI and phone.** The `context` `PagerTool` and its Panel: sections,
  tiers, citation links, spoiler folds, Refresh, the "generated at" stamp, the
  reader-level setting, the "not much is known" note, and the error, no-key and offline
  states. Add the routes to `REMOTE_ALLOW` with the per-device daily limit, and check the
  panel at phone width.
- **Phase 3: selection action.** "Context for this" on a selected name or work, reusing
  the Phase 1 pipeline with a narrowed query, and caching per item.
- **Phase 4 (optional): polish.** Cost and latency measurements, streaming sections in as
  they're verified, and the Assistant page entry.

If one phase turns out to be large, split it again rather than leaving it half done.

## Testing without spending money
- Every automated test (`cargo test`, `npm test`) uses a mocked model and mocked lookups,
  with recorded responses stored as fixtures. They make no network calls and need no key.
- Real API calls happen only in a separate check started by hand (for example
  `cargo run --example context-live -- <book>`), which prints the token and search counts.
  The user runs it with their key at the end of a phase. Don't run it yourself unless the
  user says so.

## Test books
These go in `reads/context-test/` (the library folder, which git ignores). The user adds
them; if they aren't there yet, build against the mocks and say which are missing.
- **Classic novel:** Jane Austen, *Pride and Prejudice*, the Project Gutenberg EPUB
  (ebook #1342).
- **Philosophy:** Friedrich Nietzsche, *Thus Spoke Zarathustra*, translated by Thomas
  Common, the Project Gutenberg EPUB (ebook #1998).
- **Modern nonfiction:** Bart D. Ehrman, *Misquoting Jesus: The Story Behind Who Changed
  the Bible and Why* (HarperSanFrancisco, 2005), in a DRM-free EPUB. It's a good test
  because scholars dispute it in print (for example Daniel B. Wallace's reviews), so the
  "where scholars disagree" rule gets exercised.

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
  response or log.
- A paired phone can start a briefing, and the per-device limit blocks the 11th new one
  in a day (tested in `server/tests/remote.rs` or a new test).
- All work is on the `ai-book-context` branch, committed per phase.
