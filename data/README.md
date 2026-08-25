# Data dictionary

All figures are in the currency given by `currency` (EUR by default) and every
per-kilo rate applies to the **chargeable weight**.

## airports.csv

| column | meaning |
|---|---|
| `code` | three-letter IATA code, uppercase. This is the key to everything |
| `name` | city or airport name |
| `country` | shown in the dropdown |
| `region` | groups the dropdown. Free text: `Europe`, `North Africa`, `Asia`… |
| `active` | `yes` or `no`. A `no` removes it from the interface without losing history |

## arrival_charges.csv

One row per station. `code` must exist in `airports.csv`.

| group | columns | formula |
|---|---|---|
| Security | `sec_min`, `sec_rate` | greater of minimum or rate × kg |
| Customs | `cus_min`, `cus_rate` | greater of minimum or rate × kg |
| Truck loading, bulk | `truck_bulk_min`, `truck_bulk_fee_mawb`, `truck_bulk_rate` | greater of minimum or fee × MAWB + rate × kg |
| Truck loading, ULD | `truck_uld_min`, `truck_uld_fee` | greater of minimum or fee × ULDs |
| Terminal handling, general | `thc_gen_min`, `thc_gen_rate` | greater of minimum or rate × kg |
| Terminal handling, dangerous goods | `thc_dg_min`, `thc_dg_rate` | same |
| Terminal handling, pharma and temperature | `thc_pha_min`, `thc_pha_rate` | same |
| Storage, general | `st_gen_mawb_fee`, `st_gen_rate_1_20`, `st_gen_rate_21plus`, `st_gen_free_days` | fee × MAWB + units of 100 kg × (tier 1 rate × days 1–20 + tier 2 rate × remaining days) |
| Storage, cool chamber | `st_cool_*` | same |
| Storage, dangerous goods | `st_dg_*` | same |
| Import documentation | `imp_doc_min`, `imp_doc_fee` | greater of minimum or fee × MAWB |

Free days are deducted from the total before the tiers are applied.

## routes.csv

| column | meaning |
|---|---|
| `origin` | IATA code, or `*` for "from anywhere on the network" |
| `destination` | IATA code |
| `min_charge` | minimum per shipment; wins when the per-kilo figure falls below it |
| `rate_under_100` | per kg below 100 kg |
| `rate_100_299` | per kg from 100 to 299 kg |
| `rate_300_499` | per kg from 300 to 499 kg |
| `rate_500_plus` | per kg from 500 kg |
| `fsc_per_kg` | fuel surcharge per kg |
| `ssc_per_kg` | security surcharge per kg |
| `transit_days` | transit time, informational |
| `notes` | free text, never shown to students |

A specific `origin,destination` row always beats the `*` row for the same
destination. The build warns when rate bands do not decrease.
