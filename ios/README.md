# Pager for iPhone

A SwiftUI app around the Pager web UI. It bundles the UI and serves it on `pager-app://localhost/`.
Its scheme handler carries the UI's `/api` requests to your computer as `pager/1` over iroh (API.md,
"Phones over iroh"). The phone's iroh key and its token stay in the Keychain; the web page never sees
the token.

The app also keeps a copy of the books you choose **Download** for, and reads from it when your
computer can't be reached: asleep, off, or with no signal on the phone. Reading places and highlights
made meanwhile wait on the phone and go to the computer when it is reached again
([The copy](#the-copy-reading-when-your-computer-cant-be-reached)).

It's built on Linux with [xtool](https://github.com/xtool-org/xtool) and
[IrohLib](https://github.com/n0-computer/iroh-ffi) 1.2.0 (iOS 17.5 or later).

| File | What it does |
|---|---|
| `Sources/Pager/PagerApp.swift` | The app, the `pager://pair` links the Camera opens, closing the connection in the background and looking for the computer again in front, and telling the page when the computer comes within reach or goes out of it |
| `Sources/Pager/SchemeHandler.swift` | Serves the bundled UI; `/api` over iroh; takes the token out of the pairing answer; keeps answers in the copy and answers from it when the computer is out of reach; holds the live stream open meanwhile |
| `Sources/Pager/IrohClient.swift` | The endpoint (the key from the Keychain), dialling the saved ticket, the relay and token from health; whether the computer can be reached, and looking again while it can't |
| `Sources/Pager/PhoneCopy.swift` | The copy on disk: answers by path and query, each with its tags, and the page's own record |
| `Sources/Pager/Outbox.swift` | The queue of changes waiting to be sent, on disk |
| `Sources/Pager/AppRoutes.swift` | `/_app`: the app's own routes for its page (the copy's state, the queue) |
| `Sources/Pager/Deadline.swift` | A wait with a time limit, for IrohLib calls, which can't be cancelled |
| `Sources/Pager/Frame.swift` | `pager/1` framing (mirrors `server/src/remote/protocol.rs`) |
| `Sources/Pager/Store.swift` | The ticket, the last page colour and when the computer was last reached in UserDefaults; the key, the token and the relay token in the Keychain |
| `Sources/Pager/WebView.swift` | `PagerTabs`, the tab bar in SwiftUI, made once; the web view's setup: it loads only `pager-app:` (other links open in Safari), doesn't rubber-band, and has no link previews |
| `Sources/Pager/TabsController.swift` | The system tab bar (Liquid Glass on iOS 26 and later) around the one web view, which stays in one place above the five empty tab pages and under the bar; the bar's footprint for the page; the Layout diagnostics |
| `Sources/Pager/PagerWebView.swift` | The WKWebView subclass: the page's messages, haptics, the page colour, Highlight and Note in the text menu, and the page's safe area pinned to the screen's |
| `Sources/Pager/FirstRunView.swift`, `DiagnosticsView.swift` | Before pairing; the IDs, the path, the copy's size and waiting changes, and a timed download |

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
| `__pager.online(true)` | The computer came within reach (`true`) or went out of it (`false`) | Within reach: sends the changes that waited, brings the downloaded books up to date, refreshes what is on screen. Out of reach: shows the offline line (`src/offline/index.ts`) |

The footprint is the distance in points from the top of the bar to the bottom of the screen. The page
keeps it while the bar hides, so the reader never reflows. In the app the page draws no tab bar or
side nav of its own (`data-native-tabs` on `<html>`).

The web view is not inside any tab's page. The five pages are empty and clear, and the web view sits
in the tab bar controller's own views, right above the views that hold the pages and below the bar
(`settle` in `TabsController.swift`). It never moves and never leaves the window. Before, it moved
into the page about to appear; since iOS 18 the controller crossfades between its pages on every
selection, so the web view faded in over the bare background, a dark flash each time a book opened
or closed. Now the fade runs on two empty pages, and a selection the page asks for is made without
animation as well. About half a second after the bar first shows, the app checks the arrangement
once: a touch in the middle of the screen must land in the web view, and one in the middle of the
bar must not. If the check fails, the web view moves per tab as before, for that run.
**Diagnostics → Layout → Web view** says which: `fixed`, `fixed (not checked yet)` (the bar hasn't
shown yet, as on the pairing page) or `moved per tab (fallback)`.

The bar looks new only because of how the binary is stamped. iOS 26 draws the new design for a binary
built against SDK 26 or later, and keeps anything older in compatibility mode: a flat, full-width bar.
A Linux build stamps the deployment target (17.5) as the SDK, so `Package.swift` passes the linker
the real one (27.2). With that stamp the bar is the floating glass capsule, and its scroll-edge blur
covers the web view's scroll view, which `setContentScrollView(for: .bottom)` already wires up. The
SwiftUI Diagnostics sheet takes the new look too. **Diagnostics → Layout → Built for SDK** shows the
stamp.

## The copy: reading when your computer can't be reached

The phone reads the library from your computer, and a closed laptop is asleep: nothing can reach it.
So the app keeps a copy of what you choose, on the phone.

- **Download** is in a book's menu in the Library (long-press the book, or its `⋯`). A downloaded book
  has a small mark. **Remove download** is in the same menu. Nothing downloads by itself.
- With the computer out of reach, the Library says `Offline · synced 2:14 pm` in one small line.
  Downloaded books open and read as usual. The others are dimmed: the Library stays whole, and a tap
  says the book isn't on this iPhone.
- Reading places, new highlights and notes, and changes to them are kept on the phone and sent, in
  order, when the computer is reached. **Settings → This iPhone** shows how many are waiting, and any
  the computer refused (the passage changed, the book was removed), with their words to copy out.
- Search, a new Context briefing, moving a highlight, and a book that isn't downloaded need the
  computer, and say so.
- The copy is brought up to date whenever the app is in front and reaches the computer: a downloaded
  book whose file changed is fetched again, one that left the library is removed.

### Who does what

The app can be compiled on Linux but not run there, so the Swift side is kept simple and the meaning
is in the page, where tests reach it (`npm test`, the `test/offline-*.test.ts` files).

| | |
|---|---|
| The app (Swift) | Bytes and reachability. It stores answers, keeps the queue on disk, knows whether the computer can be reached, and tells the page. It doesn't know what a book or a highlight is. |
| The page (`src/offline/`) | Meaning. What to fetch for a download (`download.ts`), what a waiting change does to the lists on screen (`ops.ts`, `api.ts`), how the queue is sent and which refusals are final (`replay.ts`), and when to bring the copy up to date (`sync.ts`). |

The server needs nothing new. The page leans on three things it already has (API.md): the sync
manifest, annotation ids that make a resend safe, and `updatedAt` on a reading place, with which an
older place never replaces a newer one.

### Which answers are kept

A 200 answer to a GET under `/api` is stored, whole, under its path and query, when one of these holds:

1. The request carries `x-pager-keep: <tag>`. The page sends it while downloading a book (the tag is
   `doc:<id>`) and for covers (`shell`). The app takes the header off before the request leaves.
2. An answer for that path and query is stored already. It is replaced, so the copy stays fresh as
   you read online.
3. The path is one of the lists every page opens with (tag `shell`): `/api/documents`, `/api/tree`,
   `/api/highlights`, `/api/tags`, `/api/health`, `/api/settings`, `/api/presets`,
   `/api/tools/context/briefings`.

Never the live stream or pairing. Health is stored without your relay's token. An answer over 48 MB
is passed on but not kept.

### What a request gets

| The request | The computer | The answer |
|---|---|---|
| A GET with a stored answer | known to be out of reach | the stored answer, at once, with `x-pager-offline: 1` |
| A GET with a stored answer | not known | waits up to 2.5 s for the connection, then up to 4 s for the computer's answer to begin; past either, the stored answer |
| A GET with no stored answer, or a change | known to be out of reach | 503 `unavailable`, at once (the page queues the changes that can wait) |
| Any request | reached | the computer's answer, as before |
| `GET /api/stream` | out of reach | held open, silent; ended when the computer is reached, so the page opens a real one from the last event it saw |
| Any request | the computer refused this phone (not paired, revoked) | 401, never the copy. **Revoke** on the computer also removes the phone's downloads |

**Reachability.** The app looks for the computer when it comes to the front, when the network changes
(Wi-Fi joined, signal back), on **Try again**, and every 15 s at first, backing off to 2 min, while it
is out of reach and the app is in front. Nothing runs while the app is in the background: iOS suspends
it, and an iroh socket doesn't survive that.

### The app's routes for its page

`/_app/*` is answered by the app and never sent to the computer. Only the app's own page can call it.

| Route | Does |
|---|---|
| `GET /_app/copy` | `{ generation, online, lastOnlineAt, bytes, entries, client, outbox }`. `online` is null until the app has tried. `client` is the page's record, as stored. `outbox` is the queue, oldest first |
| `PUT /_app/copy/client` | Stores the page's record (JSON, at most 256 KB): the downloaded books with their file version, the covers fetched, the last sync, the changes the computer refused |
| `POST /_app/copy/drop` | `{ tag }`: takes the tag off every answer and removes those left with none (Remove download) |
| `DELETE /_app/copy` | Removes every stored answer and the page's record. The queue stays |
| `POST /_app/outbox` | `{ key, method, path, body?, meta? }` → 201 `{ seq, at }`. An entry with the same `key` is replaced where it is. Only these wait: `PUT /api/documents/:id/progress`, `POST /api/documents/:id/annotations`, `PATCH` and `DELETE /api/annotations/:id` |
| `DELETE /_app/outbox/<seq>` | Removes one (it was sent, or refused for good) |
| `POST /_app/probe` | Looks for the computer now |

The page's keys keep the queue short: one waiting place per book (`progress:<doc>`), one entry for a
new highlight however often it is edited before it is sent (`create:<id>`), one merged change for a
highlight the computer has (`patch:<id>`), and `delete:<id>`. A delete that is undone before it is
sent is simply taken out.

### Where it is kept

The copy is in the app's Application Support folder (`Pager/copy/`), left out of iCloud and computer
backups (it comes back from your computer), and readable once the phone has been unlocked. The queue
(`Pager/outbox.json`) is in backups: it is the only place those changes exist. A pairing link for
another computer removes both, since they belong to the first one's library.

### Trying it in a browser

A development build has a stand-in for the app's side (`src/offline/dev.ts`) that follows the same
rules, so the page's part can be tried against the real backend:

```sh
npm run dev:server            # the backend, port 3006
npm run dev:api               # the web app, http://localhost:5176
```

Open `http://localhost:5176/?devcopy=1`, download a book from its menu, then in the console run
`__pagerDev.offline(true)`; `__pagerDev.offline(false)` brings the computer back and sends the queue.
`?devcopy=0` turns the stand-in off. It doesn't cover pictures (an `<img>` loads straight from the
backend) or anything in the Swift files.

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

### Check it: no flash, whole sheets, instant tabs

None of this has run on a phone: the Swift side has only been compiled.

1. Library → long-press a book: the menu shows every row. In a book: AA, a highlight's tray,
   Contents and Tools show whole.
2. Tap a book, tap **Back**, several times: no dark flash. Switch tabs: no flash.
3. In a book, scroll up and down so the bars hide and show: no text above "Chapter x of y".
4. Close the app from the app switcher, turn on Airplane Mode, open it: the Library, Highlights and
   the last book show at once.
5. Two fingers, three taps → Diagnostics → Layout: **Web view** says `fixed`. If it says
   `moved per tab (fallback)`, say so: the flash fix isn't in effect.

### Check it: the Assistant tab's briefings, the book picker and no blue box

None of this has run on a phone. It was measured in WebKitGTK and Chromium at 390 × 844; the
keyboard and the flash can only be seen on the phone.

1. Assistant → open a briefing → **Map** (the page scrolls down by itself), scroll a little more,
   scroll back up → **← All briefings**: no flash, and the list is where you left it. The same from
   Timeline and from a long briefing scrolled down. If it still flashes, say what the page did
   (a blink of the whole screen, or the list jumping).
2. With several briefings, scroll the list down and tap a book: its Context opens at the top.
3. Tap a listed book: its title and briefing show at once, with no grey loading blocks first.
4. **Choose a book**: three books under a search field, and the keyboard rises. The whole sheet
   stays on screen above the keyboard: its title, ✕ and the search field. Scroll the books: the
   search field stays. Type: the sheet keeps its height as the list shortens.
5. Pick a book: the sheet slides away while the book's Context shows behind it (it used to vanish
   in one frame).
6. No blue box anywhere: tap the picker's search field and its ✕, the Library's and Highlights'
   search fields, a note's text area, a full-screen map's ✕, and the fields in Settings.
7. A note's sheet (a highlight → **Note**) with the keyboard up: **Save** and the title are still on
   screen, as before.

### Check it: reading with the laptop closed

None of this could be run on Linux: the Swift side has only been compiled. Take a screenshot of
**Diagnostics → This phone's copy** with anything that goes wrong.

1. At home, with the computer on: open the app. Library → long-press a book, or tap its **⋯** →
   **Download**. (The long press must open Pager's menu, not an iOS sheet with Open, Copy, Share.) Its
   status counts the sections (`3/13`), then the book has the small mark. Settings → This iPhone says
   `Connected to your computer · synced …` and `1 book on this iPhone`, with a size.
2. Close the laptop's lid. Wait a minute, then swipe the app away and open it again. The Library
   shows `Offline · synced …`, with covers; the downloaded book looks as before and the others are
   dimmed. Diagnostics → This phone's copy → Computer says `out of reach`.
3. Tap a dimmed book: a message says it isn't on this iPhone. Nothing else happens.
4. Open the downloaded book. It opens at your place. Read into another chapter; its pictures show.
   Highlight a sentence and add a note to it. Leave the book: the Library shows the new percentage,
   and Highlights lists the new highlight first.
5. Settings → This iPhone says `2 changes waiting to send` (the place and the highlight). Swipe the
   app away and open it again: still 2, the highlight is still in the book, and the Book tab opens the
   book at the same place.
6. Open the laptop. Within about 15 s (or tap **Try again** in Settings) the offline line goes and
   the waiting line with it. On the computer, the book has the highlight with its note, and opens at
   the phone's place.
7. With the lid closed again, turn on Airplane Mode and open the app: the same as step 2, at once.
8. While reading a downloaded book online, close the lid, then turn to a chapter you haven't opened
   this session: the page shows within about 4 s, from the copy.
9. On the computer, edit a downloaded Markdown file, or replace a downloaded EPUB with another
   edition under the same name. Bring the app to the front: the book is fetched again without asking
   (its status counts sections once more).
10. Long-press the book → **Remove download**: the mark goes and the size in Settings drops.
11. Download a book again, then **Revoke** the phone on the computer: the app goes to **Pair this
    phone**, and after pairing again Settings says no books are downloaded.

## When it doesn't work

| What you see | Why | What to do |
|---|---|---|
| `Offline · synced …` stays with the computer on | The app hasn't reached it yet, or can't | Settings → This iPhone → **Try again**. Diagnostics: Computer, Last error. Then the rows below for "can't reach" |
| A downloaded book says it isn't on this iPhone | Its download was cut short (the computer went away), so it isn't whole | Reach the computer once with the app in front: the next sync finishes it |
| "1 change couldn't be saved" in Settings | The computer refused it for good: the passage changed since, or the book was removed | Its words are there to **Copy**; then **Discard** |
| Changes stay waiting with the computer reachable | The phone isn't paired any more (expired after 90 days unused, or revoked) | Pair again with the same computer: the changes are sent then |
| The Library is empty offline | The app never reached the computer since it was installed, or since **Remove all downloads** | Open it once with the computer on |
| `xtool dev build` says `Invalid Resource 'Resources/web'` | The web UI isn't built | `./ios/build-web.sh` |
| `swift sdk list` shows nothing | `xtool setup` didn't finish building the SDK | Run `xtool setup` again with the `.xip` path |
| `xtool dev` can't find the phone | It's locked, not trusted, or not on the cable | Unlock it, choose Trust, check `xtool devices` |
| The app won't open after a week | A free Apple ID's signing lasts 7 days | `xtool dev` again |
| "Pager can't reach your computer right now" | Pager isn't running, remote access is off, or neither side can reach the relay | Diagnostics' last error; Settings → Phone on the computer |
| **Pair this phone** right after Allow | The pairing answer didn't reach the app | Pair again; then Diagnostics should say Paired: yes |
| The bar is a flat grey bar on iOS 26 | The binary is stamped `sdk 17.5` (compatibility mode) | `~/.local/share/swiftly/toolchains/6.4.2/usr/bin/llvm-objdump --macho --private-headers ios/xtool/Pager.app/Pager \| grep -A3 LC_BUILD_VERSION` should say `sdk 27.2`; see the linker flag in `Package.swift` |
