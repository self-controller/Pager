import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Smartphone } from "lucide-react";
import {
  useAppSettings,
  useApprovePairing,
  useCancelPairing,
  useDenyPairing,
  useDevices,
  useHealth,
  useOpenPairing,
  usePairing,
  useRenameDevice,
  useRevokeDevice,
  useUpdateAppSettings,
} from "@/api/hooks";
import { ApiError, type DeviceView } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { cx } from "@/lib/cx";
import { formatShortDate } from "@/lib/format";
import { QrCode } from "./QrCode";

const inputClass =
  "h-10 w-full min-w-0 rounded-sm bg-surface px-3 text-[15px] shadow-[inset_0_0_0_1px_var(--detail)] placeholder:text-fg-3 focus-visible:shadow-[inset_0_0_0_1px_var(--accent),var(--focus-ring)]";

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again in a moment.";
}

function Alert({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-sm bg-surface-2 px-3 py-2 text-[13px] leading-[18px] text-error">
      {errorText(error)}
    </p>
  );
}

function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-6 w-10 shrink-0 rounded-full transition-hover disabled:opacity-50",
        checked ? "bg-accent" : "bg-surface-3 shadow-[inset_0_0_0_1px_var(--detail)]",
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 left-0.5 size-5 rounded-full bg-elevated shadow-sm transition-transform",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}

/**
 * Settings → Phone: remote access through tailscale serve, the address the phone uses, pairing a
 * phone with a code the desktop approves, and the phones paired so far. The computer only.
 */
export function PhoneSettings() {
  const settings = useAppSettings();
  const health = useHealth();
  const update = useUpdateAppSettings();
  const originId = useId();
  const remote = settings.data?.remote;
  const [origin, setOrigin] = useState("");
  const [pairing, setPairing] = useState(false);
  const suggested = health.data?.remote?.suggestedOrigin;
  const computerId = health.data?.remote?.endpointId;
  const relay = health.data?.remote?.relay;

  useEffect(() => {
    if (remote) setOrigin(remote.origin ?? "");
  }, [remote?.origin]);

  if (settings.error) return <Alert error={settings.error} />;
  if (!remote) return <p className="text-[14px] leading-5 text-fg-2">Loading…</p>;

  const typed = origin.trim();
  const saveOrigin = (e?: FormEvent) => {
    e?.preventDefault();
    update.mutate({ remote: { origin: typed || null } });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[15px] leading-5 font-medium">Remote access</span>
          <span className="text-[13px] leading-[18px] text-fg-2">
            Read your library on your phone, anywhere: with the Pager app over iroh, or through Tailscale. Off until you turn it
            on; only phones you pair can read.
          </span>
        </div>
        <Switch
          label="Remote access"
          checked={remote.enabled}
          disabled={update.isPending}
          onChange={(enabled) =>
            update.mutate({
              remote: enabled && typed !== (remote.origin ?? "") ? { enabled, origin: typed || null } : { enabled },
            })
          }
        />
      </div>

      <form onSubmit={saveOrigin} className="flex flex-col gap-1.5">
        <label htmlFor={originId} className="text-[14px] leading-5 font-semibold">
          Your computer's address for the phone
        </label>
        <div className="flex gap-2">
          <input
            id={originId}
            className={inputClass}
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            placeholder="https://my-pc.tail1234.ts.net"
            spellCheck={false}
            autoComplete="off"
            inputMode="url"
          />
          <Button type="submit" variant="secondary" disabled={update.isPending || typed === (remote.origin ?? "")}>
            Save
          </Button>
        </div>
        <span className="text-[13px] leading-[18px] text-fg-2">
          The https address <code className="font-mono text-[12px]">tailscale serve</code> gives this computer. See
          docs/iphone.md.
        </span>
        {suggested && suggested !== remote.origin && (
          <div>
            <Button
              size="sm"
              variant="tertiary"
              onClick={() => {
                setOrigin(suggested);
                update.mutate({ remote: { origin: suggested } });
              }}
            >
              Use my tailnet name ({suggested.replace(/^https:\/\//, "")})
            </Button>
          </div>
        )}
      </form>
      <Alert error={update.error} />

      {computerId && (
        <div className="flex flex-col gap-1">
          <span className="text-[14px] leading-5 font-semibold">This computer's ID</span>
          <span className="text-[13px] leading-[18px] text-fg-2">
            The Pager app dials this ID over iroh; the pairing link carries it.{" "}
            <code className="font-mono text-[12px] select-all" title={computerId}>
              {computerId.slice(0, 10)}…
            </code>
            {relay ? ` · relay ${relay.replace(/^https?:\/\//, "").replace(/\.?\/?$/, "")}` : " · no relay reached yet"}
          </span>
        </div>
      )}

      <div>
        <Button variant="primary" icon={Smartphone} disabled={!remote.enabled || !remote.origin} onClick={() => setPairing(true)}>
          Pair a phone
        </Button>
      </div>

      <DeviceList />
      <PairDialog open={pairing} onClose={() => setPairing(false)} />
    </div>
  );
}

const STATUS: Record<DeviceView["status"], string> = {
  active: "Paired",
  revoked: "Revoked",
  expired: "Expired (unused for 90 days)",
};

function DeviceList() {
  const devices = useDevices();
  if (devices.error) return <Alert error={devices.error} />;
  if (!devices.data?.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-[14px] leading-5 font-semibold">Paired phones</h3>
      <ul className="flex flex-col divide-y divide-detail">
        {devices.data.map((d) => (
          <DeviceRow key={d.id} device={d} />
        ))}
      </ul>
    </div>
  );
}

function DeviceRow({ device }: { device: DeviceView }) {
  const rename = useRenameDevice();
  const revoke = useRevokeDevice();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.name);
  const active = device.status === "active";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name.trim() === device.name) return setEditing(false);
    rename.mutate({ id: device.id, name: name.trim() }, { onSuccess: () => setEditing(false) });
  };
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {editing ? (
          <form onSubmit={submit} className="flex min-w-[200px] flex-1 gap-2">
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              aria-label="Device name"
              autoFocus
            />
            <Button type="submit" size="sm" variant="secondary" className="h-10">
              Save
            </Button>
          </form>
        ) : (
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left text-[15px] leading-5 font-medium hover:underline"
            title="Rename"
            onClick={() => {
              setName(device.name);
              setEditing(true);
            }}
          >
            {device.name}
          </button>
        )}
        <Button
          size="sm"
          variant={active ? "secondary" : "tertiary"}
          disabled={revoke.isPending}
          onClick={() => revoke.mutate(device.id)}
        >
          {active ? "Revoke" : "Remove"}
        </Button>
      </div>
      <span className={cx("text-[13px] leading-[18px]", active ? "text-fg-2" : "text-fg-3")}>
        {STATUS[device.status]} · last seen {formatShortDate(device.lastSeenAt)}
        {device.lastIp ? ` from ${device.lastIp}` : ""}
        {device.endpointId ? " · over iroh" : ""}
      </span>
      <Alert error={rename.error ?? revoke.error} />
    </li>
  );
}

function useCountdown(expiresAt: string | undefined): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [expiresAt]);
  if (!expiresAt) return "";
  const left = Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

/** The code and its QR link, then "Allow …?" when a phone asks. The window lives five minutes. */
function PairDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const start = useOpenPairing();
  const cancel = useCancelPairing();
  const approve = useApprovePairing();
  const deny = useDenyPairing();
  const state = usePairing(open);
  const [paired, setPaired] = useState<DeviceView | null>(null);
  const opened = useRef(false);
  const w = state.data;
  const countdown = useCountdown(w?.open ? w.expiresAt : undefined);

  const begin = () => {
    setPaired(null);
    approve.reset();
    deny.reset();
    // A window already open (another tab) is shown as it is.
    start.mutate(undefined, {
      onSettled: () => void state.refetch(),
      onError: (e) => (e instanceof ApiError && e.code === "conflict" ? start.reset() : undefined),
    });
  };

  useEffect(() => {
    if (open && !opened.current) begin();
    opened.current = open;
  }, [open]);

  const close = () => {
    if (w?.open) cancel.mutate();
    onClose();
  };

  let body;
  if (paired) {
    body = (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <p className="font-display text-[19px] leading-7 font-semibold">“{paired.name}” can read your library now.</p>
        <p className="text-[14px] leading-5 text-fg-2">You can revoke it here at any time.</p>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    );
  } else if (w?.open && w.pending) {
    const p = w.pending;
    body = (
      <div className="flex flex-col gap-4 py-2">
        <p className="font-display text-[19px] leading-7 font-semibold">Allow “{p.name}” to read your library?</p>
        <p className="text-[14px] leading-5 text-fg-2">
          Only allow it if you just typed the code on your own phone{p.ip ? ` (it asked from ${p.ip})` : ""}.
        </p>
        <Alert error={approve.error ?? deny.error} />
        <div className="flex justify-end gap-2">
          <Button variant="tertiary" disabled={deny.isPending || approve.isPending} onClick={() => deny.mutate(p.requestId)}>
            Deny
          </Button>
          <Button
            variant="primary"
            disabled={deny.isPending || approve.isPending}
            onClick={() => approve.mutate(p.requestId, { onSuccess: setPaired })}
          >
            Allow
          </Button>
        </div>
      </div>
    );
  } else if (w?.open && w.code && w.url) {
    body = (
      <div className="flex flex-col items-center gap-4 text-center">
        <QrCode text={w.url} size={208} label={`QR code for ${w.url}`} />
        <p className="text-[14px] leading-5 text-fg-2">
          On your phone, open Pager from the Home Screen and type this code. Not installed yet? Scan the QR code to open Pager
          in Safari, then Share → Add to Home Screen, and type the code in the installed app.
        </p>
        <p
          className="font-mono text-[28px] leading-9 font-semibold tracking-[0.12em] select-all"
          aria-label={`Code ${w.code.split("").join(" ")}`}
        >
          {w.code}
        </p>
        <p className="text-[13px] leading-[18px] text-fg-3" aria-live="polite">
          Expires in {countdown}
          {w.attempts ? ` · ${w.attempts} wrong ${w.attempts === 1 ? "try" : "tries"} of 5` : ""}
        </p>
      </div>
    );
  } else if (w && !w.open) {
    body = (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <p className="text-[15px] leading-6">
          {w.attempts >= 5 ? "The code was typed wrong too many times." : "That code has expired."}
        </p>
        <Button variant="primary" onClick={begin}>
          New code
        </Button>
      </div>
    );
  } else body = <p className="py-6 text-center text-[14px] text-fg-2">Opening a pairing code…</p>;

  return (
    <Dialog open={open} onClose={close} title="Pair a phone">
      <div className="flex flex-col gap-3 p-5">
        <Alert error={start.error ?? state.error} />
        {body}
      </div>
    </Dialog>
  );
}
