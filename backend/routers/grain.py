"""Grain workflow: SterilizeGrain (creates sterile bag) + InoculateGrain (transitions to inoculated)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from db import db, new_id, now_iso, row_to_dict, rows_to_list
from events_util import attach_photos, decrement_source, write_event
from lots import allocate_lot_id
from models import InoculateGrainIn, SterilizeGrainIn

router = APIRouter(prefix="/api/grain", tags=["grain"])


@router.get("")
def list_grain(phase: str | None = None) -> list[dict]:
    sql = "SELECT * FROM grain_lots WHERE deleted_at IS NULL"
    params: list = []
    if phase:
        sql += " AND phase = ?"
        params.append(phase)
    sql += " ORDER BY created_at DESC"
    with db() as conn:
        rows = conn.execute(sql, params).fetchall()
    return rows_to_list(rows)


@router.get("/{lot_uuid}")
def get_grain(lot_uuid: str) -> dict:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM grain_lots WHERE id = ? AND deleted_at IS NULL", (lot_uuid,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "grain lot not found")
    return row_to_dict(row)


@router.post("/sterilize")
def sterilize_grain(payload: SterilizeGrainIn) -> dict:
    """Create N sterile grain bags. Returns the list."""
    now = now_iso()
    created: list[dict] = []
    with db() as conn:
        gt = conn.execute(
            "SELECT * FROM grain_types WHERE code = ? AND deleted_at IS NULL",
            (payload.grain_type,),
        ).fetchone()
        if not gt:
            raise HTTPException(404, f"grain type '{payload.grain_type}' not found")

        for _ in range(payload.count):
            sterile_lot_id = allocate_lot_id(conn, "SG", payload.grain_type, payload.event_date or now)
            gid = new_id()
            conn.execute(
                "INSERT INTO grain_lots(id, sterile_lot_id, phase, grain_type, prep_size, sterilized_at, "
                "colonization_state, remaining, notes, created_at, updated_at) "
                "VALUES (?, ?, 'sterile', ?, ?, ?, 'none', 1.0, ?, ?, ?)",
                (gid, sterile_lot_id, payload.grain_type, payload.prep_size,
                 payload.event_date or now, payload.notes, now, now),
            )
            eid = write_event(
                conn, event_type="SterilizeGrain",
                event_date=payload.event_date, operator_id=payload.operator_id,
                client_id=payload.client_id,
                subject_lot_kind="grain", subject_lot_id=gid,
                payload={"sterile_lot_id": sterile_lot_id, "grain_type": payload.grain_type,
                         "prep_size": payload.prep_size},
                notes=payload.notes,
            )
            attach_photos(conn, eid, "grain", gid, payload.photo_refs)
            row = conn.execute("SELECT * FROM grain_lots WHERE id = ?", (gid,)).fetchone()
            created.append({"grain": row_to_dict(row), "event_id": eid})
    return {"count": len(created), "items": created}


@router.post("/inoculate")
def inoculate_grain(payload: InoculateGrainIn) -> dict:
    """Transition a sterile GrainLot to inoculated; consume the inoculant source."""
    now = now_iso()
    with db() as conn:
        glot = conn.execute(
            "SELECT * FROM grain_lots WHERE id = ? AND deleted_at IS NULL",
            (payload.grain_lot_id,),
        ).fetchone()
        if not glot:
            raise HTTPException(404, "grain lot not found")
        if glot["phase"] != "sterile":
            raise HTTPException(409, f"grain lot is already {glot['phase']}, not sterile")

        gc = conn.execute(
            "SELECT code FROM genetic_codes WHERE id = ? AND deleted_at IS NULL",
            (payload.genetic_code_id,),
        ).fetchone()
        if not gc:
            raise HTTPException(404, "genetic code not found")

        inoc_lot_id = allocate_lot_id(conn, "GL", gc["code"], payload.event_date or now)
        conn.execute(
            "UPDATE grain_lots SET inoculated_lot_id = ?, phase = 'inoculated', "
            "genetic_code_id = ?, lineage_f = ?, lineage_c = ?, lineage_iso = ?, lineage_t = ?, "
            "inoculated_at = ?, colonization_state = 'colonizing', updated_at = ? WHERE id = ?",
            (inoc_lot_id, payload.genetic_code_id, payload.lineage.f, payload.lineage.c,
             payload.lineage.iso, payload.lineage.t, payload.event_date or now, now,
             payload.grain_lot_id),
        )

        sources = [{
            "lot_kind": payload.source.lot_kind, "lot_id": payload.source.lot_id,
            "amount": payload.source.amount, "unit": payload.source.amount_unit,
        }]
        if payload.source.amount is not None:
            decrement_source(conn, payload.source.lot_kind, payload.source.lot_id,
                             payload.source.amount)

        eid = write_event(
            conn, event_type="InoculateGrain",
            event_date=payload.event_date, operator_id=payload.operator_id,
            client_id=payload.client_id,
            subject_lot_kind="grain", subject_lot_id=payload.grain_lot_id,
            payload={"inoculated_lot_id": inoc_lot_id,
                     "genetic_code_id": payload.genetic_code_id},
            notes=payload.notes, sources=sources,
        )
        attach_photos(conn, eid, "grain", payload.grain_lot_id, payload.photo_refs)
        row = conn.execute("SELECT * FROM grain_lots WHERE id = ?", (payload.grain_lot_id,)).fetchone()
    return {"grain": row_to_dict(row), "event_id": eid}
