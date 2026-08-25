#!/usr/bin/env python3
"""
sync_sheet.py — Pulls the Google Sheet tabs down into data/*.csv.

    python scripts/sync_sheet.py

The document must be shared as "anyone with the link can view". The sheet id
and tab names come from data/config.json -> data_source. Each tab needs exactly
the same header row as the matching CSV in the repository.
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
            sys.exit(f"✘ Could not read the '{tab}' tab: {exc}\n"
                     f"  Check the sheet id and that link sharing is on.")
        if body.lstrip().startswith("<"):
            sys.exit(f"✘ The '{tab}' tab returned HTML instead of CSV — "
                     f"the sheet is most likely not shared.")
        (DATA / filename).write_text(body, encoding="utf-8")
        print(f"✔ {tab} → data/{filename} ({len(body.splitlines()) - 1} rows)")

    print("\nNow validate and build:  python scripts/build.py")


if __name__ == "__main__":
    main()
