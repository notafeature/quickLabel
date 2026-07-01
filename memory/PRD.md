# QuickLabel — Memory / Session Log

**App:** Single-file HTML label printer for mushroom cultivation tracking  
**File:** `quicklabel.html`  
**Stack:** Vanilla JS, SVG; localStorage + Supabase (Postgres KV sync + Auth); no build step  
**Printer:** DYMO LabelWriter 30334 (2.25 × 1.25 in) and Merryhome/D11 (14 × 35 mm)  
**Full PRDs:** `PRD.md` (core) · `PRD-genetics-tracking.md` (pre-grain)

---

> ## Implementation status — as of 2026-07-01
>
> _Added during a documentation-accuracy audit; the summary above and the workflow table now reflect the shipping code. The dated "What Was Built" sections below remain point-in-time history._
>
> - **Workflows (9):** Ingest · Agar Plate (`AL`) · Liquid Culture (`LC`) · Grain Spawn (`GL`) · Generate a Batch (`BL`) · Harvest Lot (`HL`) · Retail Units (`RU`) · Swab (`SW`) · Reprint. Lot ID = `PREFIX-CODE-YYMMDD-NN`.
> - **Templates/printers:** `grain-spawn-9x5` (DYMO 30334, 2.25×1.25 in) and `d11-strip` (Merryhome/D11, 14×35 mm).
> - **Persistence:** per-user `localStorage` (`ql_u:<user>:<slot>`) mirrored to Supabase Postgres KV (`ql_store`) with Supabase Auth (`<user>@quicklabel.app`). Legacy keys `ql_cfg`/`ql_lots`/`ql_form` are import-once backups.
> - **Also built:** CSV/paste genetics import, inventory view, live layout "Fiddle" panel, per-user login, lineage edges per print. **Not built:** lineage-tree UI, real QR (reserve only), PDF export.

---

## Architecture

Single HTML file (+ `db.js`). State lives in per-user namespaced `localStorage` keys `ql_u:<user>:<slot>` (slots: `cfg`, `lots` [= counters], `form`, `genetics`, `lot_records`, `lineage`), mirrored to the Supabase Postgres KV table `ql_store`:
- `cfg` — settings (prefix, codes, grain types, ingest types, agar formulas, fieldVis)
- `lots` — lot ID counters keyed `[PREFIX]_[CODE]_[YYMMDD]`
- `form` — form field state restored on reload
- `genetics` / `lot_records` / `lineage` — genetics registry, per-lot records, lineage edges

LEGACY keys `ql_cfg` / `ql_lots` / `ql_form` are imported once per user, then kept as backup.

SVG label templates (two): `grain-spawn-9x5` (DYMO 30334) and `d11-strip` (Merryhome/D11) — each shared across workflows, different data per workflow.

---

## Workflows Implemented

| Workflow | Header tag | Lot prefix | Details field |
|----------|-----------|------------|---------------|
| Ingest New Genetic | INGEST NEW GENETIC ▾ | dynamic (SP, SS, LI, GT, AP, SN, CT…) | Media/Source Type + Provenance |
| Create Agar Plate | CREATE AGAR PLATE ▾ | AL | Agar Formula |
| Create Liquid Culture | CREATE LIQUID CULTURE ▾ | LC | Vessel Type |
| Make Grain Spawn | MAKE GRAIN SPAWN ▾ | GL | Grain Type |
| Generate a Batch | GENERATE A BATCH ▾ | BL | Batch (enabled) |
| Record Harvest Lot | RECORD HARVEST LOT ▾ | HL | Harvest details |
| Print Retail Units | PRINT RETAIL UNITS ▾ | RU | Retail unit details |
| Swab Collection | SWAB COLLECTION ▾ | SW | Swab source |
| Reprint from ID | REPRINT ▾ | — | Existing lot ID lookup |
| Create Storage Media | (disabled) | — | — deferred — |

---

## Label Layout (SVG lines, top→bottom)

1. Cultivar (large, bold)
2. Genus species (italic) + ACTIVE/GOURMET chip
3. Horizontal rule
4. Lot ID (monospace, large)
5. Lineage notation (e.g. F0.T0, F0.C1_A.T2) — **on its own line, new as of 2026-02-01**
6. Destination | Src: source (e.g. "Agar Plate | Src: SP-SL192-260201-01")
7. Media line (e.g. "Media: MEA", "Vessel: JAR") — omitted if empty
8. Date (left) + Notes (right)

---

## Settings Sections

- **Lab** — prefix (lab code, e.g. SL)
- **Lineage Fields** — show/hide: Source, Filial, Clone/Isolation (3 toggles)
- **Genetic Codes** — CRUD: code → genus/species/cultivar
- **Grain Types** — CRUD: code + desc (for grain spawn workflow)
- **Ingest Types** — CRUD: code + label (code = lot prefix, e.g. SP = Spore Print)
- **Agar Formulas** — CRUD: code + desc (for agar plate workflow)

---

## Filial / Transfer Conventions

- **F0** = unknown/lab-default for incoming genetics; True F0 = wild spores
- Known generation = use provided F#
- **T0** = first transfer into lab media (spore/swab/LC → agar = T0)
- T increments within same media state; does NOT increment across state changes
- **C** only present for clone derivations (tissue/gill). Omit for spore-origin plates.
- Isolation letter (A/B/C) appended as `C1_A` suffix

---

## What Was Built (Session 2026-02-01)

- New PRD: `PRD-genetics-tracking.md` — full genetics tracking spec
- Workflow selector dropdown in header (clickable workflow tag → dropdown)
- 3 new pre-grain workflows: Ingest New Genetic, Create Agar Plate, Create Liquid Culture
- Notation line added to SVG template (own line between lot ID and source line)
- Field visibility toggles in settings (Source, Filial, Clone/Isolation)
- Ingest Types CRUD in settings (with lot prefix customization)
- Agar Formulas CRUD in settings
- Vessel type datalist for LC workflow
- Form state persistence extended for all new workflow fields
- 100% test pass rate (16 automated tests) (current repo carries one headless batch-logic test, test_reports/batch_logic_test.js)

---

## P0 Backlog (must do next)

- Genetics Tracker UI panel — live inventory view with progeny tree
- Status tracking per item (active / consumed / contaminated / archived)
- Photo attachment per lot record

## P1 Backlog

- Bulk isolation print run (auto A/B/C labels from one clone)
- Castellani tube and slant create workflows (storage media)
- Sub-lot splitting for LC bulk → syringes

## P2 / Future

- QR codes on labels linking to lot records
- Import/export genetic registry
- KPI dashboard ("N plates of SL192 approaching max transfer, review recommended")
- Mobile-friendly form layout
