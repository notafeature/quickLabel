# QuickLabel — Product Requirements Document

**Version:** 0.1 (pre-build)
**Target:** Print a label today. Build the rest later.

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

### Future (separate genetics tracker repo, to be integrated)
- Genetics catalog with unique genetic codes and full lineage graph
- Vendor registry with codes
- Substrate type registry (user-defined)
- Source population from database
- Agar / LC / spore swab label variants
- Operator tracking
- State change / compliance fields
- QR codes linking to digital records

---

## 3. Taxonomy & Terminology

- **No use of the word "strain"** anywhere in UI or code.
- Categories split the genus/species picker into two tracks:
  - **Gourmet / Functional** — e.g. Pleurotus, Hericium, Ganoderma, Lentinula
  - **Actives** — e.g. Psilocybe, Panaeolus

### Seeded genus/species (v1)

**Actives — Psilocybe:**
- cubensis
- ochraceo-centrata
- subtropicalis
- tampanensis
- zapaticorum

More can be added through user profile settings (future).

---

## 4. Label Fields

### Identity
| Field | Notes |
|-------|-------|
| Category | Gourmet/Functional \| Actives — drives which genus/species list appears |
| Genus | Dropdown, filtered by category |
| Species | Dropdown, filtered by genus |
| Cultivar | Free text. This is the common name (e.g. "Golden Teacher"). Not called "strain". |

### Genetic Traceability
| Field | Notes |
|-------|-------|
| Genetic Code | Short alphanumeric. In v1 this is manually entered. In future it auto-populates from the genetics catalog. Becomes the root of the lot ID. |
| Generation | F1 / F2 / F3 … (user types or selects). "F" generations only — no P, G, etc. |
| Transfer | T0 / T1 / T2 … numeric. Resets to T0 when genetics move into a new media type. |
| Isolation | Optional: A / B / C / … Distinguishes unique isolations of the same genetic at the same generation/transfer. Used when plating out distinct sectors or points of mycelium. |

**Combined notation on label:** `F2·T3·B` or `F1·T7` — compact, readable.

**Lineage tracking note:** The agar plate that is F1·T7 becomes G (grain) T0 when
transferred to grain — but the label for the grain inoculation should reference
the agar source (F1·T7) as the Source Code so the chain is unbroken.

### Propagation Context
| Field | Notes |
|-------|-------|
| Media Type | Agar / LC / Spore Swab / Grain / Bulk. Determines which lot/batch concept applies. Today: Grain and Bulk. |
| Substrate Type | Code-based. Codes defined in user profile. If substrate came from a vendor, ties to vendor code. |
| Source Code | Where these genetics came from. Vendor code, in-house code, or genetic code of parent. Populates from database in future. Manual in v1. |
| Date | Defaults to today. Editable. |

### Lot / Batch Identity

Naming depends on media type:

- **Grain:** Grain Lot. ID format: `[GeneticCode]-[YYMMDD]-[NN]`
  where NN is a 2-digit sequence for the day.
  Example: `PSC001-260510-01`
  Within a grain lot, each expansion transfer increments T (T0 → T1 → T2).

- **Bulk:** Batch ID. Same format, `BCH` prefix or similar.

- **Agar / LC / Spore Swab:** No lot ID in v1. Will be addressed when those
  label types are built.

The lot ID is the primary scannable/searchable identifier. It encodes the
genetic code, date, and sequence without needing a separate lookup.

### Free-form
| Field | Notes |
|-------|-------|
| Notes | One line, ~40 chars max. Prints at smallest size. Optional. |

---

## 5. Label Layout (30334 — 2.25" × 1.25")

Landscape. Minimal margin. Three zones:

```
┌────────────────────────────────────────┐
│  GOLDEN TEACHER              [ACTIVE]  │  ← Cultivar large/bold, category chip
│  Psilocybe cubensis                    │  ← Genus species italic
├────────────────────────────────────────┤
│  PSC001-260510-01   F1·T7   Grain     │  ← Lot ID, generation/transfer, media
│  Sub: HWS-01   Src: VND-FTF           │  ← Substrate code, source code
├────────────────────────────────────────┤
│  05.10.2026        [Notes text here]  │  ← Date + notes (small)
└────────────────────────────────────────┘
```

Exact typography and spacing: TBD from mockups.

---

## 6. Printer Configuration

- **Hardware:** Dymo LabelWriter 450
- **Label:** 30334 (2.25" × 1.25")
- **Driver:** Dymo Connect (Mac, already installed)
- **SDK:** Dymo Connect JavaScript Framework (`dymo.connect.framework.js`)
  — communicates with local service at `https://localhost:41951`
- **Label file format:** Dymo Label XML (`.label`)

User can configure which label sizes appear in the size selector. Default
shows only sizes they've added to favorites — not the full 40+ size catalog.

---

## 7. Tech Stack — v1

| Concern | Approach |
|---------|----------|
| UI | Single `.html` file — HTML + vanilla JS + CSS |
| Printing | Dymo Connect JS SDK → local service → USB |
| Storage | `localStorage` for favorites, recent cultivars, substrate codes |
| Build | None. Open file in browser. |
| Platform | macOS, DYMO Connect installed |

### Why not Option B (Python/Flask) today
Option B gives more layout control and is the right call once a backend exists.
For today, no server, no dependencies, no install. Just open the file.

---

## 8. User-Configurable Settings (localStorage, v1)

- Saved label sizes (default: `30334`)
- Custom substrate type codes
- Custom cultivar names per genus/species
- (Future) Operator name / initials

---

## 9. Out of Scope — v1

- Genetics database
- Agar / LC / spore swab label types
- QR codes
- Barcode scanning
- Operator tracking
- Multi-user / auth
- State change / compliance
- Print history / audit log
- Vendor registry (vendor codes are manual text in v1)

---

## 10. Open Questions

- [ ] Mockup review — label zone sizing and typography
- [ ] Isolation field: show by default or behind a toggle?
- [ ] Lot ID sequence: per-day per-genetic-code, or global per-day?
- [ ] Source Code: free text in v1, or a seeded short list?
- [ ] What cultivar names to seed for Psilocybe cubensis?
