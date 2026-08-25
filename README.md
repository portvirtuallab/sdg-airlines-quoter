# SDG Airlines — Air Cargo Quotation Suite

Cotizador de carga aérea de la aerolínea ficticia **SDG Airlines**, usado en los
cursos del **Port Virtual Lab** de Escola Europea – Intermodal Transport.

Dos herramientas sobre un mismo motor:

| Página | Qué hace |
|---|---|
| `docs/quote.html` | Cotización completa origen → destino: flete con tramos de peso, recargos, THC en salida y cargos de llegada |
| `docs/arrival.html` | Sólo cargos de llegada en el aeropuerto de destino |

**La idea central:** las tarifas viven en tres CSV. Añadir un aeropuerto es
añadir una fila. Nadie toca JavaScript.

---

## Añadir un aeropuerto nuevo

Tres filas y un comando. Ejemplo con Dakar (DKR):

**1 — `data/airports.csv`**

```csv
DKR,DAKAR,Senegal,West Africa,yes
```

**2 — `data/arrival_charges.csv`** — una fila con las tarifas de handling en destino:

```csv
DKR,EUR,29.00,0.21,37.10,0.15,46.00,41.00,0.14,0,37.10,1.15,0.040,1.60,0.043,1.60,0.043,41.0,12.0,23.0,5,44,21,31,4,44,14,23.0,6,0,38.00
```

**3 — `data/routes.csv`** — qué cuesta volar hasta allí:

```csv
*,DKR,95,6.20,5.40,5.10,4.80,0.35,0.10,3,tarifa por defecto a este destino
```

**4 — compilar y comprobar**

```bash
python scripts/build.py
```

```
✔ 27 aeropuertos activos · 27 tablas de llegada · 28 tarifas de flete
✔ escrito docs/data/tariffs.json (31.4 KB)
```

Commit, push, y GitHub Pages lo publica. Dakar aparece solo en los dos
desplegables, agrupado por región, con su tabla de cargos completa.

Si te falta un dato, el build te lo dice antes de publicar nada:

```
  ERROR   DKR está activo en airports.csv pero no tiene fila en arrival_charges.csv
✘ 1 error(es). No se genera nada.
```

**Para dar de baja un aeropuerto** sin perder su histórico: pon `active` a `no`.
Desaparece de la interfaz, la fila se queda en el repo.

---

## Tarifas de flete: comodines y acuerdos

`routes.csv` acepta `*` como origen. Eso significa «desde cualquier aeropuerto
de la red». Así cubres los 26×26 pares con 26 filas.

```csv
origin,destination,min_charge,rate_under_100,...
*,CAI,60,4.05,3.45,3.00,2.78,...      ← todos → El Cairo
BCN,CAI,55,3.95,3.30,2.90,2.60,...    ← acuerdo directo BCN–El Cairo
```

El motor busca primero el par exacto y sólo si no existe usa el comodín. Para
negociar una ruta concreta en clase, añades una fila y ya.

---

## Puesta en marcha

```bash
git clone https://github.com/<tu-usuario>/sdg-airlines-quoter.git
cd sdg-airlines-quoter
pip install -r scripts/requirements.txt      # sólo para importar desde Excel
python scripts/build.py
python -m http.server 8080 --directory docs  # abre http://localhost:8080
```

**Publicar:** Settings → Pages → Source: *GitHub Actions*. El workflow `ci.yml`
valida, prueba y despliega en cada push a `main`.

---

## De dónde salen los datos

Tres modos, se elige en `data/config.json` → `data_source.mode`:

**`local`** (por defecto) — la web lee `docs/data/tariffs.json`, generado desde
los CSV del repo. Rápido, funciona sin conexión, todo cambio queda en el
historial de git.

**`sheet`** — la web lee el Google Sheet en vivo con `gviz`. Editas la hoja,
recargas el navegador y ya está: cero despliegues. Requiere que el documento
esté compartido como *cualquiera con el enlace puede ver*, y las pestañas deben
llamarse `airports`, `arrival_charges` y `routes` con las mismas cabeceras que
los CSV. Si la hoja no responde, la web vuelve sola a la copia local.

Se puede forzar sin tocar la configuración: `quote.html?source=sheet`.

**Sincronización periódica** — el workflow `sync-sheet.yml` baja la hoja y abre
una pull request con el diff. Lo mejor de los dos mundos: la gente edita en
Sheets, el repo conserva el histórico y tú revisas antes de publicar.

```bash
python scripts/sync_sheet.py    # hoja → data/*.csv
python scripts/build.py         # data/*.csv → docs/data/tariffs.json
```

---

## Cómo se calcula

**Peso facturable** — se compara el peso real con el volumétrico
(L×A×H ÷ 167, factor IATA configurable) y manda el mayor, redondeado al
alza al medio kilo.

**Tramos de flete** — `<100`, `100–299`, `300–499`, `+500` kg, siempre con
mínimo por envío.

**Salto de tramo** — si facturar al siguiente escalón sale más barato, el motor
lo detecta y factura a ese peso. Es práctica habitual en carga aérea y en clase
se ve muy bien: 95 kg a Lisboa se facturan como 100 kg y el envío pasa de
897,75 a 300 €.

**Recargos** — combustible (FSC) y seguridad (SSC) por kilo, definidos por ruta.

**Almacenaje** — días libres del aeropuerto, luego tramo 1–20 días a una tarifa
y a partir del día 21 a otra más alta, por cada 100 kg o fracción, más la
cuota por MAWB. Esto sale directo de la hoja original, que ya traía las tres
familias (general, cámara de frío y mercancías peligrosas) para los 26
aeropuertos.

**Moneda** — todo se calcula en la moneda base y se convierte al final con el
tipo de `config.json`.

Los números están comprobados contra el Excel original:

```bash
node scripts/test_engine.mjs
```

---

## Estructura

```
data/                     ← la fuente de verdad, lo único que se edita a diario
  airports.csv              red de aeropuertos
  arrival_charges.csv       tarifas de handling en destino
  routes.csv                tarifas de flete por par O/D (admite comodín *)
  config.json               monedas, factor volumétrico, tipos de mercancía
scripts/
  build.py                  CSV → docs/data/tariffs.json, con validaciones
  sync_sheet.py             Google Sheet → CSV
  import_xlsx.py            .xlsx exportado → CSV (migración puntual)
  build_gas.py              docs/ → gas/ autocontenido para Apps Script
  test_engine.mjs           comprobaciones contra los números del Excel
docs/                     ← lo que publica GitHub Pages
  index.html                vestíbulo
  quote.html                cotización completa
  arrival.html              cargos de llegada
  assets/js/engine.js       motor de cálculo, sin DOM ni dependencias
  assets/js/data.js         carga local o desde la hoja
  assets/js/ui.js           formularios y desglose
  assets/css/sdg.css        identidad visual SDG
  data/tariffs.json         generado — no editar a mano
gas/                      ← despliegue opcional en Apps Script
```

---

## Seguir usando Google Apps Script

Si necesitas el acceso restringido a la organización, el proyecto sigue
funcionando en Apps Script. Apps Script no sirve ficheros estáticos, así que
hay un empaquetador que incrusta CSS, JS y tarifas en cada página:

```bash
python scripts/build.py
python scripts/build_gas.py
cd gas && clasp push && clasp deploy
```

`gas/Code.gs` mantiene los enlaces antiguos: `?page=quoter` lleva a la
cotización completa y `?page=calculator` a los cargos de llegada.

---

## Qué no incluye la cotización

Transporte terrestre, entrega a domicilio, derechos de importación, IVA e
impuestos aduaneros. El transporte terrestre se cotiza aparte.

---

Herramienta educativa. Todas las tarifas son orientativas y la aerolínea es
ficticia. Sin uso comercial.
