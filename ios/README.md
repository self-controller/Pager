# Pager for iPhone

A SwiftUI app around the Pager web UI. It bundles the UI and serves it on `pager-app://localhost/`.
Its scheme handler carries the UI's `/api` requests to your computer as `pager/1` over iroh (API.md,
"Phones over iroh"). The phone's iroh key and its token stay in the Keychain; the web page never sees
the token.

It's built on Linux with [xtool](https://github.com/xtool-org/xtool) and
[IrohLib](https://github.com/n0-computer/iroh-ffi) 1.2.0 (iOS 17.5 or later).

| File | What it does |
|---|---|
| `Sources/Pager/PagerApp.swift` | The app, the `pager://pair` links the Camera opens, and closing the connection in the background |
| `Sources/Pager/SchemeHandler.swift` | Serves the bundled UI; `/api` over iroh; takes the token out of the pairing answer |
| `Sources/Pager/IrohClient.swift` | The endpoint (the key from the Keychain), dialling the saved ticket, the relay and token from health |
| `Sources/Pager/Frame.swift` | `pager/1` framing (mirrors `server/src/remote/protocol.rs`) |
| `Sources/Pager/Store.swift` | The ticket and the last page colour in UserDefaults; the key, the token and the relay token in the Keychain |
| `Sources/Pager/WebView.swift` | `PagerTabs`, the tab bar in SwiftUI, made once; the web view's setup: it loads only `pager-app:` (other links open in Safari), doesn't rubber-band, and has no link previews |
| `Sources/Pager/TabsController.swift` | The system tab bar (Liquid Glass on iOS 26 and later) around the one web view, which moves into the tab about to show; the bar's footprint for the page; the Layout diagnostics |
| `Sources/Pager/PagerWebView.swift` | The WKWebView subclass: the page's messages, haptics, the page colour, Highlight and Note in the text menu, and the page's safe area pinned to the screen's |
| `Sources/Pager/FirstRunView.swift`, `DiagnosticsView.swift` | Before pairing; the IDs, the path, and a timed download |

### The bridge to the page

The page posts to `window.webkit.messageHandlers.pager` (`src/lib/native.ts`). The app takes these
from its own page only (the main frame on `pager-app:`) and ignores anything else:

| Message | What the app does |
|---|---|
| `{t: "haptic.prepare", kind}` | Readies the generator for `kind`: `selection`, `light`, `soft`, `success` or `error` |
| `{t: "haptic.fire", kind}` | Plays it. The page spaces haptics 75 ms apart and skips them when Settings → Haptics is off |
| `{t: "theme", background: "#rrggbb", scheme}` | Paints the web view and its edges that colour, and keeps it for the next cold start. `scheme` (`light` or `dark`, the page's theme) sets the tab bar's style, so the bar matches the page even against the phone's setting |
| `{t: "reader", open}` | While the reader is open: the edge swipe back is off, so the page gets edge swipes, and the app does not bounce |
| `{t: "selection", items, colors}` | Which of `highlight`, `note` and `reattach` the text menu adds; `[]` outside the reader's text. `colors` are the highlight colours in menu order, the last-used first (`yellow`, `green`, `blue`, `pink`, `purple`; any other name is dropped): with them Highlight is a submenu of colours, without them one action in the last-used colour |
| `{t: "tabs", tab, hidden}` | Selects `tab` (`library`, `book`, `highlights`, `assistant` or `settings`; `null` keeps the selection), then shows or hides the bar, animated. The page sends it when either changes; any open book is `book`; `hidden` follows the reader's chrome and any open sheet (on phones the Contents and Tools panels, the type settings, the library menus and every dialog are bottom sheets, `src/components/ui/Sheet.tsx`, which mark `<html data-sheet-open>`; the type settings are a non-modal tray, marked `data-sheet-open="tray"`, and hide the bar too), and the pairing page sends `{tab: null, hidden: true}` |

The text menu keeps the system's Copy, Look Up, Translate and Share, with Pager's items first.
**Highlight** opens a submenu of the five colours, each with a dot in Pager's swatch colour, the
last-used colour first. Choosing a colour calls `window.__pager.menu("highlight", "green")`; Note and
Reattach Here call `window.__pager.menu("note")` and `("reattach")`. The reader handles them
(`src/components/reader/useNativeMenu.ts`): a highlight is made in the colour named, which becomes the
last-used colour, and the page sends the new order. Only the app's own item and colour names go into
the script. In the app the reader doesn't show its own floating selection bar. A new page load turns
the swipe back on and clears the items and colours.

The app calls the page on `window.__pager`, with names from its own code only:

| Call | When | What the page does |
|---|---|---|
| `__pager.menu("highlight", "green")`, `__pager.menu("note")` | One of Pager's items in the text menu was chosen; for Highlight, with the colour picked | Runs it on the selection. A highlight with no colour named is made in the last-used colour |
| `__pager.tab("highlights")` | A tab was tapped, the selected one included | Tab memory (`src/components/shell/tabMemory.ts`): another tab opens at its last page and scroll; the current tab goes to its top page, then scrolls to the top. Book opens the book read last at its saved place (the library before any book), and does nothing when tapped in the book |
| `__pager.tabBar(83)` | After the page's first `tabs` message of a page load, and whenever the bar's footprint changes (a rotation) | Keeps the bar's space: `--native-tab-bar` is the footprint less `env(safe-area-inset-bottom)` |

The footprint is the distance in points from the top of the bar to the bottom of the screen. The page
keeps it while the bar hides, so the reader never reflows. In the app the page draws no tab bar or
side nav of its own (`data-native-tabs` on `<html>`).

The bar looks new only because of how the binary is stamped. iOS 26 draws the new design for a binary
built against SDK 26 or later, and keeps anything older in compatibility mode: a flat, full-width bar.
A Linux build stamps the deployment target (17.5) as the SDK, so `Package.swift` passes the linker
the real one (27.2). With that stamp the bar is the floating glass capsule, and its scroll-edge blur
covers the web view's scroll view, which `setContentScrollView(for: .bottom)` already wires up. The
SwiftUI Diagnostics sheet takes the new look too. **Diagnostics → Layout → Built for SDK** shows the
stamp.

## 1. Tools, once

None of these needs `sudo`, unless a step below says so.

1. **Swift 6.4**, with [swiftly](https://www.swift.org/install/linux/):

   ```sh
   curl -O "https://download.swift.org/swiftly/linux/swiftly-$(uname -m).tar.gz"
   tar zxf "swiftly-$(uname -m).tar.gz" && ./swiftly init --quiet-shell-followup
   . "${SWIFTLY_HOME_DIR:-$HOME/.local/share/swiftly}/env.sh"   # fish: env.fish
   swift --version                                               # Swift version 6.4.1 (or later 6.4)
   ```

   If swiftly lists system packages it needs, install them with the `sudo dnf install …` line it
   prints.

2. **xtool**, into `~/.local/bin`:

   ```sh
   curl -fL "https://github.com/xtool-org/xtool/releases/latest/download/xtool-$(uname -m).AppImage" -o ~/.local/bin/xtool
   chmod +x ~/.local/bin/xtool
   xtool --help
   ```

   If it says it can't mount (no FUSE 2), either install `fuse-libs` with dnf, or run it as
   `xtool --appimage-extract-and-run …`.

3. **usbmuxd**, which lets xtool reach the phone over USB. It's already installed on this PC
   (`rpm -q usbmuxd`).

4. **Xcode 27.2** (the SDK the app is stamped with; `Package.swift` names it): download
   `Xcode_27.2.xip` from <https://developer.apple.com/download/all/?q=Xcode>
   in your browser, signed in with your Apple ID. Only its iOS SDK is used; xtool doesn't run Xcode.

5. **`xtool setup`**. It asks how to sign in:
   - **API Key** if you pay for the Apple Developer Program ($99/year): an App Store Connect Team Key
     with the App Manager role. Apps stay installed for a year.
   - **Password** with any Apple ID (Apple's private sign-in API; a separate Apple ID is the careful
     choice). Apps stop opening after 7 days until you install them again.

   It then asks for the path to the `.xip`, and builds an iOS SDK from it. Check with `swift sdk list`
   (it lists `darwin`).

6. **The phone.** Connect it with a cable, unlock it, and choose **Trust** on it. Turn on
   **Settings → Privacy & Security → Developer Mode** (the phone restarts).

## 2. Build

```sh
cd ~/Desktop/projects/Pager
./ios/build-web.sh          # the web UI, into Sources/Pager/Resources/web (again after UI changes)
cd ios
xtool dev build             # compile only: no phone, no sign-in needed
xtool dev                   # build, sign, install on the phone over USB, and launch
```

The first build fetches IrohLib's xcframework (a 38 MB download) from GitHub. If Apple refuses the
bundle ID `dev.pager.Pager` as taken, change `bundleID` in `xtool.yml` to one of your own, such as
`com.<yourname>.pager`.

With a free Apple ID, the phone asks you to trust the developer the first time: **Settings →
General → VPN & Device Management**, then your Apple ID, then **Trust**.

## 3. Pair

1. On the computer, turn on **Settings → Phone → Remote access** and choose **Pair a phone**.
2. On the phone, scan the QR code with the Camera and tap the Pager banner. The app opens on
   **Pair this phone** with the code filled in. (Or paste the link shown under the QR code on the
   app's first screen.)
3. Choose **Pair**, then **Allow** on the computer. The library opens.

The app may ask to find devices on your local network. Allow it to connect straight to the computer
on the same Wi-Fi. Without it, Pager still works, through the relay.

## 4. Check it

**Diagnostics** is on the first screen; once paired, tap three times with two fingers. It shows the
phone's and the computer's IDs, the relay, whether the connection is direct or through the relay,
the round trip, and the last error. **Time a download** fetches your largest book the way reading it
does, and gives MB/s.

Try each of these, and note what Diagnostics says:
- reading at home on Wi-Fi (direct), and on cellular with Wi-Fi off (through the relay);
- a highlight made on the phone shows on the computer, and a change on the computer shows on the
  phone without reloading (the live stream);
- **Revoke** on the computer sends the phone to **Pair this phone** at once;
- selecting words in a book shows the system menu with **Highlight** and **Note** first; Highlight
  opens the five colours, and choosing one highlights with a soft tap;
- in a book, a swipe in from the left edge doesn't go back; in the library it does;
- after switching to the dark theme and reopening the app, its first frame is already dark.

**The tab bar**, on iOS 26 or later, in light and in dark. Take screenshots of **Diagnostics → Layout**
and of anything that looks wrong:
- Library: the glass capsule floats over the list, the list shows through blurred as it scrolls,
  and the last item can be scrolled clear of the bar;
- labels under the icons; the current tab is black (light) or white (dark);
- set the page theme to dark while the phone is in light mode: the bar is dark too;
- Highlights → scroll down → Library → Highlights: the same place;
- open a book from Highlights: Book is selected. Highlights: its list, where you left it. Book: the
  book reopens at your place, with its bar showing. Tapping Book in the book does nothing;
- five tabs fit, with labels: Library, Book, Highlights, Assistant, Settings; no "More";
- switching tabs crossfades for 100 ms (iOS 18 and later; a cut on 17.5);
- tap the current tab: its top page. Tap again: it scrolls to the top;
- in a book, Pages: a centre tap hides and shows the bar, and the page and its text don't move or
  repaginate. Scroll: the bar follows the scroll, with the footer riding down with it;
- Diagnostics → Layout: `env(bottom)` is the same (34 on Face ID iPhones) with the bar shown and
  hidden (show and hide it in a book, then open Diagnostics);
- a toast sits above the bar; the pairing page has no bar;
- landscape: no web side nav, the bar at the bottom, nothing important under it;
- VoiceOver reads five tabs and which one is selected; Reduce Transparency makes the bar frosted;
- the edge swipe back still works in the library and is still off in a book.

### Check it: the glass bar and the sheets

1. Diagnostics → Layout shows **Built for SDK 27.2**.
2. Library: a floating glass capsule; the list blurs through it while scrolling; the selection bubble
   animates between tabs; the current tab is black (light) or white (dark).
3. Highlights → Library: a short crossfade, with no flash of the wrong scroll.
4. A book: Contents rises from the bottom with the dimmed strip above it. Drag the list starting on a
   chapter row: no jump. A tap jumps to the chapter. A swipe down on the grip closes it. The bar is
   gone while it's open and slides back when it closes.
5. The same in the Scroll layout. After opening, scrolling and closing Contents, the chapter hasn't
   moved and the chrome didn't hide.
6. AA opens as a tray: no dimming, the text changes above it as you tap, and a tap on the text closes
   it without hiding the bars. Tools opens as a tall sheet, and its own header closes it.
7. Library: long-press a book, the menu sheet opens, floating clear of the screen's edges, with the
   book's title and its author under it and **Delete…** last, in red. Choose **Rename…**: the rename
   sheet sits above the keyboard.
8. Landscape with a sheet open: nothing is under the home indicator.
9. With Reduce Motion on, sheets fade in and out and nothing slides; tab switches are instant.
10. Diagnostics → Layout: `env(safe-area-inset-bottom)` is the same with the bar shown and hidden.

### Check it: taps, the chapter swipe, the bars and the slides

None of this has run on a phone yet; it was measured in Chromium at 390 × 844.

1. A book in the Scroll layout: a tap in the middle of the page hides the bars, and another shows
   them. Before this round a tap did nothing.
2. Drag sideways: the next chapter follows the finger and opens at its top. Drag the other way: the
   previous chapter opens at its end. A flick does the same.
3. The Pages layout: a tap at the right edge turns the page, and a tap on a highlight opens it.
4. The text sits 24 pt from the screen's edges. The ‹ › circles are filled grey, with no ring or
   shadow, and their outer edges line up with the text. Look at them in dark too: the grey is close
   to the page there.
5. Scroll down: the bars hide. Scroll on to the end of the chapter: they come back and stay.
6. The chapter's name in the top bar is a pill. Tap it: Contents opens on the current chapter. There
   is no separate Contents icon.
7. Library → tap a book: it slides in from the right while the list moves a little left (iOS 18 and
   later; a cut on 17.5). **Back** slides it out again. The tab bar stays where it is.
8. Remove a highlight on the Highlights page: a toast rises with **Undo**, and Undo brings it back.
9. The floating sheets (a book's menu, Rename, the AA tray): their corners sit well inside the
   screen's own corners, and nothing in them is cut by a corner. Under the AA tray a strip of the
   page shows in the gap below it: say if that looks wrong.
10. Contents and Tools stay attached to the bottom edge, with rounder top corners than before.

### Check it: highlight colours, the highlight tray and the note sheet

1. Select words in a book → **Highlight**: a submenu of five colours, each with its coloured dot,
   your last colour first. Choose Green: the words turn green, with a soft tap.
2. Select other words → **Highlight**: Green is now first.
3. Tap a highlight: a tray floats up from the bottom with no dimming; the tab bar is gone. The
   colours come first, then **Note**, **Copy**, (**Share**, if the app's page can share) and
   **Delete**. No keyboard rises, and no colour has a focus ring.
4. Tap a highlight in the lower third of the screen (Scroll layout): the chapter glides up until the
   words sit just above the tray, and the top bar neither hides nor shows. Scroll the chapter with a
   finger: the tray stays.
5. Tap another colour: the highlight changes and the tray stays. Tap the checked colour: the
   highlight goes and a toast offers **Undo**; Undo brings it back.
6. **Copy**, then paste into Notes: the highlighted words. A "Copied" toast shows.
7. **Note** in the tray: the tray leaves and a sheet titled Note rises with the keyboard already up
   and the cursor in the text area. **Save** and the text area are both above the keyboard. Type,
   Save: a tap on the highlight shows the note in the tray; a tap on the note's text edits it.
8. Select words → **Note** in the system menu: a sheet titled New note with the quoted words, the
   keyboard up at once. ✕ cancels; Save makes the note.
9. Tap **Add a tag** in the tray: the tray rides up above the keyboard.

## When it doesn't work

| What you see | Why | What to do |
|---|---|---|
| `xtool dev build` says `Invalid Resource 'Resources/web'` | The web UI isn't built | `./ios/build-web.sh` |
| `swift sdk list` shows nothing | `xtool setup` didn't finish building the SDK | Run `xtool setup` again with the `.xip` path |
| `xtool dev` can't find the phone | It's locked, not trusted, or not on the cable | Unlock it, choose Trust, check `xtool devices` |
| The app won't open after a week | A free Apple ID's signing lasts 7 days | `xtool dev` again |
| "Pager can't reach your computer right now" | Pager isn't running, remote access is off, or neither side can reach the relay | Diagnostics' last error; Settings → Phone on the computer |
| **Pair this phone** right after Allow | The pairing answer didn't reach the app | Pair again; then Diagnostics should say Paired: yes |
| The bar is a flat grey bar on iOS 26 | The binary is stamped `sdk 17.5` (compatibility mode) | `~/.local/share/swiftly/toolchains/6.4.2/usr/bin/llvm-objdump --macho --private-headers ios/xtool/Pager.app/Pager \| grep -A3 LC_BUILD_VERSION` should say `sdk 27.2`; see the linker flag in `Package.swift` |
