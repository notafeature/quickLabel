# QuickLabel — Memory / Session Log

**App:** Single-file HTML label printer for mushroom cultivation tracking  
**File:** `/app/quicklabel.html`  
**Stack:** Vanilla JS, SVG, localStorage — no backend, no build step  
**Printer:** DYMO LabelWriter 30334 (2.25 × 1.25 in)  
**Full PRDs:** `/app/PRD.md` (core) · `/app/PRD-genetics-tracking.md` (pre-grain)

---

## Architecture

Single HTML file. All state in `localStorage`:
- `ql_cfg` — settings (prefix, codes, grain types, ingest types, agar formulas, fieldVis)
- `ql_lots` — lot ID counters keyed `[PREFIX]_[CODE]_[YYMMDD]`
- `ql_form` — form field state restored on reload

SVG label template: `grain-spawn-9x5` (shared by all workflows, different data per workflow).

---

## Workflows Implemented

| Workflow | Header tag | Lot prefix | Details field |
|----------|-----------|------------|---------------|
| Ingest New Genetic | INGEST NEW GENETIC ▾ | dynamic (SP, SS, LI, GT, AP, SN, CT…) | Media/Source Type + Provenance |
| Create Agar Plate | CREATE AGAR PLATE ▾ | AL | Agar Formula |
| Create Liquid Culture | CREATE LIQUID CULTURE ▾ | LC | Vessel Type |
| Make Grain Spawn | MAKE GRAIN SPAWN ▾ | GL | Grain Type |
| Generate a Batch | (disabled) | BL | — deferred — |
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

- New PRD: `/app/PRD-genetics-tracking.md` — full genetics tracking spec
- Workflow selector dropdown in header (clickable workflow tag → dropdown)
- 3 new pre-grain workflows: Ingest New Genetic, Create Agar Plate, Create Liquid Culture
- Notation line added to SVG template (own line between lot ID and source line)
- Field visibility toggles in settings (Source, Filial, Clone/Isolation)
- Ingest Types CRUD in settings (with lot prefix customization)
- Agar Formulas CRUD in settings
- Vessel type datalist for LC workflow
- Form state persistence extended for all new workflow fields
- 100% test pass rate (16 automated tests)

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
