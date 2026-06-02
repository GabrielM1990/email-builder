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

// Helper para responder con JSONP o JSON segun si hay callback
function jsonResponse(data, callback) {
  var json = JSON.stringify(data);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    var action = e.parameter.action || '';
    var callback = e.parameter.callback || '';

    switch (action) {
      case 'open':
        return handleTrackingPixel(e);
      case 'click':
        return handleClickRedirect(e);
      case 'getSends':
        return getSendsData(e, callback);
      case 'getTracking':
        return getTrackingData(e, callback);
      default:
        return jsonResponse({ success: true, message: 'Kudos Mail CRM API' }, callback);
    }
  } catch (error) {
    return jsonResponse({ success: false, error: error.toString() }, e.parameter.callback || '');
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
    try {
      logTrackingEvent('open', {
        sendId: sendId,
        trackingId: trkId,
        timestamp: new Date().toISOString()
      });
    } catch(err) {
      console.log('Error logging open:', err);
    }
  }

  // Devolver respuesta minima tipo imagen
  // Los proxies de email (Gmail, Outlook) hacen la petición GET al servidor
  // Lo importante es que la petición LLEGA y se registra el evento en la hoja
  // No necesitamos devolver una imagen real, solo una respuesta HTTP 200
  var output = ContentService.createTextOutput('');
  output.setMimeType(ContentService.MimeType.TEXT);
  return output;
}

// ============================================
// TRACKING: REDIRECCIÓN DE CLICK
// ============================================
function handleClickRedirect(e) {
  var sendId = e.parameter.sendId || '';
  var trkId = e.parameter.trkId || '';
  var url = e.parameter.url || '';
  var blockName = e.parameter.block || '';

  if (sendId && trkId) {
    try {
      logTrackingEvent('click', {
        sendId: sendId,
        trackingId: trkId,
        timestamp: new Date().toISOString(),
        url: url,
        blockName: blockName
      });
    } catch(err) {
      console.log('Error logging click:', err);
    }
  }

  // Redirigir a la URL original con meta refresh + JS
  if (url) {
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><head>' +
      '<meta http-equiv="refresh" content="0;url=' + url + '">' +
      '</head><body>' +
      '<p>Redirigiendo...</p>' +
      '<script>window.location.href="' + url + '";</script>' +
      '</body></html>'
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
    sheet.appendRow(['timestamp', 'eventType', 'sendId', 'trackingId', 'url', 'blockName']);
    var headerRange = sheet.getRange(1, 1, 1, 6);
    headerRange.setFontWeight('bold').setBackground('#764ba2').setFontColor('#ffffff');
  }

  sheet.appendRow([
    data.timestamp || new Date().toISOString(),
    type,
    data.sendId || '',
    data.trackingId || '',
    data.url || '',
    data.blockName || ''
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
function getSendsData(e, callback) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_ENVIOS);
  if (!sheet) {
    return jsonResponse({ success: true, sends: [] }, callback);
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

  // Agregar eventos de tracking con blockName a cada recipient
  var trackingSheet = ss.getSheetByName(SHEET_TRACKING);
  if (trackingSheet) {
    var trackingData = trackingSheet.getDataRange().getValues();
    if (trackingData.length > 1) {
      var tHeaders = trackingData[0];
      var tColEventType = tHeaders.indexOf('eventType');
      var tColTrackingId = tHeaders.indexOf('trackingId');
      var tColBlockName = tHeaders.indexOf('blockName');
      var tColTimestamp = tHeaders.indexOf('timestamp');
      var tColUrl = tHeaders.indexOf('url');

      for (var t = 1; t < trackingData.length; t++) {
        var tEventType = trackingData[t][tColEventType];
        var tTrackingId = trackingData[t][tColTrackingId];
        var tBlockName = tColBlockName !== -1 ? trackingData[t][tColBlockName] : '';
        var tTimestamp = trackingData[t][tColTimestamp];
        var tUrl = tColUrl !== -1 ? trackingData[t][tColUrl] : '';

        // Buscar el recipient correspondiente
        for (var sKey in sends) {
          var recipient = sends[sKey].recipients.find(function(r) { return r.trackingId === tTrackingId; });
          if (recipient) {
            if (!recipient.events) recipient.events = [];
            recipient.events.push({
              type: tEventType,
              timestamp: tTimestamp,
              blockName: tBlockName,
              url: tUrl
            });
          }
        }
      }
    }
  }

  var sendsArray = Object.values(sends);
  // Ordenar por fecha descendente
  sendsArray.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });

  return jsonResponse({ success: true, sends: sendsArray }, callback);
}

// ============================================
// OBTENER DATOS DE TRACKING (GET)
// ============================================
function getTrackingData(e, callback) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TRACKING);
  if (!sheet) {
    return jsonResponse({ success: true, events: [] }, callback);
  }

  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var events = [];
  
  var colTimestamp = headers.indexOf('timestamp');
  var colEventType = headers.indexOf('eventType');
  var colSendId = headers.indexOf('sendId');
  var colTrackingId = headers.indexOf('trackingId');
  var colUrl = headers.indexOf('url');
  var colBlockName = headers.indexOf('blockName');

  for (var i = 1; i < data.length; i++) {
    events.push({
      timestamp: colTimestamp !== -1 ? data[i][colTimestamp] : '',
      eventType: colEventType !== -1 ? data[i][colEventType] : '',
      sendId: colSendId !== -1 ? data[i][colSendId] : '',
      trackingId: colTrackingId !== -1 ? data[i][colTrackingId] : '',
      url: colUrl !== -1 ? data[i][colUrl] : '',
      blockName: colBlockName !== -1 ? (data[i][colBlockName] || '') : ''
    });
  }

  return jsonResponse({ success: true, events: events }, callback);
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

// ============================================
// DIAGNOSTICO Y SETUP
// ============================================

// Verificar que el spreadsheet es accesible
function testConnection() {
  try {
    var ss = getSpreadsheet();
    var name = ss.getName();
    var sheets = ss.getSheets().map(function(s) { return s.getName(); });
    return 'OK - Spreadsheet: ' + name + ' | Hojas: ' + sheets.join(', ');
  } catch (e) {
    return 'ERROR - ' + e.toString();
  }
}

// Crear hojas de Envios y Tracking si no existen
function setupSheets() {
  var ss = getSpreadsheet();
  
  // Crear hoja Envios
  var enviosSheet = ss.getSheetByName(SHEET_ENVIOS);
  if (!enviosSheet) {
    enviosSheet = ss.insertSheet(SHEET_ENVIOS);
    enviosSheet.appendRow([
      'sendId', 'sendDate', 'subject', 'trackingId',
      'email', 'nombre', 'empresa', 'status',
      'openCount', 'clickCount', 'lastEvent', 'blocks'
    ]);
    var headerRange = enviosSheet.getRange(1, 1, 1, 12);
    headerRange.setFontWeight('bold').setBackground('#667eea').setFontColor('#ffffff');
  }
  
  // Crear hoja Tracking
  var trackingSheet = ss.getSheetByName(SHEET_TRACKING);
  if (!trackingSheet) {
    trackingSheet = ss.insertSheet(SHEET_TRACKING);
    trackingSheet.appendRow(['timestamp', 'eventType', 'sendId', 'trackingId', 'url', 'blockName']);
    var headerRange2 = trackingSheet.getRange(1, 1, 1, 6);
    headerRange2.setFontWeight('bold').setBackground('#764ba2').setFontColor('#ffffff');
  }
  
  return 'Hojas creadas: ' + SHEET_ENVIOS + ', ' + SHEET_TRACKING;
}

// Verificar datos de envios
function checkSendsData() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_ENVIOS);
  if (!sheet) return 'Hoja Envios no existe. Ejecuta setupSheets() primero.';
  var lastRow = sheet.getLastRow();
  return 'Hoja Envios: ' + (lastRow - 1) + ' registros';
}

// Verificar datos de tracking
function checkTrackingData() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TRACKING);
  if (!sheet) return 'Hoja Tracking no existe. Ejecuta setupSheets() primero.';
  var lastRow = sheet.getLastRow();
  return 'Hoja Tracking: ' + (lastRow - 1) + ' eventos';
}

// Migrar hoja Tracking existente para agregar columna blockName
function migrateTrackingSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TRACKING);
  if (!sheet) return 'Hoja Tracking no existe';
  
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  // Verificar si ya tiene la columna blockName
  if (headers.indexOf('blockName') !== -1) {
    return 'La hoja ya tiene la columna blockName. No necesita migracion.';
  }
  
  // Agregar columna blockName al final
  var lastCol = sheet.getLastColumn();
  sheet.getRange(1, lastCol + 1).setValue('blockName');
  
  // Formatear header
  var headerRange = sheet.getRange(1, 1, 1, lastCol + 1);
  headerRange.setFontWeight('bold').setBackground('#764ba2').setFontColor('#ffffff');
  
  return 'Columna blockName agregada a la hoja Tracking. Total columnas: ' + (lastCol + 1);
}
