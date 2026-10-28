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
   * cut-over through a second loopback listener (PAGER_REMOTE_PORT, 3007) behind Tailscale. Off by default.
   */
  remote: {
    enabled: boolean;
    /**
     * The exact HTTPS origin the phone uses over Tailscale, e.g. https://fedora.tail1234.ts.net. The
     * QR link and the CSRF check use it; the server never guesses it from Host. Required to enable.
     */
    origin: string | null;
    /** Your own iroh relay (https://...), or null for n0's public relays. A change restarts the endpoint. */
    relay: string | null;
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
