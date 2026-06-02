// ============================================
// KUDOS MAIL CRM - Google Apps Script
// ============================================
// Hojas necesarias en el Spreadsheet:
//   - "Envios" (envíos realizados)
//   - "Tracking" (eventos de apertura/click)
//   - "Clientes" (datos de clientes)
// ============================================

// IMPORTANTE: Reemplazar con el ID de tu Google Spreadsheet
// Lo encuentras en la URL: https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit
var SPREADSHEET_ID = 'REEMPLAZAR_CON_TU_SPREADSHEET_ID';
var SHEET_ENVIOS = 'Envios';
var SHEET_TRACKING = 'Tracking';

// Obtener spreadsheet
function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

// ============================================
// MANEJO DE PETICIONES
// ============================================
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || 'sendEmail';

    switch (action) {
      case 'sendEmail':
        return sendEmailAndLog(data);
      case 'logSend':
        return logSend(data);
      case 'logOpen':
        return logTrackingEvent('open', data);
      case 'logClick':
        return logTrackingEvent('click', data);
      default:
        return sendEmailAndLog(data);
    }
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    var action = e.parameter.action || '';

    switch (action) {
      case 'open':
        return handleTrackingPixel(e);
      case 'click':
        return handleClickRedirect(e);
      case 'getSends':
        return getSendsData(e);
      case 'getTracking':
        return getTrackingData(e);
      default:
        return ContentService
          .createTextOutput(JSON.stringify({ success: true, message: 'Kudos Mail CRM API' }))
          .setMimeType(ContentService.MimeType.JSON);
    }
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================
// ENVIAR EMAIL Y REGISTRAR ENVIO
// ============================================
function sendEmailAndLog(data) {
  var results = [];

  // Si hay recipients (envío masivo)
  if (data.recipients && data.recipients.length > 0) {
    for (var i = 0; i < data.recipients.length; i++) {
      var recipient = data.recipients[i];
      try {
        GmailApp.sendEmail(recipient.email, data.subject, '', {
          htmlBody: recipient.htmlContent,
          name: 'Kudos Commerce'
        });

        // Registrar en hoja Envios
        logSendToSheet({
          sendId: data.sendId,
          sendDate: data.sendDate,
          subject: data.subject,
          trackingId: recipient.trackingId,
          email: recipient.email,
          nombre: recipient.nombre,
          empresa: recipient.empresa,
          status: 'sent',
          blocks: data.blocks ? JSON.stringify(data.blocks) : ''
        });

        results.push({ email: recipient.email, status: 'sent' });
      } catch (error) {
        logSendToSheet({
          sendId: data.sendId,
          sendDate: data.sendDate,
          subject: data.subject,
          trackingId: recipient.trackingId,
          email: recipient.email,
          nombre: recipient.nombre,
          empresa: recipient.empresa,
          status: 'bounced',
          blocks: data.blocks ? JSON.stringify(data.blocks) : ''
        });

        results.push({ email: recipient.email, status: 'bounced', error: error.toString() });
      }

      // Pausa entre envíos para evitar límites
      if (i < data.recipients.length - 1) {
        Utilities.sleep(2000);
      }
    }
  } else {
    // Envío individual
    try {
      GmailApp.sendEmail(data.to, data.subject, '', {
        htmlBody: data.htmlContent,
        name: 'Kudos Commerce'
      });

      logSendToSheet({
        sendId: data.sendId || generateId(),
        sendDate: data.sendDate || new Date().toISOString(),
        subject: data.subject,
        trackingId: data.trackingId || generateId(),
        email: data.to,
        nombre: data.clientName || '',
        empresa: data.empresa || '',
        status: 'sent',
        blocks: data.blocks ? JSON.stringify(data.blocks) : ''
      });

      results.push({ email: data.to, status: 'sent' });
    } catch (error) {
      logSendToSheet({
        sendId: data.sendId || generateId(),
        sendDate: data.sendDate || new Date().toISOString(),
        subject: data.subject,
        trackingId: data.trackingId || generateId(),
        email: data.to,
        nombre: data.clientName || '',
        empresa: data.empresa || '',
        status: 'bounced',
        blocks: data.blocks ? JSON.stringify(data.blocks) : ''
      });

      results.push({ email: data.to, status: 'bounced', error: error.toString() });
    }
  }

  return ContentService
    .createTextOutput(JSON.stringify({ success: true, results: results }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================
// REGISTRAR ENVIO EN HOJA
// ============================================
function logSendToSheet(data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_ENVIOS);

  // Crear hoja si no existe
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_ENVIOS);
    sheet.appendRow([
      'sendId', 'sendDate', 'subject', 'trackingId',
      'email', 'nombre', 'empresa', 'status',
      'openCount', 'clickCount', 'lastEvent', 'blocks'
    ]);
    // Formato encabezados
    var headerRange = sheet.getRange(1, 1, 1, 12);
    headerRange.setFontWeight('bold').setBackground('#667eea').setFontColor('#ffffff');
  }

  sheet.appendRow([
    data.sendId,
    data.sendDate,
    data.subject,
    data.trackingId,
    data.email,
    data.nombre,
    data.empresa,
    data.status,
    0,  // openCount
    0,  // clickCount
    data.sendDate, // lastEvent
    data.blocks
  ]);
}

// ============================================
// REGISTRAR SOLO ENVIO (sin enviar email)
// ============================================
function logSend(data) {
  if (data.recipients && data.recipients.length > 0) {
    for (var i = 0; i < data.recipients.length; i++) {
      var recipient = data.recipients[i];
      logSendToSheet({
        sendId: data.sendId,
        sendDate: data.sendDate,
        subject: data.subject,
        trackingId: recipient.trackingId,
        email: recipient.email,
        nombre: recipient.nombre,
        empresa: recipient.empresa,
        status: recipient.status || 'sent',
        blocks: data.blocks ? JSON.stringify(data.blocks) : ''
      });
    }
  }

  return ContentService
    .createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================
// TRACKING: PIXEL DE APERTURA
// ============================================
function handleTrackingPixel(e) {
  var sendId = e.parameter.sendId || '';
  var trkId = e.parameter.trkId || '';

  if (sendId && trkId) {
    logTrackingEvent('open', {
      sendId: sendId,
      trackingId: trkId,
      timestamp: new Date().toISOString()
    });
  }

  // Retornar pixel transparente 1x1
  return ContentService
    .createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

// ============================================
// TRACKING: REDIRECCIÓN DE CLICK
// ============================================
function handleClickRedirect(e) {
  var sendId = e.parameter.sendId || '';
  var trkId = e.parameter.trkId || '';
  var url = e.parameter.url || '';

  if (sendId && trkId) {
    logTrackingEvent('click', {
      sendId: sendId,
      trackingId: trkId,
      timestamp: new Date().toISOString(),
      url: url
    });
  }

  // Redirigir a la URL original
  if (url) {
    return HtmlService.createHtmlOutput(
      '<script>window.location.href="' + url + '";</script>'
    );
  }

  return ContentService
    .createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================
// REGISTRAR EVENTO DE TRACKING
// ============================================
function logTrackingEvent(type, data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TRACKING);

  // Crear hoja si no existe
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_TRACKING);
    sheet.appendRow(['timestamp', 'eventType', 'sendId', 'trackingId', 'url']);
    var headerRange = sheet.getRange(1, 1, 1, 5);
    headerRange.setFontWeight('bold').setBackground('#764ba2').setFontColor('#ffffff');
  }

  sheet.appendRow([
    data.timestamp || new Date().toISOString(),
    type,
    data.sendId || '',
    data.trackingId || '',
    data.url || ''
  ]);

  // Actualizar contadores en hoja Envios
  updateSendTracking(data.trackingId, type);
}

// ============================================
// ACTUALIZAR CONTADORES EN HOJA ENVIOS
// ============================================
function updateSendTracking(trackingId, eventType) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_ENVIOS);
  if (!sheet) return;

  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var colTrackingId = headers.indexOf('trackingId');
  var colStatus = headers.indexOf('status');
  var colOpenCount = headers.indexOf('openCount');
  var colClickCount = headers.indexOf('clickCount');
  var colLastEvent = headers.indexOf('lastEvent');

  if (colTrackingId === -1) return;

  for (var i = 1; i < data.length; i++) {
    if (data[i][colTrackingId] === trackingId) {
      var row = i + 1;

      if (eventType === 'open') {
        var openCount = parseInt(data[i][colOpenCount]) || 0;
        sheet.getRange(row, colOpenCount + 1).setValue(openCount + 1);
        sheet.getRange(row, colStatus + 1).setValue('opened');
      } else if (eventType === 'click') {
        var clickCount = parseInt(data[i][colClickCount]) || 0;
        sheet.getRange(row, colClickCount + 1).setValue(clickCount + 1);
        sheet.getRange(row, colStatus + 1).setValue('clicked');
      }

      sheet.getRange(row, colLastEvent + 1).setValue(new Date().toISOString());
      break;
    }
  }
}

// ============================================
// OBTENER DATOS DE ENVIOS (GET)
// ============================================
function getSendsData(e) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_ENVIOS);
  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: true, sends: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var sends = {};

  var colSendId = headers.indexOf('sendId');
  var colSendDate = headers.indexOf('sendDate');
  var colSubject = headers.indexOf('subject');
  var colTrackingId = headers.indexOf('trackingId');
  var colEmail = headers.indexOf('email');
  var colNombre = headers.indexOf('nombre');
  var colEmpresa = headers.indexOf('empresa');
  var colStatus = headers.indexOf('status');
  var colOpenCount = headers.indexOf('openCount');
  var colClickCount = headers.indexOf('clickCount');
  var colLastEvent = headers.indexOf('lastEvent');
  var colBlocks = headers.indexOf('blocks');

  for (var i = 1; i < data.length; i++) {
    var sendId = data[i][colSendId];

    if (!sends[sendId]) {
      sends[sendId] = {
        id: sendId,
        date: data[i][colSendDate],
        subject: data[i][colSubject],
        blocks: data[i][colBlocks] ? JSON.parse(data[i][colBlocks]) : [],
        totalRecipients: 0,
        recipients: []
      };
    }

    sends[sendId].totalRecipients++;
    sends[sendId].recipients.push({
      trackingId: data[i][colTrackingId],
      email: data[i][colEmail],
      nombre: data[i][colNombre],
      empresa: data[i][colEmpresa],
      status: data[i][colStatus],
      openCount: parseInt(data[i][colOpenCount]) || 0,
      clickCount: parseInt(data[i][colClickCount]) || 0,
      lastEvent: data[i][colLastEvent]
    });
  }

  var sendsArray = Object.values(sends);
  // Ordenar por fecha descendente
  sendsArray.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });

  return ContentService
    .createTextOutput(JSON.stringify({ success: true, sends: sendsArray }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================
// OBTENER DATOS DE TRACKING (GET)
// ============================================
function getTrackingData(e) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TRACKING);
  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: true, events: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var events = [];

  for (var i = 1; i < data.length; i++) {
    events.push({
      timestamp: data[i][0],
      eventType: data[i][1],
      sendId: data[i][2],
      trackingId: data[i][3],
      url: data[i][4]
    });
  }

  return ContentService
    .createTextOutput(JSON.stringify({ success: true, events: events }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================
// UTILIDADES
// ============================================
function generateId() {
  return Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Función de prueba
function testSend() {
  GmailApp.sendEmail('tuemail@empresa.com', 'Prueba Kudos CRM', 'Mensaje de prueba', {
    htmlBody: '<h1>Hola</h1><p>Esto es una prueba del CRM</p>',
    name: 'Kudos Commerce'
  });
}
