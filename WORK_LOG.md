# QuickLabel — Local Session Work Log

This file tracks every change made in the Claude Code session so the next
maintainer (or emergent) can pick up cold without spelunking the diff. Each
entry is dated and scoped to one concern. Newest changes at the top.

---

## 2026-05-17 — Slot model polish: QR +50%, source inline, smaller bottom lines

**Files.** `quicklabel.html`.

**Changes.**
- **QR reserve grew 50%** — `qrSize: 100 → 150` viewBox units (~9.5 mm
  physical). More confident scan range; a bit more horizontal real estate
  reserved on the body lines.
- **Source piggybacks on the destination line.** The destination slot now
  carries an optional `source` value and renders as
  `Liquid Culture  |  Src: TBG`. Source no longer claims its own body
  slot. `OPTIONAL_BODY_FIELDS = ['origin','family']` (was `['source',
  'origin','family']`). Frees up budget; in practice both Origin and
  Family fit now even with Lineage on.
- **Bottom two body lines shrink.** New layout knob `lineFSSmall: 28`
  (vs `lineFS: 34`). Body-slot index 2 and 3 use the smaller font and a
  slightly tighter inter-line step (`lineGap * 0.82`). Visual effect:
  a fade-down toward the footer with breathing room above the date line.
- **Form rename.** Checkbox label changed from "Origin (Known Progeny)"
  → **"Known Progeny"**. On the label, the line still prefixes the value
  with `Origin:` because that reads correctly there.

**Dead-code cleanup.** Removed the residual `ingestOriginDate` references
in `saveFormState`, `restoreFormState`, and `resetForm` — the underlying
input was removed in the previous pass and these were no-ops.

---

## 2026-05-17 — Label slot model, QR reserve, opt-in notes, footer rework

**Goal.** Stop adding ad-hoc toggles. Define a fixed label-line budget,
map opt-in fields to slots, gray out toggles when the budget is full, and
reserve permanent space for a future QR code.

**Files.** `quicklabel.html`.

**Slot budget.**
- `LABEL_BODY_BUDGET = 4` — four body lines below the lot ID, above the
  footer. Lot ID is never compromised.
- Order of claim:
  1. **Lineage notation** if `lineage` toggle is on.
  2. **Destination** (always — from media-type select).
  3. **Source**, **Origin**, **Family** in that priority order, only when
     their toggle is on.
- `applySlotBudget()` walks `OPTIONAL_BODY_FIELDS` and disables any
  unchecked S/O/F toggle that would exceed the remaining budget. Disabled
  checkboxes get a `title` tooltip: "No room on the label — turn off
  another field to enable this." Runs on every toggle change and on form
  restore.

**Removed.** The `originDate` opt-in. Origin Date is captured in the
record metadata via the (no-longer-exposed) `#ingest-origin-date` field
but never appears on the label. The toggle, its UI, and the related code
paths are gone; `gatherIngestRecord` uses an optional-chained read so the
missing input doesn't break the save.

**Notes became opt-in.** `#ingest-label-notes` is now wrapped in a
`notes` toggle (mirroring iNat, Source, etc.). Default unchecked; the
brief label note only appears when explicitly enabled. Max length tightened
to 40 chars (was 60) since notes share the footer row.

**Footer rework.** Three columns: `left` (date), `center`, `right`.
- Date Ingested → `footer.left`.
- iNat # (when iNat toggle on) → `footer.center` if notes are also on,
  otherwise `footer.right` (replaces notes position).
- Notes → `footer.right`.
- This satisfies the rule: iNat goes where notes go; when notes are
  present, iNat moves to center and balances.

**QR reserve.** A `qrSize: 100` (≈ 6.3 mm) × `qrSize` region pinned to
the top-right of the body area, `qrGap: 14` below the rule. Currently
rendered as a faint dashed box labeled "QR" in the preview;
`@media print { .lbl-qr-reserve { display: none !important; } }` hides it
on the printed label. **Body lines whose y-band overlaps the QR clamp
their right edge** to `qrX - 12` so text never crosses into the held space.

**Render path.** The SVG template now has two paths:
- `d.bodySlots` array present (set by `buildIngestLabelData`) → slot path.
  Each slot becomes one `<text>` line via `renderBodySlot(slot, L, y,
  maxW, monoFam)`. Kinds: `notation`, `destination`, `source`, `origin`,
  `family` (latter three get small `Src:` / `Orig:` / `Fam:` prefixes).
- Legacy (`buildLabelData` for non-ingest workflows) → original code path
  preserved verbatim. Grain Spawn, LC, Agar Plate rendering is unchanged.

**Slash-combined source / origin** is gone. Each field gets its own
labeled body line when toggled. The combined-with-slash fallback was
removed entirely.

---

## 2026-05-17 — Origin card: opt-in toggles per field + lineage shows all

**Files.** `quicklabel.html`.

**Goal.** Each line in the Ingest → Origin card is an opt-in field. Default
state shows checkboxes only; ticking one reveals its input(s). This lets
the user keep the panel minimal and avoid accidentally printing values
they don't want on a label.

**Per-section toggles added.**
- **Source** — `ingest-source-enabled` / `ingest-source-fields` →
  `#ingest-vendor` input.
- **Origin (Known Progeny)** — `ingest-origin-enabled` / `ingest-origin-fields`
  → `#ingest-originator` input.
- **Origin Date** — `ingest-origin-date-enabled` / `ingest-origin-date-fields`
  → `#ingest-origin-date` input.
- **Family or Association** — `ingest-family-enabled` / `ingest-family-fields`
  → `#ingest-family` input.
- **Lineage info** — unchanged shape, but now reveals all four lineage
  inputs (Filial / Clone / Iso / Transfer) regardless of media type
  (previously Clone/Iso/Transfer were gated by `COMPLEX_INGEST_TYPES`).
- **iNaturalist observation** — pre-existing toggle, kept as-is.

Labels stripped of em-dash hint text per the user's request. "Source",
"Origin (Known Progeny)", "Origin Date", "Family or Association" are the
literal labels; hints removed.

**Generic toggle plumbing.**
- `INGEST_SECTIONS = ['lineage','source','origin','originDate','family']`.
- `ingestSectionIds(name)` maps camelCase → kebab-case slug.
- `isIngestSectionOn(name)` reads the checkbox.
- `onIngestSectionToggle(name)` is the single onchange handler used by
  every checkbox; it shows/hides the wrap, calls `saveFormState()`, calls
  `updatePreview()`.

**Label-data plumbing.**
- `buildIngestLabelData()` reads `vendor` / `originator` only when the
  matching toggle is on. The destination still always renders.
- `buildIngestNotation()` returns empty when the lineage toggle is off;
  when on, the four lineage fields all contribute (no media-type gating).
- `gatherIngestRecord()` continues to save whatever the user typed so
  data survives a toggle off→on cycle.

**Loading an existing record.** `loadGeneticIntoIngest()` populates the
fields and **auto-checks** the toggle for any section that has a non-empty
value in the saved record. The new `setIngestField(slug, value, section)`
helper handles input + toggle pairing.

**Date update fix.** `#ingest-date` and `#ingest-origin-date` now have
`onchange="updatePreview()" oninput="updatePreview()"` so clearing the
date in the form refreshes the label preview immediately. Combined with
the earlier `|| todayISO()` removal in `buildIngestLabelData()` /
`gatherIngestRecord()`, an empty date now stays empty everywhere — form,
preview, save, and printed label.

**Form state persistence.** The five toggles are persisted to
`ingestToggles` in the form snapshot and restored on reload.

**Known limitation flagged.** When iNat fields are populated, the label
has no space to render them. Capture happens but the label template does
not surface iNat data. Resolution deferred — needs a label-layout
decision.

---

## 2026-05-17 — Ingest label tweaks, field renames, opt-in lineage

**Files.** `quicklabel.html`.

**Bug fix — blank date no longer falls back to today.**
`buildIngestLabelData()` and `gatherIngestRecord()` were defaulting an
empty `ingest-date` to `todayISO()`, so clearing the date in the form
still printed today's date on the label and saved it to the record.
Both call sites now pass through whatever the user typed (empty stays
empty).

**Field renames in the Ingest → Origin card.**
- "From (vendor / sender)" → **Source — vendor / sender**
- "Originator — if different" → **Origin — can be known progeny**
- Underlying field IDs (`ingest-vendor`, `ingest-originator`) and the
  data layer keys (`ingestData.vendor`, `ingestData.originator`)
  unchanged. Labels only. Import header map already accepts both
  "Origin"→`originator` and "Vendor/Source"→`vendor`.

**Form reorder.** In the Ingest → Origin card, the Filial/Clone/Iso/
Transfer row now sits **above** the "Received as" select — mirroring the
label's vertical order where the notation line appears above the
destination line.

**Opt-in lineage block.** The Filial row is wrapped in a new
`#ingest-lineage-fields` container, gated by a checkbox
`#ingest-lineage-enabled` ("Lineage info"). Pattern mirrors the existing
iNaturalist toggle. Behavior:
- Default unchecked. The row is hidden and `buildIngestNotation()`
  returns an empty string, so no notation line renders on the label.
- When checked, the row shows with the existing F0/clone/iso/transfer
  controls. Complex-type sub-fields (clone, iso, transfer) still toggle
  based on `onIngestMediaTypeChange()`.
- Toggle state is persisted in the form snapshot as
  `ingestLineageEnabled` and restored on reload.

---

## 2026-05-17 — Ingest panel becomes view / edit / save / print

**Goal.** Make the Ingest workflow the single surface for managing genetics
records, not just creating new ones. The user is about to re-print labels
for a few dozen existing genetics and wants to load → tweak → save → print
without bouncing through the Edit modal.

**Files.** `quicklabel.html`.

**Lab Code field.**
- Now has the same `list="code-dl"` autocomplete as the standard workflow's
  `gen-code`.
- `oninput`/`onchange` → `onIngestCodeChange()` — if the typed value
  matches an existing record (`db.genetics.get(code)`), every field in the
  ingest form is populated: cat, genus, species, cultivar, media type,
  vendor, originator, origin date, family, iNat block, ext notes, ingest
  date. Uses `setSelectValueLoose` so non-seeded genus/species still load.
- A yellow "editing &lt;code&gt;" tag appears next to the Identity card
  header when an existing record is loaded; clears when the code field is
  emptied or doesn't match.

**Buttons.** "Save & Print" was decoupled into two:
- **Save** — runs `saveIngest()` → creates or updates the record by code,
  then shows an inline "Saved SLxxx at 12:34:56" toast for 2.5 s. No print.
- **Save & Print** — calls `saveIngestRecord()` first, then the existing
  print run. Save is always idempotent: existing records update in place
  (matched by `code`); new codes create.

**Helpers extracted.** `gatherIngestRecord()` reads the form into a clean
record (no side effects). `saveIngestRecord({silent})` persists it
(create-or-update) and re-syncs `cfg.codes` afterward via
`syncCfgCodesFromGenetics()`. `printIngestLabel()` is now a thin wrapper:
save → render → `window.print()`.

**Import button moved into the Ingest panel.** Top-right of the Identity
card, alongside the new "editing X" tag. The Settings → Genetics Library →
Import button stays in place for now (no reason to strand it).

**View All row click routes by active workflow.** `loadGeneticIntoForm()`
now branches: if `currentWorkflowId === 'ingest'`, it writes to
`#ingest-code` and triggers `onIngestCodeChange()` (full field
population); otherwise writes to `#gen-code` and triggers `onCodeChange()`
(just the genetic identity, no ingest metadata) as before.

---

## 2026-05-17 — CSV / paste import for genetics

**Goal.** Bulk-load the user's existing genetics from their Excel sheet
without retyping each row. Avoid the "47 rows lost" black box by surfacing
a row-level dry-run before commit.

**Files.** `quicklabel.html`.

**Input modes.**
- **Paste from spreadsheet** (default tab) — textarea, auto-detects
  tab-separated (Excel default) or comma-separated. No file dialog needed.
- **Upload CSV** — `<input type=file accept=".csv">` with native FileReader.

**Parser.** Minimal RFC-4180-ish CSV/TSV parser inline (handles quoted
fields, escaped quotes, commas/tabs inside quotes, `\r\n`/`\n`). No
external library; XLSX deliberately not supported — Save As CSV in Excel.

**Column mapping (`IMPORT_HEADER_MAP`).** Case-insensitive,
whitespace-tolerant, supports common synonyms:

| Spreadsheet header        | Field             |
|---------------------------|-------------------|
| Genus                     | `genus`           |
| Species                   | `species` (lc)    |
| Avail / Available / Media | `ingestData.mediaType` (uc) |
| Classification / Category | `cat` (normalized) |
| Origin / Originator       | `ingestData.originator` |
| Catalog ID / Code         | `code` (uc)       |
| VENDOR / Vendor / Source  | `ingestData.vendor` |
| Culture / Cultivar        | `cultivar`        |
| Family / association      | `ingestData.family` |
| Notes                     | `ingestData.extNotes` |
| Ingest Date / Date        | `ingestData.ingestDate` |

Unmapped headers are shown in the preview struck-through so the user can
see what's being ignored.

**Category normalization.** `Active`/`Actives`/`Psilocybin`/`Psilocybe`
→ `actives`. `Gourmet`/`Functional`/`Medicinal` → `gourmet`. Anything else
falls back to `actives` (user can edit).

**Per-row actions.**
- **NEW** (green) — code does not exist in `db.genetics`. Created.
- **UPDATE** (yellow) — code exists. Merged: imported fields overwrite
  matching existing fields, blank-in-import fields preserve existing
  values, existing `inat` block preserved untouched.
- **SKIP** (gray) — row is effectively empty (no code, cultivar, or genus).

**Commit flow.** User reviews the preview table → clicks "Import N records"
→ records flow through `db.genetics.create` / `db.genetics.update` →
`syncCfgCodesFromGenetics()` rebuilds `cfg.codes` so the form datalist
and Settings count reflect reality.

**Open issue.** The user's legacy data has no dates. `ingestData.ingestDate`
is left blank for imported rows; fill in manually via the edit modal. From
the next ingest onward, dates flow naturally.

---

## 2026-05-17 — Work log started

This file (`WORK_LOG.md`) was created so the eventual commit message —
and any hand-off to emergent — can pull from a structured record instead
of reverse-engineering the diff.

---

## 2026-05-17 — Per-user login & data namespacing

**Goal.** Stop hardcoding "the library" into the app. Give each user of the
HTML file their own isolated localStorage namespace so handing the file to
someone else gives them a fresh start without exposing the previous user's
data. No password — name-only identity, single-user lab tool, closed env.

**Files.** `db.js`, `quicklabel.html`.

**Storage model.**
- New key `ql_active_user` stores the current user's name.
- All data keys are now namespaced: `ql_u:<user>:cfg`, `ql_u:<user>:lots`,
  `ql_u:<user>:form`, `ql_u:<user>:genetics`, `ql_u:<user>:lot_records`,
  `ql_u:<user>:lineage`.
- The legacy unnamespaced keys (`ql_cfg`, `ql_lots`, `ql_form`,
  `ql_genetics`, `ql_lot_records`, `ql_lineage`) are still recognized but
  only as a one-way import source. They are imported into the first user's
  namespace on initial login and then left in place as a backup. Call
  `db.session.purgeLegacy()` from the console to wipe them.

**API additions (`db.session`).**
- `db.session.login(name)` — persists the active user, imports legacy keys
  into the user's namespace if the user has no namespaced data yet, then
  runs the genetics ⇄ cfg sync (see migration history below).
- `db.session.logout()` — clears `ql_active_user`. Data preserved.
- `db.session.currentUser()` / `db.session.isLoggedIn()`.
- `db.session.hasLegacyData()` / `db.session.purgeLegacy()`.

**UI.**
- Full-screen `#login-overlay` blocks the app until a name is entered. Enter
  key submits.
- New "Account" section at the top of Settings shows the active user with a
  Log out button.
- `boot()` replaces the old top-level `init()` call; if not logged in,
  shows the login screen and returns. Login triggers a full page reload so
  the new namespace loads cleanly.

**Internal restructure.** `KEYS` became a `Proxy` that reads
`ql_active_user` on each access; the genetics ⇄ cfg merge (previously run at
module load) now runs inside `db.session.login()` so it never touches legacy
keys against a logged-out state.

---

## 2026-05-17 — Edit / delete genetics + form robustness

**Goal.** Bring back inline editing of genetics records (which existed
before "ingest" became a workflow). Surface every field the ingest form
collects. Also fix the case where editing an unusual genus/species silently
fails in the form picker.

**Files.** `db.js`, `quicklabel.html`.

**Data layer additions.**
- Genetics records now carry a stable `_id` (`g_<base36-time>_<rand>`).
  Migration backfills `_id` on existing records.
- `db.genetics.update(id, patch)` now keys by `_id` (was: by `code`,
  which broke on legacy codeless records).
- `db.genetics.remove(id)` — hard delete by `_id`.
- `db.genetics.archive(id)` — soft-flag (uses `update` under the hood).

**Edit modal (`#gedit-overlay`).** All ingest-form fields: lab code,
category, genus, species, cultivar, media type, vendor, originator, origin
date, family, full iNat block (enabled, number, collector, date, location),
extended notes, ingest date. Save → `db.genetics.update` then
`syncCfgCodesFromGenetics()` rebuilds `cfg.codes` so the form datalist and
Settings count stay accurate. Delete is hard-delete with confirm.

**Genetics table row actions.** Each row in View All now has Edit and ✕
buttons. Row body click still loads the code into the form (only if a code
exists).

**Form picker robustness.** `setSelectValueLoose()` helper: when a saved
genus/species doesn't match an existing `<option>`, it injects a custom
option and sets the value. Fixes the case where editing a record to use a
non-seeded genus/species left the form fields blank.

**Open data issue.** Legacy cultivar entries from earlier app versions have
the full string `"Psilocybe cubensis"` in the genus field and an empty
species field. The migration deliberately does NOT auto-split these to
avoid surprise mutations. Fix manually via the edit modal.

---

## 2026-05-17 — Genetics Library View (View All)

**Goal.** Make the catalog visible. Until now you could add genetics via
the ingest workflow but had no way to see them in a list.

**Files.** `quicklabel.html`.

**UI.** Centered modal `#genetics-overlay` opened by a new **View All**
button in Settings → Genetics Library. Columns: Code · Cultivar ·
Genus/Species · Category · Vendor · Ingest Date · (actions). Search input
filters across code, cultivar, genus, species in real time. Footer shows
record count. Click a row body to load the code into the active form.

---

## 2026-05-17 — Bidirectional cfg.codes ⇄ ql_genetics sync

**Goal.** Heal the discrepancy between the legacy `cfg.codes` array and the
new `ql_genetics` store. Earlier one-shot migration only ran if
`ql_genetics` was empty, so any ingest done after a partial migration
locked the rest of the legacy entries out.

**Files.** `db.js`.

**Algorithm.** On every page load (and on every login), build a union of
both stores by a composite key (`code` when present, falls back to
`genus|species|cultivar`). Backfill `_id` on existing genetics rows.

**Why composite.** Legacy cultivar-only entries have empty `code`; keying
solely by `code` filtered them out of the migration.

---

## 2026-05-17 — Data layer (Path #1)

**Goal.** Centralize all `localStorage` access behind an async `db.*` API.
Set up the surface so a future swap to IndexedDB or a real backend is a
no-op for callers. Add net-new stores for genetics, printed lots, and
lineage edges (which previously only existed as a free-text string on the
printed label).

**Files.** `db.js` (new), `quicklabel.html`.

**Decision context.** The user reviewed an emergent prompt proposing a
FastAPI+MongoDB backend and rejected it as out-of-scope per PRD §13
(single-user, closed env, no hosted backend). Path #1 keeps everything
local; the API surface mirrors the emergent prompt's REST endpoints so the
swap-in path is clean if needed later.

**Surface (`window.db`).**
- `db.config.{get, set}` — wraps the cfg blob.
- `db.form.{save, restore}` — wraps the form-restoration snapshot.
- `db.genetics.{list, get, create, update, remove, archive}` — genetics
  catalog. `list({q})` supports search.
- `db.lots.{list, get, create, byPrefix, nextNumber}` — printed lots.
  Counters remain in their own key; exposed via private helpers
  `_loadCounters` / `_saveCounters` for the existing inline counter logic.
- `db.lineage.{addEdge, parentsOf, childrenOf, tree}` — directed edges
  `{parent, child, createdAt}`.

**Inline refactors in `quicklabel.html`.**
- `loadStorage()` → async, uses `db.config.get()` + `db.lots._loadCounters()`.
- `persistCfg()` → `db.config.set(cfg)`.
- `persistLots()` → `db.lots._saveCounters(lotCounters)`.
- `saveFormState()` → `db.form.save(snapshot)`.
- `restoreFormState()` → async, `db.form.restore()`.
- `init()` → `async`; awaits storage load and form restore.

**Print-handler captures.**
- `printIngestLabel()` → on first-time-ingest of a code, also calls
  `db.genetics.create(record)` (in addition to the existing `cfg.codes`
  push). Idempotent: returns `{ok:false, reason:'duplicate'}` if the code
  already exists.
- `printLabel()` → after the counter advance, saves one lot record per
  print run via `db.lots.create({...lotId, workflowId, geneticCode,
  cultivar, genus, species, cat, notation, destination, source, sub,
  notes, date, qty, status:'active'})`. If `source` is non-empty,
  `db.lineage.addEdge(source, lotId)`.

**Untouched, intentionally.** `backend/server.py` (FastAPI health stub on
:8001) and `frontend/server.js` (Node static server on :3000). These exist
only to satisfy the Emergent Kubernetes preview environment. They have
zero application logic and nothing in Path #1 should touch them.

---

## Reference — current localStorage shape

```
ql_active_user                            string, current user's name
ql_u:<user>:cfg                           settings blob (prefix, codes,
                                          grainTypes, ingestTypes,
                                          agarFormulas, transferRules,
                                          fieldVis, customTaxa, …)
ql_u:<user>:lots                          {[`${prefix}_${code}_${YYMMDD}`]: lastSeq}
ql_u:<user>:form                          {workflowId, cat, genus,
                                          species, cultivar, …}
ql_u:<user>:genetics                      [{_id, code, cat, genus,
                                          species, cultivar, ingestData,
                                          createdAt, updatedAt}, …]
ql_u:<user>:lot_records                   [{lotId, workflowId, geneticCode,
                                          cultivar, genus, species, cat,
                                          notation, destination, source,
                                          sub, notes, date, qty, status,
                                          createdAt}, …]
ql_u:<user>:lineage                       [{parent, child, createdAt}, …]
ql_cfg, ql_lots, ql_form, ql_genetics,    legacy (pre-login) keys — read-only
ql_lot_records, ql_lineage                backup, imported once on first
                                          login per user
```
