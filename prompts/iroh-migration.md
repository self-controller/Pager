# Plan: phone access over iroh only, with bytes passed as Buffers

Status: **in progress, 2026-10-27.** The backend was rewritten in Rust (`server/`) on 2026-10-27,
which made Phase 0 a different, smaller job (below); Phase 1 is built and tested in-process. Decisions
marked *(open)* are the user's to make before that phase starts.
**2026-10-28: Tailscale is skipped.** The user won't set up the Tailscale path as an interim, so the
phone reads only once the app works. Phase 1b (new) makes iroh work on its own first, and Phase 3
no longer waits two weeks.
**2026-10-28: the TypeScript server is deleted** and `server-rs/` is now `server/`. Phase 1's step
list below was written for the TypeScript server, so the `.ts` files it names no longer exist; the
Progress note gives where each step was built in Rust.
Inputs: `reports/iPhone remote access to desktop books.md` (stage 3), API.md "Phones: the remote
listener (M6)", and the benchmark below.

## Where this ends

- **The phone reaches Pager only through iroh.** It dials the computer's endpoint ID (an Ed25519
  public key) and connects directly when it can, through a relay when it can't.
- **No socket listens for phones.** The TCP listener on 127.0.0.1:3007 goes away. iroh streams are
  handed to the remote Hono app inside the server process.
- **No Tailscale.** No `tailscale serve`, no `remote.origin`, no `tailnet.ts`, and no cookie or CSRF
  logic on the remote surface.
- **A native iPhone app replaces the Home Screen PWA.** A WKWebView runs the existing React UI, and a
  scheme handler carries its requests over iroh.
- **iroh is a crate dependency of the Rust backend.** No binding, and bytes never cross a language
  boundary. (The plan first said: bytes cross the Node binding as `Buffer`.)

**Unchanged:** port 3006 and `localOnly`; REMOTE_ALLOW / REMOTE_DENY and the test that fails on an
unlisted route; pairing (RFC 8628 code, approved on the computer); 256-bit tokens stored as sha256;
revocation; 90-day idle expiry; the sync manifest; no absolute path ever sent to a device. The user
runs every `sudo`, `systemctl`, `loginctl` and `tailscale` command.

## Why

| | Tailscale today | iroh with the stock binding | iroh with Buffers |
|---|---|---|---|
| Setup for the user | About 10 steps, a Tailscale account on both devices, VPN kept on | Install the app, scan, Allow | Same |
| iOS limits | One VPN at a time; App Review 4.2.3 risk | None of these | Same |
| Bulk transfer (loopback, this PC) | n/a | **5 MB/s, 230 CPU-s/GB** | Target ≥100 MB/s (Phase 0 measures it) |
| 2 KB request (loopback) | n/a | 1.0 ms (plain HTTP 0.19 ms) | Expected about the same |

*(The two iroh columns are history now: they describe the Node binding, which the Rust backend doesn't
use. The Rust gate's numbers are under Phase 0.)* The benchmark used `@number0/iroh` 1.2.0 with both
ends in one process and relays off. The slow part was the binding's `Vec<u8>` ⇄ `Array<number>`
conversion, not QUIC. Upstream tracks it as
iroh-ffi issue #276, "Node bindings: accept and return Buffer/Uint8Array for byte APIs" (open since
2026-07-18). Idle on the n0 preset: about 0.15% of a core and about 1.1 KB/s of UDP, measured over
90 s only.

## Decisions this plan takes

1. **Protocol: one framed request per QUIC stream (`pager/1`), not raw HTTP piped through.** Node
   calls `remote.fetch(Request)` directly, so there's no socket shim and no HTTP parser on either
   end. The Swift side only writes a JSON head and body bytes. Peer identity arrives as a function
   argument, not a header anyone could forge.
2. **Binding: none.** iroh is a dependency of `server/` (the backend was rewritten in Rust on
   2026-10-27). The plan first called for a vendored, patched copy of the Node binding; that was built,
   failed its first compile, and was removed.
3. **Device binding: a new `devices.endpoint_id` column.** `public_key` stays reserved for the
   stage 2 Secure Enclave key.
4. **No Tailscale interim** *(changed 2026-10-28)*. The plan first kept Tailscale working until the
   cut-over so the phone was never without access. The user skips it instead: Tailscale was never
   installed here and no device was paired over it, so the phone has no way in until Phase 2's app
   works. The Tailscale code stays until Phase 3, as the fallback if Phase 2 stalls (see Risks).

**Open decisions:**
- *(open)* **Native shell.** SwiftUI + WKWebView built with xtool on Fedora (recommended, no Mac
  needed), or Capacitor with macOS CI. Phase 2's first spike decides whether xtool can link IrohLib.
- *(open)* **Apple account.** $99/year, or free signing that expires every 7 days while developing.
- *(open)* **Relay.** n0's public relays through Phases 1–3, then your own `iroh-relay` (Phase 4).
  Phase 4 is required before anyone else uses Pager, optional before that.
- ~~**Upstream PR.**~~ Moot without the binding.

## Phase 0: iroh in the Rust backend

*Rewritten 2026-10-27. The Node-binding version of this phase (vendor the binding, patch five
functions to pass `Buffer`, a loader and types, a Node benchmark) was built on 2026-10-26, failed its
first compile, and was removed when the backend moved to Rust.*

1. **Dependencies.** `iroh`, `iroh-base` and `iroh-tickets` (1.x) in `server/Cargo.toml`.
2. **Benchmark gate.** `cargo run --release --example iroh-bench` (`server/examples/iroh-bench.rs`):
   two endpoints in one process on loopback, relays off; the 2 KB and 200 KB medians and a 50 MB bulk
   transfer with CPU-seconds per GB (both ends together).
   - **Pass:** ≥100 MB/s and ≤10 CPU-s/GB on loopback, and a 2 KB median ≤1.5 ms.
   - **Fail:** there is no sidecar to fall back to any more; it would mean tuning iroh itself.

**Exit:** the gate passes. **Result, 2026-10-27:** **pass.** Release build on this PC, 50 MB bulk: 314 MB/s and
0.4 CPU-s/GB (both ends); 2 KB median 0.179 ms, 200 KB median 0.98 ms, handshake 2.2 ms. Compared with
the Node binding's 3–5 MB/s and 230–390 CPU-s/GB, and plain HTTP's 0.3 ms for 2 KB.

## Phase 1: the desktop speaks iroh, alongside Tailscale

> **Progress, 2026-10-27.** Built in `server/`: `src/remote/{identity,protocol,node,bridge,client}.rs`;
> the `Peer` extension and bearer-only gate in `src/http/remote.rs`; `devices.endpoint_id` (schema v6);
> `remote.relay`; `appUrl` on the pairing window; health's `endpointId` and `relay`; Settings → Phone's
> "This computer's ID"; `tests/remote_iroh.rs` (the list under step 10, plus the connection cap and the
> relay setting); `examples/fake-phone.rs`; API.md "Phones over iroh" and CONTRACT.md. Deviations:
> step 7 keeps `url` for the Home Screen app and adds `appUrl` (the `pager://` link), so the PWA keeps
> working until Phase 3; step 5 is symmetric (a token paired over Tailscale is refused over iroh too);
> a phone pairing again replaces its earlier device row (one unrevoked row per endpoint, replaced rows
> are revoked); a phone keeps at most four connections. The relay check with the fake phone is noted
> under Exit.

1. **Identity.**
   - `server/src/remote/iroh/identity.ts` creates a 32-byte secret key at
     `<dataDir>/remote/endpoint.key` (mode 0600) the first time remote access is turned on, and passes
     it as `EndpointOptions.secretKey`.
   - The endpoint ID is this computer's ID.
   - Deleting the key (a later "Reset this computer's ID" button) makes every phone pair again.
2. **Lifecycle.**
   - The endpoint binds when `app.remote.enabled` turns on and closes when it turns off. Use the same
     one-at-a-time start/stop queue as `remoteListener()` in `server/src/server.ts`.
   - For now, use the n0 preset (n0 relays and discovery).
   - Add `remote.relay: string | null` to `AppSettings` (null = n0). Phase 4 sets it.
3. **The `pager/1` protocol.** Specify it in API.md; Node and Swift both implement it. Per
   bidirectional stream:
   - The client writes a u32 big-endian length, a JSON head
     `{ v: 1, method, path, headers }` (≤16 KB), then the body, then `finish`.
   - The server writes a u32 length, a JSON head `{ status, headers }`, then the body, then `finish`.
   - A malformed or oversized head, or an unknown `v`, resets the stream with a named error code.
   - A client that stops the stream aborts the Request's `signal`, which ends SSE responses.
4. **The bridge** (`server/src/remote/iroh/bridge.ts`):
   - **Accept loop.** After the handshake, read `conn.remoteId()`. Close the connection at once unless
     the ID belongs to an active device, or a pairing window is open.
   - **Limits.** `setMaxConcurrentBiStreams` (about 32) per connection, and a few connections per
     endpoint ID.
   - **Requests.** For each stream, decode the head and build
     `new Request("http://pager.remote" + path, { method, headers, body, signal, duplex: "half" })`.
     Call `remote.fetch(request, { peer: { endpointId, addr } })`, then write the response head and
     stream the body.
   - **Revocation.** On `device.revoked`, or when remote access turns off, close that device's
     connections.
   - Serve `/api` only. The native app bundles the UI.
5. **The remote app** (`server/src/http/remote.ts`):
   - **Auth.** A request that carries `c.env.peer` (it came through iroh) authenticates by bearer
     token only. The token must belong to the device whose `endpoint_id` equals the peer's, otherwise
     401. A copied token is then useless from any other phone.
   - **`clientIp()`** reads `c.env.peer.addr` (an IP:port, or "relay") on the iroh path and
     X-Forwarded-For on the Tailscale path. It stays informational.
   - **Pairing.** `POST /api/pair` records the requesting endpoint ID with the request. Approval writes
     it to the new device row.
   - **Tailscale path.** Cookie auth, CSRF and `fromThisApp` keep running there until Phase 3; the
     iroh path skips them.
6. **Migration.** Add `devices.endpoint_id TEXT`, with a unique index where it is not null.
7. **QR code and pairing window.** While iroh is on, `POST /devices/pairing` returns
   `url: pager://pair?v=1&t=<EndpointTicket>&code=XXXX-XXXX`. The ticket carries the endpoint ID,
   the relay URL and the current direct addresses. Check that it fits a QR code comfortably.
8. **Health.** On the iroh path, `GET /api/health` adds the current relay URL, so the phone refreshes
   the ticket it saved.
9. **Settings → Phone.** Show "This computer's ID" (short form) and the relay. Optionally, show each
   connected phone's path (direct or relay) from `Connection.paths()`.
10. **Tests** (`server/test/remote-iroh.test.ts`). Use two in-process endpoints with relays off,
    dialed by loopback address as in the benchmark. Cover:
    - an unknown endpoint is closed outside a pairing window;
    - inside a window, only health, pair and poll answer (everything else 401);
    - a paired endpoint reads; its token from another endpoint gets 401;
    - revoking closes the connection, and the next request is refused;
    - `/api/stream` delivers events and ends on revoke and on remote off;
    - request and response bodies stream both ways;
    - bad heads reset the stream.

    The existing REMOTE_ALLOW coverage test must keep passing unchanged.
11. **A fake phone** (`server/bench/fake-phone.mjs`). A Node client that pairs and reads through a
    real relay (relay-only mode), for checking the whole path without the iPhone.
12. **Docs.**
    - API.md: "Phones over iroh" (protocol, accept gate, token bound to an endpoint) and the Security
      model.
    - API.md: change the "makes no other network calls" promise to name the relay and discovery
      connections while remote access is on.
    - CONTRACT.md "On a phone".

**Exit:** the fake phone pairs and reads through a relay; Tailscale and the PWA still work; all tests
pass. **2026-10-27:** on this PC, a real `pager-server` with remote access on
and the fake phone in relay-only mode (direct addresses dropped from the ticket) paired through
`use1-1.relay.n0.iroh.link` and read the library; the device row shows `lastIp: relay` and the phone's
endpoint ID; the `appUrl` was 184 characters. `cargo test` passes (the earlier suites unchanged). Still
to try from another network, with a phone: the same run over cellular.

## Phase 1b: iroh on its own, without Tailscale *(added 2026-10-28)*

Today remote access won't turn on, and no pairing window opens, until `remote.origin` is set, and
only the Tailscale path uses that address. With Tailscale skipped, take out that dependency now
instead of in Phase 3. A small change; the protocol doesn't change.

1. **Settings.** Turning remote access on no longer needs `remote.origin` (the check in the app
   patch, `server/src/settings.rs`). The origin's rules stay for when one is set.
2. **Listeners.** The iroh endpoint starts whenever remote access is on. The TCP listener on 3007
   starts only when an origin is set (`RemoteListener::start`, `server/src/server.rs`). It stays
   useful for trying the phone layout in a desktop browser at `http://localhost:3007`.
3. **Pairing window.** `POST /devices/pairing` opens without an origin
   (`server/src/http/routes/devices.rs`): `url` only when an origin is set, `appUrl` whenever iroh
   is on, and 400 as now when there is neither. `PairingWindow.url` becomes optional in
   `server/src/model/api.rs` and `shared/src/api.ts`.
4. **Settings → Phone** (`src/components/settings/PhoneSettings.tsx`):
   - **Pair a phone** needs only remote access on.
   - The address field becomes optional and is labelled as the Tailscale address.
   - The dialog's QR code carries `appUrl` when there is one (Phase 2's Camera entry needs it), else
     `url`, and its text says so. The link is also shown as text you can select, for the fake phone.
5. **The fake phone keeps its key.** `--key <file>` loads the secret key from the file, or makes it
   there, so a token it printed works on a later run with `--ticket … --token …`. Today every run is a
   new endpoint, so that mode is refused at the accept gate.
6. **Tests** (`tests/remote_iroh.rs` and the settings tests): turning on without an origin; a window
   without an origin has `appUrl` and no `url`; no TCP listener without an origin; a phone pairs and
   reads over iroh with no origin set. The REMOTE_ALLOW coverage test stays unchanged.
7. **Docs.** API.md (the origin and `url` become optional; the two 400s for a missing origin go
   away), CONTRACT.md "On a phone", and `docs/iphone.md` (drop the `http://localhost:3007` workaround
   and the `curl` for `appUrl`; mark the Tailscale section optional).

**Exit:** with no origin set, the fake phone pairs from the link the dialog shows and reads, once from
another network as well (a phone's hotspot; this is the run left over from Phase 1's exit).
`cargo test`, `npm run typecheck` and `npm test` pass.

## Phase 2: the iPhone app

1. **Spikes first. Stop and decide if any fails:**
   - xtool builds a SwiftUI app that links IrohLib's xcframework, installs it on the phone, and
     connects to the desktop over cellular. If not, switch to Capacitor with macOS CI.
   - `EventSource` works against a custom-scheme URL served by a `WKURLSchemeHandler`. If not, add a
     fetch-stream EventSource; `followStream` already accepts an `EventSourceImpl`.
2. **`IrohClient`** (Swift):
   - One endpoint per app run. Its secret key lives in the Keychain
     (`AfterFirstUnlockThisDeviceOnly`), so the phone's endpoint ID survives relaunches.
   - It dials the saved ticket, reconnects on foreground and closes on background.
3. **`PagerSchemeHandler`** (`WKURLSchemeHandler` on the app's own scheme):
   - It serves the bundled UI from the app.
   - It forwards `/api/*` as `pager/1` frames, adding `Authorization: Bearer <token>` from the
     Keychain.
   - It streams responses with repeated `didReceive(data)`, and resets the stream on `stop`.
4. **Token capture.** When `/api/pair/poll` answers 200 `{ token }`, the handler saves the token to
   the Keychain and removes it from the body it passes to the page. The web UI never holds the
   credential.
5. **Navigation policy.** The web view only loads the app's scheme; every other link opens in Safari.
   No outside page can then send requests through the handler.
6. **QR entry.**
   - Register the `pager://` URL scheme, so the Camera opens `pager://pair?...` in the app.
   - The app saves the ticket, dials it, and opens the pairing page with the code filled in. The
     desktop shows "Allow?" as today.
7. **Web app changes** (`src/`):
   - Keep the base `/api` (relative).
   - Add a version check: an `apiVersion` mismatch shows "Update Pager".
   - PairPage drops its cookie notes.
8. **Measure on the phone:**
   - throughput for a 50 MB file over home Wi-Fi (direct) and cellular (relay);
   - phone CPU during the transfer;
   - whether the Local Network prompt appears, and that declining it still connects.
9. **Install:** xtool for personal use; the Apple account choice decides 7-day or 1-year signing.

**Exit:** the app is the daily way to read on the phone. (With Tailscale skipped, it is the only way.)

## Phase 3: cut over (remove Tailscale)

Start once Phase 2's exit is met. *(The plan first waited until the app had been the daily path for
about two weeks, with Tailscale beside it. Nothing runs on Tailscale now, so there is nothing to
compare it with; 2026-10-28.)*

1. **Remove from the server:**
   - `remoteListener()`, the TCP listener on 3007 and `PAGER_REMOTE_PORT`;
   - `devices/tailnet.ts`, `cachedOrigin`, and `suggestedOrigin` in `Health`;
   - `remote.origin` (a settings migration drops the field);
   - the `pager_device` cookie, `setDeviceCookie`, the CSRF block, `fromThisApp`, and the
     X-Forwarded-For branch of `clientIp`.
2. **Remove from the web app:**
   - the address field, "Use my tailnet name" and the Tailscale copy in `PhoneSettings.tsx`;
   - Tailscale wording anywhere else.
3. **Devices paired over Tailscale** have no `endpoint_id`. None exist: the dev library had no
   paired devices on 2026-10-28. Keep a migration that revokes any row without `endpoint_id` anyway,
   as a safety net, but the "Paired before the app; pair again" message isn't needed.
4. **Tests.** Port `remote-listener.test.ts`, `remote.test.ts` and the security tests that rely on
   the TCP listener or cookies to the iroh harness. Keep the route coverage test.
5. **Docs.**
   - `docs/iphone.md` becomes: install the app, turn on remote access, scan, Allow.
   - Update README line 102, the M6 sections of API.md, and CONTRACT.md.
6. ~~**The user's own steps:** `tailscale serve reset`, uninstall Tailscale, delete the Home Screen
   PWA.~~ Nothing to undo: Tailscale was never installed here, and the PWA was never added.

**Exit:** nothing listens for phones, `grep -ri tailscale` finds only history, and all tests pass.

## Phase 4: your own relay (before anyone else uses Pager)

1. **The relay.** `iroh-relay` on a small VPS (about $2–5/month), with your own domain and TLS.
2. **Restrict it to Pager.** The client side has `RelayConfig.authToken`. Check what the relay
   server offers for access control before relying on it.
3. **Point both ends at it.**
   - Desktop: `RelayMode.customFromUrls([your relay])`, with the minimal preset (no n0 discovery), so
     Pager connects to exactly one host you run.
   - Phones learn the relay URL from health (Phase 1, step 8).
4. **Update the network promise in API.md** to name only your relay.
5. **Later, not now:** a second region needs discovery, or tickets that list several relays.

## Risks and fallbacks

| Risk | Found in | Fallback |
|---|---|---|
| The Buffer patch doesn't compile, or still misses the gate | Phase 0 | **Rust sidecar.** Native iroh speaks `pager/1` and forwards to the Node server over a Unix socket in the data dir (0600). The sidecar adds the endpoint ID as a header it controls and strips any copy sent by the client. |
| xtool can't link IrohLib | Phase 2 | Capacitor with a macOS CI runner |
| Phase 2 stalls, and with Tailscale skipped the phone has no way in | Phase 2 | Set up the Tailscale path in `docs/iphone.md` for the meantime; its code stays until Phase 3 |
| EventSource fails on a custom scheme | Phase 2 | A fetch-stream EventSource passed to `followStream` |
| n0 relay rate limits | Phases 1–2 | Do Phase 4 sooner |
| Local Network prompt confuses users | Phase 2 | Explain it in the app; declining still works through the relay |
| Upstream changes the binding API | Ongoing | The vendored copy stays pinned until you choose to move |
| No background downloads (iroh runs in the app) | Phase 2 | Foreground sync, plus a user-started `BGContinuedProcessingTask` (stage 2 plan) |

## Not in this plan

- **The offline mirror.** It rides on top of this; `GET /api/sync/manifest` is unchanged.
- **Response compression** on the remote app (book HTML gzips about 2.8×). A separate small change
  that can land at any time.
- **Android, the WASM PWA, and multi-relay discovery.**
