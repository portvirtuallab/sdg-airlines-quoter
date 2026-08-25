/**
 * SDG Airlines — punto de entrada de Apps Script.
 *
 * Las páginas Index/Quote/Arrival las genera `python scripts/build_gas.py`
 * a partir de docs/. No las edites a mano aquí: se sobrescriben en cada build.
 */
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || 'index';

  var pages = {
    index:   { file: 'Index',   title: 'SDG Airlines — Herramientas' },
    quote:   { file: 'Quote',   title: 'SDG Airlines — Cotización completa' },
    arrival: { file: 'Arrival', title: 'SDG Airlines — Cargos de llegada' }
  };

  // Compatibilidad con los enlaces antiguos
  if (page === 'quoter') page = 'quote';
  if (page === 'calculator') page = 'arrival';

  var target = pages[page] || pages.index;

  return HtmlService.createHtmlOutputFromFile(target.file)
    .setTitle(target.title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
