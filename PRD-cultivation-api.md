# QuickLabel — Cultivation API Reference (Layer 2)

**Version:** 0.1
**Status:** Backend complete and smoke-tested end-to-end.
**Stack:** FastAPI 0.110 · Pydantic 2 · SQLite (WAL) · file-on-disk photos.
**DB path:** `/app/data/quicklabel.db` · **Photos:** `/app/data/photos/<uuid>.<ext>`
**Base URL:** `${REACT_APP_BACKEND_URL}/api` (or `http://localhost:8001/api` locally)

See `/app/PRD-data-model.md` for the conceptual model behind everything below.

---

## Resolved open questions (from PRD-data-model.md §9)

| # | Topic | Resolution |
|---|-------|-----------|
| 1 | Sterile grain prefix | Two IDs, one entity. `SG-<grain>-<YYMMDD>-<NN>` while sterile; `GL-<code>-<YYMMDD>-<NN>` added at InoculateGrain. Same row. |
| 2 | LC sub-lots | Replaced with **hierarchical partial consumption**: `parent_lot_id` pointer on LiquidCulture (and AgarPlate). `DrawLC` / `DrawAgar` events create children that are themselves independently partially consumable. Parent decrements on draw. Bulk-jar → straight-to-bags also works (skip the draw, just inoculate from the parent). |
| 3 | Recipe minimum fields | Accepted §3.6 proposal. `components_json` carries the structured list, `extra_json` holds flexible extension fields for future strict definitions. |
| 4 | Multi-source batch lineage | Highest T-value across grain inputs becomes the Batch's lineage_t. Full per-input lineage retained on the event payload. |
| 5 | Genetic-code disagreement | **Hard error.** SpawnToBulk refuses if any two grain inputs disagree on genetic_code. Mixed-genetic batches are disallowed by design. |
| 6 | Colonization windows | Per-genetic field `colonization_window_days` on `genetic_codes`. Fallback global default in settings. Used only for KPIs, never enforced. Two distinct colonization phases tracked: grain spawn (`grain_lots.colonization_state`) and bulk (`batches.colonization_state`). |
| 7 | Flush numbering | Per-batch. `(batch_id, flush_number)` is unique. |
| 8 | IngestRecord remaining | **Auto-create derivative.** Ingest types with `derivative_kind='agar'` or `'lc'` auto-create the corresponding lot, which carries `remaining`. The IngestRecord stays as the always-leaf root. |
| 9 | Quarantine | **Expose via walk, don't mutate downstream.** Confirmed contamination flag sets only the subject lot's `lifecycle_status='contaminated'`. Downstream lots are visible via `forward_walk` but their statuses are untouched. Operator decides per-lot. |
| 10 | Recipe versioning | **Snapshot at SpawnToBulk.** Full recipe contents copied into `batches.recipe_snapshot_json`. Recipe edits affect future batches only. |
| 11 | Event mutability | Notes editable; structured fields not (corrections via NoteAttach event). Currently enforced by convention; no UPDATE endpoint on `events`. |
| 12 | Photo storage | Filesystem at `/app/data/photos/<uuid>.<ext>`. Multipart upload at `POST /api/photos`. References stored as photo UUIDs in event records. |
| 13 | Unified grain entity | Confirmed. One row in `grain_lots` per physical bag, two phases. |

---

## Lot ID conventions

All allocated by `lots.allocate_lot_id(conn, prefix, code, iso_date)`. Counter
scoped to `(prefix, code, YYMMDD)`. Resets daily per (prefix, code).

| Prefix | Entity | Example | Notes |
|--------|--------|---------|-------|
| `SP`, `SS`, `LC`, `GT`, `AP`, `SN`, `CT` | IngestRecord | `SP-SL192-260518-01` | Prefix = ingest type code |
| `AL` | AgarPlate | `AL-SL192-260518-02` | |
| `LC` | LiquidCulture | `LC-SL192-260518-01` | LC ingest derivative also gets an LC- ID |
| `SG` | GrainLot (sterile) | `SG-RYE-260518-03` | grain_type substitutes for genetic code |
| `GL` | GrainLot (inoculated) | `GL-SL192-260518-01` | Same row as SG; assigned at inoculation |
| `BL` | Batch | `BL-SL192-260518-01` | Spawn-to-bulk product |
| `HL` | HarvestLot | `HL-SL192-260518-01` | One per flush |

---

## Endpoints

### System

```
GET  /api/health
POST /api/system/init                    # re-run seed (idempotent)
GET  /api/system/settings
PUT  /api/system/settings/{key}          # body: {"value": ...}
POST /api/system/counters/peek           # body: {prefix, code?, date?}
POST /api/system/counters/next           # body: {prefix, code?, date?}
POST /api/system/counters/reset          # body: {prefix, code?, date?, to}
```

### Registries

`grain-types`, `agar-formulas`, `substrate-components`, `ingest-types`. All
follow the same shape (ingest-types adds a `derivative_kind`):

```
GET    /api/registries/{kind}
PUT    /api/registries/{kind}/{code}     # upsert; body: {code, description, ...}
DELETE /api/registries/{kind}/{code}     # soft delete
```

### Genetics

```
GET    /api/genetics
POST   /api/genetics                     # body: GeneticCodeIn
GET    /api/genetics/{id}
PATCH  /api/genetics/{id}                # body: GeneticCodeIn
DELETE /api/genetics/{id}                # soft delete
```

### Ingest

```
GET  /api/ingest
GET  /api/ingest/{id}
POST /api/ingest                          # IngestEventIn — creates IngestRecord
                                          # + auto-derivative AgarPlate or LC if applicable
```

### Agar

```
GET  /api/agar
GET  /api/agar/{id}
POST /api/agar/plate                      # PlateAgarIn — fresh plate from any source
POST /api/agar/draw                       # DrawAgarIn — wedge from a parent plate
```

### Liquid culture

```
GET  /api/lc
GET  /api/lc/{id}
POST /api/lc/plate                        # PlateLCIn — new LC from agar/LC source
POST /api/lc/draw                         # DrawLCIn — child LC (syringe etc.) from parent
```

### Grain

```
GET  /api/grain?phase=sterile|inoculated
GET  /api/grain/{id}
POST /api/grain/sterilize                 # SterilizeGrainIn (count=N produces N bags)
POST /api/grain/inoculate                 # InoculateGrainIn — transitions sterile→inoculated
```

### Recipes

```
GET    /api/recipes
POST   /api/recipes                       # RecipeIn
GET    /api/recipes/{id}
PATCH  /api/recipes/{id}
DELETE /api/recipes/{id}
```

### Batches

```
GET  /api/batches
GET  /api/batches/{id}
POST /api/batches/spawn-to-bulk           # SpawnToBulkIn — fan-in N grain lots + one recipe
                                          # Hard-fails on multi-genetic input.
```

### Harvests

```
GET  /api/harvests?state=wet|dried&batch_id=...
GET  /api/harvests/{id}
POST /api/harvests/harvest                # HarvestIn — flush_number auto-increments per batch
POST /api/harvests/dry                    # DryIn — transitions wet→dried with weight
```

### In-state events

```
POST /api/events/break-and-shake          # BreakAndShakeIn
POST /api/events/contamination-flag       # ContaminationFlagIn
POST /api/events/contamination-lift       # ContaminationLiftIn
GET  /api/events/contamination/active     # current quarantine flags
POST /api/events/weight-measurement       # WeightMeasurementIn
POST /api/events/move-location            # MoveLocationIn
POST /api/events/consume-partial          # ConsumePartialIn
POST /api/events/note-attach              # NoteAttachIn
POST /api/events/archive                  # LifecycleIn
POST /api/events/destroy                  # LifecycleIn
POST /api/events/mark-gifted              # LifecycleIn
POST /api/events/mark-consumed            # LifecycleIn

GET  /api/events?lot_kind=...&lot_id=...&event_type=...&limit=200
GET  /api/events/{id}
```

### Lineage / chain of custody

```
GET /api/lineage/{lot_kind}/{uuid}/backward    # full provenance tree to GeneticCode + IngestRecord
GET /api/lineage/{lot_kind}/{uuid}/forward     # all derivatives
GET /api/lineage/by-lot-id/{lot_id}            # resolve human-readable ID → {lot_kind, id}
```

`lot_kind` ∈ `ingest | agar | lc | grain | batch | harvest`.

### Photos

```
POST   /api/photos                        # multipart: file, lot_kind?, lot_id?, event_id?, taken_at?, notes?
GET    /api/photos?lot_kind=...&lot_id=...&event_id=...
GET    /api/photos/{id}/file              # raw file
DELETE /api/photos/{id}                   # soft delete (file kept on disk for now)
```

---

## Request body shapes (Pydantic)

See `/app/backend/models.py`. Highlights:

```python
class Lineage(BaseModel):
    f: int | None = None
    c: int | None = None
    iso: str | None = None
    t: int | None = None

class SourceRef(BaseModel):
    lot_kind: Literal["ingest", "agar", "lc", "grain", "harvest", "batch"]
    lot_id: str               # UUID
    amount: float | None
    amount_unit: str | None   # "fraction" | "ml" | etc.

class EventBase(BaseModel):
    event_date: str | None           # ISO date or datetime; defaults to recorded_at
    operator_id: str | None
    client_id: str | None            # per-instance ID; default "default"
    notes: str | None
    photo_refs: list[str] = []       # photo UUIDs to bind to this event
```

Every create-event response returns `{<kind>: {...lot row}, "event_id": "<uuid>"}`.

---

## Smoke test

```bash
cd /app/backend && python3 tests/test_smoke.py
```

Walks the full chain from genetic registration through dried harvest, plus
break-and-shake, contamination flag/lift, consume-partial, and lineage walks.

---

## Database

SQLite WAL-mode at `/app/data/quicklabel.db`. Schema lives in
`/app/backend/schema.sql` and is applied idempotently on app startup.

- **Every record:** UUID primary key, `created_at`, `updated_at`, `deleted_at` (soft delete).
- **Events:** append-only — no `updated_at` or `deleted_at`. Corrections via NoteAttach.
- **Sync-readiness:** UUIDs + `client_id` on events. The schema is ready for
  multi-instance merge per the air-gap addendum, though no sync protocol is implemented.

To reset for testing:

```bash
rm -f /app/data/quicklabel.db /app/data/quicklabel.db-*
sudo supervisorctl restart backend
```

Schema and seed data re-apply on restart.

---

## What's not yet wired

- **Frontend.** `quicklabel.html` still uses localStorage. The next session
  migrates one workflow at a time to call this API. Label printing keeps working unchanged.
- **localStorage migration.** A one-shot importer reads existing browser state,
  POSTs into the new backend, then dormantizes the local store. Not implemented.
- **Photo attach-to-event UI.** Backend works; no UI yet.
- **KPI dashboards.** Data is there; views deferred.
- **Air-gap packaging.** PyInstaller / Tauri bundles deferred until v1 frontend lands.
