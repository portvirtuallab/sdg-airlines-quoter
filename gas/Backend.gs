/**
 * SDG AIRLINES - quotation backend.
 *
 * Replaces Document Studio. Receives a quotation from the web app, checks the
 * institution PIN, renders a PDF, emails it, and logs the request.
 *
 * SETUP, once:
 *   1. Create a spreadsheet and put its id in SHEET_ID below.
 *   2. Add a tab named "Institutions" with these headers in row 1:
 *        institution | pin | contact_email | active
 *      One row per school. active = yes/no.
 *   3. Add a tab named "Quotation log" - the headers are written automatically.
 *   4. Deploy > New deployment > Web app
 *        Execute as:  Me
 *        Access:      Anyone
 *      Copy the /exec URL into data/config.json -> quote.endpoint, rebuild,
 *      and push.
 *
 * The PIN list never leaves this script. The web page only ever sends a PIN
 * and gets back yes or no, so a student cannot read the other institutions'
 * codes out of the page source.
 */

var SHEET_ID = 'PUT_YOUR_SPREADSHEET_ID_HERE';
var LOG_TAB = 'Quotation log';
var PIN_TAB = 'Institutions';
var LOG_KEEP = 50;          // how many recent quotations to keep on the log tab

/* ── entry point ─────────────────────────────────────────────── */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var who = checkPin(body.pin);
    if (!who) return json({ ok: false, error: 'That PIN is not recognised. Check it with your tutor.' });
    if (!body.email || body.email.indexOf('@') < 1) {
      return json({ ok: false, error: 'Enter a valid email address.' });
    }

    var pdf = renderPdf(body).setName(body.reference + '.pdf');
    MailApp.sendEmail({
      to: body.email,
      subject: 'SDG Airlines - rate quotation ' + body.reference,
      htmlBody: emailBody(body, who),
      attachments: [pdf],
      name: 'SDG Airlines Air Cargo',
    });

    logQuotation(body, who);
    return json({ ok: true, sentTo: body.email, institution: who });
  } catch (err) {
    return json({ ok: false, error: 'Could not send the quotation: ' + err.message });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ── PIN check ───────────────────────────────────────────────── */
function checkPin(pin) {
  if (!pin) return null;
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(PIN_TAB);
  var rows = sheet.getDataRange().getValues();
  var head = rows.shift().map(function (h) { return String(h).trim().toLowerCase(); });
  var iName = head.indexOf('institution'), iPin = head.indexOf('pin'), iOn = head.indexOf('active');
  var given = String(pin).trim().toUpperCase();
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r[iPin]).trim().toUpperCase() !== given) continue;
    if (iOn > -1 && String(r[iOn]).trim().toLowerCase() === 'no') return null;
    return String(r[iName]).trim();
  }
  return null;
}

/* ── the log: data only, no attachments kept ─────────────────── */
function logQuotation(q, institution) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(LOG_TAB) || ss.insertSheet(LOG_TAB);
  var HEAD = ['requested_at', 'reference', 'institution', 'email', 'origin', 'destination',
              'commodity', 'pieces', 'gross_kg', 'chargeable_kg', 'flights', 'aircraft',
              'departure', 'arrival', 'customs_regime', 'currency', 'total'];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEAD);
    sheet.getRange(1, 1, 1, HEAD.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  var it = q.itinerary || {};
  var legs = it.legs || [];
  sheet.appendRow([
    new Date(), q.reference, institution, q.email,
    q.origin, q.destination, q.commodity,
    q.pieces, q.grossWeight, q.chargeableWeight,
    legs.length,
    legs.map(function (l) { return l.aircraft; }).join(' + '),
    legs.length ? legs[0].departureLocal : '',
    legs.length ? legs[legs.length - 1].arrivalLocal : '',
    q.regime, q.currency, q.total,
  ]);

  // Keep only the most recent LOG_KEEP rows. Oldest go first.
  var extra = sheet.getLastRow() - 1 - LOG_KEEP;
  if (extra > 0) sheet.deleteRows(2, extra);
}

/* ── the PDF ─────────────────────────────────────────────────── */
function renderPdf(q) {
  var html = quotationHtml(q);
  return Utilities.newBlob(html, 'text/html', 'quotation.html').getAs('application/pdf');
}

function money(n, cur) {
  var s = (Math.round(n * 100) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (cur === 'USD' ? '$ ' : '\u20AC ') + s;
}

function rows(lines, cur) {
  return (lines || []).map(function (l) {
    var off = l.inactive ? ' class="off"' : '';
    return '<tr' + off + '><td><span class="code">' + l.code + '</span>' + l.label +
      '<div class="detail">' + l.detail + '</div></td>' +
      '<td class="amt">' + money(l.amount, cur) + '</td></tr>';
  }).join('');
}

function quotationHtml(q) {
  var cur = q.currency;
  var it = q.itinerary || { legs: [] };
  var legs = (it.legs || []).map(function (l) {
    return '<tr><td class="fl">' + (l.flightNumber || l.service) + '</td>' +
      '<td><b>' + l.origin + '</b> ' + l.departureLocal + ' &rarr; <b>' + l.destination + '</b> ' +
      l.arrivalLocal + '<div class="detail">' + l.aircraft + ' &middot; ' + l.model +
      (l.via && l.via.length ? ' &middot; via ' + l.via.join(', ') : '') + '</div></td></tr>';
  }).join('');

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    'body{font-family:Helvetica,Arial,sans-serif;color:#131714;font-size:10pt;margin:0}' +
    '.sheet{border:1.2pt solid #131714}' +
    '.top{padding:14pt 16pt;border-bottom:1.6pt solid #131714;overflow:hidden}' +
    '.carrier{font-size:17pt;font-weight:bold;letter-spacing:.5pt}' +
    '.kind{font-size:8pt;color:#565E57;letter-spacing:1.5pt;text-transform:uppercase;margin-top:3pt}' +
    '.lane{font-size:26pt;font-weight:bold;margin-top:10pt}' +
    '.lane .a{color:#A31D28}' +
    '.cities{font-size:8pt;color:#565E57;letter-spacing:1pt;text-transform:uppercase;margin-top:4pt}' +
    '.ref{float:right;text-align:right;font-size:8pt}' +
    '.ref b{display:block;font-size:9pt;font-weight:normal;margin-bottom:5pt}' +
    '.ref span{color:#8A938B;letter-spacing:1pt;text-transform:uppercase;font-size:7pt}' +
    '.cap{background:#131714;color:#E6EAE3;padding:5pt 16pt;font-size:7.5pt;letter-spacing:2pt;text-transform:uppercase}' +
    'table{width:100%;border-collapse:collapse}' +
    'td{padding:6pt 16pt;border-bottom:.5pt solid #C7CEC3;vertical-align:top}' +
    '.amt{text-align:right;white-space:nowrap}' +
    '.detail{font-size:7.5pt;color:#8A938B;margin-top:2pt}' +
    '.code{display:inline-block;border:.5pt solid #A3AC9F;padding:0 4pt;margin-right:7pt;font-size:7.5pt;color:#565E57}' +
    '.fl{font-weight:bold;color:#A31D28;width:60pt}' +
    '.band td{background:#F2F5F0;font-size:7.5pt;letter-spacing:2pt;text-transform:uppercase;color:#565E57}' +
    '.sub td{background:#F2F5F0;font-weight:bold;font-size:8.5pt;text-transform:uppercase}' +
    '.off td,.off .code{color:#A3AC9F}.off .amt{text-decoration:line-through}' +
    '.grand{background:#131714;color:#fff;padding:12pt 16pt;overflow:hidden}' +
    '.grand .l{font-size:12pt;font-weight:bold;letter-spacing:1.5pt;text-transform:uppercase}' +
    '.grand .v{float:right;font-size:18pt;border:1pt solid #A31D28;background:#A31D28;padding:3pt 12pt}' +
    '.terms{padding:10pt 16pt;font-size:7.5pt;color:#565E57;line-height:1.5}' +
    '.sign{margin-top:16pt;border-top:.5pt solid #A3AC9F;width:180pt;padding-top:4pt;' +
    'font-size:7pt;letter-spacing:1.5pt;text-transform:uppercase;color:#8A938B}' +
    '</style></head><body><div class="sheet">' +

    '<div class="top"><div class="ref">' +
      '<span>Quotation</span><b>' + q.reference + '</b>' +
      '<span>Issued</span><b>' + q.issued + '</b>' +
      '<span>Valid until</span><b>' + q.validUntil + '</b>' +
      '<span>Prepared for</span><b>' + q.institution + '</b></div>' +
      '<div class="carrier">SDG Airlines</div>' +
      '<div class="kind">Air cargo division &middot; rate quotation</div>' +
      '<div class="lane">' + q.origin + ' <span class="a">&rarr;</span> ' + q.destination + '</div>' +
      '<div class="cities">' + q.originName + ' to ' + q.destinationName + '</div></div>' +

    (legs ? '<div class="cap">Routing &middot; ' + it.jumps + ' flight(s) &middot; ' +
      Math.round(it.transitSeconds / 3600) + ' h &middot; ' + Math.round(it.km) + ' km</div>' +
      '<table>' + legs + '</table>' : '') +

    '<div class="cap">Air waybill rate line &middot; box 22</div>' +
    '<table><tr>' +
      '<td>Pieces<div class="detail">' + q.rateLine.pieces + '</div></td>' +
      '<td>Gross weight<div class="detail">' + q.rateLine.grossWeight.toFixed(1) + ' kg</div></td>' +
      '<td>Rate class<div class="detail">' + q.rateLine.rateClass + '</div></td>' +
      '<td>Chargeable<div class="detail">' + q.rateLine.chargeableWeight.toFixed(1) + ' kg</div></td>' +
      '<td>Rate<div class="detail">' + q.rateLine.rate.toFixed(3) + '</div></td>' +
      '<td class="amt">Total<div class="detail">' + money(q.rateLine.total, cur) + '</div></td>' +
    '</tr></table>' +

    '<table>' +
      '<tr class="band"><td colspan="2">Charges at origin &mdash; prepaid</td></tr>' +
      rows(q.departure.lines, cur) +
      '<tr class="sub"><td>Subtotal at origin</td><td class="amt">' + money(q.departure.subtotal, cur) + '</td></tr>' +
      '<tr class="band"><td colspan="2">Charges at destination &mdash; ' + q.destination + '</td></tr>' +
      rows(q.arrival.lines, cur) +
      '<tr class="sub"><td>Subtotal at destination</td><td class="amt">' + money(q.arrival.subtotal, cur) + '</td></tr>' +
    '</table>' +

    '<div class="grand"><span class="v">' + money(q.total, cur) + '</span>' +
      '<span class="l">Total charges</span></div>' +

    '<div class="terms">Rates are quoted per the tariff in force on the date of issue and are ' +
    'subject to space and capacity being available at the time of booking. Excluded: inland ' +
    'trucking, door delivery, import duties, VAT and customs taxes. Dangerous goods require an ' +
    'accepted shipper\'s declaration before acceptance. Customs regime on this routing: ' +
    q.regime + '.<div class="sign">Accepted for the shipper</div></div>' +

    '</div><p style="font-size:7pt;color:#8A938B;text-align:center;margin-top:10pt">' +
    'SDG Airlines exists only in the virtual world. Escola Europea &mdash; Intermodal Transport, ' +
    'Port Virtual Lab. Training simulation, not for commercial use.</p></body></html>';
}

/* ── the covering email ──────────────────────────────────────── */
function emailBody(q, institution) {
  return '<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#131714;line-height:1.6">' +
    '<p>Dear ' + institution + ',</p>' +
    '<p>Thank you for your enquiry. Please find attached our rate quotation ' +
    '<b>' + q.reference + '</b> for ' + q.origin + ' to ' + q.destination + '.</p>' +
    '<table style="border-collapse:collapse;margin:16px 0;font-size:13px">' +
    '<tr><td style="padding:3px 16px 3px 0;color:#565E57">Chargeable weight</td><td><b>' +
      q.chargeableWeight + ' kg</b></td></tr>' +
    '<tr><td style="padding:3px 16px 3px 0;color:#565E57">Total charges</td><td><b>' +
      money(q.total, q.currency) + '</b></td></tr>' +
    '<tr><td style="padding:3px 16px 3px 0;color:#565E57">Valid until</td><td>' + q.validUntil + '</td></tr>' +
    '</table>' +
    '<p>Rates are subject to space being available at the time of booking. The air waybill is ' +
    'issued once the booking is confirmed, not at quotation stage.</p>' +
    '<p>Kind regards,<br><b>SDG Airlines</b><br>Air Cargo Division</p>' +
    '<hr style="border:none;border-top:1px solid #C7CEC3;margin:20px 0">' +
    '<p style="font-size:11px;color:#8A938B">SDG Airlines exists only in the virtual world and ' +
    'offers no real services. Escola Europea &mdash; Intermodal Transport, Port Virtual Lab.</p></div>';
}

/* ── run this once from the editor to check the setup ────────── */
function testSetup() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  Logger.log('Spreadsheet: ' + ss.getName());
  Logger.log('Institutions tab: ' + (ss.getSheetByName(PIN_TAB) ? 'found' : 'MISSING'));
  Logger.log('Log tab: ' + (ss.getSheetByName(LOG_TAB) ? 'found' : 'will be created on first use'));
  Logger.log('Email quota left today: ' + MailApp.getRemainingDailyQuota());
}
