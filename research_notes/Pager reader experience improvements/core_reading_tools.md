# Core (non-AI) reading tools in best-in-class ebook readers, and what Pager should add

Scope: in-book search, lookup, annotations, read-aloud, statistics, navigation aids, library-to-reader touches, accessibility. AI features are out of scope. Current to October 2026 as far as sources allow.

The research looked only briefly at Pager's code (grep of `src/` and `shared/src`), so the coverage notes below are rough. Another researcher owns the full audit.
- **Already in Pager:** W3C-style quote selectors (`exact`/`prefix`/`suffix`) and an `"orphaned"` anchor status (`/home/david/Desktop/projects/Pager/shared/src/annotation.ts`), bookmarks in the annotation model (`useReaderAnnotations.ts`), a jump history (`useJumpHistory.ts`), a learned reading speed (`readingSpeed.ts`), `prefers-reduced-motion` handling (`globals.css`, `usePagination.ts`), and library-wide search (`GET /search/documents`, `shared/src/api.ts:375`).
- **Not found in Pager:** `speechSynthesis` (TTS), any dictionary or Wiktionary lookup, an image lightbox, EPUB `page-list` handling, and streaks or goals.

## In-book search

### Takeaway
Readest and KOReader do in-book search best. Good search has these parts:
- a results list grouped by chapter, with an excerpt around each match;
- scope switches (whole book or current chapter), case and diacritics toggles, and whole-word, regex and "nearby words" modes;
- one tap to jump to a match, and a way back to where you were;
- for a selected word, a "search for more occurrences" action;
- search over your own highlights and notes.

Searching the web or Wikipedia from a selection is an old idea (Google eBooks, 2011) that is now standard in Readest and KOReader.

### Cited Findings
- **Readest search modes:** Ctrl/Cmd+F opens search. Options are Contains (the default), Whole Words, Regular Expression, and Nearby Words, which finds two or more words within 5, 10, 20 or 50 words of each other. Match Case and Match Diacritics are separate toggles, and diacritics do not apply in regex mode. — [Readest docs: Reading](https://readest.com/docs/reading)
- **Readest scope and results:** you can search the whole book or only the current chapter. Results are grouped by chapter, each with a short excerpt around the match, and clicking a result jumps to it. — [Readest docs: Reading](https://readest.com/docs/reading)
- **Readest link targets:** when a link inside a footnote jumps to another location, the target briefly flashes so the reader can find it. The same "flash the destination" idea suits search hits. — [Readest docs: Reading](https://readest.com/docs/reading)
- **KOReader search:** you can search by selecting text or typing it, including regular expressions. Bookmarks, highlights and notes are searchable too. — [KOReader user guide](https://koreader.rocks/user_guide/)
- **KOReader lookup popup:** the long-press popup can search the document for more occurrences of the selection, next to dictionary, Wikipedia and translate. — [KOReader user guide](https://koreader.rocks/user_guide/)
- **KOReader back/forward:** "Go back to previous location" and forward navigation exist, so a search jump can be undone. — [KOReader user guide](https://koreader.rocks/user_guide/)
- **Google eBooks web reader (2011):** selecting text opened a popup with Define, Translate, Search Book, Search Google and Search Wikipedia. Search Book listed every instance of the selected text. These were features of the old web reader, and it is not confirmed whether today's Play Books still has all of them. — [TechSpot](https://www.techspot.com/news/43886-google-ebooks-now-let-you-define-translate-search-for-words.html)
- **Apple Books notes search:** the Notes and Highlights panel has a search field "to find a highlight or note you don't see." That is search inside annotations, separate from book search. — [Apple Books for Mac guide](https://support.apple.com/en-us/guide/books/highlight-book-passages-and-add-notes-ibks3975f128/7.0/mac/15.0)
- **Readest web search:** any URL with a `%WORD%` placeholder works as a "Web Search" lookup source. This is a general way to add Wikipedia, Google or other sites. — [Readest docs: Translate & Lookup](https://readest.com/docs/translate)

### Inferences
- Pager already has library-wide full-text search on the Rust server. An in-book mode can probably reuse it, scoped to one document. It would show hits grouped by section with context, and would record the jump in `useJumpHistory` so the existing back pill returns the reader to where they were.
- The cheapest quality wins are these: diacritic- and case-insensitive matching by default, a "this chapter / whole book" switch, painting all matches on the current page, and next/previous match controls that keep the results list one tap away.
- Two other cheap additions: a "Search book for this" action in the selection menu, and a `%WORD%` URL template for web search.

### Gaps
- I did not verify how Kindle or Apple Books currently present in-book search results (grouping, match painting), and found no 2025–2026 primary documentation on it.
- I found no user research ranking search options. Regex and "nearby words" are probably power-user features.

## Dictionary and lookup

### Takeaway
The best readers combine several sources: offline dictionaries (StarDict, Wiktionary dumps), the system dictionary, Wikipedia, and translation. They show the results as stacked, collapsible cards in a popup, and they keep looked-up words in a vocabulary list.
- **Kindle:** Word Wise (small glosses above hard words) and Vocabulary Builder (flashcards that show the word in its original sentence) are the classic non-AI benchmark.
- **Pager on iPhone:** the most native-feeling route is to hand the word to the iOS dictionary (`UIReferenceLibraryViewController`, or WKWebView's built-in "Look Up").
- **Pager on desktop:** an offline Wiktionary-derived dictionary served by the Rust backend is the most robust option. Public web APIs are fragile.

### Cited Findings
- **KOReader basics:** long-tap looks up text in installed dictionaries or Wikipedia, and can translate it. Lookup works in EPUB and in scanned PDF/DJVU. — [KOReader user guide](https://koreader.rocks/user_guide/)
- **KOReader dictionaries:** they must be in StarDict format, placed in `koreader/data/dict` and enabled in Dictionary settings → Manage dictionaries. Priority can be set globally or per book ("Set dictionary priority for this book"). — [cameracode.coffee KOReader review](https://cameracode.coffee/koreader-language-learning); [KOReader wiki: dictionary support](https://git.blob42.xyz/Archives/koreader/wiki/commit/0390b8df51fdb29c1c331ff79f5279e667ad736f)
- **KOReader vocabulary:** it saves every looked-up word by default and has a vocabulary builder for memorizing them. — [cameracode.coffee](https://cameracode.coffee/koreader-language-learning); vocabulary builder gesture also listed in [KOReader user guide](https://koreader.rocks/user_guide/)
- **KOReader dictionary sources:** KOReader ships no commercial dictionaries, and free dictionaries vary a lot in quality. The xxyzz project packages the whole English Wiktionary as StarDict, downloadable from KOReader's dictionary menu, with data from Wikimedia Enterprise and Kiwix. — [cameracode.coffee](https://cameracode.coffee/koreader-language-learning); [xxyzz/wiktionary_stardict](https://github.com/xxyzz/wiktionary_stardict)
- **Readest built-in sources:** Wiktionary and Wikipedia, both following the book's language (a Spanish book uses Spanish editions, with English Wiktionary as a fallback). — [Readest docs: Translate & Lookup](https://readest.com/docs/translate)
- **Readest imported dictionaries:** offline bundles in StarDict, MDict, DICT, Slob, Babylon and Yomitan formats. — [Readest docs: Translate & Lookup](https://readest.com/docs/translate)
- **Readest System Dictionary:** an option that hands lookups to the OS dictionary on macOS, iOS and Android. It is off by default and locks the other providers while on. — [Readest docs: Translate & Lookup](https://readest.com/docs/translate)
- **Readest base-form retry:** if an exact match fails, English lookups retry with the base form (a lemmatizer step). — [Readest docs: Translate & Lookup](https://readest.com/docs/translate)
- **Readest popup design:** dictionary results are stacked cards whose headers expand or collapse. Translation shows beside the original with copy on both sides. Wikipedia shows an article summary in a popup. — [Readest docs: Translate & Lookup](https://readest.com/docs/translate)
- **Readest translations:** they disappear when dismissed. To keep one you must paste it into a note, and Readest has no vocabulary list. Users of a reader without word saving lose this. — [Readest docs: Translate & Lookup](https://readest.com/docs/translate)
- **Readest Word Lens:** non-AI, Word Wise-like hints above words that are hard for the reader's CEFR level (A1–C2), driven by per-language data packs. — [Readest docs: Translate & Lookup](https://readest.com/docs/translate)
- **Kindle Word Wise:** short definitions appear above harder words in eligible English books, and a slider sets how many hints show. Where a word has several meanings Kindle shows a best guess, and tapping lists the alternatives ("Show Multiple-Choice Hints"). — [Kindle User's Guide (manualslib)](https://www.manualslib.com/manual/824780/Amazon-Kindle.html?page=22); [FluentU](https://www.fluentu.com/blog/english/learn-english-kindle)
- **Kindle Vocabulary Builder:** it is on by default and saves every dictionary lookup. Each flashcard shows the word in its sentence from the book, with "See Definition" and "Mark as Mastered", and a Learning/Mastered count. — [Dummies: Vocabulary Builder](https://www.dummies.com/article/technology/electronics/tablets-e-readers/kindles/how-to-use-vocabulary-builder-on-your-kindle-paperwhite-156833/)
- **Vocabulary Builder limits:** it lacks fine-grained spaced-repetition controls, so users export it to Anki. — [Goodreads blog: Anki from Vocabulary Builder](https://www.goodreads.com/author_blog_posts/17831432-how-to-create-anki-flashcards-from-your-kindle-vocabulary-builder?tab=book)
- **Changed on Kindle (2021):** after firmware 5.13.7, sideloaded DRM-free books stopped getting Word Wise and X-Ray automatically. The calibre plugin WordDumb now generates Word Wise and X-Ray files for sideloaded KFX/AZW3/MOBI/EPUB. — [MobileRead thread](https://www.mobileread.com/forums/showthread.php?p=4150818); [xxyzz/WordDumb](https://github.com/xxyzz/WordDumb)
- **iOS system dictionary:** `UIReferenceLibraryViewController(term:)` presents the system dictionary, after checking `dictionaryHasDefinition(forTerm:)`. If no dictionary is installed, the controller offers to download one. — [ikyle.me (2025)](https://ikyle.me/blog/2025/show-ios-system-dictionary)
- **WKWebView edit menu:** WKWebView already shows Copy, Look Up and Translate for selected text. A 2023 report found the menu missing for PDFs in WKWebView, and WebKit added Look Up for PDF selections in February 2024. — [Apple Developer Forums](https://developer.apple.com/forums/thread/735532); [WebKit changes, Feb 2024](https://lists.webkit.org/pipermail/webkit-changes/2024-February/297802.html)
- **Customizing the WKWebView menu:** removing items such as Copy, Define or "Search Web" has been unreliable in forum reports. — [vicegax: Removing Search Web](https://vicegax.substack.com/p/removing-search-web-from-a-context); [Apple Developer Forums](https://developer.apple.com/forums/thread/715957)
- **Wiktionary REST endpoint:** `GET https://en.wiktionary.org/api/rest_v1/page/definition/{term}` returns definitions grouped by language and then part of speech. A browser extension uses it and falls back to the Free Dictionary API when it fails. — [Knowledge Tooltip docs](https://www.mintlify.com/ibralassaf/knowledge-tooltip/api/wiktionary)
- **That endpoint's status:** Wikimedia Phabricator calls it experimental and English-only, and a later task proposes deleting it because it has barely been updated since about 2016. Its outcome and current status are unverified. Wiktionary content is CC BY-SA. — [Phabricator T119235](https://phabricator.wikimedia.org/T119235); [Phabricator T123142](https://phabricator.wikimedia.org/T123142)
- **Free Dictionary API:** `GET https://api.dictionaryapi.dev/api/v2/entries/en/<word>` needs no key. Its maintainer has written about rising AWS costs threatening uptime. — [Free Dictionary API README](https://cdn.jsdelivr.net/gh/meetdeveloper/freedictionaryapi@master/README.md)
- **Google eBooks web reader:** Define showed a definition in a popup without leaving the page. Translate covered words or several sentences. — [TechSpot](https://www.techspot.com/news/43886-google-ebooks-now-let-you-define-translate-search-for-words.html)

### Inferences
- **On iPhone:** add a "Define" item to Pager's selection menu. It would call a native bridge that presents `UIReferenceLibraryViewController`. This needs no data, works offline, and covers the dictionaries the user already has installed. The system "Look Up" may already appear in WKWebView's native menu, depending on how `useNativeMenu.ts` configures it.
- **On desktop and as a common path:** the Rust server could hold an offline dictionary, for example the English Wiktionary StarDict from xxyzz or a Wiktextract JSON dump. It would expose `/lookup?word=` with a simple lemmatizer fallback. The web card then shows definition, part of speech and pronunciation, plus links to Wikipedia and a web search. This avoids depending on the experimental Wiktionary REST endpoint and on dictionaryapi.dev's uptime.
- **Save lookups:** keep each looked-up word with its sentence and location (a Vocabulary Builder equivalent). It is cheap given Pager's annotation model. It could even be an annotation with a "lookup" motivation, which would make export to Anki or Markdown trivial.
- Word Wise-style inline glosses are a bigger project (they need frequency data per language). They are likely low value for a personal reader of English non-fiction unless the user reads in a second language.

### Gaps
- I did not confirm whether `UIReferenceLibraryViewController` lets an app hide its "Search Web" and "Manage" buttons, or read the definition text into a custom card. Forum threads I found leave this unresolved.
- I did not confirm Kobo's current dictionary UX, such as multiple dictionaries or a swipe between them.
- The current status and rate limits of the Wiktionary REST definition endpoint are unconfirmed, and so is whether dictionaryapi.dev allows browser requests from other sites (CORS).

## Annotations, export, sharing and re-anchoring

### Takeaway
Leaders offer:
- 4–5 colours plus style variants (underline, strikeout or squiggly, invert);
- notes, often in Markdown;
- named bookmarks;
- a notebook that can be filtered by colour or style and searched;
- export to Markdown (aimed at Obsidian), JSON, Kindle "My Clippings" format, and Readwise or Notion;
- a quote-as-image card, which Kindle has and Apple Books does not.

For keeping highlights attached when the file changes, the reference design is Hypothesis: several selectors per annotation (range, position, and quote with about 32 characters of prefix and suffix), tried in order, with fuzzy matching as a fallback and a visible "Orphans" list. Pager already stores W3C-style quote selectors and an orphaned status, so it is ahead of most readers here.

### Cited Findings
- **KOReader styles and markers:** highlight styles are Lighten, Underline, Strikeout and Invert, and colours can be combined with styles on colour screens. A note is shown by an Underline, Side line or Side mark. The bookmark list can show text, note or both, set a maximum number of lines, and filter by highlight style. — [KOReader user guide](https://koreader.rocks/user_guide/)
- **KOReader export formats:** Text, HTML, Markdown, Kindle Clippings (.txt) and JSON, plus Joplin, Readwise, Memos, Flomo and XMNote. You can export for the current book or for all books in history. Highlights live in a `.lua` file in the book's `.sdr` folder. — [KOReader user guide](https://koreader.rocks/user_guide/)
- **Readest styles:** Highlight, Underline and Squiggly; five default colours plus custom colours; notes in plain text or Markdown, editable in place in the Notebook. — [Readest docs: Reading](https://readest.com/docs/reading)
- **Readest Excerpts and bulk highlighting:** Excerpts save a quote without marking the page. "Apply to every occurrence" highlights every match of a phrase in the book. — [Readest docs: Reading](https://readest.com/docs/reading)
- **Readest imports and toolbar:** it imports Moon+ Reader (.mrexpt) and ReadEra (.bak) annotation backups, and the selection toolbar is customizable. — [Readest docs: Reading](https://readest.com/docs/reading)
- **Readest export:** formats are Markdown (designed for Obsidian), Plain Text and JSON (which Readest can re-import), with custom Jinja2-style templates. Options cover title, author, date, cover, chapter titles, page numbers and note dates. Links can be `readest://` app links or web links back to the passage. A filter excludes certain colours or styles. On mobile the export goes through the system share sheet. — [Readest docs: Reading](https://readest.com/docs/reading)
- **Readest bookmarks:** Ctrl/Cmd+B or a pull-down gesture on touch screens toggles a bookmark, shown as a ribbon. Bookmarks can be named and are listed in a sidebar tab. — [Readest docs: Reading](https://readest.com/docs/reading)
- **Apple Books:** you choose a highlight colour or underline from the selection menu. Highlights and notes are viewed in a Notes panel with a search field. Swiping left deletes a note on iPad. — [Apple iPad guide](https://support.apple.com/en-mn/guide/ipad/ipadd3c9dc47/13.0/ipados); [Apple Books for Mac guide](https://support.apple.com/en-us/guide/books/highlight-book-passages-and-add-notes-ibks3975f128/7.0/mac/15.0)
- **Kindle exports:** Kindle e-readers keep `My Clippings.txt`, a plain-text log of every highlight, note and bookmark. Amazon's own export works one book at a time and is emailed. Third-party tools import from read.amazon.com/notebook with the original colours. — [web-highlights: exporting Kindle highlights](https://web-highlights.com/tutorials/pdf-web-highlighter/how-to-export-kindle-highlights)
- **Kindle quote images:** the Kindle iOS app (6.26, January 2020) turns a highlight into a shareable image card with several layouts, colour schemes and fonts, showing the author and title. — [The eBook Reader blog](https://blog.the-ebook-reader.com/2020/01/16/kindle-ios-app-adds-option-to-turn-quotes-into-images-for-sharing/); [Good e-Reader](https://goodereader.com/blog/kindle/amazon-kindle-app-can-turn-quotes-into-images); [ebookfriendly](https://ebookfriendly.com/kindle-ipad-share-book-quotes-images/)
- **Apple Books sharing:** I found no built-in quote image card in Apple Books. Sharing a highlight sends text, and third-party apps such as Qwote fill the gap from the Share sheet. — [iPhoneLife (older iBooks tip)](https://iphonelife.com/blog/32626/tip-day-how-share-quote-ibooks); [Qwote on the App Store](https://apps.apple.com/tt/app/qwote/id1514390362?l=fr-FR)
- **Kobo:** there is no official highlight export. Users add an `ExportHighlights` setting to "Kobo eReader.conf" or use calibre's Annotations plugin. — [MobileRead thread](https://www.mobileread.com/forums/showthread.php?p=4033614)
- **Readwise Reader:** it sends highlights to Readwise, which exports to Obsidian, Notion, Roam, Evernote, Logseq and more. In January 2025 it added full-text export to Obsidian, not just highlights. Users praise its tagging. — [Readwise Reader (App Store)](https://apps.apple.com/us/app/id1567599761?l=en-us); [Readwise update Jan 2025](https://readwise.io/reader/update-jan2025)
- **W3C TextQuoteSelector:** it stores `exact` plus `prefix`/`suffix` to tell repeated text apart. TextPositionSelector stores character offsets and is "brittle" when the resource changes. FragmentSelector can carry an EPUB CFI. `refinedBy` nests a narrower selector inside a broader one. — [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/)
- **W3C multiple selectors:** "Multiple Selectors can be given to describe the same Segment in different ways" to improve the chance of finding it later. Motivations include bookmarking, highlighting, commenting, tagging, describing and linking. — [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/)
- **Hypothesis selectors:** each annotation stores RangeSelector (XPath and offsets), TextPositionSelector, and TextQuoteSelector with a 32-character prefix and suffix. — [Hypothesis: Fuzzy Anchoring](https://web.hypothes.is/blog/fuzzy-anchoring/)
- **Hypothesis re-anchoring order:** (1) range, checked against the quote; (2) position, checked against the quote; (3) a fuzzy search for the prefix near the expected start and the suffix near the expected end, accepted if the text between them is close to the quote; (4) a fuzzy search of the whole document for the quote. It uses a modified diff-match-patch library (Bitap for fuzzy matching, Myers diff for comparison). — [Hypothesis: Fuzzy Anchoring](https://web.hypothes.is/blog/fuzzy-anchoring/)
- **Hypothesis orphans:** an annotation that cannot be re-anchored, for example because its paragraph was deleted, is an "orphan". Hypothesis used to hide orphans, which made annotations appear to vanish. Client 1.2.0 added an Orphans tab that appears only when orphans exist. — [Hypothesis: Showing Orphaned Annotations](https://web.hypothes.is/blog/showing-orphaned-annotations)

### Inferences
- **Re-anchoring:** Pager's model already matches the W3C and Hypothesis approach. The remaining work is presentation:
  - an Orphans section on the Highlights page and in the book's annotation list (conditional, like the Hypothesis tab), showing the quote and note with a "re-attach to selection" action;
  - a visible "moved" or "fuzzy-matched" badge, if the server reports approximate matches.
- **Highest-value annotation additions:**
  1. Filter the Highlights page by colour, style and chapter, and search inside notes (Apple Books, KOReader, Readest).
  2. Markdown export with a template, aimed at Obsidian, with a deep link back to Pager for each highlight; JSON for backup and re-import.
  3. A Kindle-clippings-compatible text export, for tools that already parse that format.
  4. A quote-card image, rendered client-side with canvas or SVG and handed to the iOS share sheet.
  5. Named bookmarks with a ribbon indicator, if Pager does not already show them.
  6. Margin markers for paragraphs that carry notes (KOReader's "Side mark").
- Readwise has a documented highlights API. Direct Readwise push is optional for a personal tool; a Markdown or JSON export covers Obsidian and Notion imports without API keys.

### Gaps
- I did not verify current Apple Books highlight colours (historically five plus underline) or whether Apple added filters in iOS 18–26. I found no iOS 26 Books release notes.
- I did not verify current Kindle notebook filters (by colour or type) from Amazon's own help pages.
- I did not verify Readwise's highlight API details, or which export formats Obsidian plugins prefer, from primary docs.

## Read-aloud (TTS)

### Takeaway
The current benchmark (Readest, Edge Read Aloud, Kindle Assistive Reader, Voice Dream) has these parts:
- highlighting of the word or sentence being read;
- auto page-turn or follow-scroll;
- speed from 0.5× to 3×;
- skipping by sentence or paragraph;
- "start reading from here" on a long-pressed word;
- a sleep timer that can stop at the end of the chapter;
- background playback with lock-screen controls;
- a choice of neural voices.

On iOS, the Web Speech API is risky:
- voice lists are incomplete (often only the low-quality "Eloquence" voices since iOS 18);
- boundary events in Safari reportedly come per sentence, not per word, and lack `charLength`;
- background and lock-screen playback is unreliable even for native code.

So Pager should drive TTS from native code on iPhone (`AVSpeechSynthesizer` through the bridge, or audio from a server-side neural voice) and use Web Speech only as a desktop fallback.

### Cited Findings
- **Kindle Assistive Reader:** it uses the device's OS text-to-speech engines with real-time text highlighting. It has speed control and a 30-second rewind, and long-pressing a word can start reading from that point. It is limited to Kindle books with Enhanced Typesetting, in languages the device's TTS supports. — [Amazon help: Assistive Reader](https://digprjsurvey.amazon.com/csad/help/node/TqLHvK6eo6O7DJVQoZ)
- **Assistive Reader on iOS:** it came with Kindle iOS 7.15, and an early review said each word is highlighted as it is read. — [Good e-Reader: assistive reading](https://goodereader.com/blog/tag/assistive-reading)
- **Readest engines:**
  - Native OS voices: offline, iOS and Android only.
  - Web Speech: web app only.
  - Edge TTS: Microsoft's cloud neural voices, the default when online. It needs a network connection and sends the current sentence to Microsoft's servers.
  - Readest Voice: paid.
  - Custom OpenAI-compatible speech services, such as a local Kokoro server.
  - [Readest docs: Listen](https://readest.com/docs/listen); [Readest README](https://github.com/readest/readest)
- **Readest highlighting:** word highlighting is the default but needs engines that report word timings (Edge TTS and Web Speech). Native voices, CJK text and custom services highlight by sentence. Styles are highlight, underline, strikethrough, squiggly or outline, in an adjustable colour. Shift+M saves the sentence being read as a permanent highlight. — [Readest docs: Listen](https://readest.com/docs/listen)
- **Readest follow-along:** in paginated mode the page turns when reading crosses the edge of the visible content. In scrolled mode the view keeps the current sentence visible. A "lyric-style" transcript centres on the current sentence. — [Readest docs: Listen](https://readest.com/docs/listen)
- **Readest controls:**
  - speed from 0.5× to 3×, taking effect immediately;
  - "Pause After Each Sentence" and A-B repeat;
  - a sleep timer that stops at the end of the chapter or after 1 minute to 8 hours;
  - background playback with lock-screen and media-key controls on iOS, Android, macOS and Windows;
  - shortcuts: T (toggle), Space, Ctrl+[ ] for sentence, Ctrl+Shift+{ } for paragraph, Ctrl+R to read the selection only.
  - [Readest docs: Listen](https://readest.com/docs/listen)
- **Readest voice choice:** voice lists are filtered by the book's language, and voices switch automatically in multilingual books. Playback starts from the current paragraph. — [Readest docs: Listen](https://readest.com/docs/listen)
- **Edge TTS protocol:** third-party crates replicate Edge's "Read Aloud" WebSocket protocol and return streaming MP3 frames plus word-boundary metadata. This means a server, such as Pager's Rust backend, could proxy it. It is an unofficial, reverse-engineered API. — [kothok-edge-tts crate](https://libraries.io/cargo/kothok-edge-tts)
- **Edge Read Aloud and Immersive Reader:** play, skip to the previous or next paragraph, and voice options for voice and pace. The reader view adds Line focus, which shows 1, 3 or 5 lines at a time. — [Microsoft Support: Immersive Reader in Edge](https://support.microsoft.com/en-us/education/use-immersive-reader-in-microsoft-edge-1)
- **Edge voices:** third-party guides describe them as natural-sounding, with word-by-word highlighting. — [Louth College blog](https://blogs.loucoll.ac.uk/learningtechnology/read-aloud-and-immersive-reader-in-the-edge-browser/)
- **Readwise Reader:** its TTS v3 (January 2025) brought "more lifelike voices" and better progress tracking. — [Readwise update Jan 2025](https://readwise.io/reader/update-jan2025)
- **Voice Dream Reader:** in 2024 it moved to a $59.99/year subscription. After a backlash the new owner, Applause, reversed this for existing buyers, but new features may be subscription-only. It is still the reference for sentence highlighting and precise TTS control. — [Perkins: Voice Dream subscription controversy](https://www.perkins.org/resource/voice-dream-reader-subscription-controversy/); [AppleVis](https://applevis.com/comment/165982); [TeleRead](https://teleread.com/voice-dream-reader-for-android-must-buy-if-you-want-first-class-text-to-speech-from-nondrmed-books/index.html)
- **Moon+ Reader Pro:** TTS starts with "shake the phone to speak" and works with headset and Bluetooth keys. I found no confirmed sleep timer. — [MobileRead wiki: Moon+ Reader](https://wiki.mobileread.com/wiki/Moon+_Reader)
- **Web Speech support:** Speech Synthesis has been supported in Safari for iOS since version 7, through 26.x. — [caniuse: speech-synthesis](https://caniuse.com/speech-synthesis)
- **Web Speech boundary events:** MDN marks the `boundary` event as not Baseline. `charLength` is 0 when the engine cannot supply it. — [MDN: boundary event](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/boundary_event)
- **Safari boundary granularity:** one 2026 review says Chromium fires boundary events per word and Safari per sentence. This is a low-authority source and needs a device test. An older write-up says Safari omits `charLength`. — [textintoaudio browser support (May 2026)](https://textintoaudio-com.pages.dev/browser-support.html); [Coder's Block: JS TTS quirks](https://codersblock.com/blog/javascript-text-to-speech-and-its-many-quirks/)
- **iOS voice-list bugs:**
  - `getVoices()` on iOS has missed voices since 16.0.2, and one comment says it worsened on iOS 18, listing only low-quality "Eloquence" voices;
  - newly downloaded system voices are not listed;
  - the voice list does not load every time.
  - [WebKit bug 250665](https://bugs.webkit.org/show_bug.cgi?id=250665); [WebKit bug 290497](https://bugs.webkit.org/show_bug.cgi?id=290497); [WebKit bug 159656](https://bugs.webkit.org/show_bug.cgi?id=159656)
- **iOS Safari audio side-effects:** `speechSynthesis` ducks other audio, and `navigator.audioSession.type` does not fix it. Speech can also pause video elements. — [WebKit bug 278598](https://bugs.webkit.org/show_bug.cgi?id=278598); [WebKit bug 218815](https://bugs.webkit.org/show_bug.cgi?id=218815)
- **Screen lock:** even native `AVSpeechSynthesizer` has been reported to pause mid-utterance when the screen locks, despite a background audio session. — [Apple Developer Forums thread 849627](https://developer.apple.com/forums/thread/849627)

### Inferences
- **iPhone engine:** speak through the iOS bridge with `AVSpeechSynthesizer`. It has the full voice list, including Enhanced and Premium voices, word ranges through its delegate (`willSpeakRangeOfSpeechString`), and real background audio. The app would also need the `audio` background mode and Now Playing / remote command integration.
- **Desktop and natural voices:** optionally have the Rust server stream Edge TTS or a local Piper/Kokoro model. The server returns audio plus word timings, which plays through an `<audio>` element. That gives media-session controls in browsers.
- **Web Speech:** use it only as a no-setup desktop fallback, with sentence-level highlighting assumed.
- **Must-have UX:**
  - start from the current paragraph, or from a long-pressed word;
  - highlight the sentence being read, and the word where timings exist;
  - follow-scroll in Scroll layout and auto-turn in paged layout;
  - speed control, sentence and paragraph skip, and chapter auto-advance;
  - a sleep timer with an "end of chapter" option;
  - after playback, "return to the reading position" versus "keep the listened position" (Readest has controls to return to the current reading position).

### Gaps
- I found no authoritative 2026 test of Web Speech inside WKWebView, specifically whether it exposes Enhanced or Premium voices or Personal Voice and whether it keeps playing in the background. A device test is needed.
- I could not confirm whether Apple Books has a native read-aloud mode in iOS 18–26. It has historically relied on system Speak Screen. Speechify features were not researched in depth.
- Edge TTS is unofficial and reverse-engineered. I found no source on its terms or stability.

## Reading statistics and goals

### Takeaway
KOReader's statistics plugin is the most loved: reading sessions, calendar view, "today's timeline", per-page time in its Book map, and per-book time-left estimates from the reader's own speed. Third-party dashboards (KoShelf) show demand for heatmaps and history.

Apple Books (daily-minutes goal, default 5 minutes, plus a yearly books goal) and Kindle app Reading Insights (consecutive weeks and days) offer streaks. Readers find streaks motivating, but all-or-nothing resets cause anxiety, so streaks should be opt-in with low thresholds.

Time-left estimates should come from the user's own speed. Kindle learns it on the device and is known to be skewed by idle time. Pager's learned speed already matches Kindle's approach.

### Cited Findings
- **KOReader statistics plugin:** it "calculates reading sessions statistics and reading speed for use in chapter/book remaining time estimations." Gesture actions include "show calendar view", "show today's timeline", "show progress", "show time range" and "synchronize" (stats sync across devices). A "Daily timeline starts at…" setting moves the day boundary. — [KOReader user guide](https://koreader.rocks/user_guide/)
- **KOReader per-page time:** per-page time appears in the Book map when the statistics plugin is on. — [KOReader user guide](https://koreader.rocks/user_guide/)
- **KOReader stats menu:** Current book, Reading progress, Time range, Calendar view, Today's timeline. — [MobileRead](https://www.mobileread.com/forums/showthread.php?p=4495092)
- **KoShelf (third-party):** a monthly calendar of what was read each day, plus per-book session count, average session length, reading speed, last read date and a page-level activity heatmap. — [KoShelf on AlternativeTo](https://alternativeto.net/software/koshelf/about)
- **The eBook Reader blog (May 2025):** ereaders lack useful history and stats. Readers want date completed, date added or borrowed, pages remaining and average time to finish. Kindle e-readers show no stats at all. Kobo shows only time spent, minutes per session, pages per minute and estimated time. Boox NeoReader shows date completed. Commenters praise KOReader's weekly bar charts and monthly calendars. One reader keeps her own spreadsheet; another cannot remember where she left off in a series. — [The eBook Reader blog](https://blog.the-ebook-reader.com/2025/05/19/ebook-readers-lack-useful-reading-history-and-reading-stats/)
- **Kindle Reading Insights:** consecutive weeks read, consecutive days read, and a calendar of reading days. It is in the Kindle app and on the web, not on Kindle e-readers. — [Good e-Reader](https://goodereader.com/blog/kindle/kindle-reading-insights-is-an-excellent-system-that-monitors-reading-habits)
- **Kindle Insights complaints:** recent app-store reviews say the reading days are not recorded and that Insights and achievements were removed from the home page. These are unconfirmed user reports. — [AppTail Kindle reviews](https://apptail.io/app/amazon-kindle-af/united-states)
- **Apple Books goals:** the daily goal defaults to 5 minutes and is adjustable. The current and record streaks show under Reading Goals, with a notification when you set a record. Turning off Reading Goals hides the indicators but keeps the data, and clearing data is a separate step. — [Apple iPhone User Guide: reading goals](https://support.apple.com/en-me/guide/iphone/iph6013e96f4/ios)
- **Apple Books coaching:** an optional "coaching" notification sends encouragement. — [Apple Vision Pro User Guide](https://support.apple.com/es-la/guide/apple-vision-pro/dev46c0d108e/1.0/visionos/1.0)
- **Kindle time-left basis:** estimates are computed on the device from the reader's observed speed, shown as "learning reading speed" until a few pages are turned, and based on words per page and time per page turn. A 2013 report says the speed data stays on the device. — [MobileRead](https://www.mobileread.com/forums/showthread.php?p=2948943); [Kaedrin (2013)](https://kaedrin.com/weblog/2013/05/kindle_updates)
- **Kindle time-left problems:** idle time, such as leaving the book open, skews the estimate. Users reset it with a search-box command whose exact spelling is disputed (`;ReadingTimeReset`). — [TekRevue](https://www.tekrevue.com/tip/reset-remaining-chapter-book-time-kindle/)
- **Amazon's book-level estimate:** the store's "typical time to read" appears to assume about 250 words per minute, not personal pace. — [Goodreads author blog](https://www.goodreads.com/author_blog_posts/19325480-kindle-s-down-to-earth-estimates-of-reading-speed)
- **StoryGraph streaks:** a daily streak resets after a missed day. The team made it opt-in "so as not to stress out anybody not interested." Users ask for minute- or page-based thresholds so audiobook listening counts, and for milestone badges (30, 60, 100 days, a year) that reward commitment rather than speed. — [StoryGraph roadmap: daily streak](https://roadmap.thestorygraph.com/features/posts/daily-streak); [StoryGraph roadmap: milestone request](https://roadmap.thestorygraph.com/requests-ideas/posts/reading-streak-milestone-awards-and-shareable-markers)
- **Streaks as motivation:** one user credits reading streaks with beating last year's total. — [rationalish Substack](https://rationalish.substack.com/p/from-goodreads-to-storygraph)

### Inferences
- **What Pager has and needs:** Pager has a learned reading speed, so it probably already records session-like data. The highest-value additions are:
  1. a per-book "history" card: started, finished, total time, sessions, average speed;
  2. a calendar heatmap of reading minutes;
  3. a finished-books log with dates (what the eBook Reader commenters want);
  4. time-left for chapter and book from the reader's own speed.
- **Estimate rules:** use session boundaries (stop counting after N minutes without interaction, and pause when the page is hidden) to avoid Kindle's idle-time skew. Show "learning…" until enough samples exist.
- **Goals and streaks:** make them optional and off by default. Prefer a low daily threshold (minutes or pages) and weekly rather than daily streaks (Kindle's "weeks in a row" is gentler). No guilt notifications.

### Gaps
- I did not find KOReader's exact time-left formula, or its min/max page-duration filters, in the user-guide sections I read. The plugin source would answer this.
- I found no systematic study of whether streaks help or harm reading; the evidence is anecdotal (roadmap comments, blogs).
- I did not confirm Apple Books' iOS 26 behaviour; the guide pages found may be older.

## Navigation aids

### Takeaway
Best practice is:
- a TOC that marks the current section, shows a "current position" row, and gives page numbers per entry (Readest);
- real print page numbers from EPUB `page-list` for citing (Apple Books, behind a TOC toggle; KOReader "reference pages"; Readest footer option);
- go to page or percent (KOReader Skim);
- back and forward location history (KOReader);
- a progress bar with chapter tick marks (Readest);
- a "book map" overview (KOReader);
- footnotes in popups where the popup text supports the full toolset (Readest);
- full-screen pinch-zoom for images and tables.

Pager already has the TOC drawer, footnote popovers, jump history and back pill. The main gaps are print page numbers, go-to, chapter ticks, and an image or table viewer.

### Cited Findings
- **Readest TOC and progress:** the TOC sidebar highlights the current section, shows a "Current position" row, gives each entry a page number, and wraps long headings. An optional progress bar shows chapter boundaries. The footer can show a page number, a percentage, or the book's reference pages. Alt+←/→ moves between chapters. — [Readest docs: Reading](https://readest.com/docs/reading)
- **Readest footnotes:** tapping a footnote link opens a popup that keeps your place. Popup text supports copy, highlight, annotate, translate, dictionary, Wikipedia and read-aloud. Links inside a note jump to their target and briefly flash it. — [Readest docs: Reading](https://readest.com/docs/reading)
- **Readest images:** in fixed-layout books, tapping an image or table opens it full-screen with pinch-zoom. Long-press saves or copies an image. Table handling beyond full-screen is not described. — [Readest docs: Reading](https://readest.com/docs/reading)
- **KOReader navigation:**
  - go to page: tap the page number in the Skim widget and enter a page or percentage, or tap the progress bar;
  - back and forward location history;
  - reference pages: "Use reference page numbers", with labels shown in the margin;
  - "Book map", "Book map (overview)" and "Page browser" views;
  - "Allow larger tap area around links".
  - [KOReader user guide](https://koreader.rocks/user_guide/)
- **Apple Books page-list:** it supports `page-list` in reflowable and fixed-layout EPUBs. Readers must turn on the print-page-number option in the TOC before page-list numbers appear. — [Apple Books Asset Guide: page-list](https://help.apple.com/itc/booksassetguide/en.lproj/itc0f175a5b9.html); [MobileRead](https://www.mobileread.com/forums/showthread.php?p=3229004)
- **Kobo page-list:** a MobileRead post says Kobo's standard reader ignores EPUB3 `page-list` and needs the older Adobe `page-map`. A tool (epub_pager) generates page lists for books that lack them. — [MobileRead](https://www.mobileread.com/forums/showthread.php?p=3936586); [epub_pager](https://github.com/tthkbw/epub_pager)
- **Apple Books popup footnotes:** the markup is `<a epub:type="noteref">` plus `<aside epub:type="footnote">`, and the aside is hidden in the body and shown only in the popup. Popups are a reading-system behaviour, not required by the spec. Readers that do not support them show notes as linked endnotes. — [Apple Books Asset Guide: footnotes](https://help.apple.com/itc/booksassetguide/en.lproj/itccf8ecf5c8.html); [MobileRead](https://www.mobileread.com/forums/showthread.php?p=4293158); [ebookpbook (2026)](https://www.ebookpbook.com/2026/05/12/footnotes-endnotes-print-ebook/)
- **EPUB 3.3 locators:** the EPUB locator note defines how to reference positions in a publication. — [W3C EPUB 3.3 Locators](https://w3c.github.io/epub-specs/epub33/locators)

### Inferences
- **Print page numbers:** Pager's server parses EPUBs. It could read the `page-list` nav, or `epub:type="pagebreak"` markers, and map them to block offsets. The footer cycle then gains a "p. 123 (print)" state, and highlight exports gain citable page numbers. Readest and Apple both make this optional.
- **Go-to and scrubbing:** "Go to page / % / location" plus a scrubber with chapter tick marks fits the existing footer or top bar. Jumps should be recorded in `useJumpHistory` so the back pill works.
- **Images and tables:** tap an image to open a full-screen lightbox with pinch-zoom (on iOS WKWebView, a CSS-transform zoom or a native `UIScrollView` viewer through the bridge). Wide tables get `overflow-x: auto` with a fade hint and a "view full-screen" button. Both are cheap and fix real pain on a phone.
- **Footnote popovers:** they should allow selection, highlighting and lookup inside the popover, matching Readest.

### Gaps
- I found nothing on how Thorium handles `page-list`, or on Kindle "real page numbers" and Page Flip in 2025–2026.
- I found no source on how Apple Books or Kindle handle tap-to-zoom images and wide tables today.

## Library-to-reader touches

### Takeaway
Evidence here is thin. What matters for reading is quick resumption ("continue reading" with the last position), series context, and a finished-books record. Pager is a personal folder-based reader, so a "Continue reading" row and per-book history matter more than store-like shelves.

### Cited Findings
- Readers complain that devices lack a reading history (finished dates, where they left off in a series), and some keep spreadsheets instead. — [The eBook Reader blog (May 2025)](https://blog.the-ebook-reader.com/2025/05/19/ebook-readers-lack-useful-reading-history-and-reading-stats/)
- Readest lists library management, OPDS/Calibre integration, sync of book files, progress, notes and bookmarks across platforms, and KOReader progress and annotation sync. — [Readest README](https://github.com/readest/readest); [Readest (App Store)](https://apps.apple.com/gb/app/id6738622779)
- Apple Books shows reading goals and streaks on its Home tab, tying the library surface to the reading habit. — [Apple iPhone User Guide: reading goals](https://support.apple.com/en-me/guide/iphone/iph6013e96f4/ios)

### Inferences
- Useful touches for Pager, in order:
  1. a "Continue reading" strip on the Library page with percent read and time left;
  2. an automatic "Finished on <date>" stamp when the reader reaches the end, which can be undone (Kindle annoys readers by marking books read just for reaching the end);
  3. series and order metadata from EPUB `belongs-to-collection` or calibre metadata, with "next in series" offered at the end of a book;
  4. a manual "Up next" queue.
- An iOS home-screen widget needs native WidgetKit code in the iPhone app. It is low priority.

### Gaps
- I did not research widgets, collections or metadata editing in Apple Books, Kindle or Kobo for 2025–2026; I found no strong evidence of which of these readers value most.

## Accessibility

### Takeaway
Web-based readers can reach good screen-reader support. Thorium scores 100% on epubtest.org non-visual reading, and Readest claims VoiceOver, TalkBack, NVDA and Orca support. But paginated (CSS-column) views fight screen readers' separate reading buffer, and screen readers do not report their reading position back to the app.

Pager should:
- support Dynamic Type through `-apple-system-body`, scaled to Pager's own font-size setting;
- keep honouring `prefers-reduced-motion` (it already does);
- offer a high-contrast theme;
- consider a reading ruler or line focus (Edge Immersive Reader's 1/3/5 lines, Readest's ruler) and KOReader-style page overlap for scroll mode.

### Cited Findings
- **Thorium screen readers:** it works with JAWS, NVDA, Narrator and VoiceOver. Since version 3.3, screen-reader support must be switched on manually in settings because automatic detection was unreliable. — [Thorium docs: Accessibility](https://thorium.edrlab.org/en/docs/300_accessibility/)
- **Thorium caveats:** EDRLab warns that its accessibility depends heavily on the quality of the book files. Screen readers use a separate buffer, so Thorium is generally not aware of the reader's position unless a standard event (click, tab) fires. Thorium 1.8 scored 100% on epubtest.org non-visual reading and 86.67% on basic functions. — [Thorium docs: Accessibility](https://thorium.edrlab.org/en/docs/300_accessibility/)
- **Readest accessibility:** full keyboard navigation; screen-reader support (VoiceOver, TalkBack, NVDA, Orca); a reading ruler, paragraph-by-paragraph mode and speed reading. — [Readest README](https://github.com/readest/readest)
- **Edge Immersive Reader:** Line focus shows 1, 3 or 5 lines at a time. Read Aloud skips by paragraph. — [Microsoft Support](https://support.microsoft.com/en-us/education/use-immersive-reader-in-microsoft-edge-1)
- **KOReader page overlap:** in continuous mode it marks the overlap so text near the top and bottom margins is not lost. — [KOReader user guide](https://koreader.rocks/user_guide/)
- **Dynamic Type in WKWebView:**
  - `font: -apple-system-body` follows the iOS Dynamic Type size, and other text styles exist (`-apple-system-headline`, `-caption1`, `-footnote`);
  - a custom `@font-face` loses Dynamic Type scaling;
  - results are sometimes inconsistent;
  - on macOS, where there is no "Larger text" setting, it can shrink text, and a WebKit maintainer suggests `@supports`.
  - [Use Your Loaf: Dynamic Type with web views](https://useyourloaf.com/blog/using-dynamic-type-with-web-views/); [Apple Developer Forums 105571](https://developer.apple.com/forums/thread/105571); [Apple Developer Forums 97651](https://developer.apple.com/forums/thread/97651); [WebKit bug 230348](https://bugs.webkit.org/show_bug.cgi?id=230348)
- **Kindle Assistive Reader:** Amazon presents it as an accessibility feature, read-aloud with highlighting built on OS TTS. — [About Amazon: Kindle accessibility](https://aboutamazon.com/news/books-and-authors/kindle-accessibility-features-for-all-readers); [Amazon help](https://digprjsurvey.amazon.com/csad/help/node/TqLHvK6eo6O7DJVQoZ)

### Inferences
- Pager's Scroll layout, its default, is the more screen-reader-friendly mode. Paged mode should expose chapter text as a normal document (headings, landmarks) and move focus sensibly on page turns.
- **Dynamic Type:** Pager uses its own fonts, so it should read the system text-size category through the native bridge (`UIApplication.preferredContentSizeCategory`) or measure `-apple-system-body` in a hidden probe. It then scales its own size setting by that factor, offered as a "Follow system text size" option.
- **Cheap wins:**
  - an optional reading ruler or line-focus band (CSS overlay that follows a tap or scroll);
  - in Scroll mode, a faint marker showing where the previous screen ended after a page-down;
  - a high-contrast variant of the black-and-white palette;
  - checking that the ink-blue accent passes WCAG contrast.

### Gaps
- I found no 2026 testing of VoiceOver with paginated web ebook readers inside WKWebView, beyond Thorium's general caveat.
- I did not research colour overlays (Irlen-style tints) or dyslexia fonts in current readers.
- I did not find Apple Books' or Kindle's current VoiceOver behaviour from primary sources.

Cross-cutting note on removed or changed features, from what I could find:
- **Kindle, 2021:** sideloaded books stopped getting automatic Word Wise and X-Ray. [MobileRead](https://www.mobileread.com/forums/showthread.php?p=4150818)
- **Kindle app, December 2025:** gained an AI "Ask This Book" feature (out of scope here). [MacRumors](https://www.macrumors.com/2025/12/15/kindle-app-ios-gains-in-book-ai-chatbot/)
- **Kindle app Reading Insights:** reviews say Insights was removed from the home page. Unconfirmed. [AppTail](https://apptail.io/app/amazon-kindle-af/united-states)
- **Voice Dream Reader:** its 2024 subscription switch was reversed for existing buyers. [Perkins](https://www.perkins.org/resource/voice-dream-reader-subscription-controversy/)
- **Google Play Books Bubble Zoom (2016):** a machine-learning comic zoom, Android-only preview. [Engadget](https://www.engadget.com/2016/07/21/google-play-books-bubble-zoom-comics/)
- **Apple Books, iOS 26:** I found no primary source on reader-UI changes. One unconfirmed iOS 26.1 user report says default themes and fonts became inaccessible after the Liquid Glass update. [Apple Community](https://discussions-jp-prz.apple.com/thread/256187226)
