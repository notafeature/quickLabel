# QuickLabel — Memory / Session Log

**App:** Label printer + cultivation tracker (in expansion).
**Files:**
- `/app/quicklabel.html` — frontend (still localStorage)
- `/app/backend/` — FastAPI + SQLite cultivation tracking API (NEW, Layer 2)
- `/app/data/quicklabel.db` — SQLite database (WAL mode)
- `/app/data/photos/` — photo storage
- `/app/PRD.md` — core PRD
- `/app/PRD-genetics-tracking.md` — pre-grain workflows
- `/app/PRD-data-model.md` — Layer 1 conceptual data model
- `/app/PRD-cultivation-api.md` — Layer 2 API reference (NEW)

---

## Architecture

- **Frontend (today):** Single HTML file, vanilla JS, localStorage. Served on :3000.
- **Backend (NEW):** FastAPI on :8001 with `/api/*` routes. SQLite at `/app/data/`.
- **DB:** UUIDs as PKs, soft-delete tombstones, append-only events table, dual-date model
  (`event_date` for physical, `recorded_at` for system), `client_id` for future merge.
- **Photos:** filesystem under `/app/data/photos/<uuid>.<ext>`, referenced by event UUID.

The frontend hasn't been migrated yet. Both stacks run side by side.

---

## Entities & events (Layer 2)

Per `/app/PRD-data-model.md`. Implemented and smoke-tested:

**Entities:** GeneticCode, IngestRecord, AgarPlate, LiquidCulture, GrainLot
(unified sterile + inoculated phases), BulkSubstrateRecipe, Batch,
HarvestLot (state ∈ {wet, dried}). Registries: GrainType, AgarFormula,
SubstrateComponent, IngestType.

**Events:** IngestEvent, PlateAgar, DrawAgar, PlateLC, DrawLC, SterilizeGrain,
InoculateGrain, SpawnToBulk, Harvest, Dry, BreakAndShake, ContaminationFlag,
ContaminationLift, WeightMeasurement, MoveLocation, ConsumePartial, NoteAttach,
Archive, Destroy, MarkGifted, MarkConsumed.

**Key designs:**
- Hierarchical partial consumption: parent + child lots, both consumable
  (`parent_lot_id` on AgarPlate and LiquidCulture; `DrawAgar` / `DrawLC` events).
- Multi-genetic batches: HARD ERROR at SpawnToBulk.
- Auto-derivative lots for ingest types (AP → AgarPlate, LC → LiquidCulture).
- Recipe versioning by snapshot at SpawnToBulk time.
- Contamination quarantine: subject lot only; downstream exposed via walk, not mutated.

---

## What's done

### Session 2026-05-18 (Layer 2)

- New SQLite schema covering all entities + events + lineage + photos + contamination + counters.
- FastAPI backend with 14 router modules under `/api/*`.
- Smoke test at `/app/backend/tests/test_smoke.py` walks the full chain
  Genetic → Ingest → Agar → wedge → LC → syringe → Sterile grain × 3 →
  Inoculate × 3 → Recipe → SpawnToBulk → Harvest × 2 → Dry. Plus
  BreakAndShake, ContaminationFlag/Lift, ConsumePartial, lineage walks,
  human-lot-ID resolution, event stream. All passes.

### Earlier sessions (label printer)

- Cultivar auto-shrink, Reset Lot ID button, workflow-prefix architecture,
  live layout fiddle panel, PRD reframed around conceptual state-change model.
- See `/app/CHANGELOG.md` for the detailed history.

---

## P0 Backlog (next session)

- **Frontend wire-up.** Migrate `quicklabel.html` workflows to call the new API
  one at a time. Order: Ingest → Agar → LC → Grain → Spawn-to-Bulk → Harvest.
  Label printing stays unchanged.
- **localStorage migration.** One-shot importer that POSTs existing browser
  state into the new backend on first load.
- **Genetics catalog UI.** List + filter active lots by state and genetic.

## P1 Backlog

- Inventory views: sterile bags, active agar plates, active LCs, colonizing batches.
- Photo attach-to-event UI for break-and-shake, harvest, contamination.
- "Ready for spawn-to-bulk" / "ready for fruiting" calendar views.
- KPI dashboards: wet→dry yield ratio per cultivar, contamination rate, time-in-stage.

## P2 / Future

- Air-gap packaging (Tauri or PyInstaller single-file).
- Optional sync endpoint for hosted instances (architecture supports it).
- Space designer UI for batch fruit-room layout.
- Operator tracking toggle (field is in the schema; UI deferred).
- Homogenization → product lots (out of v1 scope per user direction).
