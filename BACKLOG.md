# QuickLabel — Backlog

Future work parked here so it doesn't get lost. Items are grouped by
theme and roughly ordered by urgency within each group. Nothing here
is a commitment — it's a record of intent.

Read `PRD.md`, `PRD-genetics-tracking.md`, and `PRD-data-model.md` for
the full design context behind these items.

---

## Harvest / Post-Harvest

### Dry weight recording (near-term)
`HarvestLot` has a `state` field (`wet` | `dried`) and a `dry_weight`
field per the data model. The UI has no way to record it today. Need:
- A "Record Dry Weight" action on an existing HL- lot (probably from
  the Inventory view or a dedicated workflow)
- Updates `dry_weight` and flips `state` to `dried` on the lot record
- Optionally reprints the HL- label with the dry weight added

### Homogenized Lot workflow (deferred)
After drying, product is often homogenized across flushes into a single
lot (HMZ- prefix). Workflow would fan-in one or more HL- lots, record
mix ratios, produce one homogenized lot ID. Required before Product lots
are possible. Per PRD §17 workflow chain.

### Product Lot / retail compliance labels (deferred)
Downstream of homogenized lots. Required fields are jurisdiction-
specific and not yet codified. When rules exist: new label template
(`product-lot-2x4` or regulated sticker size), new workflow. The SVG
renderer handles it cleanly — see PRD §17 "Product lot labels."

---

## Lot Management

### Lot lifecycle status
Every lot should carry `active | consumed | gifted | contaminated |
archived | destroyed`. No UI for this today. Needed:
- Status badge in the Inventory view (colored, sortable/filterable)
- A "Mark as..." action per lot row
- `contaminated` status should optionally flag downstream lots via
  the lineage graph (see PRD-data-model §5.2 ContaminationFlag)

### Edit / annotate a lot record
Once a lot is created there's no way to update it short of direct
localStorage editing. Need:
- Edit modal accessible from the Inventory view
- Editable fields: dry weight (for HL-), notes, status, location
- Append-only note/annotation log per lot (PhotoAttach, NoteAttach
  per PRD-data-model §5.2)

### Lot remaining / consumption tracking
Agar plates, LC vials, and grain lots are consumable — you use part of
them per event. The data model defines `remaining` per entity type
(fraction for agar, mL for LC, intact/fraction for grain).
No consumption tracking in the UI today. Medium-term need once
multiple workflows are actively pulling from shared source lots.

---

## Source Field

### Structured source lookup (blocking once multiple workflows are active)
Source is free text today. When HL-, BL-, LC-, AL-, GL- lots all exist
in the system, the source field should resolve against real lot IDs.
- Source input becomes a searchable lot-ID picker (same pattern as the
  current source-lot-pick card, but universal across all workflows)
- Source type tag (`AR`, `LC`, `GR`, `BL`, etc.) per PRD §16
- Free-text override remains for off-system sources

---

## Genetics Tracker

### Lineage / progeny tree view
`db.lineage.{tree, parentsOf, childrenOf}` are implemented but nothing
surfaces them. Two useful views:
1. Ancestors of a lot — walk backward from any lot ID to its ingest
   record, showing each hop as a node
2. Descendants of a genetic — all lots ever produced from a given code,
   forward from the ingest record

Both are read-only tree renders. Could live in the Inventory view as a
row-expand or a separate panel.

### Genetics Tracker panel
Full-screen view (separate from Inventory) showing every active genetic
line and its current position in the lab. Per PRD-genetics-tracking §7:
- Collapsible progeny tree per genetic code
- Status badges per lot (active / consumed / contaminated / archived)
- Age indicators — lots past a configurable shelf-life threshold flagged
- Last-event timestamp per lot

### KPI surface
On top of the tracker:
- "N plates of SL192 approaching max transfer — review recommended"
- "HL- lots past 30 days with no dry-weight recorded"
- "Wet→dry yield ratio across last N harvests of [cultivar]"
- Per PRD-genetics-tracking §7.4 and PRD-data-model §7

---

## Labels

### QR code on labels
Space is already reserved (150×150 viewBox units, top-right). Payload
design is undecided — candidates:
- Lot ID only (scannable lookup if there's a local server)
- Signed short URL pointing at a hosted record viewer
- Full lot data encoded in the QR (no server needed, but large)
Blocked on: deciding whether a hosted backend re-enters the picture.

### Multiple label templates
Today there's one template (`grain-spawn-9x5` for the Dymo 2.25×1.25").
A larger label (e.g. 4×2") would expand the body budget and allow more
fields. Needs:
- Template registry extension
- Printer ↔ template pairing UI
- Per-workflow template override

### Direct-to-printer (bypass browser dialog)
Dymo Connect REST (or equivalent) would eliminate the browser print
dialog for every label. Currently browser print is the only path.
Per PRD §11. Deferred — browser print is good enough for solo use.

### PDF export
Serialize the SVG label to PDF at exact paper size for archival or
batch reprint. No library integrated. Cheap once a use case exists.

---

## Storage Media Workflows

### Create Castellani Tube (CT-)
Long-term water-suspension storage. Workflow stub exists in the
PRD-genetics-tracking; not built. Low urgency until you're actively
archiving lines.

### Create Slant (SN-)
Agar slant for 12–24 month cold storage. Same status as CT.

Both would appear in the workflow selector under "Storage Media" once
specified per PRD-genetics-tracking §8.

---

## Data / Infrastructure

### Cut `cfg.codes` sync
`syncGeneticsAndCfg()` in `db.js` double-writes genetics to both
`db.genetics` and `cfg.codes` for legacy compatibility. Every
`cfg.codes` reader (datalists, settings count, `findCode`) needs to
move to `db.genetics.list()` before the sync can be deleted. Estimated
half-day. Nothing is blocking it except prioritization.

### Substrate component registry
Required before BulkSubstrateRecipe (spawn-to-bulk workflow) is
implementable. Per PRD-data-model §3.6 and §3.10:
- Component codes: COIR, VERM, HPOO, GYPSUM, BRAN, etc.
- User-editable in Settings

### Bulk substrate recipe builder
Depends on substrate component registry. Needed for the Generate Batch
workflow to record what went into the substrate. Per PRD-data-model §3.6.

### Event log per lot
PRD-data-model §5 defines an append-only event catalog. Today, lot
records are static snapshots — no event history. The full event model
(BreakAndShake, WeightMeasurement, MoveLocation, ContaminationFlag, etc.)
is documented but not implemented. Foundational for KPIs and compliance.

### Sterile grain lot tracking
Sterile grain bags (pre-inoculation inventory) are not tracked today.
Per PRD-data-model §3.5: a GrainLot entity covers both `sterile` and
`inoculated` phases. Need a "Sterilize Grain" workflow and a lot-ID
prefix decision (open question in PRD-data-model §9.1).

### Import / export of lot history
CSV export of the full lot table and lineage graph for backup /
migration. Currently only genetics have import. Lots are locked in
localStorage.

---

## Open Design Questions

These need an answer before the code can move:

1. **QR payload** — lot ID only, URL, or full data blob? Hosting?
2. **Sterile grain lot-ID prefix** — `GL-` (unified with inoculated)
   or a new `SG-` prefix? Per PRD-data-model §9.1.
3. **LC sub-lot splitting** — bulk jar + drawn syringes as one lot
   (single `remaining` mL) or sub-lots? Per PRD-data-model §9.2.
4. **Multi-source lineage on Batch** — when two grain lots with
   different lineage feed one batch, what's the batch's lineage?
   Per PRD-data-model §9.4.
5. **IngestRecord remaining** — does a received agar plate or LC
   carry its own `remaining` field, or does IngestEvent immediately
   create a derivative AgarPlate / LiquidCulture record?
   Per PRD-data-model §9.8.
6. **Event note edit policy** — can a typo in an event's notes be
   corrected in-place, or only via append? Per PRD-data-model §9.11.
7. **Colonization-window thresholds** — per-genetic, per-recipe, or
   global user default? Per PRD-data-model §9.6.

---

## Deferred from Previous Sessions

Items explicitly called out as deferred in prior work:

- **Ingest workflow**: `originDate` toggle removed; re-introduce when
  QR payload or "Provenance details" sub-view exists
- **iNaturalist** fields beyond iNat # don't appear on label; full block
  (collector, date, location) stored in `db.genetics` for QR reveal
- **Legacy cultivar entries** with "Psilocybe cubensis" in genus field —
  no auto-migration; fix per-record via the edit modal
- **Isolation letter auto-increment** — when making A/B/C isolation
  plates from one clone, should the app auto-assign letters and print
  a batch? Currently manual
- **Spore swab clone ambiguity** — should the form warn when a swab is
  given a C designation? Currently left to user discretion
