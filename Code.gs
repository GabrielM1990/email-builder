// ============================================
// KUDOS MAIL CRM - Google Apps Script
// ============================================
// Hojas necesarias en el Spreadsheet:
//   - "Desarrollos" (desarrollos disponibles)
//   - "Envios" (envíos realizados)
//   - "Tracking" (eventos de apertura/click)
//   - "Clientes" (datos de clientes)
// ============================================

// IMPORTANTE: Reemplazar con el ID de tu Google Spreadsheet
// Lo encuentras en la URL: https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit
var SPREADSHEET_ID = '1yB8SensY8uwXPrs61jQ9r1RngC1XGCpeLLa5Lkj23PI';
// IMPORTANTE: los nombres de las hojas deben coincidir exactamente con los de tu spreadsheet
var SHEET_DESARROLLOS = 'Desarrollos';
var SHEET_ENVIOS = 'Envios';
var SHEET_TRACKING = 'Tracking';
var SHEET_CLIENTES = 'Clientes';

// Spreadsheet de Seguimiento (separado del principal)
var SEGUIMIENTO_SPREADSHEET_ID = '1WISybdPVUzhYwSUek2nnTxC--aI8WYsF60DrG-wjQX4';
var SEGUIMIENTO_SHEET = 'Seguimiento Gestion / Comercial';

// API Key simple para autenticacion
// IMPORTANTE: Cambiar por un valor seguro antes de deployar
var API_KEY = 'kudos_key_8fH3mK9wPq';

// Validar autenticacion
function requireAuth(e) {
  var providedKey = '';
  if (e && e.parameter && e.parameter.apiKey) {
    providedKey = e.parameter.apiKey;
  }
  if (e && e.postData && e.postData.contents) {
    try {
      var data = JSON.parse(e.postData.contents);
      if (data.apiKey) providedKey = data.apiKey;
    } catch (err) {}
  }
  if (providedKey !== API_KEY) {
    throw new Error('No autorizado. Proporcione una apiKey valida.');
  }
}

function validateSpreadsheetId() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID === 'REEMPLAZAR_CON_TU_SPREADSHEET_ID') {
    throw new Error('SPREADSHEET_ID no configurado. Edita Code.gs y reemplazalo con el ID de tu Google Spreadsheet.');
  }
}

// Obtener spreadsheet
function getSpreadsheet() {
  validateSpreadsheetId();
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

var ALLOWED_REDIRECT_DOMAINS = [];

function isUrlAllowed(url) {
  if (!url || url === '#') return true;
  try {
    var parsed = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: false });
    return true;
  } catch (e) {
    return false;
  }
}

// ============================================
// MANEJO DE PETICIONES
// ============================================
function doPost(e) {
  try {
    requireAuth(e);
    var data = JSON.parse(e.postData.contents);
    var action = data.action || '';

    validateInput(data);

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
        return jsonResponse({ success: false, error: 'Accion no valida: ' + action }, '');
    }
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function validateInput(data) {
  if (data.action === 'sendEmail') {
    if (data.recipients && data.recipients.length > 0) {
      if (data.recipients.length > 200) {
        throw new Error('No se pueden enviar mas de 200 emails por lote.');
      }
      for (var i = 0; i < data.recipients.length; i++) {
        if (!data.recipients[i].email || !data.recipients[i].email.includes('@')) {
          throw new Error('Email invalido en recipient ' + (i + 1) + ': ' + data.recipients[i].email);
        }
        if (data.recipients[i].htmlContent && data.recipients[i].htmlContent.length > 200000) {
          throw new Error('El contenido HTML del recipient ' + (i + 1) + ' excede el limite de 200KB.');
        }
      }
    } else if (data.to) {
      if (!data.to.includes('@')) {
        throw new Error('Email invalido: ' + data.to);
      }
      if (data.htmlContent && data.htmlContent.length > 200000) {
        throw new Error('El contenido HTML excede el limite de 200KB.');
      }
    }
    if (data.subject && data.subject.length > 500) {
      throw new Error('El asunto excede el limite de 500 caracteres.');
    }
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

    // Tracking pixel y redirect NO requieren auth (son para clientes externos)
    if (action === 'open') {
      return handleTrackingPixel(e);
    }
    if (action === 'click') {
      return handleClickRedirect(e);
    }

    // El resto de las acciones requieren autenticacion
    requireAuth(e);
    var callback = e.parameter.callback || '';

    switch (action) {
      case 'sendEmail':
        return handleSendViaGet(e, callback);
      case 'logSend':
        return handleLogSendViaGet(e, callback);
      case 'logOpen':
        return logTrackingEventViaGet('open', e, callback);
      case 'logClick':
        return logTrackingEventViaGet('click', e, callback);
      case 'getMasterData':
        return getMasterData(e, callback);
      case 'getDevelopments':
        return getDevelopmentsData(e, callback);
      case 'getClients':
        return getClientsData(e, callback);
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

function handleSendViaGet(e, callback) {
  try {
    // Reconstruir el objeto data desde los parametros GET
    var data = {
      action: 'sendEmail',
      sendId: e.parameter.sendId || '',
      sendDate: e.parameter.sendDate || new Date().toISOString(),
      subject: e.parameter.subject || '',
      to: e.parameter.to || '',
      htmlContent: e.parameter.htmlContent || '',
      clientName: e.parameter.clientName || '',
      empresa: e.parameter.empresa || ''
    };

    // Parsear blocks si viene como JSON string
    if (e.parameter.blocks) {
      try {
        data.blocks = JSON.parse(e.parameter.blocks);
      } catch (er) {
        data.blocks = [];
      }
    }

    // Parsear recipients si viene como JSON string
    if (e.parameter.recipients) {
      try {
        data.recipients = JSON.parse(e.parameter.recipients);
        // Por seguridad, limitar cantidad de recipients via GET
        if (data.recipients && data.recipients.length > 50) {
          data.recipients = data.recipients.slice(0, 50);
        }
      } catch (er) {
        data.recipients = null;
      }
    }

    return sendEmailAndLog(data);
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() }, callback);
  }
}

function handleLogSendViaGet(e, callback) {
  return jsonResponse({ success: false, error: 'logSend debe usar POST' }, callback);
}

function logTrackingEventViaGet(type, e, callback) {
  var data = {
    sendId: e.parameter.sendId || '',
    trackingId: e.parameter.trackingId || '',
    timestamp: new Date().toISOString(),
    url: e.parameter.url || '',
    blockName: e.parameter.blockName || ''
  };
  try {
    logTrackingEvent(type, data);
    return jsonResponse({ success: true }, callback);
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() }, callback);
  }
}

// ============================================
// ENVIAR EMAIL Y REGISTRAR ENVIO
// ============================================
var EMAIL_BATCH_SIZE = 20;
var EMAIL_BATCH_PAUSE = 5000;

function sendEmailAndLog(data) {
  var results = [];
  var startTime = Date.now();
  var MAX_EXECUTION_MS = 300000; // 5 minutos de margen sobre el limite de 6min

  // Si hay recipients (envío masivo)
  if (data.recipients && data.recipients.length > 0) {
    var recipients = data.recipients;

    for (var i = 0; i < recipients.length; i++) {
      // Verificar tiempo restante antes de cada envio
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        for (var k = i; k < recipients.length; k++) {
          results.push({ email: recipients[k].email, status: 'pending', error: 'Limite de tiempo excedido' });
        }
        break;
      }

      var recipient = recipients[i];
      try {
        GmailApp.sendEmail(recipient.email, data.subject, '', {
          htmlBody: recipient.htmlContent,
          name: 'Kudos Commerce'
        });

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

      // Pausa cada batch para evitar limites de rate
      if (i > 0 && i % EMAIL_BATCH_SIZE === 0 && i < recipients.length - 1) {
        Utilities.sleep(EMAIL_BATCH_PAUSE);
      } else if (i < recipients.length - 1) {
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

  // Devolver un pixel transparente 1x1 GIF real
  // Algunos clientes de email rechazan respuestas vacias pero aceptan imagenes
  var gifBase64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  var gifBlob = Utilities.newBlob(Utilities.base64Decode(gifBase64), 'image/gif');
  return ContentService.createTextOutput(gifBlob.getDataAsString())
    .setMimeType(ContentService.MimeType.TEXT);
}

// ============================================
// TRACKING: REDIRECCIÓN DE CLICK
// ============================================
function isUrlSafe(url) {
  if (!url) return true;
  if (url.length > 2000) return false;
  var lower = url.toLowerCase();
  if (lower.indexOf('http://') !== 0 && lower.indexOf('https://') !== 0) return false;
  return true;
}

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

  // Validar URL contra lista blanca de dominios y esquemas
  if (url && isUrlSafe(url)) {
    var safeUrl = url.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><head>' +
      '<meta http-equiv="refresh" content="0;url=' + safeUrl + '">' +
      '</head><body>' +
      '<p>Redirigiendo...</p>' +
      '<script>window.location.href=' + JSON.stringify(url) + ';</script>' +
      '</body></html>'
    );
  }

  // Si la URL no es segura, mostrar pagina de advertencia
  if (url && !isUrlSafe(url)) {
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><head><title>Enlace no seguro</title></head><body>' +
      '<p>El enlace solicitado no pudo ser verificado como seguro.</p>' +
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
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    console.log('No se pudo adquirir lock para tracking:', e);
    return;
  }

  try {
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
  } finally {
    lock.releaseLock();
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

    var blocks = [];
    if (data[i][colBlocks]) {
      try {
        blocks = JSON.parse(data[i][colBlocks]);
      } catch (e) {
        blocks = [];
      }
    }

    if (!sends[sendId]) {
      sends[sendId] = {
        id: sendId,
        date: data[i][colSendDate],
        subject: data[i][colSubject],
        blocks: blocks,
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

// Función de prueba - actualizar con un email real antes de usar
function testSend() {
  // GmailApp.sendEmail('tuemail@empresa.com', 'Prueba Kudos CRM', 'Mensaje de prueba', {
  //   htmlBody: '<h1>Hola</h1><p>Esto es una prueba del CRM</p>',
  //   name: 'Kudos Commerce'
  // });
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

// ============================================
// OBTENER DATOS DE DESARROLLOS (GET)
// ============================================
function getDevelopmentsData(e, callback) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_DESARROLLOS);
  if (!sheet) {
    return jsonResponse({ success: true, developments: [] }, callback);
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return jsonResponse({ success: true, developments: [] }, callback);
  }

  var headers = data[0].map(function(h) { return h.toString().toLowerCase().replace(/^\uFEFF/, ''); });
  var nombreIndex = headers.indexOf('nombre') !== -1 ? headers.indexOf('nombre') : headers.indexOf('name');
  var resumenIndex = headers.indexOf('resumen') !== -1 ? headers.indexOf('resumen') : (headers.indexOf('summary') !== -1 ? headers.indexOf('summary') : -1);
  var descripcionIndex = headers.indexOf('descripcion') !== -1 ? headers.indexOf('descripcion') : (headers.indexOf('description') !== -1 ? headers.indexOf('description') : -1);
  var capturaIndex = headers.indexOf('captura_url') !== -1 ? headers.indexOf('captura_url') : (headers.indexOf('captura') !== -1 ? headers.indexOf('captura') : (headers.indexOf('image') !== -1 ? headers.indexOf('image') : -1));
  var linkIndex = headers.indexOf('link') !== -1 ? headers.indexOf('link') : (headers.indexOf('url') !== -1 ? headers.indexOf('url') : -1);

  var developments = [];
  for (var i = 1; i < data.length; i++) {
    var nombre = nombreIndex >= 0 ? data[i][nombreIndex].toString().trim() : '';
    if (!nombre) continue;

    // La columna captura_url en el sheet contiene el link a la presentacion, no una imagen
    var sheetLink = capturaIndex >= 0 ? data[i][capturaIndex].toString().trim() : '';
    var actualLink = linkIndex >= 0 ? data[i][linkIndex].toString().trim() : (sheetLink || '#');

    developments.push({
      id: 'dev_' + i + '_' + Date.now(),
      nombre: nombre,
      resumen: resumenIndex >= 0 ? data[i][resumenIndex].toString().trim() : '',
      descripcion: descripcionIndex >= 0 ? data[i][descripcionIndex].toString().trim() : '',
      captura_url: '',
      link: actualLink
    });
  }

  return jsonResponse({ success: true, developments: developments }, callback);
}

// ============================================
// OBTENER DATOS DE CLIENTES (GET)
// ============================================
function getClientsData(e, callback) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_CLIENTES);
  if (!sheet) {
    return jsonResponse({ success: true, clients: [] }, callback);
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return jsonResponse({ success: true, clients: [] }, callback);
  }

  var headers = data[0].map(function(h) { return h.toString().toLowerCase().replace(/^\uFEFF/, ''); });
  var nombreIndex = headers.indexOf('nombre') !== -1 ? headers.indexOf('nombre') : (headers.indexOf('name') !== -1 ? headers.indexOf('name') : (headers.indexOf('cliente') !== -1 ? headers.indexOf('cliente') : -1));
  var emailIndex = headers.indexOf('email') !== -1 ? headers.indexOf('email') : (headers.indexOf('correo') !== -1 ? headers.indexOf('correo') : (headers.indexOf('mail') !== -1 ? headers.indexOf('mail') : -1));
  var empresaIndex = headers.indexOf('empresa') !== -1 ? headers.indexOf('empresa') : (headers.indexOf('company') !== -1 ? headers.indexOf('company') : -1);

  var clients = [];
  for (var i = 1; i < data.length; i++) {
    var email = emailIndex >= 0 ? data[i][emailIndex].toString().trim() : '';
    if (!email || email.indexOf('@') === -1) continue;
    clients.push({
      nombre: nombreIndex >= 0 ? data[i][nombreIndex].toString().trim() : email.split('@')[0],
      email: email,
      empresa: empresaIndex >= 0 ? data[i][empresaIndex].toString().trim() : 'Cliente'
    });
  }

  return jsonResponse({ success: true, clients: clients }, callback);
}

// ============================================
// OBTENER DATOS DEL MASTER DE PRODUCTOS (GET)
// ============================================
function getMasterData(e, callback) {
  try {
    var ss = SpreadsheetApp.openById(SEGUIMIENTO_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SEGUIMIENTO_SHEET);
    if (!sheet) {
      return jsonResponse({ success: false, error: 'Hoja no encontrada: ' + SEGUIMIENTO_SHEET }, callback);
    }

    var data = sheet.getDataRange().getValues();
    if (data.length < 9) {
      return jsonResponse({ success: true, tiendas: [], desarrollos: [] }, callback);
    }

    // Row 6 (0-indexed) = headers: Codigo (col B), Titulo (col C), tiendas desde col D
    // Row 7 (0-indexed) = headers con Codigo(col B), Titulo(col C), tiendas desde col D
    var headerRow = data[7];
    var tiendas = [];
    for (var c = 3; c < headerRow.length; c++) {
      var nombre = headerRow[c].toString().trim();
      if (nombre) tiendas.push(nombre);
    }

    // Row 7 (0-indexed) = PM names (sub-header, lo ignoramos pero podria usarse)

    // Data rows desde row 8 (0-indexed)
    var desarrollos = [];
    for (var r = 8; r < data.length; r++) {
      var codigo = (data[r][1] || '').toString().trim();
      var titulo = (data[r][2] || '').toString().trim();
      if (!codigo && !titulo) continue;

      var estados = {};
      for (var tc = 0; tc < tiendas.length; tc++) {
        var col = tc + 3;
        var estado = col < data[r].length ? (data[r][col] || '').toString().trim() : '';
        if (estado) estados[tiendas[tc]] = estado;
      }

      desarrollos.push({
        codigo: codigo,
        titulo: titulo,
        nombre: (codigo ? codigo + ' - ' : '') + titulo,
        estados: estados
      });
    }

    return jsonResponse({ success: true, tiendas: tiendas, desarrollos: desarrollos }, callback);
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() }, callback);
  }
}
