# Reading on your iPhone

Pager runs on this computer. A phone reaches it in one of two ways. Both are off until you turn on
remote access, both answer only phones you paired and allowed on this computer, and both lead to the
same reading surface.

- **Over iroh, with the Pager app.** This computer has an ID (an [iroh](https://www.iroh.computer)
  endpoint, a public key). The phone dials that ID and connects directly when it can, through a relay
  when it can't. No socket listens for phones on this path, and it needs no address or account. The
  computer's side is built; the iPhone app is not yet ([plan](../prompts/iroh-migration.md), Phase 2).
  Until then, a fake phone on a computer tries the whole path (step 4.3).
- **Over Tailscale, as a Home Screen app (optional).** The iPhone joins
  [Tailscale](https://tailscale.com), a private network between your own devices, and opens Pager in
  Safari as a Home Screen app. Nothing is put on the public internet: `tailscale serve` only answers
  devices signed in to your tailnet. It is set up only if you want it in the meantime; skip step 3
  otherwise.

When the Pager app is the daily way to read, the Tailscale path is removed (Phase 3 of the plan),
and with it the address field and the listener on port 3007.

```
iPhone, Home Screen app ──tailnet──▶ tailscale serve ──▶ remote listener, 127.0.0.1:3007 ───┐
  (Tailscale VPN on)                 https://<pc>.<tailnet>.ts.net                          │
                                                                                            ├──▶ Pager's remote app
iPhone, Pager app ──iroh, direct or through a relay──▶ iroh endpoint, inside Pager ───────┘    (paired phones only)
  (not built yet: the fake phone stands in)            dialed by this computer's ID
```

Run every `tailscale`, `sudo`, `systemctl` and `loginctl` command below yourself. Pager never runs them.

## 1. Keep Pager running

The phone can only read while Pager is running and the computer is awake. A server started by the
`pager` command stops itself after six idle hours, so run it as a user service instead.

Build the web app once (and again after you update Pager):

```sh
cd ~/Desktop/projects/Pager && VITE_USE_HTTP=1 npm run build
cargo build --release --manifest-path server/Cargo.toml
```

Create `~/.config/systemd/user/pager.service`:

```ini
[Unit]
Description=Pager, the reading service (and the phones' remote access when it is on)

[Service]
WorkingDirectory=%h/Desktop/projects/Pager
ExecStart=%h/Desktop/projects/Pager/server/target/release/pager-server
# Where your books and Pager's data live. Use the folders you already read from:
# npm run dev:server uses server/.data-dev; the pager command uses ~/.local/share/pager.
Environment=PAGER_READS_DIR=%h/Desktop/projects/Pager/reads
Environment=PAGER_DATA_DIR=%h/Desktop/projects/Pager/server/.data-dev
# PAGER_BACKGROUND stays unset: this server never shuts itself down when idle.
Restart=on-failure

[Install]
WantedBy=default.target
```

Then:

```sh
pager --stop                                # if the pager command started one already (it holds port 3006)
systemctl --user daemon-reload
systemctl --user enable --now pager
systemctl --user status pager               # "active (running)"
loginctl enable-linger $USER                # keep user services running when you're logged out
```

The `pager` command finds this server on port 3006 and uses it. **The computer must not sleep:**
in Settings → Power, turn Automatic Suspend off (at least while plugged in).

## 2. Turn on remote access

Open Pager on the computer (`http://localhost:3006`), then **Settings → Phone**:

1. Switch **Remote access** on. At once, without a restart, Pager starts its iroh endpoint. The first
   time, Pager makes this computer's key (step 4.1). Switching it off closes every phone's connections.
2. **This computer's ID** appears within a few seconds, with the relay that carries it, or "no relay
   reached yet" until one is reached.
3. **Pair a phone** shows a QR code and a code like `BCDF-GHJK` for five minutes. It stays greyed out
   until remote access is on and iroh has started ("Starting remote access…").

**Tailscale address (optional)** is only for the Home Screen app (step 3). Saving it also starts
Pager's remote listener on 127.0.0.1:3007 for `tailscale serve` (`PAGER_REMOTE_PORT` picks another
port; then point `tailscale serve` at that one). Clearing it stops that listener and leaves iroh on.
If Tailscale is running, **Use my tailnet name** fills in the `https://<pc>.<tailnet>.ts.net`
address from step 3.2.

## 3. Over Tailscale: the Home Screen app (optional)

Skip this step unless you want the Home Screen app while the Pager app isn't built.

### 3.1 Tailscale on the computer

```sh
sudo dnf config-manager addrepo --from-repofile=https://pkgs.tailscale.com/stable/fedora/tailscale.repo
sudo dnf install tailscale
sudo systemctl enable --now tailscaled
sudo tailscale up
```

`tailscale up` prints a link; sign in there. Then, in the [admin console](https://login.tailscale.com/admin):

- **DNS:** enable **MagicDNS**, and under **HTTPS Certificates** choose **Enable HTTPS**.
- **Machines:** on this computer's row, open the `⋯` menu and choose **Disable key expiry**. Otherwise
  the computer drops off the tailnet when its key expires, after 180 days by default.

### 3.2 `tailscale serve` in front of Pager

```sh
tailscale serve --bg 3007      # https://<pc>.<tailnet>.ts.net  →  http://127.0.0.1:3007
tailscale serve status         # check: it should show your ts.net address and "(tailnet only)"
tailscale serve reset          # undo
```

- If `tailscale serve` says access is denied, run it with `sudo`, or once run `sudo tailscale set --operator=$USER`.
- The first `serve` may wait while Tailscale issues the certificate, or print a link to enable HTTPS.
- **Never use `tailscale funnel`.** Funnel publishes the address on the public internet. Pager's
  remote listener is built for your tailnet only.

`tailscale serve status` shows the address, `https://<pc>.<tailnet>.ts.net`. Save it as **Tailscale
address** in Settings → Phone (step 2).

### 3.3 Pair the iPhone

With remote access on and the Tailscale address saved (step 2), choose **Pair a phone** on the
computer. While iroh is on, the dialog's QR code is the Pager app's link, so type the code instead of
scanning it. Then, on the iPhone:

1. Install **Tailscale** from the App Store, sign in to the same tailnet, and leave the VPN on.
2. Open `https://<pc>.<tailnet>.ts.net` in **Safari** once, then choose Share → **Add to Home Screen**.
3. Open **Pager** from the Home Screen. It opens on the pairing page.
4. Type the code from the computer and a name for the phone, then choose **Pair**.
5. On the computer, the dialog asks **Allow "iPhone" to read your library?** Choose **Allow**. The
   phone opens your library.

Pair from the installed app, not from Safari: the Home Screen app has its own storage, and Safari's
cookies don't carry over to it.

## 4. Over iroh: the Pager app

### 4.1 This computer's ID

- The iroh endpoint's ID is this computer's ID, an Ed25519 public key. Its secret key is
  `remote/endpoint.key` in Pager's data folder (mode 0600; with the service above,
  `server/.data-dev/remote/endpoint.key`).
- **Settings → Phone** shows the start of the ID; hold the pointer over it for the whole ID.
  `curl -s http://localhost:3006/api/health` shows it too, as `remote.endpointId`, and
  `journalctl --user -u pager` has "Phones can reach this computer over iroh" with the ID each time
  the endpoint starts.
- Deleting the key gives the computer a new ID, and every phone paired over iroh must pair again.
  Turn remote access off first; Pager makes a new key when you turn it back on.
- There is no port to open or forward. The endpoint connects out to its relay. A phone connects
  directly when the networks allow it (the same Wi-Fi, for example) and through the relay when they
  don't. The relay passes encrypted packets and can't read them.

### 4.2 The relay

Until you run your own relay, Pager uses n0's public relays and discovery (n0 makes iroh). While
remote access is on, those are the only outside hosts Pager connects to; when it is off, Pager
makes no outside connections for phones.

Your own relay comes before anyone else uses Pager. [docs/relay.md](relay.md) sets one up on a small
VPS, with a token so only your computer and your phones can use it. Then enter its address and token
in **Settings → Phone → Your own relay**. With your own relay, Pager connects to it alone, with no n0
discovery. Changing it restarts the endpoint. The pairing link carries the relay and its token, so
pair phones again after a change.

### 4.3 Try it with the fake phone

The fake phone, `server/examples/fake-phone.rs`, does what the app will do: it dials this
computer's ID, pairs, and reads. Run it on this computer, or on another computer with this repository
and Rust to test from another network (a phone's hotspot, for example).

1. On the computer, choose **Settings → Phone → Pair a phone** and leave the dialog open (closing it
   cancels the code). Under the QR code, the dialog shows the link the QR code carries,
   `pager://pair?v=1&t=endpoint...&code=XXXX-XXXX`. Copy it.
2. Run the fake phone with that link. Keep the quotes: the link contains `&`.

   ```sh
   cd ~/Desktop/projects/Pager/server
   cargo run --release --example fake-phone -- 'pager://pair?v=1&t=...&code=XXXX-XXXX' --key ~/fake-phone.key
   cargo run --release --example fake-phone -- 'pager://pair?...' --key ~/fake-phone.key --relay-only   # only through the relay
   ```

   `--key` keeps the fake phone's own key in that file (made on the first run), so it stays the same
   phone from run to run. `--name "Some name"` names it (default `Fake phone`). The first run compiles
   it.
3. It prints the computer's ID, its own ID, `Connected.`, and `Asked to pair. Choose Allow on the
   computer...`. On the computer, the dialog asks **Allow "Fake phone" to read your library?** and
   shows where it asked from (an address and port, or `relay`). Choose **Allow**.
4. The fake phone prints `Paired as "Fake phone"`, the number of documents and some titles, its
   health, and the events of the live stream for five seconds. Then it stops.
5. **Settings → Phone** lists **Fake phone** with `· over iroh`, last seen from an address and port,
   or `from relay` after `--relay-only`. **Revoke** it, then **Remove** it.

To read again later without pairing, give it the ticket (the `t=` part of the link), the token it
printed, and the same key file:

```sh
cargo run --release --example fake-phone -- --ticket 'endpoint...' --token '<token>' --key ~/fake-phone.key
```

Without `--key`, each run is a new phone with a new ID: the token it printed is no use on the next
run, and Pager closes the connection as `not paired`.

### 4.4 The Pager app

The app's source is in `ios/`. [ios/README.md](../ios/README.md) has the one-time tools (Swift,
xtool, an Xcode download for its iOS SDK), the build, and the install over USB. Once it's installed:

1. On the computer, turn on remote access and choose **Pair a phone**.
2. Scan the QR code with the Camera. It opens a `pager://pair` link in the app, which dials this
   computer and fills in the code.
3. Choose **Pair** on the phone, then **Allow** on the computer.

No Tailscale on the phone or on the computer, and no address to set. The app keeps its token in the
Keychain; tap three times with two fingers for its diagnostics.

## 5. Paired phones

From the phone you can read, highlight, write notes and save your place. Adding, renaming, moving and
deleting files stays on the computer.

**Settings → Phone** on the computer lists paired phones, with when and from where each was last
seen; `· over iroh` marks a phone paired over iroh. Click a name to rename it. **Revoke** a phone and
it is refused from its very next request; a phone on iroh is also disconnected at once. **Remove**
takes a revoked or expired phone off the list.

- A phone's credential works only on the path it was paired on. A phone paired over Tailscale can't
  read over iroh, and an iroh phone's token works only from that phone.
- A phone that pairs over iroh again replaces its old entry, which then shows as Revoked.
- A phone unused for 90 days expires.

## 6. When it doesn't work

| What you see | Why | What to do |
|---|---|---|
| The app opens on "Pair this phone" | The phone was revoked, or its credential is gone (for example, the app was removed from the Home Screen) | Pair again (step 3.3). Remove the old entry on the computer. |
| The pairing page after a long time away | A phone unused for 90 days expires | Pair again; the old entry shows as Expired. Remove it. |
| Changes made on the computer stop showing up live | The live stream closed (the phone was revoked, or remote access was switched off) | Reopen the app; if it asks to pair, pair again. |
| Safari can't open the page, or it spins | Pager isn't running, or remote access is off | `systemctl --user status pager` and `journalctl --user -u pager -n 50`. Check Settings → Phone → Remote access is on. |
| "Safari can't find the server" | The iPhone's Tailscale VPN is off, or the computer is asleep or off the tailnet | Turn the VPN on in the Tailscale app. `tailscale status` on the computer. |
| The page loads, but `tailscale serve status` shows nothing | `serve` was reset, or tailscaled restarted without it | `tailscale serve --bg 3007` again. |
| Pairing says the code doesn't match | A typo; five wrong codes close the window | Check the code; choose New code on the computer if it closed. |
| **Pair a phone** is greyed out | Remote access is off, or iroh hasn't started ("Starting remote access…" that stays means it failed) | Step 2. `journalctl --user -u pager -n 50` says why iroh couldn't start. |
| Settings → Phone says "no relay reached yet" and stays that way | The computer can't reach n0's relays (offline, or a network that blocks them) | Check the computer's internet connection. A phone on the same network may still connect directly. |
| The fake phone stops with "couldn't reach the computer" | Remote access is off, Pager isn't running, or (with `--relay-only`) the relay can't be reached | Check Settings → Phone: remote access on, a relay reached. |
| The fake phone's connection is closed as `not paired` | No pairing window is open (the dialog was closed, or the code expired), and this phone isn't paired, or it ran without the `--key` it paired with | Run it with the same `--key`, or open **Pair a phone**, copy the fresh link (step 4.3), and run it again. |
| A phone paired over Tailscale is refused over iroh | Credentials don't cross paths | Pair it again over iroh. |

Not built yet: reading offline, and downloading books to the phone. The iPhone app is written
(`ios/`) but hasn't been compiled or run on a phone yet. Your own relay is ready to deploy
([docs/relay.md](relay.md)). The server side is ready for the app: the `pager/1` protocol and
tokens bound to the phone's endpoint ([API.md, "Phones over iroh"](../API.md#phones-over-iroh)), a
sync manifest, and a column for the phone's own key.
