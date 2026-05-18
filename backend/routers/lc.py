"""Liquid culture workflow: PlateLC (creates) + DrawLC (draw from parent)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from db import db, new_id, now_iso, row_to_dict, rows_to_list
from events_util import attach_photos, decrement_source, write_event
from lots import allocate_lot_id
from models import DrawLCIn, PlateLCIn

router = APIRouter(prefix="/api/lc", tags=["lc"])


@router.get("")
def list_lc() -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM liquid_cultures WHERE deleted_at IS NULL ORDER BY created_at DESC"
        ).fetchall()
    return rows_to_list(rows)


@router.get("/{lot_uuid}")
def get_lc(lot_uuid: str) -> dict:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM liquid_cultures WHERE id = ? AND deleted_at IS NULL", (lot_uuid,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "LC not found")
    return row_to_dict(row)


@router.post("/plate")
def plate_lc(payload: PlateLCIn) -> dict:
    now = now_iso()
    with db() as conn:
        gc = conn.execute(
            "SELECT code FROM genetic_codes WHERE id = ? AND deleted_at IS NULL",
            (payload.genetic_code_id,),
        ).fetchone()
        if not gc:
            raise HTTPException(404, "genetic code not found")
        lot_id = allocate_lot_id(conn, "LC", gc["code"], payload.event_date or now)
        pid = new_id()
        conn.execute(
            "INSERT INTO liquid_cultures(id, lot_id, genetic_code_id, lineage_f, lineage_c, lineage_iso, "
            "lineage_t, vessel_type, initial_volume_ml, remaining_ml, notes, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (pid, lot_id, payload.genetic_code_id, payload.lineage.f, payload.lineage.c,
             payload.lineage.iso, payload.lineage.t, payload.vessel_type,
             payload.initial_volume_ml, payload.initial_volume_ml,
             payload.notes, now, now),
        )

        sources = []
        if payload.source:
            sources.append({
                "lot_kind": payload.source.lot_kind, "lot_id": payload.source.lot_id,
                "amount": payload.source.amount, "unit": payload.source.amount_unit,
            })
            if payload.source.amount is not None:
                decrement_source(conn, payload.source.lot_kind, payload.source.lot_id,
                                 payload.source.amount)

        eid = write_event(
            conn, event_type="PlateLC",
            event_date=payload.event_date, operator_id=payload.operator_id,
            client_id=payload.client_id,
            subject_lot_kind="lc", subject_lot_id=pid,
            payload={"lot_id": lot_id, "vessel_type": payload.vessel_type,
                     "initial_volume_ml": payload.initial_volume_ml},
            notes=payload.notes, sources=sources,
        )
        attach_photos(conn, eid, "lc", pid, payload.photo_refs)
        row = conn.execute("SELECT * FROM liquid_cultures WHERE id = ?", (pid,)).fetchone()
    return {"lc": row_to_dict(row), "event_id": eid}


@router.post("/draw")
def draw_lc(payload: DrawLCIn) -> dict:
    """Create a child LC (syringe, etc.) from a parent. Decrements parent.remaining_ml by amount_ml."""
    now = now_iso()
    with db() as conn:
        parent = conn.execute(
            "SELECT * FROM liquid_cultures WHERE id = ? AND deleted_at IS NULL", (payload.parent_lc_id,)
        ).fetchone()
        if not parent:
            raise HTTPException(404, "parent LC not found")
        gc = conn.execute("SELECT code FROM genetic_codes WHERE id = ?",
                          (parent["genetic_code_id"],)).fetchone()
        lot_id = allocate_lot_id(conn, "LC", gc["code"], payload.event_date or now)
        pid = new_id()
        lineage = payload.lineage if payload.lineage else None
        lf = (lineage.f if lineage else parent["lineage_f"])
        lc = (lineage.c if lineage else parent["lineage_c"])
        li = (lineage.iso if lineage else parent["lineage_iso"])
        lt = (lineage.t if lineage else parent["lineage_t"])
        vtype = payload.vessel_type or parent["vessel_type"]

        conn.execute(
            "INSERT INTO liquid_cultures(id, lot_id, genetic_code_id, parent_lot_id, lineage_f, lineage_c, "
            "lineage_iso, lineage_t, vessel_type, initial_volume_ml, remaining_ml, notes, "
            "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (pid, lot_id, parent["genetic_code_id"], payload.parent_lc_id, lf, lc, li, lt,
             vtype, payload.amount_ml, payload.amount_ml, payload.notes, now, now),
        )
        decrement_source(conn, "lc", payload.parent_lc_id, payload.amount_ml)

        eid = write_event(
            conn, event_type="DrawLC",
            event_date=payload.event_date, operator_id=payload.operator_id,
            client_id=payload.client_id,
            subject_lot_kind="lc", subject_lot_id=pid,
            payload={"lot_id": lot_id, "amount_ml": payload.amount_ml,
                     "parent_lot_id": payload.parent_lc_id},
            notes=payload.notes,
            sources=[{"lot_kind": "lc", "lot_id": payload.parent_lc_id,
                      "amount": payload.amount_ml, "unit": "ml"}],
        )
        attach_photos(conn, eid, "lc", pid, payload.photo_refs)
        row = conn.execute("SELECT * FROM liquid_cultures WHERE id = ?", (pid,)).fetchone()
    return {"lc": row_to_dict(row), "event_id": eid}
