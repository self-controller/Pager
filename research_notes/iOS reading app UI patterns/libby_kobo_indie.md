# Libby, Kobo Books and indie EPUB readers on iPhone: reader UI and micro-interactions (state as of 28 Oct 2026)

Method and evidence levels used in these notes:
- **[Doc]**: official help pages or vendor posts.
- **[Code]**: read directly in source. Two code sources were used. (1) The public, unauthenticated Libby web bundle at libbyapp.com (`dewey-22.2.0`), fetched on 2026-10-28 without logging in. (2) The Readest open-source repo, cloned at commit `578b50f` (2026-10-28) and read but not built.
- **[Screenshot]**: a real screenshot of the Libby reader in a library guide (Aug 2025, Android tablet; the same web UI is served on iOS).
- **[Review]**: press, forum posts and user reviews.
- **Inferences** are kept apart from cited findings.
- Reddit could not be fetched (the crawler is blocked), so r/LibbyApp, r/kobo and r/ebooks opinions come only through other sources.

---

## Q1. Libby (OverDrive): navigation model, settings, page turns, end-of-loan and end-of-book flows, and how a web app feels native

### Takeaway
Libby is confirmed to be one web codebase ("Dewey") running in native shells. The reader ("Bifocal") is a second web app. In the browser it runs in an iframe. In the native apps it runs in a separate native webview that the shell reveals and conceals. The web code asks the shell for haptics, the status-bar colour, sharing and storage. The reader's navigation model has five parts: tap the centre for chrome; top bar with Back, Appearance, Search and Bookmarks; a bottom "timeline" (a page ruler with a cover-thumbnail knob, pages read and left in the chapter, and marks for bookmarks and highlights); a session-only "Recent places" trail; and a tap at the top edge that toggles a bookmark. Libby has no scroll mode. It suggests "Finished?" on the Shelf once progress reaches 95% or more, and its return flow uses unusually warm, considerate wording.

### Cited Findings

**Architecture and how Libby feels native (confirmed from the public bundle)**
- The libbyapp.com shell HTML declares the following. A PWA manifest (`display: standalone`, `orientation: portrait`). `<meta name="apple-mobile-web-app-capable" content="yes">`. `apple-mobile-web-app-status-bar-style = black-translucent`. Viewport `initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover`. `color-scheme: light dark`. Splash CSS with `-webkit-tap-highlight-color: rgba(0,0,0,0)`, `-webkit-touch-callout: none`, `-webkit-text-size-adjust: none` and a `-apple-system, ".SFNSText-Regular", "San Francisco", Roboto…` font stack. The app is named in meta tags as `x-dewey-version 22.2.0` — [libbyapp.com shell HTML](https://libbyapp.com/), [web-app-manifest.json](https://libbyapp.com/dewey-22.2.0/inc/web-app-manifest.json)
- The splash screen draws a 12-spoke SVG spinner that imitates the iOS UIActivityIndicator. It uses `animation: spinner-spoke 1440ms infinite` with a 120 ms stagger per spoke. The splash "wall" animates with `transition: opacity 100ms linear 900ms, transform 500ms ease-in-out 500ms`. The mascot uses `transform 400ms ease-in-out` — [libbyapp.com shell HTML](https://libbyapp.com/)
- The same web code detects its native shells. Android: a `Dewey` token in the UA (`navigator.userAgent.match(/Chrome\/30\..*Dewey/)`). Windows: a `ms-local-stream:` origin, with a "nautilus" CORS origin parameter. iOS: `"iOS"==shellInfo.platform && shellInfo.build<65` gates the quirk "cannot-download-files". Shell capabilities checked in code include `ui:haptics`, `ui:bifocal-webview`, `bank`, `nav:share`, `device:soft-keyboard`, `device:ios-web-app`, `notifier:receive/schedule`, `ui:oauth`, `ui:passkey` and `network:info` — [Libby main.js](https://libbyapp.com/dewey-22.2.0/src/main.js)
- The strings file names each native capability: "Haptic feedback", "Separate bifocal view", "Native storage bank", "Offline dictionary", "Native share sheets", "Accessibility gestures", "Soft keyboard", "Synthetic speech", "Audio sleep at chapter", "Notification badge" — [Libby en-US strings](https://libbyapp.com/dewey-22.2.0/inc/str/en-US.js)
- The reader ("Bifocal") runs in one of two ways. On the web it is an `<iframe>` (`bifocal-frame`) loaded with the loan's "web" URL, and messages go to it with `postMessage`. When the shell has `ui:bifocal-webview`, the web app sends `bifocal:view:open` with `{url, openbookURL, format: "book"|"audiobook"}` and then `bifocal:view:reveal` or `bifocal:view:conceal`. The native shell owns a separate reader webview layered over the library UI. Leaving the reader conceals it after `{delay:100}` instead of destroying it — [Libby main.js](https://libbyapp.com/dewey-22.2.0/src/main.js)
- Opening a book uses a cover "emergence" transition. Code finds the largest visible `[data-cover-id]` element in the current screen, takes its `getBoundingClientRect()`, and calls `screen.emerge()` from that rect. This is a shared-element zoom from the shelf cover into the open-book screen — [Libby main.js](https://libbyapp.com/dewey-22.2.0/src/main.js)
- **Haptics bridge.** Module `shibui/src/haptics` exposes `prepare()`, `select()`, `impact("light")` and `notify("success")`. Each sends `{name:"haptic:"+kind, dest:"shell"}` to the native shell. Calls are coalesced with `GAP_MS = 75`: a haptic within 75 ms of the last one is deferred, not stacked. `select()` is skipped when the UA contains "Chrome", which means Android. Calls seen in code: `select()` on toggling chips and filters, map markers, filter-graph ranges and carousel dots; `impact("light")` when a tutorial balloon is "released" (it floats off and is removed after 1200 ms) — [Libby main.js](https://libbyapp.com/dewey-22.2.0/src/main.js)
- **Status-bar colour bridge.** `APP.shell.colorize(color, lock)` keeps a priority stack of colour locks (`"", "search", "theatre", "bifocal", "force"`). It computes the HSLuv and YIQ of the surface colour so the shell can choose a light or dark tint. The value `"none"` sets `immersive: true` for full-screen chrome — [Libby main.js](https://libbyapp.com/dewey-22.2.0/src/main.js)
- Accessibility settings strings: "Reduce Motion — Minimize the use of animation effects in the user interface." and "Reduce Vibrations — This setting prevents all the haptic feedback generated by Libby, but cannot suppress any system-generated vibrations." — [Libby en-US strings](https://libbyapp.com/dewey-22.2.0/inc/str/en-US.js). Libby follows the device's larger text, dark mode, colour filters and reduced-motion settings. Pop-up notices stay 3 s by default, adjustable up to 30 s, and can be turned off. "Read From Here" lets screen readers read the book — [Libby blog, 2023](https://www.libbylife.com/blog/2023-07-13-9-accessibility-features-in-the-libby-app-to-make-your-reading-easier)
- Lineage: OverDrive bought Booki.sh in 2012. Booki.sh used Inventive Labs' open-source HTML5 Monocle reader, and its founders (Joseph Pearson et al.) joined OverDrive — [Library Technology Guides](https://librarytechnology.org/document/16871). Libby launched in June 2017 as the successor to OverDrive Read — [Wikipedia](https://en.wikipedia.org/wiki/Libby_(service))
- One HN user described it as "a typical javascript monstrosity but it is sort of usable" (2024-09-13) — [HN](https://news.ycombinator.com/item?id=41536139)

**Reader chrome and tap zones**
- Tap the centre to show or hide the navigation bar (top) and timeline (bottom). Tap the left side or swipe left-to-right to go back; tap the right side or swipe right-to-left to go forward. "Slide the timeline" to reach a precise position. The top bar holds Appearance, Search, Bookmarks and notes, and "Back" (to Shelf) — [Libby Help: Using the Libby reader](https://help.libbyapp.com/en-us/6063.htm)
- **Tap the top of the screen to bookmark.** "Tap the top of the screen in the reader" adds a bookmark. You can also open chrome and tap the bookmark icon at the top right — [Libby Help 6136](https://help.libbyapp.com/en-us/6136.htm), last updated 03 Sep 2026. A library guide warns: "Do not tap near the top of the screen, as this may place a bookmark instead of turning the page" — [Oak Park PL](https://www.oppl.org/news-events/digital-learning/tech-tips-how-to-read-ebooks-magazines-in-libby/)
- **[Screenshot] Layout of the open chrome**, top to bottom:
  - Status bar.
  - "‹ Back" (text plus chevron) on the left. On the right, three outline icons: a circled "A" (Appearance), a magnifier (Search) and a stacked-bookmarks icon.
  - A thin black hairline under the top bar. A small outline bookmark-ribbon glyph hangs from the hairline at the top-right corner of the page.
  - Page text (justified serif).
  - A hairline above the bottom panel. A circular book-cover thumbnail sits centred on that hairline as the timeline's "knob", flanked by "pg. 14" on the left and "of 613" on the right.
  - The next row reads "◂ 1p", then the centred chapter title "1. The Hurricane" with "TABLE OF CONTENTS" in small caps beneath it, then "5p ▸".
  - At the bottom, a horizontal **ruler-style scrubber** with thin tick marks (labels "20" and "40") and some heavy black ticks, fading at the edges.
  — [Scenic Regional Library guide, Aug 2025](https://scenicregional.org/wp-content/uploads/LibbyMobileAppHelpGuide_August2025.pdf)
- The same guide labels the controls "Page Status: Displays what page you are on out of how many pages there are", "Page Back/Page Forward: Takes you back/forward the displayed number of pages" and "Chapters: Displays an interactive table of contents" — [Scenic Regional guide](https://scenicregional.org/wp-content/uploads/LibbyMobileAppHelpGuide_August2025.pdf)
- Progress semantics from the help page:
  - The current page is shown on the left, next to the cover, and the total page count on the right.
  - "Pages completed are shown on the left of the chapter name, and pages remaining are shown on the right."
  - The timeline shows "your progress, chapter breaks, bookmarks, and highlights".
  - "Tap the current page number next to the cover to see progress as a percentage."
  — [Libby Help 6045](https://help.libbyapp.com/en-us/6045.htm), updated 03 Sep 2026. Older (2018) wording: "Tapping the page number label cycles through how many pages are left in the chapter and total book progress as a percentage" — [OverDrive FAQ, 2018](https://company.overdrive.com/2018/03/11/4-frequently-asked-questions-about-libbyanswered/)
- Tapping the chapter title in the bar opens a chapter menu, and selecting a chapter jumps to its start — [Oak Park PL](https://www.oppl.org/news-events/digital-learning/tech-tips-how-to-read-ebooks-magazines-in-libby/)

**Place history ("go back to where you were")**
- "To jump to your last position, tap the **Recent place, just now** button or the **Next article** button below the timeline… To see a list of your recent places, tap the **Recent Places** button below the timeline." "Your recent places are erased each time you close a title." Overall progress is in the title's "Reading Journey" — [Libby Help 6285](https://help.libbyapp.com/en-us/6285.htm), updated 21 Aug 2026
- The Reading Journey is a per-title page with progress, circulation activity, bookmarks, notes and highlights. Push notifications open it — [Libby Help 6228](https://help.libbyapp.com/en-us/6228.htm). Notes and highlights export from there as a web table or spreadsheet — [Libby Help 6151 (search summary)](https://help.libbyapp.com/en-us/6151.htm)

**Reading settings sheet ("A" icon)**
- Text Scale slider. "Include accessibility sizes" extends it to larger sizes — [Oak Park PL](https://www.oppl.org/news-events/digital-learning/tech-tips-how-to-read-ebooks-magazines-in-libby/), [Libby blog](https://www.libbylife.com/blog/2023-07-13-9-accessibility-features-in-the-libby-app-to-make-your-reading-easier)
- "Lighting": "Bright", "Sepia", "Dark". "By default, Libby follows your device's lighting mode" — [Libby Help 6046](https://help.libbyapp.com/en-us/6046.htm)
- "Book Design": six presets. They are Publisher's Default, Legible, Scholar, Paperback, OpenDyslexic and Custom. Custom offers font (Palatino, Georgia, Old style, Cochin, Serif, Sans Serif), justification (left/justified), line spacing (1.0/1.5/2.0) and text weight (Normal/Heavy) — [OverDrive FAQ, Mar 2018](https://company.overdrive.com/2018/03/11/4-frequently-asked-questions-about-libbyanswered/). This list is from 2018. A 2022 forum user reported only "sans" and "serif" with no custom fonts — [MobileRead, Aug 2022](https://www.mobileread.com/forums/showthread.php?t=348500). That user may have been on an e-ink Android device, so the two sources conflict.
- No continuous scroll for books, by design. OverDrive (Adam Sockel, 3 Oct 2018): research found "continuous scroll is great for long form articles but it creates a challenging reading experience for books" — [OverDrive blog comments](https://company.overdrive.com/2018/03/07/libby-update/). Magazines have an "Article" view that scrolls vertically — [Oak Park PL](https://www.oppl.org/news-events/digital-learning/tech-tips-how-to-read-ebooks-magazines-in-libby/)
- To zoom images in ebooks, tap and hold the image, then pinch — [Oak Park PL](https://www.oppl.org/news-events/digital-learning/tech-tips-how-to-read-ebooks-magazines-in-libby/)

**Selection and highlights**
- "Press and hold a word until it's highlighted, then drag to select." "Tap **Highlight** to use the most recent highlight color, or pick a different color next to Highlight." To add a note, tap the highlighted passage, then "**Make a note**". Marks come back if you borrow the book again — [Libby Help 6136](https://help.libbyapp.com/en-us/6136.htm)

**End of loan and end of book (Libby UI strings and logic)**
- The Shelf shows a "whisperer" when `journey.progress >= .95`: "**Finished?**", which expands to "When you are done with this title, returning it early allows others to borrow it sooner." with the button "**Return Early**". It is the first check in `_analyzeLoan`, ahead of renew prompts — [Libby main.js](https://libbyapp.com/dewey-22.2.0/src/main.js), [strings](https://libbyapp.com/dewey-22.2.0/inc/str/en-US.js)
- The return screen offers alternatives:
  - "Not finished yet? Nobody is waiting, so you may renew your loan instead."
  - "Not finished yet? Several people are waiting, and you can join the line by placing a hold."
  
  The exits after return are "Keep Browsing", "Go To Shelf", "Reading Journey", "Find Your Next Read", "Thanks!" — [strings](https://libbyapp.com/dewey-22.2.0/inc/str/en-US.js)
- Notifications:
  - Loan expiring: "Your loan at {LIBRARY_NAME} is due soon.", with actions "Renew Loan", "Return Early", "Title Details".
  - Loan expired: "Your loan at {LIBRARY_NAME} was returned on the due date.", with actions "Reading Journey", "Borrow Again", "Title Details".
  - Shelf whisperer: "Expiring soon. Renew?"
  
  — [strings](https://libbyapp.com/dewey-22.2.0/inc/str/en-US.js)

**Libby complaints and praise**
- Accidental bookmarks at the top edge — [Oak Park PL](https://www.oppl.org/news-events/digital-learning/tech-tips-how-to-read-ebooks-magazines-in-libby/). An r/LibbyApp thread (seen only through a mirror) on stray touches in the player suggested iOS Guided Access as a workaround — [r/LibbyApp mirror](https://axebps-redlib.hf.space/r/LibbyApp/comments/1kyq3hk/lock_screen_to_avoid_accidentally_scrolling)
- Trustpilot reviewers call the reader counter-intuitive with cryptic icons. One says books open on the last page; others report sync failures. These are anonymous and undated — [Trustpilot (search summary)](https://ca.trustpilot.com/review/libbyapp.com)
- A Pratt IXD critique (Feb 2025, audiobook player) praises the chapter skip-to-start and skip-to-end buttons that complement the coarse slider. It criticises every bookmark defaulting to the name "A bookmark" and the edit action hidden behind an undiscoverable left swipe — [Pratt IXD](https://ixd.prattsi.org/2025/02/design-critique-libby/)

### Inferences
- **The ruler timeline is page-scaled and centred on the current page.** In the screenshot the knob sits at x≈400 for page 14, "20" is at x≈456 and "40" is at x≈642. That is about 9.3 px per page with labels every 20 pages, and it yields page 14 at the centre. So the ruler scrolls under a fixed centre knob, like a tape measure, and does not move a thumb along a fixed track. The heavy ticks are probably bookmarks and highlights, because the help says the timeline shows them. This is inferred from one screenshot.
- "1p" and "5p" are the chapter-jump buttons. They show the distance to the chapter start and end, so they double as a "pages left in chapter" readout. This is a compact design that Kindle and Apple Books lack.
- Running the reader in a separate native webview lets the shell keep the library UI alive and swap between the two instantly. The 100 ms conceal delay and the cover "emerge" animation hide the switch. A wrapper-plus-WKWebView app can copy this directly.
- Coalescing haptics to at most one per 75 ms keeps a fast scrubber or chip strip from buzzing continuously. The pattern suits Pager's scrubber ticks well.
- On iOS the native shell must use WKWebView, since UIWebView is no longer accepted. The code does not name the class, so this is inferred.

### Gaps
- The Bifocal reader's own JS and strings load only from a loan-specific URL. They were not reached because logging in was not allowed. Exact page-turn animation (slide versus none), timings, the exact Appearance sheet layout and copy, the number of highlight colours, and the in-reader end-of-book screen are therefore **unknown**. A JustAnswer thread reports books "stuck on the last page with the list of chapters", which suggests the last page shows the TOC, but it is unreliable — [JustAnswer](https://www.justanswer.com/electronics/m2reg-unable-return-ebook-stuck-libby-today-mean.html).
- No source confirms a "swipe up for menu" gesture in the book reader. The only documented chrome toggle is a centre tap.
- No source says whether the reader's own page turns or timeline scrubbing trigger haptics. The haptics module exists in the library app, and the reader is a separate bundle.

---

## Q2. Kobo Books (iOS): stats, time-left display, page turns, Reading Settings, end of book, OverDrive and Pocket

### Takeaway
Kobo rebuilt its iOS app in mid-2025 (App Store v11.x). The reader adds several things Kindle and Apple Books lack: **press-and-hold on the screen edge to flip pages faster the longer you hold**, **pinch anywhere to change font size** (a font-size menu pops up), a **"return" arrow that appears only after a jump**, page transitions **Curl / Swipe / Fade / Off**, and a beta **vertical scroll ("pageless") mode**. Public sources for current reading stats, time left in the chapter and the end-of-book flow on iOS are thin.

### Cited Findings
- **Page turning**: "Tap the right side of the screen" for next and the left side for previous, or swipe. "Tap and hold the left or right edge of the screen" to turn many pages; the longer you hold, the faster they turn — [Kobo Help: Turn pages and skip chapters](https://help.kobo.com/hc/en-us/articles/360017708194-Turn-pages-and-skip-chapters-in-your-book-on-the-Kobo-Books-app-iOS-Android)
- **Navigation chrome**: tap the centre for the menu. Drag the circle on the bottom slider (the screenshot labels it "page scrubber"). Chapter back and forward icons sit beside it. "The arrow icon only appears after you've skipped a chapter or go to a different page using the slider." Tapping it (bottom-left) returns you to where you were — [Kobo Help](https://help.kobo.com/hc/en-us/articles/360017708194-Turn-pages-and-skip-chapters-in-your-book-on-the-Kobo-Books-app-iOS-Android)
- **Reading Settings** (centre tap, then the Font icon at the top; the sheet scrolls): Tone ("Adjust the page colour and screen brightness"), Font, Margins, Line Spacing, Alignment, Page Transition ("Change the animation style when you turn your page"), Lock Orientation — [Kobo Help: margins, line spacing and more](https://help.kobo.com/hc/en-us/articles/360017865293-Adjust-page-margins-line-spacing-and-more-on-the-Kobo-Books-app-iOS-Android)
- **Font size**: "While reading, pinch the screen to make the font smaller or larger"; a font-size menu appears. You can also use the slider in the Font menu and "Tap on the desired font" — [Kobo Help: font size and type](https://help.kobo.com/hc/en-us/articles/360017708154-Adjust-font-size-and-font-type-on-the-Kobo-Books-app-iOS-Android)
- **Page transitions** in the redesigned app: "Curl, Swipe, Fade and Off". The new vertical scroll "acts as an infinite scroll" — [Good e-Reader](https://goodereader.com/blog/kobo-ereader-news/rakuten-kobo-redesigns-its-app-for-the-iphone). The scroll mode is "in Beta… in the reading settings when inside a book, it's all the way at the bottom" (17 May 2025) — [MobileRead](https://www.mobileread.com/forums/showthread.php?t=368201). Gadget Guy (23 Jul 2025) called it the "biggest" update and one of the more experimental additions — [Gadget Guy](https://www.gadgetguy.com.au/kobo-app-update-ios-version-11/)
- Kobo's summer-2025 blog describes an all-new design that puts "reading first". New features include a Listen Bar that persists while browsing, Read Aloud TTS on select titles, a beta pageless mode and in-app purchase. The page itself returned 403, so this comes from a search summary — [Kobo blog](https://www.kobo.com/blog/kobos-summer-2025-update-on-new-features-and-fixes)
- **Notes and highlights**: press and hold a word until a menu appears, drag the **circular handles**, tap "Note", type, then "Save". A **note icon** appears next to the passage, and tapping it shows the note. The list is under the TOC icon, then "Annotations", then the ⋯ menu, then "Delete Note" — [Kobo Help: Make notes](https://help.kobo.com/hc/en-us/articles/23234736728215-Make-notes-while-you-read-in-your-Kobo-Books-app-iOS-Android). Apple Pencil markups are supported on iOS — [Kobo Help section](https://help.kobo.com/hc/en-us/sections/360003253874-Reading)
- **App Store** (fetched 28 Oct 2026): 4.5★ from 28K ratings. Current version is 11.5.3; 11.0 shipped 07/03/2025. Recent notes: "More reliable reading progress and syncing, including fixes for issues around your last-read position." — [App Store](https://apps.apple.com/us/app/kobo-books/id301259483)
- **Complaints (App Store)**: the screen "no longer dims for reading at night"; "the last few words at the end of a chapter would drop off"; "not retaining the reader's place in the book"; "can't close and set as finished an e-book" (2022). Praise: "This app is simple to use" — [App Store](https://apps.apple.com/us/app/kobo-books/id301259483)
- **Stats (older app)**: per-book stats covered time spent, pages turned and pages per hour, reached from the upper area of the reader — [Softpedia review of 7.6 (search summary)](https://mobile.softpedia.com/ios/Kobo-Books-iOS-Review-1682.html), [Good e-Reader review (search summary)](https://goodereader.com/blog/reviews/kobo-ereading-and-audiobook-app-review-for-ipad-and-iphone). Kobo counts a book as finished when you mark it or reach 90% — [Kobo blog (search summary; page 403)](https://www.kobo.com/blog/https-news.kobo.com-your-reading-activity-explained). On Kobo **eReaders**, returning to the menu after about 90% triggers a "mark finished" dialog — [MobileRead (search summary)](https://mobileread.com/forums/showthread.php?p=4433154)
- **Pocket**: Mozilla shut Pocket down on 8 Jul 2025, which ended Kobo's Pocket integration — [The eBook Reader](https://blog.the-ebook-reader.com/2025/07/12/pocket-support-has-ended-on-kobos-without-any-alternatives). Kobo **eReaders** got Instapaper support in late Aug 2025 firmware (4.38.23429 / 4.43.23418) — [The eBook Reader](https://blog.the-ebook-reader.com/2025/08/26/latest-kobo-software-update-adds-instapaper-support/), [Six Colors](https://sixcolors.com/link/2025/08/kobo-instapaper-have-come-together-at-last/)

### Inferences
- The two main Kobo ideas worth copying are the edge-hold accelerating flip and the arrow that appears only after a jump. Both are chrome-light: the "go back" affordance exists only when it is useful, unlike Libby's always-present "Recent Places".
- Pinch-to-resize text, with a transient size indicator, is a direct-manipulation idea that Apple Books and Kindle on iPhone do not use for reflowable text.
- Pocket and Instapaper and OverDrive are e-reader features, not iOS app features, and are no longer relevant to the iOS reader. OverDrive's built-in integration on Kobo devices is general knowledge and was not verified here.

### Gaps
- I found no source for whether the current (11.x) iOS app shows **"time left in chapter"**, what the progress footer looks like, or whether a Reading Stats screen still exists. Forum sources describe e-readers (chapter "Page 3 of 27"; pages left in chapter) — [MobileRead (search summary)](https://www.mobileread.com/forums/showthread.php?p=4044855) — not the app.
- The end-of-book flow on iOS (rating, "what's next", mark finished) is undocumented in public sources.
- No source covers haptics, exact transition durations or the Tone sheet layout.

---

## Q3. Indie EPUB readers on iOS: distinctive ideas and current status

### Takeaway
- **Readest** (open source, active, v0.12.16) is the most useful reference for Pager. On iOS it is a Tauri app, so it is also a web UI inside WKWebView, and its code gives exact values (below).
- **Yomu** (active, v3.21.0) is praised for restraint: "no unnecessary preferences", per-book defaults, slide or fast-fade page turns, and a Liquid Glass redesign with a "Classic Reader design" fallback.
- **BookFusion** (active, iOS 1.40.1, Oct 2025) leads on configurability: a 3×3 tap-zone grid, one-tap favourite highlight colours, word-boundary snapping and a scrollable selection menu.
- **Marvin** has been gone from the App Store since about early 2024. Its legacy is fully customisable gestures, including brightness and warmth swipes, and "Deep View".
- **KyBook 3** is abandoned (last release 2019) and reported removed.

### Cited Findings

**Readest (code read at commit 578b50f, 2026-10-28; GitHub readest/readest)**
- iOS build: Tauri 2 (`@tauri-apps/api 2.11.1`) with an Xcode project in `src-tauri/gen/apple`, so it is a web UI in the system webview. Haptics come from `@tauri-apps/plugin-haptics` and are enabled only on iOS and Android (`hasHaptics = OS_TYPE === 'ios' || 'android'`) — [package.json](https://github.com/readest/readest/blob/main/apps/readest-app/package.json), [nativeAppService.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/services/nativeAppService.ts)
- **Tap zones**:
  - The middle 25% of the width toggles header and footer: the band from 37.5% to 62.5% (`zoneWidth * 0.375` to `0.625`).
  - A tap outside that band while bars are visible hides the bars first, without turning the page.
  - Otherwise the left half turns back and the right half turns forward.
  - Options: `swapClickArea` (mirror) and `fullscreenClickArea` (any tap = next). `disableClick` makes every tap act as a centre tap.
  - In a two-page spread with a full-page image, zones are measured per column.
  
  — [usePagination.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/hooks/usePagination.ts)
- **Swipe up toggles chrome** in paginated mode when all of these hold: `deltaY < -10`, `|dy| > 2·|dx|` and `|dx| < 30%` of the width. Any other unconsumed gesture hides the bars. Tap slop and swipe threshold are 15 px — [useIframeEvents.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/hooks/useIframeEvents.ts), [useTouchInterceptor.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/hooks/useTouchInterceptor.ts). Double-click window is 250 ms; long hold is 500 ms — [constants.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/services/constants.ts)
- **Page-turn motion**:
  - Styles are `'push' | 'slide' | 'curl'`, with `push` as the default. "'push' slides the whole strip; 'slide' and 'curl' layer the outgoing page over the still incoming page (Apple Books style, needs View Transitions)" — [types/book.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/types/book.ts)
  - The layered ("captured") turn defaults to **450 ms** — [capturedTurn.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/utils/capturedTurn.ts)
  - The underlying foliate-js paginator animates scroll snaps in **300 ms `easeOutQuad`** with a **100 ms** lock between turns. On release, the target page is the viewport midpoint plus `velocity × pageSize`, so 1 px/ms of flick moves one extra page. Default CSS: `--_gap: 7%`, `--_margin: 48px`, `--_max-inline-size: 720px`, `--_max-column-count: 2` — [foliate-js paginator.js](https://github.com/johnfactotum/foliate-js/blob/main/paginator.js)
- **Pull-down-to-bookmark** ("after the WeRead interaction"):
  - In paginated mode, dragging the page down slides it away from the top and reveals a band containing a hint and a ribbon.
  - Activation is 18 px (downward-dominant). Touches within 10 px of the top edge belong to the system.
  - The page tracks the finger 1:1 up to 120 px, then rubber-bands at ×0.35.
  - The trigger is **100 px**. The ribbon fill always previews the state a release would produce.
  - Copy: "Pull down to add bookmark" / "Release to add bookmark" / "Pull down to remove bookmark" / "Release to remove bookmark".
  - The spring back takes **250 ms** with ease-out-cubic. Offsets are written with rAF and `translate3d`.
  
  — [BookmarkPullDown.tsx](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/components/BookmarkPullDown.tsx), [bookmarkPullGesture.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/utils/bookmarkPullGesture.ts)
- **Left-edge brightness swipe** (iOS/Android only): the edge zone is 10% of the width, activation is 18 px, a √ curve maps position to brightness, and the overlay hides after 600 ms — [brightnessGesture.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/utils/brightnessGesture.ts), [useBrightnessGesture.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/hooks/useBrightnessGesture.ts)
- **Selection**:
  - An "instant highlight" engages only after the finger rests **300 ms** with less than 10 px of movement, so taps and swipes still turn pages — [useTextSelector.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/hooks/useTextSelector.ts)
  - Dragging a selection into the bottom-right corner (forward) or top-left corner (back) auto-turns the page after a **500 ms** dwell. The corner zone is a quarter-ellipse of 15% of each axis, capped at 50 px. A bar runs along the armed edge for the length of the dwell, "so holding there reads as 'keep holding to turn'" — [useAutoPageTurn.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/hooks/useAutoPageTurn.ts), [PageTurnHint.tsx](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/components/annotator/PageTurnHint.tsx)
  - There is a magnifier loupe component — [annotator dir](https://github.com/readest/readest/tree/main/apps/readest-app/src/app/reader/components/annotator)
  - Selection actions: Copy, Copy Link, Highlight, Annotate, Search, Dictionary, Translate, Speak, Proofread, Share, Quote Card — [AnnotationTools.tsx](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/components/annotator/AnnotationTools.tsx)
- **Mobile chrome**:
  - The bottom bar has tabs "Table of Contents", "Color", "Reading Progress", "Font & Layout" and "Speak".
  - Each tab opens a non-modal panel that floats `64px + 0.33·safeAreaBottom` above the bottom, so the page stays visible for live preview.
  - The Progress panel holds Previous Section, Previous Page, **Go Back, Go Forward** (location history), Next Page, Next Section and a slider.
  - The Font & Layout panel has Font Size, Page Margin and Line Spacing sliders (Small to Large) and "More Settings".
  - The header fades with `transition-[opacity,margin-top] duration-300`.
  
  — [MobileFooterBar.tsx](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/components/footerbar/MobileFooterBar.tsx), [NavigationPanel.tsx](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/components/footerbar/NavigationPanel.tsx), [FontLayoutPanel.tsx](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/components/footerbar/FontLayoutPanel.tsx), [HeaderBar.tsx](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/components/HeaderBar.tsx)
- **Progress copy**: "{{time}} left in chapter", "{{time}} and {{count}} pages left in chapter", "{{count}} pages left in book", "{{time}} left in book". The footer is a three-zone row (progress / remaining / clock-battery) — [ProgressBar.tsx](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/components/ProgressBar.tsx)
- **Sheets**:
  - Swipe-to-dismiss closes the sheet if velocity > 0.5 or the sheet is dragged past 50% of the height (snap threshold 0.2 for snapped sheets). It then animates out over `0.15 / max(velocity, 0.5)` s with ease-out and fires a **light impact haptic**.
  - Otherwise it springs back in 0.3 s with ease-out (overlay opacity 0.8).
  - These are the only haptics in Readest.
  
  — [Dialog.tsx](https://github.com/readest/readest/blob/main/apps/readest-app/src/components/Dialog.tsx), [useSwipeToDismiss.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/hooks/useSwipeToDismiss.ts)

**Yomu EBook Reader (active)**
- "Designed to let you focus on reading, Yomu has no unnecessary preferences." Fonts include Lato, Georgia, Lexend and OpenDyslexic. Modes: day, sepia, grey, dusk, night, black. Layout: page or scroll. "All settings can be saved as your personal default for each book." — [yomu-reader.com](https://www.yomu-reader.com/)
- Release notes (undated) show the following:
  - 3.21.0 most recent.
  - 3.14.0 "Redesigned for Apple's unified software design language" (iOS 26).
  - 3.19.0 "Classic Reader design" option under Design, plus Bold Text that follows the system setting.
  - 3.11.0 "choose between standard slide or fast fade page turning animation", an option to turn off the screen-edge back gesture in the reader, and tap left or right to continue.
  - 3.12.1 progress as a percentage.
  - 3.13.0 custom colour schemes.
  - 3.15.0 Dynamic Type.
  - 2.14.0 long-press auto-scroll.
  
  — [Yomu release notes](https://www.yomu-reader.com/release-notes/)

**BookFusion (active)**
- iOS 1.31.0 adds custom tap zones: "a convenient 3 X 3 grid", with actions Page Left, Page Right, Toggle Toolbar, Play/Pause and No Action. It also fixes brightness-gesture conflicts — [BookFusion blog](https://www.blog.bookfusion.com/bookfusion-ios-1-31-0-custom-tap-zones-other-improvements/). 1.35.2 adds Play Forward and Play Backward tap actions for TTS and read-along — [BookFusion blog](https://www.blog.bookfusion.com/?p=3967)
- iOS 1.29.0 (2 Sep 2023): "Text Selection Context Menu now scrollable to include: Search, Translation, Web Lookup, Share, Speak & Start TTS" — [BookFusion blog](https://www.blog.bookfusion.com/?p=3736)
- "quickly access favorite highlight colors with one tap". Highlights "automatically expand to word boundaries". Apple Pencil highlights are created, merged and edited with a tap. Image and area highlights are supported, and saved reader themes sync. This is a vendor-sponsored article (9 Dec 2024) — [Cult of Mac](https://www.cultofmac.com/news/bookfusion-ios-ebook-app)
- iOS 1.40.1 (7 Oct 2025): "Better Highlights" (highlight filters), smart or simple dark mode for PDFs, and zoom retention across page turns — [BookFusion blog](https://www.blog.bookfusion.com/bookfusion-ios-1-40-1-better-highlights-pdfs-comic-reading-experience/)

**Marvin (discontinued)**
- "With Marvin's recent disappearance from the iOS app store…" (16 Feb 2024). The author valued its page numbering, which follows the "1,024 characters per page rule" — [Ben Crowder](https://bencrowder.net/blog/2024/1665/). A 2023 thread already reported Marvin unavailable — [Ask MetaFilter](https://ask.metafilter.com/375791/I-need-a-good-epub-app-for-iOS)
- Customisable gestures include swipes for brightness and warmth, page-turn directions, and snapping to bookmarks and chapters — [LitReactor, 2014](https://litreactor.com/columns/product-review-marvin/). Marvin 3 added edge tapping in vertical scroll — [TeleRead, 2016](https://teleread.org/2016/06/21/appstafarian-releases-marvin-3-a-worthy-successor-to-both-marvin-and-gerty-teleread-news-e-books-publishing-tech-and-beyond/)
- "Deep View" scans the book in under a minute, lists proper nouns and can generate chapter summaries per character — [TidBITS, 2013](https://tidbits.com/2013/05/10/marvin-the-intelligent-ebook-reader-almost-gets-it-right/)

**KyBook 3 (abandoned)**
- The last release was 0.7.8 in Feb 2019, and the app is reported removed from the App Store. The source is a competing vendor's blog, so confidence is low — [justRead](https://justread.app/en-UK/posts/kybook-3-alternatives-iphone-2026)

### Inferences
- Readest shows that a WKWebView reader can carry Apple-Books-grade gestures (layered turns, pull-to-bookmark, edge brightness) when it owns touch handling inside the iframe. It uses capture-phase listeners and a "claim" arbitration between gestures (brightness first, then bookmark pull, then paginator).
- Yomu and BookFusion sit at opposite ends of the configurability scale: Yomu offers few options with good defaults, while BookFusion lets users configure every zone. Users on forums tend to praise the first and ask for the second; BookFusion's own Reddit survey found custom tap zones were the most-requested feature.

### Gaps
- Yomu's exact sheet layout, durations and haptics are closed source and undocumented.
- BookFusion's end-of-book flow is undocumented.
- Status dates for Marvin and KyBook come from blogs, not Apple.

---

## Q4. Cross-cutting comparison: end of chapter and book, progress, tap zones, chrome, selection, haptics

### Takeaway
Libby turns progress into navigation: chapter-jump buttons are labelled with page distance, the page ruler scrubs, and tapping the page number cycles its format. Kobo has the best direct-manipulation gestures (pinch font, hold-to-fast-flip, a conditional back arrow). Readest has the most precise and documented touch behaviour. None of the documented apps shows an interstitial at the end of a chapter. End of book is handled outside the reader (Libby's Shelf at 95% or more; Kobo's 90% "finished" logic on e-readers).

### Cited Findings
| Aspect | Libby | Kobo (iOS) | Readest (iOS, code) |
|---|---|---|---|
| Chrome toggle | Tap centre ([Help](https://help.libbyapp.com/en-us/6063.htm)) | Tap centre ([Help](https://help.kobo.com/hc/en-us/articles/360017708194-Turn-pages-and-skip-chapters-in-your-book-on-the-Kobo-Books-app-iOS-Android)) | Tap the middle 25% band or swipe up ([code](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/hooks/usePagination.ts)) |
| Page turn | Tap or swipe left and right; no scroll ([Help](https://help.libbyapp.com/en-us/6063.htm), [OverDrive](https://company.overdrive.com/2018/03/07/libby-update/)) | Tap or swipe; hold edge to flip faster; Curl/Swipe/Fade/Off; beta scroll ([Help](https://help.kobo.com/hc/en-us/articles/360017708194-Turn-pages-and-skip-chapters-in-your-book-on-the-Kobo-Books-app-iOS-Android), [GER](https://goodereader.com/blog/kobo-ereader-news/rakuten-kobo-redesigns-its-app-for-the-iphone)) | push/slide/curl; 300 ms easeOutQuad snap; 450 ms layered ([code](https://github.com/readest/readest/blob/main/apps/readest-app/src/types/book.ts)) |
| Bookmark | Tap top edge, or icon ([Help](https://help.libbyapp.com/en-us/6136.htm)) | Not documented for the app | Pull page down 100 px ([code](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/utils/bookmarkPullGesture.ts)) |
| Progress | "pg. N of M" by the cover knob; tap to see %; chapter pages read and left; ruler timeline ([Help](https://help.libbyapp.com/en-us/6045.htm)) | Slider "page scrubber" ([Help](https://help.kobo.com/hc/en-us/articles/360017708194-Turn-pages-and-skip-chapters-in-your-book-on-the-Kobo-Books-app-iOS-Android)) | "{time} left in chapter", pages left ([code](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/components/ProgressBar.tsx)) |
| Go back after a jump | "Recent place, just now" plus a Recent Places list; erased on close ([Help](https://help.libbyapp.com/en-us/6285.htm)) | Arrow appears only after a jump ([Help](https://help.kobo.com/hc/en-us/articles/360017708194-Turn-pages-and-skip-chapters-in-your-book-on-the-Kobo-Books-app-iOS-Android)) | Go Back and Go Forward buttons ([code](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/components/footerbar/NavigationPanel.tsx)) |
| Selection | Hold, drag, "Highlight" (last colour) or colour picker; tap highlight, then "Make a note" ([Help](https://help.libbyapp.com/en-us/6136.htm)) | Hold, circular handles, "Note", "Save"; note icon in margin ([Help](https://help.kobo.com/hc/en-us/articles/23234736728215-Make-notes-while-you-read-in-your-Kobo-Books-app-iOS-Android)) | Hold 300 ms for instant highlight; corner dwell 500 ms turns page ([code](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/hooks/useAutoPageTurn.ts)) |
| End of book | Shelf "Finished?" at progress ≥ 95%, then "Return Early" ([code](https://libbyapp.com/dewey-22.2.0/src/main.js)) | 90% = finished (search summary) ([Kobo](https://www.kobo.com/blog/https-news.kobo.com-your-reading-activity-explained)) | Not examined |
| Haptics | Native via bridge; select and light impact; 75 ms coalescing; "Reduce Vibrations" ([code](https://libbyapp.com/dewey-22.2.0/src/main.js)) | Undocumented | Light impact on sheet dismiss only ([code](https://github.com/readest/readest/blob/main/apps/readest-app/src/components/Dialog.tsx)) |

### Inferences
- What these apps share and Kindle and Apple Books lack:
  - Libby's distance-labelled chapter skips and tap-to-cycle progress format.
  - Kobo's pinch-to-resize and hold-to-fast-flip.
  - Readest's pull-down bookmark and selection-corner page turn.
  - Libby's session-scoped "Recent places" stack.
- Libby's top-edge bookmark tap causes documented false positives. A pull-down gesture, as in Readest and WeRead, is a safer way to add a bookmark by gesture.

### Gaps
- End-of-chapter behaviour (any interstitial, haptic or "chapter complete" cue) is undocumented for all apps. No evidence suggests any of them has one.

---

## Q5. What users praise and complain about

### Takeaway
Libby is praised as a service and for its accessibility work. Its reader draws complaints about accidental taps, few typographic controls (no scroll, limited fonts) and sync glitches. Kobo's 2025 rebuild is praised for design and scroll mode, and draws complaints about losing the reading position, night dimming and text clipping at chapter ends. Primary Reddit threads could not be fetched.

### Cited Findings
- Libby, accidental bookmarks from top taps — [Oak Park PL](https://www.oppl.org/news-events/digital-learning/tech-tips-how-to-read-ebooks-magazines-in-libby/). Stray touches; Guided Access workaround — [r/LibbyApp mirror](https://axebps-redlib.hf.space/r/LibbyApp/comments/1kyq3hk/lock_screen_to_avoid_accidentally_scrolling)
- Libby, requests for scroll were declined in 2018 — [OverDrive](https://company.overdrive.com/2018/03/07/libby-update/). Reported lack of custom fonts — [MobileRead](https://www.mobileread.com/forums/showthread.php?t=348500). "Javascript monstrosity but… sort of usable" — [HN](https://news.ycombinator.com/item?id=41536139)
- Libby, a 2019 accessibility audit found TalkBack rendered only parts of the text — [accessiblepublishing.ca (search summary)](https://www.accessiblepublishing.ca/wp-content/uploads/2019/07/Libby-Full-report-July-2019.html). This is outdated. Libby's 2023 blog lists VoiceOver support and "Read From Here" — [Libby blog](https://www.libbylife.com/blog/2023-07-13-9-accessibility-features-in-the-libby-app-to-make-your-reading-easier)
- Kobo App Store complaints and praise, as quoted in Q2 — [App Store](https://apps.apple.com/us/app/kobo-books/id301259483). A reviewer found scroll mode "more seamless on a phone" but preferred tap-to-turn on iPad — [search summary of Kobo coverage](https://www.digitalreviews.net/news/industry-news/kobo-announces-instapaper-integration-and-major-ios-app-overhaul/)

### Inferences
- Losing the reading position is the complaint users weigh most heavily in both apps. Reliable position restore matters more than any animation.

### Gaps
- Reddit (r/LibbyApp, r/kobo, r/ebooks) was not reachable. App Store reviews for Libby were not retrieved.

---

## Implications for Pager

Pager's iPhone app is a SwiftUI shell around a React UI in WKWebView, with CSS pagination and scroll views.

### Takeaway
Most of the patterns worth copying are pure web: Libby's timeline and progress cycling, Kobo's conditional back arrow and edge-hold flip, and Readest's pull-down bookmark, tap bands and selection-corner turn. Three things need native help through a WKScriptMessageHandler bridge: **haptics** (copy Libby's coalesced `haptic:select|impact|notify` messages), **screen brightness**, and **status-bar and immersive colouring** (Libby's `colorize`). Libby is evidence that this architecture, a web app plus a thin shell that exposes capabilities and a separate reader webview, can feel native and run at scale.

### Cited Findings
- Libby's shell-capability bridge (haptics, colorize, separate reader webview, share, storage) — [Libby main.js](https://libbyapp.com/dewey-22.2.0/src/main.js). Readest's Tauri WKWebView with native haptics and brightness plugins — [Readest repo](https://github.com/readest/readest)

### Inferences
Each pattern below is marked as buildable in web tech (Web), needing native help (Native), or a mix.

1. **Libby-style bottom timeline** — Web, plus a native haptic.
   - A centred knob (book cover or dot) with a page-scaled ruler that scrolls under it, so tick spacing is constant per page.
   - "pg. N of M" beside it; tap to cycle page, %, and pages left in chapter.
   - Chapter skip buttons labelled "‹ 3p" and "12p ›" (pages read and left in the chapter); the chapter title as the TOC button.
   - Draw bookmarks and highlights as heavier ticks. Pager has a page footer and a TOC drawer, so this replaces a plain slider.
   - Fire `haptic:select` when the scrubber crosses a chapter boundary, through a native bridge (UISelectionFeedbackGenerator), coalesced at about 75 ms as Libby does.
2. **Return to where you were** — Web.
   - Push a location onto a session stack on every non-linear jump (TOC, search hit, footnote, scrubber release, annotation tap).
   - Show a transient "Back to p. 42" pill only after a jump, Kobo-style, and list recent places Libby-style.
   - Clear the stack on close, as Libby does, or keep it per document.
3. **Bookmarking** — Web for the gesture, Native for the haptic.
   - Prefer Readest's pull-down-to-bookmark over a top-edge tap, which caused false positives in Libby.
   - Values to use: activation 18 px, trigger 100 px, 1:1 up to 120 px then damping ×0.35, ignore touches within 10 px of the top, spring back in 250 ms with ease-out-cubic.
   - Copy: "Pull down to add bookmark" / "Release to add bookmark".
   - In WKWebView, set `scrollView.bounces = false` (or `overscroll-behavior: none`) in paginated mode so the native rubber-band does not fight the gesture. This is a Native setting.
   - Fire a light impact when the 100 px threshold is crossed.
4. **Tap zones and chrome** — Web.
   - Centre band 37.5–62.5% toggles chrome. While chrome is visible, the first tap anywhere only hides it.
   - Swipe up (dy < -10 px, vertical-dominant) also toggles chrome.
   - Tap slop 15 px; double-tap window 250 ms; long-press 500 ms.
   - Offer "tap anywhere = next" and mirrored zones. A BookFusion-style 3×3 grid is optional.
   - Chrome fades in 300 ms.
   - Hide the status bar with chrome for immersive reading. This needs Native (SwiftUI `.statusBarHidden()` and `.persistentSystemOverlays(.hidden)` toggled from JS). Tint the status bar to the reading theme, as Libby's `colorize` does (Native).
5. **Page-turn animation** — Web.
   - Offer Slide (translate, 300 ms easeOutQuad snap, flick velocity adds pages) and Fade (Yomu's "fast fade"), plus None.
   - Curl is possible in web (Readest uses View Transitions and a mesh), but it is costly. Skip it at first.
   - Respect `prefers-reduced-motion`. WKWebView reflects iOS Reduce Motion; this is inferred and not verified here. Add an in-app "Reduce Motion" setting like Libby's.
6. **Kobo gestures** — Web, with caveats.
   - Hold the left or right edge to flip pages with accelerating repeat (simple timers). This is Web.
   - Pinch on the page changes the font size and shows a transient size HUD. This is Web, using WebKit `gesturestart/gesturechange` or two-finger touch maths. The viewport must disable page zoom, as Libby's `user-scalable=no` does. Pagination must then re-flow while keeping the position anchored to a CFI or text offset.
7. **Edge brightness swipe** (Readest, Marvin, BookFusion) — Native. The web layer can only dim with an overlay; real brightness needs `UIScreen.brightness` through the bridge. Gesture values: left 10% edge, 18 px activation, √ mapping, HUD hides after 600 ms.
8. **Selection and highlight flow** — Mixed.
   - Libby's "Highlight = last colour, with colour swatches beside it" and BookFusion's word-boundary snapping are Web.
   - Readest's 300 ms "instant highlight" hold and its corner dwell (500 ms, 15% / 50 px quarter-ellipse, with a growing edge bar) for selections across pages are Web.
   - Decide early between custom JS selection (full control, needs a loupe) and the native WKWebView selection menu. Native selection gives the system loupe and handles, but adding Pager actions needs native `buildMenu`/edit-menu customisation, which is Native.
   - Tapping an existing highlight should open the annotation popover with "Make a note" (Libby wording).
9. **Settings panel** — Web.
   - Use Readest's non-modal panels above the bottom bar so the page stays visible while sliders change; avoid full-screen sheets.
   - Groups as in Libby: Text Scale (with an "accessibility sizes" extension), Lighting (Bright/Sepia/Dark, following the system by default), Book Design presets ("Publisher's Default", plus 3–4 named presets, plus "Custom").
   - Yomu's "save as default for this book" and "for all books".
   - Swipe-to-dismiss with velocity > 0.5 or more than 50% travel, an exit of 0.15/v s, a 0.3 s spring back and a light haptic (Native).
10. **Progress text** — Web. Use "12 min left in chapter" and "3 pages left in chapter" (Readest copy), computed from a rolling reading speed. Tapping it cycles formats (Libby and the 2018 FAQ).
11. **End of book** — Web. Do not add an in-reader interstitial. Like Libby's ≥95% "Finished?", show a quiet "Mark as finished?" suggestion in the library and on the reader's last page once progress reaches 95% or more. Pager has no loans, so the wording can be simpler.
12. **Opening transition** — Web if there is one webview. Libby's cover "emergence" is a shared-element zoom from the library cover rect into the reader: measure with `getBoundingClientRect` and animate with FLIP or the View Transitions API. If Pager ever hosts the reader in a separate WKWebView, as Libby does, the transition and the 100 ms delayed conceal must be coordinated natively.
13. **Native-feel CSS hygiene** (from Libby's shell) — Web:
    - `-webkit-tap-highlight-color: transparent`
    - `-webkit-touch-callout: none` on chrome, but not on text if native selection is used
    - `-webkit-text-size-adjust: none`
    - `viewport-fit=cover` with safe-area insets
    - the `-apple-system` font for UI chrome
    - iOS-style activity spinner
    - haptic coalescing

### Gaps
- Real Libby and Kobo reader timings are unknown, because both are closed source and Libby's reader bundle needs a loan. Pager should take numeric defaults from Readest and foliate-js and tune them on a device.
- Whether WKWebView exposes `prefers-reduced-motion` and Dynamic Type exactly as Safari does was not verified in this research.
