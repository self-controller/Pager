import type {
  Annotation,
  AppSettings,
  AppSettingsPatch,
  CreateAnnotation,
  DeviceView,
  CreateFileInput,
  CreateFileResult,
  DocumentDetail,
  DocumentQuery,
  DocumentSearchResult,
  DocumentSummary,
  Health,
  HighlightQuery,
  IngestJob,
  JournalEvent,
  LibraryAnnotation,
  MoveEntryResult,
  PairingState,
  PairingWindow,
  PairPollResult,
  PairRequestResult,
  ProgressUpdate,
  ReadingProgress,
  Section,
  TagCount,
  TreeResponse,
  UpdateAnnotation,
} from "./types";

/**
 * Everything the UI needs from a backend. `http.ts` implements it against CONTRACT.md and API.md;
 * `mock.ts` implements it in the browser so the shell runs without a backend.
 */
export interface PagerApi {
  /** "mock" or "http": lets the UI explain what is possible (e.g. copying files from a path). */
  readonly mode: "mock" | "http";

  listDocuments(query?: DocumentQuery): Promise<DocumentSummary[]>;
  getDocument(id: string): Promise<DocumentDetail>;
  getSection(docId: string, sectionId: string): Promise<Section>;
  updateDocument(id: string, patch: { saved?: boolean }): Promise<DocumentSummary>;
  deleteDocument(id: string): Promise<void>;
  saveProgress(id: string, update: ProgressUpdate): Promise<ReadingProgress>;

  // ---- The reads folder ----
  /** The whole folder tree with each file's document. */
  getTree(): Promise<TreeResponse>;
  /** A new Markdown file (title and author in its front matter), read into the library at once. */
  createFile(input: CreateFileInput): Promise<CreateFileResult>;
  createFolder(dir: string, name: string): Promise<{ path: string }>;
  /** Rename or move a file or folder; `to` is the full new path. */
  moveEntry(from: string, to: string): Promise<MoveEntryResult>;
  /** Move a file or folder to the library's trash; its documents leave the library. */
  deleteEntry(path: string): Promise<void>;
  /** Copy a file or folder from elsewhere on this machine into `dir`. */
  importPath(dir: string, path: string): Promise<IngestJob>;
  /** Upload a file picked or dropped in the browser into `dir` ("" is the root). */
  uploadFile(file: File, dir?: string): Promise<IngestJob>;
  getJob(id: string): Promise<IngestJob>;

  /** Search every file: title, author and file-name matches plus passages, grouped per document. */
  searchDocuments(q: string): Promise<DocumentSearchResult[]>;

  /** A document's live annotations in reading order (orphans last). */
  listAnnotations(docId: string): Promise<Annotation[]>;
  createAnnotation(docId: string, input: CreateAnnotation): Promise<Annotation>;
  updateAnnotation(id: string, patch: UpdateAnnotation): Promise<Annotation>;
  /** Soft delete; `restoreAnnotation` undoes it. */
  deleteAnnotation(id: string): Promise<void>;
  restoreAnnotation(id: string): Promise<Annotation>;
  /** Highlights and notes across the library, newest first. */
  listHighlights(query?: HighlightQuery): Promise<LibraryAnnotation[]>;
  listTags(): Promise<TagCount[]>;

  /**
   * Live changes (files edited on disk, re-anchoring, other tabs). Calls `onEvent` for each journal
   * event and returns a function that stops listening. The mock has no stream and never calls back.
   */
  subscribe(onEvent: (event: JournalEvent) => void): () => void;

  // ---- The server, and phones paired with it. Backend only: the mock answers `unsupported`. ----
  /** On a phone, `remote.device` says which paired device this is. */
  getHealth(): Promise<Health>;
  /** The server's own settings (the computer only). */
  getAppSettings(): Promise<AppSettings>;
  updateAppSettings(patch: AppSettingsPatch): Promise<AppSettings>;
  /** Show a pairing code on the computer; the phone types it (or scans its QR link). */
  openPairing(): Promise<PairingWindow>;
  getPairing(): Promise<PairingState>;
  approvePairing(requestId: string): Promise<DeviceView>;
  denyPairing(requestId: string): Promise<void>;
  cancelPairing(): Promise<void>;
  listDevices(): Promise<DeviceView[]>;
  renameDevice(id: string, name: string): Promise<DeviceView>;
  /** Revokes an active device; removes one that is already revoked or expired. */
  revokeDevice(id: string): Promise<void>;
  /** On the phone: ask to pair with the computer's code, then poll until it answers. */
  requestPairing(code: string, name: string): Promise<PairRequestResult>;
  pollPairing(request: PairRequestResult): Promise<PairPollResult>;
}
