"""Ingest workflow: IngestEvent + IngestRecord (+ optional derivative AgarPlate or LC)."""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException

from db import db, new_id, now_iso, row_to_dict, rows_to_list
from events_util import attach_photos, write_event
from lots import allocate_lot_id
from models import IngestEventIn

router = APIRouter(prefix="/api/ingest", tags=["ingest"])


@router.get("")
def list_ingests() -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM ingest_records WHERE deleted_at IS NULL ORDER BY received_date DESC"
        ).fetchall()
    return rows_to_list(rows)


@router.get("/{lot_uuid}")
def get_ingest(lot_uuid: str) -> dict:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM ingest_records WHERE id = ? AND deleted_at IS NULL", (lot_uuid,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "ingest record not found")
    return row_to_dict(row)


@router.post("")
def create_ingest(payload: IngestEventIn) -> dict:
    now = now_iso()
    with db() as conn:
        # Validate genetic & ingest type, get derivative_kind
        gc = conn.execute(
            "SELECT * FROM genetic_codes WHERE id = ? AND deleted_at IS NULL",
            (payload.genetic_code_id,),
        ).fetchone()
        if not gc:
            raise HTTPException(404, "genetic code not found")
        itype = conn.execute(
            "SELECT * FROM ingest_types WHERE code = ? AND deleted_at IS NULL",
            (payload.ingest_type,),
        ).fetchone()
        if not itype:
            raise HTTPException(404, f"ingest type '{payload.ingest_type}' not found")

        lot_id = allocate_lot_id(conn, payload.ingest_type, gc["code"], payload.received_date or now)
        iid = new_id()
        deriv_kind = itype["derivative_kind"]
        deriv_id = None

        # Insert IngestRecord
        conn.execute(
            "INSERT INTO ingest_records(id, lot_id, genetic_code_id, ingest_type, external_source, "
            "lineage_f, lineage_c, lineage_iso, lineage_t, received_date, derivative_lot_kind, "
            "derivative_lot_id, notes, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (iid, lot_id, payload.genetic_code_id, payload.ingest_type, payload.external_source,
             payload.lineage.f, payload.lineage.c, payload.lineage.iso, payload.lineage.t,
             payload.received_date or now, deriv_kind, None, payload.notes, now, now),
        )

        # Optional auto-create derivative lot (per design call #8)
        if deriv_kind == "agar":
            deriv_id = new_id()
            deriv_lot = allocate_lot_id(conn, "AL", gc["code"], payload.received_date or now)
            conn.execute(
                "INSERT INTO agar_plates(id, lot_id, genetic_code_id, lineage_f, lineage_c, "
                "lineage_iso, lineage_t, agar_formula, plate_size, remaining, notes, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1.0, ?, ?, ?)",
                (deriv_id, deriv_lot, payload.genetic_code_id, payload.lineage.f, payload.lineage.c,
                 payload.lineage.iso, payload.lineage.t, payload.agar_formula, payload.plate_size,
                 f"Derived from ingest {lot_id}", now, now),
            )
        elif deriv_kind == "lc":
            deriv_id = new_id()
            deriv_lot = allocate_lot_id(conn, "LC", gc["code"], payload.received_date or now)
            initial_ml = payload.initial_volume_ml or 10.0
            conn.execute(
                "INSERT INTO liquid_cultures(id, lot_id, genetic_code_id, lineage_f, lineage_c, "
                "lineage_iso, lineage_t, vessel_type, initial_volume_ml, remaining_ml, notes, "
                "created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (deriv_id, deriv_lot, payload.genetic_code_id, payload.lineage.f, payload.lineage.c,
                 payload.lineage.iso, payload.lineage.t, payload.vessel_type, initial_ml, initial_ml,
                 f"Derived from ingest {lot_id}", now, now),
            )

        if deriv_id:
            conn.execute(
                "UPDATE ingest_records SET derivative_lot_id = ?, updated_at = ? WHERE id = ?",
                (deriv_id, now, iid),
            )

        eid = write_event(
            conn,
            event_type="IngestEvent",
            event_date=payload.event_date or payload.received_date,
            operator_id=payload.operator_id,
            client_id=payload.client_id,
            subject_lot_kind="ingest",
            subject_lot_id=iid,
            payload={
                "lot_id": lot_id,
                "ingest_type": payload.ingest_type,
                "external_source": payload.external_source,
                "derivative_lot_kind": deriv_kind,
                "derivative_lot_id": deriv_id,
            },
            notes=payload.notes,
        )
        attach_photos(conn, eid, "ingest", iid, payload.photo_refs)

        row = conn.execute("SELECT * FROM ingest_records WHERE id = ?", (iid,)).fetchone()

    return {"ingest": row_to_dict(row), "event_id": eid, "derivative_lot_id": deriv_id}
