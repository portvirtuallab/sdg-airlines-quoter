/* ══════════════════════════════════════════════════════════════
   SDG Airlines — carga de datos
   Dos modos, misma forma de salida:
     local  → docs/data/tariffs.json (generado por scripts/build.py)
     sheet  → lee el Google Sheet en vivo vía gviz CSV
   El modo se fija en data/config.json → data_source.mode, y se puede
   forzar en la URL con ?source=sheet o ?source=local.
   ══════════════════════════════════════════════════════════════ */
(function (root) {
  "use strict";

  var JSON_URL = "data/tariffs.json";

  function parseCSV(text) {
    var rows = [], row = [], field = "", inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c !== "\r") field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return [];
    var head = rows.shift().map(function (h) { return h.trim(); });
    return rows.filter(function (r) { return r.some(function (v) { return v.trim() !== ""; }); })
      .map(function (r) {
        var o = {};
        head.forEach(function (h, i) { o[h] = (r[i] || "").trim(); });
        return o;
      });
  }

  function n(v) {
    var x = parseFloat(String(v == null ? "" : v).replace(",", "."));
    return isNaN(x) ? 0 : x;
  }

  var CHARGE_KEYS = [
    "sec_min", "sec_rate", "cus_min", "cus_rate",
    "truck_bulk_min", "truck_bulk_fee_mawb", "truck_bulk_rate",
    "truck_uld_min", "truck_uld_fee",
    "thc_gen_min", "thc_gen_rate", "thc_dg_min", "thc_dg_rate",
    "thc_pha_min", "thc_pha_rate",
    "st_gen_mawb_fee", "st_gen_rate_1_20", "st_gen_rate_21plus", "st_gen_free_days",
    "st_cool_mawb_fee", "st_cool_rate_1_20", "st_cool_rate_21plus", "st_cool_free_days",
    "st_dg_mawb_fee", "st_dg_rate_1_20", "st_dg_rate_21plus", "st_dg_free_days",
    "imp_doc_min", "imp_doc_fee"
  ];

  function shape(config, airportRows, chargeRows, routeRows) {
    var airports = airportRows.map(function (r) {
      return {
        code: (r.code || "").toUpperCase(),
        name: r.name || r.code,
        country: r.country || "",
        region: r.region || "",
        active: ["yes", "si", "sí", "true", "1"].indexOf((r.active || "yes").toLowerCase()) !== -1
      };
    }).filter(function (a) { return a.code; });

    var charges = {};
    chargeRows.forEach(function (r) {
      var code = (r.code || "").toUpperCase();
      if (!code) return;
      var rec = { currency: (r.currency || config.base_currency).toUpperCase() };
      CHARGE_KEYS.forEach(function (k) { rec[k] = n(r[k]); });
      charges[code] = rec;
    });

    var routes = {};
    routeRows.forEach(function (r) {
      var o = (r.origin || "").toUpperCase(), d = (r.destination || "").toUpperCase();
      if (!o || !d) return;
      routes[o] = routes[o] || {};
      routes[o][d] = {
        min: n(r.min_charge), r0: n(r.rate_under_100), r100: n(r.rate_100_299),
        r300: n(r.rate_300_499), r500: n(r.rate_500_plus),
        fsc: n(r.fsc_per_kg), ssc: n(r.ssc_per_kg),
        transit: n(r.transit_days), notes: r.notes || ""
      };
    });

    return { config: config, airports: airports, arrival_charges: charges, routes: routes };
  }

  function sheetURL(id, tab) {
    return "https://docs.google.com/spreadsheets/d/" + id +
      "/gviz/tq?tqx=out:csv&sheet=" + encodeURIComponent(tab);
  }

  function loadFromSheet(config) {
    var ds = config.data_source, id = ds.sheet_id, tabs = ds.sheets;
    return Promise.all([tabs.airports, tabs.arrival_charges, tabs.routes].map(function (tab) {
      return fetch(sheetURL(id, tab)).then(function (r) {
        if (!r.ok) throw new Error("No se pudo leer la pestaña '" + tab + "' (HTTP " + r.status + ")");
        return r.text();
      }).then(parseCSV);
    })).then(function (parts) {
      return shape(config, parts[0], parts[1], parts[2]);
    });
  }

  function load() {
    var forced = new URLSearchParams(location.search).get("source");
    return fetch(JSON_URL, { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("Falta data/tariffs.json — ejecuta `python scripts/build.py`");
        return r.json();
      })
      .then(function (bundle) {
        var mode = forced || (bundle.config.data_source && bundle.config.data_source.mode) || "local";
        if (mode !== "sheet") { bundle.source = "local"; return bundle; }
        return loadFromSheet(bundle.config)
          .then(function (live) { live.source = "sheet"; live.generated_at = new Date().toISOString(); return live; })
          .catch(function (err) {
            console.warn("Modo hoja no disponible, se usa la copia local:", err.message);
            bundle.source = "local (la hoja no respondió)";
            return bundle;
          });
      });
  }

  root.SDGData = { load: load, parseCSV: parseCSV, shape: shape };
})(typeof globalThis !== "undefined" ? globalThis : this);
