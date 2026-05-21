# QuickLabel — Handoff

This document is the cold-start brief for the next person (or agent) to
touch this codebase. Read this first, then `WORK_LOG.md` for the detailed
trail, then `PRD.md` / `PRD-genetics-tracking.md` for product intent.

---

## What this is

QuickLabel is a single-page, browser-only lab tool for printing genetics
labels for mushroom cultivation. It's intentionally local — no backend,
no auth provider, no hosted dependencies. State lives in the browser's
`localStorage`. The PRD calls it: *"single user, personal tool, closed
environment."*

The repository ships with two infrastructure stubs (`backend/server.py`,
`frontend/server.js`) that exist **only** so the Emergent Kubernetes
preview environment doesn't 502. They have **zero application logic**.
Path-1 (the architecture chosen this session) keeps everything in
`quicklabel.html` + `db.js`. Don't touch the stubs.

---

## Files that matter

| Path | What it is |
|---|---|
| `quicklabel.html` | The entire UI + business logic. ~3200 lines. One inline `<script>`. |
| `db.js` | The async data layer over `localStorage`. All persistence flows through here. |
| `PRD.md` | Original PRD — workflow model, taxonomy, lot ID format, layout intent. |
| `PRD-genetics-tracking.md` | Detailed genetics-catalog spec. |
| `WORK_LOG.md` | Dated narrative of every change made in this session. **Read top-down for context.** |
| `CHANGELOG.md` | High-level user-facing changelog (pre-existing). |
| `PRD-cultivation-api.md` | **Archived** API design reference. The "Resolved open questions" table answers 13 things `PRD-data-model.md` left open; reuse those resolutions in the client-side model. |
| `backend/`, `frontend/` | **Do not modify.** Preview-environment plumbing only. A FastAPI/SQLite implementation was explored on `Emerget-code-changes` and rejected — see PRD-cultivation-api.md status note. |

---

## Architecture, at a glance

### Data layer (`db.js`)

Async API exposed on `window.db`:

```
db.session.{login, logout, currentUser, isLoggedIn, hasLegacyData, purgeLegacy}
db.genetics.{list, get, create, update, remove, archive}
db.lots.{list, get, create, byPrefix, nextNumber, _loadCounters, _saveCounters}
db.lineage.{addEdge, parentsOf, childrenOf, tree}
db.config.{get, set}
db.form.{save, restore}
```

Every method returns a `Promise`. Internally everything is synchronous
`localStorage` access; the async surface is deliberate so the adapter can
be swapped for IndexedDB or a real backend without touching call sites.

### Per-user namespacing

`ql_active_user` holds the logged-in name. All data keys are namespaced
`ql_u:<user>:<slot>`. The login modal blocks the app until a name is
entered. Logging in for the first time imports any pre-existing
unnamespaced keys (`ql_cfg`, `ql_lots`, etc.) into the new user's
namespace one time. The legacy keys are left in place as a read-only
backup; `db.session.purgeLegacy()` clears them.

Hand the HTML to someone else → they get an empty localStorage on their
machine → login screen → fresh namespace. No data leaks.

### Genetics ⇄ cfg sync

Historical reasons: the legacy app stored genetics in `cfg.codes`
inside the settings blob; the new app stores them as their own collection
`db.genetics`. On every load, `syncGeneticsAndCfg()` (in `db.js`) unions
the two lists by composite key (`code` if present, else
`genus|species|cultivar`). This keeps the inline UI code that reads
`cfg.codes` (datalists, the Settings count) consistent with the data
layer. Records get a stable `_id` on first sight.

When eventually cutting `cfg.codes` out entirely, this sync is the seam:
delete it, point all `cfg.codes` readers at `db.genetics.list()`, gone.

### Label rendering

`quicklabel.html` defines a `LABEL_TEMPLATES['grain-spawn-9x5']` template
keyed on a Dymo 2.25 × 1.25 in / viewBox 900 × 500 layout. The render
function has two paths:

- **Slot path** (used by the Ingest workflow). The caller produces
  `d.bodySlots = [{kind, text, [source]}, …]` plus a structured
  `d.footer = {left, center, right}`. Body slots map 1:1 to lines below
  the lot ID; bottom two slots auto-shrink (`lineFSSmall`) and pack
  tighter. Body lines whose y-band overlaps the QR reserve clamp their
  right edge to leave it clear. Maximum **4 body slots**
  (`LABEL_BODY_BUDGET`). Lot ID is never compromised.
- **Legacy path** (used by Grain Spawn / LC / Agar Plate workflows). The
  original flat-fields rendering, preserved verbatim. New workflows
  should adopt the slot path.

A `qrSize × qrSize` (currently 150 viewBox units, ≈ 9.5 mm physical)
region is permanently reserved top-right of the body area for a future
QR code. Faint dashed `QR` marker visible in preview;
`@media print { .lbl-qr-reserve { display: none } }` hides it on the
printed label. No actual QR is rendered yet.

### Opt-in field model (Ingest workflow)

The Ingest → Origin card has five toggles: `lineage`, `source`, `origin`,
`family`, `notes`. Plus a sixth (`iNat`) on the iNaturalist section. Each
toggle has:
- A checkbox `#ingest-<slug>-enabled` driving an
  `onIngestSectionToggle(name)` handler.
- A wrap div `#ingest-<slug>-fields` shown/hidden by the toggle.
- Optional contribution to a body slot or the footer.

`applySlotBudget()` walks `OPTIONAL_BODY_FIELDS = ['origin','family']`
and disables any toggle that would exceed `LABEL_BODY_BUDGET` minus
reserved slots (lineage if on + destination always). Source no longer
claims its own slot — it merges onto the destination line as
`Liquid Culture | Src: TBG`.

Toggle states persist in `ingestToggles` of the form-state snapshot
(`db.form`) so reloads restore the user's panel exactly.

### Footer layout

Three columns: `left` (date ingested), `center`, `right` (notes / iNat).
Rule of thumb:
- Notes alone → right
- iNat alone → right
- Both → iNat center, notes right

Implemented in `buildIngestLabelData()` populating `d.footer`. The render
draws three `<text>` elements with text-anchor `start` / `middle` / `end`.

---

## How to set up locally

1. Clone, then open `quicklabel.html` directly in a browser. No build, no
   server. The `file://` origin is fine.
2. The login screen appears. Type any name. Existing legacy data is
   imported once into that user's namespace.

That's it. No npm install. The `backend/` and `frontend/` directories
spin up only in the Emergent preview to keep its router happy.

---

## What works today

- **Login / per-user namespace** with first-login legacy import.
- **Edit-genetics modal** with all ingest fields, hard delete.
- **View All genetics** modal with search, row-click loads code into the
  active workflow's primary code field.
- **CSV / paste import** with column-mapping preview, NEW / UPDATE /
  SKIP row coloring, merge-on-update.
- **Ingest workflow as edit-and-print**: typing an existing code
  populates every field; Save and Save & Print are decoupled; toggles
  auto-flip on for fields that have saved values.
- **Slot-based label rendering** with 4-line body budget, smaller bottom
  two lines, QR reserve.
- **Lot-record + lineage capture** on every print run via `db.lots.create`
  and `db.lineage.addEdge` (free-text edges until the source field is
  structured — see Open Issues).

---

## Known limitations

These are deliberate omissions, not bugs.

1. **Source field is still free-text.** When you type "Agar SL188.F1.T2"
   into Source, `db.lineage.addEdge` writes that string as the parent.
   It's not a foreign-key reference to a real lot ID. The PRD §16
   ("Source type tag") proposes a structured-pointer design; deferred
   until a second workflow ships.
2. **iNaturalist fields beyond the iNat # do not appear on the label.**
   The label template has no room. The full iNat block (number,
   collector, date, location) is captured to `db.genetics` for
   record-keeping. When the QR code is implemented, it can encode the
   iNat permalink for a full reveal.
3. **QR code itself is not rendered.** Space is reserved; no library is
   integrated. Payload schema is undecided — likely a short URL pointing
   at a hosted lookup, deferred until there's somewhere to host.
4. **No lineage view.** `db.lineage.{tree, parentsOf, childrenOf}` exist
   but no UI surfaces them. Two designs were sketched (ancestry-of-a-lot,
   descendants-of-a-genetic) — see WORK_LOG and the conversation
   transcript.
5. **Legacy cultivar entries** carry "Psilocybe cubensis" jammed into the
   genus field with empty species. The auto-migration deliberately does
   not split them to avoid surprise mutations. Fix per-record via the
   edit modal.
6. **Single label template** (`grain-spawn-9x5`). Larger / smaller labels
   are planned. The slot model is per-template; adding a new template
   inherits its own budget without changing logic.
7. **Origin Date** is part of the data model (`ingestData.originDate`)
   but no UI surfaces it currently. The toggle was removed because
   nothing useful was rendered on the label. Re-introduce when the QR
   payload or a "Provenance details" sub-view exists.
8. **No real-time validation.** Per PRD §13, all fields are optional and
   unvalidated. Empty values render nothing on the label.
9. **CSV import is paste/CSV only.** XLSX intentionally not supported —
   it would require a ~600 KB parser dependency. Excel → Save As → CSV
   takes 5 seconds.

---

## Things to decide

When picking this up, these are the open product/design questions worth
resolving before more code lands:

1. **Lineage view shape.** Read-only ancestors of a lot, descendants of a
   genetic, or interactive graph? See WORK_LOG and the chat history.
2. **QR payload.** Lot ID only? A signed lookup URL? Where does it
   resolve? This determines whether a hosted backend re-enters the picture.
3. **When to cut `cfg.codes` out.** The sync currently double-writes.
   Cutover requires updating every `cfg.codes` reader (datalists, the
   "Genetics count" indicator, the form's `findCode`) to read
   `db.genetics.list()` instead. A focused half-day's work; nothing's
   blocking it.
4. **Source field structure.** Free-text vs. type-tag (per PRD §16) vs.
   real foreign-key lookup. Becomes urgent the moment a second workflow
   (LC, Agar) starts producing real lot IDs the next ingest can reference.
5. **Multiple label templates.** A larger label size would expand the
   body budget and the QR-reserve options. Probably needs a printer-and-
   template selector UI even when there's just one combo.

---

## Conventions adopted this session

- **Per-user namespacing** is the law. New persistent state must go
  through `db.*`, never directly to `localStorage`.
- **Async by default** for all data-layer methods.
- **Opt-in toggle pattern** for new label fields: checkbox → wrap div →
  `onIngestSectionToggle(name)` → label slot or footer position. Always
  enforce the slot budget.
- **No backend, no auth, no hosted dependencies** unless and until the
  PRD's "blue sky" section §15 starts being implemented.
- **Lot ID is never compromised** — body lines below it can shrink or
  drop; the lot ID's font/position never moves.

---

## Where to start if you're emergent

1. Read `WORK_LOG.md` top-down (newest entries first).
2. Open `quicklabel.html` in your browser, log in as a test user, and
   walk through the Ingest workflow once. Watch the slot toggles and the
   preview update in real time.
3. Confirm the slot-budget behavior: turn on Lineage info + Source +
   Known Progeny + Family or Association and see one toggle gray out
   when there's no room.
4. Pick a "Things to decide" item and propose a design before coding.
5. When you make changes, append a dated entry to the top of
   `WORK_LOG.md` in the same shape as existing entries.

Anything unclear, the entire chat transcript that produced this state is
also useful context. Architecture decisions and rationale are usually
in the work log entry corresponding to that change, not in code comments.
