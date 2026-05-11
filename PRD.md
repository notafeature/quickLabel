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

### Workflows

A **workflow** is a named state change. Every label is one workflow event.
The workflow fixes the destination state, the lot type, and the lot-ID
format. The user picks a workflow, then fills in the rest.

Today's release implements one workflow:

| Workflow | Destination | Lot type | In scope? |
|----------|-------------|----------|-----------|
| **Make Grain Spawn** | Grain Spawn | Grain Lot | Yes |
| Spawn-to-Bulk | Bulk substrate | Batch | No |
| Spore → Agar | Agar plate | Agar Lot | No |
| LC → Agar | Agar plate | Agar Lot | No |
| Agar → Agar (transfer) | Agar plate | Agar Lot | No |
| Make Liquid Culture | Liquid Culture | LC Lot | No |
| Harvest | Fruiting body | Harvest Lot | No |
| Homogenize | Processed product | Homogenized Lot | No |

The destination state is **not** user-selected on the form — it is implied
by the workflow. The user picks the workflow and fills in source (where
the thing came from), lineage, and label metadata. Future workflows expand
this table without changing the model.

### Source

Source captures where a thing came from. It is **optional and secondary**
to the workflow. Some workflows treat source as mandatory; this one does
not. Source is currently a free-text field on the form (`Agar SL188.F1.T2`,
`Liquid Culture (origin)`, etc.). Future iterations will let it pull from
a consumables list, an asset list from a sibling tracking module (e.g. an
agar tracker), or stay overridable as freeform.

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
| Transfer  | `T0`, `T1`, …      | Passage count on the genetic line. Carries across state changes (T2 agar → T2 grain → T2 bulk). Advances only on transfer within the same state (T2 agar → T3 agar). |

Combined notation uses `.` as a separator. Examples:

| Combined        | Meaning |
|-----------------|---------|
| `F1.C1.T2`      | Filial 1, clone 1, transfer 2 |
| `F1.C1_A.T3`    | Adds isolation A |
| `C1.T3`         | Filial not tracked |
| `T5`            | Transfer only |

All four lineage components are always available on the form. Empty
components are simply omitted from the rendered notation.

---

## 6. Lot Identity

**Lot type is workflow-derived.** Each workflow produces a specific lot
type; the lot type determines the lot-ID format and gets its own counter
namespace so types never collide (a Grain Lot `01` and a Batch `01` are
always distinct).

Today only the Grain Lot type is produced. Its format is described below.
Future lot types (Batch, Agar Lot, LC Lot, Harvest Lot, Homogenized Lot)
will have their own formats and rules — when they land, the lot-ID on a
label will depend on the workflow, not on the form.

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
- The counter for a `(code, date)` pair can be **reset or set to a custom
  starting number** via a "Reset Lot ID" button next to Quantity. Useful
  when iterating on tests for the same genetic without polluting the live
  sequence — print four test labels, click Reset Lot ID, type `1`, the
  next print uses `01` again.

---

## 8. Label Content

Every grain-lot label carries:

- **Cultivar** — full-width across the top of the label, dominant.
  Auto-shrinks if the name is too long to fit, down to a legible
  minimum. No truncation.
- **Genus species** — italic, secondary, on the species line.
- **Category chip** — Actives / Gourmet, right side of the species line.
- **Lot ID** — the lot ID for this label, on its own line below the
  rule, slightly emphasized. This is the core identifier of the labeled
  thing. Format per the lot type, described in §6.
- **Lineage** — combined notation (e.g. `F1.C1_A.T3`), on its own line.
- **Destination | Source** — destination state (workflow-derived) on the
  left, source descriptor on the right after `Src:`. If source is empty,
  only the destination shows. When this thing's lineage notation is
  present, it is appended to the source on the label
  (`Agar 187` + `F1.C2.T6` → `Agar 187.F1.C2.T6`), since lineage carries
  across state changes. The append is suppressed if the typed source
  already ends with that notation, so a user who types the full source
  by hand doesn't double-stamp. Examples: `Grain Spawn  |  Src: Agar
  187.F1.C2.T6`, `Grain Spawn  |  Src: Liquid Culture (Bas Eq)`.
- **Grain type** — the grain preparation used (e.g. `RYE`); optionally
  with description (`RYE — Rye berries`) per a form-level toggle.
- **Date** — initiation date, bottom-left.
- **Notes** — optional one-line free text, bottom-right.

Field omissions are silent — empty fields render nothing, no placeholders.

---

## 9. Label Layout

Target media: 2.25" × 1.25", landscape, minimal margin.

Indicative zoning:

```
┌────────────────────────────────────────┐
│  ENIGMA                                │  Cultivar full-width, auto-shrink
│  Psilocybe cubensis           [ACTIVE] │  Genus species italic · chip
│  ─────                                 │  Rule
│  SL192-260510-03                       │  L1: Lot ID alone (core)
│  F1.C1_A.T3                            │  L2: Lineage alone
│  Grain Spawn  |  Src: Agar SL188.F1.T2 │  L3: Destination | Source
│  Grain: RYE — Rye berries              │  L4: Grain type (with desc)
│  05.10.26              notes if any    │  Date · notes
└────────────────────────────────────────┘
```

Typography is calibrated to render identically on screen preview and on
the printed label. Preview is a literal scaled rendering of print output.

---

## 10. User Profile (Settings)

Editable by the user, persisted across sessions. Single source of truth
for labeling.

- **Lab prefix** — the genetic-code prefix (e.g. `SL`).
- **Genetic code registry** — list of `{code, genus, species, cultivar}`
  records. The form's primary lookup. Records can be added, edited, and
  removed inline.
- **Grain type registry** — list of `{code, description}` grain
  preparations (e.g. `RYE — Rye berries`). Editable inline. The label
  shows just the code by default; a per-label toggle on the form opts
  in to including the description.
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
- The app header carries a **workflow tag** showing which workflow is
  active (today: `Make Grain Spawn`). The tag is a placeholder for a
  future workflow selector.
- **Genetic code** is the first form field. Picking or typing a saved code
  populates genus, species, and cultivar. The auto-populated fields
  remain editable for one-off labels.
- The form pane is user-resizable horizontally via a draggable splitter
  bar between the form and the preview.
- The form sections, in order, are: **Genetic** (genetic code, category,
  genus, species, cultivar), **Lineage** (source, then filial / clone /
  isolation / transfer, then notation preview), **Lot** (date, lot ID
  display, quantity), **Details** (grain type with optional description,
  notes), and **Print** (print and reset actions). Source sits at the top
  of Lineage because it describes the prior state from which this
  thing's lineage continues; the filial / clone / transfer notation that
  follows describes this thing. No media-type field — destination state
  is workflow-derived.
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
- **Source autocomplete from upstream sources**: the Source field on the
  form pulls from a consumables list, from an asset list owned by a
  sibling tracking module (e.g. an agar tracker), or stays overridable
  as freeform. Resolving a source becomes a real foreign-key lookup
  rather than a free-text string.

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

---

## 16. Session Backlog — 2026-05-11

Items captured during the SVG-rendering migration session. These are real
requirements, not nice-to-haves, but were deferred to keep the SVG migration
focused. Listed in rough order of when they'll hurt.

### Lot ID type modifier (P1, blocking once a second state ships)

**Status: prefix shipped 2026-05-11; per-workflow prefix architecture in place.**

The Grain Lot ID format is now `<prefix>-<genetic-code>-<YYMMDD>-<seq>`,
e.g. `GL-SL189-260511-03`. Prefix is workflow-derived
(`WORKFLOWS[id].lotPrefix`), so future workflows declare their own:

```
GL-SL189-260511-03   ← Grain spawn lot (current)
LL-SL189-260511-03   ← Liquid Culture lot
AL-SL189-260511-03   ← Agar plate lot (more "plate ID" than lot)
BL-SL189-260511-03   ← Batch (spawn-to-bulk) lot
HL-SL189-260511-03   ← Harvest lot
ML-SL189-260511-03   ← Homogenized / mixed lot
PL-SL189-260511-03   ← Product lot (post-test parted-out)
```

`lotCounters` is now keyed `<prefix>_<code>_<YYMMDD>`, so sequences are
per-workflow per-genetic per-day. Existing pre-prefix counters in
localStorage are orphaned (single-user dev tool, no migration needed).

---

## 17. Workflow Architecture (forward plan)

A **workflow** is a state-change event being labeled. Today the app has one
workflow hard-wired (`grain-spawn`); the architecture is in place to add
more. Each workflow owns four things:

1. **A header label** (what shows next to the QuickLabel logo when active).
2. **A destination state** (what the labeled thing now is).
3. **A lot-type prefix** (e.g. `GL`, `HL`, `BL`).
4. **A media label** (the caption on the bottom data line — for grain-spawn
   it's "Media:", for agar it's "Media:" too but the value carries different
   semantics, for spawn-to-bulk it's "Media:" referring to the bulk substrate
   plus the grain-spawn inputs).

### Workflow chain — pre-regulation lineage tracking

The full chain a genetic line moves through, in order:

```
genetic registry  →  agar plates  →  liquid culture  →  grain spawn
                          ↓                                   ↓
                     (sub-lots,                          (sub-lots,
                      isolations)                         expansions)
                          ↓                                   ↓
                          ←──────── spawn-to-bulk ←───────────┘
                                       ↓
                                    BATCH (inoculation event = regulated boundary)
                                       ↓
                                  flush harvests  →  HARVEST LOT
                                       ↓
                                    homogenize
                                       ↓
                                  HOMOGENIZED LOT  →  test
                                       ↓                 ↓
                                       (cleared)    (rejected)
                                       ↓
                                  PRODUCT LOTS (parted out by SKU/pack size)
```

Each arrow is a state-change event = one workflow = one label-print
opportunity. The **source** field on each label is the lot ID of the
predecessor: that's how lineage propagates. If you ever need to ask "what
went into this product lot," you walk the chain backward via source IDs
until you reach the genetic registry entry.

### Regulated boundary

The **batch** (spawn-to-bulk → inoculation event) is the first lot that
carries regulatory weight in cultivation compliance frameworks. Everything
upstream of it is pre-regulation lineage (useful for the operator, not yet
required by law). Everything from batch onward must be tracked end-to-end:

- Batch ID → all inputs (grain spawn lots, bulk substrate definition,
  inoculation date, room/zone, operator)
- Harvest lot(s) → batch ID + flush number + harvest date
- Homogenized lot → harvest lot(s) it was built from
- Product lot → homogenized lot + pack size + SKU

### Compliance reporting needs (parked, design later)

- **Total ingredients per batch** — every component that touches the bag
  needs to roll up. Grain type, substrate type, additives, water source.
  Gluten/allergen flags. This is why the label's media line had to become
  "Media:" generically — bulk substrate workflows need to surface the
  substrate composition, not the upstream grain.
- **Contaminant flags** — any rejected lot in the chain quarantines
  downstream.
- **Test results linkage** — homogenized lot pairs with a COA from an
  external lab. The product lot label needs the test reference visible
  (and probably a QR linking to the full COA).

### Product lot labels (deferred)

Product lot labels are **structurally different** from cultivation labels:

- Required content is dictated by codified rules (mg per dose, lot ID,
  expiry, manufacturer, allergen statement, COA link, etc.).
- Off-label channels (e.g. wholesale to dispensary) may have their own
  formats.
- Rules are not yet codified in the active jurisdiction — design when they
  are.

The current SVG template architecture supports this cleanly: when the rules
exist, write a new template (`product-lot-2x4` or whatever the regulated
sticker size is), add it to `LABEL_TEMPLATES`, register a printer paired
with it, ship. The form/data layer barely changes.

### Form behavior under workflow switching (parked)

When the workflow is switchable (via the header click target near the logo),
each workflow's left-panel form composition changes:

- **Grain spawn** (today): genetic registry, lineage, lot, grain type.
- **Agar**: genetic registry, lineage, plate ID, agar formulation.
- **Liquid culture**: genetic registry, lineage, vessel size, formulation.
- **Spawn-to-bulk**: bulk substrate definition, grain inputs (multi-select
  of existing grain lots), inoculation date.
- **Harvest**: source batch lot, flush number, wet weight, harvest date.
- **Homogenized**: source harvest lots, mix ratio if applicable.
- **Product**: source homogenized lot, SKU, pack size, expiry math.

The "Details" section in the form panel is also workflow-derived. When in
the grain-spawn workflow it shows "Grain Type"; in agar it would show "Agar
Formulation"; etc. The label's media line caption changes in lockstep.

---

### QR / barcode region (P2)

The right side of the label below the chip is currently empty space. Reserve
it for an optional 2D code (QR for URLs / full lot payload, or DataMatrix /
Code128 for inventory scanners). Implementation note: the SVG template's
viewBox already gives a stable coordinate system; adding a `<g>` at, e.g.,
`(VB.w - padR - QR_SIZE, ruleY + 20)` is a few lines. The mid-block (lot,
notation, source, grain) would clamp its right edge to `chipX - 12` instead
of `VB.w - padR`. **Defer until a real scanning use case exists** — premature
without a workflow that reads them.

### Live layout tuning panel (DONE 2026-05-11)

A development-time fiddle panel for the SVG template's layout object.
Toggle with `\` key or the `▦` header button. Sliders + numeric inputs for
padding, type scale, spacing, chip, and rule properties. Mutates
`LABEL_TEMPLATES[id].layout` in place and re-renders on every input. Reset
restores from `LAYOUT_DEFAULTS` (snapshot at module load). Copy JSON button
dumps the current layout for paste-back into source. Not exposed in print.

Listed here so it's findable for future templates: when a second template
ships, the same panel works against it — just point `activeLayout()` at the
new template's layout object.

### Future label-rendering targets (parked)

The SVG-based renderer means the label is already a vector document. Two
downstream paths become cheap-to-build when needed:

- **PDF export** — serialize the same SVG into a PDF at exact paper size
  (e.g. via `pdf-lib` or server-side `cairo`/`weasyprint`). One label = one
  page. Useful for archival, batch reprint, sharing.
- **Direct-to-printer rendering** — bypass the browser print dialog by
  rasterizing the SVG to the printer's native bitmap (DYMO SDK, ZPL for
  Zebra, etc.). Removes one click per print run, supports per-printer
  defaults, enables the "plug in a new printer and the layout adapts"
  story from the session notes.

Both are mechanically separate from the layout work and don't need to be
designed now.
