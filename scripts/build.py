#!/usr/bin/env python3
"""
build.py — Compila data/*.csv + data/config.json en docs/data/tariffs.json,
que es lo único que consume la web.

    python scripts/build.py            # compila
    python scripts/build.py --check    # solo valida, no escribe (para CI)

Validaciones: códigos IATA duplicados, aeropuertos sin tarifa de llegada,
tarifas de aeropuertos inexistentes, rutas huérfanas, números negativos,
tramos de peso incoherentes y días libres de almacenaje fuera de rango.
"""
import csv
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "docs" / "data" / "tariffs.json"

errors: list[str] = []
warnings: list[str] = []


def read_csv(name):
    path = DATA / name
    if not path.exists():
        errors.append(f"Falta el fichero {name}")
        return []
    with path.open(newline="", encoding="utf-8-sig") as f:
        return [dict(r) for r in csv.DictReader(f)]


def num(row, key, where, required=True, default=0.0):
    raw = (row.get(key) or "").strip().replace(",", ".")
    if raw == "":
        if required:
            warnings.append(f"{where}: '{key}' vacío → se usa {default}")
        return default
    try:
        v = float(raw)
    except ValueError:
        errors.append(f"{where}: '{key}' no es un número ({raw!r})")
        return default
    if v < 0:
        errors.append(f"{where}: '{key}' es negativo ({v})")
    return v


def build():
    config = json.loads((DATA / "config.json").read_text(encoding="utf-8"))

    # ── Aeropuertos ───────────────────────────────────────────
    airports = {}
    for row in read_csv("airports.csv"):
        code = (row.get("code") or "").strip().upper()
        where = f"airports.csv[{code or '?'}]"
        if not re.fullmatch(r"[A-Z]{3}", code):
            errors.append(f"{where}: código IATA inválido, deben ser 3 letras")
            continue
        if code in airports:
            errors.append(f"{where}: código duplicado")
            continue
        airports[code] = {
            "code": code,
            "name": (row.get("name") or code).strip(),
            "country": (row.get("country") or "").strip(),
            "region": (row.get("region") or "").strip(),
            "active": (row.get("active") or "yes").strip().lower() in ("yes", "si", "sí", "true", "1"),
        }

    # ── Tarifas de llegada ────────────────────────────────────
    charge_keys = [
        "sec_min", "sec_rate", "cus_min", "cus_rate",
        "truck_bulk_min", "truck_bulk_fee_mawb", "truck_bulk_rate",
        "truck_uld_min", "truck_uld_fee",
        "thc_gen_min", "thc_gen_rate", "thc_dg_min", "thc_dg_rate",
        "thc_pha_min", "thc_pha_rate",
        "st_gen_mawb_fee", "st_gen_rate_1_20", "st_gen_rate_21plus", "st_gen_free_days",
        "st_cool_mawb_fee", "st_cool_rate_1_20", "st_cool_rate_21plus", "st_cool_free_days",
        "st_dg_mawb_fee", "st_dg_rate_1_20", "st_dg_rate_21plus", "st_dg_free_days",
        "imp_doc_min", "imp_doc_fee",
    ]
    charges = {}
    for row in read_csv("arrival_charges.csv"):
        code = (row.get("code") or "").strip().upper()
        where = f"arrival_charges.csv[{code or '?'}]"
        if code not in airports:
            errors.append(f"{where}: no existe ese aeropuerto en airports.csv")
            continue
        if code in charges:
            errors.append(f"{where}: tarifa duplicada")
            continue
        rec = {"currency": (row.get("currency") or config["base_currency"]).strip().upper()}
        for k in charge_keys:
            rec[k] = num(row, k, where, required=False)
        for fam in ("gen", "cool", "dg"):
            if rec[f"st_{fam}_free_days"] > 30:
                warnings.append(f"{where}: st_{fam}_free_days = {rec[f'st_{fam}_free_days']} días, ¿seguro?")
        charges[code] = rec

    for code in airports:
        if airports[code]["active"] and code not in charges:
            errors.append(f"{code} está activo en airports.csv pero no tiene fila en arrival_charges.csv")

    # ── Rutas ─────────────────────────────────────────────────
    routes = {}
    for row in read_csv("routes.csv"):
        o = (row.get("origin") or "").strip().upper()
        d = (row.get("destination") or "").strip().upper()
        where = f"routes.csv[{o}→{d}]"
        if d not in airports:
            errors.append(f"{where}: destino desconocido")
            continue
        if o != "*" and o not in airports:
            errors.append(f"{where}: origen desconocido")
            continue
        if o == d:
            errors.append(f"{where}: origen y destino iguales")
            continue
        rec = {
            "min": num(row, "min_charge", where),
            "r0": num(row, "rate_under_100", where),
            "r100": num(row, "rate_100_299", where),
            "r300": num(row, "rate_300_499", where),
            "r500": num(row, "rate_500_plus", where),
            "fsc": num(row, "fsc_per_kg", where, required=False),
            "ssc": num(row, "ssc_per_kg", where, required=False),
            "transit": num(row, "transit_days", where, required=False),
            "notes": (row.get("notes") or "").strip(),
        }
        if not (rec["r0"] >= rec["r100"] >= rec["r300"] >= rec["r500"]):
            warnings.append(f"{where}: los tramos no son decrecientes (r0 {rec['r0']} / 100 {rec['r100']} / 300 {rec['r300']} / 500 {rec['r500']})")
        routes.setdefault(o, {})[d] = rec

    for code, ap in airports.items():
        if ap["active"] and code not in routes.get("*", {}) and not any(code in v for v in routes.values()):
            warnings.append(f"{code}: activo pero sin ninguna tarifa de flete en routes.csv")

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "config": config,
        "airports": [airports[c] for c in sorted(airports)],
        "arrival_charges": charges,
        "routes": routes,
    }


def main():
    check_only = "--check" in sys.argv
    bundle = build()

    for w in warnings:
        print(f"  aviso   {w}")
    for e in errors:
        print(f"  ERROR   {e}")

    if errors:
        print(f"\n✘ {len(errors)} error(es). No se genera nada.")
        sys.exit(1)

    active = sum(1 for a in bundle["airports"] if a["active"])
    lanes = sum(len(v) for v in bundle["routes"].values())
    print(f"\n✔ {active} aeropuertos activos · {len(bundle['arrival_charges'])} tablas de llegada · {lanes} tarifas de flete")

    if check_only:
        print("  (--check: no se ha escrito tariffs.json)")
        return

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(bundle, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"✔ escrito {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
