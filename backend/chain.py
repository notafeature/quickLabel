"""Chain-of-custody helpers: backward (lineage) and forward (progeny) walks."""
from __future__ import annotations

from typing import Any

CREATE_EVENT_TYPES = {
    "ingest": ["IngestEvent"],
    "agar":   ["PlateAgar", "DrawAgar"],
    "lc":     ["PlateLC", "DrawLC"],
    "grain":  ["InoculateGrain", "SterilizeGrain"],  # InoculateGrain preferred
    "batch":  ["SpawnToBulk"],
    "harvest": ["Harvest"],
}

LOT_TABLE = {
    "ingest":  "ingest_records",
    "agar":    "agar_plates",
    "lc":      "liquid_cultures",
    "grain":   "grain_lots",
    "batch":   "batches",
    "harvest": "harvest_lots",
}


def fetch_lot(conn, lot_kind: str, lot_uuid: str) -> dict | None:
    table = LOT_TABLE.get(lot_kind)
    if not table:
        return None
    row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (lot_uuid,)).fetchone()
    return dict(row) if row else None


def find_create_event(conn, lot_kind: str, lot_uuid: str) -> dict | None:
    """Return the most-relevant create-event for this lot.

    For grain: prefer InoculateGrain (has in-system source) over SterilizeGrain
    (which only has raw-grain as source, terminal). For others: first match.
    """
    types = CREATE_EVENT_TYPES.get(lot_kind, [])
    if not types:
        return None
    for t in types:
        row = conn.execute(
            "SELECT * FROM events WHERE subject_lot_kind = ? AND subject_lot_id = ? AND event_type = ? "
            "ORDER BY event_date DESC LIMIT 1",
            (lot_kind, lot_uuid, t),
        ).fetchone()
        if row:
            return dict(row)
    return None


def backward_walk(conn, lot_kind: str, lot_uuid: str, visited: set | None = None) -> dict | None:
    """Recursive provenance trace. Terminates at IngestRecord or SterilizeGrain."""
    if visited is None:
        visited = set()
    key = (lot_kind, lot_uuid)
    if key in visited:
        return {"lot_kind": lot_kind, "lot_id": lot_uuid, "cycle": True}
    visited.add(key)

    lot = fetch_lot(conn, lot_kind, lot_uuid)
    if not lot:
        return None

    create_event = find_create_event(conn, lot_kind, lot_uuid)

    sources: list[dict] = []
    if create_event:
        src_rows = conn.execute(
            "SELECT * FROM event_sources WHERE event_id = ?", (create_event["id"],)
        ).fetchall()
        for src in src_rows:
            walked = backward_walk(conn, src["source_lot_kind"], src["source_lot_id"], visited)
            if walked is not None:
                walked["consumed"] = {
                    "amount": src["amount_consumed"],
                    "unit": src["amount_unit"],
                }
                sources.append(walked)

    # Pull the GeneticCode pointer for convenience
    gc_id = lot.get("genetic_code_id")
    genetic = None
    if gc_id:
        gc_row = conn.execute("SELECT * FROM genetic_codes WHERE id = ?", (gc_id,)).fetchone()
        genetic = dict(gc_row) if gc_row else None

    return {
        "lot_kind": lot_kind,
        "lot": lot,
        "genetic": genetic,
        "create_event": create_event,
        "sources": sources,
    }


def forward_walk(conn, lot_kind: str, lot_uuid: str, visited: set | None = None) -> dict:
    """Find every downstream lot derived from this one."""
    if visited is None:
        visited = set()
    key = (lot_kind, lot_uuid)
    if key in visited:
        return {"lot_kind": lot_kind, "lot_id": lot_uuid, "cycle": True}
    visited.add(key)

    lot = fetch_lot(conn, lot_kind, lot_uuid)
    children: list[dict] = []

    rows = conn.execute(
        "SELECT e.* FROM events e JOIN event_sources es ON es.event_id = e.id "
        "WHERE es.source_lot_kind = ? AND es.source_lot_id = ? "
        "ORDER BY e.event_date ASC",
        (lot_kind, lot_uuid),
    ).fetchall()
    for ev in rows:
        if not ev["subject_lot_id"]:
            continue
        child = forward_walk(conn, ev["subject_lot_kind"], ev["subject_lot_id"], visited)
        if child is not None:
            child["via_event"] = dict(ev)
            children.append(child)

    return {
        "lot_kind": lot_kind,
        "lot": lot,
        "children": children,
    }
