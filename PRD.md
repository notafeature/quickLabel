# QuickLabel — Product Requirements Document

**Version:** 0.3
**Target:** Print a grain spawn or bulk spawn label today. Build the rest later.

---

## 1. Problem

Labeling bags, bins, and substrate in a cultivation workflow is currently manual
and inconsistent. Labels need to carry enough information to trace genetics,
track propagation lineage, and eventually feed compliance workflows — without
requiring the person printing to know any of that context upfront.

---

## 2. Scope

### v1 (today)
Single HTML file. Fill form, print label on Dymo LabelWriter 450 (30334,
2.25" × 1.25"). Data lives in `localStorage`. No backend.

**Media types in scope:** Grain Spawn, Bulk (spawn-to-bulk)

**Media types out of scope for v1:** Agar, LC, Spore Swab

### Future (separate genetics tracker repo, to be integrated)
- Genetics catalog with genetic codes, lineage graph, progeny tracking
- Vendor registry with codes
- Substrate inventory: create substrate lots, pull from inventory when creating batch
- Substrate recipe builder with custom codes
- Cultivar names extracted from database
- Source population from database
- QR code scanning for substrate/lot lookup
- Operator tracking
- State change / compliance fields
- Harvest lot, homogenized lot, and downstream tracking

---

## 3. Taxonomy & Terminology

- **No use of the word "strain"** anywhere in UI or code.
- **Category** splits the genus/species picker:
  - **Gourmet / Functional** — Pleurotus, Hericium, Ganoderma, Lentinula, etc.
  - **Actives** — Psilocybe, Panaeolus

### Seeded genus/species (v1 defaults — user-extensible in settings)

**Actives — Psilocybe (abbrev: P.):**
| Species |
|---------|
| cubensis |
| ochraceo-centrata |
| subtropicalis |
| tampanensis |
| zapaticorum |

**Actives — Panaeolus (abbrev: PAn.):**
| Species |
|---------|
| cyanescens |

Cultivar names are **not seeded** — user-defined in settings, future DB extraction.

---

## 4. Genetic Lineage Notation

### Fields

All three components — Filial (F), Clone (C), Transfer (T) — are part of one
continuous notation chain. Isolation letter is optional within a clone instance.

| Field | Notation | Notes |
|-------|----------|-------|
| Filial generation | `F1`, `F2` … | Spore-derived generation. Some labs skip this entirely — controlled by user setting. |
| Clone number | `C1`, `C2` … | Clone within a filial generation (or standalone if filial is hidden). |
| Isolation | `A`, `B`, `C` … | Optional. Used when multiple distinct isolations of the same clone are tracked. |
| Transfer | `T0`, `T1` … | Passage count on current media type. Resets when media type changes. |

### Combined notation examples

| Example | Meaning |
|---------|---------|
| `F1·C1·T2` | Filial gen 1, clone 1, transfer 2 |
| `F2·C3` | Filial gen 2, clone 3 |
| `F1·C1·A·T1` | Filial gen 1, clone 1, isolation A, transfer 1 |
| `F1·C2·B·T4` | Filial gen 1, clone 2, isolation B, transfer 4 |
| `C1·T3` | Clone 1, transfer 3 (filial hidden — lab preference) |
| `T5` | Transfer 5 only (minimal tracking mode) |

### Lab-level settings (future)
- Show/hide Filial field
- Show/hide Clone field
- Isolation required vs. optional

**Open question — clone method types:** Is there a distinction between clone
types (e.g. fruiting body tissue clone vs. mycelial clone) that needs to appear
in the notation or as a separate field? Or is clone type just metadata in the
database?

---

## 5. Lot / Batch Identity Model

### Lot types in the full lifecycle

| Stage | Name | v1? |
|-------|------|-----|
| Grain spawn | Grain Lot | Yes |
| Spawn-to-bulk | Batch | Yes |
| Post-harvest | Harvest Lot | No |
| Processing | Homogenized Lot | No |

---

### Genetic Code (Lot Root ID)

**Format:** `[LabPrefix][NNN]` — no dashes, no embedded date, no cultivar.

Example: `SL192`
- `SL` = lab identifier (user-defined in settings)
- `192` = sequential genetic instance number

The genetic code is an opaque key that resolves to the full genetic record in the
database. The label displays cultivar/genus/species separately — the code is for
traceability, not human decoding. Two labels with `SL192` share the same genetic
origin regardless of when they were made.

---

### Sublot (Grain Lot expansion tracking)

The sublot encodes the full expansion path from the original inoculation.
Each segment is the bag number at that expansion level, zero-padded by expected
count at that level.

**Tree structure:**

```
SL192
├── 01  (original bag 1)
├── 02  (original bag 2)
├── 03  (original bag 3)
└── 04  (original bag 4)
    └── 04.01  (first expansion from bag 04 — bag 1 of that expansion)
    └── 04.02  ...
        └── 04.02.01  (second expansion from 04.02 — first bag)
        └── 04.02.02
```

Full bag identifier: `SL192 · 01.03.02`
Reads as: grain lot SL192 → original bag 01 → first expansion bag 03 → second
expansion bag 02.

**Digit padding:** scales with expected count at each level. Implementation
detail — not locked in PRD.

**Lot ID on label:** `SL192` (root only)
**Sublot on label:** `01.03.02` (expansion path)

Both shown together: `SL192 · 01.03.02`

---

### Batch (Spawn-to-Bulk)

A batch is formed when grain spawn combines with substrate. All units in a batch
share the same media type.

- One batch can draw from multiple grain lots
- One grain lot can be split across multiple batches
- Each container in a batch = a **batch unit** (not a sub-lot)
- Batch ID: TBD format

**v1:** Bulk bag label does **not** show the grain lot sublot it came from.
Future: this link may be required for compliance.

---

### Substrate Codes

User-defined in profile settings. Each code maps to a recipe.

**Default/suggested codes (user can rename or replace):**
- `COIR` — coir
- `CVG` — coir/vermiculite/gypsum
- `CVG+` — CVG plus custom amendment (user defines the `+`)
- Fully custom: `CWM`, `WMC`, etc.

Substrate codes for Actives and Gourmet/Functional will differ (dung lovers,
wood lovers, universal blends, etc.). A lab doing experimental genetics may
have a large and rapidly-growing substrate code list.

**Future:** substrate inventory system — create substrate lots, track quantity,
pull from inventory when building a batch. QR scanning to look up substrate
codes at the bag.

---

## 6. Label Fields

### Always visible

| Field | Input | Notes |
|-------|-------|-------|
| Category | Toggle | Gourmet/Functional \| Actives |
| Genus | Dropdown | Filtered by category |
| Species | Dropdown | Filtered by genus |
| Cultivar | Text | User-defined names, not seeded |
| Media Type | Dropdown | Grain Spawn \| Bulk (v1) |
| Filial | Text / dropdown | `F1`, `F2` … — hidden if lab setting off |
| Clone | Text | `C1`, `C2` … |
| Isolation | Text | `A`, `B`, `C` — optional |
| Transfer | Text | `T0`, `T1` … |
| Date | Date picker | Defaults to today |

### Advanced (collapsed by default)

| Field | Input | Notes |
|-------|-------|-------|
| Genetic Code | Text | Manual v1; future: auto from DB |
| Sublot | Text | Expansion path: `01.03.02` |
| Source | Text | Free text v1; future: DB linked |
| Substrate Code | Text/Dropdown | User-defined codes |
| Notes | Text | ~40 chars, one line |

---

## 7. Label Layout (30334 — 2.25" × 1.25")

Landscape. Minimal margin. Four zones — typography TBD from mockups.

```
┌────────────────────────────────────────┐
│  ENIGMA                      [ACTIVE]  │  ← Cultivar bold/large, category chip
│  Psilocybe cubensis                    │  ← Genus species italic
├────────────────────────────────────────┤
│  SL192 · 01.03.02   F1·C1·A·T3        │  ← Genetic code · sublot, lineage
│  Grain    Src: SL191·F1·C1·T7         │  ← Media type, source
├────────────────────────────────────────┤
│  Sub: CVG+          05.09.26           │  ← Substrate code, date
└────────────────────────────────────────┘
  [Notes — smallest size, only if present]
```

Exact typography and zone spacing: pending mockups.

---

## 8. Printer Configuration

- **Hardware:** Dymo LabelWriter 450, macOS, USB
- **Label:** 30334 (2.25" × 1.25")
- **Driver:** Dymo Connect (installed)
- **SDK:** Dymo Connect JavaScript Framework (`dymo.connect.framework.js`)
  — communicates with local service at `https://localhost:41951`
- **Label file format:** Dymo Label XML (`.label`)

Size selector shows only user-saved sizes. Default: `30334`.

---

## 9. Tech Stack — v1

| Concern | Approach |
|---------|----------|
| UI | Single `.html` file — HTML + vanilla JS + CSS |
| Printing | Dymo Connect JS SDK → local service → USB |
| Storage | `localStorage` — settings, substrate codes, recent cultivars |
| Build | None. Open file in browser. |
| Platform | macOS, Dymo Connect installed |

---

## 10. User Settings (localStorage, v1)

- Lab prefix (e.g. `SL`)
- Saved label sizes (default: `30334`)
- Custom substrate codes (code + description)
- Custom cultivar names per genus/species
- Show/hide Filial field toggle
- (Future) Operator name, DB connection, vendor codes

---

## 11. Out of Scope — v1

- Genetics / cultivation tracker database
- Agar, LC, spore swab label types
- QR codes / barcode scanning
- Substrate inventory management
- Batch unit label (Bulk label for v1 is basic — no grain lot backlink)
- Operator tracking
- Compliance / state change
- Print history / audit log
- Harvest Lot, Homogenized Lot
- Green bag weight tracking
- Vendor registry

---

## 12. Open Questions (pre-build)

- [ ] **Clone method types** — does the distinction between fruiting body clone
      vs. mycelial clone appear anywhere in the label notation, or is that
      purely database metadata?
- [ ] **Sublot on label** — always visible, or behind the advanced toggle?
- [ ] **Batch label** — when Media Type = Bulk, which fields change/disappear?
      Does the category/genus/species block stay, or is the batch label
      structurally different enough to be a separate form?
- [ ] **Mockup review** — label zone sizing, font hierarchy
