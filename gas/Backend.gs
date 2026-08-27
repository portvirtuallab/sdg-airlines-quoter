/**
 * SDG AIRLINES - quotation backend.
 *
 * Two jobs. It is the only thing that can read the PIN list, and it is the
 * only thing that can write to the operations log. Both sheets stay private;
 * the web page sends a PIN and gets back yes or no, so a student cannot read
 * the codes out of the page source. That is the whole reason this file exists
 * rather than the check living in JavaScript.
 *
 * SETUP, once:
 *   1. Put the two spreadsheet ids below.
 *      PIN_SHEET_ID  - the sheet holding the codes. Keep it PRIVATE.
 *      LOG_SHEET_ID  - where operations are recorded. Keep it private too:
 *                      it will hold students' names and email addresses.
 *   2. The PIN tab is read as a plain list of codes down column A. A header
 *      in A1 is ignored if it does not look like a code.
 *   3. The log tab is created and headed automatically.
 *   4. Deploy > New deployment > Web app
 *        Execute as:  Me
 *        Access:      Anyone
 *      Copy the /exec URL into data/config.json -> quote.endpoint, then push.
 *
 * Until that URL is set the site simply runs without the gate, so the tools
 * keep working while this is being wired up.
 */

var PIN_SHEET_ID = 'PUT_THE_VERIFICATION_SPREADSHEET_ID_HERE';
var LOG_SHEET_ID = 'PUT_THE_OPERATIONS_LOG_SPREADSHEET_ID_HERE';
var PIN_TAB = 'SHEET VERIFICATION';
var PIN_COLUMN = 1;         // column A
var LOG_TAB = 'Operations log';
var LOG_KEEP = 0;           // 0 keeps every row; set a number for a rolling window

/* ── entry point ─────────────────────────────────────────────────
   action 'verify' - check the PIN and record the operation. No email.
   action 'send'   - the above, plus the PDF by email.
   Anything else is treated as 'send', which is what older builds posted. */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action === 'verify' ? 'verify' : 'send';

    if (!checkPin(body.pin)) {
      return json({ ok: false, error: 'That PIN is not recognised. Check it with your tutor.' });
    }
    if (!body.name || String(body.name).trim().length < 2) {
      return json({ ok: false, error: 'Enter your name.' });
    }
    if (!body.email || body.email.indexOf('@') < 1) {
      return json({ ok: false, error: 'Enter a valid email address.' });
    }

    if (action === 'send') {
      var pdf = renderPdf(body).setName(body.reference + '.pdf');
      MailApp.sendEmail({
        to: body.email,
        subject: 'SDG Airlines - rate quotation ' + body.reference,
        htmlBody: emailBody(body, body.name),
        attachments: [pdf],
        name: 'SDG Airlines Air Cargo',
      });
    }

    logOperation(body, action);
    return json({ ok: true, action: action, sentTo: action === 'send' ? body.email : null });
  } catch (err) {
    return json({ ok: false, error: 'The request could not be completed: ' + err.message });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ── PIN check ───────────────────────────────────────────────────
   The tab is a plain list of codes down one column. Comparison ignores
   case and surrounding spaces, because a code copied out of a sheet
   arrives with both. Returns true or false and nothing else - the page
   never learns anything about the list it did not already send.        */
function checkPin(pin) {
  if (!pin) return false;
  var sheet = SpreadsheetApp.openById(PIN_SHEET_ID).getSheetByName(PIN_TAB);
  if (!sheet) throw new Error('Tab "' + PIN_TAB + '" not found in the verification sheet');
  var last = sheet.getLastRow();
  if (last < 1) return false;

  var codes = sheet.getRange(1, PIN_COLUMN, last, 1).getValues();
  var given = String(pin).trim().toUpperCase();
  if (!given) return false;

  for (var i = 0; i < codes.length; i++) {
    if (String(codes[i][0]).trim().toUpperCase() === given) return true;
  }
  return false;
}

/* ── the log: data only, no attachments kept ─────────────────────
   One row per operation, whether it was a full quotation or an arrival
   calculation, so the register shows who used the tools and for what.  */
function logOperation(q, action) {
  var ss = SpreadsheetApp.openById(LOG_SHEET_ID);
  var sheet = ss.getSheetByName(LOG_TAB) || ss.insertSheet(LOG_TAB);
  var HEAD = ['requested_at', 'tool', 'reference', 'name', 'email', 'pin',
              'origin', 'destination', 'incoterm', 'commodity',
              'pieces', 'gross_kg', 'chargeable_kg', 'flights', 'aircraft',
              'departure', 'arrival', 'customs_regime',
              'currency', 'seller_pays', 'buyer_pays', 'total', 'emailed'];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEAD);
    sheet.getRange(1, 1, 1, HEAD.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  var it = q.itinerary || {};
  var legs = it.legs || [];
  sheet.appendRow([
    new Date(), q.tool || 'quotation', q.reference, q.name, q.email, q.pin,
    q.origin || '', q.destination, q.incoterm || '', q.commodity,
    q.pieces, q.grossWeight, q.chargeableWeight,
    legs.length,
    legs.map(function (l) { return l.aircraft; }).join(' + '),
    legs.length ? legs[0].departureLocal : '',
    legs.length ? legs[legs.length - 1].arrivalLocal : '',
    q.regime || '', q.currency,
    q.sellerTotal == null ? '' : q.sellerTotal,
    q.buyerTotal == null ? '' : q.buyerTotal,
    q.total, action === 'send' ? 'yes' : 'no',
  ]);

  // A rolling window only if one was asked for. Left at 0 the register keeps
  // everything, which is what a register is for.
  if (LOG_KEEP > 0) {
    var extra = sheet.getLastRow() - 1 - LOG_KEEP;
    if (extra > 0) sheet.deleteRows(2, extra);
  }
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
      '<span>Prepared for</span><b>' + q.name + '</b></div>' +
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

/* ── run this once from the editor to check the setup ──────────
   Reports what it can reach without revealing a single code.        */
function testSetup() {
  var pinSs = SpreadsheetApp.openById(PIN_SHEET_ID);
  var pinTab = pinSs.getSheetByName(PIN_TAB);
  Logger.log('Verification sheet: ' + pinSs.getName());
  Logger.log('Tab  + PIN_TAB + : ' + (pinTab ? pinTab.getLastRow() + ' row(s) in column A' : 'MISSING'));

  var logSs = SpreadsheetApp.openById(LOG_SHEET_ID);
  Logger.log('Log sheet: ' + logSs.getName());
  Logger.log('Tab "' + LOG_TAB + '": ' + (logSs.getSheetByName(LOG_TAB) ? 'found' : 'will be created on first use'));
  Logger.log('Rows kept: ' + (LOG_KEEP > 0 ? LOG_KEEP + ' most recent' : 'all of them'));
  Logger.log('Email quota left today: ' + MailApp.getRemainingDailyQuota());
}
