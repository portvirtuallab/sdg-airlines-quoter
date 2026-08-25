/* Checks the rotation engine against the timetable the spreadsheet published.
   Run: node scripts/test_network.mjs                                        */
import fs from "node:fs";
import { buildNetwork, flightsFrom, route } from "../docs/assets/js/network.js";

const csv = f => {
  const [h, ...rows] = fs.readFileSync(f, "utf8").trim().split("\n");
  const cols = h.split(",");
  const split = line => {
    const out = []; let cur = "", q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur); return out;
  };
  return rows.map(r => Object.fromEntries(split(r).map((v, i) => [cols[i], v])));
};
const D = "data/network/";
const airports = csv(D + "airports.csv").filter(a => a.active === "yes");
const net = buildNetwork({
  airports, services: csv(D + "services.csv"),
  legs: csv(D + "legs.csv"), rotations: csv(D + "rotations.csv"),
});
const codes = airports.map(a => a.code);
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};

console.log("Rotations");
for (const ac of net.fleet) {
  const drift = ac.loopMs - ac.cycleMs;
  check(`${ac.aircraft.padEnd(10)} ${ac.services.join(" + ").padEnd(24)} ${ac.legs.length} legs`,
        Math.abs(drift) < 120000, `closes to ${(ac.cycleMs / 864e5)} day(s), drift ${(drift / 60000).toFixed(1)} min`);
}

console.log("\nClock stability over 90 days");
const t0 = Date.parse("2026-09-01T00:00:00Z");
const clocks = new Map();
for (const c of codes)
  for (const f of flightsFrom(net, c, t0, t0 + 90 * 864e5)) {
    const k = `${f.aircraft}|${f.origin}|${f.stops[0].airport}|${f.service}`;
    (clocks.get(k) ?? clocks.set(k, new Set()).get(k)).add(f.departureUTC % 864e5);
  }
const wobbly = [...clocks].filter(([, v]) => v.size > 1);
check(`every rotation departs at a fixed local clock time`, wobbly.length === 0,
      `${clocks.size - wobbly.length}/${clocks.size} stable`);

console.log("\nReachability, every ordered pair");
let unreachable = [];
for (const o of codes) for (const d of codes) {
  if (o === d) continue;
  if (!route(net, o, d, t0, { horizonDays: 30 })) unreachable.push(`${o}-${d}`);
}
check(`all ${codes.length * (codes.length - 1)} pairs routable`, unreachable.length === 0,
      unreachable.length ? unreachable.slice(0, 8).join(" ") : "");

console.log("\nRouting matches the historical quotations");
const known = [
  ["BCN", "BEY", ["Olivia", "Maria"]],
  ["ATH", "BEY", ["Olivia", "Maria"]],
  ["MRS", "TUN", null],
];
for (const [o, d, want] of known) {
  const r = route(net, o, d, t0);
  const got = r ? r.legs.map(l => l.aircraft) : [];
  const path = r ? r.legs.map(l => `${l.origin}-${l.destination}${l.via.length ? "(" + l.via.length + " stops)" : ""}`).join(" + ") : "none";
  check(`${o} to ${d}`, !!r && (!want || want.every((w, i) => got[i] === w)),
        `${r ? r.jumps : 0} flight(s), ${r ? (r.transitSeconds / 3600).toFixed(0) : "-"} h : ${path}`);
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks pass");
process.exit(failed ? 1 : 0);
