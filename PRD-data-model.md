# QuickLabel — Conceptual Data Model & Event Catalog (Layer 1)

**Version:** 0.1 (draft)
**Last updated:** 2026-05-18
**Status:** Design only. No schema, no code, no UI. Canonical spec for downstream layers.
**Parent docs:** `/app/PRD.md`, `/app/PRD-genetics-tracking.md`

---

## 1. Purpose and Scope

This document defines the conceptual data model behind QuickLabel's
expansion from "label printer" to "cultivation tracker." It names the
entities the system reasons about, the events that move them through
state, and the questions the system must answer. It stops where physical
material stops moving in v1: at the dried harvest lot.

Layer 2 (schema, persistence) and Layer 3 (UI, API) are downstream of
this file and may not contradict it without revising it.

### 1.1 In scope

Tracking one or more genetic lines from registry entry through to dried
harvest lot, including all upstream pre-grain media (ingest, agar, LC),
the regulated inoculation boundary (spawn-to-bulk → batch), per-flush
harvests, and drying.

### 1.2 Out of scope (v1)

Homogenization. Product lots. Retail SKUs. Costs. Operator
authentication / RBAC. Cloud sync. Space-designer UI. Printer harness
beyond what `quicklabel.html` already does. KPI dashboards. Sublot
trees for grain lots (deferred per PRD §15). The model must *support*
these later; we just don't build them yet.

### 1.3 Reading order

Read `/app/PRD.md` §2 (conceptual model), §6 (lot identity), §17
(workflow architecture) and `/app/PRD-genetics-tracking.md` for the
upstream chain. This file does not redefine concepts those documents
already cover — lot ID format, lineage notation, workflow definitions
are referenced, not duplicated.

---

## 2. State Chain (a DAG, not a pipeline)

```
GeneticCode (registry)
   ↓
IngestRecord (print / swab / LC / agar / tissue / germination / etc.)
   ↓
AgarPlate ◄─────┐  agar ← agar (transfer)
   ↓            │  agar ← LC (reisolation)
   ↓            │  agar ← grain (rescue)
   ↓            │  agar ← harvest (fruit-body clone)
   ↓            │
LiquidCulture ◄─┤  LC ← agar
   ↓            │  LC ← LC (passage)
   ↓            │
GrainLot ◄──────┘  grain ← LC | agar | grain (g2g)
   ↓               (each grain lot consumes one GrainExpendableUnit)
   ↓
Batch (spawn-to-bulk; fan-in of N GrainLots + one BulkSubstrateRecipe)
   ↓
HarvestLot (per flush; one Batch produces many)
   ↓
HarvestLot[state=dried] (terminal state for v1)
```

Forward, lateral, and back-going edges are all valid. The model never
gates "forward only." `IngestRecord` is the one exception: it has no
in-system predecessor — its source is external (vendor, trade, wild
collection) and is captured as descriptive text on the record itself.

---

## 3. Entity Catalog

Every entity below is a tracked lot. Every tracked lot has:

- A **lot ID** (format defined by the workflow that creates it; see
  PRD.md §6 and §17, PRD-genetics-tracking §5).
- A **genetic code** pointer (every lot in v1 carries exactly one).
- A **lifecycle status** (see §3.12).
- A **remaining-material** descriptor where applicable (see §4).
- An **event history** — the sequence of events that reference it as
  subject, source, or product.

Identity is the lot ID. Two physical objects with the same lot ID are
the same lot. A lot exists from the moment its create-event is recorded
until it is archived or destroyed; remaining material may go to zero
before that.

### 3.1 GeneticCode

The lab-scoped pointer to a genetic line. Defined in PRD.md §4; this
section names the fields the data model needs.

- `code` — e.g. `SL192`. The identity.
- `genus` — taxonomic genus, e.g. `Psilocybe`.
- `species` — taxonomic species, e.g. `cubensis`.
- `cultivar` — e.g. `Enigma`. May be blank for unnamed isolates.
- `notes` — free text, optional.

**Relationships:** Every IngestRecord references exactly one
GeneticCode. Every downstream lot inherits the GeneticCode of its
predecessor via its create-event. Two distinct codes for the "same"
cultivar (two separate prints of Golden Teacher) are intentionally
independent lines.

### 3.2 IngestRecord

The entry point of a genetic into the lab. Defined in
PRD-genetics-tracking §4.1.

- `lot_id` — e.g. `SP-SL192-260201-01`. Prefix is the ingest type code.
- `genetic_code` — pointer to GeneticCode.
- `ingest_type` — one of the codes from PRD-genetics-tracking §3.1
  (SP / SS / LI / GT / AP / SN / CT, or user-defined).
- `external_source` — free-text provenance ("Vendor: FungusHead",
  "Trade: John D.", "Wild: Mt Hood 2025-09"). Not a lot pointer; the
  predecessor is outside the system by definition.
- `lineage` — F, optional C, T per PRD §5 and PRD-genetics-tracking §2.
- `received_date` — when the physical material arrived.
- `notes`.

**Relationships:** Root of every provenance chain. No in-system source.

### 3.3 AgarPlate

A single agar plate (or wedge, for received plates) carrying one
genetic. Defined in PRD-genetics-tracking §4.2.

- `lot_id` — `AL-…` per PRD-genetics-tracking §4.2.
- `genetic_code`.
- `lineage` — F, optional C/isolation, T.
- `agar_formula` — code from the agar-formula registry (MEA, PDYA, …).
- `plate_size` — e.g. `100mm`, `60mm`. Used to make quadrant
  consumption math meaningful.
- `remaining` — see §4.2.
- `notes`.

**Relationships:** Created by a PlateAgar event that references exactly
one source — another AgarPlate, a LiquidCulture, a GrainLot, or a
HarvestLot (tissue clone) — or an IngestRecord. Can be the source of
future PlateAgar, PlateLC, and InoculateGrain events.

### 3.4 LiquidCulture

A liquid culture vessel (jar / vial / syringe / bag). Defined in
PRD-genetics-tracking §4.3.

- `lot_id` — `LC-…`.
- `genetic_code`.
- `lineage`.
- `vessel_type` — `JAR`, `10mL`, `20mL`, etc.
- `initial_volume_ml` — capacity at creation.
- `remaining` — see §4.2.
- `notes`.

**Relationships:** Created by a PlateLC event from one source
(AgarPlate or LiquidCulture). Source of future PlateAgar, PlateLC, or
InoculateGrain events.

> Sub-lot splitting (bulk jar → multiple syringes as derived lots) is
> noted in PRD-genetics-tracking §4.3 as deferred. The model below
> assumes a bulk jar and any syringes drawn from it share one lot ID
> and decrement one `remaining` value. Splitting becomes an open
> question (§9).

### 3.5 GrainExpendableUnit and GrainLot — one entity, two phases

A sterile grain bag (e.g. 1.2 lb rye) and the inoculated grain lot it
becomes are **the same physical object at two lifecycle phases**, and
the data model treats them as **one entity** with a phase field.

**Decision:** Single entity, called `GrainLot`, with a `phase` field
that takes values `sterile` (pre-inoculation, inventory state) or
`inoculated` (post-inoculation, colonization onward).

**Justification:**

- The physical bag is one continuous object. Inoculation does not
  create a new container; it changes the contents.
- Provenance trace works cleanly: an inoculated GrainLot's history
  trivially includes its own sterilization, because they are events on
  the same entity. No identity hop.
- Inventory questions ("how many sterile bags do I have?") become a
  filter on `phase=sterile` rather than a separate table.
- The cost of unifying is one nullable foreign key (the source lot is
  null while sterile, set when InoculateGrain fires) and a small set of
  events that only fire in one phase. Both are cheap.
- The cost of *splitting* would be a fragile identity transfer on
  inoculation, doubling the back-trace path through grain.

**Fields:**

- `lot_id` — `GL-…` per PRD §6 once inoculated. Sterile-phase bags
  receive a lot ID at sterilization-event time (see §6.1 open
  questions: prefix for sterile bags is undecided).
- `phase` — `sterile` | `inoculated`.
- `genetic_code` — null while `sterile`; set on inoculation.
- `lineage` — null while `sterile`; set on inoculation.
- `grain_type` — code from the grain-type registry (RYE, OAT, etc.).
- `prep_size` — nominal weight or volume of the bag (e.g. `1.2 lb`).
- `sterilized_at` — when the bag became sterile-ready. Set by the
  sterilization event.
- `inoculated_at` — when InoculateGrain fired. Null while sterile.
- `remaining` — see §4.2. For grain, this is whole-or-not.
- `notes`.

**Relationships:** While sterile, has no source lot — it was created
from raw grain (outside the model) and a sterilization event. Once
inoculated, has exactly one source (LiquidCulture, AgarPlate, or
another GrainLot for g2g). May be consumed in part by a SpawnToBulk
event into a Batch.

### 3.6 BulkSubstrateRecipe

A reusable composition definition for a batch's bulk substrate. Recipes
are templates; a specific batch references a recipe and may override
proportions or substitute components in the SpawnToBulk event itself.

**Fields (proposed minimum):**

- `recipe_id` — short user-defined code, e.g. `CVG-STD`, `MASTERS-MIX`.
- `name` — display name.
- `components` — ordered list of `{component_code, proportion, unit}`
  entries. `component_code` references a substrate-component registry
  (HPOO = horticultural perlite, COIR, VERM = vermiculite, GYPSUM,
  BRAN, etc.). Proportion is dry weight or volume per the unit.
- `hydration_target` — field-capacity / pasteurization moisture target.
  Free string for v1 ("field capacity", "65% by weight").
- `prep_method` — pasteurized / sterilized / cold-fermented / etc.
- `notes`.

**Relationships:** Referenced by SpawnToBulk events. A recipe is not a
lot — it carries no lineage and never appears in a back-trace as a
contributor of genetic material. But it appears in the back-trace as a
**substrate contributor**: "this batch's bulk medium was recipe X."

### 3.7 Batch

The spawn-to-bulk result. The regulated boundary per PRD §17.

- `lot_id` — `BL-…`.
- `genetic_code` — inherited from grain inputs (all inputs must agree;
  see §9).
- `lineage` — inherited (see §9 on multi-source lineage).
- `bulk_substrate_recipe` — pointer to BulkSubstrateRecipe.
- `bulk_mass` — final mass / volume of bulk medium used.
- `container_count` — number of fruiting containers (bins, monotubs,
  bags) the batch is split across.
- `location` — physical zone (room / shelf), free string in v1.
- `inoculated_at` — when SpawnToBulk fired.
- `notes`.

**Relationships:** Created by a SpawnToBulk event that consumes N
GrainLots (each partially or whole) and references one
BulkSubstrateRecipe. Source of one or more HarvestLot records, one
per flush.

### 3.8 HarvestLot

A single flush from a single batch. **Drying is a state on HarvestLot,
not a separate entity** — see §3.9.

- `lot_id` — `HL-…`.
- `batch` — pointer to the source Batch.
- `genetic_code` — inherited from Batch.
- `flush_number` — `1`, `2`, `3`, …, scoped to its Batch.
- `wet_weight` — recorded at Harvest event.
- `dry_weight` — null until the Dry event fires; set then.
- `state` — `wet` | `dried`. Transitions wet→dried via the Dry event.
- `harvested_at` — when Harvest event fired.
- `dried_at` — null until Dry event fires.
- `notes`.

**Relationships:** Each HarvestLot points to exactly one Batch.
A HarvestLot in `dried` state remains the same entity it was when
`wet`. May be source of a PlateAgar event (fruit-body tissue clone).

### 3.9 DriedHarvestLot — modeled as a state, not an entity

**Decision:** No separate entity. `HarvestLot.state ∈ {wet, dried}`.
The Dry event transitions the state and records dry weight.

**Justification:**

- A dried harvest is the same physical material as the wet harvest,
  minus water. No new container, no new genetic provenance edge.
- Wet→dry yield ratio is a single-row query (`dry_weight / wet_weight`
  on one HarvestLot) rather than a join across two entities.
- Any downstream use (tissue clone via PlateAgar from a fruit body)
  doesn't care whether the source flush has been dried yet; it
  references the HarvestLot regardless of state.
- The cost is one extra field and one extra state. The cost of two
  entities would be every harvest query joining or unioning across
  them.

The phrase "DriedHarvestLot" remains useful in conversation; in the
model it means `HarvestLot where state = dried`.

### 3.10 Cross-cutting entities

These are not lots, but the event model relies on them.

- **GrainTypeRegistry** — codes for grain preparations (RYE, OAT, …).
  Already exists per PRD §10.
- **AgarFormulaRegistry** — codes for agar media (MEA, PDYA, MYPA, …).
  Already exists per PRD-genetics-tracking §4.2.
- **SubstrateComponentRegistry** — codes for individual bulk-substrate
  components (COIR, VERM, HPOO, GYPSUM, BRAN, etc.). New in v1.
- **IngestTypeRegistry** — already defined in PRD-genetics-tracking
  §3.1, including user-defined types.
- **LocationRegistry** — deferred. Locations are free strings in v1.

### 3.11 No first-class Operator entity (v1)

Operator tracking is toggleable per §8. Events may carry an
`operator_id` string. No Operator entity exists in v1; the field is
opaque text.

### 3.12 Lifecycle status (every lot)

Independent of entity-specific phase fields, every lot carries one of:

- `active` — present in the lab; remaining material may or may not be
  zero (an active lot with zero remaining is "fully consumed but not
  yet archived").
- `consumed` — explicitly marked spent. Optional shortcut for "active
  with zero remaining and no further use planned."
- `gifted` — given away.
- `contaminated` — confirmed contamination. See ContaminationFlag.
- `archived` — stale or no longer tracked, retained for history.
- `destroyed` — physically discarded.

Status is set by lifecycle events (see §5.4). Transitions are not
gated; the user is trusted to set status truthfully.

---

## 4. Dual Identity — Tracked Lot AND Expendable Material

Agar plates, LC vessels, and (post-inoculation) grain lots are
**simultaneously** tracked entities (lot ID, lineage, event history)
**and** expendable material that downstream events consume in part. A
10 mL LC vial inoculating five grain bags at 0.5 mL each remains the
same lot afterward — with ~7.5 mL left.

### 4.1 Where consumption applies

- **AgarPlate** — quadrants / fractions / wedges.
- **LiquidCulture** — milliliters.
- **GrainLot (inoculated)** — fractions of bag mass when splitting
  spawn across multiple batches.
- **GrainLot (sterile)** — **whole-only.** A sterile grain bag is
  either inoculated whole or not at all. No partial consumption. This
  is a physical constraint of sterile-bag handling and the model
  enforces it by event semantics (see §5.1: InoculateGrain consumes
  the whole sterile unit).
- **HarvestLot** — partial consumption only when a fruit body is taken
  for a tissue clone (PlateAgar from harvest). Most of the harvest
  ends up dried; the clone event subtracts a small amount that does
  not need to be precisely tracked in v1.
- **Batch** — bulk substrate is not "consumed" in chunks the way
  agar/LC are; a Batch produces HarvestLots until exhausted. No
  remaining-material accounting in v1.
- **IngestRecord** — handled like its substrate (a received agar
  plate's remaining acts like AgarPlate's; a received LC's like
  LiquidCulture's). See §9 open question.

### 4.2 The `remaining` descriptor

Each consumable lot carries a `remaining` descriptor. The shape varies:

- **AgarPlate.remaining** — a fraction in `[0, 1]` representing
  remaining usable plate area. Quadrant-based UIs (fourths) and
  freeform fractional entries both reduce to a number. Initial value
  on creation: `1.0`.
- **LiquidCulture.remaining** — a volume in mL. Initial value:
  `initial_volume_ml`. Decremented by each PlateAgar / PlateLC /
  InoculateGrain event sourced from this LC.
- **GrainLot.remaining** — for sterile phase, a boolean (`intact` |
  `consumed`). For inoculated phase, a fraction in `[0, 1]` of the
  inoculated mass, decremented by SpawnToBulk events that take part of
  the lot.

Consumption events (any state-change event that names this lot as a
source, plus the explicit ConsumePartial event) decrement `remaining`
by the amount declared on the event. A lot whose `remaining` reaches
zero is **exhausted** but remains addressable (history, back-trace).
A lot can also be **wasted** — ConsumePartial with `reason=waste`
zeroes the remaining and records why.

The model does not enforce that recorded consumption sums to the
initial amount; physical reality includes loss to evaporation,
condensation, spillage. Discrepancy is a notes-level concern, not a
validation concern.

### 4.3 What "remaining" is *not*

It is not an inventory count of derivative things. The five grain bags
inoculated from a 10 mL LC are their own lots; the LC's remaining
field shrinks from 10 to 7.5, full stop. The five GrainLots are
discoverable via "events where source = this LC."

---

## 5. Event Catalog

Events are the unit of history. Every state change, every annotation,
every measurement, every consumption is an event. Events are
**append-only**; corrections are themselves events (a note attached
to the prior event), not edits to the original.

### 5.0 Universal event fields

Every event, regardless of type, carries:

- `event_id` — unique within the system.
- `event_type` — one of the types defined in this section.
- `event_date` — when the physical action happened. Used for every
  report and every age/threshold calculation.
- `recorded_at` — when the event was entered in the system.
  Defaults to `now()`. Differs from `event_date` only when backdating.
- `operator_id` — optional, nullable. See §8.
- `subject_lot` — the lot this event is "about." For create-events,
  this is the lot being created. For lifecycle events, the lot whose
  state changes. May be null for events that act on the registry or
  on a recipe.
- `notes` — free text.
- `photo_refs` — list of attached photo references. (Storage of the
  photos themselves is a Layer 2 concern.)

Default behavior: `event_date = recorded_at = now()`. The user may
override `event_date` for backdated entries. Reports use `event_date`.
Both values are retained.

### 5.1 State-change (create) events

These events produce new lots. Each names exactly one product and
zero or more sources.

#### IngestEvent
- **Produces:** IngestRecord.
- **Consumes:** nothing in-system. References external provenance via
  the IngestRecord's `external_source`.
- **Records:** ingest type, genetic code (existing or new), lineage,
  received date.

#### PlateAgar
- **Produces:** AgarPlate.
- **Consumes:** exactly one source, partial: AgarPlate | LiquidCulture
  | GrainLot (rescue) | HarvestLot (tissue clone) | IngestRecord.
- **Records:** source lot ID, amount consumed (fraction for agar,
  mL for LC, fraction for grain, free for harvest tissue), agar
  formula, plate size, lineage carry (T-rules per
  PRD-genetics-tracking §4.2).

#### PlateLC
- **Produces:** LiquidCulture.
- **Consumes:** exactly one source, partial: AgarPlate (typical) or
  LiquidCulture (passage).
- **Records:** source lot ID, amount consumed, vessel type,
  initial volume.

#### InoculateGrain
- **Produces:** GrainLot transitions from `phase=sterile` to
  `phase=inoculated`. **Does not create a new lot** — the sterile bag
  is the same entity. Genetic code, lineage, source link, and
  `inoculated_at` are populated on the existing record.
- **Consumes:** the whole sterile GrainLot (whole-only constraint
  per §4.1) **and** partial of one source: LiquidCulture | AgarPlate
  | GrainLot (g2g).
- **Records:** source lot ID and amount, target GrainLot ID.

> **Sterile bag creation** — a separate event (working name:
> `SterilizeGrain`) creates a GrainLot in `phase=sterile`. Inputs are
> raw grain (outside the model) and a grain-type code. See §9: the
> lot-ID prefix for sterile-phase bags is undecided.

#### SpawnToBulk
- **Produces:** Batch.
- **Consumes:** **N inoculated GrainLots** (fan-in, partial or whole
  on each) plus references **one BulkSubstrateRecipe** instance.
- **Records:** per-grain-lot consumption amounts, recipe pointer,
  any recipe overrides for this batch, bulk mass, container count,
  location, genetic-code resolution (see §9).

#### Harvest
- **Produces:** HarvestLot in `state=wet`.
- **Consumes:** nothing — a flush is *yielded by* the Batch, not
  subtracted from it. The Batch remains active until the operator
  decides it's spent (Archive event).
- **Records:** batch pointer, flush number, wet weight, harvest date.

#### Dry
- **Produces:** nothing new. Transitions an existing HarvestLot's
  `state` from `wet` to `dried`.
- **Consumes:** nothing.
- **Records:** dry weight, dried date. Subject lot is the HarvestLot.

### 5.2 In-state events

These do not transition lifecycle phase and produce no new lots, but
they belong in the event history.

#### BreakAndShake
- **Subject:** GrainLot (inoculated).
- **Records:** date (event_date), notes (e.g. mycelium coverage
  estimate), photo refs.

#### ContaminationFlag
- **Subject:** any lot.
- **Records:** suspected contaminant (free text), severity
  (`suspect` | `confirmed`), quarantine flag.
- **Side effect on the back-trace:** when `quarantine=true`, the
  graph walker (see §6) tags every downstream lot reachable from
  this lot as quarantined-by-derivation. The event itself does not
  *change* downstream lots' status — it lets the system mark them.
  Lifting a flag is itself an event (see §5.4).

#### WeightMeasurement
- **Subject:** any lot for which weight is meaningful.
- **Records:** measured weight, unit, context (free text). Used for
  bag-mass tracking, mid-cycle weight checks, anything ad hoc.
  Distinct from the wet/dry weights captured on Harvest and Dry,
  which are first-class fields.

#### MoveLocation
- **Subject:** any lot.
- **Records:** previous location (string, optional), new location.
  Locations are free strings in v1.

#### ConsumePartial
- **Subject:** any consumable lot.
- **Records:** amount consumed, reason (`waste` | `gift` | `test` |
  `discard` | free text). Decrements `remaining` without producing
  any tracked successor. Covers giving an agar quarter to a friend,
  letting half a syringe rot, sacrificing a plate for a stain.
- **No product lot.** That's the whole point.

#### PhotoAttach
- **Subject:** any lot. May attach to a prior event via reference.
- **Records:** photo refs.

#### NoteAttach
- **Subject:** any lot. May attach to a prior event via reference.
- **Records:** note text. Distinct from the `notes` field on the
  thing being annotated because a note may need its own timestamp,
  operator, photos.

### 5.3 Reciprocal / passive events

Two events that fire indirectly:

#### Consumption (implicit)
Every state-change event that names a source lot implicitly fires a
consumption against that source. Not a distinct event type; recorded
as part of the create event. ConsumePartial exists for the case where
there's no create event.

#### Yield (implicit)
A Batch's relationship to its HarvestLots is one-to-many, but there's
no "yield" event — Harvest itself names the Batch.

### 5.4 Lifecycle events

These set `lifecycle_status` (§3.12):

- **Archive** — subject is any lot. Reason recorded.
- **Destroy** — subject is any lot. Reason recorded.
- **MarkGifted** — subject is any lot. Recipient recorded (free text).
- **MarkConsumed** — subject is any lot. Optional; equivalent to
  Archive for fully-consumed lots.
- **ContaminationLift** — subject is a lot previously flagged. Records
  reason for clearing. Status moves out of `contaminated`.

---

## 6. Chain of Custody — Lineage Walk

Given any lot, walking the event graph backward must reach:

- The originating **GeneticCode** (always exactly one in v1).
- The originating **IngestRecord** (always exactly one).
- Every **GrainExpendableUnit** (i.e. GrainLot in sterile phase prior
  to its own inoculation) that contributed to any GrainLot that fed
  any Batch on the path.
- Every **BulkSubstrateRecipe** referenced by any Batch on the path.

### 6.1 Walk algorithm (conceptual)

Starting from a lot:

1. List all create-events whose **product** is this lot. There is
   exactly one for non-grain lots; for grain it's the InoculateGrain
   event (the SterilizeGrain event is the same entity's prior
   create-event).
2. For each named source on that event, recurse into the source lot.
3. For SpawnToBulk specifically, recurse into **every** named
   GrainLot input *and* record the BulkSubstrateRecipe.
4. The recursion terminates at IngestRecord (no in-system source) or
   at a sterile GrainLot (whose source is "raw grain," outside the
   model).
5. The GeneticCode pointer is carried on every lot; collecting
   distinct codes along the walk yields the genetic provenance set.

For v1 every chain resolves to a single GeneticCode; if multiple grain
inputs to a Batch disagree, that's flagged as a data error at
SpawnToBulk time (see §9).

### 6.2 Forward walk

Equally important: given a lot, find every downstream lot. Used by
ContaminationFlag's quarantine mechanic, by the Genetics Tracker UI's
progeny tree (PRD-genetics-tracking §7.2), and by the query "every
event that has ever touched genetic SL192."

The forward walk is just the backward walk's dual: list events whose
**source** is this lot, recurse into the products.

### 6.3 Where the model would break

If the back-trace from a HarvestLot can't reach a GeneticCode, the
event model is wrong. The required invariants:

- Every create-event names its source(s).
- Every lot has a `genetic_code` set by its create-event.
- IngestRecord is the only entity with no in-system source, and it
  always carries an explicit GeneticCode.

These invariants are the model's load-bearing constraints. Schema
(Layer 2) should enforce them.

---

## 7. Query Catalog

Plain English. These are the questions the model exists to answer.

### 7.1 Inventory

- "How many active lots do I have, by state and by genetic?"
  → Group lots by `phase` (or entity type) and `genetic_code`,
    filter `lifecycle_status=active`.
- "How many sterile grain bags do I have in inventory right now?"
  → GrainLot where `phase=sterile` and `lifecycle_status=active`.
- "How much of LC vial #X have I used; how much remains?"
  → `initial_volume_ml − remaining` (used), `remaining` (left).
- "Which agar plates are past 30 days?"
  → AgarPlate where `(now − create_event.event_date) > 30d` and
    `lifecycle_status=active`.

### 7.2 Readiness / planning

- "Which grain lots are ready for spawn-to-bulk?"
  → GrainLot where `phase=inoculated`, `lifecycle_status=active`,
    age ≥ threshold (user-defined), and (optionally) presence of a
    recent BreakAndShake event.
- "Which batches need to move from colonization to fruiting by date X?"
  → Batch where `inoculated_at + colonization_window` falls before X
    and no Harvest event yet exists. (Colonization_window is a
    user-defined per-genetic or per-recipe expectation; see §9.)
- "I have N bulk bins available — which grain lots should I use,
  oldest-colonized first?"
  → GrainLot where `phase=inoculated` and `lifecycle_status=active`,
    ordered by `inoculated_at` ascending, limit derived from N and
    per-bin grain requirement.

### 7.3 Provenance

- "What did this DriedHarvestLot come from?"
  → Backward walk per §6.1. Returns the GeneticCode, IngestRecord,
    contributing GrainLots, BulkSubstrateRecipe, and all intermediate
    AgarPlate / LiquidCulture lots.
- "Every event that has ever touched genetic SL192."
  → All events whose subject lot's `genetic_code = SL192`, ordered
    by `event_date`.
- "When did I last break-and-shake GL-SL192-260511-03?"
  → Latest BreakAndShake event with subject = this lot.

### 7.4 Quality / yield

- "Wet→dry yield ratio across the last N harvests of cultivar Y."
  → HarvestLots where `state=dried` and the cultivar resolves
    through Batch → genetic_code → cultivar, ordered by
    `harvested_at` desc, top N, compute `dry_weight / wet_weight`.
- "Which lots are currently flagged contaminated?"
  → Lots where `lifecycle_status=contaminated` (direct flag) plus,
    via forward walk from each, downstream lots tagged
    quarantined-by-derivation.

### 7.5 Questions that fall out automatically

- "What's the transfer history of SL192's clone C1_A?"
- "Which plates were used as sources for grain lots last week?"
- "Average remaining volume across active LC lots?"
- "Photos attached to anything from Batch BL-SL192-260301-01?"

### 7.6 Questions that surface gaps

If any of these resists a clean answer, the gap goes to §9:

- "Total ingredients per batch" — requires BulkSubstrateRecipe's
  components to be itemizable, plus the grain type from each input
  GrainLot. The model supports this; the registry (§3.10) is the
  load-bearing piece.
- "How much LC did I waste this month?" — sum of ConsumePartial
  amounts with `reason=waste` on LiquidCulture subjects.

---

## 8. Toggleable Operator Tracking

Every event carries a nullable `operator_id` string. When operator
tracking is off (the default for v1's single-user posture), the field
is left null and hidden in any UI. When on, the field is populated
from whatever identity surface the app exposes — for v1, a free-text
operator name set in user profile.

No Operator entity. No auth. No RBAC. Just: events may know who did
them, retroactively meaningful when a real identity layer arrives.

---

## 9. Open Questions

Resolve before Layer 2 begins.

1. **Sterile GrainLot lot-ID prefix.** Inoculated grain is `GL-…`.
   Sterile grain (phase=sterile) has no defined prefix yet.
2. **LC sub-lot splitting.** Bulk jar → N syringes: one lot with mL
   remaining, or N sub-lots?
3. **BulkSubstrateRecipe minimal fields.** §3.6 proposes a set;
   needs human confirmation.
4. **Multi-source lineage on Batch.** SpawnToBulk fans in N GrainLots
   that may differ in lineage. What's the Batch's lineage?
5. **Disagreement on genetic code at SpawnToBulk.** Hard error, soft
   warn, or just allow?
6. **Colonization-window expectations.** Per-genetic? Per-recipe?
   Global default?
7. **Flush numbering across multi-batch harvest days.** Confirm
   per-batch scoping.
8. **IngestRecord remaining material.** Polymorphic field on
   IngestRecord, or auto-create derivative AgarPlate / LC?
9. **Quarantine semantics.** Mutate downstream `lifecycle_status` or
   only expose via walk?
10. **Recipe versioning.** Snapshot at SpawnToBulk or live reference?
11. **Event immutability granularity.** Notes editable, fields not?
12. **Photo storage.** Layer 2 concern but worth flagging.
13. **GrainExpendableUnit and GrainLot unified.** Confirm §3.5 call.

---

## 10. Glossary

- **Lot** — any tracked physical object with a lot ID.
- **Phase** — for GrainLot, the `sterile` vs `inoculated` distinction.
- **State** — for HarvestLot, the `wet` vs `dried` distinction.
- **Lifecycle status** — universal `active / consumed / gifted /
  contaminated / archived / destroyed`.
- **Source** — the predecessor lot on a create-event.
- **Remaining** — the consumable material left on a lot.
- **Walk** — graph traversal across the event history (backward for
  provenance, forward for progeny / quarantine).
- **Subject lot** — the lot a non-create event is "about."
