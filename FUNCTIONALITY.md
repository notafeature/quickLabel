# QuickLabel — Complete Functionality & Data Map

**As of:** 2026-07-01
**Source of truth:** `quicklabel.html` (~5,136 lines) + `db.js` (551 lines), read directly.
**Purpose:** authoritative, current-state map of everything the app does and how its
data is stored — written so this logic can be ported into another app without reading
the older/aspirational planning docs. Where a doc and this file disagree, **this file
wins** (it was reconciled against the code; the PRDs describe intent, some of it future).

> This is a factual map of the *shipping* code. Sections labeled "NOT BUILT" are genuinely
> absent. Two real **bugs** are documented in §16 — they are described, not fixed.

---

## 1. What it is

A single-file, browser-only **label maker for a mushroom-cultivation lab**. A user picks a
workflow (ingest genetics, agar plate, liquid culture, grain spawn, batch, harvest, retail,
swab, reprint), fills a form, and the app mints a human-readable **lot ID**, renders a live
**SVG** label sized to the chosen label stock, and prints it via the browser or exports a
300-DPI PNG. It also keeps a **genetics catalog**, **per-code sequence counters**, a
**printed-lot record store**, and a **parent→child lineage graph**, persisted to per-user
`localStorage` and mirrored to Supabase.

Domain: psilocybin ("actives") + gourmet/functional mushrooms. No cannabis anywhere.

---

## 2. File inventory

| File | Lines | What it is |
|---|---:|---|
| `quicklabel.html` | ~5,136 | **The whole app** — UI + label engine + all 9 workflows, one inline `<script>`, loads `db.js`. |
| `db.js` | 551 | Data layer: per-user `localStorage` + Supabase KV sync + Supabase Auth. |
| `batch-labels.html` | 411 | **Standalone** one-off batch/transfer label sheet. Copies the `grain-spawn-9x5` template verbatim (legacy flat render only). No `db.js`, no auth, no persistence. Fixed 7-row table. |
| `quicklabel-portable.html` | ~4,787 | **OLDER, reduced snapshot** with `db.js` inlined. Only 5 workflows (ingest, agar-plate, liquid-culture, grain-spawn, generate-batch); **lacks** harvest-lot, retail-units, swab-collection, reprint, and the Inventory view. Hosted on GitHub Pages. Lags the main app — do not treat as current. |
| `backend/server.py` | 7 | FastAPI **health-check stub** (`GET /api/health`). Stores nothing. |
| `frontend/server.js` | 24 | 24-line Node static server that serves `quicklabel.html`. |
| `.static/index.html` | — | **Dangling symlink** → `/app/quicklabel.html` (a leftover from the old container layout; the target doesn't exist at repo root). Not load-bearing for the port. |

Docs: `PRD.md`, `PRD-genetics-tracking.md`, `PRD-data-model.md` (design intent, some future);
`memory/PRD.md`, `HANDOFF.md`, `BACKLOG.md`, `CHANGELOG.md`, `WORK_LOG.md` (history/backlog);
`CLAUDE-CODE-DATABASE-PROMPT.md` (**superseded** — specs a MongoDB backend that was never built).

---

## 3. Stack

Vanilla **HTML + CSS + JavaScript**, single file, **no framework, no build step, no bundler**.
Zero npm dependencies for the app itself. Label rendering = hand-written **SVG strings** (no
PDF/barcode/QR/canvas/SVG library). Persistence = `localStorage` + **Supabase** (Postgres KV +
Auth) via raw `fetch`. The only `package.json` is `frontend/package.json` (the trivial static
server; no dependencies).

---

## 4. Workflows (9)

Registry: `WORKFLOWS` (`quicklabel.html:1823-1860`). Default workflow: `grain-spawn`.
The header has a real **workflow-selector dropdown** grouped Genetics / Production / Harvest /
Samples / Utilities. "Create Storage Media" is a disabled/"soon" menu item.

| id | Label | Lot prefix | Destination | mediaLabel | Build function |
|---|---|---|---|---|---|
| `ingest` | Ingest New Genetic | ingest media-type code (default **IG**) | (type label) | — | `buildIngestLabelData()` |
| `agar-plate` | Create Agar Plate | **AL** | Agar Plate | Media | `buildLabelData()` |
| `liquid-culture` | Create Liquid Culture | **LC** | Liquid Culture | Vessel | `buildLabelData()` |
| `grain-spawn` | Make Grain Spawn | **GL** | Grain Spawn | Media | `buildLabelData()` |
| `generate-batch` | Generate a Batch | **BL** | Batch | Substrate | `buildBatchLabelData()` |
| `harvest-lot` | Record Harvest Lot | **HL** | Harvest Lot | — | `buildHarvestLotLabelData()` |
| `retail-units` | Print Retail Units | **RU** | Retail | — | `buildRetailUnitLabelData()` |
| `swab-collection` | Swab Collection | **SW** | Swab | — | `buildSwabLabelData()` (+ `buildSwabBagLabelData()`) |
| `reprint` | Reprint from ID | — | — | — | `buildReprintLabelData(lot)` |

Fields set by each builder (the `d` object — see §6 for schema):

- **`buildLabelData(seqOverride)`** (`3929`) — agar/LC/grain. Returns flat fields
  `{cat, genus, species, cultivar, destination, date, source, sub, mediaLabel, notes, notation, lotId}`.
  `sub` = grain sub-code (optionally `CODE - desc`), agar formula (uppercased), or LC vessel.
- **`buildBatchLabelData(unitIndex, unitCount)`** (`4085`) — `destination` = unit marker
  (`"Bin 03/12"` from `batchUnitType()`); `sub` = substrate; `source` = first `batchSources`
  lotId + `" +N"`; `mediaLabel:'Substrate'`.
- **`buildHarvestLotLabelData(seq)`** (`4611`) — slot-based; slots: destination `"Flush N"` +
  `source:sourceLotId`; optional `"Wet: Ng"` (info); optional notes (origin). `footer.left = date`.
- **`buildRetailUnitLabelData(seq)`** (`4688`) — destination `"{gramWt}g"` or `"Retail"` + source;
  optional **potency** (origin, free text); optional notes (info).
- **`buildSwabLabelData(seq)`** (`4766`) — destination `"Swab"` + source; optional notes.
  **`buildSwabBagLabelData(firstSeq, qty)`** (`4787`) — destination `"Swab Bag ×N"`; ID range info.
- **`buildIngestLabelData()`** (`3533`) — see §9.
- **`buildReprintLabelData(lot)`** (`4915`) — rebuilds a label from a stored lot record: uses
  `lot.bodySlots` if present, else special-cases batch, else generic flat→slots.

---

## 5. Lot ID system

**Format:** `PREFIX-CODE-YYMMDD-NN` (2-digit zero-padded sequence). No-prefix fallback:
`CODE-YYMMDD-NN` (only when a workflow has no prefix).

- **Prefixes:** `AL` agar, `LC` liquid culture, `GL` grain, `BL` batch, `HL` harvest,
  `RU` retail, `SW` swab; ingest uses the selected media-type code (default `IG`).
  (Unbuilt/future: `ML` homogenized, `PL` product.)
- **Validator:** `extractCodeFromLotId` regex `^[A-Z]{1,5}-([A-Z]{1,6}\d+)-\d{6}-\d{2}$` (`2326`).
- **Counters:** dict `lotCounters`, key = `PREFIX_CODE_YYMMDD` (`lotKey` `2346`). `nextSeq` =
  stored+1 (`2351`). Persisted in the `counters` slot (storage key `ql_u:<user>:lots`).
  Resets per (prefix, code, day); up to 99/day. `resetLotCounter()` prompts to set next (1-99).
- **Prefix source:** `effectiveLotPrefix()` (`2336`) — workflow prefix, or ingest media-type code,
  fallback `IG`.
- Pre-prefix counters from an earlier version are orphaned (no migration; single-user tool).

---

## 6. Label data object (`d`) schema

The render functions consume one plain object `d`. Every field it may read:

| Field | Type | Renders as |
|---|---|---|
| `cat` | `'actives'\|'gourmet'` | colored **ACTIVE/GOURMET** chip (anything ≠ `actives` → gourmet) |
| `cultivar` | string | large headline (auto-shrink, no truncation) |
| `genus`, `species` | string | italic binomial subline |
| `lotId` | string | mono lot code line |
| `bodySlots` | `Array<{kind,text,source?}>` | body lines (slot path) |
| `footer` | `{left,center,right}` | date / center (e.g. `iNat 123`) / notes |
| `notation` | string | filial code (legacy flat path; also bottom-right in `renderSimple`) |
| `destination` | string | legacy flat path body line |
| `source` | string | inline `Src:` on the destination line |
| `sub` / `mediaLabel` | string | `Media:`/`Vessel:`/`Substrate:` line (legacy path) |
| `date` | string | footer-left (via `fmtDate`) |
| `notes` | string | footer-right |

**`bodySlots[].kind` values:** `notation`, `destination` (source piggybacks inline as `Src:`),
`origin` (`Origin:`), `family` (`Fam:`), `info`, default. Bottom two slots (index ≥ 2) render at
`lineFSSmall`. Slot budget `LABEL_BODY_BUDGET = 4`; optional fields `OPTIONAL_BODY_FIELDS =
['origin','family']`.

There are **two render paths**: the newer **slot-based** path (`bodySlots`, used by ingest/
harvest/retail/swab) and the **legacy flat-field** path (agar/LC/grain/batch, and
`batch-labels.html`).

---

## 7. Label engine

Hand-written SVG strings. `LABEL_TEMPLATES` (`1947`). Each template object has `render(d)`,
`renderSimple(d)`, and `fit(svgEl)`.

**Templates:**

- **`grain-spawn-9x5`** — viewBox 900×500. Full `layout` object: `padL/R 36, padTop 26,
  padBot 45, cultivarFS 100, cultivarKerning 1.75, speciesFS 38, lotFS 50, lineFS 34, dimFS 34,
  dateFS 30, notesFS 30, chip{H 42, padX 18, FS 30}, cultivarSpeciesGap 62, speciesRuleGap 20,
  ruleLotGap 50, lotNotationGap 44, notationSrcGap 44, lotSourceGap 52, lineGap 44, ruleStroke 2,
  ruleColor #d8d8d8, qrSize 150, qrGap 14, lineFSSmall 28`. Has the **QR reserve** box.
- **`d11-strip`** — viewBox 875×350 (35:14). Minimal `layout {padL 34, padR 34}`. **No QR reserve.**

`LAYOUT_DEFAULTS` is a deep clone of the grain-spawn layout (used by the Fiddle Reset).

**Printers:** `PRINTERS` (`1877`):
- `dymo-30334` — "DYMO LabelWriter — 30334", paper 2.25 × 1.25 in, template `grain-spawn-9x5`.
- `merryhome-d11` — "Merryhome / D11 — 14 × 35 mm", paper 35/25.4 × 14/25.4 in, template `d11-strip`.

`PREVIEW_SCALE = 2.4`. Default `currentPrinterId = 'dymo-30334'`.

**`renderLabel(host, d, opts)`** (`2180`): picks the current printer's template; scale = 1 when
`opts.physical === 'print'` else `PREVIEW_SCALE`; uses `renderSimple` when `labelMode === 'simple'`
and the template has it; sets svg width/height in inches; then `tpl.fit(svg)`.

**`fit()`** shrinks overflowing text via SVG `textLength`/`lengthAdjust` (`fitText`, `1902`). It
calls `getComputedTextLength()`/`getBBox()`, so **it requires the SVG to be in a live DOM** (browser
or a DOM shim). `render()` itself is pure string-building.

`CHIP_COLORS`: `actives {fill:#dcfce7, text:#14532d}`, `gourmet {fill:#cffafe, text:#164e63}`.

**QR reserve** (`2049`): a dashed placeholder box + "QR" text (grain-spawn only). **No encoder** —
placeholder space only. Hidden on print (`@media print { .lbl-qr-reserve { display:none } }`) and
stripped from PNG exports.

**Fiddle / Layout Lab** (`2211`): live layout-tuning panel over the active template's `layout`,
toggled with `⌘\`/`Ctrl\`, with Copy-JSON and Reset-to-`LAYOUT_DEFAULTS`. Dev tool; not in print.

`labelMode` global: `standard` (full) vs `simple` (cultivar + genus/species + date + filial code).

---

## 8. Output / print pipeline

Two exits, both browser-native:

1. **Browser print** — each `print*()` builds N `.label-host` divs into hidden `#print-area`,
   renders at physical scale, then `window.print()`. `@media print` (`664`) hides everything but
   `#print-area`; **`@page { size: 2.25in 1.25in; margin: 0 }`** with `page-break-after:always`.
   On mobile, `primaryPrint()` opens the preview sheet instead (Bluetooth makers can't use browser
   print).
2. **PNG export / share** — `svgToPng(svgEl, dpi=300)` (`4259`): sizes a canvas to the current
   printer's paper × dpi, clones the SVG, removes `.lbl-qr-reserve`, white bg, `toBlob('image/png')`.
   `saveCurrentLabel` downloads; `shareCurrentLabel` uses the **Web Share API**
   (`navigator.share({files})`) with download fallback.

**No PDF. No image format beyond PNG. No ZPL/EPL** or thermal command language — thermal printers
go through the OS print dialog.

---

## 9. Genetics & taxonomy

**Catalog CRUD:** `db.genetics` (§14). **Table UI** `renderGeneticsTable` (`2570`): columns
Code / Cultivar / Genus-Species / Category / Vendor / Ingest Date; row click loads the code into the
active workflow. **Edit modal** captures code, cat, genus, species, cultivar, and `ingestData`.

**Taxonomy** `TAXA` (`1761`):
- **actives** — Psilocybe: azurescens, caerulescens, cubensis, mexicana, ochraceocentrata,
  subaeruginosa, subtropicalis, tampanensis, zapotecorum · Panaeolus: cyanescens.
- **gourmet** — Pleurotus: ostreatus, eryngii, citrinopileatus, djamor, pulmonarius · Hericium:
  erinaceus, coralloides, abietis · Ganoderma: lucidum, tsugae, oregonense · Lentinula: edodes ·
  Cyclocybe: aegerita · Flammulina: velutipes.
- `allTaxa(category)` merges built-ins with `cfg.customTaxa`. Custom genera/species addable in-UI.

**Category** is `actives`/`gourmet`. `normalizeCategory(raw)` (`2955`): empty → `actives`;
starts-with `active`/`psilocybin`/`psilocybe` → `actives`; starts-with `gourmet`/`functional`/
`medicinal` → `gourmet`; else `actives`. `categoryForGenus(genus)` looks up `TAXA` then custom.

**Notation (filial code):** `buildNotation()` (`3747`) / `buildIngestNotation()` (`3460`) — Filial
`F<n>`, Clone `C<n>` (+`_<ISO>` if isolation set), Transfer `T<n>`, joined by `.` → e.g. `F1.C1_A.T3`.

**iNaturalist:** stored under `ingestData.inat {enabled, number, collector, date, location}`. On the
label, the footer shows `iNat <number>` when enabled; other iNat fields are stored only.

**Ingest workflow:** form reads code, category, genus, species, cultivar, opt-in sections
(lineage/source/origin/family/notes), media type ("Received as"), iNat, date, extended notes.
`buildIngestLabelData()` (`3533`) returns `{cat, genus, species, cultivar, bodySlots, footer, lotId,
date, notation, notes}` — `lotId` = uppercased ingest code; destination = ingest-type label.
`gatherIngestRecord()` (`3590`) → a genetics record with `ingestData`; `saveIngestRecord({silent})`
create-or-update by code (requires code + cultivar); `printIngestLabel` saves then prints (qty 1-20).

---

## 10. CSV / paste import

`IMPORT_HEADER_MAP` (`2727`) — recognized headers (case-insensitive, whitespace-collapsed) → field:

- genus → `genus`; species → `species`; avail/available → `mediaType`; classification/category →
  `cat`; origin/originator → `originator`; catalog id/catalog/code/lab code → `code`;
  vendor/source → `vendor`; culture/cultivar → `cultivar`; family/association → `family`;
  notes/note/ext notes → `extNotes`; media/media type → `mediaType`; ingest date/date →
  `ingestDate`; inat/inaturalist/inat id/inat number/inat # → `inat`.

Pipeline: `parseImport` → `parseDelimited` (tab if the first line has a tab, else comma) →
`parseCSV` (RFC-4180-ish). `buildImportPreview` shows the column mapping and per-row action
**new / update / skip** (update if code matches an existing record; skip if empty). `recordFromRow`
normalizes (code upper, species lower, `normalizeCategory`, packs `ingestData`). `commitImport`
creates new rows and **merges** `ingestData` on updates (skips empty values, preserves existing
`inat`). Paste tab + file-upload tab. **Export:** genetics only conceptually; no lot-history export.

---

## 11. Data model as actually stored

Not a relational schema — JSON blobs per slot. Shapes:

**Genetics record** (`db.genetics`): `{ _id, code, cat, genus, species, cultivar, ingestData{
mediaType, mediaLabel?, vendor, originator, originDate, family, inat{enabled, number, collector,
date, location}, extNotes, ingestDate }, archived?, createdAt, updatedAt }`. `_id` =
`g_<base36 time>_<random>`.

**Lot record** (`db.lots`, one row per print run) — union of all fields ever written:
`{ lotId, workflowId, geneticCode, cultivar, genus, species, cat, notation, destination, source,
sub, notes, date, qty, status:'active', createdAt }` plus workflow-specific:
`unitType`, `sourceLots[]` (batch); `flushNumber`, `wetWeight`, `state` (harvest);
`gramWeight`, `potencyRef` (retail); `bodySlots` (slot-based workflows).

**Lineage edge** (`db.lineage`): `{ parent, child, createdAt }`.

**`cfg`** (config): `{ prefix:'SL', codes:[], grainTypes, ingestTypes, agarFormulas, substrates:[],
customTaxa:{actives:{},gourmet:{}}, fieldVis:{source:true,filial:true,clone:true}, transferRules }`.

**Defaults (verbatim):**
- `DEFAULT_GRAIN_TYPES`: RYE, OATS, MILLET.
- `DEFAULT_INGEST_TYPES`: SP=Spore Print, SS=Spore Swab, LI=Liquid Culture, GT=Gill/Tissue,
  AP=Agar Plate/Wedge, SN=Slant, CT=Castellani Tube.
- `DEFAULT_AGAR_FORMULAS`: MEA, PDYA, MYPA, RBA, WBA.
- `DEFAULT_VESSEL_TYPES`: JAR (Bulk Jar), 10mL/20mL (syringes), BAG (Filter Patch Bag).
  **Vessel types are a code constant, not part of `cfg`** — not user-editable (unlike grain/ingest/agar).
- `DEFAULT_TRANSFER_RULES`: `allowOverride, agarToAgar, lcToLC, grainToGrain = true`;
  `agarToLC, agarToGrain, grainToBulk = false`. **Persisted + shown in Settings, but never read by any
  print or validation path — declarative only.**
- `cfg.codes` is a **derived cache** of the genetics catalog; `genetics` is authoritative
  (`loadStorage` rebuilds `cfg.codes` from genetics on every load, and `syncGeneticsAndCfg` keeps the
  two in a union on login).

---

## 12. Persistence & sync (`db.js`)

**Source of truth:** `localStorage`, per-user namespaced keys `ql_u:<user>:<slot>`. Active user in
`ql_active_user`. `KEYS` is a Proxy resolving to the active user (`60`).

**Slot → storage-key map:** `cfg → cfg`, `counters → lots`, `form → form`, `genetics → genetics`,
`lots → lot_records`, `lineage → lineage`. (Note the naming quirk: the **counters** slot is stored
under `…:lots`, while lot **records** are under `…:lot_records`.)

**Legacy keys** (`LEGACY_KEYS`): `ql_cfg, ql_lots, ql_form, ql_genetics, ql_lot_records, ql_lineage`
— imported once per user on first login (`importLegacyForUser`), then left as read-only backup;
`purgeLegacy()` clears them.

**Supabase KV:** table **`ql_store`** at `https://lunkqtvndjdntuaidhyv.supabase.co` (publishable key
hardcoded in `db.js`). Row = `{ user_id, slot, data (JSON), updated_at }`, keyed by auth uid,
`on_conflict=user_id,slot` merge-duplicates. Writes debounce 600 ms (`queuePush`); `pullRemote` on
login seeds the cloud with local-only slots first time.
**`SYNC_SLOTS` = cfg, counters, genetics, lots, lineage.** The **`form`** slot is device-local and
**never synced**.

`syncGeneticsAndCfg()` (`db.js:304`) runs every login — bidirectional union of `cfg.codes` ⇄
`genetics` by code (falls back to genus|species|cultivar), backfills `_id`. `loadStorage` rebuilds
`cfg.codes` from the user's genetics (authoritative).

---

## 13. Auth (`db.js`)

Supabase Auth via a **synthetic email** derived from the username: `emailFor(u)` → simple usernames
`<user>@quicklabel.app`, special-character usernames `u<fnv-hash>@quicklabel.app`; the real username
rides in `user_metadata`. Token stored in `ql_sb_token`.

Flow: `signUp` / `signIn` (grant_type=password), `refreshSession`, token stored with uid (from
`user.id` or the JWT `sub`) and `expires_at`. Admin can set a `force_pw` row → `mustChangePassword()`
→ `changePassword()` (min 6 chars, clears the flag). Self-serve reset `claimPassword()` calls RPC
**`claim_password`** (only works when an admin enabled it). App boot uses `AUTH_EPOCH =
'2026-06-06-pw2'` to force a one-time re-login per device when bumped.

RLS is keyed on `auth.uid`, so each request carries a verified JWT and per-user data is walled.

---

## 14. `db.js` API surface

- `db.session` — `login(name, pw, mode)`, `logout()`, `currentUser()`, `isLoggedIn()`,
  `hasLegacyData()`, `purgeLegacy()`, `refresh()`, `mustChangePassword()`, `changePassword(pw)`,
  `claimPassword(user, pw)`. All return Promises.
- `db.genetics` — `list({q})`, `get(code)`, `create(record)` (rejects duplicate code),
  `update(id, patch)` (by `_id`), `remove(id)`, `archive(id)`.
- `db.lots` — `list({code, prefix})`, `get(lotId)`, `byPrefix(prefix)`, `nextNumber({prefix,code,date})`,
  `create(record)`, `_loadCounters()`, `_saveCounters(c)`.
- `db.lineage` — `addEdge(parent, child)` (dedupes), `parentsOf(child)`, `childrenOf(parent)`,
  `tree(root, {direction:'up'|'down', maxDepth:16})` (cycle-guarded).
- `db.config` — `get()`, `set(cfg)`.
- `db.form` — `save(snapshot)`, `restore()`.
- `db.sync` — `pull()`, `push(slot, value)`.

Every method is async (Promise) over synchronous `localStorage`, with writes mirrored to Supabase.
The adapter is deliberately swappable (localStorage → IndexedDB → real backend) without changing
callers.

---

## 15. Inventory · reprint · lineage

- **Inventory view** (`4384`): `IV_TYPES` filter chips = **BL** Batch, **GS** Grain Spawn,
  **LC** Liquid Culture, **AP** Agar Plate, **HL** Harvest, **RU** Retail, **SW** Swab (unknown → IN).
  Filters lot records by prefix + text, newest-first. Row → `inventoryReprint` → reprint workflow.
- **Reprint** (`4867`): datalist of all lots; `onReprintIdChange` looks up `db.lots.get`, live-preview;
  `buildReprintLabelData` reconstructs the label from the stored record.
- **Lineage** (`db.lineage`): edges captured on **every** print (`addEdge(source, lotId)`); batch adds
  one edge per grain source and stores `sourceLots[]`. `tree()` API exists but **no lineage-tree UI is
  wired** — nothing surfaces it.
- Source auto-fill: `onSourceChange` extracts the genetic code from a source lot ID and fills the
  genetic fields.

---

## 16. Known bugs / footguns (documented, NOT fixed)

1. **Inventory prefix mismatch.** `IV_TYPES` uses badge codes **`GS`** (grain) and **`AP`** (agar),
   but those workflows mint **`GL-`** and **`AL-`** lot IDs. So grain-spawn and agar-plate lots **never
   match their own filter chips** in the Inventory view (`4386` vs the `GL`/`AL` prefixes in
   `WORKFLOWS`). Real bug.
2. **Print `@page` is hardcoded** to `2.25in 1.25in` (DYMO) regardless of the selected printer
   (`666`). Printing on the Merryhome/D11 uses the wrong page size through the browser dialog.
3. **Ingest `IG` fallback** — if the ingest media type is unset/unmatched, lot IDs use `IG-…`, which
   no `IV_TYPES` badge recognizes either (compounds bug #1).
4. **Transfer rules never enforced** — `cfg.transferRules` is fully wired into Settings + persisted,
   but no print/validation path reads it.
5. **`dryWeight`** is read by the inventory detail (`4481`) but **never written** by any print path —
   always blank (a future field).
6. `COMPLEX_INGEST_TYPES = {AP,LI,SN,CT,GT}` is declared (`1794`) but effectively unused (media type
   no longer gates lineage). Pre-prefix lot counters from an earlier version are orphaned (no migration).
7. **Counters vs records diverge** — counters (`…:lots`) and lot records (`…:lot_records`) are
   independent stores: resetting a counter doesn't touch records, and records can be created without
   advancing a counter (the per-swab loop does this).
8. **`AUTH_EPOCH = '2026-06-06-pw2'`** — bumping this constant force-logs-out every device once on next
   load.
9. `cfg.codes` ⇄ `genetics` bidirectional sync runs every login — a deliberate consistency shim, but
   two representations of one catalog to reconcile when porting (genetics is authoritative).

---

## 17. NOT built (genuinely absent)

Real QR/barcode encoding (reserve box only); lineage / progeny-tree UI; PDF export; direct-to-printer
(Dymo Connect REST was attempted and abandoned); Castellani/Slant "create storage media" workflows
(CT/SN exist only as ingest *types*); substrate-component registry + bulk recipe builder; lot lifecycle
status UI; consumption / `remaining` tracking; per-lot event log; lot-history import/export;
homogenized (`ML`) and product (`PL`) lot workflows; real-time validation; XLSX import (deliberate —
CSV/paste only).

---

## 18. Portability notes (for the port)

| Piece | Verdict |
|---|---|
| **Label engine** (`LABEL_TEMPLATES`, `renderLabel`, `renderBodySlot`, `svgEsc`, `fmtDate`) | **Portable as-is** — pure `d`→SVG string building. Caveat: `fit()`/`fitText` need a live DOM (`getComputedTextLength`/`getBBox`); server-render needs a DOM shim or precomputed text widths. |
| **Templates** | **Portable** (plain JS/data). Hardcoded to two mushroom label stocks; add sizes as needed. |
| **Barcode / QR** | **Build fresh** — only a reserved box exists; add an encoder into it. |
| **Print pipeline** | **UI-coupled — rebuild.** `window.print()` + `@media print`/`@page` + `navigator.share` + canvas rasterization are browser-only. Server PDF or ZPL would be net-new. |
| **Persistence / auth** | **Discard** — localStorage + Supabase-KV + synthetic-email auth is orthogonal to a Prisma/Postgres platform. Reuse only the field shapes (§11). |

**Domain fit:** QuickLabel's model *is* a mushroom grower model — genetics (genus/species/cultivar),
lot codes, lineage edges, sequence counters, free-text potency all map straight onto a cultivation
platform. The port is: keep the SVG render/template/fit layer, swap the data source to your entities,
add QR encoding into the reserved box, and replace the print/export layer. The `cat` field is an
`actives | gourmet` binary driving the chip — keep, rename, or map to your taxonomy.

---

_Generated 2026-07-01 from a direct read of `quicklabel.html` + `db.js`. If you change the code, update
this file — it is the port's source of truth._
