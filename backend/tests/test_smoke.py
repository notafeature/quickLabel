#!/usr/bin/env python3
"""End-to-end smoke test of the QuickLabel cultivation API.

Walks the chain: Genetic → Ingest → Agar → Draw wedge → LC → Draw syringe →
Sterilize grain × 3 → Inoculate grain × 3 → Recipe → SpawnToBulk → Harvest × 2 → Dry.
Then exercises BreakAndShake, ContaminationFlag/Lift, ConsumePartial, lineage walks.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

API = os.environ.get("API_URL", "http://localhost:8001/api")


def call(method: str, path: str, body: dict | None = None) -> dict:
    url = f"{API}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"{method} {path} -> {e.code}: {e.read().decode()}", file=sys.stderr)
        raise


def must(cond: bool, msg: str) -> None:
    if not cond:
        print(f"FAIL: {msg}", file=sys.stderr)
        sys.exit(1)
    print(f"  ✓ {msg}")


def main() -> None:
    print("== health ==")
    h = call("GET", "/health")
    must(h["status"] == "ok", "health ok")

    print("== registries ==")
    gt = call("GET", "/registries/grain-types")
    must(any(r["code"] == "RYE" for r in gt), "RYE grain type seeded")
    it = call("GET", "/registries/ingest-types")
    must(any(r["code"] == "SP" for r in it), "SP ingest type seeded")

    print("== create genetic ==")
    g = call("POST", "/genetics", {"code": "SL192", "genus": "Psilocybe",
                                   "species": "cubensis", "cultivar": "Enigma"})
    gid = g["id"]
    must(g["code"] == "SL192", f"genetic created: {gid}")

    print("== ingest a spore print ==")
    ing = call("POST", "/ingest", {
        "genetic_code_id": gid, "ingest_type": "SP",
        "external_source": "Vendor: FungusHead",
        "received_date": "2026-05-18",
        "lineage": {"f": 0, "t": 0},
    })
    iid = ing["ingest"]["id"]
    must(ing["ingest"]["lot_id"].startswith("SP-SL192-"), f"ingest lot: {ing['ingest']['lot_id']}")
    must(ing["derivative_lot_id"] is None, "no derivative for SP")

    print("== ingest a received agar plate (auto-derivative) ==")
    ap = call("POST", "/ingest", {
        "genetic_code_id": gid, "ingest_type": "AP",
        "external_source": "Trade: Bob",
        "received_date": "2026-05-18",
        "lineage": {"f": 1, "t": 0},
        "plate_size": "100mm", "agar_formula": "MEA",
    })
    must(ap["derivative_lot_id"] is not None, "AP auto-creates derivative agar plate")

    print("== plate agar from ingest ==")
    pa = call("POST", "/agar/plate", {
        "genetic_code_id": gid,
        "source": {"lot_kind": "ingest", "lot_id": iid, "amount": 1.0, "amount_unit": "fraction"},
        "lineage": {"f": 0, "t": 0},
        "agar_formula": "MEA", "plate_size": "100mm",
    })
    aid = pa["agar"]["id"]
    must(pa["agar"]["lot_id"].startswith("AL-SL192-"), f"agar plate: {pa['agar']['lot_id']}")
    must(pa["agar"]["remaining"] == 1.0, "new plate fully intact")

    print("== draw 1/4 wedge ==")
    dw = call("POST", "/agar/draw", {"parent_agar_id": aid, "fraction": 0.25, "plate_size": "100mm"})
    wedge_id = dw["agar"]["id"]
    must(dw["agar"]["parent_lot_id"] == aid, "wedge has parent pointer")
    parent_after = call("GET", f"/agar/{aid}")
    must(abs(parent_after["remaining"] - 0.75) < 1e-9,
         f"parent agar decremented to {parent_after['remaining']}")

    print("== plate LC (1 gallon) from agar ==")
    lc = call("POST", "/lc/plate", {
        "genetic_code_id": gid,
        "source": {"lot_kind": "agar", "lot_id": aid, "amount": 0.25, "amount_unit": "fraction"},
        "vessel_type": "GAL", "initial_volume_ml": 3785,
        "lineage": {"f": 0, "t": 1},
    })
    gallon_id = lc["lc"]["id"]
    must(lc["lc"]["remaining_ml"] == 3785, "gallon LC initial volume")

    print("== draw 10mL syringe from gallon ==")
    syr = call("POST", "/lc/draw", {"parent_lc_id": gallon_id, "amount_ml": 10, "vessel_type": "10mL"})
    syringe_id = syr["lc"]["id"]
    must(syr["lc"]["remaining_ml"] == 10, "syringe has 10mL")
    gallon_after = call("GET", f"/lc/{gallon_id}")
    must(gallon_after["remaining_ml"] == 3775, f"gallon decremented to {gallon_after['remaining_ml']}")

    print("== sterilize 3 grain bags ==")
    sg = call("POST", "/grain/sterilize", {"grain_type": "RYE", "prep_size": "1.2 lb", "count": 3})
    must(sg["count"] == 3, "3 sterile bags")
    sterile_ids = [item["grain"]["id"] for item in sg["items"]]

    print("== inoculate all 3 from the syringe ==")
    inoc_ids = []
    for i, sid in enumerate(sterile_ids):
        r = call("POST", "/grain/inoculate", {
            "grain_lot_id": sid,
            "source": {"lot_kind": "lc", "lot_id": syringe_id, "amount": 2, "amount_unit": "ml"},
            "genetic_code_id": gid,
            "lineage": {"f": 0, "t": 2},
        })
        must(r["grain"]["phase"] == "inoculated", f"bag {i+1} inoculated")
        inoc_ids.append(r["grain"]["id"])
    syr_after = call("GET", f"/lc/{syringe_id}")
    must(abs(syr_after["remaining_ml"] - 4.0) < 1e-9, f"syringe decremented to {syr_after['remaining_ml']}mL")

    print("== break and shake ==")
    bs = call("POST", "/events/break-and-shake", {"grain_lot_id": inoc_ids[0],
                                                   "notes": "70% coverage"})
    must("event_id" in bs, "break-and-shake recorded")

    print("== recipe ==")
    rec = call("POST", "/recipes", {
        "code": "CVG-STD", "name": "Coir-Verm-Gypsum standard",
        "components": [
            {"component_code": "COIR", "proportion": 0.5, "unit": "vol"},
            {"component_code": "VERM", "proportion": 0.45, "unit": "vol"},
            {"component_code": "GYPSUM", "proportion": 0.05, "unit": "vol"},
        ],
        "hydration_target": "field capacity",
        "prep_method": "pasteurized",
    })
    rid = rec["id"]
    must(rec["code"] == "CVG-STD", "recipe created")

    print("== spawn to bulk ==")
    batch = call("POST", "/batches/spawn-to-bulk", {
        "grain_inputs": [{"grain_lot_id": gid_, "fraction": 1.0} for gid_ in inoc_ids],
        "recipe_id": rid,
        "bulk_mass": 30, "bulk_mass_unit": "lb",
        "container_count": 6, "location": "Fruit Room A",
    })
    batch_id = batch["batch"]["id"]
    must(batch["batch"]["lot_id"].startswith("BL-SL192-"), f"batch: {batch['batch']['lot_id']}")

    print("== first flush + dry ==")
    h1 = call("POST", "/harvests/harvest", {"batch_id": batch_id, "wet_weight": 800,
                                            "wet_weight_unit": "g"})
    must(h1["harvest"]["flush_number"] == 1, "flush 1")
    d1 = call("POST", "/harvests/dry", {"harvest_lot_id": h1["harvest"]["id"],
                                         "dry_weight": 76, "dry_weight_unit": "g"})
    must(d1["harvest"]["state"] == "dried", "harvest dried")

    print("== second flush ==")
    h2 = call("POST", "/harvests/harvest", {"batch_id": batch_id, "wet_weight": 550,
                                            "wet_weight_unit": "g"})
    must(h2["harvest"]["flush_number"] == 2, "flush 2 numbering correct")

    print("== contamination flag + lift ==")
    cf = call("POST", "/events/contamination-flag", {
        "lot_kind": "grain", "lot_id": inoc_ids[1],
        "severity": "confirmed", "quarantine": True,
        "suspected_contaminant": "trichoderma",
    })
    flag_id = cf["flag_id"]
    afterflag = call("GET", f"/grain/{inoc_ids[1]}")
    must(afterflag["lifecycle_status"] == "contaminated", "lot marked contaminated")
    cl = call("POST", "/events/contamination-lift", {"flag_id": flag_id, "reason": "false alarm"})
    must("event_id" in cl, "lift recorded")
    afterlift = call("GET", f"/grain/{inoc_ids[1]}")
    must(afterlift["lifecycle_status"] == "active", "lot back to active after lift")

    print("== consume partial (waste) ==")
    cp = call("POST", "/events/consume-partial", {
        "lot_kind": "lc", "lot_id": gallon_id, "amount": 200, "amount_unit": "ml",
        "reason": "waste",
    })
    must("event_id" in cp, "consume-partial event recorded")
    g2 = call("GET", f"/lc/{gallon_id}")
    must(g2["remaining_ml"] == 3575, f"gallon down to {g2['remaining_ml']}mL after waste")

    print("== lineage walk: dried harvest → genetic ==")
    walk = call("GET", f"/lineage/harvest/{h1['harvest']['id']}/backward")
    must(walk["genetic"]["code"] == "SL192", "harvest backward walks to SL192")
    must(walk["create_event"]["event_type"] == "Harvest", "creation event is Harvest")
    must(len(walk["sources"]) == 1, "harvest has 1 source (batch)")
    batch_node = walk["sources"][0]
    must(batch_node["lot_kind"] == "batch", "source is batch")
    must(len(batch_node["sources"]) == 3, "batch has 3 grain sources")

    print("== forward walk from genetic? use ingest → all derivatives ==")
    fw = call("GET", f"/lineage/agar/{aid}/forward")
    must(any(c["lot_kind"] == "lc" for c in fw["children"]), "agar walked forward finds LC")

    print("== resolve human lot ID ==")
    rs = call("GET", f"/lineage/by-lot-id/{batch['batch']['lot_id']}")
    must(rs["lot_kind"] == "batch", f"resolved {rs['lot_id']} → batch")

    print("== events stream filtered by genetic via lot ==")
    evs = call("GET", f"/events?lot_kind=grain&lot_id={inoc_ids[0]}")
    types = [e["event_type"] for e in evs]
    must("InoculateGrain" in types, "inoculate event visible")
    must("BreakAndShake" in types, "break-and-shake event visible")
    must("SpawnToBulk" in types, "grain lot appears in spawn-to-bulk source")

    print("\n== ALL SMOKE TESTS PASSED ==")


if __name__ == "__main__":
    main()
