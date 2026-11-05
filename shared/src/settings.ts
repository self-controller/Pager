/**
 * Settings are stored by the server and shaped by the UI. Reading settings are opaque JSON objects in
 * two scopes (global, per document); the effective value is a shallow merge, document over global.
 * In a PATCH, a key set to null is removed from that scope. App settings control the server itself.
 *
 * Type-only module: cross-file imports in shared/ must be `import type`.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type SettingsObject = { [key: string]: JsonValue };

/**
 * A suggested starting vocabulary for reading settings. The server does not validate keys; the UI
 * owns this list and can extend it freely.
 */
export interface ReadingSettingsSuggestion {
  theme: string;
  typeface: string;
  headingTypeface: string | null;
  fontOffset: number;
  lineHeight: number;
  /** Text column width in characters. */
  measure: number;
  paragraphSpacing: number;
  paragraphIndent: number;
  justify: boolean;
  hyphenate: boolean;
  layout: "scroll" | "paged";
  notes: "popover" | "end";
  remoteImages: "block" | "allow";
  customCss: string;
  /** Who Context briefings are written for (the UI keeps it in src/state/settings.ts). */
  contextLevel: "general" | "student" | "scholar";
}

export interface AppSettings {
  mirror: {
    /** Write a Markdown file of each document's annotations. */
    enabled: boolean;
    /** Folder for the mirror; null means `<data dir>/notes`. */
    dir: string | null;
  };
  /** Recording switches for the journal. Off means nothing in that category is written. */
  record: {
    /** nav.*: sections opened, links and footnotes followed. */
    navigation: boolean;
    /** lookup.*: words and names looked up. */
    lookups: boolean;
    /** search.*: what you searched for. */
    search: boolean;
    /** Reading sessions (when you read, for how long). */
    sessions: boolean;
    /** Anything else the UI sends. */
    other: boolean;
  };
  /** Stop the background server after this long with no open tabs; 0 = never. */
  idleShutdownMinutes: number;
  /**
   * Reading from a paired phone: over iroh (the computer's endpoint, dialled by ID), and until the
   * cut-over through a second loopback listener (PAGER_REMOTE_PORT, 3007) behind Tailscale, which runs
   * only while `origin` is set. Off by default.
   */
  remote: {
    enabled: boolean;
    /**
     * The exact HTTPS origin the phone uses over Tailscale, e.g. https://fedora.tail1234.ts.net, or null.
     * Optional: only the Tailscale path uses it (its QR link and CSRF check); the server never guesses
     * it from Host.
     */
    origin: string | null;
    /** Your own iroh relay (https://...), or null for n0's public relays. A change restarts the endpoint. */
    relay: string | null;
    /**
     * The bearer token your relay asks for (iroh-relay's `access.shared_token`), or null. Needs `relay`;
     * clearing `relay` clears it. The pairing link carries it (`rt`) so phones can use the relay too.
     */
    relayToken: string | null;
  };
  /** Context briefings (API.md, "Context"). */
  context: {
    /**
     * Paid runs (a new briefing or a Refresh) each paired phone may start in a rolling 24 hours: a
     * whole number from 0 (phones only open briefings already made) to 100. Default 10. The
     * computer is never limited.
     */
    phoneDailyLimit: number;
  };
}

export interface SettingsResponse {
  /** global merged with document. */
  effective: SettingsObject;
  global: SettingsObject;
  /** Null when no docId was asked for. */
  document: SettingsObject | null;
  /** Local listener only: never sent to a paired device (mirror.dir is a path on the computer). */
  app?: AppSettings;
}

/** A named snapshot of reading settings the UI can apply to a scope. */
export interface Preset {
  id: string;
  name: string;
  values: SettingsObject;
  createdAt: string;
  updatedAt: string;
}
