# SDG Airlines — Air Cargo Rating Desk

Air cargo quotation tool for the fictional carrier **SDG Airlines**, used in the
**Port Virtual Lab** courses at Escola Europea – Intermodal Transport.

| Page | What it does |
|---|---|
| `docs/quote.html` | Full origin-to-destination quotation: weight charge with rate bands and weight breaks, surcharges, origin handling and every destination charge |
| `docs/arrival.html` | Destination charges only |

**The core idea:** tariffs live in three CSV files. Adding an airport means
adding a row. Nobody touches JavaScript.

The output is styled as a real air waybill rate line, so students read the same
document they will meet in the industry.

---

## Adding a station

Three rows. Example, Dakar (DKR):

**1 — `data/network/airports.csv`**

```csv
DKR,GOBD,Blaise Diagne International,DAKAR,Senegal,14.67,-17.07,0,WEST AFRICA,no,yes,AIBD SA,,,yes
```

**2 — `data/tariffs/ground_charges.csv`** — ground handling tariff at that station:

```csv
DKR,EUR,29.00,0.21,37.10,0.15,46.00,41.00,0.14,0,37.10,1.15,0.040,1.60,0.043,1.60,0.043,41.0,12.0,23.0,5,44,21,31,4,44,14,23.0,6,0,38.00
```

**3 — `data/tariffs/freight_rates.csv`** — what it costs to fly there:

```csv
BCN,DKR,95,6.20,5.40,5.10,4.80
```

Commit those three rows. GitHub Actions runs the build, validates the figures
and publishes. **You do not need Python on your own machine** — the workflow
runs it for you.

If something is missing, the build stops before anything goes live:

```
  ERROR    DKR is active in airports.csv but has no row in arrival_charges.csv
✘ 1 error(s). Nothing was written.
```

**To retire a station** without losing its history, set `active` to `no`. It
disappears from the interface and the row stays in the repository.

---

## Freight rates: wildcards and contracts

`freight_rates.csv` holds one row per ordered pair, 650 in all, straight from
the carrier tariff. The engine also accepts `*` as the origin, meaning "from
anywhere on the network", so a new station needs one wildcard row rather than
fifty:

```csv
origin,destination,minimum,rate_under_100,rate_100_299,rate_300_499,rate_500_plus
*,DKR,95,6.20,5.40,5.10,4.80      ← anywhere to Dakar
BCN,DKR,88,5.90,5.10,4.80,4.55    ← negotiated BCN-Dakar rate
```

The exact pair always wins over the wildcard. To negotiate one lane in class,
add one row.

---

## Running it

```bash
git clone https://github.com/<user>/sdg-airlines-quoter.git
cd sdg-airlines-quoter
python scripts/build.py
python -m http.server 8080 --directory docs   # open http://localhost:8080
```

**Publishing:** Settings → Pages → Source: *GitHub Actions*. The `ci.yml`
workflow validates, tests and deploys on every push to `main`.

---

## Where the data comes from

Set in `data/config.json` → `data_source.mode`:

**`local`** (default) — the site reads `docs/data/tariffs.json`, built from the
CSVs. Fast, works offline, every change is in the git history.

**`sheet`** — the site reads the Google Sheet live over `gviz`. Edit the sheet,
reload the page, done. The document must be shared as *anyone with the link can
view*, and the tabs must be named `airports`, `arrival_charges` and `routes`
with the same headers as the CSVs. If the sheet does not answer, the site falls
back to the bundled copy on its own.

Force it without touching the config: `quote.html?source=sheet`.

**Scheduled sync** — the `sync-sheet.yml` workflow pulls the sheet and opens a
pull request with the diff. People edit in Sheets, the repository keeps the
history, and someone reviews before it goes live.

---

## How the numbers are worked out

**Chargeable weight** — actual weight against volumetric (L × W × H ÷ 167, the
IATA factor, configurable); the greater one wins, rounded up to the half kilo.

**Rate bands** — under 100, 100–299, 300–499 and 500 kg and over, always
against a minimum charge per shipment.

**Weight break** — when rating at the next breakpoint costs less, the engine
spots it and quotes the lower figure. Standard air cargo practice, and it shows
well in class: 95 kg to Lisbon is rated as 100 kg and the shipment drops from
897.75 to 300 EUR.

**Rate class** — the quote shows the AWB rate class: **M** when the minimum
charge applies, **N** for a normal rate below 100 kg, **Q** for a quantity rate.

**Surcharges** — emissions by the kilometre, then X-ray screening, the airport
surcharge and the customs cost as flat figures, all in `surcharges.csv`. Each
can carry a `minimum`: screening is floored at 54.00, because putting a
shipment through the machine costs much the same whatever its size.

**Dangerous goods** — on top of the higher handling and storage tariffs, a flat
acceptance fee covering the first ten pieces and a rate on every piece beyond
them, charged **at both ends**. Twelve pieces is 35.00 + 2 × 2.50 at origin and
the same again at destination. Priced on pieces rather than weight, because the
work is the paperwork and the segregation. Set in `config.json →
dangerous_goods`.

**One air waybill** — every quotation is a single MAWB, so the charges that
used to be multiplied by the number of waybills are quoted once.

**Storage** — free days first, then days 1–20 at one rate and day 21 onward at
a higher one, per 100 kg or part thereof, plus the fee per MAWB. All three
families come straight from the original workbook: general cargo, cool chamber
and dangerous goods, for all 26 stations.

**Currency** — everything is computed in the base currency and converted at the
end using the rate in `config.json`.

The figures are checked against the original workbook:

```bash
node scripts/test_engine.mjs
```

---

## Incoterms

The quotation asks for an Incoterm — FCA, CPT, CIP, DAP or DDP, the Incoterms
2020 recommends for air cargo — and marks every charge with the party that
bears it, with a subtotal for each side.

**The total never changes.** The same shipment costs the same under every
Incoterm; what moves is where the line between seller and buyer falls. BCN to
Lisbon with 100 kg is 611.93 throughout, split 39.00 / 572.93 under FCA,
537.44 / 74.49 under DAP and 611.93 / nothing under DDP.

Under **FCA** the buyer contracts the carriage, so everything the carrier
raises at origin — terminal handling and dangerous goods acceptance included —
is the buyer's. The seller is left with the export formalities and getting the
cargo to the airport, which is what the term says.

Who pays what lives in `data/incoterms.csv`, one row per charge and one column
per Incoterm:

```csv
code,label,stage,FCA,CPT,CIP,DAP,DDP
TH,Terminal handling at origin,origin,buyer,seller,seller,seller,seller
WT,Air freight,origin,buyer,seller,seller,seller,seller
CH,Import customs clearance,arrival,buyer,buyer,buyer,buyer,seller
```

So the allocation is arguable in a spreadsheet rather than buried in
JavaScript — useful, because several of these calls genuinely are debatable.
The build refuses to publish if the engine can quote a charge that has no row.

Three lines carry no amount and exist so the Incoterm reads honestly:
pre-carriage, on-carriage and import duties. A DAP quotation that silently
omitted on-carriage would teach the wrong lesson. They read **Not included**
and say why — the airline does not sell road transport, and duties are settled
with the customs authority — linking to the road haulier set in
`config.json → partners.road_haulier`. Leave the `url` blank and the lines
still appear, simply without a link.

This matters most under **DDP**, where all three fall to the seller: the duties
are settled with the customs authority and the final truck is booked with the
haulier, neither of them by this airline. The quotation says so on the line
rather than leaving the seller to find out.

**Arrival charges are unaffected.** `arrival.html` takes no Incoterm and looks
exactly as it always did, so a student who only wants the destination figure
does not have to build a whole quotation. Both pages call the same engine
function, so the numbers agree to the cent.

**CIP needs a rate.** CIP differs from CPT only by the insurance the seller
takes out, and `config.json → insurance` ships at zero, so the line appears
flagged and the two Incoterms cost the same. Set
`pct_of_insured_value` to separate them.

---

## The consignment

Each line carries a **description of the goods** and an **HS code** beside the
pieces, weight and dimensions. Both are free text and neither touches the
arithmetic; the description is printed on the quotation under *Nature and
quantity of goods*, which is box 22 of an air waybill, and the HS code is what
customs would rate the duty on.

**Loose cargo only.** The airline does not offer unitised cargo, so truck
loading at destination is always rated on the bulk tariff and there is no ULD
count to enter. The `truck_uld_*` columns stay in `ground_charges.csv` against
the day ULDs are offered again.

---

## Charge codes

Quotations use IATA-style codes so the breakdown reads like a real one.

| Code | Charge |
|---|---|
| `WT` | Air freight (weight charge) |
| `DGO` / `DGD` | Dangerous goods, origin and destination |
| `AW` | Air waybill fee |
| `TH` | Terminal handling at origin |
| `SD` | Security at arrival |
| `CH` | Customs clearance formalities |
| `DB` | Import documentation handling |
| `LB` | Truck loading, loose cargo |
| `XR` | X-ray screening |
| `TD` | Terminal handling at destination |
| `ST` | Storage |

---

## Layout

```
data/                     ← the source of truth, the only files edited day to day
  config.json               currencies, volumetric factor, commodity types
  network/
    airports.csv            the station network, with UTC offset and customs status
    services.csv            the six services, their hub and emblem
    legs.csv                the 40 legs that make up the six rotation loops
    rotations.csv           which aircraft flies which loop, and from when
    aircraft_types.csv      the fleet types
    distances.csv           great-circle distances between stations
    customs_regime.csv      WCO or Schengen by O/D pair
    customs_documents.csv   the paperwork link by O/D pair
  tariffs/
    ground_charges.csv      handling tariffs by station
    freight_rates.csv       freight rates by O/D pair
    surcharges.csv          ETS, screening, control, peak season
scripts/
  build.py                  CSV → docs/data/tariffs.json, with validation
  sync_sheet.py             Google Sheet → CSV
  import_xlsx.py            exported .xlsx → CSV, one-off migration
  build_gas.py              docs/ → self-contained gas/ for Apps Script
  test_engine.mjs           checks against the original workbook figures
  test_network.mjs          checks the rotations close and every pair routes
docs/                     ← what GitHub Pages publishes
  index.html                rating desk
  quote.html                full quotation, routing and email
  arrival.html              arrival charges
  assets/js/engine.js       charges: freight, surcharges, handling, storage
  assets/js/network.js      rotations, schedules and routing with connections
  assets/js/data.js         loads locally or from the sheet
  assets/js/ui.js           forms and the quotation document
  assets/css/sdg.css        the visual system
  data/tariffs.json         generated — do not edit by hand
gas/                      ← optional Apps Script deployment
```

---

## Staying on Google Apps Script

If access has to be restricted to the organisation, the project still runs on
Apps Script. Since Apps Script cannot serve static files, a bundler inlines the
CSS, JS and tariffs into each page:

```bash
python scripts/build.py
python scripts/build_gas.py
cd gas && clasp push && clasp deploy
```

`gas/Code.gs` keeps the old links alive: `?page=quoter` reaches the full
quotation and `?page=calculator` the arrival charges.

---

## Emailing the quotation

`gas/Backend.gs` replaces Document Studio. The student fills in the form, enters
their institution's PIN and an email address, and gets the PDF in their inbox.

The PIN list lives in a Google Sheet that only the script can read, so a student
cannot pull the other institutions' codes out of the page source. The page sends
a PIN and gets back yes or no, nothing else.

**Setting it up:**

1. Create a spreadsheet. Put its id in `SHEET_ID` at the top of `gas/Backend.gs`.
2. Add a tab called `Institutions` with these headers in row 1:
   `institution | pin | contact_email | active`, one row per school.
3. Push the script with clasp, then **Deploy → New deployment → Web app**,
   executing as *Me*, access *Anyone*.
4. Paste the `/exec` URL into `data/config.json` → `quote.endpoint`, commit.

Leave `endpoint` blank and the email panel simply does not appear, so the site
still works before the backend is wired up.

## The PIN gate and the operations register

Rating a shipment asks for a name, an email address and a **Port Virtual Lab
PIN**, on both tools. The PIN is checked before anything is shown: get it
wrong and the quotation does not appear. Every accepted calculation is written
to the operations register, so the log answers who used the tools, for what,
and when.

**The check cannot live in this repository.** A page served by GitHub Pages
that validated PINs in JavaScript would carry the list in its own source, and
any student could read it. So `gas/Backend.gs` holds it: the page sends a code
and gets back yes or no, and the sheet stays private.

Two spreadsheets, both of which should stay private:

```js
var PIN_SHEET_ID = '…';   // codes down column A of the SHEET VERIFICATION tab
var LOG_SHEET_ID = '…';   // the register. It will hold names and addresses.
```

The register keeps every row. Set `LOG_KEEP` to a number if you would rather
have a rolling window.

**Until the endpoint is set the gate does not appear at all** and both tools
work exactly as before, so nothing is blocked while this is being wired up.
Deploy the script as a web app, executing as *Me*, access *Anyone*, and paste
the `/exec` URL into `config.json → quote.endpoint`.

---

## The quotation log

Every quotation sent is appended to a `Quotation log` tab: reference, institution,
route, weights, aircraft, dates, customs regime and total. Data only — **no PDFs
are stored**, they are emailed and forgotten.

The tab keeps the **50 most recent** rows and deletes the older ones on each new
request. It is a rolling window for seeing what students are doing this week, not
an archive. Change `LOG_KEEP` in `gas/Backend.gs` if you want a different depth.

---

## Not included in a quotation

Inland trucking, door delivery, import duties, VAT and customs taxes. Inland
transport is quoted separately.

---

Training tool. All tariffs are indicative and the carrier is fictional. Not for
commercial use.
