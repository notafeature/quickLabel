# QuickLabel — Product Requirements Document

**Version:** 0.2
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

**Media types in scope:** Grain Spawn, Bulk (spawn-to-bulk bags/bins)

**Media types out of scope for v1:** Agar, LC, Spore Swab (field structure
designed to accept them later without throwaway work)

### Future (separate genetics tracker repo, to be integrated)
- Genetics catalog with unique genetic codes and full lineage graph
- Vendor registry with codes
- Substrate type registry (user-defined in profile)
- Cultivar names extracted from database
- Source population from database
- Operator tracking
- State change / compliance fields
- QR codes linking to digital records
- Harvest lot, homogenized lot, and downstream tracking

---

## 3. Taxonomy & Terminology

- **No use of the word "strain"** anywhere in UI or code.
- **Category** splits the genus/species picker:
  - **Gourmet / Functional** — Pleurotus, Hericium, Ganoderma, Lentinula, etc.
  - **Actives** — Psilocybe, Panaeolus

### Seeded genus/species (v1 defaults — user-extensible in settings)

**Actives — Psilocybe (abbrev: P.):**
| Species | Notes |
|---------|-------|
| cubensis | Primary |
| ochraceo-centrata | |
| subtropicalis | |
| tampanensis | |
| zapaticorum | |

**Actives — Panaeolus (abbrev: PAn.):**
| Species | Notes |
|---------|-------|
| cyanescens | Primary |

Cultivar names are **not seeded** — user-defined in settings, future DB extraction.

---

## 4. Genetic Lineage Notation

### Generation types

| Type | Notation | Description |
|------|----------|-------------|
| Filial | `F1`, `F2`, `F3` … | Spore-derived generations. Sub-designation (A/B/C) used rarely. |
| Clone | `C1`, `C2` … | Clonal isolations. Each clone gets an A/B/C isolation designator. |
| Fruiting Clone Transfer | `FCT` | Clone taken from fruiting body tissue. Sub-designated A/B/C per isolation. |

**Open question — FCT:** Confirm: is FCT a distinct clone method (forced vs.
non-forced fruiting clone), or is it the umbrella term for all fruiting clones
with forced/non-forced as a sub-attribute?

### Transfer number
`T0`, `T1`, `T2` … — increments with each passage on the same media type.
Resets to `T0` when material moves to a new media type (e.g. agar F1·T7 → grain
becomes grain T0, but the label records the agar source so the chain is intact).

### Combined notation examples
- `F1·T7` — filial gen 1, 7th transfer on current media
- `C2B·T3` — clone 2, isolation B, 3rd transfer
- `FCT-A·T0` — fruiting clone transfer isolation A, first transfer (initial grain inoculation)

### Source field
Records the origin of material going into this label's container. In v1: free
text (e.g. `F1·T7` from agar plate, or vendor code). Future: linked record in
genetics DB.

---

## 5. Lot / Batch Identity Model

### Lot types in the full lifecycle

| Stage | Name | v1? |
|-------|------|-----|
| Grain spawn | Grain Lot | Yes |
| Spawn-to-bulk | Batch | Yes |
| Post-harvest | Harvest Lot | No |
| Processing | Homogenized Lot | No |

### Grain Lot

**ID format:** `[GeneticCode]-[YYMMDD]`
Example: `PSC-ENG-260509`
(Psilocybe cubensis Enigma, grain lot initiated May 9, 2026)

Date is the initiation date of the original inoculation event. The lot ID does
not change as the lot expands — that's what sublot tracking is for.

**Sublot notation — expansion rounds:**
Each expansion of the lot adds a round number and a bag number within that round.

| Designation | Meaning |
|-------------|---------|
| `0.1`, `0.2` | Initial inoculation bags (round 0) |
| `1.01` … `1.10` | First expansion bags (round 1, bags 1–10) |
| `2.01` … `2.20` | Second expansion bags (round 2) |

Full individual bag ID: `PSC-ENG-260509 · 1.03`
(same grain lot, first expansion, third bag)

The lot record tracks total bag count per round. A single 2 lb bag typically
yields 8–10 bags per expansion.

**Green bag weight** — trackable future field, not v1.

### Batch (Spawn-to-Bulk)

Formed when grain lot(s) combine with a substrate lot.

- One batch can draw from **multiple grain lots**
- One grain lot can be **split across multiple batches**
- Each container within a batch = a **batch unit**
- Batch ID: TBD format (references substrate lot ID + sequence)
- Batch unit ID: `[BatchID]-U[NNN]`

**Substrate Lot ID** — user-defined codes, built in user profile settings.
If substrate came from a vendor, substrate lot ties to vendor code.

---

## 6. Label Fields

### Always visible

| Field | Input | Notes |
|-------|-------|-------|
| Category | Toggle | Gourmet/Functional \| Actives |
| Genus | Dropdown | Filtered by category |
| Species | Dropdown | Filtered by genus |
| Cultivar | Text | User-defined names, no seeded list |
| Media Type | Dropdown | Grain Spawn \| Bulk (v1) |
| Generation + Transfer | Combined | `F1`, `C2B`, `FCT-A` + `T0`–`T9+` |
| Date | Date picker | Defaults to today |

### Advanced (collapsed by default — "show advanced" toggle)

| Field | Input | Notes |
|-------|-------|-------|
| Genetic Code | Text | Manual v1; future: auto from DB |
| Lot ID | Auto + editable | Built from Genetic Code + Date |
| Sublot | Text | `0.1`, `1.03`, `2.07`, etc. |
| Source | Text | Free text v1; future: DB linked |
| Substrate Code | Text/Dropdown | User-defined codes |
| Notes | Text | ~40 chars, one line |

---

## 7. Label Layout (30334 — 2.25" × 1.25")

Landscape. Minimal margin. Four zones, typography TBD from mockups.

```
┌────────────────────────────────────────┐
│  ENIGMA                      [ACTIVE]  │  ← Cultivar bold/large, category chip
│  Psilocybe cubensis                    │  ← Genus species italic
├────────────────────────────────────────┤
│  PSC-ENG-260509  ·  1.03               │  ← Lot · sublot
│  F1·T7     Grain    Src: FCT-A·T0      │  ← Gen/transfer, media, source
├────────────────────────────────────────┤
│  Sub: HWS-01           05.09.26        │  ← Substrate code, date
└────────────────────────────────────────┘
  [Notes line if present — smallest size]
```

Exact typography and zone spacing: TBD from user mockups.

---

## 8. Printer Configuration

- **Hardware:** Dymo LabelWriter 450, macOS, USB
- **Label:** 30334 (2.25" × 1.25")
- **Driver:** Dymo Connect (installed)
- **SDK:** Dymo Connect JavaScript Framework (`dymo.connect.framework.js`)
  — communicates with local service at `https://localhost:41951`
- **Label file format:** Dymo Label XML (`.label`)

Size selector shows only user-saved sizes. Default: `30334`.
Full Dymo catalog available to browse and add.

---

## 9. Tech Stack — v1

| Concern | Approach |
|---------|----------|
| UI | Single `.html` file — HTML + vanilla JS + CSS |
| Printing | Dymo Connect JS SDK → local service → USB |
| Storage | `localStorage` for settings, saved substrate codes, recent entries |
| Build | None. Open file in browser. |
| Platform | macOS, Dymo Connect installed |

---

## 10. User Settings (localStorage, v1)

- Saved label sizes
- Custom substrate type codes (code + description)
- Custom cultivar names per genus/species
- (Future) Vendor codes, operator name, DB connection

---

## 11. Out of Scope — v1

- Genetics / cultivation tracker database
- Agar, LC, spore swab label types
- QR codes / barcode scanning
- Operator tracking
- Multi-user / auth
- Compliance / state change
- Print history / audit log
- Harvest Lot, Homogenized Lot
- Green bag weight tracking
- Vendor registry (vendor codes are free text in v1)

---

## 12. Open Questions (pre-build)

- [ ] **FCT definition** — forced vs. non-forced fruiting clone: is FCT the
      umbrella, or does "forced" have a distinct meaning that needs its own
      designator?
- [ ] **Sublot on label** — always show, or only show advanced?
- [ ] **Batch label layout** — when Media Type = Bulk, does the label swap Grain
      Lot + Sublot for Batch ID + Unit? Or show both?
- [ ] **Substrate codes** — seed any defaults, or start blank and let user build?
- [ ] **Mockup review** — label zone sizing and typography
