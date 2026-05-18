"""Batches: SpawnToBulk event. Enforces single-genetic constraint per design call #5."""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException

from db import db, new_id, now_iso, row_to_dict, rows_to_list
from events_util import attach_photos, decrement_source, write_event
from lots import allocate_lot_id
from models import SpawnToBulkIn

router = APIRouter(prefix="/api/batches", tags=["batches"])


@router.get("")
def list_batches() -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM batches WHERE deleted_at IS NULL ORDER BY inoculated_at DESC"
        ).fetchall()
    return rows_to_list(rows)


@router.get("/{lot_uuid}")
def get_batch(lot_uuid: str) -> dict:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM batches WHERE id = ? AND deleted_at IS NULL", (lot_uuid,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "batch not found")
    return row_to_dict(row)


@router.post("/spawn-to-bulk")
def spawn_to_bulk(payload: SpawnToBulkIn) -> dict:
    """Fan-in N grain lots + one recipe → one Batch.

    Hard error if grain inputs disagree on genetic_code (design call #5).
    """
    if not payload.grain_inputs:
        raise HTTPException(400, "at least one grain input required")

    now = now_iso()
    with db() as conn:
        # Validate recipe + snapshot it
        recipe = conn.execute(
            "SELECT * FROM bulk_substrate_recipes WHERE id = ? AND deleted_at IS NULL",
            (payload.recipe_id,),
        ).fetchone()
        if not recipe:
            raise HTTPException(404, "recipe not found")

        # Validate every grain lot exists, is inoculated, and shares one genetic
        grain_rows = []
        genetic_id = None
        max_t = None
        for inp in payload.grain_inputs:
            row = conn.execute(
                "SELECT * FROM grain_lots WHERE id = ? AND deleted_at IS NULL",
                (inp.grain_lot_id,),
            ).fetchone()
            if not row:
                raise HTTPException(404, f"grain lot {inp.grain_lot_id} not found")
            if row["phase"] != "inoculated":
                raise HTTPException(409, f"grain lot {row['inoculated_lot_id'] or row['sterile_lot_id']} "
                                         f"is not inoculated")
            if genetic_id is None:
                genetic_id = row["genetic_code_id"]
            elif row["genetic_code_id"] != genetic_id:
                raise HTTPException(409,
                    "genetic code disagreement at SpawnToBulk: cannot mix genetic batches "
                    "(per design call #5)")
            grain_rows.append(row)
            # collect highest T value across inputs for batch lineage
            t_val = row["lineage_t"]
            if t_val is not None:
                max_t = t_val if max_t is None else max(max_t, t_val)

        gc = conn.execute("SELECT code FROM genetic_codes WHERE id = ?", (genetic_id,)).fetchone()
        lot_id = allocate_lot_id(conn, "BL", gc["code"], payload.event_date or now)
        bid = new_id()

        # Compose lineage on the Batch — use highest T across inputs (design call #4)
        base = grain_rows[0]
        recipe_snapshot = {
            "id": recipe["id"], "code": recipe["code"], "name": recipe["name"],
            "components": json.loads(recipe["components_json"]),
            "hydration_target": recipe["hydration_target"], "prep_method": recipe["prep_method"],
            "extra": json.loads(recipe["extra_json"]) if recipe["extra_json"] else None,
            "overrides": payload.recipe_overrides,
        }
        conn.execute(
            "INSERT INTO batches(id, lot_id, genetic_code_id, lineage_f, lineage_c, lineage_iso, "
            "lineage_t, recipe_snapshot_json, bulk_mass, bulk_mass_unit, container_count, location, "
            "inoculated_at, notes, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (bid, lot_id, genetic_id, base["lineage_f"], base["lineage_c"], base["lineage_iso"],
             max_t, json.dumps(recipe_snapshot),
             payload.bulk_mass, payload.bulk_mass_unit, payload.container_count, payload.location,
             payload.event_date or now, payload.notes, now, now),
        )

        sources = []
        for inp in payload.grain_inputs:
            sources.append({"lot_kind": "grain", "lot_id": inp.grain_lot_id,
                            "amount": inp.fraction, "unit": "fraction"})
            decrement_source(conn, "grain", inp.grain_lot_id, inp.fraction)

        eid = write_event(
            conn, event_type="SpawnToBulk",
            event_date=payload.event_date, operator_id=payload.operator_id,
            client_id=payload.client_id,
            subject_lot_kind="batch", subject_lot_id=bid,
            payload={"lot_id": lot_id, "recipe_id": payload.recipe_id,
                     "recipe_overrides": payload.recipe_overrides,
                     "bulk_mass": payload.bulk_mass, "container_count": payload.container_count,
                     "location": payload.location},
            notes=payload.notes, sources=sources,
        )
        attach_photos(conn, eid, "batch", bid, payload.photo_refs)
        row = conn.execute("SELECT * FROM batches WHERE id = ?", (bid,)).fetchone()
    return {"batch": row_to_dict(row), "event_id": eid}
