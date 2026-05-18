"""Harvests: Harvest (flush per batch) + Dry (transitions wet→dried)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from db import db, new_id, now_iso, row_to_dict, rows_to_list
from events_util import attach_photos, write_event
from lots import allocate_lot_id
from models import DryIn, HarvestIn

router = APIRouter(prefix="/api/harvests", tags=["harvests"])


@router.get("")
def list_harvests(state: str | None = None, batch_id: str | None = None) -> list[dict]:
    sql = "SELECT * FROM harvest_lots WHERE deleted_at IS NULL"
    params: list = []
    if state:
        sql += " AND state = ?"
        params.append(state)
    if batch_id:
        sql += " AND batch_id = ?"
        params.append(batch_id)
    sql += " ORDER BY harvested_at DESC"
    with db() as conn:
        rows = conn.execute(sql, params).fetchall()
    return rows_to_list(rows)


@router.get("/{lot_uuid}")
def get_harvest(lot_uuid: str) -> dict:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM harvest_lots WHERE id = ? AND deleted_at IS NULL", (lot_uuid,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "harvest lot not found")
    return row_to_dict(row)


@router.post("/harvest")
def create_harvest(payload: HarvestIn) -> dict:
    """Record a flush from a batch. Flush_number auto-increments per batch."""
    now = now_iso()
    with db() as conn:
        batch = conn.execute(
            "SELECT * FROM batches WHERE id = ? AND deleted_at IS NULL", (payload.batch_id,)
        ).fetchone()
        if not batch:
            raise HTTPException(404, "batch not found")

        # Next flush number for this batch
        max_flush = conn.execute(
            "SELECT COALESCE(MAX(flush_number), 0) AS m FROM harvest_lots WHERE batch_id = ?",
            (payload.batch_id,),
        ).fetchone()["m"]
        flush = max_flush + 1

        gc = conn.execute("SELECT code FROM genetic_codes WHERE id = ?",
                          (batch["genetic_code_id"],)).fetchone()
        lot_id = allocate_lot_id(conn, "HL", gc["code"], payload.event_date or now)
        hid = new_id()
        conn.execute(
            "INSERT INTO harvest_lots(id, lot_id, batch_id, genetic_code_id, flush_number, "
            "wet_weight, wet_weight_unit, state, harvested_at, notes, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'wet', ?, ?, ?, ?)",
            (hid, lot_id, payload.batch_id, batch["genetic_code_id"], flush,
             payload.wet_weight, payload.wet_weight_unit,
             payload.event_date or now, payload.notes, now, now),
        )
        eid = write_event(
            conn, event_type="Harvest",
            event_date=payload.event_date, operator_id=payload.operator_id,
            client_id=payload.client_id,
            subject_lot_kind="harvest", subject_lot_id=hid,
            payload={"lot_id": lot_id, "flush_number": flush, "wet_weight": payload.wet_weight,
                     "wet_weight_unit": payload.wet_weight_unit},
            notes=payload.notes,
            sources=[{"lot_kind": "batch", "lot_id": payload.batch_id}],
        )
        attach_photos(conn, eid, "harvest", hid, payload.photo_refs)
        row = conn.execute("SELECT * FROM harvest_lots WHERE id = ?", (hid,)).fetchone()
    return {"harvest": row_to_dict(row), "event_id": eid}


@router.post("/dry")
def dry_harvest(payload: DryIn) -> dict:
    """Transition a HarvestLot from wet to dried. Records dry weight."""
    now = now_iso()
    with db() as conn:
        h = conn.execute(
            "SELECT * FROM harvest_lots WHERE id = ? AND deleted_at IS NULL",
            (payload.harvest_lot_id,),
        ).fetchone()
        if not h:
            raise HTTPException(404, "harvest lot not found")
        if h["state"] != "wet":
            raise HTTPException(409, "harvest is not in wet state")
        conn.execute(
            "UPDATE harvest_lots SET state='dried', dry_weight=?, dry_weight_unit=?, "
            "dried_at=?, updated_at=? WHERE id=?",
            (payload.dry_weight, payload.dry_weight_unit, payload.event_date or now, now,
             payload.harvest_lot_id),
        )
        eid = write_event(
            conn, event_type="Dry",
            event_date=payload.event_date, operator_id=payload.operator_id,
            client_id=payload.client_id,
            subject_lot_kind="harvest", subject_lot_id=payload.harvest_lot_id,
            payload={"dry_weight": payload.dry_weight, "dry_weight_unit": payload.dry_weight_unit},
            notes=payload.notes,
        )
        attach_photos(conn, eid, "harvest", payload.harvest_lot_id, payload.photo_refs)
        row = conn.execute("SELECT * FROM harvest_lots WHERE id = ?",
                           (payload.harvest_lot_id,)).fetchone()
    return {"harvest": row_to_dict(row), "event_id": eid}
