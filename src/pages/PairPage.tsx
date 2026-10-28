import { useEffect, useId, useState, type FormEvent } from "react";
import { api } from "@/api";
import { useHealth } from "@/api/hooks";
import { ApiError, ErrorCodes, type PairRequestResult } from "@/api/types";
import { Button } from "@/components/ui/Button";

const inputClass =
  "h-11 w-full rounded-sm bg-surface px-3 text-[17px] shadow-[inset_0_0_0_1px_var(--detail)] placeholder:text-fg-3 focus-visible:shadow-[inset_0_0_0_1px_var(--accent),var(--focus-ring)]";

/** What the user types, as the computer shows it: XXXX-XXXX (letters only; RFC 8628's alphabet has no digits). */
export function formatCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8);
  return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

type Step = { kind: "form" } | { kind: "waiting"; request: PairRequestResult } | { kind: "paired" } | { kind: "gone"; message: string };

/**
 * Pairing this phone: the code the computer shows (from the QR link's #code= or typed), a name, then
 * waiting while the computer allows it. The credential arrives as a cookie this installed app keeps;
 * Safari's cookies are not shared with it, so pairing happens inside the installed app.
 */
export function PairPage() {
  const codeId = useId();
  const nameId = useId();
  const health = useHealth();
  const paired = health.data?.remote?.device;
  const [code, setCode] = useState(() => formatCode(new URLSearchParams(window.location.hash.slice(1)).get("code") ?? ""));
  const [name, setName] = useState("iPhone");
  const [step, setStep] = useState<Step>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // iOS Safari says false; the Home Screen app says true; other browsers don't say.
  const inSafari = (navigator as Navigator & { standalone?: boolean }).standalone === false;

  useEffect(() => {
    document.title = "Pair this phone · Pager";
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== 9 || !name.trim()) return;
    setBusy(true);
    setError(null);
    api
      .requestPairing(code, name.trim())
      .then((request) => setStep({ kind: "waiting", request }))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === ErrorCodes.gone) setStep({ kind: "gone", message: err.message });
        else setError(err instanceof ApiError ? err.message : "The reading service isn't reachable right now.");
      })
      .finally(() => setBusy(false));
  };

  // Ask every 2 s until the computer answers. A dropped connection just means asking again.
  useEffect(() => {
    if (step.kind !== "waiting") return;
    let stopped = false;
    let timer = 0;
    const ask = async () => {
      try {
        const answer = await api.pollPairing(step.request);
        if (stopped) return;
        if ("token" in answer) {
          setStep({ kind: "paired" });
          // Ask the browser to keep this app's storage; the answer doesn't change anything here.
          await navigator.storage?.persist?.().catch(() => false);
          window.location.assign("/");
          return;
        }
      } catch (err) {
        if (stopped) return;
        if (err instanceof ApiError && err.code === ErrorCodes.gone) return setStep({ kind: "gone", message: err.message });
      }
      timer = window.setTimeout(ask, 2000);
    };
    timer = window.setTimeout(ask, 2000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [step]);

  const startAgain = () => {
    setCode("");
    setError(null);
    setStep({ kind: "form" });
  };

  return (
    <main className="flex min-h-dvh justify-center px-5 pt-[max(48px,env(safe-area-inset-top))] pb-[max(32px,env(safe-area-inset-bottom))]">
      <div className="flex w-full max-w-[400px] flex-col gap-6">
        <p className="font-display text-[28px] leading-9 font-bold">Pager</p>

        {step.kind === "waiting" || step.kind === "paired" ? (
          <section className="flex flex-col gap-4" aria-live="polite">
            <h1 className="font-display text-[22px] leading-7 font-semibold">{step.kind === "paired" ? "Paired. Opening your library…" : "Waiting for approval on your computer…"}</h1>
            {step.kind === "waiting" && (
              <>
                <p className="text-[15px] leading-6 text-fg-2">
                  Your computer is asking whether “{name.trim()}” may read your library. Choose Allow there.
                </p>
                <div>
                  <Button variant="tertiary" onClick={startAgain}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </section>
        ) : step.kind === "gone" ? (
          <section className="flex flex-col gap-4">
            <h1 className="font-display text-[22px] leading-7 font-semibold">That didn't work</h1>
            <p className="text-[15px] leading-6 text-fg-2">{step.message}</p>
            <p className="text-[15px] leading-6 text-fg-2">On your computer, open Settings, then Phone, then Pair a phone, and type the new code here.</p>
            <div>
              <Button variant="primary" onClick={startAgain}>
                Start again
              </Button>
            </div>
          </section>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <h1 className="font-display text-[22px] leading-7 font-semibold">Pair this phone</h1>
              <p className="text-[15px] leading-6 text-fg-2">
                On your computer, open Pager, then Settings, then Phone, and choose Pair a phone. Type the code it shows.
              </p>
            </div>
            {inSafari && (
              <p className="rounded-sm bg-surface-2 px-3 py-2.5 text-[14px] leading-5">
                Add Pager to your Home Screen first, then pair from there. The installed app has its own storage. (Share, then Add to Home Screen.)
              </p>
            )}
            {paired && (
              <p className="rounded-sm bg-surface-2 px-3 py-2.5 text-[14px] leading-5">
                This phone is already paired as “{paired.name}”.{" "}
                <a href="/" className="font-semibold text-accent underline">
                  Open your library
                </a>
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor={codeId} className="text-[14px] leading-5 font-semibold">
                Code
              </label>
              <input
                id={codeId}
                className={`${inputClass} font-mono tracking-[0.12em] uppercase`}
                value={code}
                onChange={(e) => setCode(formatCode(e.target.value))}
                placeholder="XXXX-XXXX"
                autoCapitalize="characters"
                autoComplete="one-time-code"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                aria-describedby={error ? `${codeId}-error` : undefined}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={nameId} className="text-[14px] leading-5 font-semibold">
                Name for this phone
              </label>
              <input id={nameId} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoComplete="off" />
            </div>
            {error && (
              <p id={`${codeId}-error`} role="alert" className="rounded-sm bg-surface-2 px-3 py-2 text-[14px] leading-5 text-error">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" disabled={busy || code.length !== 9 || !name.trim()}>
              {busy ? "Sending…" : "Pair"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
