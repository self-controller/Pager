# Build: the iOS Liquid Glass tab bar in the iPhone app

## Branch and starting point
- Work on a new branch `ios-native-tab-bar`, cut from `main`. Commit once per phase. Leave
  merging and pushing to the user.
- Start from a clean tree. On 2026-11-08 `main` had uncommitted work from other sessions:
  - the frosted CSS pill in `BottomTabBar.tsx` and `globals.css`;
  - the phone header safe area in `Page.tsx` and `tokens.css`;
  - the no-zoom viewport in `index.html`;
  - Context changes in `src/tools/context/` and `AssistantPage.tsx`.

  If `git status` is not clean, stop and ask the user to commit that work, or to tell you what
  to do with it. Never discard it or revert it. This plan builds on the CSS pill: it stays as the
  browser's tab bar.
- Baseline before you change anything: `npm test`, `npm run typecheck`, and
  `./ios/build-web.sh && (cd ios && xtool dev build)` all pass. The toolchain is installed on this
  PC (Swift 6.4.2, xtool, iOS SDK 27.2 at `~/.swiftpm/swift-sdks/darwin.artifactbundle`). The phone
  is the user's: only they can run `xtool dev` to install, and there is no iOS Simulator on Linux.

## Goal
In the iPhone app, the four main tabs (Library, Highlights, Assistant, Settings) use the system
tab bar. On iOS 26 and later that is the real Liquid Glass bar: the floating capsule, the lens
bubble that slides between tabs, the press-and-drag between tabs, light/dark adaptation, the soft
scroll-edge blur, and VoiceOver's tab semantics, all for free. The web UI stays one page in one
web view. The web pill is not shown in the app. In a browser or the Home Screen PWA nothing
changes.

## Decisions made by the user (2026-11-08)
1. **The system tab bar.** Use a UIKit `UITabBarController` around the one web view. Do not use a
   custom glass pill, and do not keep only the CSS pill in the app.
2. **Labels, black and white.** Each tab shows its icon with a label under it. The current tab is
   drawn in `--fg-primary` (#111111 light, #E5E5E5 dark). The other tabs are drawn in
   `--fg-secondary` (#616161 / #A3A3A3). Do not use ink blue: DESIGN.md keeps the accent for links
   and buttons.
3. **Tabs remember where you left them** (the iOS convention). Coming back to a tab opens its last
   page at its last scroll. A tap on the tab that is already selected goes to that tab's top page.
   A second tap scrolls that page to the top.
4. **The bar stays full size.** Set `tabBarMinimizeBehavior = .never`. In a book the bar still hides
   and shows with the reader's chrome, as the web bar does today.

Any other design choice you meet (timing, a colour, behaviour at an edge case): do not decide it
silently. List it in your report with a recommendation.

## What the research found
- **Real Liquid Glass is native only.** In CSS, glass means `backdrop-filter: blur() saturate()`
  plus highlights, which is what the CSS pill does. The refraction look needs
  `backdrop-filter: url(#svg-displacement)`. WebKit parses that and renders nothing, and
  `@supports` reports it as supported (WebKit bug 245510). So no CSS route reaches the native look
  in WKWebView.
- **Only `UITabBarController` (or SwiftUI `TabView`) gets the full system bar.**
  - A standalone `UITabBar` gets no scroll-edge blur. Apple's engineer says the controller
    configures the scroll views under it, and a custom bar needs
    `UIScrollEdgeElementContainerInteraction` set up by hand.
  - A standalone bar also has no minimize, no `setTabBarHidden`, and no `contentLayoutGuide`.
  - A tab bar built with JavaScript keeps its web look under the iOS 27 SDK.
- **SwiftUI `TabView` is the wrong fit.** Each tab owns its own content view, and one
  `UIViewRepresentable` can't be shown in four tabs. Four web views would mean four page loads,
  four live-update streams and four times the memory.
- **The SDK on this PC has everything** (iPhoneOS27.2.sdk headers, checked):
  - `UITabBarController.tabBarMinimizeBehavior`, `contentLayoutGuide` and `bottomAccessory`
    (iOS 26), and `prominentTabIdentifier` (iOS 27).
  - `setTabBarHidden(_:animated:)` (iOS 18).
  - `UIScrollView.bottomEdgeEffect` (iOS 26).
  - `UIGlassEffect` (iOS 26).
  - `WKWebView.obscuredContentInsets` (iOS 26).
- **`UIDesignRequiresCompatibility` is ignored with the iOS 27 SDK.** The app's system UI (sheets,
  the edit menu) is already Liquid Glass on iOS 26+.
- **Older iOS.** The package's floor is iOS 17.5 (IrohLib). There the same code shows the classic
  translucent bar. That is fine.
- **Don't put a background on the bar.** Apple: "Remove any background customization … Using
  `UIBarAppearance` or `backgroundColor` interferes with the glass appearance." Only tint colours.

## How it fits together

```
RootView (SwiftUI)
└─ PagerTabs: UIViewControllerRepresentable      (replaces the WebView representable)
   └─ TabsController: UITabBarController          (owns the one PagerWebView)
      ├─ TabPage(.library)    ─┐
      ├─ TabPage(.highlights)  │ empty, clear view controllers; the web view is moved
      ├─ TabPage(.assistant)   │ into whichever one is about to appear (viewWillAppear),
      └─ TabPage(.settings)   ─┘ pinned to its edges, under the floating bar
```

- **The page owns which tab it is in.** Opening a book from Highlights keeps Highlights selected.
  The app only shows the selection and reports taps.
- **The page keeps laying itself out** (`viewport-fit=cover`, `contentInsetAdjustmentBehavior =
  .never`). It reserves the bar's space with the same CSS variables as today. Only the number comes
  from the app.

### The bridge (additions to `src/lib/native.ts` and `PagerWebView.swift`)

**Page → app**, on `window.webkit.messageHandlers.pager`:

| Message | When | What the app does |
|---|---|---|
| `{t: "tabs", tab: "library" \| "highlights" \| "assistant" \| "settings" \| null, hidden: boolean}` | AppShell sends it whenever either field changes, deduplicated like `setNativeMenuItems`. When AppShell unmounts (the pairing page) it sends `{tab: null, hidden: true}` | Selects `tab` with `selectedIndex` (`null` keeps the current selection), then shows or hides the bar, animated |
| `{t: "theme", background, scheme: "light" \| "dark"}` | As today, plus `scheme` (the resolved `data-theme`) | Sets `overrideUserInterfaceStyle` on the tab controller, so the bar matches the page's theme even when it differs from the phone's |

`hidden` is true while `<html data-reader-chrome="hidden">` is set. That covers both Pages (the
centre tap) and Scroll (the chrome follows the scroll). Watch the attribute with a
MutationObserver, as `startNativeShell` watches `data-theme`.

**App → page**, on `window.__pager`, next to the existing `menu`:

| Call | When | What the page does |
|---|---|---|
| `__pager.tab("highlights")` | The person tapped a tab, including the one already selected (`tabBarController(_:didSelect:)` is called for both) | The tab-memory rules below |
| `__pager.tabBar(83)` | After each `tabs` message, if the value is new for this page load, and whenever it changes (rotation). The value is the distance in points from the top of the bar to the bottom of the screen | Sets `--native-tab-bar` to `max(0, value − env(safe-area-inset-bottom))` px. Measure the env value with a fixed probe element. The CSS adds the env inset itself, as it does today |

Swift calls only `window.__pager?.tab?.("<rawValue>")` with names from its own enum, so nothing
outside reaches the script. This is the same rule as `menu`.

## Phase 1: the page side (TypeScript, fully testable here)

1. **`src/components/shell/nav.ts`.** Add `tab: NativeTab` to the four mobile entries: `library`,
   `highlights`, `assistant`, `settings`. Export the order. The Swift enum mirrors it, with a
   comment on both sides.
2. **`src/lib/native.ts`.**
   - Add the `tabs` message and the `NativeTab` type.
   - Add `scheme` to `theme`.
   - Add `onNativeTab(handler)` and `onNativeTabBar(handler)`, which register `__pager.tab` and
     `__pager.tabBar` the way `onNativeMenu` registers `menu`.
   - In `startNativeShell()`, set `data-native-tabs` on `<html>`. It runs before the first render.
3. **Tab memory: `src/components/shell/tabMemory.ts`.** Pure logic, no React.
   - The state is the current tab, plus each tab's last location (pathname + search + hash) and
     its `scrollY`.
   - On a location change:
     - A tab's root (`/`, `/highlights`, `/assistant`, `/settings`) makes that tab current.
     - Any other path (a book, a 404) belongs to the current tab.
     - Record the location as the current tab's last.
   - On `select(tab)`, for another tab:
     - Save `window.scrollY` for the current tab.
     - Navigate to the other tab's last location, or its root if it has none. Pass
       `state: { tabSwitch: true }`.
     - Then restore that tab's saved `scrollY`, or 0 if none. Restore it after the new page
       renders (two animation frames), and scroll as far as the page allows. Nothing restores
       scroll today: without this, one tab's scroll would leak into the next.
   - On `select(tab)` for the same tab:
     - Away from its root: navigate to the root and go to the top.
     - At its root: scroll to the top. Make it smooth, or instant under
       `prefers-reduced-motion`.
   - Memory lasts for the page's life only. A cold start opens Library.
   - Tab switches push a history entry, as `NavLink` does today. Don't redesign the back swipe;
     note how it behaves in your report.
4. **`useNativeTabs()` in `AppShell`.** Runs only when `isNativeApp()`. It does four things:
   - feeds the location to tab memory;
   - posts `tabs` (the current tab, and `hidden` from `data-reader-chrome`);
   - registers the two `__pager` handlers;
   - on unmount, posts `{tab: null, hidden: true}`.
5. **A book reopened by a tab switch starts with its chrome showing.** Do this in
   `useReaderChrome`, when `location.state?.tabSwitch` is set. Otherwise a tap on Library would
   reopen the book and hide the bar at once, since touch screens open books with the chrome hidden.
6. **Hide the web navigation in the app.**
   - `BottomTabBar` and `SideNav` return `null` when `isNativeApp()`. The CSS pill stays for
     browsers.
   - Under `:root[data-native-tabs]`, at all widths (an iPhone in landscape can be wider than
     767px, where the side nav would appear):
     - `--size-bottom-nav: var(--native-tab-bar, 56px)`;
     - `--size-bottom-nav-effective: var(--size-bottom-nav)`;
     - `--size-left-nav: 0px`.
   - Make sure the `md:pb-0` on AppShell's `<main>` and the `md:bottom-6` on `Toast` don't remove
     the bar's space in the app.
7. **`ContextPanel.tsx`.** Replace the hard-coded `PHONE_TAB_BAR = 56` with the computed
   `--size-bottom-nav`.
8. **Tests (vitest).**
   - `test/native.test.ts`:
     - the `tabs` messages, deduplicated;
     - `__pager.tab` and `__pager.tabBar` registration and clean-up;
     - `scheme` in `theme`.
   - New `test/tab-memory.test.ts`:
     - root and non-root locations;
     - a switch remembers location and scroll;
     - a reselect goes to the root, then to the top;
     - a switch passes `tabSwitch`.
   - A test that the mobile NAV `tab` order is exactly `library, highlights, assistant,
     settings`.

Exit: `npm test`, `npm run typecheck` and `./ios/build-web.sh` pass, and the browser looks
unchanged (spot-check the phone width in Chromium, see the `ui-browser-checks` notes). Commit.

## Phase 2: the app side (Swift, checked with `xtool dev build`)

1. **`Sources/Pager/TabsController.swift`** (new).
   - `enum PagerTab: String, CaseIterable` holds `library, highlights, assistant, settings`. Each
     case has a title and SF Symbols:
     - Library: `books.vertical`, selected `books.vertical.fill`;
     - Highlights: `highlighter`;
     - Assistant: `sparkles`;
     - Settings: `gearshape`, selected `gearshape.fill`.

     Check each name with `UIImage(systemName:)` (it returns nil for a bad name). Use an
     `assertionFailure` in debug builds.
   - `TabPage: UIViewController`: one per tab, with a clear background and
     `tabBarItem = UITabBarItem(title:image:selectedImage:)`. Use the classic `viewControllers` API,
     not `UITab`, which needs iOS 18. The floor is 17.5.
   - `TabsController: UITabBarController, UITabBarControllerDelegate` owns the `PagerWebView`. In
     `TabPage.viewWillAppear`, move the web view into the page's view if it isn't there yet:
     - pin it to the view's edges, not to its safe area;
     - call `page.setContentScrollView(webView.scrollView, for: .bottom)`.

     Moving a WKWebView keeps its page and its state.
   - **Tint only.** Set `tabBar.tintColor` to the dynamic `--fg-primary` and
     `tabBar.unselectedItemTintColor` to the dynamic `--fg-secondary`, with the hex values above.
     No `UITabBarAppearance`, no `backgroundColor`.
   - On iOS 26 and later, set `tabBarMinimizeBehavior = .never`.
   - In `didSelect`, call `__pager.tab(<tab>)`.
   - A `tabs` message does two things:
     - It sets `selectedIndex`. A change made in code doesn't call the delegate, so there is no
       loop.
     - It calls `setTabBarHidden(hidden, animated: true)` on iOS 18 and later, or sets
       `tabBar.isHidden` on 17.x.
   - Before any message: if the start URL is `/pair`, the bar is hidden. Otherwise it shows, with
     Library selected. A normal cold start then has no pop-in.
   - **Footprint.** In `viewDidLayoutSubviews`, while the bar shows, compute:
     - on iOS 26 and later: `view.bounds.maxY - contentLayoutGuide.layoutFrame.maxY`;
     - before iOS 26: `view.bounds.maxY - tabBar.frame.minY`.

     Send it with `__pager.tabBar` as described in the bridge. While the bar is hidden, keep the
     last value: the page keeps the bar's space on purpose (the reader never reflows).
   - **Theme.** Set `overrideUserInterfaceStyle` from the `theme` message's `scheme`. At a cold
     start, derive it from the stored page colour's luminance (`Store.pageColor`). No new Store key.
2. **`PagerWebView.swift`.**
   - Parse `tabs` and pass it on through a callback that the controller sets. Add `scheme` to
     `theme`.
   - `pageLoaded()` also resets the last footprint sent.
   - **Pin the page's safe area to the screen's:**
     `override var safeAreaInsets: UIEdgeInsets { window?.safeAreaInsets ?? super.safeAreaInsets }`.
     Inside a tab bar controller, the web view's own safe area grows by the bar and shrinks when
     the bar hides. WebKit feeds that into `env(safe-area-inset-bottom)`, so without this override
     every chrome toggle in the reader would change the page box and repaginate. Phase 3 checks
     that WebKit honours the override.
3. **`WebView.swift` and `PagerApp.swift`.**
   - Replace the `WebView` `UIViewRepresentable` with `PagerTabs`, a `UIViewControllerRepresentable`
     that makes the `TabsController` once.
   - Keep all of today's web view setup in one function both can use: the scheme handler, the
     navigation policy coordinator, no link previews, the edge-swipe back, the two-finger
     triple-tap, and `start`/`reload`.
   - Recreating the controller while a full-screen modal covers it breaks the glass rendering
     (Apple forums 824566). Make it once.
4. **`DiagnosticsView.swift`.** Add a Layout section for the device check:
   - the iOS version;
   - the footprint;
   - the web view's real `super.safeAreaInsets.bottom` and the window's;
   - the page's measured `env(safe-area-inset-bottom)` and computed `--size-bottom-nav`, read
     with `evaluateJavaScript`;
   - all of these with the bar shown and with it hidden.
5. **`ios/README.md`.** Add `TabsController.swift` to the file table and the new messages and calls
   to the bridge table. Add the Phase 3 checks to "Check it".

Exit: `./ios/build-web.sh && (cd ios && xtool dev build)` compiles with no new warnings. Commit, then
hand the user the Phase 3 checklist.

## Phase 3: the device check (the user runs it), then the fixes
The user installs with `cd ios && xtool dev` and checks the list below on iOS 26 or later, in
light and dark. Ask for screenshots of Diagnostics → Layout and of anything that looks wrong.

- [ ] Library: the glass capsule floats over the list, the list shows through blurred as it
      scrolls, and the last item can be scrolled clear of the bar.
- [ ] Labels under the icons. The current tab is black (light) or white (dark).
- [ ] Set the page theme to dark while the phone is in light mode: the bar is dark too.
- [ ] Highlights → scroll down → Library → Highlights: same place.
- [ ] Open a book from Highlights: Highlights stays selected. Library, then Highlights: the book
      reopens with its bar showing.
- [ ] Tap the current tab: its top page. Tap again: it scrolls to the top.
- [ ] In a book, Pages: a centre tap hides and shows the bar, and the page and its text do not move
      or repaginate. Scroll: the bar follows the scroll, with the footer riding down with it.
- [ ] Diagnostics → Layout: `env(safe-area-inset-bottom)` is the same (34 on Face ID iPhones)
      with the bar shown and hidden.
- [ ] A toast sits above the bar. The pairing page has no bar.
- [ ] Landscape: no web side nav, the bar at the bottom, nothing important under it.
- [ ] VoiceOver reads four tabs and which one is selected. Reduce Transparency makes the bar
      frosted (the system does this).
- [ ] The edge swipe back still works in the library and is still off in a book.

Then fix what the user reports, using the fallbacks below. Commit.

## Phase 4: docs
- **DESIGN.md.** Update the "Mobile bar" row and the Chrome paragraph: in the app, the bar is the
  system tab bar with labels, tabs remember their place, and the bar stays full size. In browsers
  it is the frosted pill.
- **CONTRACT.md.** Update "On a phone", and any mention of the tab bar there.
- Write a short Progress note at the end of this file. Commit.

## Risks, and what to do
| If… | Then |
|---|---|
| A tab switch flashes blank or shows the old page for a frame | Move the web view in `tabBarController(_:shouldSelect:)`, before the transition starts. If it still flashes, ask the user before trying the last resort: the web view sits behind the tab pages in the controller's view, and the pages are clear and let touches through. |
| `env(safe-area-inset-bottom)` still changes when the bar hides (WebKit ignores the override) | Cancel the bar on `TabPage` with a negative `additionalSafeAreaInsets.bottom`, recomputed in `viewSafeAreaInsetsDidChange`. Report it. |
| The soft scroll-edge blur smears the reader's footer or text | Set `webView.scrollView.bottomEdgeEffect.isHidden` (iOS 26) while the reader is open, from the existing `reader` message. Send the user before and after screenshots. |
| The glass keeps the last tab's light/dark until you scroll (Apple forums 834761) | `overrideUserInterfaceStyle` from the page theme should cover it. Report it if it is still seen. |
| The bar's hide animation and the reader's CSS (250 ms) visibly disagree | Report it with a recommendation. Don't retime the reader on your own. |

## Don'ts
- No `UITabBarAppearance` backgrounds, shadows or `backgroundColor` on the bar.
- No `WKWebView.obscuredContentInsets`. It shrinks the layout viewport, which changes `100dvh` and
  the reader's page box, and Scroll could no longer run under the bar.
- No SwiftUI `TabView`, no second web view, no standalone `UITabBar`.
- No `bottomAccessory` or search tab in this round. They are good later ideas: "Continue reading"
  as an accessory, a search tab for the library. Mention them, don't build them.
- Don't remove or restyle the CSS pill. Don't change the server or the API: no new routes.

## Done when
- Phases 1–2 are committed on `ios-native-tab-bar`, the tests, the typecheck and
  `xtool dev build` pass, and the browser is unchanged.
- The user's Phase 3 list passes on their phone.
- The docs are updated, and the report lists the open design questions with recommendations.

## Sources
- Apple, WWDC25 "Build a UIKit app with the new design": https://developer.apple.com/videos/play/wwdc2025/284/
- Apple forums: a standalone UITabBar gets no scroll-edge blur: https://developer.apple.com/forums/thread/791643
- Apple forums: glass not updating on a tab switch: https://developer.apple.com/forums/thread/834761
- Apple forums: glass breaks when the controller is recreated under a modal: https://developer.apple.com/forums/thread/824566
- Donny Wals, tab bars on iOS 26: https://www.donnywals.com/exploring-tab-bars-on-ios-26-with-liquid-glass/
- `UIDesignRequiresCompatibility` ignored with the iOS 27 SDK: https://github.com/Orange-OpenSource/ouds-ios/discussions/1556
- WebKit bug 245510, `backdrop-filter: url()`: https://bugs.webkit.org/show_bug.cgi?id=245510
- Liquid glass on the web, the Safari limits: https://dev.to/devyatov/liquid-glass-on-the-web-6-ways-to-build-it-with-css-and-svg-3m07
- Headers checked: `UITabBarController.h`, `UIGlassEffect.h`, `UIScrollView.h`,
  `UIScrollEdgeElementContainerInteraction.h`, `WKWebView.h` in the local iPhoneOS27.2.sdk

## Progress (2026-11-09)

Phases 1 and 2 (the page's side of the tab bar and the system tab bar around the one web view) and
the native Book tab were built earlier and are committed on this branch.

This round answered four findings from the user's iPhone. First, the app's binary is now stamped
SDK 27.2: a linker flag in `ios/Package.swift` replaces the Linux link's stamp of 17.5, so iOS 26
draws the Liquid Glass tab bar instead of the flat compatibility bar. Diagnostics → Layout shows the
stamp ("Built for SDK"). Second, on phones (below 768px, and in the app at every width) every
dialog, popover and context menu is a bottom sheet (`src/components/ui/Sheet.tsx`). Contents and
Tools are tall, the rest fit their content, and a sheet closes with a swipe down on its grip, the
close button, Esc or the scrim. Third, while a sheet is open `<html data-sheet-open>` holds the page
still and hides the tab bar, the app's included through `tabs.hidden`; with the sheet's single scroller,
this is meant to stop the jump when the Contents list is dragged. Fourth, tab
switches in the app crossfade for 200 ms, as the browser's do for 150 ms.

The tests, the typecheck, the web build and `xtool dev build` pass, and the binary reads `sdk 27.2`,
`minos 17.5`. An automated web check was tried and dropped, because it cannot see the iOS app.

Still open: the device run. Phase 3 is the user's, with the lists in ios/README.md under "Check it"
(the earlier list and the new one for the glass bar and the sheets). Nothing in this round has run
on a phone yet, so the glass bar, the Contents drag and the sheets over the keyboard are unconfirmed.
