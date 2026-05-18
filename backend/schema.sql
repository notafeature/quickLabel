-- ===========================================================================
-- QuickLabel cultivation tracker — SQLite schema v0.1
-- ===========================================================================
-- Conventions:
--   * Primary keys are UUIDs stored as TEXT.
--   * Timestamps are UTC ISO 8601 strings.
--   * `created_at`, `updated_at`, `deleted_at` on every mutable table.
--   * `events` is append-only — no UPDATE or DELETE. Corrections are
--     NoteAttach events that reference the prior event_id.
--   * Lots are mutable snapshots of state derivable from the event log.
--   * Soft delete only (deleted_at tombstone) — never hard delete.
--   * `client_id` on events for future merge / sync.
-- ===========================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ---------------------------------------------------------------------------
-- REGISTRIES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS grain_types (
    code        TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS agar_formulas (
    code        TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS substrate_components (
    code        TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS ingest_types (
    code             TEXT PRIMARY KEY,
    label            TEXT NOT NULL,
    derivative_kind  TEXT,            -- 'agar' | 'lc' | NULL
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    deleted_at       TEXT
);

-- ---------------------------------------------------------------------------
-- GENETIC CODES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS genetic_codes (
    id                        TEXT PRIMARY KEY,
    code                      TEXT NOT NULL UNIQUE,
    genus                     TEXT NOT NULL,
    species                   TEXT NOT NULL,
    cultivar                  TEXT,
    colonization_window_days  INTEGER,
    notes                     TEXT,
    created_at                TEXT NOT NULL,
    updated_at                TEXT NOT NULL,
    deleted_at                TEXT
);

-- ---------------------------------------------------------------------------
-- LOTS — one table per kind for clean queries
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ingest_records (
    id                  TEXT PRIMARY KEY,
    lot_id              TEXT NOT NULL UNIQUE,
    genetic_code_id     TEXT NOT NULL REFERENCES genetic_codes(id),
    ingest_type         TEXT NOT NULL REFERENCES ingest_types(code),
    external_source     TEXT,
    lineage_f           INTEGER,
    lineage_c           INTEGER,
    lineage_iso         TEXT,
    lineage_t           INTEGER,
    received_date       TEXT NOT NULL,
    derivative_lot_kind TEXT,       -- 'agar' | 'lc' | NULL
    derivative_lot_id   TEXT,       -- FK to agar_plates.id or liquid_cultures.id
    lifecycle_status    TEXT NOT NULL DEFAULT 'active',
    notes               TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    deleted_at          TEXT
);

CREATE TABLE IF NOT EXISTS agar_plates (
    id               TEXT PRIMARY KEY,
    lot_id           TEXT NOT NULL UNIQUE,
    genetic_code_id  TEXT NOT NULL REFERENCES genetic_codes(id),
    parent_lot_id    TEXT REFERENCES agar_plates(id),  -- wedge/sub-plate from parent
    lineage_f        INTEGER,
    lineage_c        INTEGER,
    lineage_iso      TEXT,
    lineage_t        INTEGER,
    agar_formula     TEXT REFERENCES agar_formulas(code),
    plate_size       TEXT,
    remaining        REAL NOT NULL DEFAULT 1.0,
    lifecycle_status TEXT NOT NULL DEFAULT 'active',
    notes            TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    deleted_at       TEXT
);

CREATE TABLE IF NOT EXISTS liquid_cultures (
    id                TEXT PRIMARY KEY,
    lot_id            TEXT NOT NULL UNIQUE,
    genetic_code_id   TEXT NOT NULL REFERENCES genetic_codes(id),
    parent_lot_id     TEXT REFERENCES liquid_cultures(id),  -- draw from parent LC
    lineage_f         INTEGER,
    lineage_c         INTEGER,
    lineage_iso       TEXT,
    lineage_t         INTEGER,
    vessel_type       TEXT,
    initial_volume_ml REAL NOT NULL,
    remaining_ml      REAL NOT NULL,
    lifecycle_status  TEXT NOT NULL DEFAULT 'active',
    notes             TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    deleted_at        TEXT
);

CREATE TABLE IF NOT EXISTS grain_lots (
    id                 TEXT PRIMARY KEY,
    sterile_lot_id     TEXT UNIQUE,    -- SG-<grain>-<YYMMDD>-<NN>
    inoculated_lot_id  TEXT UNIQUE,    -- GL-<code>-<YYMMDD>-<NN>
    phase              TEXT NOT NULL CHECK(phase IN ('sterile','inoculated')),
    genetic_code_id    TEXT REFERENCES genetic_codes(id),
    lineage_f          INTEGER,
    lineage_c          INTEGER,
    lineage_iso        TEXT,
    lineage_t          INTEGER,
    grain_type         TEXT NOT NULL REFERENCES grain_types(code),
    prep_size          TEXT,
    sterilized_at      TEXT,
    inoculated_at      TEXT,
    colonization_state TEXT NOT NULL DEFAULT 'none'
        CHECK(colonization_state IN ('none','colonizing','colonized')),
    remaining          REAL NOT NULL DEFAULT 1.0,
    lifecycle_status   TEXT NOT NULL DEFAULT 'active',
    notes              TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    deleted_at         TEXT
);

CREATE TABLE IF NOT EXISTS bulk_substrate_recipes (
    id              TEXT PRIMARY KEY,
    code            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    components_json TEXT NOT NULL,
    hydration_target TEXT,
    prep_method     TEXT,
    notes           TEXT,
    extra_json      TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT
);

CREATE TABLE IF NOT EXISTS batches (
    id                   TEXT PRIMARY KEY,
    lot_id               TEXT NOT NULL UNIQUE,
    genetic_code_id      TEXT NOT NULL REFERENCES genetic_codes(id),
    lineage_f            INTEGER,
    lineage_c            INTEGER,
    lineage_iso          TEXT,
    lineage_t            INTEGER,
    recipe_snapshot_json TEXT NOT NULL,
    bulk_mass            REAL,
    bulk_mass_unit       TEXT,
    container_count      INTEGER,
    location             TEXT,
    inoculated_at        TEXT NOT NULL,
    colonization_state   TEXT NOT NULL DEFAULT 'colonizing'
        CHECK(colonization_state IN ('colonizing','colonized','fruiting','spent')),
    lifecycle_status     TEXT NOT NULL DEFAULT 'active',
    notes                TEXT,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL,
    deleted_at           TEXT
);

CREATE TABLE IF NOT EXISTS harvest_lots (
    id                TEXT PRIMARY KEY,
    lot_id            TEXT NOT NULL UNIQUE,
    batch_id          TEXT NOT NULL REFERENCES batches(id),
    genetic_code_id   TEXT NOT NULL REFERENCES genetic_codes(id),
    flush_number      INTEGER NOT NULL,
    wet_weight        REAL,
    wet_weight_unit   TEXT,
    dry_weight        REAL,
    dry_weight_unit   TEXT,
    state             TEXT NOT NULL CHECK(state IN ('wet','dried')) DEFAULT 'wet',
    harvested_at      TEXT NOT NULL,
    dried_at          TEXT,
    lifecycle_status  TEXT NOT NULL DEFAULT 'active',
    notes             TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    deleted_at        TEXT,
    UNIQUE(batch_id, flush_number)
);

-- ---------------------------------------------------------------------------
-- EVENTS (append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS events (
    id                TEXT PRIMARY KEY,
    event_type        TEXT NOT NULL,
    event_date        TEXT NOT NULL,
    recorded_at       TEXT NOT NULL,
    operator_id       TEXT,
    client_id         TEXT NOT NULL,
    subject_lot_kind  TEXT,
    subject_lot_id    TEXT,
    payload_json      TEXT NOT NULL DEFAULT '{}',
    notes             TEXT,
    created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_subject ON events(subject_lot_kind, subject_lot_id);
CREATE INDEX IF NOT EXISTS idx_events_type    ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_date    ON events(event_date);

CREATE TABLE IF NOT EXISTS event_sources (
    id              TEXT PRIMARY KEY,
    event_id        TEXT NOT NULL REFERENCES events(id),
    source_lot_kind TEXT NOT NULL,
    source_lot_id   TEXT NOT NULL,
    amount_consumed REAL,
    amount_unit     TEXT,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_sources_event  ON event_sources(event_id);
CREATE INDEX IF NOT EXISTS idx_event_sources_source ON event_sources(source_lot_kind, source_lot_id);

-- ---------------------------------------------------------------------------
-- PHOTOS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS photos (
    id            TEXT PRIMARY KEY,
    event_id      TEXT REFERENCES events(id),
    lot_kind      TEXT,
    lot_id        TEXT,
    filename      TEXT NOT NULL,
    original_name TEXT,
    mime_type     TEXT,
    size_bytes    INTEGER,
    taken_at      TEXT,
    notes         TEXT,
    created_at    TEXT NOT NULL,
    deleted_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_photos_event ON photos(event_id);
CREATE INDEX IF NOT EXISTS idx_photos_lot   ON photos(lot_kind, lot_id);

-- ---------------------------------------------------------------------------
-- CONTAMINATION FLAGS (denormalized — flagged lots query without walking events)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS contamination_flags (
    id                    TEXT PRIMARY KEY,
    lot_kind              TEXT NOT NULL,
    lot_id                TEXT NOT NULL,
    severity              TEXT NOT NULL CHECK(severity IN ('suspect','confirmed')),
    quarantine            INTEGER NOT NULL DEFAULT 1,
    suspected_contaminant TEXT,
    flag_event_id         TEXT REFERENCES events(id),
    lift_event_id         TEXT REFERENCES events(id),
    active                INTEGER NOT NULL DEFAULT 1,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contam_lot ON contamination_flags(lot_kind, lot_id, active);

-- ---------------------------------------------------------------------------
-- LOT COUNTERS — replaces localStorage `ql_lots`
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lot_counters (
    key        TEXT PRIMARY KEY,    -- e.g. GL_SL192_260518
    counter    INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- SETTINGS (single-row K/V)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
