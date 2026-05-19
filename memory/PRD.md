# QuickLabel — Memory / Session Log

**App:** Label printer + cultivation tracker.
**Files:**
- `/app/quicklabel.html` — label printer (still localStorage; has header link to tracker)
- `/app/tracker.html` — cultivation tracker UI (NEW, API-backed)
- `/app/backend/` — FastAPI + SQLite cultivation tracking API
- `/app/data/quicklabel.db` — SQLite database (WAL mode)
- `/app/data/photos/` — photo storage
- `/app/PRD.md` — core PRD
- `/app/PRD-genetics-tracking.md` — pre-grain workflows
- `/app/PRD-data-model.md` — Layer 1 conceptual data model
- `/app/PRD-cultivation-api.md` — Layer 2 API reference

---

## Architecture

- **Routes (served by `/app/frontend/server.js` on :3000):**
  - `/` and `/quicklabel` → `quicklabel.html` (the label printer, unchanged)
  - `/tracker` → `tracker.html` (the cultivation tracker, NEW)
- **Backend:** FastAPI on :8001 with `/api/*` routes. SQLite at `/app/data/`.
- **DB:** UUIDs as PKs, soft-delete tombstones, append-only events, dual-date
  (`event_date` physical, `recorded_at` system), `client_id` for future merge.
- **Photos:** filesystem under `/app/data/photos/<uuid>.<ext>`.

The two frontends coexist. Both reference the same backend.

---

## Tracker UI (`tracker.html`)

Single-file vanilla JS app. Sections:

| Nav | View | Purpose |
|-----|------|---------|
| Dashboard | counts + rollups | wired to `/api/dashboard/summary` |
| Genetics | CRUD | list + create genetic codes |
| Ingest | form | IngestEvent + auto-derivative |
| Agar Plate | tabs | PlateAgar (new) + DrawAgar (wedge) |
| Liquid Culture | tabs | PlateLC + DrawLC (hierarchical partial consumption) |
| Grain | tabs | SterilizeGrain (N bags) + InoculateGrain |
| Spawn → Bulk | form | fan-in N grain lots + recipe → batch |
| Harvest | tabs | Harvest (wet) + Dry |
| Inventory | list | active lots by kind |
| Lineage | walker | resolve any lot ID → backward + forward tree |
| Recipes | CRUD | bulk substrate recipes |
| Migrate | one-shot | imports `ql_cfg` from localStorage |

**Source-lot fields take human-readable IDs** (e.g. `SP-SL192-260518-01`) and
resolve to UUIDs via `/api/lineage/by-lot-id/{lot_id}`. Lineage tab also accepts
lot IDs directly.

**Migration:** the Migrate panel reads `localStorage.ql_cfg` from the label
printer's settings and pushes grain types, agar formulas, ingest types, and
genetic codes into the DB. Sets `ql_migrated_at` to suppress re-prompts.
Toast banner on first load if `ql_cfg` exists but `ql_migrated_at` doesn't and
`genetics` table is empty.

**Smoke verified end-to-end:**
- All 12 nav sections render and activate
- Creating a genetic via the Genetics form → appears in table → dashboard
  counts update (`GENETICS: 1` → `2` after add)
- No JS errors

---

## Backend additions this session

- `/app/backend/routers/dashboard.py` — `GET /api/dashboard/summary` returning
  counts of (genetics, ingest, agar active/exhausted/contam, LC active +
  remaining mL, grain sterile/inoculated/contam, batches colonizing/fruiting,
  harvests wet/dried + total g, contamination active flags).

Smoke test still passes: `cd /app/backend && python3 tests/test_smoke.py`.

---

## P0 Backlog (next session)

- Photo upload UI (attach to any event). Backend ready.
- Per-lot detail view: history timeline of events on a single lot, with
  contamination flag / break-and-shake / consume actions inline.
- Editable settings panel (operator tracking toggle, default colonization window).

## P1 Backlog

- "Wedge / draw from current plate" shortcut buttons in inventory rows.
- "Ready for spawn-to-bulk" + "Ready for fruiting" calendar views.
- KPI graphs (wet→dry yield by cultivar, contamination rate, time-in-stage).
- localStorage migration coverage: lot counters, in-flight form state.

## P2 / Future

- Air-gap packaging (Tauri or PyInstaller).
- Optional sync endpoint for hosted instances.
- Space designer UI for batch fruit-room layout.
- Operator tracking enabled-by-toggle UI.
- Homogenization → product lots (out of v1 scope).
