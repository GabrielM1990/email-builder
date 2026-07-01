// ============================================
// CONFIGURACION
// ============================================
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/build/pdf.worker.min.js';

var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwOKX52v4hw55C9vy3C0AwwRMG2VlHbR4eC8986bRirOu3HTGLfgTzbIR3ZlUxaxk0hVQ/exec';
var API_KEY = 'kudos_key_8fH3mK9wPq';

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
        var url = APPS_SCRIPT_URL + '?action=' + action + '&callback=' + callbackName + '&t=' + Date.now() + '&apiKey=' + encodeURIComponent(API_KEY);
        
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
            // Si hay eventos detallados, usar esos
            if (r.events && r.events.length > 0) {
                r.events.forEach(function(evt) {
                    activities.push({
                        type: evt.type === 'click' ? 'click' : evt.type === 'open' ? 'open' : evt.type === 'bounced' ? 'bounce' : 'send',
                        clientName: r.nombre, clientEmail: r.email, subject: send.subject,
                        date: evt.timestamp || r.lastEvent || send.date, sendId: send.id,
                        blockName: evt.blockName || '',
                        url: evt.url || ''
                    });
                });
            } else if (r.status !== 'sent') {
                activities.push({
                    type: r.status === 'clicked' ? 'click' : r.status === 'opened' ? 'open' : r.status === 'bounced' ? 'bounce' : 'send',
                    clientName: r.nombre, clientEmail: r.email, subject: send.subject,
                    date: r.lastEvent || send.date, sendId: send.id,
                    blockName: ''
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
        else { showToast('Formato no soportado. Usa PDF o DOCX', 'error'); return; }
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
                    id: generateDevId(), nombre: devName, resumen: summary, descripcion: description,
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
                                id: generateDevId(), nombre: nombre, resumen: extractSummary(section),
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
    localStorage.setItem('allDevelopments', JSON.stringify(developments));
    renderSidebar();
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
        localStorage.removeItem('allDevelopments');
        localStorage.removeItem('importedDevelopments');
        localStorage.removeItem('backupDevelopments');
        var data = await fetchFromSheet('getDevelopments');
        if (data && data.success && data.developments && data.developments.length > 0) {
            developments = assignDevIds(data.developments);
            localStorage.setItem('backupDevelopments', JSON.stringify(developments));
            renderSidebar();
            showToast('Recarga completa: ' + developments.length + ' desarrollos cargados', 'success');
        } else { throw new Error('Sin datos'); }
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
        var data = await fetchFromSheet('getDevelopments');
        if (data && data.success && data.developments && data.developments.length > 0) {
            developments = assignDevIds(data.developments);
        } else {
            throw new Error('Sin datos');
        }
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
        var data = await fetchFromSheet('getClients');
        if (data && data.success && data.clients && data.clients.length > 0) {
            clients = data.clients;
            localStorage.setItem('clientesData', JSON.stringify(clients));
            renderClientSelector();
            return;
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
        var block = document.createElement('div');
        block.className = 'block-card';
        block.setAttribute('draggable', 'true');
        block.setAttribute('data-dev-id', dev.id || escapeHtml(dev.nombre));
        var imgHtml = '';
        if (dev.captura_url) {
            var safeUrl = dev.captura_url.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            imgHtml = '<img src="' + safeUrl + '" alt="' + escapeHtml(dev.nombre) + '" style="max-width:100%;border-radius:6px;margin-bottom:8px;" loading="lazy">';
        }
        var linkUrl = dev.link.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        block.innerHTML = '<div class="block-header"><h3>' + escapeHtml(dev.nombre) + '</h3><button class="add-to-email-btn" data-dev-id="' + escapeHtml(dev.id) + '">+ Agregar</button></div><div class="summary">' + escapeHtml(dev.resumen || 'Sin resumen') + '</div>' + imgHtml + '<div class="link"><a href="' + linkUrl + '" target="_blank">Ver desarrollo</a></div>';
        block.addEventListener('dragstart', handleDragStart);
        block.addEventListener('dragend', handleDragEnd);
        block.querySelector('.add-to-email-btn').addEventListener('click', function(e) {
            e.stopPropagation();
            var id = this.getAttribute('data-dev-id');
            if (id) addBlockById(id);
        });
        container.appendChild(block);
    });
}

var CLIENTS_PAGE_SIZE = 50;
var clientsPageLoaded = CLIENTS_PAGE_SIZE;

function renderClientSelector() {
    var container = document.getElementById('clients-list');
    if (!container) return;
    container.innerHTML = '';
    var filtered = clients;
    if (clientSearchTerm) {
        filtered = clients.filter(function(c) {
            return c.nombre.toLowerCase().includes(clientSearchTerm.toLowerCase()) || c.email.toLowerCase().includes(clientSearchTerm.toLowerCase()) || c.empresa.toLowerCase().includes(clientSearchTerm.toLowerCase());
        });
        clientsPageLoaded = filtered.length;
    } else {
        clientsPageLoaded = Math.min(clientsPageLoaded, filtered.length);
    }
    if (filtered.length === 0) {
        container.innerHTML = '<div class="loading">No hay clientes que coincidan</div>';
        updateSelectionInfo();
        return;
    }

    var showing = Math.min(clientsPageLoaded, filtered.length);
    var visible = filtered.slice(0, showing);

    var selectAllDiv = document.createElement('div');
    selectAllDiv.className = 'client-item';
    selectAllDiv.style.background = '#e9ecef';
    selectAllDiv.style.fontWeight = 'bold';
    selectAllDiv.innerHTML = '<input type="checkbox" id="select-all-clients" style="margin-right:10px;"><label for="select-all-clients" style="font-weight:bold;">Seleccionar todos (' + filtered.length + ')</label>';
    container.appendChild(selectAllDiv);

    visible.forEach(function(client) {
        var originalIdx = clients.findIndex(function(c) { return c.email === client.email; });
        var div = document.createElement('div');
        div.className = 'client-item';
        div.innerHTML = '<input type="checkbox" class="client-checkbox" id="client_' + originalIdx + '" value="' + originalIdx + '"><label for="client_' + originalIdx + '" style="cursor:pointer;"><strong>' + escapeHtml(client.nombre) + '</strong><br><small>' + escapeHtml(client.email) + ' | ' + escapeHtml(client.empresa) + '</small></label>';
        var strongEl = div.querySelector('strong');
        strongEl.style.cursor = 'pointer';
        strongEl.style.color = '#1a73e8';
        strongEl.addEventListener('click', function(e) {
            e.preventDefault();
            showClientProfile(client.email);
        });
        container.appendChild(div);
    });

    if (showing < filtered.length) {
        var moreDiv = document.createElement('div');
        moreDiv.className = 'client-item';
        moreDiv.style.textAlign = 'center';
        moreDiv.style.background = 'transparent';
        moreDiv.style.border = 'none';
        moreDiv.innerHTML = '<button id="load-more-clients" class="btn btn-ghost" style="width:100%;justify-content:center;"><i class="fas fa-chevron-down"></i> Mostrar mas (' + (filtered.length - showing) + ' restantes)</button>';
        container.appendChild(moreDiv);
        document.getElementById('load-more-clients').addEventListener('click', function() {
            clientsPageLoaded += CLIENTS_PAGE_SIZE;
            renderClientSelector();
        });
    }

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
        var dev = developments.find(function(d) { return d.id === block.devId; });
        if (!dev) return;
        var blockDiv = document.createElement('div');
        blockDiv.className = 'block-item';
        blockDiv.setAttribute('data-block-idx', idx);
        blockDiv.innerHTML = '<button class="remove-block" data-idx="' + idx + '">&times;</button><h3>' + escapeHtml(dev.nombre) + '</h3><div class="description">' + escapeHtml(dev.descripcion || dev.resumen || 'Sin descripcion') + '</div><a href="' + dev.link.replace(/"/g, '&quot;') + '" target="_blank" class="block-link">Ver mas</a>';
        blockDiv.querySelector('.remove-block').addEventListener('click', function(e) { e.stopPropagation(); removeBlock(idx); });
        container.appendChild(blockDiv);
    });
    if (sortable) sortable.destroy();
    sortable = null;
    if (typeof Sortable !== 'undefined') {
        try {
            sortable = new Sortable(container, { animation: 150, onEnd: function() { saveOrder(); } });
        } catch (e) {
            console.log('SortableJS no disponible');
        }
    }
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
        var idx = parseInt(item.getAttribute('data-block-idx'));
        if (!isNaN(idx) && blocks[idx]) newOrder.push(blocks[idx]);
    });
    localStorage.setItem('emailBlocks', JSON.stringify(newOrder));
    renderEmailBlocks();
}

function getCurrentEmailBlocks() {
    var blocks = [];
    var savedBlocks = JSON.parse(localStorage.getItem('emailBlocks') || '[]');
    savedBlocks.forEach(function(block) {
        var dev = developments.find(function(d) { return d.id === block.devId; });
        if (dev) blocks.push(dev);
    });
    return blocks;
}

function addBlockById(devId) {
    var dev = developments.find(function(d) { return d.id === devId; });
    if (!dev) return;
    var savedBlocks = JSON.parse(localStorage.getItem('emailBlocks') || '[]');
    savedBlocks.push({ devId: devId });
    localStorage.setItem('emailBlocks', JSON.stringify(savedBlocks));
    renderEmailBlocks();
    showToast('"' + dev.nombre + '" agregado al email', 'success');
}

function clearAllBlocks() {
    if (confirm('Eliminar todos los desarrollos del email?')) {
        localStorage.setItem('emailBlocks', JSON.stringify([]));
        renderEmailBlocks();
    }
}

function loadImportedDevelopments() {
    var saved = localStorage.getItem('allDevelopments') || localStorage.getItem('importedDevelopments');
    if (saved) {
        var imported = JSON.parse(saved);
        var existingIds = new Set(developments.map(function(d) { return d.id; }));
        var newDevelopments = imported.filter(function(d) { return !existingIds.has(d.id); });
        developments.push.apply(developments, newDevelopments);
    }
}

function generateDevId() {
    return 'dev_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function assignDevIds(devs) {
    return devs.map(function(d) {
        if (!d.id) d.id = generateDevId();
        return d;
    });
}

// ============================================
// DRAG & DROP
// ============================================
function handleDragStart(e) {
    draggedItem = this;
    var devId = this.getAttribute('data-dev-id');
    if (devId) e.dataTransfer.setData('text/plain', devId);
    e.dataTransfer.effectAllowed = 'copy';
}

function handleDragEnd() { draggedItem = null; }

function setupDropZone() {
    var dropZone = document.getElementById('email-blocks');
    dropZone.addEventListener('dragover', function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; dropZone.style.background = '#e8f0fe'; });
    dropZone.addEventListener('dragleave', function() { dropZone.style.background = ''; });
    dropZone.addEventListener('drop', function(e) {
        e.preventDefault(); dropZone.style.background = '';
        if (draggedItem) {
            var devId = draggedItem.getAttribute('data-dev-id');
            if (devId) addBlockById(devId);
        }
    });
}

// ============================================
// ENVIO DE CORREOS CON TRACKING
// ============================================
function postToAppsScript(data) {
    return new Promise(function(resolve) {
        var callbackName = 'kudosPostCallback_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
        var params = 'action=' + encodeURIComponent(data.action) +
            '&callback=' + callbackName +
            '&t=' + Date.now() +
            '&apiKey=' + encodeURIComponent(data.apiKey || '') +
            '&sendId=' + encodeURIComponent(data.sendId || '') +
            '&sendDate=' + encodeURIComponent(data.sendDate || '') +
            '&subject=' + encodeURIComponent(data.subject || '') +
            '&blocks=' + encodeURIComponent(JSON.stringify(data.blocks || [])) +
            '&recipients=' + encodeURIComponent(JSON.stringify(data.recipients || [])) +
            '&to=' + encodeURIComponent(data.to || '') +
            '&htmlContent=' + encodeURIComponent(data.htmlContent || '');

        window[callbackName] = function(response) {
            delete window[callbackName];
            var el = document.getElementById(callbackName);
            if (el) el.remove();
            resolve(response);
        };

        var script = document.createElement('script');
        script.id = callbackName;
        script.src = APPS_SCRIPT_URL + '?' + params;
        script.onerror = function() {
            delete window[callbackName];
            var el = document.getElementById(callbackName);
            if (el) el.remove();
            resolve({ success: false, error: 'Error de conexion' });
        };
        document.head.appendChild(script);

        setTimeout(function() {
            if (window[callbackName]) {
                delete window[callbackName];
                var el = document.getElementById(callbackName);
                if (el) el.remove();
                resolve({ success: false, error: 'Timeout' });
            }
        }, 30000);
    });
}

async function sendEmails() {
    var selectedClients = [];
    document.querySelectorAll('.client-checkbox:checked').forEach(function(checkbox) {
        var idx = parseInt(checkbox.value);
        if (clients[idx]) selectedClients.push(clients[idx]);
    });
    if (selectedClients.length === 0) { showToast('Selecciona al menos un cliente', 'warning'); return; }
    var blocks = getCurrentEmailBlocks();
    if (blocks.length === 0) { showToast('Agrega al menos un desarrollo al email', 'warning'); return; }

    // Confirmacion antes de enviar
    if (!confirm('Enviar email a ' + selectedClients.length + ' cliente(s) con ' + blocks.length + ' desarrollo(s)?')) return;

    var sendId = generateSendId();
    var sendDate = new Date().toISOString();
    var subjectEl = document.getElementById('email-subject');
    var subject = subjectEl ? subjectEl.value.trim() : 'Nuevos desarrollos para tu tienda VTEX | Kudos Commerce';
    if (!subject) {
        showToast('Escribe un asunto para el email', 'warning');
        sendButton.innerHTML = originalHTML;
        sendButton.disabled = false;
        return;
    }
    var blocksData = blocks.map(function(b) { return { nombre: b.nombre, resumen: b.resumen, link: b.link }; });
    var recipients = selectedClients.map(function(client) {
        return { trackingId: generateTrackingId(), email: client.email, nombre: client.nombre, empresa: client.empresa, status: 'sent', openCount: 0, clickCount: 0, lastEvent: sendDate, events: [] };
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
            var trackableLink = APPS_SCRIPT_URL + '?action=click&sendId=' + sendId + '&trkId=' + recipient.trackingId + '&url=' + encodeURIComponent(block.link || '#') + '&block=' + encodeURIComponent(block.nombre);
            return '<div style="border:1px solid #e0e0e0;border-radius:8px;padding:15px;margin-bottom:15px;font-family:Arial,sans-serif;"><h3 style="color:#1a73e8;margin-top:0;margin-bottom:10px;">' + escapeHtml(block.nombre) + '</h3><p style="margin:0 0 10px 0;line-height:1.5;">' + escapeHtml(block.descripcion || block.resumen || '') + '</p><a href="' + trackableLink + '" style="color:#1a73e8;text-decoration:none;">Ver desarrollo</a></div>';
        }).join('');
        var trackingPixel = '<img src="' + APPS_SCRIPT_URL + '?action=open&sendId=' + sendId + '&trkId=' + recipient.trackingId + '" width="1" height="1" style="display:none;" />';
        var unsubscribeLink = APPS_SCRIPT_URL + '?action=click&sendId=' + sendId + '&trkId=' + recipient.trackingId + '&url=' + encodeURIComponent('#unsubscribe') + '&block=' + encodeURIComponent('Baja');
        var emailTemplate = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"><div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:30px 20px;text-align:center;border-radius:12px 12px 0 0;"><h1 style="margin:0;">Kudos Commerce</h1><p style="margin:10px 0 0;">Especialistas en comercio unificado</p></div><div style="padding:20px;border:1px solid #e0e0e0;border-top:none;background:white;"><h2 style="color:#2c3e50;margin-top:0;">Nuevos desarrollos disponibles</h2><div style="margin-top:20px;">' + blocksHTML + '</div><div style="margin-top:30px;padding-top:20px;border-top:1px solid #e0e0e0;font-size:12px;color:#666;text-align:center;"><p>2026 Kudos Commerce - Todos los derechos reservados</p><p style="margin-top:8px;"><a href="' + unsubscribeLink + '" style="color:#999;text-decoration:underline;">Darse de baja</a></p></div></div>' + trackingPixel + '</body></html>';

        recipientsWithHTML.push({
            trackingId: recipient.trackingId,
            email: client.email,
            nombre: client.nombre,
            empresa: client.empresa,
            htmlContent: emailTemplate
        });
        sendButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparando ' + (i + 1) + '/' + selectedClients.length + '...';
        await new Promise(function(r) { setTimeout(r, 50); }); // dejar que el DOM se actualice
    }

    // Enviar al Apps Script via POST (no-cors porque Apps Script no devuelve CORS headers)
    try {
        var postBody = JSON.stringify({
            apiKey: API_KEY,
            action: 'sendEmail',
            sendId: sendId,
            sendDate: sendDate,
            subject: subject,
            blocks: blocksData,
            recipients: recipientsWithHTML
        });

        await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain' },
            body: postBody
        });

        addSend(sendData);
        showToast('Solicitud de envio enviada a ' + selectedClients.length + ' destinatario(s)', 'success');
        showToast('Los emails pueden tardar unos minutos en llegar. Usa Sincronizar para ver el estado.', 'info');
    } catch (error) {
        addSend(sendData);
        showToast('Error de conexion al enviar. Datos guardados localmente.', 'error');
        showToast('Usa Sincronizar cuando tengas conexion para actualizar.', 'warning');
    }

    sendButton.innerHTML = originalHTML;
    sendButton.disabled = false;
    renderHistory(); renderAnalytics(); navigateTo('history');
}

async function reloadClients() {
    clientsPageLoaded = CLIENTS_PAGE_SIZE;
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
var escapeHtml = (function() {
    var div = document.createElement('div');
    return function(text) {
        if (!text) return '';
        div.textContent = text;
        return div.innerHTML;
    };
})();

function mostrarError(mensaje) {
    var container = document.getElementById('blocks-list');
    var errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = mensaje;
    container.innerHTML = '';
    container.appendChild(errorDiv);
}

function getMockDevelopments() {
    return assignDevIds([
        { nombre: "Carrusel de Videos en Home", resumen: "Muestra videos de productos destacados en Home", descripcion: "Solucion que permite mostrar productos destacados de forma dinamica.", captura_url: "https://via.placeholder.com/300x150", link: "#" },
        { nombre: "Cross Selling en Checkout", resumen: "Maximiza el valor de cada compra", descripcion: "Presenta productos complementarios justo antes del checkout.", captura_url: "https://via.placeholder.com/300x150", link: "#" },
        { nombre: "Compra Conjunta en PDP", resumen: "Sugiere productos complementarios en PDP", descripcion: "Muestra productos complementarios como oferta de combo.", captura_url: "https://via.placeholder.com/300x150", link: "#" }
    ]);
}

function getTimeAgo(dateStr) {
    if (!dateStr) return '-';
    var now = new Date();
    var date = new Date(dateStr);
    if (isNaN(date.getTime())) return '-';
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
// SEGUIMIENTO - Matriz de desarrollos por tienda
// ============================================
var masterData = { tiendas: [], desarrollos: [] };

async function loadMasterData() {
    try {
        var data = await fetchFromSheet('getMasterData');
        if (data && data.success && data.desarrollos) {
            masterData = { tiendas: data.tiendas || [], desarrollos: data.desarrollos || [] };
        }
    } catch (e) {
        console.log('Error cargando master data:', e);
    }
}

function renderSeguimiento() {
    var wrapper = document.getElementById('seg-table-wrapper');
    if (!wrapper) return;

    var storeFilter = document.getElementById('seg-filter-store');
    var statusFilter = document.getElementById('seg-filter-status');
    var searchFilter = document.getElementById('seg-filter-search');

    var storeVal = storeFilter ? storeFilter.value : '';
    var statusVal = statusFilter ? statusFilter.value : '';
    var searchVal = searchFilter ? searchFilter.value.toLowerCase() : '';

    var tiendas = masterData.tiendas;
    var desarrollos = masterData.desarrollos;

    if (desarrollos.length === 0) {
        wrapper.innerHTML = '<div class="empty-state"><i class="fas fa-table empty-icon"></i><p>No hay datos de seguimiento</p><small>Carga los datos desde el sheet</small></div>';
        return;
    }

    // Filtrar desarrollos
    var filtered = desarrollos;
    if (searchVal) {
        filtered = filtered.filter(function(d) {
            return d.codigo.toLowerCase().indexOf(searchVal) !== -1 ||
                   d.titulo.toLowerCase().indexOf(searchVal) !== -1;
        });
    }

    // Determinar que tiendas mostrar
    var visibleTiendas = tiendas;
    if (storeVal) {
        visibleTiendas = [storeVal];
    }

    var statusColors = {
        'Implementado': { bg: '#e6f4ea', text: '#137333', icon: 'fa-check-circle' },
        'En curso': { bg: '#e8f0fe', text: '#1a73e8', icon: 'fa-spinner' },
        'Propuesto': { bg: '#fef7e0', text: '#b06000', icon: 'fa-clock' },
        'Proponer': { bg: '#f1f3f4', text: '#5f6368', icon: 'fa-lightbulb' },
        'No aplica': { bg: '#fce8e6', text: '#dc3545', icon: 'fa-ban' }
    };

    var html = '<div class="seg-table-scroll"><table class="seg-table">';
    html += '<thead><tr><th class="seg-th-code">Codigo</th><th class="seg-th-title">Desarrollo</th>';
    visibleTiendas.forEach(function(t) {
        html += '<th class="seg-th-store">' + escapeHtml(t) + '</th>';
    });
    html += '</tr></thead><tbody>';

    filtered.forEach(function(d) {
        html += '<tr><td class="seg-td-code">' + escapeHtml(d.codigo) + '</td>';
        html += '<td class="seg-td-title">' + escapeHtml(d.titulo) + '</td>';
        visibleTiendas.forEach(function(t) {
            var estado = d.estados[t] || '';
            var matchStatus = !statusVal || estado === statusVal;
            var displayStyle = matchStatus ? '' : ' style="display:none;"';
            var color = statusColors[estado] || { bg: '#f1f3f4', text: '#5f6368', icon: 'fa-minus' };
            html += '<td class="seg-td-status"' + displayStyle + '>';
            if (estado) {
                html += '<span class="seg-badge" style="background:' + color.bg + ';color:' + color.text + ';"><i class="fas ' + color.icon + '"></i> ' + escapeHtml(estado) + '</span>';
            }
            html += '</td>';
        });
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    wrapper.innerHTML = html;

    var countEl = document.getElementById('seg-count');
    if (countEl) countEl.textContent = filtered.length + ' desarrollos';
}

function updateTiendaFilter() {
    var select = document.getElementById('seg-filter-store');
    if (!select) return;
    var currentVal = select.value;
    select.innerHTML = '<option value="">Todas las tiendas</option>';
    masterData.tiendas.forEach(function(t) {
        var opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        select.appendChild(opt);
    });
    if (currentVal) select.value = currentVal;
}

// ============================================
// ROUTER - Sistema de rutas con hash
// ============================================
var ROUTE_MAP = {
    'composer': 'componer',
    'history': 'enviados',
    'analytics': 'analytics',
    'clients': 'clientes',
    'seguimiento': 'seguimiento'
};

var ROUTE_REVERSE = {};
for (var key in ROUTE_MAP) {
    ROUTE_REVERSE[ROUTE_MAP[key]] = key;
}

function getRouteFromNav(navName) {
    return ROUTE_MAP[navName] || navName;
}

function getNavFromRoute(route) {
    return ROUTE_REVERSE[route] || route;
}

function navigateTo(navName) {
    var route = getRouteFromNav(navName);
    window.location.hash = '#/' + route;
}

function switchTab(navName, updateHash) {
    // Actualizar nav items
    document.querySelectorAll('.nav-item').forEach(function(btn) { btn.classList.toggle('active', btn.getAttribute('data-nav') === navName); });
    // Actualizar views
    document.querySelectorAll('.view-content').forEach(function(view) { view.classList.toggle('active', view.id === 'view-' + navName); });
    // Renderizar contenido segun la vista
    if (navName === 'history') renderHistory();
    if (navName === 'analytics') renderAnalytics();
    if (navName === 'clients') renderClientsPage();
    if (navName === 'seguimiento') { renderSeguimiento(); }
    // Actualizar hash si es necesario
    if (updateHash !== false) {
        var route = getRouteFromNav(navName);
        if (window.location.hash !== '#/' + route) {
            window.location.hash = '#/' + route;
        }
    }
}

function handleRouteChange() {
    var hash = window.location.hash || '#/componer';
    var route = hash.replace('#/', '') || 'componer';
    var navName = getNavFromRoute(route) || 'composer';
    switchTab(navName, false);
}

// ============================================
// CLIENTS PAGE - Vista de clientes
// ============================================
var clientPageSearchTerm = '';

function renderClientsPage() {
    var grid = document.getElementById('clients-page-grid');
    if (!grid) return;
    var sends = getSends();

    // Calcular stats por cliente
    var clientStats = {};
    sends.forEach(function(send) {
        send.recipients.forEach(function(r) {
            if (!clientStats[r.email]) {
                clientStats[r.email] = { nombre: r.nombre, email: r.email, empresa: r.empresa, sentCount: 0, openCount: 0, clickCount: 0, bounceCount: 0, lastEvent: null };
            }
            clientStats[r.email].sentCount++;
            if (r.status === 'opened' || r.status === 'clicked') clientStats[r.email].openCount++;
            if (r.status === 'clicked') clientStats[r.email].clickCount++;
            if (r.status === 'bounced') clientStats[r.email].bounceCount++;
            if (r.lastEvent) clientStats[r.email].lastEvent = r.lastEvent;
        });
    });

    // Combinar con todos los clientes
    var allClients = clients.map(function(c) {
        var stats = clientStats[c.email] || { sentCount: 0, openCount: 0, clickCount: 0, bounceCount: 0, lastEvent: null };
        var status = 'inactive';
        if (stats.clickCount > 0) status = 'engaged';
        else if (stats.openCount > 0) status = 'active';
        else if (stats.sentCount > 0) status = 'cold';
        return {
            nombre: c.nombre, email: c.email, empresa: c.empresa,
            initials: c.nombre.split(' ').map(function(n) { return n[0]; }).join('').substring(0, 2).toUpperCase(),
            sentCount: stats.sentCount, openCount: stats.openCount, clickCount: stats.clickCount, bounceCount: stats.bounceCount,
            lastEvent: stats.lastEvent, status: status
        };
    });

    // Filtrar por busqueda
    if (clientPageSearchTerm) {
        var term = clientPageSearchTerm.toLowerCase();
        allClients = allClients.filter(function(c) {
            return c.nombre.toLowerCase().indexOf(term) !== -1 || c.email.toLowerCase().indexOf(term) !== -1 || c.empresa.toLowerCase().indexOf(term) !== -1;
        });
    }

    // Ordenar: mas activos primero
    allClients.sort(function(a, b) {
        var order = { engaged: 0, active: 1, cold: 2, inactive: 3 };
        return (order[a.status] || 4) - (order[b.status] || 4);
    });

    if (allClients.length === 0) {
        grid.innerHTML = '<div class="empty-state"><i class="fas fa-users empty-icon"></i><p>No hay clientes</p><small>Carg&aacute; los clientes desde Google Sheets</small></div>';
        return;
    }

    var html = '';
    allClients.forEach(function(c) {
        var statusText = c.status === 'engaged' ? 'Comprometido' : c.status === 'active' ? 'Activo' : c.status === 'cold' ? 'Sin abrir' : 'Sin actividad';
        var statusIcon = c.status === 'engaged' ? 'fa-fire' : c.status === 'active' ? 'fa-check-circle' : c.status === 'cold' ? 'fa-clock' : 'fa-minus-circle';
        html += '<div class="client-card" data-client-email="' + escapeHtml(c.email) + '">';
        html += '<div class="client-card-header">';
        html += '<div class="client-card-avatar">' + c.initials + '</div>';
        html += '<div class="client-card-info">';
        html += '<div class="client-card-name">' + escapeHtml(c.nombre) + '</div>';
        html += '<div class="client-card-company">' + escapeHtml(c.empresa) + '</div>';
        html += '<div class="client-card-email">' + escapeHtml(c.email) + '</div>';
        html += '</div>';
        html += '<span class="client-card-status ' + c.status + '"><i class="fas ' + statusIcon + '"></i> ' + statusText + '</span>';
        html += '</div>';
        html += '<div class="client-card-stats">';
        html += '<div class="client-card-stat"><div class="client-card-stat-value">' + c.sentCount + '</div><div class="client-card-stat-label">Enviados</div></div>';
        html += '<div class="client-card-stat"><div class="client-card-stat-value">' + c.openCount + '</div><div class="client-card-stat-label">Abiertos</div></div>';
        html += '<div class="client-card-stat"><div class="client-card-stat-value">' + c.clickCount + '</div><div class="client-card-stat-label">Clicks</div></div>';
        html += '</div>';
        html += '</div>';
    });
    grid.innerHTML = html;
    grid.querySelectorAll('.client-card').forEach(function(card) {
        card.addEventListener('click', function() {
            var email = this.getAttribute('data-client-email');
            if (email) showClientProfile(email);
        });
    });
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
async function showClientProfile(clientEmail) {
    var client = clients.find(function(c) { return c.email === clientEmail; });
    if (!client) return;
    var modal = document.getElementById('client-profile-modal');
    var title = document.getElementById('modal-client-title');
    var body = document.getElementById('modal-client-body');
    title.textContent = client.nombre;
    body.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Cargando perfil...</div>';
    modal.style.display = 'flex';

    // Forzar actualizacion de datos desde Sheet antes de mostrar
    try {
        var updatedSends = await fetchTrackingFromSheet();
        if (updatedSends && updatedSends.length > 0) {
            saveSends(updatedSends);
        }
    } catch(e) {
        console.log('Error actualizando datos para perfil:', e);
    }

    var sends = getSends();
    var clientSends = [];
    sends.forEach(function(send) {
        var recipient = send.recipients.find(function(r) { return r.email === clientEmail; });
        if (recipient) {
            clientSends.push({
                sendId: send.id, subject: send.subject, date: send.date,
                blocks: send.blocks || [],
                status: recipient.status, openCount: recipient.openCount || 0,
                clickCount: recipient.clickCount || 0, lastEvent: recipient.lastEvent,
                trackingId: recipient.trackingId,
                events: recipient.events || []
            });
        }
    });

    var totalSent = clientSends.length;
    var totalOpened = clientSends.filter(function(h) { return h.status === 'opened' || h.status === 'clicked'; }).length;
    var totalClicked = clientSends.filter(function(h) { return h.status === 'clicked'; }).length;
    var totalBounced = clientSends.filter(function(h) { return h.status === 'bounced'; }).length;
    var totalOpenCount = clientSends.reduce(function(sum, h) { return sum + h.openCount; }, 0);
    var totalClickCount = clientSends.reduce(function(sum, h) { return sum + h.clickCount; }, 0);
    var openRate = totalSent > 0 ? (totalOpened / totalSent * 100).toFixed(0) : 0;
    var clickRate = totalSent > 0 ? (totalClicked / totalSent * 100).toFixed(0) : 0;
    var lastActivity = clientSends.length > 0 ? clientSends[0].lastEvent || clientSends[0].date : null;
    var initials = client.nombre.split(' ').map(function(n) { return n[0]; }).join('').substring(0, 2).toUpperCase();

    // Determinar estado del cliente
    var clientStatus = 'inactive';
    var clientStatusText = 'Sin actividad';
    if (totalClicked > 0) { clientStatus = 'engaged'; clientStatusText = 'Muy comprometido'; }
    else if (totalOpened > 0) { clientStatus = 'active'; clientStatusText = 'Activo'; }
    else if (totalSent > 0) { clientStatus = 'cold'; clientStatusText = 'Sin abrir'; }

    var html = '';

    // Header del cliente
    html += '<div class="cp-header">';
    html += '<div class="cp-avatar">' + initials + '</div>';
    html += '<div class="cp-info">';
    html += '<h3>' + escapeHtml(client.nombre) + '</h3>';
    html += '<p class="cp-email">' + escapeHtml(client.email) + '</p>';
    html += '<p class="cp-company">' + escapeHtml(client.empresa) + '</p>';
    html += '</div>';
    html += '<span class="cp-status-badge cp-status-' + clientStatus + '">' + clientStatusText + '</span>';
    html += '</div>';

    // KPIs del cliente
    html += '<div class="cp-kpis">';
    html += '<div class="cp-kpi"><div class="cp-kpi-value">' + totalSent + '</div><div class="cp-kpi-label">Enviados</div></div>';
    html += '<div class="cp-kpi"><div class="cp-kpi-value">' + totalOpened + '</div><div class="cp-kpi-label">Abiertos</div></div>';
    html += '<div class="cp-kpi"><div class="cp-kpi-value">' + totalClicked + '</div><div class="cp-kpi-label">Clickeados</div></div>';
    html += '<div class="cp-kpi"><div class="cp-kpi-value">' + totalBounced + '</div><div class="cp-kpi-label">Rebotados</div></div>';
    html += '<div class="cp-kpi cp-kpi-highlight"><div class="cp-kpi-value">' + openRate + '%</div><div class="cp-kpi-label">Tasa Apertura</div></div>';
    html += '<div class="cp-kpi cp-kpi-highlight"><div class="cp-kpi-value">' + clickRate + '%</div><div class="cp-kpi-label">Tasa Click</div></div>';
    html += '</div>';

    // Timeline de interacciones
    html += '<div class="cp-section">';
    html += '<h3 class="cp-section-title"><i class="fas fa-stream"></i> Timeline de Interacciones</h3>';

    if (clientSends.length === 0) {
        html += '<div class="cp-empty">No hay correos enviados a este cliente</div>';
    } else {
        html += '<div class="cp-timeline">';

        // Recopilar eventos detallados para la timeline
        var events = [];
        clientSends.forEach(function(cs) {
            events.push({ type: 'sent', date: cs.date, subject: cs.subject, sendId: cs.sendId, blockName: '' });
            if (cs.status === 'bounced') {
                events.push({ type: 'bounced', date: cs.date, subject: cs.subject, sendId: cs.sendId, blockName: '' });
            }
            // Si hay eventos detallados con blockName, usar esos
            if (cs.events && cs.events.length > 0) {
                cs.events.forEach(function(evt) {
                    events.push({ type: evt.type, date: evt.timestamp, subject: cs.subject, sendId: cs.sendId, blockName: evt.blockName || '', url: evt.url || '' });
                });
            } else {
                // Fallback: usar contadores si no hay eventos detallados
                if (cs.openCount > 0) {
                    events.push({ type: 'open', date: cs.lastEvent, subject: cs.subject, sendId: cs.sendId, blockName: '', count: cs.openCount });
                }
                if (cs.clickCount > 0) {
                    events.push({ type: 'click', date: cs.lastEvent, subject: cs.subject, sendId: cs.sendId, blockName: '', count: cs.clickCount });
                }
            }
        });

        // Ordenar por fecha descendente
        events.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });

        events.forEach(function(evt) {
            var icon, color, text;
            if (evt.type === 'sent') {
                icon = 'fa-paper-plane'; color = '#1a73e8'; text = 'Email enviado';
            } else if (evt.type === 'open' || evt.type === 'opened') {
                icon = 'fa-eye'; color = '#34a853'; text = 'Email abierto';
                if (evt.count > 1) text += ' (' + evt.count + ' veces)';
            } else if (evt.type === 'click' || evt.type === 'clicked') {
                icon = 'fa-mouse-pointer'; color = '#f9ab00';
                text = 'Link clickeado';
                if (evt.blockName) text = 'Clicke\u00f3 "' + evt.blockName + '"';
            } else if (evt.type === 'bounced') {
                icon = 'fa-exclamation-triangle'; color = '#dc3545'; text = 'Email rebotado';
            }
            var dateStr = new Date(evt.date).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            // Para clicks, mostrar blockName/url como detalle; para otros eventos, el subject
            var detailText = '';
            if ((evt.type === 'click' || evt.type === 'clicked') && (evt.blockName || evt.url)) {
                detailText = evt.blockName ? escapeHtml(evt.blockName) : '';
                if (evt.url) detailText += (detailText ? ' - ' : '') + '<a href="' + escapeHtml(evt.url) + '" target="_blank" style="color:#1a73e8;text-decoration:none;font-size:12px;">Ver enlace</a>';
            } else {
                detailText = escapeHtml(evt.subject);
            }
            html += '<div class="cp-timeline-item">';
            html += '<div class="cp-timeline-icon" style="background:' + color + '"><i class="fas ' + icon + '"></i></div>';
            html += '<div class="cp-timeline-content">';
            html += '<div class="cp-timeline-text">' + text + '</div>';
            html += '<div class="cp-timeline-subject">' + detailText + '</div>';
            html += '<div class="cp-timeline-date">' + dateStr + '</div>';
            html += '</div>';
            html += '</div>';
        });

        html += '</div>';
    }
    html += '</div>';

    // Historial de emails con detalle expandible
    html += '<div class="cp-section">';
    html += '<h3 class="cp-section-title"><i class="fas fa-envelope"></i> Emails Enviados (' + totalSent + ')</h3>';

    if (clientSends.length === 0) {
        html += '<div class="cp-empty">No hay correos enviados a este cliente</div>';
    } else {
        clientSends.forEach(function(cs, idx) {
            var statusClass = cs.status === 'sent' ? 'not-opened' : cs.status;
            var statusText = cs.status === 'sent' ? 'Enviado' : cs.status === 'opened' ? 'Abierto' : cs.status === 'clicked' ? 'Clickeado' : cs.status === 'bounced' ? 'Rebotado' : cs.status;
            var dateStr = new Date(cs.date).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
            var lastEventStr = cs.lastEvent ? new Date(cs.lastEvent).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

            html += '<div class="cp-email-card" data-send-idx="' + idx + '">';
            html += '<div class="cp-email-card-header" onclick="toggleEmailDetail(' + idx + ')">';
            html += '<div class="cp-email-card-left">';
            html += '<span class="status-badge ' + statusClass + '">' + statusText + '</span>';
            html += '<span class="cp-email-subject">' + escapeHtml(cs.subject) + '</span>';
            html += '</div>';
            html += '<div class="cp-email-card-right">';
            html += '<span class="cp-email-date">' + dateStr + '</span>';
            html += '<i class="fas fa-chevron-down cp-email-chevron" id="chevron-' + idx + '"></i>';
            html += '</div>';
            html += '</div>';

            // Detalle expandible
            html += '<div class="cp-email-detail" id="email-detail-' + idx + '" style="display:none;">';
            html += '<div class="cp-email-detail-grid">';
            html += '<div class="cp-detail-item"><span class="cp-detail-label">Fecha de envio</span><span class="cp-detail-value">' + dateStr + '</span></div>';
            html += '<div class="cp-detail-item"><span class="cp-detail-label">Ultima actividad</span><span class="cp-detail-value">' + lastEventStr + '</span></div>';
            html += '<div class="cp-detail-item"><span class="cp-detail-label">Aperturas</span><span class="cp-detail-value">' + cs.openCount + '</span></div>';
            html += '<div class="cp-detail-item"><span class="cp-detail-label">Clicks</span><span class="cp-detail-value">' + cs.clickCount + '</span></div>';
            html += '</div>';

            // Desarrollos incluidos en el email
            if (cs.blocks && cs.blocks.length > 0) {
                html += '<div class="cp-email-blocks">';
                html += '<div class="cp-blocks-title">Desarrollos incluidos</div>';
                cs.blocks.forEach(function(block) {
                    html += '<div class="cp-block-item">';
                    html += '<div class="cp-block-name"><i class="fas fa-cube"></i> ' + escapeHtml(block.nombre) + '</div>';
                    if (block.resumen) html += '<div class="cp-block-resumen">' + escapeHtml(block.resumen) + '</div>';
                    if (block.link) html += '<a href="' + escapeHtml(block.link) + '" target="_blank" class="cp-block-link"><i class="fas fa-external-link-alt"></i> Ver desarrollo</a>';
                    html += '</div>';
                });
                html += '</div>';
            }

            html += '</div>'; // cp-email-detail
            html += '</div>'; // cp-email-card
        });
    }
    html += '</div>';

    body.innerHTML = html;
    modal.style.display = 'flex';
}

// Toggle detalle de email en perfil de cliente
function toggleEmailDetail(idx) {
    var detail = document.getElementById('email-detail-' + idx);
    var chevron = document.getElementById('chevron-' + idx);
    if (!detail) return;
    if (detail.style.display === 'none') {
        detail.style.display = 'block';
        if (chevron) chevron.style.transform = 'rotate(180deg)';
    } else {
        detail.style.display = 'none';
        if (chevron) chevron.style.transform = 'rotate(0deg)';
    }
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
                var actionText = act.type === 'click' ? 'hizo click' : act.type === 'open' ? 'abrio' : act.type === 'bounce' ? 'reboto' : 'recibio';
                var detail = '';
                var subjectOrBlock = escapeHtml(act.subject);
                if (act.type === 'click') {
                    if (act.blockName) {
                        detail = ' en "' + escapeHtml(act.blockName) + '"';
                        subjectOrBlock = escapeHtml(act.blockName);
                    }
                    if (act.url) {
                        subjectOrBlock += ' - <a href="' + escapeHtml(act.url) + '" target="_blank" style="color:#1a73e8;text-decoration:none;font-size:12px;">Ver enlace</a>';
                    }
                }
                var timeAgo = getTimeAgo(act.date);
                html += '<div class="activity-item"><div class="activity-icon ' + iconClass + '"><i class="fas ' + iconFA + '"></i></div><div class="activity-text"><strong>' + escapeHtml(act.clientName) + '</strong> ' + actionText + detail + ' "' + subjectOrBlock + '"</div><div class="activity-time">' + timeAgo + '</div></div>';
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
                        var ur = updatedSends[i].recipients[j];
                        if (lr.status !== ur.status ||
                            lr.openCount !== ur.openCount ||
                            lr.clickCount !== ur.clickCount) {
                            hasChanges = true;
                            break;
                        }
                        // Detectar cambios en events (blockName)
                        var localEventsCount = (lr.events && lr.events.length) || 0;
                        var updatedEventsCount = (ur.events && ur.events.length) || 0;
                        if (localEventsCount !== updatedEventsCount) {
                            hasChanges = true;
                            break;
                        }
                        // Verificar si algun event tiene blockName que no teniamos
                        if (ur.events && ur.events.length > 0) {
                            for (var e = 0; e < ur.events.length; e++) {
                                if (ur.events[e].blockName && (!lr.events || !lr.events[e] || lr.events[e].blockName !== ur.events[e].blockName)) {
                                    hasChanges = true;
                                    break;
                                }
                            }
                            if (hasChanges) break;
                        }
                    }
                    if (hasChanges) break;
                }
            }
            if (hasChanges) {
                saveSends(updatedSends);
                var activeView = document.querySelector('.view-content.active');
                if (activeView) {
                    var viewId = activeView.id;
                    if (viewId === 'view-history') renderHistory();
                    if (viewId === 'view-analytics') renderAnalytics();
                }
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
    if (searchClientInput) searchClientInput.addEventListener('input', function(e) { clientSearchTerm = e.target.value; clientsPageLoaded = CLIENTS_PAGE_SIZE; renderClientSelector(); });

    // Nav items
    document.querySelectorAll('.nav-item').forEach(function(btn) { btn.addEventListener('click', function() { navigateTo(this.getAttribute('data-nav')); }); });

    // Clients page search
    var searchClientsPage = document.getElementById('search-clients-page');
    if (searchClientsPage) searchClientsPage.addEventListener('input', function(e) { clientPageSearchTerm = e.target.value; renderClientsPage(); });

    // Reload clients page
    var reloadClientsPageBtn = document.getElementById('reload-clients-page');
    if (reloadClientsPageBtn) reloadClientsPageBtn.addEventListener('click', function() { loadClients(); renderClientsPage(); showToast('Clientes recargados', 'info'); });

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

    // Seguimiento filters
    document.getElementById('seg-filter-store') && document.getElementById('seg-filter-store').addEventListener('change', renderSeguimiento);
    document.getElementById('seg-filter-status') && document.getElementById('seg-filter-status').addEventListener('change', renderSeguimiento);
    document.getElementById('seg-filter-search') && document.getElementById('seg-filter-search').addEventListener('input', renderSeguimiento);
    document.getElementById('refresh-seguimiento') && document.getElementById('refresh-seguimiento').addEventListener('click', async function() {
        showToast('Cargando datos de seguimiento...', 'info');
        await loadMasterData();
        updateTiendaFilter();
        renderSeguimiento();
        showToast('Datos actualizados', 'success');
    });

    // Escuchar cambios de ruta
    window.addEventListener('hashchange', handleRouteChange);

    // Cargar envios desde Google Sheets (fuente de verdad)
    await fetchSendsFromSheet();
    renderHistory();
    renderAnalytics();

    // Cargar datos de seguimiento
    await loadMasterData();
    updateTiendaFilter();

    // Inicializar ruta segun la URL
    handleRouteChange();

    var pollIntervalId = setInterval(function() { pollTrackingEvents(); }, POLL_INTERVAL);
    window.addEventListener('beforeunload', function() {
        if (pollIntervalId) clearInterval(pollIntervalId);
    });

    console.log('Kudos Mail CRM inicializado');
}

if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
else { init(); }
