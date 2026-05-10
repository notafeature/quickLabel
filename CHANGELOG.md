# QuickLabel — Changelog

History of implementation milestones and bug fixes. The PRD is the
product spec; this file is the development log.

---

## 2026-05-10 — PRD v1.0 reframe

PRD reorganized around the conceptual state-change model, with genetic
code as the primary entity. Implementation status, tech-stack details,
and storage-key names moved out of the PRD entirely. Future / blue-sky
items consolidated into a single section.

### Removed from PRD

- §8 Printer Configuration (the *how* — Dymo Connect REST URL, schema
  errors, browser-print mechanics).
- §9 Tech Stack (HTML / vanilla JS / localStorage layout).
- §10 storage-key names (`ql_cfg`, `ql_lots`, `ql_form`).
- §13 Implementation Status (this file now holds it).

### Reframed in PRD

- Sequence reconceived as **quantity** — labels per print run — rather
  than a per-day auto-counter.
- Substrate code reframed as **grain type** for the grain-spawn state.
  The substrate concept returns when Batch returns.
- Bulk removed from active scope; Batch is the future name.
- Genetic Code promoted to primary entity. Cultivar names now live on
  genetic-code records, not in their own list.

---

## 2026-05-10 — Form persistence root cause fix

The previous diagnosis of the form-state-on-reload bug was wrong. Real
cause: `init()` ran `applySettings()` → `applyLineageDisplay()` →
`updatePreview()` → `saveFormState()` **before** `restoreFormState()`
was called, wiping the saved form state with empty defaults before the
restore step had a chance to read it. Fix: an `initializing` flag,
checked in `saveFormState()`, cleared at the end of `init()`.

Also removed dead code from the abandoned Dymo Connect REST API attempt:
- `xml()` helper (XML escaping for the dropped Dymo label XML).
- `savePrinter()` (referenced a non-existent `#printer-sel` element).
- `#cert-notice` div + `.cert-notice` CSS (DYMO cert prompt — never shown).
- `"Connecting…"` status pill text (replaced with `"Ready"` on init).

Print CSS now forces `html, body { overflow: visible; height: auto }`
in `@media print` so the body's `overflow: hidden; height: 100vh`
can't clip the printed label.

---

## 2026-05-10 — Earlier session

- Print text forced black on all label elements.
- Cultivar datalist shows all cultivars regardless of current
  genus/species filter.
- Cultivar settings UI replaced manual text key with category / genus /
  species pickers.
- Cultivar auto-populate (typing a saved cultivar fills category, genus,
  species). Pushed but not user-verified at the time.

---

## Pre-2026-05-10 — Foundation

- Initial form UI: category, genus, species, cultivar, lineage, media,
  date, advanced section.
- Lineage notation preview: `F1.C1_A.T3` format built live.
- Lot ID auto-build: `[GeneticCode]-[YYMMDD]-[NN]`, sequence per
  genetic code per day.
- Settings panel: lab prefix, filial toggle, substrate codes, cultivar
  names.
- Substrate code datalist populated from saved substrate codes.
- Dark theme UI, two-column layout (form left, preview right).
- Browser print via `window.print()` with `@page { size: 2.25in 1.25in;
  margin: 0 }`. Print targets the preview div via `visibility:hidden`
  on all other elements.
- Dymo Connect REST API attempted (`https://localhost:41951`),
  rejected label XML with `Sch_UndeclaredElement` error. Root cause not
  diagnosed. Deferred. Browser print is the supported path.
