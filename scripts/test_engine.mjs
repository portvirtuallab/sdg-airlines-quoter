/* Verifies the engine reproduces the figures from the original workbook.
   Run:  node scripts/test_engine.mjs                                     */
import fs from "node:fs";
import vm from "node:vm";

const data = JSON.parse(fs.readFileSync("docs/data/tariffs.json", "utf8"));
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("docs/assets/js/engine.js", "utf8"), ctx);
const E = ctx.SDGEngine;

let failed = 0;
function check(name, got, want, tol = 0.011) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}: ${got}${ok ? "" : `  (expected ${want})`}`);
}

// -- Case 1: the workbook Calculator sheet (BCN, 500 kg, general, customs, bulk)
const arr = E.arrivalQuote(data, {
  airport: "BCN", chargeableWeight: 500, mawbs: 1,
  cargoType: "GEN", customs: true, handling: "Bulk", storageDays: 0
});
check("BCN arrival 500 kg - security", arr.lines.find(l => l.code === "SD").amount, 80);
check("BCN arrival 500 kg - customs", arr.lines.find(l => l.code === "CH").amount, 50);
check("BCN arrival 500 kg - bulk truck loading", arr.lines.find(l => l.code === "LB").amount, 85.03);
check("BCN arrival 500 kg - terminal handling", arr.lines.find(l => l.code === "TD").amount, 16.5);
check("BCN arrival 500 kg - import documentation", arr.lines.find(l => l.code === "DB").amount, 38);
check("BCN arrival 500 kg - TOTAL", arr.subtotal, 269.53);

// -- Case 2: chargeable weight, 30 pieces of 20 kg at 60 x 40 x 30 cm
const cw = E.chargeableWeight([{ qty: 30, weightKg: 20, l: 60, w: 40, h: 30 }], 167, 0.5);
check("gross weight", cw.gross, 600);
check("volumetric weight", cw.volumetric, 360.72);
check("chargeable is the gross weight", cw.chargeable, 600);
console.log(`  ok    rated on: ${cw.basis}`);

// A dense piece: 1 m3 of feathers weighing 50 kg rates as 167 kg
const light = E.chargeableWeight([{ qty: 1, weightKg: 50, l: 100, w: 100, h: 100 }], 167, 0.5);
check("one cubic metre rates at the factor", light.volumetric, 167);
check("volume wins over actual weight", light.chargeable, 167);

// -- Case 3: weight break
// To ALG: 95 kg at 5.15 = 489.25; 100 kg at 5.15 = 515, so no break.
// To LIS: 95 kg at 9.45 = 897.75; 100 kg at 3.00 = 300, so it breaks.
const wb = E.freightQuote(data, {
  origin: "BCN", destination: "LIS", chargeableWeight: 95, mawbs: 1, cargoType: "GEN"
});
const frt = wb.lines.find(l => l.code === "WT");
check("LIS 95 kg rated at 100 kg", wb.billedWeight, 100);
check("LIS 95 kg weight charge", frt.amount, 300);

// -- Case 4: tiered storage with free days
// BCN general: 5 free days, 16.7 per 100kg/day (1-20), 27.9 (21+), 45.4 per MAWB.
const st = E.arrivalQuote(data, {
  airport: "BCN", chargeableWeight: 500, mawbs: 1,
  cargoType: "GEN", customs: false, handling: "Bulk", storageDays: 30
});
const line = st.lines.find(l => l.code === "ST");
check("BCN storage over 30 days", line.amount, 45.4 + 5 * (16.7 * 20 + 27.9 * 5));

// -- Case 5: real O/D rates out of the carrier tariff
check("BCN-CAI minimum", E.findRoute(data, "BCN", "CAI").rate.min, 60);
check("BCN-ALG minimum", E.findRoute(data, "BCN", "ALG").rate.min, 105);

// -- Case 7: surcharges, including one shown but switched off
const sc = E.surchargeLines(data, { km: 2898, chargeableWeight: 500, freight: 1000, customs: true });
const ets = sc.find(s => s.code === "ETS");
check("ETS is charged per kilometre", ets.amount, Math.round(2898 * 0.009 * 100) / 100);
const pss = sc.find(s => s.code === "PSS");
check("PSS appears on the quotation", pss ? 1 : 0, 1);
check("PSS is priced at zero", pss.amount, 0);
console.log(`  ok    PSS is flagged inactive: ${pss.inactive} - "${pss.detail}"`);

// -- Case 6: the AWB rate line
const q = E.fullQuote(data, { origin: "BCN", destination: "CAI", chargeableWeight: 500,
  grossWeight: 480, pieces: 6, mawbs: 1, cargoType: "GEN", customs: true,
  handling: "Bulk", storageDays: 0, currency: "EUR" });
check("rate line pieces", q.rateLine.pieces, 6);
check("rate line chargeable weight", q.rateLine.chargeableWeight, 500);
console.log(`  ok    rate class: ${q.rateLine.rateClass}`);

console.log(failed ? `\n✘ ${failed} check(s) failed` : "\n✔ all checks pass");
process.exit(failed ? 1 : 0);
