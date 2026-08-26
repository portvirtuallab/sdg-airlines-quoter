/* ═══════════════════════════════════════════════════════════════
   SDG AIRLINES — interface
   Every dropdown is built from the data, so adding an airport is
   adding a row to a CSV. Nothing here needs editing for that.
   ═══════════════════════════════════════════════════════════════ */
(function (root) {
  "use strict";

  var DATA = null, NET = null, MODE = "full", LAST = null;
  var $ = function (id) { return document.getElementById(id); };
  var E = function () { return root.SDGEngine; };

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ── option builders ─────────────────────────────────────────── */
  function airportOptions(select, placeholder) {
    select.innerHTML = "";
    select.appendChild(el("option", { value: "" }, placeholder));
    var byRegion = {};
    DATA.airports.filter(function (a) { return a.active; }).forEach(function (a) {
      (byRegion[a.region || "Other"] = byRegion[a.region || "Other"] || []).push(a);
    });
    Object.keys(byRegion).sort().forEach(function (region) {
      var g = el("optgroup", { label: region });
      byRegion[region].sort(function (x, y) { return x.code < y.code ? -1 : 1; }).forEach(function (a) {
        g.appendChild(el("option", { value: a.code }, a.code + "  " + a.name + " \u00b7 " + a.country));
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
  function incotermOptions(select, note) {
    var cfg = DATA.config.incoterms || {};
    (cfg.list || []).forEach(function (i) {
      select.appendChild(el("option", { value: i.id }, esc(i.label)));
    });
    if (cfg.default) select.value = cfg.default;
    function explain() {
      var chosen = (cfg.list || []).filter(function (i) { return i.id === select.value; })[0];
      if (note && chosen) note.textContent = chosen.note;
    }
    select.addEventListener("change", explain);
    explain();
  }

  function currencyOptions(select) {
    select.innerHTML = "";
    Object.keys(DATA.config.currencies).forEach(function (c) {
      select.appendChild(el("option", { value: c }, c + " \u2014 " + DATA.config.currencies[c].label));
    });
  }

  /* ── consignment lines ───────────────────────────────────────── */
  function consignmentLine(values) {
    var v = values || { qty: 1, weightKg: 100, l: 60, w: 40, h: 30 };
    var row = el("div", { class: "line" });
    var cell = function (k, label, val, attrs) {
      return '<div><span class="ll">' + label + '</span>' +
        '<input type="number" ' + attrs + ' data-k="' + k + '" value="' + val +
        '" aria-label="' + label + '"></div>';
    };
    row.innerHTML =
      cell("qty", "Pieces", v.qty, 'min="1" step="1"') +
      cell("weightKg", "Weight each (kg)", v.weightKg, 'min="0" step="0.1"') +
      cell("l", "Length (cm)", v.l, 'min="0"') +
      cell("w", "Width (cm)", v.w, 'min="0"') +
      cell("h", "Height (cm)", v.h, 'min="0"') +
      '<button class="x" type="button" aria-label="Remove this line">\u00d7</button>';
    row.querySelector("button").onclick = function () {
      if ($("lines").querySelectorAll(".line").length > 1) { row.remove(); tally(); }
    };
    row.addEventListener("input", tally);
    return row;
  }

  function readLines() {
    return Array.prototype.map.call($("lines").querySelectorAll(".line"), function (r) {
      var o = {};
      r.querySelectorAll("input").forEach(function (i) { o[i.dataset.k] = parseFloat(i.value) || 0; });
      return o;
    });
  }

  function tally() {
    var cfg = DATA.config;
    var rows = readLines();
    var w = E().chargeableWeight(rows, cfg.volumetric_factor, cfg.chargeable_weight_rounding);
    var pieces = rows.reduce(function (s, r) { return s + (r.qty || 0); }, 0);
    $("t-pieces").textContent = pieces;
    $("t-gross").textContent = w.gross.toFixed(1) + " kg";
    $("t-vol").textContent = w.volumetric.toFixed(1) + " kg";
    $("t-cw").textContent = w.chargeable.toFixed(1) + " kg";
    $("t-basis").textContent = w.basis;
    w.pieces = pieces;
    return w;
  }

  function weights() {
    if (MODE === "arrival") {
      var cw = parseFloat($("cwDirect").value) || 0;
      return { chargeable: cw, gross: cw, pieces: parseInt($("pieces").value, 10) || 1 };
    }
    var w = tally();
    var override = parseFloat($("cwOverride").value);
    if (override > 0) w.chargeable = override;
    return w;
  }

  /* ── rendering ───────────────────────────────────────────────── */
  function money(a) { return E().formatMoney(a, LAST.currency, DATA); }
  function airportName(code) {
    var a = DATA.airports.filter(function (x) { return x.code === code; })[0];
    return a ? a.name : code;
  }

  function chargeRow(l) {
    // The party pill only appears once an Incoterm has been chosen, so the
    // arrival-charges page and a quotation without one look exactly as before.
    var pill = l.party
      ? '<span class="who ' + l.party + '">' + (l.party === "seller" ? "Seller" : "Buyer") + '</span>'
      : '';
    var name = l.href
      ? '<a class="c-name out" href="' + esc(l.href) + '" target="_blank" rel="noopener">' +
        esc(l.label) + '</a>'
      : '<span class="c-name">' + esc(l.label) + '</span>';
    var value = l.info
      ? '<span class="amt none">quoted separately</span>'
      : '<span class="amt">' + money(l.amount) + '</span>';
    var cls = [l.inactive ? "off" : "", l.info ? "info" : ""].join(" ").trim();
    return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td><span class="c-code">' + esc(l.code) + '</span>' +
      name + pill +
      '<div class="c-detail">' + esc(l.detail) + '</div></td>' +
      '<td>' + value + '</td></tr>';
  }

  function render(q) {
    LAST = q;

    if (q.rateLine) {
      var rl = q.rateLine;
      $("rateline").innerHTML =
        '<div class="rateline-cap">Air waybill rate line \u00b7 box 22</div>' +
        '<table><thead><tr>' +
        '<th>No. of<br>pieces</th><th>Gross<br>weight</th><th>kg</th>' +
        '<th>Rate<br>class</th><th>Chargeable<br>weight</th><th>Rate /<br>charge</th>' +
        '<th>Total</th></tr></thead><tbody><tr>' +
        '<td>' + rl.pieces + '</td>' +
        '<td>' + rl.grossWeight.toFixed(1) + '</td>' +
        '<td>K</td>' +
        '<td><span class="rc" data-c="' + rl.rateClass + '">' + rl.rateClass + '</span></td>' +
        '<td>' + rl.chargeableWeight.toFixed(1) + '</td>' +
        '<td>' + rl.rate.toFixed(3) + '</td>' +
        '<td>' + money(rl.total) + '</td>' +
        '</tr></tbody></table>';
      $("rateline").style.display = "";
    } else {
      $("rateline").style.display = "none";
    }

    if (q.itinerary) {
      var utc = function (c) {
        var a = DATA.airports.filter(function (x) { return x.code === c; })[0];
        return a ? a.utcOffset : 0;
      };
      var L = root.SDGNetwork.localTime;
      $("itin").innerHTML =
        '<div class="itin-cap">Routing \u00b7 ' + q.itinerary.jumps + ' flight(s) \u00b7 ' +
        Math.round(q.itinerary.transitSeconds / 3600) + ' h total \u00b7 ' +
        Math.round(q.itinerary.km) + ' km</div>' +
        q.itinerary.legs.map(function (l) {
          return '<div class="itin-leg">' +
            '<div class="itin-fl">' + esc(l.flightNumber || l.service) + '</div>' +
            '<div class="itin-od"><strong>' + esc(l.origin) + '</strong> ' + L(l.departureUTC, utc(l.origin)) +
            '<span class="itin-ar">\u2192</span>' +
            '<strong>' + esc(l.destination) + '</strong> ' + L(l.arrivalUTC, utc(l.destination)) + '</div>' +
            '<div class="itin-ac">' + esc(l.aircraft) + ' \u00b7 ' + esc(l.model) + ' \u00b7 ' + esc(l.tail) +
            (l.via.length ? ' \u00b7 via ' + l.via.join(", ") : "") + '</div>' +
            '</div>';
        }).join("") +
        '<div class="itin-note">Local times at each station. ' +
        (q.regime === "SCHENGEN"
          ? "Both stations are inside Schengen, so no customs clearance applies."
          : "Customs regime: " + esc(q.regime) + ".") + '</div>';
      $("itin").style.display = "";
    } else if ($("itin")) {
      $("itin").style.display = "none";
    }

    var body = "";
    if (q.departure) {
      body += '<tr class="band"><td colspan="2">Charges at origin \u2014 prepaid</td></tr>';
      body += q.departure.lines.map(chargeRow).join("");
      body += '<tr class="sub-row"><td>Subtotal at origin</td><td><span class="amt">' + money(q.departure.subtotal) + '</span></td></tr>';
    }
    body += '<tr class="band"><td colspan="2">Charges at destination \u2014 ' + esc(q.destination) + '</td></tr>';
    body += q.arrival.lines.map(chargeRow).join("");
    if (q.departure) {
      body += '<tr class="sub-row"><td>Subtotal at destination</td><td><span class="amt">' + money(q.arrival.subtotal) + '</span></td></tr>';
    }

    // The Incoterm split. Both sides add up to the same total: the shipment
    // costs what it costs, the Incoterm only says where the line falls.
    if (q.incoterm) {
      var ii = q.incotermInfo || {};
      body += '<tr class="band"><td colspan="2">' + esc(q.incoterm) +
        ' — delivered at ' + esc(ii.place || "") + '</td></tr>';
      body += '<tr class="split"><td><span class="who seller">Seller</span>' +
        '<span class="c-name">Borne by the seller</span></td>' +
        '<td><span class="amt">' + money(q.sellerTotal) + '</span></td></tr>';
      body += '<tr class="split"><td><span class="who buyer">Buyer</span>' +
        '<span class="c-name">Borne by the buyer</span></td>' +
        '<td><span class="amt">' + money(q.buyerTotal) + '</span></td></tr>';
      if (ii.note) {
        body += '<tr class="icnote"><td colspan="2">' + esc(ii.note) + '</td></tr>';
      }
    }
    $("ledger").innerHTML = body;

    $("grand").textContent = money(q.total);
    $("doc-lane").innerHTML = q.departure
      ? esc(q.origin) + '<span class="arrow">\u2192</span>' + esc(q.destination)
      : esc(q.destination);
    $("doc-cities").textContent = q.departure
      ? airportName(q.origin) + " to " + airportName(q.destination)
      : "Arrival at " + airportName(q.destination);

    var cargo = $("cargoType").options[$("cargoType").selectedIndex].textContent;
    var meta = [
      ["Quotation", q.reference],
      ["Issued", new Date().toISOString().slice(0, 10)],
      ["Valid until", q.validUntil],
      ["Currency", q.currency],
      ["Commodity", cargo]
    ];
    if (q.incoterm) meta.splice(4, 0, ["Incoterm", q.incoterm]);
    if (q.itinerary) {
      meta.push(["Departure", new Date(q.itinerary.departureUTC).toISOString().slice(0, 10)]);
      meta.push(["Arrival", new Date(q.itinerary.arrivalUTC).toISOString().slice(0, 10)]);
      meta.push(["Customs", q.regime]);
    } else if (q.transitDays) meta.push(["Transit", q.transitDays + " days"]);
    $("doc-ref").innerHTML = meta.map(function (m) {
      return "<dt>" + esc(m[0]) + "</dt><dd>" + esc(m[1]) + "</dd>";
    }).join("");

    $("alert").innerHTML = (q.billedWeight && q.billedWeight !== q.chargeableWeight)
      ? '<div class="alert"><strong>Rated on the weight break</strong>Chargeable weight is ' +
        q.chargeableWeight + ' kg, but rating the shipment at ' + q.billedWeight +
        ' kg falls into a cheaper band and costs less. The lower figure is quoted.</div>'
      : "";

    var endpoint = (DATA.config.quote || {}).endpoint;
    if ($("send")) {
      $("send").classList.toggle("on", !!(endpoint && q.itinerary));
      $("sendMsg").textContent = "";
      $("sendMsg").className = "send-msg";
      $("sendBtn").disabled = false;
      $("sendBtn").textContent = "Send";
    }

    $("doc").classList.add("on");
    $("doc").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ── email the quotation ─────────────────────────────────────── */
  function payload() {
    var utc = function (c) {
      var a = DATA.airports.filter(function (x) { return x.code === c; })[0];
      return a ? a.utcOffset : 0;
    };
    var L = root.SDGNetwork.localTime;
    var name = function (c) {
      var a = DATA.airports.filter(function (x) { return x.code === c; })[0];
      return a ? a.name : c;
    };
    var it = LAST.itinerary;
    return {
      pin: $("sendPin").value.trim(),
      email: $("sendEmail").value.trim(),
      reference: LAST.reference,
      issued: new Date().toISOString().slice(0, 10),
      validUntil: LAST.validUntil,
      currency: LAST.currency,
      origin: LAST.origin, destination: LAST.destination,
      originName: name(LAST.origin), destinationName: name(LAST.destination),
      commodity: $("cargoType").options[$("cargoType").selectedIndex].textContent,
      pieces: LAST.rateLine.pieces,
      grossWeight: LAST.rateLine.grossWeight,
      chargeableWeight: LAST.chargeableWeight,
      regime: LAST.regime,
      rateLine: LAST.rateLine,
      departure: LAST.departure,
      arrival: LAST.arrival,
      total: LAST.total,
      itinerary: {
        jumps: it.jumps, km: it.km, transitSeconds: it.transitSeconds,
        legs: it.legs.map(function (l) {
          return {
            flightNumber: l.flightNumber, service: l.service, aircraft: l.aircraft,
            model: l.model, tail: l.tail, origin: l.origin, destination: l.destination,
            via: l.via,
            departureLocal: L(l.departureUTC, utc(l.origin)),
            arrivalLocal: L(l.arrivalUTC, utc(l.destination)),
          };
        }),
      },
    };
  }

  function sendByEmail() {
    var msg = $("sendMsg"), btn = $("sendBtn");
    var show = function (text, cls) { msg.textContent = text; msg.className = "send-msg " + (cls || ""); };
    if (!LAST) return;
    if (!$("sendPin").value.trim()) return show("Enter your Port Virtual Lab PIN.", "bad");
    if ($("sendEmail").value.indexOf("@") < 1) return show("Enter a valid email address.", "bad");

    btn.disabled = true; btn.textContent = "Sending";
    show("Preparing the quotation\u2026");

    fetch(DATA.config.quote.endpoint, {
      method: "POST",
      // Apps Script rejects a preflight, so the body goes as plain text.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload()),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok) {
          show("Sent to " + res.sentTo + " for " + res.institution + ".", "ok");
          btn.textContent = "Sent";
        } else {
          show(res.error || "The quotation could not be sent.", "bad");
          btn.disabled = false; btn.textContent = "Send";
        }
      })
      .catch(function (err) {
        show("Could not reach the quotation desk: " + err.message, "bad");
        btn.disabled = false; btn.textContent = "Send";
      });
  }

  function fail(msg) {
    $("alert").innerHTML = '<div class="alert"><strong>Cannot quote</strong>' + esc(msg) + "</div>";
    $("doc").classList.add("on");
    $("doc").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ── calculate ───────────────────────────────────────────────── */
  function calculate() {
    $("alert").innerHTML = "";
    var w = weights();
    var input = {
      origin: MODE === "full" ? $("origin").value : null,
      destination: $("destination").value,
      chargeableWeight: w.chargeable,
      grossWeight: w.gross,
      pieces: w.pieces,
      mawbs: parseInt($("mawbs").value, 10) || 1,
      cargoType: $("cargoType").value,
      customs: $("customs").value === "yes",
      handling: $("handling").value,
      ulds: parseInt($("ulds").value, 10) || 1,
      storageDays: parseInt($("storageDays").value, 10) || 0,
      currency: $("currency").value,
      incoterm: (MODE === "full" && $("incoterm")) ? $("incoterm").value : null
    };

    if (MODE === "full" && !input.origin) return fail("Select an airport of origin.");
    if (!input.destination) return fail("Select an airport of destination.");
    if (MODE === "full" && input.origin === input.destination) return fail("Origin and destination must differ.");
    if (!(input.chargeableWeight > 0)) return fail("Enter dimensions or a chargeable weight above zero.");

    var itinerary = null;
    if (MODE === "full" && NET) {
      var wanted = Date.parse(($("departDate").value || "") + "T00:00:00Z");
      if (isNaN(wanted)) return fail("Enter a departure date.");
      itinerary = root.SDGNetwork.route(NET, input.origin, input.destination, wanted, { horizonDays: 30 });
      if (!itinerary) {
        return fail("No service connects " + input.origin + " to " + input.destination +
                    " within 30 days of " + $("departDate").value + ".");
      }
      input.distanceKm = itinerary.km;
    }

    if (MODE === "full") {
      input.customs = E().customsApplies(DATA, input.origin, input.destination, input.customs);
    }

    var q;
    if (MODE === "full") {
      q = E().fullQuote(DATA, input);
      if (!q.error) { q.itinerary = itinerary; q.regime = E().customsRegime(DATA, input.origin, input.destination); }
    } else {
      var a = E().arrivalQuote(DATA, {
        airport: input.destination, chargeableWeight: input.chargeableWeight,
        mawbs: input.mawbs, cargoType: input.cargoType, customs: input.customs,
        handling: input.handling, ulds: input.ulds, storageDays: input.storageDays
      });
      if (a.error) return fail(a.error);
      var fx = (DATA.config.currencies[input.currency] || {}).rate_from_base || 1;
      a.lines = a.lines.map(function (l) {
        return { code: l.code, due: l.due, label: l.label, detail: l.detail, amount: E().round2(l.amount * fx) };
      });
      a.subtotal = E().round2(a.subtotal * fx);
      q = {
        reference: "SDG-ARR-" + new Date().toISOString().slice(2, 10).replace(/-/g, "") +
                   "-" + input.destination + "-" + Math.floor(Math.random() * 9000 + 1000),
        currency: input.currency, destination: input.destination,
        chargeableWeight: input.chargeableWeight, arrival: a, total: a.subtotal,
        validUntil: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10)
      };
    }
    if (q.error) return fail(q.error);
    render(q);
  }

  /* ── export ──────────────────────────────────────────────────── */
  function exportCSV() {
    if (!LAST || !LAST.arrival) return;
    var rows = [["reference", "origin", "destination", "code", "charge", "basis", "amount", "currency"]];
    var push = function (l) {
      rows.push([LAST.reference, LAST.origin || "", LAST.destination, l.code, l.label, l.detail, l.amount, LAST.currency]);
    };
    if (LAST.departure) LAST.departure.lines.forEach(push);
    LAST.arrival.lines.forEach(push);
    rows.push([LAST.reference, LAST.origin || "", LAST.destination, "", "TOTAL", "", LAST.total, LAST.currency]);
    var csv = rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\r\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = LAST.reference + ".csv";
    a.click();
  }

  /* ── boot ────────────────────────────────────────────────────── */
  function init(mode) {
    MODE = mode;
    return root.SDGData.load().then(function (data) {
      DATA = data;
      if (root.SDGNetwork && data.network) {
        NET = root.SDGNetwork.buildNetwork({
          airports: data.airports, services: data.network.services,
          legs: data.network.legs, rotations: data.network.rotations,
        });
      }

      if (MODE === "full") airportOptions($("origin"), "\u2014 select origin \u2014");
      airportOptions($("destination"), "\u2014 select destination \u2014");
      cargoOptions($("cargoType"));
      currencyOptions($("currency"));
      if (MODE === "full" && $("incoterm")) {
        incotermOptions($("incoterm"), $("incotermNote"));
      }

      if (MODE === "full") {
        $("lines").appendChild(consignmentLine());
        $("addLine").onclick = function () { $("lines").appendChild(consignmentLine()); tally(); };
        tally();
        $("cwOverride").addEventListener("input", function () {
          $("t-cw").textContent = (parseFloat(this.value) > 0)
            ? parseFloat(this.value).toFixed(1) + " kg" : tally().chargeable.toFixed(1) + " kg";
        });
      }

      $("handling").onchange = function () {
        $("uldField").style.display = this.value === "ULD" ? "" : "none";
      };
      $("handling").onchange();

      if ($("departDate") && !$("departDate").value) {
        $("departDate").value = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
      }
      $("calc").onclick = calculate;
      $("print").onclick = function () { window.print(); };
      $("csv").onclick = exportCSV;
      if ($("sendBtn")) $("sendBtn").onclick = sendByEmail;

      var active = data.airports.filter(function (a) { return a.active; }).length;
      if ($("s-airports")) $("s-airports").textContent = active + " stations";
      if ($("s-source")) {
        var live = data.source === "sheet";
        $("s-source").textContent = live ? "live sheet" : "repository";
        $("s-source").className = "flag " + (live ? "live" : "");
      }
      if ($("s-updated") && data.generated_at) $("s-updated").textContent = data.generated_at.slice(0, 10);
      return data;
    }).catch(function (err) {
      document.body.insertBefore(
        el("div", { class: "alert" }, "<strong>Tariffs unavailable</strong>" + esc(err.message)),
        document.body.firstChild
      );
      throw err;
    });
  }

  root.SDGUI = { init: init, calculate: calculate, data: function () { return DATA; } };
})(typeof globalThis !== "undefined" ? globalThis : this);
