# QuickLabel → Cultivation Suite: Merge Handoff

**Written:** 2026-07-01. **Audience:** the Cultivation Suite session doing the fold-in.
**Goal:** you should be able to do the entire merge from this file plus `source/` and
`catalog-export/`, without re-reading QuickLabel's git history or asking follow-up
questions.

**Read order:** this file top to bottom, then `source/FUNCTIONALITY.md` (the
reconciled current-state map this file is built on top of — treat it as the
detailed reference this document summarizes and extends), then dip into
`source/quicklabel.html` / `source/db.js` at the line numbers cited in §G as
needed.

**Framing, up front:** QuickLabel is *not* a label maker with some data
bolted on. It is a small but real **cultivation tracking database** —
genetics catalog, lot-lineage graph, per-user sequence counters, an
inventory view — that happens to render its records as SVG labels as one
output format. Treat the label as a view, not the model. Cultivation
Suite already has (or will have) the relational spine QuickLabel lacks;
the job is porting QuickLabel's *domain knowledge* (what a mycology lab
actually needs to track, precisely) into that spine, plus its label
renderer as one more output your Prisma-backed entities can feed.

---

## A. Full functional map — the cultivation pipeline as a state machine

QuickLabel models a mushroom lab's production pipeline as a chain of
states, each with its own workflow, its own lot-ID prefix, and each
carrying forward a `source` pointer (free-text, not a real foreign key —
see §E/§F) to the state that produced it. The full chain, plus the two
side-branches (swab, reprint):

```
            ┌────────────┐
            │  INGEST    │  new genetic material enters the lab
            │  (IG*)     │  (spore print/swab, tissue, LC, plate, slant, tube)
            └─────┬──────┘
                   │ source (free text, usually a code)
                   ▼
       ┌─────────────────────┐        ┌──────────────────┐
       │   AGAR PLATE (AL)   │◄──────►│ LIQUID CULTURE(LC)│  (peers — either can
       └─────────┬───────────┘        └────────┬──────────┘   feed the other,
                  │                              │              cfg.transferRules
                  ▼                              ▼              says which — see §D)
            ┌────────────────────────────────────────┐
            │           GRAIN SPAWN (GL)             │
            └─────────────────┬───────────────────────┘
                               │ N grain lots as sources
                               ▼
                     ┌───────────────────┐
                     │  BATCH (BL)       │  bulk substrate, one unit label
                     │  multi-source      │  per bin (unit index/count)
                     └─────────┬─────────┘
                               ▼
                     ┌───────────────────┐
                     │ HARVEST LOT (HL)  │  one per flush; wet weight
                     └─────────┬─────────┘
                               ▼
                     ┌───────────────────┐
                     │ RETAIL UNITS (RU) │  gram-weight packaged units,
                     └───────────────────┘  optional potency ref

     side branches, attachable to any genetic/lot at any point:
       SWAB COLLECTION (SW)  — sampling, not production; optional swab-bag range label
       REPRINT (no prefix)   — re-render an existing lot record's label verbatim
```

Registry: `WORKFLOWS` in `source/quicklabel.html:1823-1860`. Nine workflow
ids total; default on load is `grain-spawn`.

### State-by-state: what it creates, what it captures, what it carries forward

**1. Ingest** (`buildIngestLabelData`, `quicklabel.html:3533`) — the only
state with no `source` (it's the root). Creates: a **genetics record**
(`db.genetics`, keyed by `code`) *and* a lot record for the ingest event
itself. Captures: lab code, category (actives/gourmet), genus/species/
cultivar, "received as" media type (7 built-in ingest types — spore print,
spore swab, liquid culture, gill/tissue, agar plate/wedge, slant,
Castellani tube), five **opt-in** sections — lineage (filial/clone/
isolation/transfer), source, origin, family/association, extended notes —
plus a separate iNaturalist block (enabled flag, observation number,
collector, date, location). Lot-ID prefix: **the selected media-type
code** (default `IG` if unset/unmatched — see bug §E.3). Carries forward:
nothing (root of the lineage graph), but the genetics record it creates is
what every downstream workflow's `code` field points back to.

**2. Agar plate / Liquid culture / Grain spawn** (`buildLabelData`,
`quicklabel.html:3929`) — three parallel "media" states sharing one build
function; differ only in prefix and vocabulary. Creates: one lot record
each. Captures: genetic code (autofills genus/species/cultivar/category
from the catalog), destination media (agar formula code, LC vessel type,
or grain type code — each a `cfg` registry, see §D), lineage notation
(filial/clone/isolation/transfer — see §B), free-text `source`. Prefixes:
**AL** (agar), **LC** (liquid culture), **GL** (grain). Carries forward:
`source` (free text, typically a prior lot ID) and the notation string.
`cfg.transferRules` (agar→agar, agar→LC, agar→grain, LC→LC, grain→grain,
grain→bulk) is fully modeled and shown in Settings but **never enforced**
— see §E.4.

**3. Batch** (`buildBatchLabelData`, `quicklabel.html:4085`) — the
spawn-to-bulk-substrate transition, and the first genuinely
multi-source state. Creates: one lot record **per physical unit** (bin);
`unitIndex`/`unitCount` drive a `"Bin 03/12"`-style destination marker via
`batchUnitType()`. Captures: substrate type, a list of **source grain
lots** (`batchSources[]`, each `{lotId, manual}` — manual entries are
free-text, not validated against the catalog). Prefix: **BL**. Carries
forward: `source` on the label = first source's lotId + `" +N"` for the
rest; the stored lot record keeps the **full** `sourceLots[]` array (this
is the one place QuickLabel keeps more than one parent — everywhere else
`source` is a single string). One `lineage.addEdge(parent, childLotId)`
call per source lot.

**4. Harvest lot** (`buildHarvestLotLabelData`, `quicklabel.html:4611`) —
per-flush harvest event. Creates: one lot record per flush. Captures:
source (the batch/bin lot id), flush number (`"Flush N"` destination),
optional wet weight (`"Wet: Ng"` info slot), optional notes (origin).
Prefix: **HL**. Carries forward: `source` = the batch lot id.
**`dryWeight`** is read by the inventory detail view but genuinely never
written anywhere — a real gap, not just a naming quirk (§E.5).

**5. Retail units** (`buildRetailUnitLabelData`, `quicklabel.html:4688`) —
final packaged product. Creates: one lot record per unit run. Captures:
source (harvest lot id), gram weight (destination = `"{g}g"` or generic
`"Retail"`), optional free-text **potency** field (no structured
lab-test/COA model — just a text line), optional notes. Prefix: **RU**.
Carries forward: `source` = harvest lot id.

**6. Swab collection** (`buildSwabLabelData` / `buildSwabBagLabelData`,
`quicklabel.html:4766`/`4787`) — a sampling side-branch usable against any
lot at any pipeline stage, not a production step. Creates: one swab lot
record (+ optionally a batch of "swab bag ×N" labels sharing an ID range).
Captures: source lot, optional notes. Prefix: **SW**.

**7. Reprint** (`buildReprintLabelData`, `quicklabel.html:4915`) —
re-renders a label from an already-stored lot record, verbatim, without
minting a new lot ID or touching counters/lineage. Reconstructs from
`lot.bodySlots` when present, else special-cases batch records, else
falls back to generic flat-field→slot conversion. This is how the
Inventory view's "Reprint" button and the standalone Reprint workflow
both work.

### Non-label tracking capability (the part a naive "label maker" clone would miss)

- **Genetics catalog as a first-class, independently editable entity** —
  not just a lookup populated by ingest. `db.genetics` supports list (with
  text search across code/cultivar/genus/species), get-by-code, create
  (rejects duplicate codes), update-by-`_id`, remove, and soft-archive.
  `renderGeneticsTable` (`quicklabel.html:2570`) is a full CRUD table (Code /
  Cultivar / Genus-Species / Category / Vendor / Ingest Date) with an edit
  modal and row-click-to-load-into-workflow. This is a real "genetics
  master data" surface, independent of any print action.
- **CSV / paste bulk import** (`quicklabel.html:2727` `IMPORT_HEADER_MAP`
  onward) — a header-mapping importer (13 recognized header aliases →
  fields, case/whitespace-insensitive), a preview classifying every row as
  new/update/skip, and a commit step that **merges** `ingestData` on
  update (skips blanks, preserves existing iNat data) rather than
  clobbering. This is genuine data-migration tooling, not a label
  shortcut.
- **Inventory view** (`quicklabel.html:4384`) — a filterable table over
  *all* printed lot records (not just genetics), with prefix filter chips
  and free-text search, newest-first, and a reprint action per row. This
  is the closest thing QuickLabel has to a "browse my production history"
  screen, and it is lot-centric, not label-centric.
- **Reprint-from-ID** — a datalist over every known lot id, live preview,
  full reconstruction from the stored record. Reprinting is a first-class
  workflow, meaning lot records are treated as durable data worth
  retrieving later, not print-and-forget.
- **Lineage graph capture on every single print**, regardless of
  workflow — `db.lineage.addEdge(source, lotId)` fires unconditionally
  (batch fires once per source). The API (`parentsOf`, `childrenOf`,
  `tree(root, {direction, maxDepth})`, cycle-guarded) is a full graph
  traversal layer — **built and populated, but with zero UI surfacing it**.
  This is a materially complete feature sitting unused; porting the *data*
  (the edges) is far more valuable than porting the (nonexistent) UI.
- **Per-(prefix, code, day) sequence counters**, independent of the lot
  records themselves (see §B and bug §E.7) — this is inventory-grade lot
  numbering discipline, not typical of a "just print a sticker" tool.
- **Source-lot autofill** (`onSourceChange`, `quicklabel.html:3771`) —
  typing/pasting a lot ID into any Source field extracts its genetic code
  (`extractCodeFromLotId`) and autofills genus/species/cultivar/category
  from the catalog. This is lightweight but real cross-entity referential
  behavior layered on top of what is otherwise a free-text field.

---

## B. Label engine (for the port)

### Templates

`LABEL_TEMPLATES` object, `quicklabel.html:1947-2172`. Two templates, each
with `render(d)`, `renderSimple(d)`, `fit(svgEl)`:

**`grain-spawn-9x5`** (`quicklabel.html:1948-2120`) — physical: DYMO 30334,
2.25 × 1.25 in. `viewBox: {w:900, h:500}`. Full tunable `layout` object
(all values below are the shipping defaults, also captured verbatim as
`LAYOUT_DEFAULTS`):

```
padL:36 padR:36 padTop:26 padBot:45
cultivarFS:100 cultivarKerning:1.75
speciesFS:38 lotFS:50 lineFS:34 dimFS:34
dateFS:30 notesFS:30
chipH:42 chipPadX:18 chipFS:30
cultivarSpeciesGap:62 speciesRuleGap:20
ruleLotGap:50 lotNotationGap:44 notationSrcGap:44
lotSourceGap:52 lineGap:44
ruleStroke:2 ruleColor:'#d8d8d8'
qrSize:150 qrGap:14
lineFSSmall:28
```

Fields drawn, top to bottom: **cultivar** (headline, bold, letter-spaced,
class `lbl-cultivar`) → **genus + species** (italic subline, class
`lbl-species`, only if either is set) → **category chip** (rounded rect +
centered bold text, top-right, y-aligned to the species line) → **rule**
(horizontal divider line) → **QR reserve box** (dashed placeholder,
top-right below the rule — see below) → **lot ID** (mono, bold, class
`lbl-lot`, only if `d.lotId` set) → **body lines** (up to 4, either the
slot-path or legacy flat-path — see next section) → **footer** (3-column:
left=date, center, right=notes, drawn with `text-anchor` start/middle/end).
`fill="#ffffff"` background rect underneath everything.

**`d11-strip`** (`quicklabel.html:2123-2172`) — physical: Merryhome/NIIMBOT
D11, 14×35mm. `viewBox:{w:875,h:350}` (35:14 landscape). Minimal
`layout:{padL:34, padR:34}` — **no QR reserve, no chip, no rule, no body
slots**: just cultivar, lot ID, date, and destination (as a single
end-anchored line), hardcoded y-positions (118/232/325). This is the
"everything that matters, nothing more" tiny-thermal template — treat
grain-spawn-9x5 as the "full" reference template and d11-strip as proof
that a template can validly omit most fields.

Both templates also expose `renderSimple(d)` — a minimal alternate render
(cultivar + genus/species + date + filial notation only) used when the
global `labelMode` is `'simple'` instead of `'standard'` (toggle intended
for tiny label makers).

### Two render paths — slot-based vs. legacy flat-field

This is the single most important engine detail to preserve or
deliberately supersede in the port. There are **two ways** a caller can
feed `render(d)`:

1. **Slot path** (`d.bodySlots = [{kind, text, source?}, ...]`) — used by
   ingest, harvest, retail, swab. `renderBodySlot(slot, L, y, maxW,
   monoFam, fs)` (`quicklabel.html:1915-1945`) switches on `slot.kind`:
   - `'notation'` — mono gray filial-code line.
   - `'destination'` — plain text; if `slot.source` is set, appends
     `" | Src: <source>"` inline on the *same* line via `<tspan>`s (source
     never gets its own slot).
   - `'origin'` / `'family'` — a small gray label (`"Origin:"` / `"Fam:"`)
     followed by the value in mono.
   - default — plain text, no label.
   Body-line placement (`render()`, `quicklabel.html:2000-2016`): slots are
   stacked starting at `lotY + lotNotationGap`; index ≥ 2 (bottom two
   slots) render at the smaller `lineFSSmall` font with a tighter
   `lineGap*0.82` step. **QR-collision clamp**: any body line whose y-band
   overlaps the QR reserve box has its right edge clamped to `qrX - 12`
   instead of the full label width — this is a real per-line max-width
   computation, not a fixed column.
   Budget: `LABEL_BODY_BUDGET = 4` (`quicklabel.html:3482`).
   `OPTIONAL_BODY_FIELDS = ['origin','family']` (`3483`) — the two fields
   that compete for whatever slots aren't already reserved by destination
   (always, 1 slot) + lineage notation (if its toggle is on, 1 slot). See
   `reservedBodySlots()`/`applySlotBudget()` (`3498-3521`): toggles that
   would overflow the budget are **disabled in the UI**, not silently
   dropped at render time — the user can never build a label that
   silently loses a field.

2. **Legacy flat-field path** (no `d.bodySlots`) — used by agar/LC/grain/
   batch and standalone `batch-labels.html`. Reads `d.notation`,
   `d.destination`, `d.source`, `d.sub`/`d.mediaLabel` directly and lays
   them out at fixed y-offsets (`notationY`, `srcY`, `grainY`). This is
   the *original* rendering approach, preserved verbatim rather than
   migrated — **new port code should standardize on the slot path**; the
   flat path exists only for historical reasons and has no advantage.

### `fit()` — how auto-shrink actually works

`fitText(textEl, maxLen)` (`quicklabel.html:1902-1910`):
```js
function fitText(textEl, maxLen) {
  if (!textEl || !maxLen) return;
  textEl.removeAttribute('textLength'); textEl.removeAttribute('lengthAdjust');
  const natural = textEl.getComputedTextLength();
  if (natural > maxLen) {
    textEl.setAttribute('textLength', maxLen);
    textEl.setAttribute('lengthAdjust', 'spacingAndGlyphs');
  }
}
```
This is **not** a font-size binary search and **not** a text-measurement
canvas trick — it relies on the live SVG DOM's `getComputedTextLength()`
(and, for the chip, `getBBox()`) to get the *actual rendered* width, then
sets the SVG `textLength`/`lengthAdjust="spacingAndGlyphs"` attributes so
the browser's own renderer compresses glyph spacing to fit exactly
`maxLen`. **No truncation, ever** — long cultivar names compress instead
of getting cut off or wrapped. Each template's `fit(svgEl)` method
(`grain-spawn-9x5`: `2082-2097`; `d11-strip`: `2164-2170`) calls this per
named element (`.lbl-cultivar`, `.lbl-species`, `.lbl-lot`,
`.lbl-notation`, `.lbl-src`, `.lbl-grain`, `.lbl-notes`), each against a
different `maxLen` fraction of the content width (species is clamped to
the space left of the category chip's actual bbox; source/grain/notes get
72%/78%/55% of content width respectively — empirically tuned so a full
cultivar name never collides with the chip or the QR box).

**Consequence for the port:** `render()` (string building) is pure and
portable to any server-side renderer. `fit()` is **not** — it requires a
live DOM with `getComputedTextLength`/`getBBox` (a real browser, or a DOM
shim like `linkedom`/`jsdom` with font-metrics support, or — better for a
server-rendered PDF/PNG pipeline — replace it with real font-metrics-based
width computation and either a shrink-to-fit font-size loop or precomputed
glyph-width tables). Do not port `fit()` verbatim into a Node service
without a DOM; port the *intent* (shrink long names to the available
width, never truncate) with whatever text-measurement primitive your PDF
stack provides.

### Category-chip logic (actives vs. gourmet)

Binary category system, no third state. `cat === 'actives'` → chip reads
"ACTIVE" (`fill:#dcfce7 text:#14532d`, green); anything else (including
unset/empty) → chip reads "GOURMET" (`fill:#cffafe text:#164e63`, teal).
This means **the default for an unrecognized/blank category is GOURMET at
render time**, even though `normalizeCategory()` (`quicklabel.html:2955`,
used earlier in the data pipeline) defaults *unset* category to `actives`.
These two defaults disagree — a `cat` value that made it past validation
as "actives" renders green; a `cat` that's genuinely missing/garbled and
skipped normalization renders as the teal GOURMET chip. Worth resolving
explicitly (pick one canonical default) rather than porting both defaults
unreconciled.

Chip width is computed from an approximate glyph-width heuristic
(`chipText.length * chipFS * 0.62`), not measured — it's a fixed multiplier
tuned for the specific font-weight/kerning combination in use, not a
generic solution. If you port to a different font, this multiplier needs
re-tuning or replacing with a real text-measurement call.

Category taxonomy (`TAXA`, `quicklabel.html:1761-1775`) determines
`categoryForGenus()`: **actives** = *Psilocybe* (azurescens,
caerulescens, cubensis, mexicana, ochraceocentrata, subaeruginosa,
subtropicalis, tampanensis, zapotecorum) + *Panaeolus* (cyanescens);
**gourmet** = *Pleurotus* (ostreatus, eryngii, citrinopileatus, djamor,
pulmonarius), *Hericium* (erinaceus, coralloides, abietis), *Ganoderma*
(lucidum, tsugae, oregonense), *Lentinula* (edodes), *Cyclocybe*
(aegerita), *Flammulina* (velutipes). `cfg.customTaxa.{actives,gourmet}`
lets users add genera/species at runtime, merged in via `allTaxa()`
(`2316-2323`).

### Lineage notation derivation (e.g. `F1.C1_A.T3`)

Two near-identical implementations — `buildNotation()`
(`quicklabel.html:3747-3757`, used by agar/LC/grain) and
`buildIngestNotation()` (`3460-3473`, used by ingest, and gated by the
"lineage" opt-in toggle — returns `''` if that toggle is off):

```js
function buildNotation() {
  const parts = [];
  let f = filialInput.trim().toUpperCase();
  if (f) parts.push(f.startsWith('F') ? f : 'F' + f);
  let c = cloneInput.trim().toUpperCase();
  const iso = isoInput.trim().toUpperCase();
  if (c) { if (!c.startsWith('C')) c = 'C' + c; parts.push(iso ? `${c}_${iso}` : c); }
  let t = transferInput.trim().toUpperCase();
  if (t) parts.push(t.startsWith('T') ? t : 'T' + t);
  return parts.join('.');
}
```

Reading `F1.C1_A.T3` token by token:
- **`F1`** — Filial generation 1 (i.e. this is a first-generation isolate/
  cross). User types `1` or `F1`; the function normalizes to always have
  the `F` prefix.
- **`C1_A`** — Clone 1, isolation tag `A`. Clone number normalized the
  same way (`C` prefix enforced); the isolation code (free text, e.g. a
  letter or short tag distinguishing which of several simultaneous clone
  attempts this is) is appended after an underscore **only if present**.
- **`T3`** — Transfer generation 3 (this media has been sub-cultured/
  transferred 3 times from its clone). `T` prefix enforced.
- Any part the user leaves blank is simply omitted — `parts.join('.')`
  means the string always has *only* the tokens that were filled in, in
  Filial → Clone(_Isolation) → Transfer order. There is no validation
  that these are sequential or consistent with any parent's notation —
  it's a free-typed annotation string, not a computed/derived value from
  actual lineage graph traversal. **This is worth upgrading in the port**:
  a real relational lineage graph (parent lot → child lot, with a
  generation/transfer count per edge) could *compute* this notation
  automatically instead of relying on the user to type it correctly every
  time.

### Lot-ID format and the per-day sequence counter

Format: **`PREFIX-CODE-YYMMDD-NN`** — e.g. `GL-SL188-260701-03`. No-prefix
fallback `CODE-YYMMDD-NN` only applies to a workflow with no configured
prefix (there is none among the 9 shipping workflows other than
`reprint`/`ingest`-with-blank-media-type).

- `YYMMDD` from `toYYMMDD(iso)` (`quicklabel.html:2306`): 2-digit year +
  2-digit month + 2-digit day, no separators, from the form's ISO date
  input (not necessarily "today" — user-editable).
- `NN` is a 2-digit zero-padded sequence, **1-99**, i.e. capped at 99 lots
  of the same prefix+code+day (`resetLotCounter()` validates `1 ≤ n ≤ 99`,
  `quicklabel.html:3828-3837`; nothing stops the *natural* increment path
  from exceeding 99 and producing a 3-digit non-zero-padded overflow — the
  cap is only enforced on the manual "reset to N" path, not on organic
  growth past 99 same-day prints).
- **Prefix**: `effectiveLotPrefix()` (`quicklabel.html:2336-2344`) —
  the current workflow's static `lotPrefix` (AL/LC/GL/BL/HL/RU/SW), or for
  `ingest`, the *selected ingest-type code* (falls back to `'IG'` if
  unset/unmatched — this is bug §E.3).
- **Counter key**: `lotKey(code, date)` (`2346-2349`) = `` `${prefix}_${code}_${toYYMMDD(date)}` `` —
  i.e. the counter is keyed on the *triple* (prefix, genetic code, day),
  **not** on prefix+day alone and **not** on code alone. Two different
  genetics printed as grain spawn on the same day get independent
  `01, 02, ...` sequences; the same genetic printed as both agar and grain
  spawn on the same day *also* gets independent sequences (different
  prefix). This triple-keying is precisely why the format needs all three
  segments to be unambiguous.
- **`nextSeq(code, date)`** (`2351-2355`) = `(lotCounters[key] || 0) + 1` —
  pure read, does not itself increment anything.
- **Increment happens at print time**, one `lotCounters[key] = ...`
  assignment per print call site (`quicklabel.html:4147, 4333, 4657, 4734,
  4839` — one per workflow that mints new lot IDs), immediately followed
  by `persistLots()`. Multi-unit print runs (batch, swab-bag, retail,
  harvest ranges) set the counter to `start + qty - 1` in one shot rather
  than looping N individual increments.
- **Storage**: the whole `lotCounters` dict is persisted under the
  `counters` slot, which — naming trap — is stored at storage key
  `…:lots` (not `…:counters`; see §D). It survives independently of the
  `lots` slot's actual lot records (see bug §E.7 — they can diverge).
- **Manual override**: `resetLotCounter()` (`3828-3846`) prompts for a new
  next-sequence-number (1-99) for the *current* (workflow prefix, code,
  date) triple and sets `lotCounters[key] = n - 1` so the next mint
  produces `n`.
- **Validator** (round-trip check, used to recognize a string as a lot ID
  rather than free text): `extractCodeFromLotId`, regex
  `^[A-Z]{1,5}-([A-Z]{1,6}\d+)-\d{6}-\d{2}$` (`quicklabel.html:2326-2333`,
  also accepts a bare code with no dashes as a degenerate case).

---

## C. Data model — exact shapes

QuickLabel is not relational — every "table" is a JSON array/object blob
persisted as one `localStorage` value (and mirrored as one Supabase row's
`data` column). Below: every field actually written anywhere in the code,
its type, whether anything requires it, an example, and what it's for.
**★ = consumed directly by label rendering** (i.e. dropping this field
would visibly change a printed label); everything else is catalog/
record-keeping data with no render-time consumer today.

### Genetics record (`db.genetics`, array)

| Field | Type | Required? | Example | Purpose |
|---|---|---|---|---|
| `_id` | string | yes (auto) | `g_m3x2ab_k9f2q1` | Stable id: `g_<base36 ms timestamp>_<random>`. Primary key equivalent. |
| `code` | string | soft (create rejects dup, not empty) | `"SL188"` | ★ Lab code — the join key every workflow's genetic picker uses. Uppercased on compare. |
| `cat` | `'actives'\|'gourmet'` | no (defaults via `normalizeCategory`) | `"actives"` | ★ Drives the label's category chip color/text. |
| `genus` | string | no | `"Psilocybe"` | ★ Species subline. |
| `species` | string | no | `"cubensis"` | ★ Species subline. |
| `cultivar` | string | no (but effectively required to be useful) | `"Golden Teacher"` | ★ Label headline. |
| `ingestData.mediaType` | string (ingest-type code) | no | `"SP"` | Non-render; how the genetic first arrived. |
| `ingestData.mediaLabel` | string | no | `"Spore Print"` | Non-render; display label for mediaType. |
| `ingestData.vendor` | string | no | `"Ralphsters"` | Non-render; supplier/source. |
| `ingestData.originator` | string | no | `"J. Smith"` | Non-render; who found/bred it. |
| `ingestData.originDate` | ISO date string | no (no UI currently surfaces it — dead field, see §E) | `"2025-11-02"` | Non-render; provenance date. |
| `ingestData.family` | string | no | `"Cambodian x GT"` | ★ (if the ingest "family" body slot is enabled) cross/lineage family label. |
| `ingestData.inat.enabled` | boolean | no | `true` | Gates iNat footer display. |
| `ingestData.inat.number` | string | no | `"123456789"` | ★ Rendered in footer as `iNat <number>` when enabled. |
| `ingestData.inat.collector` | string | no | `"J. Smith"` | Non-render; record-keeping only. |
| `ingestData.inat.date` | ISO date string | no | `"2025-10-30"` | Non-render. |
| `ingestData.inat.location` | string | no | `"Humboldt Co., CA"` | Non-render. |
| `ingestData.extNotes` | string | no | `"Found on old-growth Doug fir"` | Non-render/free text. |
| `ingestData.ingestDate` | ISO date string | no | `"2025-11-02"` | Non-render; when logged into the catalog. |
| `archived` | boolean | no | `true` | Soft-delete flag (`db.genetics.archive`). |
| `createdAt` | ISO datetime | yes (auto) | `"2025-11-02T18:04:11.203Z"` | Audit. |
| `updatedAt` | ISO datetime | yes (auto) | same shape | Audit; bumped on every `update()`. |
| `_fromCfg` | boolean | no | `true` | Set only by `syncGeneticsAndCfg()` when a record was backfilled from `cfg.codes` rather than created directly — a migration marker, not real domain data. |

### Lot record (`db.lots`, array — one row per print run)

Union of every field any workflow writes; not every row has every field.

| Field | Type | Required? | Example | Purpose |
|---|---|---|---|---|
| `lotId` | string | yes | `"GL-SL188-260701-03"` | ★ Primary key equivalent; the printed lot ID. |
| `workflowId` | string | yes | `"grain-spawn"` | Which of the 9 workflows produced this row. |
| `geneticCode` | string | usually | `"SL188"` | FK-ish pointer to `db.genetics.code` (not enforced). |
| `cultivar`, `genus`, `species`, `cat` | strings | usually | — | ★ Denormalized copy of the genetics record *at print time* — this row does not update if the genetics record is later edited. |
| `notation` | string | no | `"F1.C1_A.T3"` | ★ Filial code at print time. |
| `destination` | string | usually | `"Grain Spawn"` / `"Bin 03/12"` / `"Flush 2"` / `"12g"` / `"Swab"` | ★ Body-line text — meaning varies per workflow (see §A per-state). |
| `source` | string | usually | `"AL-SL188-260630-01"` | ★ Free-text pointer to a parent lot ID (or arbitrary text) — see §F, this is the single biggest structural weakness to fix in the port. |
| `sub` | string | agar/LC/grain only | `"RYE"` / `"MEA"` / `"JAR"` | ★ Media/vessel/substrate sub-code (legacy flat path). |
| `notes` | string | no | `"slow colonizer"` | ★ Footer-right text. |
| `date` | ISO date string | yes | `"2026-07-01"` | ★ Footer-left (formatted via `fmtDate`) and part of the lot-ID's `YYMMDD`. |
| `qty` | number | no | `3` | How many labels were printed in this run (not necessarily 1 lot = 1 physical unit for multi-unit runs). |
| `status` | string | yes (defaults `'active'`) | `"active"` | Only value ever written is `'active'` — no lifecycle transitions exist (§E "NOT built"). |
| `createdAt` | ISO datetime | yes (auto) | — | Audit. |
| `unitType` | string | batch only | `"Bin 03/12"` | Batch's per-unit marker. |
| `sourceLots` | `string[]` | batch only | `["GL-SL188-260630-01","GL-SL188-260630-02"]` | ★ Full multi-parent list (label shows only the first + "+N"). |
| `flushNumber` | number | harvest only | `2` | ★ "Flush N" destination text. |
| `wetWeight` | number (grams) | harvest, optional | `450` | ★ Optional "Wet: Ng" info slot. |
| `dryWeight` | number (grams) | **never written** | — | Read by inventory detail UI only; always blank in practice — a real gap (§E.5). |
| `state` | string | harvest only | (freeform) | Not consistently populated; treat as legacy/未use. |
| `gramWeight` | number | retail only | `12` | ★ `"{g}g"` destination text. |
| `potencyRef` | string | retail, optional | `"Batch COA #204"` | ★ Optional free-text potency line — **not** a structured lab-test/COA record. |
| `bodySlots` | `Array<{kind,text,source?}>` | slot-path workflows only (ingest/harvest/retail/swab) | see §B | ★ The actual rendered body lines, stored verbatim so reprint can reproduce them exactly without re-deriving. |

### Lineage edge (`db.lineage`, array)

| Field | Type | Required? | Example | Purpose |
|---|---|---|---|---|
| `parent` | string | yes | `"AL-SL188-260630-01"` | Free-text — usually a lot ID, sometimes arbitrary user-typed text (whatever was in the Source field). |
| `child` | string | yes | `"GL-SL188-260701-03"` | Always a real minted lot ID (the print that created the edge). |
| `createdAt` | ISO datetime | yes (auto) | — | Audit. |

Deduped on `(parent, child)` exact match before insert (`addEdge`,
`db.js:504-514`). No edge metadata (no generation/transfer-count/date
recorded on the *edge* — only in the *notation string* on the child).

### `cfg` (config/settings blob, one object)

| Field | Type | Required? | Example | Purpose |
|---|---|---|---|---|
| `prefix` | string | yes (default `'SL'`) | `"SL"` | Legacy/unused label-code prefix from before per-workflow prefixes existed. |
| `codes` | array of genetics-shaped objects | yes (default `[]`) | — | **Derived cache**, not authoritative — see §D. |
| `grainTypes` | `{code,desc}[]` | yes (seeded) | `{code:'RYE',desc:'Rye berries'}` | ★ Populates the grain-spawn "sub" dropdown; `desc` shown next to the code in-app, not on the label. |
| `ingestTypes` | `{code,label}[]` | yes (seeded) | `{code:'SP',label:'Spore Print'}` | ★ Populates ingest "received as" dropdown; `code` becomes the lot-ID prefix for ingest. |
| `agarFormulas` | `{code,desc}[]` | yes (seeded) | `{code:'MEA',desc:'Malt Extract Agar'}` | ★ Populates agar-plate "media" dropdown. |
| `substrates` | array | yes (default `[]`, never seeded) | — | Intended for batch substrate types; **empty by default, no `DEFAULT_SUBSTRATES` constant exists** — batch substrate is currently free text. |
| `customTaxa.actives` / `.gourmet` | `{[genus]: species[]}` | yes (default `{}`) | `{Psilocybe: ['ovoideocystidiata']}` | ★ User-added genus/species merged into `TAXA` at render/picker time. |
| `fieldVis.source` / `.filial` / `.clone` | boolean | yes (default all `true`) | — | Show/hide toggles for those form fields — cosmetic, doesn't gate data capture once entered. |
| `transferRules.*` | booleans (7 flags) | yes (seeded, see §D) | — | **Declarative only — never enforced** (§E.4). |

Vessel types (`JAR`, `10mL`, `20mL`, `BAG`) are **not** part of `cfg` —
they're the hardcoded constant `DEFAULT_VESSEL_TYPES`
(`quicklabel.html:1804-1809`), the one media registry that isn't
user-editable in Settings. Worth noting as an inconsistency if you're
building a unified "media/vessel registry" admin screen — the port should
almost certainly make all four registries (grain/ingest/agar/vessel)
equally editable.

### Counters (`db.lots._loadCounters/_saveCounters`, one flat object)

`{ "<PREFIX>_<CODE>_<YYMMDD>": <lastSequenceIssued:number>, ... }` — e.g.
`{"GL_SL188_260701": 3}`. See §B for the keying/increment mechanics. This
is its own top-level slot (`counters`), independent of the `lots` record
array — see bug §E.7 for why that independence is a footgun.

---

## D. Persistence & config — exact keys and every registry default

### localStorage key scheme

Active user pointer: `ql_active_user` (plain string, not namespaced).
Everything else: `ql_u:<user>:<slot>`, where `<slot>` is one of `cfg,
counters, form, genetics, lots, lineage`. **Naming trap**: the storage
key for the `counters` slot is `…:lots` and the storage key for the `lots`
(records) slot is `…:lot_records` — i.e. the slot *names* the code uses
internally don't match their own storage-key suffixes 1:1
(`db.js:47-57`, `keysFor()`). Don't carry this naming quirk into a fresh
schema — name tables for what they hold (`lot_counters` / `lots`), not for
this historical accident.

Legacy unnamespaced keys (pre-multi-user): `ql_cfg, ql_lots, ql_form,
ql_genetics, ql_lot_records, ql_lineage` — imported into a user's
namespace once on their first-ever login (`importLegacyForUser`,
`db.js:364-378`), then left alone as a read-only backup;
`db.session.purgeLegacy()` deletes them.

### Supabase `ql_store` table

One row per `(user_id, slot)`:

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | Supabase Auth `auth.uid()` — RLS partition key. |
| `slot` | text | One of `cfg, counters, genetics, lots, lineage` (**not** `form` — device-local, never synced). |
| `data` | jsonb | The entire slot's JSON blob (array or object, whatever that slot's shape is). |
| `updated_at` | timestamptz | Set by the client on every push. |

`on_conflict=user_id,slot` with `Prefer: resolution=merge-duplicates` —
i.e. upsert keyed on the `(user_id, slot)` pair (`db.js:112-125`).
Writes are debounced 600ms per `(user, slot)` key (`queuePush`,
`db.js:126-132`) — rapid form edits coalesce into one push. On login,
`pullRemote()` (`db.js:134-159`) fetches all of that user's rows, seeds
localStorage from them, then **pushes any local-only slots the cloud
doesn't have yet** (first-login-ever seeds the cloud; doesn't clobber a
richer cloud state with a thinner local one). `SYNC_SLOTS = ['cfg',
'counters', 'genetics', 'lots', 'lineage']` (`db.js:97`) is the exact
sync allowlist.

Auth model: Supabase Auth via a **synthetic email** derived from the
username (`emailFor`, `db.js:179-182`) — simple usernames (`^[a-z0-9._-]+$`)
get `<user>@quicklabel.app`; anything with special characters gets a
FNV-1a-hash-derived `u<hash>@quicklabel.app`. The *real* username rides in
`user_metadata`. Password auth (`grant_type=password`), refresh tokens,
admin-settable `force_pw` flag forcing a password change on next login,
self-serve reset via RPC `claim_password` (only works if an admin flagged
the account). Token cached in `ql_sb_token` with `{access_token,
refresh_token, username, uid, expires_at}`. `AUTH_EPOCH` version string
force-logs-out every device once when bumped. **None of this
username/password/RLS auth model should be ported** — it's orthogonal
plumbing for a single-file localStorage app; Cultivation Suite already has
(or will have) its own real auth. Only the *field shapes* matter.

### Every `cfg` registry, defaults enumerated verbatim

```js
DEFAULT_GRAIN_TYPES = [
  { code: 'RYE',    desc: 'Rye berries' },
  { code: 'OATS',   desc: 'Whole oats' },
  { code: 'MILLET', desc: 'Millet' },
];

DEFAULT_INGEST_TYPES = [
  { code: 'SP', label: 'Spore Print' },
  { code: 'SS', label: 'Spore Swab' },
  { code: 'LI', label: 'Liquid Culture' },
  { code: 'GT', label: 'Gill / Tissue' },
  { code: 'AP', label: 'Agar Plate / Wedge' },
  { code: 'SN', label: 'Slant' },
  { code: 'CT', label: 'Castellani Tube' },
];

DEFAULT_AGAR_FORMULAS = [
  { code: 'MEA',  desc: 'Malt Extract Agar' },
  { code: 'PDYA', desc: 'Potato Dextrose Yeast Agar' },
  { code: 'MYPA', desc: 'Malt Yeast Peptone Agar' },
  { code: 'RBA',  desc: 'Rose Bengal Agar' },
  { code: 'WBA',  desc: 'Water Agar (Blank)' },
];

// NOT part of cfg — hardcoded constant, not user-editable in Settings:
DEFAULT_VESSEL_TYPES = [
  { code: 'JAR',  desc: 'Bulk Jar' },
  { code: '10mL', desc: '10mL Syringe' },
  { code: '20mL', desc: '20mL Syringe' },
  { code: 'BAG',  desc: 'Filter Patch Bag' },
];

DEFAULT_TRANSFER_RULES = {
  allowOverride: true,
  agarToAgar:    true,
  agarToLC:      false,
  agarToGrain:   false,
  lcToLC:        true,
  grainToGrain:  true,
  grainToBulk:   false,
};
// Declarative only — see §E.4. Persisted + editable in Settings; never
// read by any print or validation path.

// cfg object's own top-level defaults:
cfg = {
  prefix:        'SL',              // legacy, effectively dead
  codes:         [],                // derived cache — see below
  grainTypes:    [...DEFAULT_GRAIN_TYPES],
  ingestTypes:   [...DEFAULT_INGEST_TYPES],
  agarFormulas:  [...DEFAULT_AGAR_FORMULAS],
  substrates:    [],                 // never seeded — no DEFAULT_SUBSTRATES
  customTaxa:    { actives: {}, gourmet: {} },
  fieldVis:      { source: true, filial: true, clone: true },
  transferRules: { ...DEFAULT_TRANSFER_RULES },
};
```

`cfg.codes` vs `db.genetics`: `cfg.codes` is a **derived cache** of the
genetics catalog, kept for backward compatibility with UI code that reads
`cfg.codes` directly (datalists, the Settings "N genetics" count).
`db.genetics` is authoritative. Two reconciliation passes run on every
load: `loadStorage()` (`quicklabel.html:2359-2379`) rebuilds `cfg.codes`
fresh from `db.genetics.list()` every time (so it can never show a stale
or cross-user set); `syncGeneticsAndCfg()` (`db.js:304-357`) additionally
unions the two lists bidirectionally by composite key (`code`, or
`genus|species|cultivar` fallback for legacy code-less rows), backfilling
`_id` on any genetics row that lacks one. **Port takeaway:** don't carry
`cfg.codes` forward as a separate table at all — collapse straight to one
genetics table; the dual representation exists purely as compatibility
debt in the single-file app.

---

## E. Known bugs / footguns — do NOT carry these over

1. **Inventory filter-chip prefix mismatch (real bug).** The Inventory
   view's `IV_TYPES` filter chips use badge codes `GS` (meant for grain)
   and `AP` (meant for agar) (`quicklabel.html:4386`), but the workflows
   that actually mint those lots use prefixes `GL-` and `AL-`
   (`WORKFLOWS`, `1823-1860`). Result: grain-spawn and agar-plate lots
   **never match their own filter chip** in Inventory. Fix in the port by
   deriving filter badges from the *same* prefix constants the workflows
   use — never hand-maintain a second parallel list of codes.

2. **`@page` print size is hardcoded** to 2.25in × 1.25in (the DYMO size)
   regardless of which printer/template is actually selected
   (`quicklabel.html:666`). Printing the Merryhome/D11 template through
   the browser dialog gets the wrong page size. In a server-rendered PDF
   pipeline this class of bug goes away naturally (page size becomes a
   real per-template parameter) — just don't accidentally hardcode a
   single physical size anywhere in the new renderer either.

3. **Ingest `IG` silent fallback compounds bug #1.** If the ingest
   media-type selection is unset or doesn't match a known code,
   `effectiveLotPrefix()` falls back to `'IG'` — a prefix no `IV_TYPES`
   filter chip recognizes either. A relational schema with a real
   NOT NULL/enum ingest-type foreign key eliminates this class of bug
   entirely; don't replicate a silent string fallback for a required
   classification field.

4. **Transfer rules are fully modeled and displayed but never enforced.**
   `cfg.transferRules` (agarToAgar, agarToLC, agarToGrain, lcToLC,
   grainToGrain, grainToBulk, allowOverride) is persisted and editable in
   Settings, but no print or validation code path reads it — a user can
   record an agar→grain transfer even when that rule says `false`. If the
   port wants real enforcement (worth doing — this is exactly the kind of
   guardrail a *tracking* system should have that a *label maker* doesn't
   need), it must be newly wired into the workflow-transition validation,
   not assumed to already work because the config exists.

5. **`dryWeight` is read but never written.** The inventory detail view
   displays `lot.dryWeight`, but no harvest-lot code path ever sets it —
   it is always blank in practice. Either implement the write path for
   real in the port, or drop the field rather than shipping a phantom
   column that looks populated-by-design but never is.

6. **`COMPLEX_INGEST_TYPES` is dead code.** Declared
   (`{AP,LI,SN,CT,GT}`, `quicklabel.html:1794`) as "ingest types that
   carry complex lineage," but the current ingest form shows the
   lineage/source/origin/family toggles unconditionally regardless of
   media type — this set is effectively unused. Also: pre-prefix lot
   counters from an earlier app version are orphaned with no migration
   path (harmless in a single-user tool; would matter in a multi-tenant
   import).

7. **Counters and lot records are two independent stores that can
   diverge.** Resetting a counter (`resetLotCounter`) does not touch or
   validate against existing lot records, and at least one code path (the
   per-swab-bag loop) can create lot records without advancing the
   counter that "owns" that lot-id sequence. In a relational schema, make
   the sequence-number generation and the lot-record insert a **single
   transaction** (e.g. a DB sequence or a `SELECT ... FOR UPDATE` +
   insert) so they structurally cannot diverge — don't port the
   two-independent-blobs design.

8. **`AUTH_EPOCH` force-logout mechanism** — a version string bump forces
   every device to re-authenticate once. Irrelevant to port (auth is
   being replaced wholesale) but flagging so nobody mistakes the constant
   for meaningful domain data if skimming the code.

9. **`cfg.codes` ⇄ `genetics` bidirectional sync runs on every login** —
   a deliberate compatibility shim carrying real cost (two representations
   of one catalog, reconciled repeatedly). See §D for the resolution:
   collapse to one genetics table in the port, full stop.

10. **Category-default disagreement** (see §B) — `normalizeCategory()`
    defaults unset/garbled category to `actives`, but the label chip's
    own fallback (`cat === 'actives' ? ... : 'gourmet'`) means anything
    that *isn't literally* the string `'actives'` renders as the teal
    GOURMET chip. Pick one canonical default in the port and apply it
    consistently at the data layer, not per-renderer.

11. **Potency/lab-test data is a single free-text field**
    (`potencyRef` on retail-unit lots) — there is no structured lab-test
    result model (no analyte list, no COA reference id, no test date/lab
    name). If Cultivation Suite needs real compliance-grade potency
    tracking, this needs to be designed fresh — QuickLabel has nothing to
    port here beyond "there should be a place to put a short reference
    string on the label."

---

## F. Candid merge assessment

### Where QuickLabel's model is genuinely *better* than a plain relational tracker would default to

- **The opt-in body-slot budget model** (`LABEL_BODY_BUDGET`,
  `reservedBodySlots`/`applySlotBudget`) is a small but real solved
  problem: rather than cramming an arbitrary number of optional fields
  onto a fixed-size label and hoping they fit, it computes remaining
  capacity live and **disables** (not silently truncates) whichever
  optional toggle would overflow. A relational "just render every
  non-null field" approach would need this exact logic reinvented — worth
  porting as a first-class concept (a per-template "field budget"), not
  just copying the magic number 4.
- **Never-truncate auto-shrink** (`fit()`/`fitText`) is a genuinely good
  UX call for a physical label: a long cultivar name compresses instead
  of getting cut off mid-word or silently wrapping into the next field's
  space. Whatever text-layout approach the port uses (PDF library, canvas,
  SVG), preserve "shrink, never truncate, never overlap" as a hard
  requirement — that's the actual design contract, not the specific
  `textLength` mechanism.
- **Lineage-edge capture as a mandatory side effect of every print**
  (`db.lineage.addEdge` fires unconditionally) means QuickLabel's data,
  despite the free-text `source` field, is *denser* with real parent/child
  relationships than a schema that makes lineage capture optional would
  produce in practice — because a lab worker printing a label will always
  do it, whereas a separate "log the lineage" step often gets skipped.
  Port the *pattern* (lineage capture is a byproduct of the state-machine
  transition, not a separate optional form) even as you make the pointer
  itself a real foreign key.
- **The (prefix, code, day)-triple-keyed sequence counter** is a sensible,
  human-legible numbering scheme that a from-scratch relational design
  might reach for something less readable (a global auto-increment or a
  UUID) — worth keeping the *lot-ID format* even after the underlying
  counter mechanism becomes a real DB sequence per key.
- **The CSV import's new/update/skip preview with merge-not-clobber
  semantics** on update is more careful than most quick-and-dirty
  importers — it explicitly protects existing iNat data and skips blank
  incoming values rather than overwriting good data with empty cells.
  Worth carrying the *behavior* forward into any bulk-import tooling
  Cultivation Suite builds.
- **Reprint-from-stored-record** (rather than re-deriving a label from
  current entity state) means a printed label's exact historical content
  is always reproducible even after the genetics record or config changes
  later — this is effectively an audit/snapshot pattern (`bodySlots`
  stored verbatim on the lot row) worth keeping conceptually: store a
  point-in-time render payload alongside the live relational data, don't
  reconstruct historical labels purely from current joins.

### Where it's weaker — fix these, don't preserve them

- **`source` is a free-text string everywhere**, not a foreign key. This
  is the single biggest thing to *not* carry over structurally — every
  lineage edge, every "which lot did this come from" pointer is a string
  that happens to often look like a lot ID but is never validated or
  constrained to be one. In Cultivation Suite this must become a real
  foreign key (lot → parent lot, nullable, with referential integrity),
  with the lineage-edge table becoming the join representation of a
  proper parent/child relationship, not a denormalized string-matching
  side table.
- **No lot lifecycle/status model** — `status` is always the literal
  string `'active'`; there's no consumed/discarded/contaminated/expired
  state, no `remaining` quantity tracking, no per-lot event log beyond the
  print-time snapshot. A real cultivation tracker needs this; QuickLabel
  has nothing to port here except the observation that it's missing.
- **No structured potency/COA model** (§E.11).
- **Transfer rules that don't do anything** (§E.4) — either implement
  real enforcement in the port or don't bother modeling the rules at all;
  a config screen that lies about what it does is worse than no config
  screen.
- **The `cfg.codes` / `db.genetics` dual representation** (§D, §E.9) is
  pure migration debt from the app's own history — collapse to one table,
  don't inherit the reconciliation logic.
- **`dryWeight` and `originDate`** are schema fields with no working
  write path — decide per-field whether to actually implement or actually
  delete; don't port a column that's silently always empty.
- **No QR/barcode encoding**, only a reserved layout box — if Cultivation
  Suite wants scannable labels (plausible for a real production tracker),
  this needs a real encoder (e.g. a QR library keyed on lot ID or a
  lookup URL), designed fresh; nothing to port but the reserved-space
  *idea*.

### Places QuickLabel's data won't map cleanly onto relational tables

- **`bodySlots` is a rendered-output snapshot, not source data** — it's
  an array of `{kind, text, source}` where `text` is already
  human-formatted (e.g. `"Wet: 450g"`). Don't import this into a
  structured `wetWeight` column expecting to parse it back out reliably;
  instead re-derive equivalent slots from the *other*, already-structured
  fields on the same lot row (which do exist for harvest/retail — see the
  Lot record table in §C) and treat `bodySlots` only as a legacy-render
  fallback for old imported rows that might lack full structured fields.
- **`batchSources[]` mixes real lot IDs and manual free-text entries**
  (`{lotId, manual}`) — some multi-parent batch sources are validated
  against the catalog, others are just typed strings the user asserts are
  real. A relational import needs an explicit reconciliation/review step
  for the `manual: true` rows (they cannot be turned into a clean foreign
  key automatically), not a blind FK constraint that will simply fail to
  import them.
- **Genetics records with legacy blank-species/genus-jammed-with-full-
  binomial** (documented in the pre-existing `HANDOFF.md`: "Psilocybe
  cubensis" typed into the genus field with species left empty) exist in
  real historical data and were deliberately never auto-split to avoid
  silent mutation. A relational import with separate NOT NULL genus/
  species columns will hit these rows — plan a manual review pass for
  catalog rows where `species` is empty but `genus` contains a space, not
  an automated regex split (the original app avoided that specifically
  because it's lossy/ambiguous for edge cases).
- **The counters slot has no natural relational home** other than a
  literal `(prefix, code, date) -> last_seq` table or a computed
  `MAX(sequence) FROM lots WHERE ...` — given bug §E.7 (counters and
  records can already disagree in the source data), don't trust the
  imported `counters` blob as ground truth; on import, recompute each
  key's counter from the actual imported lot records' sequence numbers
  and treat the stored counter values as a secondary sanity check, not
  the source of truth.

---

## G. Source pointers — exact functions/files to port

All line numbers refer to `source/quicklabel.html` and `source/db.js` in
this bundle (verbatim copies of the files at repo root as of 2026-07-01).

### Label engine (portable string-building layer)

| What | File : lines |
|---|---|
| `TAXA` (built-in genus/species taxonomy) | `quicklabel.html:1761-1775` |
| `DEFAULT_GRAIN_TYPES` / `DEFAULT_INGEST_TYPES` / `DEFAULT_AGAR_FORMULAS` / `DEFAULT_VESSEL_TYPES` / `DEFAULT_TRANSFER_RULES` | `quicklabel.html:1777-1819` |
| `WORKFLOWS` registry | `quicklabel.html:1823-1860` |
| `PRINTERS` registry | `quicklabel.html:1877-1888` |
| `CHIP_COLORS` | `quicklabel.html:1893-1896` |
| `svgEsc` | `quicklabel.html:1898-1900` |
| `fitText` (the shrink-to-fit primitive — needs a live-DOM replacement server-side) | `quicklabel.html:1902-1910` |
| `renderBodySlot` (slot-path body-line renderer) | `quicklabel.html:1915-1945` |
| `LABEL_TEMPLATES['grain-spawn-9x5']` (`layout`, `render`, `fit`, `renderSimple`) | `quicklabel.html:1948-2120` |
| `LABEL_TEMPLATES['d11-strip']` | `quicklabel.html:2123-2172` |
| `LAYOUT_DEFAULTS` | `quicklabel.html:2174` |
| `renderLabel(host, d, opts)` (template dispatch, scale, simple-mode) | `quicklabel.html:2180-2189+` (continues past excerpt; read to the closing brace) |
| `svgToPng(svgEl, dpi)` (300 DPI canvas rasterization) | `quicklabel.html:4259` onward |
| `extractCodeFromLotId` | `quicklabel.html:2326-2333` |
| `effectiveLotPrefix` | `quicklabel.html:2336-2344` |
| `lotKey` / `nextSeq` | `quicklabel.html:2346-2355` |
| `resetLotCounter` | `quicklabel.html:3828-3846` |
| `buildNotation` (agar/LC/grain filial-code builder) | `quicklabel.html:3747-3757` |
| `buildIngestNotation` (ingest filial-code builder, opt-in gated) | `quicklabel.html:3460-3473` |
| `LABEL_BODY_BUDGET` / `OPTIONAL_BODY_FIELDS` / `reservedBodySlots` / `applySlotBudget` | `quicklabel.html:3482-3521` |
| `normalizeCategory` | `quicklabel.html:2955` (see `FUNCTIONALITY.md` §9 for behavior) |
| `categoryForGenus` / `allTaxa` | `quicklabel.html:2309-2323` |

### The `build*LabelData` family (per-workflow label-data assembly — the

part that maps your entities onto the `d` object the renderer consumes)

| Workflow | Function | File : line |
|---|---|---|
| Ingest | `buildIngestLabelData()` | `quicklabel.html:3533` |
| Agar / LC / Grain (shared) | `buildLabelData(seqOverride)` | `quicklabel.html:3929` |
| Batch | `buildBatchLabelData(unitIndex, unitCount)` | `quicklabel.html:4085` |
| Harvest lot | `buildHarvestLotLabelData(seq)` | `quicklabel.html:4611` |
| Retail units | `buildRetailUnitLabelData(seq)` | `quicklabel.html:4688` |
| Swab | `buildSwabLabelData(seq)` / `buildSwabBagLabelData(firstSeq, qty)` | `quicklabel.html:4766` / `4787` |
| Reprint | `buildReprintLabelData(lot)` | `quicklabel.html:4915` |

### CSV/paste import

| What | File : line |
|---|---|
| `IMPORT_HEADER_MAP` | `quicklabel.html:2727` |
| `parseImport` / `parseDelimited` / `parseCSV` / `buildImportPreview` / `recordFromRow` / `commitImport` | see `FUNCTIONALITY.md` §10 for the full call chain; all in the same region as `IMPORT_HEADER_MAP` |

### Inventory / reprint / lineage UI

| What | File : line |
|---|---|
| Inventory view + `IV_TYPES` (**note bug §E.1** before porting these badge codes) | `quicklabel.html:4384-4386+` |
| `inventoryReprint` | `quicklabel.html:4384` region |
| Reprint datalist + `onReprintIdChange` | `quicklabel.html:4867` |
| `onSourceChange` (source-lot autofill) | `quicklabel.html:3771` |
| `renderGeneticsTable` (catalog CRUD table) | `quicklabel.html:2570` |

### `db.js` — the whole file is short (551 lines) and worth reading end to
end rather than jumping to line numbers; the API surface (for shape
reference, not for porting the implementation):

| Namespace | Methods | File : line |
|---|---|---|
| `db.session` | `login, logout, currentUser, isLoggedIn, hasLegacyData, purgeLegacy, refresh, mustChangePassword, changePassword, claimPassword` | `db.js:380-413` |
| `db.genetics` | `list, get, create, update, remove, archive` | `db.js:416-463` |
| `db.lots` | `list, get, byPrefix, nextNumber, create, _loadCounters, _saveCounters` | `db.js:468-500` |
| `db.lineage` | `addEdge, parentsOf, childrenOf, tree` | `db.js:503-536` |
| `db.config` | `get, set` | `db.js:539-542` |
| `db.form` | `save, restore` | `db.js:545-548` |
| `syncGeneticsAndCfg` (the cfg.codes⇄genetics reconciliation — read for the *problem* it solves, not to reimplement) | `db.js:304-357` |

---

## Appendix: files in `source/`

- `quicklabel.html` — the whole app, ~5,136 lines, verbatim copy.
- `db.js` — the data layer, 551 lines, verbatim copy.
- `FUNCTIONALITY.md` — the authoritative current-state map this handoff is
  built on top of; read it for anything this file summarizes rather than
  quotes in full.
- `feature-map.html` — a visual/HTML rendering of the same functional map;
  open in a browser for a quick skim, corroborates (doesn't add to)
  `FUNCTIONALITY.md`.

See `../catalog-export/README.md` for the state of the real production
data export (blocked by this session's network policy — script + exact
instructions provided, no data fabricated).
