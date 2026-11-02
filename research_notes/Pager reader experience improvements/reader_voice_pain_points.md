# Reader voice: what heavy ebook readers love, hate and request (2023–2026)

**Corpus and method (read first).** These notes draw on the sources below. Counts are keyword matches, so they are approximate and include some praise and some noise. Treat them as rough frequency signals, not survey results.

- **App Store reviews (US, most recent first, collected 2026-10-29).** 3,065 reviews dated 2023-01-01 or later, across 11 reader apps, from Apple's public review feed (`itunes.apple.com/us/rss/customerreviews/.../sortby=mostrecent/json`). The feed returns at most 500 reviews per app, so high-volume apps cover a short window: Kindle 2026-09-24→10-28, Apple Books 2026-07-05→10-27, Libby 2026-10-15→10-28. Smaller apps reach back years: Kobo from 2025-04, PocketBook, Yomu and KyBook from 2023. The window bias matters: the Kindle sample is dominated by reactions to an October 2026 update. I also pulled Readwise (Highlights), Matter and Instapaper.
- **Google Play reviews (US/en, "most relevant" plus "newest").** 4,307 reviews dated 2023 or later, across 7 apps (Kindle, Moon+, ReadEra, Google Play Books, Readest, Librera, Lithium). Each carries a "helpful" upvote count, shown below as `N^`, which is the best intensity signal available. KOReader and Readwise Reader returned no Play reviews.
- **Hacker News.** Full comment trees of 6 threads: "KOReader" (2026-07-29, 752 pts / 248 comments), "KOReader: Open-Source eBook Reader" (2025-03-31, 420 / 106), "Alexandria" (2023-08-29, 280 / 156), "Ask HN: Best offline-only eBook reader?" (2024), "Ask HN: Best Open E-Reader?" (2024), and an LLM-reader Show HN (2025).
- **GitHub.** Issues sorted by 👍 and by comment count for KOReader, Readest, Foliate, Thorium, foliate-js and epub.js.
- **Other.** MobileRead "So Marvin's Gone!" thread (2023), TidBITS forum (2023), Basic Apple Guy's "Build a Better Books" (2023), The eBook Reader blog (2025), and a few Reddit threads.
- **Reddit access was poor.** Reddit and its mirrors blocked fetching, and the Pushshift-style archive (pullpush.io) rate-limited and then refused agent scraping. Reddit evidence is therefore thin: thread titles and scores for r/ereader, plus the top comments of one dark-mode thread. That is a known gap.

---

## 1. Why do people leave or switch readers, and what do they miss most?

### Takeaway
People rarely switch over one big feature. They leave after an accumulation of small betrayals. The most common are:

- losing their place (bad sync, or reopening in the wrong spot);
- a redesign that hides basic controls or adds clutter;
- being sold to (ads, store-first home screens, DRM or download rules);
- typography they cannot fix (margins above all).

They switch *to* apps that are fast, uncluttered and customisable, and they stay for reliable position sync. Marvin refugees miss its deep customisation, Calibre/OPDS/Dropbox loading, author/series library organisation and auto-scroll. Many settled on Yomu, BookFusion or (from 2025) Readest, and each falls short in some specific way.

### Cited Findings

**Kindle → elsewhere (KOReader, Kobo, Readest)**

- **Ownership and DRM is the biggest single trigger.** The most-upvoted 2023+ Kindle Play review (761^, 1★, 2025-03-23) is about Amazon removing download-and-transfer: "When we pay for a product, even a digital one, we should have the right to read in whatever format we choose." — [Kindle, Google Play](https://play.google.com/store/apps/details?id=com.amazon.kindle). The HN threads on the same theme were large: "Amazon now discloses you're buying a license" (2025-02-22, 467 pts / 346 comments) and "Amazon will allow ePub and PDF downloads for DRM-free eBooks" (2025-12-19, 634 / 339) — [HN](https://news.ycombinator.com/item?id=43141825), [HN](https://news.ycombinator.com/item?id=46324078)
- **Speed of the UI, not the page turn.** "When you hit buttons in koreader it actually responds in less than a second. I hadn't even realized how frustrat[ing]…" (porkloin, 14-year Kindle user, 2026-07-29) — [HN](https://news.ycombinator.com/item?id=49101515). Another: "I always thought the Kindle was just slow, nope, it's just really bad software" (joshstrange, 2026-07-29) — [HN](https://news.ycombinator.com/item?id=49097559). He adds: "I'm not talking about page turning, that was fine on both, but navigating menus is way faster" — [HN](https://news.ycombinator.com/item?id=49097411)
- **Customisation.** "Customise any/everything. Font size, line spacing, paragraph spacing, margins, header/footer content, the list goes on" — [HN, joshstrange 2026-07-29](https://news.ycombinator.com/item?id=49097559)
- **Kindle app churn in October 2026.** The Kindle iOS sample (500 reviews, 5 weeks, average 3.64★) shows these complaints:
  - library covers no longer show titles: "you no longer see the title in text below the picture" (1★, 2026-10-15);
  - "they took away the back button" (1★, 2026-10-08);
  - a new persistent banner;
  - Android: "two useless buttons that are always present on the screen in full screen mode and can't be removed" (3^, 1★, 2026-10-17);
  - "Why fix things that aren't broken" (3★, 2026-10-05).
  Sources: [Kindle, App Store](https://apps.apple.com/us/app/id302584613); [Kindle, Google Play](https://play.google.com/store/apps/details?id=com.amazon.kindle)
- **Kobo switch threads score well on r/ereader:**
  - "i'm so glad i switched to kobo" (335 pts / 40 comments, 2025-08-21) — [Reddit](https://reddit.com/r/ereader/comments/1mw1m4l/im_so_glad_i_switched_to_kobo/)
  - "Switched to kobo from kindle PW" (306 / 62, 2026-07-29) — [Reddit](https://reddit.com/r/ereader/comments/1va14f5/switched_to_kobo_from_kindle_pw/)
  - "switched from kindle to kobo" (233 / 26, 2025-07-05) — [Reddit](https://reddit.com/r/ereader/comments/1ls1qq3/switched_from_kindle_to_kobo/)
  - Counterpoint: "Unpopular Opinion about Switching from Kindle to Kobo" (88 comments, 2026-02-26) — [Reddit](https://reddit.com/r/ereader/comments/1rexcii/unpopular_opinion_about_switching_from_kindle_to/)
  I could read the titles and scores only, not the bodies.
- **Kobo app praise is about not being sold to:**
  - "They just let you use a device and read your books without trying to sell you stuff all the time" (5★, 2026-04-26);
  - "Better than Kindle in most ways. It's nice not being locked in" (5★, 2026-06-08).
  Source: [Kobo, App Store](https://apps.apple.com/us/app/id301259483)

**Apple Books → Kindle, Yomu and others**

- **Margins are the oldest grievance:**
  - "Apple Books would easily be the best eBook app if it had smaller (or customizable) margins. It's been a common request for years. Maddening." (tiltowait, 2023-08-29) — [HN](https://news.ycombinator.com/item?id=37308398)
  - "The side margins are ridiculous" (DanShockley, 2023-09-23). He found the Kindle app "much more comfortable"; another user says complaints date to about 2010 — [TidBITS](https://talk.tidbits.com/t/margins-line-length-and-reading-ebooks-on-an-iphone/24445)
  - Yomu reviewers say the same: "It's hard to believe that Apple keeps messing up the page margins in Books… I came to Yomu because it lets me tweak the margins to get a line length I prefer" (4★, 2023-09-25); "Used Apple Books for a while but got sick of the dull, boring customization. Switched to this" (5★, 2026-03-29) — [Yomu, App Store](https://apps.apple.com/us/app/id562211012)
- **The iOS 16 redesign** (heavy-reader blog, about 2023-02):
  - page curl removed for a "tinder-like swipe" (restored in 16.4);
  - the navigation controller is "nearly impossible to select";
  - "Four steps to access Highlights when a single dedicated button previously provided instant access";
  - about 75% of bookmarks were accidental in iOS 16.0–16.1;
  - "Apple, by default, mandates that I see all related books" (forced series collections);
  - "stop changing covers on me!".
  Source: [Basic Apple Guy](https://basicappleguy.com/basicappleblog/build-a-better-books)
- **2026 Apple Books reviews** (500 reviews from 2026-07 to 10, average 3.70★):
  - bookmarks "hidden in a stupid collapsed menu" and page numbers "now… hidden after a few seconds. PLEASE stop fixing things are not broken!!!!" (1★, 2026-07-16);
  - four reviews call it "glitchy since ios27" (2026-09-21 to 10-17).
  Source: [Apple Books, App Store](https://apps.apple.com/us/app/id364709193)

**Marvin (iOS; pulled from the App Store about spring 2023): what users loved, and where they went**

- The MobileRead thread "So Marvin's Gone!" opened on 2023-05-06: "I loved it for 10+ years." What users named:
  - customisation: BookFusion "lacks all the fabulous customization options available in Moon+ Reader and Marvin" (Faterson, 2023-05-09);
  - "header info and paging like Marvin" (peaceridge);
  - landscape two-column reading (PocketBook "can't even do 2 columns in landscape!").
  Source: [MobileRead](https://www.mobileread.com/forums/showthread.php?t=353769)
- Later in the thread: "the kindle app is no match for marvin" (Spfamy1, 2023-06-21), and "The highlighting controls are not visible with iOS 16" (JSWolf) — [MobileRead p.10](https://www.mobileread.com/forums/showthread.php?t=353769&page=10)
- App Store reviews that name Marvin (24 since 2023) list what refugees need:
  - "sideload from Files (check), change covers (check), and sort by author… only display the *author name* until I tap" (Yomu 2★, 2023-12-09);
  - "no cloud integration with things like Dropbox like I had in Marvin" (BookFusion 3★, 2025-04-06);
  - "Most e-reading apps for iOS I try either lack necessary settings, tie to some unwanted service, or are nearly impossible to load books into", and the KyBook replacement lacks "swipe to advance pages" (KyBook 3 4★, 2024-02-27);
  - Yomu "without the huge catalog of options Marvin had, but… the progress sync is actually easier and more consistent than Marvin was" (5★, 2023-12-22);
  - "Bring back Marvin!" and "Makes you long for Marvin 3" (PocketBook 1★, 2026-01-11 and 2026-02-18).
  Sources: [Yomu](https://apps.apple.com/us/app/id562211012), [BookFusion](https://apps.apple.com/us/app/id1141834096), [KyBook 3](https://apps.apple.com/us/app/id1348198785), [PocketBook](https://apps.apple.com/us/app/id805488884)
- Readest's auto-scroll request cites Marvin: "Many other apps, such as BookFusion and Marvin, offer this feature" (2025-01-25, 17 comments, 6 👍) — [GitHub readest#254](https://github.com/readest/readest/issues/254)
- One iOS reviewer who had tried "dozens since the introduction of the iPad (including Marvin, Kybook, Book Fusion, Pocketbook, & Apple)" says Readest "tops them all". The reasons given: the Calibre plug-in, "superb customization", and auto-scroll (5★, 2026-09-06) — [Readest, App Store](https://apps.apple.com/us/app/id6738622779)

**Moon+ Reader → ReadEra and others (Android)**

- **Moon+ is loved for control and resented for ads.**
  - Praise: "Every single thing is customizable, especially the controls and swipe gestures" (157^, 5★, 2024-10-17).
  - Ads: "I get an ad after basically each action I take" while organising (126^, 4★, 2025-07-24); "unskippable full screen ads offensive for a book reading app" (14^, 2★, 2026-07-13).
  - 96 of 527 Moon+ reviews since 2023 mention ads.
  Source: [Moon+, Google Play](https://play.google.com/store/apps/details?id=com.flyersoft.moonreader)
- **ReadEra wins on no ads, privacy and simplicity:**
  - "NO ADS!" (160^, 2024-08-11);
  - "the third ePub reader I downloaded and the first I did not immediately delete… setup enables giving the app access to exactly one folder!" (153^, 2025-01-03);
  - "Even if it's not as feature rich as Moon+ or Librera, the user interface is simple to grasp" (163^, 2024-12-27).
  Source: [ReadEra, Google Play](https://play.google.com/store/apps/details?id=org.readera)
- **Moon+ ads after a Pro purchase** were raised on MobileRead in January 2026 (via search summary only) — [MobileRead](https://www.mobileread.com/forums/showthread.php?p=4563430)

**Readwise Reader (adopted for highlights, criticised as a book reader)**

- "I would cancel if it weren't part of the highlights subscription which I value more." The same review lists:
  - "highlighting a word doesn't always bring up the menu… Often it mis-registers a page turn";
  - "No offline/real dictionary";
  - "No swiping left or right to change the page";
  - "Can't bookmark a page/location";
  - "I live in fear of accidentally clicking this thing ['return to location'] on a thousand page book".
  (1★, 2025-08-19, 2 helpful votes) — [Readwise Reader, App Store](https://apps.apple.com/us/app/id1567599761)
- Other Readwise Reader reviews:
  - "crashing every 5 to 7 minutes" on an EPUB, "back to iBooks, which is not nearly as elegant but just seems to consistently work" (2★, 2024-08-25);
  - "Zero statistics… the only feature that I wanted" (1★, 2024-12-17, 4 votes).
  Source: [Readwise Reader, App Store](https://apps.apple.com/us/app/id1567599761)
- Readwise said its "EPUBs v2" overhaul was "much much harder than expected" (June 2025 update; via search summary) — [Readwise](https://readwise.io/reader/update-june2025)

**KOReader: why people adopt it, and why some abandon it**

- **Adopt:**
  - progress and statistics sync across devices;
  - "customised estimated time remaining/progress bar";
  - "custom fonts and margin support";
  - after years of a Tolino: "slow page turns, soft crashing regularly… and being stuck with publishers type setting… It's like a new device."
  Sources: [HN jabroni_salad](https://news.ycombinator.com/item?id=49097695), [HN nekooooo](https://news.ycombinator.com/item?id=49102796), [HN tweetle_beetle](https://news.ycombinator.com/item?id=49107575)
- **Abandon:**
  - "I found the menus and UI to be rather non-intuitive… get rid of KOReader because it felt a bit laggy" (gejose, 2026-07-29);
  - "UI is cumbersome… you keep getting these 'Connecting to wifi' popups" (charles_f, 2026-07-29);
  - "It's like learning to pilot a plane.... manually" (b0dhimind, 2025-04-01).
  Sources: [HN](https://news.ycombinator.com/item?id=49097889), [HN](https://news.ycombinator.com/item?id=49099243), [HN](https://news.ycombinator.com/item?id=43552491)

**Google Play Books**

- **A deal-breaker switch back to Kindle:** "Font & highlighting issues have become deal breakers. Going back to reading on Kindle… ABILITY TO HIGHLIGHT ACROSS MULTIPLE PAGES" (984^, 3★, 2026-06-20) — [Play Books, Google Play](https://play.google.com/store/apps/details?id=com.google.android.apps.books)

### Inferences
- Pager sidesteps the commercial switching triggers: no store, no DRM, no ads, a local folder. What remains are the triggers a personal app *can* commit:
  - losing place;
  - redesigns that hide controls;
  - unfixable typography;
  - instability.
- The Marvin, Yomu and KOReader stories suggest power readers will forgive a dense settings surface if the reading view itself stays clean.
- The things that made people switch are mostly reading-view details: margins, a laggy page turn, a control you cannot hit. Library features matter less.

### Gaps
- I could not read Reddit thread bodies, including the Kindle→Kobo threads and r/ebooks "Marvin" threads, so specific "the small thing that made me switch" anecdotes from Reddit are missing.
- I found no 2023+ user-voice evidence about Kindle Page Flip specifically; only 2016 launch coverage exists.

---

## 2. Recurring frustrations: the minute details people notice

### Takeaway
The most intense complaints are about **trust in position**: reopening in the wrong place, sync "shooting back" chapters, rotation or font changes losing the spot, text that reflows between visits. Next come **input arbitration**:

- taps near edges turning the page instead of following a footnote or starting a highlight;
- pinch gestures silently changing font size;
- accidental highlights while scrolling;
- highlights that cannot cross a page break.

Then **night comfort** (white flashes, white bars in dark mode, no sleep timeout), **progress indicators** (page numbers that don't count pages, indicators that change when you tap, no way to hide them), and **footnotes** (no popup, no "back", slow jumps).

### Cited Findings

**Approximate frequency (keyword matches across all star ratings).**
- App Store, 3,065 reviews since 2023: highlights/notes 196, sync 168, ads/upsell 159, performance/crash 150, TTS 125, typography/fonts 106, scroll 94, progress indicators 56, page-turn 51, dictionary 50, lost place 42, dark/flash 31, stats 20, margins 14, accidental input 12, footnotes 10.
- Google Play, 4,307 reviews: ads 448 (in ReadEra's case mostly *praise* for having none), highlights 336, TTS 226, typography 173, sync 154, scroll 92, progress 81, dark/night 75, accidental 28, lost place 24, stats 19.
- The 11 per-app App Store feeds (iOS) are linked in the method note; Play: [Moon+](https://play.google.com/store/apps/details?id=com.flyersoft.moonreader), [ReadEra](https://play.google.com/store/apps/details?id=org.readera), [Play Books](https://play.google.com/store/apps/details?id=com.google.android.apps.books), [Readest](https://play.google.com/store/apps/details?id=com.bilingify.readest), [Librera](https://play.google.com/store/apps/details?id=com.foobnix.pdf.reader), [Lithium](https://play.google.com/store/apps/details?id=com.faultexception.reader), [Kindle](https://play.google.com/store/apps/details?id=com.amazon.kindle)

**A. Losing your place: the most emotionally charged theme**

- **Kobo app** (17 "lost place" and 31 "sync" mentions in 500 iOS reviews):
  - "If you accept the pop up to sync to the last page read you can be assured you'll be shot back like two plus chapters" (1★, 2025-07-11);
  - "Now every time I open a book, it starts the book over and I lose my place. Unusable for me now." (1★, 2025-09-23);
  - "even when the app was open and I temporarily switched to another app, I have to back out of the book. Otherwise, who knows where the book is going to open" (2★, 2025-06-11);
  - "bookmark your current page in Kobo often as possible. It will be the only way to jump back" (1★, 2025-07-13);
  - "asks… to sync to the latest page every time I turn a page… even when I'm at the latest page" (2★, 2026-06-12).
  Source: [Kobo, App Store](https://apps.apple.com/us/app/id301259483)
- **Apple Books, scroll mode specifically:** "Won't Save Position on Vertical scrolling. Skips ahead ~50 pages every time I open a book when vertical scrolling is enabled" (1★, 2026-09-19). Also: "Pages stick. I look up the page isn't turning but the page number at the bottom is. Close the app reopen and I'm 300 pages in a different direction" (1★, 2026-10-13) — [Apple Books, App Store](https://apps.apple.com/us/app/id364709193)
- **Kindle iPad reflow:** "text randomly shifts when turning pages. I can leave a page, return to the exact same location, and find that text and paragraphs have moved or been repaginated. This makes it extremely difficult to keep my place" (4★, 2026-10-04). A cross-device complaint: "it used to ask if I wanted to move to the most recent page on the second device… No longer does that" (1★, 2026-10-25) — [Kindle, App Store](https://apps.apple.com/us/app/id302584613)
- **Rotation:**
  - PocketBook "when I rotate my phone, the app loses my place and loses my color appearance settings… Deleted." (1★, 2025-03-16) — [PocketBook](https://apps.apple.com/us/app/id805488884)
  - Yomu "Repeatedly rotating the iPad can cause your reading position to shift slightly" (4★, 2023-12-31) — [Yomu](https://apps.apple.com/us/app/id562211012)
- **Readest GitHub** (a WebView-based reader, so the closest analogue to Pager):
  - "Bug: Readest sync does not work at all and will overwrite itself with old location" (2026-05-19, 15 comments; "numerous other users confirmed") — [readest#4222](https://github.com/readest/readest/issues/4222)
  - "Reading progress sync is getting pretty bad… restart a few pages or chapters back… I've started using bookmarks when I put the device down… reliable page sync is by far my number one use case" (2026-08-24) — [readest#5859](https://github.com/readest/readest/issues/5859)
  - "iOS: Book reopens on wrong chapter… jump forward to the end of the current chapter" (2026-05-02, 17 comments) — [readest#4036](https://github.com/readest/readest/issues/4036)
  - after device sleep "jumps back to the beginning of the chapter", suspected to happen while Wi-Fi reconnects (2026-10-21) — [readest#6967](https://github.com/readest/readest/issues/6967)
  - opening a book on iOS pushed about 0% over KOReader's 26.6% (2025-09-05, 33 comments) — [readest#1968](https://github.com/readest/readest/issues/1968)
- **Navigation history:** Readwise Reader's single "return to location", "once it's gone, it's gone" (1★, 2025-08-19) — [Readwise Reader](https://apps.apple.com/us/app/id1567599761)
- **Series bingers:** "can't remember where I left off" (Linda, 2025-05-20) — [The eBook Reader blog](https://blog.the-ebook-reader.com/2025/05/19/ebook-readers-lack-useful-reading-history-and-reading-stats/)

**B. Accidental input: taps, pinches, swipes, highlights**

- **Pinch-to-resize on Kindle iOS after an October 2026 update.** At least 7 reviews in about 3 weeks:
  - "Even when you're not intentionally pinching the screen, boom font size changes" (3★, 2026-10-05);
  - "my font won't stay fixed… This throws my pages off and I have to scroll to find my current reading point" (2★, 2026-10-05);
  - "I am constantly accidentally changing the font. Please make this feature something you can turn off" (3★, 2026-10-21);
  - "Font size changes by itself" (1★, 2026-10-14).
  Source: [Kindle, App Store](https://apps.apple.com/us/app/id302584613)
- **Auto-highlight on Kindle:**
  - "Auto-highlight driving me insane!… I read fiction, and never want to highlight anything, but I am constantly inadvertently highlighting as I read" (4★, 2026-10-04);
  - "impossible to turn off the highlight ability. Scrolling while reading you get words, sentences highlighted… This brings you out of the book world" (4★, 2026-10-09).
  Source: [Kindle, App Store](https://apps.apple.com/us/app/id302584613)
- **Kindle progress indicator vs page turn:** "If I'm trying to turn the page I don't want it to instead change from the time left in the chapter to the page number. This has been an issue for years and now happens every third page turn or so" (2★, 2026-10-03) — [Kindle, App Store](https://apps.apple.com/us/app/id302584613)
- **Edge taps:**
  - "Trying to tap a link (like a footnote) near the edge or bottom of a page is an exercise in frustration — it either won't detect the tap or it will turn the page. Trying to highlight text near the edge of the page will more often just turn the page." (Kobo 2★, 2026-06-12) — [Kobo](https://apps.apple.com/us/app/id301259483)
  - Lithium's top complaint: "text highlighting has a serious bug that causes pages to turn and entire pages to be highlighted when attempting to highlight things in certain areas of the screen" (60^, 2023-02-10). Repeated at 23^ (2024-04-01), 22^ (2025-01-08) and 67^ (2025-08-04), and "on curved screens… impossible to highlight lines of text at the extreme top or extreme bottom" (2025-11-09) — [Lithium, Google Play](https://play.google.com/store/apps/details?id=com.faultexception.reader)
- **No way to turn off tap-to-turn:** Yomu has "no option to disable tap-to-turn-pages, which results in potentially a lot of unintentional page turning, and losing my place" (5★, 2025-03-28) — [Yomu](https://apps.apple.com/us/app/id562211012)
- **Other mis-fires:**
  - PocketBook: "I keep accidentally enabling [autoscroll] when I try to exit" (5★, 2024-04-07);
  - PocketBook: sliding a finger on the scrubber jumps "to a whole another Section of the book" (4★, 2025-05-17).
  Source: [PocketBook](https://apps.apple.com/us/app/id805488884)
- **The positive mirror:** "The page turn is not so sensitive that I accidentally turn it all the time which is my favorite feature" (Kobo 5★, 2026-04-02) — [Kobo](https://apps.apple.com/us/app/id301259483)
- **The opposite failure (too insensitive):** Readest swipes "often doesn't register… It takes multiple swipes" (2025-10-17, 42 comments). The dev says it is "more sensitive if it's more horizontal"; a user asks to make it customisable — [readest#2252](https://github.com/readest/readest/issues/2252)
- **Undo:** "One nice to have feature would be an undo button for accidental highlights" (BookFusion 5★, 2025-08-10) — [BookFusion](https://apps.apple.com/us/app/id1141834096)

**C. Highlights that won't cross a page break; selection limits**

- Play Books: "ABILITY TO HIGHLIGHT ACROSS MULTIPLE PAGES" (984^, 2026-06-20). Another review: "Highlighting across pages only works on desktop" (10^, 2026-09-02) — [Play Books](https://play.google.com/store/apps/details?id=com.google.android.apps.books)
- Kobo: "Try highlighting a sentence that continues from one page to the next. It's impossible. You simply can['t] do it without changing the font size" (1★, 2025-05-19); "Want to highlight something that spans a page break? Yeah, me too, but you can't" (2★, 2026-06-12) — [Kobo](https://apps.apple.com/us/app/id301259483)
- Yomu: "Multi-page highlights and notes… would be appreciated" (4★, 2023-12-31); "I often want to highlight sentences that cross to the next page on my phone and it doesn't allow me to" (5★, 2026-05-24) — [Yomu](https://apps.apple.com/us/app/id562211012)
- epub.js: "I would also want to be able to highlight trough pages" (2023-07-04) — [epub.js#1343](https://github.com/futurepress/epub.js/issues/1343)
- **Copy limits:** "The copy limit is stupid, I bought the book" (Kindle 1★, 2026-10-20) — [Kindle](https://apps.apple.com/us/app/id302584613). A Yomu user reports Kindle blocked copying from a *public-domain* Aozora Bunko text (2024-12-05) — [Yomu](https://apps.apple.com/us/app/id562211012)
- **Selection granularity:** Play Books lets you select "only one word at a time" for translation or definition (552^, 2026-07-14) — [Play Books](https://play.google.com/store/apps/details?id=com.google.android.apps.books)

**D. Night reading: white flashes, white bars, sleep**

- Kobo iOS (4 separate reviews):
  - "If you use it at night in a darkened room you get blinded by the entire tablet flashing white for a couple seconds. I am actively looking for a replacement." (3★, 2025-08-12);
  - "make it stop flashing a bright white screen whenever I start the app" (4★, 2025-07-23);
  - "every time I open a book the screen flashes rapidly multiple times, which is especially annoying in dark mode while reading at night" (2★, 2026-06-27);
  - "this glitch makes the app unusable for me since I read most at n[ight]" (3★, 2026-08-11).
  Source: [Kobo](https://apps.apple.com/us/app/id301259483)
- Kindle iOS: "Even when reading at night with the white on black setting, there is a bar of bright white that appears at the bottom every time I turn the page and most of the icons also are in white" (4★, 2026-10-22) — [Kindle](https://apps.apple.com/us/app/id302584613)
- Kindle library: "WHY are all of the collection group gray?? What happened to dark mode on here?" (2★, 2026-10-06) — [Kindle](https://apps.apple.com/us/app/id302584613)
- Falling asleep while reading:
  - "I go to sleep with reading, and I wake up to a tapped-out battery and a future of screen burn-in" (PocketBook 4★, 2024-07-19);
  - "if I fall asleep I want to see the IPAD reader off and not still on 6 hours later" (Yomu 5★, 2024-06-12);
  - "other apps I've used will turn off the screen after a few minutes of not interacting or turning a page. This one does not" (Kobo 4★, 2026-09-11).
  Sources: [PocketBook](https://apps.apple.com/us/app/id805488884), [Yomu](https://apps.apple.com/us/app/id562211012), [Kobo](https://apps.apple.com/us/app/id301259483)

**E. Progress indicators that lie, nag or vanish**

- Readest page numbers are computed from word count, not screens: "One page turn, one number count." The user calls the explanation "counterintuitive, but fair. I think if you can toggle the pre[ferred] way would be better" (2026-02-12, 27 comments) — [readest#3271](https://github.com/readest/readest/issues/3271)
- Apple Books, opposite wishes in the same month:
  - "No way to hide page number… Knowing how fast you're reading pages distracts" (1★, 2026-08-23);
  - "We had a sense of where we were in a book with the bottom page numbers which now is hidden after a few seconds" (1★, 2026-07-16).
  Source: [Apple Books](https://apps.apple.com/us/app/id364709193)
- Kindle: the setting does not stick, "it never gives the time left in the chapter no matter how many times you set it" (2★, 2026-10-19); "no way to view page numbers anymore" (1★, 2026-10-01) — [Kindle](https://apps.apple.com/us/app/id302584613)
- Moon+: "there's no option to turn on a 'page' indicator (at the bottom), only percentage or time left" (17^, 2024-07-17) — [Moon+](https://play.google.com/store/apps/details?id=com.flyersoft.moonreader)
- Yomu: "lacks a total page count"; "no total number of pages or adequate progress bar" (5★, 2026-09-27 and 10-03) — [Yomu](https://apps.apple.com/us/app/id562211012)
- Thorium's newest top-voted issue: "Show current page number persistently in the reading view (not just on hover)" (2026-07-23) — [thorium#3718](https://github.com/edrlab/thorium-reader/issues/3718)
- Kindle streaks break when sync lags: "it did not sync correctly causing me to lose my reading streak" (13^, 2026-05-20; also 16^, 11^) — [Kindle, Google Play](https://play.google.com/store/apps/details?id=com.amazon.kindle)

**F. Footnotes**

- Popup wanted:
  - "when epubs… have a word that has an asterisk… make that footnote pop up on the screen in a bubble without it taking you to the end" (BookFusion 4★, 2025-04-18);
  - "a dedicated button to easily return to your last reading place, after you've opened a footnote… Or, create a reference popup" (Yomu 3★, 2023-03-06);
  - "Missing 'back' button for annotations" (Yomu 4★, 2023-12-31).
  Sources: [BookFusion](https://apps.apple.com/us/app/id1141834096), [Yomu](https://apps.apple.com/us/app/id562211012)
- Broken return:
  - "Footnotes are almost impossible to click and return is always to a different location" (PocketBook 2★, 2024-06-28) — [PocketBook](https://apps.apple.com/us/app/id805488884)
  - Kobo "footnotes hyperlinks… often feel nearly impossible to interact with… the app swipes to a different page" (2★, 2025-05-04) — [Kobo](https://apps.apple.com/us/app/id301259483)
- Slowness: "jumping to a footnote can take up to five seconds on an M2" (Yomu, 2026-09-27) — [Yomu](https://apps.apple.com/us/app/id562211012)
- Praise: ReadEra Android "allows you to quickly toggle back and forth between recently visited sections" for "academic material with extensive endnotes" (5★ iOS review, 2025-04-29) — [ReadEra iOS](https://apps.apple.com/us/app/id1669188337)
- Non-linear content: "Wonder if it handles non-linear pages correctly, or if it does what iBooks does and treats them as some sort of end notes feature" (2023-08-29) — [HN](https://news.ycombinator.com/item?id=37312753)

**G. Margins, line length, chrome over text**

- Phone margins: "the 'margins' of my phone include a bit of black bezel and some leather case… wasting phone screen real estate on the title or chapter name on each page is annoying. I'd rather have three extra lines of text." Also: "Too-short lines of text drive me crazy" (jxdxbx, 2023-08-29) — [HN](https://news.ycombinator.com/item?id=37308859), [HN](https://news.ycombinator.com/item?id=37308241)
- Disagreement: "I don't find Apple's margins too large" (xdev); "Margins do help readability" (jxdxbx). Libby is praised by one user for near-ideal line length (ace) and attacked by another for "no margin control, too little space between lines" (gastropod) — [TidBITS 2023-09](https://talk.tidbits.com/t/margins-line-length-and-reading-ebooks-on-an-iphone/24445)
- Scroll mode: Yomu has "huge white margins on the top and bottom of the screen when in scroll mode" (4★, 2026-09-11). Kobo: "On continuous scroll it's worse because the chapter marker literally sits over the content at the bottom, which also happens to be how i read" (1★, 2026-04-21) — [Yomu](https://apps.apple.com/us/app/id562211012), [Kobo](https://apps.apple.com/us/app/id301259483)
- Settings vocabulary: Readest margins are controlled by "column gap", and "Increasing the gap width to increase my margins was _not_ obvious"; a second user hit "this same thing" (2026-07-24, 23 comments) — [readest#5301](https://github.com/readest/readest/issues/5301)
- Font floors: Apple Books "minimum font when using built-in themes is way too big" (2★, 2026-08-17) — [Apple Books](https://apps.apple.com/us/app/id364709193)
- Settings persistence:
  - Yomu: "I set up font, margins & background for my book… looked to see if the setup saved by clicking on another book. IT DOES NOT." (1★, 2023-09-22) — [Yomu](https://apps.apple.com/us/app/id562211012)
  - PocketBook "annoying to have to re-left justify every time" (4★, 2024-04-29) — [PocketBook](https://apps.apple.com/us/app/id805488884)
  - Kindle logout resets "font and margins and continuous scrolling" (10^, 2026-07-25) — [Kindle, Google Play](https://play.google.com/store/apps/details?id=com.amazon.kindle)

**H. Publisher formatting: both directions**

- Too much override:
  - "Worst at publisher styles… It stomps on background colors on anything but 'Day' theme" (Yomu 1★, 2024-11-30);
  - "ignores all original formatting by the book designer, so you see plain-vanilla text" (Yomu 2★, 2026-06-22).
  Source: [Yomu](https://apps.apple.com/us/app/id562211012)
- Too little override: "stuck with publishers type setting" (Tolino; HN 2026-07-30) — [HN](https://news.ycombinator.com/item?id=49107575). BookFusion users "could not select publisher's styling" (MobileRead 2023-05) — [MobileRead](https://www.mobileread.com/forums/showthread.php?t=353769)
- Delight when done right: Readest is "the ONLY reading app I've ever used that seems to render books the way they're intended to be experienced by their publishers… I could cry" (5★, 2026-04-05) — [Readest](https://apps.apple.com/us/app/id6738622779)

**I. Images, tables, technical books**

- "Terrible for a technical book with math. The math is presented as images as opposed to text" (Kindle 1★, 2026-09-27) — [Kindle](https://apps.apple.com/us/app/id302584613)
- "please allow the app to full screen the illustrations in the books" (Readest 5^, 2025-12-26) — [Readest, Google Play](https://play.google.com/store/apps/details?id=com.bilingify.readest)
- Readest "Image Gallery Mode" request (11 👍, 2025-03-21) — [readest#662](https://github.com/readest/readest/issues/662)

**J. Data loss and update regressions**

- Moon+: "notes and highlights are gone. Only the first few pages and the most recent ones have them" (90^, 2024-04-07) — [Moon+](https://play.google.com/store/apps/details?id=com.flyersoft.moonreader)
- PocketBook: "The new update completely wiped all my local notes, bookmarks and location" (2★, 2023-05-02) — [PocketBook](https://apps.apple.com/us/app/id805488884)
- Kobo: "it just deleted every single one of my imports" (2★, 2025-08-10); "removed bookshelf view (only has list now)" (1★, 2025-07-15) — [Kobo](https://apps.apple.com/us/app/id301259483)

### Inferences
- **Position integrity outranks everything else** for heavy readers. Pager should treat all of these as first-class correctness bugs, not polish:
  - restore after app switch, sleep and rotation;
  - font-size change and reflow keeping the same first visible sentence;
  - never letting a sync overwrite a further position with an older or 0% one;
  - for Scroll layout specifically, not jumping on reopen (the Apple Books bug).
- **Input arbitration is where web readers most often fail.** Pager already has a touch arbiter; the evidence says:
  - edge zones must defer to links and selection;
  - selection near page edges must not trigger turns;
  - pinch-to-resize should be off or opt-in;
  - "accidental highlight" should be impossible or undoable.
- **The "flash of white" is real and repeated.** Every surface must render in the dark theme from the first paint: app shell, loading states, chapter transitions, any toolbar or bar that appears on turn.
- **For progress, users disagree** (hide vs always show; page vs % vs time left). The consistent asks are a choice of indicator, an indicator that never changes on a page-turn tap, and honest numbers ("one page turn, one number").

### Gaps
- I found no first-hand 2023+ complaints specific to hyphenation or justification quality. Mentions exist (HN on word spacing under full justification, [HN](https://news.ycombinator.com/item?id=43551901)) but are sparse in reviews. Battery complaints were also rare beyond falling asleep with the screen on.
- Table-rendering complaints did not surface clearly. The "tables" keyword mostly matched "table of contents".

---

## 3. Delights: features people rave about

### Takeaway
Raves cluster around:

- reliable cross-device position;
- speed and responsiveness;
- deep but optional customisation (fonts, margins, hex colours, separate day and night themes, tap zones);
- a calm, ad-free, store-free reading surface;
- a few emotionally resonant details: a page-curl animation, time left in chapter, reading statistics and calendars, daily highlight review, a reading ruler, auto-scroll, and a sleep timer.

### Cited Findings
- **Cross-device position as the "killer feature":**
  - "This app is a lifesaver for an avid reader because it picks up your spot across devices" (Kindle 5★, 2026-10-22) — [Kindle](https://apps.apple.com/us/app/id302584613)
  - "It's not the best reader, but it has one killer feature: sync" (paraphrased Reddit summary, undated) — [GummySearch](https://gummysearch.com/tools/best-products/ebook-reader-app/)
  - Readest: "a no brainer if you like to read across multiple devices; I use it to sync my progress between my phone, tablet, and e-ink reader" (23^, 2026-09-06) — [Readest](https://play.google.com/store/apps/details?id=com.bilingify.readest)
- **Kindle detail praise:** "I love the realistic page-turning option and the time left in each chapter, in the book, the page numbers left, and the way it detects reading speed" (5★, 2026-10-23) — [Kindle, Google Play](https://play.google.com/store/apps/details?id=com.amazon.kindle)
- **Page-turn animation as the deciding factor:** "People underestimate how important a page turning animation is, but it is the deciding factor between whether I reach for the Google Play Books app, or My Kindle. I adore the little page curl at the corners" (49^, 2026-06-23) — [Play Books](https://play.google.com/store/apps/details?id=com.google.android.apps.books). Similar:
  - Moon+ "I love that even with a samsung I can still have the 3d flip animation" (2026-07-09);
  - Readest "page curl works faster and more responsive… The app is now perfect!" (2026-08-17);
  - ReadEra and KyBook users request it (2026-06-20, 2024-05-19).
  Sources: [Moon+](https://play.google.com/store/apps/details?id=com.flyersoft.moonreader), [Readest](https://play.google.com/store/apps/details?id=com.bilingify.readest), [ReadEra](https://play.google.com/store/apps/details?id=org.readera), [KyBook 3](https://apps.apple.com/us/app/id1348198785)
- **Customising colour and theme:**
  - "Messed with the fonts, margins, hex colors, etc., and it's gorgeous. Have one theme each for night and day" (Yomu 5★, 2026-03-29) — [Yomu](https://apps.apple.com/us/app/id562211012)
  - "I read almost exclusively in bed, and what's the point of having an OLED screen if you can't set the background black. And then I really like to set my text to orange" (BookFusion 5★, 2026-07-22) — [BookFusion](https://apps.apple.com/us/app/id1141834096)
  - "I do dark red for the text and black for the background at night. During the day I do a Manila yellow background" (KyBook 5★, 2026-07-26) — [KyBook 3](https://apps.apple.com/us/app/id1348198785)
- **Screen real estate:** "neither of those major apps take full advantage of the size of the iPhone or iPad screen… Yomu is perfect in that sense" (5★, 2024-09-18) — [Yomu](https://apps.apple.com/us/app/id562211012). Moon+: "ability to maximize reading space, removal of white space" (102^, 2025-10-11) — [Moon+](https://play.google.com/store/apps/details?id=com.flyersoft.moonreader)
- **Statistics:**
  - KOReader: "I especially like the statistics" (siatko, 2026-07-29) — [HN](https://news.ycombinator.com/item?id=49097116)
  - KOReader on a Kobo Sage shows "all kind of statistics" with "bar charts for each week. Calendars for each month"; KOReader "displays nice reading statistics that you can even synchronize with other devices" (comments, 2025-05-19/20) — [The eBook Reader blog](https://blog.the-ebook-reader.com/2025/05/19/ebook-readers-lack-useful-reading-history-and-reading-stats/)
  - The blog's author calls Kobo's stats "very limited" (time spent, minutes per session, pages per minute) and Kindle e-readers' stats absent — [same](https://blog.the-ebook-reader.com/2025/05/19/ebook-readers-lack-useful-reading-history-and-reading-stats/)
- **Highlight review (Readwise):**
  - "the highlights stay lost. Until readwise came along! I get daily reminders to review highlights" (5★, 2023-03-08);
  - "really helped me remember what I've read" (5★, 2023-12-16);
  - streak loss frustrates: "no notification when you are about to lose the streak" (4★, 2024-03-25).
  Source: [Readwise, App Store](https://apps.apple.com/us/app/id1476885528)
- **Article-reader typography:** "The typography is crisp, beautiful, wonderful balance of white space vs text" (Matter 5★, 2023-12-03) — [Matter](https://apps.apple.com/us/app/id1501592184). Instapaper: "Offers enough typographic control that I can read comfortably" (5★, 2023-05-25); against it, "Fonts are too dark in dark mode" (3★, 2023-05-08) — [Instapaper](https://apps.apple.com/us/app/id288545208)
- **Auto-scroll and ruler:**
  - "Finally an ebook reader with autoscroll! I'm a fast reader and my poor thumb" (BookFusion 5★, 2025-10-06) — [BookFusion](https://apps.apple.com/us/app/id1141834096)
  - "the ability to auto scroll while the ruler is on and dimming the words outside the ruler. it's helped me focus" (Readest 5★, 2026-07-14) — [Readest](https://play.google.com/store/apps/details?id=com.bilingify.readest)
- **Libby's simplicity:** 77 of 422 Libby 4–5★ App Store reviews since 2024 use "easy", "simple", "intuitive", "clean" or "seamless" (sample window 2026-10). Example: "Libby is so easy." — [Libby](https://apps.apple.com/us/app/id1076402606). One critic: "the reading experience on it is just junk" (1★, 2026-10-26) — [Libby](https://apps.apple.com/us/app/id1076402606)
- **Folder-based auto-import:**
  - "It found and consolidated all of my previously downloaded books automatically and painlessly" (Librera 30^, 2024-08-29) — [Librera](https://play.google.com/store/apps/details?id=com.foobnix.pdf.reader)
  - Moon+ "automatically add books that you download" (157^) — [Moon+](https://play.google.com/store/apps/details?id=com.flyersoft.moonreader)
  - ReadEra's "access to exactly one folder" (153^) — [ReadEra](https://play.google.com/store/apps/details?id=org.readera)
- **Sleep timer:** "Fulfills my needs: imports books, has decent voices, and a sleep timer" (Readest 5★, 2025-08-06) — [Readest](https://play.google.com/store/apps/details?id=com.bilingify.readest)

### Inferences
- Several delights are cheap for Pager:
  - per-time-of-day themes with free hex colours, including true-black OLED with coloured text;
  - time left in chapter;
  - a statistics or calendar view built from the local reading log;
  - a reading ruler;
  - a screen-off timeout.
- Pager's "local folder" model matches a real delight. Readers love apps that just find their books in a folder they control.
- Page-turn animation polarises. Some readers say it is "the deciding factor"; others prefer instant turns (see section 5). Make it a setting.

### Gaps
- I found no first-hand 2023+ user raves about Apple Books' scroll theme or Kindle Page Flip. Only one TidBITS user said scroll mode eases the margin problem. Both features are praised in coverage, but I could not verify that users talk about them.

---

## 4. Most-requested features, 2024–2026

### Takeaway
In order of the evidence volume I saw:

1. Reliable progress and annotation sync, plus self-hosted or open sync (WebDAV, KOReader, Hardcover).
2. Highlights that span pages, with multiple colours, an undo, and notes export (Markdown/Obsidian).
3. Continuous vertical scroll *across chapters*.
4. Configurable tap zones and gestures.
5. Footnote popups with a "back" action.
6. Better dictionary lookup: offline, inline popup, phrase not just word.
7. Reading stats, streaks and goals.
8. Reading ruler and auto-scroll.
9. TTS that turns pages and has a sleep timer.
10. Clock and battery in the reading chrome.
11. Library organisation: by author/series, folder watching, flat view.

### Cited Findings

**GitHub 👍 counts.** These are modest absolute numbers, so read them as ranking within each project.

- **KOReader:**
  - stylus/handwriting annotations (96 and 82);
  - "Flat/Library view" (76, open since 2021);
  - Japanese vertical text (42);
  - native Android keyboard (39);
  - sync highlights across KOReader devices (14, open since 2019).
  Sources: [koreader#2633](https://github.com/koreader/koreader/issues/2633), [#8472](https://github.com/koreader/koreader/issues/8472), [#11469](https://github.com/koreader/koreader/issues/11469), [#4587](https://github.com/koreader/koreader/issues/4587)
- **Readest:**
  - WebDAV backup (35);
  - self-hosted sync (19);
  - Hardcover sync (16);
  - vocabulary builder (15);
  - dictionary providers (14);
  - custom TTS (13);
  - KOReader statistics sync (12);
  - continuous scrolling across chapters (11);
  - sync custom themes (11);
  - image gallery (11);
  - recursive directory import (10);
  - end-to-end encryption for sync (9);
  - a chatbot aware of the book's context (9).
  Sources: [readest#356](https://github.com/readest/readest/issues/356), [#192](https://github.com/readest/readest/issues/192), [#789](https://github.com/readest/readest/issues/789), [#589](https://github.com/readest/readest/issues/589), [#1745](https://github.com/readest/readest/issues/1745), [#179](https://github.com/readest/readest/issues/179), [#1741](https://github.com/readest/readest/issues/1741)
- **Foliate:**
  - PDF support (131);
  - Windows (43);
  - PDF single-page (22, 2024);
  - watch folders (14, 2024);
  - add many books at once (14);
  - "set current book zoom as default for all books" (8).
  Sources: [foliate#139](https://github.com/johnfactotum/foliate/issues/139), [#1320](https://github.com/johnfactotum/foliate/issues/1320), [#1158](https://github.com/johnfactotum/foliate/issues/1158)
- **Thorium:**
  - mouse-wheel and touchpad scroll support (open since 2021, its top issue);
  - "Let the users modify Default Settings for appearance of books" (2025-11);
  - persistent page number (2026-07).
  Sources: [thorium#1436](https://github.com/edrlab/thorium-reader/issues/1436), [#3283](https://github.com/edrlab/thorium-reader/issues/3283), [#3718](https://github.com/edrlab/thorium-reader/issues/3718)

**Tap zones**

- Readest "Custom Screen Tap Zone": "divide the reading screen into multiple zones (such as a 3x3 grid…) and assign a custom action to each zone". A later user: "the current tap selection is far too simplified and a bit of a turn off… at least be able to go back/forward on both sides of the screen" (2025-11-18, updated 2026-05-12) — [readest#2464](https://github.com/readest/readest/issues/2464)
- BookFusion: asks for "'Increase Auto-Scroll Speed' and 'Decrease Auto-Scroll Speed' as assignable tap-zone actions" (5★, 2026-08-11) — [BookFusion](https://apps.apple.com/us/app/id1141834096)

**Stats, streaks and goals**

- ReadEra: "I wish it kept streaks… reading analysis at the end of the month or year, you could also create reading goals?" (202^, 2025-04-24); "how much time I've spent reading each individual book" (19^, 2026-04-12) — [ReadEra](https://play.google.com/store/apps/details?id=org.readera)
- Readwise Reader: "I deeply miss being able to see my reading progress, streaks, goals, etc for the year at a glance" (1★, 2025-01-26) — [Readwise Reader](https://apps.apple.com/us/app/id1567599761)

**Reading ruler**

- "it could benefit with a Reading Ruler like in the Kindle or Moon+ apps… would help anyone to read easier without getting lost. It would pair well with ReadEra's continuous scrolling mode" (163^, 2024-12-27) — [ReadEra](https://play.google.com/store/apps/details?id=org.readera)
- Line-by-line advance for readers who skip lines: "tap on the screen to go to the next line (so, similar to what Apple Books offers!)… used to read with a bookmark covering the next lines in school" (Yomu 5★, 2025-10-13) — [Yomu](https://apps.apple.com/us/app/id562211012)

**Dictionary**

- "I wish the dictionary didn't open in another app, there should be like a popup with the meaning" (Librera 81^, 2026-01-18) — [Librera](https://play.google.com/store/apps/details?id=com.foobnix.pdf.reader)
- Readwise Reader: "No offline/real dictionary… impossible with no connection" (2025-08-19) — [Readwise Reader](https://apps.apple.com/us/app/id1567599761)
- Readest: "offline dictionary and vocabulary builder" (12^, 2025-11-25) — [Readest](https://play.google.com/store/apps/details?id=com.bilingify.readest)

**Annotations and export**

- Play Books annotation review: "everything that doesn't fit on the first line is just cut off… it just picks a page somewhere around where the annotation is rather than taking me [there]" (1020^, 2025-06-13) — [Play Books](https://play.google.com/store/apps/details?id=com.google.android.apps.books)
- Readest: "no option to sort by date in highlights, notes, and bookmarks" (17^, 2025-12-12) — [Readest](https://play.google.com/store/apps/details?id=com.bilingify.readest)
- Yomu: "I make notes and highlight, then export into markdown to add to Obsidian… would love… a direct to Obsidian integration" (5★, 2023-12-27) — [Yomu](https://apps.apple.com/us/app/id562211012)
- Readwise Reader: no print or PDF export is "a deal breaker" (2★, 2024-05-14) — [Readwise Reader](https://apps.apple.com/us/app/id1567599761)
- ReadEra: "highlight colors for when I make annotations, and Sans Serif fonts" (107^, 2026-08-04) — [ReadEra](https://play.google.com/store/apps/details?id=org.readera)

**Clock and battery in the reading view**

- "adding the clock, and battery percentage would be amazing!" (ReadEra 6^, 2026-09-09); "I just wish there was a way to stop it hiding the clock" (6^, 2026-07-01) — [ReadEra](https://play.google.com/store/apps/details?id=org.readera)
- "I wish there was a way to keep the current time on the page" (Kobo 5★, 2026-05-19) — [Kobo](https://apps.apple.com/us/app/id301259483)

**TTS** (heavy volume: 62 of 387 Readest Play reviews, 41 of 787 ReadEra)

- "I'd love for the pages to turn along with the TTS" (Readest 13^, 2025-11-28) — [Readest](https://play.google.com/store/apps/details?id=com.bilingify.readest)
- Good TTS means "not speaking page and title numbers, working with the screen off, and turning pages properly" (2023-08-29) — [HN](https://news.ycombinator.com/item?id=37308241)
- "Please add a sleep timer" (Readwise Reader 5★, 2026-01-26) — [Readwise Reader](https://apps.apple.com/us/app/id1567599761)

**Library organisation**

- "sort my library by genre instead of just alphabetical author and book title" (Kindle 515^, 2025-04-29) — [Kindle](https://play.google.com/store/apps/details?id=com.amazon.kindle)
- "Only wish it pulled more of the metadata fields from my epubs so could sort by series, genre, collection" (Yomu 5★, 2024-02-02) — [Yomu](https://apps.apple.com/us/app/id562211012)
- Readest "Reading performance becomes unusable with large book collections" (2026-04-01, 20 comments) — [readest#3714](https://github.com/readest/readest/issues/3714)

### Inferences
- Many top requests are about sync and integrations, which Pager (a personal, local-first app) can largely ignore beyond its own phone/desktop sync. The reading-view requests transfer directly:
  - cross-page highlights;
  - continuous cross-chapter scroll;
  - tap zones;
  - footnote popups;
  - inline offline dictionary;
  - stats;
  - ruler;
  - clock and battery.
- "Set current settings as default for all books" (Foliate, Thorium, Yomu) and "settings persist" (Kindle, PocketBook) are recurring low-cost wins.

### Gaps
- I could not access Readwise's public feature-vote board or the r/readwise monthly feature-request threads (mirrors blocked), so I have no Readwise vote counts.
- I found no source ranking requests across apps. The ordering above is my synthesis of volume across sources, not a measured ranking.

---

## 5. Casual vs power readers; scroll vs pages; one-handed; reading in bed; non-fiction vs fiction

### Takeaway
Power readers want every knob and accept a learning curve, but they also value an uncluttered default view. Casual readers praise "easy", and a dense UI drives them away.

Scroll vs pages is a genuine split:
- vertical-scroll fans are vocal on Android (Play Books lacks scroll; Librera wins for it);
- their key complaint is scroll that is *not continuous across chapters*;
- page fans care about turn feel and animation.

For one-handed phone use, people ask for auto-scroll, tap zones and volume-key turns (blocked on iOS), and complain about controls placed near the home indicator. Night readers want true black, custom text colour, no flashes and a screen timeout.

Non-fiction readers want highlights, exportable notes, quick back-and-forth to notes and diagrams, and math as text. Fiction readers want immersion: no accidental highlights, page numbers they can hide, nothing on top of the text.

### Cited Findings

**Power vs casual**

- KOReader: "wildly unintuitive (just try to look at battery statistics, and marvel that it's in a submenu of a submenu with only 2 items) -- but it is very powerful. once I got used to it's quirks I can't go back" (2026-07-29) — [HN](https://news.ycombinator.com/item?id=49102796)
- "I am a power user… However, I am constantly frustrated with a lot of OSS software because it expects you to think like the developer of the tool" (incanus77, 2026-07-29) — [HN](https://news.ycombinator.com/item?id=49098807)
- The anti-tinkerer: "The entire point of my Kobo is kinda to be a distraction-free device, and messing around with installing stuff on it would ensure I would get distracted… when I should be reading or sleeping" (rbits, 2026-07-29) — [HN](https://news.ycombinator.com/item?id=49100356)
- Readest: "It can feel a little clunky UI/UX wise initially but you get used to it" (17^, 2026-03-30) — [Readest](https://play.google.com/store/apps/details?id=com.bilingify.readest). Librera: "Interface needs to be studied, but I like to do it" (40^, 2024-04-19) — [Librera](https://play.google.com/store/apps/details?id=com.foobnix.pdf.reader)
- Tap-zone debate: "Nice concept, but it could get overwhelming if not communicated well (for example, some test participants said the Padding system is already a bit confusing)" — [readest#2464](https://github.com/readest/readest/issues/2464)
- Yomu: "even though you already HAD a minimal interface the app wants to give you ANOTHER minimal interface" (1★, 2024-09-04) — [Yomu](https://apps.apple.com/us/app/id562211012)

**Scroll vs pages**

- **Scroll fans:**
  - "I just wish Vertical Scroll is an option for e-books. The side scroll feels too awkward for me to use, which makes me unable to actually use Books as a reading app" (Play Books 37^, 2026-08-13);
  - "I wish there was an option for vertical scroll… along with the classic turn-page" (19^, 2026-05-26);
  - "the best reader I have found for vertical scrolling" (Librera 57^, 2025-07-16);
  - "I want to read by scrolling not fake flipping" (Apple Books 1★, 2026-09-09);
  - "vertical scrollling would be helpful" (Kindle 2★, 2026-10-17).
  Sources: [Play Books](https://play.google.com/store/apps/details?id=com.google.android.apps.books), [Librera](https://play.google.com/store/apps/details?id=com.foobnix.pdf.reader), [Apple Books](https://apps.apple.com/us/app/id364709193), [Kindle](https://apps.apple.com/us/app/id302584613)
- **Chapter boundaries break scroll:**
  - "The lack of a true infinite scroll really hurts the app… when I get to the end of the chapter, I'm flicked to the next one" (Moon+ 54^, 2★, 2024-12-26) — [Moon+](https://play.google.com/store/apps/details?id=com.flyersoft.moonreader)
  - Readest scroll "briefly freeze[s] when switching chapters… if I haven't finished the last few lines, it jumps to the next chapter too soon, disrupting the reading flow" (11 👍). The developer, after a prototype: "it can still occasionally get stuck when you slowly scroll to the bottom of a section without enough momentum" (2026-01-02); a user: "I wonder how Kindle is doing it so smoothly?" — [readest#1745](https://github.com/readest/readest/issues/1745)
- **Scroll speed:** "I read quite quickly with large font, and the scroll speed from swiping is limited, making it really awkward to read" (PocketBook 2★, 2024-10-07) — [PocketBook](https://apps.apple.com/us/app/id805488884)
- **Page fans:** see the page-curl quotes in section 3. Kobo iPad: "The page turn animation on the IPad is laggy and highlighting text is fiddly" (3★, 2025-04-19) — [Kobo](https://apps.apple.com/us/app/id301259483)
- **Blog view (weak, undated in result):** a writer says scrolling feels natural on phones and makes a chapter's end feel closer — [Yahoo Tech](https://tech.yahoo.com/articles/vertical-scrolling-makes-ebooks-addictive-110015308.html)

**One-handed phone reading**

- "I'm a fast reader and my poor thumb. Why is it so difficult for other ebook readers to have autoscroll?" (BookFusion 5★, 2025-10-06) — [BookFusion](https://apps.apple.com/us/app/id1141834096)
- "I do wish I could scroll with the volume buttons but I haven't seen another app with that feature on iOS so I guess it's a limitation" (BookFusion 5★, 2024-09-01). "Now if Apple will allow the use of the volume button… then ill be very happy" (PocketBook 4★, 2023-01-04) — [BookFusion](https://apps.apple.com/us/app/id1141834096), [PocketBook](https://apps.apple.com/us/app/id805488884)
- Yomu: "you can't even use the page control _at all_ on modern iOS devices because the swipe-up control at the bottom overlaps it completely" (1★, 2024-09-04) — [Yomu](https://apps.apple.com/us/app/id562211012)
- Apple Books navigation controller is "nearly impossible to select" — [Basic Apple Guy](https://basicappleguy.com/basicappleblog/build-a-better-books)
- Lithium: "page turn with the finger print sensor" (175^, 2024-04-28) — [Lithium](https://play.google.com/store/apps/details?id=com.faultexception.reader)

**Reading in bed at night**

See section 2D for flashes and timeouts. Opinions on dark mode split:

- r/ereader "Where is the perfect Dark Mode?" (133 pts, 48 comments, 2025-08-03). Top comment: "i think dark mode on a eink screen defeats to purpose of an eink screen" (119). Others:
  - "I much prefer regular mode except when reading at night in the dark" (37);
  - "I read as close as I can to a dark grey background with off-white text" (13);
  - "I see 'floaters' in white surfaces" (3);
  - "I have pattern glare… I would prefer a gray background" (4).
  The comment text came through an archive. Source: [Reddit](https://reddit.com/r/ereader/comments/1mg799q/where_is_the_perfect_dark_mode/)
- "Yeah I use a combination of colored overlays… I don't get any white flash or brightness" (same thread, 2 points) — [Reddit](https://reddit.com/r/ereader/comments/1mg799q/where_is_the_perfect_dark_mode/)
- Manual brightness reverts to automatic on reopen (ReadEra 4^, 2026-06-24) — [ReadEra](https://play.google.com/store/apps/details?id=org.readera)

**Non-fiction and study vs fiction and immersion**

- "Technical references aren't read sequentially; random access is essential" (2023-08-29) — [HN](https://news.ycombinator.com/item?id=37305170)
- "the option of continuous scrolling text which will be useful for reading text while referring to diagrams" (Play Books 10^, 2026-09-02) — [Play Books](https://play.google.com/store/apps/details?id=com.google.android.apps.books)
- Readest "became my reader of choice for academic and reference books too" (23^, 2026-09-06) — [Readest](https://play.google.com/store/apps/details?id=com.bilingify.readest)
- Kindle colour highlights used analytically: "highlight in different colors to make clear a different assessment (review this passage later, this is the most important conclusion…)" (5★, 2026-10-27) — [Kindle](https://apps.apple.com/us/app/id302584613)
- Fiction immersion: Kindle auto-highlight "brings you out of the book world you are immersed in" (2026-10-09); Apple Books page number "distracts from being able to just focus on the content" (2026-08-23) — [Kindle](https://apps.apple.com/us/app/id302584613), [Apple Books](https://apps.apple.com/us/app/id364709193)
- Recaps for series readers: "the recaps with spoilers. I think every single book should be required to have one" (Kindle 5★, 2026-10-20) — [Kindle](https://apps.apple.com/us/app/id302584613)

### Inferences
- Pager's default Scroll layout fits the vocal scroll camp. The evidence shows the bar is *seamless chapter continuity*:
  - no stall or freeze at chapter boundaries;
  - no premature jump while the last lines are unread;
  - position saved exactly on reopen.
- Pager's drag-to-turn should be checked against the "flicked to the next chapter before I finished" complaint.
- For one-handed iPhone use in a WKWebView:
  - keep controls clear of the home-indicator area;
  - offer large, configurable tap zones;
  - consider auto-scroll with fine speed steps (users complain about coarse percentage speeds: [Moon+ 7^](https://play.google.com/store/apps/details?id=com.flyersoft.moonreader)).
  Volume-key turning is not available on iOS.
- A "study mode" vs "immersion mode" split maps to real user groups:
  - study: highlight colours, notes list, back stack, stats;
  - immersion: hidden numbers, highlight gestures off, minimal chrome.

### Gaps
- I found no quantitative data on the share of readers preferring scroll vs pages. The evidence is anecdotal and skews to people who are missing their preferred mode.
- One-handed-specific threads (r/iphone and others) were not reachable.

---

## 6. Complaints specific to web-based or WebView readers (pitfalls for Pager)

### Takeaway
Web-engine readers (Readest on Tauri/WebView, epub.js and foliate-js apps, Readwise Reader) show a recognisable failure set:

- CSS-column pagination artifacts (columns drifting, text cut at edges, page numbers that don't match screens);
- selection near page edges triggering page changes or "teleporting";
- scroll mode stalling at chapter (iframe/section) boundaries;
- position lost on resume, sleep or network reconnect;
- implementation terms leaking into settings ("column gap");
- selection rendering glitches;
- swipe recognition that is too strict.

These map directly onto Pager's architecture.

### Cited Findings
- **Selection near edges teleports pages:** "When I select some text and I select it to far to the right of the screen or too far to the bottom of the screen it, shift the column or teleport me to another page" (2023-07-04, 2 👍) — [epub.js#1343](https://github.com/futurepress/epub.js/issues/1343). The same failure appears in native Android apps (Lithium, multiple reviews at 22–67^) — [Lithium](https://play.google.com/store/apps/details?id=com.faultexception.reader)
- **Column drift (older):** "Every time pages are switched, column shifts slightly to the right, after repeating this a few times text column moves out of viewport" (2021, 15 comments) — [epub.js#1218](https://github.com/futurepress/epub.js/issues/1218). Moon+ shows the same symptom natively: "the text is slightly outside the left bound, leading to about half of all the leftmost letters cut in two" (17^, 2024-07-17) — [Moon+](https://play.google.com/store/apps/details?id=com.flyersoft.moonreader)
- **iOS-specific (older):**
  - "Mobile Safari text selection broken for many ePubs on iOS (iPad)" (2019) — [epub.js#904](https://github.com/futurepress/epub.js/issues/904)
  - "Ios cuts off the last few pages of a paragraph after changing the font size" (2015) — [epub.js#330](https://github.com/futurepress/epub.js/issues/330)
  These are old and may be fixed in modern WebKit, but they mark known risk areas.
- **Embedding side-effects:** "Cannot embed foliate into a web page without it causing spurious scrolling of containing elements" (2025-03-23, 14 comments) — [foliate-js#53](https://github.com/johnfactotum/foliate-js/issues/53)
- **Scroll mode across sections:** Readest freezes or stalls at chapter boundaries; see [readest#1745](https://github.com/readest/readest/issues/1745). A Readest Play review: "Scroll mode doesn't works and you can only read files in horizontal page flip… the app crashes" (2★, 2025-09-05) — [Readest](https://play.google.com/store/apps/details?id=com.bilingify.readest)
- **Pagination via CSS columns leaks into the UI:** margins are set through "column gap" because "each page is at least one column in the paginated mode… It uses css column layout to paginate". The user: "that's implementation details that only you (mostly) know about. The user doesn't see a column layout" (2026-07-24) — [readest#5301](https://github.com/readest/readest/issues/5301)
- **Page numbers don't match screens:** word-count-based numbering confuses users — [readest#3271](https://github.com/readest/readest/issues/3271)
- **Resume, sleep and network:** reopening on the wrong chapter (iOS), jumping back after device sleep while Wi-Fi reconnects, and a 0% push on first open — [readest#4036](https://github.com/readest/readest/issues/4036), [#6967](https://github.com/readest/readest/issues/6967), [#1968](https://github.com/readest/readest/issues/1968). Readest also "frequently crashes after exiting to another app and returning" (13^, 2025-11-28) — [Readest](https://play.google.com/store/apps/details?id=com.bilingify.readest)
- **Selection rendering:**
  - "Weird behavior when selecting text from the start of a paragraph in Android" (8 👍, 2025-07-08) — [readest#1553](https://github.com/readest/readest/issues/1553)
  - "Black rectangles during selection on some Android devices" (2026-09-02) — [readest#6025](https://github.com/readest/readest/issues/6025)
  - "Text glitches in scrolling mode in EPUB on MacOS" (2025-03-13, 19 comments) — [readest#600](https://github.com/readest/readest/issues/600)
  - Readest tablet: "When I select text, the highlight option shows up but I can't tap it" (22^, 2026-03-21) — [Readest](https://play.google.com/store/apps/details?id=com.bilingify.readest)
- **Swipe strictness:** see [readest#2252](https://github.com/readest/readest/issues/2252) (42 comments)
- **Desktop input:** Thorium's top-voted open issue is mouse-wheel and touchpad scroll support (since 2021) — [thorium#1436](https://github.com/edrlab/thorium-reader/issues/1436)
- **Readwise Reader (web-heavy architecture):**
  - "highlighting a word doesn't always bring up the menu… Often it mis-registers a page turn" (2025-08-19);
  - the iPad app is "the web browser's inferior in every way" (3★, 2024-11-24).
  Source: [Readwise Reader](https://apps.apple.com/us/app/id1567599761)
- **Offline expectations:** about a web-app reader, "So you must be able to reach the server every time you are reading an ebook… And what if you don't have internet connectivity?" (2023-08-29) — [HN](https://news.ycombinator.com/item?id=37305421)

### Inferences
- For Pager (React PWA plus WKWebView), the checklist the users imply:
  - edge-safe selection that never turns or teleports pages, and that can extend across a page boundary;
  - pagination that never drifts or clips glyphs at column edges after many turns or font changes;
  - scroll that flows across chapter boundaries without stalls;
  - exact resume after backgrounding, sleep, rotation and network flaps, with sync that cannot regress position;
  - settings named in reader terms (margins, line length), not CSS terms;
  - swipe thresholds that tolerate diagonal thumbs;
  - full offline reading.
- Because WKWebView cannot see volume keys, one-handed comfort has to come from tap zones and auto-scroll.

### Gaps
- I found no user-voice complaints specifically naming WKWebView, such as rubber-band overscroll, the iOS text-selection loupe, or the keyboard covering note fields, in 2023+ reader reviews. The evidence above is from WebView-based readers in general, and some epub.js items are old (2015–2021).
- Readest's iOS App Store reviews (86 since 2025) mention sync and TTS most. They do not single out WebView feel.
