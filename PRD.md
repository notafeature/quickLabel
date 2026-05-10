# QuickLabel — Product Requirements Document

**Version:** 1.0
**Last updated:** 2026-05-10
**Audience:** the author (single user, personal tool, closed environment).

---

## 1. Problem

Cultivation work moves a genetic line through a series of physical states.
Each transition produces a new physical container — a bag, plate, jar, bin —
that needs a label carrying enough information to identify the genetic, where
in its lifecycle it sits, what its lineage is, and where it came from. Today
that labeling is manual, inconsistent, and error-prone.

QuickLabel produces those labels.

---

## 2. Conceptual Model

### Things, states, transitions

A **thing** is a physical container of mycelium or substrate. Every thing
exists in a **state** — agar, liquid culture, grain spawn, batch (bulk),
harvest, homogenized — and carries a **lot ID** that is unique within that
state. A new state begins when a thing is moved to a new media: spores onto
agar, agar into LC, LC into grain, grain into bulk, etc. Each transition is
a **state change**.

Every state-change label captures four things:

1. **What state** the new thing is in (grain spawn, batch, etc.).
2. **What genetic** it carries.
3. **What lineage** within that genetic (filial / clone / isolation / transfer).
4. **Where it came from** — the originating state, and that state's ID if one
   exists.

Each state has its own lot-ID format. Today, only one state is in scope:
**grain spawn**, producing **grain lots**.

### Today's scope

This release labels grain spawn lots only. All other states are parked.
When new states are added, each gets its own lot-ID format and its own label
content; the model above does not change.

---

## 3. Taxonomy

- The word **strain** is not used anywhere in the product.
- Genetics are organized as **Category → Genus → Species → Cultivar**.
- **Category** is a UI grouping; it is derived from genus (it is not stored
  on a genetic record).
  - **Actives** — *Psilocybe*, *Panaeolus*
  - **Gourmet / Functional** — *Pleurotus*, *Hericium*, *Ganoderma*,
    *Lentinula*, *Cyclocybe*, *Flammulina*, etc.
- Genus and species are seeded with sensible defaults; users may extend
  them in their lab profile.

### Seeded defaults

**Actives — Psilocybe:**
azurescens, caerulescens, cubensis, mexicana, ochraceocentrata,
subaeruginosa, subtropicalis, tampanensis, zapotecorum.

**Actives — Panaeolus:**
cyanescens.

**Gourmet / Functional:**
*Pleurotus* (ostreatus, eryngii, citrinopileatus, djamor, pulmonarius),
*Hericium* (erinaceus, coralloides, abietis),
*Ganoderma* (lucidum, tsugae, oregonense),
*Lentinula* (edodes),
*Cyclocybe* (aegerita),
*Flammulina* (velutipes).

Cultivar names are not seeded. They live on genetic-code records.

---

## 4. Genetic Code Registry

A **genetic code** is a lab-scoped pointer to a specific genetic line. It is
the entity the user thinks in. Like a call number in a library: you remember
the code, the code resolves to the rest.

### Format

`[LabPrefix][NNN]` — no separators, no embedded date or cultivar.
Example: `SL192`. The lab prefix is set per user; the numeric portion is
the user's own counter.

### Record shape

A genetic-code record carries:

- `code` — e.g. `SL192`
- `genus` — e.g. `Psilocybe`
- `species` — e.g. `cubensis`
- `cultivar` — e.g. `Enigma`

Category is derived from genus. Lineage is **not** part of the record;
lineage is a property of a specific lot, not the genetic line.

### Behavior

- The code is the entry point on every label form. Choosing a code
  populates genus, species, and cultivar.
- Codes are user-managed in the lab profile.
- Typing a new code with new genus/species/cultivar implicitly creates a
  new record (deferred from this release; today, codes are added through
  the profile).

---

## 5. Lineage Notation

Filial (F), Clone (C), Isolation, and Transfer (T) form a single notation
chain. Components are independently optional.

| Field | Form | Notes |
|-------|------|-------|
| Filial    | `F1`, `F2`, …      | Spore-derived generation. |
| Clone     | `C1`, `C2`, …      | Tissue/fruit-body clone within a filial generation, or standalone. |
| Isolation | `_A`, `_B`, …      | Suffixed onto the clone: `C1_A`. |
| Transfer  | `T0`, `T1`, …      | Passage count on the **current** state. Resets at every state change. |

Combined notation uses `.` as a separator. Examples:

| Combined        | Meaning |
|-----------------|---------|
| `F1.C1.T2`      | Filial 1, clone 1, transfer 2 |
| `F1.C1_A.T3`    | Adds isolation A |
| `C1.T3`         | Filial not tracked |
| `T5`            | Transfer only |

Filial visibility is a per-lab display setting. Some labs only track clone
and transfer.

---

## 6. Lot Identity

Each state has its own lot-ID format. The label states the state explicitly
so the ID is never ambiguous.

| State            | Lot type        | In scope today? |
|------------------|-----------------|-----------------|
| Grain spawn      | **Grain Lot**   | Yes |
| Spawn-to-bulk    | Batch           | No |
| Post-harvest     | Harvest Lot     | No |
| Processing       | Homogenized Lot | No |

### Grain Lot ID

`[GeneticCode]-[YYMMDD]-[NN]`

- `[GeneticCode]` — e.g. `SL192`
- `[YYMMDD]` — initiation date, two-digit year first
- `[NN]` — two-digit sequence, scoped to (genetic code, date). Resets each day per code.
  Allows up to 99 grain-lot initiations per code per day.

Example: `SL192-260510-03`.

### Originating state ("source")

Captured as free text on the label. The user writes the originating state
and that state's ID, if one exists.

Examples:
- `LC: SL188.F1.T2`
- `Agar: SL188.F1.T1`
- `Liquid Culture` (no ID known)

In future iterations, these states will have first-class IDs and Source
will be a structured pointer.

### Expansion

Splitting a parent grain lot into derived sublots produces hierarchical
sub-IDs (`-01.01`, `-01.02`, …). **Out of scope for this release.**

---

## 7. Quantity / Print Runs

A print run produces N labels for one configuration of (code, date, lineage,
…). Each label gets a successive sequence number.

- The user specifies the **quantity** for the run, default 1.
- The first label uses sequence `last+1` for that `(code, date)` pair.
  Subsequent labels in the run increment sequentially.
- After a successful print run, the highest-used sequence is persisted as
  the new `last`.
- A canceled print run is not detectable from the browser. Counter advance
  is best-effort: a missed run causes a gap, not a duplicate. Reprint of an
  exact lot ID is a manual workflow and does not advance the counter.

---

## 8. Label Content

Every grain-lot label carries:

- **Cultivar** — large, dominant.
- **Category chip** — Actives / Gourmet — small, top-right.
- **Genus species** — italic, secondary.
- **Lot ID** — the grain lot ID for this label.
- **Lineage** — combined notation (e.g. `F1.C1_A.T3`).
- **State** — `Grain` / `Grain Spawn`.
- **Source** — originating state, free text.
- **Grain type** — the grain preparation used (rye, oats, millet, custom).
- **Date** — initiation date.
- **Notes** — optional one-line free text.

Field omissions are silent — empty fields render nothing, no placeholders.

---

## 9. Label Layout

Target media: 2.25" × 1.25", landscape, minimal margin.

Indicative zoning:

```
┌────────────────────────────────────────┐
│  ENIGMA                      [ACTIVE]  │  Cultivar dominant; category chip
│  Psilocybe cubensis                    │  Genus species italic
├────────────────────────────────────────┤
│  SL192-260510-03   F1.C1_A.T3          │  Lot ID · lineage
│  Grain             Src: Agar SL188.F1  │  State · originating state
├────────────────────────────────────────┤
│  Grain: Rye                 05.10.26   │  Grain type · date
└────────────────────────────────────────┘
  [Notes — smallest, only if present]
```

Typography is calibrated to render identically on screen preview and on
the printed label. Preview is a literal scaled rendering of print output.

---

## 10. User Profile (Settings)

Editable by the user, persisted across sessions. Single source of truth
for labeling.

- **Lab prefix** — the genetic-code prefix (e.g. `SL`).
- **Genetic code registry** — list of `{code, genus, species, cultivar}`
  records. The form's primary lookup.
- **Grain type registry** — list of grain preparations (e.g. `RYE`,
  `OATS`, `RYE+`). User-defined.
- **Lineage display rules** — show/hide Filial.
- **(Parked)** Substrate code registry — for when Batch state returns.

---

## 11. Printer Support

- The product must always provide a way to print. Browser print
  (system print dialog) is the always-available baseline.
- Direct-to-printer (Dymo Connect REST or equivalent) is desired but not
  required. If direct printing fails or is unavailable, the user falls
  back to the browser dialog without losing the in-progress label.
- Today's hardware target is the Dymo LabelWriter family with media
  30334 (2.25" × 1.25"). The product does not assume Dymo long-term;
  printer support is meant to broaden over time.

---

## 12. Form Behavior

- The form is flat. There is no "Advanced" section.
- **Genetic code** is the first field. Picking or typing a saved code
  populates genus, species, and cultivar. The auto-populated fields
  remain editable for one-off labels.
- The form pane is user-resizable horizontally. The user adjusts width
  to fit their screen and content density.
- All fields are optional. Nothing is mandatory; nothing is validated.
  An empty field renders nothing on the label.
- Form state persists across sessions, except **date**, which always
  defaults to today on load.

---

## 13. Out of Scope (this release)

- States other than grain spawn (agar, LC, batch, harvest, homogenized).
- Lot expansion / sublot tree.
- Field validation, mandatory fields, format enforcement.
- Multi-user / multi-lab / hosted backend.
- Direct-to-printer integration (parked, browser print is the path).
- Multi-printer routing, room/printer selection, network printers.
- Print history, audit log, reprint workflows.
- Compliance fields, operator tracking, vendor registry.
- Substrate inventory, recipe builder, QR/barcodes.
- Print-to-WIP pipeline.

---

## 14. Open Questions

- **Bulk / Batch label content.** When the Batch state comes back, what
  does its label carry? Grain-lot origin? Multiple? Volume? Recipe?
- **State-change history capture.** Source is free text today. What should
  the structured form look like once prior states have first-class IDs?
- **Lab-scoped vs personal data.** When data eventually leaves
  localStorage, which entities are personal (this user's choices) versus
  lab-shared (everyone in the lab sees the same registry)?
- **Implicit registry growth.** Should typing a new genetic code in the
  form (with new genus/species/cultivar) implicitly create a registry
  record? Or always require explicit add through the profile?
- **Print fidelity verification.** What's the right physical-output check
  to confirm preview matches printed label across firmware/OS combinations?

---

## 15. Future / Blue Sky

Tracked aspirations. None of these are commitments and none should
influence the current code.

### Product surface

- Hosted web app with identity persistence (closed environment, not real
  auth). Eventually real auth via Synergy SSO.
- Multi-tenant: Lab → Users → Rooms → Printers. Users print from any of
  their lab's printers in any room.
- Print-to-WIP: a printed label opens a tracked work-in-progress entry in
  Synergy, eligible for state changes downstream.

### Data

- Relational backend. Cultivars, genetic codes, grain types, substrates,
  lots, batches, harvests, runs are first-class records with referential
  integrity.
- Settings import/export across labs and users.
- Vendor registry, substrate inventory, recipe builder.

### Workflow

- Full state lifecycle: agar plate, LC, grain, batch, harvest, homogenized.
  Each with its own ID format and label content. State changes tracked as
  events, not just free text.
- Lot expansion / sublot tree (deferred design lives below).
- Operator tracking, compliance fields, audit log, print history,
  reprints.
- QR codes / barcode scanning for substrate and lot lookup.
- Bulk-add of cultivars, codes, grain types from CSV / paste.

### Hardware

- Broad printer support across Dymo (LabelWriter family) and non-Dymo
  thermal label printers. Multi-printer routing, network printers, per-
  room defaults. Direct-to-printer always preferred, browser print as
  fallback.

### Sublot tree (deferred design)

Each expansion of a grain lot creates sublots with a hierarchical path.
Each expansion level may carry its own date.

- Original bags: `01`, `02`, … (2 digits)
- First expansion: `01.01`, `01.02`, … (2 digits per level)
- Second expansion: `01.03.01` … (2 digits)
- Third expansion and beyond: 3-digit padding (`01.03.001`) at deeper
  levels.

The challenge is whether each expansion node carries a date or only the
root does. Needs design.
