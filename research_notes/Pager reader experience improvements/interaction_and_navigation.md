# Interaction, motion and navigation details beyond the iOS report (desktop, Android/e-ink, session lifecycle)

Scope note: this deliberately skips everything in `reports/iOS reading app UI patterns.md` (iOS chrome hiding, Readest centre band / 15 px slop / 250 ms double-tap / 500 ms hold, foliate-js 300 ms snap, Kindle footer cycling, Libby navigator, back pill table, footnote popovers, recency colour, Apple Books themes, haptics, Readest pull-to-bookmark numbers, Omnivore ≥98% rule). It adds desktop, Android/e-ink, sync and lifecycle material.

Evidence tags used below: **[code]** = read in the shipping source (exact values); **[docs]** = vendor help/developer docs; **[eng-note]** = Readest's public engineering notes in `.claude/memory/` (written by its maintainers/agents while fixing real bugs; describe failure modes with repro detail); **[press]** = journalism; **[forum]** = user reports (weak, often old); **[local]** = Pager's own code or earlier Pager reports; **[inference]** = my reasoning.

Primary sources pulled for this note (all fetched 2026-10-29 from default branches):
- Readest: `apps/readest-app/src/helpers/shortcuts.ts`, `app/reader/utils/wheelGesture.ts`, `utils/autoscroller.ts`, `utils/autoScrollSpeedGesture.ts`, `hooks/useAutoScroll.ts`, `hooks/useProgressSync.ts`, `components/KOSyncResolver.tsx`, `services/constants.ts`, `utils/config.ts`, plus ~40 `.claude/memory/*.md` notes.
- KOReader (master): `defaults.lua`, `frontend/device/gesturedetector.lua`, `plugins/gestures.koplugin/defaults.lua`, `plugins/kosync.koplugin/main.lua`, `frontend/apps/reader/modules/{readerstatus,readerback,readerview,readerhighlight}.lua`, `frontend/ui/elements/{page_turns,refresh_menu_table}.lua`, `frontend/ui/widget/{skimtowidget,bookstatuswidget}.lua`, `plugins/autoturn.koplugin/main.lua`.
- foliate-js (main): `paginator.js`, `view.js`, `progress.js`; Foliate GTK (gtk4): `src/ui/help-overlay.ui`.
- calibre viewer (master): `src/pyj/read_book/{shortcuts,paged_mode,touch,view}.pyj`, `prefs/scrolling.pyj`, `src/pyj/session.pyj`.
- Thorium (develop): `src/common/keyboard.ts`.

---

## Q1. Desktop reading: keyboard, mouse wheel / trackpad, click zones, two-page spreads, resize reflow, fullscreen

### Takeaway
Desktop readers share one core keymap: ←/→, Space/Shift+Space and PageUp/PageDown turn pages, Home/End go to the ends, Alt+←/→ (Thorium and Kindle use Backspace) walk a back/forward history, `/` or Ctrl/Cmd+F searches, Ctrl+G (or `;` in calibre) jumps to a location, Ctrl/Cmd +/−/0 changes the font size, F11 goes fullscreen, and `?` shows the shortcuts. Vim keys `h/j/k/l` are common in the open-source readers. The hard part of mouse input is turning a trackpad's long, inertial stream of wheel events into exactly one page turn. Readest sums 30 px, turns once, then ignores everything until the wheel has been idle for 200 ms. calibre turns a page for every 60 px and resets after 1 s idle. Two-page spreads switch on by width, not by device: foliate-js uses min(2, ceil(width / 720 px)) and forces one column in portrait, and calibre uses floor(width / 35 em). A resize keeps the reader's place by anchoring to a DOM Range rather than a page number.

### Cited Findings

**Default keymaps, exact bindings**
- **Readest [code]**:
  - Turning and scrolling: ← / `h` / Shift+Space and → / `l` / Space turn left and right. ↑ / `k` and ↓ / `j` scroll. Shift+→, Shift+↓ and PageDown go to the next page; Shift+K, Shift+←, Shift+↑ and PageUp go to the previous one. `d` and `u` move half a page (vim).
  - Sections and history: Alt/Opt+←/→/↑/↓ move by section. Home and End go to the start and end of the book. **Shift+H / Shift+L go Back / Forward**.
  - Font size: Ctrl/Cmd+= and Ctrl/Cmd+−, also Shift+= and Shift+−, with Ctrl/Cmd+0 to reset.
  - Panels and modes: Enter toggles the toolbar. `s` toggles the sidebar and `n` the notebook. Ctrl/Cmd+F searches and Ctrl/Cmd+B bookmarks. Shift+J toggles scroll mode, Shift+A auto-scroll, Shift+P paragraph mode, Shift+V speed reading (RSVP) and `t` text-to-speech, with Space as play/pause while TTS is on.
  - Settings and help: Shift+F or Ctrl/Cmd+, opens settings, Ctrl/Cmd+Shift+P the command palette, and Shift+? the shortcuts help. F11 toggles fullscreen.
  - Selection: Ctrl/Cmd+H highlight, +U underline, +N annotate, +C copy, +T translate, +D dictionary, +R read aloud. Shift+←/→ adjusts the selection by character, and Ctrl/Alt+Shift+←/→ by word.
  - Users can rebind every shortcut (issue #3772). — [shortcuts.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/helpers/shortcuts.ts); [custom-shortcuts-3772](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/custom-shortcuts-3772.md)
- **Foliate GTK [code]**:
  - Turning and scrolling: `p` / PageUp / Shift+Space go to the previous page and `n` / PageDown / Space to the next. `h` / ← go left and `l` / → go right. `j` / ↓ scroll down and `k` / ↑ scroll up.
  - History: **Alt+← / Alt+→ jump to the previous / next location**.
  - Panels: F9 sidebar, Ctrl+T contents, Ctrl+Alt+A annotations, Ctrl+Alt+D bookmarks.
  - Search: `/` or Ctrl+F, with Ctrl+G / Ctrl+Shift+G for next and previous.
  - Font size: `+`, `−` and `0`, with or without Ctrl.
  - View and location: F11 fullscreen, Ctrl+M scrolled mode, **Ctrl+L show current location**, Ctrl+D bookmark the current location.
  - Other: Alt+, opens font and layout settings, Ctrl+? the shortcuts, and Ctrl+P prints. — [help-overlay.ui](https://github.com/johnfactotum/foliate/blob/gtk4/src/ui/help-overlay.ui)
- **calibre e-book viewer [code]**:
  - Ends of file and book: Home (or Ctrl+↑/←) goes to the start of the current file and End (or Ctrl+↓/→) to its end. Ctrl+Home and Ctrl+End go to the start and end of the book.
  - Scrolling: ↑/↓ "Scroll backwards/forwards smoothly (by screen-fulls in paged mode)". PageUp/Shift+Space and Space/PageDown move by screen-fulls. Ctrl+PageUp/PageDown go to the previous and next section.
  - History: **Alt+← Back / Alt+→ Forward**.
  - Locations: **Go to location: `;`, `:` or Ctrl+G**. "Copy current location as calibre:// URL" is Ctrl+Shift+C.
  - Search: `/`, Ctrl+F or Cmd+F. F3/Enter finds the next match and Shift+F3/Shift+Enter the previous.
  - Font size: Ctrl+=/− and Ctrl+0.
  - Pages per screen: Ctrl+[ decreases it, and Ctrl+Alt+C makes it automatic.
  - Modes: F11 or Ctrl+Shift+F fullscreen. Ctrl+M toggles paged and flow mode. Ctrl+X toggles reference mode. Alt+P switches between settings "profiles".
  - Auto-scroll: **Ctrl+Space toggles it, and Alt+↑/↓ makes it faster or slower**.
  - Selection: Shift+arrows and Ctrl+Shift+arrows extend it by character, word, line or paragraph.
  - Controls: Esc shows the viewer controls. — [shortcuts.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/read_book/shortcuts.pyj)
- **Thorium [code]**:
  - Pages: ←/→, plus Ctrl+, and Ctrl+. as alternates.
  - Chapters: Ctrl+Shift+←/→ (plus Alt on Windows and Linux), or **Ctrl+PageUp/PageDown**.
  - Ends of the book: Ctrl+Home/End.
  - **History: back with Ctrl+Backspace, forward with Ctrl+Shift+Backspace**.
  - Go to page: Ctrl+Shift+P.
  - Search: Ctrl+F, F3 and Shift+F3, Ctrl+G and Ctrl+Shift+G.
  - Bookmarks: Ctrl+B, and Alt+Shift+B for a bookmark with a label.
  - Fullscreen: Ctrl+F11. **"Zen mode": Ctrl+Shift+F11**.
  - Settings: Ctrl+S. Close: Ctrl+W.
  - "Where am I": Ctrl+Shift+I, and Ctrl+Shift+K speaks it.
  - Annotations: create with Alt+Shift+A, quick annotation with Alt+Shift+Q.
  - Audio controls: Ctrl+1–7. — [keyboard.ts](https://github.com/edrlab/thorium-reader/blob/develop/src/common/keyboard.ts)
- **Apple Books for Mac [docs]**:
  - Pages: → / ↓ / PageDown go to the next page and ← / ↑ / PageUp to the previous.
  - **Chapters: Option+→/← go to the next or previous chapter, and Option+↓/↑ go to the end or beginning of the chapter**.
  - Font size: Cmd +/−/0. Fullscreen: Fn/Globe+F.
  - Bookmarks: Cmd+D adds one, and Shift+Cmd+D shows the list.
  - Panels: Cmd+F search, Cmd+T contents, **Shift+Cmd+T thumbnails**, Shift+Cmd+N notes.
  - Trackpad: swipe left or right to turn the page.
  - The guide lists no "go back" shortcut. An older Apple guide and iDownloadBlog give Shift+Cmd+→ for the next chapter instead, so the binding has changed across versions. — [Apple Books Mac shortcuts](https://support.apple.com/guide/books/ibk0a716cf4-9a70-485b-9835-72e3c7ed6c29/mac); [iDownloadBlog](https://www.idownloadblog.com/2020/03/27/keyboard-shortcuts-for-books-mac/)
- **Kindle for Windows [docs]** (Amazon says the legacy "Kindle for PC" app is unsupported as of 30 June 2026):
  - Pages: PageDown/→/↓ next, PageUp/←/↑ previous.
  - **Backspace goes Back**. Ctrl+G goes to a location. Ctrl+F searches.
  - Font size: Ctrl +/−.
  - Ctrl+D adds a bookmark, Ctrl+N opens the notebook, Ctrl+W closes the book, F5 syncs.
  - The list has no chapter keys and no fullscreen key. — [Amazon: Kindle for Windows Keyboard Shortcuts](https://digprjsurvey.amazon.com/csad/help/node/GPC7U392HH93VPC8)
- **Readwise Reader web [docs/blog]**:
  - The arrow keys move a purple **paragraph focus indicator**. `h` highlights the focused paragraph, and `n` highlights it and opens the note pane. Space moves to the next paragraph.
  - Shift+H toggles auto-highlighting.
  - Cmd/Ctrl+K opens the command palette, and `?` shows a quick reference.
  - Keyboard highlighting works "at the paragraph level" only. On mobile, a double-tap on a paragraph does the same. — [Readwise Highlights FAQ](https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes); [Getting Started with Reader](https://blog.readwise.io/p/bf87944f-b0fe-4f08-a461-f75ab8aded6a/)
- **Readest keyboard pitfalls [eng-note]**:
  - **Zoom keys did nothing.** Ctrl/Cmd +/−/0 were dead on reflowable books because they drove only the fixed-layout `scale-factor`. They now step the book's own default font size (issue #5694). — [zoom-shortcuts-reflowable-font-size-5694](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/zoom-shortcuts-reflowable-font-size-5694.md)
  - **Selection keys turned the page.** After a selection, focus moves to the parent document. The selection-adjust handler is therefore wired *first*, so Shift+→ extends the selection instead of turning the page. With no selection, Shift+→ still navigates. Cmd+Shift is left to the OS for line selection. — [keyboard-selection-adjust-4728](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/keyboard-selection-adjust-4728.md)
- **Pager today [local]**: [ReaderPage.tsx](../../src/pages/ReaderPage.tsx) handles arrows, Space/Shift+Space, PageUp/PageDown, Home/End and Esc. It returns early on any Meta, Ctrl or Alt modifier. In the Scroll layout, ←/→ turn chapters.

**Wheel and trackpad paging in paginated mode**
- **Readest `wheelGesture.ts` [code]**:
  - **Normalizing.** Line-mode deltas count as 40 px each and page-mode deltas as 800 px.
  - **Turning once.** A page turns when the accumulated travel on either axis reaches **30 px**. The gesture is then marked `flipped`, and **the rest of the stream (the momentum tail) is swallowed until the wheel has been idle for 200 ms**. The comment says this "mirrors what native readers (e.g. Apple Books) do … so one gesture flips exactly one page".
  - **Direction.** The turn follows the dominant axis, so cross-axis noise can't turn the wrong way.
  - **Zoomed pages.** A `suppress()` call marks gestures that native scrolling consumed, for example on a zoomed page, so the ticks that arrive once the page hits its edge cannot turn it.
  - **The problem it solves.** The Magic Mouse and trackpads emit "a long stream of tiny, low-magnitude wheel events … plus an inertial momentum tail", and "even a light brush" produces deltas. — [wheelGesture.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/utils/wheelGesture.ts)
- **calibre `paged_mode.pyj` [code]**:
  - **Pixel-mode deltas** accumulate per axis, and a page turns when they exceed **60 px**. The setting is `paged_pixel_scroll_threshold` ("Pixel scroll threshold").
  - **Reset rules.** The accumulator resets after **more than 1000 ms** since the last event, on a change of direction, and after every turn. A long trackpad stream can therefore turn several pages, unlike Readest.
  - **Other deltas.** Line- and page-mode deltas turn a page directly.
  - **Defaults** ([session.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/session.pyj)):
    - `paged_wheel_scrolls_by_screen` is False ("Mouse wheel scrolls by screen fulls instead of pages").
    - **`paged_wheel_section_jumps` is True** ("Horizontal mouse wheel jumps to next/previous section").
    - `paged_margin_clicks_scroll_by_screen` is True. — [paged_mode.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/read_book/paged_mode.pyj); [prefs/scrolling.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/read_book/prefs/scrolling.pyj)
- **calibre flow (scroll) mode at file boundaries [code]**:
  - "Seconds to pause when mouse-scrolling past internal file boundaries" defaults to **0.5 s**; zero means no pause.
  - "Stop at internal file boundaries when smooth scrolling by holding down the scroll key" defaults to off.
  - Smooth scrolling runs at **20 lines/s**. — [session.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/session.pyj); [prefs/scrolling.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/read_book/prefs/scrolling.pyj)
- **Pager's own sideways-swipe chapter turn [local]** uses three constants in [chapterTurn.ts](../../src/components/reader/chapterTurn.ts):
  - `WHEEL_TURN_PX = 80`;
  - `WHEEL_LOCK_MS = 600`;
  - `WHEEL_QUIET_MS = 200`, "so a swipe's momentum never turns twice".
- **A double-scroll failure mode [eng-note]**:
  - **The bug.** A wheel listener on an iframe page called `scrollBy(e.deltaY)` itself while the browser was already chaining the wheel to the host scroller. **Each notch scrolled about 2× over the page and 1× over the margin.**
  - **Why it struck so often.** Notches slower than about 6 per second all landed inside the 150 ms window in which the iframe takes pointer events again after scrolling.
  - **The fix.** Delete the manual scroll and let native scroll chaining do the work.
  - **Testing.** Synthetic wheel events do not trigger native chaining; only real `page.mouse.wheel` does. — [pdf-scroll-mode-wheel-double-4727](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/pdf-scroll-mode-wheel-double-4727.md)
- **Readest middle-click autoscroll** (desktop, scrolled mode only, always on, no setting) [code]:
  - **Speed.** A **12 px dead zone** around the anchor, then **10 px/s of velocity per px of pointer offset, capped at 4000 px/s**. Sub-pixel remainders carry over between frames.
  - **Sticky or drag.** A quick release near the anchor makes it sticky until the next click. A drag past the dead zone stops when the button is released.
  - **Conflicts.** It swallows the middle-click `auxclick` so links do not open, and it calls `preventDefault` on WebView2's own autoscroll. — [autoscroller.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/utils/autoscroller.ts); [middle-click-autoscroll-4951](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/middle-click-autoscroll-4951.md)
- **Cursor auto-hide [eng-note]**:
  - foliate-js's `CursorAutohider` hides the pointer after **1 s** without mouse movement.
  - It used to blank the cursor in the middle of a paused selection drag. The fix guards inside `hide()` with `!getSelection().isCollapsed`, so the cursor never hides while text is selected. It is desktop-only. — [cursor-autohide-blanked-during-selection](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/cursor-autohide-blanked-during-selection.md)

**Click zones on desktop**
- **calibre [code]**:
  - Clicking a margin turns by **a whole screen** rather than one column by default (`paged_margin_clicks_scroll_by_screen = True`), which matters in two-column spreads.
  - **"Invert the page turn tap areas"** (`reverse_page_turn_zones`, default off) makes the left side go forward.
  - A controls-help overlay appears the first time a book is opened in a session, **at most twice in total**, with a separate count for books that turn right to left. — [session.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/session.pyj); [view.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/read_book/view.pyj)
- **Readest [eng-note]**:
  - On screens 640 px and wider that are not mobile, a **52 px hover strip** over the footer band reveals the toolbar on hover.
  - The tap-to-hide footer is "a touch-first feature by design", so desktop clicks never reach it. — [tap-toggle-progress-bar-5293](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/tap-toggle-progress-bar-5293.md)

**Two-page spreads: when to switch**
- **foliate-js [code]**:
  - Defaults: `--_max-inline-size: 720px`, `--_max-column-count: 2`, `--_gap: 7%`.
  - Columns = `min(maxColumnCount, ceil(size / maxInlineSize))`.
  - **`@container (orientation: portrait)` forces `--_max-column-count-portrait`, which is 1.** A landscape container wider than 720 px therefore gets two columns, and a portrait one always gets a single column. — [paginator.js](https://github.com/johnfactotum/foliate-js/blob/main/paginator.js)
- **Readest [code]**:
  - It uses `maxColumnCount: 2` with a `maxInlineSize` of 720. On portrait screens the size is `max(screenWidth, 720)`, so phones in portrait never split into columns.
  - Its mobile defaults set `spreadMode: 'none'` and `disableDoubleClick: true`.
  - Fixed-layout books use `spreadMode: 'auto'` and `keepCoverSpread: true`. — [constants.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/services/constants.ts); [utils/config.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/utils/config.ts)
- **calibre [code]**:
  - **`columns_per_screen` has separate portrait and landscape values**. 0 means auto, which is **floor(viewport inline size / 35 em), clamped to 1–20**. At 16 px that is about 1120 px for two columns.
  - With more than one column, a page that holds only a full-screen image falls back to a single column. — [paged_mode.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/read_book/paged_mode.pyj)

**Window resize and rotation keep the place**
- **foliate-js [code]**:
  - The paginator keeps an `#anchor`, which is a fraction, a Range or an Element.
  - A `ResizeObserver` calls `render()`, which scrolls back to the anchor.
  - After a user turn or scroll, the anchor becomes the visible Range. After programmatic navigation the anchor stays on the target. — [paginator.js](https://github.com/johnfactotum/foliate-js/blob/main/paginator.js)
- **Readest drift bug, fixed in August 2026 [eng-note]**:
  - **Symptom.** Rotating portrait → landscape → portrait **moved back a page on every round trip**, usually at the start of a section in a two-column layout. Desktop window resizes and split view had the same drift.
  - **Cause.** The restore scroll fired the debounced scroll listener, which re-derived the anchor.
  - **Fix.** Keep the anchor while its start is still in the visible range (`range.comparePoint`).
  - **Regression test.** Resize between 400×700 and 700×400 twice, letting the 250 ms debounce fire between steps, and expect the same page. — [resize-anchor-drift-5808](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/resize-anchor-drift-5808.md)

**Fullscreen and focus**
- **The F11 family.** F11 means fullscreen in Foliate, Readest and calibre (calibre also accepts Ctrl+Shift+F). Thorium uses Ctrl+F11 and adds a separate **Zen mode** on Ctrl+Shift+F11. Apple Books uses Fn/Globe+F. — sources as above.

### Inferences
- **Keys Pager lacks [inference].** Compared with this consensus, Pager is missing:
  - Back and Forward on **Alt+←/→**, which pairs naturally with its back pill;
  - search on `/` and Ctrl/Cmd+F;
  - go-to on Ctrl+G or `;`;
  - `j/k` and `h/l`;
  - a `?` help overlay;
  - chapter keys in the Pages layout, using Option/Alt+arrows as Apple Books and Readest do.

  Every one of these needs a modifier or a printable key, and Pager drops all modified keys today. Ctrl/Cmd +/−/0 collide with the browser's own zoom in a PWA. Readest and calibre own them because they run in their own shells, so Pager should intercept them only in the reader and only if it treats them as text size.
- **A two-path wheel model [inference].** Treat one notched mouse-wheel tick as one page: `deltaMode` 1, or large discrete `deltaY` values that arrive at a slow cadence. Trackpad streams should use Readest's rule: 30 px of accumulated travel, one turn, and the tail swallowed until 200 ms idle. That avoids the main failure of calibre's model, where one long trackpad flick turns several pages. Pager's 80 px threshold, 600 ms lock and 200 ms quiet period for sideways chapter turns already follow this idea. The 30 px figure is the comparison point for page turns, which should be lighter than chapter turns.
- **A pause at chapter boundaries [inference].** In Scroll mode, calibre's 0.5 s pause when wheel-scrolling across a file boundary is a cheap way to make chapter transitions feel deliberate on desktop. Its "seconds to pause before auto-scrolling past boundaries" (5 s) is the auto-scroll equivalent.
- **Spread rule [inference].** If Pager adds two-page spreads to the Pages layout, foliate-js's rule is simple and well tested: two columns only in landscape and only when the column would otherwise exceed about 720 px or 35 em. Turns, clicks and wheel ticks should then move by a whole spread, as calibre's margin clicks do.

### Gaps
- No primary source was found for the **Google Play Books web reader**'s keyboard shortcuts or its thumbnail scrubber; both searches returned unrelated pages.
- **Kindle Cloud Reader** shortcuts were not verified.
- Apple does not document when **Apple Books for Mac** switches to two pages.
- Thorium's column settings (auto, 1 or 2) were not checked in its code.

---

## Q2. Android and e-ink: KOReader's gesture manager, Moon+ Reader, Kobo and Kindle devices, and what transfers

### Takeaway
KOReader is the most configurable reference and the only one whose values are all in source. Its defaults:
- The forward zone covers the right 75% of the screen and the backward zone the left 25%. Menu and config bands are each 1/8 of the height, and the corners are 1/8 × 1/8.
- Double-tap waits 300 ms, hold 500 ms, and a "very long hold" 3 s.
- Corners are pre-bound to bookmark and frontlight, and the left edge controls the frontlight.
- Default multiswipes cover navigation: back, contents, skim, go-to, and the previous or next chapter.

Its progress sync defaults to **prompt when the remote position is ahead, and never sync backward**. Moon+ Reader's distinguishing features are its five auto-scroll modes, configurable hardware keys and tilt-to-turn. E-ink devices add full-refresh cadence: every page, every 6 pages or every chapter. The ideas that transfer to a phone or desktop web reader are:
- zone layouts with presets and a size slider;
- an invert option for left-handed reading;
- a per-book versus default (★) settings model;
- a page-overlap indicator for screen-by-screen paging;
- a skim widget with ±1/±10 steps and a return arrow;
- one-tap corner bookmarks;
- a timed auto-turn.

Hardware volume keys cannot be used for page turns on iOS.

### Cited Findings

**KOReader tap zones, as screen fractions [code]** ([defaults.lua](https://github.com/koreader/koreader/blob/master/defaults.lua))

| Zone | x | y | w | h |
|---|---|---|---|---|
| `DTAP_ZONE_FORWARD` | 1/4 | 0 | 3/4 | 1 |
| `DTAP_ZONE_BACKWARD` | 0 | 0 | 1/4 | 1 |
| `DTAP_ZONE_MENU` (full-width top band) | 0 | 0 | 1 | 1/8 |
| `DTAP_ZONE_MENU_EXT` ("taller, narrower extension") | 1/4 | 0 | 2/4 | 1/5 |
| `DTAP_ZONE_CONFIG` (bottom band) | 0 | 7/8 | 1 | 1/8 |
| `DTAP_ZONE_CONFIG_EXT` | 1/4 | 4/5 | 2/4 | 1/5 |
| Each of the four corners | — | — | 1/8 | 1/8 |
| Double-tap next / previous chapter | same as forward / backward | | | |
| Edge swipe zones | 1/8 strip along each edge | | | |

**KOReader page-turn settings [code]**
- **Layouts.** Tap-zone layouts are **Default, Left/right, Top/bottom and Bottom/top**.
- **Zone sizes.** "Backward / forward tap zone size" is set as a percentage of width or height.
- **Toggles.** "With taps", "With swipes", "Swipes always active", and **"Invert page turn taps and swipes"**.
- **Per-book defaults.** "Invert page turn taps and swipes" has a per-book versus default switch. Prompts read "The default (★) for newly opened books is left-to-right (LTR) page turning. Would you like to change it?", and the same applies to "Invert document-related dialogs".
- **Animations.** "Page turn animations" is a separate setting. — [page_turns.lua](https://github.com/koreader/koreader/blob/master/frontend/ui/elements/page_turns.lua)

**KOReader gesture timings [code]**
- **Defaults:**
  - tap interval 0 ms;
  - **double-tap interval 300 ms**;
  - two-finger tap 300 ms;
  - **hold 500 ms**;
  - **long hold 3 s**;
  - swipe interval 900 ms.
- **Distances, scaled by DPI:** double-tap distance and single-tap bounce 50, **pan threshold 35**, two-finger tap region 20, multiswipe threshold 50.
- **Every time is a user setting** (`ges_*_ms`). — [gesturedetector.lua](https://github.com/koreader/koreader/blob/master/frontend/device/gesturedetector.lua)

**KOReader's default reader gestures [code]**
- **Corners.** Tapping the top-left corner toggles **page flipping (skim)**, tapping the **top-right corner toggles a bookmark**, and tapping the bottom-left corner toggles the frontlight.
- **Edges.** A **swipe up or down along the left edge changes the frontlight**, and the right edge changes warmth.
- **Double-taps.** A **double-tap on the left or right side jumps −10 / +10 pages**.
- **Full refresh.** A short diagonal swipe forces one.
- **Multiswipes** ([gestures.koplugin/defaults.lua](https://github.com/koreader/koreader/blob/master/plugins/gestures.koplugin/defaults.lua)):

| Pattern | Action |
|---|---|
| ⬅➡ | previous location |
| ➡⬅ | latest bookmark |
| ⬆➡ | table of contents |
| ⬆⬅ | bookmarks |
| ➡⬆ | history |
| ⬅⬆ | book status |
| ➡⬇ | go to |
| ⬇⬆ | skim |
| ⬅⬇ | back |
| ⬆⬇⬆ / ⬇⬆⬇ | previous / next chapter |
| ⬅➡⬅ | open previous document |
| ⬊⬈ | follow the nearest link |

- **Two-finger swipes.** East opens the contents, west the bookmarks, and north or south changes the frontlight.
- **Spread** (two fingers moving apart) increases the font size.

**KOReader navigation widgets [code]**
- **Location history.** A back stack holds up to **5000 entries** (`max_stack = 5000`). When it is empty, KOReader says "Location history is empty." — [readerback.lua](https://github.com/koreader/koreader/blob/master/frontend/apps/reader/modules/readerback.lua)
- **Skim widget.** Buttons for **−10, −1, +1 and +10**, a current-page button, **chapter ◁ ▷**, **bookmark previous and next**, a bookmark toggle, and **↺ to return** to where skimming started.
  - The progress bar carries **TOC ticks** (`getTocTicksFlattened`).
  - Small screens show 5 buttons, with the middle one set apart; larger screens show 11, evenly spaced.
  - Mirroring follows the text direction. — [skimtowidget.lua](https://github.com/koreader/koreader/blob/master/frontend/ui/widget/skimtowidget.lua)
- **Page overlap in scroll mode.** `DOVERLAPPIXELS = 30` and `DSHOWOVERLAP = false`. The overlap indicator styles are **"No indicator", "Gray out", "Arrow", "Solid line", "Dashed line"**. — [defaults.lua](https://github.com/koreader/koreader/blob/master/defaults.lua); [readerview.lua](https://github.com/koreader/koreader/blob/master/frontend/apps/reader/modules/readerview.lua)
- **AutoTurn plugin.** It turns a page every N seconds (`autoturn_sec`), or scrolls a fraction of a page (`autoturn_distance`). Any user action restarts the timer from `last_action_time`. Its message reads "Autoturn is now active and will automatically scroll %1 % of the page every %2 seconds." — [autoturn.koplugin/main.lua](https://github.com/koreader/koreader/blob/master/plugins/autoturn.koplugin/main.lua)
- **E-ink full refresh.** "Full refresh rate" offers **Never, Every page, Every 6 pages** and two custom slots. "For every chapter set -1". — [refresh_menu_table.lua](https://github.com/koreader/koreader/blob/master/frontend/ui/elements/refresh_menu_table.lua)

**Other Android and e-ink readers**
- **calibre touch thresholds [code]**:
  - hold **750 ms**;
  - tap within **8 px**;
  - swipe beyond **64 px**, counted only when the minor/major axis ratio is below 0.35;
  - pinch beyond 20 px;
  - **link hit-testing probes ±5 px** around the tap (a 3×3 grid) to find a link.
  - Configurable gestures include "**Drag and hold finger in writing direction, to go forward**", calibre's hold-to-keep-turning. — [touch.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/read_book/touch.pyj)
- **Moon+ Reader [docs, a wiki summary of the store listing]**:
  - "5 auto-scroll modes: rolling blind mode; by pixel, by line or by page", with "real-time speed control".
  - Paging by "touch screen, volume keys or even camera, search or back keys".
  - "24 customized operations" across "15 events".
  - Pro adds headphone and Bluetooth keys and "**Tilt to turn page**".
  - Sliding a finger along the left edge sets brightness.
  - "Shake the phone to speak" starts text-to-speech; it is not a page-turn gesture.
  - "Real page turning effect" with adjustable speed, colour and transparency, and "5 page flip animations".
  - "10+ themes" plus a "Day & Night mode switcher".
  - Reading positions sync through Dropbox, and GDrive in Pro. — [MobileRead wiki: Moon+ Reader](https://wiki.mobileread.com/wiki/Moon+_Reader)
- **Readest on e-ink [code]**:
  - Its e-ink defaults are `animated: false` and **`volumeKeysToFlip: true`**.
  - Volume-key paging of the library was verified on a device. Each Volume Down pages forward, with the scroll snapped to rows, and the ringer volume did not change. — [constants.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/services/constants.ts); [library-volume-keys-xiaomi-verified](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/library-volume-keys-xiaomi-verified.md)
- **The Kindle Android app** offers "turn pages with volume control", according to users *[forum; taken from a search summary of Logos threads, post not opened]*. — [Logos community](https://community.logos.com/discussion/comment/1242135)
- **Kindle e-reader "Page Refresh" [docs/press]**:
  - It forces a full refresh on every page turn. That "will eliminate most ghosting" at the cost of a flash and some battery.
  - PDFs and comics flash on every turn regardless.
  - The setting lives in Settings › Home, Library and Notebooks › Book and notebook options on newer firmware, and in Reading Options on older firmware. — [iFixit](https://www.ifixit.com/Wiki/Kindle_Paperwhite_12th_Gen_Screen_Ghosting)
- **Kobo left-handed use [forum, old]**:
  - On the Kobo Touch in 2012, the page-turn zone could be moved for left-handed users.
  - In 2021, users complained that **inverting the screen does not flip the tap zones**, so they have to change the zones by hand each time.
  - No current official Kobo documentation was found. — [MobileRead 2012](https://www.mobileread.com/forums/showthread.php?p=2077681); [MobileRead 2021](https://www.mobileread.com/forums/showthread.php?p=4182134)
- **Volume buttons on iOS [docs/forum]**: App Store Review Guideline **2.5.9** rejects apps that "alter or disable the functions of standard switches, such as the Volume Up/Down and Ring/Silent switches". Developers on Apple's forums read it as ruling out volume-button page turns. — [Apple Developer Forums 696271](https://developer.apple.com/forums/thread/696271); [mjtsai on Astropad rejection](https://mjtsai.com/blog/2017/11/10/astropads-camera-button-rejected-from-the-app-store)

### Inferences
- **Transferable ideas for Pager [inference]**:
  1. **Tap-zone presets plus a size slider.** Offer Default (back 25% / forward 75%, as in KOReader), Both-margins-forward, and Left-handed (inverted), with zone-width sliders.
  2. **A corner tap to bookmark.** KOReader's default top-right corner (1/8 × 1/8) is far less accident-prone than Libby's whole top edge.
  3. **A KOReader-style skim widget for the scrubber.** Use ±1/±10 steps, chapter and bookmark jumps, TOC ticks and an ↺ return. On desktop it doubles as keyboard-reachable navigation.
  4. **An overlap indicator for Space paging in the Scroll layout.** Keep about 30 px of overlap between screens, marked with a grey band or dashed line, so the eye can find its line after Space or PageDown.
  5. **Per-book versus default settings marked with ★**, so the scope of a setting is visible.
  6. **A timed auto-turn for the Pages layout**, which complements auto-scroll in the Scroll layout.
- **What not to transfer [inference].** Multiswipes, two-finger gestures and double-tap ±10 pages suit e-ink, where selection is rare. On a phone they would compete with selection and double-tap-word.
- **Keep the frontlight-style edge swipe in mind [inference].** It maps to Readest's 10% brightness strip, which was covered in the earlier report.

### Gaps
- **ReadEra's gestures** were not covered here; Pager's separate ReadEra report covers its sync. **Lithium** was not researched for lack of budget.
- **Kindle e-reader** left-handed and page-button options, and **Kobo**'s current official tap-zone options, were not confirmed from official sources.
- The Moon+ evidence is a wiki summary of store copy, not the app itself.
- No source mentions a **page-turn sound** option in Moon+, Kindle or Apple Books.

---

## Q3. Position and navigation: storage across reflow, jump history, furthest vs last read, sync conflicts, scrubbers, "where was I"

### Takeaway
Positions are stored as content anchors, not page numbers: a CFI or Range, or an XPointer in KOReader. Fractions serve only as a fallback across different files. foliate-js's history is the best model for "go back": **push on jumps, replace on ordinary page turns**, so Back returns to where you were reading and Forward returns to how far you got. For sync, the strongest rule set is KOReader's: **remote ahead of local → prompt (default); remote behind local → never (default)**. It compares the remote timestamp with the local last page turn. Readest adds last-writer-wins on the server, a forward-only epsilon for copies of the same book, and an "already resolved" memory so a conflict dialog never returns for the same remote report. Kindle's "furthest page read" prompt is the cautionary tale: it jumps partway, and the furthest page could not be reset.

### Cited Findings

**Anchors and history**
- **foliate-js `History` [code]**:
  - `pushState` is called by `goTo` and `goToFraction`. It skips a duplicate of the last entry or one with the same fraction.
  - **`replaceState(cfi)` runs on relocations whose reason is `snap`, `page` or `scroll`.** The current entry therefore follows your reading after a jump.
  - `back()` and `forward()` move through the array, and a push truncates the forward entries.
  - `init()` pushes `lastLocation`. With no saved location it calls **`goToTextStart()` if `showTextStart` is set**, which skips the cover and front matter; otherwise it goes to the first page. — [view.js](https://github.com/johnfactotum/foliate-js/blob/main/view.js)
- **foliate-js progress units [code]**: `SectionProgress(sections, 1500, 1600)` gives one "location" per **1500** size units and one time unit per **1600** of remaining size. That makes location and time estimates a function of section byte size, not of layout. — [view.js](https://github.com/johnfactotum/foliate-js/blob/main/view.js); [progress.js](https://github.com/johnfactotum/foliate-js/blob/main/progress.js)
- **Back and forward bindings [code/docs]**:

| App | Back | Forward |
|---|---|---|
| Foliate, calibre | Alt+← | Alt+→ |
| Thorium | Ctrl+Backspace | Ctrl+Shift+Backspace |
| Kindle for Windows | Backspace | — |
| Readest | Shift+H | Shift+L |
| KOReader | multiswipe ⬅➡ "previous location", and ⬅⬇ "back"; stack of 5000 entries | — |

  Sources: as listed under Q1 and Q2.
- **Readest "Current position" row [eng-note]**: the TOC sidebar adds a synthetic, clickable "Current position" row under the active chapter, indented one level and showing the live page number, so the TOC shows where you are within the chapter. — [toc-current-position-row](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/toc-current-position-row.md)
- **Shareable positions in calibre [code]**: Alt+C copies the current location, and Ctrl+Shift+C copies it as a `calibre://` URL, a shareable deep link. — [shortcuts.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/read_book/shortcuts.pyj)

**Sync rules and conflict prompts**
- **KOReader `kosync` [code]**:
  - Defaults: `sync_forward = PROMPT` and **`sync_backward = DISABLE`**, each offered as Silently, Prompt or Never.
  - "Automatically keep documents in sync", and "Periodically sync every # pages".
  - **Automatic push and pull are debounced to once per 25 s** (`API_CALL_DEBOUNCE_DELAY`).
  - A remote record from the same device is ignored ("Latest progress is coming from this device.").
  - "Ahead" is decided by `body.timestamp > last_page_turn_timestamp`, falling back to comparing percentages.
  - **The prompt reads "Sync to latest location %1% from device '%2'?"**
  - Documents match by "Binary. Only identical files" or by "Filename". — [kosync.koplugin/main.lua](https://github.com/koreader/koreader/blob/master/plugins/kosync.koplugin/main.lua)
- **Readest cloud progress sync [code]**:
  - Progress is pushed with a **3 s debounce** (`SYNC_PROGRESS_INTERVAL_SEC = 3`).
  - On open it pulls, retrying after **1.5, 4 and 10 s** (about 15.5 s in total) before releasing the gate.
  - The server applies last-writer-wins on `updated_at`.
  - A pending push is flushed on close and before every pull.
  - On Android it pulls again on resume, "before a suspended auto-push can send the old local position".
  - **A deep-link preview, such as a search hit or a shared annotation, never pushes and never moves the view to the remote position.**
  - After applying a remote position it shows a hint toast, **"Reading Progress Synced"**.
  - **Copies of the same book** (same metadata hash, different file hash) contribute only a *fraction*, forward-only, and only when ahead by **at least 0.002**. A copy's CFI "can silently mis-resolve to a section start" (issue #5859).
  - **Jump-back bug #7041.** Auto-save stamped `updatedAt` about 1.5 s after the last turn, and the server keeps its own row on a tie, so the push was dropped. The next open jumped back to the older, further position. The fix saves before pushing. — [useProgressSync.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/hooks/useProgressSync.ts)
- **Readest KOSync conflict dialog [code/eng-note]**:
  - Title "Sync Conflict", body "Reading progress on this device differs from "{device}"", with side-by-side previews for "This device" and the remote device. Dismissing it counts as "keep local".
  - **Failure #5527.** The dialog came back on every window reactivation, for example after closing an Android dictionary popup.
  - The fix remembers the resolved report (progress, timestamp and device ID). A pull that returns the identical report counts as already synced. Reports from the same device compare by percentage only. — [KOSyncResolver.tsx](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/components/KOSyncResolver.tsx); [kosync-conflict-reprompt-5527](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/kosync-conflict-reprompt-5527.md)
- **Readest position failure modes [eng-note]**:
  - **A malformed CFI went to the wrong end of the chapter.** A range CFI with an empty start, such as `epubcfi(/6/24!/4,,/20/1:58)`, came from an inert skip-link node. It sent other devices to the wrong end of the section, so such CFIs are now discarded. — [empty-start-cfi-sync](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/empty-start-cfi-sync.md)
  - **A cover page stalled progress.** In scrolled mode, an SVG-only cover produced no `relocate` event, so a newly opened book "cannot sync progress". — [scrolled-cover-no-relocate-progress-sync](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/scrolled-cover-no-relocate-progress-sync.md)
  - **Progress was lost on quit.** The library card was saved through a **30 s throttle** and never flushed on window close or quit, so relaunching showed the old percentage. — [library-progress-lost-on-quit-6623](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/library-progress-lost-on-quit-6623.md)
- **ReadEra [local report]**:
  - On open, if a position from another device is pending, a bottom sheet shows "Source: <device> - <time> (synchronization)" and "page N", with two buttons: jump, or just clear it.
  - The user decides, not a timestamp. — [ReadEra reverse engineering report](../../reports/ReadEra%20reverse%20engineering,%20sync%20and%20features.md)
- **Kindle Whispersync [forum/third-party]**:
  - The book menu has a "Sync to Furthest Page Read" command. — [Guiding Tech](https://www.guidingtech.com/fix-kindle-books-not-syncing-between-devices/)
  - Users report that the "jump to furthest page" popup "jumps forward a bit, but very rarely to the furthest page read" (a MobileRead thread surfaced by search, post not opened; *weak*). — [MobileRead](https://www.mobileread.com/forums/showthread.php?p=3554994)
  - In 2011 the only way to reset the furthest page was to turn Whispersync off. — [40tech, 2011](https://www.40tech.com/2011/01/04/how-to-reset-the-furthest-read-location-on-your-kindle/)
  - Newer prompts ask about the "most recent page read". The source is undated and no official Amazon text was found. — [Wonder of Tech](https://wonderoftech.com/?p=18240)

**Scrubbers**
- **KOReader** skim widget: see Q2.
- **Apple Books for Mac**: a thumbnails view on **Shift+Cmd+T** [docs].
- **Readest scrubber jitter [eng-note]**:
  - **Symptom.** Dragging the desktop footer slider past its left end and holding it over the page label made the slider jitter.
  - **Cause.** At fraction 0 the label unmounted, so the slider widened under the cursor. It navigated, the label came back, and the loop repeated.
  - **Fix.** Keep showing the last committed valid page.
  - **Still open.** Width changes at digit boundaries (99 → 100) can still toggle. — [progress-slider-jitter-6646](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/progress-slider-jitter-6646.md)

**"Where was I" after a long absence**
- **Kindle Recaps** (April 2025, US): series-level refreshers reached through "View Recaps" on a series group. — [About Amazon](https://www.aboutamazon.com/news/books-and-authors/kindle-recaps-feature-ebook-series-refreshers)
- **Kindle "Story So Far"**:
  - Announced in September 2025 and rolling out from June 2026 on Kindles and the iPhone app.
  - It gives **spoiler-free recaps up to the reader's current position** in the current book.
  - It is reached from "Read Recap" in the library or from the ⋮ menu while reading.
  - Coverage is thousands of English-language bestsellers in the US, and a warning appears when a recap may contain spoilers. — [The eBook Reader, 2026-06-09](https://blog.the-ebook-reader.com/2026/06/09/new-story-so-far-feature-rolling-out-to-kindle-ereaders-and-apps/); [9to5Mac, 2026-06-11](https://9to5mac.com/2026/06/11/amazons-story-so-far-feature-rolling-out-to-us-kindles-and-iphone-app/)

### Inferences
- **Position rules for Pager [inference]**, combining KOReader's defaults, Readest's bugs and Pager's single-user, two-device setup (desktop server and phone):
  1. Store a per-device "last" position and a book-level "furthest" position, both as anchors (CFI or Range plus text offset), with a fraction only as a fallback.
  2. On open or resume, if the remote position is newer *and* ahead, show a **non-modal** toast, for example "Continued from iPhone · ch. 7, p. 214 — Stay at p. 180", rather than KOReader's modal dialog. Never move backward automatically.
  3. Ignore remote records that come from this device.
  4. Remember resolved reports so the prompt never repeats.
  5. Ignore position events while previewing a deep link or a search hit.
  6. Save before pushing, and flush on `pagehide` and `visibilitychange` (Pager already flushes on both).
  7. Keep Omnivore's ≥98% re-read rule, from the earlier report, as an exception to "furthest".
- **Back pill [inference].** foliate-js's push-on-jump, replace-on-read history gives the pill the right semantics. "Back" returns to the pre-jump place. Pressing it again ("Return") goes to where you had read to after the jump, not just the jump target. Pair the pill with Alt+←/→ on desktop.
- **"Where was I" without AI [inference].** A non-AI version for Pager: after more than N days away, open with a dismissible card showing the last highlight or note made, the current chapter title and the first lines of the previous page. Story So Far is AI-generated and catalogue-limited, so it is not reproducible in Pager without an LLM.

### Gaps
- No official Amazon text was found for the current Whispersync prompt, or for whether "furthest" was replaced by "most recent".
- Apple Books' iOS behaviour on sync conflicts is undocumented.
- Google Play Books' scrubber and its thumbnails were not verified.

---

## Q4. Session lifecycle: opening, cover and title page, chapter openings and ends, end of book, closing, returning

### Takeaway
Open-source readers treat the lifecycle mostly as *continuity*, never interrupting. They resume exactly where you were, or skip the front matter to the first text page on a first open (foliate-js `showTextStart`). They show controls help only on the first two opens (calibre) and resume an auto-scroll that was never stopped (Readest). At a chapter boundary they pause briefly rather than showing an interstitial (calibre: 0.5 s for the mouse, 5 s for auto-scroll). At the end they ask one configurable question: KOReader's popup "You've reached the end of the document. What would you like to do?" offers Mark as finished, Book status, Go to beginning, Open next file, Delete and File browser. Commercial apps attach a rating, which users dislike when it misfires. Closing must flush the position; Readest lost progress on quit because of a 30 s throttle.

### Cited Findings
- **First open [code]**: with no saved location, foliate-js can `goToTextStart()`, skipping the cover and front matter, or show the first page. — [view.js](https://github.com/johnfactotum/foliate-js/blob/main/view.js)
- **Onboarding [code]**: calibre shows its controls-help overlay the first time a book opens in a session, **only while the stored count is below 2**, with a separate count for books that turn right to left. — [view.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/read_book/view.pyj)
- **Full-screen covers [eng-note]**: Readest supports Duokan's `duokan-page-fullscreen` covers. In August 2026 it stopped stretching them and pins the image with `object-fit: contain` (letterbox). — [duokan-fullscreen-cover-letterbox-5263](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/duokan-fullscreen-cover-letterbox-5263.md)
- **Resuming a mode [eng-note]**:
  - Readest resumes auto-scroll on reopen if the session was not explicitly stopped. The maintainer chose this over adding a setting.
  - It skips the resume when the book was opened through a deep link (preview mode), which would otherwise "scroll unprompted and promote the preview into the user's real reading position". — [autoscroll-resume-on-reopen-5631](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/autoscroll-resume-on-reopen-5631.md)
- **Chapter boundaries in scroll mode [code]**:
  - calibre pauses **0.5 s** when mouse-scrolling across an internal file boundary.
  - **Auto-scroll pauses 5 s** before continuing past a boundary; a negative value means stop there.
  - Readest auto-scroll moves to the next section after **800 ms** without movement. At the end it stops with an **"End of book"** toast. — [session.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/session.pyj); [auto-scroll-teleprompter-4998](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/auto-scroll-teleprompter-4998.md)
- **End of document in KOReader [code]**:
  - The `end_document_action` setting offers:
    - "Ask with popup dialog" (the default, "pop-up");
    - "Do nothing";
    - "Book status";
    - "Delete file";
    - "Open next file";
    - "Go to beginning";
    - "Return to file browser";
    - "Mark book as finished";
    - "Book status and return to file browser".
  - The popup's title is **"You've reached the end of the document.\nWhat would you like to do?"** Its toggle reads "Mark as finished" or "Mark as reading".
  - "Open next file" is disabled when the folder is sorted by date or access ("Sort by date does not support this feature").
  - The silent variant says "The current book has been marked as finished." — [readerstatus.lua](https://github.com/koreader/koreader/blob/master/frontend/apps/reader/modules/readerstatus.lua)
- **KOReader book status page [code]**: status options Reading, **On hold** and Finished; "% Completed", read pages, time and days; a review field, "A few words about the book", and "Save review". — [bookstatuswidget.lua](https://github.com/koreader/koreader/blob/master/frontend/ui/widget/bookstatuswidget.lua)
- **Apple Books at the end [docs/forum]**:
  - On the Mac, reaching the end of a book adds it to the **Finished** collection.
  - On iOS 17 the end-of-book rate-and-review prompt was replaced by "Mark as Finished". Rating moved to the ••• menu (Apple Community, 2024).
  - Year in Review needs at least 3 finished titles and iOS 17.1. — [Apple Community 255651361](https://discussions.apple.com/thread/255651361); [MacRumors](https://www.macrumors.com/2023/11/28/apple-books-year-in-review-feature/)
- **Ratings at the end [forum, 2019]**: Kindle e-readers pop up a star rating at the end of a book that syncs to Goodreads. Kobo's ratings work only for books bought from Kobo, not sideloaded ones (taken from a search summary; the exact post in threads p=3917102 and p=3917340 was not opened). — [MobileRead](https://www.mobileread.com/forums/showthread.php?p=3917102)
- **Closing [code/eng-note]**:
  - Readest flushes the pending push and then pulls when a book closes (#4532).
  - The quit bug (#6623) was fixed by awaiting `flushPendingLibrarySave()` in the close path. — [useProgressSync.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/hooks/useProgressSync.ts); [library-progress-lost-on-quit-6623](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/library-progress-lost-on-quit-6623.md)
- **Returning**: Kindle Story So Far, and Readest's "Reading Progress Synced" toast (see Q3).

### Inferences
- **End card [inference].** KOReader's list is a good template for Pager's end card: a "Finished?" toggle, Go to beginning, Next in folder or series (Pager has a library, not a folder), Book notes (annotation count), and Back to library. Make "Ask" the default and let the user pick a silent default. Never ask for a rating; the forum complaints come from ratings attached to end markers.
- **Front matter [inference].** On a first open, skip the cover and copyright pages to the first body-matter page, using EPUB landmarks, as foliate-js `showTextStart` does. Keep Pager's TitlePage reachable by going backward.
- **"On hold" [inference].** KOReader's "On hold" status is a useful third state alongside Reading and Finished for a personal library.

### Gaps
- No primary documentation was found for Apple Books' current iOS end-of-book screen, or for "next in series" behaviour in Kobo, Kindle or Apple Books.
- **Time to first page**: no app publishes a figure, and none was measured here.
- No source documented an interstitial at chapter openings (drop caps, chapter headers) as an interaction pattern.

---

## Q5. Auto-scroll, volume-button paging, page-turn sound and haptics, reduced motion, left-handed and one-handed use

### Takeaway
Readest's July 2026 Auto Scroll is the best-specified web implementation:
- It is a constant-velocity scroller from **5 to 100 px/s** in 5 px/s steps, defaulting to **20 px/s**.
- **A tap pauses and resumes it** instead of turning the page.
- A **right-edge 10% vertical swipe** changes the speed while it runs.
- It hops chapters on a stall of 800 ms or more, and it resumes on reopen if it was never stopped.

calibre defaults its auto-scroll to 1 line/s, controlled with Ctrl+Space and Alt+↑/↓. Volume-key paging is standard on Android (Moon+, Kindle, KOReader, and Readest on e-ink) but off-limits on iOS under App Review 2.5.9. Left-handed support is "invert the zones" (KOReader, calibre). One-handed reach is mostly a matter of zone geometry: KOReader's forward zone covers 75% of the width.

### Cited Findings
- **Readest Auto Scroll [code/eng-note]**:
  - **Scope.** Scrolled mode only, toggled with Shift+A or from the View menu.
  - **Engine.** `PacedScroller` emits whole-pixel steps and carries the fraction. It clamps frame gaps to **100 ms**, so resuming a background tab does not jump.
  - **Speed.** px/s = `AUTO_SCROLL_BASE_PX_PER_SEC (20) × speed / 100`. Speed runs from **25 to 500 in steps of 25**, default 100, which gives **5–100 px/s, default 20 px/s**.
  - **Taps and manual scrolling.** A tap pauses or resumes, and the click is consumed. Manual wheel or drag scrolling "composes with" it, with no pause on wheel.
  - **Chapters and the end.** It moves to the next section after **800 ms or more** without movement. At the end it stops and shows an "End of book" toast.
  - **Speed gesture.** A **right-edge strip of 10%** arms only while auto-scroll runs. It activates after **18 px of vertical-dominant travel**. A full view-height drag spans the whole speed range, snapped to the 25-step. A capsule readout **fades about 600 ms after release**. This mirrors the left-edge brightness gesture.
  - **Persistence.** It resumes on reopen unless it was explicitly stopped. — [constants.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/services/constants.ts); [useAutoScroll.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/hooks/useAutoScroll.ts); [autoScrollSpeedGesture.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/utils/autoScrollSpeedGesture.ts); [auto-scroll-speed-swipe-5206](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/auto-scroll-speed-swipe-5206.md)
- **calibre auto-scroll [code]**: `lines_per_sec_auto` defaults to **1 line/s**, compared with 20 lines/s for held-key smooth scrolling. Ctrl+Space toggles it and Alt+↑/↓ makes it faster or slower. It pauses 5 s at file boundaries. — [session.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/session.pyj); [shortcuts.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/read_book/shortcuts.pyj)
- **KOReader AutoTurn [code]**: turns a page every N seconds, or scrolls a fraction of a page, and the timer restarts on any user action (see Q2).
- **Moon+ auto-scroll [docs]**: five modes (rolling blind, by pixel, by line, by page) with real-time speed control (see Q2).
- **WCAG 2.2.2 Pause, Stop, Hide (Level A) [docs]**: moving or scrolling content that starts automatically, lasts more than 5 s and runs alongside other content needs a way to pause, stop or hide it. — [W3C Understanding 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
- **WCAG 2.3.3 Animation from Interactions (AAA) [docs]**: motion animation triggered by interaction can be turned off unless it is essential. — [W3C Understanding 2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
- **Motion defaults [code]**: Readest's mobile defaults set `animated: true`, and its e-ink defaults set `animated: false`. KOReader's "Page turn animations" is a separate toggle. — [constants.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/services/constants.ts); [page_turns.lua](https://github.com/koreader/koreader/blob/master/frontend/ui/elements/page_turns.lua)
- **Volume keys**: on Android (Moon+, Kindle per users, Readest's e-ink default `volumeKeysToFlip: true`); App Review guideline 2.5.9 on iOS (see Q2).
- **Left-handed modes [code]**:
  - KOReader: "Invert page turn taps and swipes" with a per-book ★ default, plus tap-zone layouts and sizes.
  - calibre: "Invert the page turn tap areas: Have tapping on the left side turn the page forward and the right side backwards". — [page_turns.lua](https://github.com/koreader/koreader/blob/master/frontend/ui/elements/page_turns.lua); [prefs/scrolling.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/read_book/prefs/scrolling.pyj)
- **Target size, WCAG 2.5.8 (AA, WCAG 2.2) [docs]**: targets at least **24 × 24 CSS px**, or enough spacing around them. — [W3C Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

### Inferences
- **Auto-scroll for Pager's Scroll layout [inference]**:
  - Copy Readest's numbers: 20 px/s default, 5–100 px/s range, 5 px/s steps, and tap to pause.
  - Keep the chrome or a small pill visible with −/+ and pause, as Dwell does in the earlier report.
  - On desktop, bind it to Shift+A or Ctrl+Space with Alt+↑/↓ for speed.
  - Respect WCAG 2.2.2: resuming on reopen counts as "starts automatically", so show the pause control immediately.
  - Pause automatically on text selection, on opening a popover, and when the page is hidden (`visibilitychange`).
- **Volume keys [inference].** They are not available in Pager's iOS shell. Do not attempt AVAudioSession volume observation, given guideline 2.5.9. Desktop and Android browsers do not expose volume keys to web pages either; Readest gets them only through its native Tauri shell.
- **Left-handed and one-handed use [inference].** Ship "Invert tap zones" and a "Both margins go forward" option; the latter was covered in the earlier report as Apple's "Both Margins Advance". The KOReader default (forward = right 75%) is the right-thumb-friendly baseline.

### Gaps
- No primary source gave a **page-turn sound** option for any studied app.
- No source documented the speed model of Moon+'s "rolling blind" mode.

---

## Q6. Text selection micro-details in web readers

### Takeaway
The failures that users and maintainers report are about arbitration, not visuals:
- A long press that drifts 1 px counts as a "drag" and turns the page at the edge.
- `preventDefault` on pointerdown silently breaks tap-to-turn.
- The selection toolbar flashes during handle drags on iOS.
- The cursor auto-hides in the middle of a selection.
- Keyboard selection keys turn pages.

Cross-page selection is solved in two ways. Readest uses a dwell at the edge or corner while dragging. KOReader uses an explicit **Select → turn pages → Extend**. Readwise offers paragraph-level keyboard highlighting through a focus indicator.

### Cited Findings
- **Readest cross-page selection by edge dwell [eng-note]**:
  - The corner-dwell page turn (issue #1354) was decoupled from the DOM selection (#4741).
  - Review of PR #5888 found four defects:
    1. **The long-press guard didn't hold.** On touch, any arriving `pointermove` set "dragged", so "a long press that drifts 1px … a finger resting at the page edge flipped the page". The fix arms the edge turn only on a real drag.
    2. **`pointercancel` left the hint bar painted.**
    3. **Stale latches** carried over between gestures. The fix adds `beginSelectionDrag`/`endSelectionDrag` at every gesture boundary.
    4. **RTL turned backwards.**
  - Still open: page margins count as the turn zone, so "a finger parked in the margin for 500ms turns". — [cross-page-selection-edge-turn-5888](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/cross-page-selection-edge-turn-5888.md); [cross-page-selection-autoturn-4741](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/cross-page-selection-autoturn-4741.md)
- **KOReader [code]**:
  - "Long-press on text" can be set to Ask with popup dialog, Highlight, **Select and highlight**, Translate, Wikipedia, Dictionary or Fulltext search.
  - The selection popup has a **Select / Extend** button, so a selection can start on one page and be extended on another.
  - "Highlight very-long-press interval" defaults to **3 s**. Beyond it, "single word selection will not be triggered".
  - "Use highlight color for selection" is an option. — [readerhighlight.lua](https://github.com/koreader/koreader/blob/master/frontend/apps/reader/modules/readerhighlight.lua)
- **Readest double-tap selects a word [eng-note]**: a double-click or double-tap now selects the word, then runs the configured instant action or shows the toolbar. Android has no native double-tap word selection. Readest's mobile defaults ship `disableDoubleClick: true`. — [iframe-double-click-word-select](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/iframe-double-click-word-select.md); [constants.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/services/constants.ts)
- **Readest instant highlight broke paging [eng-note]**: with Instant Highlight on, `handlePointerDown` called `preventDefault()`. Tapping *text* then stopped turning pages, and only taps on the margins worked. — [instant-highlight-tap-paginate](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/instant-highlight-tap-paginate.md)
- **Readest selection toolbar flash on iOS [eng-note]**: a `touchmove` handler hid the popup "so it doesn't follow the selection while dragging". Meanwhile, every `selectionchange` during the drag showed it again. Interleaved at event frequency, the toolbar flashed. The fix defers showing until the drag ends. — [ios-selection-toolbar-flash-defer](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/ios-selection-toolbar-flash-defer.md)
- **Keyboard selection [code]**:
  - calibre uses Shift+arrows and Ctrl+Shift+arrows by character, word, line and paragraph, plus Shift+Home/End.
  - Readest uses Shift+←/→ and Ctrl/Alt+Shift+←/→, and leaves Cmd+Shift to the OS. Extending a selection past a page edge in paginated mode does *not* follow it onto the next page. — [shortcuts.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/read_book/shortcuts.pyj); [keyboard-selection-adjust-4728](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/keyboard-selection-adjust-4728.md)
- **Readwise paragraph highlighting [docs]**: arrows move a focus indicator, `h` highlights the focused paragraph, `n` adds a note, and on mobile a double-tap highlights a paragraph. Keyboard highlighting works at paragraph level only. — [Readwise Highlights FAQ](https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes)
- **Link taps [code]**: calibre's ±5 px probe ensures a tap near a link follows it rather than turning the page. — [touch.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/read_book/touch.pyj)
- **Readest pull-to-bookmark [eng-note]**: a selection in progress suppresses the pull, and the pull never engages on a page that can pan vertically, such as a zoomed fixed-layout page. — [bookmark-pull-fixed-layout-5142](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/bookmark-pull-fixed-layout-5142.md)

### Inferences
- **Checklist for Pager's touch arbiter and selection code [inference]**:
  1. Arm an edge or corner auto-turn only after real movement beyond the slop, never on a resting finger.
  2. Clear all pending turn or hint state on `pointercancel` *and* `touchcancel`.
  3. Never call `preventDefault` on pointerdown over text.
  4. Defer the selection menu until handles stop moving. This matches the earlier report's 150–250 ms stability rule.
  5. On desktop, keep the cursor visible while a selection exists.
  6. Bind Shift+arrows to adjust the selection when one exists, and to navigate otherwise.
  7. Add KOReader-style "Extend" for highlights that span pages in the Pages layout; it is simpler than a dwell.
- **Desktop keyboard highlighting [inference].** Readwise's paragraph-focus model (↑/↓ to focus, `h` to highlight) is a cheap win, because it needs no selection API at all.

### Gaps
- **iOS loupe and handle behaviour inside WKWebView** is system-provided and was not re-examined; the earlier report covers the edit menu.
- **Kindle's or Apple's "swipe to highlight"** gestures were not verified from primary sources.
- Readest's note on lookup-popup range handles (#5815) was not read.

---

## Q7. Loading and perceived performance: pre-paginating neighbours, scroll anchoring, fonts, images

### Takeaway
The visible glitches are layout-shift problems in the scroll container, not slow rendering:
- **Browser scroll anchoring is suppressed at `scrollTop === 0`.** Prepending the previous chapter above the current one therefore jumps the view, so it needs manual compensation.
- Forward preloading should be eager and backward preloading debounced.
- Lazy pages need a lead of about 2 viewports, loading the nearest first with bounded concurrency.
- Per-frame background repaints during swipe turns drop frames at section boundaries.

### Cited Findings
- **Scroll anchoring at the top [eng-note]**:
  - "Browser scroll-anchoring (`overflow-anchor: auto`) … is **suppressed when scrollTop === 0**." The paginator preloads the *previous* section by inserting it above the current one, so the viewport jumped. There were two bugs:
    - a TOC jump one section back landed on section n−1;
    - the reader could not scroll up, and was thrown to the beginning of the previous section.
  - **Fix.** Compensate manually at the single prepend point: `containerPosition += addedSize`. Also preload the previous section on every navigation in scrolled mode.
  - Forward preload is "eager/immediate", while backward preload is debounced at about 250 ms. — [issue-4112-scroll-anchoring](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/issue-4112-scroll-anchoring.md)
- **Lazy-loading lead [eng-note]**:
  - **Measured cost.** On Android, a PDF page took about **415 ms to render uncached and about 65 ms cached**.
  - **Symptom.** With an IntersectionObserver `rootMargin: '50% 0px'`, blank pages showed while scrolling.
  - **Fix.** Use `rootMargin: '200% 0px'`, about two viewports of lead. Load visible and idle pages nearest the current index first, bounded by `maxConcurrent`, and evict the farthest pages beyond `maxLoaded`. — [pdf-scroll-lag-preload-4795](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/pdf-scroll-lag-preload-4795.md)
- **Dropped frames at section boundaries [eng-note]**:
  - Swipe animations dropped frames, worst when crossing section boundaries on first open. `#replaceBackground()` rebuilt its whole paint context **every frame**. — [pageturn-bg-replace-reflow-4785](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/pageturn-bg-replace-reflow-4785.md)
  - A related flash appeared between a transparent page and a CSS-coloured page during a swipe: the slower the swipe, the bigger the flash. — [paginator-swipe-bg-flash](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/paginator-swipe-bg-flash.md)
- **Fonts [eng-note]**:
  - Accessing `doc.fonts.ready` on every section load crashed WebKit's content process deterministically on **iOS 16 (WebKit 7615)**, while an injected `@font-face` was still loading.
  - iOS 17 (WebKit 7616) defers the promise resolution and does not crash. The suggested feature-detect is `AppleWebKit/605` with no `URL.canParse`. — [ios16-fonts-ready-webcontent-crash](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/ios16-fonts-ready-webcontent-crash.md)
- **Font fallback metrics [docs]**: `@font-face` descriptors such as `size-adjust` (and the `ascent-override` family) let a fallback font match the web font's metrics, reducing reflow when the font swaps in. — [MDN size-adjust](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/size-adjust); [MDN FontFaceSet.ready](https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/ready)
- **Two-finger scroll versus pinch [eng-note]**: two-finger scrolling on a touchscreen laptop triggered zoom. The fix adds a pending state, a magnitude discriminator and a dead zone, because a human scroll is never perfectly parallel. — [pinch-vs-twofinger-scroll-4858](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/pinch-vs-twofinger-scroll-4858.md)

### Inferences
- **Neighbouring chapters in Pager's Scroll layout [inference].** When the previous chapter is mounted above the current one, compensate `scrollTop` by the inserted height in the same frame. Do not rely on `overflow-anchor`: Safari lacks it before Safari 27, as the earlier report found, and it is suppressed at the top anyway.
- **Pages layout [inference].** Pre-paginate the next chapter eagerly and the previous one lazily.
- **iOS 16 [inference].** Pager's iOS floor is 17.5, so the `fonts.ready` crash does not apply. It does warn against touching `fonts.ready` in hot paths.
- **Skeletons versus instant render [inference].** No studied open-source reader uses skeleton screens inside the reading view. They render the saved position directly and show nothing during fast loads, as YouVersion's spinner delayed by 150 ms did in the earlier report.

### Gaps
- **No measured time-to-first-page** was found for any app.
- **Image lazy-loading inside CSS columns** (reserving the box with `width`/`height` or `aspect-ratio` before decode) was not found discussed in these sources beyond Readwise's "text stays put", which the earlier report already covered.

---

## Q8. Deferred items: live settings panel and presets/themes, status bar following the chrome, pull-to-bookmark

### Takeaway
Presets come in three forms:
- **Profiles**: calibre switches named profiles with Alt+P, and KOReader has a profiles plugin.
- **Themes**: Moon+ has 10+ themes and a Day & Night switcher.
- **A per-book versus global scope**: KOReader marks the default with ★, and Readest uses "Apply to All Books" / "Apply to This Book".

The scope must be *visible on touch*. Readest's scope labels lived in tooltips that never appear on touch, and users did not know the scope existed. For the status bar, Android documents immersive mode with "transient bars by swipe", and lists books among the intended uses.

### Cited Findings
- **calibre profiles [code]**: "Change settings quickly by creating and switching to 'profiles'" (Alt+P). Some settings are marked `disallowed_in_profile`, such as the controls-help counter. — [shortcuts.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/read_book/shortcuts.pyj); [session.pyj](https://github.com/kovidgoyal/calibre/blob/master/src/pyj/session.pyj)
- **KOReader settings scope [code]**: per-book settings carry a **★** on the global default, with "The default (★) for newly opened books is … Would you like to change it?" A `profiles.koplugin` also exists; its contents were not read. — [page_turns.lua](https://github.com/koreader/koreader/blob/master/frontend/ui/elements/page_turns.lua); [koreader plugins/profiles.koplugin](https://github.com/koreader/koreader/tree/master/plugins/profiles.koplugin)
- **Readest settings scope [eng-note]**:
  - The labels "Apply to All Books" and "Apply to This Book" sat in a `lg:tooltip` and a native `title` attribute. "Native `title` never fires on touch and `lg:` starts at 1024px", so on phones the menu read only "Global Settings ✓".
  - The fix is two mutually exclusive toggled rows. — [settings-scope-menu-5933](https://github.com/readest/readest/blob/main/apps/readest-app/.claude/memory/settings-scope-menu-5933.md)
- **Readest font sizes [code]**: font size runs from **8 to 120 px in 1 px steps** (`MIN_FONT_SIZE`, `MAX_FONT_SIZE`, `FONT_SIZE_STEP`). — [constants.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/services/constants.ts)
- **Moon+ themes [docs]**: "10+ themes embedded" with a "Day & Night mode switcher". — [MobileRead wiki](https://wiki.mobileread.com/wiki/Moon+_Reader)
- **Android immersive mode [docs]**:
  - `WindowInsetsControllerCompat.hide(Type.systemBars())`.
  - `systemBarsBehavior` takes one of three values:
    - `BEHAVIOR_SHOW_BARS_BY_TOUCH`;
    - `BEHAVIOR_SHOW_BARS_BY_SWIPE`;
    - **`BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`**, where the bars "overlay the app's content, may be somewhat transparent, and hide automatically after a short timeout".
  - The guide names **books** as an immersive use case, and warns that users lose easy access to system navigation. — [Android: Hide system bars for immersive mode](https://developer.android.com/develop/ui/views/layout/immersive)
- **iOS status bar [docs]**: a UIKit view controller animates status-bar hide and show with the style from `preferredStatusBarUpdateAnimation` (`.none`, `.fade` or `.slide`) when `setNeedsStatusBarAppearanceUpdate()` is called. — [Apple: preferredStatusBarUpdateAnimation](https://developer.apple.com/documentation/uikit/uiviewcontroller/preferredstatusbarupdateanimation)
- **Corner bookmark [code]**: KOReader's default top-right **corner tap (1/8 × 1/8) toggles a bookmark**. Readest's pull-to-bookmark is suppressed during a selection and on vertically pannable pages (see Q6). — [gestures.koplugin/defaults.lua](https://github.com/koreader/koreader/blob/master/plugins/gestures.koplugin/defaults.lua)

### Inferences
- **Settings panel [inference].**
  - Show the scope as a visible segmented control ("This book / All books"), with ★ marking values that differ from the global default.
  - Offer named profiles, for example "Night in bed" and "Desk".
  - Never put consequences in tooltips.
- **Status bar [inference].**
  - In the iOS shell, pair Pager's chrome toggle with `.fade` status-bar animation so both move together.
  - Do not hide the status bar in the Scroll layout's reading state unless the chrome is hidden too.
  - An Android build should use transient bars by swipe.
- **Pull-to-bookmark [inference].** Keep Readest's values from the earlier report and add two guards: suppress the pull during selection, and when the page can pan. Offer KOReader's corner tap as the non-gesture alternative.

### Gaps
- The contents of KOReader's `profiles.koplugin` and calibre's profile UI were not read.
- No source gave preset *names* or values for the open-source readers comparable to Apple's six themes.
- Apple's own iOS status-bar timing for Books is undocumented.
