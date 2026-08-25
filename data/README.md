# Diccionario de datos

Todos los importes están en la moneda de `currency` (por defecto EUR) y todas
las tarifas por kilo se aplican sobre el **peso facturable**.

## airports.csv

| columna | qué es |
|---|---|
| `code` | código IATA de 3 letras, en mayúsculas. Es la clave de todo |
| `name` | nombre de la ciudad o el aeropuerto |
| `country` | país, se muestra en el desplegable |
| `region` | agrupa el desplegable. Texto libre: `Europe`, `North Africa`, `Asia`… |
| `active` | `yes` o `no`. Un `no` lo saca de la interfaz sin borrar el histórico |

## arrival_charges.csv

Una fila por aeropuerto. `code` debe existir en `airports.csv`.

| grupo | columnas | fórmula |
|---|---|---|
| Seguridad | `sec_min`, `sec_rate` | máx(mínimo, tarifa × kg) |
| Aduana | `cus_min`, `cus_rate` | máx(mínimo, tarifa × kg) |
| Camión granel | `truck_bulk_min`, `truck_bulk_fee_mawb`, `truck_bulk_rate` | máx(mínimo, cuota × MAWB + tarifa × kg) |
| Camión ULD | `truck_uld_min`, `truck_uld_fee` | máx(mínimo, cuota × nº ULD) |
| THC general | `thc_gen_min`, `thc_gen_rate` | máx(mínimo, tarifa × kg) |
| THC mercancías peligrosas | `thc_dg_min`, `thc_dg_rate` | ídem |
| THC farma / temperatura | `thc_pha_min`, `thc_pha_rate` | ídem |
| Almacenaje general | `st_gen_mawb_fee`, `st_gen_rate_1_20`, `st_gen_rate_21plus`, `st_gen_free_days` | cuota × MAWB + unidades de 100 kg × (tarifa tramo 1 × días 1–20 + tarifa tramo 2 × días restantes) |
| Almacenaje cámara de frío | `st_cool_*` | ídem |
| Almacenaje mercancías peligrosas | `st_dg_*` | ídem |
| Documentos de importación | `imp_doc_min`, `imp_doc_fee` | máx(mínimo, cuota × MAWB) |

Los días libres se descuentan de los días totales antes de repartir por tramos.

## routes.csv

| columna | qué es |
|---|---|
| `origin` | código IATA, o `*` para «desde cualquier aeropuerto» |
| `destination` | código IATA |
| `min_charge` | mínimo por envío, gana si el cálculo por kilo queda por debajo |
| `rate_under_100` | €/kg por debajo de 100 kg |
| `rate_100_299` | €/kg de 100 a 299 kg |
| `rate_300_499` | €/kg de 300 a 499 kg |
| `rate_500_plus` | €/kg a partir de 500 kg |
| `fsc_per_kg` | recargo de combustible por kilo |
| `ssc_per_kg` | recargo de seguridad por kilo |
| `transit_days` | días de tránsito, informativo |
| `notes` | texto libre, no se muestra al alumno |

Una fila `origin,destination` concreta siempre gana sobre la fila `*` del mismo
destino. El build avisa si los tramos no son decrecientes.
