"""Helpers for writing events + sources atomically. Shared by all create-event routes."""
from __future__ import annotations

import json
from typing import Any, Optional

from db import db, new_id, now_iso


def write_event(
    conn,
    *,
    event_type: str,
    event_date: Optional[str],
    operator_id: Optional[str] = None,
    client_id: Optional[str] = None,
    subject_lot_kind: Optional[str] = None,
    subject_lot_id: Optional[str] = None,
    payload: dict[str, Any] | None = None,
    notes: Optional[str] = None,
    sources: list[dict] | None = None,
) -> str:
    """Append an event + its sources. Returns event_id.

    `sources` items: {lot_kind, lot_id, amount?, unit?}
    """
    eid = new_id()
    now = now_iso()
    edate = event_date or now
    cid = client_id or "default"
    conn.execute(
        "INSERT INTO events(id, event_type, event_date, recorded_at, operator_id, client_id, "
        "subject_lot_kind, subject_lot_id, payload_json, notes, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (eid, event_type, edate, now, operator_id, cid,
         subject_lot_kind, subject_lot_id, json.dumps(payload or {}), notes, now),
    )
    if sources:
        for s in sources:
            conn.execute(
                "INSERT INTO event_sources(id, event_id, source_lot_kind, source_lot_id, "
                "amount_consumed, amount_unit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (new_id(), eid, s["lot_kind"], s["lot_id"],
                 s.get("amount"), s.get("unit"), now),
            )
    return eid


def decrement_source(conn, lot_kind: str, lot_id: str, amount: float) -> None:
    """Decrement `remaining` on a source lot. Tolerates over-consumption (caps at 0)."""
    if lot_kind == "agar":
        conn.execute(
            "UPDATE agar_plates SET remaining = MAX(0, remaining - ?), updated_at = ? WHERE id = ?",
            (amount, now_iso(), lot_id),
        )
    elif lot_kind == "lc":
        conn.execute(
            "UPDATE liquid_cultures SET remaining_ml = MAX(0, remaining_ml - ?), updated_at = ? WHERE id = ?",
            (amount, now_iso(), lot_id),
        )
    elif lot_kind == "grain":
        conn.execute(
            "UPDATE grain_lots SET remaining = MAX(0, remaining - ?), updated_at = ? WHERE id = ?",
            (amount, now_iso(), lot_id),
        )
    # ingest, harvest, batch: not currently consumable in v1


def attach_photos(conn, event_id: str, lot_kind: Optional[str], lot_id: Optional[str],
                  photo_refs: list[str]) -> None:
    """Bind already-uploaded photo records to this event."""
    if not photo_refs:
        return
    for ref in photo_refs:
        conn.execute(
            "UPDATE photos SET event_id = ?, lot_kind = COALESCE(lot_kind, ?), "
            "lot_id = COALESCE(lot_id, ?) WHERE id = ?",
            (event_id, lot_kind, lot_id, ref),
        )
