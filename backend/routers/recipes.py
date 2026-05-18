"""Bulk substrate recipe CRUD."""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException

from db import db, new_id, now_iso, row_to_dict, rows_to_list
from models import RecipeIn

router = APIRouter(prefix="/api/recipes", tags=["recipes"])


def _hydrate(row: dict) -> dict:
    """Decode JSON columns for response."""
    row = dict(row)
    try:
        row["components"] = json.loads(row.pop("components_json"))
    except (json.JSONDecodeError, TypeError):
        row["components"] = []
    extra = row.pop("extra_json", None)
    if extra:
        try:
            row["extra"] = json.loads(extra)
        except json.JSONDecodeError:
            row["extra"] = None
    else:
        row["extra"] = None
    return row


@router.get("")
def list_recipes() -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM bulk_substrate_recipes WHERE deleted_at IS NULL ORDER BY code"
        ).fetchall()
    return [_hydrate(dict(r)) for r in rows]


@router.post("")
def create_recipe(payload: RecipeIn) -> dict:
    now = now_iso()
    rid = new_id()
    with db() as conn:
        existing = conn.execute(
            "SELECT id FROM bulk_substrate_recipes WHERE code = ? AND deleted_at IS NULL",
            (payload.code,),
        ).fetchone()
        if existing:
            raise HTTPException(409, f"recipe code '{payload.code}' already exists")
        conn.execute(
            "INSERT INTO bulk_substrate_recipes(id, code, name, components_json, hydration_target, "
            "prep_method, notes, extra_json, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (rid, payload.code, payload.name,
             json.dumps([c.model_dump() for c in payload.components]),
             payload.hydration_target, payload.prep_method, payload.notes,
             json.dumps(payload.extra) if payload.extra else None, now, now),
        )
        row = conn.execute("SELECT * FROM bulk_substrate_recipes WHERE id = ?", (rid,)).fetchone()
    return _hydrate(dict(row))


@router.get("/{rid}")
def get_recipe(rid: str) -> dict:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM bulk_substrate_recipes WHERE id = ? AND deleted_at IS NULL", (rid,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "recipe not found")
    return _hydrate(dict(row))


@router.patch("/{rid}")
def update_recipe(rid: str, payload: RecipeIn) -> dict:
    now = now_iso()
    with db() as conn:
        existing = conn.execute(
            "SELECT id FROM bulk_substrate_recipes WHERE id = ? AND deleted_at IS NULL", (rid,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, "recipe not found")
        conn.execute(
            "UPDATE bulk_substrate_recipes SET code=?, name=?, components_json=?, "
            "hydration_target=?, prep_method=?, notes=?, extra_json=?, updated_at=? WHERE id=?",
            (payload.code, payload.name,
             json.dumps([c.model_dump() for c in payload.components]),
             payload.hydration_target, payload.prep_method, payload.notes,
             json.dumps(payload.extra) if payload.extra else None, now, rid),
        )
        row = conn.execute("SELECT * FROM bulk_substrate_recipes WHERE id = ?", (rid,)).fetchone()
    return _hydrate(dict(row))


@router.delete("/{rid}")
def delete_recipe(rid: str) -> dict:
    now = now_iso()
    with db() as conn:
        conn.execute(
            "UPDATE bulk_substrate_recipes SET deleted_at=?, updated_at=? WHERE id=?",
            (now, now, rid),
        )
    return {"id": rid, "deleted": True}
