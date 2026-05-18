"""Agar workflow: PlateAgar (creates from any source) + DrawAgar (wedge from parent)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from db import db, new_id, now_iso, row_to_dict, rows_to_list
from events_util import attach_photos, decrement_source, write_event
from lots import allocate_lot_id
from models import DrawAgarIn, PlateAgarIn

router = APIRouter(prefix="/api/agar", tags=["agar"])


@router.get("")
def list_agar() -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM agar_plates WHERE deleted_at IS NULL ORDER BY created_at DESC"
        ).fetchall()
    return rows_to_list(rows)


@router.get("/{lot_uuid}")
def get_agar(lot_uuid: str) -> dict:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM agar_plates WHERE id = ? AND deleted_at IS NULL", (lot_uuid,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "agar plate not found")
    return row_to_dict(row)


@router.post("/plate")
def plate_agar(payload: PlateAgarIn) -> dict:
    now = now_iso()
    with db() as conn:
        gc = conn.execute(
            "SELECT code FROM genetic_codes WHERE id = ? AND deleted_at IS NULL",
            (payload.genetic_code_id,),
        ).fetchone()
        if not gc:
            raise HTTPException(404, "genetic code not found")
        lot_id = allocate_lot_id(conn, "AL", gc["code"], payload.event_date or now)
        pid = new_id()
        conn.execute(
            "INSERT INTO agar_plates(id, lot_id, genetic_code_id, lineage_f, lineage_c, lineage_iso, "
            "lineage_t, agar_formula, plate_size, remaining, notes, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1.0, ?, ?, ?)",
            (pid, lot_id, payload.genetic_code_id, payload.lineage.f, payload.lineage.c,
             payload.lineage.iso, payload.lineage.t, payload.agar_formula, payload.plate_size,
             payload.notes, now, now),
        )

        sources = []
        if payload.source:
            sources.append({
                "lot_kind": payload.source.lot_kind,
                "lot_id": payload.source.lot_id,
                "amount": payload.source.amount,
                "unit": payload.source.amount_unit,
            })
            if payload.source.amount is not None:
                decrement_source(conn, payload.source.lot_kind, payload.source.lot_id, payload.source.amount)

        eid = write_event(
            conn, event_type="PlateAgar",
            event_date=payload.event_date, operator_id=payload.operator_id,
            client_id=payload.client_id,
            subject_lot_kind="agar", subject_lot_id=pid,
            payload={"lot_id": lot_id, "agar_formula": payload.agar_formula,
                     "plate_size": payload.plate_size},
            notes=payload.notes, sources=sources,
        )
        attach_photos(conn, eid, "agar", pid, payload.photo_refs)
        row = conn.execute("SELECT * FROM agar_plates WHERE id = ?", (pid,)).fetchone()
    return {"agar": row_to_dict(row), "event_id": eid}


@router.post("/draw")
def draw_agar(payload: DrawAgarIn) -> dict:
    """Create a child AgarPlate (wedge) from a parent. Decrements parent.remaining."""
    now = now_iso()
    with db() as conn:
        parent = conn.execute(
            "SELECT * FROM agar_plates WHERE id = ? AND deleted_at IS NULL", (payload.parent_agar_id,)
        ).fetchone()
        if not parent:
            raise HTTPException(404, "parent agar plate not found")
        gc = conn.execute("SELECT code FROM genetic_codes WHERE id = ?",
                          (parent["genetic_code_id"],)).fetchone()
        lot_id = allocate_lot_id(conn, "AL", gc["code"], payload.event_date or now)
        pid = new_id()
        lineage = payload.lineage if payload.lineage else None
        lf = (lineage.f if lineage else parent["lineage_f"])
        lc = (lineage.c if lineage else parent["lineage_c"])
        li = (lineage.iso if lineage else parent["lineage_iso"])
        lt = (lineage.t if lineage else parent["lineage_t"])
        formula = payload.agar_formula or parent["agar_formula"]
        psize = payload.plate_size or parent["plate_size"]

        conn.execute(
            "INSERT INTO agar_plates(id, lot_id, genetic_code_id, parent_lot_id, lineage_f, lineage_c, "
            "lineage_iso, lineage_t, agar_formula, plate_size, remaining, notes, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1.0, ?, ?, ?)",
            (pid, lot_id, parent["genetic_code_id"], payload.parent_agar_id, lf, lc, li, lt,
             formula, psize, payload.notes, now, now),
        )
        decrement_source(conn, "agar", payload.parent_agar_id, payload.fraction)

        eid = write_event(
            conn, event_type="DrawAgar",
            event_date=payload.event_date, operator_id=payload.operator_id,
            client_id=payload.client_id,
            subject_lot_kind="agar", subject_lot_id=pid,
            payload={"lot_id": lot_id, "fraction_drawn": payload.fraction,
                     "parent_lot_id": payload.parent_agar_id},
            notes=payload.notes,
            sources=[{"lot_kind": "agar", "lot_id": payload.parent_agar_id,
                      "amount": payload.fraction, "unit": "fraction"}],
        )
        attach_photos(conn, eid, "agar", pid, payload.photo_refs)
        row = conn.execute("SELECT * FROM agar_plates WHERE id = ?", (pid,)).fetchone()
    return {"agar": row_to_dict(row), "event_id": eid}
