"""Dashboard summary — counts + readiness rollups for the home view."""
from __future__ import annotations

from fastapi import APIRouter

from db import db

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary")
def summary() -> dict:
    """Counts of active lots by kind/state, plus readiness rollups."""
    with db() as conn:
        # registries
        gc_total = conn.execute(
            "SELECT COUNT(*) AS c FROM genetic_codes WHERE deleted_at IS NULL"
        ).fetchone()["c"]

        # ingest
        ingest_total = conn.execute(
            "SELECT COUNT(*) AS c FROM ingest_records WHERE deleted_at IS NULL "
            "AND lifecycle_status = 'active'"
        ).fetchone()["c"]

        # agar
        agar_active = conn.execute(
            "SELECT COUNT(*) AS c FROM agar_plates WHERE deleted_at IS NULL "
            "AND lifecycle_status = 'active' AND remaining > 0"
        ).fetchone()["c"]
        agar_exhausted = conn.execute(
            "SELECT COUNT(*) AS c FROM agar_plates WHERE deleted_at IS NULL "
            "AND lifecycle_status = 'active' AND remaining = 0"
        ).fetchone()["c"]
        agar_contam = conn.execute(
            "SELECT COUNT(*) AS c FROM agar_plates WHERE lifecycle_status = 'contaminated' "
            "AND deleted_at IS NULL"
        ).fetchone()["c"]

        # LC
        lc_active = conn.execute(
            "SELECT COUNT(*) AS c, COALESCE(SUM(remaining_ml), 0) AS ml FROM liquid_cultures "
            "WHERE deleted_at IS NULL AND lifecycle_status = 'active' AND remaining_ml > 0"
        ).fetchone()
        lc_contam = conn.execute(
            "SELECT COUNT(*) AS c FROM liquid_cultures WHERE lifecycle_status = 'contaminated' "
            "AND deleted_at IS NULL"
        ).fetchone()["c"]

        # grain — sterile vs inoculated
        grain_sterile = conn.execute(
            "SELECT COUNT(*) AS c FROM grain_lots WHERE deleted_at IS NULL "
            "AND phase = 'sterile' AND lifecycle_status = 'active'"
        ).fetchone()["c"]
        grain_inoc = conn.execute(
            "SELECT COUNT(*) AS c FROM grain_lots WHERE deleted_at IS NULL "
            "AND phase = 'inoculated' AND lifecycle_status = 'active' AND remaining > 0"
        ).fetchone()["c"]
        grain_contam = conn.execute(
            "SELECT COUNT(*) AS c FROM grain_lots WHERE lifecycle_status = 'contaminated' "
            "AND deleted_at IS NULL"
        ).fetchone()["c"]

        # batches
        batch_colonizing = conn.execute(
            "SELECT COUNT(*) AS c FROM batches WHERE deleted_at IS NULL "
            "AND lifecycle_status = 'active' AND colonization_state = 'colonizing'"
        ).fetchone()["c"]
        batch_fruiting = conn.execute(
            "SELECT COUNT(*) AS c FROM batches WHERE deleted_at IS NULL "
            "AND lifecycle_status = 'active' AND colonization_state IN ('colonized','fruiting')"
        ).fetchone()["c"]

        # harvests
        harvest_wet = conn.execute(
            "SELECT COUNT(*) AS c, COALESCE(SUM(wet_weight),0) AS w FROM harvest_lots "
            "WHERE deleted_at IS NULL AND state = 'wet'"
        ).fetchone()
        harvest_dried = conn.execute(
            "SELECT COUNT(*) AS c, COALESCE(SUM(dry_weight),0) AS w FROM harvest_lots "
            "WHERE deleted_at IS NULL AND state = 'dried'"
        ).fetchone()

        # contamination
        active_flags = conn.execute(
            "SELECT COUNT(*) AS c FROM contamination_flags WHERE active = 1"
        ).fetchone()["c"]

    return {
        "genetics": {"total": gc_total},
        "ingest": {"active": ingest_total},
        "agar": {
            "active": agar_active,
            "exhausted": agar_exhausted,
            "contaminated": agar_contam,
        },
        "lc": {
            "active": lc_active["c"],
            "remaining_ml": float(lc_active["ml"]),
            "contaminated": lc_contam,
        },
        "grain": {
            "sterile": grain_sterile,
            "inoculated": grain_inoc,
            "contaminated": grain_contam,
        },
        "batches": {
            "colonizing": batch_colonizing,
            "fruiting": batch_fruiting,
        },
        "harvests": {
            "wet": {"count": harvest_wet["c"], "total_g": float(harvest_wet["w"])},
            "dried": {"count": harvest_dried["c"], "total_g": float(harvest_dried["w"])},
        },
        "contamination": {"active_flags": active_flags},
    }
