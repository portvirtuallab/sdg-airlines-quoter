/* ══════════════════════════════════════════════════════════════
   SDG AIRLINES — quotation engine
   No DOM, no dependencies. Runs in the browser and in Apps Script.
   All arithmetic lives here; the interface only renders the result.
   ══════════════════════════════════════════════════════════════ */
(function (root) {
  "use strict";

  var BREAKS = [100, 300, 500];

  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  function ceilTo(n, step) {
    if (!step) return n;
    return Math.ceil((n - 1e-9) / step) * step;
  }

  /* ── Chargeable weight ──────────────────────────────────────
     pieces: [{ qty, weightKg, l, w, h }]   dimensions in cm

     The IATA factor is kilos per cubic METRE (167 kg/m3, equivalently
     6000 cm3/kg). Centimetres must be converted to cubic metres first:
       60 x 40 x 30 cm = 72,000 cm3 = 0.072 m3
       0.072 m3 x 167 = 12.024 kg per piece                            */
  function chargeableWeight(pieces, volumetricFactor, rounding) {
    var vf = volumetricFactor || 167;
    var gross = 0, volumetric = 0;
    (pieces || []).forEach(function (p) {
      var qty = Number(p.qty) || 0;
      gross += qty * (Number(p.weightKg) || 0);
      var l = Number(p.l) || 0, w = Number(p.w) || 0, h = Number(p.h) || 0;
      if (l && w && h) volumetric += qty * ((l * w * h) / 1e6) * vf;
    });
    var cw = Math.max(gross, volumetric);
    return {
      gross: round2(gross),
      volumetric: round2(volumetric),
      chargeable: round2(ceilTo(cw, rounding || 0)),
      basis: volumetric > gross ? "volumetric" : "actual"
    };
  }

  /* ── Freight rate lookup ────────────────────────────────────
     Priority: exact O/D pair, then the "*" wildcard to that dest. */
  function findRoute(data, origin, destination) {
    var r = data.routes || {};
    if (r[origin] && r[origin][destination]) {
      return { rate: r[origin][destination], source: origin + "\u2013" + destination + " contract rate" };
    }
    if (r["*"] && r["*"][destination]) {
      return { rate: r["*"][destination], source: "published rate to " + destination };
    }
    return null;
  }

  function rateForWeight(rate, kg) {
    if (kg >= 500) return { perKg: rate.r500, band: "500 kg and over" };
    if (kg >= 300) return { perKg: rate.r300, band: "300\u2013499 kg" };
    if (kg >= 100) return { perKg: rate.r100, band: "100\u2013299 kg" };
    return { perKg: rate.r0, band: "under 100 kg" };
  }

  /* Weight break: when billing at the next breakpoint costs less,
     the shipment is rated at that weight. Standard IATA practice.  */
  function bestFreight(rate, cw) {
    var direct = rateForWeight(rate, cw);
    var best = {
      billedWeight: cw,
      perKg: direct.perKg,
      band: direct.band,
      amount: Math.max(rate.min, direct.perKg * cw),
      weightBreak: false
    };
    BREAKS.forEach(function (b) {
      if (b <= cw) return;
      var r = rateForWeight(rate, b);
      var amount = Math.max(rate.min, r.perKg * b);
      if (amount < best.amount - 0.005) {
        best = { billedWeight: b, perKg: r.perKg, band: r.band, amount: amount, weightBreak: true };
      }
    });
    best.amount = round2(best.amount);
    best.minApplied = best.amount <= rate.min + 0.005;
    return best;
  }

  /* ── Phase 1: freight and origin handling ───────────────────── */
  function freightQuote(data, input) {
    var lines = [];
    var found = findRoute(data, input.origin, input.destination);
    if (!found) {
      return { error: "No rate published for " + input.origin + " \u2192 " + input.destination };
    }
    var rate = found.rate;
    var cw = Number(input.chargeableWeight) || 0;
    var mawbs = Math.max(1, Number(input.mawbs) || 1);
    var fr = bestFreight(rate, cw);

    lines.push({
      code: "WT",
      due: "C",
      label: "Weight charge",
      detail: found.source + " \u00b7 " + fr.band + " at " + fr.perKg.toFixed(3) + "/kg" +
        (fr.weightBreak ? " \u00b7 rated at " + fr.billedWeight + " kg on the weight break" : "") +
        (fr.minApplied ? " \u00b7 minimum charge applied" : ""),
      amount: fr.amount
    });

    lines.push(...surchargeLines(data, {
      km: Number(input.distanceKm) || distanceBetween(data, input.origin, input.destination),
      chargeableWeight: cw, freight: fr.amount, customs: input.customs,
    }));

    // Origin terminal handling, priced from the origin airport table.
    var org = data.arrival_charges[input.origin];
    if (org) {
      var fam = thcFamily(data, input.cargoType);
      var min = org["thc_" + fam + "_min"], per = org["thc_" + fam + "_rate"];
      lines.push({
        code: "TH",
        due: "C",
        label: "Terminal handling at origin \u2014 " + famLabel(fam),
        detail: "greater of " + min.toFixed(2) + " or " + per.toFixed(3) + "/kg \u00d7 " + cw + " kg",
        amount: round2(Math.max(min, per * cw))
      });
    }

    lines.push({
      code: "AW",
      due: "A",
      label: "Air waybill fee",
      detail: mawbs + " master air waybill(s) issued",
      amount: round2(25 * mawbs)
    });

    var ins = insuranceLine(data, input.incoterm, fr.amount, input.insuredValue);
    if (ins) lines.push(ins);

    return {
      origin: input.origin,
      destination: input.destination,
      chargeableWeight: cw,
      billedWeight: fr.billedWeight,
      rateLine: {
        pieces: Number(input.pieces) || 1,
        grossWeight: Number(input.grossWeight) || cw,
        rateClass: fr.minApplied ? "M" : (fr.billedWeight < 100 ? "N" : "Q"),
        chargeableWeight: fr.billedWeight,
        rate: fr.perKg,
        total: fr.amount
      },
      transitDays: rate.transit || null,
      lines: lines,
      subtotal: round2(lines.reduce(function (s, l) { return s + l.amount; }, 0))
    };
  }

  /* Inside Schengen there is no customs frontier, so clearance,
     the customs cost and the import paperwork simply do not arise. */
  function customsRegime(data, o, d) {
    var m = data.customs || {};
    return (m[o] && m[o][d]) || (m[d] && m[d][o]) || "WCO";
  }

  function customsApplies(data, o, d, requested) {
    if (requested === false) return false;
    return customsRegime(data, o, d) !== "SCHENGEN";
  }

  function distanceBetween(data, o, d) {
    var m = data.distances || {};
    return (m[o] && m[o][d]) || (m[d] && m[d][o]) || 0;
  }

  /* Surcharges come from tariffs/surcharges.csv. One marked applies="disabled"
     still appears on the quotation, priced at zero and flagged, so the reader
     can see the charge exists and is simply not in force today. */
  function surchargeLines(data, ctx) {
    return (data.surcharges || []).map(function (s) {
      var off = s.applies === "disabled" ||
                (s.applies === "customs_required" && !ctx.customs);
      var amount = 0, basis = "";
      if (s.basis === "flat") { amount = s.amount; basis = "flat charge per shipment"; }
      else if (s.basis === "per_kg") {
        amount = s.amount * ctx.chargeableWeight;
        basis = s.amount.toFixed(3) + "/kg \u00d7 " + ctx.chargeableWeight + " kg";
      } else if (s.basis === "per_km") {
        amount = s.amount * ctx.km;
        basis = s.amount.toFixed(3) + "/km \u00d7 " + Math.round(ctx.km) + " km";
      } else if (s.basis === "percent_freight") {
        amount = s.amount * ctx.freight;
        basis = (s.amount * 100).toFixed(1) + "% of the weight charge";
      }
      return {
        code: s.code, due: "C", label: s.label,
        detail: off ? (s.applies === "disabled" ? "not in force for this shipment"
                                                : "customs clearance not required") : basis,
        amount: off ? 0 : round2(amount),
        inactive: off,
      };
    });
  }

  /* ── Incoterms ───────────────────────────────────────────────
     Who bears each charge comes from data/incoterms.csv, one row per
     charge and one column per Incoterm. The engine only looks the
     answer up; the allocation itself is data, open to argument.

     The total never changes with the Incoterm — the same shipment costs
     the same. What changes is where the line between the two parties
     falls, so the two subtotals move and the total does not.          */
  function incotermRow(data, code) {
    var rows = data.incoterms || [];
    for (var i = 0; i < rows.length; i++) if (rows[i].code === code) return rows[i];
    return null;
  }

  function partyFor(data, code, incoterm) {
    if (!incoterm) return null;
    var r = incotermRow(data, code);
    if (!r) return null;
    var p = r.parties && r.parties[incoterm];
    return p && p !== "none" ? p : null;
  }

  /* Pre-carriage, on-carriage and duties are real costs of the door-to-door
     move that this airline does not sell. They are listed so the Incoterm
     reads honestly — a DAP quotation that silently omitted on-carriage would
     teach the wrong lesson — carried at zero and marked as quoted elsewhere. */
  function infoLines(data, stage, incoterm) {
    if (!incoterm) return [];
    var hauler = ((data.config.partners || {}).road_haulier) || {};
    return (data.incoterms || [])
      .filter(function (r) { return r.stage === stage; })
      .map(function (r) {
        var party = r.parties[incoterm];
        if (!party || party === "none") return null;
        var road = r.code === "PRE" || r.code === "ONC";
        return {
          code: r.code, due: "X", label: r.label, party: party,
          detail: road
            ? "not sold by the airline · quoted by " + (hauler.name || "the road haulier")
            : "payable to the customs authority on import · not quoted here",
          href: road ? (hauler.url || "") : "",
          amount: 0, info: true
        };
      })
      .filter(Boolean);
  }

  function insuranceLine(data, incoterm, freight, insuredValue) {
    if (partyFor(data, "INS", incoterm) === null) return null;
    var cfg = data.config.insurance || {};
    var pct = Number(cfg.pct_of_insured_value) || 0;
    var min = Number(cfg.minimum) || 0;
    var base = freight + (Number(insuredValue) || 0);
    var amount = Math.max(min, pct * base);
    return {
      code: "INS", due: "C", label: "Cargo insurance",
      detail: pct > 0
        ? (pct * 100).toFixed(2) + "% of " + base.toFixed(2) + " (weight charge plus declared value)"
        : "no rate configured — set config.insurance.pct_of_insured_value",
      amount: round2(amount),
      inactive: pct <= 0 && min <= 0
    };
  }

  function thcFamily(data, cargoTypeId) {
    var t = (data.config.cargo_types || []).filter(function (c) { return c.id === cargoTypeId; })[0];
    return t ? t.thc : "gen";
  }
  function storageFamily(data, cargoTypeId) {
    var t = (data.config.cargo_types || []).filter(function (c) { return c.id === cargoTypeId; })[0];
    return t ? t.storage : "gen";
  }
  function famLabel(f) {
    return { gen: "general cargo", dg: "dangerous goods", pha: "pharma / temperature controlled", cool: "cool chamber" }[f] || f;
  }

  /* ── Phase 2: charges at the destination airport ────────────── */
  function arrivalQuote(data, input) {
    var t = data.arrival_charges[input.airport];
    if (!t) return { error: "No arrival tariff on file for " + input.airport };

    var cw = Number(input.chargeableWeight) || 0;
    var mawbs = Math.max(1, Number(input.mawbs) || 1);
    var lines = [];

    lines.push({
      code: "SD",
      due: "C",
      label: "Security at arrival",
      detail: "greater of " + t.sec_min.toFixed(2) + " or " + t.sec_rate.toFixed(3) + "/kg \u00d7 " + cw + " kg",
      amount: round2(Math.max(t.sec_min, t.sec_rate * cw))
    });

    if (input.customs) {
      lines.push({
        code: "CH",
        due: "A",
        label: "Customs clearance formalities",
        detail: "greater of " + t.cus_min.toFixed(2) + " or " + t.cus_rate.toFixed(3) + "/kg \u00d7 " + cw + " kg",
        amount: round2(Math.max(t.cus_min, t.cus_rate * cw))
      });
      lines.push({
        code: "DB",
        due: "A",
        label: "Import documentation handling",
        detail: t.imp_doc_fee.toFixed(2) + " per MAWB \u00d7 " + mawbs,
        amount: round2(Math.max(t.imp_doc_min, t.imp_doc_fee * mawbs))
      });
    }

    if (input.handling === "ULD") {
      var ulds = Math.max(1, Number(input.ulds) || 1);
      lines.push({
        code: "LU",
        due: "C",
        label: "Truck loading \u2014 ULD",
        detail: t.truck_uld_fee.toFixed(2) + " per ULD \u00d7 " + ulds,
        amount: round2(Math.max(t.truck_uld_min, t.truck_uld_fee * ulds))
      });
    } else {
      lines.push({
        code: "LB",
        due: "C",
        label: "Truck loading \u2014 bulk",
        detail: "greater of " + t.truck_bulk_min.toFixed(2) + " or " + t.truck_bulk_fee_mawb.toFixed(2) +
          " \u00d7 " + mawbs + " MAWB + " + t.truck_bulk_rate.toFixed(3) + "/kg \u00d7 " + cw + " kg",
        amount: round2(Math.max(t.truck_bulk_min, t.truck_bulk_fee_mawb * mawbs + t.truck_bulk_rate * cw))
      });
    }

    var fam = thcFamily(data, input.cargoType);
    lines.push({
      code: "TD",
      due: "C",
      label: "Terminal handling at destination \u2014 " + famLabel(fam),
      detail: "greater of " + t["thc_" + fam + "_min"].toFixed(2) + " or " + t["thc_" + fam + "_rate"].toFixed(3) + "/kg \u00d7 " + cw + " kg",
      amount: round2(Math.max(t["thc_" + fam + "_min"], t["thc_" + fam + "_rate"] * cw))
    });

    if (input.storageDays > 0) {
      var st = storage(data, t, input, cw, mawbs);
      lines.push(st);
    }

    return {
      airport: input.airport,
      lines: lines,
      subtotal: round2(lines.reduce(function (s, l) { return s + l.amount; }, 0))
    };
  }

  function storage(data, t, input, cw, mawbs) {
    var fam = input.storageFamily || storageFamily(data, input.cargoType);
    var unit = (data.config.storage && data.config.storage.unit_kg) || 100;
    var tier1Last = (data.config.storage && data.config.storage.tier_1_last_day) || 20;

    var free = t["st_" + fam + "_free_days"] || 0;
    var fee = t["st_" + fam + "_mawb_fee"] || 0;
    var r1 = t["st_" + fam + "_rate_1_20"] || 0;
    var r2 = t["st_" + fam + "_rate_21plus"] || 0;

    var days = Math.max(0, Number(input.storageDays) || 0);
    var payable = Math.max(0, days - free);
    var d1 = Math.min(payable, tier1Last);
    var d2 = Math.max(0, payable - tier1Last);
    var units = Math.ceil(cw / unit);

    var amount = fee * mawbs + units * (r1 * d1 + r2 * d2);
    var detail = free + " free days \u00b7 " + units + " \u00d7 " + unit + " kg \u00b7 " +
      d1 + " day(s) at " + r1.toFixed(2) + (d2 ? " + " + d2 + " day(s) at " + r2.toFixed(2) : "") +
      " + " + fee.toFixed(2) + " per MAWB";
    if (payable === 0) detail = days + " day(s), within the " + free + " free days";

    return {
      code: "ST",
      due: "C",
      label: "Storage \u2014 " + famLabel(fam),
      detail: detail,
      amount: round2(amount)
    };
  }

  /* ── Complete quotation ─────────────────────────────────────── */
  function fullQuote(data, input) {
    var cur = input.currency || data.config.base_currency;
    var fx = ((data.config.currencies || {})[cur] || {}).rate_from_base || 1;

    var dep = freightQuote(data, input);
    if (dep.error) return dep;
    var arr = arrivalQuote(data, {
      airport: input.destination,
      chargeableWeight: dep.chargeableWeight,
      mawbs: input.mawbs,
      cargoType: input.cargoType,
      customs: input.customs,
      handling: input.handling,
      ulds: input.ulds,
      storageDays: input.storageDays,
      storageFamily: input.storageFamily
    });
    if (arr.error) return arr;

    var ic = input.incoterm || null;

    function convert(block, stage) {
      var lines = block.lines.map(function (l) {
        return { code: l.code, due: l.due, label: l.label, detail: l.detail,
                 inactive: l.inactive, info: l.info, href: l.href,
                 party: l.party || partyFor(data, l.code, ic),
                 amount: round2(l.amount * fx) };
      });
      // Pre-carriage opens the origin block; on-carriage and duties close
      // the arrival one, in the order the shipment actually meets them.
      var info = infoLines(data, stage, ic);
      lines = stage === "info_origin" ? info.concat(lines) : lines.concat(info);
      return { lines: lines, subtotal: round2(block.subtotal * fx) };
    }

    var d = convert(dep, "info_origin"), a = convert(arr, "info_arrival");

    function sideTotal(who) {
      return round2(d.lines.concat(a.lines).reduce(function (s, l) {
        return s + (l.party === who && !l.info ? l.amount : 0);
      }, 0));
    }
    var seller = sideTotal("seller"), buyer = sideTotal("buyer");
    return {
      reference: reference(data, input),
      currency: cur,
      fx: fx,
      origin: input.origin,
      destination: input.destination,
      transitDays: dep.transitDays,
      chargeableWeight: dep.chargeableWeight,
      billedWeight: dep.billedWeight,
      rateLine: (function () {
        var rl = dep.rateLine;
        return { pieces: rl.pieces, grossWeight: rl.grossWeight, rateClass: rl.rateClass,
                 chargeableWeight: rl.chargeableWeight, rate: round2(rl.rate * fx), total: round2(rl.total * fx) };
      })(),
      departure: d,
      arrival: a,
      total: round2(d.subtotal + a.subtotal),
      incoterm: ic,
      incotermInfo: ic ? (data.config.incoterms.list || []).filter(function (i) {
        return i.id === ic;
      })[0] || null : null,
      sellerTotal: seller,
      buyerTotal: buyer,
      validUntil: validUntil(data)
    };
  }

  function reference(data, input) {
    var p = (data.config.quote && data.config.quote.reference_prefix) || "SDG";
    var stamp = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    var seq = Math.floor(Math.random() * 9000 + 1000);
    return p + "-" + stamp + "-" + (input.origin || "") + (input.destination || "") + "-" + seq;
  }

  function validUntil(data) {
    var days = (data.config.quote && data.config.quote.validity_days) || 15;
    var d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function formatMoney(amount, currency, data) {
    var c = ((data.config.currencies || {})[currency]) || { symbol: "" };
    return c.symbol + " " + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  root.SDGEngine = {
    chargeableWeight: chargeableWeight,
    findRoute: findRoute,
    freightQuote: freightQuote,
    arrivalQuote: arrivalQuote,
    fullQuote: fullQuote,
    surchargeLines: surchargeLines,
    customsRegime: customsRegime,
    customsApplies: customsApplies,
    partyFor: partyFor,
    distanceBetween: distanceBetween,
    formatMoney: formatMoney,
    round2: round2
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
