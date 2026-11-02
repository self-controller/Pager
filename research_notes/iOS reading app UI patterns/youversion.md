# YouVersion Bible App reader on iPhone: UI and micro-interaction teardown (with ESV Bible and Dwell comparisons)

Method and evidence base (read this first):
- **Native iOS app (version 11.35.0, 28 Oct 2026):** I had no device. Native behavior comes from YouVersion's help center (iOS articles updated 1–3 weeks before 28 Oct 2026), App Store release notes and older YouVersion blog posts. No source gives exact durations, spring values or haptic events for the native app. Any such value below is marked as inferred or as a gap.
- **Web reader (bible.com):** I reverse engineered it on 28 Oct 2026. Deploy id `b58ab6043e8794190e5460d6bb89fa879f28a86c`. I fetched the server-rendered HTML for `JHN.1.NIV`, both stylesheets and all 33 JS chunks with curl. Then I read the real class names, CSS values and minified React logic. The web reader is a Next.js/Tailwind app. Its markup (`cat7xG_verse`, `data-usfm`) and its behavior (a bottom action sheet, highlight swatches, prev/next arrows) clearly come from the same product family as the native app. Even so, **every web value may differ from the native iOS app**. Use the web values as a concrete, buildable reference, not as a measurement of the native app.
- **Live browser capture failed:** headless Chromium at 390x844 got a Fastly CAPTCHA (bot challenge) on bible.com. I did not try to bypass it. I took the screenshots below instead by rendering the downloaded HTML and CSS locally, without JS, at 390x844. I made the "selected", "highlighted", "dark" and "large" states by toggling the same classes and inline styles that the site's JS toggles. The font fell back to the system serif on Linux, so the **typeface in the screenshots is not representative**. Layout, spacing, colors and chrome are.
  - `screenshots/youversion_web_reconstructed_reader_light.png`: default reader, 20px serif, 600px column.
  - `screenshots/youversion_web_reconstructed_verse_selected_sheet.png`: verses 3–4 selected, with the action sheet raised.
  - `screenshots/youversion_web_reconstructed_highlight_v1.png`: verse 1 with a yellow highlight.
  - `screenshots/youversion_web_reconstructed_reader_dark.png`: `.dark` theme, showing the floating prev/next arrows and the tab bar.
  - `screenshots/youversion_web_reconstructed_size_large_24px.png`: the "22" size preset (24px serif, 700px column).
- **Web asset URLs used as sources:**
  - Page: https://www.bible.com/bible/111/JHN.1.NIV
  - Reader CSS module: https://www.bible.com/_next/static/chunks/1kkxuxu-rkriu.css
  - Main Tailwind CSS: https://www.bible.com/_next/static/chunks/120d2unqof6av.css
  - Chapter page, NavArrows and keyboard: https://www.bible.com/_next/static/chunks/2jxxevxe-azgb.js
  - Bible text, verse selection, highlights and action sheet: https://www.bible.com/_next/static/chunks/291mtgegayhux.js
  - Reader settings presets: https://www.bible.com/_next/static/chunks/0r8tr9-rce__k.js
  - Focus mode and hotkey map: https://www.bible.com/_next/static/chunks/36ribu1licvns.js
  - Shell, tab bar and rail: https://www.bible.com/_next/static/chunks/2aqmadbz-vsxv.js
  - Chunk names change with each deploy.

## 1. Chapter boundaries and the floating previous/next chapter buttons

### Takeaway
On the web reader, a chapter ends in this order: the last verse, then about 24px of copyright text, then a 96px gap, then related content ("Videos for John 1"). There is no next-chapter card, no pull-to-advance and no auto-advance. Navigation is done with two always-visible 48x48px rounded-square buttons, pinned 16px above the tab bar, that stick to the bottom while the chapter scrolls. When a navigation takes longer than 150ms, a spinner fades into the button over 150ms. On native iOS, chapter changes go through the bottom buttons by default. Android has a documented "Continuous Scrolling" switch that removes them; I found no iOS equivalent.

### Cited Findings
- **Arrow markup and styling (web):** each arrow is a link (`aria-label="Previous Chapter"` / `"Next Chapter"`) with classes `size-12 rounded-12 bg-button-filled-on-canvas-fill`. That means 48x48px, 12px corner radius and a filled background. The fill is `#edebeb` (gray-10) in light mode and `#353333` (gray-40) in dark mode. The hover and pressed states have their own fill tokens. The 24px chevron icon is rotated 180° for "previous" (it is RTL-aware). — [bible.com JHN.1 HTML](https://www.bible.com/bible/111/JHN.1.NIV); [JS chunk](https://www.bible.com/_next/static/chunks/2jxxevxe-azgb.js); tokens in [main CSS](https://www.bible.com/_next/static/chunks/120d2unqof6av.css)
- **Arrow position (web):**
  - The container is `pointer-events-none sticky bottom-[calc(var(--tabbar-h)+16px)] z-docked mx-auto flex w-full justify-between max-w-[calc(100%-32px)]`. So the two buttons sit 16px from the screen edges and 16px above the tab bar. Only the buttons themselves take pointer events.
  - Because the container is `sticky` and placed after the chapter text, the arrows float over the text the whole time you are inside the chapter. When you scroll past the end of the chapter, they come to rest at the chapter's end. They are not hidden on scroll; no scroll-direction logic exists for them.
  - At tablet width the offset is `--tabbar-h + 80px`. The container's max-width follows the font-size preset: 726, 776 or 876px. — [JS chunk](https://www.bible.com/_next/static/chunks/2jxxevxe-azgb.js); [main CSS](https://www.bible.com/_next/static/chunks/120d2unqof6av.css)
- **Tab bar height variable (web):** `--tabbar-h` is `calc(72px + env(safe-area-inset-bottom,0px))` on phones, `calc(95px + safe-area)` at ≥640px and `0px` at ≥992px. Focus mode forces both `--tabbar-h` and `--rail-w` to `0px`. — [main CSS](https://www.bible.com/_next/static/chunks/120d2unqof6av.css)
- **Pending state (web):** inside each arrow is a `data-testid="nav-arrow-pending"` overlay that holds a spinner. It is `opacity-0 transition-opacity duration-150`, and while Next.js `useLinkStatus().pending` is true it gets `opacity-100 delay-150`. The spinner therefore appears only when navigation takes longer than 150ms, then fades in over 150ms with the default easing `cubic-bezier(.4,0,.2,1)`. Prefetching of these links is disabled (`prefetch:null`). — [JS chunk](https://www.bible.com/_next/static/chunks/2jxxevxe-azgb.js)
- **Focus mode (web):** in focus mode the arrows are hidden with `reader-focus-mode:invisible` (visibility, not display), so the layout does not shift. — [JS chunk](https://www.bible.com/_next/static/chunks/2jxxevxe-azgb.js); [main CSS](https://www.bible.com/_next/static/chunks/120d2unqof6av.css)
- **"Previous" at the top of a book (web):** on John 1, the "previous" link goes to the book introduction (`/bible/111/JHN.INTRO1.NIV`), not to Luke 24. — [bible.com JHN.1 HTML](https://www.bible.com/bible/111/JHN.1.NIV)
- **What follows the chapter (web):**
  - The last verse.
  - The version copyright block: 14px, `#777a7b`, line-height 1.6, `margin-top:1.42857rem`, with a "Learn More About New International Version" link in `#3d79c2`.
  - The chapter block's `mbe-24` margin (96px).
  - The related content, with heading "Videos for John 1", then a two-column video-card grid on wider screens.
  
  I found no "Next chapter" card and no scroll-to-advance code. — [bible.com JHN.1 HTML](https://www.bible.com/bible/111/JHN.1.NIV); [reader CSS](https://www.bible.com/_next/static/chunks/1kkxuxu-rkriu.css)
- **Keyboard (web):** → and ← move to the next and previous chapter. In RTL the keys swap (`{ltr:"right",rtl:"left"}`). Navigation uses `router.push`, which is a full route change. — [JS chunk](https://www.bible.com/_next/static/chunks/2jxxevxe-azgb.js); [hotkey map](https://www.bible.com/_next/static/chunks/36ribu1licvns.js)
- **Android "Continuous Scrolling" (native):** Bible tab > ⋯ > Fonts & Settings has a **Continuous Scrolling** switch. When it is on, "scrolling moves between chapters instead of using the bottom navigation buttons". — [YouVersion Help: Android Bible Reader Settings](https://help.youversion.com/l/en/article/mya0fknmzo-bible-settings-android)
- **iOS Fonts & Settings (native):** the iOS article lists only font size, font and background color. It does not list Continuous Scrolling. — [YouVersion Help: iOS Bible Reader Settings](https://help.youversion.com/l/en/article/j2nmx67p54-settings)
- **Older iOS gestures (2011):** swiping left or right jumped to the previous or next chapter, and swiping up or down scrolled within the chapter. — [YouVersion blog 2011 (via search snippet; page not fetched)](https://blog.youversion.com/2011/07/updated-bible-app-for-iphone-ipod-touch-ipad-new-bible-reader-features/)
- **VoiceOver chapter navigation (AppleVis, older):** a VoiceOver workaround thread says users "flick left or right to move between chapters" after picking a book. — [AppleVis thread (via search snippet)](https://www.applevis.com/forum/ios-ipados/problem-latest-update-youversion-bible-app)

### Inferences
- The native iOS app very likely uses the same "two floating corner buttons" model as the web. Android's help text calls them "the bottom navigation buttons", and the web build copies the native look closely.
- On iOS, chapter-to-chapter reading is discrete (one chapter per screen) unless iOS has an undocumented continuous mode.
- Unverified recollection, needs device testing: in the native iOS app the arrows are translucent circles that fade while you scroll and reappear when scrolling stops or reverses. The web build does not do this. Its arrows are always visible.
- The 150ms-delay spinner is a good pattern. Fast chapter loads (cached or prefetched) show no flash at all; only slow loads show feedback.

### Gaps
- I found no source for the native iOS arrow shape, size, opacity, auto-hide timing or animation.
- I could not confirm whether native iOS has a pull-to-advance or rubber-band affordance at the chapter end. No help article or release note mentions one.
- I could not confirm whether native iOS has a Continuous Scrolling setting in 2026. It is documented only for Android.

### Update, 29 Oct 2026: chapter turns, from YouVersion's open-source SDK

A second pass for Pager's scroll layout. It read YouVersion's open-source readers in the `youversion` GitHub org (Swift, React, React Native, Kotlin) with `gh api`. The Swift README calls its reader "very similar to the YouVersion Bible app". It is still **not the Bible App's code**, so SDK values are confirmed for the SDK and only inferred for the native app.

**Corrections to the bullets above**
- **The AppleVis "flick left or right" quote is not a reader gesture.** The full 2018 post is about VoiceOver focus in the chapter picker ("from 15 to 14, or right to 16, 17 or 18"). It tells readers to use "the Next and Previous Chapter buttons near the bottom of the screen". — [AppleVis 2018 (mirror)](https://atlas-entry.applevis.com/forum/ios-ipados/problem-latest-update-youversion-bible-app)
- **The 2011 blog post has now been fetched.** It says: "Swipe Left/Right: Jump to previous/next chapter in current book". It also says double-tap toggles fullscreen. — [blog 2011](https://blog.youversion.com/2011/07/updated-bible-app-for-iphone-ipod-touch-ipad-new-bible-reader-features/)

**Native app** (user reports)
- **2021 (v9.0.1):** "you can just swipe left/right to go to the previous or next chapter". — [ChristianBytes](https://www.christianbytes.com/apps-desktop-software/youversion-bible-app-review/)
- **No 2022–2026 source confirms or denies a swipe.** The iOS settings article lists no switch for one.
- **Dec 2025:** "Previous Chapter" / "Next Chapter" buttons at the bottom. — [AppleVis Dec 2025](https://mail.applevis.com/forum/ios-ipados/youversion-bible-app-help-needed)

**SDK** (`platform-sdk-swift`, confirmed for the SDK)
- **No horizontal chapter gesture in any of the four readers.**
- **Buttons, until an Oct 2026 redesign** ([BibleReaderNavButtons.swift @f467a9b](https://github.com/youversion/platform-sdk-swift/blob/f467a9b692d950848c7feae80cadb51f1f5c42df/Sources/YouVersionPlatformReader/Components/BibleReaderNavButtons.swift); [PR 96](https://github.com/youversion/platform-sdk-swift/pull/96)):
  - 42×42 pt circles in the page background, shadow radius 2 at y 2.
  - 16 pt medium `chevron.left` / `chevron.right`.
  - Inset 24 pt from the sides and bottom.
  - They slide down 200 pt over 0.3 s ease-in-out on scroll-down (they fade under Reduce Motion), and are invisible while the verse drawer is open.
- **After the Oct 2026 redesign:** one `[‹ John 1 ›]` capsule with 44 pt targets. — [PR 283](https://github.com/youversion/platform-sdk-swift/pull/283)
- **Chrome** ([`handleScroll`](https://github.com/youversion/platform-sdk-swift/blob/main/Sources/YouVersionPlatformReader/ViewModels/BibleReaderViewModel+Navigation.swift)):
  - It hides after ≥ 10 pt of downward scroll and shows after ≥ 10 pt upward.
  - It always shows at the top, overscroll included.
  - Toggles take 0.1 s ease-in-out.
- **A chapter turn** ([BibleReaderView.swift](https://github.com/youversion/platform-sdk-swift/blob/main/Sources/YouVersionPlatformReader/BibleReaderView.swift)):
  - It clears the verse selection.
  - It swaps the content instantly, with no animation.
  - It jumps to the top for both Next and Previous.
  - It forces the chrome visible and holds scroll-driven hiding off for 0.5 s.
- **No pull-to-advance and no auto-advance.** After the last verse come a copyright block and "Learn more". — [PR 119](https://github.com/youversion/platform-sdk-swift/pull/119)
- **No haptics in the SDK.**

**Other apps**
- **Olive Tree:** a three-finger swipe changes chapter (search snippet).
- **AndBible:** after users changed chapter by accident, a setting lets the swipe mean chapter, page, or nothing. — [issue #501](https://github.com/AndBible/and-bible/issues/501)
- **kappalib (a web reader):** after accidental swipes it requires ≥ max(80 px, 25% of the width), horizontal ≥ 2× vertical, and no pinch-zoom. — [PR #267](https://github.com/ch1kulya/kappalib/pull/267)

**Still unknown for the native app:** whether 11.3x has a swipe at all, and its arrow look, animation and haptics. Settling these needs a screen recording of the app on a device.

**What Pager built from this (DESIGN.md "Scroll"):** a drag that follows the finger (Pager's own addition), with the SDK's buttons, its 10 pt chrome rule and its 0.5 s hold.

## 2. Chrome: top bar and bottom tab bar, hide and show

### Takeaway
On native iOS, the reader's top controls disappear as you scroll down into a chapter and come back when you scroll up or return to the top. Help articles tell users to "scroll to the top of the chapter" or "scroll up slightly" to find hidden buttons. On the web reader the chrome does not hide on scroll. It is a sticky, 97%-opaque, 2px-blurred toolbar. The only "hide everything" mode is an explicit Focus Mode (key `f`), which also requests browser fullscreen. In 2015 the native app toggled full screen with a double-tap.

### Cited Findings
- **iOS ⋯ button hides on scroll:** to reach Fonts & Settings, "Tap the top-right circle icon with three dots (⋯)… If the button is hidden, scroll to the top of the chapter first." — [YouVersion Help: iOS Bible Reader Settings](https://help.youversion.com/l/en/article/j2nmx67p54-settings)
- **Android speaker icon hides on scroll:** to find the speaker icon at the top center, "If it's missing, scroll up slightly." — [YouVersion Help: Android Audio Bible](https://help.youversion.com/l/en/article/q0f56wuz5c-android-audio-bible)
- **iOS audio controls:** iOS audio starts from "the speaker icon at the top" or "a play button at the bottom center". Tapping the speaker offers **Show Controls / Hide Controls** for that play button. — [YouVersion Help: iOS Audio Bible](https://help.youversion.com/l/en/article/2z77z3edpw-audio-bible-ios)
- **2015 iOS double-tap:** "Double-tap anywhere in the Bible text to toggle between full-screen and default reading modes." — [YouVersion blog, June 2015](https://blog.youversion.com/2015/06/introducing-all-new-youversion-bible-app-for-apple-ios-devices/)
- **Web toolbar (below 992px), in order:**
  - A "John 1 ▾" pill: 1px border `#dddbdb`, radius 16px, 12px bold, min height 32px. It opens the book picker as a dialog (`aria-haspopup="dialog"`, shortcut `B`).
  - An "NIV" pill: 32px high, fully rounded.
  - A 32px round "Listen" button, which links to `/audio-bible/...`.
  - A "Parallel" button, hidden below 768px.
  - A 32px round settings (Aa) button.
  - The bar's own classes are `sticky top-0 min-h-toolbar(56px) border-t bg-canvas/[0.97] backdrop-blur-[2px] px-6 py-3` (dark: `bg-canvas/[0.95]`).
  
  Above it is a 72px site header (logo, search, language, menu, avatar) that scrolls away on phones (`relative`, sticky only at ≥992px). — [bible.com JHN.1 HTML](https://www.bible.com/bible/111/JHN.1.NIV); [JS chunk](https://www.bible.com/_next/static/chunks/2aqmadbz-vsxv.js); screenshot `youversion_web_reconstructed_reader_light.png`
- **Web tab bar:** a fixed bottom bar with **Home, Bible, Today, Plans**. Classes: `bg-canvas/[0.97] p-1 pb-[calc(4px+env(safe-area-inset-bottom))] shadow-elevated backdrop-blur-[2px]`. On tablets it becomes a floating 376px-wide pill with 24px radius. It hides in focus mode. — [JS chunk](https://www.bible.com/_next/static/chunks/2aqmadbz-vsxv.js); screenshot `youversion_web_reconstructed_reader_dark.png`
- **Web Focus Mode:**
  - Toggled with `f`, exited with `Esc`.
  - It sets `data-reader-focus-mode` on an `<output>` element. CSS keyed on `:root:has([data-reader-focus-mode])` then hides the rail, tab bar and footer (`display:none`), makes the arrows `visibility:hidden`, and sets `--rail-w:0; --tabbar-h:0`.
  - It calls `document.documentElement.requestFullscreen()` and exits focus mode when fullscreen ends.
  - It announces `full_screen_on` to screen readers.
  - It logs `reader_focus_mode_enter` and `reader_focus_mode_exit` with `duration_seconds`.
  
  — [focus-mode JS](https://www.bible.com/_next/static/chunks/36ribu1licvns.js); [chapter JS](https://www.bible.com/_next/static/chunks/2jxxevxe-azgb.js); [main CSS](https://www.bible.com/_next/static/chunks/120d2unqof6av.css)
- **No scroll-hide on the web:** no scroll-direction listener drives the web chrome. The only `scrollDirection` in the bundle belongs to the virtualized-list library (react-window). — [JS chunk](https://www.bible.com/_next/static/chunks/1nzaumrppojyb.js)
- **Help-center tab names:** iOS help articles refer to the **Bible** tab, the **You** tab and a **Saved** tab ("You > Saved > Highlights"). The iOS help categories are Home, Bible, Plans, Discover and You. — [YouVersion Help: iOS category](https://help.youversion.com/l/en/category/inq2supp6u-bible-app-i-os); [Highlights iOS](https://help.youversion.com/l/en/article/ie1gz0nsr7-highlights-ios)

### Inferences
- Native iOS most likely ties top-bar visibility to scroll direction: it hides on downward scroll and shows on upward scroll or near the top. That is the only behavior consistent with "scroll to the top of the chapter first" and "scroll up slightly". Whether it slides or fades, and whether the tab bar moves with it, is not documented.
- The 2015 double-tap full-screen toggle may still exist, but no 2025–2026 source confirms it.

### Gaps
- I found no source for the native slide-versus-fade style, the scroll threshold, or whether the bottom tab bar hides with the top bar on iOS 26.
- I found no source on whether a single tap toggles the chrome natively. A single tap is used to select verses, which probably rules it out.

## 3. Verse interaction: tap, underline, action sheet, highlights, multi-select, Verse Image

### Takeaway
Tapping a verse toggles it into a selection set and draws a **dotted underline** under it. A bottom sheet slides up with the reference and the actions. Tapping more verses adds to the selection; tapping a selected verse removes it. On the web, if the tapped verse is within 350px of the bottom of the viewport, the page smooth-scrolls it to the center so the sheet does not cover it. When a highlight is applied, its background color **fades in over 750ms**, and the text flips to black or white automatically for contrast. Natively, the action list scrolls horizontally: "swipe left" reveals Image (Verse Image), Compare and more.

### Cited Findings
- **iOS selection:** "select the verse(s). **Dotted underlines** appear beneath the selected verses, and a row of options appears at the bottom." — [YouVersion Help: iOS Highlights](https://help.youversion.com/l/en/article/ie1gz0nsr7-highlights-ios)
- **iOS highlight colors:**
  - There are five colors, and the **three most recently used** are shown first.
  - To see all five, "tap the multicolor button and swipe left".
  - A custom color is reached by swiping to **⋯**.
  - To remove a highlight, select the verse and tap the current color, which shows an **X** in the middle.
  - Highlights are public by default.
  
  — [YouVersion Help: iOS Highlights](https://help.youversion.com/l/en/article/ie1gz0nsr7-highlights-ios)
- **iOS Saved Verse Indicator:** a **blue background behind the verse number** marks a verse you have highlighted. It shows only in the version where you made the highlight, and tapping it opens the item in Saved. — [YouVersion Help: iOS Highlights](https://help.youversion.com/l/en/article/ie1gz0nsr7-highlights-ios)
- **iOS action menu:** the actions menu scrolls horizontally. "swipe the actions menu from right to left and choose Compare". For a Verse Image, "Swipe left in that list and choose Image". — [Compare/Parallel iOS](https://help.youversion.com/l/en/article/nxlpf1hcgh-compare-bible-version-ios); [Verse Images iOS](https://help.youversion.com/l/en/article/x2qwuszjaf-verse-images)
- **iOS Verse Image editor:**
  - Choose a stock photo or "Select Image" from your device.
  - Controls at the bottom: Font; font size, letter spacing, line height and alignment; Shape; Bible text opacity; background blur and brightness.
  - Tap the text to edit it; tap the background to leave text-edit mode.
  - "The more verses you select, the smaller the text becomes."
  - Tap **Save**.
  - Images with stock backgrounds appear on friends' Community Feed.
  
  — [YouVersion Help: iOS Verse Images](https://help.youversion.com/l/en/article/x2qwuszjaf-verse-images)
- **Release-note history of this menu:**
  - An older release added "a new swipe-up gesture when tapping a verse to reach related content" (version 10.5, App Store listing, via search snippet).
  - Version 10.15 (Nov 2024) added "verse-action indicators in the reader" (via search snippet).
  
  — [App Store listing (sk)](https://apps.apple.com/sk/app/bible/id282935706); [Apptopia changelog](https://apptopia.com/ios/app/282935706/about)
- **2016 redesign:** the verse action menu was redesigned so that its menus "stay out of the way of the verses on screen". It covers highlight, verse image, bookmark and share. — [Bible Buying Guide, Aug 30 2016](https://biblebuyingguide.com/youversion-bible-app-significant-update/)
- **Web selection logic:**
  - A tap on a verse span (`[data-usfm]`) toggles its USFM in a `Set` and adds or removes the class `verse-selected`, which is `border-bottom:1px dotted #777a7b` (dark mode: `#aaa`).
  - On select, `if (window.innerHeight - el.getBoundingClientRect().top < 350) el.scrollIntoView({behavior:"smooth", block:"center"})`.
  - A verse split across paragraphs is selected in all of its spans.
  
  — [JS chunk](https://www.bible.com/_next/static/chunks/291mtgegayhux.js); [reader CSS](https://www.bible.com/_next/static/chunks/1kkxuxu-rkriu.css)
- **Web verse tap styling:** `.verse{cursor:pointer; transition: background-color .75s cubic-bezier(.42,1,.16,.93), color .75s}`. The text container has `-webkit-tap-highlight-color:transparent`. — [reader CSS](https://www.bible.com/_next/static/chunks/1kkxuxu-rkriu.css)
- **Web highlight color application:** highlights are set as inline `background-color:#RRGGBB`. The text color is computed from the W3C brightness and color-difference formula: white text if the brightness difference is ≥125 and the color difference is ≥500, otherwise black. — [JS chunk](https://www.bible.com/_next/static/chunks/291mtgegayhux.js); screenshot `youversion_web_reconstructed_highlight_v1.png`
- **Web action sheet structure:**
  - A fixed bottom panel: `rounded-t-16` (24px on tablet), `p-6`, `shadow-light-2` (`0 2px 6px #12121226`), elevated surface, 480px wide on tablet.
  - Hidden state is `translate-y-[calc(100%+24px)]`. Shown state is `translate-y-0`.
  - It uses Tailwind `transition`: transform, opacity and others, **150ms `cubic-bezier(.4,0,.2,1)`**, turned off with `motion-reduce:transition-none`.
  - When hidden it is `aria-hidden` and `inert`.
  
  — [JS chunk](https://www.bible.com/_next/static/chunks/291mtgegayhux.js); [main CSS](https://www.bible.com/_next/static/chunks/120d2unqof6av.css)
- **Web action sheet content and copy:**
  - Header: "Currently Selected:" (11px, muted), then a link "John 1:3-4 NIV ›" (13px bold), and on the right a round 40px **Cancel** (X) button with a `#edebeb` background.
  - Rows, separated by 1px dividers, with 14px padding and a 13px bold label: **Highlight** (followed by the swatch strip), **Copy**, **Compare**, **Share**.
  - Signed-out footer card: "Want to have your highlights saved across all your devices? Sign up or sign in".
  
  — [bible.com JHN.1 HTML](https://www.bible.com/bible/111/JHN.1.NIV); screenshot `youversion_web_reconstructed_verse_selected_sheet.png`
- **Web swatch strip:**
  - A horizontally virtualized list, 184×32px, with **44px per swatch**.
  - When a highlight already exists, a 32px round "remove highlight" button and a 1px divider come first.
  - Choosing a color moves it to the front of the list (most recent first) and smooth-scrolls the strip back to `left:0`.
  - Signed-out highlights are kept in a cookie `PendingHighlights_{version}_{usfm}` for 168 hours.
  
  — [JS chunk](https://www.bible.com/_next/static/chunks/291mtgegayhux.js)

### Inferences
- The "most recent colors first" ordering is shared by the web (sort on select) and iOS ("three most recently used"). The swatch row works as a recency list, not a fixed palette.
- The 750ms ease-out-ish highlight fade (`cubic-bezier(.42,1,.16,.93)` overshoots the start, then settles slowly) gives a soft "ink soaking in" feel. Most apps apply the color instantly instead.
- The keep-selection-visible rule (scroll to center when within 350px of the bottom) is how the sheet avoids covering the verse you just tapped. The threshold roughly matches the height of the sheet.

### Gaps
- I found no source for the native sheet's height, detents, animation curve, or whether it can be dragged to dismiss.
- The native Verse Image transition (push, modal, or a zoom from the verse) is undocumented.
- Native haptics on verse tap are undocumented; see section 9.

## 4. Book and chapter picker

### Takeaway
The picker opens from the "Book Chapter ▾" pill. The web version opens it as a dialog (shortcut `B`), and its panel code loads lazily on first open. Native iOS added "recent Bible passages directly from the passage picker" in August 2026 and accessibility improvements to "passage choosing" in September 2026. The exact grid and list layout and the selection motion could not be observed.

### Cited Findings
- **Web trigger:**
  - The pill is a link to `/versions/...`, but a plain left click is intercepted (`preventDefault`) to open a dialog panel, `BibleUsfmPickerPanel`, which is dynamically imported.
  - It has `aria-haspopup="dialog"` and `aria-keyshortcuts="B"`.
  - The `b` hotkey clicks the first visible `[data-book-picker-shortcut-trigger]`.
  
  — [JS chunk](https://www.bible.com/_next/static/chunks/2jxxevxe-azgb.js); [hotkey map](https://www.bible.com/_next/static/chunks/36ribu1licvns.js)
- **11.29.0 (Aug 6, 2026):** "Easily view and access your recent Bible passages directly from the passage picker." — [App Store](https://apps.apple.com/us/app/bible/id282935706)
- **11.31.0 (Sep 2, 2026):** accessibility improvements for passage choosing and reading. — [App Store](https://apps.apple.com/us/app/bible/id282935706)
- **Android "Show Verse Pickers":** a switch that shows or hides verse numbers when you change books. In other words, the flow is book, then chapter, then an optional verse step. — [YouVersion Help: Android Bible Reader Settings](https://help.youversion.com/l/en/article/mya0fknmzo-bible-settings-android)

### Inferences
- The native flow is probably: book list, then a chapter-number grid, then an optional verse-number grid (Android documents the verse step as optional), plus a "recents" row since 11.29.

### Gaps
- The picker panel is lazy-loaded JS and the live site was behind a CAPTCHA, so I captured no layout, column count, cell size, expand/collapse animation or selection animation.
- No native picker screenshots or descriptions were found in the help center.

## 5. Typography settings (Aa / Fonts & Settings)

### Takeaway
Native iOS: ⋯, then **Fonts & Settings**. It has two "A" buttons for size (smaller and larger, in steps), a font list (OpenDyslexic was added at one point), and a row of background colors. Picking a background color also switches the whole app between Light and Dark. Red letters, footnotes and the audio tracking bar live under You > Settings > Bible Reading. The web reader has a much smaller set: two families (Source Serif Pro or Aktiv Grotesk), three sizes, a footnotes toggle, a "numbers and titles" toggle and a keyboard-shortcuts toggle. **The text column widens as the font grows (550, 600, 700px).** No source shows how either version preserves reading position when the size changes.

### Cited Findings
- **iOS size, font and background:**
  - Size: "Use the **A** buttons to make the text larger or smaller."
  - Font: open the **Font** section and pick from the list.
  - Background: choose one of the colors. "Changing the reader's background color also switches the whole app between Light Mode and Dark Mode."
  
  — [YouVersion Help: iOS Bible Reader Settings](https://help.youversion.com/l/en/article/j2nmx67p54-settings)
- **iOS You > Settings > Bible Reading:** Red Letters, Footnotes, Show Audio Tracking Bar. — [YouVersion Help: iOS Bible Reader Settings](https://help.youversion.com/l/en/article/j2nmx67p54-settings)
- **App Store description:** "Adjust settings like fonts, spacing, and text size, and even read in Dark Mode"; "Themes let you select a color palette for your entire Bible App experience". — [App Store](https://apps.apple.com/us/app/bible/id282935706)
- **11.34.0 and 11.34.1 (Oct 14 and 17, 2026):** "Added accessible color options for red-letter text in the Bible Reader" and "Increased verse number size for improved readability." — [App Store](https://apps.apple.com/us/app/bible/id282935706)
- **OpenDyslexic:** this font was added to the font list, reached from the **Aa** button in the reader or from Reader Settings. — [YouVersion blog via search snippet](https://churchleaders.com/news/426062-pastors-dream-bible-dyslexic-font.html/2)
- **2015 iOS release:** "more accessible font and lightness controls". — [YouVersion blog 2015](https://blog.youversion.com/2015/06/introducing-all-new-youversion-bible-app-for-apple-ios-devices/)
- **Web reader settings model:**
  - Defaults: `{fontFamily:"Source Serif Pro", fontSize:"18px", footnotes:true, keyboardShortcuts:true, numbersTitles:true}`.
  - Size presets: 14, 18 and 22px. For the serif family they are bumped to **16, 20 and 24px**, because the serif renders smaller.
  - Column max-width per preset: **550, 600 and 700px**.
  - The alternative family is `aktiv-grotesk`, the brand sans, defined as `"aktiv-grotesk", Inter, Arial, sans-serif`.
  
  — [settings JS](https://www.bible.com/_next/static/chunks/0r8tr9-rce__k.js); [main CSS](https://www.bible.com/_next/static/chunks/120d2unqof6av.css); screenshot `youversion_web_reconstructed_size_large_24px.png`
- **Web body text:**
  - Line-height **1.8** (36px at 20px).
  - Color: `.reader` is `#121212`; the dark-mode reader is `#e8e6e6`.
  - Paragraphs: `text-indent:1em`.
  - Poetry (`q1`): hanging indent `text-indent:-2em; padding-inline-start:2em`.
  - Words of Christ: `#ff3d4d`.
  - Small-caps for `pc` and `qc` in NIV.
  
  — [reader CSS](https://www.bible.com/_next/static/chunks/1kkxuxu-rkriu.css)
- **Web verse numbers:** 14px, `#777a7b` (dark: `#a0a0a0`), `position:relative; top:-.6em` (raised, but kept on the baseline so line spacing is unaffected), `margin-inline-end:5px`. — [reader CSS](https://www.bible.com/_next/static/chunks/1kkxuxu-rkriu.css)
- **Web headings:**
  - Chapter title h1: centered, `margin:3rem 0`, bold, 31px (39px at ≥768), line-height 1.15, tracking −0.004em.
  - Section heading (`s1`): 1.1em bold, `margin:0 0 .5em`; heading line-height 1.2em.
  - Cross-reference headings (`r`): 0.8em italic.
  
  — [reader CSS](https://www.bible.com/_next/static/chunks/1kkxuxu-rkriu.css); [bible.com JHN.1 HTML](https://www.bible.com/bible/111/JHN.1.NIV)
- **Web side margins:** 24px on phones (`px-6`), 40px at ≥768 (`px-10`). — [bible.com JHN.1 HTML](https://www.bible.com/bible/111/JHN.1.NIV)
- **YouVersion React SDK:** its BibleReader exposes font size 12–20px (default 16), a `lineHeight` multiplier, and the fonts "Inter" or "Source Serif". — [YouVersion platform SDK docs (search snippet; the page now returns HTTP 410)](https://www.mintlify.com/youversion/platform-sdk-react/api/ui/bible-reader)
- **Observation on the web font:** the inline style says `font-family:Source Serif Pro`, but the two loaded stylesheets define only `@font-face{font-family:SourceSerifPro}` (a Cyrillic 900 weight) and Inter. Unless another chunk loads it, the web serif may fall back to the system serif. — [main CSS](https://www.bible.com/_next/static/chunks/120d2unqof6av.css)

### Inferences
- Pairing size steps with column width (550, 600, 700) keeps the line length at roughly 60–70 characters across sizes. On a 390px phone this has no effect, because the 24px padding caps the column at 342px.
- The native "A smaller / A larger" stepper suggests discrete steps rather than a slider.
- The web reader re-renders the chapter from the settings context (memoized on a `chapterContentStyle` JSON comparison). I found no code that saves and restores the scroll anchor. Most likely the browser's default scroll anchoring (Chromium) or nothing (Safari) handles position on the web.

### Gaps
- Native line-spacing control: the App Store says "spacing", but the help article does not list it.
- I found no source for the native font list in 2026, the number of size steps, or whether native iOS keeps the reading position when the size changes.
- Live preview behavior in the native sheet (whether the text behind the sheet updates live) is undocumented.

## 6. Audio Bible: mini-player, follow-along and auto-scroll

### Takeaway
On native iOS, audio starts from the speaker icon at the top of the reader or from a play button at the bottom center. Users can hide that play button. The skip controls move **one verse at a time** (not 30 seconds, as in 2015). A "1X" speed control and a sleep timer are available. An optional **Audio Tracking Bar** highlights the verse being read. Playback continues into the next chapter automatically and stops at the end of the book. Siri can start audio chapters (Sep 2026). Whether the text auto-scrolls to follow the audio is not documented.

### Cited Findings
- **iOS player:**
  - Entry: the "speaker icon at the top" or a "play button at the bottom center". The speaker icon's menu offers Show Controls and Hide Controls.
  - Rewind and forward "move one verse at a time".
  - "1X" speed at the bottom left; a clock icon at the bottom right for the timer.
  - "drag the seek bar's bubble at the bottom".
  - Narrator switch.
  - Audio "reads to the end of a chapter and then moves to the next one automatically… stops only when you stop it or the book ends".
  - Background playback is controlled from Control Center.
  
  — [YouVersion Help: iOS Audio Bible](https://help.youversion.com/l/en/article/2z77z3edpw-audio-bible-ios)
- **Tracking bar:** "Show Audio Tracking Bar" highlights the verse being read aloud. It is not available for some versions. — [YouVersion Help: iOS Bible Reader Settings](https://help.youversion.com/l/en/article/j2nmx67p54-settings); [iOS Audio Bible](https://help.youversion.com/l/en/article/2z77z3edpw-audio-bible-ios)
- **11.32.0 (Sep 16, 2026):** "Ask Siri to play Bible audio chapters." — [App Store](https://apps.apple.com/us/app/bible/id282935706)
- **2015 release:** added playback speed, "skip backward or forward 30 seconds", and a Timer. — [YouVersion blog 2015](https://blog.youversion.com/2015/06/introducing-all-new-youversion-bible-app-for-apple-ios-devices/)
- **Web audio:** the web reader's "Listen" button opens a separate `/audio-bible/...` page in a new tab (`target="_blank"`), not an inline player. — [bible.com JHN.1 HTML](https://www.bible.com/bible/111/JHN.1.NIV)
- **Third-party word-level claim:** a blog says the app highlights "the words being spoken". YouVersion's own docs say the highlight is per **verse**, so treat the word-level claim as unreliable. — [sophiecress.com (low quality)](https://sophiecress.com/blog/bible-app-audio-does-the); contradicted by [YouVersion Help: iOS Audio Bible](https://help.youversion.com/l/en/article/2z77z3edpw-audio-bible-ios)

### Inferences
- Per-verse skip suggests the native audio has verse-level timestamps. The tracking bar uses the same data.
- Auto-scroll that keeps the spoken verse in view is likely when the tracking bar is on, but it is not documented.

### Gaps
- I found no source for the native mini-player's look (a collapsed bar above the tab bar, or controls inside the reader), its expand animation, or the available speed values and timer options.
- Whether the reader follows the audio across chapter changes (and loads the next chapter's text) is undocumented.

## 7. Reading plans, day completion, streaks and Verse of the Day

### Takeaway
Streaks count consecutive days of opening or engaging with the app, shown in the home feed. They reward milestones such as 7 days in a row or a new personal record with "mini-celebrations". Verse of the Day appears on an image background and can be shared, saved or used as a widget. Newer builds add "Guided Scripture" with video and reflection questions and a Guided Scripture streak. Plan day-completion animations are not documented anywhere I could reach.

### Cited Findings
- **Streaks (Life.Church blog, about Aug 2017):** "When you consistently open the app multiple days in a row, you'll create a 'streak.'" The home feed shows "how many days in a row" you have engaged. Milestones such as 7 days or beating your record trigger "mini-celebrations". — [Life.Church Open blog](https://openblog.life.church/?p=5768)
- **Guided Scripture:** "Verse of the Day in Guided Scripture with an engaging video and personal reflection questions", tied to a "Guided Scripture Streak". A 2023 note mentions a Streaks home-screen widget. — App Store listing via search snippet ([App Store vc](https://apps.apple.com/vc/app/bible/id282935706))
- **Verse of the Day:** shown each morning on an image background; it can be saved to the camera roll, shared, or used as a home-screen widget. — [bibleinyear.com review, Apr 28 2026](https://bibleinyear.com/blog/youversion-bible-app); [iOS Widget help article listed](https://help.youversion.com/l/en)
- **Plans:** daily readings with optional devotionals, several at once, and "tracks your reading streak and gently reminds you". — [bibleinyear.com, Apr 28 2026](https://bibleinyear.com/blog/youversion-bible-app)
- **Plans redesign concept:** a "Plans Redesign. YouVersion App" exists on Dribbble. It is a designer concept, not shipped UI. — [Dribbble](https://dribbble.com/shots/20752187-Plans-Redesign-YouVersion-App)

### Inferences
- The celebrations are milestone-based (7 days, new record), not shown every day. This keeps the reward scarce.

### Gaps
- I found no source for the checkmark, confetti or animation when completing a plan day; the order of events (last reading, then a completion screen, then the next day); the streak animation style; or haptics. The help-center Plans category has 13 iOS articles; I did not open them because of the tool-call budget.

## 8. Parallel, compare, footnotes and cross-references

### Takeaway
On iPhone, **Parallel Mode is landscape-only**: rotate the phone, then tap the Parallel icon at the top right. Verse actions work only on the right pane. **Compare** is a list of the selected verse(s) in several versions, reached from the action menu. On the web, footnotes are a 24px icon at 60% opacity inline in the text. They open a popover up to 460px wide and up to 60vh tall that scrolls internally.

### Cited Findings
- **iOS Parallel Mode:** "Rotate the device to landscape… tap the Parallel Mode icon at the top right." Two versions appear side by side. Note, Copy and Share work only on the right pane. Exit by tapping the icon again or rotating back to portrait. — [YouVersion Help: Compare/Parallel iOS](https://help.youversion.com/l/en/article/nxlpf1hcgh-compare-bible-version-ios)
- **iOS Compare:** "displays these comparisons as a list". Edit (top right) reorders; swipe left to delete; "+ ADD VERSION" at the bottom; Close at the top left. — [YouVersion Help: Compare/Parallel iOS](https://help.youversion.com/l/en/article/nxlpf1hcgh-compare-bible-version-ios)
- **2016 Compare:** introduced using "the last few versions that you've read". — [Bible Buying Guide 2016](https://biblebuyingguide.com/youversion-bible-app-significant-update/)
- **Web footnote marker:** `.note:before` draws a 24×24px icon at `opacity:.6` (1 on hover) with 5px margin. Its `#` label is hidden. — [reader CSS](https://www.bible.com/_next/static/chunks/1kkxuxu-rkriu.css)
- **Web footnote body:**
  - `position:absolute; top:100%`, 14px/21px, 15px padding, 5px radius, elevated surface with `shadow-light-2`.
  - `width:calc(100vw - 2.5rem); max-width:460px; max-height:60vh; overflow-y:auto`, a thin 8px scrollbar, hidden by default.
  - `.note.show .body{opacity:1; transform:scale(1)}`, which implies a scale-and-fade reveal.
  - The reference is shown bold (for example "1:5"), followed by the note text. Cross-references inside notes are `.ref[data-usfm]` spans (for example "Gen. 28:12").
  
  — [reader CSS](https://www.bible.com/_next/static/chunks/1kkxuxu-rkriu.css); [bible.com JHN.1 HTML](https://www.bible.com/bible/111/JHN.1.NIV)
- **Web parallel:** the web has `?parallel=<versionId>` routes, and the Parallel button is hidden below 768px. — [bible.com JHN.1 HTML](https://www.bible.com/bible/111/JHN.1.NIV)
- **Footnote toggles:** iOS has a footnotes toggle (You > Settings > Bible Reading); the web has `footnotes` and `numbersTitles` settings. — [iOS Reader Settings](https://help.youversion.com/l/en/article/j2nmx67p54-settings); [settings JS](https://www.bible.com/_next/static/chunks/0r8tr9-rce__k.js)

### Inferences
- YouVersion does not attempt a portrait split view on iPhone. Parallel reading is gated behind rotation, which keeps the portrait reader single-column and uncluttered.

### Gaps
- I found no source for the native footnote popover style (a popover arrow, a sheet, or an inline expansion) or whether parallel panes scroll in sync.

## 9. Haptics

### Takeaway
I found no source (help center, release notes or reviews) that documents where the native app fires haptics. The web reader cannot fire them: there is no `navigator.vibrate` in the bundle, and iOS Safari does not support it anyway.

### Cited Findings
- **No vibration call on the web:** a search across all 33 web JS chunks found no `vibrate` call. — [bible.com JS chunks, e.g.](https://www.bible.com/_next/static/chunks/291mtgegayhux.js)

### Inferences
- Likely native haptic points, all unverified: verse select and deselect (selection feedback), highlight applied (light impact), streak milestone and plan-day completion (success notification), and swatch strip scroll (selection ticks).

### Gaps
- No confirmed native haptic events. This needs on-device testing.

## 10. Dark mode and theme transitions

### Takeaway
Native: picking a reader background color is also the app-wide Light/Dark switch, and "Themes" recolor the whole app. Web: dark mode is a `.dark` class that swaps CSS variables. Canvas becomes `#121212`, the elevated surface becomes gray-45, text becomes `#e8e6e6`, verse numbers become `#a0a0a0`, and shadows deepen to `0 2px 6px #00000073`. No theme cross-fade animation is defined.

### Cited Findings
- **iOS:** "Changing the reader's background color also switches the whole app between Light Mode and Dark Mode." — [iOS Reader Settings](https://help.youversion.com/l/en/article/j2nmx67p54-settings)
- **App Store:** "Themes let you select a color palette for your entire Bible App experience." — [App Store](https://apps.apple.com/us/app/bible/id282935706)
- **2015 release:** "all-new Bible App Theme colors". — [YouVersion blog 2015](https://blog.youversion.com/2015/06/introducing-all-new-youversion-bible-app-for-apple-ios-devices/)
- **Web dark tokens:**
  - `.dark{color-scheme:dark; --color-canvas:var(--color-grayscale-gray-50 /*#121212*/); --color-surface-elevated-primary:var(--color-grayscale-gray-45) …}`.
  - Reader text `#e8e6e6`, base text `#e0e0e0`, labels `#a0a0a0`, copyright `#a0a0a0`, links `#6fa8dc`, selection underline `#aaa`.
  - Toolbar opacity changes from 97% to 95%.
  - Shadow: `--shadow-dark-2:0px 2px 6px #00000073`.
  
  — [reader CSS](https://www.bible.com/_next/static/chunks/1kkxuxu-rkriu.css); [main CSS](https://www.bible.com/_next/static/chunks/120d2unqof6av.css); screenshot `youversion_web_reconstructed_reader_dark.png`
- **No theme fade on the web:** the web CSS has no keyframes for a theme change. The only keyframes are popIn, fadeIn, spin, pulse, toast-enter and toast-leave (translate 400px), scroll-left, spinner-arc and spinner-dot. — [main CSS](https://www.bible.com/_next/static/chunks/120d2unqof6av.css)

### Gaps
- I found no source for the native background color list (white, sepia or tan, gray, black?) or whether the native app cross-fades on theme change.

## 11. User complaints and redesign timeline

### Takeaway
I found no recent Reddit threads with my search tools. Searches for r/Bible and r/Christianity complaints returned nothing indexable. The App Store page shows 4.9★ from about 14M ratings. Visible reviews complain about the reading position not sticking, and about highlights and notes not carrying across versions or translations. Accessibility forums record VoiceOver regressions after updates. The 2026 release stream focuses on accessibility (red-letter colors, verse number size, VoiceOver) and on the passage picker, not on a reader redesign.

### Cited Findings
- **Ratings:** 4.9/5 from about 14M ratings. — [App Store](https://apps.apple.com/us/app/bible/id282935706)
- **Review, 2022:** "The app doesn't seem to stick to what you read last time" (nk_fye, 06/10/2022). — [App Store](https://apps.apple.com/us/app/bible/id282935706)
- **Review, 2025:** notes and highlights "do not carry over from translation or language version" (Kolya290, 09/12/2025). — [App Store](https://apps.apple.com/us/app/bible/id282935706)
- **Review, 2022 (praise):** switching versions "with great ease" while staying on the passage (ParishWon1981, 2022). — [App Store](https://apps.apple.com/us/app/bible/id282935706)
- **Help center:** highlights show only "in the Bible version where the highlight was created". This is the documented cause of the cross-version complaint. — [iOS Highlights](https://help.youversion.com/l/en/article/ie1gz0nsr7-highlights-ios)
- **VoiceOver regression:** after an update, the Read tab could not be reached via the chapter field. — [AppleVis forum](https://www.applevis.com/forum/ios-ipados/problem-latest-update-youversion-bible-app)
- **Timeline, with dates where known:**
  - **2011:** swipe left or right to change chapter; double-tap for full screen. — [YouVersion blog 2011 (snippet)](https://blog.youversion.com/2011/07/updated-bible-app-for-iphone-ipod-touch-ipad-new-bible-reader-features/)
  - **June 2015:** the "All-New Bible App" for iOS, with themes, font and lightness controls, audio speed, ±30s skip, a timer, and double-tap full screen. — [YouVersion blog 2015](https://blog.youversion.com/2015/06/introducing-all-new-youversion-bible-app-for-apple-ios-devices/)
  - **Aug 2016:** a redesigned verse action menu, Compare, and plan discovery. — [Bible Buying Guide](https://biblebuyingguide.com/youversion-bible-app-significant-update/)
  - **About 2017:** Streaks. — [Life.Church](https://openblog.life.church/?p=5768)
  - **Nov 2024 (10.15):** verse-action indicators in the reader. — [Apptopia (snippet)](https://apptopia.com/ios/app/282935706/about)
  - **2026:** 11.29 (Aug 6) recent passages in the picker; 11.30 (Aug 21) redesigned Saved page; 11.31 (Sep 2) Profile/Saved and passage-choosing accessibility; 11.32 (Sep 16) Siri audio and reader VoiceOver; 11.34.x (Oct 14 and 17) accessible red-letter colors and larger verse numbers; 11.35.0 (Oct 28) bug fixes. — [App Store](https://apps.apple.com/us/app/bible/id282935706)
  - **Nov 2025:** YouVersion passed 1 billion installs across its family of Bible apps. — [ChurchLeaders (via search snippet)](https://churchleaders.com/news/503794-youversion-bible-app-breaks-download-record.html)

### Gaps
- No Reddit evidence was gathered: the searches returned no relevant threads. I could not verify user complaints about the 2025–2026 chapter arrows or the chrome.
- I found no dated "reader redesign" in 2025–2026. The reader appears to have evolved through small releases.

## 12. Comparison: ESV Bible app (Crossway) and Dwell

### Takeaway
ESV's reader is typography-first. It offers horizontal *or* vertical paging, a "Reader's Mode" that strips verse numbers and headings, justified text, serif, slab-serif and sans fonts, sepia and night themes, and footnotes and cross-references in a popup box. An early 2010 ESV app advertised "infinite scrolling" through the whole Bible. I could not confirm that the current app still scrolls continuously. Dwell is audio-first. Its "Read Along" scrolls the text in sync with the narrator (improved again in Oct 2026). Since Sep 2025 its Read mode scrolls continuously from one **book** to the next. A Selah button pauses the voice but keeps the music playing.

### Cited Findings
- **ESV 2015 redesign:** "Toggle between horizontal and vertical page scrolling". Reader's Mode "pulls out verse numbers and chapter headings". Fonts: "serif, slab serif, sans serif". Justified text. "sepia theme and updated night theme". "View cross-references and footnotes in a popup box". Verse-by-Verse Mode. A two-column study view. — [Crossway, Apr 13 2015](https://www.crossway.org/blog/2015/04/introducing-the-new-esv-bible-app/)
- **ESV FAQ:** "split-screen reading", "a brand new reader's mode", "all-new typography", notes and highlights that sync with ESV.org. — [Crossway ESV iOS FAQ](https://www.crossway.org/articles/esv-bible-for-ios-faq/)
- **ESV 2010:** the early iPhone app advertised "Infinite scrolling through the entire Bible". — search-result summary; primary page not fetched ([Frontgate Media listing, unverified](https://www.frontgatemedia.com/171/))
- **Dwell Read Along:** "follow the text as it scrolls in sync with the narrator". — [Dwell App Store](https://apps.apple.com/us/app/dwell-audio-bible/id1343917374)
- **Dwell 2026.10.1 (Oct 15, 2026):** "smoother Read Along scrolling", progress bars and a "last listened" date on plans. — [Dwell App Store](https://apps.apple.com/us/app/dwell-audio-bible/id1343917374)
- **Dwell 2026.9.2 (Sep 16, 2026):** the menu bar "now stays visible while using Read Along"; Sleep Timer and Speed are available directly in the player; the timer can stop at the end of a chapter, book or experience. — [Dwell App Store](https://apps.apple.com/us/app/dwell-audio-bible/id1343917374)
- **Dwell 2025.9.2 (Sep 4, 2025):** "In Read mode, scrolling up or down moves to the next or previous Scripture Book"; a Play/Resume button in the Bible tab header. — [Dwell App Store](https://apps.apple.com/us/app/dwell-audio-bible/id1343917374)
- **Dwell 2026.7.1 (Jul 24, 2026):** a Selah button (pauses narration while the background music continues) and Repeat (loops a passage). — [Dwell App Store](https://apps.apple.com/us/app/dwell-audio-bible/id1343917374)
- **Dwell review:** "a beautifully designed app"; "like Spotify for the Bible"; voices across 7 English translations; Repeat for memorization; a "Reflect" pause. — [Tim Wildsmith review](https://timwildsmith.com/reviews/dwell-app)

### Inferences
- Three approaches to chapter boundaries:
  - YouVersion: discrete chapters with floating buttons.
  - ESV: user-chosen paging axis, historically infinite scroll.
  - Dwell: continuous scroll within a book, with a gesture to cross to the next book.
- Dwell's "menu bar stays visible during Read Along" release note implies that the chrome used to auto-hide during auto-scroll, which users found disorienting. Keep the controls visible while the text moves by itself.

### Gaps
- I could not confirm whether the 2026 ESV app has continuous cross-chapter scrolling, or how its chapter boundary looks (a heading or a divider).
- I found no source for Dwell's Read Along highlight style (current verse versus current line) or its scroll easing.

## 13. Implications for Pager (WKWebView + React reader, SwiftUI shell)

### Takeaway
Most of what makes YouVersion pleasant can be built in the web layer: sticky floating chapter buttons, a dotted-underline selection, a 150ms slide-up action sheet, a 750ms highlight fade, size presets paired with column widths, root-attribute focus mode, and capped scrollable footnote popovers. Native help is needed only for haptics, for hiding the status bar and home indicator in focus mode, and for lock-screen audio controls if Pager adds audio.

### Cited Findings (patterns to copy, with build notes)
- **Floating prev/next section buttons (scroll view)** — web tech. — [web pattern](https://www.bible.com/_next/static/chunks/2jxxevxe-azgb.js)
  - Use a `position:sticky; bottom: calc(var(--footer-h) + 16px)` container with `pointer-events:none`, holding two `pointer-events:auto` 48px buttons with 12px radius, inset 16px.
  - Put the container after each chapter or section so the buttons float during reading and come to rest at the end.
  - Show a spinner only after 150ms (`transition-delay:150ms`).
  - In paginated mode, use edge taps or swipes instead.
- **Selection and action sheet** — web tech.
  - Tap a paragraph or sentence to get a dotted 1px underline.
  - The sheet slides up with `transform: translateY(calc(100% + 24px))` → `0`, 150ms `cubic-bezier(.4,0,.2,1)`, and is `inert` when hidden.
  - If the tapped element's top is within about 350px of the viewport bottom, `scrollIntoView({block:'center', behavior:'smooth'})`.
  - Show most-recent colors first, as a horizontally scrolling swatch strip with 44px pitch.
  - This fits Pager's existing text-selection menu and annotation popover. — [web pattern](https://www.bible.com/_next/static/chunks/291mtgegayhux.js)
- **Highlight fade** — web tech. Use `transition: background-color .75s cubic-bezier(.42,1,.16,.93)` and auto black or white text from a brightness/contrast formula. — [reader CSS](https://www.bible.com/_next/static/chunks/1kkxuxu-rkriu.css)
- **Reading settings** — web tech.
  - Use discrete size presets, each paired with a column max-width (for example 550, 600, 700px), so the measure stays constant on iPad.
  - Line-height about 1.8 for serif body text.
  - Verse or section numbers small and raised with `position:relative; top:-.6em`, so they do not disturb line spacing.
  - Preserve the reading position when the size changes:
    1. Before applying the change, record the first visible block (via `document.elementFromPoint` or a CSS pagination column index) and its offset ratio.
    2. Apply the change.
    3. Restore the position in `requestAnimationFrame`.
  
  Do not rely on CSS `overflow-anchor`: WebKit's support has historically been missing, so verify it on current iOS. In paginated mode, re-paginate and jump to the page that contains the anchor. — Inference from [settings JS](https://www.bible.com/_next/static/chunks/0r8tr9-rce__k.js), which shows no anchoring
- **Chrome hide on scroll** — web tech if the bars live in React. — Inference from [iOS help](https://help.youversion.com/l/en/article/j2nmx67p54-settings)
  - Hide the top bar on downward scroll past a small threshold.
  - Show it on upward scroll, at the top of a section, or on tap.
  - If the SwiftUI shell owns any bar, it needs a bridge message (`WKScriptMessageHandler`) with the scroll direction.
  - Keep the chrome visible during any auto-scroll (Dwell's lesson). — [Dwell release notes](https://apps.apple.com/us/app/dwell-audio-bible/id1343917374)
- **Focus mode** — mostly web tech.
  - One attribute (`data-focus`) on the root drives CSS such as `:root:has([data-focus]) { --tabbar-h:0 }`, plus `visibility:hidden` for the floating buttons (no layout shift), `display:none` for bars, and Esc or tap to exit.
  - **Native help needed:** hiding the status bar and home indicator (`prefersStatusBarHidden`, `prefersHomeIndicatorAutoHidden`) through the bridge. `requestFullscreen` does not work for a page in WKWebView on iPhone the way it does on desktop.
  
  — [focus-mode JS](https://www.bible.com/_next/static/chunks/36ribu1licvns.js); [main CSS](https://www.bible.com/_next/static/chunks/120d2unqof6av.css)
- **Footnote and endnote popovers** — web tech. Use `width: calc(100vw - 2.5rem); max-width:460px; max-height:60vh; overflow-y:auto`, a scale and opacity reveal, and tap (not hover) to open on iOS. This maps to EPUB `epub:type="noteref"` links. — [reader CSS](https://www.bible.com/_next/static/chunks/1kkxuxu-rkriu.css)
- **Continuous scrolling across chapters or spine items** (Android YouVersion setting, ESV, Dwell) — web tech. Lazy-mount neighboring EPUB spine documents with IntersectionObserver in Pager's scroll view, and offer it as a setting, as YouVersion Android does. — [Android help](https://help.youversion.com/l/en/article/mya0fknmzo-bible-settings-android)
- **Haptics** — **needs native help.**
  - Define a JS bridge `window.webkit.messageHandlers.haptic.postMessage({type:'selection'|'light'|'success'})`, mapped to `UISelectionFeedbackGenerator`, `UIImpactFeedbackGenerator` and `UINotificationFeedbackGenerator`.
  - WKWebView has no `navigator.vibrate`.
  - Use it on selection start, highlight applied, and section or goal completion.
  
  — Inference (no YouVersion source)
- **Keyboard shortcuts (iPad with a hardware keyboard)** — web keydown works in WKWebView.
  - YouVersion's map: → / ← for next and previous (flipped in RTL), `b` for the picker, `f` for focus, `/` for search, `?` for help, `Esc` to exit.
  - Shortcuts are ignored when a dialog is open or when the key is auto-repeating.
  - Optionally mirror them as native `UIKeyCommand` entries so they show in the ⌘-hold overlay. — [hotkey map](https://www.bible.com/_next/static/chunks/36ribu1licvns.js)
- **Reduced motion** — web tech. Add `@media (prefers-reduced-motion: reduce)` to disable sheet and fade transitions, as YouVersion's `motion-reduce:transition-none` does. WKWebView reflects the iOS Reduce Motion setting. — [main CSS](https://www.bible.com/_next/static/chunks/120d2unqof6av.css)

### Inferences
- The highest-value, lowest-cost items to copy are the sticky floating section buttons, the dotted-underline selection with the 350px keep-visible rule, and the "recent colors first" swatch strip. All three fit Pager's existing selection menu and annotation popover.

### Gaps
- None of the native motion values (sheet springs, chrome fade timing) are known. On-device screen recording of YouVersion 11.35 would be needed to match them exactly.
