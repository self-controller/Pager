# Earn the reader's trust before adding features

Pager's reader is already stronger than its feature list suggests. It saves a block-anchored place that survived every resize and font change in testing, routes every touch through one arbiter, opens footnotes in place with a back pill, and learns the reader's speed. Those are exactly the areas where Kobo, Apple Books, Kindle and Readest collect their angriest reviews. The highest-return work is therefore not new features. It is closing a short list of trust gaps that undercut those strengths:

- **four observed bugs**: a wrong text-size label, a Scroll font change that hides the settings it came from, a reader percentage that disagrees with the library's, and a trackpad flick that turns several pages;
- a **last-write-wins sync** in which a stale desktop tab can overwrite the phone's newer place;
- **Pages chapter crossings that cut** instead of slide;
- **about 112 px of blank page** on phones;
- **typography limited to size, face and theme**, even though Pager's shared settings format already defines line spacing, margins, justification and hyphenation.

Readers leave apps after an accumulation of small betrayals: losing their place, controls that a redesign hid, margins they cannot fix. They stay for reliable position.

After that come the tools heavy readers treat as table stakes, which Pager lacks: in-book search, a bookmark UI, a dictionary, an end-of-book state, a scrubber with go-to, highlights that cross a page break, image zoom and offline reading. Reading research argues for choice over dogma. A reader's fastest font is individual and worth about 35% in speed. Line length and spacing barely matter within normal ranges. Bionic Reading does not work. AI comes last, and narrowly. Five vendors converged on a short "previously…" recap limited to the reader's position, and on spoiler-safe "who is this?" lookups. Both need a furthest-read position and a text index that Pager does not have yet. One step comes before all of this: the whole Scroll layout, the gesture arbiter and the footnote work exist only as uncommitted files.

## Pager already does the hard parts well, and four bugs undercut them

The codebase audit compared Pager's reader in the 29 October 2026 working tree with the best open-source and commercial readers. Pager is at parity or ahead in the places that are hardest to get right:

- **Saved place.** It is a block id plus a character offset, written at placement, after each 1 s rest, and on `pagehide` and `visibilitychange`. It is restored in a fixed order: URL target, back-pill point, requested page, saved point, saved offset ([useReadingProgress.ts](../src/components/reader/useReadingProgress.ts)). In a headless Chromium run, Scroll kept the same paragraph at the top through 1440×900 → 800×800 → 1440×900. Pages went from "p. 1 of 10" to "p. 1 of 15" with the same first paragraph.
- **Touch.** Every touch goes through one arbiter that uses Readest's thresholds. A tap is a release within **15 px**. A 500 ms hold does nothing. Taps within 150 ms of a scroll are ignored. Links and highlights win over turn zones ([gestures.ts](../src/components/reader/gestures.ts)).
- **Footnotes.** They open in a popover up to 460 px wide and 60vh tall, and the note is looked up in other sections if needed ([FootnotePopover.tsx](../src/components/reader/FootnotePopover.tsx)).
- **Back pill.** A two-state pill appears after any non-linear jump and retires after three screens ([useJumpHistory.ts](../src/components/reader/useJumpHistory.ts)).
- **Reading speed.** The time-left footer learns words per minute as the median of the last 30 page dwells. It shows a "~238 wpm" estimate until five samples exist ([readingSpeed.ts](../src/components/reader/readingSpeed.ts)).
- **Highlights.** They paint through the CSS Custom Highlight API without wrapper elements. They store W3C-style quote selectors with an "orphaned" status ([annotation.ts](../shared/src/annotation.ts)), the same design Hypothesis uses for robust re-anchoring ([Hypothesis](https://web.hypothes.is/blog/fuzzy-anchoring/)).

| Area | Pager today | Best-in-class reference | Verdict |
|---|---|---|---|
| Saved place | Block id + character offset; same paragraph kept through resizes and font steps (observed) | foliate-js keeps a DOM Range anchor ([paginator.js](https://github.com/johnfactotum/foliate-js/blob/main/paginator.js)) | At parity; the sync rules lag |
| Touch arbitration | One arbiter, 15 px slop, long press inert, links beat zones ([gestures.ts](../src/components/reader/gestures.ts)) | Readest: 15 px slop, 500 ms hold ([constants.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/services/constants.ts)) | At parity |
| Jumps and footnotes | In-place popover, two-state back pill | Readest popups that support highlight, lookup and read-aloud ([Readest docs](https://readest.com/docs/reading)) | Near parity; no tools inside the popover |
| Progress | Tap-to-cycle footer with a learned speed | Kindle's cycling footer and learned speed | At parity, but two different percentages |
| Typography controls | Size (−3…+9), serif or sans, three themes ([settings.ts](../src/state/settings.ts)) | Font, size, line spacing, margins, justification and theme everywhere ([Readium prefs](https://github.com/readium/readium-css/blob/develop/docs/CSS12-user_prefs.md)) | Widest gap |
| Reading tools | No in-book search, bookmark UI, dictionary, TTS, stats UI, scrubber or end-of-book state | Readest and KOReader ship all of them ([KOReader guide](https://koreader.rocks/user_guide/)) | Missing |
| Offline | No service worker; "offline reading is stage 2" ([index.html](../index.html)) | Native apps read offline | Missing |

Four defects were observed in the run, at 390×844 touch and 1440×900 desktop.

1. **The text-size label is wrong on phones, and the smallest steps do nothing.** The label is computed as `19 + offset` px ([ReadingSettings.tsx:16](../src/components/reader/ReadingSettings.tsx)), but the phone base is 17 px with a 16 px floor ([tokens.css](../src/styles/tokens.css)). A phone therefore shows "19px" for 17 px text, and the two smallest steps change nothing ([screenshot](<../research_notes/Pager reader experience improvements/screenshots/phone_reading_settings_popover.png>)).
2. **In Scroll, one text-size step hides the settings popover.** The step reflows the chapter (scrollTop 2500 → 2598). The scroll-follows-chrome rule reads that move as a user scroll and hides the chrome, and the open settings popover goes with it. The second "Larger text" click then misses ([screenshot](<../research_notes/Pager reader experience improvements/screenshots/desktop_scroll_font_change_hides_chrome.png>)).
3. **The reader and the library show different percentages.** The reader computes `(sectionIndex + offset) / sectionCount`, which weights every chapter equally, for the top progress line, the footer and "time left in book" ([useReadingProgress.ts:137](../src/components/reader/useReadingProgress.ts)). The server stores a character-weighted `percent_at`, and the library shows that ([library.rs](../server/src/library/library.rs)). So the same book shows two numbers, and the book estimate skews whenever chapters differ in length.
4. **A trackpad flick turns several pages.** Twenty wheel events over about 320 ms moved Pages from p. 1 to p. 3. The wheel handler has only a 350 ms time throttle and no end-of-gesture detection ([PagedView.tsx:105-111](../src/components/reader/PagedView.tsx)).

Around these sit a dozen rough edges:

- **Pages wastes about 112 px on a phone.** With the chrome hidden, the page still spans only y 57→744 of 844, because the 56 px top bar and the 56 px tab bar leave blank bands ([screenshot](<../research_notes/Pager reader experience improvements/screenshots/phone_paged_chrome_hidden.png>)).
- **The Scroll chapter circles sit on top of words** while the chrome shows ([screenshot](<../research_notes/Pager reader experience improvements/screenshots/phone_scroll_after_chapter_drag.png>)).
- **The Scroll title page leaves a gap** of about 450 px before chapter 1.
- **On the desktop**, the 232 px app sidebar stays in the reader, and the 728 px column sits off-centre ([screenshot](<../research_notes/Pager reader experience improvements/screenshots/desktop_paged.png>)).
- **The end of a book** is the footer saying "The end" and nothing else.
- **The selection menu** offers only Highlight and Note. In mobile Safari it appears alongside iOS's own callout ([SelectionMenu.tsx](../src/components/reader/SelectionMenu.tsx)).
- **The Tools button** opens a panel that says "No tools yet" ([ToolPanel.tsx](../src/components/reader/ToolPanel.tsx)).
- **On phones, settings open as a 300 px dropdown** that covers the text.

One practical risk outweighs all of these. The working tree carries **69 changed files (+3,234/−647) on top of a single commit**. ScrollView, chapterTurn, gestures, usePressArbiter, BackPill, useJumpHistory, FootnotePopover, readingSpeed, `ios/` and `relay/` are untracked and have never been committed. A bad checkout would erase the best parts of the reader.

## Losing the reader's place is the complaint that ends relationships

Users describe lost position with more emotion than any other defect, and they treat reliable position as the feature that earns loyalty. Kobo's iOS reviews have the sharpest examples:

- "If you accept the pop up to sync to the last page read you can be assured you'll be shot back like two plus chapters".
- Another reviewer advises bookmarking "as often as possible. It will be the only way to jump back" ([Kobo, App Store](https://apps.apple.com/us/app/id301259483)).

Other apps draw the same complaint:

- **Apple Books, Scroll mode:** it "Skips ahead ~50 pages every time I open a book when vertical scrolling is enabled" ([Apple Books, App Store](https://apps.apple.com/us/app/id364709193)).
- **Kindle on iPad:** "text randomly shifts when turning pages" ([Kindle, App Store](https://apps.apple.com/us/app/id302584613)).
- **PocketBook:** a reviewer deleted the app after rotation lost both the place and the colour settings ([PocketBook, App Store](https://apps.apple.com/us/app/id805488884)).
- **Readest**, a WebView reader and so Pager's closest analogue, has a 2026 issue in which sync "will overwrite itself with old location" ([readest#4222](https://github.com/readest/readest/issues/4222)). Another user, who now bookmarks before putting the device down, writes that "reliable page sync is by far my number one use case" ([readest#5859](https://github.com/readest/readest/issues/5859)).

The raves are the mirror image. A Kindle reviewer calls cross-device position "a lifesaver for an avid reader" ([Kindle, App Store](https://apps.apple.com/us/app/id302584613)).

Pager's anchor model is right. Its sync rules are what fail it. The server rejects an older `updatedAt` with a 409, but only if the client sends one, and the web client never does ([library.rs](../server/src/library/library.rs); [useReadingProgress.ts](../src/components/reader/useReadingProgress.ts)). The result is last-write-wins. Three further gaps combine with it:

- the reader writes its place on open;
- a contents jump moves the saved place immediately;
- Pager has no "furthest read" position.

So a desktop tab left open for a week can turn one page and silently move the phone's place backward. An open reader also ignores `progress.updated` from the other device, and the audit found no re-check when the app returns from the background. Point-based restore has not been exercised end to end: the preview mode's mock HTML has no `[data-b]` blocks, so only code reading covers it.

The open-source readers have already debugged this problem.

- **KOReader.** Its sync plugin defaults to **prompting when the remote position is ahead and never syncing backward**. It ignores records from its own device and debounces automatic pushes to once per 25 s ([kosync main.lua](https://github.com/koreader/koreader/blob/master/plugins/kosync.koplugin/main.lua)).
- **Readest's sync design.** It pushes with a 3 s debounce, and pulls on open with retries at 1.5, 4 and 10 s. On Android it pulls again on resume, "before a suspended auto-push can send the old local position". A deep-link preview, such as a search hit, never pushes and never moves the view ([useProgressSync.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/hooks/useProgressSync.ts)).
- **Readest's sync bugs.** Each gives Pager a rule:
  - Saving *after* pushing caused a jump-back bug, so save first.
  - A 30 s throttle lost progress on quit, so flush on close ([note #6623](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/library-progress-lost-on-quit-6623.md)).
  - A conflict dialog that came back after every app switch, so remember resolved conflicts ([note #5527](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/kosync-conflict-reprompt-5527.md)).
- **foliate-js.** Its history **pushes on jumps and replaces on ordinary page turns**. Back therefore returns to where you were reading, and Forward returns to how far you got after the jump ([view.js](https://github.com/johnfactotum/foliate-js/blob/main/view.js)).
- **Kindle's furthest-page prompt.** It is the cautionary case: a MobileRead thread reports that it jumps "forward a bit, but very rarely to the furthest page read" ([MobileRead](https://www.mobileread.com/forums/showthread.php?p=3554994)), and re-readers once had to switch Whispersync off to reset it ([40tech](https://www.40tech.com/2011/01/04/how-to-reset-the-furthest-read-location-on-your-kindle/)).

For Pager, combining these sources gives one rule set.

- **Send `updatedAt`.** The server already enforces it.
- **Store two positions.** Keep a per-device "last" position and a book-level "furthest" position, both as block anchors.
- **On open and on resume, move forward only, and ask quietly.** If the remote position is newer *and* ahead, show a non-modal toast, for example "Continued from iPhone · ch. 7 — Stay at ch. 5". Never move backward automatically. Ignore records from this device, and remember resolved ones.
- **Leave "furthest" alone on jumps.** Deep links, search hits and contents jumps may update "last", but never move "furthest" backward.
- **Re-read rule.** Reopen at the start when a book was left at 98% or more, as Omnivore does ([Article.tsx](https://github.com/omnivore-app/omnivore/blob/main/packages/web/components/templates/article/Article.tsx)).
- **Wait for layout before sampling.** Ignore progress events until the restore jump and `document.fonts.ready` have both settled. Readwise's changelog records progress "set to 100%" on open ([Readwise changelog](https://docs.readwise.io/changelog)). That is the typical symptom of sampling before the layout settles.
- **One percentage.** Use the server's character-weighted percent in the reader as well.

The same furthest-read position later becomes the spoiler boundary for any AI feature, so this one data-model change pays off several times.

Tests are the other half of trust. About 191 test cases exist, but all of them are pure-logic or happy-dom tests. **None renders ScrollView, PagedView or ReaderPage in a real layout engine.** Readest's August 2026 drift bug shows what such tests catch. Rotating portrait → landscape → portrait moved back a page on every round trip, because the restore scroll fired the debounced listener, which then re-derived the anchor. The regression test resizes between 400×700 and 700×400 twice, waits out the 250 ms debounce each time, and expects the same page ([note #5808](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/resize-anchor-drift-5808.md)). Pager's Scroll font-change bug is probably the same class of fault. Its 100 ms "own move" window seems to let a restore scroll count as a user scroll ([useChapterScroll.ts](../src/components/reader/useChapterScroll.ts)); the audit did not verify this. A small Playwright suite would cover the behaviour users punish hardest. It should use the real `[data-b]` fixtures in `server/tests/fixtures` and run resize round trips, font steps, layout switches and reopen-in-Scroll.

## Touch, wheel and keys need one more arbitration pass

### Pages should slide across chapters and give the text its full height

Inside a chapter, Pages turns with the platform's own scroll-snap momentum. **Crossing into the next section is a router navigation and therefore a hard cut, whatever the page-turn setting** ([ReaderPage.tsx:192-195](../src/pages/ReaderPage.tsx)). A swipe from the last page glides for 300 ms, then jumps. Scroll got a real animated chapter turn; Pages did not. Scroll's three-pane track already renders the neighbouring sections, so the natural fix is to give Pages the same structure. Pre-paginate the next section eagerly and the previous one lazily, as Readest does with debounced backward preloading ([note #4112](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/issue-4112-scroll-anchoring.md)). Then slide into the neighbour's first or last page with the same curve as an in-chapter turn. Users notice when transitions stutter here. Readest's swipe dropped frames worst at section boundaries, because a background repaint ran every frame ([note #4785](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/pageturn-bg-replace-reflow-4785.md)). `requestAnimationFrame` in WKWebView is also capped at 60 Hz on ProMotion iPhones ([WebKit bug 294338](https://bugs.webkit.org/show_bug.cgi?id=294338)). The slide should therefore stay in native scrolling or CSS transforms, not JS-driven frames.

The 112 px of blank bands on a phone is the other Pages fix. DESIGN.md chose to keep the bars' space ("Transform and opacity only, so their space stays") to avoid reflow when the chrome toggles ([globals.css](../src/styles/globals.css)). That avoids one problem by creating a permanent one. Readers say explicitly that they would trade chrome for lines: "I'd rather have three extra lines of text" ([HN](https://news.ycombinator.com/item?id=37308859)). A Moon+ reviewer with 102 upvotes praises its "ability to maximize reading space" ([Moon+, Google Play](https://play.google.com/store/apps/details?id=com.flyersoft.moonreader)). The better design lays pages out once at the full safe-area height minus the footer, and lets the transient chrome *overlay* the top lines while it shows. Pagination then never changes when the chrome toggles. When the footer cycles to "off", it should give back its 44 px too. This is an inference from the user evidence. No source documents how Apple Books or Kindle size the page under their chrome.

Keep the page-turn setting as it is. Animation polarises readers. **Kindle ships "Page Turn Animation" off by default** ([MakeUseOf](https://www.makeuseof.com/kindle-page-turn-animation-setting/)). Apple restored the curl after its iOS 16 removal drew a backlash ([MacRumors](https://www.macrumors.com/2023/02/28/ios-16-4-apple-books-page-turning-animation)). A Play Books reviewer calls the turn animation "the deciding factor" in choosing an app (49 upvotes, [Play Books](https://play.google.com/store/apps/details?id=com.google.android.apps.books)). Pager's Slide, Fade and None choice, with a cut under reduced motion, already matches the consensus. A curl would need native snapshots, and it can wait.

### Desktop input needs a wheel model and a real keymap

A trackpad turns a swipe into a long stream of tiny wheel events plus an inertial tail. Readers that handle this well turn **exactly one page per gesture**. Readest sums the deltas, turns once at **30 px**, and then swallows the rest of the stream until the wheel has been **idle for 200 ms**. It follows the dominant axis so that cross-axis noise cannot turn the wrong way. Its source says this "mirrors what native readers (e.g. Apple Books) do" ([wheelGesture.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/utils/wheelGesture.ts)). calibre instead resets after 1 s idle, so one long flick turns several pages ([paged_mode.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/read_book/paged_mode.pyj)). That is exactly Pager's bug. Pager's own sideways chapter turn already uses the right idea: 80 px, then a 600 ms lock, then 200 ms of quiet ([chapterTurn.ts](../src/components/reader/chapterTurn.ts)). Applying it to Pages with a lighter 30 px threshold, while a notched mouse-wheel tick still counts as one page, closes the bug. In Scroll, calibre's **0.5 s pause** when wheel-scrolling past a file boundary is a cheap way to make a chapter end feel deliberate ([session.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/session.pyj)).

Pager handles arrows, Space, PageUp and PageDown, Home, End and Esc. It returns early on any Ctrl, Cmd or Alt modifier, so it has **no shortcut for contents, settings, text size, search, bookmarks or going back**. The desktop readers have converged on a keymap:

| Action | Suggested binding | Precedent |
|---|---|---|
| Back / forward through jumps (pairs with the back pill) | Alt+← / Alt+→ | Foliate, calibre ([help-overlay.ui](https://github.com/johnfactotum/foliate/blob/gtk4/src/ui/help-overlay.ui); [shortcuts.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/read_book/shortcuts.pyj)) |
| Search in book | `/` and Ctrl/Cmd+F | Foliate, calibre, Readest, Apple Books ([Apple](https://support.apple.com/guide/books/ibk0a716cf4-9a70-485b-9835-72e3c7ed6c29/mac)) |
| Go to page or percent | `;` or Ctrl+G | calibre |
| Previous / next chapter in Pages | Alt+↑ / Alt+↓ | Readest moves by section with Alt+arrows ([shortcuts.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/helpers/shortcuts.ts)) |
| Text size | Ctrl/Cmd + / − / 0, reader only | Readest, Foliate, Apple Books |
| Toggle bookmark | Ctrl/Cmd+B | Readest |
| Scroll and turn without arrows | j/k, h/l | Readest, Foliate |
| Shortcut help | `?` | Readest, Foliate |

Two engineering notes from Readest apply here. Users expected the zoom keys to change *text size*, and Readest had to rewire them after reports that they did nothing ([note #5694](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/zoom-shortcuts-reflowable-font-size-5694.md)). And when a selection exists, Shift+arrows must adjust the selection before any page-turn handler sees them ([note #4728](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/keyboard-selection-adjust-4728.md)). calibre shows a controls overlay on a book's first open, at most twice in total ([view.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/read_book/view.pyj)). That is a gentle way to make the keymap discoverable.

Several other desktop fixes are small:

- **Hide the app sidebar in the reader.**
- **Keep the Scroll chapter controls reachable with a mouse.** Today a click on the page does nothing in Scroll, and the ‹ › circles vanish when the chrome hides on wheel scroll.
- **Hide the cursor after 1 s without movement, never while text is selected.** foliate-js's auto-hider once blanked the cursor mid-drag ([note](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/cursor-autohide-blanked-during-selection.md)).
- **Add two-page spreads by width, not by device.** foliate-js uses min(2, ceil(width / 720 px)) columns and forces one column in portrait ([paginator.js](https://github.com/johnfactotum/foliate-js/blob/main/paginator.js)). calibre's auto mode is floor(width / 35em) ([paged_mode.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/read_book/paged_mode.pyj)). Turns and wheel ticks should then move by a whole spread. Losing landscape two-column reading was one of the things Marvin refugees missed ([MobileRead](https://www.mobileread.com/forums/showthread.php?t=353769)).

### Tap zones should bend to the hand, and selection must cross page breaks

Pager's Pages zones are symmetric: back 37.5%, chrome 25%, forward 37.5% ([gestures.ts](../src/components/reader/gestures.ts)). KOReader defaults to **forward on the right 75% and back on the left 25%**, which suits a right thumb. It also offers an "Invert page turn taps and swipes" option for left-handed readers ([defaults.lua](https://github.com/koreader/koreader/blob/master/defaults.lua); [page_turns.lua](https://github.com/koreader/koreader/blob/master/frontend/ui/elements/page_turns.lua)). Readers ask for control here. A Readest request reads "at least be able to go back/forward on both sides of the screen" ([readest#2464](https://github.com/readest/readest/issues/2464)). A Yomu reviewer complains of "no option to disable tap-to-turn-pages, which results in potentially a lot of unintentional page turning" ([Yomu, App Store](https://apps.apple.com/us/app/id562211012)). The same Readest thread warns that a 3×3 zone editor confuses people. Five named presets fit Pager better than a grid:

- Balanced, the current layout;
- Forward-heavy (25/75);
- Both sides forward;
- Left-handed;
- Swipe only.

Small targets near edges are where readers lose fights with the zones. Kobo users find footnote links "nearly impossible to interact with… the app swipes to a different page" ([Kobo, App Store](https://apps.apple.com/us/app/id301259483)). calibre probes **±5 px** around a tap to find a link ([touch.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/read_book/touch.pyj)). WCAG 2.5.8 asks for targets of at least **24×24 CSS px** ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)). Pager's links already win over the zones. Its superscript note references are tiny, though, so an invisible enlarged hit area or a ±5 px probe is the remaining fix.

**Highlights that cannot cross a page break are one of the most-upvoted complaints in the whole corpus.** A Play Books review with 984 upvotes demands the "ABILITY TO HIGHLIGHT ACROSS MULTIPLE PAGES" ([Play Books](https://play.google.com/store/apps/details?id=com.google.android.apps.books)). Kobo and Yomu reviewers say the same ([Kobo](https://apps.apple.com/us/app/id301259483); [Yomu](https://apps.apple.com/us/app/id562211012)). Pager's Pages layout blocks selection at the page edge by design ([DESIGN.md](../DESIGN.md)). There are two known fixes:

- **An edge dwell.** Readest turns the page when a selection drag rests at the edge. Its code review found four defects in that approach, including a finger resting in the margin turning the page, and RTL books turning backwards ([note #5888](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/cross-page-selection-edge-turn-5888.md)).
- **An explicit Extend.** KOReader's selection popup has **Select / Extend**: start on one page, turn, and tap the end point ([readerhighlight.lua](https://github.com/koreader/koreader/blob/master/frontend/apps/reader/modules/readerhighlight.lua)). This is simpler and has nothing to misfire. It is the better choice for Pager.

Readest's bug notes add a short checklist for the selection code:

- **Never call `preventDefault` on pointerdown over text.** Doing so silently broke tap-to-turn ([note](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/instant-highlight-tap-paginate.md)).
- **Show the selection menu only after the handles stop moving.** Otherwise it flashes on iOS ([note](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/ios-selection-toolbar-flash-defer.md)).
- **Clear pending turn state on `pointercancel`.**

Accidental input deserves its own guard. Kindle's October 2026 update brought pinch-to-resize, and at least seven reviews in three weeks complained. One reads: "Even when you're not intentionally pinching the screen, boom font size changes". Kindle's always-on auto-highlight drew complaints from fiction readers who "never want to highlight anything" ([Kindle, App Store](https://apps.apple.com/us/app/id302584613)). The earlier iOS research suggested copying Kobo's pinch gesture. This newer evidence says that if Pager adds pinch-to-resize or an instant highlight, it should be **opt-in and off by default**.

### Scroll readers want continuity and a free thumb

The vertical-scroll camp is vocal, and its main grievance is chapter boundaries. "The lack of a true infinite scroll really hurts the app… when I get to the end of the chapter, I'm flicked to the next one" (54 upvotes, [Moon+](https://play.google.com/store/apps/details?id=com.flyersoft.moonreader)). Readest's scroll mode "briefly freeze[s] when switching chapters" and jumps "too soon" if the last lines are unread ([readest#1745](https://github.com/readest/readest/issues/1745)). Pager's chapter-by-chapter Scroll layout was a deliberate choice in the YouVersion style. It never jumps early, but the end of a chapter is a wall that takes a sideways drag or a button to pass.

The evidence supports keeping that default while offering "Continuous across chapters" later. Scroll already mounts the neighbouring panes, so the remaining work is mechanical but subtle. Browser scroll anchoring is **suppressed at `scrollTop === 0`**, and Safari lacks `overflow-anchor` before Safari 27. Prepending the previous chapter therefore needs manual `scrollTop` compensation in the same frame ([note #4112](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/issue-4112-scroll-anchoring.md)). Content should also load about two viewports ahead ([note #4795](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/pdf-scroll-lag-preload-4795.md)).

Three smaller Scroll fixes follow from the audit:

- **Let the chapter circles stop covering text.** A Kobo reviewer complains that "the chapter marker literally sits over the content at the bottom" ([Kobo](https://apps.apple.com/us/app/id301259483)). YouVersion's web reader puts its 48 px buttons in a sticky container after the chapter text. They float while you read and come to rest at the chapter's end with no scroll-direction logic ([bible.com JS](https://www.bible.com/_next/static/chunks/2jxxevxe-azgb.js)).
- **Shrink the title-page gap.**
- **Mark where the previous screen ended.** Space and PageDown scroll a screen less 80 px. KOReader keeps a **30 px** overlap and offers to mark it with a grey band or a dashed line, so the eye finds its line ([defaults.lua](https://github.com/koreader/koreader/blob/master/defaults.lua); [readerview.lua](https://github.com/koreader/koreader/blob/master/frontend/apps/reader/modules/readerview.lua)).

One-handed phone reading is where auto-scroll earns its place. "I'm a fast reader and my poor thumb," writes a BookFusion reviewer ([BookFusion](https://apps.apple.com/us/app/id1141834096)). Marvin refugees name auto-scroll among the things they miss, and one reader switched to Readest partly for it ([readest#254](https://github.com/readest/readest/issues/254); [Readest, App Store](https://apps.apple.com/us/app/id6738622779)). Readest's July 2026 implementation is the best-specified model ([useAutoScroll.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/hooks/useAutoScroll.ts); [autoScrollSpeedGesture.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/utils/autoScrollSpeedGesture.ts)):

- **Speed:** **5–100 px/s in 5 px/s steps, default 20 px/s**.
- **Taps:** a tap pauses and resumes instead of turning a page.
- **Speed gesture:** a right-edge strip of 10% adjusts the speed while it runs.
- **Chapters:** it moves to the next section after an 800 ms stall.

WCAG 2.2.2 requires a way to pause, stop or hide anything that moves on its own for more than 5 s ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)). Volume-button page turns, the other one-handed staple, are off-limits on iOS. App Review guideline 2.5.9 rejects apps that alter the volume buttons ([Apple Developer Forums](https://developer.apple.com/forums/thread/696271)). Zones and auto-scroll are therefore the whole one-handed toolkit.

## Typography is the widest gap between Pager and a book reader

### Research rewards choice over any single optimal layout

The robust findings are few, and they point toward personal choice:

- **Font choice is the biggest measured lever, and it is personal.** Wallace et al. (ACM TOCHI 2022) had 352 people read in 16 size-normalised fonts on their own devices. Participants read **35% faster in their fastest font than their slowest (314 vs 232 WPM)**, with no loss of comprehension. They read 14% faster in their fastest font than in the one they preferred. Preference predicted the fastest font only at chance, and "there was not a single font that increased reading speed for everyone" ([Wallace et al.](https://jeffhuang.com/papers/Readability_TOCHI22.pdf)).
- **Bigger text helps up to a point.** Rello, Pielot and Marcos (CHI 2016, 104 participants) found that readability and comprehension improved up to 18 pt. Line spacing between 0.8× and 1.4× had no significant effect on reading time ([researchr](https://researchr.org/publication/RelloPM16)). Legge and Bigelow describe a "critical print size" above which speed plateaus ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3428264)).
- **Line length matters less than its reputation.** Lines of 100 characters were read *faster* than 25-character lines, while 55 characters per line was rated easiest ([Dyson & Kipping](https://journals.uc.edu/index.php/vl/article/view/5671)). Practitioners recommend 45–90 characters ([Butterick](https://practicaltypography.com/line-length.html)).
- **Light mode is the better default in lit rooms.** Dark text on light backgrounds is slightly more legible in most lighting. White-on-black in dark surroundings needed the longest exposure in a glance-reading study ([Dobres et al. 2017](https://pubmed.ncbi.nlm.nih.gov/28166901/)).
- **Pages may suit study better than scroll.** A 2022 Norwegian study found better integrated understanding when paging, while scrolling felt more pleasant ([Springer](https://link.springer.com/doi/10.1007/s11145-022-10328-9)).
- **Bionic Reading has no effect.** Snell (2024) found no difference in reading times ([PubMed](https://pubmed.ncbi.nlm.nih.gov/38723450/)). Readwise's test of 2,074 readers found it 2.6 WPM slower ([Readwise](https://blog.readwise.io/bionic-reading-results/)).
- **Dyslexia fonts do not help, but letter spacing does.** OpenDyslexic gave dyslexic students no gain in rate or accuracy, and none of them preferred it ([Wery & Diliberto](https://pmc.ncbi.nlm.nih.gov/articles/PMC5629233/)). Widening letter spacing by about 0.18 em **doubled reading accuracy** in dyslexic children ([Zorzi et al. 2012](https://pubmed.ncbi.nlm.nih.gov/22665803/)).

These findings support a clear position. Offer several good, size-normalised faces and let the reader find their own. Expose line spacing and margins mainly for comfort, not for speed. Add letter spacing as an accessibility setting. Never ship Bionic Reading. Offer OpenDyslexic only as an opt-in.

### Pager's type reads like a web article, though the fix is already specified

Pager's body type uses web-article conventions, not book typesetting ([prose.css](../src/styles/prose.css); [tokens.css](../src/styles/tokens.css)):

- **Face and size:** Spectral at 17 px on phones and 19 px on desktops.
- **Spacing:** a `1.6em` line height, and a fixed 20 px gap between block paragraphs.
- **Line breaking:** ragged right, with no hyphenation, no `text-wrap: pretty` and no indents.
- **Language:** no `lang` attribute on the reading root, although the API exposes the document's language.

The measure is about **43 characters per line on a phone, and 72–81 on the desktop**. The desktop figure is above the 66–75 that most guidance prefers, and the reader cannot narrow it except by raising the text size. Several sizes are fixed px and ignore the size setting: code at 13 px, footnote popovers at 14/21 px, and the paragraph gap.

The controls are thin: size, serif or sans, three themes, layout, page turn and footer format. Meanwhile the shared settings format already defines `lineHeight`, `measure`, `paragraphSpacing`, `paragraphIndent`, `justify`, `hyphenate`, `headingTypeface`, named `Preset`s, and global and per-document scopes. **None of it is implemented in the client**, and reading settings live only in each device's `localStorage` ([shared/src/settings.ts](../shared/src/settings.ts)). The gap is therefore unfinished design work rather than a decision against these controls, and most of the work is UI.

The market baseline is clear. Every mainstream reader exposes font, size, line spacing, margins, justification and theme. Apple Books adds character and word spacing and Bold Text behind a Customize switch ([Apple Support](https://support.apple.com/en-asia/guide/iphone/iphc1af7c57/ios)). The open-source defaults cluster tightly:

- **Foliate** uses a 1.5 line height, justification and hyphenation on, and a 720 px maximum line box ([gschema](https://github.com/johnfactotum/foliate/blob/gtk4/data/com.github.johnfactotum.Foliate.gschema.xml)).
- **Readest** uses a 1.4 line height and justifies on desktop but not on mobile ([constants.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/services/constants.ts)).
- **Readium** lets the user set size from 75% to 250% and line height from 1 to 2 ([Readium prefs](https://github.com/readium/readium-css/blob/develop/docs/CSS12-user_prefs.md)).

Readium's user survey adds two useful facts. Most users want the basic settings (theme, typeface, size) rather than many options, and **fewer than 15% keep the publisher's typeface** ([Readium insights](https://github.com/readium/readium-css/blob/develop/docs/CSS15-user_pref_insights.md)).

User complaints sharpen the brief:

- **Margins are the oldest grievance in iOS reading.** "Apple Books would easily be the best eBook app if it had smaller (or customizable) margins. It's been a common request for years. Maddening." ([HN](https://news.ycombinator.com/item?id=37308398)).
- **Settings should use reading words, not CSS words.** Readest users could not find margins because they are set through "column gap". As one put it, "that's implementation details that only you (mostly) know about" ([readest#5301](https://github.com/readest/readest/issues/5301)).
- **Settings must persist.** A Yomu reviewer gave one star after finding that their setup did not carry to the next book ([Yomu](https://apps.apple.com/us/app/id562211012)).

The settings Pager should build follow from all this:

- **A Core group:** theme, font, size and layout.
- **An Advanced group:**
  - line spacing from 1.2 to 2.0;
  - "Margins" as Narrow, Medium and Wide, mapped to roughly 75, 66 and 55 characters per line;
  - justification, which also turns hyphenation on, because Readium calls hyphenation "critical" with justified text ([Readium recs](https://github.com/readium/readium-css/blob/develop/docs/CSS14-user_settings_recs.md));
  - paragraph style, indent or spacing;
  - Bold text;
  - letter and word spacing up to the WCAG 1.4.12 test values ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html)).
- **Better defaults:**
  - a unitless `line-height: 1.5`, so captions and headings stop inheriting a fixed pixel leading;
  - `em`-based paragraph spacing;
  - a desktop measure capped near 34em;
  - `lang` set from the document;
  - `hyphens: auto`;
  - `text-wrap: pretty` on paragraphs and `balance` on headings.
- **A size floor below 16 px.** Apple Books draws complaints that its minimum is "way too big" ([Apple Books](https://apps.apple.com/us/app/id364709193)).

The settings surface also needs reshaping. It should become a non-modal bottom sheet over the live text instead of a dropdown. Readest's panels float above the bottom edge and dismiss on a swipe faster than 0.5 or past 50% of their travel ([MobileFooterBar.tsx](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/components/footerbar/MobileFooterBar.tsx); [useSwipeToDismiss.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/hooks/useSwipeToDismiss.ts)). The sheet needs a scope control that is *visible on touch*, "This book / All books". Readest's tooltip-only scope labels never appeared on phones ([note #5933](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/settings-scope-menu-5933.md)). It also needs named presets, along the lines of calibre's profiles ([shortcuts.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/read_book/shortcuts.pyj)). Finally, settings should sync through the server, which already models them. Phone and desktop should keep their own size overrides, because a phone at arm's length and a monitor legitimately differ.

### WebKit decides what pagination CSS can do on the iPhone

Three engine facts shape the Pages layout on iOS.

- **`break-after: avoid` and `break-before: avoid` have no effect in Safari or Firefox.** The value is recognised but does nothing ([MDN BCD](https://github.com/mdn/browser-compat-data/blob/main/css/properties/break-after.json)). Pager's heading rule ([prose.css:245](../src/styles/prose.css)) therefore does nothing on the iPhone, and headings can be stranded at the bottom of a page. The robust fix is a post-layout pass. After pagination, it finds any heading whose following line lands in a later column, or that sits within about two lines of the column bottom, and gives that heading `break-before: column`. It reruns on resize and font change.
- **`widows` and `orphans` default to `auto` in WebKit**, which means no protection, so they must be set explicitly ([WebKit commit](https://webkit.googlesource.com/WebKit/+/fde5fdff14172235df40afcc08efec060e77eccb)). Pager already sets them to 2, which is the right value. Raising them to 3 would make phone page bottoms visibly ragged.
- **`text-wrap: pretty` needs Safari 26 or later.** WebKit's version weighs every line of the paragraph, where Chromium's adjusts only the last four ([WebKit blog](https://webkit.org/blog/16547/better-typography-with-text-wrap-pretty/)). On Pager's iOS 17.5 floor it degrades harmlessly.

Several cheaper fixes follow:

- **Size the column to whole lines.** Make the column height an exact multiple of the line height, and trim the first block's leading with `text-box-trim` (Safari 18.2+) ([MDN BCD](https://github.com/mdn/browser-compat-data/blob/main/css/properties/text-box-trim.json)). This stops the clipped last line that Kobo users notice as "the last few words at the end of a chapter would drop off" ([Kobo](https://apps.apple.com/us/app/kobo-books/id301259483)).
- **Let wide tables scroll.** Wrap them in an `overflow-x: auto` box. Only rows, never a whole table, should be kept from breaking.
- **Start chapters on a fresh page.** Give the chapter `h1` `break-before: column`.
- **Offer drop caps only as an option.** `initial-letter` works in Safari behind the `-webkit-` prefix ([MDN BCD](https://github.com/mdn/browser-compat-data/blob/main/css/properties/initial-letter.json)), but Readium's accessibility baseline lists removing drop caps as a user need ([Readium a11y](https://github.com/readium/readium-css/blob/develop/docs/CSS13-a11y_settings_baseline.md)).

### More faces, dimmer nights, and one decision about sepia

Given the Wallace result, a single bundled serif is the most consequential typographic limit. A menu of four to six faces fits the evidence and the requests. All should be bundled as WOFF2 so that the phone and the desktop match:

- **Literata**, a variable font with an optical-size axis, built from the Google Play Books face ([TypeTogether](https://type-together.com/literata-variable-release));
- **Source Serif 4** or **Charter**;
- **EB Garamond** or **Crimson Pro**;
- the slab **Bitter**;
- **Atkinson Hyperlegible** for sans;
- **OpenDyslexic**, opt-in.

Readers name several of these when they ask for fonts ([Readium insights](https://github.com/readium/readium-css/blob/develop/docs/CSS15-user_pref_insights.md)). Apply `font-size-adjust` (Safari 16.4+) so that switching faces does not change the apparent size, as Wallace's normalisation required ([MDN BCD](https://github.com/mdn/browser-compat-data/blob/main/css/properties/font-size-adjust.json)). Spectral's small x-height at 17 px is a reason to test Literata as the default. That is typographic judgement, though, not a study result.

Pager's palette is sound. Its dark theme (#E5E5E5 on #121212, 14.9:1) sits within Material's guidance against pure white on dark ([Material](https://m2.material.io/design/color/dark-theme)). Two problems remain:

- **The night options are thin.** Night readers ask for exactly what Pager lacks: a true-black OLED background and quieter text. "What's the point of having an OLED screen if you can't set the background black," writes a BookFusion reviewer who sets orange text at night ([BookFusion](https://apps.apple.com/us/app/id1141834096)). On r/ereader, readers want "a dark grey background with off-white text" ([Reddit](https://reddit.com/r/ereader/comments/1mg799q/where_is_the_perfect_dark_mode/)). A **Dim** variant (about #BDBDBD on #121212, 10:1) and an **OLED** variant (#000 with about #C8C8C8 text) fit Pager's black-and-white identity.
- **Images are not dimmed in dark mode.** An opt-in `brightness(.85)` filter fixes that ([Readium recs](https://github.com/readium/readium-css/blob/develop/docs/CSS14-user_settings_recs.md)).

A sepia theme is standard elsewhere: Kindle ([Amazon](https://digprjsurvey.amazon.com/csad/help/node/TABlJ4ot69emTO8jJG)), Apple Books, Readwise, and Pocket's #F4ECD8 / #5B4636 at 7.5:1 ([Mozilla bug 1158281](https://bugzilla.mozilla.org/show_bug.cgi?id=1158281)). But DESIGN.md rules out "warm or sepia tints". That is a decision for the user, not the evidence.

The white flash is a real night complaint. "If you use it at night in a darkened room you get blinded by the entire tablet flashing white for a couple seconds," says one Kobo reviewer, and three others report the same ([Kobo](https://apps.apple.com/us/app/id301259483)). Pager's iOS subclass already syncs the web view's `backgroundColor` and `underPageBackgroundColor` to the theme ([PagerWebView.swift](../ios/Sources/Pager/PagerWebView.swift)). The app has never been compiled, so a device check should confirm that every surface paints dark from the first frame: the loading state, the title page, chapter transitions and the tab bar.

### Publisher styling is stripped wholesale

Pager's sanitiser removes every `<style>` element and `style=` attribute; only server classes such as `.align-center` survive ([sanitize.ts](../src/lib/sanitize.ts)). That loses poetry indentation, small caps and centred epigraphs. Readers split on publisher styling:

- some readers complain that an app "ignores all original formatting by the book designer";
- others complain that an app "stomps on background colors" ([Yomu](https://apps.apple.com/us/app/id562211012));
- one called Readest "the ONLY reading app I've ever used that seems to render books the way they're intended to be experienced by their publishers" ([Readest](https://apps.apple.com/us/app/id6738622779)).

Readium's rule settles the order: user styles beat author styles, which beat the reader's own. Explicit alignment, per-element fonts, math and SVG count as authorial intent. A `font-family` on `body` or `p` does not ([Readium recs](https://github.com/readium/readium-css/blob/develop/docs/CSS14-user_settings_recs.md)). Pager should translate a safe subset of publisher CSS into classes on the server, add a "Publisher styles" switch, and let the user's font, size and spacing always win on body copy. Before any of that, it should test a handful of real EPUBs (verse, drama, a technical book). The audit could not, because the preview mode serves only TXT and Markdown.

## A dozen expected tools are missing, led by search and bookmarks

The research team counted keywords across 3,065 App Store and 4,307 Google Play reviews posted since 2023, pulled from the stores' public review feeds. The counts give a rough map of what readers talk about. Leaving aside ads, which a personal app cannot commit, **highlights and notes** lead (196 App Store and 336 Play mentions). **Sync**, **performance**, **TTS**, **typography** and **scroll** follow, then progress indicators, dictionary and lost place. These are keyword matches, not a survey. Combined with GitHub upvotes, they rank the reading-view requests roughly as follows:

1. reliable sync;
2. highlights across pages, with colours, undo and export;
3. continuous scroll across chapters;
4. configurable tap zones;
5. footnote popups with a way back;
6. an offline inline dictionary;
7. statistics;
8. a ruler and auto-scroll;
9. TTS that turns pages, with a sleep timer;
10. a clock in the chrome.

Pager has already shipped the fifth and parts of the second.

**In-book search** is the clearest gap with the cheapest path. The Rust server already runs full-text search for the library (`GET /search/documents`), so a per-document scope is mostly plumbing. Readest sets the bar:

- results grouped by chapter, each with an excerpt;
- a whole-book or this-chapter switch;
- toggles for case and diacritics;
- a jump that briefly flashes its target ([Readest docs](https://readest.com/docs/reading)).

KOReader adds a "search for more occurrences" action on a selection ([KOReader guide](https://koreader.rocks/user_guide/)). Every search jump should go through Pager's existing jump history, so the back pill returns the reader to where they were. A reader who cannot trust the way back does what Kobo reviewers advise: bookmark before every jump.

**Bookmarks already exist in the data model.** The annotation kind `bookmark` is defined, but nothing creates one ([annotation.ts](../shared/src/annotation.ts)). The safe entry points are:

- a **top-right corner tap**, KOReader's default (1/8 × 1/8 of the screen) ([gestures defaults](https://github.com/koreader/koreader/blob/master/plugins/gestures.koplugin/defaults.lua));
- **Ctrl/Cmd+B** on the desktop;
- later, Readest's **pull-down gesture**: it engages at 18 px, follows 1:1 to 120 px and triggers at 100 px ([bookmarkPullGesture.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/utils/bookmarkPullGesture.ts)), and it must be suppressed during a selection ([note](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/bookmark-pull-fixed-layout-5142.md)).

Avoid whole-edge taps and double-taps. About 75% of one critic's Apple Books bookmarks were accidental under such a gesture ([BasicAppleGuy](https://basicappleguy.com/basicappleblog/build-a-better-books)).

**A dictionary** splits by platform. Readers want "a popup with the meaning" rather than another app (81 upvotes, [Librera](https://play.google.com/store/apps/details?id=com.foobnix.pdf.reader)), and they want it offline ([Readwise Reader](https://apps.apple.com/us/app/id1567599761)).

- **On the iPhone:** a Define action over the native bridge can present `UIReferenceLibraryViewController`, which uses the dictionaries already installed and works offline ([ikyle.me](https://ikyle.me/blog/2025/show-ios-system-dictionary)).
- **On the desktop:** the server can hold the English Wiktionary packaged as StarDict ([xxyzz/wiktionary_stardict](https://github.com/xxyzz/wiktionary_stardict)). The public Wiktionary REST definition endpoint is experimental, and Wikimedia has proposed deleting it ([Phabricator T123142](https://phabricator.wikimedia.org/T123142)).
- **Saving lookups:** each lookup can be stored with its sentence as an annotation, which gives Pager a Kindle-style Vocabulary Builder for almost nothing ([Dummies](https://www.dummies.com/article/technology/electronics/tablets-e-readers/kindles/how-to-use-vocabulary-builder-on-your-kindle-paperwhite-156833/)).

The selection menu should grow to hold all this:

- Highlight in the last colour, plus a recency-ordered colour row;
- Note, Copy, Define and Search in book;
- in mobile Safari, a bar docked at the bottom so it never collides with the system callout.

**Endings and returns** need a lifecycle, not a footer label. KOReader's end-of-document popup asks one configurable question ("You've reached the end of the document. What would you like to do?") and offers Mark as finished, Book status, Go to beginning and Open next file ([readerstatus.lua](https://github.com/koreader/koreader/blob/master/frontend/apps/reader/modules/readerstatus.lua)). Its status page adds a third state, **On hold** ([bookstatuswidget.lua](https://github.com/koreader/koreader/blob/master/frontend/ui/widget/bookstatuswidget.lua)). Apple dropped its end-of-book rating prompt for "Mark as Finished" in iOS 17 ([Apple Community](https://discussions.apple.com/thread/255651361)). Kindle's unskippable end screen misfires inside box sets ([iFixit](https://www.ifixit.com/Answers/View/805352/Why+does+the+%E2%80%9CBefore+You+Go%E2%80%9D+screen+pop+up+part+way+through+a+book)). Pager should show a quiet end card with:

- a "Finished on <date>" stamp that can be undone;
- the book's annotation count, linking to its notes;
- Go to beginning;
- Back to library.

It should never ask for a rating. The return trip deserves the same care. Storytel found that **63% of nightly sleep-timer users struggle the next morning to find where they fell asleep** ([Storytel](https://www.storytelgroup.com/en/storytels-new-ai-powered-recaps-let-users-pick-up-where-they-left-off/)). A non-AI "where was I" card fits a return after several days: the chapter title, the last highlight, and the closing lines of the previous screen. It is cheap, and it is the slot an AI recap can later fill.

**Navigation aids** come next:

- **A scrubber in KOReader's skim style:** ±1 and ±10 steps, chapter and bookmark jumps, contents ticks on the bar, and a ↺ that returns to where skimming began ([skimtowidget.lua](https://github.com/koreader/koreader/blob/master/frontend/ui/widget/skimtowidget.lua)). It should keep the page label mounted at the ends, which avoids the jitter loop Readest hit ([note #6646](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/progress-slider-jitter-6646.md)).
- **Go to page or percent.**
- **A better contents drawer:** it should open scrolled to the current chapter and show a "Current position" row inside it, as Readest's does ([note](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/toc-current-position-row.md)). It should also show chapter lengths and offer tabs for highlights and bookmarks.
- **Print page numbers.** These come from EPUB `page-list`, which Apple Books supports behind a toggle ([Apple asset guide](https://help.apple.com/itc/booksassetguide/en.lproj/itc0f175a5b9.html)). They give citable pages for non-fiction.

Progress readers disagree about the indicator itself, so Pager should keep its tap-to-cycle choice. Some readers want page numbers hidden ("Knowing how fast you're reading pages distracts"). Others are angry when they vanish ([Apple Books](https://apps.apple.com/us/app/id364709193)). Two rules from the complaints are firm:

- **The indicator must never change on a page-turn tap.** Kindle's did "every third page turn or so" ([Kindle](https://apps.apple.com/us/app/id302584613)).
- **Numbers must be honest: "One page turn, one number count"** ([readest#3271](https://github.com/readest/readest/issues/3271)).

**Images and tables** fail quietly on phones today. There is no zoom handler and no horizontal-scroll wrapper ([prose.css](../src/styles/prose.css)). Readers ask to "full screen the illustrations" ([Readest, Google Play](https://play.google.com/store/apps/details?id=com.bilingify.readest)) and for a gallery mode ([readest#662](https://github.com/readest/readest/issues/662)). Tap-to-zoom with a lightbox, plus a scroll wrapper for wide tables, is cheap.

**Offline reading** matters more for Pager than for most apps, because the iPhone app reads books served by the desktop. A web-reader skeptic put the objection plainly: "So you must be able to reach the server every time you are reading an ebook… And what if you don't have internet connectivity?" ([HN](https://news.ycombinator.com/item?id=37305421)). A service worker that caches the app shell, plus the current and recent books' sections on the phone, turns a sleeping laptop from an outage into a non-event. Pager has no service worker today ([index.html](../index.html)).

**Statistics** are a delight Pager is unusually close to. The server already records sessions ([sessions.rs](../server/src/sessions.rs)), but no UI shows them. Readers rave about KOReader's "bar charts for each week. Calendars for each month" ([The eBook Reader](https://blog.the-ebook-reader.com/2025/05/19/ebook-readers-lack-useful-reading-history-and-reading-stats/)). A ReadEra request for streaks and yearly analysis drew 202 upvotes ([ReadEra](https://play.google.com/store/apps/details?id=org.readera)). Four views would serve that demand:

- a per-book history (started, finished, time, sessions, speed);
- a calendar heatmap;
- a finished-books log;
- a reset for the learned reading speed, a function that exists but has no UI.

Streaks should stay **opt-in**. StoryGraph made its streak optional "so as not to stress out anybody not interested" ([StoryGraph](https://roadmap.thestorygraph.com/features/posts/daily-streak)). Kindle users lose streaks when sync lags ([Kindle, Google Play](https://play.google.com/store/apps/details?id=com.amazon.kindle)).

**Read-aloud** is heavily requested (62 of 387 Readest Play reviews). It must turn pages ("I'd love for the pages to turn along with the TTS"), keep working with the screen off, and offer a sleep timer ([Readest, Google Play](https://play.google.com/store/apps/details?id=com.bilingify.readest); [HN](https://news.ycombinator.com/item?id=37308241)). Web Speech is unreliable on iOS. `getVoices()` has missed voices since iOS 16, and some reports say it lists only the low-quality voices on iOS 18 ([WebKit bug 250665](https://bugs.webkit.org/show_bug.cgi?id=250665)). Even native speech has paused at screen lock ([Apple forums](https://developer.apple.com/forums/thread/849627)). The iPhone path is therefore native `AVSpeechSynthesizer` over the bridge, which reports word ranges for highlighting. Web Speech serves only as the desktop fallback. Readest's Listen feature is the reference design: sentence highlighting, auto-turn, 0.5–3× speed, and a sleep timer that can stop at the chapter's end ([Readest docs](https://readest.com/docs/listen)).

Three smaller features close the list:

- **A reading ruler or line focus**, requested at 163 upvotes ([ReadEra](https://play.google.com/store/apps/details?id=org.readera)) and praised when paired with auto-scroll ([Readest](https://play.google.com/store/apps/details?id=com.bilingify.readest)).
- **Export.** The notes found no highlight export in Pager. Markdown for Obsidian, JSON for backup, and a Kindle-clippings text file cover what readers ask for ([KOReader guide](https://koreader.rocks/user_guide/); [Yomu](https://apps.apple.com/us/app/id562211012)).
- **An Orphans list** that appears only when orphaned highlights exist. Hypothesis learned that hiding orphans makes annotations appear to vanish ([Hypothesis](https://web.hypothes.is/blog/showing-orphaned-annotations)).

**Accessibility** has two open items:

- **Follow the system text size.** A "Follow system text size" option can scale Pager's own size setting from the iOS Dynamic Type category through the bridge. A custom `@font-face` loses Dynamic Type scaling ([Use Your Loaf](https://useyourloaf.com/blog/using-dynamic-type-with-web-views/)).
- **Test VoiceOver in Pages.** Paginated CSS columns fight a screen reader's separate reading buffer ([Thorium docs](https://thorium.edrlab.org/en/docs/300_accessibility/)), and nobody has tested Pager's Pages layout with VoiceOver.

## AI belongs in the side panel, fenced at the furthest page read

Pager already has the hooks for AI and nothing behind them. `PagerTool` defines a `Panel` for the right-hand tool panel and `selectionActions` for the selection menu. A `TextSelection` carries a section id plus character offsets ([types.ts](../src/tools/types.ts)). The registry is empty ([registry.ts](../src/tools/registry.ts)). So the question is which tools earn a slot.

The market has answered that question unusually clearly. Five companies shipped or planned the same feature: a **"reorient me" recap limited to the reader's position**.

- Kindle has Recaps and Story So Far ([Gadget Hacks](https://apple.gadgethacks.com/news/kindle-app-for-ios-new-ai-features-ask-this-book-story-so-far-and-recaps-explained/)).
- Google Play Books has "Catch me up" across more than a million books ([Superpower Daily](https://superpowerdaily.com/posts/google-adds-gemini-book-insights-to-ios-and-expands-it-past-1-million-ebooks)).
- Storytel has recaps on resume and after the sleep timer ([Storytel](https://www.storytelgroup.com/en/storytels-new-ai-powered-recaps-let-users-pick-up-where-they-left-off/)).
- Readwise has a "Pick up where I left off" prompt ([Readwise](https://docs.readwise.io/reader/guides/ghostreader/default-prompts)).
- Kobo plans a recap of about 150 words built from recent pages *and the reader's highlights* ([Engadget](https://www.engadget.com/ai/ai-might-undermine-one-of-the-better-alternatives-to-the-kindle-123039955.html)).

Spoiler-safe lookup is the second convergent pattern. Kindle's X-Ray hides excerpts "beyond the furthest page you've read" until asked ([Voyage manual](https://www.manualslib.com/manual/960098/Amazon-Voyage.html?page=26)). Readwise has an "Internal x-ray". KOReader's assistant plugin builds an X-Ray "up to your progress" ([assistant.koplugin](https://github.com/omer-faruq/assistant.koplugin)).

Free-form Q&A is the contested feature, and its failures say how to build it.

- **Spoilers.** Amazon's Ask this Book first answered from the whole book. Then, "After complaints that the chatbot was providing spoilers, the application appears to be limited to text already read", and it often replies that it lacks the information ([Writer Beware](https://writerbeware.blog/2025/12/12/kindles-new-gen-ai-powered-ask-this-book-feature-raises-rights-concerns/)).
- **Accuracy.** A hands-on test at 64% of *And Then There Were None* found four deaths listed where there had been six, an answer that referred to later events, and different answers to the same question ([Rankin](https://meredithrankin.substack.com/p/amazon-kindles-ask-this-book-option)).
- **No sources.** Another tester found answers that never cite a chapter or a line ([Kindlepreneur](https://kindlepreneur.com/amazon-ask-this-book/)).
- **Immersion.** Critics argue that "a feature that pulls you away from reading" is not "staying immersed" ([Literary Hub](https://lithub.com/amazon-put-an-ai-book-explainer-into-kindle-so-you-can-be-even-more-easily-distracted-from-your-book/)).
- **Personality.** Fable's AI year-end summaries produced offensive remarks and forced changes ([The Star/NYT](https://www.thestar.com.my/tech/tech-news/2025/01/06/fable-a-book-app-makes-changes-after-offensive-ai-messages)).

Gemini Notebook now cites passages directly ([9to5Google](https://9to5google.com/2026/08/27/gemini-notebook-play-books/)). Readers will come to expect citations.

These lessons give Pager eight design rules.

1. **Invoked, never ambient.** AI lives in three places only: the selection menu, the side panel and the Assistant page. Nothing appears on the page unprompted.
2. **The furthest-read position is the spoiler boundary.** Retrieval filters text by it *before* ranking. The prompt also forbids outside knowledge of the plot, because position-limited retrieval alone does not stop spoilers for famous books.
3. **A visible scope switch** offers "Up to where I've read", the default, or "Whole book (spoilers)".
4. **Every claim carries a citation that jumps to its passage.** The jump goes through the back pill and the landing flash that Pager already has. Claude's citations return character locations ([Claude docs](https://platform.claude.com/docs/en/build-with-claude/citations)), and the server can map them back to the section-offset coordinates `TextSelection` already uses.
5. **Short, literal answers come first**, with interpretation offered separately.
6. **Cached artefacts.** Store generated recaps and X-Ray entries per book, section and prompt version, so the same question returns the same answer.
7. **Quiet labelling.** Mark AI output plainly, as Apple now does with "Summarized by Apple Intelligence" in italics ([Tom's Guide](https://www.tomsguide.com/ai/apple-intelligence/apple-intelligence-will-summarize-news-again-in-ios-26-after-false-headline-debacle)).
8. **Show what leaves the device.** Each action shows what it sends, as KOAssistant's badges do ([KOAssistant](https://newreleases.io/project/github/zeeyado/koassistant.koplugin/release/v0.17.0)), and one global switch hides every AI entry point.

The economics are trivial for one reader, using October 2026 prices ([Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing)). Retrieval Q&A over position-filtered paragraph chunks sends about 7k tokens per question. That is about **$0.001 per question on Claude Haiku 5.5** and about $0.018 on Sonnet 5.5. Rolling chapter summaries and entity extraction for a 100k-word book cost about **$0.02 with Haiku** and about $0.39 with Sonnet. These are the notes' arithmetic, not measurements. Apple's on-device model has a **4,096-token context** shared by instructions, input and output, so it fits only selection-sized tasks ([InfoQ](https://www.infoq.com/news/2026/03/apple-foundation-models-context)). The API key belongs on the Rust server, so book text goes from the user's own machine to the model provider with nothing in between.

The order follows from dependencies, not from appeal. Recaps and X-Ray need the furthest-read position (from the position work), a paragraph-chunk index in reader coordinates (an extension of the server's search index), and citation jumps (the existing back pill and flash). Until those exist, the right AI move is subtraction: **hide the Tools button until a tool is registered**.

## The order of work: trust, then type, then tools, then AI

The tiers below rank work by how much reader trust or daily comfort it buys per unit of effort, and by its dependencies. "Where" marks whether a change is web-only, needs the native iOS bridge, or needs the server. Effort is my rough estimate: S is under a day, M is a few days, L is a week or more.

### Tier 0: this week

| Change | Why | Where | Effort |
|---|---|---|---|
| Commit the working tree | The Scroll layout, gesture arbiter, back pill, footnotes and the iOS shell are untracked | git | S |
| Show the real text size; lower the floor | The label is wrong on phones, and the two smallest steps do nothing | web | S |
| Hold the chrome while settings are open and during relayouts | One size step in Scroll hides the popover the reader is using | web | S |
| One percentage everywhere (the server's, character-weighted) | The reader and the library disagree, and "time left in book" skews | web | S |
| Readest-style wheel model in Pages | One trackpad flick turns several pages | web | S |
| Hide the Tools button until a tool exists | A dead affordance in prime top-bar space | web | S |

### Tier 1: trust and feel

| Change | Why | Where | Effort |
|---|---|---|---|
| Position rules: send `updatedAt`; per-device last plus book furthest; forward-only, non-modal "Continued from…" toast; re-check on resume; ≥98% re-read | Lost place is the most emotional complaint; a stale tab can overwrite the phone today | web, server | M |
| Real-engine regression tests for position (resize and rotation round trips, font steps, layout switch, reopen) | No test renders a reader view today; drift bugs recur without them | test | M |
| Pages pages at full height with overlaid chrome; the footer's "off" reclaims its space | 112 px lost on phones; readers trade chrome for lines | web | M |
| Animated Pages section crossings with an eagerly pre-paginated next section | Inside a chapter it slides; at the boundary it cuts | web | M |
| Clean page edges: heading-stranding pass, line-grid column height, table scroll wrapper | `break-after: avoid` does nothing on the iPhone | web | M |
| Settings as a bottom sheet with Core and Advanced groups, built from the existing settings vocabulary, plus better defaults (unitless 1.5, `em` gaps, `lang`, hyphens, `text-wrap: pretty`, a desktop measure cap) | Typography is the widest gap; margins are readers' oldest grievance | web | L |
| Settings sync plus a visible "This book / All books" scope | Settings drift between phone and desktop; readers hate settings that do not stick | web, server | M |
| Offline cache on the phone (service worker plus recent sections) | The phone cannot read when the desktop sleeps | web | M |

### Tier 2: the tools readers expect

| Change | Why | Where | Effort |
|---|---|---|---|
| In-book search, grouped by chapter, with jumps through the back pill and a "Search for this" selection action | The biggest missing tool; the server search already exists | web, server | M |
| Bookmarks: corner tap, Ctrl/Cmd+B, a ribbon, a list tab | The data model exists; readers bookmark defensively | web | S |
| Define: the iOS system dictionary; offline Wiktionary on the server; saved lookups | A top request; it must be an inline popup that works offline | native, server | M |
| A fuller selection menu (Copy, Define, Search, colour row; bottom-docked in mobile Safari) | Today it offers only Highlight and Note | web | S |
| Cross-page highlights in Pages through Extend | One of the most-upvoted complaints across apps | web | M |
| Scrubber with ±1/±10, chapter ticks and ↺; go-to; contents drawer with current position and tabs | Random access for non-fiction; a "where am I" view | web | M |
| End card, Finished/On hold states, and a "where was I" card after days away | "The end" is all Pager shows; returning readers lose the thread | web, server | M |
| Image lightbox, dimmed images in dark mode, wide-table scrolling | Illustrations and tables fail quietly on phones | web | S |
| Desktop: hide the sidebar in the reader; keymap plus `?` overlay; cursor auto-hide; spreads in landscape | The desktop reader still looks like the app shell | web | M |
| Four to six size-normalised fonts, Bold text, and Dim and OLED themes | Font choice is the largest measured lever; night readers want true black | web | M |

### Tier 3: delights and depth

| Change | Why | Where | Effort |
|---|---|---|---|
| Reading statistics from the session log (history, heatmap, finished log); opt-in streaks; reading-speed reset | Loved in KOReader; the server already records sessions | web, server | M |
| Auto-scroll in Scroll and a timed auto-turn in Pages, with a visible pause | One-handed reading; volume keys are banned on iOS | web, native for the idle timer | M |
| Reading ruler or line focus, plus a Space-paging overlap marker | Requested at 163 upvotes; helps readers keep their line | web | S |
| Native read-aloud with sentence highlighting, auto-turn and a sleep timer | Heavy demand; Web Speech is unreliable on iOS | native, web | L |
| Export (Markdown, JSON, clippings), an Orphans list, quote cards | Notes are worth more outside the app | web, server | M |
| Tap-zone presets including Left-handed and Both sides forward | Requested; KOReader's 25/75 suits a right thumb | web | S |
| Status bar that follows the chrome, plus an optional footer clock | Apple Books hides the status bar while reading; readers ask for the time | native, web | S |
| A subset of publisher styles plus a switch, after testing real EPUBs | Verse, small caps and epigraphs are lost today | server, web | M |
| Print page numbers from `page-list` | Citable pages for non-fiction | server, web | M |
| Optional continuous scroll across chapters | The scroll camp's main grievance | web | L |
| Performance: `content-visibility` in neighbour panes; profile a real 120k-character section on a phone | Speed is why readers switch; never measured on a device | web | M |

### Tier 4: AI, once the foundations exist

| Change | Why | Where | Effort |
|---|---|---|---|
| "Previously in this book" recap of about 150 words on return | Five vendors converged on it | server | M |
| Spoiler-safe "Who or what is this?" with cited earlier mentions | X-Ray's proven pattern | server, web | M |
| Explain or simplify a passage | Cheap and useful; small context | server, web | S |
| Cited Q&A in the side panel, with a spoiler-scope switch | Valuable for non-fiction, but only with citations | server, web | L |

Some things should not be built:

- **Bionic Reading.** No effect on reading speed.
- **OpenDyslexic as a default.** No measured benefit.
- **A page curl.** Native cost, polarising value.
- **Pinch-to-resize or instant highlight switched on by default.**
- **Rating prompts, and streak notifications that guilt the reader.**
- **Volume-button page turns.** App Review 2.5.9 forbids them.
- **AI personas, character chat, automatic tagging, or any AI text on the page itself.**

Following the standing rule to ask before design choices, a few decisions belong to the user before agents build:

- **Sepia.** Add a sepia or "paper" theme, or keep the black-and-white identity and add only Dim and OLED variants?
- **Scroll chapters.** Should Scroll gain a continuous mode, or stay strictly chapter by chapter?
- **Default font.** Keep Spectral or test Literata?
- **Tap zones.** Should the default stay symmetric, or become forward-heavy?
- **AI.** Should book text go to a cloud model at all, and with which provider?

Every finding here was verified only in headless Chromium. The iPhone app has never been compiled, so the first device session should run the regression list before any new feature lands:

- selection handles;
- scroll-snap momentum;
- the 60 Hz frame cap;
- the edit menu on iOS 17;
- dark first paint.

## Conclusion

The striking thing about Pager's position is its cost curve. Most of the features readers ask for most are wiring jobs, not inventions, because the hard substrate already exists:

- server full-text search for in-book search;
- an annotation kind for bookmarks;
- a session log for statistics;
- a settings vocabulary with presets and scopes for typography and sync;
- quote selectors and orphan status for export and re-anchoring;
- a tool registry with selection actions for the dictionary and AI;
- a jump history with a landing flash for search hits and citations.

The priority list is therefore less a research agenda than an ordering of plumbing, and the order matters more than the items. One data-model change, a **book-level furthest-read position alongside a per-device last position**, is the keystone. It stops sync from regressing a reader's place, enables the re-read rule and an honest end-of-book state, powers "where was I", and becomes the spoiler boundary that makes AI recaps and X-Ray safe. Build it first, and five later features become cheap.

The evidence also changes what "polish" should mean for Pager. The readers who switch apps cite margins they could not fix, a tap that turned the page instead of following a footnote, and a place lost overnight. Nobody cites a missing flourish. The unknowns that remain are physical, not conceptual: how WKWebView handles selection near page edges, momentum under scroll snap, and the first dark frame on a real iPhone. An hour with a device and a fixed test script will retire more risk than any new feature, and it should come before the next build round.
