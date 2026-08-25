/* ══════════════════════════════════════════════════════════════
   SDG Airlines — motor de cálculo
   Sin DOM, sin dependencias. Funciona en navegador y en Apps Script.
   Toda la aritmética vive aquí; la interfaz sólo pinta el resultado.
   ══════════════════════════════════════════════════════════════ */
(function (root) {
  "use strict";

  var BREAKS = [100, 300, 500];

  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  function ceilTo(n, step) {
    if (!step) return n;
    return Math.ceil((n - 1e-9) / step) * step;
  }

  /* ── Peso facturable ────────────────────────────────────────
     piezas: [{ qty, weightKg, l, w, h }]  (dimensiones en cm)     */
  function chargeableWeight(pieces, volumetricFactor, rounding) {
    var vf = volumetricFactor || 167;
    var gross = 0, volumetric = 0;
    (pieces || []).forEach(function (p) {
      var qty = Number(p.qty) || 0;
      gross += qty * (Number(p.weightKg) || 0);
      var l = Number(p.l) || 0, w = Number(p.w) || 0, h = Number(p.h) || 0;
      if (l && w && h) volumetric += qty * ((l * w * h) / vf);
    });
    var cw = Math.max(gross, volumetric);
    return {
      gross: round2(gross),
      volumetric: round2(volumetric),
      chargeable: round2(ceilTo(cw, rounding || 0)),
      basis: volumetric > gross ? "volumen" : "peso real"
    };
  }

  /* ── Búsqueda de tarifa de flete ────────────────────────────
     Prioridad: par O/D exacto → comodín "*" hacia el destino.     */
  function findRoute(data, origin, destination) {
    var r = data.routes || {};
    if (r[origin] && r[origin][destination]) {
      return { rate: r[origin][destination], source: "acuerdo " + origin + "–" + destination };
    }
    if (r["*"] && r["*"][destination]) {
      return { rate: r["*"][destination], source: "tarifa general a " + destination };
    }
    return null;
  }

  function rateForWeight(rate, kg) {
    if (kg >= 500) return { perKg: rate.r500, band: "+500 kg" };
    if (kg >= 300) return { perKg: rate.r300, band: "300–499 kg" };
    if (kg >= 100) return { perKg: rate.r100, band: "100–299 kg" };
    return { perKg: rate.r0, band: "menos de 100 kg" };
  }

  /* Salto de tramo (weight break): si facturar al siguiente escalón
     sale más barato, se factura a ese peso. Es práctica IATA real. */
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

  /* ── Fase 1: flete + THC en origen ──────────────────────────── */
  function freightQuote(data, input) {
    var lines = [];
    var found = findRoute(data, input.origin, input.destination);
    if (!found) {
      return { error: "No hay tarifa publicada para " + input.origin + " → " + input.destination };
    }
    var rate = found.rate;
    var cw = Number(input.chargeableWeight) || 0;
    var mawbs = Math.max(1, Number(input.mawbs) || 1);
    var fr = bestFreight(rate, cw);

    lines.push({
      code: "FRT",
      label: "Flete aéreo",
      detail: found.source + " · " + fr.band + " a " + fr.perKg.toFixed(3) + "/kg" +
        (fr.weightBreak ? " · facturado a " + fr.billedWeight + " kg por salto de tramo" : "") +
        (fr.minApplied ? " · mínimo aplicado" : ""),
      amount: fr.amount
    });

    if (rate.fsc) {
      lines.push({
        code: "FSC",
        label: "Recargo de combustible",
        detail: rate.fsc.toFixed(3) + "/kg × " + fr.billedWeight + " kg",
        amount: round2(rate.fsc * fr.billedWeight)
      });
    }
    if (rate.ssc) {
      lines.push({
        code: "SSC",
        label: "Recargo de seguridad",
        detail: rate.ssc.toFixed(3) + "/kg × " + fr.billedWeight + " kg",
        amount: round2(rate.ssc * fr.billedWeight)
      });
    }

    // THC en salida: se usa la tabla del aeropuerto de origen.
    var org = data.arrival_charges[input.origin];
    if (org) {
      var fam = thcFamily(data, input.cargoType);
      var min = org["thc_" + fam + "_min"], per = org["thc_" + fam + "_rate"];
      lines.push({
        code: "THC-DEP",
        label: "THC en origen (" + famLabel(fam) + ")",
        detail: "máx(" + min.toFixed(2) + " , " + per.toFixed(3) + "/kg × " + cw + " kg)",
        amount: round2(Math.max(min, per * cw))
      });
    }

    lines.push({
      code: "AWB",
      label: "Emisión de AWB",
      detail: mawbs + " MAWB",
      amount: round2(25 * mawbs)
    });

    return {
      origin: input.origin,
      destination: input.destination,
      chargeableWeight: cw,
      billedWeight: fr.billedWeight,
      transitDays: rate.transit || null,
      lines: lines,
      subtotal: round2(lines.reduce(function (s, l) { return s + l.amount; }, 0))
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
    return { gen: "carga general", dg: "mercancías peligrosas", pha: "farma / temperatura", cool: "cámara de frío" }[f] || f;
  }

  /* ── Fase 2: cargos de llegada en destino ───────────────────── */
  function arrivalQuote(data, input) {
    var t = data.arrival_charges[input.airport];
    if (!t) return { error: "Sin tabla de cargos de llegada para " + input.airport };

    var cw = Number(input.chargeableWeight) || 0;
    var mawbs = Math.max(1, Number(input.mawbs) || 1);
    var lines = [];

    lines.push({
      code: "SEC",
      label: "Seguridad en llegada",
      detail: "máx(" + t.sec_min.toFixed(2) + " , " + t.sec_rate.toFixed(3) + "/kg × " + cw + " kg)",
      amount: round2(Math.max(t.sec_min, t.sec_rate * cw))
    });

    if (input.customs) {
      lines.push({
        code: "CUS",
        label: "Formalidades aduaneras",
        detail: "máx(" + t.cus_min.toFixed(2) + " , " + t.cus_rate.toFixed(3) + "/kg × " + cw + " kg)",
        amount: round2(Math.max(t.cus_min, t.cus_rate * cw))
      });
      lines.push({
        code: "DOC",
        label: "Gestión de documentos de importación",
        detail: t.imp_doc_fee.toFixed(2) + " por MAWB × " + mawbs,
        amount: round2(Math.max(t.imp_doc_min, t.imp_doc_fee * mawbs))
      });
    }

    if (input.handling === "ULD") {
      var ulds = Math.max(1, Number(input.ulds) || 1);
      lines.push({
        code: "TRK",
        label: "Carga a camión — ULD",
        detail: t.truck_uld_fee.toFixed(2) + " por ULD × " + ulds,
        amount: round2(Math.max(t.truck_uld_min, t.truck_uld_fee * ulds))
      });
    } else {
      lines.push({
        code: "TRK",
        label: "Carga a camión — granel",
        detail: "máx(" + t.truck_bulk_min.toFixed(2) + " , " + t.truck_bulk_fee_mawb.toFixed(2) +
          " × " + mawbs + " MAWB + " + t.truck_bulk_rate.toFixed(3) + "/kg × " + cw + " kg)",
        amount: round2(Math.max(t.truck_bulk_min, t.truck_bulk_fee_mawb * mawbs + t.truck_bulk_rate * cw))
      });
    }

    var fam = thcFamily(data, input.cargoType);
    lines.push({
      code: "THC-ARR",
      label: "THC en destino (" + famLabel(fam) + ")",
      detail: "máx(" + t["thc_" + fam + "_min"].toFixed(2) + " , " + t["thc_" + fam + "_rate"].toFixed(3) + "/kg × " + cw + " kg)",
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
    var detail = free + " días libres · " + units + " × " + unit + " kg · " +
      d1 + " día(s) a " + r1.toFixed(2) + (d2 ? " + " + d2 + " día(s) a " + r2.toFixed(2) : "") +
      " + " + fee.toFixed(2) + "/MAWB";
    if (payable === 0) detail = days + " día(s) dentro de los " + free + " días libres";

    return {
      code: "STO",
      label: "Almacenaje — " + famLabel(fam),
      detail: detail,
      amount: round2(amount)
    };
  }

  /* ── Cotización completa ────────────────────────────────────── */
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

    function convert(block) {
      return {
        lines: block.lines.map(function (l) {
          return { code: l.code, label: l.label, detail: l.detail, amount: round2(l.amount * fx) };
        }),
        subtotal: round2(block.subtotal * fx)
      };
    }

    var d = convert(dep), a = convert(arr);
    return {
      reference: reference(data, input),
      currency: cur,
      fx: fx,
      origin: input.origin,
      destination: input.destination,
      transitDays: dep.transitDays,
      chargeableWeight: dep.chargeableWeight,
      billedWeight: dep.billedWeight,
      departure: d,
      arrival: a,
      total: round2(d.subtotal + a.subtotal),
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
    formatMoney: formatMoney,
    round2: round2
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
