# Kindle for iOS: reading UI and micro-interactions teardown

Scope note: this describes the Kindle iOS reader as of late 2026, based only on public sources (articles, Amazon/KDP help pages, App Store notes, forums). I did not log in to Kindle Cloud Reader or download an app binary. **Public sources give no animation durations, tap-zone sizes or swipe thresholds.** Every question that asks for those numbers has them listed under Gaps. Older behaviors are dated. Where two sources disagree, both are given.

Dated timeline of reader-relevant changes (each item is sourced in the sections below):
- Feb 2013: four-color highlights and "Book End Actions".
- Jan 2014 (v4.1): tappable page footer that cycles through modes.
- Apr 2014: TOC moved to the left panel, plus X-Ray Smart Look-Up info cards.
- Jun 2016: Page Flip.
- Oct 2017: app-wide redesign.
- Feb 2020: the Aa menu became a Font / Layout / More panel.
- c. 2020: saved Themes.
- Apr 2021: "Update Page Using System Theme".
- 2023: "Learning reading speed" bug, fixed in 6.74.
- May 2025: "Get Book" button.
- Apr 2025: Recaps.
- Dec 2025: Ask this Book on iOS.
- Jun 2026: Story So Far in the three-dot menu and "ask" in the selection menu.
- Aug 2026: Page Turn Animation still under Aa > More.

---

## 1. Page turning: animations, tap zones, swipes, Continuous Scrolling

### Takeaway
Kindle iOS has one optional page-turn animation, "Page Turn Animation", which is off by default. It is a toggle at the bottom of Aa > More. Without it, pages change with an instant cut. Continuous Scrolling (Aa > Layout) is a separate vertical-scroll mode, and turning it on disables the animation toggle. Kindle has no menu of curl, slide and fade styles like Apple Books has. Public sources give no tap-zone geometry or swipe thresholds.

### Cited Findings
- **Path:** open a book > tap the center of the screen > tap **Aa** > **More** > toggle **Page Turn Animation**. The article (27 Aug 2026) is about the iOS/iPadOS app and says Android and iPad have it too. — [MakeUseOf, Aug 2026](https://www.makeuseof.com/kindle-page-turn-animation-setting/)
- An Amazon staff reply says it is "the last item in the menu", switched with a slider. — [Amazon forum](https://www.amazonforum.com/s/question/0D56Q0000DpIPv3SQG/page-turning-animation)
- **Look:** instead of an instant cut, the page moves like a physical page being turned. The author says pages "slide like you're flipping a real one" and describes a "curl". In iPadOS landscape two-page view, the animation splits along the center crease. There is no sound and no jerkiness. The author calls Kindle's approach simpler than Apple Books, which has four distinct effects. The article says nothing about whether the page follows the finger during a drag. — [MakeUseOf, Aug 2026](https://www.makeuseof.com/kindle-page-turn-animation-setting/)
  - Contradiction to note: the journalist uses both "slide" and "curl" for the same effect, so the exact visual is not settled by this source.
- The same article says the animation feels "slightly more instant" on new e-ink Kindles than in the app. — [MakeUseOf](https://www.makeuseof.com/kindle-page-turn-animation-setting/)
- **Personal documents** (Send-to-Kindle or sideloaded files) also animate when the setting is on, but the article reports that the Aa button and the toggle are missing for those files. — [MakeUseOf](https://www.makeuseof.com/kindle-page-turn-animation-setting/)
- **Missing option:** in Dec 2024, a user reported that the toggle was gone after moving to an iPad Pro on iPadOS 18.1.1. — [Amazon forum](https://www.amazonforum.com/s/question/0D56Q0000DpIPv3SQG/page-turning-animation)
- **Mutual exclusion:** with Continuous Scrolling on, the Page Turn Animation option disappears or is disabled. — [MakeUseOf](https://www.makeuseof.com/kindle-page-turn-animation-setting/)
  - One user saw the disabled-state copy "Turn off Continuous Scroll to enable setting". — [Apple Community](https://discussions.apple.com/thread/251718919)
- **Continuous Scrolling:**
  - Path: Aa > **Layout** > toggle **Continuous Scrolling**. Whole chapters become one long scrollable page instead of separate pages. — [Pocket-lint, Aug 2025](https://www.pocket-lint.com/kindle-app-secret-features/); [Amazon forum](https://www.amazonforum.com/s/question/0D54P00007FsMifSAF/how-do-i-scroll-instead-of-turn-pages-on-my-kindle-app)
  - Amazon's accessibility help describes it as moving "by scrolling vertically instead of swiping pages", toggled from the Aa menu, on Kindle for Android and iOS/macOS. I saw this text only as a search snippet; the page returned HTTP 503 when fetched. — [Amazon help: Accessible Reading Options](https://www.amazon.com/gp/help/customer/display.html?nodeId=TABlJ4ot69emTO8jJG)
  - Amazon promoted it as "Scroll continuously on Kindle for iPhone and iPad". — [Kindle on Facebook](https://www.facebook.com/kindle/videos/scroll-continuously-on-kindle-for-iphone-and-ipad/10156300939151558/)
  - Community report: Continuous Scrolling works only for KFX-format books. Sideloaded MOBI files don't get it. — [MobileRead](https://www.mobileread.com/forums/showthread.php?t=335927)
- **Turn gestures, historical:**
  - v4.1 release notes (Jan 2014): "Simply tap on either side of the screen or flick to turn pages." — [iClarified, Jan 2014](https://www.iclarified.com/37365/kindle-app-update-brings-flashcards-notebook-filters-page-footers-and-more)
  - iMore (updated Feb 2018): swipe from the left or right side of the screen to turn one page. Tap the screen to "call up the page tools". — [iMore](https://www.imore.com/how-customize-reading-options-kindle-app-ios)
- **Not on iOS:**
  - "Double Tap to Page Turn" (double-tap the side or back of the device) is e-reader only: 2024 Paperwhite and Colorsoft, firmware 5.18.1, Mar 2025. It only goes forward. — [How-To Geek via Yahoo, Mar 2025](https://tech.yahoo.com/articles/amazon-brings-back-page-turn-144719723.html)
  - On e-readers, Page Turn Animation needs a Paperwhite 11th gen or later. — [MakeUseOf](https://www.makeuseof.com/kindle-page-turn-animation-setting/)

### Inferences
- The default experience is an instant page swap. Animation is opt-in and buried as the last item of the last tab, which suggests Amazon treats it as a nostalgia option rather than the core feel.
- Because the toggle is explicitly blocked while Continuous Scrolling is on, the paginated and scroll modes are probably separate renderers, not one renderer with a style switch.
- The "split along the center crease" on iPad two-page view suggests a page-curl-style effect, like UIPageViewController's `.pageCurl` with a spine in the middle, rather than a flat slide. This is not confirmed.
- Footnote-return links near the left edge are misread as page turns (see section 5). This implies the edge tap zones are tall and get priority over link hit-testing near the edges.

### Gaps
- **Tap zones:** I found no public source for zone widths, for example whether left is about 1/3 of the width or a narrow edge strip. I also found no source on whether tapping the left zone goes back, or whether any setting changes the zones (such as left-handed mode).
- **Swipes:** no source gives the swipe distance or velocity threshold, the snap-back behavior when a swipe is released early, or whether the page follows the finger with the animation off.
- **Durations:** no source gives the animation duration or easing curve.
- Whether a fade or "none" option exists beyond the on/off toggle. Sources only describe on/off.
- Whether Continuous Scrolling shows chapter breaks, keeps the footer, or snaps.
- Whether the volume buttons can turn pages on iOS. Not found.
- The Justia patents "Animated page turning" (US 2012/0105464, US 9,911,221) showed up in search, but I did not confirm that they are Amazon's or that they describe the iOS app.

---

## 2. Chrome: what a tap reveals and how the bars behave

### Takeaway
A tap on the page reveals the reading chrome. The top area has **Aa** at the top right and a **three-dot menu** at the top right that now holds Story So Far and Ask this Book. The bottom area has a progress scrubber. Sources give no detail on the bars' animation (fade versus slide) or the status bar.

### Cited Findings
- **Where to tap — sources disagree:**
  - "Tap the center of the screen" to open the menus. — [MakeUseOf, Aug 2026](https://www.makeuseof.com/kindle-page-turn-animation-setting/); [Amazon forum](https://www.amazonforum.com/s/question/0D54P00007FsMifSAF/how-do-i-scroll-instead-of-turn-pages-on-my-kindle-app)
  - "Tap the top of the page to bring up menus". — [Pocket-lint, Aug 2025](https://www.pocket-lint.com/kindle-app-secret-features/)
- **Aa placement:** "Aa" is at the top right of the reading view. — [eBookFriendly, Mar 2020](https://ebookfriendly.com/amazon-kindle-ios-app-revamped-menu-february-2020/); [Pocket-lint](https://www.pocket-lint.com/kindle-app-secret-features/)
- **Three-dot menu:** in Jun 2026, "Story So Far" is opened from the three-dot menu at the top right while reading. Ask this Book is also in the in-book menu. — [Engadget, Jun 2026](https://www.engadget.com/2202142/kindle-app-features-ios-has-ereader-still-doesnt-have/)
- **Older layout (iMore, Feb 2018):**
  - An upper-left **Menu** icon offered Cover, Beginning and Location. Location opened a page-number field with a **Go** button.
  - A bookmark icon sat at the upper right.
  - A **My Notebook** icon sat at the bottom right. Its notebook had a Filter (Bookmarks), a trash icon and a star "favorite" icon.
  - The progress bar sat at the bottom: touch and hold, then drag to scrub.
  - Source: [iMore](https://www.imore.com/how-customize-reading-options-kindle-app-ios)
- **Older TOC placement:** in Apr 2014, the TOC moved to a "left panel navigation menu". — [iClarified, Apr 2014](https://www.iclarified.com/40135/amazon-updates-kindle-app-for-ios-with-table-of-contents-xray-smart-lookup-improvements)
- **Bottom bar back-dots:** the bottom navigation scrubber shows "one or two black dots, representing previously established locations". A dot can sit so close to the scrubber knob that it can't be seen or tapped. The poster was on Android but says the change shipped to both iOS and Android. — [KBoards](https://www.kboards.com/threads/question-about-going-back-in-kindle-for-android.196587/)
- **Cover thumbnail:** Amazon staff suggest tapping "the book cover thumbnail in the bottom navigation bar" to jump back to your place. The platform is unclear. — [Amazon India forum](https://in.amazonforum.com/s/question/0D56Q0000CqmyWESQY/returning-from-footnotes)
- **Clock:** a "clock visibility" toggle lives in Aa > More (Feb 2020). — [eBookFriendly](https://ebookfriendly.com/amazon-kindle-ios-app-revamped-menu-february-2020/)

### Inferences
- The clock toggle implies the reader hides the iOS status bar while reading and draws its own optional clock. This is inferred from the toggle's existence, not documented.
- Chrome has two layers: a lightweight overlay (Aa, three-dot menu, scrubber) and full-screen sheets (Notebook, TOC, Aa panel).

### Gaps
- Whether the bars fade or slide, how long that takes, and whether they auto-hide after a delay or on page turn.
- Whether the status bar is hidden, and whether it appears together with the chrome.
- The full current top-bar inventory (back/library button, title, search, bookmark, Aa, three-dot) and bottom-bar inventory (scrubber, "Page X of Y", percentage, chapter name). I found no current, fully documented source. A hands-on check is needed.
- Whether the bars change look in light versus dark themes, and whether the app adopted iOS 26 "Liquid Glass" materials. A search found nothing Kindle-specific.

---

## 3. Progress indicators, footer cycling, and Page Flip

### Takeaway
The bottom-left footer is a tap-to-cycle indicator. It cycles through page in book, time left in chapter, time left in book, location, and off. The time-left values come from a learned per-user reading speed. Page Flip (Jun 2016) is the "overview" navigator: it pins your current page, lets you browse pixel-accurate thumbnails, and lets you zoom out to a multi-page bird's-eye view.

### Cited Findings
- **v4.1 (Jan 2014):**
  - Readers could see page numbers or time left in book in the lower-left page footer.
  - Release-note copy: "Readers can switch between page #, time left in book or a blank footer by simply tapping on the text or empty area."
  - A setting turned the footer off.
  - Source: [iClarified, Jan 2014](https://www.iclarified.com/37365/kindle-app-update-brings-flashcards-notebook-filters-page-footers-and-more)
- **Current cycle order:** tap the indicator at the bottom left. Each tap shows the next mode: page in book → time left in chapter → time left in book → location → off. The same setting is reachable from More > Reading Progress. I saw this source only as a search snippet. — [Just Kindle Books](https://www.justkindlebooks.com/article_jkb/how-to-view-your-kindle-reading-progress/)
- **Kindle for Web:** Amazon's help lists Reading Progress options as time left in chapter, page in book, and/or time left in book. — [Amazon help: Customize Kindle for Web](https://www.amazon.com/gp/help/customer/display.html?nodeId=TT200NNkr2BE4Jnsy9)
- **Estimates:**
  - The App Store listing says time left is based on your reading speed. — [App Store listing](https://apps.apple.com/app/kindle/id302584613)
  - One guide says estimates come from how fast you flip pages and are "usually a little off". — [Just Kindle Books](https://www.justkindlebooks.com/article_jkb/how-to-view-your-kindle-reading-progress/)
- **Warm-up state:**
  - In early 2023, iOS users saw "Learning reading speed" in place of the estimate. Amazon staff said version 6.74 fixed it.
  - Users said the `;ReadingTimeReset` search command didn't reset it.
  - Source: [Amazon forum](https://www.amazonforum.com/s/question/0D54P00008CSz7ESAT/recalculate-or-reset-time-left-in-chapter-ios-app)
- **E-reader backlash, Aug 2024 (firmware 5.16.10; e-reader, not the app):**
  - The indicator got smaller and now follows the book's margins instead of sitting in the corner.
  - Users complained it was hard to read and that cycling lagged behind taps ("clicks repeatedly").
  - Users said you must tap a precise spot, and that they trigger it by accident.
  - One user liked the minimal, margin-aligned symmetry.
  - Source: [The eBook Reader blog, Aug 2024](https://blog.the-ebook-reader.com/2024/08/09/last-kindle-update-changed-reading-progress-indicator-and-some-hate-it/)
- **Page Flip announcement (28 Jun 2016):** Amazon called it a "reimagined navigation experience" on e-readers, Fire, and the iPhone and Android apps. — [TechCrunch, Jun 2016](https://techcrunch.com/2016/06/28/amazon-introduces-page-flip-for-kindle/)
  - Your current page is **pinned to the side of the screen**. You flip elsewhere, then tap the pinned page to return.
  - You can **zoom out to a bird's-eye view** to find a picture, map or passage.
  - Thumbnails are "pixel-accurate" and follow your font and margin settings.
  - The idea came from watching how people use print books (attributed to Kindle VP Chuck Moore).
- **Page Flip in KDP docs:**
  - KDP describes a "bird's eye view of your book while always saving their place".
  - A screenshot caption reads: "With Page Flip, readers can view multiple pages at once to better locate a chart or image."
  - Amazon turns it on automatically for compatible titles. The product page shows "Page Flip: Enabled".
  - Source: [KDP help](https://kdp.amazon.com/en_US/help/topic/GNY87A6WM6EK6YEE)
- **Page Flip limits:** not available for fixed-layout books, Send-to-Kindle PDFs, or older MOBI files. — [MakeUseOf, Aug 2026](https://www.makeuseof.com/kindle-page-turn-animation-setting/)
- **Scrubbing (2018):** touch and hold the bottom progress bar, then drag left or right. — [iMore](https://www.imore.com/how-customize-reading-options-kindle-app-ios)

### Inferences
- The footer cycle is a single tap target with five states, and the choice persists. It is very cheap to build, and readers notice it a lot.
- A "learning" placeholder is needed before enough page turns are timed. Kindle's literal copy for that state was "Learning reading speed".
- The 2024 e-reader complaints give design rules: keep the indicator legible (not tiny), make cycling respond instantly, and give it a hit area larger than the text.
- Page Flip thumbnails reflect the current font and margins, so the thumbnails are real renders of the reflowed pages, not cached PDF-style images.

### Gaps
- The exact string formats, such as "Page 45 of 320", "12 min left in chapter", "Loc 1234", or a percentage. No current source quotes them verbatim.
- Whether the bottom-right corner has its own indicator. Older e-readers show a percentage there; I found no iOS source.
- Page Flip on iOS today: how you enter it (scrubber drag, button, or pinch), the thumbnail strip layout, the grid zoom levels, and the dismiss gesture. Sources describe only the concept.
- Whether the scrubber shows chapter tick marks, or a preview bubble with the page or chapter name while dragging.

---

## 4. End of chapter and end of book

### Takeaway
Kindle shows an end-of-book screen ("Before You Go" on e-readers; "Book End Actions" in the app since Feb 2013). It offers star rating, review, Goodreads status, author info, the next book in the series, and recommendations. It appears when you reach the end, or swipe past the last page, and users cannot turn it off. I found nothing about any special end-of-chapter behavior.

### Cited Findings
- **Feb 2013 iOS release notes:**
  - "Book End Actions – Just finish your book? Share the accomplishment with friends on Facebook and Twitter."
  - "Rate and write your own review. See other books that might interest you and add them to a wish list."
  - Source: [iClarified, Feb 2013](https://www.iclarified.com/27515/kindle-app-for-ios-gets-multicolor-highlights-book-end-actions-saved-brightness)
- **"Before you go…" on e-readers:** appears "when you reach the end of a book, or after you swipe past the final page". It offers a star rating, a Goodreads status update, author info, and buying the next book in a series. I saw this as a search snippet only. — [Good e-Reader Kindle Scribe guide](https://goodereader.com/blog/manuals/kindle-user-guides/kindle-scribe-user-guide-and-manual-2)
- **No off switch:** "there doesn't appear to be any kind of setting available to turn that off". — [iFixit Answers](https://www.ifixit.com/Answers/View/805352/Why+does+the+%E2%80%9CBefore+You+Go%E2%80%9D+screen+pop+up+part+way+through+a+book)
- **Early trigger:** it can fire too soon, for example at the end of each book inside a box set. — [KBoards](https://www.kboards.com/threads/rate-book-popup-appearing-in-random-places-on-kindle.244699/); [iFixit](https://www.ifixit.com/Answers/View/805352/Why+does+the+%E2%80%9CBefore+You+Go%E2%80%9D+screen+pop+up+part+way+through+a+book)
- **Trigger point:** Amazon uses an "end of book" marker that the publisher can set. KDP forum threads discuss it in the context of review requests. — [KDP Community](https://kdpcommunity.com/s/question/0D5f400000FHTWyCAP/request-for-review-at-end-of-book-kindle-edition?language=en_US); [Goodreads author blog](https://www.goodreads.com/author_blog_posts/2609429-kindle-s-before-you-go-feature)

### Inferences
- The trigger is a position (the end marker, or swiping past the last page), not "last byte of the file". This explains the box-set misfires and back-matter cases.
- For a store-less reader, the useful part is a calm "Finished" screen: completion state, a rating or note, and a way back to the library. The commerce part is Amazon-specific.

### Gaps
- The current iOS end screen: its exact title copy (whether "Before You Go" or something else), whether it is a full-screen sheet or a page, and its animation.
- Whether "About this book" appears at the start of a book on iOS.
- End of chapter: whether anything happens (for example a chapter-end indicator, or a "time left in chapter" reset cue). No source found.

---

## 5. Navigation memory: return-to-location and furthest-page sync

### Takeaway
Kindle keeps your place three ways:
- **Back-dots:** small dots on the bottom scrubber mark previous locations after a jump, and you tap a dot to return. Users find them hard to see and hit.
- **Page Flip pin:** your page stays pinned while you browse.
- **Furthest-page sync:** this is either a prompt when you open the book (behavior varies by version) or a manual "Sync to Furthest Page Read" menu item.

There is no dedicated Back button in current reports. That is a long-running complaint, especially after following footnotes.

### Cited Findings
- **Back-dots:** tap to show the chrome, then tap the black dot on the navigation scrubber that marks your previous location. A dot can hide behind the scrubber knob. — [KBoards](https://www.kboards.com/threads/question-about-going-back-in-kindle-for-android.196587/); [Amazon forum](https://www.amazonforum.com/s/question/0D54P00006zJOj6SAG/looking-for-back-button-to-return-from-footnote-to-main-text)
- **No back button:** an AppleVis (VoiceOver users) thread reports no back button for link jumps. The suggested workaround is to bookmark before following a link. — [AppleVis](https://applevis.com/forum/ios-ipados/kindle-app-navigation)
- **Older Back button:** an old iPad handout describes a Back button at the bottom that returned you after a jump such as an endnote. — [SlideShare iPad handout](https://www.slideshare.net/slideshow/ipad-handout/10255237)
- **Edge conflict:** on iPhone and iPad, a footnote's return link often sits near the left edge. Tapping it registers as a page turn or opens the menu. — [Straight Dope boards](https://boards.straightdope.com/t/kindle-footnotes-iphone-and-ipad/643734)
- **Sync, 2018:** Menu > **Sync** shows a message window with a **Yes** button that takes you to the furthest page read. iMore doesn't quote the message text. — [iMore](https://www.imore.com/how-customize-reading-options-kindle-app-ios)
- **Sync menu label:** "Sync to Furthest Page Read" in the options menu. This is a third-party guide. — [DocGenie](https://docgenie.co.uk/blog/sync-to-furthest-page-read-kindle)
- **Auto-prompt varies by version:** older Fire/Kindle tablets showed a prompt on open, while newer models needed a manual menu sync. A 9th-gen device prompted automatically and a 12th-gen one didn't. — [Amazon forum](https://www.amazonforum.com/s/question/0D56Q0000DAblMPSQZ/automatic-sync-to-last-page-read)
- **Re-reading problem:** opening a book you are re-reading can jump to the old furthest page from years ago. The fix is to clear "Furthest Page Read" in Manage Your Content and Devices. — [Amazon forum](https://www.amazonforum.com/s/question/0D54P00007K0dEhSAJ/sync-to-the-furthest-page-read-not-working); [How-To Geek](https://www.howtogeek.com/359117/how-to-clear-your-furthest-read-page-on-kindle/)
- **Page Flip pin** (see section 3): your place is pinned, and one tap brings you back. — [TechCrunch, 2016](https://techcrunch.com/2016/06/28/amazon-introduces-page-flip-for-kindle/)

### Inferences
- The dot design avoids extra chrome but fails on discoverability and hit-target size. A labeled pill such as "← Back to p. 42" next to the scrubber would fix both.
- Furthest-page and last-page-read are different values. A good design keeps both: "furthest" for progress, "last" for resume. It should prompt only when the remote position is ahead of the local one and newer.

### Gaps
- The exact copy of the current iOS sync prompt. I could not source the wording "You are on page X. The furthest page read is Y. Go to Y?" or the device and time attribution. Whether iOS shows it automatically on open in 2026 is also unconfirmed.
- Whether a TOC jump or a search-result jump creates a back-dot the same way a link does.
- How long a back-dot lasts (for example cleared on close, or after N page turns).

---

## 6. Text selection, highlighting and the selection menu

### Takeaway
Long-press selects a word. Drag handles extend the selection. A menu appears with a highlight color choice and Note, Look Up, Copy and Share. Since Dec 2025 (US), it also has an "ask" action. There are four highlight colors (yellow, blue, pink, orange), and the last one used becomes the default. Look Up shows dictionary, X-Ray and (historically) Wikipedia info cards without leaving the page.

### Cited Findings
- **Making a highlight:** press and hold a word, drag the handles to cover the passage, then tap a color in the menu that appears. The highlight syncs. — [clippings.io](https://www.clippings.io/how-to-highlight-on-kindle/)
- **Menu on an existing highlight:** tap the highlight and you get a color dot (press and hold it to change color), **Look Up**, **Note**, **Copy** and **Share**. This comes from third-party highlight guides surfaced in search, not from Amazon. — [clippings.io](https://www.clippings.io/how-to-highlight-on-kindle/); [Kindle Export](https://www.kindleexport.com/blog/how-to-highlight-on-kindle)
- **Colors:** yellow, blue, pink, orange in the phone, tablet and desktop apps. The last color you used is used for the next highlight. — [Kindle Export](https://www.kindleexport.com/blog/how-to-highlight-on-kindle); [Integrate](https://integrate.fyi/content/blog/kindle-highlights)
  - Release-note copy (Feb 2013): "Four color choices make it easier to distinguish important passages." — [iClarified, Feb 2013](https://www.iclarified.com/27515/kindle-app-for-ios-gets-multicolor-highlights-book-end-actions-saved-brightness)
  - Green was added on **Colorsoft e-readers** in Feb 2026 (5.19.2). I found nothing confirming it in the iOS app. — [Integrate](https://integrate.fyi/content/blog/kindle-highlights)
- **Ask action:**
  - Jun 2026: when you highlight a passage, an "ask" symbol appears alongside "highlight", "look up", "copy" and "note".
  - Tapping it shows suggested questions at the bottom of the screen, with a grey text field below for your own question.
  - Answers can cover only up to your current position, or the whole book.
  - "ask" only appears for eligible text, in the US only.
  - Source: [Engadget, Jun 2026](https://www.engadget.com/2202142/kindle-app-features-ios-has-ereader-still-doesnt-have/)
  - Answers can't be shared or copied. — [Gadget Hacks](https://apple.gadgethacks.com/news/kindle-app-for-ios-new-ai-features-ask-this-book-story-so-far-and-recaps-explained/)
  - Ask this Book reached the iOS app in Dec 2025. — [AlternativeTo, Dec 2025](https://alternativeto.net/news/2025/12/amazon-adds-ask-this-book-to-the-kindle-ios-app-for-interactive-and-spoiler-free-qanda); [Digital Trends](https://www.digitaltrends.com/phones/kindles-new-ask-this-book-feature-lets-readers-get-answers-without-leaving-the-page/)
- **Dictionary and X-Ray cards (Apr 2014):**
  - "Tap and hold a word to view the definition."
  - X-Ray Smart Look-Up: "Select a word or name and learn more about the concept, person, or place in the Info Card", with descriptions from Shelfari and Wikipedia.
  - Purchased dictionaries (medical, legal, translation) can be used.
  - Source: [iClarified, Apr 2014](https://www.iclarified.com/40135/amazon-updates-kindle-app-for-ios-with-table-of-contents-xray-smart-lookup-improvements)
- **Lookup features over time:**
  - 2010: a built-in dictionary of 250,000 entries.
  - v4.5 (2014): a "Smart Lookup" translation card plus copy and paste, as named in the headline.
  - Source: [iClarified search results](https://www.iclarified.com/44005/kindle-app-gets-updated-with-kindle-today-widget-copy-paste-smart-lookup-translation-card/comments)
- **Studying (2014):** Notebook filters by color, bookmarks and notes; flashcards. — [iClarified, Jan 2014](https://www.iclarified.com/37365/kindle-app-update-brings-flashcards-notebook-filters-page-footers-and-more); [MakeUseOf](https://www.makeuseof.com/tag/new-kindle-ios-features-make-serious-ereader-studying/)

### Inferences
- The menu is a single row of actions. Color is folded into one dot (press and hold for a palette), which keeps the menu short. This is a good model for a narrow phone popover.
- "Last color is sticky" means one tap highlights in the reader's current color scheme. A second color is a deliberate long-press.

### Gaps
- Whether Kindle iOS supports "instant highlight" by dragging without first long-pressing. No source found.
- How the dictionary card animates (for example a bottom sheet sliding up versus a popover) and whether it pages horizontally between Dictionary, Wikipedia and Translation. No current source found.
- Whether the selection menu is iOS's native edit menu or a custom view. No source found.
- The handle style, and the magnifier or loupe behavior.

---

## 7. Aa panel: Themes, Font, Layout, More; live preview and reflow

### Takeaway
Since Feb 2020, Aa opens one settings panel with tabs **Font** (the default), **Layout** and **More**, with brightness on every tab. Saved **Themes** (c. 2020) store font and layout combinations for one-tap switching and sync to e-readers. Page Color has four options plus "Update Page Using System Theme" (Apr 2021). Continuous Scrolling, Columns (iPad landscape), Reading Ruler and Page Turn Animation also live here.

### Cited Findings
- **Feb 2020 revamp:** three sections. — [eBookFriendly, Mar 2020](https://ebookfriendly.com/amazon-kindle-ios-app-revamped-menu-february-2020/)
  - **Font** opens by default. It has a slide bar for choosing the typeface and a font-size control with **14 marked levels**.
  - **Layout** has line spacing, alignment, orientation lock, and background color: White, Sepia, Green, Black.
  - **More** has Popular Highlights, clock visibility, the highlights menu, and page-turn animation. These moved there from the app's main menu.
  - **Brightness** appears in all three sections.
- **Themes:**
  - Themes save "preferred font and layout settings" and are switched "with a single tap" from Aa. Available on iOS, synced to e-readers. The article is undated, c. 2020. — [Good e-Reader](https://goodereader.com/blog/kindle/amazon-kindle-can-now-save-preferred-fonts-layout-settings)
  - The iPad app lets you create custom themes and reach them from Aa. — [eBookFriendly](https://ebookfriendly.com/kindle-app-ipad-custom-themes/)
- **System theme:**
  - The **"Update Page Using System Theme"** toggle sits under Aa > Layout, below Page Color. — [eBookFriendly](https://ebookfriendly.com/amazon-kindle-app-iphone-ipad-gets-automatic-theme-switcher/)
  - It arrived in Apr 2021. — [GeekUpdated](https://geekupdated.com/how-to-control-theme-colors-kindle-for-ipad-iphone/)
- **Page Color in 2025:** white, yellow (sepia), mint green, black, plus the system-theme toggle. — [Pocket-lint, Aug 2025](https://www.pocket-lint.com/kindle-app-secret-features/)
- **Columns:** Aa > Layout > Columns gives two columns in iPad landscape. — [MakeUseOf](https://www.makeuseof.com/kindle-settings-change-reading-experience/)
- **Reading Ruler:** Aa > More > Reading Ruler. Options are color, transparency, size and style: highlight the current line, or block out text you aren't reading. — [Pocket-lint](https://www.pocket-lint.com/kindle-app-secret-features/); [Amazon help: Enable Kindle Reading Ruler](https://www.amazon.com/gp/help/customer/display.html?nodeId=GLD8QTCF6CVEPT34)
- **Fonts:** Aa > Font lists faces including Baskerville and Caecilia. — [MakeUseOf, Aug 2026](https://www.makeuseof.com/kindle-page-turn-animation-setting/)
- **Saved brightness (Feb 2013):** "the brightness setting will now be saved across device sleeps." — [iClarified](https://www.iclarified.com/27515/kindle-app-for-ios-gets-multicolor-highlights-book-end-actions-saved-brightness)

### Inferences
- Putting brightness on every tab shows that Amazon treats it as the most-changed setting. A brightness slider in an iOS app needs native `UIScreen.brightness`.
- With 14 discrete size steps, a stepped slider beats a free slider: each step is a deliberate reflow.

### Gaps
- **Theme presets:** the built-in names (e.g. Standard, Compact, Large, Low Vision on e-readers) and the save, rename and delete flow on iOS 2026. Not confirmed.
- **Fonts:** the full font list in 2026. Bookerly and Ember are not confirmed by any source fetched here.
- **Margin options:** for example narrow, normal, wide. No source fetched.
- **Live preview:** whether the panel is a sheet that covers part of the page so changes reflow live behind it.
- **Location after reflow:** whether a font or size change keeps the exact first word on screen. No source found. Page Flip's thumbnails do adapt to font and margins (section 3).
- **Reading Progress toggles:** Pocket-lint and Just Kindle Books mention a Reading Progress option under More. No source gives its current per-mode checkboxes.

---

## 8. Footnotes, image zoom, X-Ray, Word Wise, Read & Listen

### Takeaway
Kindle shows pop-up footnotes when the book is marked up for them. Pop-ups close with an X or a tap outside. Plain link-style notes jump, and you return via back-dots. X-Ray info cards come up from selection. Whispersync for Voice is now **Read & Listen**: a headphones icon opens an audiobook bar, with live word highlighting. I could not confirm that Word Wise exists on iOS.

### Cited Findings
- **Footnote pop-ups:** close with the X or by tapping outside. This is a general guide, not iPhone-specific. — [eathealthy365](https://eathealthy365.com/how-footnotes-and-endnotes-actually-work-on-your-kindle/)
- **Return paths:** non-pop-up notes are a jump, and you return via the scrubber dots or the cover thumbnail. — [Amazon forum](https://www.amazonforum.com/s/question/0D54P00006zJOj6SAG/looking-for-back-button-to-return-from-footnote-to-main-text); [Amazon India forum](https://in.amazonforum.com/s/question/0D56Q0000CqmyWESQY/returning-from-footnotes)
- **X-Ray Smart Look-Up info cards:** see section 6. — [iClarified, Apr 2014](https://www.iclarified.com/40135/amazon-updates-kindle-app-for-ios-with-table-of-contents-xray-smart-lookup-improvements)
- **Read & Listen:**
  - Whispersync for Voice is now branded "Read & Listen". — [Audible UK help](https://help.audible.co.uk/s/article/listen-with-whispersync-for-voice?language=en_GB)
  - On iPhone, tap the **headphones icon** to reveal the audiobook bar. The text is highlighted as it is read (Immersion Reading). You must own both the ebook and the audiobook. — [eBookFriendly](https://ebookfriendly.com/add-audible-narration-kindle-ipad-iphone/)
- **No TTS:** one guide says the iPhone app has no built-in text-to-speech. — [Bristol City Council vision-support guide](https://services.bristol.gov.uk/sensory-support-service/vision-support/guide-to-using-kindle-app-for-ipad-and-iphone)
- **Story So Far** (three-dot menu, spoiler-free) and **Recaps** (press and hold a book or series in the library for "Read recap"): US only, from Apr 2025 onward. — [Engadget, Jun 2026](https://www.engadget.com/2202142/kindle-app-features-ios-has-ereader-still-doesnt-have/); [About Amazon](https://www.aboutamazon.com/news/books-and-authors/kindle-recaps-feature-ebook-series-refreshers)
- **Word Wise:**
  - The Android app got it in an update. — [Droid Life](https://droid-life.com/?p=165296)
  - An older App Store review asks for Word Wise on iPhone, which suggests it was missing then. — [App Store (CO)](https://apps.apple.com/co/app/kindle/id302584613?l=en-GB)

### Inferences
- The "ask" and Story So Far features are reached from the same two places, the selection menu and the three-dot menu. This keeps the page clean.

### Gaps
- **Image zoom:** double-tap or pinch, the full-screen viewer, and the dismiss gesture. No source found.
- **Word Wise on iOS in 2026:** unconfirmed.
- **X-Ray entry point:** whether X-Ray has its own entry in the three-dot menu in 2026.
- **Pop-up footnotes:** their visual design (bottom sheet versus popover) and their animation.

---

## 9. Library-to-reader transition and opening

### Takeaway
I found no public description of the open-book transition or loading state.

### Cited Findings
- **Library long-press:** press and hold a book in the library and a "Read recap" button appears when a recap is available. — [Engadget, Jun 2026](https://www.engadget.com/2202142/kindle-app-features-ios-has-ereader-still-doesnt-have/)
- **Get Book button:** since May 2025, an orange "Get Book" button next to listings opens Amazon's product page in the browser. — [MacRumors, May 2025](https://www.macrumors.com/2025/05/06/kindle-app-gets-biggest-ios-change-in-a-decade/)
  - Pocket-lint (Aug 2025) still says books "can't be bought within the app". Both are true: the purchase completes in the browser. — [Pocket-lint](https://www.pocket-lint.com/kindle-app-secret-features/)
- **Background downloads:** iClarified headline: "Kindle app now downloads books in the background". — [iClarified](https://www.iclarified.com/13481/kindle-app-now-downloads-books-in-the-background)

### Gaps
- Whether opening a book uses a cover zoom, a crossfade or a push, and how long it takes.
- What shows while a book downloads or opens: a progress ring on the cover, or a skeleton page.
- Whether the book opens on the cover, on "About this book", or at the last position.

---

## 10. Haptics

### Takeaway
I found no source on where Kindle iOS fires haptics.

### Gaps
- Whether haptics fire on page turn, on selection handle snap, on highlight creation, on scrubber chapter boundaries, or on toggles. A hands-on check is needed.

---

## 11. The 2023–2026 changes and user reaction

### Takeaway
I found no full "reader redesign" of the Kindle iOS app in 2023–2026. Change came as feature additions:
- the "Learning reading speed" fix (2023);
- the Get Book button (May 2025);
- Recaps (Apr 2025);
- Ask this Book (Dec 2025, US);
- Story So Far in the three-dot menu (by Jun 2026).

The loudest public pushback is about the AI features (authors' rights, no opt-out). It is not about reading feel. The best-documented reader-feel backlash (Aug 2024, the progress indicator) was on e-readers, not the app.

### Cited Findings
- **2017 redesign (24 Oct 2017):** new design, deeper Goodreads integration, persistent search. — [TechCrunch, Oct 2017](https://techcrunch.com/2017/10/24/amazon-revamps-the-kindle-app-with-a-new-design-and-deeper-good-reads-integration)
- **2023:** the "Learning reading speed" bug, fixed in 6.74. — [Amazon forum](https://www.amazonforum.com/s/question/0D54P00008CSz7ESAT/recalculate-or-reset-time-left-in-chapter-ios-app)
- **May 2025:** the "Get Book" button, after the 30 Apr 2025 Epic v. Apple order. MacRumors called it the biggest iOS change in over a decade. — [MacRumors](https://www.macrumors.com/2025/05/06/kindle-app-gets-biggest-ios-change-in-a-decade/)
- **AI features:**
  - Ask this Book on iOS arrived in Dec 2025. — [AlternativeTo](https://alternativeto.net/news/2025/12/amazon-adds-ask-this-book-to-the-kindle-ios-app-for-interactive-and-spoiler-free-qanda); [TechSpot](https://www.techspot.com/news/110607-amazon-ask-book-feature-like-book-chatbot-kindle.html); [Trusted Reviews](https://www.trustedreviews.com/news/kindle-app-can-now-answer-book-related-questions-without-spoilers)
  - The Authors Guild objects. Amazon offers no opt-out, citing a "consistent reading experience". — [Engadget, Jun 2026](https://www.engadget.com/2202142/kindle-app-features-ios-has-ereader-still-doesnt-have/)
- **Aug 2024 e-reader progress-indicator backlash:** too small, lags when cycling, hard to hit; some liked it. — [The eBook Reader blog](https://blog.the-ebook-reader.com/2024/08/09/last-kindle-update-changed-reading-progress-indicator-and-some-hate-it/)
- **Page Turn Animation:** still under Aa > More as of Aug 2026. — [MakeUseOf](https://www.makeuseof.com/kindle-page-turn-animation-setting/)

### Gaps
- **Reddit:** I did not retrieve any Reddit threads (r/kindle, r/ebooks, r/iphone) about the iOS reader. Searches returned none, so I have no user sentiment from Reddit.
- **App Store "What's New":** I found no 2024–2026 notes beyond press coverage. iClarified pages showing "2026" dates are 2010–2014 articles with crawl-date stamps.
- **iOS 26 / Liquid Glass:** whether the Kindle app adopted it. Searches found nothing.

---

## Implications for Pager

Context: Pager's iPhone app is a SwiftUI shell around a React web UI in a WKWebView. It has a CSS-paginated view and a scroll view, a reading-settings panel, a selection menu, an annotation popover, a TOC drawer and a footer. Below, **[web]** means buildable in the web layer. **[native]** means it needs a Swift bridge (a WKScriptMessageHandler call).

**Patterns worth copying:**
1. **Tap-to-cycle footer [web].**
   - One footer tap target cycles page-in-book → time-left-in-chapter → time-left-in-book → position/percentage → off. The choice persists.
   - Compute time-left from a rolling per-user words-per-minute figure. Ignore long idle gaps and fast skims.
   - Show the honest warm-up copy "Learning reading speed" until there are enough samples.
   - Make the hit area much larger than the text, and switch instantly. The 2024 Kindle complaints were about tiny text and lag.
2. **Back-to-location after any jump [web].** Kindle's scrubber dots are a known pain point: hard to see and hard to hit. Copy the idea, fix the design:
   - After a TOC, link, footnote, search or scrubber jump, show a labeled pill such as "← Back to p. 42", or a chapter-relative label for EPUB.
   - Clear it after N page turns away from the jump target.
3. **Footnote pop-ups instead of jumps [web].**
   - Intercept `epub:type="noteref"` or same-document anchor links and show the note in the annotation popover. Close it with an X or a tap outside.
   - Keep link hit-testing ahead of edge tap zones. Kindle's left-edge zone eats return links.
4. **Edge tap zones plus center chrome toggle [web].**
   - Pointer events on an overlay: left zone = previous, right zone = next, middle = toggle chrome.
   - Skip the zones when the target is a link, an existing highlight, or inside a selection.
   - Public sources give no zone widths for Kindle. Pick your own (for example a left/right edge of about 25–30% of the width) and test it.
5. **Page turn style [web for slide/none; native for curl].**
   - Kindle's default is an instant cut, with one optional animation. A CSS `transform: translateX` slide over CSS columns, with a drag that follows the finger and a velocity/distance snap, is fully web.
   - A real page curl in one WKWebView would need native snapshotting: `WKWebView.takeSnapshot` into a `UIPageViewController` `.pageCurl`. It is not worth it.
   - Copy Kindle's rule that the animation toggle is disabled in scroll mode, with explanatory copy ("Turn off Continuous Scroll to enable setting").
6. **Hide the status bar while reading, plus an optional in-page clock [native + web].**
   - Status bar visibility must come from SwiftUI (`.statusBarHidden()` / `.persistentSystemOverlays(.hidden)`), driven by a bridge message when the chrome toggles. The web layer cannot do this.
   - The clock itself is web.
7. **Aa panel structure [web, with native pieces].**
   - Copy Kindle's tab split: Themes/Font/size (default tab), Layout (spacing, margins, alignment, page color, follow-system-theme, columns on iPad, continuous scroll), More (progress options, page animation, reading ruler).
   - Use a stepped size slider (Kindle has 14 steps).
   - Saved named Themes (font + layout bundles) are a cheap, high-value web feature.
   - **Brightness** needs native `UIScreen.brightness`. **Orientation lock** needs a native supported-orientations change. "Follow system theme" can be web via `prefers-color-scheme`.
   - Live preview: show the panel as a bottom sheet over the page so reflow happens visibly behind it.
8. **Keep location across reflow [web].**
   - Before any font, size or margin change, record the first visible text node and character offset (CFI-like). After re-layout, find the page containing it.
   - Kindle's Page Flip thumbnails respect font and margins, so it clearly re-paginates live. Pager must do the same and never jump to the chapter start.
9. **Selection menu: one row, sticky color [native for menu suppression, web for UI].**
   - Kindle's row is: color dot (tap = last color, long-press = palette), Note, Look Up, Copy, Share (and Ask).
   - In WKWebView, long-press selection and handles come free from iOS. To replace or extend the native edit menu, override `buildMenu(with:)` in a WKWebView subclass on iOS 16+. Use it to drop system items or add "Highlight/Note" commands that message the web layer. Otherwise the native callout and Pager's web menu will collide.
   - The menu itself can be web, positioned from `getClientRects()` of the selection.
10. **Dictionary lookup [native helps].**
    - iOS's `UIReferenceLibraryViewController` gives offline dictionary definitions natively. A web card needs its own dictionary data.
    - If Pager wants Kindle's "info card without leaving the page", a web bottom sheet showing a short definition, plus a native "More" handoff, is a reasonable split.
11. **End-of-book screen [web].**
    - Trigger it on swiping past the last page, not on reaching the last byte. Kindle's marker-based trigger misfires on box sets and back matter.
    - Keep it calm: "Finished", a date stamp, an optional rating or note, "Back to library". It must be dismissible and should never auto-pop mid-book.
12. **Furthest vs. last position sync [web + server].**
    - Store both positions. Prompt on open only when the remote last-read position is newer and differs.
    - Use explicit copy that names the device and time, for example "You're at 34% here. On Mac you reached 41% (yesterday). Jump there?". Kindle's wording varies across versions, so write your own.
    - Offer "reset furthest position" for re-reads. Kindle users hit this and have to go to a website to fix it.
13. **Page Flip–style overview [web, effortful].**
    - A zoomed-out grid of the real paginated columns (CSS `transform: scale()` on the column container, or rendering N pages side by side), with the current page pinned and tap-to-return.
    - It is buildable in web, but performance on long chapters needs care. A cheaper first step is a scrubber with a live preview label (chapter title + page).
14. **Haptics [native].**
    - `navigator.vibrate` is not supported in iOS WebKit. Any haptic needs a bridge to `UIImpactFeedbackGenerator` or `UISelectionFeedbackGenerator`.
    - Sensible places, since Kindle's are undocumented: selection handle snap to word, highlight committed, scrubber crossing a chapter boundary, toggle flips.
15. **Library-to-reader transition [depends on where the library lives].**
    - If the library is native SwiftUI, the iOS 18 zoom navigation transition (`.navigationTransition(.zoom(sourceID:in:))`) from the cover is native.
    - If both are in the web layer, the same-document View Transitions API in Safari 18+ can morph the cover into the page.
    - Kindle's own transition is undocumented, so this is a free design choice.
