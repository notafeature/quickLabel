# QuickLabel — Product Requirements Document

**Version:** 0.4
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
| azurescens |
| caerulescens |
| cubensis |
| mexicana |
| ochraceocentrata |
| subaeruginosa |
| subtropicalis |
| tampanensis |
| zapotecorum |

**Actives — Panaeolus (abbrev: PAn.):**
| Species |
|---------|
| cyanescens |

Cultivar names are **not seeded** — user-defined in settings, future DB extraction.

---

## 4. Genetic Lineage Notation

### Clone definition
A clone is a fruiting body or tissue clone. There is no mycelial clone type —
clone = fruiting clone. One type only.

### Fields

Filial (F), Clone (C), Isolation, and Transfer (T) form one continuous notation
chain. Each component is optional depending on lab settings.

| Field | Notation | Notes |
|-------|----------|-------|
| Filial generation | `F1`, `F2` … | Spore-derived generation. Optional — some labs only track C and T. |
| Clone number | `C1`, `C2` … | Clone instance within a filial generation, or standalone. |
| Isolation | `_A`, `_B`, `_C` … | Appended directly to clone: `C1_A`. Used when multiple isolations of the same clone are tracked. |
| Transfer | `T0`, `T1` … | Passage count on current media type. Resets when media type changes. |

### Combined notation — separator is `.`

| Example | Meaning |
|---------|---------|
| `F1.C1.T2` | Filial gen 1, clone 1, transfer 2 |
| `F2.C3` | Filial gen 2, clone 3 |
| `F1.C1_A.T1` | Filial gen 1, clone 1, isolation A, transfer 1 |
| `F1.C2_B.T4` | Filial gen 1, clone 2, isolation B, transfer 4 |
| `C1.T3` | Clone 1, transfer 3 (filial not tracked) |
| `T5` | Transfer 5 only (minimal tracking) |

### Lab-level settings (future)
- Show/hide Filial field
- Show/hide Clone field
- Isolation required vs. optional

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

### Genetic Code

**Format:** `[LabPrefix][NNN]` — no dashes, no embedded date or cultivar.

Example: `SL192`
- `SL` = lab identifier (user-defined in settings)
- `192` = sequential genetic instance number (3 digits)

The code is an opaque key that resolves to the full genetic record in the
database. Cultivar/genus/species appear separately on the label.

---

### Grain Lot ID (v1 — simplified)

**Format:** `[GeneticCode]-[YYMMDD]-[NN]`

Example: `SL192-260509-01`
- `SL192` = genetic code
- `260509` = lot initiation date
- `01` = 2-digit daily sequence per genetic code

The 2-digit sequence resets per day per genetic code, allowing up to 99 grain
lot starts per genetic per day.

**Expansion tracking (DEFERRED — not v1):**
The sublot tree structure described below is preserved for future implementation.
Each expansion of a grain lot creates sublots with a hierarchical path encoding
the full propagation chain. Each expansion level gets its own date. The challenge
of attaching a date to each expansion node (vs. one date on the lot root) needs
design work before implementation.

Deferred sublot design:
- Original bags: `01`, `02` … (2 digits)
- First expansion: `01.01`, `01.02` … (2 digits per level)
- Second expansion: `01.03.01` … (2 digits)
- Third expansion and beyond: 3-digit padding (`01.03.001`) to accommodate larger
  counts at deeper levels

---

### Batch (Spawn-to-Bulk)

A batch is formed when grain spawn combines with substrate. All units in a batch
share the same media type.

- One batch can draw from multiple grain lots
- One grain lot can be split across multiple batches
- Each container in a batch = a **batch unit**
- Batch ID: TBD format

**v1:** Bulk bag label does not show grain lot origin. Future may require it.

---

### Substrate Codes

User-defined in profile settings. Each code maps to a recipe.

**Suggested defaults (user renames or replaces freely):**
- `COIR` — coir
- `CVG` — coir/vermiculite/gypsum
- `CVG+` — CVG plus custom amendment (user defines the `+`)

A lab doing experimental work may have a large substrate code list. The `+`
suffix convention lets users extend named bases without polluting the main list.

**Future:** substrate inventory system, QR scan-to-lookup, recipe builder.

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
| Filial | Text | `F1`, `F2` … — hidden if lab setting off |
| Clone | Text | `C1`, `C2` … |
| Isolation | Text | `_A`, `_B` … — optional |
| Transfer | Text | `T0`, `T1` … |
| Date | Date picker | Defaults to today |

### Advanced (collapsed by default)

| Field | Input | Notes |
|-------|-------|-------|
| Genetic Code | Text | Manual v1; future: auto from DB |
| Lot ID | Auto-built + editable | `SL192-260509-01` |
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
│  SL192-260509-01   F1.C1_A.T3         │  ← Lot ID, lineage
│  Grain             Src: SL191.F1.C1.T7│  ← Media type, source
├────────────────────────────────────────┤
│  Sub: CVG+                 05.09.26    │  ← Substrate code, date
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
| Storage | `localStorage` — settings, substrate codes, recent entries |
| Build | None. Open file in browser. |
| Platform | macOS, Dymo Connect installed |

---

## 10. User Settings (localStorage, v1)

- Lab prefix (e.g. `SL`)
- Saved label sizes (default: `30334`)
- Custom substrate codes (code + description)
- Custom cultivar names per genus/species
- Show/hide Filial field toggle
- (Future) Operator name, DB connection, vendor codes, substrate inventory

---

## 11. Out of Scope — v1

- Genetics / cultivation tracker database
- Agar, LC, spore swab label types
- QR codes / barcode scanning
- Grain lot expansion / sublot tree tracking
- Substrate inventory management
- Batch unit label (Bulk label is basic — no grain lot backlink)
- Operator tracking
- Compliance / state change
- Print history / audit log
- Harvest Lot, Homogenized Lot
- Green bag weight tracking
- Vendor registry

---

## 12. Open Questions (pre-build)

- [ ] **Batch label structure** — when Media Type = Bulk, which fields change?
      Same form with different lot ID logic, or structurally different?
- [ ] **Mockup review** — label zone sizing, font hierarchy
- [ ] **Lot ID sequence** — 2-digit counter: per-day per-genetic-code, or
      global per-day across all genetics?
