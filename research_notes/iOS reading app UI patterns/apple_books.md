# Apple Books (iOS) reader: UI and micro-interaction teardown

Scope note on dating. Today is 2026-10-28. Apple's iPhone User Guide now defaults to **iOS 27** and lists iPhone Duo (a foldable). The guide's version picker shows iOS 27, 26, 18, 17, 16 ([Apple, Read books, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios)). So the current app is the iOS 27 era, not iOS 26. A further reader redesign is in **iOS 27.2 beta 3**, which is not yet released ([9to5Mac, 2026-10-06](https://9to5mac.com/?p=1072973)). Below, "iOS 26" means the 2025-2026 release and "current" means iOS 27 / 27.2 beta. I diffed the Apple Support "Read books" page across the iOS 17, 18, 26 and 27 versions. This gives a primary-source changelog that the press did not cover.

Method limits. I had no device. Apple publishes no motion specs for Books: no durations, spring parameters or haptic map. Every motion detail below that has no citation is marked as inference or recollection. It needs a hands-on check with a screen recording.

---

## 1. Version timeline: what changed in iOS 16, 16.2, 16.4, 17, 18, 26, 27 and 27.2

### Takeaway
iOS 16 (Sept 2022) replaced the top toolbar with one always-visible bottom-corner menu button. Later releases mostly undid its pain points: Curl came back in 16.4, brightness and margins came back by iOS 17/18, and the bookmark moved out of the menu in 27. iOS 27.2 beta 3 (Oct 2026) changes the reader again. It uses a standard Liquid Glass menu, a separate bookmark button, a close button at top-left, a larger back button and visible progress bars. I found no evidence that iOS 26 itself changed the reader layout.

### Cited Findings
- **iOS 15 and earlier (old model):** the top toolbar could be summoned or dismissed with a tap ([TidBITS](https://tidbits.com/2022/10/03/apples-books-ios-16/)). The page turn was a skeuomorphic curl. There was a single dark theme plus an "Auto-Night Theme" toggle. You closed a book with a back "<" button in the options ([Gadget Hacks](https://ios.gadgethacks.com/how-to/20-big-new-features-and-changes-coming-apple-books-your-iphone-0385075)).
- **iOS 16.0 (Sept 2022):** UI moved from the top to the bottom, "the Safari treatment". The redesign added a single button that reveals a menu, which MacStories called "a completely new element that has no precedent on iOS" ([MacStories](https://www.macstories.net/stories/ios-16-the-macstories-review/10)). Curl was replaced with "a simple-looking swipe animation" and there was no option to restore it. Six themes arrived. Double-tap to bookmark was added. Swipe-down-to-close was added. The brightness slider was removed ([Gadget Hacks](https://ios.gadgethacks.com/how-to/20-big-new-features-and-changes-coming-apple-books-your-iphone-0385075)).
- **iOS 16.2:** double-tap-to-bookmark was effectively replaced by a menu path. A critic called the result "a three-step process … still bad, just a different kind of bad" ([BasicAppleGuy](https://basicappleguy.com/basicappleblog/build-a-better-books)). One TidBITS commenter reported "The double tap to add a bookmark is no longer working for me?" ([TidBITS](https://tidbits.com/2022/10/03/apples-books-ios-16/)).
- **iOS 16.4 (beta 2, 2023-02-28):** a page-effect picker arrived with Slide, Curl and None, and "Curl" became the default ([9to5Mac, 2023-03-01](https://9to5mac.com/?p=868348); [MacRumors](https://www.macrumors.com/2023/02/28/ios-16-4-apple-books-page-turning-animation)).
- **iOS 17:** the guide calls the control the "Page Turn Style Curl button" and lists Scroll as a page-turn option. It adds "Adjust the display brightness: Touch the brightness bar", so a brightness control is back in Themes & Settings. Customize has line, character and word spacing, with **no margins** ([Apple, iOS 17](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/17.0/ios/17.0)).
- **iOS 18:** the page-turn options are listed as "Curl, Fast Fade, or Scroll". Customize sliders now include **margins**. **Line Guide** appears in the guide (it is not in the iOS 17 guide). Swiping down closes the Themes & Settings menu ([Apple, iOS 18](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/18.0/ios/18.0)). The press called Books "largely unchanged from iOS 17" except for Price Drop notifications ([9to5Mac iOS 18 Books, search snippet](https://9to5mac.com/?p=958984)).
- **iOS 26:** the reader text in the guide is nearly the same as iOS 18. Differences: the Bold Text and Done steps now use icon images, and the guide no longer says "or swipe down to close the menu" ([Apple, iOS 26](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/26/ios/26)). Books had not adopted the new iOS 26.4 Apple Account design ([9to5Mac, 2026-04-17](https://9to5mac.com/2026/04/17/ios-26-4-revamps-apple-account-pages-inside-apps-with-new-design/)). iOS 26.1 added a way to reduce Liquid Glass transparency and a "Tinted" option, system-wide ([BGR](https://bgr.com/2070522/ios-26-2-fixed-liquid-glass-new-settings-options/)).
- **iOS 27 (current guide):** "Undo Page Skip button in the bottom-left corner" replaces the top-left and top-right rounded arrows. The progress line now reads "drag the slider at the bottom of the page", where earlier versions said "touch and hold Contents". The bookmark is a "Bookmark Ribbon" that you tap directly with no Menu step. Bookmarks and Highlights now live under **Contents** (formerly the "Bookmarks & Highlights" menu item). The guide no longer mentions swipe-down-to-close or Reading Menu Position. On iPhone Duo in landscape there is an Appearance button "on the outer edge" ([Apple, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios)).
- **iOS 27.2 beta 3 (2026-10-06):** "Progress bars are now available to track your reading location". The bottom-right menu has a new three-dot icon and is "a standard Liquid Glass menu for consistency with other apps". Bookmark became a standalone upper-right button. The X close button moved to the upper-left. The Back button moved to the lower-left and is larger. 9to5Mac thinks the iPhone Duo was the likely motive ([9to5Mac, 2026-10-06](https://9to5mac.com/?p=1072973); [9to5Mac roundup, 2026-10-22](https://9to5mac.com/?p=1075324)).

### Inferences
- The iOS 27 guide already describes several 27.2-beta items: a bottom slider, a bottom-left undo button and a standalone bookmark ribbon. Either Apple updated the guide ahead of 27.2, or part of the change shipped in 27.0. I cannot tell which from the sources.
- The 27.2 change replaces Books' custom floating menu with a stock `UIMenu`/SwiftUI `Menu` in Liquid Glass. The bespoke "menu item doubles as a slider" behavior of iOS 16-26 is probably gone, and the separate bottom slider takes its place.

### Gaps
- I found no source that describes iOS 26-specific reader visuals, such as whether the menu button or panel used Liquid Glass in 26.0.
- I could not verify that swipe-down-to-close was removed in iOS 27. The only claim is an unverified commenter on 9to5Mac. The guide simply stopped mentioning it.

---

## 2. Page turning, tap zones, Scroll mode, chapter boundaries

### Takeaway
Paging is a horizontal swipe or a tap in the right or left margin. A tap on the middle of the page toggles chrome. "Both Margins Advance" lets both margins go forward. Current styles are Curl (default since 16.4), Fast Fade and Scroll, with Slide and None in the 16.4 set. Under Reduce Motion, the "None" style drops even its cross-fade.

### Cited Findings
- "Turn the page: Tap the right margin or swipe right to left … Go back to the previous page: Tap the left margin or swipe left to right." ([Apple, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios))
- "To allow either the left or right margin to turn the page, go to Settings > Apps > Books, then turn on Both Margins Advance." ([Apple, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios))
- Tapping the page (not a margin) brings up chrome: "Tap the page, then tap [Menu]" is the start of every navigation action ([Apple, iOS 26](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/26/ios/26)).
- Page-turn picker in iOS 18 and 26: "Tap [the Page Turn button], then tap Curl, Fast Fade, or Scroll." ([Apple, iOS 18](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/18.0/ios/18.0)). In iOS 27 the list is not spelled out: "tap an option" ([Apple, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios)).
- The 16.4 options were Slide, Curl and None. Curl was "the older realistic page-turning effect". Slide was "the simple effect introduced by iOS 16". None "is a misnomer since a slight cross-fade transition exists". With Reduce Motion on and the effect set to None, the cross-fade is removed. "Prefer Cross-Fade Transitions" did not affect Books page turns before 16.4 ([Gadget Hacks](https://ios.gadgethacks.com/how-to/get-page-turning-curl-animation-back-apple-books-for-iphone-and-ipad-0385329)).
- The page-turn control is "the page icon with the bent corner" next to the appearance button in Themes & Settings ([9to5Mac](https://9to5mac.com/?p=868348)).
- iOS 16 made vertical scrolling "a small icon button under Themes & Settings instead of a large toggle" ([Gadget Hacks](https://ios.gadgethacks.com/how-to/20-big-new-features-and-changes-coming-apple-books-your-iphone-0385075)). TidBITS says "Vertical scrolling is the default" in iOS 16 ([TidBITS](https://tidbits.com/2022/10/03/apples-books-ios-16/)). This conflicts with the rest of the coverage, which treats paged turning as normal, so treat the TidBITS claim with caution.
- In Scroll mode (iOS 16), "a position slider on the right shows progress", and you can "drag it to navigate within the book quickly". The Contents control works as a slider in paged mode but only as a button in scroll mode ([TidBITS](https://tidbits.com/2022/10/03/apples-books-ios-16/)).
- Swipe-down-to-close was "not available if vertical scrolling is on" (iOS 17-26), because the vertical gesture belongs to the scroll view ([Apple, iOS 26](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/26/ios/26)).
- PDFs, manga and fixed-layout books use a separate switch: "tap the Appearance button, then turn on Vertical Scrolling" ([Apple, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios)).
- In Line Guide mode, margin taps move the guide line instead of turning the page: "Tap the left or right page margin to move the line guide up or down (not available if vertical scrolling is on)" ([Apple, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios)).

### Inferences
- **"Fast Fade" probably replaces the 16.4 "None"**, which was really a short cross-fade. Apple renamed it to say what it does. I did not verify whether "Slide" survives in iOS 18 and later. Apple's lists name only Curl, Fast Fade and Scroll, but the lists may be incomplete.
- **Curl following the finger** (platform knowledge, not verified for Books this session): UIKit's `UIPageViewController` with `.pageCurl` gives an interactive curl. The page corner tracks the touch point, the fold angle depends on where the finger is vertically, and releasing past about half the width finishes the turn, otherwise it springs back. Books' curl looks like this behavior. A margin tap plays the same curl without user tracking.
- **Tap-zone widths** are not documented. From recollection, the margin tap zones are narrow strips at the left and right edges, and the centre toggles chrome. Measure on a device before copying.
- **Chapter boundaries:** in paged mode each EPUB spine item starts on a fresh page, so a chapter's last page may be short. Scroll mode is described as "infinite scrolling" ([Gadget Hacks search snippet](https://ios.gadgethacks.com/how-to/apple-books-just-got-its-biggest-iphone-update-years-0385075)), which suggests continuous scrolling across chapters. I did not confirm whether there is a visible separator or a pause at the boundary.

### Gaps
- No source gives page-turn durations, the curl's shading or back-of-page rendering (in Books the back of the curled page shows a faint mirror of the text, from recollection), or the swipe velocity threshold.
- No source documents the Fast Fade duration or whether Scroll mode snaps at chapter ends.

---

## 3. The reading menu (iOS 16-26), the 27.2 Liquid Glass menu, and chrome hiding

### Takeaway
From iOS 16 to 26 the reader had an always-on corner button: two lines over an ellipsis, bottom-right by default, with a Left option. It opened a floating stack of rows: Contents with % progress (also a hold-and-drag scrubber), Search Book, Themes & Settings, and a row of icon buttons for Share, Orientation Lock and Bookmark. The status bar hides while you read and appears with the menu. Critics disliked the button that never hides and its small hit target. iOS 27.2 replaces it with a stock three-dot Liquid Glass menu.

### Cited Findings
- Menu icon: "two horizontal lines with an ellipsis (•••) beneath them. It is always visible and cannot be hidden." Items: "Contents," "Bookmarks & Highlights," "Themes & Settings," share book, lock orientation ([Gadget Hacks](https://ios.gadgethacks.com/how-to/20-big-new-features-and-changes-coming-apple-books-your-iphone-0385075)).
- Menu contents per TidBITS: Contents, Search Book, Themes & Settings, Share, Lock Orientation, Bookmark. "The button can't be made to go away with a tap or slide, even temporarily." ([TidBITS](https://tidbits.com/2022/10/03/apples-books-ios-16/))
- "Reading Menu Position" in Settings > Books has Left and Right ([Apple, iOS 26](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/26/ios/26); [Gadget Hacks](https://ios.gadgethacks.com/how-to/20-big-new-features-and-changes-coming-apple-books-your-iphone-0385075)).
- "The bookmark icon now sits on top of that menu button" in iOS 16, meaning a bookmarked page is shown on or above the menu button ([Gadget Hacks](https://ios.gadgethacks.com/how-to/20-big-new-features-and-changes-coming-apple-books-your-iphone-0385075)).
- Status bar: "By default, Books hides it while reading and shows it when the reading menu opens". The "Show Status" setting keeps it visible ([Gadget Hacks](https://ios.gadgethacks.com/how-to/20-big-new-features-and-changes-coming-apple-books-your-iphone-0385075)). TidBITS adds that this setting stops text from vanishing under the notch or Dynamic Island ([TidBITS](https://tidbits.com/2022/10/03/apples-books-ios-16/)).
- Menu and close button overlap the text: Books "always displays the Reading Menu and close button" over the text (TidBITS commenter Jochen Wolters). Another commenter calls it "the always-on chrome, which I find intrusive" ([TidBITS](https://tidbits.com/2022/10/03/apples-books-ios-16/)).
- The button is "nearly impossible to select", with an estimated ~50% hit rate on iPhone. The Contents row "looks like a button, but functions like a slider". Reaching Highlights took four steps ([BasicAppleGuy](https://basicappleguy.com/basicappleblog/build-a-better-books)).
- iOS 27: "You may need to tap the page to display the Menu button (or the Appearance button)" ([Apple, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios)). The iOS 18 and 26 guides say "You may need to tap the page for the Menu button to appear" ([Apple, iOS 26](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/26/ios/26)). This suggests the button does fade out in some states in later versions, which contradicts the iOS 16-era "always visible" reports.
- iOS 27.2: three-dot icon, "a standard Liquid Glass menu", bookmark taken out of the menu ([9to5Mac](https://9to5mac.com/?p=1072973)).

### Inferences
- **Menu animation (recollection, not sourced):** in iOS 16-26 the menu grows out of the corner button. It is a rounded floating panel that scales and fades in with its anchor at the button corner, using a spring with slight overshoot. The page behind stays visible and is not dimmed or only lightly dimmed. Tapping outside collapses it back into the button. iOS 27.2's stock Liquid Glass menu would use the system menu morph: the glass button stretches into the menu. Rebuild it as a scale-and-opacity spring from `transform-origin: bottom right`, roughly 0.35-0.45 s with light damping. That number is a design guess, not a measurement.
- From iOS 18 on, a tap on the page seems to toggle the close button, back arrows, page number and menu together. In iOS 16 some chrome stayed pinned.

### Gaps
- No source gives the button's size, the menu's corner radius or blur material, or the open and close durations.
- I found no source on whether the menu items stagger in.

---

## 4. Themes & Settings sheet

### Takeaway
A bottom sheet with: A- / A+ size buttons, a page-turn icon button, a Light/Dark/auto mode button, a brightness bar (back by iOS 17), and a grid of six preset themes: **Original, Quiet, Paper, Bold, Calm, Focus**. Then "Customize" opens font, Bold Text, and under "Accessibility & Layout Options" a Customize switch. It unlocks line, character and word spacing, margins (iOS 18+), Justify Text and Allow Multiple Columns. Each theme stores its own customizations, and "Reset Theme" reverts them. The page behind updates live.

### Cited Findings
- Themes: "Original, Quiet, Paper, Bold, Calm, and Focus". Paper, Bold and Focus were new in iOS 16. "Settings are remembered per theme." ([Gadget Hacks](https://ios.gadgethacks.com/how-to/20-big-new-features-and-changes-coming-apple-books-your-iphone-0385075)). New color options include "a lighter gray, a light yellow and a different shade of white" (search snippet of [Gadget Hacks](https://ios.gadgethacks.com/how-to/apple-books-just-got-its-biggest-iphone-update-years-0385075)).
- Themes "combine font, size, color, and background" and are "the only way to change background color" ([TidBITS](https://tidbits.com/2022/10/03/apples-books-ios-16/)).
- Labels in the sheet (iOS 18-27): "Tap the large A to increase the font size or tap the small A to decrease it." Page Turn button. "Adjust the background mode: Tap [the Appearance Options Light button], then tap an option." "Touch the brightness bar, then drag your finger in either direction." "Change the page theme: Tap a page theme such as Quiet or Bold." ([Apple, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios))
- Fonts: "Tap Customize, then tap Font. Swipe up to view the font options. Tap a font name, such as Original or Palatino, to see a preview at the top of the screen. Tap Done to apply the font." ([Apple, iOS 18](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/18.0/ios/18.0)). Customize has "A preview paragraph … at the top, followed by a font selector and a bold text option" ([Gadget Hacks](https://ios.gadgethacks.com/how-to/20-big-new-features-and-changes-coming-apple-books-your-iphone-0385075)).
- Spacing: "Tap Customize, then below Accessibility & Layout Options, turn on Customize. Drag the sliders left or right to adjust line spacing, character spacing, word spacing, and margins. You can also turn Justify Text on or off." ([Apple, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios)). The iOS 17 version has no margins ([Apple, iOS 17](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/17.0/ios/17.0)). iOS 16 also had "Allow Multiple Columns" and "Full Justification" (moved from Settings > Books). "With Full Justification on, word spacing changes only slightly". Margins "cannot be changed" in iOS 16 ([Gadget Hacks](https://ios.gadgethacks.com/how-to/20-big-new-features-and-changes-coming-apple-books-your-iphone-0385075)).
- "To undo text and layout customizations, tap [Menu] … tap Customize, then tap Reset Theme." ([Apple, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios))
- Closing: "Tap [the Close button] or swipe down to close the menu" (iOS 17-18). iOS 26 and 27 mention only the Close button ([Apple, iOS 18](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/18.0/ios/18.0); [Apple, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios)).
- MacStories (iOS 16): a sheet "at the bottom of the screen with multiple themes" and a nested Options page where you "preview your changes inline" ([MacStories](https://www.macstories.net/stories/ios-16-the-macstories-review/10)).
- iOS 16 removed the brightness slider ("Use Control Center instead") ([Gadget Hacks](https://ios.gadgethacks.com/how-to/20-big-new-features-and-changes-coming-apple-books-your-iphone-0385075)). A reader missed being able to "set the brightness while reading separately from the system brightness" ([TidBITS](https://tidbits.com/2022/10/03/apples-books-ios-16/)). By iOS 17 the brightness bar was back ([Apple, iOS 17](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/17.0/ios/17.0)).
- Spacing controls were praised: they "help improve my reading speed and overall experience" ([BasicAppleGuy](https://basicappleguy.com/basicappleblog/build-a-better-books)). One complaint: font size resets and the book sometimes opens on the wrong page (TidBITS commenter crun, [TidBITS](https://tidbits.com/2022/10/03/apples-books-ios-16/)).

### Inferences
- **Detents (recollection):** the sheet opens at about half height so the top half of the page stays visible and reflows live behind it. Customize pushes a second page inside the same sheet with its own preview paragraph. This fits iOS 15+ `UISheetPresentationController` with a `.medium` detent and an undimmed background. Only the "preview at the top of the screen" wording and "swipe down to close" are confirmed.
- **Font-size steps:** A- and A+ are discrete steps, not a slider. I found no source for the step count or the point sizes.
- **Position on reflow:** Books seems to keep the current passage on screen when you change size or theme. TidBITS's "opens on the wrong page" complaint shows that anchoring is not perfect.
- Each of the six presets is a font plus a weight, spacing and color bundle. Per-theme memory means Customize edits a theme, not a global style.

### Gaps
- No source gives the hex colors or fonts of each preset. My recollection: Original is serif on white, Quiet is grey-tinted, Paper is a textured off-white, Bold is heavier weight, Calm is sepia/cream, Focus is a warm cream with a serif. Check this against the screenshots folder.
- I found no source confirming that the reading position is kept on reflow, and no source on the sheet's exact detent heights.

---

## 5. Progress: page number, "pages left in chapter", scrubber, Contents

### Takeaway
iOS 16-26 kept progress almost invisible. A small page number sits at the bottom. A tap, or opening the menu, shows "pages left in chapter" at the top, and the Contents menu row shows % read. Scrubbing was a hidden gesture: touch and hold Contents, then drag sideways. iOS 27 / 27.2 makes it explicit with a bottom slider and progress bars.

### Cited Findings
- "With the menu open, pages left in the chapter appear where the book name used to be. With the menu closed, tapping the current page number at the bottom temporarily reveals that count." "The 'Contents' button shows progress as a percentage." ([Gadget Hacks](https://ios.gadgethacks.com/how-to/20-big-new-features-and-changes-coming-apple-books-your-iphone-0385075))
- Opening the menu shows "a subtle indicator at the top with pages left in the chapter". Tapping the screen shows that plus a "page X of Y" indicator at the bottom. These are "harder to read over the text" ([TidBITS](https://tidbits.com/2022/10/03/apples-books-ios-16/)).
- Scrubber (iOS 17-26): "To quickly move through a book, touch and hold Contents, then drag your finger left or right; release your finger to go directly to that location in the book." ([Apple, iOS 26](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/26/ios/26))
- Scrubber (iOS 27): "drag the slider at the bottom of the page left or right to go to a specific page or chapter" ([Apple, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios)). In 27.2 beta, "Progress bars are now available to track your reading location" ([9to5Mac](https://9to5mac.com/?p=1075324)).
- Critique: scrubbing moved into a "considerably miniaturized pseudo button" that "looks like a button, but functions like a slider" ([BasicAppleGuy](https://basicappleguy.com/basicappleblog/build-a-better-books)).
- Contents now holds the Bookmarks and Highlights tabs (iOS 27). "Tap a highlight to go to that location in the book." ([Apple Annotate, iOS 27](https://support.apple.com/guide/iphone/annotate-books-iph17bf340c1/27/ios/27))

### Inferences
- Scrubber preview (recollection): while dragging, a label shows the target page and chapter title. The page itself does not change until you release ("release your finger to go directly to that location" supports commit-on-release). The Contents list highlights or marks the current chapter. I did not verify this.

### Gaps
- No source describes what the scrubber preview looks like or what the 27.2 progress bars contain (per-chapter or whole-book), or where they sit.

---

## 6. Opening and closing a book; back-to-page after jumps

### Takeaway
Tap a cover and the book opens. From iOS 16 to 26 you closed it with an X at top-right or a swipe down from the top of the page (not in Scroll mode). In 27.2 the X moves to top-left. After any jump, a "return" control appears: rounded arrows with page numbers at top-left and top-right in iOS 16-26, and a larger "Undo Page Skip" button at bottom-left in iOS 27.

### Cited Findings
- "Close a book: Tap the page, then tap [the Close button] in the top-right corner. Or swipe down from the top of the page (not available if vertical scrolling is on)." ([Apple, iOS 26](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/26/ios/26))
- iOS 27 guide: "Close a book: Tap the page, then tap [the Close button]." There is no position and no swipe ([Apple, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios)). In 27.2 the X moves to the upper-left ([9to5Mac](https://9to5mac.com/?p=1075324)).
- Back after jump (iOS 16-26): "Tiny numbers with arrows appear in the top left and top right, returning you to your previous page after you jump ahead or back" ([Gadget Hacks](https://ios.gadgethacks.com/how-to/20-big-new-features-and-changes-coming-apple-books-your-iphone-0385075)). "Tap the rounded arrow in the top-left corner of the page. Tap the rounded arrow again, but in the top-right corner, to go back to your current location." ([Apple, iOS 26](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/26/ios/26))
- iOS 27: "Tap the page, then tap [the Undo Page Skip button] in the bottom-left corner of the page. Tap the rounded arrow again to go back to your current location." ([Apple, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios)). In 27.2 the Back button is in the lower-left and larger ([9to5Mac](https://9to5mac.com/?p=1072973)).
- "When you close a book, your place is saved automatically" ([Apple, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios)).

### Inferences
- **Cover-to-page zoom (recollection):** the tapped cover scales up from its library position to full screen and cross-fades into the first or current page. Closing reverses it. The page shrinks back into the cover's slot. During a swipe-down close, the page follows the finger, shrinks and rounds its corners, and a release past a threshold finishes the close with a spring. This matches the SwiftUI iOS 18 `.navigationTransition(.zoom(sourceID:in:))` behavior, which gives interactive drag-to-dismiss. I did not confirm that Books uses that API.
- The return control is a two-state toggle (back to the origin, then forward to the jump target). It keeps a single pair of positions, not a history stack.

### Gaps
- No source gives the zoom duration, the dismissal threshold or the spring parameters.
- I could not confirm whether swipe-down-to-close still exists in iOS 27.

---

## 7. End of book and Reading Goals

### Takeaway
Reading Goals tracks daily minutes (default **5 min/day**) and books per year (default **3**). It celebrates streak records with notifications and lists finished covers under "Books Read This Year". "Mark as Finished" lives in the book's More menu. I found **no source** that describes the end-of-book screen or any confetti or animation for goals.

### Cited Findings
- "If you don't customize your daily reading goal, it's set to 5 minutes per day." You change it with Home → reading goals button → tap the timer → "Adjust Goal" → "Slide the counter up or down" ([Apple Reading Goals, iOS 27](https://support.apple.com/en-us/guide/iphone/set-reading-goals-iph6013e96f4/ios)).
- "After you finish a book, the cover is displayed below Books Read This Year. The default yearly reading goal is three books per year." Empty slots are "cover placeholder[s]" ([Apple Reading Goals, iOS 27](https://support.apple.com/en-us/guide/iphone/set-reading-goals-iph6013e96f4/ios)).
- "Books sends you notifications when you achieve a reading goal or set a reading streak." There are separate "Coaching" ("encouragement and nudges") and "Goal Completion" notification toggles. "Include PDFs" counts PDFs toward the goal. Settings also has "Clear Reading Goals Data" ([Apple Reading Goals, iOS 27](https://support.apple.com/en-us/guide/iphone/set-reading-goals-iph6013e96f4/ios)).
- On the Mac, Books tracks consecutive goal days and notifies you on a new record. You can "Click the notification to get more details about your achievement, or send your achievement to friends." ([Apple, Books for Mac](https://support.apple.com/guide/books/ibks7c41beea/mac))
- "Mark as Finished": "Tap [the More Info button] below a book or audiobook cover, then tap Mark as Finished." ([Apple Reading Goals, iOS 27](https://support.apple.com/en-us/guide/iphone/set-reading-goals-iph6013e96f4/ios)). In iOS 17 one user found Rate and Review replaced by Mark as Finished in that menu ([Apple Community](https://discussions.apple.com/thread/255651361)).
- The Home widget shows the current book, minutes read today and weekly progress ([MacStories](https://www.macstories.net/stories/ios-16-the-macstories-review/10)). A "Year in Review" experience launched in Nov 2023 ([MacRumors](https://www.macrumors.com/2023/11/28/apple-books-year-in-review-feature/)).

### Inferences
- **End-of-book screen (recollection, unverified):** after the last page, Books shows a "finished" card with the cover, a rating or review prompt, "Mark as Finished", and store recommendations such as more by the author. In recent versions finishing also adds the book to Books Read This Year. Check on a device before relying on this.
- **Goal celebration (recollection, unverified):** the daily-minutes ring fills on Home. Hitting the goal shows an in-app banner or notification. I have no evidence of confetti or haptics.

### Gaps
- No source on the end-of-book UI, confetti, animation or haptics for goal completion or streaks, or the visual design of the minutes ring.

---

## 8. Text selection, highlighting, notes, Highlights list

### Takeaway
Long-press selects with system grab points. The edit menu leads with **Highlight, Add Note, Translate**, and a ">" (Forward) arrow reveals Translate, Search, Copy and Share. Highlight opens color swatches plus an underline option. Tapping an existing highlight reopens the menu with Highlight (to recolor) and Remove. Removing a highlight that has a note asks "Remove Note" or "Remove Highlight & Note". All annotations are listed under Contents → Highlights, with multi-select for Share and Delete.

### Cited Findings
- "Touch and hold a word, move the grab points to adjust the selection, tap Highlight, then tap a color option or underline. To change the highlight color or switch to underline, tap the text, tap Highlight, then tap an option. To remove a highlight or underline, tap the text, then tap Remove." ([Apple Annotate, iOS 27](https://support.apple.com/guide/iphone/annotate-books-iph17bf340c1/27/ios/27))
- The illustration shows "The Highlight, Add Note, and Translate controls … above the selected text." The overflow: "Tap [the Forward button], then tap Translate, Search, or Copy" and Share ([Apple Annotate, iOS 27](https://support.apple.com/guide/iphone/annotate-books-iph17bf340c1/27/ios/27)). The iOS 17-18 wording was "Swipe right on the menu items, then tap Share" ([Apple, iOS 18](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/18.0/ios/18.0)).
- Notes: "Tap Add Note, enter text, then tap [Done]." To delete: "Tap a note, tap Remove, then choose Remove Note or Remove Highlight & Note." ([Apple Annotate, iOS 27](https://support.apple.com/guide/iphone/annotate-books-iph17bf340c1/27/ios/27))
- List: "tap Contents, then tap Highlights. Tap a highlight to go to that location." Bulk actions use "Tap [the Checklist button], tap the items … then tap [Share]/[Delete]." ([Apple Annotate, iOS 27](https://support.apple.com/guide/iphone/annotate-books-iph17bf340c1/27/ios/27))
- iOS 16 renamed the "Notes" tab to "Highlights" ([Gadget Hacks](https://ios.gadgethacks.com/how-to/20-big-new-features-and-changes-coming-apple-books-your-iphone-0385075)).
- Shared selections include a Book Store link for store books ([Apple, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios)).
- iOS 16 complaints: highlighting needed double-tap, hold and drag. The color menu appeared "only intermittently". Notes could not be shared at the time (TidBITS commenters, [TidBITS](https://tidbits.com/2022/10/03/apples-books-ios-16/)).

### Inferences
- The menu is the system `UIEditMenuInteraction` with custom leading actions. The color picker replaces the menu in place as a row of circular swatches (recollection: yellow, green, blue, pink, purple, plus an underline glyph). New highlights reuse the last color.
- Selection haptics are the system text-selection ticks. I found no Books-specific haptic evidence.

### Gaps
- No source lists the exact highlight colors or says whether the note editor is a sheet or a popover.

---

## 9. Bookmarks

### Takeaway
iOS 16.0-16.1 used double-tap to bookmark. It was easy to trigger by accident, and one reviewer said ~75% of their bookmarks were accidental. 16.2 through 26 used Menu → ribbon icon. iOS 27 and 27.2 add a standalone ribbon button at top-right.

### Cited Findings
- iOS 16.0: "Double-tap a page to bookmark it, and double-tap again to remove" ([Gadget Hacks](https://ios.gadgethacks.com/how-to/20-big-new-features-and-changes-coming-apple-books-your-iphone-0385075)). This was "easy to do inadvertently" ([TidBITS](https://tidbits.com/2022/10/03/apples-books-ios-16/)). "About 75% of the bookmarks I made were accidental" ([BasicAppleGuy](https://basicappleguy.com/basicappleblog/build-a-better-books)).
- iOS 17-26: "Tap [the Menu button] … Tap [the Bookmark Ribbon] to add a bookmark; tap it again to remove." The list is at "Bookmarks & Highlights → Bookmarks" ([Apple, iOS 26](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/26/ios/26)).
- iOS 27: "tap the page you want to bookmark. Tap [the Bookmark Ribbon]". The list is at Contents → Bookmarks ([Apple, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios)). In 27.2 it is a standalone upper-right button ([9to5Mac](https://9to5mac.com/?p=1072973)).

### Inferences
- Ribbon animation (recollection): when added, a red ribbon drops in from the top edge in the top-right corner and stays there while you are on that page. Removing it slides it back up. I did not verify this, and I found no haptic evidence.

### Gaps
- No source describes the ribbon's motion or haptics.

---

## 10. Footnotes, images, Look Up, Line Guide

### Takeaway
Only Line Guide is documented. It is a dimmed page with one bright line band that you move by tapping above or below it, tapping the margins, or dragging. Its dim level is set from a bottom-left button. Footnote popovers, image zoom and the Look Up card have no sources.

### Cited Findings
- "When Line Guide is on, the rest of the page dims and the line you're reading becomes more visible." "Tap the page above or below the line guide to move it up or down." "Touch and hold the line guide, then drag it to a new line." The bottom-left Line Guide button adjusts "the background dim level" or turns it off ([Apple, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios)).
- Line Guide appears in the iOS 18 guide but not in the iOS 17 guide ([Apple, iOS 18](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/18.0/ios/18.0); [Apple, iOS 17](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/17.0/ios/17.0)). A MacRumors forum report says it had no effect on iPadOS 18 but worked on iOS 18 ([MacRumors forum, snippet](https://forums.macrumors.com/threads/books-on-ipados-line-guide-bug.2443810)).

### Inferences
- From recollection: EPUB3 `epub:type="noteref"` links open the footnote in a popover card anchored to the reference, which you dismiss by tapping outside. Non-footnote internal links jump and trigger the return control (section 6). A double-tap or pinch on an image opens it full-screen with zoom. Look Up appears in the edit menu and opens the system dictionary sheet (`UIReferenceLibraryViewController`).

### Gaps
- No source on footnote popover styling, image viewer gestures or the Look Up presentation in Books.

---

## 11. Night mode, auto theme, system Dark Mode

### Takeaway
iOS 16 replaced the single dark theme and Auto-Night toggle with a separate mode control: **Light / Dark / Match Device / Match Surroundings**. It applies on top of any of the six themes. Dark mode darkens all six.

### Cited Findings
- "'Light' works on all six themes. 'Dark' darkens all six. 'Match Device' and 'Match Surroundings' are also available. iOS 15 had one dark theme and an 'Auto-Night Theme' toggle." It is reached through "the brightness (sun) icon under 'Themes & Settings'" ([Gadget Hacks](https://ios.gadgethacks.com/how-to/20-big-new-features-and-changes-coming-apple-books-your-iphone-0385075)).
- The far-right Light/Dark control includes Match Device and Match Surroundings ([TidBITS](https://tidbits.com/2022/10/03/apples-books-ios-16/)). In iOS 18-27 it is labeled "Adjust the background mode: Tap [the Appearance Options Light button], then tap an option." ([Apple, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios)).

### Inferences
- "Match Surroundings" uses the ambient light sensor, like the older Auto-Night Theme. Third-party apps have no public iOS ambient-light API, so the only proxy is `UIScreen.brightness` or system appearance.
- Theme changes look like a quick cross-fade of background and text color, not a hard cut (recollection, unverified).

### Gaps
- No source gives the theme transition timing or the dark-variant colors.

---

## 12. Praise and complaints by redesign

### Takeaway
iOS 16 drew the most criticism: Curl removed, chrome you cannot hide, a small hard-to-hit button, a hidden scrubber, accidental bookmarks, lost brightness control and lost margins. Apple walked most of these back over 16.4-18. iOS 27.2 is received as a welcome move to stock controls. I found no substantive iOS 26 Books criticism.

### Cited Findings
- Removing Curl was "unequivocally the most egregious and unnecessary killjoy change". Its restoration in 16.4 drew "Bravo Cupertino!" ([BasicAppleGuy](https://basicappleguy.com/basicappleblog/build-a-better-books)). Forums filled with complaints, and some users said they moved to Kindle ([PiunikaWeb, snippet](https://piunikaweb.com/2022/09/16/apple-books-new-page-turn-animation-not-liked-by-many/)). "RIP skeuomorphic page turn" ([TidBITS commenter](https://tidbits.com/2022/10/03/apples-books-ios-16/)).
- MacStories verdict: "shocking at first, but well done, maybe?" ([MacStories](https://www.macstories.net/stories/ios-16-the-macstories-review/10)).
- Praise: spacing controls; "% complete" visible without leaving the book (TidBITS commenter darrenoia, [TidBITS](https://tidbits.com/2022/10/03/apples-books-ios-16/)).
- Wish list (2023): navigation, Search, Notes and Bookmarks "dismissable by a tap", a top-right bookmark button, narrower margins, dyslexia-friendly fonts ([BasicAppleGuy](https://basicappleguy.com/basicappleblog/build-a-better-books)). Apple later shipped a top-right bookmark (27.2) and margins (18).
- iOS 27.2: "Apple Books is my favorite app for reading, and it's getting several welcome design updates" ([9to5Mac](https://9to5mac.com/?p=1072973)).

### Inferences
- Apple's own reversals point the same way: users want visible, tappable controls (bookmark, progress, back) more than a minimalist single button. They also want the tactile page turn as an option, not removed.

### Gaps
- I found no Reddit threads in this session, and no reviews of the iOS 26 Liquid Glass reader.

---

## 13. Implications for Pager

### Takeaway
Most of Books' good ideas can be built in the React/WKWebView layer. Pager needs native help for haptics, a real page curl, status-bar hiding, the system sheet with detents (optional), the system edit menu, Look Up, and a zoom or interactive-dismiss transition if it wants the system feel.

### Cited Findings
- The patterns to copy are the ones Apple kept or added after the iOS 16 backlash: Curl as an option, margin taps with "Both Margins Advance", a bottom progress slider, a bottom-left "Undo Page Skip", a standalone bookmark ribbon, margins and spacing sliders, per-theme memory with "Reset Theme", and Line Guide ([Apple, iOS 27](https://support.apple.com/en-us/guide/iphone/read-books-iphc1af7c57/ios); [9to5Mac](https://9to5mac.com/?p=1072973)).

### Inferences
**Web-only (React inside WKWebView):**
- **Tap zones:** left and right margin strips turn pages, the centre toggles chrome. Add a "Both margins advance" setting. In Line Guide mode, margin taps move the guide instead.
- **Slide and Fast Fade page turns** for the CSS-paginated view, with CSS transforms and opacity. Honor `prefers-reduced-motion` by dropping to an instant cut, as Books' None does under Reduce Motion.
- **Chrome toggling:** one tap shows the page number, "N pages left in chapter", the close button, the menu and the back-to-location button together. Tapping the page-number footer alone could reveal "pages left in chapter", as Books did.
- **Floating menu that springs from its button:** a `transform-origin` at the button corner with a scale and opacity spring (CSS `linear()` easing or a JS spring). Give it a 44 pt hit target. Do not repeat the "looks like a button but is a slider" mistake: use a separate, visible progress slider (the iOS 27 direction).
- **Progress slider with preview:** show chapter title and page while dragging, commit on release. In Scroll mode, use a right-edge position slider.
- **Back-to-location:** after TOC, search, link or footnote jumps, show a bottom-left "Back to p. X" pill. After you use it, it flips to "Return to p. Y".
- **Themes & Settings panel:** six presets as font, size, spacing and color bundles. Customize goes behind a switch. Store edits per preset with Reset. Apply changes live behind a half-height panel. Keep the reading position across reflow by saving a text anchor (element path plus character offset) before re-paginating and restoring it after.
- **Annotations:** color swatches plus an underline option, Add Note, and Remove with a "Remove Note / Remove Highlight & Note" choice. A Highlights list with multi-select for share and delete.
- **Bookmark ribbon:** a top-right toggle with a short drop-in animation from the top edge. Do not use double-tap, because Books proved it fires by accident.
- **Line Guide:** a dim overlay with a movable clear band, which is easy to build in CSS.
- **Footnote popovers, image lightbox, Light/Dark/Match Device** (via `prefers-color-scheme`) and goal rings in SVG with canvas confetti.

**Needs native help (SwiftUI shell plus a JS bridge):**
- **Haptics:** WKWebView has no usable Vibration API on iOS. Bridge to `UIImpactFeedbackGenerator` and `UISelectionFeedbackGenerator` for bookmark, goal reached and scrubber chapter ticks.
- **Page Curl:** CSS cannot do a real curl. The native route is to snapshot the current and next page from WKWebView (`takeSnapshot`) and run a `UIPageViewController(.pageCurl)` overlay, then swap back. This is costly and fragile, so ship Slide and Fast Fade first.
- **Status bar hiding** in sync with chrome: native `.statusBarHidden()` driven from JS.
- **Settings sheet with detents** and live text behind it: either a native `.sheet` with `.presentationDetents([.medium, .large])` and background interaction enabled, sending settings to JS, or a web bottom sheet. The web version is simpler and keeps one code path.
- **Selection menu:** WKWebView shows the system edit menu. To add Highlight and Note items natively, override `buildMenu(with:)` in a WKWebView subclass. The alternative is to suppress the system menu and draw a web menu, but that loses the system Look Up, Translate and Share.
- **Look Up / Translate:** keep the system items, or call `UIReferenceLibraryViewController` through the bridge.
- **Cover-to-page zoom and swipe-down-to-close:** if library and reader share one WKWebView, use the web View Transitions API (WebKit supports same-document view transitions) and a custom drag-to-dismiss. If the reader is a separate native screen, SwiftUI's `.navigationTransition(.zoom)` (iOS 18+) gives both for free.
- **Match Surroundings** (ambient light): no public API, so skip it.
- **Liquid Glass chrome:** native `.glassEffect()` (iOS 26+) on SwiftUI overlay buttons, or approximate it in web with `-webkit-backdrop-filter`.

### Gaps
- All motion numbers (durations, springs, curl thresholds) still need a hands-on screen recording of Books on iOS 26 or 27. None are documented.
