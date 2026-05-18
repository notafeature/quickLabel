"""Genetic code CRUD."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from db import db, new_id, now_iso, row_to_dict, rows_to_list
from models import GeneticCodeIn

router = APIRouter(prefix="/api/genetics", tags=["genetics"])


@router.get("")
def list_genetics() -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM genetic_codes WHERE deleted_at IS NULL ORDER BY code"
        ).fetchall()
    return rows_to_list(rows)


@router.post("")
def create_genetic(payload: GeneticCodeIn) -> dict:
    now = now_iso()
    gid = new_id()
    with db() as conn:
        existing = conn.execute(
            "SELECT id FROM genetic_codes WHERE code = ? AND deleted_at IS NULL",
            (payload.code,),
        ).fetchone()
        if existing:
            raise HTTPException(409, f"genetic code '{payload.code}' already exists")
        conn.execute(
            "INSERT INTO genetic_codes(id, code, genus, species, cultivar, colonization_window_days, "
            "notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (gid, payload.code, payload.genus, payload.species, payload.cultivar,
             payload.colonization_window_days, payload.notes, now, now),
        )
        row = conn.execute("SELECT * FROM genetic_codes WHERE id = ?", (gid,)).fetchone()
    return row_to_dict(row)


@router.get("/{gid}")
def get_genetic(gid: str) -> dict:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM genetic_codes WHERE id = ? AND deleted_at IS NULL", (gid,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "genetic code not found")
    return row_to_dict(row)


@router.patch("/{gid}")
def update_genetic(gid: str, payload: GeneticCodeIn) -> dict:
    now = now_iso()
    with db() as conn:
        existing = conn.execute(
            "SELECT id FROM genetic_codes WHERE id = ? AND deleted_at IS NULL", (gid,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, "genetic code not found")
        conn.execute(
            "UPDATE genetic_codes SET code=?, genus=?, species=?, cultivar=?, "
            "colonization_window_days=?, notes=?, updated_at=? WHERE id=?",
            (payload.code, payload.genus, payload.species, payload.cultivar,
             payload.colonization_window_days, payload.notes, now, gid),
        )
        row = conn.execute("SELECT * FROM genetic_codes WHERE id = ?", (gid,)).fetchone()
    return row_to_dict(row)


@router.delete("/{gid}")
def delete_genetic(gid: str) -> dict:
    now = now_iso()
    with db() as conn:
        conn.execute(
            "UPDATE genetic_codes SET deleted_at=?, updated_at=? WHERE id=?",
            (now, now, gid),
        )
    return {"id": gid, "deleted": True}
