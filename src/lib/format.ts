const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const SHORT_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** "Oct 22", or "Oct 22, 2025" when not this year. */
export function formatShortDate(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (d.getFullYear() === now.getFullYear() ? SHORT : SHORT_YEAR).format(d);
}

/** Published dates may be a bare year ("1847") or an ISO date. */
export function formatPublished(value: string | undefined): string {
  if (!value) return "";
  if (/^\d{3,4}$/.test(value)) return value;
  return formatShortDate(value);
}

export function formatPercent(fraction: number | undefined): string {
  if (fraction === undefined) return "";
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

/**
 * A reading time: "< 1 min", "6 min", "1 h 5 min", "3 h". `spoken` spells it out for screen
 * readers: "less than a minute", "6 minutes", "1 hour 5 minutes".
 */
export function formatDuration(minutes: number, spoken = false): string {
  if (!Number.isFinite(minutes) || minutes < 1) return spoken ? "less than a minute" : "< 1 min";
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  const hours = h ? (spoken ? plural(h, "hour") : `${h} h`) : "";
  const mins = m || !h ? (spoken ? plural(m, "minute") : `${m} min`) : "";
  return [hours, mins].filter(Boolean).join(" ");
}

export function initials(name: string | undefined): string {
  if (!name) return "?";
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0]?.[0] ?? "?";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Stable hue (0–359) for tinted placeholders, so a source keeps its colour. */
export function hueFor(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 360;
}
