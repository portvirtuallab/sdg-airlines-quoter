/* ══════════════════════════════════════════════════════════════
   SDG Airlines — interfaz
   Los desplegables se construyen a partir de los datos, así que
   añadir un aeropuerto es añadir una fila al CSV. Nada más.
   ══════════════════════════════════════════════════════════════ */
(function (root) {
  "use strict";

  var DATA = null, MODE = "full", LAST = null;
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (html != null) e.innerHTML = html;
    return e;
  }

  function airportOptions(select, placeholder) {
    select.innerHTML = "";
    select.appendChild(el("option", { value: "" }, placeholder));
    var byRegion = {};
    DATA.airports.filter(function (a) { return a.active; }).forEach(function (a) {
      (byRegion[a.region || "Otros"] = byRegion[a.region || "Otros"] || []).push(a);
    });
    Object.keys(byRegion).sort().forEach(function (region) {
      var g = el("optgroup", { label: region });
      byRegion[region].sort(function (x, y) { return x.code < y.code ? -1 : 1; }).forEach(function (a) {
        g.appendChild(el("option", { value: a.code }, a.code + " — " + a.name + " (" + a.country + ")"));
      });
      select.appendChild(g);
    });
  }

  function cargoOptions(select) {
    select.innerHTML = "";
    DATA.config.cargo_types.forEach(function (c) {
      select.appendChild(el("option", { value: c.id }, c.label));
    });
  }

  function currencyOptions(select) {
    select.innerHTML = "";
    Object.keys(DATA.config.currencies).forEach(function (c) {
      select.appendChild(el("option", { value: c }, c + " — " + DATA.config.currencies[c].label));
    });
  }

  /* ── piezas ────────────────────────────────────────────────── */
  function pieceRow(values) {
    var v = values || { qty: 1, weightKg: 100, l: 60, w: 40, h: 30 };
    var row = el("div", { class: "piece-row" });
    row.innerHTML =
      '<div class="field"><label>Bultos</label><input type="number" min="1" step="1" data-k="qty" value="' + v.qty + '"></div>' +
      '<div class="field"><label>Peso por bulto (kg)</label><input type="number" min="0" step="0.1" data-k="weightKg" value="' + v.weightKg + '"></div>' +
      '<div class="field"><label>Largo (cm)</label><input type="number" min="0" data-k="l" value="' + v.l + '"></div>' +
      '<div class="field"><label>Ancho (cm)</label><input type="number" min="0" data-k="w" value="' + v.w + '"></div>' +
      '<div class="field"><label>Alto (cm)</label><input type="number" min="0" data-k="h" value="' + v.h + '"></div>' +
      '<button class="btn-mini" type="button" title="Quitar esta línea" aria-label="Quitar esta línea">×</button>';
    row.querySelector("button").onclick = function () {
      if ($("pieces").querySelectorAll(".piece-row").length > 1) { row.remove(); refreshWeights(); }
    };
    row.addEventListener("input", refreshWeights);
    return row;
  }

  function readPieces() {
    return Array.prototype.map.call($("pieces").querySelectorAll(".piece-row"), function (r) {
      var o = {};
      r.querySelectorAll("input").forEach(function (i) { o[i.dataset.k] = parseFloat(i.value) || 0; });
      return o;
    });
  }

  function refreshWeights() {
    var cfg = DATA.config;
    var w = root.SDGEngine.chargeableWeight(readPieces(), cfg.volumetric_factor, cfg.chargeable_weight_rounding);
    $("w-gross").textContent = w.gross.toFixed(1) + " kg";
    $("w-vol").textContent = w.volumetric.toFixed(1) + " kg";
    $("w-cw").textContent = w.chargeable.toFixed(1) + " kg";
    $("w-basis").textContent = w.basis;
    return w;
  }

  function currentCW() {
    var override = parseFloat($("cwOverride") && $("cwOverride").value);
    if (override > 0) return override;
    if (MODE === "arrival") return parseFloat($("cwDirect").value) || 0;
    return refreshWeights().chargeable;
  }

  /* ── render ────────────────────────────────────────────────── */
  function money(a) { return root.SDGEngine.formatMoney(a, $("currency").value, DATA); }

  function lineRow(l) {
    return '<tr><td><div class="c-name"><span class="c-code">' + l.code + '</span>' + l.label + '</div>' +
      '<div class="c-detail">' + l.detail + '</div></td>' +
      '<td><span class="amt">' + money(l.amount) + '</span></td></tr>';
  }

  function render(q) {
    LAST = q;
    var body = "";
    if (q.departure) {
      body += '<tr class="divider"><td colspan="2">Origen — flete y manipulación en salida</td></tr>';
      body += q.departure.lines.map(lineRow).join("");
      body += '<tr class="sub-row"><td>Subtotal salida</td><td class="amt">' + money(q.departure.subtotal) + '</td></tr>';
    }
    body += '<tr class="divider"><td colspan="2">Destino — cargos de llegada</td></tr>';
    body += q.arrival.lines.map(lineRow).join("");
    if (q.departure) {
      body += '<tr class="sub-row"><td>Subtotal llegada</td><td class="amt">' + money(q.arrival.subtotal) + '</td></tr>';
    }
    $("bk-body").innerHTML = body;
    $("res-total").textContent = money(q.total);

    $("res-route").textContent = q.departure ? q.origin + " → " + q.destination : q.destination;
    var apName = function (c) {
      var a = DATA.airports.filter(function (x) { return x.code === c; })[0];
      return a ? a.name : c;
    };
    $("res-sub").textContent = q.departure ? apName(q.origin) + " → " + apName(q.destination) : apName(q.destination);

    var cargoLabel = $("cargoType").options[$("cargoType").selectedIndex].textContent;
    var chips = [q.reference, q.chargeableWeight + " kg facturables", cargoLabel, q.currency];
    if (q.billedWeight && q.billedWeight !== q.chargeableWeight) chips.push("facturado a " + q.billedWeight + " kg");
    if (q.transitDays) chips.push(q.transitDays + " días de tránsito");
    chips.push("válida hasta " + q.validUntil);
    $("res-chips").innerHTML = chips.map(function (c) { return '<span class="chip">' + c + "</span>"; }).join("");

    $("res").classList.add("on");
    $("res").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function fail(msg) {
    $("res-error").innerHTML = '<div class="err">' + msg + "</div>";
    $("res").classList.add("on");
  }

  /* ── cálculo ───────────────────────────────────────────────── */
  function calculate() {
    $("res-error").innerHTML = "";
    var input = {
      origin: MODE === "full" ? $("origin").value : null,
      destination: $("destination").value,
      chargeableWeight: currentCW(),
      mawbs: parseInt($("mawbs").value, 10) || 1,
      cargoType: $("cargoType").value,
      customs: $("customs").value === "yes",
      handling: $("handling").value,
      ulds: parseInt($("ulds").value, 10) || 1,
      storageDays: parseInt($("storageDays").value, 10) || 0,
      currency: $("currency").value
    };

    if (MODE === "full" && !input.origin) return fail("Elige el aeropuerto de origen.");
    if (!input.destination) return fail("Elige el aeropuerto de destino.");
    if (MODE === "full" && input.origin === input.destination) return fail("Origen y destino no pueden coincidir.");
    if (!(input.chargeableWeight > 0)) return fail("Introduce dimensiones o un peso facturable mayor que cero.");

    var q;
    if (MODE === "full") {
      q = root.SDGEngine.fullQuote(DATA, input);
    } else {
      var a = root.SDGEngine.arrivalQuote(DATA, {
        airport: input.destination, chargeableWeight: input.chargeableWeight,
        mawbs: input.mawbs, cargoType: input.cargoType, customs: input.customs,
        handling: input.handling, ulds: input.ulds, storageDays: input.storageDays
      });
      if (a.error) return fail(a.error);
      var fx = (DATA.config.currencies[input.currency] || {}).rate_from_base || 1;
      a.lines = a.lines.map(function (l) { return Object.assign({}, l, { amount: root.SDGEngine.round2(l.amount * fx) }); });
      a.subtotal = root.SDGEngine.round2(a.subtotal * fx);
      q = {
        reference: "SDG-ARR-" + Math.floor(Math.random() * 9000 + 1000),
        currency: input.currency, destination: input.destination,
        chargeableWeight: input.chargeableWeight, arrival: a, total: a.subtotal,
        validUntil: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10)
      };
    }
    if (q.error) return fail(q.error);
    render(q);
  }

  /* ── exportar ──────────────────────────────────────────────── */
  function exportCSV() {
    if (!LAST) return;
    var rows = [["referencia", "origen", "destino", "concepto", "detalle", "importe", "moneda"]];
    var push = function (l) {
      rows.push([LAST.reference, LAST.origin || "", LAST.destination, l.label, l.detail, l.amount, LAST.currency]);
    };
    if (LAST.departure) LAST.departure.lines.forEach(push);
    LAST.arrival.lines.forEach(push);
    rows.push([LAST.reference, LAST.origin || "", LAST.destination, "TOTAL", "", LAST.total, LAST.currency]);
    var csv = rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = LAST.reference + ".csv";
    a.click();
  }

  /* ── arranque ──────────────────────────────────────────────── */
  function init(mode) {
    MODE = mode;
    return root.SDGData.load().then(function (data) {
      DATA = data;

      if (MODE === "full") airportOptions($("origin"), "— Elige el origen —");
      airportOptions($("destination"), "— Elige el destino —");
      cargoOptions($("cargoType"));
      currencyOptions($("currency"));

      if (MODE === "full") {
        $("pieces").insertBefore(pieceRow(), $("pieces-foot"));
        $("addPiece").onclick = function () {
          $("pieces").insertBefore(pieceRow(), $("pieces-foot"));
          refreshWeights();
        };
        refreshWeights();
      }

      $("handling").onchange = function () {
        $("uldField").style.display = this.value === "ULD" ? "" : "none";
      };
      $("handling").onchange();

      $("calc").onclick = calculate;
      $("print").onclick = function () { window.print(); };
      $("csv").onclick = exportCSV;

      var active = data.airports.filter(function (a) { return a.active; }).length;
      if ($("stat-airports")) $("stat-airports").textContent = active + " aeropuertos";
      if ($("stat-source")) {
        $("stat-source").textContent = data.source === "sheet" ? "hoja en vivo" : "datos del repo";
        $("stat-source").className = "tb-pill " + (data.source === "sheet" ? "live" : "");
      }
      if ($("stat-updated") && data.generated_at) {
        $("stat-updated").textContent = data.generated_at.slice(0, 10);
      }
      return data;
    }).catch(function (err) {
      document.body.insertBefore(
        el("div", { class: "err", style: "margin:20px" }, "No se han podido cargar las tarifas: " + err.message),
        document.body.firstChild
      );
      throw err;
    });
  }

  root.SDGUI = { init: init, calculate: calculate, data: function () { return DATA; } };
})(typeof globalThis !== "undefined" ? globalThis : this);
