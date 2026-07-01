# QuickLabel — Genetics Tracking Expansion
## Product Requirements Document

**Version:** 1.0  
**Last updated:** 2026-02-01; audited 2026-07-01  
**Status:** Implemented — the three pre-grain workflows (Ingest, Agar Plate, Liquid Culture) are shipped, along with downstream Grain Spawn, Batch, Harvest, Retail, Swab, and Reprint (as of 2026-07-01).  
**Parent PRD:** `PRD.md` (QuickLabel core)

---

> ## Implementation status — as of 2026-07-01
>
> _Audit note. The upstream workflows specified here (Ingest, Agar Plate, Liquid Culture) are implemented in `quicklabel.html`, as are downstream Grain Spawn, Generate a Batch, Harvest Lot, Retail Units, Swab, and Reprint (nine workflows total). Ingest types SP/SS/LI/GT/AP/SN/CT ship as defaults. Still unbuilt: the Genetics Tracker / progeny-tree UI, real QR encoding (reserve box only), and dedicated Castellani/Slant "storage media" create-workflows._

---

## 1. Purpose

This PRD covers the **genetics tracking** layer of QuickLabel: everything that happens
*before* grain spawn. It defines how a genetic line enters the lab, moves through
pre-regulation media (prints, swabs, agar, liquid culture), and maintains full
provenance back to its originating source.

The grain-spawn and downstream workflows are specified in the parent PRD. This document
covers the upstream chain only.

---

## 2. Conceptual Model

### 2.1 The provenance chain

Every item in the lab traces to an **originating source** — the physical object that
first introduced the genetic into this lab. The chain:

```
Originating Source (print / swab / LC / tissue / plate received)
         │
         └─► Ingest Record  (IDs the source on entry into the lab)
                   │
                   └─► Agar Plates (transfer series: T0, T1, T2…)
                              │
                              ├─► Isolation work (C1_A, C1_B, C1_C…)
                              │
                              └─► Liquid Culture (bulk jar → syringes)
                                         │
                                         └─► Grain Spawn (→ parent PRD)
```

Every item at every stage carries the lot ID of its predecessor as its `source`.
Walking source IDs backward from any item reaches the ingest record, which names
the originating source.

### 2.2 Filial numbering convention

| Situation | Convention |
|-----------|------------|
| Genetic arrives with no history | Label `F0` — "zero in this lab" |
| True wild collection (forest spores) | `F0` — genuinely first generation |
| Genetic arrives with known history (e.g., "this is F3") | Use the provided generation number |
| Fruiting from spores | Same F generation as the spores |
| Clone taken from a fruiting body | Same F generation + new C designation |
| New generation of fruiting from a clone | F increments (e.g., F0→F1) |

**C (clone) is only present when the item IS a clone.** If the item came from
spores and is not a tissue/clone derivative, omit C entirely. The lot string
would be `F0.T0` for a spore-to-agar plate, not `F0.C0.T0`.

### 2.3 Transfer (T) numbering

- **T0** = first introduction of the genetic to a given media type (spore/swab/LC → agar = T0).
- **T increments** only when transferring within the same media state
  (T0 agar → new agar plate = T1 agar).
- Transfer does **not** increment across state changes: T2 agar → LC = T2 LC, T2 LC → grain = T2 grain.

### 2.4 Multiple sources of the same cultivar

Two different prints of "Golden Teacher" are **distinct genetic lines** tracked
independently. The genetic code (e.g., `SL192` vs `SL193`) is the differentiator.
Both resolve to the same genus/species/cultivar in the registry, but their lot IDs
and provenance chains are completely separate.

---

## 3. Ingest Types

An **ingest type** is the physical form a genetic takes when it enters the lab.
Each type has a short code used as the lot-ID prefix.

### 3.1 Default types

| Code | Display name            | Lot prefix | Notes |
|------|-------------------------|------------|-------|
| SP   | Spore Print             | SP         | Dried spore deposit. Pure spores. |
| SS   | Spore Swab              | SS         | Spore-loaded swab. May carry gut tissue (ambiguous clone status). |
| LI   | Liquid Culture (Ingest) | LI         | Receives an external LC vial/syringe. |
| GT   | Gill / Tissue           | GT         | Tissue clone from fruiting body. Explicitly a clone; carries C designation. |
| AP   | Agar Plate / Wedge      | AP         | Receives an external agar plate or wedge. |
| SN   | Slant                   | SN         | Long-term agar slant storage. |
| CT   | Castellani Tube         | CT         | Long-term water suspension storage. |

### 3.2 User-defined types

Users may add custom ingest types via Settings → Ingest Types. Each entry carries:
- `code` — short identifier, used as lot-ID prefix (2–5 chars, uppercase)
- `label` — full display name

The lot prefix for a custom ingest type equals its `code`.

---

## 4. Pre-Grain Workflows

### 4.1 Workflow: Ingest New Genetic

**Purpose:** Record a new genetic source entering the lab.  
**Lot prefix:** Derived from selected ingest type (e.g., `SP`, `SS`).  
**Lot format:** `[type-code]-[GeneticCode]-[YYMMDD]-[NN]`  
**Example:** `SP-SL192-260201-01`

**Label content:**
- Cultivar, genus/species, chip (standard header)
- Lot ID
- Lineage (F#, optional C designation, T0)
- Destination = ingest type label (e.g., "Spore Print")
- Source = provenance (e.g., "Vendor: FungusHead", "Trade: John D.", "Wild: Mt Hood 2025")
- Date, optional notes

**Ingest type notes:**
- **SP / SS:** No C designation unless there's reason to believe the swab contains tissue. Default lineage for both: `F0.T0` or `F?.T0` if generation is known.
- **GT:** Always carries a C designation (e.g., `F0.C1`). This IS a clone by definition.
- **LI / AP / SN / CT:** T0 on arrival; C only if the external source was a clone.

---

### 4.2 Workflow: Create Agar Plate

**Purpose:** Transfer a genetic onto a new agar plate.  
**Lot prefix:** `AL`  
**Lot format:** `AL-[GeneticCode]-[YYMMDD]-[NN]`  
**Example:** `AL-SL192-260201-03`

**Label content:**
- Cultivar, genus/species, chip
- Lot ID
- Lineage (F, optional C + isolation letter, T)
- Destination = "Agar Plate"
- Source = source lot ID (e.g., `SP-SL192-260201-01`)
- Media line = agar formulation code (e.g., `MEA`)
- Date, optional notes

**Lineage rules for agar transfers:**
- Plate from spore/swab → T0
- Plate from existing agar plate (same genetic, same state) → T increments
- Plate from LC → T carries from LC (does not increment on state change)
- Clone from fruit → new C designation, T resets to 0 for that clone

**Agar formulas (defaults, user-editable):**
`MEA` (Malt Extract Agar), `PDYA` (Potato Dextrose Yeast), `MYPA` (Malt Yeast Peptone),
`RBA` (Rose Bengal), `WBA` (Water Agar / Blank)

---

### 4.3 Workflow: Create Liquid Culture

**Purpose:** Inoculate an LC vessel from agar.  
**Lot prefix:** `LC`  
**Lot format:** `LC-[GeneticCode]-[YYMMDD]-[NN]`  
**Example:** `LC-SL192-260201-02`

**Label content:**
- Cultivar, genus/species, chip
- Lot ID
- Lineage (F, optional C, T — carries from source agar plate)
- Destination = "Liquid Culture"
- Source = source agar plate lot ID
- Vessel line = vessel type (e.g., `JAR`, `10mL`, `20mL`)
- Date, optional notes

**Notes:**
- T does NOT increment moving from agar to LC. T2 agar → T2 LC.
- A bulk LC jar and syringes drawn from it share the same lot ID. Sub-lot splitting (JAR-01, JAR-02) is deferred.
- Once agar reaches a satisfactory point, LC is the mass-replication tool for inoculations.

---

## 5. Lot ID Formats (Summary)

| Workflow        | Prefix | Format |
|-----------------|--------|--------|
| Ingest (Print)  | SP     | `SP-SL192-260201-01` |
| Ingest (Swab)   | SS     | `SS-SL192-260201-01` |
| Ingest (LC)     | LI     | `LI-SL192-260201-01` |
| Ingest (Tissue) | GT     | `GT-SL192-260201-01` |
| Agar Plate      | AL     | `AL-SL192-260201-01` |
| Liquid Culture  | LC     | `LC-SL192-260201-01` |
| Grain Spawn     | GL     | `GL-SL192-260201-01` |
| Batch           | BL     | `BL-SL192-260201-01` |

Counters are scoped to `[prefix]_[GeneticCode]_[YYMMDD]`. Different workflows on
the same genetic+date have independent sequences.

---

## 6. Field Visibility / Customization

Users can toggle which lineage fields appear on the form. Toggling a field hides
it in the form AND omits its contribution from the lineage notation on the label.

**Toggleable fields:**
- **Source** — the prior lot ID (useful for full traceability; optional for simple labs)
- **Filial** — F generation number
- **Clone / Isolation** — C designation and isolation letter

Transfer (T) is always shown. Notation preview always reflects visible fields only.

Field visibility is global (applies to all workflows) and persisted per-user in
localStorage. Default: all fields visible.

---

## 7. Genetics Tracker Module (future UI — not yet built)

This section documents the planned Genetics Tracker UI. It is not part of the
current implementation — the workflows above produce the labeling foundation;
the tracker is built on top of that data.

### 7.1 Purpose

A live inventory view showing every active genetic line and its current state
in the lab. Answers:
- "What agar plates of SL192 are active right now?"
- "Which plates need attention / are getting old?"
- "What's the transfer history for my Golden Teacher isolate C1_A?"
- "How did SL192 and SL193 diverge from two different Golden Teacher sources?"

### 7.2 Progeny tree

Each lot links to its source lot via the `source` field on its label. Walking
these links backwards from any item reaches the ingest record. The UI renders
this as a collapsible tree.

```
SL192 — Golden Teacher (Psilocybe cubensis) [Actives]
  └─ SP-SL192-260201-01  Spore Print  F0.T0  Vendor: FungusHead
       └─ AL-SL192-260201-01  Agar Plate  F0.T0  MEA
            ├─ AL-SL192-260205-01  Agar Plate  F0.T1  MEA  [active]
            ├─ AL-SL192-260205-02  Agar Plate  F0.T1.C1_A  MEA  [active ★]
            └─ LC-SL192-260210-01  Liquid Culture  F0.T1  JAR  [consumed]
                 └─ GL-SL192-260212-01  Grain Spawn  F0.T1  …
```

### 7.3 Status tracking

Each lot/item can carry a status:
- `active` — live in the lab
- `consumed` — used to create a downstream item (grain, LC, etc.)
- `gifted` — given away
- `contaminated` — confirmed contamination
- `archived` — stale / no longer tracked
- `destroyed` — discarded

Status is set manually. The tracker flags items that should be reviewed (e.g.,
agar plates beyond a user-defined shelf life, T-count approaching a safe maximum).

### 7.4 KPI surface (future)

- "3 plates of SL192 are past 30 days — inspect or transfer"
- "You have isolated SL193.F0.C1_A through 4 generations — candidate for final
  expression evaluation"
- "Plate AL-SL192-260205-02 has photo evidence from 3 flushes — review phenotype"

### 7.5 Photographic evidence

Each lot/item can have photo links or attached images. The primary use case is
capturing the fruiting expression of a clone so isolations can be compared
visually over generations.

---

## 8. Storage Media (documented, deferred)

Storage media are long-term preservation formats. They are ingest types when
receiving from outside the lab; they become separate workflows when creating
new storage from live cultures.

**Status (2026-07-01):** Castellani Tube (`CT`) and Slant (`SN`) ship today as
ingest **types** (part of `DEFAULT_INGEST_TYPES`, usable as lot-ID prefixes on
Ingest). What remains deferred is the dedicated "Create Storage Media" workflow
for producing new storage from live cultures — it currently appears as a
disabled / "soon" item in the workflow menu.

### 8.1 Create Castellani Tube

A water suspension tube for indefinite cold storage. Create-workflow deferred.
Lot prefix would be `CT` (already available as an ingest type).

### 8.2 Create Slant

An agar slant in a small sealed tube for 12–24 month cold storage.
Create-workflow deferred. Lot prefix would be `SN` (already available as an
ingest type).

These would appear in the workflow selector as "Create Storage Media" (grouped),
once specified.

---

## 9. Batch / Generate a Batch (implemented)

The **batch** is spawn-to-bulk — the first step in the regulated chain described
in the parent PRD. **Status (2026-07-01):** Generate a Batch is now implemented
(lot prefix `BL`) and is a live option in the workflow selector; it is documented
fully in §17 of the parent PRD (`PRD.md`). Downstream-of-batch steps in the
regulated chain remain future design work per the parent PRD.

---

## 10. Open Questions

- **Spore swab clone ambiguity.** Should the form warn or prompt when a swab is
  selected with a C designation? Or leave it to the user's discretion?
- **Isolation letter auto-increment.** When making three isolation plates from
  one clone, should the app auto-assign A, B, C and print three labels? Or is
  manual entry always preferred?
- **Status transitions.** Should marking an item "consumed" require linking it
  to a downstream lot ID? Or stay optional/freeform?
- **Progeny tree data layer.** The lot labels (printed and saved locally) carry
  the source IDs. Does the tracker parse printed lot history to reconstruct the
  tree, or does every label-print event write a separate inventory record?
- **Shelf-life defaults per media type.** What are the recommended maximums
  for agar plate, LC, grain before flagging? (Likely user-configurable.)
- **Multiple isolation runs from one plate.** If C1_A, C1_B, C1_C are three
  plates from one parent, they share a parent lot ID but have different isolation
  letters. Does the parent lot increment T on each pull? (Current answer: no —
  isolation letters are siblings, not transfers.)

---

## 11. Backlog / Future

- Genetics Tracker UI panel (progeny tree, health status, KPIs)
- Photo attachment per lot record
- Status transitions (active → consumed → archived)
- Bulk isolation print run (auto A/B/C/… labels)
- Castellani tube and slant create workflows
- Sub-lot splitting for LC (bulk jar → syringes as sub-lots)
- Import/export of genetic registry and lot history
- QR codes on labels linking to lot records in the tracker
