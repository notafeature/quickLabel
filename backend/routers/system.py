"""System routes: health, init, settings, counters."""
from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import db, now_iso
from lots import next_counter, peek_counter, reset_counter
from models import SettingIn
from seed import seed_registries

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "app": "QuickLabel"}


@router.post("/init")
def init() -> dict:
    """Re-run seed (idempotent). Schema is applied at app startup."""
    seed_registries()
    return {"status": "seeded"}


# ── settings ──────────────────────────────────────────────────────────────

@router.get("/settings")
def list_settings() -> dict[str, Any]:
    out: dict[str, Any] = {}
    with db() as conn:
        rows = conn.execute("SELECT key, value_json FROM settings").fetchall()
    for r in rows:
        try:
            out[r["key"]] = json.loads(r["value_json"])
        except json.JSONDecodeError:
            out[r["key"]] = r["value_json"]
    return out


@router.put("/settings/{key}")
def put_setting(key: str, payload: SettingIn) -> dict:
    now = now_iso()
    value_json = json.dumps(payload.value)
    with db() as conn:
        conn.execute(
            "INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
            (key, value_json, now),
        )
    return {"key": key, "value": payload.value}


# ── lot counters ──────────────────────────────────────────────────────────

class CounterQuery(BaseModel):
    prefix: str
    code: Optional[str] = None
    date: Optional[str] = None  # ISO date or YYMMDD


class CounterReset(CounterQuery):
    to: int


@router.post("/counters/peek")
def counter_peek(q: CounterQuery) -> dict:
    with db() as conn:
        seq, yymmdd = peek_counter(conn, q.prefix, q.code, q.date)
    return {"prefix": q.prefix, "code": q.code, "date": yymmdd, "next": seq}


@router.post("/counters/next")
def counter_next(q: CounterQuery) -> dict:
    with db() as conn:
        seq, yymmdd = next_counter(conn, q.prefix, q.code, q.date)
    return {"prefix": q.prefix, "code": q.code, "date": yymmdd, "seq": seq}


@router.post("/counters/reset")
def counter_reset(q: CounterReset) -> dict:
    with db() as conn:
        reset_counter(conn, q.prefix, q.code, q.date, q.to)
        seq, yymmdd = peek_counter(conn, q.prefix, q.code, q.date)
    return {"prefix": q.prefix, "code": q.code, "date": yymmdd, "next": seq}
