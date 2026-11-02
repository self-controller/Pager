# Your own relay

Pager on your computer and the Pager app on your phone connect directly when the networks allow it.
When they don't, a **relay** passes their packets on. Until you run your own, Pager uses n0's public
relays and discovery (n0 makes iroh). Your own relay comes before anyone else uses Pager.

The relay can't read your library. iroh encrypts every connection end to end, and the relay only
forwards the encrypted packets. A token decides who may use it: your computer, and the phones you
pair, which get the token from the pairing link.

You need:
- a small Linux VPS with a public IPv4 address (about $2–5 a month; 1 CPU and 512 MB are plenty);
- a domain name you control, for the relay's TLS certificate;
- Rust on the VPS, or another way to put the `iroh-relay` binary there.

The files are in `relay/` in this repository: `iroh-relay.toml` (the config) and
`iroh-relay.service` (the systemd unit). Run the `sudo` commands below yourself.

## 1. A name for the VPS

Add a DNS record for a name such as `relay.example.com`:
- an `A` record with the VPS's IPv4 address;
- an `AAAA` record with its IPv6 address, if it has one.

Check it from your computer with `dig +short relay.example.com`. It should show the VPS's address.

## 2. Open the ports

| Port | For |
|---|---|
| TCP 80 | LetsEncrypt's certificate check, and the captive-portal probe |
| TCP 443 | The relay itself (HTTPS) |
| UDP 7842 | QUIC address discovery: phones and your computer learn their public address |

Open them in the VPS provider's firewall, and in the VPS's own if it runs one. For example, with
firewalld:

```sh
sudo firewall-cmd --permanent --add-service=http --add-service=https --add-port=7842/udp
sudo firewall-cmd --reload
```

With ufw: `sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 7842/udp`.

## 3. Install iroh-relay

Use the same version as Pager's iroh (1.4.1, in `server/Cargo.lock`). On the VPS:

```sh
sudo cargo install iroh-relay@1.4.1 --features server --locked --root /usr/local
/usr/local/bin/iroh-relay --help
```

The build takes a few minutes. A VPS with 512 MB may run out of memory; add swap, or build on your
computer with `cargo install ... --root ./relay-bin` and copy `relay-bin/bin/iroh-relay` to
`/usr/local/bin/` on the VPS. Build on the same distribution, or a glibc at least as old.

## 4. The token and the config

1. Make a token:

   ```sh
   openssl rand -hex 32
   ```

   Keep it for step 6. It goes in two places only: this config and Pager's settings.

2. Copy the config into place, root-only:

   ```sh
   sudo install -d -m 0700 /etc/iroh-relay
   sudo install -m 0600 relay/iroh-relay.toml /etc/iroh-relay/iroh-relay.toml
   sudoedit /etc/iroh-relay/iroh-relay.toml
   ```

3. In the config, change:
   - `hostname` to your name from step 1;
   - `PASTE-YOUR-TOKEN-HERE` to the token;
   - `contact` to your email. LetsEncrypt requires one, and sends expiry notices there.

   The `[limits]` section caps new connections and each client's traffic, in case the token leaks.
   10 MB/s per client is more than a phone needs to read.

## 5. Start it

```sh
sudo install -m 0644 relay/iroh-relay.service /etc/systemd/system/iroh-relay.service
sudo systemctl daemon-reload
sudo systemctl enable --now iroh-relay
systemctl status iroh-relay
journalctl -u iroh-relay -n 50
```

The first start fetches a certificate from LetsEncrypt, which can take a minute. Then, from your
computer:

```sh
curl -sI https://relay.example.com/ping          # HTTP/2 200
curl -s -o /dev/null -w '%{http_code}\n' https://relay.example.com/generate_204   # 204
```

The unit runs the relay as its own user, made for the service. That user can bind ports 80 and 443
and do nothing else. The config with the token stays root-only; systemd hands the relay a copy.

## 6. Point Pager at it

On the computer, open **Settings → Phone → Your own relay**:

1. **Relay address:** `https://relay.example.com`.
2. **Token:** the token from step 4.
3. Choose **Save**.

Pager restarts its iroh endpoint on the new relay. After a few seconds, "This computer's ID" shows
`relay relay.example.com`. If it says "no relay reached yet" and stays that way, see the table below.

With your own relay set, Pager connects to that one host for phones, with no n0 discovery. A phone
needs the relay's address and token to reach the computer from another network. Both come in the
pairing link, so **pair your phones again**. The app can also catch up by itself: on the same Wi-Fi
as the computer it still connects directly, and then picks up the new relay and token from the
computer. The fake phone can't.

To go back to n0's relays, clear **Relay address** and choose **Save**. That clears the token too.

## 7. Check it with the fake phone

Before you rely on it, check the relay path with the fake phone (`docs/iphone.md` §4.3):

1. Choose **Pair a phone** and copy the link under the QR code. It ends in `&rt=<token>`.
2. Run the fake phone with `--relay-only`, so it uses only the relay:

   ```sh
   cd ~/Desktop/projects/Pager/server
   cargo run --release --example fake-phone -- 'pager://pair?...&rt=...' --key ~/fake-phone.key --relay-only
   ```

3. Choose **Allow** on the computer. The fake phone reads, and **Settings → Phone** lists it as last
   seen `from relay`.

The fake phone uses only your relay when the link has a token, as the app does. To check that the
token is enforced, run it again with `--relay-token wrong-token-0123456789` in place of the link's.
It should stop with "couldn't reach the computer".

## When it doesn't work

| What you see | Why | What to do |
|---|---|---|
| `systemctl status iroh-relay` shows it failed with a credential error | `/etc/iroh-relay/iroh-relay.toml` is missing | Step 4.2. |
| The log says LetsEncrypt failed | The name doesn't point at the VPS yet, or TCP 80 is closed | `dig +short` (step 1); open port 80 (step 2). LetsEncrypt limits failed attempts, so wait a few minutes between tries. |
| `curl https://…/ping` times out | TCP 443 is closed, or the relay isn't running | Step 2; `journalctl -u iroh-relay`. |
| Settings → Phone says "no relay reached yet" | The token in Pager doesn't match the config, or the address is wrong | Paste the token again; check the address matches `hostname`. |
| A phone reads at home but not on cellular | It was paired before you set the relay, or the token changed | Pair it again. |
| Saving says the token is invalid | Pager takes 16 to 256 visible characters, no spaces | Use `openssl rand -hex 32`. |
