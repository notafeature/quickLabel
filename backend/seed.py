"""Default seed data for registries — runs once on init."""
from __future__ import annotations

from db import db, now_iso

DEFAULT_GRAIN_TYPES = [
    ("RYE",  "Rye berries"),
    ("OAT",  "Oat grain"),
    ("WBS",  "Wild bird seed"),
    ("MILT", "Millet"),
    ("WHT",  "Wheat berries"),
    ("BRR",  "Brown rice"),
]

DEFAULT_AGAR_FORMULAS = [
    ("MEA",  "Malt extract agar"),
    ("PDYA", "Potato dextrose yeast agar"),
    ("MYPA", "Malt yeast peptone agar"),
    ("DFA",  "Dog food agar"),
    ("HWA",  "Hardwood agar"),
]

DEFAULT_SUBSTRATE_COMPONENTS = [
    ("COIR",   "Coco coir"),
    ("VERM",   "Vermiculite"),
    ("HPOO",   "Horticultural perlite"),
    ("GYPSUM", "Gypsum"),
    ("BRAN",   "Wheat bran"),
    ("HWS",    "Hardwood sawdust"),
    ("STR",    "Straw"),
    ("LIME",   "Hydrated lime"),
]

DEFAULT_INGEST_TYPES = [
    # (code, label, derivative_kind)
    ("SP", "Spore print",            None),
    ("SS", "Spore syringe",          None),
    ("LC", "Liquid culture",         "lc"),
    ("GT", "Genetic tissue",         None),
    ("AP", "Agar plate",             "agar"),
    ("SN", "Slant",                  None),
    ("CT", "Castellani tube",        None),
]


def seed_registries() -> None:
    now = now_iso()
    with db() as conn:
        for code, desc in DEFAULT_GRAIN_TYPES:
            conn.execute(
                "INSERT OR IGNORE INTO grain_types(code, description, created_at, updated_at) "
                "VALUES (?, ?, ?, ?)",
                (code, desc, now, now),
            )
        for code, desc in DEFAULT_AGAR_FORMULAS:
            conn.execute(
                "INSERT OR IGNORE INTO agar_formulas(code, description, created_at, updated_at) "
                "VALUES (?, ?, ?, ?)",
                (code, desc, now, now),
            )
        for code, desc in DEFAULT_SUBSTRATE_COMPONENTS:
            conn.execute(
                "INSERT OR IGNORE INTO substrate_components(code, description, created_at, updated_at) "
                "VALUES (?, ?, ?, ?)",
                (code, desc, now, now),
            )
        for code, label, deriv in DEFAULT_INGEST_TYPES:
            conn.execute(
                "INSERT OR IGNORE INTO ingest_types(code, label, derivative_kind, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (code, label, deriv, now, now),
            )
        # default settings
        for key, value in [
            ("lab_prefix", '"SL"'),
            ("operator_tracking_enabled", "false"),
            ("default_colonization_window_days", "14"),
        ]:
            conn.execute(
                "INSERT OR IGNORE INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)",
                (key, value, now),
            )
