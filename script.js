// ============================================
// CONFIGURACIÓN
// ============================================

// Configuración de PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/build/pdf.worker.min.js';

// URLs (reemplazar con las tuyas)
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSaMkkN_vbBOWt8xfuBjrk6egPV-8H0rlVw0eEmcAKIK-7aa_E0bVVGHQGwt_jl1uj4hEz5G82oIVrA/pub?output=csv';
const CLIENTS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSaMkkN_vbBOWt8xfuBjrk6egPV-8H0rlVw0eEmcAKIK-7aa_E0bVVGHQGwt_jl1uj4hEz5G82oIVrA/pub?gid=1654401836&single=true&output=csv';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzPUkdJc4XINr57b5Uxuohz6GJUTcIW59-2dDS4parofHVqZ67pz2ToHdZTPAlHSEb10A/exec';

// Variables globales
let developments = [];
let clients = [];
let sortable;
let draggedItem = null;
let extractedDevelopments = [];
let devSearchTerm = '';
let clientSearchTerm = '';

// ============================================
// FUNCIONES DE IMPORTACIÓN DE ARCHIVOS
// ============================================

async function importFile(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    
    showLoading('Extrayendo información del archivo...');
    
    try {
        let text = '';
        
        if (extension === 'pdf') {
            text = await extractFromPDF(file);
        } else if (extension === 'docx') {
            text = await extractFromDOCX(file);
        } else if (extension === 'pptx') {
            text = await extractFromPPTX(file);
        } else {
            alert('Formato no soportado. Usa PDF, DOCX o PPTX');
            return;
        }
        
        console.log('Texto extraído, longitud:', text.length);
        
        extractedDevelopments = parseDevelopmentsFromText(text);
        
        if (extractedDevelopments.length === 0) {
            alert('No se encontraron desarrollos en el archivo. Verifica el formato.');
            return;
        }
        
        showPreview(extractedDevelopments);
        
    } catch (error) {
        console.error('Error al procesar archivo:', error);
        alert('Error al procesar el archivo: ' + error.message);
    }
}

async function extractFromPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + '\n';
    }
    
    return fullText;
}

async function extractFromDOCX(file) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    return result.value;
}

async function extractFromPPTX(file) {
    const arrayBuffer = await file.arrayBuffer();
    return "Procesando PPTX... Los desarrollos se extraerán automáticamente";
}

function parseDevelopmentsFromText(text) {
    const developmentsFound = [];
    
    const knownDevelopments = [
        'Carrusel de Videos', 'Cross Selling', 'Compra Conjunta', 'Barra progresiva de Envío',
        'Barra progresiva de Financiación', 'Shop the Look', 'Administrador de Cucardas',
        'Landing de Medios de Pago', 'Programación de Banners', 'Quick View',
        'Calculador de Litros', 'Panel promociones de medios de pago', 'Cronómetro de Ofertas',
        'Carrusel Programable', 'Popup de Promociones Bancarias', 'Landing Modelo',
        'Shop Our Instagram', 'Editor de Variantes', 'Calculador de Cuotas',
        'Mensaje Promocional', 'Asistente Informativo', 'Banner con cuenta regresiva'
    ];
    
    for (const devName of knownDevelopments) {
        const regex = new RegExp(`(${devName}[^\\n]{10,100})([\\s\\S]{100,800}?)(?=\\n\\s*\\n\\s*[A-ZÁÉÍÓÚÑ]|$)`, 'i');
        const match = text.match(regex);
        
        if (match) {
            const fullText = match[0];
            const summary = extractSummary(fullText);
            const description = fullText.substring(0, 500).replace(/[*_#]/g, '');
            
            let link = '#';
            const linkMatch = fullText.match(/https?:\/\/[^\s\)\n]+/i);
            if (linkMatch) {
                link = linkMatch[0];
            }
            
            developmentsFound.push({
                nombre: devName,
                resumen: summary,
                descripcion: description,
                captura_url: `https://via.placeholder.com/400x200?text=${encodeURIComponent(devName)}`,
                link: link
            });
        }
    }
    
    if (developmentsFound.length === 0) {
        const sections = text.split(/\n(?:###|#{2,3}|\d+\.\s+)/);
        
        for (let section of sections) {
            if (section.length > 50 && section.length < 2000) {
                const lines = section.split('\n').filter(l => l.trim());
                if (lines.length > 0) {
                    let nombre = lines[0].substring(0, 60).replace(/[*_#]/g, '').trim();
                    if (nombre.length > 5 && !nombre.match(/^\d+$/)) {
                        developmentsFound.push({
                            nombre: nombre,
                            resumen: extractSummary(section),
                            descripcion: section.substring(0, 500).replace(/[*_#]/g, ''),
                            captura_url: 'https://via.placeholder.com/400x200',
                            link: '#'
                        });
                    }
                }
            }
        }
    }
    
    return developmentsFound;
}

function extractSummary(text) {
    let cleaned = text.replace(/\s+/g, ' ').trim();
    cleaned = cleaned.replace(/[*_#]/g, '');
    
    const bulletMatch = cleaned.match(/[•\-*]\s*([^.\n]{30,150})/);
    if (bulletMatch) {
        return bulletMatch[1].trim();
    }
    
    if (cleaned.length > 200) {
        cleaned = cleaned.substring(0, 200) + '...';
    }
    
    return cleaned;
}

function showPreview(developments) {
    const previewDiv = document.getElementById('import-preview');
    const contentDiv = document.getElementById('preview-content');
    
    contentDiv.innerHTML = '';
    
    developments.forEach((dev, idx) => {
        const item = document.createElement('div');
        item.className = 'preview-item';
        item.innerHTML = `
            <strong>📌 ${escapeHtml(dev.nombre)}</strong><br>
            <small>${escapeHtml(dev.resumen.substring(0, 100))}...</small><br>
            <label style="font-size: 11px; margin-top: 5px; display: inline-block;">
                <input type="checkbox" checked data-idx="${idx}" class="preview-checkbox">
                Importar este desarrollo
            </label>
        `;
        contentDiv.appendChild(item);
    });
    
    previewDiv.style.display = 'block';
}

function confirmImport() {
    const checkboxes = document.querySelectorAll('.preview-checkbox:checked');
    const selectedDevelopments = [];
    
    checkboxes.forEach(cb => {
        const idx = parseInt(cb.getAttribute('data-idx'));
        if (extractedDevelopments[idx]) {
            selectedDevelopments.push(extractedDevelopments[idx]);
        }
    });
    
    if (selectedDevelopments.length === 0) {
        alert('Selecciona al menos un desarrollo para importar');
        return;
    }
    
    const existingNames = new Set(developments.map(d => d.nombre));
    const newDevelopments = selectedDevelopments.filter(d => !existingNames.has(d.nombre));
    
    developments.push(...newDevelopments);
    localStorage.setItem('importedDevelopments', JSON.stringify(developments));
    renderSidebar();
    document.getElementById('import-preview').style.display = 'none';
    
    alert(`✅ ${newDevelopments.length} desarrollos importados correctamente`);
    generateCSV(newDevelopments);
}

function generateCSV(developmentsToExport) {
    const csvData = developmentsToExport.map(dev => ({
        nombre: dev.nombre,
        resumen: dev.resumen,
        descripcion: dev.descripcion,
        captura_url: dev.captura_url,
        link: dev.link
    }));
    
    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `desarrollos_importados_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    console.log('CSV generado. Copia este contenido a Google Sheets:');
    console.log(csv);
}

function exportAllDevelopmentsToCSV() {
    if (developments.length === 0) {
        alert('No hay desarrollos para exportar');
        return;
    }
    
    const csvData = developments.map(dev => ({
        nombre: dev.nombre,
        resumen: dev.resumen,
        descripcion: dev.descripcion,
        captura_url: dev.captura_url,
        link: dev.link
    }));
    
    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `todos_los_desarrollos_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    alert(`✅ Exportados ${developments.length} desarrollos a CSV`);
}

function showLoading(message) {
    const previewDiv = document.getElementById('import-preview');
    const contentDiv = document.getElementById('preview-content');
    contentDiv.innerHTML = `<div class="loading">${message}</div>`;
    previewDiv.style.display = 'block';
}

// ============================================
// FUNCIÓN FORZAR RECARGA - LIMPIA CACHÉ
// ============================================

async function forceReloadData() {
    const btn = document.getElementById('force-reload-data');
    if (!btn) return;
    
    const originalText = btn.textContent;
    btn.textContent = '🔄 Limpiando caché...';
    btn.disabled = true;
    
    try {
        localStorage.removeItem('importedDevelopments');
        localStorage.removeItem('backupDevelopments');
        
        const urlWithTimestamp = SHEET_URL + '&t=' + new Date().getTime();
        
        console.log('Forzando recarga desde:', urlWithTimestamp);
        
        const response = await fetch(urlWithTimestamp, {
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });
        
        if (response.ok) {
            const csv = await response.text();
            console.log('CSV fresco recibido, longitud:', csv.length);
            
            const freshDevelopments = parseCSV(csv);
            console.log('Desarrollos frescos cargados:', freshDevelopments.length);
            
            if (freshDevelopments.length > 0) {
                console.log('Primer desarrollo fresco:', freshDevelopments[0]);
            }
            
            developments = freshDevelopments;
            localStorage.setItem('backupDevelopments', JSON.stringify(developments));
            renderSidebar();
            
            alert(`✅ Recarga completa exitosa!\n📦 ${developments.length} desarrollos cargados\n\nLas imágenes y links deberían estar actualizados.`);
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
        
    } catch (error) {
        console.error('Error en recarga forzada:', error);
        alert('❌ Error al recargar. Verifica la conexión y que el sheet esté publicado.\n\n' + error.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

// ============================================
// FUNCIONES DE CARGA DE DATOS
// ============================================

async function loadDevelopments() {
    const container = document.getElementById('blocks-list');
    container.innerHTML = '<div class="loading">Cargando desarrollos...</div>';
    
    try {
        const urlWithTimestamp = SHEET_URL + '&t=' + new Date().getTime();
        
        const response = await fetch(urlWithTimestamp, {
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });
        
        if (response.ok) {
            const csv = await response.text();
            console.log('CSV desarrollos recibido, longitud:', csv.length);
            
            if (csv.trim().length === 0) {
                throw new Error('CSV vacío');
            }
            
            developments = parseCSV(csv);
            console.log('Desarrollos cargados:', developments.length);
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (error) {
        console.error('Error cargando Google Sheets:', error);
        developments = getMockDevelopments();
        mostrarError('Usando datos de ejemplo para desarrollos');
    }
    
    loadImportedDevelopments();
    renderSidebar();
}

async function loadClients() {
    const container = document.getElementById('clients-list');
    if (!container) return;
    
    container.innerHTML = '<div class="loading">Cargando clientes...</div>';
    
    const savedClients = localStorage.getItem('clientesData');
    if (savedClients) {
        try {
            clients = JSON.parse(savedClients);
            if (clients.length > 0) {
                console.log('✅ Clientes cargados desde localStorage:', clients.length);
                renderClientSelector();
                return;
            }
        } catch (e) {
            console.log('Error parsing saved clients');
        }
    }
    
    try {
        const urlWithTimestamp = CLIENTS_SHEET_URL + '&t=' + new Date().getTime();
        console.log('Cargando clientes desde:', urlWithTimestamp);
        
        const response = await fetch(urlWithTimestamp, {
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });
        
        if (response.ok) {
            const csv = await response.text();
            console.log('CSV clientes recibido, longitud:', csv.length);
            
            const parsedClients = parseClientsFromCSV(csv);
            if (parsedClients.length > 0) {
                clients = parsedClients;
                localStorage.setItem('clientesData', JSON.stringify(clients));
                console.log('✅ Clientes cargados desde Google Sheets:', clients.length);
                renderClientSelector();
                return;
            }
        }
    } catch (error) {
        console.error('Error cargando clientes desde Google Sheets:', error);
    }
    
    clients = [
        { nombre: "Juan Pérez", email: "juan.perez@ejemplo.com", empresa: "Empresa A" },
        { nombre: "María García", email: "maria.garcia@ejemplo.com", empresa: "Empresa B" },
        { nombre: "Carlos López", email: "carlos.lopez@ejemplo.com", empresa: "Empresa C" },
        { nombre: "Ana Martínez", email: "ana.martinez@ejemplo.com", empresa: "Empresa D" },
        { nombre: "Roberto Sánchez", email: "roberto.sanchez@ejemplo.com", empresa: "Empresa E" }
    ];
    
    localStorage.setItem('clientesData', JSON.stringify(clients));
    renderClientSelector();
    console.log('✅ Usando clientes de ejemplo:', clients.length);
}

function parseClientsFromCSV(csv) {
    const lines = csv.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
        console.log('No hay suficientes líneas en CSV');
        return [];
    }
    
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^\uFEFF/, ''));
    console.log('Headers detectados:', headers);
    
    const nombreIndex = headers.findIndex(h => h.includes('nombre') || h.includes('name') || h.includes('cliente'));
    const emailIndex = headers.findIndex(h => h.includes('email') || h.includes('correo') || h.includes('mail'));
    const empresaIndex = headers.findIndex(h => h.includes('empresa') || h.includes('company') || h.includes('compania'));
    
    if (emailIndex === -1) {
        console.log('No se encontró columna de email');
        return [];
    }
    
    const clientsList = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const values = parseCSVLine(line);
        const email = emailIndex >= 0 && values[emailIndex] ? values[emailIndex].trim() : '';
        
        if (email && email.includes('@')) {
            clientsList.push({
                nombre: nombreIndex >= 0 && values[nombreIndex] ? values[nombreIndex].trim() : email.split('@')[0],
                email: email,
                empresa: empresaIndex >= 0 && values[empresaIndex] ? values[empresaIndex].trim() : 'Cliente'
            });
        }
    }
    
    console.log('Clientes parseados:', clientsList.length);
    return clientsList;
}

// ============================================
// RENDERIZADO MEJORADO
// ============================================

function renderSidebar() {
    const container = document.getElementById('blocks-list');
    container.innerHTML = '';
    
    // Filtrar por búsqueda
    let filtered = developments;
    if (devSearchTerm) {
        filtered = developments.filter(d => 
            d.nombre.toLowerCase().includes(devSearchTerm.toLowerCase()) ||
            (d.resumen && d.resumen.toLowerCase().includes(devSearchTerm.toLowerCase()))
        );
    }
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="loading">No hay desarrollos que coincidan con la búsqueda</div>';
        return;
    }
    
    filtered.forEach((dev, displayIdx) => {
        // Encontrar el índice real en el array original
        const originalIdx = developments.findIndex(d => d.nombre === dev.nombre);
        
        const block = document.createElement('div');
        block.className = 'block-card';
        block.setAttribute('draggable', 'true');
        block.setAttribute('data-dev-index', originalIdx);
        
        block.innerHTML = `
            <div class="block-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                <h3 style="flex: 1; font-size: 14px; color: #1a73e8; margin: 0;">📌 ${escapeHtml(dev.nombre)}</h3>
                <button class="add-to-email-btn" data-dev-index="${originalIdx}" style="background: #1a73e8; color: white; border: none; border-radius: 6px; padding: 4px 8px; font-size: 11px; cursor: pointer;">+ Agregar</button>
            </div>
            <div class="summary" style="font-size: 12px; color: #6c757d; margin-bottom: 8px; line-height: 1.4;">${escapeHtml(dev.resumen || 'Sin resumen')}</div>
            ${dev.captura_url ? `<img src="${dev.captura_url}" alt="${escapeHtml(dev.nombre)}" onerror="this.src='https://via.placeholder.com/300x150'" style="max-width: 100%; border-radius: 6px; margin-bottom: 8px;">` : ''}
            <div class="link" style="font-size: 11px;"><a href="${dev.link}" target="_blank" style="color: #1a73e8;">🔗 Ver desarrollo</a></div>
        `;
        
        block.addEventListener('dragstart', handleDragStart);
        block.addEventListener('dragend', handleDragEnd);
        
        const addBtn = block.querySelector('.add-to-email-btn');
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            addBlock(originalIdx);
        });
        
        container.appendChild(block);
    });
}

function renderClientSelector() {
    const container = document.getElementById('clients-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Filtrar por búsqueda
    let filtered = clients;
    if (clientSearchTerm) {
        filtered = clients.filter(c => 
            c.nombre.toLowerCase().includes(clientSearchTerm.toLowerCase()) ||
            c.email.toLowerCase().includes(clientSearchTerm.toLowerCase()) ||
            c.empresa.toLowerCase().includes(clientSearchTerm.toLowerCase())
        );
    }
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="loading">No hay clientes que coincidan con la búsqueda</div>';
        updateSelectionInfo();
        return;
    }
    
    const selectAllDiv = document.createElement('div');
    selectAllDiv.className = 'client-item';
    selectAllDiv.style.background = '#e9ecef';
    selectAllDiv.style.fontWeight = 'bold';
    selectAllDiv.innerHTML = `
        <input type="checkbox" id="select-all-clients" style="margin-right: 10px;">
        <label for="select-all-clients" style="font-weight: bold;">✅ Seleccionar todos (${filtered.length} clientes)</label>
    `;
    container.appendChild(selectAllDiv);
    
    filtered.forEach((client, displayIdx) => {
        // Encontrar el índice real en el array original
        const originalIdx = clients.findIndex(c => c.email === client.email);
        
        const div = document.createElement('div');
        div.className = 'client-item';
        div.innerHTML = `
            <input type="checkbox" class="client-checkbox" id="client_${originalIdx}" value="${originalIdx}" checked>
            <label for="client_${originalIdx}" style="cursor: pointer;">
                <strong>${escapeHtml(client.nombre)}</strong><br>
                <small>📧 ${escapeHtml(client.email)} | 🏢 ${escapeHtml(client.empresa)}</small>
            </label>
        `;
        container.appendChild(div);
    });
    
    const selectAllCheckbox = document.getElementById('select-all-clients');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            document.querySelectorAll('.client-checkbox').forEach(cb => {
                cb.checked = e.target.checked;
            });
            updateSelectionInfo();
        });
    }
    
    // Añadir evento a cada checkbox para actualizar contador
    document.querySelectorAll('.client-checkbox').forEach(cb => {
        cb.addEventListener('change', () => updateSelectionInfo());
    });
    
    updateSelectionInfo();
}

function updateSelectionInfo() {
    const selectedCount = document.querySelectorAll('.client-checkbox:checked').length;
    const infoDiv = document.getElementById('selection-info');
    if (infoDiv) {
        infoDiv.textContent = `${selectedCount} cliente${selectedCount !== 1 ? 's' : ''} seleccionado${selectedCount !== 1 ? 's' : ''}`;
    }
}

function renderEmailBlocks() {
    const container = document.getElementById('email-blocks');
    container.innerHTML = '';
    
    const savedBlocks = JSON.parse(localStorage.getItem('emailBlocks') || '[]');
    
    if (savedBlocks.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #999; padding: 40px;">Arrastra desarrollos aquí ➡️</div>';
    }
    
    savedBlocks.forEach((block, idx) => {
        const dev = developments[block.devIndex];
        if (!dev) return;
        
        const blockDiv = document.createElement('div');
        blockDiv.className = 'block-item';
        blockDiv.setAttribute('data-idx', idx);
        
        blockDiv.innerHTML = `
            <button class="remove-block" data-idx="${idx}">✕</button>
            <h3>🚀 ${escapeHtml(dev.nombre)}</h3>
            <div class="description">${escapeHtml(dev.descripcion || dev.resumen || 'Sin descripción')}</div>
            <a href="${dev.link}" target="_blank" class="block-link">Ver más →</a>
        `;
        
        blockDiv.querySelector('.remove-block').addEventListener('click', (e) => {
            e.stopPropagation();
            removeBlock(idx);
        });
        
        container.appendChild(blockDiv);
    });
    
    if (sortable) sortable.destroy();
    sortable = new Sortable(container, {
        animation: 150,
        onEnd: function() { saveOrder(); }
    });
}

function removeBlock(idx) {
    let blocks = JSON.parse(localStorage.getItem('emailBlocks') || '[]');
    blocks.splice(idx, 1);
    localStorage.setItem('emailBlocks', JSON.stringify(blocks));
    renderEmailBlocks();
}

function saveOrder() {
    const container = document.getElementById('email-blocks');
    const items = container.querySelectorAll('.block-item');
    const newOrder = [];
    const blocks = JSON.parse(localStorage.getItem('emailBlocks') || '[]');
    
    items.forEach(item => {
        const idx = parseInt(item.getAttribute('data-idx'));
        if (!isNaN(idx) && blocks[idx]) {
            newOrder.push(blocks[idx]);
        }
    });
    
    localStorage.setItem('emailBlocks', JSON.stringify(newOrder));
    renderEmailBlocks();
}

function getCurrentEmailBlocks() {
    const blocks = [];
    const savedBlocks = JSON.parse(localStorage.getItem('emailBlocks') || '[]');
    savedBlocks.forEach(block => {
        const dev = developments[block.devIndex];
        if (dev) blocks.push(dev);
    });
    return blocks;
}

function addBlock(devIndex) {
    const savedBlocks = JSON.parse(localStorage.getItem('emailBlocks') || '[]');
    savedBlocks.push({ devIndex: devIndex });
    localStorage.setItem('emailBlocks', JSON.stringify(savedBlocks));
    renderEmailBlocks();
}

function clearAllBlocks() {
    if (confirm('¿Eliminar todos los desarrollos del email?')) {
        localStorage.setItem('emailBlocks', JSON.stringify([]));
        renderEmailBlocks();
    }
}

function loadImportedDevelopments() {
    const saved = localStorage.getItem('importedDevelopments');
    if (saved) {
        const imported = JSON.parse(saved);
        const existingNames = new Set(developments.map(d => d.nombre));
        const newDevelopments = imported.filter(d => !existingNames.has(d.nombre));
        developments.push(...newDevelopments);
        if (newDevelopments.length > 0) {
            console.log('Desarrollos importados cargados:', newDevelopments.length);
            renderSidebar();
        }
    }
}

function parseCSV(csv) {
    const lines = csv.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^\uFEFF/, ''));
    const nombreIndex = headers.findIndex(h => h.includes('nombre') || h.includes('name'));
    const resumenIndex = headers.findIndex(h => h.includes('resumen') || h.includes('summary'));
    const descripcionIndex = headers.findIndex(h => h.includes('descripcion') || h.includes('description'));
    const capturaIndex = headers.findIndex(h => h.includes('captura') || h.includes('image'));
    const linkIndex = headers.findIndex(h => h.includes('link') || h.includes('url'));
    
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length > 0 && values[0].trim()) {
            data.push({
                nombre: nombreIndex >= 0 ? (values[nombreIndex] || 'Sin título').trim() : `Desarrollo ${i}`,
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
    const result = [];
    let inQuotes = false;
    let currentValue = '';
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(currentValue);
            currentValue = '';
        } else {
            currentValue += char;
        }
    }
    result.push(currentValue);
    return result.map(val => val.replace(/^"|"$/g, '').trim());
}

// ============================================
// FUNCIONES DE MANEJO DE DRAG & DROP
// ============================================

function handleDragStart(e) {
    draggedItem = this;
    e.dataTransfer.setData('text/plain', this.getAttribute('data-dev-index'));
    e.dataTransfer.effectAllowed = 'copy';
}

function handleDragEnd(e) {
    draggedItem = null;
}

function setupDropZone() {
    const dropZone = document.getElementById('email-blocks');
    
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        dropZone.style.background = '#e8f0fe';
    });
    
    dropZone.addEventListener('dragleave', () => {
        dropZone.style.background = '';
    });
    
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.background = '';
        if (draggedItem) {
            const devIndex = parseInt(draggedItem.getAttribute('data-dev-index'));
            if (!isNaN(devIndex)) {
                addBlock(devIndex);
            }
        }
    });
}

// ============================================
// FUNCIONES DE ENVÍO DE CORREOS
// ============================================

async function sendEmails() {
    const selectedClients = [];
    document.querySelectorAll('.client-checkbox:checked').forEach(checkbox => {
        const idx = parseInt(checkbox.value);
        if (clients[idx]) {
            selectedClients.push(clients[idx]);
        }
    });
    
    if (selectedClients.length === 0) {
        alert('⚠️ Por favor, selecciona al menos un cliente');
        return;
    }
    
    const blocks = getCurrentEmailBlocks();
    if (blocks.length === 0) {
        alert('⚠️ Agrega al menos un desarrollo al email');
        return;
    }
    
    const blocksHTML = blocks.map(block => `
        <div style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; margin-bottom: 15px; font-family: Arial, sans-serif;">
            <h3 style="color: #1a73e8; margin-top: 0; margin-bottom: 10px;">🚀 ${escapeHtml(block.nombre)}</h3>
            <p style="margin: 0 0 10px 0; line-height: 1.5;">${escapeHtml(block.descripcion || block.resumen)}</p>
            <a href="${block.link}" style="color: #1a73e8; text-decoration: none;">🔗 Ver más →</a>
        </div>
    `).join('');
    
    const emailTemplate = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px 20px; text-align: center; border-radius: 12px 12px 0 0;">
                <h1 style="margin: 0;">📧 Mi Agencia</h1>
                <p style="margin: 10px 0 0;">Innovación digital</p>
            </div>
            <div style="padding: 20px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 12px 12px; background: white;">
                <h2 style="color: #2c3e50; margin-top: 0;">Nuevos desarrollos disponibles</h2>
                <div style="margin-top: 20px;">
                    ${blocksHTML}
                </div>
                <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #666; text-align: center;">
                    <p>© 2025 Mi Agencia - Todos los derechos reservados</p>
                    <p style="margin-top: 5px;">Este correo fue enviado automáticamente. Por favor no responder a este mensaje.</p>
                </div>
            </div>
        </body>
        </html>
    `;
    
    const sendButton = document.getElementById('send-emails');
    const originalText = sendButton.textContent;
    sendButton.textContent = '📧 Enviando...';
    sendButton.disabled = true;
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const client of selectedClients) {
        try {
            await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: client.email,
                    subject: `Nuevos desarrollos para ${client.empresa} | Mi Agencia`,
                    htmlContent: emailTemplate,
                    clientName: client.nombre
                })
            });
            successCount++;
            console.log(`✅ Email enviado a ${client.email}`);
        } catch (error) {
            errorCount++;
            console.error(`❌ Error enviando a ${client.email}:`, error);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    sendButton.textContent = originalText;
    sendButton.disabled = false;
    
    if (errorCount === 0) {
        alert(`✅ ¡Éxito! Se enviaron ${successCount} correos correctamente.`);
    } else {
        alert(`⚠️ Envío completado\n✅ Exitosos: ${successCount}\n❌ Fallidos: ${errorCount}`);
    }
}

async function reloadClients() {
    const btn = document.getElementById('reload-clients');
    if (btn) {
        const originalText = btn.textContent;
        btn.textContent = '🔄 Cargando...';
        btn.disabled = true;
        
        localStorage.removeItem('clientesData');
        await loadClients();
        
        btn.textContent = originalText;
        btn.disabled = false;
    } else {
        await loadClients();
    }
}

// ============================================
// FUNCIONES DE EXPORTACIÓN
// ============================================

function exportToHTML() {
    const headerHTML = document.querySelector('.email-header').cloneNode(true);
    const footerHTML = document.querySelector('.email-footer').cloneNode(true);
    const blocksContainer = document.getElementById('email-blocks');
    const blocksHTML = Array.from(blocksContainer.querySelectorAll('.block-item')).map(block => {
        const clone = block.cloneNode(true);
        const removeBtn = clone.querySelector('.remove-block');
        if (removeBtn) removeBtn.remove();
        return clone.outerHTML;
    }).join('');
    
    return `<!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Email Personalizado - Mi Agencia</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f4f4f4; }
            .email-container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .email-header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px 20px; text-align: center; }
            .email-footer { background: #2c3e50; color: white; padding: 20px; text-align: center; font-size: 12px; }
            .email-footer a { color: #ffd700; text-decoration: none; }
            .email-blocks { padding: 20px; }
            .block-item { border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; margin-bottom: 15px; }
            .block-item h3 { color: #1a73e8; margin-bottom: 8px; }
            .block-item .description { font-size: 14px; color: #333; margin-bottom: 10px; }
            .block-link { color: #1a73e8; text-decoration: none; }
        </style>
    </head>
    <body>
        <div class="email-container">
            ${headerHTML.outerHTML}
            <div class="email-blocks">
                ${blocksHTML}
            </div>
            ${footerHTML.outerHTML}
        </div>
    </body>
    </html>`;
}

async function copyHTML() {
    const html = exportToHTML();
    try {
        await navigator.clipboard.writeText(html);
        alert('✅ HTML copiado al portapapeles');
    } catch (err) {
        alert('❌ Error al copiar');
    }
}

function downloadHTML() {
    const html = exportToHTML();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `email-${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    alert('✅ Email exportado correctamente');
}

// ============================================
// FUNCIONES DE UTILIDAD
// ============================================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function mostrarError(mensaje) {
    const container = document.getElementById('blocks-list');
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = mensaje;
    container.innerHTML = '';
    container.appendChild(errorDiv);
}

function getMockDevelopments() {
    return [
        { nombre: "Carrusel de Videos en Home", resumen: "Muestra videos de productos destacados en Home", descripcion: "Solución que permite mostrar productos destacados de forma dinámica.", captura_url: "https://via.placeholder.com/300x150", link: "#" },
        { nombre: "Cross Selling en Checkout", resumen: "Maximiza el valor de cada compra", descripcion: "Presenta productos complementarios justo antes del checkout.", captura_url: "https://via.placeholder.com/300x150", link: "#" },
        { nombre: "Compra Conjunta en PDP", resumen: "Sugiere productos complementarios en PDP", descripcion: "Muestra productos complementarios como oferta de combo.", captura_url: "https://via.placeholder.com/300x150", link: "#" }
    ];
}

// ============================================
// INICIALIZACIÓN
// ============================================

async function init() {
    await loadDevelopments();
    await loadClients();
    setupDropZone();
    renderEmailBlocks();
    
    // Botones existentes
    const exportBtn = document.getElementById('export-html');
    if (exportBtn) exportBtn.addEventListener('click', downloadHTML);
    
    const copyBtn = document.getElementById('copy-html');
    if (copyBtn) copyBtn.addEventListener('click', copyHTML);
    
    const exportCsvBtn = document.getElementById('export-csv');
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportAllDevelopmentsToCSV);
    
    const importBtn = document.getElementById('import-file-btn');
    if (importBtn) {
        importBtn.addEventListener('click', () => {
            document.getElementById('file-input').click();
        });
    }
    
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            if (e.target.files.length > 0) {
                await importFile(e.target.files[0]);
                e.target.value = '';
            }
        });
    }
    
    const confirmBtn = document.getElementById('confirm-import');
    if (confirmBtn) confirmBtn.addEventListener('click', confirmImport);
    
    const reloadClientsBtn = document.getElementById('reload-clients');
    if (reloadClientsBtn) reloadClientsBtn.addEventListener('click', reloadClients);
    
    const sendEmailsBtn = document.getElementById('send-emails');
    if (sendEmailsBtn) sendEmailsBtn.addEventListener('click', sendEmails);
    
    const forceReloadBtn = document.getElementById('force-reload-data');
    if (forceReloadBtn) {
        forceReloadBtn.addEventListener('click', forceReloadData);
    }
    
    const reloadDataBtn = document.getElementById('reload-data');
    if (reloadDataBtn) {
        reloadDataBtn.addEventListener('click', () => { loadDevelopments(); });
    }
    
    const clearBlocksBtn = document.getElementById('clear-blocks');
    if (clearBlocksBtn) {
        clearBlocksBtn.addEventListener('click', clearAllBlocks);
    }
    
    // Buscador de desarrollos
    const searchDevInput = document.getElementById('search-developments');
    if (searchDevInput) {
        searchDevInput.addEventListener('input', (e) => {
            devSearchTerm = e.target.value;
            renderSidebar();
        });
    }
    
    // Buscador de clientes
    const searchClientInput = document.getElementById('search-clients');
    if (searchClientInput) {
        searchClientInput.addEventListener('input', (e) => {
            clientSearchTerm = e.target.value;
            renderClientSelector();
        });
    }
    
    console.log('✅ Email Builder inicializado correctamente');
    console.log('📊 Desarrollos cargados:', developments.length);
    console.log('👥 Clientes cargados:', clients.length);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}