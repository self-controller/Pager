# Design: a reading room in black and white

Pager is a personal reading environment: a library that is a folder, and chapters you either
scroll and turn like the pages of a book (the default Scroll layout) or read in pages. The palette is black and white with neutral greys between, plus one ink blue for
everything you can act on; the dark theme is a soft near-black, not pure black. Type is Spectral
for everything that is read or titled, and the system sans for controls. The layout measurements
(a 232px left nav, a 728px reading measure, 72px bars) began as a study of Substack's web reader and were kept; the look, the name and every colour are Pager's own.

Tokens live in `src/styles/tokens.css` (runtime CSS variables, light and dark). Tailwind utilities are
mapped onto them in `src/styles/globals.css`. Reading typography, pages and the title page are in
`src/styles/prose.css`.

## Palette

Black and white, neutral greys (no warm or sepia tints), and one blue. The blue marks only what you can
act on or where you are: buttons, links, the focus ring, progress fills, the reading-progress line,
the selection tint and the open highlight. Everything else is grey.

| Token | Light | Dark (soft) | Used for |
|---|---|---|---|
| `--bg-primary` | `#ffffff` | `#121212` | the page |
| `--bg-primary-hover` | `#f5f5f5` | `#1a1a1a` | rows under the pointer |
| `--bg-secondary` / `--bg-tertiary` / `--bg-quaternary` | `#ebebeb` / `#dbdbdb` / `#bdbdbd` | `#242424` / `#303030` / `#4a4a4a` | buttons, progress tracks, folder cards, dashed borders, the blockquote rule |
| `--bg-elevated` | `#ffffff` (set apart by the `.elevation` ring and shadow) | `#1e1e1e` | dialogs, popovers, context menus |
| `--fg-primary` | `#111111` | `#e5e5e5` | text |
| `--fg-secondary` | `#616161` | `#a3a3a3` | meta, inactive nav |
| `--fg-tertiary` | `#858585` | `#737373` | placeholders, hints, hairline icons |
| `--accent` / `--accent-hover` | `#1d4ed8` / `#1e40af` | `#60a5fa` / `#93c5fd` | primary buttons, links, progress fills, the reading-progress line, the focus ring |
| `--accent-bg` | `rgb(29 78 216 / .16)` | `rgb(96 165 250 / .24)` | text selection, search marks, drop zones |
| `--on-accent` | `#ffffff` | `#121212` (the light blue needs dark text) | text on the accent |
| `--detail` | `rgb(0 0 0 / .12)` | `rgb(255 255 255 / .12)` | hairlines |
| `--modal-scrim` | `rgb(0 0 0 / .4)` | `rgb(0 0 0 / .6)` | behind desktop dialogs |
| `--sheet-scrim` | `rgb(0 0 0 / .15)` | `rgb(0 0 0 / .3)` | behind a content-sized phone sheet: light, so the page it acts on still reads |
| `--sheet-scrim-tall` | `rgb(0 0 0 / .2)` | `rgb(0 0 0 / .35)` | behind a tall phone sheet (Contents, Tools) |
| `--tooltip-bg` / `--tooltip-fg` | `#111111` / `#ffffff` | `#e5e5e5` / `#121212` | toasts, the selection menu (the page inverted) |
| `--tooltip-accent` | `#60a5fa` | `#1d4ed8` | the accent on a tooltip surface (toast actions) |
| `--error` | `#b91c1c` | `#f87171` | errors, danger buttons |
| highlights | yellow, green, blue, pink, purple at 24–40 % | the same, 24–28 % | the CSS Custom Highlight API, `prose.css` |
| `--hl-active` | `rgb(29 78 216 / .26)` | `rgb(96 165 250 / .3)` | the highlight open in the popover |

Contrast (WCAG): on white, text 18.9:1, secondary 6.2:1 (5.2:1 on `--bg-secondary`), tertiary 3.7:1,
accent links 6.7:1, white on the accent 6.7:1, error 6.5:1. On `#121212`: text 14.9:1, secondary
7.4:1 (6.2:1 on `--bg-secondary`), tertiary 4.0:1, accent links 7.4:1, `#121212` on the accent 7.4:1,
error 6.8:1. Text on every highlight is 12:1 or better in light and 8.6:1 or better in dark. There is
no paper grain or texture: the page is flat.

## Type

| Variable | Value | Where |
|---|---|---|
| `--font-spectral` | Spectral (bundled via `@fontsource`), Georgia | reading text, titles, book names, the wordmark |
| `--font-title` | = Spectral | the title page, chapter headings, dialog titles |
| `--font-ui` / `--font-meta` | system sans | controls, breadcrumbs, meta lines, "p. 4 of 17" |
| body size | 19px, 17px under 768px, plus the reader's offset (−3 … +9), never below 16px; Reading settings shows the size the text really has, and "Smaller" stops at the floor | `--font-size-body`, `reader/textSize.ts` |

## Layout

| Element | Measurement | Where |
|---|---|---|
| Left nav | 232px fixed, 80px icon rail between 768 and 1023px, hidden under 768px; wordmark "Pager" at the top (no logo) | `components/shell/SideNav.tsx` |
| Mobile bar | below 768px in a browser, a floating pill of frosted glass with five items and a bubble that slides to the current one; in the iPhone app, the system Liquid Glass tab bar instead. Both hide with the reader's chrome and under an open sheet or tray | `shell/BottomTabBar.tsx`, `.glass-tab-bar`, `ios/Sources/Pager/TabsController.swift` |
| Library column | 1040px (`--size-library`) inside 20px gutters. Under 768px no column gutter: every content edge (header title, toolbar, breadcrumbs, row thumbnails, card covers, search results, section headings) sits 16px from the screen edge | `shell/Page.tsx` `WideColumn` |
| Toolbar | search bar (always), view toggle (compact / detailed), sort | `library/LibraryToolbar.tsx` |
| Compact row | 40px: 20×28 cover, title, author, 96px progress bar + label, date, `⋯` | `library/items.tsx` |
| Detailed card | `minmax(150px, 1fr)` grid: full-width 5:7 cover, title (2 lines), author, progress bar; `⋯` at the card's top right, 8px in | `library/items.tsx` |
| Context menu | 220px min, fixed at the pointer, clamped to the viewport | `ui/ContextMenu.tsx` |
| Sheet | phones only (below 768px, and always in the iPhone app): every menu, panel and dialog (Contents, Reading settings, Tools, the library's menus, every dialog but a full-window view) rises from the bottom edge over the tab bar. Full width, `--radius-lg` top corners, `bg-elevated` on a light scrim (`--sheet-scrim`, `--sheet-scrim-tall` behind a tall one); a 36×5 grip in a 28px band, then a title row with ✕ (none for Tools): 48px, taller when a 13px/18px grey subtitle sits under the title, and with room for one action before ✕. 92dvh tall for Contents and Tools, as tall as its content otherwise (92dvh at most); only its body scrolls. In 300ms on `cubic-bezier(.19,1,.22,1)`; out 150ms on `cubic-bezier(.4,0,1,1)` after a tap, 250ms on the way in's curve after a drag. Closes with a swipe down on the grip or title row (past 30% of its height, or a flick), ✕, Esc or a tap on the scrim | `ui/Sheet.tsx`, `ui/sheetDrag.ts`, `.sheet` |
| Tray | the sheet for settings you watch take effect (Reading settings on phones): not modal, no scrim and no title row (the grip only), at most 46dvh tall, `z-index` 45 (over the bars and popovers, under the toast). The page behind stays live and scrolls; the tab bar still hides. Closes with a tap anywhere outside it (which does nothing else), a tap on its own button, Esc or a swipe down on the grip; scrolling the page does not close it | `ui/Sheet.tsx` `modal={false}`, `ui/Popover.tsx` `tray`, `.sheet[data-tray]` |
| Floating sheet | in the iPhone app only: a content-sized sheet or a tray floats 8px (`--sheet-float-gap`) from the left, right and bottom edges (8px above the keyboard), all four corners `--sheet-float-radius` (44px), with a ring and a soft shadow all round (`--sheet-float-shadow`); its body keeps the home indicator's inset less the 8px, 12px at least. A tall sheet stays attached, with `--sheet-tall-radius` (38px) top corners. Phone browsers keep the attached shape | `:root[data-native-tabs] .sheet` |
| Menu sheet | a menu on a phone is titled with what it acts on (a book's title with its author, a folder's name with what it holds); rows that destroy go last, after one divider, in `--error`, icon included | `ui/ContextMenu.tsx` `sheetMenuOrder` |
| Reader | top bar 72px (56px on phones) with a 2px progress line. The text sits `--reader-gutter` from the sides in both layouts: 24px under 768px, 32px from there. Pages: hidden by a centre tap with its space kept; the page box fills the rest minus a 44px footer; the page is 728px wide at most, 20/32px of vertical breathing room, 64px between pages. Scroll: the bars float over the chapter, which runs under them and under the tab bar; the column is 728px at most, 20/32px below the bar, 84px of room past the footer for the chapter buttons | `reader/PagedView.tsx`, `reader/ScrollView.tsx`, `--size-page-footer`, `--reader-gutter` |
| Toast | one at a time, bottom centre, 12px above the tab bar (24px from the bottom from 768px in a browser), in the tooltip colours, 14/20px, at most 480px wide, with one optional action (Undo). A plain notice stays 3s, one with an action 5s; a new toast replaces the current one at once. In: 150ms fade and an 8px rise, ease-out; out: 200ms fade, then removed (the fades alone under reduced motion). In a polite live region (`role="status"`) | `ui/Toast.tsx`, `.toast` |
| Chapter buttons (Scroll) | 44px circles in the page colour, 1px detail ring and a 2px shadow, 16px chevrons, 24px in from the bottom corners of the reading area (above the footer), the back pill between them; none on a side with no chapter. They hide with the chrome and while a selection, popover, note or footnote is open: down 200px over 300ms ease-in-out, behind the footer (a fade under reduced motion) | `reader/ScrollView.tsx`, `.chapter-button` |
| Page footer | 44px: ‹ and › at the sides (Pages only; Scroll has the chapter buttons, and its footer is opaque and rides down with the tab bar); between them one full-height button (13px meta, chapter title first on md+) that cycles on tap, instantly: "p. 4 of 17" ("Chapter 3 of 12" in Scroll) → "6 min left in chapter" → "3 h 12 min left in book" (books only) → "42%" → hidden; the choice is the `footerFormat` setting. Times use a reading speed learned from page dwell (median of the last 30 pages read at 4 s–3 min and 60–1000 wpm); until 5 samples, an average 238 wpm marked "~" ("~6 min left in chapter"; "< 1 min left" takes no mark) | `reader/PageFooter.tsx`, `reader/readingSpeed.ts` |
| Title page | title at `clamp(30px, 4.5vw, 44px)`, subtitle italic, author 19px, meta 13px, a Contents button for books | `reader/TitlePage.tsx`, `.title-page` |
| Body | Spectral, line-height 1.6em, paragraph margin 20px; headings 2/1.625/1.375em; figures, code, tables and footnotes never split across pages; headings keep their next line | `prose.css` |
| Back pill | appears only after a jump (a link, a note's "Go to note", the contents): bottom-left on the page's lower edge, in line with the text; 44px hit area, 32px pill, 13px semibold accent on an opaque accent tint. "Back to p. 42" (page within its chapter, "· Chapter 3" when elsewhere), then "Return to p. 87" once used, and back again; in Scroll, with no page numbers, "Back" or "Back to Chapter 3". Gone after 3 page turns (screenfuls, in Scroll) away from both places or on leaving the document. Stays when the chrome hides. 150ms fade-and-rise | `reader/BackPill.tsx`, `reader/useJumpHistory.ts` |
| Footnote popover | a note reference opens its note beside it instead of jumping: `min(100vw − 2.5rem, 460px)` wide, at most 60vh tall (scrolls inside), 14/21px in the reading face, elevated surface; "Note 1" and ✕ at the top, "Go to note" at the bottom. Closes on a tap outside, ✕, Esc or a page turn. Arrives as every card over the text does (Motion, "Popovers"): 250ms scale 0.975→1 and fade, `cubic-bezier(.19,1,.22,1)` | `reader/FootnotePopover.tsx`, `reader/footnotes.ts` |
| Context card map | The Assistant page's Map, and every full-screen map from 768px (Phase 6): each node a card (`bg-elevated`, 1px detail ring, rounded) with what it is to the author over its name ("Concept:" 12px secondary, the name 14.5px semibold, two lines at most) and a 44px round picture on the right, the book's cover as a small portrait; the book's and the author's cards ringed darker. Laid on ovals filling the stage, overlaps pushed apart, lines routed round other cards. A tap rings the card in accent, lights its lines and relations and fades the unrelated cards' contents (the cards stay opaque); its details float over the map (360px, the footnote popover's entrance, own scroll) on the side away from it, closing with ✕, Esc or a tap on the map, so the page never moves. No key: the role says what each node is | `tools/context/CardMap.tsx`, `cardLayout`/`routeEdge` in `model.ts` |
| Context card | "Context for this" on a selection (web only): the footnote popover's box and entrance, beside the selection, at most as tall as the roomier side so it never covers the words; "Context" and ✕ at the top, "Open in Context →" at the bottom. Shows a focused briefing already made, else what the book's briefing says about the name (with "Go deeper"), else an offer with its cost. Closes on a tap outside, ✕, Esc, a page turn, a scroll or a resize. The selection menu stays 8px inside the viewport | `tools/context/ContextCard.tsx`, `reader/SelectionMenu.tsx` |
| Landing flash | the block a jump lands on: 20% accent wash with an 8px halo, held 2s then faded over 1s (`3s ease-out forwards`); a still wash for 3s under reduced motion. A class only, so text offsets hold | `.is-landing`, `flashLanding` |
| Tool panel | 360px, side by side at 1280px and up, a right drawer from 768px, a bottom sheet on phones | `ReaderPage.tsx` |

## Pages

The section's HTML flows into CSS multi-columns inside `.reader-columns`: `column-width` equals the
box's width, `column-fill: auto`. Its scroller, `.reader-scroller`, scrolls sideways with no scrollbar
and `scroll-snap-type: x mandatory`; one zero-content marker per page (outside the text, `aria-hidden`)
gives a snap point at N × (width + gap), with `scroll-snap-stop: always` so a fling moves one page.
The number of pages is `round((scrollWidth + gap) / (width + gap))`, taken from the columns (not the
scroller, whose markers trail a relayout) and measured again whenever the box resizes, the content or
type changes, fonts arrive or an image loads. The DOM is never split, so `textContent` offsets
(selections, highlights) are untouched; the reading place is the first block whose box touches the
visible page, plus the character under the page's top-left corner.

**Turning.** A swipe is the platform's own scroll: it follows the finger, carries momentum and snaps
to the next page, which becomes the page shown when the scroll settles (`scrollend`, or 120 ms without
a scroll event). A swipe past the last page opens the next section; past the first, the previous
section's last page. Taps, keys, the footer and a vertical wheel turn with the **Page turn** setting:
Slide (default: a smooth scroll to the next snap point), Fade (a cut, then the new page fades in over
150 ms ease-out) or None (a cut). Under `prefers-reduced-motion` every turn is a cut. Jumps (links,
contents, the back pill), relayouts and restoring a saved place are always cuts. While text is
selected the scroller stops scrolling (`overflow-x: hidden`), so a selection dragged to the edge never
turns the page; a selection can't run across a page boundary.

**One tap, one thing.** Every press on the page goes through one arbiter (`reader/gestures.ts`):
- A tap is a release within 15 px and under 500 ms. A long touch press never turns or toggles; a tap
  released while the pages moved, or within 150 ms of a scroll ending, does nothing.
- Links, buttons and highlights win over zones. A press that began with text selected only clears the
  selection; one that began with an overlay open (`[data-reader-overlay]`: popovers, menus, the
  footnote, the contents) only closes it. Neither also turns or toggles.
- Touch and pen: the left 37.5% turns back, the right 37.5% forward, the band between toggles the
  chrome. While the chrome shows, a tap outside the band only hides it. Mouse: the outer 18% on each
  side turns; the middle does nothing, and a mouse never hides the chrome.
- There is no double-tap action, so a tap never waits. Touches over the text are never
  `preventDefault`ed, so selection and its handles work as usual.

**Chrome.** The reader's top bar and, on phones, the tab bar. On a touch screen a book opens with them
hidden (a centre tap shows them); with a mouse they show. A centre tap or a swipe hides them over
250 ms `cubic-bezier(.19,1,.22,1)` (instant under reduced motion): they slide and fade out of their
own space, which stays, so the page never changes size or reflows. Hidden, they are `inert`; any mouse
movement or the Tab key brings them back. The page footer always stays.

**Sheets.** On phones a sheet rises in 300 ms on `cubic-bezier(.19,1,.22,1)`, the chrome's curve, and
leaves twice as fast: closed by a tap (✕, the scrim, Esc, a menu pick, its owner) it falls away in
150 ms on `cubic-bezier(.4,0,1,1)`; the scrim fades with it. A drag on the grip or title row moves it
with the finger (never up); let go past 30% of its height, or flicked down at 0.5 px/ms over 40 px, it
slides the rest of the way out from there in 250 ms on the way in's curve, otherwise back in 250 ms.
A floating sheet travels its 8px gap as well, so it starts and ends off screen. While a sheet is open
the tab bar hides as with the chrome and the page behind holds still; under a tray the bar hides but
the page stays live. Under reduced motion nothing slides: the sheet and its scrim fade in over 200 ms
and out over 200 ms (a drag still follows the finger, and the sheet fades where it was let go).

**Switching tabs** crossfades the whole screen in 100 ms, in a browser and in the iPhone app
(`--tab-fade-duration`), a cut where the web view has no View Transitions API. A change of content
is quick; a change of place takes longer:

**Opening a book, and going back.** A book opened from a list (the library's rows and cards, its
menu's Open, Recent, search results, a new file, an added book's Open, a row of Highlights) slides in
from the right over the list, `translateX(100%)` to 0, while the list moves from 0 to
`translateX(-15%)`, undimmed: 260 ms, `ease`. The reader's Back button is the reverse, the book on
top: it slides out to `translateX(100%)` as the list comes back from `-15%`, 250 ms on
`cubic-bezier(.33,1,.68,1)`. Both are the same view transition of the root as a tab switch;
`data-vt="push"` or `"pop"` on `<html>` (`src/lib/pageTransition.ts`) names it while it runs. Back
slides when the way in had a transition, and cuts otherwise; so does everything where the web view
has no View Transitions API. The tab bar's Book tab is a tab switch and crossfades. From 768px in a
browser the side nav is on screen, so there both cut, as before. The browser's own Back is
not marked and gets the tabs' crossfade. Under reduced motion nothing slides or fades. As a book opens, its text
is held back until it is at the saved place and then fades in over 100 ms (at once under reduced
motion, on an error, or after 500 ms); a chapter turn or a jump never fades.

**Popovers.** Every card that floats over the text (the selection menu, the highlight popover, the
new-note panel, a footnote, the Context card, the card map's details) arrives the same way: 250 ms on
`cubic-bezier(.19,1,.22,1)`, opacity 0 to 1 and scale 0.975 to 1, growing from the side nearest its
anchor (`.pop-in`; the `scale` property, so the translate that places a card is left alone). Once,
when it appears: not when the selection changes and the menu moves. Under reduced motion a 150 ms
fade with no scale. There is no way out: they close on a scroll or a press outside, and a fixed card
would drift from its words while it faded.

## Scroll

The default layout (Reading settings → Layout: Scroll | Pages). Each chapter is one page that
scrolls top to bottom, and a chapter changes with a sideways page turn. The model is YouVersion's
Bible reader (research_notes/iOS reading app UI patterns/youversion.md): its own open-source iOS
reader has floating ‹ › circles, chrome that follows the scroll, no auto-advance, and chapters that
open at the top; Pager adds a drag that follows the finger, as UIPageViewController's scroll style
does, and opens the previous chapter at its end.

**Track.** `.chapter-stage` (`overflow: clip`, `touch-action: pan-y`) holds a track of up to three
panes: the previous chapter, the open one, the next. Only the middle pane scrolls
(`overflow-y: auto`, `overscroll-behavior: contain`); the next waits 24 px off the right edge at its
top, the previous off the left pinned to its end (`display: flex; justify-content: flex-end`, so no
script keeps it there). Panes are keyed by section, so when a turn lands the pane that slid in simply
becomes the open one: nothing is re-parsed or laid out again, and the swap can't flash. The
neighbours are fetched with the open chapter, and theirs are prefetched; highlights are painted in
all three. The bars float over the text: panes pad by the top bar, footer, tab bar and safe area, and
the same insets are their `scroll-padding`, which is how the reading box (and the browser's own
`scrollIntoView`) knows where text shows.

**Turning.** Touch and pen only: a press that has moved 10 px, at least twice as far sideways as up
or down, becomes a drag (`touch-action: pan-y` hands any vertical pan to the browser, which cancels
the pointer). Not when text is selected or an overlay is open, after a 500 ms hold (that is a
selection starting), on a pinch-zoomed page, or within 24 px of the left edge (the back swipe). The
track follows the finger one to one, at 0.35× toward a side with no chapter. Released past 30% of the
width, or flicked at 0.4 px/ms over 40 px, it slides the rest of the way in 220–320 ms (scaled to the
distance left), `cubic-bezier(.2,.8,.2,1)`; otherwise back in 250 ms, as does a quick flick back. The
‹ › circles, ← and →, and a sideways trackpad swipe (80 px, once per swipe) run the same slide in
280 ms. A turn fires one selection haptic. The next chapter opens at its top, the previous at its end.
Under reduced motion nothing slides: the chapter opens and fades in over 150 ms. There is no
auto-advance past a chapter's end.

**Keys.** ← → turn chapters; ↑ ↓ scroll 40 px; Space, Page Down and Page Up a screen less two lines
(Shift+Space up); Home and End go to the top and the end. The vertical wheel scrolls.

**Taps and chrome.** Taps go through the same arbiter as in Pages, but every touch tap is the centre
band's: it toggles the chrome, and nothing but a drag or a button changes chapter. A mouse click on
the page does nothing. Scrolling down 10 px hides the chrome and scrolling up 10 px shows it; at the
top of a chapter (rubber-banding included) it always shows. A turn shows it and holds it for 500 ms.
Hidden, the bars reveal text beneath them without the text moving; the footer drops to the bottom
with the tab bar.

**The reading place.** A "page" for the back pill, the reading-speed sampler and the footer's time
left is a screenful. The place saved is the block and character on the reading line, 24 px below the
top bar (nothing in the first 40 px of a chapter: there the place is its start), and jumps put their
words 20 px below the bar. `offset` is `scrollTop / (scrollHeight − clientHeight)`. Switching
layouts keeps the same words in view.
