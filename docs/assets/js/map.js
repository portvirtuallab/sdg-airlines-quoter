/* SDG Airlines — network chart
   Draws the live network from the bundle: every active station placed by its
   own lat/lon, every leg of every rotation as an airway. Nothing here is
   hardcoded, so a station added to airports.csv appears on the map by itself.

   Hovering a service in the legend lights its loop and dims the rest, which is
   the quickest way to see that the six rotations really do close. */
var SDGMap = (function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var W = 1180, H = 330, PAD = { l: 44, r: 44, t: 30, b: 34 };

  function mk(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function draw(svg, legend, data) {
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (legend) while (legend.firstChild) legend.removeChild(legend.firstChild);

    var stations = (data.airports || []).filter(function (a) {
      return a.active && typeof a.lat === "number" && typeof a.lon === "number";
    });
    if (stations.length < 2) return;

    var net = data.network || {};
    var legs = net.legs || [];
    var services = net.services || [];

    // hubs come from the services file, not a list kept in here
    var hubs = {};
    services.forEach(function (s) { if (s.hub) hubs[s.hub] = true; });

    var at = {};
    stations.forEach(function (a) { at[a.code] = a; });

    var lons = stations.map(function (a) { return a.lon; });
    var lats = stations.map(function (a) { return a.lat; });
    var lo0 = Math.min.apply(null, lons), lo1 = Math.max.apply(null, lons);
    var la0 = Math.min.apply(null, lats), la1 = Math.max.apply(null, lats);
    var spanLo = (lo1 - lo0) || 1, spanLa = (la1 - la0) || 1;

    var px = function (lo) { return PAD.l + (lo - lo0) / spanLo * (W - PAD.l - PAD.r); };
    var py = function (la) { return PAD.t + (la1 - la) / spanLa * (H - PAD.t - PAD.b); };

    svg.setAttribute("viewBox", "0 0 " + W + " " + H);

    // graticule — every 20° of longitude, every 10° of latitude
    var grid = mk("g", { class: "map-grat" });
    for (var lo = Math.ceil(lo0 / 20) * 20; lo <= lo1; lo += 20)
      grid.appendChild(mk("line", { x1: px(lo), y1: PAD.t - 8, x2: px(lo), y2: H - PAD.b + 8 }));
    for (var la = Math.ceil(la0 / 10) * 10; la <= la1; la += 10)
      grid.appendChild(mk("line", { x1: PAD.l - 16, y1: py(la), x2: W - PAD.r + 16, y2: py(la) }));
    svg.appendChild(grid);

    // airways — bowed so overlapping legs stay tellable apart
    var gl = mk("g", {});
    legs.forEach(function (l) {
      var a = at[(l.origin || "").toUpperCase()], b = at[(l.destination || "").toUpperCase()];
      if (!a || !b || a.code === b.code) return;
      var x1 = px(a.lon), y1 = py(a.lat), x2 = px(b.lon), y2 = py(b.lat);
      var dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      var k = Math.min(len * 0.13, 44) * (dx < 0 ? -1 : 1);
      var cx = (x1 + x2) / 2 - (dy / len) * k, cy = (y1 + y2) / 2 + (dx / len) * k;
      gl.appendChild(mk("path", {
        class: "map-leg", "data-service": l.service || "",
        d: "M" + x1 + " " + y1 + " Q" + cx + " " + cy + " " + x2 + " " + y2
      }));
    });
    svg.appendChild(gl);

    // which services touch each station
    var touches = {};
    legs.forEach(function (l) {
      [l.origin, l.destination].forEach(function (c) {
        c = (c || "").toUpperCase();
        if (!c) return;
        (touches[c] = touches[c] || {})[l.service] = true;
      });
    });

    // Stations close together — Amman and Tel Aviv are 112 km apart — would
    // print their codes on top of each other, so a label that lands near one
    // already placed is dropped below its station instead of above.
    var placed = [];
    function labelY(x, y) {
      var above = y - 9, below = y + 15;
      var clash = placed.some(function (p) {
        return Math.abs(p.x - x) < 26 && Math.abs(p.y - above) < 11;
      });
      var at = clash ? below : above;
      placed.push({ x: x, y: at });
      return at;
    }

    var gs = mk("g", {});
    stations.forEach(function (a) {
      var g = mk("g", {
        class: "map-stn" + (hubs[a.code] ? " hub" : ""),
        "data-service": Object.keys(touches[a.code] || {}).join("|")
      });
      g.appendChild(mk("circle", { cx: px(a.lon), cy: py(a.lat), r: hubs[a.code] ? 4.6 : 3.4 }));
      var t = mk("text", { x: px(a.lon), y: labelY(px(a.lon), py(a.lat)) });
      t.textContent = a.code;
      g.appendChild(t);
      var title = mk("title", {});
      title.textContent = a.code + " — " + a.name + ", " + a.city;
      g.appendChild(title);
      gs.appendChild(g);
    });
    svg.appendChild(gs);

    if (!legend) return;

    function highlight(id) {
      svg.querySelectorAll(".map-leg").forEach(function (p) {
        var on = p.getAttribute("data-service") === id;
        p.classList.toggle("on", on);
        p.classList.toggle("off", !on);
      });
      svg.querySelectorAll(".map-stn").forEach(function (n) {
        var on = (n.getAttribute("data-service") || "").split("|").indexOf(id) > -1;
        n.classList.toggle("on", on);
        n.classList.toggle("off", !on);
      });
    }
    function clear() {
      svg.querySelectorAll(".map-leg,.map-stn").forEach(function (n) {
        n.classList.remove("on", "off");
      });
    }

    services.forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "map-chip";
      b.innerHTML = '<span class="map-chip-em"></span><span class="map-chip-id"></span>';
      b.firstChild.textContent = (s.emblem || "").toLowerCase().replace(/^./, function (c) {
        return c.toUpperCase();
      });
      b.lastChild.textContent = s.service;
      b.addEventListener("mouseenter", function () { highlight(s.service); });
      b.addEventListener("focus", function () { highlight(s.service); });
      b.addEventListener("mouseleave", clear);
      b.addEventListener("blur", clear);
      legend.appendChild(b);
    });
  }

  return { draw: draw };
})();
