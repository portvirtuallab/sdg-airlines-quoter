/* SDG AIRLINES — rotation schedule engine.

   A service is a closed loop: an ordered list of legs whose ground and flight
   times add up to a whole number of days. Given a seed instant, every flight
   on any date is arithmetic - no stored timetable, no expiry window.

   A rotation is flown under one flight number, so boarding at one stop and
   leaving at a later stop of the same rotation is ONE flight with intermediate
   stops, not several connections. Only changing aircraft counts as a jump. */

(function (root) {
  "use strict";

function buildNetwork({ airports, services, legs, rotations }) {
  const loops = new Map();
  for (const s of services) {
    loops.set(s.service, legs
      .filter(l => l.service === s.service)
      .sort((a, b) => Number(a.seq) - Number(b.seq))
      .map(l => ({
        service: s.service, origin: l.origin, destination: l.destination,
        flightNumber: l.flight_number || "", bound: l.bound || "",
        km: Number(l.km) || 0,
        ground: Number(l.ground_seconds) * 1000,
        flight: Number(l.flight_seconds) * 1000,
      })));
  }

  // A rotation chains one or more service loops into a single closed circuit.
  const fleet = rotations.map(r => {
    const chain = [];
    let acc = 0;
    for (const name of String(r.services).split("|")) {
      for (const leg of loops.get(name) || []) {
        chain.push({ ...leg, depOff: acc + leg.ground, arrOff: acc + leg.ground + leg.flight });
        acc += leg.ground + leg.flight;
      }
    }
    return {
      aircraft: r.aircraft, model: r.model, tail: r.tail,
      services: String(r.services).split("|"),
      cycleMs: Number(r.cycle_days) * 86400000,
      seedMs: Date.parse(r.seed_utc),
      legs: chain,
      loopMs: acc,
    };
  });

  const utc = new Map(airports.map(a => [a.code, Number(a.utc_offset) || 0]));
  return { fleet, loops, utcOffset: c => utc.get(c) ?? 0, airports, services };
}

/* Through-flights leaving `airport` in a window.
   Each result carries every downstream stop it serves. */
function flightsFrom(net, airport, fromMs, toMs, maxStops = 10) {
  const out = [];
  for (const ac of net.fleet) {
    ac.legs.forEach((leg, i) => {
      if (leg.origin !== airport) return;
      const base = ac.seedMs + leg.depOff;
      let k = Math.ceil((fromMs - base) / ac.cycleMs);
      for (let dep = base + k * ac.cycleMs; dep <= toMs; dep += ac.cycleMs) {
        const shift = dep - base;
        const stops = [];
        for (let n = 1; n <= maxStops && i + n <= ac.legs.length; n++) {
          const l = ac.legs[i + n - 1];
          if (l.service !== leg.service) break;            // a new service is a new flight
          if (l.destination === airport) break;            // back at the boarding point
          stops.push({
            airport: l.destination,
            arrivalUTC: ac.seedMs + l.arrOff + shift,
            km: ac.legs.slice(i, i + n).reduce((s, x) => s + x.km, 0),
            stopIndex: n - 1,
          });
        }
        if (stops.length) out.push({
          service: leg.service, aircraft: ac.aircraft, model: ac.model, tail: ac.tail,
          flightNumber: leg.flightNumber, bound: leg.bound,
          origin: airport, departureUTC: dep, stops,
        });
      }
    });
  }
  return out.sort((a, b) => a.departureUTC - b.departureUTC);
}

/* Earliest arrival with at most `maxJumps` flights. */
function route(net, origin, destination, notBeforeMs, opts = {}) {
  const maxJumps = opts.maxJumps ?? 3;
  const minConnect = (opts.minConnectMinutes ?? 90) * 60000;
  const horizon = (opts.horizonDays ?? 30) * 86400000;

  let frontier = [{ at: origin, time: notBeforeMs, path: [] }];
  const seenAt = new Map([[origin, notBeforeMs]]);
  let best = null;

  for (let depth = 0; depth < maxJumps && frontier.length; depth++) {
    const next = [];
    for (const node of frontier) {
      const earliest = node.path.length ? node.time + minConnect : node.time;
      for (const f of flightsFrom(net, node.at, earliest, node.time + horizon)) {
        // The same tail on a later rotation is a genuine connection: you land,
        // wait for the next day's service and board again. Only revisiting an
        // airport already on the itinerary is disallowed.
        for (const s of f.stops) {
          if (node.path.some(p => p.origin === s.airport)) continue;
          const hop = {
            service: f.service, aircraft: f.aircraft, model: f.model, tail: f.tail,
            flightNumber: f.flightNumber, origin: f.origin, destination: s.airport,
            departureUTC: f.departureUTC, arrivalUTC: s.arrivalUTC,
            km: s.km, viaCount: s.stopIndex,
            via: f.stops.slice(0, s.stopIndex).map(x => x.airport),
          };
          const cand = { at: s.airport, time: s.arrivalUTC, path: [...node.path, hop] };
          if (s.airport === destination) {
            if (!best || cand.time < best.time) best = cand;
            continue;
          }
          if (best && cand.time >= best.time) continue;
          const prev = seenAt.get(s.airport);
          if (prev !== undefined && cand.time >= prev) continue;
          seenAt.set(s.airport, cand.time);
          next.push(cand);
        }
      }
    }
    frontier = next.sort((a, b) => a.time - b.time).slice(0, 60);
  }
  if (!best) return null;
  const legs = best.path;
  return {
    origin, destination, jumps: legs.length, legs,
    departureUTC: legs[0].departureUTC, arrivalUTC: best.time,
    transitSeconds: (best.time - legs[0].departureUTC) / 1000,
    km: legs.reduce((s, l) => s + l.km, 0),
  };
}

  function localTime(ms, offsetHours) {
    return new Date(ms + (offsetHours || 0) * 3600000).toISOString().replace("T", " ").slice(0, 16);
  }

  root.SDGNetwork = {
    buildNetwork: buildNetwork,
    flightsFrom: flightsFrom,
    route: route,
    localTime: localTime,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
