# Pager reader: codebase audit of the reading experience as it is today (2026-10-29)

Scope: the reader in the working tree as of 2026-10-29 (`src/components/reader/*`, `src/pages/ReaderPage.tsx`, `src/state/settings.ts`, `shared/src/settings.ts`, `src/styles/*`, DESIGN.md, README.md, CONTRACT.md, API.md, `test/`). The sources are files in the repository. Links are relative to this notes folder (`../../` is the repository root), and line numbers are in the link text. "Observed" findings come from a headless Chromium run (Playwright 1.58 with the cached chromium-1243 build) against preview mode (`npm run dev`, the mock adapter, Jane Eyre ch. 1–3 and The Gift of the Magi). The run used a 390×844 touch viewport and a 1440×900 desktop viewport. The scripts are in the session scratchpad (`observe.mjs`, `observe2.mjs`), and the screenshots are in [screenshots/](screenshots/). The dev server was stopped afterwards. Nothing in the repository was modified.

## Feature inventory: what a reader can do today, with settings and defaults

### Takeaway
Pager has a solid core: two layouts, careful gestures, a block-anchored saved place, footnote popovers, a back pill, highlights and notes, and a learned reading speed. Its reading settings are thin: text size, serif or sans, three themes, layout, page turn and footer format. It has no in-book search, bookmarks, dictionary, TTS, stats UI, scrubber, two-page spread, offline mode, end-of-book screen, or line-height, margin and justification controls.

### Cited Findings

**Settings that exist (client-side, `localStorage` key `pager.settings`)**: defined in [state/settings.ts:15-53](../../src/state/settings.ts). Clamping: [settings.ts:71-80](../../src/state/settings.ts).
| Setting | Values | Default | Where it is set |
|---|---|---|---|
| `theme` | system / light / dark | `system` | reader popover, Settings page ([ReadingSettings.tsx:68-81](../../src/components/reader/ReadingSettings.tsx)) |
| `fontOffset` | −3 … +9 px added to the base | `0` | ± buttons, label shows `19 + offset` px ([ReadingSettings.tsx:16, 29-54](../../src/components/reader/ReadingSettings.tsx); [settings.ts:37-38](../../src/state/settings.ts)) |
| `typeface` | serif (Spectral) / sans (system UI) | `serif` | [ReadingSettings.tsx:55-67](../../src/components/reader/ReadingSettings.tsx); applied as `--font-body` in [settings.ts:115-119](../../src/state/settings.ts) |
| `layout` | scroll / paged | `scroll` | [ReadingSettings.tsx:82-97](../../src/components/reader/ReadingSettings.tsx) |
| `pageTurn` | slide / fade / none (Pages only) | `slide` | shown only when layout = paged ([ReadingSettings.tsx:98-114](../../src/components/reader/ReadingSettings.tsx)) |
| `footerFormat` | page / chapter-time / book-time / percent / off | `page` | tap the footer to cycle ([PageFooter.tsx:11, 176-179](../../src/components/reader/PageFooter.tsx)) |
| `highlightColor` | yellow / green / blue / pink / purple | `yellow` | last colour picked in the annotation popover ([useReaderAnnotations.ts:115-118](../../src/components/reader/useReaderAnnotations.ts)) |
| `toolPanelOpen` | bool | `false` | top-bar Tools button (wide screens) |
| `haptics` | bool | `true` | Settings page, iPhone app only ([SettingsPage.tsx:33-44](../../src/pages/SettingsPage.tsx)) |
- The body size is `max(16px, base + offset)`. The base is 19px, or 17px at ≤767px ([tokens.css:110-112, 147-153](../../src/styles/tokens.css)).
- The shared wire vocabulary also lists `headingTypeface`, `lineHeight`, `measure`, `paragraphSpacing`, `paragraphIndent`, `justify`, `hyphenate`, `notes: popover|end`, `remoteImages` and `customCss`. It also defines named `Preset`s and global and per-document scopes ([shared/src/settings.ts:12-32, 79-96](../../shared/src/settings.ts)). **None of these are implemented in the client.** README lists "settings sync" under "Not used yet from the backend" ([README.md:123](../../README.md)), and reading settings live only in `localStorage` ([README.md:84-85](../../README.md)).

**Navigation**
- Scroll layout (default): each chapter scrolls vertically. A sideways drag with touch or pen, the floating ‹ › circles, ← →, or a sideways trackpad swipe turns the chapter ([ScrollView.tsx:119-129, 247-254, 373-378, 411-418](../../src/components/reader/ScrollView.tsx); [ReaderPage.tsx:255-289](../../src/pages/ReaderPage.tsx)). The next chapter opens at its top and the previous one at its end ([ReaderPage.tsx:200-214](../../src/pages/ReaderPage.tsx)).
- Pages layout: CSS columns one page wide. Turns come from tap zones, swipes, keys, the footer ‹ › and a vertical wheel. Past the last page comes the next section's first page, and before the first page the previous section's last ([ReaderPage.tsx:181-198](../../src/pages/ReaderPage.tsx); [PagedView.tsx:51-111](../../src/components/reader/PagedView.tsx)).
- Contents drawer, a flat list with indentation by `depth` and the current entry highlighted ([TocDrawer.tsx:10-58](../../src/components/reader/TocDrawer.tsx)). A title page opens every document ([TitlePage.tsx:1-37](../../src/components/reader/TitlePage.tsx)).
- Back pill after any non-linear jump (link, "Go to note", contents). It is a two-state Back/Return toggle and retires after 3 pages or screenfuls away from both ends ([useJumpHistory.ts:22-39, 107-133](../../src/components/reader/useJumpHistory.ts); [BackPill.tsx](../../src/components/reader/BackPill.tsx)).
- Deep links `/read/<doc>/<section>#<blockId>` open on that block and flash it ([useReadingProgress.ts:164-170](../../src/components/reader/useReadingProgress.ts); [CONTRACT.md:76-79](../../CONTRACT.md)). The library search opens a passage "on its page" ([README.md:36-37](../../README.md)).
- Keyboard ([ReaderPage.tsx:255-320](../../src/pages/ReaderPage.tsx)). In Pages: → ↓ PageDown Space go forward, ← ↑ PageUp Shift+Space go back, Home and End go to the section's ends, Esc closes the tools. In Scroll: ← → turn chapters, ↑ ↓ scroll 40px, Space PageDown PageUp scroll a screen less 80px, Home and End scroll to the ends ([pagination.ts:84-89](../../src/components/reader/pagination.ts)). **There are no shortcuts** for contents, settings, text size, theme, search or bookmarks.

**Annotations**: select text to get Highlight (in the last colour) or Note. Clicking painted text opens a popover with colour, note, tags, delete with Undo, and accept-anchor ([SelectionMenu.tsx:57-99](../../src/components/reader/SelectionMenu.tsx); [useReaderAnnotations.ts:72-145](../../src/components/reader/useReaderAnnotations.ts)). Painting uses the CSS Custom Highlight API, so no wrapper elements are added ([useHighlightPainting.ts:26-86](../../src/components/reader/useHighlightPainting.ts)). A "reattach" mode moves orphaned highlights ([ReaderPage.tsx:97-102, 405-424](../../src/pages/ReaderPage.tsx)). In the iPhone app, the native edit menu carries Highlight and Note instead ([useNativeMenu.ts](../../src/components/reader/useNativeMenu.ts)). The underline style is painted ([prose.css:597-611](../../src/styles/prose.css)), but the selection menu offers no way to choose it at creation.

**Footnotes**: note references open a popover beside the reference, `min(100vw−2.5rem, 460px)` wide and at most 60vh tall. The note is looked up in other sections if needed. The popover closes on a tap outside, ✕, Esc, a page turn, a scroll or a resize, and offers "Go to note" ([FootnotePopover.tsx:65-91, 207-233](../../src/components/reader/FootnotePopover.tsx); [prose.css:507-529](../../src/styles/prose.css)).

**Footer and progress**: the footer button cycles p. N of M ("Chapter N of M" in Scroll) → time left in chapter → time left in book → percent → off ([PageFooter.tsx:64-95](../../src/components/reader/PageFooter.tsx)). Time estimates use a WPM learned from page dwell: the median of the last 30 samples, each 4 s to 3 min long and 60 to 1000 wpm. At least 5 samples are needed, and until then it uses 238 wpm marked with "~" ([readingSpeed.ts:12-22](../../src/components/reader/readingSpeed.ts)). A 2px progress line runs under the top bar ([ReaderTopBar.tsx:71-79](../../src/components/reader/ReaderTopBar.tsx)).

**Not present** (confirmed by grep or observation):
- **In-book search**: observed, no search control in the reader. README mentions only library search ([README.md:36-37](../../README.md)).
- **In-book bookmarks**: an annotation kind `bookmark` exists in the types ([shared/src/annotation.ts:89](../../shared/src/annotation.ts)), and the reader's count skips it ([useReaderAnnotations.ts:70](../../src/components/reader/useReaderAnnotations.ts)), but there is no UI to create one.
- **Dictionary or lookup, TTS**: no `speechSynthesis` or lookup code. The tool registry is "Empty by design in this pass" ([tools/registry.ts:4-10](../../src/tools/registry.ts); [tools/index.tsx:1-10](../../src/tools/index.tsx)).
- **Reading stats**: the server records sessions ([server/src/sessions.rs:36-58](../../server/src/sessions.rs)), but there is no UI ("reading history … interaction journal" are unused, [README.md:123](../../README.md)).
- **Offline**: there is no service worker ("offline reading is stage 2", [index.html:11](../../index.html)).
- **Two-page spread**: the column width always equals the page width, at most 728px ([PagedView.tsx:127-141](../../src/components/reader/PagedView.tsx); [tokens.css:133](../../src/styles/tokens.css)).
- **Progress scrubber, end-of-book screen, pull-to-bookmark, status-bar hiding**: all were deferred by the earlier round. No `statusBarHidden` or `persistentSystemOverlays` code exists in `ios/` (grep).
- **Reset reading speed UI**: `resetReadingSpeed` is there "for a future 'reset reading speed'" ([readingSpeed.ts:92-102](../../src/components/reader/readingSpeed.ts)).
- **Tools panel**: the top-bar Tools button opens "No tools yet" ([ToolPanel.tsx:46-52](../../src/components/reader/ToolPanel.tsx); [ReaderTopBar.tsx:62-68](../../src/components/reader/ReaderTopBar.tsx); observed [desktop_tools_panel_empty.png](screenshots/desktop_tools_panel_empty.png)). The Assistant page is "a placeholder until tools are registered" ([README.md:120](../../README.md)).

**Accessibility and reduced motion**:
- Reduced motion makes every Pages turn a cut ([gestures.ts:100-103](../../src/components/reader/gestures.ts)). Scroll chapter turns fade over 150 ms instead of sliding ([ScrollView.tsx:203-218, 262-269](../../src/components/reader/ScrollView.tsx)). The chrome, chapter buttons, popovers and landing flash all have reduced-motion fallbacks ([globals.css:170-175](../../src/styles/globals.css); [prose.css:397-411, 562-574](../../src/styles/prose.css)).
- The footer value is `aria-live` ([PageFooter.tsx:211-213](../../src/components/reader/PageFooter.tsx)). The progress line has `role=progressbar` ([ReaderTopBar.tsx:71-79](../../src/components/reader/ReaderTopBar.tsx)).
- The footnote popover takes focus and returns it to the reference ([FootnotePopover.tsx:194-205](../../src/components/reader/FootnotePopover.tsx)). Neighbour panes are `inert` and `aria-hidden` ([ScrollView.tsx:103](../../src/components/reader/ScrollView.tsx)). Hidden chrome is `inert` and Tab brings it back ([ReaderTopBar.tsx:40](../../src/components/reader/ReaderTopBar.tsx); [useReaderChrome.ts:40-42](../../src/components/reader/useReaderChrome.ts)). A skip link exists ([AppShell.tsx:12-17](../../src/components/shell/AppShell.tsx)).
- Contrast, as documented: light text 18.9:1 and secondary 6.2:1. Dark text (#e5e5e5 on #121212) 14.9:1, and tertiary 4.0:1 ([DESIGN.md:39-43](../../DESIGN.md)).

**Haptics** (iPhone app only):
- A selection tick on chapter turns, text-size steps and footer cycling ([ScrollView.tsx:211](../../src/components/reader/ScrollView.tsx); [ReadingSettings.tsx:18-22](../../src/components/reader/ReadingSettings.tsx); [PageFooter.tsx:176-179](../../src/components/reader/PageFooter.tsx)).
- "Soft" on a highlight and "success" on a note ([useReaderAnnotations.ts:87-88](../../src/components/reader/useReaderAnnotations.ts)).

### Inferences
- The settings set is narrower than mainstream readers. The shared `ReadingSettingsSuggestion` shows the author planned line height, measure, justify, hyphenate, indent and presets, so the gap is design debt, not a decision against those controls.
- Settings, reading speed and annotations' colour default all live in per-device `localStorage`. The phone (WKWebView) and the desktop therefore drift apart, even though the server already has scoped settings and presets.

### Gaps
- VoiceOver and screen-reader behaviour in the Pages layout (CSS columns, all text in the DOM) was not tested.
- I did not check whether WKWebView honours iOS Dynamic Type. The CSS uses fixed px with `text-size-adjust: 100%` ([globals.css:44-47](../../src/styles/globals.css)).

## Interaction details: geometry, thresholds, timings, and how the place is kept

### Takeaway
Gesture handling is careful and fully parameterised in pure modules (gestures.ts, chapterTurn.ts, scrollChrome.ts). The saved place is a block id plus a character offset, saved on open, on each rest (1 s debounce) and on hide. It survives resizes and font changes (observed). Rough spots: chapter boundaries in Pages are cuts, Pages keeps the bars' space when they hide, and the paging maths is LTR-only.

### Cited Findings
**Tap arbiter (both layouts)** ([gestures.ts:9-98](../../src/components/reader/gestures.ts); [usePressArbiter.ts:37-89](../../src/components/reader/usePressArbiter.ts)):
- A tap is a release within 15 px. A touch held 500 ms or more is a long press and does nothing. A release while the page scrolled, or within 150 ms of a scroll, is ignored.
- A press that began with a selection or an overlay open only dismisses it.
- Links, buttons and highlights win over the zones. There is no double-tap action.

**Zones**:
- Pages, touch and pen: the left 37.5% goes back, the right 37.5% goes forward, and the middle 25% toggles the chrome. While the chrome shows, a side tap only hides it ([gestures.ts:66-69, 85-90](../../src/components/reader/gestures.ts)).
- Pages, mouse: only the outer 18% on each side turns, and a mouse never hides the chrome.
- Scroll: every touch tap toggles the chrome, and a mouse click does nothing ([gestures.ts:75-77](../../src/components/reader/gestures.ts)).

**Pages swipes**:
- The platform's own scroll-snap handles swipes (`scroll-snap-type: x mandatory`, `scroll-snap-stop: always`, one snap span per page) ([prose.css:192-222](../../src/styles/prose.css); [PagedView.tsx:143-146](../../src/components/reader/PagedView.tsx)).
- A swipe from the margins or past either end turns after 40 px at 1.5× horizontal dominance, within 600 ms unless it covered 30% of the width ([gestures.ts:16-18, 93-98](../../src/components/reader/gestures.ts); [PagedView.tsx:83-102](../../src/components/reader/PagedView.tsx)).
- A swipe hides the chrome. The page settles on `scrollend`, or after 120 ms without one ([usePagination.ts:15, 160-208](../../src/components/reader/usePagination.ts)).

**Pages turn motion**:
- Slide is `scrollTo({behavior:"smooth"})`, with a 1000 ms glide timeout ([usePagination.ts:17, 233-241](../../src/components/reader/usePagination.ts)).
- Fade is an opacity 0→1 over 150 ms, ease-out ([usePagination.ts:13, 244-246](../../src/components/reader/usePagination.ts)). None is a cut.
- Page gap is 64 px ([usePagination.ts:10](../../src/components/reader/usePagination.ts)).
- **Crossing into another section is a router navigation with `state.page = 0 | "last"`, i.e. a cut, whatever the setting** ([ReaderPage.tsx:192-195](../../src/pages/ReaderPage.tsx)).
- Vertical wheel: one page per event above 24 px delta, throttled to one per 350 ms ([PagedView.tsx:105-111](../../src/components/reader/PagedView.tsx)).

**Scroll chapter drag** ([chapterTurn.ts:11-35, 54-111](../../src/components/reader/chapterTurn.ts)):
- Engages after 10 px of travel at 2:1 horizontal dominance.
- Not within 24 px of the left edge (the back swipe), not after a 500 ms hold, not when pinch-zoomed, and not with a mouse.
- The track follows the finger 1:1, rubber-banded at 0.35× toward a missing chapter.
- Commits past 30% of the width, or on a flick of 0.4 px/ms over at least 40 px. A flick back cancels.
- Settles in 220–320 ms, snaps back in 250 ms, and button or key turns take 280 ms, all on `cubic-bezier(0.2,0.8,0.2,1)`. Velocity is measured over the last 100 ms.
- Sideways trackpad: 80 px accumulated turns once, then locks for 600 ms and until 200 ms of quiet ([chapterTurn.ts:125-152](../../src/components/reader/chapterTurn.ts)).
- If the router has not landed within 1000 ms, the turn is undone ([ScrollView.tsx:41, 189-197](../../src/components/reader/ScrollView.tsx)).

**Chrome**:
- Touch screens open a book with the chrome hidden, and a mouse opens it shown ([useReaderChrome.ts:5-8](../../src/components/reader/useReaderChrome.ts)). Scroll forces it shown at a chapter's top ([ReaderPage.tsx:250-253](../../src/pages/ReaderPage.tsx)).
- Scroll: 10 px of scroll one way hides it (down) or shows it (up). It always shows at the top, and holds for 500 ms after a turn ([scrollChrome.ts:8-10, 28-41](../../src/components/reader/scrollChrome.ts)).
- The bars slide over 250 ms `cubic-bezier(.19,1,.22,1)` ([globals.css:148-175](../../src/styles/globals.css)).
- Any mouse movement or press, or the Tab key, brings it back ([useReaderChrome.ts:32-52](../../src/components/reader/useReaderChrome.ts)).
- **In Pages the bars keep their space when hidden**: "Transform and opacity only, so their space stays" ([globals.css:148-150](../../src/styles/globals.css); [ReaderPage.tsx:391](../../src/pages/ReaderPage.tsx)). The page footer always stays ([DESIGN.md:113](../../DESIGN.md)).

**Position save and restore** ([useReadingProgress.ts:6, 127-224](../../src/components/reader/useReadingProgress.ts); [CONTRACT.md:67-73, 139-141](../../CONTRACT.md)):
- What is saved: `{sectionId, offset 0–1, percent, point {blockId, offset}, revisionId, reason}`.
  - Pages offset is `page/(pageCount−1)` ([pagination.ts:30-33](../../src/components/reader/pagination.ts)). Scroll offset is `scrollTop/(scrollHeight−clientHeight)`.
  - The point in Pages is the first leaf `[data-b]` block touching the page plus the caret at its top-left ([dom.ts:147-159](../../src/components/reader/dom.ts)).
  - The point in Scroll is the block on a reading line 20+4 px below the top bar. There is none in the first 40 px of a chapter ([useChapterScroll.ts:9, 265-274](../../src/components/reader/useChapterScroll.ts); [dom.ts:192-205](../../src/components/reader/dom.ts)).
- When it is written:
  - once at placement, immediately ([useReadingProgress.ts:185-186](../../src/components/reader/useReadingProgress.ts));
  - at each rest, debounced 1000 ms ([useReadingProgress.ts:201-208](../../src/components/reader/useReadingProgress.ts));
  - flushed on section change or unmount, `pagehide`, and `visibilitychange: hidden` ([useReadingProgress.ts:191-197, 210-220](../../src/components/reader/useReadingProgress.ts)).
- Restore order: URL hash target, then the back-pill point, then the asked page (a cross-chapter turn), then the saved point (unless the anchor is orphaned), then the saved offset, then page 0 ([useReadingProgress.ts:164-180](../../src/components/reader/useReadingProgress.ts)).
- Relayouts (file edit, resize, font, layout switch) put the same words back ([useReadingProgress.ts:153-160](../../src/components/reader/useReadingProgress.ts)). Scroll keeps them at the same pixel delta ([useChapterScroll.ts:234-241](../../src/components/reader/useChapterScroll.ts)).
- Conflicts: the server rejects an older `updatedAt` with 409, but only if the client sends `updatedAt` ([server/src/library/library.rs:1044-1049](../../server/src/library/library.rs)). The web client's update never includes it ([useReadingProgress.ts:127-144](../../src/components/reader/useReadingProgress.ts)), so it is last-write-wins. An open reader ignores `progress.updated` from another device ([CONTRACT.md:151-153](../../CONTRACT.md)).
- There is no "furthest read" and no ≥98% re-read rule (deferred).

**Resize, rotation and font change**:
- Both layouts re-measure on ResizeObserver, `document.fonts.ready` and image `load` ([usePagination.ts:143-157](../../src/components/reader/usePagination.ts); [useChapterScroll.ts:122-137](../../src/components/reader/useChapterScroll.ts)).
- Observed:
  - Scroll: resizing 1440×900 → 800×800 → 1440×900 kept the same paragraph at the top.
  - Pages: resizing 1440×900 → 800×700 went from "p. 1 of 10" to "p. 1 of 15" with the same first paragraph.
  - Pages font +4: "p. 3 of 10" became "p. 4 of 14".
- Rotation is the same code path (ResizeObserver). It was not tested on a device.

**Chapter boundaries, long chapters and content types**:
- Sections are the author's units. One over ~120,000 characters is split at its next heading or into `synthetic` parts ([API.md:58-60](../../API.md)).
- Scroll has no auto-advance. Pages runs straight into the next section ([DESIGN.md:144-145](../../DESIGN.md)).
- Images: `max-height: page-h − 2em`, centred, with no zoom or lightbox handler ([prose.css:134-139, 226-229, 325-328](../../src/styles/prose.css)).
- Tables are `width:100%`, 0.85em, and `break-inside: avoid` in Pages, with no horizontal-scroll wrapper ([prose.css:152-163, 230-238](../../src/styles/prose.css)).
- `pre` is `pre-wrap` at a fixed 13px/20px ([prose.css:111-132](../../src/styles/prose.css)).
- In Pages, a selection cannot cross a page boundary ([DESIGN.md:93-95](../../DESIGN.md); [prose.css:204-207](../../src/styles/prose.css)).

**RTL and vertical text**:
- The body is `dir="auto"` ([ReaderBody.tsx:69](../../src/components/reader/ReaderBody.tsx)). Headings and list items use `unicode-bidi: plaintext` ([prose.css:40, 104](../../src/styles/prose.css)).
- Page arithmetic uses a positive `scrollLeft` ([pagination.ts:7-21](../../src/components/reader/pagination.ts)). Swipe and drag direction assume "finger left = forward" ([gestures.ts:93-98](../../src/components/reader/gestures.ts); [chapterTurn.ts:101-111](../../src/components/reader/chapterTurn.ts)).
- There is no `writing-mode` handling anywhere in the CSS.

### Inferences
- An RTL book (Arabic, Hebrew) in Pages will flow columns the wrong way and swipe backwards, and vertical CJK is unsupported. Low priority for a personal English library, but the maths would need a direction flag.
- Pages chapter boundaries feel different from in-chapter turns: a smooth slide inside the chapter, then a hard cut, when the reader swipes from the last page. Scroll got a real chapter slide; Pages did not.
- Without a furthest-read position, last-write-wins and a save on open combine badly. A stale desktop tab that turns one page overwrites a newer place saved from the phone. Opening a book via a TOC jump also moves the saved place immediately.

### Gaps
- Rotation, real iOS WKWebView momentum, and the iOS edge-swipe interplay were not tested; this was headless Chromium only.
- Behaviour with the real backend's `[data-b]` blocks was not observed: the mock HTML has none (observed `blocks: 0`). Point-based restore was therefore exercised only through code reading.

## Typography as implemented

### Takeaway
The type is a web-article style: Spectral (or the system sans), 1.6 line-height, block paragraphs separated by a fixed 20 px, ragged-right, no hyphenation, no `text-wrap: pretty`, no indents. Phones get about 43 characters per line and the desktop 72–81, which is above the usual 45–75 range. Several sizes are fixed px and ignore the text-size setting.

### Cited Findings
**Font stacks**:
- Reading: `"Spectral", Georgia, serif`, bundled with @fontsource at weights 400, 400 italic, 600 and 700 only ([tokens.css:104-107](../../src/styles/tokens.css); [main.tsx:3-6](../../src/main.tsx)).
- UI and sans option: `system-ui, -apple-system, …` ([tokens.css:101-103](../../src/styles/tokens.css)).
- Inline code: `ui-monospace, SFMono-Regular, Menlo, Consolas`, at 0.75em ([prose.css:119-125](../../src/styles/prose.css)).

**Size**: 19 px desktop and 17 px phone, plus the offset, floored at 16 px ([tokens.css:110-112, 152](../../src/styles/tokens.css)). Observed computed sizes: phone 17px and desktop 19px.

**Line height and spacing**:
- `p` line-height is 1.6em (observed 27.2 px on the phone, 30.4 px on the desktop). The paragraph margin is a fixed `0 0 20px`. Headings use 1.16em, sized 2 / 1.625 / 1.375 / 1.125em ([prose.css:22-57](../../src/styles/prose.css)).
- Lists use `margin: 8px 0 0 32px` ([prose.css:101-105](../../src/styles/prose.css)). Blockquotes have a 4 px left rule with 20 px indent ([prose.css:72-79](../../src/styles/prose.css)).

**Measure**:
- `--size-reader: 728px` max ([tokens.css:133](../../src/styles/tokens.css)). Horizontal padding is 16 px on phones and 32 px at ≥768 ([prose.css:306-317](../../src/styles/prose.css); [PagedView.tsx:116](../../src/components/reader/PagedView.tsx)).
- Observed: 358 px column ≈ 43 chars per line on the phone. 728 px ≈ 81 chars per line (Scroll sample paragraph) and 72 chars per line (Pages sample) on the desktop.
- There is no measure setting.

**Alignment, hyphenation and wrapping**:
- No `text-align: justify`, no `hyphens: auto`, and no `text-wrap: pretty|balance`. Observed: `textAlign: start`, `hyphens: manual`, `textWrap: wrap`, `textIndent: 0px`.
- `overflow-wrap: anywhere; word-break: break-word` on `.markup`. `hanging-punctuation: allow-end`, which only Safari supports ([prose.css:5-16](../../src/styles/prose.css)).
- No `lang` attribute is set on the reader body, although the API exposes the document's `language` ([ReaderBody.tsx:69](../../src/components/reader/ReaderBody.tsx); [API.md:50](../../API.md)).

**Widows, orphans and breaks**: these rules apply only in Pages ([prose.css:230-251](../../src/styles/prose.css)):
- `orphans: 2; widows: 2` on p and li;
- `break-after: avoid` on headings;
- `break-inside: avoid` on figure, pre, table, tr, pullquote, footnote and note;
- the title page forces `break-after: column`.

**Fixed px that ignore the text-size setting**:
- `pre code` 13px/20px ([prose.css:126-129](../../src/styles/prose.css));
- the paragraph gap of 20 px;
- footnote popover text 14/21 px ([prose.css:518-526](../../src/styles/prose.css));
- title-page author 19 px ([prose.css:441-447](../../src/styles/prose.css)).

`figcaption` does follow the offset ([prose.css:143-150](../../src/styles/prose.css)).

**Publisher styling**: `<style>` and `style=` are stripped by the sanitizer ([lib/sanitize.ts:25-26](../../src/lib/sanitize.ts)). Only server classes such as `.align-center` survive ([prose.css:576-579](../../src/styles/prose.css)).

**Themes and colours**:
- Light: #111 on #fff. Dark: #e5e5e5 on #121212. Accent: #1d4ed8 in light, #60a5fa in dark ([tokens.css:8-97](../../src/styles/tokens.css)).
- There is no sepia or other paper theme, by design: "no warm or sepia tints" ([DESIGN.md:15](../../DESIGN.md)).
- Images are not dimmed in dark mode (no rule in prose.css).

### Inferences
- At default settings the desktop measure (~72–81 chars per line) is over the ~66–75 that most typographic guidance recommends. Users cannot narrow it except by raising the text size.
- A fixed 20 px paragraph gap reads as more than a full blank line at 16 px and as cramped at 28 px. An `em`-based gap or indent-style paragraphs would scale with the text.
- Losing publisher CSS removes poetry indentation, small caps, drop caps and centred epigraphs (other than `.align-center`) in EPUBs.
- Pages has no text-align or hyphenation option, so phone pages at about 43 chars per line will show ragged edges and occasional loose lines.

### Gaps
- Real EPUB rendering (headings, images, tables, verse) was not observed, because preview mode serves plain text and Markdown only. In the mock texts the chapter bodies had no visible chapter heading ([phone_scroll_after_chapter_drag.png](screenshots/phone_scroll_after_chapter_drag.png)). I did not determine whether the real backend keeps TXT chapter headings in the body.

## Performance: loading, rendering and pagination cost

### Takeaway
Each section renders as one full DOM. Scroll renders up to three sections at once and prefetches four. Paged measures CSS columns via `scrollWidth` on every resize, font or image load. Nothing is virtualised, deferred with `content-visibility`, or cached offline. With sections capped at ~120k characters this is probably fine on a desktop, but it is the main risk for a slow first page or jank on a phone.

### Cited Findings
- **Request waterfall**: with a bare `/read/<doc>` URL, the section id comes from the loaded document's progress, so the section request waits for the document request ([ReaderPage.tsx:76-80](../../src/pages/ReaderPage.tsx)). Sections are cached with `staleTime: Infinity` ([api/hooks.ts:54-60](../../src/api/hooks.ts)).
- **Scroll layout**: renders prev, live and next panes in full ([ScrollView.tsx:380-409](../../src/components/reader/ScrollView.tsx)). It also prefetches next-next and prev-prev ([ReaderPage.tsx:234-248](../../src/pages/ReaderPage.tsx)). Panes use `contain: strict` ([prose.css:277-285](../../src/styles/prose.css)).
- **Paged layout**:
  - Measures `columns.scrollWidth` after a rAF on every relayout trigger ([usePagination.ts:70-91, 136-157](../../src/components/reader/usePagination.ts)).
  - Renders one absolutely positioned snap span per page ([PagedView.tsx:143-146](../../src/components/reader/PagedView.tsx)).
  - The first placement waits for the first measurement (`version > 0`) ([useReadingProgress.ts:147-148](../../src/components/reader/useReadingProgress.ts)).
- **Per-rest work**:
  - `readingPointInBox` scans every leaf block with `getBoundingClientRect` ([dom.ts:147-149](../../src/components/reader/dom.ts)). `leafBlocks` runs `querySelectorAll` plus one `querySelector` per block ([dom.ts:129-131](../../src/components/reader/dom.ts)).
  - Scroll uses a binary search instead ([dom.ts:167-185](../../src/components/reader/dom.ts)).
  - Word counting runs a regex over the whole `textContent` on each layout change ([readingSpeed.ts:170-176](../../src/components/reader/readingSpeed.ts)).
- **Selection**: on every `selectionchange` (rAF-throttled), offsets are computed by `Range.toString()` over the prefix of the section ([tools/useSelection.ts:6-11, 34-60](../../src/tools/useSelection.ts)).
- **Highlights**: any change to annotations rebuilds a full text index for each of up to three surfaces and re-registers every Highlight ([useHighlightPainting.ts:41-86](../../src/components/reader/useHighlightPainting.ts)).
- **No virtualisation**: grep finds no `content-visibility`, `IntersectionObserver` or `requestIdleCallback` in `src/`.
- **No service worker**: there is no offline cache ([index.html:11](../../index.html)).
- **Build**: one app chunk of about 175 kB gzipped, with seed texts included ([vite.config.ts:25-26](../../vite.config.ts)).
- Observed: first text appeared about 975 ms after navigation on the phone viewport. That figure is for the Vite dev server with the mock adapter, so it is not representative of production.

### Inferences
- The worst case is a 120k-character section in Scroll on a phone: three panes (up to ~360k characters of DOM) plus layout on each relayout and selection offset work. Fast typing of selection handles or font changes could stutter. This was not measured.
- Paged `scrollWidth` measurement forces a full column layout of the section. On a long chapter the first page can only paint after that layout, and the title page and skeleton do not hide the cost.

### Gaps
- No profiling was done on a large real EPUB chapter or on a device. Performance claims here are code-path analysis, not measurements.

## Rough edges, bugs, inconsistencies, unbuilt items and in-progress work

### Takeaway
I found two clear UI bugs (the text-size label and dead steps on phones; text-size changes in Scroll hiding the chrome and the settings popover) and one data inconsistency (reader percent vs library percent). There are a dozen layout and desktop rough edges. The whole last build round, including the Scroll layout itself, is uncommitted.

### Cited Findings
**Bugs (observed)**

1. **Text-size label is wrong on phones, and −1…−3 do nothing there.**
   - The label is `19 + offset` px ([ReadingSettings.tsx:16, 41-43](../../src/components/reader/ReadingSettings.tsx)), but the phone base is 17 px with a 16 px floor ([tokens.css:112, 152](../../src/styles/tokens.css)).
   - Observed on the phone: default label "19px" vs actual 17px; −2 labelled "17px" vs actual 16px; −3 labelled "16px" vs actual 16px ([phone_reading_settings_popover.png](screenshots/phone_reading_settings_popover.png)).
   - DESIGN.md says "−3 … +9" ([DESIGN.md:52](../../DESIGN.md)).
2. **In Scroll, one text-size step hides the chrome, and with it the open settings popover.**
   - Observed on the desktop: before +1, chrome shown and popover open at scrollTop 2500. After +1, scrollTop 2598 and chrome hidden. The second "Larger text" click then failed because the popover was not visible ([desktop_scroll_font_change_hides_chrome.png](screenshots/desktop_scroll_font_change_hides_chrome.png)).
   - The popover lives inside the top bar ([ReaderTopBar.tsx:56-61](../../src/components/reader/ReaderTopBar.tsx)), and the scroll-follows-chrome rule hides the bar on 10 px of "user" scroll ([scrollChrome.ts:28-41](../../src/components/reader/scrollChrome.ts); [useReaderChrome.ts:62-80](../../src/components/reader/useReaderChrome.ts)).
3. **The reader's percent disagrees with the library's.**
   - The reader computes `(sectionIndex + offset) / sectionCount`, a chapter-count weighting, for the top progress line, the footer % and "time left in book" ([useReadingProgress.ts:137, 224](../../src/components/reader/useReadingProgress.ts); [PageFooter.tsx:76-78](../../src/components/reader/PageFooter.tsx); [readingSpeed.ts:189-200](../../src/components/reader/readingSpeed.ts)).
   - The server replaces the stored percent with `idx.percent_at(si, offset)`, character-weighted, which the library shows ([server/src/library/library.rs:1033-1040](../../server/src/library/library.rs); [CONTRACT.md:70-71](../../CONTRACT.md)).
4. **A trackpad flick in Pages turns several pages.** Observed: 20 wheel events of 30 px over about 320 ms went from p. 1 to p. 3. The cause is a time-only 350 ms throttle with no end-of-gesture detection ([PagedView.tsx:105-111](../../src/components/reader/PagedView.tsx)).

**Layout and visual rough edges (observed)**

5. **Pages on a phone wastes about 112 px when the chrome is hidden.**
   - Observed: the page box spans y 57→744 of 844. The top bar's 56 px and the tab bar's 56 px stay as blank bands, and the 44 px footer stays visible ([phone_paged_chrome_hidden.png](screenshots/phone_paged_chrome_hidden.png)).
   - Cause: [globals.css:148-168](../../src/styles/globals.css); [ReaderPage.tsx:391](../../src/pages/ReaderPage.tsx).
6. **The Scroll chapter circles cover text while the chrome shows.** Observed: ‹ and › sit over the words "nothing" and "think" ([phone_scroll_after_chapter_drag.png](screenshots/phone_scroll_after_chapter_drag.png); [prose.css:356-388](../../src/styles/prose.css)).
7. **In Scroll, the title page leaves a screen-tall gap before chapter 1.** The title page has `min-height: page-h − 40px`, so scrolling shows the "Contents" button followed by about 450 px of empty space ([prose.css:329-334](../../src/styles/prose.css); [phone_scroll_reading_chrome_hidden.png](screenshots/phone_scroll_reading_chrome_hidden.png)).
8. **On the desktop:**
   - the app side nav (232 px) stays visible in the reader ([AppShell.tsx:18-24](../../src/components/shell/AppShell.tsx));
   - there is no two-page spread, so a 728 px column sits off-centre in a 1440 px window ([desktop_paged.png](screenshots/desktop_paged.png));
   - the measure is about 72–81 chars per line.
9. **The desktop Scroll layout hides the chrome on wheel scroll**, observed after a 1200 px wheel. Any mouse movement brings it back ([useReaderChrome.ts:36-39](../../src/components/reader/useReaderChrome.ts)). The ‹ › chapter buttons are hidden with it, and a mouse click on the page does nothing ([gestures.ts:75-77](../../src/components/reader/gestures.ts)).
10. **End of book: the footer says "The end", and nothing else happens.** There is no end screen, no finished state and no next-book action ([PageFooter.tsx:68](../../src/components/reader/PageFooter.tsx); [desktop_scroll_end_of_book.png](screenshots/desktop_scroll_end_of_book.png); [desktop_paged_end_of_book.png](screenshots/desktop_paged_end_of_book.png)).
11. **The TOC is a plain numbered list.** It has no per-chapter length or progress, no highlights or bookmarks tab, no search, and no scroll-to-current for long TOCs ([TocDrawer.tsx:30-54](../../src/components/reader/TocDrawer.tsx); [desktop_toc_drawer.png](screenshots/desktop_toc_drawer.png)).
12. **The selection menu offers only Highlight (in the last colour) and Note.**
    - It has no Copy, Define, Search in book, Share or colour choice ([SelectionMenu.tsx:67-81](../../src/components/reader/SelectionMenu.tsx); [desktop_selection_menu.png](screenshots/desktop_selection_menu.png)).
    - It always sits above the selection, clamped to 8 px from the top ([SelectionMenu.tsx:63-64](../../src/components/reader/SelectionMenu.tsx)).
    - In mobile Safari, outside the app, it is shown in addition to iOS's own callout, which is suppressed only in the native app ([ReaderPage.tsx:518-528](../../src/pages/ReaderPage.tsx)).
13. **The Tools button is a dead affordance.** It takes a top-bar slot and opens an empty "No tools yet" panel ([ReaderTopBar.tsx:62-68](../../src/components/reader/ReaderTopBar.tsx); [ToolPanel.tsx:46-52](../../src/components/reader/ToolPanel.tsx)).
14. **On phones, reading settings open as a 300 px dropdown that covers the top of the text**, not a bottom sheet ([ReaderTopBar.tsx:56-61](../../src/components/reader/ReaderTopBar.tsx); [ui/Popover.tsx](../../src/components/ui/Popover.tsx); [phone_reading_settings_popover.png](screenshots/phone_reading_settings_popover.png)).

**Inconsistencies between Scroll and Pages**

| Aspect | Scroll | Pages | Source |
|---|---|---|---|
| Footer "page" format | "Chapter N of M" | "p. N of M" | [PageFooter.tsx:69-73](../../src/components/reader/PageFooter.tsx) |
| Back-pill label | "Back" / "Back to Chapter 3" | "Back to p. 42" | [useJumpHistory.ts:121-133, 228](../../src/components/reader/useJumpHistory.ts) |
| Taps | toggle chrome only | turn zones plus a centre toggle | [gestures.ts:62-90](../../src/components/reader/gestures.ts) |
| Mouse click on page | nothing | outer 18% turns | [gestures.ts:66-77](../../src/components/reader/gestures.ts) |
| ↑ ↓ keys | scroll 40 px | turn pages | [ReaderPage.tsx:261-309](../../src/pages/ReaderPage.tsx) |
| Chrome when hidden | overlay, text runs under it, follows scroll direction | slides away but keeps its space | [ReaderPage.tsx:388-403](../../src/pages/ReaderPage.tsx); [globals.css:148-181](../../src/styles/globals.css) |
| Chrome at open (touch) | shown at chapter top | hidden | [ReaderPage.tsx:250-253](../../src/pages/ReaderPage.tsx); [useReaderChrome.ts:5-8](../../src/components/reader/useReaderChrome.ts) |
| Chapter boundary | animated slide | router cut | [ReaderPage.tsx:185-198](../../src/pages/ReaderPage.tsx) |
| Page-turn setting | not applicable (hidden) | slide, fade or none | [ReadingSettings.tsx:98-114](../../src/components/reader/ReadingSettings.tsx) |
| Prev/next controls | floating chapter circles | footer ‹ › page buttons | [ScrollView.tsx:411-418](../../src/components/reader/ScrollView.tsx); [PageFooter.tsx:189-223](../../src/components/reader/PageFooter.tsx) |
| Widows, orphans, break-avoid | none | yes | [prose.css:230-251](../../src/styles/prose.css) |
| Selection across boundary | free | blocked at page edge | [DESIGN.md:95](../../DESIGN.md) |

**Desktop vs touch**:
- Touch-only: the chapter drag ([chapterTurn.ts:54-65](../../src/components/reader/chapterTurn.ts)), the long-press rule ([gestures.ts:55](../../src/components/reader/gestures.ts)), and opening with the chrome hidden.
- Mouse-only: the chrome is never hidden by a click, and the outer-18% zones in Pages.

**Dead or unbuilt settings and features**:
- Unused vocabulary in `ReadingSettingsSuggestion`: `lineHeight`, `measure`, `justify`, `hyphenate`, `paragraphIndent`, `paragraphSpacing`, `headingTypeface`, `notes`, `remoteImages`, `customCss`. Presets and per-document scope are unused too ([shared/src/settings.ts:16-32, 89-96](../../shared/src/settings.ts)).
- No reset-reading-speed UI ([readingSpeed.ts:92](../../src/components/reader/readingSpeed.ts)).
- Bookmark annotations have no UI.
- Deferred from the last round: status bar following the chrome, furthest and last-read positions with the ≥98% re-read rule, a live settings panel and presets, a progress scrubber, an end-of-book experience, and pull-to-bookmark ([reports/iOS reading app UI patterns.md:47, 92, 113, 152, 221, 274](../../reports/iOS%20reading%20app%20UI%20patterns.md)).

**Stale docs and testing gaps**:
- README says `npm test` passes 76 tests ([README.md:129](../../README.md)). `test/` now holds about 191 lines matching `it(`/`test(` across 20 files (grep -c).
- All tests are pure-logic or happy-dom: gestures, chapterTurn, scrollChrome, jump history, reading speed, footnotes, DOM coordinates. None render ScrollView, PagedView or ReaderPage in a real layout engine.
- The mock HTML has no `[data-b]` blocks (observed `blocks: 0`), so preview mode cannot exercise point-based restore.

**In-progress work (git)**:
- `git diff --stat`: 69 tracked files changed, +3,234 / −647, on top of a single commit, `fdd9def Pager first commit Phase 1`. Reader-heavy changes include ReaderPage.tsx +331, prose.css +264, usePagination.ts +231, PageFooter.tsx +216 and useReadingProgress.ts +143.
- Untracked, and therefore never committed: ScrollView.tsx, chapterTurn.ts, useChapterScroll.ts, scrollChrome.ts, gestures.ts, usePressArbiter.ts, useReaderChrome.ts, BackPill.tsx, useJumpHistory.ts, FootnotePopover.tsx, footnotes.ts, readingSpeed.ts, layout.ts, events.ts, useNativeMenu.ts, `src/lib/native.ts`, nine new test files, `ios/` and `relay/` (`git status --short`).

### Inferences
- The likely mechanism for bug 2 is the browser's own scroll anchoring, or a restore scroll arriving after the 100 ms "own move" window ([useChapterScroll.ts:13, 82-95](../../src/components/reader/useChapterScroll.ts)). Either way the move is classified as a user scroll. Holding the chrome while a settings popover is open, or calling `hold()` around relayouts, would avoid it. This is not verified.
- Bug 3 means the same book can read, say, "42%" in the reader and a different figure in the library, and "time left in book" is skewed whenever chapters vary in length.
- The uncommitted state is a practical risk. The entire Scroll layout, the gesture arbiter and the footnote work exist only in the working tree.

### Gaps
- I did not test the iPhone app (never compiled), so native selection-menu, haptic and safe-area behaviour on a device are unknown.
- I did not test dark-mode contrast of highlights over real EPUB images or tables.
