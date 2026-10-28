//! Schema migrations, applied in order by `PRAGMA user_version`. Never edit a shipped migration;
//! append a new one. Timestamps are ISO-8601 UTC text. Identical to the TypeScript server's.

pub const MIGRATIONS: &[&str] = &[
    // v1: library, revisions, anchors and everything attached to them, settings, the journal.
    r#"
  CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('file','folder','upload')),
    path TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','indexing','error')),
    error TEXT,
    added_at TEXT NOT NULL,
    removed_at TEXT
  );
  CREATE UNIQUE INDEX sources_live ON sources(kind, path) WHERE removed_at IS NULL;

  CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id),
    format TEXT NOT NULL,
    path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    path_status TEXT NOT NULL DEFAULT 'ok' CHECK (path_status IN ('ok','missing')),
    watch INTEGER NOT NULL DEFAULT 0,
    current_revision_id TEXT,
    src_mtime_ms INTEGER,
    src_size INTEGER,
    title TEXT NOT NULL,
    subtitle TEXT,
    authors TEXT NOT NULL DEFAULT '[]',
    language TEXT,
    identifier TEXT,
    published_at TEXT,
    cover_asset TEXT,
    excerpt TEXT,
    word_count INTEGER NOT NULL DEFAULT 0,
    section_count INTEGER NOT NULL DEFAULT 1,
    title_override TEXT,
    author_override TEXT,
    saved INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL,
    last_opened_at TEXT,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX documents_source ON documents(source_id);
  CREATE INDEX documents_recent ON documents(last_opened_at);
  CREATE INDEX documents_identifier ON documents(identifier) WHERE identifier IS NOT NULL;

  CREATE TABLE document_paths (
    path TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE INDEX document_paths_doc ON document_paths(document_id);

  CREATE TABLE revisions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    content_hash TEXT NOT NULL,
    parser_version INTEGER NOT NULL,
    model_version INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    doc_chars INTEGER NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('added','source-changed','parser-upgraded','reload','import')),
    snapshot TEXT,
    stats TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX revisions_doc ON revisions(document_id, created_at);
  CREATE INDEX revisions_hash ON revisions(content_hash);

  CREATE TABLE anchors (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    owner TEXT NOT NULL CHECK (owner IN ('annotation','record','progress')),
    revision_id TEXT NOT NULL,
    section_id TEXT NOT NULL,
    start_block TEXT NOT NULL,
    start_offset INTEGER NOT NULL,
    end_block TEXT NOT NULL,
    end_offset INTEGER NOT NULL,
    doc_start INTEGER NOT NULL,
    doc_end INTEGER NOT NULL,
    exact TEXT NOT NULL,
    prefix TEXT NOT NULL,
    suffix TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'anchored' CHECK (status IN ('anchored','moved','fuzzy','orphaned')),
    confidence REAL NOT NULL DEFAULT 1,
    original_quote TEXT NOT NULL,
    checked_revision_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX anchors_doc ON anchors(document_id, doc_start);

  CREATE TABLE annotations (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    anchor_id TEXT NOT NULL REFERENCES anchors(id),
    kind TEXT NOT NULL CHECK (kind IN ('highlight','note','bookmark')),
    color TEXT,
    style TEXT NOT NULL DEFAULT 'highlight',
    body TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    request_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX annotations_doc ON annotations(document_id);
  CREATE INDEX annotations_updated ON annotations(updated_at);

  CREATE TABLE tool_records (
    id TEXT PRIMARY KEY,
    tool_id TEXT NOT NULL,
    document_id TEXT REFERENCES documents(id),
    anchor_id TEXT REFERENCES anchors(id),
    data TEXT NOT NULL,
    request_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX tool_records_tool ON tool_records(tool_id, document_id);

  CREATE TABLE progress (
    document_id TEXT PRIMARY KEY REFERENCES documents(id),
    section_id TEXT NOT NULL,
    scroll_offset REAL NOT NULL,
    percent REAL NOT NULL,
    anchor_id TEXT REFERENCES anchors(id),
    updated_at TEXT NOT NULL
  );

  CREATE TABLE settings (
    scope TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('server','client')),
    type TEXT NOT NULL,
    v INTEGER NOT NULL DEFAULT 1,
    document_id TEXT,
    subject_id TEXT,
    payload TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX events_doc ON events(document_id, seq) WHERE document_id IS NOT NULL;
  CREATE INDEX events_type ON events(type, seq);
  "#,
    // v2: anchors remember whether their passage sat in a repeated paragraph (ids of repeats shift).
    r#"
  ALTER TABLE anchors ADD COLUMN ambiguous INTEGER NOT NULL DEFAULT 0;
  "#,
    // v3: full-text search over the current revision of every document, and over annotations.
    r#"
  CREATE VIRTUAL TABLE block_fts USING fts5(text, document_id UNINDEXED, section_id UNINDEXED, block_id UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2');
  CREATE VIRTUAL TABLE annotation_fts USING fts5(quote, body, tags, annotation_id UNINDEXED, document_id UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2');
  CREATE TABLE fts_state (document_id TEXT PRIMARY KEY, revision_id TEXT NOT NULL);
  "#,
    // v4: the Markdown mirror's own writes, reading sessions, and imports waiting for their file.
    r#"
  CREATE TABLE mirror_files (
    document_id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    written_at TEXT NOT NULL
  );
  CREATE TABLE reading_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL REFERENCES documents(id),
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    active_ms INTEGER NOT NULL,
    from_percent REAL,
    to_percent REAL,
    open INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX reading_sessions_doc ON reading_sessions(document_id, started_at);
  CREATE TABLE import_queue (
    id TEXT PRIMARY KEY,
    content_hashes TEXT NOT NULL,
    identifier TEXT,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  "#,
    // v5: paired phones (the remote listener's credentials), and which device wrote the reading place.
    r#"
  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    public_key TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_ip TEXT,
    revoked_at TEXT
  );
  ALTER TABLE progress ADD COLUMN device_id TEXT;
  "#,
    // v6: the iroh endpoint (the phone's public key) a device was paired from. Its token is then good
    // from that endpoint only. One unrevoked row per endpoint: pairing again replaces the old one.
    r#"
  ALTER TABLE devices ADD COLUMN endpoint_id TEXT;
  CREATE UNIQUE INDEX devices_endpoint_live ON devices(endpoint_id) WHERE endpoint_id IS NOT NULL AND revoked_at IS NULL;
  "#,
];

pub const SCHEMA_VERSION: usize = MIGRATIONS.len();
