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
| `--modal-scrim` | `rgb(0 0 0 / .4)` | `rgb(0 0 0 / .6)` | behind dialogs |
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
| body size | 19px, 17px under 768px, plus the reader's offset (−3 … +9) | `--font-size-body` |

## Layout

| Element | Measurement | Where |
|---|---|---|
| Left nav | 232px fixed, 80px icon rail between 768 and 1023px, hidden under 768px; wordmark "Pager" at the top (no logo) | `components/shell/SideNav.tsx` |
| Mobile bar | 56px bottom bar, four items | `BottomTabBar.tsx` |
| Library column | 1040px (`--size-library`) inside 20px gutters | `shell/Page.tsx` `WideColumn` |
| Toolbar | search bar (always), view toggle (compact / detailed), sort | `library/LibraryToolbar.tsx` |
| Compact row | 40px: 20×28 cover, title, author, 96px progress bar + label, date, `⋯` | `library/items.tsx` |
| Detailed card | `minmax(150px, 1fr)` grid: full-width 5:7 cover, title (2 lines), author, progress bar | `library/items.tsx` |
| Context menu | 220px min, fixed at the pointer, clamped to the viewport | `ui/ContextMenu.tsx` |
| Reader | top bar 72px (56px on phones) with a 2px progress line. Pages: hidden by a centre tap with its space kept; the page box fills the rest minus a 44px footer; the page is 728px wide at most, 20/32px of vertical breathing room, 64px between pages. Scroll: the bars float over the chapter, which runs under them and under the tab bar; the column is 728px at most, 20/32px below the bar, 84px of room past the footer for the chapter buttons | `reader/PagedView.tsx`, `reader/ScrollView.tsx`, `--size-page-footer` |
| Chapter buttons (Scroll) | 44px circles in the page colour, 1px detail ring and a 2px shadow, 16px chevrons, 24px in from the bottom corners of the reading area (above the footer), the back pill between them; none on a side with no chapter. They hide with the chrome and while a selection, popover, note or footnote is open: down 200px over 300ms ease-in-out, behind the footer (a fade under reduced motion) | `reader/ScrollView.tsx`, `.chapter-button` |
| Page footer | 44px: ‹ and › at the sides (Pages only; Scroll has the chapter buttons, and its footer is opaque and rides down with the tab bar); between them one full-height button (13px meta, chapter title first on md+) that cycles on tap, instantly: "p. 4 of 17" ("Chapter 3 of 12" in Scroll) → "6 min left in chapter" → "3 h 12 min left in book" (books only) → "42%" → hidden; the choice is the `footerFormat` setting. Times use a reading speed learned from page dwell (median of the last 30 pages read at 4 s–3 min and 60–1000 wpm); until 5 samples, an average 238 wpm marked "~" ("~6 min left in chapter") | `reader/PageFooter.tsx`, `reader/readingSpeed.ts` |
| Title page | title at `clamp(30px, 4.5vw, 44px)`, subtitle italic, author 19px, meta 13px, a Contents button for books | `reader/TitlePage.tsx`, `.title-page` |
| Body | Spectral, line-height 1.6em, paragraph margin 20px; headings 2/1.625/1.375em; figures, code, tables and footnotes never split across pages; headings keep their next line | `prose.css` |
| Back pill | appears only after a jump (a link, a note's "Go to note", the contents): bottom-left on the page's lower edge, in line with the text; 44px hit area, 32px pill, 13px semibold accent on an opaque accent tint. "Back to p. 42" (page within its chapter, "· Chapter 3" when elsewhere), then "Return to p. 87" once used, and back again; in Scroll, with no page numbers, "Back" or "Back to Chapter 3". Gone after 3 page turns (screenfuls, in Scroll) away from both places or on leaving the document. Stays when the chrome hides. 150ms fade-and-rise | `reader/BackPill.tsx`, `reader/useJumpHistory.ts` |
| Footnote popover | a note reference opens its note beside it instead of jumping: `min(100vw − 2.5rem, 460px)` wide, at most 60vh tall (scrolls inside), 14/21px in the reading face, elevated surface; "Note 1" and ✕ at the top, "Go to note" at the bottom. Closes on a tap outside, ✕, Esc or a page turn. 150ms scale 0.98→1 and fade, `cubic-bezier(.16,1,.3,1)` | `reader/FootnotePopover.tsx`, `reader/footnotes.ts` |
| Context card | "Context for this" on a selection (web only): the footnote popover's box and entrance, beside the selection, at most as tall as the roomier side so it never covers the words; "Context" and ✕ at the top, "Open in Context →" at the bottom. Shows a focused briefing already made, else what the book's briefing says about the name (with "Go deeper"), else an offer with its cost. Closes on a tap outside, ✕, Esc, a page turn, a scroll or a resize. The selection menu stays 8px inside the viewport | `tools/context/ContextCard.tsx`, `reader/SelectionMenu.tsx` |
| Landing flash | the block a jump lands on: 20% accent wash with an 8px halo, held 2s then faded over 1s (`3s ease-out forwards`); a still wash for 3s under reduced motion. A class only, so text offsets hold | `.is-landing`, `flashLanding` |
| Tool panel | 360px, side by side at 1280px and up, a sheet below that | `ReaderPage.tsx` |

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
