// =====================================================================
// ESTADO GLOBAL DE LA APLICACIÓN
// =====================================================================
let projects = [];
let currentProject = null;
let currentTask = null;

// Variables específicas para el flujo de anotación activo
let selectedClassificationLabel = null;
let rlhfSelectedResponse = null;
let rlhfRating = 0;
let nerActiveLabel = null;
let nerEntities = []; // Estructura: [{start, end, label, text}]

// =====================================================================
// INICIALIZACIÓN E INTERFAZ DE USUARIO
// =====================================================================
document.addEventListener("DOMContentLoaded", () => {
    loadProjects();
    setupEventListeners();
});

function setupEventListeners() {
    // Modal de Importación
    document.getElementById("btn-show-import").addEventListener("click", showImportModal);
    document.getElementById("btn-close-modal").addEventListener("click", hideImportModal);
    document.getElementById("btn-cancel-import").addEventListener("click", hideImportModal);
    document.getElementById("btn-submit-import").addEventListener("click", handleImportProject);
    
    // Acciones de Anotación
    document.getElementById("btn-submit-annotation").addEventListener("click", handleSubmitAnnotation);
    document.getElementById("btn-export").addEventListener("click", handleExportDataset);

    // Rating por Estrellas (RLHF)
    const starContainer = document.getElementById("star-rating");
    starContainer.addEventListener("click", (e) => {
        if (e.target.tagName === "SPAN") {
            const val = parseInt(e.target.getAttribute("data-value"));
            setRlhfRating(val);
        }
    });
}

// =====================================================================
// CARGA Y GESTIÓN DE PROYECTOS (API calls)
// =====================================================================
async function loadProjects() {
    try {
        const response = await fetch("/api/projects");
        projects = await response.json();
        renderProjectsList();
    } catch (err) {
        console.error("Error al cargar los proyectos:", err);
    }
}

function renderProjectsList() {
    const listContainer = document.getElementById("project-list");
    listContainer.innerHTML = "";

    if (projects.length === 0) {
        listContainer.innerHTML = '<li class="project-item-empty">No hay proyectos creados</li>';
        return;
    }

    projects.forEach(p => {
        const li = document.createElement("li");
        li.className = "project-item";
        if (currentProject && currentProject.id === p.id) {
            li.classList.add("active");
        }
        
        // Mapeo amigable para el tipo de tarea
        let typeText = "Clasificación";
        if (p.task_type === "rlhf") typeText = "Alineación LLM (RLHF)";
        if (p.task_type === "ner") typeText = "Entidades (NER)";

        li.innerHTML = `
            <div class="project-title">${p.name}</div>
            <div class="project-type">${typeText}</div>
        `;
        
        li.addEventListener("click", () => selectProject(p));
        listContainer.appendChild(li);
    });
}

async function selectProject(project) {
    currentProject = project;
    renderProjectsList();

    // Actualizamos la cabecera
    document.getElementById("current-project-name").innerText = project.name;
    
    let typeText = "Clasificación de Texto";
    if (project.task_type === "rlhf") typeText = "Alineación y Comparación de LLM (RLHF)";
    if (project.task_type === "ner") typeText = "Reconocimiento de Entidades Nombradas (NER)";
    document.getElementById("current-project-type").innerText = typeText;

    // Habilitamos el botón de exportación
    document.getElementById("btn-export").disabled = false;

    // Cargamos la siguiente tarea
    loadNextTask();
}

// =====================================================================
// GESTIÓN DE TAREAS Y TOKENIZACIÓN (Interlinking)
// =====================================================================
async function loadNextTask() {
    if (!currentProject) return;

    try {
        const response = await fetch(`/api/projects/${currentProject.id}/tasks/next`);
        const data = await response.json();

        if (data.task) {
            currentTask = data.task;
            showWorkspace(true);
            renderTask();
            calculateTokens(currentTask.text);
        } else {
            // No quedan tareas pendientes
            currentTask = null;
            showWorkspace(false);
            document.getElementById("empty-workspace").innerHTML = `
                <div class="welcome-card">
                    <h2>Proyecto Completado</h2>
                    <p>Se han completado todas las tareas de este proyecto. Ya puedes exportar el dataset anotado.</p>
                </div>
            `;
        }
    } catch (err) {
        console.error("Error al cargar la siguiente tarea:", err);
    }
}

async function calculateTokens(text) {
    // Calculamos tokens consumiendo la API de tokenizacion BPE
    try {
        const response = await fetch("/api/tokenize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text })
        });
        const data = await response.json();
        
        document.getElementById("stat-tokens-count").innerText = data.tokens_count;
        
        const idsBox = document.getElementById("stat-token-ids-container");
        if (data.token_ids && data.token_ids.length > 0) {
            idsBox.innerText = data.token_ids.join(", ");
        } else {
            idsBox.innerText = "No hay tokens.";
        }
    } catch (err) {
        console.error("Error en la tokenización:", err);
        document.getElementById("stat-tokens-count").innerText = "-";
        document.getElementById("stat-token-ids-container").innerText = "Error al calcular.";
    }
}

function showWorkspace(active) {
    const workspace = document.getElementById("annotation-workspace");
    const emptyWorkspace = document.getElementById("empty-workspace");
    if (active) {
        workspace.classList.remove("hidden");
        emptyWorkspace.classList.add("hidden");
    } else {
        workspace.classList.add("hidden");
        emptyWorkspace.classList.remove("hidden");
    }
}

// =====================================================================
// RENDERIZADO DEL WORKSPACE DE ACUERDO AL TIPO DE PROYECTO
// =====================================================================
function renderTask() {
    if (!currentTask || !currentProject) return;

    document.getElementById("task-id-display").innerText = currentTask.id;
    
    // Renderizado del texto base
    const textContainer = document.getElementById("text-to-annotate");
    textContainer.innerText = currentTask.text;

    // Resetear estados locales
    selectedClassificationLabel = null;
    rlhfSelectedResponse = null;
    rlhfRating = 0;
    nerEntities = [];
    resetStars();

    // Limpiamos los inputs de RLHF
    document.getElementById("pref-a").checked = false;
    document.getElementById("pref-b").checked = false;
    document.getElementById("box-response-a").classList.remove("selected");
    document.getElementById("box-response-b").classList.remove("selected");
    document.getElementById("rlhf-edited-text").value = "";

    // Ocultar todos los módulos primero
    document.getElementById("module-classification").classList.add("hidden");
    document.getElementById("module-rlhf").classList.add("hidden");
    document.getElementById("module-ner").classList.add("hidden");

    // Mostrar el módulo que corresponda al tipo de tarea
    if (currentProject.task_type === "classification") {
        renderClassificationModule();
    } else if (currentProject.task_type === "rlhf") {
        renderRlhfModule();
    } else if (currentProject.task_type === "ner") {
        renderNerModule();
    }
}

// --- CLASIFICACIÓN ---
function renderClassificationModule() {
    const module = document.getElementById("module-classification");
    module.classList.remove("hidden");
    
    const buttonGroup = document.getElementById("classification-buttons");
    buttonGroup.innerHTML = "";

    const labels = currentProject.labels.split(",");
    labels.forEach(label => {
        const btn = document.createElement("button");
        btn.className = "btn-label";
        btn.innerText = label.strip ? label.strip() : label.trim();
        btn.addEventListener("click", () => {
            // Marcamos el botón seleccionado
            document.querySelectorAll(".btn-label").forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
            selectedClassificationLabel = btn.innerText;
        });
        buttonGroup.appendChild(btn);
    });
}

// --- RLHF ---
function renderRlhfModule() {
    const module = document.getElementById("module-rlhf");
    module.classList.remove("hidden");

    document.getElementById("text-response-a").innerText = currentTask.response_a;
    document.getElementById("text-response-b").innerText = currentTask.response_b;
    
    // Por defecto, sugerimos editar la mejor respuesta una vez se seleccione,
    // copiando el contenido al editor.
}

function selectResponse(choice) {
    rlhfSelectedResponse = choice;
    
    const boxA = document.getElementById("box-response-a");
    const boxB = document.getElementById("box-response-b");
    const radioA = document.getElementById("pref-a");
    const radioB = document.getElementById("pref-b");

    if (choice === "A") {
        boxA.classList.add("selected");
        boxB.classList.remove("selected");
        radioA.checked = true;
        
        // Copiamos la respuesta al editor para facilitarle la vida al anotador (Human-in-the-Loop)
        if (!document.getElementById("rlhf-edited-text").value) {
            document.getElementById("rlhf-edited-text").value = currentTask.response_a;
        }
    } else {
        boxB.classList.add("selected");
        boxA.classList.remove("selected");
        radioB.checked = true;
        
        if (!document.getElementById("rlhf-edited-text").value) {
            document.getElementById("rlhf-edited-text").value = currentTask.response_b;
        }
    }
}

function setRlhfRating(val) {
    rlhfRating = val;
    const stars = document.querySelectorAll("#star-rating span");
    stars.forEach(s => {
        const starVal = parseInt(s.getAttribute("data-value"));
        if (starVal <= val) {
            s.classList.add("active");
        } else {
            s.classList.remove("active");
        }
    });
}

function resetStars() {
    document.querySelectorAll("#star-rating span").forEach(s => s.classList.remove("active"));
}

// --- NER ---
function renderNerModule() {
    const module = document.getElementById("module-ner");
    module.classList.remove("hidden");

    const labelGroup = document.getElementById("ner-label-buttons");
    labelGroup.innerHTML = "";

    const labels = currentProject.labels.split(",");
    
    if (labels.length > 0) {
        nerActiveLabel = labels[0].trim();
    }

    labels.forEach((label, idx) => {
        const btn = document.createElement("button");
        const cleanLabel = label.trim();
        // Clases de color cíclicas
        btn.className = `badge-label label-color-${idx % 6}`;
        if (cleanLabel === nerActiveLabel) {
            btn.classList.add("active");
        }
        btn.innerText = cleanLabel;
        btn.addEventListener("click", () => {
            document.querySelectorAll(".badge-label").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            nerActiveLabel = cleanLabel;
        });
        labelGroup.appendChild(btn);
    });

    // Escuchador de selección sobre el texto a anotar
    const textContainer = document.getElementById("text-to-annotate");
    // Eliminamos listeners anteriores para no duplicar
    textContainer.removeEventListener("mouseup", handleTextSelection);
    textContainer.addEventListener("mouseup", handleTextSelection);

    renderNerEntitiesList();
}

function handleTextSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const selectedText = selection.toString().trim();
    if (!selectedText || !nerActiveLabel) return;

    const range = selection.getRangeAt(0);
    const container = document.getElementById("text-to-annotate");
    
    // Calculamos el offset absoluto sobre el texto plano original.
    // Esto es crítico ya que el contenedor de texto puede contener nodos <mark> debido
    // a entidades anotadas anteriormente, lo que altera los offsets de nodos locales.
    const preSelectionRange = range.cloneRange();
    preSelectionRange.selectNodeContents(container);
    preSelectionRange.setEnd(range.startContainer, range.startOffset);
    
    const start = preSelectionRange.toString().length;
    const end = start + selectedText.length;

    // Evitamos duplicar o cruzar anotaciones
    const overlap = nerEntities.some(ent => {
        return (start >= ent.start && start < ent.end) || (end > ent.start && end <= ent.end);
    });

    if (overlap) {
        alert("Las entidades no pueden superponerse.");
        selection.removeAllRanges();
        return;
    }

    // Guardamos la entidad
    nerEntities.push({
        start: start,
        end: end,
        label: nerActiveLabel,
        text: selectedText
    });

    // Ordenamos entidades por orden de aparicion para renderizar
    nerEntities.sort((a, b) => a.start - b.start);

    // Limpiamos selección del navegador
    selection.removeAllRanges();

    // Volvemos a pintar el contenedor con los markups interactivos
    highlightNerText();
    renderNerEntitiesList();
}

function highlightNerText() {
    const container = document.getElementById("text-to-annotate");
    const rawText = currentTask.text;
    
    const labelsList = currentProject.labels.split(",").map(l => l.trim());

    if (nerEntities.length === 0) {
        container.innerText = rawText;
        return;
    }

    let html = "";
    let lastIdx = 0;

    nerEntities.forEach(ent => {
        // Texto previo a la entidad
        html += rawText.substring(lastIdx, ent.start);
        
        // Obtener el indice de color
        const colorIdx = labelsList.indexOf(ent.label) % 6;
        
        // Pintamos el tag <mark> con estilo visual premium
        html += `<mark class="label-color-${colorIdx}">${rawText.substring(ent.start, ent.end)} <span style="font-size:0.6rem; font-weight:700; background:rgba(0,0,0,0.3); padding:1px 4px; border-radius:3px; margin-left:4px;">${ent.label}</span></mark>`;
        
        lastIdx = ent.end;
    });

    // Texto posterior al último elemento
    html += rawText.substring(lastIdx);
    container.innerHTML = html;
}

function renderNerEntitiesList() {
    const listBody = document.getElementById("ner-entities-list");
    listBody.innerHTML = "";

    if (nerEntities.length === 0) {
        listBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No hay entidades marcadas</td></tr>';
        return;
    }

    nerEntities.forEach((ent, idx) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${ent.text}</strong></td>
            <td><span class="badge" style="padding:2px 8px; font-size:0.7rem;">${ent.label}</span></td>
            <td>${ent.start} - ${ent.end}</td>
            <td><button class="btn-delete" onclick="deleteNerEntity(${idx})">Eliminar</button></td>
        `;
        listBody.appendChild(tr);
    });
}

function deleteNerEntity(index) {
    nerEntities.splice(index, 1);
    highlightNerText();
    renderNerEntitiesList();
}


// =====================================================================
// GUARDAR ANOTACIONES Y EXPORTACIÓN (REST endpoints)
// =====================================================================
async function handleSubmitAnnotation() {
    if (!currentTask || !currentProject) return;

    let payload = {};

    if (currentProject.task_type === "classification") {
        if (!selectedClassificationLabel) {
            alert("Por favor, seleccione una categoría para continuar.");
            return;
        }
        payload = { user_label: selectedClassificationLabel };
    } else if (currentProject.task_type === "rlhf") {
        if (!rlhfSelectedResponse) {
            alert("Por favor, seleccione su respuesta preferida (A o B).");
            return;
        }
        payload = {
            selected_response: rlhfSelectedResponse,
            rating: rlhfRating,
            edited_response: document.getElementById("rlhf-edited-text").value
        };
    } else if (currentProject.task_type === "ner") {
        // Mandamos la lista de entidades marcadas
        payload = { ner_entities: nerEntities };
    }

    try {
        const response = await fetch(`/api/tasks/${currentTask.id}/annotations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            // Avanzamos a la siguiente tarea
            loadNextTask();
        } else {
            const err = await response.json();
            alert("Error al guardar anotación: " + err.detail);
        }
    } catch (err) {
        console.error("Error al guardar la anotación:", err);
    }
}

function handleExportDataset() {
    if (!currentProject) return;
    
    // Redirigimos el navegador al endpoint de exportación; dado que devuelve
    // un adjunto (attachment), se iniciará la descarga directa en segundo plano.
    window.location.href = `/api/projects/${currentProject.id}/export`;
}


// =====================================================================
// MODAL PARA IMPORTAR/CREAR NUEVO PROYECTO
// =====================================================================
function showImportModal() {
    document.getElementById("modal-import").classList.remove("hidden");
}

function hideImportModal() {
    document.getElementById("modal-import").classList.add("hidden");
    // Resetear formulario
    document.getElementById("import-name").value = "";
    document.getElementById("import-labels").value = "";
    document.getElementById("import-json-data").value = "";
}

async function handleImportProject() {
    const name = document.getElementById("import-name").value.trim();
    const task_type = document.getElementById("import-task-type").value;
    const labels = document.getElementById("import-labels").value.trim();
    const jsonData = document.getElementById("import-json-data").value.trim();

    if (!name) {
        alert("El nombre del proyecto es obligatorio.");
        return;
    }

    let tasks = [];
    if (jsonData) {
        try {
            tasks = JSON.parse(jsonData);
            if (!Array.isArray(tasks)) {
                alert("El JSON de tareas debe ser una lista/array.");
                return;
            }
        } catch (e) {
            alert("Error al parsear el JSON de tareas. Verifique el formato.");
            return;
        }
    } else {
        // Proyecto vacío
        tasks = [];
    }

    const payload = {
        name: name,
        task_type: task_type,
        labels: labels,
        tasks: tasks
    };

    try {
        const response = await fetch("/api/projects/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            const data = await response.json();
            hideImportModal();
            // Recargamos la lista de proyectos y seleccionamos el nuevo
            await loadProjects();
            // Buscamos el proyecto recién creado
            const newProj = projects.find(p => p.id === data.project_id);
            if (newProj) {
                selectProject(newProj);
            }
        } else {
            const err = await response.json();
            alert("Error al importar el proyecto: " + err.detail);
        }
    } catch (err) {
        console.error("Error al importar el proyecto:", err);
    }
}
