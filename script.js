// ============================================
// CONFIGURACION
// ============================================
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/build/pdf.worker.min.js';

var SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSaMkkN_vbBOWt8xfuBjrk6egPV-8H0rlVw0eEmcAKIK-7aa_E0bVVGHQGwt_jl1uj4hEz5G82oIVrA/pub?output=csv';
var CLIENTS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSaMkkN_vbBOWt8xfuBjrk6egPV-8H0rlVw0eEmcAKIK-7aa_E0bVVGHQGwt_jl1uj4hEz5G82oIVrA/pub?gid=1654401836&single=true&output=csv';
var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzPUkdJc4XINr57b5Uxuohz6GJUTcIW59-2dDS4parofHVqZ67pz2ToHdZTPAlHSEb10A/exec';

var developments = [];
var clients = [];
var sortable;
var draggedItem = null;
var extractedDevelopments = [];
var devSearchTerm = '';
var clientSearchTerm = '';

// ============================================
// TRACKING & CRM
// ============================================
var TRACKING_STORAGE_KEY = 'kudosMailSends';
var POLL_INTERVAL = 15000;

function generateSendId() {
    return 'snd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function generateTrackingId() {
    return 'trk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function getSends() {
    try { return JSON.parse(localStorage.getItem(TRACKING_STORAGE_KEY) || '[]'); }
    catch (e) { return []; }
}

function saveSends(sends) {
    localStorage.setItem(TRACKING_STORAGE_KEY, JSON.stringify(sends));
}

function addSend(sendData) {
    var sends = getSends();
    sends.unshift(sendData);
    saveSends(sends);
    return sendData;
}

// Cargar envios desde Google Sheets usando JSONP (evita problemas de CORS)
function fetchFromSheet(action) {
    return new Promise(function(resolve) {
        var callbackName = 'kudosCallback_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
        var url = APPS_SCRIPT_URL + '?action=' + action + '&callback=' + callbackName + '&t=' + Date.now();
        
        window[callbackName] = function(data) {
            delete window[callbackName];
            if (document.getElementById(callbackName)) {
                document.getElementById(callbackName).remove();
            }
            resolve(data);
        };
        
        var script = document.createElement('script');
        script.id = callbackName;
        script.src = url;
        script.onerror = function() {
            delete window[callbackName];
            if (document.getElementById(callbackName)) {
                document.getElementById(callbackName).remove();
            }
            resolve(null);
        };
        document.head.appendChild(script);
        
        // Timeout de 10 segundos
        setTimeout(function() {
            if (window[callbackName]) {
                delete window[callbackName];
                if (document.getElementById(callbackName)) {
                    document.getElementById(callbackName).remove();
                }
                resolve(null);
            }
        }, 10000);
    });
}

async function fetchSendsFromSheet() {
    try {
        var data = await fetchFromSheet('getSends');
        if (data && data.success && data.sends) {
            saveSends(data.sends);
            return data.sends;
        }
    } catch (e) {
        console.log('Error cargando envios desde Sheet:', e);
    }
    return getSends();
}

// Cargar tracking desde Google Sheets (usa getSendsData que tiene contadores actualizados)
async function fetchTrackingFromSheet() {
    try {
        var data = await fetchFromSheet('getSends');
        if (data && data.success && data.sends) {
            return data.sends;
        }
    } catch (e) {
        console.log('Error cargando tracking desde Sheet:', e);
    }
    return getSends();
}

function getClientHistory(clientEmail) {
    var sends = getSends();
    var history = [];
    sends.forEach(function(send) {
        var recipient = send.recipients.find(function(r) { return r.email === clientEmail; });
        if (recipient) {
            history.push({
                sendId: send.id, subject: send.subject, date: send.date,
                status: recipient.status, openCount: recipient.openCount || 0,
                clickCount: recipient.clickCount || 0, lastEvent: recipient.lastEvent
            });
        }
    });
    return history;
}

function getAnalytics() {
    var sends = getSends();
    var totalSent = 0, totalOpened = 0, totalClicked = 0, totalBounced = 0, totalDelivered = 0;
    sends.forEach(function(send) {
        send.recipients.forEach(function(r) {
            totalSent++;
            if (r.status === 'opened' || r.status === 'clicked') totalOpened++;
            if (r.status === 'clicked') totalClicked++;
            if (r.status === 'bounced') totalBounced++;
            if (r.status !== 'bounced') totalDelivered++;
        });
    });
    var openRate = totalDelivered > 0 ? ((totalOpened / totalDelivered) * 100).toFixed(1) : 0;
    var clickRate = totalDelivered > 0 ? ((totalClicked / totalDelivered) * 100).toFixed(1) : 0;
    return { totalSent: totalSent, totalDelivered: totalDelivered, totalOpened: totalOpened, totalClicked: totalClicked, totalBounced: totalBounced, openRate: openRate, clickRate: clickRate };
}

function getTopClients(limit) {
    limit = limit || 10;
    var clientStats = {};
    var sends = getSends();
    sends.forEach(function(send) {
        send.recipients.forEach(function(r) {
            if (!clientStats[r.email]) {
                clientStats[r.email] = { nombre: r.nombre, email: r.email, empresa: r.empresa, sentCount: 0, openCount: 0, clickCount: 0 };
            }
            clientStats[r.email].sentCount++;
            if (r.status === 'opened' || r.status === 'clicked') clientStats[r.email].openCount++;
            if (r.status === 'clicked') clientStats[r.email].clickCount++;
        });
    });
    return Object.values(clientStats).sort(function(a, b) { return b.openCount - a.openCount; }).slice(0, limit);
}

function getRecentActivity(limit) {
    limit = limit || 20;
    var activities = [];
    var sends = getSends();
    sends.forEach(function(send) {
        send.recipients.forEach(function(r) {
            if (r.status !== 'sent') {
                activities.push({
                    type: r.status === 'clicked' ? 'click' : r.status === 'opened' ? 'open' : r.status === 'bounced' ? 'bounce' : 'send',
                    clientName: r.nombre, clientEmail: r.email, subject: send.subject,
                    date: r.lastEvent || send.date, sendId: send.id
                });
            }
        });
    });
    return activities.sort(function(a, b) { return new Date(b.date) - new Date(a.date); }).slice(0, limit);
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================
function showToast(message, type) {
    type = type || 'info';
    var container = document.getElementById('toast-container');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    var icons = {
        success: '<i class="fas fa-check-circle" style="color:#34a853;font-size:16px;"></i>',
        error: '<i class="fas fa-exclamation-circle" style="color:#dc3545;font-size:16px;"></i>',
        warning: '<i class="fas fa-exclamation-triangle" style="color:#f9ab00;font-size:16px;"></i>',
        info: '<i class="fas fa-info-circle" style="color:#1a73e8;font-size:16px;"></i>'
    };
    toast.innerHTML = (icons[type] || icons.info) + '<span>' + escapeHtml(message) + '</span>';
    container.appendChild(toast);
    setTimeout(function() {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(function() { toast.remove(); }, 300);
    }, 4000);
}

// ============================================
// FUNCIONES DE IMPORTACION DE ARCHIVOS
// ============================================
async function importFile(file) {
    var extension = file.name.split('.').pop().toLowerCase();
    showLoading('Extrayendo informacion del archivo...');
    try {
        var text = '';
        if (extension === 'pdf') { text = await extractFromPDF(file); }
        else if (extension === 'docx') { text = await extractFromDOCX(file); }
        else if (extension === 'pptx') { text = await extractFromPPTX(file); }
        else { showToast('Formato no soportado. Usa PDF, DOCX o PPTX', 'error'); return; }
        extractedDevelopments = parseDevelopmentsFromText(text);
        if (extractedDevelopments.length === 0) { showToast('No se encontraron desarrollos en el archivo', 'warning'); return; }
        showPreview(extractedDevelopments);
    } catch (error) {
        showToast('Error al procesar el archivo: ' + error.message, 'error');
    }
}

async function extractFromPDF(file) {
    var arrayBuffer = await file.arrayBuffer();
    var pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    var fullText = '';
    for (var i = 1; i <= pdf.numPages; i++) {
        var page = await pdf.getPage(i);
        var textContent = await page.getTextContent();
        fullText += textContent.items.map(function(item) { return item.str; }).join(' ') + '\n';
    }
    return fullText;
}

async function extractFromDOCX(file) {
    var arrayBuffer = await file.arrayBuffer();
    var result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    return result.value;
}

async function extractFromPPTX(file) {
    return "Procesando PPTX... Los desarrollos se extraeran automaticamente";
}

function parseDevelopmentsFromText(text) {
    var developmentsFound = [];
    var knownDevelopments = [
        'Carrusel de Videos', 'Cross Selling', 'Compra Conjunta', 'Barra progresiva de Envio',
        'Barra progresiva de Financiacion', 'Shop the Look', 'Administrador de Cucardas',
        'Landing de Medios de Pago', 'Programacion de Banners', 'Quick View',
        'Calculador de Litros', 'Panel promociones de medios de pago', 'Cronometro de Ofertas',
        'Carrusel Programable', 'Popup de Promociones Bancarias', 'Landing Modelo',
        'Shop Our Instagram', 'Editor de Variantes', 'Calculador de Cuotas',
        'Mensaje Promocional', 'Asistente Informativo', 'Banner con cuenta regresiva'
    ];
    for (var i = 0; i < knownDevelopments.length; i++) {
        var devName = knownDevelopments[i];
        var regex = new RegExp('(' + devName + '[^\n]{10,100})([\s\S]{100,800}?)(?=\n\s*\n\s*[A-Z]|$)', 'i');
        var match = text.match(regex);
        if (match) {
            var fullText = match[0];
            var summary = extractSummary(fullText);
            var description = fullText.substring(0, 500).replace(/[*_#]/g, '');
            var link = '#';
            var linkMatch = fullText.match(/https?:\/\/[^\s\)\n]+/i);
            if (linkMatch) link = linkMatch[0];
            developmentsFound.push({
                nombre: devName, resumen: summary, descripcion: description,
                captura_url: 'https://via.placeholder.com/400x200?text=' + encodeURIComponent(devName), link: link
            });
        }
    }
    if (developmentsFound.length === 0) {
        var sections = text.split(/\n(?:###|#{2,3}|\d+\.\s+)/);
        for (var j = 0; j < sections.length; j++) {
            var section = sections[j];
            if (section.length > 50 && section.length < 2000) {
                var lines = section.split('\n').filter(function(l) { return l.trim(); });
                if (lines.length > 0) {
                    var nombre = lines[0].substring(0, 60).replace(/[*_#]/g, '').trim();
                    if (nombre.length > 5 && !nombre.match(/^\d+$/)) {
                        developmentsFound.push({
                            nombre: nombre, resumen: extractSummary(section),
                            descripcion: section.substring(0, 500).replace(/[*_#]/g, ''),
                            captura_url: 'https://via.placeholder.com/400x200', link: '#'
                        });
                    }
                }
            }
        }
    }
    return developmentsFound;
}

function extractSummary(text) {
    var cleaned = text.replace(/\s+/g, ' ').trim().replace(/[*_#]/g, '');
    var bulletMatch = cleaned.match(/[•\-*]\s*([^.\n]{30,150})/);
    if (bulletMatch) return bulletMatch[1].trim();
    if (cleaned.length > 200) cleaned = cleaned.substring(0, 200) + '...';
    return cleaned;
}

function showPreview(developments) {
    var previewDiv = document.getElementById('import-preview');
    var contentDiv = document.getElementById('preview-content');
    contentDiv.innerHTML = '';
    developments.forEach(function(dev, idx) {
        var item = document.createElement('div');
        item.className = 'preview-item';
        item.innerHTML = '<strong>' + escapeHtml(dev.nombre) + '</strong><br><small>' + escapeHtml(dev.resumen.substring(0, 100)) + '...</small><br><label style="font-size:11px;margin-top:5px;display:inline-block;"><input type="checkbox" checked data-idx="' + idx + '" class="preview-checkbox"> Importar este desarrollo</label>';
        contentDiv.appendChild(item);
    });
    previewDiv.style.display = 'block';
}

function confirmImport() {
    var checkboxes = document.querySelectorAll('.preview-checkbox:checked');
    var selectedDevelopments = [];
    checkboxes.forEach(function(cb) {
        var idx = parseInt(cb.getAttribute('data-idx'));
        if (extractedDevelopments[idx]) selectedDevelopments.push(extractedDevelopments[idx]);
    });
    if (selectedDevelopments.length === 0) { showToast('Selecciona al menos un desarrollo', 'warning'); return; }
    var existingNames = new Set(developments.map(function(d) { return d.nombre; }));
    var newDevelopments = selectedDevelopments.filter(function(d) { return !existingNames.has(d.nombre); });
    developments.push.apply(developments, newDevelopments);
    localStorage.setItem('importedDevelopments', JSON.stringify(developments));
    renderSidebar();
    document.getElementById('import-preview').style.display = 'none';
    showToast(newDevelopments.length + ' desarrollos importados correctamente', 'success');
    generateCSV(newDevelopments);
}

function generateCSV(developmentsToExport) {
    var csvData = developmentsToExport.map(function(dev) {
        return { nombre: dev.nombre, resumen: dev.resumen, descripcion: dev.descripcion, captura_url: dev.captura_url, link: dev.link };
    });
    var csv = Papa.unparse(csvData);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'desarrollos_importados_' + Date.now() + '.csv'; a.click();
    URL.revokeObjectURL(url);
}

function exportAllDevelopmentsToCSV() {
    if (developments.length === 0) { showToast('No hay desarrollos para exportar', 'warning'); return; }
    var csvData = developments.map(function(dev) {
        return { nombre: dev.nombre, resumen: dev.resumen, descripcion: dev.descripcion, captura_url: dev.captura_url, link: dev.link };
    });
    var csv = Papa.unparse(csvData);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'todos_los_desarrollos_' + Date.now() + '.csv'; a.click();
    URL.revokeObjectURL(url);
    showToast('Exportados ' + developments.length + ' desarrollos a CSV', 'success');
}

function showLoading(message) {
    var previewDiv = document.getElementById('import-preview');
    var contentDiv = document.getElementById('preview-content');
    contentDiv.innerHTML = '<div class="loading">' + message + '</div>';
    previewDiv.style.display = 'block';
}

// ============================================
// FORZAR RECARGA
// ============================================
async function forceReloadData() {
    var btn = document.getElementById('force-reload-data');
    if (!btn) return;
    var originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Limpiando cache...';
    btn.disabled = true;
    try {
        localStorage.removeItem('importedDevelopments');
        localStorage.removeItem('backupDevelopments');
        var urlWithTimestamp = SHEET_URL + '&t=' + new Date().getTime();
        var response = await fetch(urlWithTimestamp, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
        if (response.ok) {
            var csv = await response.text();
            developments = parseCSV(csv);
            localStorage.setItem('backupDevelopments', JSON.stringify(developments));
            renderSidebar();
            showToast('Recarga completa: ' + developments.length + ' desarrollos cargados', 'success');
        } else { throw new Error('HTTP ' + response.status); }
    } catch (error) {
        showToast('Error al recargar: ' + error.message, 'error');
    } finally { btn.innerHTML = originalText; btn.disabled = false; }
}

// ============================================
// CARGA DE DATOS
// ============================================
async function loadDevelopments() {
    var container = document.getElementById('blocks-list');
    container.innerHTML = '<div class="loading">Cargando desarrollos...</div>';
    try {
        var urlWithTimestamp = SHEET_URL + '&t=' + new Date().getTime();
        var response = await fetch(urlWithTimestamp, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
        if (response.ok) {
            var csv = await response.text();
            if (csv.trim().length === 0) throw new Error('CSV vacio');
            developments = parseCSV(csv);
        } else { throw new Error('HTTP ' + response.status); }
    } catch (error) {
        developments = getMockDevelopments();
        mostrarError('Usando datos de ejemplo para desarrollos');
    }
    loadImportedDevelopments();
    renderSidebar();
}

async function loadClients() {
    var container = document.getElementById('clients-list');
    if (!container) return;
    container.innerHTML = '<div class="loading">Cargando clientes...</div>';
    var savedClients = localStorage.getItem('clientesData');
    if (savedClients) {
        try {
            clients = JSON.parse(savedClients);
            if (clients.length > 0) { renderClientSelector(); return; }
        } catch (e) {}
    }
    try {
        var urlWithTimestamp = CLIENTS_SHEET_URL + '&t=' + new Date().getTime();
        var response = await fetch(urlWithTimestamp, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
        if (response.ok) {
            var csv = await response.text();
            var parsedClients = parseClientsFromCSV(csv);
            if (parsedClients.length > 0) {
                clients = parsedClients;
                localStorage.setItem('clientesData', JSON.stringify(clients));
                renderClientSelector();
                return;
            }
        }
    } catch (error) { console.error('Error cargando clientes:', error); }
    clients = [
        { nombre: "Juan Perez", email: "juan.perez@ejemplo.com", empresa: "Empresa A" },
        { nombre: "Maria Garcia", email: "maria.garcia@ejemplo.com", empresa: "Empresa B" },
        { nombre: "Carlos Lopez", email: "carlos.lopez@ejemplo.com", empresa: "Empresa C" },
        { nombre: "Ana Martinez", email: "ana.martinez@ejemplo.com", empresa: "Empresa D" },
        { nombre: "Roberto Sanchez", email: "roberto.sanchez@ejemplo.com", empresa: "Empresa E" }
    ];
    localStorage.setItem('clientesData', JSON.stringify(clients));
    renderClientSelector();
}

function parseClientsFromCSV(csv) {
    var lines = csv.split('\n').filter(function(line) { return line.trim(); });
    if (lines.length < 2) return [];
    var headers = lines[0].split(',').map(function(h) { return h.trim().toLowerCase().replace(/^\uFEFF/, ''); });
    var nombreIndex = headers.findIndex(function(h) { return h.includes('nombre') || h.includes('name') || h.includes('cliente'); });
    var emailIndex = headers.findIndex(function(h) { return h.includes('email') || h.includes('correo') || h.includes('mail'); });
    var empresaIndex = headers.findIndex(function(h) { return h.includes('empresa') || h.includes('company'); });
    if (emailIndex === -1) return [];
    var clientsList = [];
    for (var i = 1; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        var values = parseCSVLine(line);
        var email = emailIndex >= 0 && values[emailIndex] ? values[emailIndex].trim() : '';
        if (email && email.includes('@')) {
            clientsList.push({
                nombre: nombreIndex >= 0 && values[nombreIndex] ? values[nombreIndex].trim() : email.split('@')[0],
                email: email,
                empresa: empresaIndex >= 0 && values[empresaIndex] ? values[empresaIndex].trim() : 'Cliente'
            });
        }
    }
    return clientsList;
}

// ============================================
// RENDERIZADO
// ============================================
function renderSidebar() {
    var container = document.getElementById('blocks-list');
    container.innerHTML = '';
    var filtered = developments;
    if (devSearchTerm) {
        filtered = developments.filter(function(d) {
            return d.nombre.toLowerCase().includes(devSearchTerm.toLowerCase()) || (d.resumen && d.resumen.toLowerCase().includes(devSearchTerm.toLowerCase()));
        });
    }
    if (filtered.length === 0) {
        container.innerHTML = '<div class="loading">No hay desarrollos que coincidan</div>';
        return;
    }
    filtered.forEach(function(dev) {
        var originalIdx = developments.findIndex(function(d) { return d.nombre === dev.nombre; });
        var block = document.createElement('div');
        block.className = 'block-card';
        block.setAttribute('draggable', 'true');
        block.setAttribute('data-dev-index', originalIdx);
        block.innerHTML = '<div class="block-header"><h3>' + escapeHtml(dev.nombre) + '</h3><button class="add-to-email-btn" data-dev-index="' + originalIdx + '">+ Agregar</button></div><div class="summary">' + escapeHtml(dev.resumen || 'Sin resumen') + '</div>' + (dev.captura_url ? '<img src="' + dev.captura_url + '" alt="' + escapeHtml(dev.nombre) + '" onerror="this.src=\'https://via.placeholder.com/300x150\'" style="max-width:100%;border-radius:6px;margin-bottom:8px;">' : '') + '<div class="link"><a href="' + dev.link + '" target="_blank">Ver desarrollo</a></div>';
        block.addEventListener('dragstart', handleDragStart);
        block.addEventListener('dragend', handleDragEnd);
        block.querySelector('.add-to-email-btn').addEventListener('click', function(e) { e.stopPropagation(); addBlock(originalIdx); });
        container.appendChild(block);
    });
}

function renderClientSelector() {
    var container = document.getElementById('clients-list');
    if (!container) return;
    container.innerHTML = '';
    var filtered = clients;
    if (clientSearchTerm) {
        filtered = clients.filter(function(c) {
            return c.nombre.toLowerCase().includes(clientSearchTerm.toLowerCase()) || c.email.toLowerCase().includes(clientSearchTerm.toLowerCase()) || c.empresa.toLowerCase().includes(clientSearchTerm.toLowerCase());
        });
    }
    if (filtered.length === 0) {
        container.innerHTML = '<div class="loading">No hay clientes que coincidan</div>';
        updateSelectionInfo();
        return;
    }
    var selectAllDiv = document.createElement('div');
    selectAllDiv.className = 'client-item';
    selectAllDiv.style.background = '#e9ecef';
    selectAllDiv.style.fontWeight = 'bold';
    selectAllDiv.innerHTML = '<input type="checkbox" id="select-all-clients" style="margin-right:10px;"><label for="select-all-clients" style="font-weight:bold;">Seleccionar todos (' + filtered.length + ')</label>';
    container.appendChild(selectAllDiv);

    filtered.forEach(function(client) {
        var originalIdx = clients.findIndex(function(c) { return c.email === client.email; });
        var div = document.createElement('div');
        div.className = 'client-item';
        div.innerHTML = '<input type="checkbox" class="client-checkbox" id="client_' + originalIdx + '" value="' + originalIdx + '" checked><label for="client_' + originalIdx + '" style="cursor:pointer;"><strong>' + escapeHtml(client.nombre) + '</strong><br><small>' + escapeHtml(client.email) + ' | ' + escapeHtml(client.empresa) + '</small></label>';
        // Click on client name to show profile
        var strongEl = div.querySelector('strong');
        strongEl.style.cursor = 'pointer';
        strongEl.style.color = '#1a73e8';
        strongEl.addEventListener('click', function(e) {
            e.preventDefault();
            showClientProfile(client.email);
        });
        container.appendChild(div);
    });

    var selectAllCheckbox = document.getElementById('select-all-clients');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', function(e) {
            document.querySelectorAll('.client-checkbox').forEach(function(cb) { cb.checked = e.target.checked; });
            updateSelectionInfo();
        });
    }
    document.querySelectorAll('.client-checkbox').forEach(function(cb) { cb.addEventListener('change', function() { updateSelectionInfo(); }); });
    updateSelectionInfo();
}

function updateSelectionInfo() {
    var selectedCount = document.querySelectorAll('.client-checkbox:checked').length;
    var infoDiv = document.getElementById('selection-info');
    if (infoDiv) infoDiv.textContent = selectedCount + ' cliente' + (selectedCount !== 1 ? 's' : '') + ' seleccionado' + (selectedCount !== 1 ? 's' : '');
}

function renderEmailBlocks() {
    var container = document.getElementById('email-blocks');
    container.innerHTML = '';
    var savedBlocks = JSON.parse(localStorage.getItem('emailBlocks') || '[]');
    if (savedBlocks.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-thumbtack empty-icon"></i><p>Arrastra desarrollos aqui</p><small>o haz clic en "+ Agregar"</small></div>';
    }
    savedBlocks.forEach(function(block, idx) {
        var dev = developments[block.devIndex];
        if (!dev) return;
        var blockDiv = document.createElement('div');
        blockDiv.className = 'block-item';
        blockDiv.setAttribute('data-idx', idx);
        blockDiv.innerHTML = '<button class="remove-block" data-idx="' + idx + '">&times;</button><h3>' + escapeHtml(dev.nombre) + '</h3><div class="description">' + escapeHtml(dev.descripcion || dev.resumen || 'Sin descripcion') + '</div><a href="' + dev.link + '" target="_blank" class="block-link">Ver mas</a>';
        blockDiv.querySelector('.remove-block').addEventListener('click', function(e) { e.stopPropagation(); removeBlock(idx); });
        container.appendChild(blockDiv);
    });
    if (sortable) sortable.destroy();
    sortable = new Sortable(container, { animation: 150, onEnd: function() { saveOrder(); } });
}

function removeBlock(idx) {
    var blocks = JSON.parse(localStorage.getItem('emailBlocks') || '[]');
    blocks.splice(idx, 1);
    localStorage.setItem('emailBlocks', JSON.stringify(blocks));
    renderEmailBlocks();
}

function saveOrder() {
    var container = document.getElementById('email-blocks');
    var items = container.querySelectorAll('.block-item');
    var newOrder = [];
    var blocks = JSON.parse(localStorage.getItem('emailBlocks') || '[]');
    items.forEach(function(item) {
        var idx = parseInt(item.getAttribute('data-idx'));
        if (!isNaN(idx) && blocks[idx]) newOrder.push(blocks[idx]);
    });
    localStorage.setItem('emailBlocks', JSON.stringify(newOrder));
    renderEmailBlocks();
}

function getCurrentEmailBlocks() {
    var blocks = [];
    var savedBlocks = JSON.parse(localStorage.getItem('emailBlocks') || '[]');
    savedBlocks.forEach(function(block) {
        var dev = developments[block.devIndex];
        if (dev) blocks.push(dev);
    });
    return blocks;
}

function addBlock(devIndex) {
    var savedBlocks = JSON.parse(localStorage.getItem('emailBlocks') || '[]');
    savedBlocks.push({ devIndex: devIndex });
    localStorage.setItem('emailBlocks', JSON.stringify(savedBlocks));
    renderEmailBlocks();
    showToast('Desarrollo agregado al email', 'success');
}

function clearAllBlocks() {
    if (confirm('Eliminar todos los desarrollos del email?')) {
        localStorage.setItem('emailBlocks', JSON.stringify([]));
        renderEmailBlocks();
    }
}

function loadImportedDevelopments() {
    var saved = localStorage.getItem('importedDevelopments');
    if (saved) {
        var imported = JSON.parse(saved);
        var existingNames = new Set(developments.map(function(d) { return d.nombre; }));
        var newDevelopments = imported.filter(function(d) { return !existingNames.has(d.nombre); });
        developments.push.apply(developments, newDevelopments);
    }
}

function parseCSV(csv) {
    var lines = csv.split('\n').filter(function(line) { return line.trim(); });
    if (lines.length < 2) return [];
    var headers = lines[0].split(',').map(function(h) { return h.trim().toLowerCase().replace(/^\uFEFF/, ''); });
    var nombreIndex = headers.findIndex(function(h) { return h.includes('nombre') || h.includes('name'); });
    var resumenIndex = headers.findIndex(function(h) { return h.includes('resumen') || h.includes('summary'); });
    var descripcionIndex = headers.findIndex(function(h) { return h.includes('descripcion') || h.includes('description'); });
    var capturaIndex = headers.findIndex(function(h) { return h.includes('captura') || h.includes('image'); });
    var linkIndex = headers.findIndex(function(h) { return h.includes('link') || h.includes('url'); });
    var data = [];
    for (var i = 1; i < lines.length; i++) {
        var values = parseCSVLine(lines[i]);
        if (values.length > 0 && values[0].trim()) {
            data.push({
                nombre: nombreIndex >= 0 ? (values[nombreIndex] || 'Sin titulo').trim() : 'Desarrollo ' + i,
                resumen: resumenIndex >= 0 ? (values[resumenIndex] || '').trim() : '',
                descripcion: descripcionIndex >= 0 ? (values[descripcionIndex] || '').trim() : '',
                captura_url: capturaIndex >= 0 ? (values[capturaIndex] || 'https://via.placeholder.com/300x150').trim() : 'https://via.placeholder.com/300x150',
                link: linkIndex >= 0 ? (values[linkIndex] || '#').trim() : '#'
            });
        }
    }
    return data;
}

function parseCSVLine(line) {
    var result = [];
    var inQuotes = false;
    var currentValue = '';
    for (var i = 0; i < line.length; i++) {
        var char = line[i];
        if (char === '"') { inQuotes = !inQuotes; }
        else if (char === ',' && !inQuotes) { result.push(currentValue); currentValue = ''; }
        else { currentValue += char; }
    }
    result.push(currentValue);
    return result.map(function(val) { return val.replace(/^"|"$/g, '').trim(); });
}

// ============================================
// DRAG & DROP
// ============================================
function handleDragStart(e) {
    draggedItem = this;
    e.dataTransfer.setData('text/plain', this.getAttribute('data-dev-index'));
    e.dataTransfer.effectAllowed = 'copy';
}

function handleDragEnd() { draggedItem = null; }

function setupDropZone() {
    var dropZone = document.getElementById('email-blocks');
    dropZone.addEventListener('dragover', function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; dropZone.style.background = '#e8f0fe'; });
    dropZone.addEventListener('dragleave', function() { dropZone.style.background = ''; });
    dropZone.addEventListener('drop', function(e) {
        e.preventDefault(); dropZone.style.background = '';
        if (draggedItem) { var devIndex = parseInt(draggedItem.getAttribute('data-dev-index')); if (!isNaN(devIndex)) addBlock(devIndex); }
    });
}

// ============================================
// ENVIO DE CORREOS CON TRACKING
// ============================================
async function sendEmails() {
    var selectedClients = [];
    document.querySelectorAll('.client-checkbox:checked').forEach(function(checkbox) {
        var idx = parseInt(checkbox.value);
        if (clients[idx]) selectedClients.push(clients[idx]);
    });
    if (selectedClients.length === 0) { showToast('Selecciona al menos un cliente', 'warning'); return; }
    var blocks = getCurrentEmailBlocks();
    if (blocks.length === 0) { showToast('Agrega al menos un desarrollo al email', 'warning'); return; }

    var sendId = generateSendId();
    var sendDate = new Date().toISOString();
    var subject = 'Nuevos desarrollos para tu tienda VTEX | Kudos Commerce';
    var blocksData = blocks.map(function(b) { return { nombre: b.nombre, resumen: b.resumen, link: b.link }; });
    var recipients = selectedClients.map(function(client) {
        return { trackingId: generateTrackingId(), email: client.email, nombre: client.nombre, empresa: client.empresa, status: 'sent', openCount: 0, clickCount: 0, lastEvent: sendDate };
    });

    var sendData = {
        id: sendId, date: sendDate, subject: subject,
        blocks: blocksData, totalRecipients: selectedClients.length, recipients: recipients
    };

    var sendButton = document.getElementById('send-emails');
    var originalHTML = sendButton.innerHTML;
    sendButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
    sendButton.disabled = true;

    // Preparar recipients con su HTML individual para el Apps Script
    var recipientsWithHTML = [];
    for (var i = 0; i < selectedClients.length; i++) {
        var client = selectedClients[i];
        var recipient = recipients[i];
        var blocksHTML = blocks.map(function(block) {
            var trackableLink = APPS_SCRIPT_URL + '?action=click&sendId=' + sendId + '&trkId=' + recipient.trackingId + '&url=' + encodeURIComponent(block.link || '#');
            return '<div style="border:1px solid #e0e0e0;border-radius:8px;padding:15px;margin-bottom:15px;font-family:Arial,sans-serif;"><h3 style="color:#1a73e8;margin-top:0;margin-bottom:10px;">' + escapeHtml(block.nombre) + '</h3><p style="margin:0 0 10px 0;line-height:1.5;">' + escapeHtml(block.descripcion || block.resumen || '') + '</p><a href="' + trackableLink + '" style="color:#1a73e8;text-decoration:none;">Ver desarrollo</a></div>';
        }).join('');
        var trackingPixel = '<img src="' + APPS_SCRIPT_URL + '?action=open&sendId=' + sendId + '&trkId=' + recipient.trackingId + '" width="1" height="1" style="display:none;" />';
        var emailTemplate = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"><div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:30px 20px;text-align:center;border-radius:12px 12px 0 0;"><h1 style="margin:0;">Kudos Commerce</h1><p style="margin:10px 0 0;">Especialistas en comercio unificado</p></div><div style="padding:20px;border:1px solid #e0e0e0;border-top:none;background:white;"><h2 style="color:#2c3e50;margin-top:0;">Nuevos desarrollos disponibles</h2><div style="margin-top:20px;">' + blocksHTML + '</div><div style="margin-top:30px;padding-top:20px;border-top:1px solid #e0e0e0;font-size:12px;color:#666;text-align:center;"><p>2026 Kudos Commerce - Todos los derechos reservados</p></div></div>' + trackingPixel + '</body></html>';

        recipientsWithHTML.push({
            trackingId: recipient.trackingId,
            email: client.email,
            nombre: client.nombre,
            empresa: client.empresa,
            htmlContent: emailTemplate
        });
        sendButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparando ' + (i + 1) + '/' + selectedClients.length + '...';
    }

    // Enviar todo al Apps Script: envía emails + guarda en Sheets
    var successCount = 0, errorCount = 0;
    try {
        await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'sendEmail',
                sendId: sendId,
                sendDate: sendDate,
                subject: subject,
                blocks: blocksData,
                recipients: recipientsWithHTML
            })
        });
        successCount = selectedClients.length;
    } catch (error) {
        errorCount = selectedClients.length;
        recipients.forEach(function(r) { r.status = 'bounced'; });
    }

    // Guardar localmente como cache
    addSend(sendData);
    sendButton.innerHTML = originalHTML;
    sendButton.disabled = false;
    if (errorCount === 0) showToast('Se enviaron ' + successCount + ' correos correctamente', 'success');
    else showToast('Envio: ' + successCount + ' exitosos, ' + errorCount + ' fallidos', 'warning');
    renderHistory(); renderAnalytics(); switchTab('history');
}

async function reloadClients() {
    var btn = document.getElementById('reload-clients');
    if (btn) {
        var originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-redo fa-spin"></i>';
        btn.disabled = true;
        localStorage.removeItem('clientesData');
        await loadClients();
        btn.innerHTML = originalText; btn.disabled = false;
    } else { await loadClients(); }
}

// ============================================
// EXPORTACION
// ============================================
function exportToHTML() {
    var headerHTML = document.querySelector('.email-header').cloneNode(true);
    var footerHTML = document.querySelector('.email-footer').cloneNode(true);
    var blocksContainer = document.getElementById('email-blocks');
    var blocksHTML = Array.from(blocksContainer.querySelectorAll('.block-item')).map(function(block) {
        var clone = block.cloneNode(true);
        var removeBtn = clone.querySelector('.remove-block');
        if (removeBtn) removeBtn.remove();
        return clone.outerHTML;
    }).join('');
    return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Email - Kudos Commerce</title><style>body{font-family:Arial,sans-serif;margin:0;padding:20px;background:#f4f4f4;}.email-container{max-width:600px;margin:0 auto;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1);}.email-header{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:30px 20px;text-align:center;}.email-footer{background:#2c3e50;color:white;padding:20px;text-align:center;font-size:12px;}.email-blocks{padding:20px;}.block-item{border:1px solid #e0e0e0;border-radius:8px;padding:15px;margin-bottom:15px;}.block-item h3{color:#1a73e8;margin-bottom:8px;}</style></head><body><div class="email-container">' + headerHTML.outerHTML + '<div class="email-blocks">' + blocksHTML + '</div>' + footerHTML.outerHTML + '</div></body></html>';
}

async function copyHTML() {
    var html = exportToHTML();
    try { await navigator.clipboard.writeText(html); showToast('HTML copiado al portapapeles', 'success'); }
    catch (err) { showToast('Error al copiar', 'error'); }
}

function downloadHTML() {
    var html = exportToHTML();
    var blob = new Blob([html], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'email-' + Date.now() + '.html'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Email exportado correctamente', 'success');
}

// ============================================
// UTILIDADES
// ============================================
function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function mostrarError(mensaje) {
    var container = document.getElementById('blocks-list');
    var errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = mensaje;
    container.innerHTML = '';
    container.appendChild(errorDiv);
}

function getMockDevelopments() {
    return [
        { nombre: "Carrusel de Videos en Home", resumen: "Muestra videos de productos destacados en Home", descripcion: "Solucion que permite mostrar productos destacados de forma dinamica.", captura_url: "https://via.placeholder.com/300x150", link: "#" },
        { nombre: "Cross Selling en Checkout", resumen: "Maximiza el valor de cada compra", descripcion: "Presenta productos complementarios justo antes del checkout.", captura_url: "https://via.placeholder.com/300x150", link: "#" },
        { nombre: "Compra Conjunta en PDP", resumen: "Sugiere productos complementarios en PDP", descripcion: "Muestra productos complementarios como oferta de combo.", captura_url: "https://via.placeholder.com/300x150", link: "#" }
    ];
}

function getTimeAgo(dateStr) {
    var now = new Date();
    var date = new Date(dateStr);
    var diffMs = now - date;
    var diffMins = Math.floor(diffMs / 60000);
    var diffHours = Math.floor(diffMs / 3600000);
    var diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'Ahora';
    if (diffMins < 60) return diffMins + ' min';
    if (diffHours < 24) return diffHours + 'h';
    return diffDays + 'd';
}

// ============================================
// TABS
// ============================================
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(function(btn) { btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName); });
    document.querySelectorAll('.tab-content').forEach(function(content) { content.classList.toggle('active', content.id === 'tab-' + tabName); });
    if (tabName === 'history') renderHistory();
    if (tabName === 'analytics') renderAnalytics();
}

// ============================================
// HISTORIAL
// ============================================
function renderHistory() {
    var container = document.getElementById('history-container');
    if (!container) return;
    var sends = getSends();
    if (sends.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox empty-icon"></i><p>No hay envios registrados</p><small>Los envios apareceran aqui</small></div>';
        return;
    }
    var html = '<div class="history-list">';
    sends.forEach(function(send) {
        var opened = 0, clicked = 0, bounced = 0;
        send.recipients.forEach(function(r) { if (r.status === 'opened') opened++; if (r.status === 'clicked') clicked++; if (r.status === 'bounced') bounced++; });
        var totalRecipients = send.recipients.length;
        var openRate = totalRecipients > 0 ? ((opened + clicked) / totalRecipients * 100).toFixed(0) : 0;
        var progressColor = openRate > 50 ? '#34a853' : openRate > 20 ? '#f9ab00' : '#dc3545';
        var dateStr = new Date(send.date).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        html += '<div class="history-card" onclick="showSendDetail(\'' + send.id + '\')"><div class="history-card-header"><h3>' + escapeHtml(send.subject) + '</h3><span class="history-card-date">' + dateStr + '</span></div><div class="history-card-stats"><span class="history-stat stat-sent"><i class="fas fa-paper-plane"></i> ' + totalRecipients + '</span><span class="history-stat stat-opened"><i class="fas fa-eye"></i> ' + (opened + clicked) + '</span><span class="history-stat stat-clicked"><i class="fas fa-mouse-pointer"></i> ' + clicked + '</span>' + (bounced > 0 ? '<span class="history-stat stat-bounced"><i class="fas fa-exclamation-circle"></i> ' + bounced + '</span>' : '') + '</div><div class="history-card-clients"><i class="fas fa-users"></i> ' + totalRecipients + ' destinatarios</div><div class="history-progress-bar"><div class="history-progress-fill" style="width:' + openRate + '%;background:' + progressColor + ';"></div></div></div>';
    });
    html += '</div>';
    container.innerHTML = html;
}

// ============================================
// DETALLE DE ENVIO (MODAL)
// ============================================
function showSendDetail(sendId) {
    var sends = getSends();
    var send = sends.find(function(s) { return s.id === sendId; });
    if (!send) return;
    var modal = document.getElementById('send-detail-modal');
    var title = document.getElementById('modal-send-title');
    var body = document.getElementById('modal-send-body');
    title.textContent = send.subject;
    var opened = 0, clicked = 0, bounced = 0, sent = 0;
    send.recipients.forEach(function(r) { if (r.status === 'opened') opened++; if (r.status === 'clicked') clicked++; if (r.status === 'bounced') bounced++; if (r.status === 'sent') sent++; });
    var total = send.recipients.length;
    var html = '<div class="send-detail-stats"><div class="send-stat-card"><div class="stat-value">' + total + '</div><div class="stat-label">Enviados</div></div><div class="send-stat-card"><div class="stat-value" style="color:#34a853;">' + (opened + clicked) + '</div><div class="stat-label">Abiertos</div></div><div class="send-stat-card"><div class="stat-value" style="color:#e8710a;">' + clicked + '</div><div class="stat-label">Clickeados</div></div><div class="send-stat-card"><div class="stat-value" style="color:#dc3545;">' + bounced + '</div><div class="stat-label">Rebotados</div></div></div>';
    html += '<div class="send-detail-recipients"><h3>Destinatarios</h3>';
    send.recipients.forEach(function(r) {
        var statusClass = r.status === 'sent' ? 'not-opened' : r.status;
        var statusText = r.status === 'sent' ? 'Enviado' : r.status === 'opened' ? 'Abierto' : r.status === 'clicked' ? 'Clickeado' : r.status === 'bounced' ? 'Rebotado' : r.status;
        var initials = r.nombre ? r.nombre.split(' ').map(function(n) { return n[0]; }).join('').substring(0, 2).toUpperCase() : '??';
        html += '<div class="recipient-row"><div class="recipient-info"><div class="recipient-avatar">' + initials + '</div><div><div class="recipient-name">' + escapeHtml(r.nombre) + '</div><div class="recipient-email">' + escapeHtml(r.email) + ' | ' + escapeHtml(r.empresa) + '</div></div></div><div class="recipient-status"><span class="status-badge ' + statusClass + '">' + statusText + '</span></div></div>';
    });
    html += '</div>';
    if (send.blocks && send.blocks.length > 0) {
        html += '<div style="margin-top:20px;"><h3 style="font-size:15px;color:#2c3e50;margin-bottom:12px;">Desarrollos incluidos</h3>';
        send.blocks.forEach(function(block) {
            html += '<div class="email-history-item"><span class="email-history-subject">' + escapeHtml(block.nombre) + '</span>' + (block.link ? '<a href="' + block.link + '" target="_blank" style="color:#1a73e8;font-size:12px;">Ver</a>' : '') + '</div>';
        });
        html += '</div>';
    }
    body.innerHTML = html;
    modal.style.display = 'flex';
}

// ============================================
// PERFIL DE CLIENTE (MODAL)
// ============================================
function showClientProfile(clientEmail) {
    var client = clients.find(function(c) { return c.email === clientEmail; });
    if (!client) return;
    var modal = document.getElementById('client-profile-modal');
    var title = document.getElementById('modal-client-title');
    var body = document.getElementById('modal-client-body');
    title.textContent = client.nombre;
    var history = getClientHistory(clientEmail);
    var totalSent = history.length;
    var totalOpened = history.filter(function(h) { return h.status === 'opened' || h.status === 'clicked'; }).length;
    var totalClicked = history.filter(function(h) { return h.status === 'clicked'; }).length;
    var openRate = totalSent > 0 ? (totalOpened / totalSent * 100).toFixed(0) : 0;
    var initials = client.nombre.split(' ').map(function(n) { return n[0]; }).join('').substring(0, 2).toUpperCase();
    var html = '<div class="client-profile-header"><div class="client-profile-avatar">' + initials + '</div><div class="client-profile-info"><h3>' + escapeHtml(client.nombre) + '</h3><p>' + escapeHtml(client.email) + ' | ' + escapeHtml(client.empresa) + '</p></div></div>';
    html += '<div class="client-profile-stats"><div class="client-stat-card"><div class="stat-value">' + totalSent + '</div><div class="stat-label">Enviados</div></div><div class="client-stat-card"><div class="stat-value">' + totalOpened + '</div><div class="stat-label">Abiertos</div></div><div class="client-stat-card"><div class="stat-value">' + totalClicked + '</div><div class="stat-label">Clickeados</div></div><div class="client-stat-card"><div class="stat-value">' + openRate + '%</div><div class="stat-label">Tasa Apertura</div></div></div>';
    html += '<div class="client-email-history"><h3>Historial de correos</h3>';
    if (history.length === 0) { html += '<p style="color:#999;font-size:13px;">No hay correos enviados a este cliente</p>'; }
    else {
        history.forEach(function(h) {
            var statusClass = h.status === 'sent' ? 'not-opened' : h.status;
            var statusText = h.status === 'sent' ? 'Enviado' : h.status === 'opened' ? 'Abierto' : h.status === 'clicked' ? 'Clickeado' : h.status === 'bounced' ? 'Rebotado' : h.status;
            var dateStr = new Date(h.date).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
            html += '<div class="email-history-item"><div><span class="email-history-subject">' + escapeHtml(h.subject) + '</span><span class="email-history-date" style="margin-left:8px;">' + dateStr + '</span></div><span class="status-badge ' + statusClass + '">' + statusText + '</span></div>';
        });
    }
    html += '</div>';
    body.innerHTML = html;
    modal.style.display = 'flex';
}

// ============================================
// ANALYTICS
// ============================================
function renderAnalytics() {
    var analytics = getAnalytics();
    var kpiSent = document.getElementById('kpi-sent');
    var kpiDelivered = document.getElementById('kpi-delivered');
    var kpiOpened = document.getElementById('kpi-opened');
    var kpiClicked = document.getElementById('kpi-clicked');
    var kpiOpenRate = document.getElementById('kpi-open-rate');
    var kpiClickRate = document.getElementById('kpi-click-rate');
    if (kpiSent) kpiSent.textContent = analytics.totalSent;
    if (kpiDelivered) kpiDelivered.textContent = analytics.totalDelivered;
    if (kpiOpened) kpiOpened.textContent = analytics.totalOpened;
    if (kpiClicked) kpiClicked.textContent = analytics.totalClicked;
    if (kpiOpenRate) kpiOpenRate.textContent = analytics.openRate + '%';
    if (kpiClickRate) kpiClickRate.textContent = analytics.clickRate + '%';

    // Top clients
    var topClientsContainer = document.getElementById('top-clients-list');
    if (topClientsContainer) {
        var topClients = getTopClients(5);
        if (topClients.length === 0) {
            topClientsContainer.innerHTML = '<div class="loading">No hay datos aun</div>';
        } else {
            var html = '';
            topClients.forEach(function(tc, idx) {
                var rankClass = idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : '';
                html += '<div class="top-client-row"><div class="top-client-info"><div class="top-client-rank ' + rankClass + '">' + (idx + 1) + '</div><div><div class="top-client-name">' + escapeHtml(tc.nombre) + '</div><div class="top-client-email">' + escapeHtml(tc.empresa) + '</div></div></div><div class="top-client-stats"><span><i class="fas fa-eye" style="color:#34a853;"></i> ' + tc.openCount + '</span><span><i class="fas fa-mouse-pointer" style="color:#f9ab00;"></i> ' + tc.clickCount + '</span></div></div>';
            });
            topClientsContainer.innerHTML = html;
        }
    }

    // Recent activity
    var activityContainer = document.getElementById('recent-activity');
    if (activityContainer) {
        var activities = getRecentActivity(10);
        if (activities.length === 0) {
            activityContainer.innerHTML = '<div class="loading">No hay actividad registrada</div>';
        } else {
            var html = '';
            activities.forEach(function(act) {
                var iconClass = act.type === 'click' ? 'click' : act.type === 'open' ? 'open' : act.type === 'bounce' ? 'bounce' : 'send';
                var iconFA = act.type === 'click' ? 'fa-mouse-pointer' : act.type === 'open' ? 'fa-eye' : act.type === 'bounce' ? 'fa-exclamation-circle' : 'fa-paper-plane';
                var actionText = act.type === 'click' ? 'hizo click en' : act.type === 'open' ? 'abrio' : act.type === 'bounce' ? 'reboto' : 'recibio';
                var timeAgo = getTimeAgo(act.date);
                html += '<div class="activity-item"><div class="activity-icon ' + iconClass + '"><i class="fas ' + iconFA + '"></i></div><div class="activity-text"><strong>' + escapeHtml(act.clientName) + '</strong> ' + actionText + ' "' + escapeHtml(act.subject) + '"</div><div class="activity-time">' + timeAgo + '</div></div>';
            });
            activityContainer.innerHTML = html;
        }
    }
}

// ============================================
// POLLING DE TRACKING
// ============================================
async function pollTrackingEvents() {
    // Consultar datos reales desde Google Sheets
    try {
        var updatedSends = await fetchTrackingFromSheet();
        if (updatedSends && updatedSends.length > 0) {
            var localSends = getSends();
            // Comparar contadores de tracking (no todo el JSON que puede variar)
            var hasChanges = false;
            if (localSends.length !== updatedSends.length) {
                hasChanges = true;
            } else {
                for (var i = 0; i < updatedSends.length; i++) {
                    var local = localSends.find(function(s) { return s.id === updatedSends[i].id; });
                    if (!local) { hasChanges = true; break; }
                    if (local.recipients.length !== updatedSends[i].recipients.length) { hasChanges = true; break; }
                    for (var j = 0; j < updatedSends[i].recipients.length; j++) {
                        var lr = local.recipients.find(function(r) { return r.trackingId === updatedSends[i].recipients[j].trackingId; });
                        if (!lr) { hasChanges = true; break; }
                        if (lr.status !== updatedSends[i].recipients[j].status ||
                            lr.openCount !== updatedSends[i].recipients[j].openCount ||
                            lr.clickCount !== updatedSends[i].recipients[j].clickCount) {
                            hasChanges = true;
                            break;
                        }
                    }
                    if (hasChanges) break;
                }
            }
            if (hasChanges) {
                saveSends(updatedSends);
                renderHistory();
                renderAnalytics();
                console.log('Tracking actualizado desde Sheets');
            }
        }
    } catch (e) {
        console.log('Error en polling de tracking:', e);
    }
}

// ============================================
// INICIALIZACION
// ============================================
async function init() {
    await loadDevelopments();
    await loadClients();
    setupDropZone();
    renderEmailBlocks();

    var exportBtn = document.getElementById('export-html');
    if (exportBtn) exportBtn.addEventListener('click', downloadHTML);
    var copyBtn = document.getElementById('copy-html');
    if (copyBtn) copyBtn.addEventListener('click', copyHTML);
    var exportCsvBtn = document.getElementById('export-csv');
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportAllDevelopmentsToCSV);
    var importBtn = document.getElementById('import-file-btn');
    if (importBtn) importBtn.addEventListener('click', function() { document.getElementById('file-input').click(); });
    var fileInput = document.getElementById('file-input');
    if (fileInput) fileInput.addEventListener('change', async function(e) { if (e.target.files.length > 0) { await importFile(e.target.files[0]); e.target.value = ''; } });
    var confirmBtn = document.getElementById('confirm-import');
    if (confirmBtn) confirmBtn.addEventListener('click', confirmImport);
    var reloadClientsBtn = document.getElementById('reload-clients');
    if (reloadClientsBtn) reloadClientsBtn.addEventListener('click', reloadClients);
    var sendEmailsBtn = document.getElementById('send-emails');
    if (sendEmailsBtn) sendEmailsBtn.addEventListener('click', sendEmails);
    var forceReloadBtn = document.getElementById('force-reload-data');
    if (forceReloadBtn) forceReloadBtn.addEventListener('click', forceReloadData);
    var reloadDataBtn = document.getElementById('reload-data');
    if (reloadDataBtn) reloadDataBtn.addEventListener('click', function() { loadDevelopments(); });
    var clearBlocksBtn = document.getElementById('clear-blocks');
    if (clearBlocksBtn) clearBlocksBtn.addEventListener('click', clearAllBlocks);
    var searchDevInput = document.getElementById('search-developments');
    if (searchDevInput) searchDevInput.addEventListener('input', function(e) { devSearchTerm = e.target.value; renderSidebar(); });
    var searchClientInput = document.getElementById('search-clients');
    if (searchClientInput) searchClientInput.addEventListener('input', function(e) { clientSearchTerm = e.target.value; renderClientSelector(); });

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(function(btn) { btn.addEventListener('click', function() { switchTab(this.getAttribute('data-tab')); }); });

    // Modal close
    var closeSendDetail = document.getElementById('close-send-detail');
    if (closeSendDetail) closeSendDetail.addEventListener('click', function() { document.getElementById('send-detail-modal').style.display = 'none'; });
    var closeClientProfile = document.getElementById('close-client-profile');
    if (closeClientProfile) closeClientProfile.addEventListener('click', function() { document.getElementById('client-profile-modal').style.display = 'none'; });
    document.querySelectorAll('.modal-overlay').forEach(function(overlay) { overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.style.display = 'none'; }); });

    var refreshHistoryBtn = document.getElementById('refresh-history');
    if (refreshHistoryBtn) refreshHistoryBtn.addEventListener('click', async function() {
        showToast('Sincronizando con Google Sheets...', 'info');
        await fetchSendsFromSheet();
        renderHistory();
        renderAnalytics();
        showToast('Historial sincronizado', 'success');
    });

    // Close preview
    var closePreviewBtn = document.getElementById('close-preview');
    if (closePreviewBtn) closePreviewBtn.addEventListener('click', function() { document.getElementById('import-preview').style.display = 'none'; });

    // Cargar envios desde Google Sheets (fuente de verdad)
    await fetchSendsFromSheet();
    renderHistory();
    renderAnalytics();
    setInterval(function() { pollTrackingEvents(); }, POLL_INTERVAL);

    console.log('Kudos Mail CRM inicializado');
}

if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
else { init(); }
