# Substack and Medium (iOS): article reader UI and micro-interactions

Research date: 2026-10-28. Researcher: Claude subagent.

**Method and caveats.** No app binaries were downloaded and no service was logged into. The native iOS apps could not be run here, so the hardest numbers come from **the mobile web readers**. I loaded them in headless Chromium with an iPhone viewport (390x844, DPR 2, iOS 18.5 Safari user agent) and read computed styles, stylesheet rules, keyframes and the position of fixed/sticky elements at several scroll offsets. Pages inspected on 2026-10-28:
- Substack: `https://on.substack.com/p/the-tribe-has-spoken-how-drop-your` (the publication uses the "fancy_serif"/Lora preset), plus the 21 CSS bundles from `substackcdn.com/bundle/static/css/*.css` that this page links.
- Medium: `https://medium.com/blog/dark-mode-for-medium-is-finally-here-002977326982` (light mode), and `https://medium.com/the-ascent/3-empowering-truths-that-help-you-reach-your-fullest-potential-53c2fef5c595` (a member-only story, with `prefers-color-scheme: dark` emulated).

All sessions were logged out, so both sites showed sign-up interstitials. **Values taken from the web readers may differ from the native iOS apps.** Where a statement covers the native app, it cites a product post, a help page or the App Store. Anything without such a source is marked as inference. Screenshots are in `research_notes/iOS reading app UI patterns/screenshots/` with `substack_web_*` and `medium_web_*` prefixes.

---

## 1. Header and toolbar behavior on scroll

### Takeaway
On mobile web, Substack hides both bars when you scroll down and brings them back when you scroll up. The top bar (57 px) slides off by its own height, and the bottom like/comment/restack/share bar (57 px) slides down with a 0.25 s ease-out-expo transition. Medium's mobile web keeps a sticky top header (logged out) and a sticky 48 px bottom bar (claps, responses, reposts, save). That bar changes a class on scroll-down; the class that was observed sets `translateY(0)` on the bar's children. I found no source that describes the native apps' toolbar behavior.

### Cited Findings
**Substack mobile web (inspected)**
- Top bar: a `div.mainMenuContent` with `position: fixed`, height 57 px, background `#FAFAFA` (rgb 250,250,250). It holds the publication logo and name, an orange **Subscribe** pill and **Sign in**. After scrolling down 400 px its computed transform became `translateY(-57px)`, which hides it fully. After scrolling back up (from 1400 to 1000) it returned to `translateY(0)`. Its computed `transition` was `all` (no duration), so the movement is probably applied by script rather than by a CSS transition. A separate `.topBar` rule animates only `height` over `var(--animation-timing-faster)` (0.125 s) with `var(--animation-smooth)`. — [Substack web reader, inspected 2026-10-28](https://on.substack.com/p/the-tribe-has-spoken-how-drop-your)
- Bottom action bar: `div.mobile-footer-ufi`, rule `position: fixed; bottom: 0; left: 0; width: 100%; background: var(--color-bg-primary-themed); border-top: var(--border-default-themed); z-index: 2; transition: all var(--animation-smooth) var(--animation-timing-fast)`. The computed value is `0.25s cubic-bezier(0.19, 1, 0.22, 1)`. The bar is hidden at the top of the article, stays hidden while scrolling down, and is shown on scroll-up. Hidden state: class `hidden`, `transform: translateY(57px)`. Shown state: `transform: none`, `top: 787`. One CSS module also defines `.hidden-… { transform: translateY(100%) }`. — [Substack web reader](https://on.substack.com/p/the-tribe-has-spoken-how-drop-your); CSS bundle on substackcdn.com
- Bottom bar contents, in DOM order: **Like** (heart, `aria-label="Like (484)"`, `aria-pressed`), **comment** (`aria-label="View comments (0)"`, greyed out with `state-disabled` when there are 0 comments), **restack** (count only, "34"), **Share**. The buttons are bordered pills (`style-tabs … with-border`, 40 px tall, radius 20 px), and the row is `justified`. — [Substack web reader](https://on.substack.com/p/the-tribe-has-spoken-how-drop-your)
- Toasts are placed relative to the bottom bar. The fixed toast viewport (`ol.viewport…mobile`, z-index 1000, bottom 32 px) moves to `translateY(-64px)` while the bottom bar is visible, so toasts never sit under it. — [Substack web reader](https://on.substack.com/p/the-tribe-has-spoken-how-drop-your)
- Web-only promotions: a grey card at the top of the post reads **"Read distraction-free on Substack"** with a chevron. The Listen button's aria-label is **"Listen to this post in the app"**. Logged-out readers also get a centered modal after scrolling, **"Discover more from On Substack"**, with an email field, an orange **Subscribe**, "OR", **"Subscribe with Substack"**, legal text and "Already have an account? Sign in". It sits over a 60 % opacity backdrop (screenshots `substack_web_scrollup_subscribe_modal.png`, `substack_web_end_region.png`). The legacy intro popup uses `transition: transform 0.3s ease-in-out`. — [Substack web reader](https://on.substack.com/p/the-tribe-has-spoken-how-drop-your)
- Design-system motion tokens from Substack's CSS: `--animation-smooth: cubic-bezier(.19,1,.22,1)` (ease-out-expo), `--animation-drawer: cubic-bezier(.32,.72,0,1)` (an iOS sheet-like curve), `--animation-bounce: cubic-bezier(.15,1,.75,1.2)`, `--animation-timing-faster: .125s`, `--animation-timing-fast: .25s`, `--animation-timing-slow: .5s`. — Substack CSS bundles (substackcdn.com/bundle/static/css), linked from [the inspected post](https://on.substack.com/p/the-tribe-has-spoken-how-drop-your)

**Medium mobile web (inspected)**
- Top: a sticky white header, 98 px tall when logged out. It contains a "Sign up / Sign in" strip and a row with the Medium wordmark, search and avatar. It did not move at any scroll offset tested. Below it is a "The Medium Blog · Follow publication" row, then topic chips with "+" follow buttons (screenshot `medium_web_top_light_390.png`). — [Medium web reader, inspected 2026-10-28](https://medium.com/blog/dark-mode-for-medium-is-finally-here-002977326982)
- Bottom bar: a sticky `div` at `bottom: 0`, `z-index: 400`, 48 px tall. It shows **clap** icon + count ("4.1K"), **responses** speech bubble + count ("79"), **repost** arrows + count ("37"), and **save/bookmark** (bookmark with a "+") at the far right. In the initial state it has class `aci`, which maps to `.aci > * { transform: translateY(0px) }`. After scrolling down 400 px the class became `add`. That rule was not captured, but the naming pattern suggests a `translateY(...)` hide state (inferred). — [Medium web reader](https://medium.com/blog/dark-mode-for-medium-is-finally-here-002977326982)
- Bottom sheet, present but closed (probably the responses drawer, inferred): `position: fixed`, `transform: translateY(814px)`, `transition: transform 0.6s cubic-bezier(0.23,1,0.32,1), opacity 0.6s cubic-bezier(0.23,1,0.32,1)`. Its backdrop is white at 60 % (dark mode: `#171717` at 60 %), with `transition: opacity 0.6s cubic-bezier(0.23,1,0.32,1)`. Shadow: `0 0 4px rgba(36,36,36,.05), 0 2px 8px rgba(36,36,36,.15)`. — [Medium web reader](https://medium.com/blog/dark-mode-for-medium-is-finally-here-002977326982)
- New in 2026: Medium stories now have a **table of contents**. It is a `<nav aria-label="Table of contents">` with a button (`aria-haspopup`, `aria-expanded`) and a popover (`data-testid="toc-popover"`) that lists the H2s. The current section is marked `aria-current="location"`. The popover fades with `opacity 0.18s, visibility 0.18s`. Medium's October 2026 dark-mode post lists "table of contents" among this year's roadmap items. — [Medium web reader](https://medium.com/blog/dark-mode-for-medium-is-finally-here-002977326982); [Medium Blog, "Dark mode for Medium is finally here" (Oct 2026)](https://medium.com/blog/dark-mode-for-medium-is-finally-here-002977326982)

### Inferences
- Substack's top bar moves with the scroll position (no CSS duration), while the bottom bar snaps with a 250 ms ease-out-expo class toggle. That combination feels like Safari's own chrome. The bottom bar staying hidden at the very top is deliberate: the same like/comment/restack/share row is already shown inline under the byline, so the floating copy appears only once that inline row has scrolled away and the reader reverses direction.
- The native Substack and Medium apps probably use standard UIKit/SwiftUI navigation bars with hide-on-swipe behavior, but no source confirms this.

### Gaps
- No primary source (engineering blog, release note or video) describes the native iOS apps' nav-bar collapse or hide behavior, or a compact title. Neither app's App Store release notes for 2026 mention it. Substack's notes are mostly "Bug fixes and performance improvements" ([App Store, Substack](https://apps.apple.com/us/app/substack/id1581650857)); Medium's are a generic "smoother reading experience" line ([App Store, Medium](https://apps.apple.com/us/app/medium/id828256236)).
- Medium's hide-state CSS (class `add`) was not captured because a full-screen sign-up overlay locked scrolling right after the class changed.

---

## 2. The bottom of an article: end matter, clap, recommendations, paywall

### Takeaway
Substack ends a post with subscribe CTAs, the full action row, comments, a "Previous" link and an archive strip (Top / Latest / Discussions). Medium ends with the clap/response row, "Written by" and "Published in" cards, and recommendation cards. Member-only stories end in a text fade into a "Create an account to read the full story." wall. Medium allows 50 claps per reader per story; holding the button claps repeatedly with an enlarged "exploded" animation.

### Cited Findings
**Substack (web, inspected).** Headings and controls after the body, in order:
1. "Subscribe to On Substack" (inline subscribe widget, 40 px tall).
2. The inline action row (Like, comments, restack, **Share**).
3. The comments area. Here the comments button is disabled at 0 comments.
4. **"Previous"** (link to the previous post).
5. Archive tabs **"Top" / "Latest" / "Discussions"**, with post cards: serif title, subtitle, uppercase date, like count, restack count, share icon. Then **"See all"**.
6. A full-width orange band **"Ready for more?"** with a subscribe form.
7. Footer: "© 2026 Substack · Privacy · Terms · Collection notice", **"Start your Substack"**, **"Get the app"**, and "Substack is the home for great culture".

There was no overscroll or pull-to-next-post behavior on the web. Screenshots: `substack_web_bottom_modal.png`, `substack_web_end_region.png`. — [Substack web reader](https://on.substack.com/p/the-tribe-has-spoken-how-drop-your)
- Substack like animation, from the CSS: `a.like-button .reaction-container svg.animation { position:absolute; opacity:1; transform: scale(0); transition: all var(--animation-timing-slow) var(--animation-smooth) }`, so an overlay heart scales in over 0.5 s with ease-out-expo. Related keyframes: `@keyframes pop_1_5 { 0%,100% { transform: scale(1) } 50% { transform: scale(1.5) } }`. A particle burst `@keyframes spark-burst` moves each spark outward at angle `var(--Θ)` with `translateY(.8em → 1em)`, `scale(1 → 0)`, `opacity → 0`. — Substack CSS bundles linked from [the inspected post](https://on.substack.com/p/the-tribe-has-spoken-how-drop-your) (which element uses spark-burst is inferred)

**Medium clap**
- "You can clap up to 50 times per story or list." To remove claps on the web: three-dot button at the bottom of the story → **"Undo applause for this post."** Only the author sees how many claps each person gave. Ranking weighs a user's claps relative to how many they usually give. — [Medium Help: About claps](https://help.medium.com/hc/en-us/articles/115011350967-About-claps)
- Claps replaced the heart/"recommend" in August 2017. Existing hearts were converted 1:1 to claps, and the cap was 50 per user per article. — [Nieman Lab (Aug 2017)](https://www.niemanlab.org/reading/medium-will-now-pay-writers-based-on-how-many-claps-they-get/); [TechNext (Aug 17 2017)](https://technext.ng/2017/08/17/can-now-clap-posts-medium-much-like/)
- Holding the button down produced an enlarged, "exploded" clap animation. Ev Williams's team chose applause as "the most natural metaphor" for appreciation. — [Quartz](https://qz.com/1115662/why-medium-replaced-traditional-advertising-with-a-subscription-model-and-claps)
- Users describe the press-and-hold: the longer you hold, the more claps, up to 50. — [Tildes discussion](https://tildes.net/~misc/65e/what_do_you_think_of_mediums_clapping_system)
- The well-known community recreations of the clap (a "+N" counter bubble that rises and fades, a particle burst, an auto-repeat while held) use a ~300 ms auto-clap interval and a max of 50. These are **third-party reconstructions, not Medium code.** — [MediumClap-Android](https://github.com/wajahatkarim3/MediumClap-Android/); [Hackernoon walkthrough](https://sia.hackernoon.com/how-i-implemented-the-medium-clap-from-scratch-4a16ac90ad3b)

**Medium end-of-story, paywall and recommendations (web, inspected)**
- After the body, the headings are: "Get Medium Staff’s stories in your inbox" (`gt-super` serif heading 18/21, email field, "Subscribe", "Remember me for faster sign in"), **"Written by Medium Staff"** and **"Published in The Medium Blog"**, followed by recommendation cards. Each card shows publication icon, "In <pub> by <author> · <date>", a bold sohne title, a grey subtitle, and a row with a gold sparkle (member-only marker), clap count, response count, repost count and a "show less" thumbs-down at the right (screenshot `medium_web_recommended_dark.png`). — [Medium web reader](https://medium.com/the-ascent/3-empowering-truths-that-help-you-reach-your-fullest-potential-53c2fef5c595)
- Member-only wall (logged out): the last paragraphs fade into the background color (an H2 and paragraph shown at decreasing opacity), then a serif headline **"Create an account to read the full story."**, the copy **"The author made this story available to Medium members only. If you’re new to Medium, create a new account to read this story on us."**, a white pill **"Continue in app"** and App Store / Google Play badges (screenshot `medium_web_paywall_fade_dark.png`). — [Medium web reader](https://medium.com/the-ascent/3-empowering-truths-that-help-you-reach-your-fullest-potential-53c2fef5c595)
- On a free story, a full-screen sign-up overlay appears after about 400 px of scrolling: **"Be the first to hear about new stories from Medium Staff"**, "Join Medium for free to get updates from Medium Staff sent right to your inbox.", "Create account", "Other sign up options" (screenshot `medium_web_signup_overlay.png`). — [Medium web reader](https://medium.com/blog/dark-mode-for-medium-is-finally-here-002977326982)
- Medium describes the paywall this way: "Non-members can read all the stories that authors have chosen to publish outside the paywall." — [Medium Help: About the paywall](https://help.medium.com/hc/en-us/articles/360017581433-About-the-paywall)

### Inferences
- Both products treat the end of an article as a conversion surface (subscribe, follow, more stories) rather than a quiet ending. The reusable pattern is a single clearly separated "end card" with the primary reaction and a "next" path.
- The clap's appeal comes from hold-to-repeat combined with a counter bubble that rises and fades. That is easy to rebuild with pointer events and CSS keyframes.

### Gaps
- I found no first-party description of the current native clap animation timings or of haptics on each clap. Medium's 2017 launch posts are only paraphrased in press coverage here.
- "More from <author>" exists on Medium story pages, but the logged-out inspection showed "Written by" plus general recommendations, so the exact native copy was not confirmed.
- No pull-to-next-post or overscroll gesture was found in either product's sources.

---

## 3. Progress: reading-progress bar and "X min read"

### Takeaway
Medium shows a static "N min read" at the top (265 WPM, with an adjustment for images; CJK at 500 characters/min) and, from 2026, a TOC whose current section updates as you scroll. Neither web reader shows a scroll progress bar. Substack's post header shows no read time on the web.

### Cited Findings
- "Read time is based on the average reading speed of an adult (roughly 265 WPM). We take the total word count of a post and translate it into minutes, with an adjustment made for images. For posts in Chinese, Japanese and Korean, it's a function of number of characters (500 characters/min)." — [Medium Help: Read time](https://help.medium.com/hc/en-us/articles/214991667-Read-time)
- Medium's mobile web header row reads "2 min read · 6 days ago" (sohne, grey #6B6B6B). — [Medium web reader](https://medium.com/blog/dark-mode-for-medium-is-finally-here-002977326982)
- Medium's TOC popover marks the active heading with `aria-current="location"`. — [Medium web reader](https://medium.com/blog/dark-mode-for-medium-is-finally-here-002977326982)
- Substack's post header on the web contains: section label ("STORIES", uppercase grey), title, subtitle, avatars, uppercase author names ("SEAN ROSS AND BAILEY DUNN"), uppercase date ("OCT 20, 2026") and a **Listen** button. It has no read-time text, and no fixed progress element was found. — [Substack web reader](https://on.substack.com/p/the-tribe-has-spoken-how-drop-your)

### Inferences
- The scroll spy behind Medium's TOC is effectively a progress indicator: it shows which section you are in.

### Gaps
- I could not confirm whether the native Substack app shows read time or a progress bar, or whether the native Medium app shows a progress indicator.

---

## 4. Typography

### Takeaway
On a 390 px phone both readers set an 18 px serif body. Substack uses a line-height of 1.6 (28.8 px) with 20 px paragraph gaps and 16 px gutters (~40 characters per line). Medium uses 28 px (1.56) with ~28 px paragraph gaps and 24 px gutters (~33–40 characters per line). Medium pairs a serif body (`source-serif-pro` on web) with sohne sans headings. Substack's fonts come from per-publication presets, with system fallbacks that include New York (`-apple-system-ui-serif`) and SF Pro. Substack ships an opt-in drop cap built on `initial-letter`.

### Cited Findings
**Substack (web, Lora preset; `--font_preset_body: fancy_serif`, `--font_size_body_offset: 1px`)**

| Element | Computed value at 390 px |
|---|---|
| Body `p` | Lora 18 px / 28.8 px (1.6), 400, color `#363737`, margin 0 0 20 px, column 358 px (16 px gutters), measured ≈40 chars/line, `-webkit-font-smoothing: antialiased`, no hyphenation |
| Title `h1.post-title` | Lora 32 px / 36 px, weight 600, `#363737` |
| Subtitle `h3.subtitle` | Lora 18 px / 24 px, `#868787`, margin-top 12 px |
| Section label | uppercase, grey ("STORIES") |
| Image caption | 15 px / 20 px, letter-spacing −0.15 px, `#868787`, centered, italic in the screenshot, margin-top 8 px, about 54 px side padding |
| Links | accent `#FF6719` (publication accent = Substack orange) |
| Pull quote `.pullquote p` | Lora 18 / 28.8, weight 500, margin 32 px top and bottom |
| Listen button | system-ui 13 px / 20 px, 600, 32 px tall, radius 8 px, outlined ("secondary-outline") with a headphones icon |

— [Substack web reader](https://on.substack.com/p/the-tribe-has-spoken-how-drop-your)
- Substack font tokens:
  - `--font-family-serif: -apple-system-ui-serif, ui-serif, "Spectral", "Georgia", serif` (New York on Apple platforms)
  - `--font-family-title-base: "SF Pro Display", -apple-system-headline, var(--font-family-text)`
  - `--font-family-text-base: system-ui, -apple-system, …`
  - `--font-family-meta: "SF Compact", -apple-system, …`
  - `--font-family-digit: "Jetbrains Mono", monospace`
  - Publication body = `var(--font_family_body, var(--font_family_body_preset, var(--font-family-text)))`, so with no preset the body falls back to the system sans.

  — Substack CSS bundles linked from [the inspected post](https://on.substack.com/p/the-tribe-has-spoken-how-drop-your)
- Substack drop cap (opt-in `.dropCap` class on the post):
  - Base: `.body > p:first-of-type { display: flow-root; overflow: clip }`.
  - Where `initial-letter` is supported: `-webkit-initial-letter: 3; initial-letter: 3; margin-inline-end: .4rem; font-weight: 700; color: var(--color-accent-themed)`. At `max-width: 768px` this changes to `initial-letter: 2; margin-inline-end: .3rem`.
  - Fallback: `float: left; font-size: 6.5rem` (3.5rem on mobile); `line-height: .8; margin-top: .06em; margin-inline-end: .1em`.

  — Substack CSS bundles
- Substack pull quotes can bleed past the column with `.pullquote { margin-left/right: var(--margin-bleed) }`, and there are alignment variants `pullquote-align-center|right|wide`. One publication theme sets pull quotes in 32 px / 1.4 condensed serif, centered, in the accent color. — Substack CSS bundles
- Substack sets `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0, viewport-fit=cover">`, so pinch zoom is off on the web reader, and `theme-color #ffffff`. — [Substack web reader](https://on.substack.com/p/the-tribe-has-spoken-how-drop-your)

**Medium (web)**

| Element | Computed value at 390 px |
|---|---|
| Body `p.pw-post-body-paragraph` | `source-serif-pro, Georgia, Cambria, "Times New Roman", Times, serif` 18 px / 28 px, 400, letter-spacing −0.054 px (−0.003 em), `#242424`, margin-top 28.08 px with margin-bottom −8.28 px (net gap ≈20–28 px), column 342 px (24 px gutters), measured ≈33 chars/line |
| Title `h1.pw-post-title` | `sohne, "Helvetica Neue", Helvetica, Arial, sans-serif` 32 px / 38 px, 700, letter-spacing −0.448 px (−0.014 em), `#242424`, `text-rendering: optimizeLegibility` |
| Subtitle `h2.pw-subtitle-paragraph` | sohne 18 / 24, 400, `#6B6B6B`, margin-top 14.22 px, margin-bottom 24 px |
| Body H2 | sohne 20 / 24, 600, margin-top 24 px |
| Blockquote | italic source-serif 18 / 28; a 3 px left rule drawn with `box-shadow: rgb(36,36,36) 3px 0 0 0 inset` plus `margin-left: -20px; padding-left: 23px` (the rule hangs into the gutter) |
| Figure | margin-top 40 px, full column width (342 px); wrapper `transition: transform 0.3s cubic-bezier(0.2,0,0.2,1)` (click to zoom: "Press enter or click to view image in full size") |
| Figcaption | sohne 14 / 20, `#6B6B6B`, margin-top 10 px, max-width 728 px |

— [Medium web reader (light)](https://medium.com/blog/dark-mode-for-medium-is-finally-here-002977326982); [Medium web reader (dark, member story)](https://medium.com/the-ascent/3-empowering-truths-that-help-you-reach-your-fullest-potential-53c2fef5c595)
- Font faces loaded on Medium story pages (`document.fonts`): `charter` (400/700, regular and italic), `fell`, `gt-super`, `noe`, **`opendyslexic`**, `sohne` (300–700), `source-code-pro`, `source-serif-pro`. On the inspected pages the body used source-serif-pro and the sign-up and paywall headlines used gt-super. — [Medium web reader](https://medium.com/blog/dark-mode-for-medium-is-finally-here-002977326982)
- No drop cap was found on either inspected Medium story. No element had `float:left` with a large font size, and `::first-letter` was 18 px. — [Medium web reader](https://medium.com/blog/dark-mode-for-medium-is-finally-here-002977326982)

### Inferences
- Charter and OpenDyslexic are loaded but unused in the default story view. That suggests Medium offers alternate reader fonts or uses Charter in some contexts. Charter is widely reported as the iOS app's body face, but I found no source in this session, so this is unconfirmed.
- Medium's +28 px top / −8 px bottom paragraph margins are a collapse trick that keeps the gap tight after headings and figures but roomy between paragraphs.
- The two readers converge on a phone recipe: 18 px serif, line-height 1.55–1.6, 16–24 px gutters, 30–40 characters per line, a 32 px bold title, an 18 px muted subtitle, captions at 14–15 px in grey, and images at full column width with generous top margin (Medium 40 px).

### Gaps
- Native-app font sizes, Dynamic Type support and any in-app text-size or font settings were not confirmed for either app (see section 10 for complaints).
- I did not confirm what Medium's own design posts say about Charter or sohne (no fetch succeeded; medium.com returns 403 to plain fetches).

---

## 5. Text selection and highlighting

### Takeaway
Substack's custom selection menu fades in and drops about 4 px over 140 ms (disabled under reduced motion). Its main action is **Restack**, which, since the December 2024 redesign, turns the quote into an image-like card with a choice of background color and alignment. Medium highlights are public to your followers and the author, shown as a light-green `<mark>` (`#E8F3E8`). A highlight can start a response, and highlights can be hidden per story.

### Cited Findings
- Substack selection menu CSS: `.selectionMenu { position: fixed; z-index: 2147483000; animation: .14s cubic-bezier(.16,1,.3,1) selectionMenuIn }`, with `@keyframes selectionMenuIn { 0% { opacity: 0; transform: translateY(calc(-1 * var(--size-4))) } }`. Under `@media (prefers-reduced-motion: reduce)` the animation is `none`. Substack's `::selection` background is `var(--color-bg-accent-hover-themed)`, a tint of the publication accent. — Substack CSS bundles linked from [the inspected post](https://on.substack.com/p/the-tribe-has-spoken-how-drop-your)
- Quote restack redesign (Dec 18 2024): "The updated layout treats the selected quote like an image in the feed, and readers can now customize the background color and text alignment before posting. The process remains the same: highlight the text you want to share, then click 'Restack' when prompted." — [On Substack: New read-aloud voices, quote restacks, and Note stats](https://on.substack.com/p/new-read-aloud-voices-quote-restacks)
- A writer describes the flow as "Restack Quote", which opens a note draft, with a paintbrush icon at the top right to change the background (community source, per search snippet). — [Substack note](https://substack.com/@entropicabsurdity/note/c-238799389)
- Substack's "share as image" for whole posts is reached from the post's ⋯ menu (community source, per search snippet). — [lindac.substack.com](https://lindac.substack.com/p/substacks-image-builder-is-a-fun)
- Substack deep-linked heading highlight: `.header-anchor-post.highlight { --highlight-bg: oklch(from var(--color-bg-accent-themed) l c h / 0.2); animation: 3s ease-out forwards highlight-fade; border-radius: var(--size-2) }`, with `@keyframes highlight-fade { 0%,66% { background-color: var(--highlight-bg); box-shadow: 0 0 0 var(--size-8) var(--highlight-bg) } 100% { background-color: transparent; box-shadow: 0 0 0 var(--size-8) transparent } }`. The target holds a 20 % accent wash with an 8 px halo for 2 s, then fades over 1 s. Heading anchor links (`.header-anchor-parent`, 44 px wide, `translate(-100%)`, `opacity 0` → fade in with `--animation-timing-fast`) sit in the left gutter. — Substack CSS bundles
- Medium highlights: "Passages you highlight are visible to your followers and to the author of the story on the story page," and "The story author will receive a notification." Web flow: select text → click the highlighter icon; click it again to remove. You can respond from a highlight ("Click the Response button in the tool bar that appears"). **Hide highlights**: three-dot button at the top right → "Hide highlights" (desktop, iOS and Android). Highlights are listed under Library → Highlights. — [Medium Help: About highlights](https://help.medium.com/hc/en-us/articles/214406358-About-highlights)
- Medium web renders highlights as `<mark>` with `background-color: var(--color-bg-accent-quaternary)` (computed `rgb(232,243,232)` = `#E8F3E8`) and `color: currentcolor`. On the inspected story the title and opening sentences carried these marks (the "top highlight" display). — [Medium web reader](https://medium.com/blog/dark-mode-for-medium-is-finally-here-002977326982)
- Older behavior: Medium "Notes" were private messages to authors, mainly for copy edits. Public responses could target individual passages. — [Medium (older company post)](https://medium.com/@Medium/e5c12132fa23)

### Inferences
- Medium's private notes appear to have been replaced by public highlights and responses. The current help pages describe no private-note popover. This is unconfirmed for the native app.
- Substack's 140 ms fade plus a few pixels of travel, using a sharp ease-out (`.16,1,.3,1`), is a good default for any selection popover.

### Gaps
- The exact buttons in Substack's selection menu (beyond "Restack") and Medium's native selection toolbar (highlight, respond, share, Tweet?) were not confirmed. Logged-out pages did not show them, and selection could not be scripted without JavaScript UI events.
- I found no source for the native animation of Medium's highlight popover.

---

## 6. Audio / TTS

### Takeaway
Substack's text-to-speech launched for **iOS app readers** in June 2022. It is app-only, English-only, plays in the app's audio player and keeps playing in the background. Since December 2024 publishers can pick the voice. The July 2026 player redesign added speed control, offline downloads, a sleep timer and a queue. Medium's "Listen" is a member feature: a player docks at the bottom and expands to full screen with a "1X" speed button, Share and an ⋯ menu that includes voice choice.

### Cited Findings
- "Starting today, readers using the Substack iOS app will have the ability to hear posts read aloud" (Jun 28 2022). Writer voiceovers and audio embeds launched the same day. A recorded voiceover "can be listened to from email, on the web, or in the Substack iOS app." — [On Substack: New ways to listen to your favorite writing](https://on.substack.com/p/new-ways-to-listen-to-your-favorite)
- Dec 2024: "new text-to-speech (TTS) voices in the Substack app. Publishers with TTS enabled can now choose from a variety of free voices, offering diverse genders, ages, and tones." — [On Substack bulletin](https://on.substack.com/p/new-read-aloud-voices-quote-restacks)
- Jul 6 2026: "A redesigned podcast player … Subscribers can now adjust playback speed directly from the player, listen to episodes offline, and set a sleep timer to better control auto-advance behavior," plus "add episodes to their playback queue". — [On Substack: New on Substack … redesigned podcast player](https://on.substack.com/p/new-on-substack-subscriber-perks)
- Substack iOS release notes about the player:
  - 3.8.1 (Jul 23 2026): "Posts you've already listened to should now stop getting stacked up in the player queue", and "Background playback should stop getting halted when quickly leaving the app after playing audio."
  - 3.10.1 (Aug 4 2026): "Fix media player crashing after playing for some period of time when in the background."
  - 3.2.1 (Jun 9 2026): "Fixes a bug that can cause the app to freeze when toggling playback in the fullscreen player."

  So there is a **fullscreen player**, a **queue** and **background playback**. — [App Store: Substack version history](https://apps.apple.com/us/app/substack/id1581650857)
- Writers' help posts say there is a play icon at the top right of a post that starts audio in the app player, which continues in the background. TTS is English-only, not available on the web, and free subscribers may hear only previews of paywalled posts (community sources, per search snippets). — [Those Who Wander](https://thosewhowander.substack.com/p/new-feature-announcement-now-listen); [fiercecommunity.substack.com](https://fiercecommunity.substack.com/p/you-can-listen-to-posts-on-the-app)
- On the web, Substack's header Listen button has `aria-label="Listen to this post in the app"`, so it routes to the app. — [Substack web reader](https://on.substack.com/p/the-tribe-has-spoken-how-drop-your)
- Medium: "You must have a Medium account with an active membership subscription in order to listen to stories." App flow: "click the Listen button at the top of the screen. Once you tap Listen, the player will be displayed at the bottom of the screen … If you tap on it, it will be expanded in full-screen, allowing you to: Tap the 1X button to adjust the speed. Tap the Share button … Tap the ellipsis button to access additional options, including the voice selection." English only. — [Medium Help: About audio](https://help.medium.com/hc/en-us/articles/4635049283351-About-audio)
- The Medium App Store listing promotes "listen to audio versions of any story" as a Member feature. — [App Store: Medium](https://apps.apple.com/us/app/medium/id828256236)
- Medium web: a `button[data-testid="audioPlayButton"][aria-label="Listen"]` (play-circle icon + "Listen") sits next to Share under the byline. — [Medium web reader](https://medium.com/blog/dark-mode-for-medium-is-finally-here-002977326982)

### Inferences
- Both apps share one model: a Listen entry point in the article header → a mini player docked above the tab bar → tap to expand to a full-screen player with speed, voice and share. The mini player persists while you browse. That persistence needs a native audio session.

### Gaps
- No source describes word-by-word or sentence highlighting synchronized with TTS in either app, or whether reading position follows the audio.
- No source gives the exact speed steps (for example 0.8x–2x).

---

## 7. Transitions: opening from the feed, swipe-back, pull-down-to-dismiss

### Takeaway
I found no primary or reliable secondary source that describes how either native app opens an article (push, zoom or sheet), or whether it supports swipe-back or pull-down-to-dismiss.

### Cited Findings
- The only related motion data comes from the web: Substack's `--animation-drawer: cubic-bezier(.32,.72,0,1)` sheet curve and Medium's bottom sheet `transform 0.6s cubic-bezier(0.23,1,0.32,1)`. — Substack CSS bundles; [Medium web reader](https://medium.com/blog/dark-mode-for-medium-is-finally-here-002977326982)

### Inferences
- Both apps most likely use a standard navigation push with the iOS interactive edge swipe-back (the UIKit default), but this is unverified.

### Gaps
- This needs hands-on screen recordings of the current apps. I found no Mobbin-style flow captures, blog posts or videos in this session.

---

## 8. Substack specifics: in-app reader vs web view, Notes, Chat

### Takeaway
On the web, Substack pushes readers toward the app ("Read distraction-free on Substack", "Listen to this post in the app"), and TTS is app-only, so the app's reader is the primary surface. Whether the iOS post body is a native view or a web view is not public.

### Cited Findings
- The web post page shows an app-promo card, **"Read distraction-free on Substack"**, and a Listen button labeled "Listen to this post in the app". — [Substack web reader](https://on.substack.com/p/the-tribe-has-spoken-how-drop-your)
- Substack's 2022 web reader ("Revenge of RSS") was the first non-app reading inbox. A Substack reply in that thread says dark mode on the web reader follows the system preference. — [On Substack: new web reader](https://on.substack.com/p/new-web-reader); [comment](https://on.substack.com/p/new-web-reader/comment/12859555) (per search snippet)
- 2026 social and app features that sit next to the reader: saved Notes on iOS and Android (⋯ top right → saved), scheduled Chat threads, a redesigned podcast/video player, and new post-editor features (text colors and highlight, sub/superscript, polls). — [On Substack (Jul 6 2026)](https://on.substack.com/p/new-on-substack-subscriber-perks)

### Inferences
- The publication's web CSS includes many publication-specific theme modules (for example a Free Press "thefp" theme with condensed serif pull quotes). That suggests the in-app reader either renders the same themed HTML or maps theme presets to native styles. Which one is unknown.

### Gaps
- Native vs WebView rendering of the Substack iOS post body is unconfirmed (no binary inspection was allowed, and there was no public engineering post).
- Notes and Chat were out of scope beyond the above.

---

## 9. Haptics, loading skeletons, image lazy-load fades, dark mode

### Takeaway
Medium launched dark mode in September–October 2026, after a decade of requests. It follows the system setting by default, with a manual toggle at Settings → Profile → Appearance. Its dark palette is `#171717` background with `#E5E5E5` text. Substack's publication pages ignored `prefers-color-scheme: dark` in this test, but its web reader reportedly follows the system. Substack uses a 2.2 s linear shimmer skeleton and progressive JPEGs. No source covered haptics.

### Cited Findings
- Medium: "we are happy to finally release dark mode on Medium … If you already have dark mode turned on in your computer’s system settings, you should just be able to come to Medium.com and have it be in dark mode automatically … If you want to manually set Medium to dark mode, just head over to your Settings > Profile > Appearance > Toggle to Dark." Development started in February 2026 and "got it across the line in September". Dark mode had been "one of our top three most-requested changes". — [Medium Blog: Dark mode for Medium is finally here (Oct 2026)](https://medium.com/blog/dark-mode-for-medium-is-finally-here-002977326982) (text read via headless browser)
- Medium dark palette (computed, `prefers-color-scheme: dark` emulated): header and page background `rgb(23,23,23)` = `#171717`; title and body text `rgb(229,229,229)` = `#E5E5E5`; subtitle and caption `rgb(179,179,179)` = `#B3B3B3`. Blockquote rule color follows the text color. The image backdrop in light mode is white (`img { background: #fff }`). Screenshots: `medium_web_top_dark_390.png`, `medium_web_paywall_fade_dark.png`. — [Medium web reader (dark)](https://medium.com/the-ascent/3-empowering-truths-that-help-you-reach-your-fullest-potential-53c2fef5c595)
- Substack: with `prefers-color-scheme: dark` emulated, the on.substack.com post rendered identically to light mode (same `#363737` text on white, `theme-color #ffffff`, byte-identical top screenshot). Publication theme colors come from inline variables (`--web_bg_color: #ffffff`, `--print_on_web_bg_color: #363737`, `--color_theme_accent: #ff6719`). — [Substack web reader](https://on.substack.com/p/the-tribe-has-spoken-how-drop-your)
- Substack skeleton: `.shimmer { background: linear-gradient(90deg, #d6d6d6 8%, #a8a8a8 18%, #d6d6d6 33%) 0 0 / 1200px 100%; animation: shimmerAnimation 2.2s linear infinite forwards }` with `@keyframes shimmerAnimation { 0% { background-position: -1200px 0 } to { background-position: 1200px 0 } }`. There is also a `pulse` keyframe (opacity 1 → .5 → 1) and `processing-fade` (opacity .4 → .8). — Substack CSS bundles
- Substack images: `srcset` from `substackcdn.com/image/fetch/…w_424,c_limit,f_auto,q_auto:good,fl_progressive:steep/…`, `sizes="100vw"`, with no `loading="lazy"` attribute and no opacity transition on `img`. Perceived loading relies on **progressive JPEG ("steep")** and automatic format and quality. — [Substack web reader](https://on.substack.com/p/the-tribe-has-spoken-how-drop-your)
- Medium images: the first figure image was `loading="eager"` with no opacity transition. The figure wrapper animates `transform 0.3s cubic-bezier(0.2,0,0.2,1)` for zoom. — [Medium web reader](https://medium.com/blog/dark-mode-for-medium-is-finally-here-002977326982)
- Older complaints: App Store and aggregator reviews say the Substack app lacked dark mode and font size options at one point. — [justuseapp reviews](https://justuseapp.com/en/app/1581650857/substack/reviews) (undated aggregation)

### Inferences
- Medium's dark mode uses a near-black, not pure black (`#171717`), and an off-white text (`#E5E5E5`), which avoids halation on OLED.

### Gaps
- No source found for haptics in either app (clap ticks, like taps, selection).
- Whether the native Substack app supports dark mode now (2026) was not confirmed by a first-party source. Third-party guides claim reader dark mode and font-size options exist, but they are undated and unreliable ([substackcourse.com](https://substackcourse.com/how-to-use-substack-as-a-reader/)).
- Whether Medium's native iOS app had dark mode before the October 2026 web launch is not clear from the post, which talks about Medium.com.

---

## 10. What users praise or complain about

### Takeaway
The recurring Substack complaints are a fixed font with no size control (at least historically), no dark mode, comments that can't be sorted, crashes, and audio-player bugs. Medium's complaints are older (iPad layout, freezes) and center on the decade-long wait for dark mode. Praise is generic ("distraction-free").

### Cited Findings
- Substack App Store review: the reader app uses one fixed font, a small serif body with a sans headline, with no font style or size options, and is "harder to read than the browser". — [App Store (TH) Substack reviews](https://apps.apple.com/th/app/substack/id1581650857) (per search snippet; undated)
- Substack: "can't adjust font size or switch to dark mode, and can't sort comments." — [justuseapp](https://justuseapp.com/en/app/1581650857/substack/reviews)
- Substack: readers like the core reading experience but cite limited customization and frequent crashes. — [Kimola consumer insights](https://kimola.com/reports/substack-consumer-insights-and-user-experience)
- Substack's 2026 release notes fix player-queue stacking, background playback halting and background crashes, which shows the audio player was a pain point. — [App Store: Substack](https://apps.apple.com/us/app/substack/id1581650857)
- Medium: dark mode was "consistently … one of our top three most-requested changes" for about 10 years. — [Medium Blog (Oct 2026)](https://medium.com/blog/dark-mode-for-medium-is-finally-here-002977326982)
- Medium App Store reviews (older): huge white margins in iPad landscape and cut-off images (2018), and freezes "by the third click or so" (2021). The listing pitches "distraction-free reading" and continuous reading across devices. — [App Store: Medium](https://apps.apple.com/us/app/medium/id828256236)
- A Tildes discussion shows mixed feelings about the clap mechanic (holding to give more). — [Tildes](https://tildes.net/~misc/65e/what_do_you_think_of_mediums_clapping_system)

### Gaps
- Reddit (r/Substack, r/Medium) threads about the reader specifically were not retrieved. One search summary attributed an April 2026 "font too thin / ignores iOS Bold Text / paragraphs too tight" complaint to Substack, but on fetching it turned out to be about the **Gemini** app, so it is excluded. The checklist it raises (Bold Text, paragraph gap vs line gap) is still useful for Pager.

---

## 11. Implications for Pager

Pager is a SwiftUI shell around a React UI in a WKWebView, with paginated (CSS columns) and scroll modes, a settings panel, a selection menu, an annotation popover, a TOC drawer and a page footer. Each pattern below is marked **Web** (buildable inside WKWebView) or **Native** (needs Swift help).

1. **Hide chrome on scroll-down, reveal on scroll-up (scroll mode)** — Web. Translate the top bar with the scroll delta (clamped to its height, as Substack does with no transition) and toggle the bottom bar with a class: `transform: translateY(100%)`, `transition: transform .25s cubic-bezier(.19,1,.22,1)`. Keep the bottom bar hidden at the very top. In paginated mode, toggle the chrome on a center tap instead. Move toasts up when the bar is visible, as Substack's toast viewport does. *Native* help is needed only if the bars are SwiftUI views or the status bar should hide too (JS → `WKScriptMessageHandler` → `.statusBarHidden`).
2. **Motion tokens** — Web. Use Substack's set: 125/250/500 ms; ease-out-expo `cubic-bezier(.19,1,.22,1)` for bars and popovers; `cubic-bezier(.32,.72,0,1)` for sheets and the TOC drawer; selection popover `140ms cubic-bezier(.16,1,.3,1)` from `opacity:0; translateY(-4px)`. Wrap all of it in `prefers-reduced-motion`, which WKWebView honors.
3. **Typography defaults for phone** — Web. 18 px serif, line-height 1.55–1.6, 16–24 px gutters (aim for 30–40 characters per line on a 390 px phone and cap `max-width` around 680–728 px on iPad), paragraph gap about 20 px (or Medium's `margin-top: 1.56em` with a negative bottom margin), 32 px / 1.15 title, 18 px muted subtitle, 14–15 px grey captions, images full column width with about 40 px top margin. `font-family: -apple-system-ui-serif, ui-serif, Georgia` gives New York for free in WKWebView, and `system-ui` gives SF.
4. **Accessibility settings that readers notice** — mostly Web, with a little Native. `font: -apple-system-body` lets CSS follow Dynamic Type inside WKWebView. Bold Text (`UIAccessibility.isBoldTextEnabled`) and increased contrast need a *Native* observer that injects a CSS class. Keep the paragraph gap clearly larger than the line gap.
5. **Drop cap** — Web. Copy Substack's rule: `-webkit-initial-letter: 2` on phones and 3 on wide screens, accent color, weight 700, `margin-inline-end: .3rem`, with a float fallback. WebKit supports `-webkit-initial-letter`. Test it inside CSS multi-column pagination, where the first paragraph of a chapter can land at a column break.
6. **Blockquote and pull quote** — Web. Medium's hanging rule: `box-shadow: inset 3px 0 0 currentColor; margin-left: -20px; padding-left: 23px; font-style: italic`. Pull quotes: 32 px top and bottom margin, optionally bleeding past the gutters.
7. **Highlight rendering and jump-to-annotation** — Web. Use a soft fill (Medium `#E8F3E8`; Substack uses a 20 % accent wash via `oklch(from accent l c h / .2)`). When navigating from the TOC or the annotation list, flash the target with Substack's `highlight-fade` (3 s ease-out: hold for 66 %, then fade, with an 8 px box-shadow halo). Add a "Hide highlights" toggle, which Medium offers per story.
8. **Selection menu** — Web for the custom menu, *Native* for suppressing or merging the iOS edit menu. JS cannot fully remove WKWebView's system callout. Either subclass WKWebView and override `buildMenu(with:)` / `canPerformAction(_:withSender:)` to add Highlight, Note and Share items natively, or hide the system items and show the React menu. Share-quote-as-image: render the card to `<canvas>` in Web, then hand the PNG to `UIActivityViewController` (*Native*). Offer Substack-style background color and alignment choices.
9. **Read time and progress** — Web. Medium's formula: words / 265 WPM plus an image allowance; CJK characters / 500 per minute. Put "N min left in chapter" in the page footer, and drive TOC scroll spy (`aria-current="location"`), as Medium's 2026 TOC does, so the TOC drawer opens on the current section.
10. **End-of-document card** — Web. Neither product leaves a dead end: show "Next chapter / next file", "Mark as finished", an annotation count with a link to the notes list, and "Back to library". Fade the last lines only when there is a real boundary (Medium's paywall fade is the visual reference).
11. **TTS with a mini player** — *Native*. Both apps use: Listen button in the header → mini player docked at the bottom → tap to expand to full screen (speed "1X", voice, share, sleep timer, queue). Background playback, lock-screen controls and the Now Playing card need `AVSpeechSynthesizer` or `AVAudioSession`, plus `MPNowPlayingInfoCenter` and `MPRemoteCommandCenter`. Web Speech in WKWebView stops when the app is in the background. The mini-player UI itself can be Web if the native side posts progress events. Sentence highlighting synced to speech is a Pager differentiator (neither app documents it).
12. **Haptics** — *Native*. `navigator.vibrate` is unavailable in iOS WebKit. Bridge to `UIImpactFeedbackGenerator` / `UISelectionFeedbackGenerator` for: highlight created, page-turn snap at a chapter end, a hold-to-repeat "clap"-like control if any, and long-press menus.
13. **Dark mode** — Web, plus one Native detail. Use `prefers-color-scheme` with a manual override. Use near-black `#171717` with `#E5E5E5` text, not `#000`/`#fff`. Natively, set the WKWebView `isOpaque = false`, `backgroundColor` and `underPageBackgroundColor` to the theme color to avoid a white flash on launch and on overscroll. Keep `<meta name="theme-color">` in sync.
14. **Loading** — Web. Use a shimmer skeleton (`linear-gradient(90deg,#d6d6d6 8%,#a8a8a8 18%,#d6d6d6 33%)` at 1200 px, 2.2 s linear, toned down for dark mode) for the library and book open. Use `decoding="async"`, intrinsic `width`/`height` to prevent layout shift, and a short opacity fade on image load. Substack relies on progressive JPEGs instead.
15. **Transitions and swipe-back** — *Native*. Open a book with a NavigationStack push, which gives the interactive edge swipe-back for free. For in-book link history, `allowsBackForwardNavigationGestures` on WKWebView or a JS history stack. A pull-down-to-dismiss sheet for the reader would also be native (SwiftUI `.fullScreenCover` with a drag gesture). None of these behaviors could be confirmed for Substack or Medium.
16. **Zoom policy** — Web. Substack disables pinch zoom (`maximum-scale=1, user-scalable=0`) because text size is a reader setting. Pager can do the same in paginated mode, but should allow image zoom via a tap-to-lightbox, as Medium does with "click to view image in full size" and a `transform .3s cubic-bezier(.2,0,.2,1)` zoom.
