"""Lot ID generation + counter management.

All counter operations accept an open sqlite3 connection. Callers must hold
the connection inside their own `db()` context to ensure atomic increments.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from db import now_iso


def to_yymmdd(iso_date: Optional[str]) -> str:
    """Accepts an ISO date or datetime string, returns YYMMDD."""
    if not iso_date:
        d = date.today()
    else:
        try:
            d = datetime.fromisoformat(iso_date.replace("Z", "+00:00")).date()
        except ValueError:
            d = date.fromisoformat(iso_date[:10])
    return d.strftime("%y%m%d")


def counter_key(prefix: str, code: Optional[str], date_yymmdd: str) -> str:
    if code:
        return f"{prefix}_{code}_{date_yymmdd}"
    return f"{prefix}_{date_yymmdd}"


def next_counter(conn, prefix: str, code: Optional[str], iso_date: Optional[str]) -> tuple[int, str]:
    yymmdd = to_yymmdd(iso_date)
    key = counter_key(prefix, code, yymmdd)
    now = now_iso()
    row = conn.execute("SELECT counter FROM lot_counters WHERE key = ?", (key,)).fetchone()
    if row is None:
        conn.execute(
            "INSERT INTO lot_counters(key, counter, created_at, updated_at) VALUES (?, 1, ?, ?)",
            (key, now, now),
        )
        return 1, yymmdd
    new_count = row["counter"] + 1
    conn.execute(
        "UPDATE lot_counters SET counter = ?, updated_at = ? WHERE key = ?",
        (new_count, now, key),
    )
    return new_count, yymmdd


def peek_counter(conn, prefix: str, code: Optional[str], iso_date: Optional[str]) -> tuple[int, str]:
    yymmdd = to_yymmdd(iso_date)
    key = counter_key(prefix, code, yymmdd)
    row = conn.execute("SELECT counter FROM lot_counters WHERE key = ?", (key,)).fetchone()
    return ((row["counter"] if row else 0) + 1, yymmdd)


def reset_counter(conn, prefix: str, code: Optional[str], iso_date: Optional[str], to: int) -> None:
    yymmdd = to_yymmdd(iso_date)
    key = counter_key(prefix, code, yymmdd)
    now = now_iso()
    row = conn.execute("SELECT counter FROM lot_counters WHERE key = ?", (key,)).fetchone()
    if row is None:
        conn.execute(
            "INSERT INTO lot_counters(key, counter, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (key, max(0, to - 1), now, now),
        )
    else:
        conn.execute(
            "UPDATE lot_counters SET counter = ?, updated_at = ? WHERE key = ?",
            (max(0, to - 1), now, key),
        )


def format_lot_id(prefix: str, code: Optional[str], yymmdd: str, seq: int) -> str:
    if code:
        return f"{prefix}-{code}-{yymmdd}-{seq:02d}"
    return f"{prefix}-{yymmdd}-{seq:02d}"


def allocate_lot_id(conn, prefix: str, code: Optional[str], iso_date: Optional[str]) -> str:
    seq, yymmdd = next_counter(conn, prefix, code, iso_date)
    return format_lot_id(prefix, code, yymmdd, seq)
