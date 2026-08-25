#!/usr/bin/env python3
"""
sync_sheet.py — Descarga las pestañas del Google Sheet a data/*.csv.

    python scripts/sync_sheet.py

Requisito: el documento debe estar compartido como "cualquier persona con el
enlace puede ver". El id y los nombres de pestaña salen de data/config.json
→ data_source. Las pestañas deben tener exactamente las mismas cabeceras que
los CSV del repo.
"""
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

TARGETS = {
    "airports": "airports.csv",
    "arrival_charges": "arrival_charges.csv",
    "routes": "routes.csv",
}


def main():
    cfg = json.loads((DATA / "config.json").read_text(encoding="utf-8"))
    ds = cfg["data_source"]
    sheet_id, tabs = ds["sheet_id"], ds["sheets"]

    for key, filename in TARGETS.items():
        tab = tabs.get(key, key)
        url = ("https://docs.google.com/spreadsheets/d/" + sheet_id +
               "/gviz/tq?tqx=out:csv&sheet=" + urllib.parse.quote(tab))
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                body = r.read().decode("utf-8")
        except Exception as exc:  # noqa: BLE001
            sys.exit(f"✘ No se pudo leer la pestaña '{tab}': {exc}\n"
                     f"  Comprueba el id de la hoja y que esté compartida con el enlace.")
        if body.lstrip().startswith("<"):
            sys.exit(f"✘ La pestaña '{tab}' devolvió HTML en lugar de CSV — "
                     f"lo normal es que la hoja no sea pública.")
        (DATA / filename).write_text(body, encoding="utf-8")
        print(f"✔ {tab} → data/{filename} ({len(body.splitlines()) - 1} filas)")

    print("\nAhora valida y compila:  python scripts/build.py")


if __name__ == "__main__":
    main()
