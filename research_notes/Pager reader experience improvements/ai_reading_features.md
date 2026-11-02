# AI-assisted and "knowledge" features in reading apps (state as of October 2026), and how to build them into Pager

Scope note: this file covers AI and knowledge features only. Plain search, dictionary, TTS, annotations and stats belong to another researcher. Labels used: **[fact]** means documented by the vendor or reported by press; **[anecdote]** means one user's or reviewer's hands-on report; **[inference]** means my own reasoning. Dates are launch or report dates.

Pager context that shaped the recommendations (from the repo, read-only): `src/tools/types.ts` already defines a `PagerTool` with two hooks. A `Panel` renders in the reader's right-hand tool panel and on the Assistant page. `selectionActions` appear in the menu above selected text. A `TextSelection` carries `sectionId` plus `start`/`end` character offsets into the section's plain text. `ToolContext` carries `doc`, `section`, `selection` and an optional `progress` (`ReadingProgress`). The registry (`src/tools/registry.ts`) is empty. `AssistantPage.tsx` shows the empty state "Smart tools will live here".

---

## 1. Kindle: Recaps, Ask this Book, Story So Far, X-Ray, Word Wise, Translate. How spoilers are handled, and how the features were received

### Takeaway
Amazon is the main reference point. **Recaps** (series refreshers, April 2025), **Ask this Book** (in-book Q&A, 11 Dec 2025) and **Story So Far** (a recap up to the reader's position) all limit what they reveal to the reader's position. Hands-on tests found them mostly restrained but sometimes wrong: missed plot points, different answers to the same question, unrequested speculation, and no citations. The loudest criticism came from authors' rights groups (no opt-out) and from people who think AI breaks immersion. Readers did not complain much about usefulness.

### Cited Findings
**Recaps (series refresher).**
- [fact] Recaps launched on Kindle e-readers in April 2025 and later came to the iOS app. The flow: open a series in the library, and if a recap exists an option appears to review storylines and character arcs before the next book. Amazon likens it to TV's "Previously on". It covers "thousands" of bestselling English-language series, bought or through Kindle Unlimited. — [Gadget Hacks](https://apple.gadgethacks.com/news/kindle-app-for-ios-new-ai-features-ask-this-book-story-so-far-and-recaps-explained/); [MobileSyrup, 7 Apr 2025](https://mobilesyrup.com/2025/04/07/amazon-using-ai-to-recap-books-on-kindle/)
- [fact] Amazon says recaps are made with "GenAI and Amazon moderators", i.e. with human review. At launch, users on Reddit worried about accuracy and hallucinated plot. I found no documented catalogue of recap errors. — [getcoai](https://getcoai.com/news/skip-recap-amazons-new-ai-powered-kindle-recaps-helps-readers-catch-up-on-book-series); [The Mary Sue](https://themarysue.com/amazons-new-kindle-recaps-feature-is-suspicious)

**Ask this Book (in-book chatbot).**
- [fact] Amazon announced it on 11 Dec 2025, first in the US Kindle iOS app. Readers reach it from the book menu, or by highlighting a passage and tapping "Ask". It answers questions about plot, characters and themes. Amazon promises to limit answers to what the reader has already passed. — [GIGAZINE](https://gigazine.net/gsc_news/en/20251216-ask-this-book); [Authors Guild](https://authorsguild.org/news/statement-on-amazon-kindle-ask-this-book-ai-feature/)
- [fact] Tom's Guide says it was first shown at Amazon's September 2025 hardware event. Amazon says it "only reveals information up to your current reading position". — [Tom's Guide](https://www.tomsguide.com/computing/e-readers/amazon-adds-ai-chatbot-to-the-kindle-app-which-offers-spoiler-free-answers-about-your-ebooks)
- [fact] Answers cannot be copied or shared. It works only on books the reader bought or rented, and not every title is eligible (Amazon publishes no criteria). Android is planned "by next year". Kindle hardware from 2024 or later (Paperwhite, Colorsoft, Scribe) was promised Ask this Book and Story So Far "later this year". There is no timeline for non-US regions or non-English titles. — [Gadget Hacks](https://apple.gadgethacks.com/news/kindle-app-for-ios-new-ai-features-ask-this-book-story-so-far-and-recaps-explained/)
- [fact] Amazon says it runs a "standalone" model instance, that book text is used "only as a prompt", and that the text is "not retained or used to train the underlying AI model". Amazon calls the feature "a natural language expansion of the search functionality that already exists in Kindle apps" and says that needs no licence. "To ensure a consistent reading experience, the feature is always on, and there is no option for authors or publishers to opt titles out." — [Authors Guild, 23 Dec 2025, updated 7 Jan 2026](https://authorsguild.org/news/statement-on-amazon-kindle-ask-this-book-ai-feature/); [Writer Beware, 12 Dec 2025](https://writerbeware.blog/2025/12/12/kindles-new-gen-ai-powered-ask-this-book-feature-raises-rights-concerns/)
- [fact] Spoiler behaviour changed after launch. Writer Beware's 30 Dec 2025 update, citing the Authors Guild via Publishers Lunch, says the feature "initially analyzed the full text and answered questions about the book as a whole". Then: "After complaints that the chatbot was providing spoilers, the application appears to be limited to text already read." It also "often answer[s] that it does not have the information sought." — [Writer Beware](https://writerbeware.blog/2025/12/12/kindles-new-gen-ai-powered-ask-this-book-feature-raises-rights-concerns/)
- [anecdote] Meredith Rankin tested it (12 Feb 2026) on *And Then There Were None* at 10%, 30%, 64% and 100%.
  - The entry point is a star icon next to search and notes. It offers **two modes**: answers from the reading so far, or from the whole book.
  - Mid-book "who is the killer?" answers did not give away the ending.
  - At 64% it listed 4 deaths when there were 6, and asking again gave different details with the same omissions.
  - It put the revolver in the wrong place, and that answer referred to later events.
  - At the end of the book it got several facts about the twist wrong.
  - It padded answers with unrequested rumour and interpretation, and read some questions too literally.
  - Asking the same question twice gave different answers.
  - Her verdict: it "doesn't handle nuance well", can be wrong, can miss major plot points, and is inconsistent. — [Meredith Rankin, Substack](https://meredithrankin.substack.com/p/amazon-kindles-ask-this-book-option)
- [anecdote] Kindlepreneur tested *Alice's Adventures in Wonderland* and *Around the World in Eighty Days* (article updated 21 Feb 2026). It "mostly avoided spoilers", showed "no strong evidence of hallucination", and "didn't jump ahead or wander outside the book". Answers were confident paragraphs of several sentences. It **did not point to a chapter or quote a line**. Authors cannot review or correct answers. — [Kindlepreneur](https://kindlepreneur.com/amazon-ask-this-book/)
- [fact/opinion] Literary Hub (James Folta, 15 Dec 2025) argued that the feature pulls readers *out* of the book: "it's not accurate to describe a feature that pulls you away from reading as something that helps you 'stay immersed'". Also: "That's what the book is for!" — [Literary Hub](https://lithub.com/amazon-put-an-ai-book-explainer-into-kindle-so-you-can-be-even-more-easily-distracted-from-your-book/)
- [fact] The Authors Guild asked for "a permissioned, paid model". It argued that a chatbot on top of a book is a derivative or "enhanced ebook" format and "sets a dangerous precedent". It suspects RAG but has no confirmation. Precedent: Amazon's 2009 text-to-speech feature drew rightsholder pushback, and Amazon later let rightsholders turn it off title by title. — [Authors Guild](https://authorsguild.org/news/statement-on-amazon-kindle-ask-this-book-ai-feature/); [Writer Beware](https://writerbeware.blog/2025/12/12/kindles-new-gen-ai-powered-ask-this-book-feature-raises-rights-concerns/)

**Story So Far.**
- [fact] It generates a spoiler-free summary of the current book "matched to the reader's exact position". Amazon pitches it at readers coming back after a long break. It was live in the US iOS app alongside Ask this Book in Dec 2025. — [Gadget Hacks](https://apple.gadgethacks.com/news/kindle-app-for-ios-new-ai-features-ask-this-book-story-so-far-and-recaps-explained/)

**X-Ray and Word Wise (classic, not generative).**
- [fact] X-Ray is a reference for characters, places, topics and events. It scans the whole book, but "excerpts beyond the furthest page you've read stay hidden until you choose to show them". That is a spoiler boundary set at the **furthest-read position**, with an explicit reveal. — [Amazon Kindle Voyage manual](https://www.manualslib.com/manual/960098/Amazon-Voyage.html?page=26); [SlashGear](https://www.slashgear.com/2020365/hidden-kindle-features-you-probably-do-not-know-about)
- [anecdote] Authors can write X-Ray entries through KDP's "X-Ray for Authors". Where no author entry exists, Amazon is said to import Wikipedia definitions. This comes from a forum post quoting Amazon help, not an official page. — [Goodreads forum](https://www.goodreads.com/topic/show/19715419-kindle-x-rays-how-do-they-work?page=1)
- [fact] Word Wise shows short definitions above harder words, works offline, and can be enabled per title. — [SlashGear](https://www.slashgear.com/2020365/hidden-kindle-features-you-probably-do-not-know-about)
- [anecdote] MobileRead users report that around 2021 Amazon stopped delivering X-Ray and Word Wise data for sideloaded DRM-free books. The community WordDumb calibre plugin generates both locally. — [MobileRead](https://www.mobileread.com/forums/showthread.php?p=4150363)
- I found no evidence that Amazon replaced classic X-Ray with an LLM-generated version by October 2026. KOReader plugins do offer an LLM "X-Ray" (section 3).

**Kindle Translate.**
- [fact] Announced in beta on 6 or 7 Nov 2025 (sources differ). It is an **author/publisher-side** AI translation service for KDP authors, not a reading feature. It covers English to Spanish, Spanish to English and German to English, at no cost to authors. Translations are "automatically evaluated … for accuracy" before release, and a translated ebook can publish within about 72 hours. Translators criticised it, and one critic noted Amazon does not explain the evaluation steps. — [Slator](https://slator.com/kindle-translate-amazon-create-ai-translated-ebooks-72-hours/); [ARY News](https://arynews.tv/amazon-launches-ai-powered-kindle-translate-service)

### Inferences
- The Ask this Book timeline is a lesson in itself. It answered from the whole book at launch, readers complained about spoilers, and Amazon pulled it back to read-so-far, which made it often say "I don't have that information". Spoiler safety is the feature readers notice first, and an over-tight boundary also feels broken. A visible scope control ("answer from what I've read" vs. "whole book, spoilers OK") that defaults to read-so-far fits Rankin's observation that two modes exist.
- Rankin's 64% revolver answer referred to later events even in spoiler-safe mode. For a famous public-domain novel this may come from the model's training knowledge rather than from retrieval. **Position-limited retrieval alone does not stop spoilers for well-known books.** The prompt must also tell the model not to use outside knowledge of the plot, and Pager should consider checking answers against the allowed text.
- Answers that vary between asks, and answers without a citation, are the two problems most directly fixable in Pager. Citations with jump-to-passage links make an answer checkable in one tap.
- The rights controversy matters little for Pager, because the user reads their own files privately. The *privacy* version of the same concern does apply: whether book text goes to a cloud API.

### Gaps
- No public usage or engagement numbers for Recaps, Ask this Book or Story So Far.
- I could not confirm whether Ask this Book and Story So Far reached 2024+ Kindle hardware or Android by October 2026.
- No systematic accuracy benchmark exists; the evidence is two small hands-on tests.
- Exact Story So Far UI (entry point, length) is not documented in the sources I found.
- I found no Hacker News or Reddit threads in search results, so the read on general reader sentiment comes from press and blogs.

---

## 2. Readwise Reader Ghostreader, plus Readwise review and spaced repetition: which prompts exist and which get used

### Takeaway
Ghostreader is the most developed "AI in the reading surface" design. It has three prompt **scopes**: word (1–3 words), passage (more than 3 words), and document. A single shortcut (`G`, or `Shift+G` for the document) opens it. Readers can edit prompts as Jinja templates. Its default set reads as a curated list of the patterns that work: define, encyclopedia lookup, **internal x-ray**, translate, simplify, expand, **"pick up where I left off"**, thought-provoking questions, takeaways. On mobile, plain dictionary lookup still comes first for short selections, and AI is opt-in there. I found no data on which prompts people actually use.

### Cited Findings
- [fact] Default prompts by scope:
  - **Word level (1–3 words):** "Dictionary definition" (in the context of its sentence), "Encyclopedia lookup" (external proper nouns), "**Internal x-ray (character, place, term)**" (explains a term using the current document only), and "Translate to Spanish (customizable!)".
  - **Passage level:** "Explain passage (simplify)", "Expand passage (elaborate)" (the reply can be saved as a highlight note), "**Pick up where I left off**" (summarises the most recent section before your position, recap-style for fiction and plain for nonfiction), and "Translate".
  - **Document level:** "Generate thought-provoking questions" (3 questions, *before* reading), "Extract key takeaways and to dos" (from your notes and highlights, *after* reading), and "Draft newsletter blurb". — [Readwise docs: Default prompts](https://docs.readwise.io/reader/guides/ghostreader/default-prompts)
- [fact] How to invoke it:
  - **Web:** press `G` with text selected (or with the focus indicator on a paragraph, no selection needed), or use "Chat about this" in the `...` menu.
  - **Mobile:** a ghost icon in the annotation bar opens a "Prompts" dropdown.
  - **Document prompts:** `Shift+G`, or the right sidebar Chat tab's "Preset prompts".
  - On mobile, selecting 1–3 words opens **Quick Lookup** (dictionary) by default, and users must turn it off to get the AI prompts. — [Readwise docs: Default prompts](https://docs.readwise.io/reader/guides/ghostreader/default-prompts)
- [fact] Automatic prompts:
  - "Summarize the document" writes into the document's *summary metadata field*, not into chat. It runs on manually saved documents. Feed items are summarised only if the user adds their own OpenAI key.
  - "Tag the document" is experimental and off by default. It must return 1–6 comma-separated tags, and AI tags get a `#` prefix. The docs warn it "can flood your account with unwanted tags". — [Readwise docs: Default prompts](https://docs.readwise.io/reader/guides/ghostreader/default-prompts); [Custom prompts](https://docs.readwise.io/reader/guides/ghostreader/custom-prompts)
- [fact] Models and cost: the default model is **GPT-5 Mini, included in the subscription**, with a Fast/Thinking toggle for follow-ups. Other models need the user's own OpenAI key and can be set per prompt. The docs caution against using o3 to summarise a whole book because of cost. — [Custom prompts](https://docs.readwise.io/reader/guides/ghostreader/custom-prompts)
- [fact] Long-text handling: prompts are Jinja2 templates with variables such as `document.title`, `document.content`, `document.highlights` and `highlight.note`, plus subroutines. `central_sentences` is extractive selection using embeddings; `central_paragraphs` is for very long documents. The default summary prompt uses the full text below 2,500 tokens, `central_sentences` above 2,500, and `central_paragraphs` on the HTML above 25,000 tokens. It fails if the content exceeds the model's context. — [Custom prompts](https://docs.readwise.io/reader/guides/ghostreader/custom-prompts); [Reference](https://docs.readwise.io/reader/guides/ghostreader/reference)
- [fact] The official Prompt Library groups prompts by **reading stage**: before reading (pre-reading information, flags, questions), during (define, expand), and after (takeaways, to-dos). A `.qa` action tag on a response "can automatically create a review card in Readwise". — [Prompt Library](https://docs.readwise.io/reader/guides/ghostreader/prompt-library); [Tips & Tricks](https://docs.readwise.io/reader/guides/ghostreader/tips-tricks)
- [fact] Readwise (the companion app) is built on spaced repetition and active recall. It offers a **Daily Review** of resurfaced highlights, can turn highlights into flashcards, and has an experimental weekly "Themed Connections" review across sources. — [Readwise App Store listing](https://apps.apple.com/de/app/readwise/id1476885528)
- [fact] A community collection of user prompts exists (Scarvy/ghostreader-prompts, last pushed March 2024). — [GitHub](https://github.com/Scarvy/ghostreader-prompts)

### Inferences
- Readwise maps prompt *scope* to selection *size*: 1–3 words gets lookups, a passage gets explain/simplify, nothing selected gets document prompts. This fits Pager's `selectionActions` plus `Panel` split directly. Pager can choose which actions to show from `selection.text` length.
- "Internal x-ray" and "Pick up where I left off" being *defaults* suggests these are core patterns for long-form reading. Pager can make both spoiler-safe in a way Readwise does not appear to (Readwise doesn't document position limits for internal x-ray).
- Readwise writes outputs into durable places (the summary field, tags, notes, review cards) instead of only a chat log. Pager could do the same: save an explanation as a note on the highlight, or turn a Q&A into a review card.
- Readwise keeps the dictionary as the default for short selections on mobile. That is a sign that AI should not take over the cheapest, fastest, most common lookup.

### Gaps
- No usage statistics or survey data on which Ghostreader prompts people use. Search found no relevant r/readwise threads.
- Readwise's docs did not state limits on document length or monthly usage for the included model.
- I did not verify the details of Readwise's spaced-repetition scheduling (intervals, cloze, "Mastery").

---

## 3. The rest of the field: Apple, Google, Kobo, Storytel, Audible, Fable, Readest, KOReader plugins, read-it-later apps, NotebookLM / Gemini Notebook

### Takeaway
By late 2026 the "big platform" pattern is set. **Google** has Book insights ("Catch me up" plus asking about themes and characters) on more than 1M ebooks, and Gemini Notebook offers purchased books as cited sources (27 Aug 2026). **Storytel** has recaps on resume and on waking after the sleep timer (May 2026). **Audible** has spoiler-free character cards and character chat (1 Oct 2026). **Kobo** has a recap planned but not shipped. **Apple Books** has nothing equivalent; Apple's relevant offering is the on-device Foundation Models framework, with a 4,096-token context. Open-source readers (KOReader plugins) are the closest model for Pager: bring your own key (BYOK), many providers, highlight-menu actions, and LLM X-Ray and Recap limited to the reader's progress. Failure cases (Fable's offensive AI summaries; Apple's paused news summaries) show what destroys trust.

### Cited Findings
**Google Play Books / Gemini.**
- [fact] Book insights (built with Gemini) is on Play Books for Android, iOS and the web reader, covering more than 1 million English-language ebooks, bestsellers and free titles included. "Catch me up" recaps the pages already read, and readers can ask about themes, context and characters without leaving the book. The iOS expansion was reported 2 Sep 2026. — [Superpower Daily, 2 Sep 2026](https://superpowerdaily.com/posts/google-adds-gemini-book-insights-to-ios-and-expands-it-past-1-million-ebooks)
- [fact] An "Ask Gemini" select-text button was first seen in a Play Books APK teardown, before it was announced. — [Android Authority](https://www.androidauthority.com/google-play-books-ask-gemini-apk-teardown-3624252/)
- [fact] "Expert Intelligence" launched 27 Aug 2026. Purchased Play Books can be added as sources in Gemini Notebook, which answers "grounded directly in that book" **with direct citations to relevant passages**. It can also make Audio Overviews, Infographics and Quizzes from a book, and mix the book with personal material. It covers more than 100,000 books from publishers including Penguin Random House, Macmillan and O'Reilly, done "with authors and publishers". Collaborators on a shared notebook must buy their own copy. Uploaded ebooks are excluded. — [9to5Google, 27 Aug 2026](https://9to5google.com/2026/08/27/gemini-notebook-play-books/)

**Apple.**
- [fact] I found no Apple Books AI summary or Q&A feature in any source. — (searches returned only notification-summary coverage)
- [fact] In January 2025 Apple turned off Apple Intelligence notification summaries for news and entertainment apps after they produced false BBC headlines. In the iOS 26 betas (July 2025) it brought them back as opt-in per category, shown in **italics** and labelled "**Summarized by Apple Intelligence**". — [Tom's Guide](https://www.tomsguide.com/ai/apple-intelligence/apple-intelligence-will-summarize-news-again-in-ios-26-after-false-headline-debacle); [9to5Mac](https://9to5mac.com/2025/07/24/heres-what-apple-intelligence-summarized-news-notifications-look-like-on-ios-26)
- [fact] The Foundation Models framework was announced 9 Jun 2025 (WWDC). It gives developers access to the on-device model behind Apple Intelligence. It works **offline**, keeps data on the device, has **no per-request inference cost**, and supports guided generation (structured output) and tool calling. — [MacRumors](https://www.macrumors.com/2025/06/09/foundation-models-framework/); [TechCrunch](https://techcrunch.com/2025/06/09/apple-lets-developers-tap-into-its-offline-ai-models/)
- [fact] Developers report a ~3B-parameter, 2-bit quantised model with a **4,096-token context shared by instructions, input and output**. Overflowing it throws `.exceededContextWindowSize`, and the session must be restarted. iOS 26.4 added `contextSize` and `tokenCount(for:)`. Apple's guidance is to split work across sessions, ask for short answers, and use tools sparingly. — [InfoQ, Mar 2026](https://www.infoq.com/news/2026/03/apple-foundation-models-context); [Natasha The Robot](https://www.natashatherobot.com/p/apple-foundation-models?open=false); [AppleMagazine via Magzter](https://www.magzter.com/ja/stories/technology/AppleMagazine/APPLE-ANNOUNCES-ONDEVICE-AI-FEATURES-FOR-DEVELOPERS)

**Kobo.**
- [fact] Kobo Writing Life terms changed on 28 Jun 2025. AI processing may be used for discoverability, promotion, and "recaps, reading assistance, and accessibility", with no training on authors' work and **no author opt-out**. The planned feature is a personalised recap of about 150 words, based on the reader's recent pages *and highlights*. Kobo called it a beta it "hasn't begun testing" and said it is "not interested in doing whole summaries of books". Authors pushed back; one said Kobo "vastly underestimated" how much its users dislike AI. — [Engadget](https://www.engadget.com/ai/ai-might-undermine-one-of-the-better-alternatives-to-the-kindle-123039955.html)
- [fact] In July 2026 the CEO hinted at unannounced projects for the second half of 2026. I found no confirmed Kobo AI launch. — [The eBook Reader blog](https://blog.the-ebook-reader.com/2026/07/02/kobos-ceo-hinting-at-something-new-coming-soon/)

**Storytel / Audible (audio, but the patterns carry over).**
- [fact] Storytel AI Recaps (press release 4 May 2026) summarise earlier listening so users can reorient before pressing play. **Sleep Timer Recaps** automatically summarise what played while the sleep timer ran, and let the listener jump back. It was piloted in Sweden and rolled out to the Nordics, the Netherlands and Bulgaria. Storytel's data: over 100,000 Swedish users use the sleep timer nightly, and **63% struggle the next morning to find where they fell asleep**. — [Storytel](https://www.storytelgroup.com/en/storytels-new-ai-powered-recaps-let-users-pick-up-where-they-left-off/)
- [fact] Storytel "Genie" (June 2026) offers AI chapter recaps, interactive chats and personalised picks. — [The Bookseller](https://www.thebookseller.com/news/storytel-launches-ai-genie-software); [Storytel](https://www.storytelgroup.com/en/book-discovery-is-now-made-hyper-personal-with-storytel-genie/)
- [fact] Audible announced three features in beta on 1 Oct 2026:
  - **Character Guide:** live "who is speaking" with "spoiler-free" character cards; questions "as the story unfolds" are promised for later.
  - **Interactive Story:** generative AI chat with a character, e.g. Renfield in *Dracula*.
  - **Visual Explorer:** images and place details for nonfiction.
  - Creators are involved in building them, and they launched on Audible Originals. — [TechCrunch, 1 Oct 2026](https://techcrunch.com/2026/10/01/audibles-new-features-let-you-explore-book-worlds-and-even-talk-to-characters/)

**Fable (social reading app): the failure case.**
- [fact] Fable's AI-written 2024 year-end reading summaries ("roasts") produced racist, sexist and ableist remarks; one Black reader was told to read "the occasional white author". Head of product Chris Gallello said the AI was meant to write "a fun sentence or two" and that the offensive-content filters failed. Coverage of the outcome differs: changed safeguards (NYT, via The Star, 6 Jan 2025); removal of popular AI features (USA Today via AIID); the "roast" removed so only plain summaries remain (getcoai). — [The Star/NYT](https://www.thestar.com.my/tech/tech-news/2025/01/06/fable-a-book-app-makes-changes-after-offensive-ai-messages); [AI Incident Database](https://incidentdatabase.ai/reports/4416); [getcoai](https://getcoai.com/news/ai-reading-app-fable-forced-to-disable-ai-feature-for-offensive-comments)

**Open-source readers.**
- [fact] KOReader's **assistant.koplugin** (omer-faruq) offers:
  - **Ask** on a highlight, with follow-ups.
  - **Translate**, which can replace KOReader's long-press translate.
  - A book-aware **Dictionary**.
  - **Term X-Ray**, which explains a term "using its earlier mentions in the book".
  - **Recap**, for a book you haven't opened recently.
  - **X-Ray**, covering characters, places, themes and timeline "up to your progress".
  - Book summary and recommendations, analysis of the reader's own highlights and notes, custom prompts, streaming, optional web search, and saving to a notebook.
  - Providers include Anthropic Messages, OpenAI, Gemini, DeepSeek, OpenRouter, Ollama, Groq and Mistral, with the user's own key.
  - Entry points are the highlight menu, the main menu, and **gestures for Ask, Recap and X-Ray**. — [GitHub: omer-faruq/assistant.koplugin](https://github.com/omer-faruq/assistant.koplugin); [v1.09 release notes](https://newreleases.io/project/github/omer-faruq/assistant.koplugin/release/v1.09)
- [fact] The other plugin, **KOAssistant** (zeeyado, v0.17), added **data-access indicators** on every action, so the user can see what each action sends: 📄 document text, 📝 annotations, 📓 notebook, 🌐 web search. — [KOAssistant v0.17.0](https://newreleases.io/project/github/zeeyado/koassistant.koplugin/release/v0.17.0)
- [fact] **Readest** (open-source reader, v0.12.16 on 21 Oct 2026 per Uptodown) lists AI summarisation of books and chapters as "Building". It ships translation (DeepL or Yandex, "from a single sentence to the entire book") and TTS. I found no Q&A assistant. — [GitHub: readest/readest](https://github.com/readest/readest); [GIGAZINE, Oct 2026](https://gigazine.net/gsc_news/en/20261010-readest/); [Uptodown](https://readest.en.uptodown.com/android)

**Read-it-later apps.**
- [fact] Instapaper launched Summaries (written up 24 Apr 2024). It summarises in two steps: extract key sentences, then write an abstractive summary from them. — [bthdonohue.com](https://bthdonohue.com/2024/04/24/multilevel-summarization-instapaper.html)
- [fact] Matter Premium advertises a "Seamless AI Co-Reader". A review describes on-demand summaries triggered by pulling down. A competitor's article claims Matter has shipped nothing meaningful in 18 months; it is weakly sourced. — [App Store](https://apps.apple.com/us/app/matter-read-listen-learn/id1501592184); [dev.to](https://dev.to/fisher_shenfisher_1c32/matter-app-alternative-2026-6-read-later-apps-compared-after-matter-stopped-updating-11m0)
- [fact] Omnivore's team joined ElevenLabs in Oct 2024. The hosted service shut down in November 2024 and user data was deleted at the end of that month; the code remains open source. — [wallabag](https://wallabag.org/news/20241031-migrate-from-omnivore/); [MacRumors forums](https://forums.macrumors.com/threads/omnivore-shutting-down.2441423)

**NotebookLM Audio Overviews.**
- [fact/anecdote] Reviewers note the AI "hosts" sometimes add extra or incorrect details to keep the conversation flowing, and that "a minor mistake can be significant". An educator reported students found the overviews helpful and engaging, while calling them "not always fully accurate or comprehensive". I found no book-length-specific evaluation. — [TechRadar](https://www.techradar.com/pro/notebooklm-review); [Superlore](https://superlore.ai/blog/how-notebooklm-audio-overview-works-limitations-and-use-cases); [UW–Milwaukee](https://uwm.edu/advancing-learning/?p=7339)

### Inferences
- The features that shipped and stayed are almost all **"reorient me"** features: Kindle Recaps and Story So Far, Google "Catch me up", Storytel Recaps and Sleep Timer Recaps, the planned Kobo recap, and KOReader Recap. That convergence across five companies is the strongest market signal in this survey. Free-form chat is the more controversial, more criticised feature.
- Kobo's planned recap uses *recent pages + the reader's highlights* in about 150 words. That is a good, cheap design for Pager: short, personal, and limited to recent text.
- KOAssistant's data-access badges are a cheap trust device that suits Pager's privacy-minded, single-user setting.
- Apple's on-device model cannot hold a chapter, let alone a book (4k tokens). On iPhone it is realistic only for selection-level tasks: define in context, simplify a paragraph, translate a sentence. Pager runs in a WKWebView, so it would also need the native bridge, and only Apple Intelligence-capable devices have the model.
- Gemini Notebook's per-passage citations show what readers will come to expect. Kindle's lack of citations is a gap Pager can close.

### Gaps
- I found no information on Bookly, Glasp, LibraryThing, Moon+ Reader or Speechify AI features. One Speechify source lists "AI Summaries" and "Voice Chat" only on a marketing page, which I did not verify.
- No sources on how readers use Claude or ChatGPT "Projects" for reading (uploading books and asking questions). This is common practice anecdotally, but I found nothing citable.
- No independent accuracy reviews of Google Book insights or of Gemini Notebook on books.
- No reception data for Storytel Recaps beyond the vendor's pilot claim.

---

## 4. Which feature patterns readers find useful and which feel gimmicky

### Takeaway
Evidence ranks the patterns roughly as follows.
- **Clearly useful and widely copied:** "previously / story so far" recaps up to the reader's position; in-context definition and explanation on selection; spoiler-safe character, place and term lookup (X-Ray style); translation on selection.
- **Useful but risky:** free-form Q&A (accuracy and consistency problems, spoilers, and it breaks immersion unless kept out of the way); whole-book or chapter summaries (risk of substituting for reading; hallucinations).
- **Gimmick or backlash risk:** AI "personality" features (Fable's roasts), talking to characters (an Audible novelty, no reception data yet), auto-tagging (Readwise warns it floods tags), generated promotional or blurb content.

The research literature is thin and mixed: engagement goes up, comprehension gains are uncertain, and over-reliance is a concern.

### Cited Findings
- [fact] Recap or "pick up where I left off" ships at Amazon (Recaps, Story So Far), Google ("Catch me up"), Storytel (Recaps, Sleep Timer Recaps), Readwise (a default prompt) and KOReader (Recap). Kobo has it planned. — [Gadget Hacks](https://apple.gadgethacks.com/news/kindle-app-for-ios-new-ai-features-ask-this-book-story-so-far-and-recaps-explained/); [Superpower Daily](https://superpowerdaily.com/posts/google-adds-gemini-book-insights-to-ios-and-expands-it-past-1-million-ebooks); [Storytel](https://www.storytelgroup.com/en/storytels-new-ai-powered-recaps-let-users-pick-up-where-they-left-off/); [Readwise](https://docs.readwise.io/reader/guides/ghostreader/default-prompts); [assistant.koplugin](https://github.com/omer-faruq/assistant.koplugin); [Engadget on Kobo](https://www.engadget.com/ai/ai-might-undermine-one-of-the-better-alternatives-to-the-kindle-123039955.html)
- [fact] Storytel's data shows a real need for reorientation: 63% of nightly sleep-timer users struggle to find their place. — [Storytel](https://www.storytelgroup.com/en/storytels-new-ai-powered-recaps-let-users-pick-up-where-they-left-off/)
- [fact] Lookup of characters and terms with spoiler-safe context: Kindle X-Ray hides content past the furthest-read page; Readwise has "Internal x-ray"; KOReader has "Term X-Ray" from earlier mentions and X-Ray "up to your progress"; Audible has "spoiler-free" character cards. — [Voyage manual](https://www.manualslib.com/manual/960098/Amazon-Voyage.html?page=26); [Readwise](https://docs.readwise.io/reader/guides/ghostreader/default-prompts); [assistant.koplugin](https://github.com/omer-faruq/assistant.koplugin); [TechCrunch](https://techcrunch.com/2026/10/01/audibles-new-features-let-you-explore-book-worlds-and-even-talk-to-characters/)
- [anecdote] Free-form Q&A accuracy: Rankin found missed deaths, a wrong object location, a misread twist, different answers on repeat, and unrequested speculation. Kindlepreneur found it restrained, with no hallucination seen, but **no citations**. — [Rankin](https://meredithrankin.substack.com/p/amazon-kindles-ask-this-book-option); [Kindlepreneur](https://kindlepreneur.com/amazon-ask-this-book/)
- [opinion] Q&A distracts from reading: "a feature that pulls you away from reading" is not "staying immersed". — [Literary Hub](https://lithub.com/amazon-put-an-ai-book-explainer-into-kindle-so-you-can-be-even-more-easily-distracted-from-your-book/)
- [fact] Discussion questions, takeaways and flashcards: Readwise ships "Generate thought-provoking questions" (before reading) and "Extract key takeaways and to dos" (after, from the reader's highlights). A `.qa` tag turns a response into a review card. Readwise frames review around spaced repetition. Gemini Notebook generates Quizzes from purchased books. — [Readwise default prompts](https://docs.readwise.io/reader/guides/ghostreader/default-prompts); [Tips & Tricks](https://docs.readwise.io/reader/guides/ghostreader/tips-tricks); [Readwise App Store](https://apps.apple.com/de/app/readwise/id1476885528); [9to5Google](https://9to5google.com/2026/08/27/gemini-notebook-play-books/)
- [fact] Annotation summarisation: Readwise's takeaways prompt uses notes and highlights; KOReader has "Highlight & Note Analysis" and "Summary Using Highlights & Notes"; Kobo's planned recap uses highlights. — [Readwise](https://docs.readwise.io/reader/guides/ghostreader/default-prompts); [assistant.koplugin](https://github.com/omer-faruq/assistant.koplugin); [Engadget](https://www.engadget.com/ai/ai-might-undermine-one-of-the-better-alternatives-to-the-kindle-123039955.html)
- [fact] Related reading and recommendations: KOReader has "Book Summary & Recs"; Storytel Genie has personalised Top Picks. — [assistant.koplugin](https://github.com/omer-faruq/assistant.koplugin); [Storytel](https://www.storytelgroup.com/en/book-discovery-is-now-made-hyper-personal-with-storytel-genie/)
- [fact] Personality and "fun" generation is the documented backlash case (Fable, Jan 2025). — [The Star/NYT](https://www.thestar.com.my/tech/tech-news/2025/01/06/fable-a-book-app-makes-changes-after-offensive-ai-messages)
- [fact] Research on comprehension:
  - A CHI 2024 workshop paper (Chen and Leitch) studied Claude as a reading assistant for graduate students over a semester, with a control group. It reports preliminary gains in comprehension and engagement, and flags "potential for overreliance and ethical considerations". — [arXiv 2403.19506](https://arxiv.org/abs/2403.19506)
  - A non-peer-reviewed write-up of a quasi-experiment (69 university students, 11 weeks) reports that an AI reading companion raised motivation and time spent reading but produced **no measurable comprehension gain**. I could not verify the original study. — [Substack (canevac)](https://canevac.substack.com/p/i-reading-companion-motivation-comprehension-gap)

### Inferences
Each pattern below is rated for Pager, which is a personal reader with local full text, one user, and no rights constraints.
- **Explain or simplify this passage** (selection action): high value and cheap. It needs only the selection plus a little surrounding text. Readwise's "Explain passage" is the template.
- **Define or gloss in context** (selection, 1–3 words): high value. A plain dictionary should stay the default (another researcher covers it). AI adds "what does this word mean *here*", plus archaic, technical or invented terms.
- **Who or what is this?** (spoiler-safe X-Ray on a name): high value for fiction and dense nonfiction. Derive it from the reader's earlier mentions, limited to the furthest-read position, and show cited earlier mentions with jump links.
- **Previously in this book** (on return after N days): the clearest win, and nearly every major vendor converged on it. Offer it unobtrusively when opening a book after a gap: a dismissable one-line card, never a modal. Keep it about 150 words (Kobo's figure), covering the last chapter or the last session plus the reader's highlights.
- **Chapter summaries:** worth having as *the reader's own* end-of-chapter or table-of-contents aid (the TOC drawer could show a summary for chapters already read). Never show summaries for unread chapters by default.
- **Q&A grounded in the text with citations that jump to the passage:** valuable for nonfiction and for "wait, who was X" moments, but only with citations and a spoiler scope. It belongs in the side panel, not in the reading surface.
- **Vocabulary and translation for language learners:** high value when the user reads in a second language. Selection-level translation is cheap and could run on-device.
- **Discussion questions / "think about this", flashcards from highlights, annotation summaries:** moderate value. They work best *after* a chapter or book, on the Assistant page or in the panel, and should write into durable artefacts (notes, review cards).
- **Related reading:** low priority for a local-library reader. It could suggest *other books in the user's own library* via local embeddings, which would be unusually useful and private.
- **Avoid:** character chat, "fun" persona outputs, automatic tagging by default, and anything that shows on the page unprompted.

### Gaps
- No quantitative data on which features retain users (no vendor shares usage of Recaps or Ask this Book).
- No peer-reviewed, main-track study on spoiler-safe Q&A or on how recaps affect comprehension or enjoyment.

---

## 5. Design principles: grounding, spoiler boundaries, latency, entry points, calm, privacy, cost, and what makes readers distrust or turn off AI

### Takeaway
Readers distrust AI in readers for five documented reasons: **(1)** wrong or inconsistent facts, **(2)** spoilers, **(3)** features that are always on and cannot be turned off, **(4)** AI that intrudes on the reading surface or reads as having a personality, **(5)** opacity about what data goes where. The design response: cite and link every claim, limit retrieval to the furthest-read position and forbid outside knowledge, make every feature opt-in and invoked on demand, label AI output clearly, show what is sent, and keep the page itself free of AI.

### Cited Findings
- [fact] **Grounding and citations.** Kindle answers neither quote nor point to a chapter. Gemini Notebook gives "direct citations to relevant passages". — [Kindlepreneur](https://kindlepreneur.com/amazon-ask-this-book/); [9to5Google](https://9to5google.com/2026/08/27/gemini-notebook-play-books/)
- [fact] Claude's API has native citations. With `citations: {enabled: true}` on document or search-result blocks, the response's text blocks carry `cited_text` plus a location: `char_location` (start and end character index) for plain-text documents, or `content_block_location` for custom content. — [Claude docs: Citations](https://platform.claude.com/docs/en/build-with-claude/citations)
- [fact] **Spoiler boundary.**
  - Kindle X-Ray uses the *furthest page read* as its boundary and reveals more only on request. — [Voyage manual](https://www.manualslib.com/manual/960098/Amazon-Voyage.html?page=26)
  - Ask this Book answered from the whole book at launch and was restricted after spoiler complaints. It then often says it lacks the information. — [Writer Beware](https://writerbeware.blog/2025/12/12/kindles-new-gen-ai-powered-ask-this-book-feature-raises-rights-concerns/)
  - By Feb 2026 it offered a read-so-far mode and a whole-book mode. — [Rankin](https://meredithrankin.substack.com/p/amazon-kindles-ask-this-book-option)
- [fact] **Consistency and padding.** The same question gave different answers, with unrequested speculation and interpretation. — [Rankin](https://meredithrankin.substack.com/p/amazon-kindles-ask-this-book-option)
- [fact] **Labelling AI output.** Apple now shows AI notification summaries in italics with "Summarized by Apple Intelligence", after the January 2025 false-headline episode. — [Tom's Guide](https://www.tomsguide.com/ai/apple-intelligence/apple-intelligence-will-summarize-news-again-in-ios-26-after-false-headline-debacle)
- [fact] **Transparency of data access.** KOAssistant marks each action with what it reads: document text, annotations, notebook, or web. — [KOAssistant v0.17.0](https://newreleases.io/project/github/zeeyado/koassistant.koplugin/release/v0.17.0)
- [fact] **Always-on with no opt-out** drew the strongest institutional backlash, at Kindle and at Kobo. — [Authors Guild](https://authorsguild.org/news/statement-on-amazon-kindle-ask-this-book-ai-feature/); [Engadget on Kobo](https://www.engadget.com/ai/ai-might-undermine-one-of-the-better-alternatives-to-the-kindle-123039955.html)
- [fact] **Immersion.** The Literary Hub critique says AI Q&A pulls readers out of the book. — [Literary Hub](https://lithub.com/amazon-put-an-ai-book-explainer-into-kindle-so-you-can-be-even-more-easily-distracted-from-your-book/)
- [fact] **Personality is risky** (Fable). — [The Star/NYT](https://www.thestar.com.my/tech/tech-news/2025/01/06/fable-a-book-app-makes-changes-after-offensive-ai-messages)
- [fact] **Entry points in practice.**
  - Kindle: highlight then "Ask", or a star icon in the top bar.
  - Readwise: `G` on a selection or focused paragraph, `Shift+G` for the document, the ghost icon in the mobile annotation bar, the sidebar Chat tab.
  - KOReader: highlight menu, main menu, gestures.
  - Storytel: recap on resume.
  - Readwise mobile keeps the dictionary first for short selections.
  — [Rankin](https://meredithrankin.substack.com/p/amazon-kindles-ask-this-book-option); [Readwise](https://docs.readwise.io/reader/guides/ghostreader/default-prompts); [assistant.koplugin](https://github.com/omer-faruq/assistant.koplugin); [Storytel](https://www.storytelgroup.com/en/storytels-new-ai-powered-recaps-let-users-pick-up-where-they-left-off/)
- [fact] **Cost awareness.** Readwise ships a cheap default model (GPT-5 Mini) and warns about the cost of running expensive models on whole books. For long texts it pre-selects central sentences or paragraphs rather than sending everything. — [Readwise custom prompts](https://docs.readwise.io/reader/guides/ghostreader/custom-prompts)
- [fact] **Over-reliance concerns** in the research literature. — [arXiv 2403.19506](https://arxiv.org/abs/2403.19506)

### Inferences
Design rules for Pager, derived from the findings above:
1. **Invoked, never ambient.** No AI text on the page unless the user asked. AI lives in three places only:
   - (a) the selection menu: Explain, Who/what is this, Translate;
   - (b) the right-hand tool panel: Ask, Story so far, Chapter notes;
   - (c) the Assistant page: whole-book artefacts such as a reading guide, flashcards from highlights, highlight digest.
   - One optional exception: a small, dismissable "Pick up where you left off?" chip when reopening a book after X days. It should be off by default or easy to switch off.
2. **Spoiler scope is visible and defaults to safe.** The boundary is the furthest-read position (not the current position, so flipping back doesn't shrink it). Show a scope control on Ask: "Up to where I've read" (default) or "Whole book (spoilers)". The scope rule goes in the prompt, together with "use only the provided excerpts; do not use your outside knowledge of this book's plot". Outputs show the boundary they used, e.g. "Based on chapters 1–7".
3. **Every factual claim is cited, and each citation jumps to the passage.** Map Claude's `char_location` back to `sectionId` and offsets, the same coordinates `TextSelection` uses, then flash-highlight the passage on jump. If nothing relevant is retrieved, say "Not covered in what you've read so far". Don't pad.
4. **Short, literal, then optional depth.** Answer the question asked in 1–3 sentences, then offer "More" or "Interpretation" separately. That addresses Rankin's padding and speculation complaint.
5. **Determinism where it matters.** Cache generated recaps, X-Ray entries and chapter summaries keyed by (book, section, model, prompt version). The same question about the same position then returns the same stored artefact, which avoids "different answers every time" for the structured features.
6. **Label AI output** with a quiet marker (e.g. italic, or a small "AI" tag on the panel header), never mixed into book typography.
7. **Show what leaves the device.** Per action, show something like "Sends: selected passage + 2 paragraphs, to Anthropic", in KOAssistant's style. Keep a global switch to turn AI off and hide every entry point.
8. **Latency budgets** [inference; no source measured these for reading apps]:
   - Selection actions should start streaming in about 1–2 s, so use a fast model with a small context.
   - Panel Q&A can tolerate a few seconds if it streams.
   - Recaps and summaries should be precomputed in the background (on import or when a chapter is finished) so they appear instantly.

### Gaps
- No measured latency tolerance data for in-reader AI.
- No study on whether citations increase reader trust in reading apps specifically. The inference rests on general RAG practice and on the contrast between Gemini Notebook and Kindle.

---

## 6. Technical approaches feasible for Pager: local index, position-limited retrieval, chunking, Claude API vs on-device, prompt caching, cost and latency for a 100k-word book

### Takeaway
Pager owns the full text locally, so it can do what Kindle does (position-limited retrieval) and add citations. The recommended architecture:
- the Rust backend builds a **chunk index**: paragraph-level chunks grouped by section, with character offsets, plus a BM25 or full-text index and optional embeddings;
- every AI request filters chunks to `end_offset <= furthest_read`;
- **Claude Haiku 5.5** handles selection actions and background precomputation (cents per book);
- **Claude Sonnet 5.5** handles panel Q&A;
- **Opus 5.5** is used only on demand for deep "reading guide" style work;
- whole-text-so-far **prompt caching** is an alternative to retrieval when reading sessions are active.

Apple's on-device model (4k context) only fits selection-level tasks on iPhone.

### Cited Findings
- [fact] **Claude prices** (per million tokens, from the live pricing page, Oct 2026):

  | Model | Input | 5-min cache write | 1-h cache write | Cache hit | Output |
  |---|---|---|---|---|---|
  | `claude-opus-5-5` | $4 | $5 | $8 | $0.20 | $20 |
  | `claude-sonnet-5-5` | $2 | $2.50 | $4 | $0.10 | $10 |
  | `claude-haiku-5-5`, prompts ≤100K tokens | $0.10 | $0.125 | $0.20 | $0.01 | $0.50 |
  | `claude-haiku-5-5`, prompts >100K tokens | $0.50 | $0.625 | $1 | $0.05 | $2.50 |

  - The Batch API gives 50% off.
  - Cache hits on Opus 5.5 and Sonnet 5.5 cost 0.05× base input. Note: the bundled Claude API skill reference (cached 6 Oct 2026) lists Sonnet 5.5 cache reads at $0.20. The live pricing page says $0.10. I used the live page.
  - On Haiku 5.5, a request over 100K prompt tokens pays the higher rates even when part of the prompt is a cache hit.
  - Opus and Sonnet price the full 1M-token context at standard rates. — [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [fact] All three models have a **1M-token context window** and 128K max output. — [Claude models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [fact] **Prompt caching mechanics.**
  - It is a prefix match: any byte change before the breakpoint invalidates the cache.
  - The default TTL is 5 minutes and a 1-hour TTL is available. A cache read refreshes the timer.
  - The minimum cacheable prefix on the 5.5 models is 512 tokens.
  - A `max_tokens: 0` request can pre-warm the cache to cut first-request latency. — [Claude docs: Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [fact] **Tokenizer and models.**
  - The newer tokenizer (Opus 4.7 onward, used by the 5.x models) produces about 1.0–1.35× as many tokens as earlier tokenizers. Haiku 5.5's tokenizer counts the same text as about 30% more tokens than Haiku 4.5.
  - Opus 5.5 thinking cannot be disabled; its effort defaults to `medium`. — Claude API reference ([models overview](https://platform.claude.com/docs/en/about-claude/models/overview); [migration guide](https://platform.claude.com/docs/en/about-claude/models/migration-guide))
- [fact] **Citations output.** Text-document citations return `char_location` with start and end character indices; custom-content documents return `content_block_location`. — [Claude docs: Citations](https://platform.claude.com/docs/en/build-with-claude/citations)
- [fact] **On-device (iOS 26).** Foundation Models is free, offline and private, but has a ~4,096-token context covering instructions, input and output, and overflow ends the session. — [MacRumors](https://www.macrumors.com/2025/06/09/foundation-models-framework/); [InfoQ](https://www.infoq.com/news/2026/03/apple-foundation-models-context)
- [fact] **Prior art for long texts.**
  - Readwise uses embedding-based extractive pre-selection (`central_sentences`, `central_paragraphs`) above 2,500 and 25,000 tokens.
  - Instapaper uses extract-then-abstract summarisation.
  - The Authors Guild suspects Kindle uses RAG. — [Readwise](https://docs.readwise.io/reader/guides/ghostreader/custom-prompts); [bthdonohue.com](https://bthdonohue.com/2024/04/24/multilevel-summarization-instapaper.html); [Authors Guild](https://authorsguild.org/news/statement-on-amazon-kindle-ask-this-book-ai-feature/)
- [fact] KOReader's plugin already shows that one BYOK client can target Anthropic Messages, OpenAI, Gemini and local Ollama. — [assistant.koplugin](https://github.com/omer-faruq/assistant.koplugin)

### Inferences (cost and latency estimates; my arithmetic, using the prices above)
**Size assumption:** a 100k-word English book is about **130k–175k tokens** on current tokenizers. I use **~150k** below. This is a rule-of-thumb estimate, not measured; measure real books with the `count_tokens` endpoint. A typical book has about 30 chapters of about 5k tokens each. Assume answers of about 400 output tokens.

**A. Retrieval Q&A (recommended default).**
- Each question sends the top ~8–10 position-filtered chunks (~4k tokens), the current page or nearby paragraphs (~2k), and instructions (~1k): about 7k input tokens.
- Cost per question:

  | Model | Input | Output | Total |
  |---|---|---|---|
  | Haiku 5.5 | 7k × $0.10/M = $0.0007 | 400 × $0.50/M = $0.0002 | **≈ $0.001** |
  | Sonnet 5.5 | $0.014 | $0.004 | **≈ $0.018** |
  | Opus 5.5 | $0.028 | $0.008 | **≈ $0.036** |

- Latency: a 7k-token prompt is small, so time to first token is mostly network plus model start-up. It should feel near-instant with streaming (no source measured this).

**B. Whole-text-so-far in context, cached (no retrieval errors, higher cost).**
- At the book's midpoint, the prefix is everything read so far: about 75k tokens.

  | Model | First question (cache write) | Follow-ups within 5 min (cache read) |
  |---|---|---|
  | Sonnet 5.5 | 75k × $2.50/M ≈ **$0.19** | 75k × $0.10/M + output ≈ **$0.012** |
  | Opus 5.5 | ≈ **$0.38** | ≈ **$0.023** |
  | Haiku 5.5 | ≈ **$0.01** (still ≤100K tier) | ≈ **$0.001** |

- At the end of the book (150k):
  - Sonnet: ≈ $0.38 first, ≈ $0.02 follow-ups.
  - Opus: ≈ $0.76 first, ≈ $0.04 follow-ups.
  - Haiku jumps to the >100K tier: ≈ $0.095 first, ≈ $0.009 follow-ups.
- Without caching, every Sonnet question at the midpoint would cost about $0.15.
- Caveats:
  - The prefix grows as the reader advances, so each new page invalidates the tail. Use breakpoints at chapter boundaries: cache "chapters 1..k" and append the current chapter's read portion uncached.
  - Processing 75–150k uncached tokens likely takes several seconds before the first token (an estimate, not measured). Pre-warm with `max_tokens: 0` when the panel opens.
- Best fit: an "active study session" mode for nonfiction, or the "whole book" spoiler scope.

**C. Background precomputation (rolling and spoiler-safe by construction).**
- When a chapter is finished, or on import, summarise each chapter using only that chapter plus the previous rolling summary. Extract entities (name, aliases, a one-line description *as of this chapter*, offsets of first and notable mentions).
- Cost for ~150k input and ~9k output per book:

  | Model | Cost per book | With Batch API |
  |---|---|---|
  | Haiku 5.5 | ≈ $0.015 + $0.0045 ≈ **$0.02** | **≈ $0.01** |
  | Sonnet 5.5 | ≈ $0.30 + $0.09 ≈ **$0.39** | ≈ $0.20 |
  | Opus 5.5 | ≈ **$0.78** | ≈ $0.39 |

- Outputs:
  - "Story so far" is assembled from the stored summaries of chapters ≤ furthest-read, plus a fresh short summary of the partial current chapter.
  - X-Ray "who is this" entries show the latest description from a chapter ≤ furthest-read.
  - A "Previously…" chip combines the last session's text and highlights into about 150 words (Haiku, ≈ $0.001).
- These artefacts are stored, so they are deterministic and instant.

**D. Selection actions** (Explain, Define-in-context, Translate). Send the selection, ±1–2 paragraphs and the book title. Under 1k tokens in, so a fraction of a cent on Haiku 5.5. These could also run on-device through Apple Foundation Models in the iOS app (they fit in 4k tokens), but that needs the native bridge and an Apple Intelligence device.

**Index design for Pager's Rust backend** [inference]:
- Store chunks as (doc_id, section_id, paragraph_index, start_char, end_char, text). Use the same `textContent` coordinate space the reader already uses for `TextSelection`, so citations map straight back to highlights.
- Use SQLite FTS5 or tantivy for BM25. Embeddings are optional: a small local embedding model, or an API. Hybrid lexical plus semantic retrieval suits named-entity questions ("who is Renfield?"), where lexical search alone does well.
- Filter `end_char <= furthest_read` (per section ordinal) **before** ranking, never after. Use a position *slightly* behind the reader (e.g. the end of the previous paragraph) to avoid leaking the next sentence.
- Send chunks to Claude as search-result or document blocks with citations enabled. Keep each chunk's ids in its title or metadata so cited blocks resolve to (section, offsets).
- Keep the API key on the backend (the Rust server), not in the PWA. The iPhone app reaches it through the existing remote bridge. Book text then goes from the user's own server to Anthropic, with no third party in between.

### Gaps
- No measured time-to-first-token figures for 75–150k-token Claude prompts. Benchmark them with Pager's real books before choosing between strategies A and B.
- I did not verify Anthropic API data-retention or zero-retention terms for consumer API keys. The privacy wording in Pager's UI should link to the current policy.
- No public evaluation compares RAG with full-context for spoiler-safe book Q&A accuracy.
- Exact token counts for Pager's library are unknown; use `count_tokens`.
- I did not verify whether Apple Foundation Models' context grew beyond 4,096 tokens in iOS 26.x or 27 betas; one source warns against hardcoding the limit.
