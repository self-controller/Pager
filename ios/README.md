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
| `Sources/Pager/WebView.swift` | The web view's setup: it loads only `pager-app:` (other links open in Safari), doesn't rubber-band, and has no link previews |
| `Sources/Pager/PagerWebView.swift` | The WKWebView subclass: the page's messages, haptics, the page colour, and Highlight and Note in the text menu |
| `Sources/Pager/FirstRunView.swift`, `DiagnosticsView.swift` | Before pairing; the IDs, the path, and a timed download |

### The bridge to the page

The page posts to `window.webkit.messageHandlers.pager` (`src/lib/native.ts`). The app takes these
from its own page only (the main frame on `pager-app:`) and ignores anything else:

| Message | What the app does |
|---|---|
| `{t: "haptic.prepare", kind}` | Readies the generator for `kind`: `selection`, `light`, `soft`, `success` or `error` |
| `{t: "haptic.fire", kind}` | Plays it. The page spaces haptics 75 ms apart and skips them when Settings → Haptics is off |
| `{t: "theme", background: "#rrggbb"}` | Paints the web view and its edges that colour, and keeps it for the next cold start |
| `{t: "reader", open}` | While the reader is open: the edge swipe back is off, so the page gets edge swipes, and the app does not bounce |
| `{t: "selection", items}` | Which of `highlight`, `note` and `reattach` the text menu adds; `[]` outside the reader's text |

The text menu keeps the system's Copy, Look Up, Translate and Share, with Pager's items first. Choosing
one calls `window.__pager.menu("highlight")` (or `"note"`, `"reattach"`), which the reader handles
(`src/components/reader/useNativeMenu.ts`). In the app the reader doesn't show its own floating
selection bar. A new page load turns the swipe back on and clears the items.

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

4. **Xcode 27.1**: download `Xcode_27.1.xip` from <https://developer.apple.com/download/all/?q=Xcode>
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
  uses your last colour, with a soft tap;
- in a book, a swipe in from the left edge doesn't go back; in the library it does;
- after switching to the dark theme and reopening the app, its first frame is already dark.

## When it doesn't work

| What you see | Why | What to do |
|---|---|---|
| `xtool dev build` says `Invalid Resource 'Resources/web'` | The web UI isn't built | `./ios/build-web.sh` |
| `swift sdk list` shows nothing | `xtool setup` didn't finish building the SDK | Run `xtool setup` again with the `.xip` path |
| `xtool dev` can't find the phone | It's locked, not trusted, or not on the cable | Unlock it, choose Trust, check `xtool devices` |
| The app won't open after a week | A free Apple ID's signing lasts 7 days | `xtool dev` again |
| "Pager can't reach your computer right now" | Pager isn't running, remote access is off, or neither side can reach the relay | Diagnostics' last error; Settings → Phone on the computer |
| **Pair this phone** right after Allow | The pairing answer didn't reach the app | Pair again; then Diagnostics should say Paired: yes |
