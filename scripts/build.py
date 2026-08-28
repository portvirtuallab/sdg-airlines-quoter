#!/usr/bin/env python3
"""
build.py - Compiles data/ into docs/data/tariffs.json, the only file the site reads.

    python scripts/build.py            # build
    python scripts/build.py --check    # validate only, write nothing

Checks the network as well as the tariffs: rotations that do not close to a whole
number of days, day names that are misspelled, airports with no flights, stations
that are active but have no tariff, and rate bands that do not decrease.
"""
import csv, json, re, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "docs" / "data" / "tariffs.json"

errors, warnings = [], []
DAYS = {"monday","tuesday","wednesday","thursday","friday","saturday","sunday"}


def read(rel):
    p = DATA / rel
    if not p.exists():
        errors.append(f"Missing file {rel}")
        return []
    with p.open(newline="", encoding="utf-8-sig") as f:
        return [dict(r) for r in csv.DictReader(f)]


SIGNED = {"lat", "lon", "utc_offset"}


def num(row, key, where, default=0.0, required=False):
    raw = (row.get(key) or "").strip().replace(",", ".")
    if raw == "":
        if required:
            warnings.append(f"{where}: '{key}' is blank, using {default}")
        return default
    try:
        v = float(raw)
    except ValueError:
        errors.append(f"{where}: '{key}' is not a number ({raw!r})")
        return default
    if v < 0 and key not in SIGNED:
        errors.append(f"{where}: '{key}' is negative ({v})")
    return v


def build():
    config = json.loads((DATA / "config.json").read_text(encoding="utf-8"))

    # -- Airports -------------------------------------------------
    airports = {}
    for r in read("network/airports.csv"):
        code = (r.get("code") or "").strip().upper()
        where = f"airports[{code or '?'}]"
        if not re.fullmatch(r"[A-Z]{3}", code):
            errors.append(f"{where}: invalid IATA code, must be three letters")
            continue
        if code in airports:
            errors.append(f"{where}: duplicate code")
            continue
        airports[code] = {
            "code": code, "icao": (r.get("icao") or "").strip(),
            "name": (r.get("name") or code).strip(),
            "city": (r.get("city") or "").strip(),
            "country": (r.get("country") or "").strip(),
            "lat": num(r, "lat", where), "lon": num(r, "lon", where),
            "utcOffset": num(r, "utc_offset", where),
            "schengen": (r.get("schengen") or "no").strip().lower() == "yes",
            "afcfta": (r.get("afcfta") or "no").strip().lower() == "yes",
            "authority": (r.get("authority") or "").strip(),
            "active": (r.get("active") or "yes").strip().lower() in ("yes", "true", "1"),
        }
    active = {c for c, a in airports.items() if a["active"]}

    # -- Network: services, legs, rotations ------------------------
    services = {s["service"]: s for s in read("network/services.csv")}
    legs = read("network/legs.csv")
    for l in legs:
        where = f"legs[{l.get('service')} {l.get('seq')}]"
        if l["service"] not in services:
            errors.append(f"{where}: unknown service")
        for end in ("origin", "destination"):
            if l[end].strip().upper() not in airports:
                errors.append(f"{where}: unknown airport {l[end]!r} in {end}")
        day = (l.get("base_day") or "").strip()
        if day and day.lower() not in DAYS:
            errors.append(f"{where}: {day!r} is not a day of the week")

    by_service = {}
    for l in legs:
        by_service.setdefault(l["service"], []).append(l)
    for s, L in by_service.items():
        L.sort(key=lambda x: int(x["seq"]))
        if L[0]["origin"] != L[-1]["destination"]:
            errors.append(f"service {s}: the loop does not return to {L[0]['origin']}")

    rotations = read("network/rotations.csv")
    flown = set()
    for r in rotations:
        who = r.get("aircraft", "?")
        chain = [s.strip() for s in (r.get("services") or "").split("|") if s.strip()]
        if not chain:
            errors.append(f"rotation {who}: no services assigned")
            continue
        total = 0
        for s in chain:
            if s not in by_service:
                errors.append(f"rotation {who}: unknown service {s!r}")
                continue
            for l in by_service[s]:
                total += float(l["flight_seconds"]) + float(l["ground_seconds"])
                flown.add(l["origin"]); flown.add(l["destination"])
        cycle = num(r, "cycle_days", f"rotation {who}", required=True) * 86400
        drift = total - cycle
        if abs(drift) > 120:
            errors.append(f"rotation {who}: circuit lasts {total/86400:.3f} days but is "
                          f"declared as {cycle/86400:.0f} - it would drift {drift/3600:+.2f} h "
                          f"every cycle")
        try:
            datetime.fromisoformat((r.get("seed_utc") or "").replace("Z", "+00:00"))
        except ValueError:
            errors.append(f"rotation {who}: seed_utc is not a valid timestamp")

    for c in sorted(active - flown):
        warnings.append(f"{c}: active but no rotation calls there")

    # -- Ground charges -------------------------------------------
    charge_keys = ["sec_min","sec_rate","cus_min","cus_rate",
        "truck_bulk_min","truck_bulk_fee_mawb","truck_bulk_rate","truck_uld_min","truck_uld_fee",
        "thc_gen_min","thc_gen_rate","thc_dg_min","thc_dg_rate","thc_pha_min","thc_pha_rate",
        "st_gen_mawb_fee","st_gen_rate_1_20","st_gen_rate_21plus","st_gen_free_days",
        "st_cool_mawb_fee","st_cool_rate_1_20","st_cool_rate_21plus","st_cool_free_days",
        "st_dg_mawb_fee","st_dg_rate_1_20","st_dg_rate_21plus","st_dg_free_days",
        "imp_doc_min","imp_doc_fee"]
    charges = {}
    for r in read("tariffs/ground_charges.csv"):
        code = (r.get("code") or "").strip().upper()
        where = f"ground_charges[{code or '?'}]"
        if code not in airports:
            errors.append(f"{where}: no such airport")
            continue
        rec = {"currency": (r.get("currency") or config["base_currency"]).strip().upper()}
        for k in charge_keys:
            rec[k] = num(r, k, where)
        charges[code] = rec
    for c in sorted(active - set(charges)):
        errors.append(f"{c} is active but has no row in tariffs/ground_charges.csv")

    # -- Freight rates --------------------------------------------
    routes = {}
    for r in read("tariffs/freight_rates.csv"):
        o = (r.get("origin") or "").strip().upper()
        d = (r.get("destination") or "").strip().upper()
        where = f"freight_rates[{o}->{d}]"
        if d not in airports or (o != "*" and o not in airports):
            errors.append(f"{where}: unknown airport")
            continue
        if o == d:
            errors.append(f"{where}: origin and destination are the same")
            continue
        rec = {"min": num(r, "minimum", where), "r0": num(r, "rate_under_100", where),
               "r100": num(r, "rate_100_299", where), "r300": num(r, "rate_300_499", where),
               "r500": num(r, "rate_500_plus", where)}
        if not (rec["r0"] >= rec["r100"] >= rec["r300"] >= rec["r500"]):
            warnings.append(f"{where}: rate bands do not decrease")
        band = [rec["min"], rec["r0"], rec["r100"], rec["r300"], rec["r500"]]
        if len(set(band)) == 1:
            warnings.append(f"{where}: minimum and all four rate bands are {band[0]} - "
                            f"this is what a filled-down cell looks like, not a tariff")
        routes.setdefault(o, {})[d] = rec

    # -- Distances, customs, surcharges ---------------------------
    distances = {}
    for r in read("network/distances.csv"):
        o, d = r["origin"].upper(), r["destination"].upper()
        if o in airports and d in airports:
            distances.setdefault(o, {})[d] = num(r, "km", f"distances[{o}-{d}]")

    customs = {}
    for r in read("network/customs_regime.csv"):
        o, d = r["origin"].upper(), r["destination"].upper()
        if o in airports and d in airports:
            customs.setdefault(o, {})[d] = (r.get("regime") or "").strip().upper()

    surcharges = []
    for r in read("tariffs/surcharges.csv"):
        where = f"surcharges[{r.get('code')}]"
        basis = (r.get("basis") or "").strip()
        if basis not in ("flat", "per_kg", "per_km", "percent_freight"):
            errors.append(f"{where}: basis {basis!r} is not one of flat, per_kg, per_km, percent_freight")
        surcharges.append({
            "code": (r.get("code") or "").strip(), "label": (r.get("label") or "").strip(),
            "basis": basis, "amount": num(r, "amount", where),
            "minimum": num(r, "minimum", where),
            "applies": (r.get("applies") or "always").strip(),
            "note": (r.get("note") or "").strip(),
        })

    # -- Incoterms: who bears each charge --------------------------
    # One row per charge, one column per Incoterm. Kept as data so the
    # allocation can be argued over and corrected without touching code.
    ic_ids = [i["id"] for i in (config.get("incoterms", {}).get("list") or [])]
    incoterms = []
    ic_seen = set()
    for r in read("incoterms.csv"):
        code = (r.get("code") or "").strip()
        where = f"incoterms[{code or '?'}]"
        if not code:
            errors.append(f"{where}: missing charge code")
            continue
        if code in ic_seen:
            errors.append(f"{where}: duplicate charge code")
            continue
        ic_seen.add(code)
        stage = (r.get("stage") or "").strip()
        if stage not in ("origin", "arrival", "info_origin", "info_arrival"):
            errors.append(f"{where}: stage {stage!r} is not origin, arrival, "
                          f"info_origin or info_arrival")
        parties = {}
        for i in ic_ids:
            p = (r.get(i) or "").strip().lower()
            if p not in ("seller", "buyer", "none"):
                errors.append(f"{where}: {i} is {p!r}, must be seller, buyer or none")
            parties[i] = p
        incoterms.append({
            "code": code, "label": (r.get("label") or code).strip(),
            "stage": stage, "parties": parties,
        })

    for i in ic_ids:
        if i not in (set().union(*[set(x["parties"]) for x in incoterms]) if incoterms else set()):
            errors.append(f"incoterms.csv has no column for Incoterm {i}")

    # Every charge the engine can emit must have a row, or a quotation would
    # show a line nobody is said to pay.
    #
    # This list is a hand-kept copy of the codes engine.js pushes, so it has to
    # be edited alongside it. Retiring ULD handling and forgetting to drop "LU"
    # from here failed the build until the two agreed again — which is the
    # check working, but the coupling is worth knowing about.
    emitted = {"WT", "AW", "TH", "SD", "CH", "DB", "LB", "TD", "ST", "DGO", "DGD"}
    emitted |= {s["code"] for s in surcharges if s["code"]}
    for c in sorted(emitted - ic_seen):
        errors.append(f"charge {c} is quoted by the engine but has no row in incoterms.csv")

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "config": config,
        "incoterms": incoterms,
        "airports": [airports[c] for c in sorted(airports)],
        "network": {
            "services": list(services.values()),
            "legs": legs,
            "rotations": rotations,
        },
        "arrival_charges": charges,
        "routes": routes,
        "distances": distances,
        "customs": customs,
        "surcharges": surcharges,
    }


def main():
    bundle = build()
    for w in warnings: print(f"  warning  {w}")
    for e in errors:   print(f"  ERROR    {e}")
    if errors:
        print(f"\n{len(errors)} error(s). Nothing was written.")
        sys.exit(1)

    n_active = sum(1 for a in bundle["airports"] if a["active"])
    lanes = sum(len(v) for v in bundle["routes"].values())
    print(f"\n{n_active} active stations - {len(bundle['network']['rotations'])} rotations - "
          f"{len(bundle['network']['legs'])} legs - {lanes} freight lanes - "
          f"{len(bundle['surcharges'])} surcharges")

    if "--check" in sys.argv:
        print("  (--check: tariffs.json was not written)")
        return
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    main()
