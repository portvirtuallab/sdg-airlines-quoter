/* Comprueba que el motor reproduce los números del Excel original.
   Uso:  node scripts/test_engine.mjs                                    */
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
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}: ${got}${ok ? "" : `  (esperado ${want})`}`);
}

// ── Caso 1: hoja Calculator del Excel (BCN, 500 kg, general, aduana, granel)
const arr = E.arrivalQuote(data, {
  airport: "BCN", chargeableWeight: 500, mawbs: 1,
  cargoType: "GEN", customs: true, handling: "Bulk", storageDays: 0
});
check("BCN llegada 500 kg — seguridad", arr.lines.find(l => l.code === "SEC").amount, 80);
check("BCN llegada 500 kg — aduana", arr.lines.find(l => l.code === "CUS").amount, 50);
check("BCN llegada 500 kg — camión granel", arr.lines.find(l => l.code === "TRK").amount, 85.03);
check("BCN llegada 500 kg — THC", arr.lines.find(l => l.code === "THC-ARR").amount, 16.5);
check("BCN llegada 500 kg — documentos", arr.lines.find(l => l.code === "DOC").amount, 38);
check("BCN llegada 500 kg — TOTAL", arr.subtotal, 269.53);

// ── Caso 2: peso facturable por volumen
const cw = E.chargeableWeight([{ qty: 4, weightKg: 100, l: 120, w: 100, h: 100 }], 167, 0.5);
check("peso bruto", cw.gross, 400);
check("peso volumétrico", cw.volumetric, 4 * (120 * 100 * 100) / 167);
check("peso facturable = volumétrico", cw.chargeable, Math.ceil((4 * 1200000 / 167) / 0.5) * 0.5);

// ── Caso 3: salto de tramo (weight break)
// A ALG: 95 kg a 5.15/kg = 489.25 ; facturar 100 kg a 5.15 = 515 → no compensa.
// A LIS: 95 kg a 9.45 = 897.75 ; 100 kg a 3.00 = 300 → sí compensa.
const wb = E.freightQuote(data, {
  origin: "BCN", destination: "LIS", chargeableWeight: 95, mawbs: 1, cargoType: "GEN"
});
const frt = wb.lines.find(l => l.code === "FRT");
check("LIS 95 kg factura a 100 kg", wb.billedWeight, 100);
check("LIS 95 kg importe flete", frt.amount, 300);

// ── Caso 4: almacenaje por tramos con días libres
// BCN general: 5 días libres, 16.7/100kg/día (1–20), 27.9 (>20), 45.4 por MAWB.
const st = E.arrivalQuote(data, {
  airport: "BCN", chargeableWeight: 500, mawbs: 1,
  cargoType: "GEN", customs: false, handling: "Bulk", storageDays: 30
});
const line = st.lines.find(l => l.code === "STO");
check("BCN almacenaje 30 días", line.amount, 45.4 + 5 * (16.7 * 20 + 27.9 * 5));

// ── Caso 5: override de par O/D
const ov = E.findRoute(data, "BCN", "CAI");
check("override BCN–CAI activo", ov.rate.min, 55);
const def = E.findRoute(data, "MAD", "CAI");
check("MAD–CAI usa la tarifa general", def.rate.min, 60);

console.log(failed ? `\n✘ ${failed} comprobación(es) fallidas` : "\n✔ todas las comprobaciones pasan");
process.exit(failed ? 1 : 0);
