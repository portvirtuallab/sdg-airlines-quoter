#!/usr/bin/env python3
"""
build_gas.py — Empaqueta docs/ en ficheros HTML autocontenidos dentro de gas/,
listos para subir a Google Apps Script con clasp.

Cada página queda con el CSS, el JS y las tarifas incrustados, porque Apps
Script no sirve ficheros estáticos. La fuente de verdad sigue siendo data/.

    python scripts/build.py && python scripts/build_gas.py
    cd gas && clasp push
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
GAS = ROOT / "gas"

PAGES = {"index.html": "Index.html", "quote.html": "Quote.html", "arrival.html": "Arrival.html"}


def inline(html, tariffs):
    # CSS
    def css_sub(m):
        return "<style>\n" + (DOCS / m.group(1)).read_text(encoding="utf-8") + "\n</style>"
    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css_sub, html)

    # JS local
    def js_sub(m):
        return "<script>\n" + (DOCS / m.group(1)).read_text(encoding="utf-8") + "\n</script>"
    html = re.sub(r'<script src="(assets/[^"]+)"></script>', js_sub, html)

    # Datos: se sustituye la carga por fetch por el bundle incrustado
    boot = ("<script>\nwindow.__SDG_TARIFFS__ = " + json.dumps(tariffs, ensure_ascii=False) + ";\n"
            "SDGData.load = function(){ var b = window.__SDG_TARIFFS__; b.source='local'; "
            "return Promise.resolve(b); };\n</script>")
    html = html.replace("</body>", boot.replace("</script>", "<\\/script>").replace("<\\/script>", "</script>") + "\n</body>")

    # Enlaces internos → parámetros de doGet
    for src, param in (("index.html", "?"), ("quote.html", "?page=quote"), ("arrival.html", "?page=arrival")):
        html = html.replace('href="' + src + '"', 'href="' + param + '" target="_top"')
    return html


def main():
    tariffs = json.loads((DOCS / "data" / "tariffs.json").read_text(encoding="utf-8"))
    GAS.mkdir(exist_ok=True)
    for src, dst in PAGES.items():
        html = (DOCS / src).read_text(encoding="utf-8")
        (GAS / dst).write_text(inline(html, tariffs), encoding="utf-8")
        print(f"✔ gas/{dst}  ({len((GAS / dst).read_text(encoding='utf-8')) / 1024:.0f} KB)")
    print("\nListo. Ahora: cd gas && clasp push && clasp deploy")


if __name__ == "__main__":
    main()
