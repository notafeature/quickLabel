# QuickLabel — Database Layer
## Claude Code Implementation Prompt

---

> ## ⚠️ SUPERSEDED — NEVER IMPLEMENTED (audit note, 2026-07-01)
>
> **Do not treat this document as a description of the app. It is an old proposal that was never built as written.** It specifies a **MongoDB + FastAPI** backend with `REACT_APP_BACKEND_URL`/nginx. That plan was **rejected** and never shipped.
>
> **What actually shipped instead:** the app persists to per-user `localStorage` (`ql_u:<user>:<slot>`) mirrored to a **Supabase (Postgres) key/value table** (`ql_store`, columns `user_id / slot / data / updated_at`), with **Supabase Auth** (synthetic `<user>@quicklabel.app`). There is **no MongoDB, no FastAPI data API, no React, no nginx**. The only "backend" file in the repo is `backend/server.py` — a 7-line FastAPI health-check stub that stores nothing.
>
> **Also note:** every `/app/...` path below reflects an old container layout; this repo lives at its root (`quicklabel.html`, `db.js`, `backend/server.py`, …).
>
> For the real, current implementation see **`FUNCTIONALITY.md`** (authoritative current-state map) and the source of truth, **`db.js`**. This file is retained only as historical design context.

---

## OBJECTIVE

Build a persistence backend for the QuickLabel genetics-tracking app.
Currently the app is a **single HTML file** (`/app/quicklabel.html`) that stores
everything in `localStorage`. This backend will replace localStorage as the
data store while keeping the existing HTML file as the frontend.

---

## CONTEXT

QuickLabel is a mushroom cultivation lab tool that tracks genetics through a
provenance chain:

```
Ingest Record (print / swab / LC received)
  └─► Agar Plates (transfer series)
        └─► Liquid Cultures
              └─► Grain Spawn
                    └─► Bulk Substrate / Batch
```

Every item carries the lot ID of its predecessor as its `source`.
Walking source IDs backward from any item reaches the ingest record.

---

## TECH STACK

- **Backend:** FastAPI + Python, MongoDB via `MONGO_URL` env var, `DB_NAME` env var
- **Frontend:** existing `quicklabel.html` (vanilla JS, no build step)
- **The frontend hits the backend via `REACT_APP_BACKEND_URL` env var**
- All backend routes must be prefixed `/api/`
- Follow the existing `/app/backend/server.py` pattern

---

## DATA MODELS

### 1. Genetic Record (`genetics` collection)

```json
{
  "_id": "ObjectId",
  "code": "SL176",
  "cat": "actives",
  "genus": "Psilocybe",
  "species": "cubensis",
  "cultivar": "Mana from Heaven",
  "ingestData": {
    "mediaType": "SP",
    "mediaLabel": "Spore Print",
    "vendor": "Basidium Equilibrium",
    "originator": "Raj Kumar",
    "originDate": "2025-11-01",
    "family": "Tidal Wave",
    "inat": {
      "enabled": false,
      "number": "",
      "collector": "",
      "date": "",
      "location": ""
    },
    "extNotes": "Very strong stamets phenotype on F2 flush...",
    "ingestDate": "2026-01-15"
  },
  "createdAt": "2026-01-15T...",
  "updatedAt": "2026-01-15T..."
}
```

### 2. Lot Record (`lots` collection)

Saved automatically every time a label is printed.

```json
{
  "_id": "ObjectId",
  "lotId": "AL-SL176-260517-01",
  "workflowId": "agar-plate",
  "geneticCode": "SL176",
  "cultivar": "Mana from Heaven",
  "genus": "Psilocybe",
  "species": "cubensis",
  "cat": "actives",
  "notation": "F0.T1",
  "destination": "Agar Plate",
  "source": "SP-SL176-260115-01",
  "sub": "MEA",
  "notes": "",
  "date": "2026-05-17",
  "status": "active",
  "qty": 4,
  "createdAt": "2026-05-17T..."
}
```

Status values: `active` | `consumed` | `contaminated` | `gifted` | `archived` | `destroyed`

### 3. Custom Taxa (`taxa` collection — single document per lab)

```json
{
  "_id": "ObjectId",
  "labId": "default",
  "customTaxa": {
    "actives": {
      "Gymnopilus": ["luteofolius", "junonius"],
      "Conocybe":   ["cyanopus"]
    },
    "gourmet": {}
  }
}
```

### 4. Lab Config (`config` collection — single document)

Mirrors the `cfg` object from localStorage. Syncs on load.

```json
{
  "_id": "ObjectId",
  "labId": "default",
  "prefix": "SL",
  "grainTypes": [...],
  "ingestTypes": [...],
  "agarFormulas": [...],
  "transferRules": {
    "allowOverride": true,
    "agarToAgar": true,
    "agarToLC": false,
    "agarToGrain": false,
    "lcToLC": true,
    "grainToGrain": true,
    "grainToBulk": false
  },
  "fieldVis": { "source": true, "filial": true, "clone": true }
}
```

---

## API ENDPOINTS TO BUILD

### Genetics

| Method | Route | Description |
|--------|-------|-------------|
| GET    | `/api/genetics` | List all genetics (paginated: `?skip=0&limit=50`, searchable: `?q=golden`) |
| GET    | `/api/genetics/:code` | Get single genetic by lab code |
| POST   | `/api/genetics` | Create new genetic record |
| PUT    | `/api/genetics/:code` | Update genetic record |
| DELETE | `/api/genetics/:code` | Delete genetic record |
| POST   | `/api/genetics/import-csv` | Bulk import from CSV (multipart/form-data) |
| GET    | `/api/genetics/export-csv` | Export all genetics as CSV download |

**CSV import columns (required):** `code`, `cultivar`, `genus`, `species`  
**CSV import columns (optional):** `cat`, `vendor`, `originator`, `family`, `notes`, `ingestDate`

### Lots

| Method | Route | Description |
|--------|-------|-------------|
| POST   | `/api/lots` | Save a lot record (called when label printed) |
| GET    | `/api/lots/:lotId` | Lookup lot by ID → returns full record |
| GET    | `/api/lots?code=SL176` | List lots for a genetic code |
| PATCH  | `/api/lots/:lotId/status` | Update status (`{ "status": "consumed" }`) |
| GET    | `/api/lots/:lotId/provenance` | Walk source chain → returns array of ancestor lots |

### Config

| Method | Route | Description |
|--------|-------|-------------|
| GET    | `/api/config` | Get lab config |
| PUT    | `/api/config` | Save lab config (called when settings change) |

### Custom Taxa

| Method | Route | Description |
|--------|-------|-------------|
| GET    | `/api/taxa` | Get custom taxa |
| PUT    | `/api/taxa` | Save custom taxa |

### Lot Counters

| Method | Route | Description |
|--------|-------|-------------|
| GET    | `/api/counters` | Get all lot counters |
| PUT    | `/api/counters` | Save all lot counters |

---

## FRONTEND INTEGRATION

After building the backend, update `quicklabel.html` to:

1. **On startup:** Try to fetch `/api/config` and `/api/genetics`. If successful,
   use API data instead of localStorage. If the fetch fails (offline / no backend),
   fall back to localStorage silently.

2. **On `printLabel()` / `printIngestLabel()`:** POST to `/api/lots` with the
   label data. Do this in addition to updating `lotCounters` in localStorage.

3. **On `printIngestLabel()`:** POST to `/api/genetics` to save the genetic record.

4. **On `onSourceChange()`:** GET `/api/lots/:lotId` to look up a source lot and
   auto-populate all fields from its data (not just the genetic code lookup).

5. **On Settings save:** PUT to `/api/config` to sync settings.

6. **REACT_APP_BACKEND_URL is already available in `/app/frontend/.env`.**
   Read it at runtime:
   ```js
   const API_BASE = ''; // relative URL since both are on same origin
   ```
   Since the nginx proxy routes `/api/*` to the backend, use relative paths.

---

## ADDITIONAL FEATURES TO BUILD

### Genetics Library View

A read-only panel (triggered by a button in Settings or a workflow option)
that shows all genetics in a searchable table:

Columns: Code | Cultivar | Genus/Species | Ingest Date | Vendor | Active Lots

### Provenance Tree (stretch)

`GET /api/lots/:lotId/provenance` returns the full chain. The frontend
can render this as a collapsible tree.

---

## IMPLEMENTATION NOTES

- Use `PyObjectId` pattern for MongoDB ObjectId serialization (see existing server.py pattern)
- Use `datetime.now(UTC)` not `datetime.utcnow()`
- Paginate list endpoints, don't return unbounded arrays
- The lot counter logic currently lives in `localStorage` — replicate in `/api/counters`
- MongoDB indexes: `genetics.code` (unique), `lots.lotId` (unique), `lots.geneticCode`
- Include a seed script that migrates existing localStorage data (write a JS snippet the user can run in browser console to export localStorage → JSON, then a Python script to import that JSON to MongoDB)

---

## FILE STRUCTURE EXPECTED

```
/app/backend/
├── server.py         (main FastAPI app, add new routes here)
├── models.py         (Pydantic models for all collections)
├── database.py       (MongoDB connection helpers)
├── routes/
│   ├── genetics.py
│   ├── lots.py
│   ├── config.py
│   └── taxa.py
└── requirements.txt  (update with motor, pydantic)
```

---

## MIGRATION / SEED

After building, provide a migration helper:

**Step 1 — Export from browser (run in browser console on the QuickLabel page):**
```js
copy(JSON.stringify({
  cfg:  JSON.parse(localStorage.getItem('ql_cfg')  || '{}'),
  lots: JSON.parse(localStorage.getItem('ql_lots') || '{}'),
  form: JSON.parse(localStorage.getItem('ql_form') || '{}')
}));
```

**Step 2 — Import to MongoDB:**
```bash
# Paste the clipboard into /tmp/ql_export.json, then:
python scripts/migrate_localstorage.py /tmp/ql_export.json
```

The migration script should insert all `cfg.codes` as genetic records,
save lot counters to the counters collection, and save cfg to the config collection.
