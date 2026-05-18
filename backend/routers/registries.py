"""Registry CRUD: grain_types, agar_formulas, substrate_components, ingest_types."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import db, now_iso, rows_to_list

router = APIRouter(prefix="/api/registries", tags=["registries"])

# ---------------------------------------------------------------------------
# Shared helpers for simple {code, description} tables
# ---------------------------------------------------------------------------


def _list_simple(table: str) -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            f"SELECT code, description FROM {table} WHERE deleted_at IS NULL ORDER BY code"
        ).fetchall()
    return rows_to_list(rows)


def _upsert_simple(table: str, code: str, description: str) -> dict:
    now = now_iso()
    with db() as conn:
        conn.execute(
            f"INSERT INTO {table}(code, description, created_at, updated_at) VALUES (?, ?, ?, ?) "
            f"ON CONFLICT(code) DO UPDATE SET description = excluded.description, "
            f"updated_at = excluded.updated_at, deleted_at = NULL",
            (code, description, now, now),
        )
    return {"code": code, "description": description}


def _delete_simple(table: str, code: str) -> dict:
    now = now_iso()
    with db() as conn:
        conn.execute(
            f"UPDATE {table} SET deleted_at = ?, updated_at = ? WHERE code = ?",
            (now, now, code),
        )
    return {"code": code, "deleted": True}


class SimpleEntry(BaseModel):
    code: str
    description: str


# ── grain_types ───────────────────────────────────────────────────────────

@router.get("/grain-types")
def list_grain_types() -> list[dict]:
    return _list_simple("grain_types")


@router.put("/grain-types/{code}")
def put_grain_type(code: str, entry: SimpleEntry) -> dict:
    if entry.code != code:
        raise HTTPException(400, "code mismatch")
    return _upsert_simple("grain_types", code, entry.description)


@router.delete("/grain-types/{code}")
def del_grain_type(code: str) -> dict:
    return _delete_simple("grain_types", code)


# ── agar_formulas ─────────────────────────────────────────────────────────

@router.get("/agar-formulas")
def list_agar_formulas() -> list[dict]:
    return _list_simple("agar_formulas")


@router.put("/agar-formulas/{code}")
def put_agar_formula(code: str, entry: SimpleEntry) -> dict:
    if entry.code != code:
        raise HTTPException(400, "code mismatch")
    return _upsert_simple("agar_formulas", code, entry.description)


@router.delete("/agar-formulas/{code}")
def del_agar_formula(code: str) -> dict:
    return _delete_simple("agar_formulas", code)


# ── substrate_components ──────────────────────────────────────────────────

@router.get("/substrate-components")
def list_substrate_components() -> list[dict]:
    return _list_simple("substrate_components")


@router.put("/substrate-components/{code}")
def put_substrate_component(code: str, entry: SimpleEntry) -> dict:
    if entry.code != code:
        raise HTTPException(400, "code mismatch")
    return _upsert_simple("substrate_components", code, entry.description)


@router.delete("/substrate-components/{code}")
def del_substrate_component(code: str) -> dict:
    return _delete_simple("substrate_components", code)


# ── ingest_types ──────────────────────────────────────────────────────────

class IngestTypeEntry(BaseModel):
    code: str
    label: str
    derivative_kind: Optional[str] = None


@router.get("/ingest-types")
def list_ingest_types() -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT code, label, derivative_kind FROM ingest_types "
            "WHERE deleted_at IS NULL ORDER BY code"
        ).fetchall()
    return rows_to_list(rows)


@router.put("/ingest-types/{code}")
def put_ingest_type(code: str, entry: IngestTypeEntry) -> dict:
    if entry.code != code:
        raise HTTPException(400, "code mismatch")
    if entry.derivative_kind not in (None, "agar", "lc"):
        raise HTTPException(400, "derivative_kind must be 'agar', 'lc', or null")
    now = now_iso()
    with db() as conn:
        conn.execute(
            "INSERT INTO ingest_types(code, label, derivative_kind, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(code) DO UPDATE SET label = excluded.label, "
            "derivative_kind = excluded.derivative_kind, updated_at = excluded.updated_at, deleted_at = NULL",
            (code, entry.label, entry.derivative_kind, now, now),
        )
    return entry.model_dump()


@router.delete("/ingest-types/{code}")
def del_ingest_type(code: str) -> dict:
    return _delete_simple("ingest_types", code)
