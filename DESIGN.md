# Design: a reading room on paper

Pager is a personal reading environment: a library that is a folder, and pages rather than a
scrolling column. The palette is paper and ink with a saddle-brown accent; the dark theme is dark
sepia. Type is Spectral for everything that is read or titled, and the system sans for controls. The
layout measurements (a 232px left nav, a 728px reading measure, 72px bars) began as a study of
Substack's web reader and were kept; the look, the name and every colour are Pager's own.

Tokens live in `src/styles/tokens.css` (runtime CSS variables, light and dark). Tailwind utilities are
mapped onto them in `src/styles/globals.css`. Reading typography, pages and the title page are in
`src/styles/prose.css`.

## Palette

| Token | Light (paper) | Dark (sepia) | Used for |
|---|---|---|---|
| `--bg-primary` | `#faf6ee` | `#1c1713` | the page |
| `--bg-primary-hover` | `#f4ede0` | `#221c17` | rows under the pointer |
| `--bg-secondary` / `--bg-tertiary` / `--bg-quaternary` | `#ebe1cf` / `#ddd0b8` / `#c4b394` | `#2a2219` / `#362c21` / `#5a4a3a` | buttons, progress tracks, folder cards, dashed borders |
| `--bg-elevated` | `#fffdf8` | `#241e18` | dialogs, popovers, context menus |
| `--fg-primary` | `#2a211a` (ink) | `#e9dfcf` | text |
| `--fg-secondary` | `#6b5a4a` | `#a89880` | meta, inactive nav |
| `--fg-tertiary` | `#a8977f` | `#7a6a58` | placeholders, hairline icons |
| `--accent` / `--accent-hover` | `#7a4f2a` / `#5e3b1e` | `#c2905d` / `#d4a572` | primary buttons, links, progress fills, the reading-progress line |
| `--accent-bg` | `rgb(122 79 42 / .16)` | `rgb(194 144 93 / .22)` | text selection, search marks, drop zones |
| `--on-accent` | `#fbf5e9` | `#1c1713` | text on the accent |
| `--detail` | `rgb(60 40 20 / .12)` | `rgb(233 223 207 / .12)` | hairlines |
| `--error` | `#a83a2a` | `#e07b6a` | |
| highlights | yellow, green, blue, pink, purple at 24–40 % | the same, slightly stronger | the CSS Custom Highlight API, `prose.css` |

Contrast on paper: ink 14:1, secondary 6:1, accent 6.3:1 (links pass AA); on sepia: 13:1, 6.5:1, 6.6:1.
A faint paper grain (`body::before`, an inline `feTurbulence` SVG at 3.5 %) sits over the light theme only.

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
| Reader | top bar 72px (56px on phones) with a 2px progress line; the page box fills the rest minus a 44px footer; the page is 728px wide at most, 20/32px of vertical breathing room, 64px between pages | `reader/PagedView.tsx`, `--size-page-footer` |
| Title page | title at `clamp(30px, 4.5vw, 44px)`, subtitle italic, author 19px, meta 13px, a Contents button for books | `reader/TitlePage.tsx`, `.title-page` |
| Body | Spectral, line-height 1.6em, paragraph margin 20px; headings 2/1.625/1.375em; figures, code, tables and footnotes never split across pages; headings keep their next line | `prose.css` |
| Tool panel | 360px, side by side at 1280px and up, a sheet below that | `ReaderPage.tsx` |

## Pages

The section's HTML flows into CSS multi-columns inside `.reader-scroller`: `column-width` equals the
box's width, `column-fill: auto`, `overflow: hidden`. Page N is shown by setting `scrollLeft` to
N × (width + gap). The number of pages is `round((scrollWidth + gap) / (width + gap))`, measured again
whenever the box resizes, the content or type changes, fonts arrive or an image loads. The DOM is
never split, so `textContent` offsets (selections, highlights) are untouched; the reading place is the
first block whose box touches the visible page, plus the character under the page's top-left corner.
