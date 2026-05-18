"""In-state events: BreakAndShake, ContaminationFlag/Lift, WeightMeasurement, MoveLocation,
ConsumePartial, NoteAttach, Archive/Destroy/MarkGifted/MarkConsumed. Also events stream GET."""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException

from db import db, new_id, now_iso, row_to_dict, rows_to_list
from events_util import attach_photos, decrement_source, write_event
from models import (
    BreakAndShakeIn,
    ConsumePartialIn,
    ContaminationFlagIn,
    ContaminationLiftIn,
    LifecycleIn,
    MoveLocationIn,
    NoteAttachIn,
    WeightMeasurementIn,
)

router = APIRouter(prefix="/api/events", tags=["events"])


# ── events stream ────────────────────────────────────────────────────────

@router.get("")
def list_events(
    lot_kind: str | None = None,
    lot_id: str | None = None,
    event_type: str | None = None,
    limit: int = 200,
) -> list[dict]:
    sql = "SELECT * FROM events WHERE 1=1"
    params: list = []
    if lot_kind:
        sql += " AND (subject_lot_kind = ? OR id IN (SELECT event_id FROM event_sources WHERE source_lot_kind = ?))"
        params.extend([lot_kind, lot_kind])
    if lot_id:
        sql += " AND (subject_lot_id = ? OR id IN (SELECT event_id FROM event_sources WHERE source_lot_id = ?))"
        params.extend([lot_id, lot_id])
    if event_type:
        sql += " AND event_type = ?"
        params.append(event_type)
    sql += " ORDER BY event_date DESC, recorded_at DESC LIMIT ?"
    params.append(limit)
    with db() as conn:
        rows = conn.execute(sql, params).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["payload"] = json.loads(d.pop("payload_json"))
        except (json.JSONDecodeError, TypeError):
            d["payload"] = {}
        # attach sources
        srcs = conn.execute(
            "SELECT * FROM event_sources WHERE event_id = ?", (d["id"],)
        ).fetchall() if False else []
        out.append(d)
    # second pass for sources (avoid nested conn use inside generator)
    with db() as conn:
        for d in out:
            srcs = conn.execute(
                "SELECT source_lot_kind, source_lot_id, amount_consumed, amount_unit "
                "FROM event_sources WHERE event_id = ?",
                (d["id"],),
            ).fetchall()
            d["sources"] = [dict(s) for s in srcs]
    return out


@router.get("/{eid}")
def get_event(eid: str) -> dict:
    with db() as conn:
        row = conn.execute("SELECT * FROM events WHERE id = ?", (eid,)).fetchone()
        if not row:
            raise HTTPException(404, "event not found")
        d = dict(row)
        try:
            d["payload"] = json.loads(d.pop("payload_json"))
        except (json.JSONDecodeError, TypeError):
            d["payload"] = {}
        srcs = conn.execute(
            "SELECT source_lot_kind, source_lot_id, amount_consumed, amount_unit "
            "FROM event_sources WHERE event_id = ?", (eid,)
        ).fetchall()
        d["sources"] = [dict(s) for s in srcs]
    return d


# ── BreakAndShake ─────────────────────────────────────────────────────────

@router.post("/break-and-shake")
def break_and_shake(payload: BreakAndShakeIn) -> dict:
    with db() as conn:
        g = conn.execute("SELECT id, phase FROM grain_lots WHERE id = ? AND deleted_at IS NULL",
                         (payload.grain_lot_id,)).fetchone()
        if not g:
            raise HTTPException(404, "grain lot not found")
        if g["phase"] != "inoculated":
            raise HTTPException(409, "break-and-shake only applies to inoculated grain")
        eid = write_event(
            conn, event_type="BreakAndShake",
            event_date=payload.event_date, operator_id=payload.operator_id,
            client_id=payload.client_id,
            subject_lot_kind="grain", subject_lot_id=payload.grain_lot_id,
            payload={}, notes=payload.notes,
        )
        attach_photos(conn, eid, "grain", payload.grain_lot_id, payload.photo_refs)
    return {"event_id": eid}


# ── Contamination ─────────────────────────────────────────────────────────

@router.post("/contamination-flag")
def contamination_flag(payload: ContaminationFlagIn) -> dict:
    now = now_iso()
    fid = new_id()
    with db() as conn:
        eid = write_event(
            conn, event_type="ContaminationFlag",
            event_date=payload.event_date, operator_id=payload.operator_id,
            client_id=payload.client_id,
            subject_lot_kind=payload.lot_kind, subject_lot_id=payload.lot_id,
            payload={"severity": payload.severity, "quarantine": payload.quarantine,
                     "suspected_contaminant": payload.suspected_contaminant},
            notes=payload.notes,
        )
        conn.execute(
            "INSERT INTO contamination_flags(id, lot_kind, lot_id, severity, quarantine, "
            "suspected_contaminant, flag_event_id, active, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
            (fid, payload.lot_kind, payload.lot_id, payload.severity,
             1 if payload.quarantine else 0, payload.suspected_contaminant, eid, now, now),
        )
        # If confirmed, mark the lot's lifecycle_status (does NOT mutate downstream — per design call #9)
        if payload.severity == "confirmed":
            table = {"agar": "agar_plates", "lc": "liquid_cultures", "grain": "grain_lots",
                     "ingest": "ingest_records", "batch": "batches", "harvest": "harvest_lots"}.get(
                payload.lot_kind)
            if table:
                conn.execute(
                    f"UPDATE {table} SET lifecycle_status = 'contaminated', updated_at = ? WHERE id = ?",
                    (now, payload.lot_id),
                )
        attach_photos(conn, eid, payload.lot_kind, payload.lot_id, payload.photo_refs)
    return {"event_id": eid, "flag_id": fid}


@router.post("/contamination-lift")
def contamination_lift(payload: ContaminationLiftIn) -> dict:
    now = now_iso()
    with db() as conn:
        flag = conn.execute(
            "SELECT * FROM contamination_flags WHERE id = ? AND active = 1", (payload.flag_id,)
        ).fetchone()
        if not flag:
            raise HTTPException(404, "active contamination flag not found")
        eid = write_event(
            conn, event_type="ContaminationLift",
            event_date=payload.event_date, operator_id=payload.operator_id,
            client_id=payload.client_id,
            subject_lot_kind=flag["lot_kind"], subject_lot_id=flag["lot_id"],
            payload={"flag_id": payload.flag_id, "reason": payload.reason},
            notes=payload.notes,
        )
        conn.execute(
            "UPDATE contamination_flags SET active = 0, lift_event_id = ?, updated_at = ? WHERE id = ?",
            (eid, now, payload.flag_id),
        )
        # Move lot back to active (only if not also destroyed/archived since)
        table = {"agar": "agar_plates", "lc": "liquid_cultures", "grain": "grain_lots",
                 "ingest": "ingest_records", "batch": "batches", "harvest": "harvest_lots"}.get(
            flag["lot_kind"])
        if table:
            conn.execute(
                f"UPDATE {table} SET lifecycle_status = 'active', updated_at = ? "
                f"WHERE id = ? AND lifecycle_status = 'contaminated'",
                (now, flag["lot_id"]),
            )
    return {"event_id": eid}


@router.get("/contamination/active")
def list_active_flags() -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM contamination_flags WHERE active = 1 ORDER BY created_at DESC"
        ).fetchall()
    return rows_to_list(rows)


# ── WeightMeasurement / MoveLocation / ConsumePartial / NoteAttach ────────

@router.post("/weight-measurement")
def weight_measurement(payload: WeightMeasurementIn) -> dict:
    with db() as conn:
        eid = write_event(
            conn, event_type="WeightMeasurement",
            event_date=payload.event_date, operator_id=payload.operator_id,
            client_id=payload.client_id,
            subject_lot_kind=payload.lot_kind, subject_lot_id=payload.lot_id,
            payload={"weight": payload.weight, "unit": payload.unit, "context": payload.context},
            notes=payload.notes,
        )
        attach_photos(conn, eid, payload.lot_kind, payload.lot_id, payload.photo_refs)
    return {"event_id": eid}


@router.post("/move-location")
def move_location(payload: MoveLocationIn) -> dict:
    now = now_iso()
    with db() as conn:
        # Find previous location
        table = {"agar": "agar_plates", "lc": "liquid_cultures", "grain": "grain_lots",
                 "batch": "batches", "harvest": "harvest_lots"}.get(payload.lot_kind)
        prev = None
        if table:
            row = conn.execute(f"SELECT location FROM {table} WHERE id = ?",
                               (payload.lot_id,)).fetchone() if table == "batches" else None
            prev = row["location"] if row and "location" in row.keys() else None
            if table == "batches":
                conn.execute(f"UPDATE {table} SET location = ?, updated_at = ? WHERE id = ?",
                             (payload.new_location, now, payload.lot_id))
        eid = write_event(
            conn, event_type="MoveLocation",
            event_date=payload.event_date, operator_id=payload.operator_id,
            client_id=payload.client_id,
            subject_lot_kind=payload.lot_kind, subject_lot_id=payload.lot_id,
            payload={"previous_location": prev, "new_location": payload.new_location},
            notes=payload.notes,
        )
        attach_photos(conn, eid, payload.lot_kind, payload.lot_id, payload.photo_refs)
    return {"event_id": eid}


@router.post("/consume-partial")
def consume_partial(payload: ConsumePartialIn) -> dict:
    with db() as conn:
        decrement_source(conn, payload.lot_kind, payload.lot_id, payload.amount)
        eid = write_event(
            conn, event_type="ConsumePartial",
            event_date=payload.event_date, operator_id=payload.operator_id,
            client_id=payload.client_id,
            subject_lot_kind=payload.lot_kind, subject_lot_id=payload.lot_id,
            payload={"amount": payload.amount, "amount_unit": payload.amount_unit,
                     "reason": payload.reason},
            notes=payload.notes,
            sources=[{"lot_kind": payload.lot_kind, "lot_id": payload.lot_id,
                      "amount": payload.amount, "unit": payload.amount_unit}],
        )
        attach_photos(conn, eid, payload.lot_kind, payload.lot_id, payload.photo_refs)
    return {"event_id": eid}


@router.post("/note-attach")
def note_attach(payload: NoteAttachIn) -> dict:
    with db() as conn:
        eid = write_event(
            conn, event_type="NoteAttach",
            event_date=payload.event_date, operator_id=payload.operator_id,
            client_id=payload.client_id,
            subject_lot_kind=payload.lot_kind, subject_lot_id=payload.lot_id,
            payload={"target_event_id": payload.target_event_id, "note": payload.note},
            notes=payload.note,
        )
        attach_photos(conn, eid, payload.lot_kind, payload.lot_id, payload.photo_refs)
    return {"event_id": eid}


# ── Lifecycle: Archive / Destroy / MarkGifted / MarkConsumed ──────────────

_LIFECYCLE_TYPE = {
    "archive": "Archive",
    "destroy": "Destroy",
    "mark-gifted": "MarkGifted",
    "mark-consumed": "MarkConsumed",
}
_STATUS_FOR = {
    "Archive": "archived",
    "Destroy": "destroyed",
    "MarkGifted": "gifted",
    "MarkConsumed": "consumed",
}


@router.post("/{action}")
def lifecycle(action: str, payload: LifecycleIn) -> dict:
    if action not in _LIFECYCLE_TYPE:
        raise HTTPException(404, f"unknown action '{action}'")
    etype = _LIFECYCLE_TYPE[action]
    status = _STATUS_FOR[etype]
    now = now_iso()
    table = {"agar": "agar_plates", "lc": "liquid_cultures", "grain": "grain_lots",
             "ingest": "ingest_records", "batch": "batches", "harvest": "harvest_lots"}.get(
        payload.lot_kind)
    if not table:
        raise HTTPException(400, f"unknown lot_kind '{payload.lot_kind}'")
    with db() as conn:
        conn.execute(
            f"UPDATE {table} SET lifecycle_status = ?, updated_at = ? WHERE id = ?",
            (status, now, payload.lot_id),
        )
        eid = write_event(
            conn, event_type=etype,
            event_date=payload.event_date, operator_id=payload.operator_id,
            client_id=payload.client_id,
            subject_lot_kind=payload.lot_kind, subject_lot_id=payload.lot_id,
            payload={"reason": payload.reason, "recipient": payload.recipient},
            notes=payload.notes,
        )
        attach_photos(conn, eid, payload.lot_kind, payload.lot_id, payload.photo_refs)
    return {"event_id": eid, "status": status}
