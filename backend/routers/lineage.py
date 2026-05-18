"""Lineage walks: backward (provenance) and forward (progeny)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from chain import LOT_TABLE, backward_walk, forward_walk
from db import db

router = APIRouter(prefix="/api/lineage", tags=["lineage"])


@router.get("/{lot_kind}/{lot_uuid}/backward")
def backward(lot_kind: str, lot_uuid: str) -> dict:
    if lot_kind not in LOT_TABLE:
        raise HTTPException(400, f"unknown lot_kind '{lot_kind}'")
    with db() as conn:
        result = backward_walk(conn, lot_kind, lot_uuid)
    if result is None:
        raise HTTPException(404, "lot not found")
    return result


@router.get("/{lot_kind}/{lot_uuid}/forward")
def forward(lot_kind: str, lot_uuid: str) -> dict:
    if lot_kind not in LOT_TABLE:
        raise HTTPException(400, f"unknown lot_kind '{lot_kind}'")
    with db() as conn:
        result = forward_walk(conn, lot_kind, lot_uuid)
    return result


@router.get("/by-lot-id/{lot_id}")
def resolve_lot_id(lot_id: str) -> dict:
    """Resolve a human-readable lot ID (e.g. GL-SL192-260518-03) to (lot_kind, uuid)."""
    with db() as conn:
        for kind, table in LOT_TABLE.items():
            if kind == "grain":
                row = conn.execute(
                    "SELECT id, 'grain' AS kind FROM grain_lots "
                    "WHERE sterile_lot_id = ? OR inoculated_lot_id = ?",
                    (lot_id, lot_id),
                ).fetchone()
            else:
                row = conn.execute(f"SELECT id, '{kind}' AS kind FROM {table} WHERE lot_id = ?",
                                   (lot_id,)).fetchone()
            if row:
                return {"lot_kind": row["kind"], "id": row["id"], "lot_id": lot_id}
    raise HTTPException(404, f"lot_id '{lot_id}' not found")
