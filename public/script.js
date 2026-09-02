/**
 * Supervisor de Campo — Clima Social
 * Frontend Logic: Layout 2 Columnas, Filtros Cruzados (Sector, Supervisor, Fecha), 
 * Modo Puntos Individuales vs Clusters y Seguimiento en Tiempo Real.
 */

document.addEventListener('DOMContentLoaded', () => {
    // =========================================================================
    // ESTADO GLOBAL DE LA APLICACIÓN
    // =========================================================================
    const AppState = {
        config: {
            nombreProyecto: 'Supervisión de Campo',
            metaEncuestas: 2500,
            campoEncuestador: 'cod_enc',
            campoSupervisor: 'cod_sup'
        },
        encuestas: [],
        supervisorSeleccionado: 'Todos',
        sectorSeleccionado: 'Todos',
        parroquiaSeleccionada: 'Todas',
        fechaSeleccionada: 'Todas',
        encuestadorSeleccionado: null,
        mostrarEtiquetas: false,
        filtroGPS: 'Todos', // 'Todos', 'ConGPS', 'SinGPS'
        filtroTabla: '',
        modoVisualizacion: 'puntos', // 'puntos' | 'cluster'
        ordenTabla: { columna: 'encuestador', asc: true },
        supervisoresExpandidos: new Set(),
        ubicacionSupervisor: null,
        markerSupervisor: null,
        mapLoaded: false,
        parroquiasGeojson: null,
        parroquiasMap: new Map(),
        sectoresGeojson: null,
        sectoresMap: new Map()
    };
    window.AppState = AppState;

    // Paleta oficial Clima Social de Alto Contraste para Mapa
    const PALETA_SUPERVISORES = {
        '1': '#028090', // Teal Intenso Oficial
        '2': '#e11d48', // Coral / Carmesí Vivo
        '3': '#d97706', // Ámbar Dorado Brillante
        '4': '#7c3aed', // Violeta Real Intenso
        '5': '#059669', // Verde Esmeralda Vivo
        '6': '#2563eb', // Azul Cobalto Eléctrico
        '7': '#ea580c', // Naranja Intenso
        'default': '#f26419'
    };

    const UI = {
        cargaOverlay: document.getElementById('cargaOverlay'),
        errorBanner: document.getElementById('errorBanner'),
        botonReintentar: document.getElementById('botonReintentar'),
        tituloProyecto: document.getElementById('tituloProyecto'),
        badgeTexto: document.getElementById('badgeTexto'),
        hora: document.getElementById('hora'),
        fecha: document.getElementById('fecha'),
        botonSync: document.getElementById('botonSync'),
        botonModoOscuro: document.getElementById('botonModoOscuro'),
        
        // KPIs
        kpiTotal: document.getElementById('kpiTotal'),
        kpiHoy: document.getElementById('kpiHoy'),
        kpiPendientes: document.getElementById('kpiPendientes'),
        kpiAvance: document.getElementById('kpiAvance'),
        barraAvance: document.getElementById('barraAvance'),
        kpiMeta: document.getElementById('kpiMeta'),
        
        // Filtros Cruzados
        supervisorFilter: document.getElementById('supervisorFilter'),
        sectorFilter: document.getElementById('sectorFilter'),
        parroquiaFilter: document.getElementById('parroquiaFilter'),
        fechaFilter: document.getElementById('fechaFilter'),
        datePills: document.querySelectorAll('#datePills .cs-date-pill'),
        btnLimpiarFiltros: document.getElementById('btnLimpiarFiltros'),
        txtLimpiarFiltros: document.getElementById('txtLimpiarFiltros'),
        activeFilterChipsWrap: document.getElementById('activeFilterChipsWrap'),
        activeFilterChips: document.getElementById('activeFilterChips'),
        
        // Mapa y Modos
        mapContainer: document.getElementById('map'),
        mapLegend: document.getElementById('mapLegend'),
        mapLegendItems: document.getElementById('mapLegendItems'),
        locateBtn: document.getElementById('locateBtn'),
        btnEtiquetasOn: document.getElementById('btnEtiquetasOn'),
        btnEtiquetasOff: document.getElementById('btnEtiquetasOff'),
        mapStats: document.getElementById('mapStats'),
        
        // Tabla
        searchInput: document.getElementById('searchInput'),
        tablaEncuestadoresBody: document.querySelector('#tablaEncuestadores tbody'),
        emptyState: document.getElementById('emptyState'),
        headersTabla: document.querySelectorAll('#tablaEncuestadores th'),
        
        // Footer & Toast
        ultimaActualizacion: document.getElementById('ultimaActualizacion'),
        toast: document.getElementById('toast')
    };

    let map = null;

    // =========================================================================
    // RESOLVER DE CAMPOS KOBO (Ultra-rápido O(1) con fallback)
    // =========================================================================
    function campo(encuesta, nombreCorto) {
        if (!encuesta) return undefined;
        if (encuesta[nombreCorto] !== undefined) return encuesta[nombreCorto];
        
        // Fast paths directos para rendimiento instantáneo
        if (nombreCorto === 'sc' && encuesta.sc !== undefined) return encuesta.sc;
        if ((nombreCorto === 'tipologia' || nombreCorto === 'TIPOLOGIA') && encuesta.tipologia !== undefined) return encuesta.tipologia;
        if ((nombreCorto === 'parroquia' || nombreCorto === 'PARROQUIA' || nombreCorto === 'nom_parroquia') && encuesta.parroquia !== undefined) return encuesta.parroquia;
        if ((nombreCorto === 'barrio' || nombreCorto === 'BARRIO_O_SECTOR') && encuesta.barrio !== undefined) return encuesta.barrio;
        if (nombreCorto === 'C_digo_encuestador' && encuesta.encuestador !== undefined) return encuesta.encuestador;
        if (nombreCorto === 'C_digo_Supervisor' && encuesta.supervisor !== undefined) return encuesta.supervisor;

        const keys = Object.keys(encuesta);
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (k.endsWith('/' + nombreCorto)) return encuesta[k];
        }
        return undefined;
    }

    // =========================================================================
    // MAPEO DE CÓDIGOS DE PARROQUIA (CUENCA / AZUAY)
    // =========================================================================
    const DICCIONARIO_PARROQUIAS = {
        '5075': 'BELLAVISTA',
        '5080': 'CAÑARIBAMBA',
        '5135': 'EL BATAN',
        '5330': 'EL VECINO',
        '6865': 'HERMANO MIGUEL',
        '5450': 'HUAYNACAPAC',
        '5140': 'MACHANGARA',
        '5290': 'MONAY',
        '5875': 'RAMIREZ DAVALOS',
        '5905': 'SAGRARIO',
        '5930': 'SAN BLAS',
        '6010': 'SAN SEBASTIAN',
        '6090': 'SUCRE',
        '5360': 'TOTORACOCHA',
        '5370': 'YANUNCAY',
        '285': 'BAÑOS',
        '0285': 'BAÑOS',
        '845': 'CHAUCHA / ANGAS',
        '0845': 'CHAUCHA / ANGAS',
        '860': 'CHECA JIDCAY',
        '0860': 'CHECA JIDCAY',
        '905': 'CHIQUINTAD',
        '0905': 'CHIQUINTAD',
        '730': 'CUMBE',
        '0730': 'CUMBE',
        '2255': 'LLACAO',
        '2430': 'MOLLETURO',
        '2570': 'MULTI / NULTI',
        '2595': 'OCTAVIO CORDERO PALACIOS',
        '2680': 'PACCHA',
        '3105': 'QUINGEO',
        '3165': 'RICAURTE',
        '3460': 'SAN JOAQUIN',
        '3685': 'SANTA ANA',
        '3795': 'SAYAUSI',
        '3850': 'SIDCAY',
        '3870': 'SININCAY',
        '3980': 'TARQUI',
        '4095': 'TURI',
        '4200': 'VALLE',
        '4225': 'VICTORIA DEL PORTETE'
    };

    function obtenerParroquiaEncuesta(encuesta) {
        const val = campo(encuesta, 'parroquia') || campo(encuesta, 'PARROQUIA') || campo(encuesta, 'nom_parroquia');
        if (!val) return '';
        const strVal = String(val).trim();
        if (DICCIONARIO_PARROQUIAS[strVal]) return DICCIONARIO_PARROQUIAS[strVal];
        const padded = strVal.padStart(4, '0');
        if (DICCIONARIO_PARROQUIAS[padded]) return DICCIONARIO_PARROQUIAS[padded];
        return strVal;
    }

    function extraerCoordenadas(encuesta) {
        // 1. _geolocation [lat, lng]
        if (encuesta._geolocation && Array.isArray(encuesta._geolocation) && encuesta._geolocation.length >= 2 && encuesta._geolocation[0] !== null) {
            const lat = parseFloat(encuesta._geolocation[0]);
            const lng = parseFloat(encuesta._geolocation[1]);
            if (!isNaN(lat) && !isNaN(lng) && lat !== 0) return [lat, lng];
        }
        // 2. Campo 'gps' ("-0.2540309 -78.5465494 ...")
        const gpsStr = campo(encuesta, 'gps');
        if (gpsStr && typeof gpsStr === 'string') {
            const partes = gpsStr.trim().split(/\s+/);
            if (partes.length >= 2) {
                const lat = parseFloat(partes[0]);
                const lng = parseFloat(partes[1]);
                if (!isNaN(lat) && !isNaN(lng) && lat !== 0) return [lat, lng];
            }
        }
        return null;
    }

    function calcularDistancia(lat1, lon1, lat2, lon2) {
        const R = 6371; // km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    // =========================================================================
    // INICIALIZACIÓN
    // =========================================================================
    function configurarNavegacionMovil() {
        const navBtns = document.querySelectorAll('#mobileNav .cs-mobile-nav-btn');
        if (!navBtns || navBtns.length === 0) return;

        navBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                navBtns.forEach(b => b.classList.toggle('active', b === btn));
                if (tab === 'mapa' && map) {
                    setTimeout(() => map.resize(), 100);
                }
            });
        });
    }

    async function inicializar() {
        iniciarReloj();
        configurarModoOscuro();
        configurarNavegacionMovil();
        configurarEventos();

        // 1. Boot Instantáneo desde Caché Local Offline (0ms)
        try {
            const cached = localStorage.getItem('cs_encuestas_cache');
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    AppState.encuestas = parsed;
                    if (UI.badgeTexto) UI.badgeTexto.textContent = 'En vivo';
                    if (UI.cargaOverlay) UI.cargaOverlay.style.display = 'none';
                }
            }
        } catch (e) {
            console.warn('[Cache] Error al leer caché:', e);
        }
        
        try {
            await cargarConfiguracion();
            await inicializarMapa();
            await Promise.all([cargarLimitesParroquiales(), cargarSectoresCensales()]);
            
            if (AppState.encuestas.length > 0) {
                poblarFiltros();
                renderizarVista(false, false);
            }

            await cargarDatos(AppState.encuestas.length === 0);
            
            // Auto-refresco inteligente (pausa si la pantalla se apaga o se cambia de app)
            AppState.intervaloPolling = setInterval(() => cargarDatos(false), 180000);
            
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    clearInterval(AppState.intervaloPolling);
                    AppState.intervaloPolling = null;
                } else {
                    // Restablecer el canvas del mapa si estaba oculto (Android Chrome/tablet)
                    if (map) {
                        setTimeout(() => map.resize(), 100);
                        setTimeout(() => map.resize(), 500);
                    }
                    cargarDatos(false);
                    if (!AppState.intervaloPolling) {
                        AppState.intervaloPolling = setInterval(() => cargarDatos(false), 180000);
                    }
                }
            });
        } catch (error) {
            console.error('Error al inicializar:', error);
            if (UI.cargaOverlay) UI.cargaOverlay.style.display = 'none';
            mostrarError('Error de inicialización de la aplicación.');
        }
    }

    async function cargarConfiguracion() {
        try {
            const res = await fetch('/api/config');
            if (res.ok) {
                const configData = await res.json();
                AppState.config = { ...AppState.config, ...configData };
            }
            if (UI.tituloProyecto) {
                UI.tituloProyecto.textContent = AppState.config.nombreProyecto || 'Supervisión de Campo';
            }
            if (UI.kpiMeta) {
                UI.kpiMeta.textContent = `Meta: ${(AppState.config.metaEncuestas || 2500).toLocaleString()}`;
            }
        } catch (e) {
            console.warn('Usando configuración por defecto');
        }
    }

    async function cargarDatos(mostrarOverlay = false) {
        if (mostrarOverlay && UI.cargaOverlay) UI.cargaOverlay.style.display = 'flex';
        ocultarError();
        
        if (UI.badgeTexto) UI.badgeTexto.textContent = 'Sincronizando…';

        try {
            const res = await fetch('/api/encuestas');
            if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
            
            const data = await res.json();
            const rawEncuestas = data.resultados || [];
            AppState.encuestas = rawEncuestas.filter(e => {
                const codEnc = String(e.encuestador || e.C_digo_encuestador || campo(e, AppState.config.campoEncuestador) || '').trim();
                const codSup = String(e.supervisor || e.C_digo_Supervisor || campo(e, AppState.config.campoSupervisor) || '').trim();
                return codEnc !== '98' && codSup !== '98';
            });

            // Guardar en caché local para operatividad 100% offline
            try {
                localStorage.setItem('cs_encuestas_cache', JSON.stringify(AppState.encuestas));
            } catch (e) {
                console.warn('[Cache] Error al guardar caché:', e);
            }
            
            poblarFiltros();
            renderizarVista(false, mostrarOverlay);
            
            if (AppState.encuestas.length === 0) {
                if (UI.badgeTexto) UI.badgeTexto.textContent = 'En espera';
                if (UI.ultimaActualizacion) UI.ultimaActualizacion.textContent = 'Esperando nueva encuesta';
            } else {
                if (UI.badgeTexto) UI.badgeTexto.textContent = 'En vivo';
                if (UI.ultimaActualizacion) {
                    const ahora = new Date();
                    UI.ultimaActualizacion.textContent = `Última sincronización: ${ahora.toLocaleTimeString('es-EC')}`;
                }
            }
        } catch (error) {
            console.error('Error cargando encuestas:', error);
            if (AppState.encuestas.length === 0) {
                mostrarError('No se pudieron cargar los datos de KoboToolbox.');
            } else {
                mostrarToast('Modo sin conexión: datos desde caché local', 'info');
            }
            if (UI.badgeTexto) UI.badgeTexto.textContent = 'Sin conexión';
        } finally {
            if (UI.cargaOverlay) UI.cargaOverlay.style.display = 'none';
        }
    }

    // =========================================================================
    // FILTROS CRUZADOS INTELIGENTES Y DINÁMICOS
    // =========================================================================
    function actualizarFiltrosUI() {
        let activeCount = 0;
        const chips = [];

        if (UI.supervisorFilter) {
            const isAct = AppState.supervisorSeleccionado !== 'Todos';
            UI.supervisorFilter.classList.toggle('is-active', isAct);
            if (isAct) {
                activeCount++;
                chips.push({
                    tipo: 'supervisor',
                    label: `Supervisor #${AppState.supervisorSeleccionado}`,
                    onClear: () => {
                        AppState.supervisorSeleccionado = 'Todos';
                        if (UI.supervisorFilter) UI.supervisorFilter.value = 'Todos';
                        poblarFiltros();
                        renderizarVista(true, true);
                    }
                });
            }
        }
        if (UI.parroquiaFilter) {
            const isAct = AppState.parroquiaSeleccionada !== 'Todas';
            UI.parroquiaFilter.classList.toggle('is-active', isAct);
            if (isAct) {
                activeCount++;
                chips.push({
                    tipo: 'parroquia',
                    label: `Parroquia: ${AppState.parroquiaSeleccionada}`,
                    onClear: () => {
                        AppState.parroquiaSeleccionada = 'Todas';
                        if (UI.parroquiaFilter) UI.parroquiaFilter.value = 'Todas';
                        poblarFiltros();
                        renderizarVista(true, true);
                    }
                });
            }
        }
        if (UI.sectorFilter) {
            const isAct = AppState.sectorSeleccionado !== 'Todos';
            UI.sectorFilter.classList.toggle('is-active', isAct);
            if (isAct) {
                activeCount++;
                chips.push({
                    tipo: 'sector',
                    label: `Sector: ${AppState.sectorSeleccionado}`,
                    onClear: () => {
                        AppState.sectorSeleccionado = 'Todos';
                        if (UI.sectorFilter) UI.sectorFilter.value = 'Todos';
                        poblarFiltros();
                        renderizarVista(true, true);
                    }
                });
            }
        }
        // Sincronizar Botones Rápidos de Fecha (Pills)
        if (UI.datePills && UI.datePills.length > 0) {
            UI.datePills.forEach(pill => {
                const f = pill.dataset.dateFilter;
                pill.classList.toggle('active', AppState.fechaSeleccionada === f);
            });
        }

        if (UI.fechaFilter) {
            const isCustomDate = AppState.fechaSeleccionada !== 'Todas' && 
                                 AppState.fechaSeleccionada !== 'Hoy' && 
                                 AppState.fechaSeleccionada !== 'Ayer' && 
                                 AppState.fechaSeleccionada !== 'Semana';
            UI.fechaFilter.classList.toggle('is-active', isCustomDate);
            if (isCustomDate) {
                UI.fechaFilter.value = AppState.fechaSeleccionada;
            }
        }

        if (AppState.fechaSeleccionada !== 'Todas') {
            activeCount++;
            let fecLabel = `Fecha: ${AppState.fechaSeleccionada}`;
            if (AppState.fechaSeleccionada === 'Hoy') fecLabel = 'Fecha: Hoy';
            else if (AppState.fechaSeleccionada === 'Ayer') fecLabel = 'Fecha: Ayer';
            else if (AppState.fechaSeleccionada === 'Semana') fecLabel = 'Fecha: Esta semana';

            chips.push({
                tipo: 'fecha',
                label: fecLabel,
                onClear: () => {
                    AppState.fechaSeleccionada = 'Todas';
                    if (UI.fechaFilter) UI.fechaFilter.value = 'Todas';
                    renderizarVista(true, true);
                }
            });
        }
        if (AppState.encuestadorSeleccionado) {
            activeCount++;
            chips.push({
                tipo: 'encuestador',
                label: `Encuestador #${AppState.encuestadorSeleccionado}`,
                onClear: () => {
                    seleccionarEncuestador(AppState.encuestadorSeleccionado);
                }
            });
        }
        if (AppState.filtroTabla) {
            activeCount++;
            chips.push({
                tipo: 'busqueda',
                label: `Búsqueda: "${AppState.filtroTabla}"`,
                onClear: () => {
                    AppState.filtroTabla = '';
                    if (UI.searchInput) UI.searchInput.value = '';
                    const encuestas = obtenerEncuestasFiltradas();
                    actualizarTabla(encuestas);
                    actualizarFiltrosUI();
                }
            });
        }

        if (UI.btnLimpiarFiltros) {
            UI.btnLimpiarFiltros.classList.toggle('has-active', activeCount > 0);
            const txt = document.getElementById('txtLimpiarFiltros');
            if (txt) {
                txt.textContent = activeCount > 0 ? `Limpiar (${activeCount})` : 'Limpiar';
            }
        }

        // Renderizar Chips de Filtros Activos
        if (UI.activeFilterChipsWrap && UI.activeFilterChips) {
            if (chips.length > 0) {
                UI.activeFilterChipsWrap.style.display = 'flex';
                UI.activeFilterChips.innerHTML = '';
                chips.forEach(chip => {
                    const el = document.createElement('button');
                    el.type = 'button';
                    el.className = 'cs-filter-chip';
                    el.innerHTML = `<span>${chip.label}</span><svg class="cs-chip-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
                    el.title = `Quitar filtro: ${chip.label}`;
                    el.addEventListener('click', (e) => {
                        e.stopPropagation();
                        chip.onClear();
                    });
                    UI.activeFilterChips.appendChild(el);
                });
            } else {
                UI.activeFilterChipsWrap.style.display = 'none';
                UI.activeFilterChips.innerHTML = '';
            }
        }
    }

    function poblarFiltros() {
        if (!AppState.encuestas || AppState.encuestas.length === 0) return;

        const selSup = AppState.supervisorSeleccionado;
        const selSec = AppState.sectorSeleccionado;
        const selPar = AppState.parroquiaSeleccionada;
        const selFec = AppState.fechaSeleccionada;
        const selEnc = AppState.encuestadorSeleccionado;
        const targetPar = selPar !== 'Todas' ? selPar.toUpperCase() : '';

        const supervisores = new Map();
        const sectores = new Map();
        const parroquias = new Map();
        const fechas = new Map();

        const encuestas = AppState.encuestas;
        const total = encuestas.length;

        for (let i = 0; i < total; i++) {
            const e = encuestas[i];
            const sup = String(e.supervisor || e.C_digo_Supervisor || campo(e, AppState.config.campoSupervisor) || '');
            const rawSc = String(e.sc || campo(e, 'sc') || '');
            const sc = rawSc.replace(/[^0-9]/g, '') || rawSc;
            const tip = String(e.tipologia || campo(e, 'tipologia') || '').toUpperCase();
            const etiq = `${sc}${tip}`;
            const parr = obtenerParroquiaEncuesta(e);
            const fec = e._submission_time ? e._submission_time.substring(0, 10) : '';
            const encCod = String(e.encuestador || e.C_digo_encuestador || campo(e, AppState.config.campoEncuestador) || '');

            const matchSup = (selSup === 'Todos' || sup === selSup);
            const matchSec = (selSec === 'Todos' || sc === selSec || rawSc === selSec || etiq === selSec);
            let matchFec = true;
            if (selFec !== 'Todas') {
                const hoyStr = new Date().toISOString().split('T')[0];
                const ayerStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];
                const haceSieteDiasStr = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
                if (selFec === 'Hoy') matchFec = (fec === hoyStr);
                else if (selFec === 'Ayer') matchFec = (fec === ayerStr);
                else if (selFec === 'Semana') matchFec = (fec >= haceSieteDiasStr && fec <= hoyStr);
                else matchFec = (fec === selFec);
            }
            const matchEnc = (!selEnc || encCod === String(selEnc));
            let matchPar = true;
            if (targetPar) {
                const uParr = parr.toUpperCase();
                matchPar = (uParr.includes(targetPar) || targetPar.includes(uParr));
            }

            // 1. Supervisores disponibles (filtrado por Sector, Parroquia, Fecha, Encuestador)
            if (sup && matchSec && matchPar && matchFec && matchEnc) {
                supervisores.set(sup, (supervisores.get(sup) || 0) + 1);
            }

            // 2. Sectores disponibles (filtrado por Supervisor, Parroquia, Fecha, Encuestador)
            if (sc && matchSup && matchPar && matchFec && matchEnc) {
                sectores.set(sc, (sectores.get(sc) || 0) + 1);
            }

            // 3. Parroquias disponibles (filtrado por Supervisor, Sector, Fecha, Encuestador)
            if (parr && matchSup && matchSec && matchFec && matchEnc) {
                parroquias.set(parr, (parroquias.get(parr) || 0) + 1);
            }

            // 4. Fechas disponibles (filtrado por Supervisor, Sector, Parroquia, Encuestador)
            if (fec && matchSup && matchSec && matchPar && matchEnc) {
                fechas.set(fec, (fechas.get(fec) || 0) + 1);
            }
        }

        const hayFiltroActivo = (selSup !== 'Todos' || !!selEnc || !!targetPar || selFec !== 'Todas');

        // 1. Selector Supervisores
        if (UI.supervisorFilter) {
            const actualSup = AppState.supervisorSeleccionado || 'Todos';
            UI.supervisorFilter.innerHTML = '<option value="Todos">Todos los supervisores</option>';
            const supList = Array.from(supervisores.keys()).sort((a, b) => (parseInt(a, 10) || a) - (parseInt(b, 10) || b));
            const frag = document.createDocumentFragment();
            supList.forEach(sup => {
                const opt = document.createElement('option');
                opt.value = sup;
                opt.textContent = `Supervisor #${sup} (${supervisores.get(sup)} enc.)`;
                frag.appendChild(opt);
            });
            UI.supervisorFilter.appendChild(frag);
            UI.supervisorFilter.value = supervisores.has(actualSup) ? actualSup : 'Todos';
            if (!supervisores.has(actualSup) && actualSup !== 'Todos') AppState.supervisorSeleccionado = 'Todos';
        }

        // 2. Selector Sectores Censales (Universal & Dinámico)
        if (UI.sectorFilter) {
            const actualSec = AppState.sectorSeleccionado || 'Todos';
            UI.sectorFilter.innerHTML = '<option value="Todos">Todos los sectores</option>';
            
            // Usar catálogo canónico único del GeoJSON
            const mapaSectoresUnicos = new Map();
            if (AppState.sectoresGeojson && AppState.sectoresGeojson.features) {
                AppState.sectoresGeojson.features.forEach(f => {
                    const p = f.properties || {};
                    const scNum = String(p.sc || '').trim();
                    const tipologia = String(p.tipologia || '').trim().toUpperCase();
                    const etiqueta = p.etiquetaSC || `${scNum}${tipologia}`;
                    const parroquia = String(p.PARROQUIA || p.parroquia || '').trim();
                    if (scNum && !mapaSectoresUnicos.has(scNum)) {
                        mapaSectoresUnicos.set(scNum, { sc: scNum, etiqueta, parroquia });
                    }
                });
            }

            // Ordenamiento natural de sectores 1..77
            const listaSectores = Array.from(mapaSectoresUnicos.values()).sort((a, b) => {
                return (parseInt(a.sc, 10) || 0) - (parseInt(b.sc, 10) || 0);
            });
            
            const frag = document.createDocumentFragment();
            const sectoresValidos = new Set();

            listaSectores.forEach(item => {
                const count = sectores.get(item.sc) || 0;
                
                // Si hay filtro activo (supervisor, encuestador, parroquia, fecha), SOLO mostrar sectores con encuestas en ese contexto
                if (hayFiltroActivo && count === 0) {
                    return;
                }

                // Si hay filtro de parroquia y no coincide
                if (targetPar && item.parroquia && !item.parroquia.toUpperCase().includes(targetPar) && !targetPar.includes(item.parroquia.toUpperCase()) && count === 0) {
                    return;
                }

                sectoresValidos.add(item.sc);

                const opt = document.createElement('option');
                opt.value = item.sc;
                opt.textContent = count > 0 ? `Sector ${item.etiqueta} (${count})` : `Sector ${item.etiqueta}`;
                opt.title = `Sector ${item.etiqueta}${item.parroquia ? ` — ${item.parroquia}` : ''}${count > 0 ? ` (${count} encuestas)` : ''}`;
                frag.appendChild(opt);
            });
            UI.sectorFilter.appendChild(frag);

            if (actualSec !== 'Todos' && !sectoresValidos.has(actualSec)) {
                AppState.sectorSeleccionado = 'Todos';
                UI.sectorFilter.value = 'Todos';
            } else {
                UI.sectorFilter.value = actualSec;
            }
        }

        // 3. Selector Parroquias
        if (UI.parroquiaFilter) {
            const actualPar = AppState.parroquiaSeleccionada || 'Todas';
            UI.parroquiaFilter.innerHTML = '<option value="Todas">Todas las parroquias</option>';
            const parList = Array.from(parroquias.keys()).sort((a, b) => a.localeCompare(b, 'es'));
            const frag = document.createDocumentFragment();
            parList.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p;
                opt.textContent = `${p} (${parroquias.get(p)} enc.)`;
                frag.appendChild(opt);
            });
            UI.parroquiaFilter.appendChild(frag);
            UI.parroquiaFilter.value = parroquias.has(actualPar) ? actualPar : 'Todas';
            if (!parroquias.has(actualPar) && actualPar !== 'Todas') AppState.parroquiaSeleccionada = 'Todas';
        }

        // 4. Selector Fechas
        if (UI.fechaFilter) {
            const actualFec = AppState.fechaSeleccionada || 'Todas';
            UI.fechaFilter.innerHTML = '<option value="Todas">Otras fechas…</option>';
            const fecList = Array.from(fechas.keys()).sort().reverse();
            const frag = document.createDocumentFragment();
            fecList.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f;
                opt.textContent = `${f} (${fechas.get(f)} enc.)`;
                frag.appendChild(opt);
            });
            UI.fechaFilter.appendChild(frag);
            const isNamedFec = actualFec === 'Todas' || actualFec === 'Hoy' || actualFec === 'Ayer' || actualFec === 'Semana';
            UI.fechaFilter.value = isNamedFec ? 'Todas' : (fechas.has(actualFec) ? actualFec : 'Todas');
            if (!isNamedFec && !fechas.has(actualFec)) AppState.fechaSeleccionada = 'Todas';
        }

        actualizarFiltrosUI();
    }

    function obtenerEncuestasFiltradas() {
        let filtradas = AppState.encuestas || [];
        
        // Filtro por Supervisor
        if (AppState.supervisorSeleccionado !== 'Todos') {
            filtradas = filtradas.filter(e => {
                const sup = String(e.supervisor || e.C_digo_Supervisor || campo(e, AppState.config.campoSupervisor) || '');
                return sup === AppState.supervisorSeleccionado;
            });
        }

        // Filtro por Parroquia
        if (AppState.parroquiaSeleccionada !== 'Todas') {
            const target = AppState.parroquiaSeleccionada.toUpperCase();
            filtradas = filtradas.filter(e => {
                const p = obtenerParroquiaEncuesta(e).toUpperCase();
                return p.includes(target) || target.includes(p);
            });
        }

        // Filtro por Sector Censal
        if (AppState.sectorSeleccionado !== 'Todos') {
            const targetSC = AppState.sectorSeleccionado;
            filtradas = filtradas.filter(e => {
                const sc = String(e.sc || campo(e, 'sc') || '');
                const tip = String(e.tipologia || campo(e, 'tipologia') || '').toUpperCase();
                const etiq = `${sc}${tip}`;
                return sc === targetSC || etiq === targetSC;
            });
        }

        // Filtro por Fecha (Compatible con 'Hoy', 'Ayer', 'Semana' y fecha específica YYYY-MM-DD)
        if (AppState.fechaSeleccionada !== 'Todas') {
            const hoyObj = new Date();
            const hoyStr = hoyObj.toISOString().split('T')[0];
            const ayerStr = new Date(hoyObj.getTime() - 86400000).toISOString().split('T')[0];
            const haceSieteDiasStr = new Date(hoyObj.getTime() - 7 * 86400000).toISOString().split('T')[0];

            filtradas = filtradas.filter(e => {
                const fec = e._submission_time ? e._submission_time.substring(0, 10) : '';
                if (!fec) return false;

                if (AppState.fechaSeleccionada === 'Hoy') {
                    return fec === hoyStr;
                } else if (AppState.fechaSeleccionada === 'Ayer') {
                    return fec === ayerStr;
                } else if (AppState.fechaSeleccionada === 'Semana') {
                    return fec >= haceSieteDiasStr && fec <= hoyStr;
                } else {
                    return fec === AppState.fechaSeleccionada;
                }
            });
        }

        // Filtro por Encuestador seleccionado en tabla
        if (AppState.encuestadorSeleccionado) {
            filtradas = filtradas.filter(e => {
                const enc = String(e.encuestador || e.C_digo_encuestador || campo(e, AppState.config.campoEncuestador) || '');
                return enc === AppState.encuestadorSeleccionado;
            });
        }

        return filtradas;
    }

    function renderizarVista(actualizarSelects = false, ajustarCamara = false) {
        if (actualizarSelects) {
            poblarFiltros();
        } else {
            actualizarFiltrosUI();
        }
        actualizarPoligonosMapa(ajustarCamara);
        const encuestas = obtenerEncuestasFiltradas();
        actualizarKPIs(encuestas);
        actualizarMapa(encuestas, ajustarCamara && AppState.sectorSeleccionado === 'Todos' && AppState.parroquiaSeleccionada === 'Todas');
        actualizarLeyendaMapa(encuestas);
        actualizarTabla(encuestas);
        actualizarClaseZoom();
    }

    // =========================================================================
    // KPIS
    // =========================================================================
    function actualizarKPIs(encuestas) {
        const total = encuestas.length;
        const meta = AppState.config.metaEncuestas || 2500;
        
        const hoyStr = new Date().toISOString().split('T')[0];
        const hoy = encuestas.filter(e => {
            const fecha = e._submission_time ? e._submission_time.substring(0, 10) : '';
            return fecha === hoyStr;
        }).length;
        
        const pendientes = Math.max(0, meta - total);
        const avancePorcentaje = ((total / meta) * 100).toFixed(1);

        animarNumero(UI.kpiTotal, total);
        animarNumero(UI.kpiHoy, hoy);
        animarNumero(UI.kpiPendientes, pendientes);
        
        if (UI.kpiAvance) UI.kpiAvance.textContent = `${avancePorcentaje}%`;
        if (UI.barraAvance) UI.barraAvance.style.width = `${Math.min(100, parseFloat(avancePorcentaje))}%`;
    }

    function animarNumero(elemento, valorFinal) {
        if (!elemento) return;
        const valorInicial = parseInt(elemento.textContent.replace(/[^\d]/g, ''), 10) || 0;
        if (valorInicial === valorFinal) {
            elemento.textContent = valorFinal.toLocaleString();
            return;
        }
        const duracion = 350;
        const inicio = performance.now();

        function frame(ahora) {
            const progreso = Math.min((ahora - inicio) / duracion, 1);
            const easeOut = 1 - (1 - progreso) * (1 - progreso);
            const actual = Math.round(valorInicial + (valorFinal - valorInicial) * easeOut);
            elemento.textContent = actual.toLocaleString();
            if (progreso < 1) {
                requestAnimationFrame(frame);
            } else {
                elemento.textContent = valorFinal.toLocaleString();
            }
        }
        requestAnimationFrame(frame);
    }

    // =========================================================================
    // MAPA WEBGL MAPLIBRE (Aceleración GPU 100% Nativa - Cero Glitches)
    // =========================================================================
    async function inicializarMapa() {
        if (!UI.mapContainer || !window.maplibregl) return;

        // Pre-cargar ambos GeoJSONs antes de crear el mapa
        // Esto elimina cualquier condición de carrera con las capas WebGL
        let sectoresData = { type: 'FeatureCollection', features: [] };
        let parroquiasData = { type: 'FeatureCollection', features: [] };

        try {
            const [resSec, resPar] = await Promise.all([
                fetch('assets/sectores_censales.geojson'),
                fetch('assets/parroquias.geojson')
            ]);
            if (resSec.ok) sectoresData = await resSec.json();
            if (resPar.ok) parroquiasData = await resPar.json();
        } catch (e) {
            console.warn('[Mapa] Error pre-cargando GeoJSONs:', e);
        }

        // Enriquecer sectores con etiquetaSC, bbox y centroid único
        const centroidesFeatures = [];
        if (sectoresData.features) {
            sectoresData.features.forEach(f => {
                const p = f.properties || {};
                const sc = String(p.sc || '').trim();
                const tipologia = String(p.tipologia || '').trim().toUpperCase();
                f.properties.etiquetaSC = sc ? `${sc}${tipologia}` : tipologia;
                if (f.geometry) {
                    const bbox = calcularBBOX(f.geometry);
                    f.properties._bbox_w = bbox[0][0];
                    f.properties._bbox_s = bbox[0][1];
                    f.properties._bbox_e = bbox[1][0];
                    f.properties._bbox_n = bbox[1][1];
                    const cx = (bbox[0][0] + bbox[1][0]) / 2;
                    const cy = (bbox[0][1] + bbox[1][1]) / 2;
                    f.properties._cx = cx;
                    f.properties._cy = cy;
                    f.properties.centroid = [cx, cy];
                    if (sc) {
                        AppState.sectoresMap.set(sc, f.properties);
                        AppState.sectoresMap.set(f.properties.etiquetaSC, f.properties);
                        const n = parseInt(sc, 10);
                        if (!isNaN(n)) AppState.sectoresMap.set(String(n), f.properties);
                    }
                    centroidesFeatures.push({
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: [cx, cy]
                        },
                        properties: {
                            sc: sc,
                            tipologia: tipologia,
                            etiquetaSC: f.properties.etiquetaSC,
                            parroquia: p.PARROQUIA || p.parroquia || ''
                        }
                    });
                }
            });
            AppState.sectoresGeojson = sectoresData;
            AppState.sectoresCentroidesGeojson = {
                type: 'FeatureCollection',
                features: centroidesFeatures
            };
        }

        // Enriquecer parroquias con bbox
        if (parroquiasData.features) {
            parroquiasData.features.forEach(f => {
                const p = f.properties || {};
                const nombre = (p.nombre || p.PARROQUIA || p.name || '').toUpperCase();
                if (f.geometry) f.properties.bbox = calcularBBOX(f.geometry);
                if (nombre) AppState.parroquiasMap.set(nombre, f);
            });
            AppState.parroquiasGeojson = parroquiasData;
            poblarFiltroParroquias(parroquiasData.features.map(f => ({
                nombre: f.properties.nombre || f.properties.PARROQUIA || f.properties.name || '',
                tipo: f.properties.ESTADO || 'Parroquia',
                canton: f.properties.CANTON || 'Cuenca',
                cod: f.properties.CODPAR || ''
            })));
        }

        // Crear el mapa con sectores y parroquias YA incluidos en el estilo
        map = new maplibregl.Map({
            container: 'map',
            fadeDuration: 0,
            maxTileCacheSize: 60,
            preserveDrawingBuffer: false,
            antialias: false,
            trackResize: true,
            failIfMajorPerformanceCaveat: false,
            style: {
                version: 8,
                glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
                sources: {
                    'esri-tiles': {
                        type: 'raster',
                        tiles: [
                            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
                            'https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'
                        ],
                        tileSize: 256,
                        attribution: '&copy; Esri &mdash; OpenStreetMap &amp; Clima Social'
                    },
                    'parroquias-source': {
                        type: 'geojson',
                        data: parroquiasData
                    },
                    'sectores-source': {
                        type: 'geojson',
                        data: sectoresData
                    },
                    'sectores-centroides-source': {
                        type: 'geojson',
                        data: AppState.sectoresCentroidesGeojson || { type: 'FeatureCollection', features: [] }
                    }
                },
                layers: [
                    {
                        id: 'esri-layer',
                        type: 'raster',
                        source: 'esri-tiles',
                        minzoom: 0,
                        maxzoom: 19
                    },
                    {
                        id: 'parroquias-fill',
                        type: 'fill',
                        source: 'parroquias-source',
                        paint: {
                            'fill-color': '#8b5cf6',
                            'fill-opacity': 0.0
                        }
                    },
                    {
                        id: 'parroquias-line',
                        type: 'line',
                        source: 'parroquias-source',
                        paint: {
                            'line-color': '#7c3aed',
                            'line-width': 1.5,
                            'line-opacity': 0.65
                        }
                    },
                    {
                        id: 'sectores-fill',
                        type: 'fill',
                        source: 'sectores-source',
                        paint: {
                            'fill-color': '#028090',
                            'fill-opacity': 0.18
                        }
                    },
                    {
                        id: 'sectores-line',
                        type: 'line',
                        source: 'sectores-source',
                        paint: {
                            'line-color': '#028090',
                            'line-width': [
                                'interpolate', ['linear'], ['zoom'],
                                10, 2.5,
                                14, 4.0,
                                17, 6.0
                            ],
                            'line-opacity': 1.0
                        }
                    },
                    {
                        id: 'sectores-label',
                        type: 'symbol',
                        source: 'sectores-centroides-source',
                        layout: {
                            'text-field': ['get', 'etiquetaSC'],
                            'text-font': ['Open Sans Bold'],
                            'text-size': [
                                'interpolate', ['linear'], ['zoom'],
                                10, 13,
                                13, 17,
                                16, 26
                            ],
                            'text-anchor': 'center',
                            'text-allow-overlap': true,
                            'text-ignore-placement': true,
                            'visibility': AppState.mostrarEtiquetas ? 'visible' : 'none'
                        },
                        paint: {
                            'text-color': '#9a3412',
                            'text-halo-color': '#ffffff',
                            'text-halo-width': 4.5
                        }
                    }
                ]
            },
            center: [-78.9983, -2.9334],
            zoom: 12.0,
            minZoom: 8,
            maxZoom: 19,
            interactive: true,
            dragPan: true,
            scrollZoom: true,
            boxZoom: true,
            dragRotate: false,
            keyboard: true,
            doubleClickZoom: true,
            touchZoomRotate: true,
            touchPitch: false,
            cooperativeGestures: false
        });

        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
        window.map = map;

        // Asegurar gestos de navegación y paneo activos en todos los dispositivos
        try {
            if (map.dragPan) map.dragPan.enable();
            if (map.touchZoomRotate) map.touchZoomRotate.enable();
            if (map.scrollZoom) map.scrollZoom.enable();
            if (map.doubleClickZoom) map.doubleClickZoom.enable();
        } catch (err) {
            console.warn('[Map Gestures]', err);
        }

        // ResizeObserver para sincronización automática e instantánea del canvas en cualquier cambio de tamaño
        const mapContainer = document.getElementById('map');
        if (window.ResizeObserver && mapContainer) {
            const ro = new ResizeObserver(() => {
                if (map) map.resize();
            });
            ro.observe(mapContainer);
        }

        map.on('error', (e) => {
            console.warn('[MapLibre Error]', e);
        });

        map.on('load', () => {
            AppState.mapLoaded = true;
            configurarCapasWebGL();
            renderizarVista(false, false);
            // Cascade de resizes para corregir canvas en Android Chrome/tablets
            [50, 150, 300, 600, 1200, 2500].forEach(ms =>
                setTimeout(() => { if (map) map.resize(); }, ms)
            );
        });

        // Un resize adicional justo cuando el mapa termina de pintar todas las tiles
        map.on('idle', () => {
            if (map) map.resize();
        });

        // pageshow: captura el Back/Forward Cache de iOS Safari y Chrome Android
        window.addEventListener('pageshow', (e) => {
            if (map) setTimeout(() => map.resize(), 100);
        });

        window.addEventListener('resize', () => {
            if (map) map.resize();
        });
        window.addEventListener('orientationchange', () => {
            setTimeout(() => { if (map) map.resize(); }, 200);
            setTimeout(() => { if (map) map.resize(); }, 600);
        });
    }

    function configurarCapasWebGL() {
        if (!map || !map.isStyleLoaded()) return;

        if (AppState.parroquiasGeojson && map.getSource('parroquias-source')) {
            map.getSource('parroquias-source').setData(AppState.parroquiasGeojson);
        }
        if (AppState.sectoresGeojson && map.getSource('sectores-source')) {
            map.getSource('sectores-source').setData(AppState.sectoresGeojson);
        }
        if (AppState.sectoresCentroidesGeojson && map.getSource('sectores-centroides-source')) {
            map.getSource('sectores-centroides-source').setData(AppState.sectoresCentroidesGeojson);
        }

        // 3. Capas de Encuestas: Puntos Individuales y Etiquetas
        if (!map.getSource('encuestas-puntos-source')) {
            map.addSource('encuestas-puntos-source', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
                cluster: false
            });

            // 1. Círculos de Puntos Individuales (Coloreados por Supervisor)
            map.addLayer({
                id: 'puntos-layer',
                type: 'circle',
                source: 'encuestas-puntos-source',
                paint: {
                    'circle-color': [
                        'match',
                        ['get', 'supervisor'],
                        '1', '#028090',
                        '2', '#e11d48',
                        '3', '#d97706',
                        '4', '#7c3aed',
                        '5', '#059669',
                        '6', '#2563eb',
                        '7', '#ea580c',
                        '#f26419'
                    ],
                    'circle-radius': [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        10, 10.0,
                        13, 12.5,
                        16, 15.5
                    ],
                    'circle-stroke-width': 2.0,
                    'circle-stroke-color': '#ffffff',
                    'circle-opacity': 1.0
                }
            });

            // 2. Capa de Etiquetas de Encuestador (Centrada exactamente dentro del círculo)
            map.addLayer({
                id: 'puntos-label-layer',
                type: 'symbol',
                source: 'encuestas-puntos-source',
                layout: {
                    'text-field': ['to-string', ['get', 'encuestador']],
                    'text-font': ['Open Sans Bold'],
                    'text-size': [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        10, 10.0,
                        13, 12.0,
                        16, 14.5
                    ],
                    'text-offset': [0, 0],
                    'text-anchor': 'center',
                    'text-allow-overlap': true,
                    'text-ignore-placement': true,
                    'visibility': AppState.mostrarEtiquetas ? 'visible' : 'none'
                },
                paint: {
                    'text-color': '#ffffff',
                    'text-halo-color': 'rgba(0, 0, 0, 0.95)',
                    'text-halo-width': 1.6
                }
            });

            // 3. Capa de Micro-Etiquetas de Sector y Tipología de la Encuesta (Discreta, arriba del punto)
            map.addLayer({
                id: 'puntos-micro-label-layer',
                type: 'symbol',
                source: 'encuestas-puntos-source',
                layout: {
                    'text-field': ['get', 'microEtiqueta'],
                    'text-font': ['Open Sans Bold'],
                    'text-size': [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        11, 9.5,
                        14, 11.5,
                        17, 13.5
                    ],
                    'text-offset': [0, -1.35],
                    'text-anchor': 'bottom',
                    'text-allow-overlap': false,
                    'text-optional': true,
                    'visibility': AppState.mostrarEtiquetas ? 'visible' : 'none'
                },
                paint: {
                    'text-color': '#0f172a',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 2.5,
                    'text-halo-blur': 0.3
                }
            });
        }

        // =====================================================================
        // EVENTOS E INTERACTIVIDAD WEBGL
        // =====================================================================
        // Clic en Sector Censal
        map.on('click', 'sectores-fill', (e) => {
            if (!e.features || !e.features.length) return;
            const p = e.features[0].properties;
            const sc = String(p.sc || p.codigo_sc || '').trim();
            const etiqueta = p.etiquetaSC || `${p.sc || ''}${p.tipologia || ''}`;
            const coords = e.lngLat;
            const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}`;

            if (sc && UI.sectorFilter) {
                AppState.sectorSeleccionado = sc;
                UI.sectorFilter.value = sc;
                renderizarVista(true, true);
            }

            new maplibregl.Popup({ offset: [0, -10], closeButton: true })
                .setLngLat(coords)
                .setHTML(`
                    <div style="font-family:'Inter',sans-serif;padding:3px;min-width:170px;text-align:center;">
                        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-weight:800;font-size:0.92rem;color:#0f172a;margin-bottom:6px;">
                            Sector Censal <strong>${etiqueta}</strong>
                        </div>
                        <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" class="cs-btn-gmaps" style="display:inline-flex;justify-content:center;width:100%;margin-top:2px;">
                            <svg class="cs-icon" style="width:13px;height:13px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                            Cómo llegar (Google Maps)
                        </a>
                    </div>
                `)
                .addTo(map);
        });

        // Manejador común de popup para puntos de encuesta
        const abrirPopupEncuesta = (e) => {
            if (!e.features || !e.features.length) return;
            const p = e.features[0].properties;
            const coords = e.features[0].geometry.coordinates;
            const colorPunto = PALETA_SUPERVISORES[p.supervisor] || PALETA_SUPERVISORES.default;

            let distInfo = '';
            if (AppState.ubicacionSupervisor) {
                const d = calcularDistancia(AppState.ubicacionSupervisor.lat, AppState.ubicacionSupervisor.lng, coords[1], coords[0]);
                distInfo = `<p style="margin:4px 0;font-size:0.8rem;color:#028090;"><strong>A ${d.toFixed(2)} km de tu ubicación</strong></p>`;
            }

            new maplibregl.Popup({ offset: [0, -10], closeButton: true })
                .setLngLat(coords)
                .setHTML(`
                    <div style="font-family:'Inter',sans-serif;min-width:180px;padding:2px;">
                        <div style="background:${colorPunto};color:#fff;padding:6px 10px;border-radius:6px 6px 0 0;margin:-14px -14px 8px -14px;font-weight:700;font-size:0.85rem;display:flex;justify-content:space-between;">
                            <span>Encuestador #${p.encuestador}</span>
                            <span>Sup #${p.supervisor}</span>
                        </div>
                        <p style="margin:4px 0;font-size:0.8rem;"><strong>Parroquia:</strong> ${p.parroquia}</p>
                        ${p.sc ? `<p style="margin:4px 0;font-size:0.8rem;"><strong>Sector Censal:</strong> ${p.sc}${p.tipologia ? ` (Tipología ${p.tipologia})` : ''}</p>` : ''}
                        ${p.barrio ? `<p style="margin:4px 0;font-size:0.8rem;"><strong>Barrio:</strong> ${p.barrio}</p>` : ''}
                        <p style="margin:4px 0;font-size:0.75rem;color:#64748b;">Fecha: ${p.fecha}</p>
                        ${distInfo}
                    </div>
                `)
                .addTo(map);
        };

        map.on('click', 'puntos-layer', abrirPopupEncuesta);

        // Cursores
        map.on('mouseenter', 'sectores-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'sectores-fill', () => { map.getCanvas().style.cursor = ''; });
        map.on('mouseenter', 'puntos-layer', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'puntos-layer', () => { map.getCanvas().style.cursor = ''; });

        actualizarPoligonosMapa(false);
    }

    function actualizarClaseZoom() {
        if (!map || !AppState.mapLoaded) return;
        const show = AppState.mostrarEtiquetas ? 'visible' : 'none';

        if (map.getLayer('puntos-label-layer')) {
            map.setLayoutProperty('puntos-label-layer', 'visibility', show);
        }
        if (map.getLayer('puntos-micro-label-layer')) {
            map.setLayoutProperty('puntos-micro-label-layer', 'visibility', show);
        }
        if (map.getLayer('sectores-label')) {
            map.setLayoutProperty('sectores-label', 'visibility', show);
        }
    }

    // Calcula los límites [ [minLng, minLat], [maxLng, maxLat] ] de una geometría GeoJSON
    function calcularBBOX(geometry) {
        let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
        function procesarCoords(coords) {
            if (typeof coords[0] === 'number') {
                const lng = coords[0], lat = coords[1];
                if (lng < minLng) minLng = lng;
                if (lat < minLat) minLat = lat;
                if (lng > maxLng) maxLng = lng;
                if (lat > maxLat) maxLat = lat;
            } else {
                for (let i = 0; i < coords.length; i++) {
                    procesarCoords(coords[i]);
                }
            }
        }
        procesarCoords(geometry.coordinates);
        return [[minLng, minLat], [maxLng, maxLat]];
    }

    async function cargarLimitesParroquiales() {
        try {
            if (AppState.parroquiasGeojson && AppState.parroquiasGeojson.features && AppState.parroquiasGeojson.features.length > 0) {
                return; // Ya cargado en inicializarMapa
            }
            const res = await fetch('assets/parroquias.geojson');
            if (!res.ok) return;
            const geojsonData = await res.json();

            AppState.parroquiasGeojson = geojsonData;
            AppState.parroquiasMap.clear();
            const listaParroquias = [];

            if (geojsonData.features) {
                geojsonData.features.forEach(f => {
                    const p = f.properties || {};
                    const nombre = p.nombre || p.PARROQUIA || p.name || 'Parroquia';
                    const canton = p.CANTON || 'Cuenca';
                    const tipo = p.ESTADO || 'Rural';
                    const cod = p.CODPAR || '';

                    listaParroquias.push({ nombre, canton, tipo, cod });
                    const bbox = f.geometry ? calcularBBOX(f.geometry) : null;
                    AppState.parroquiasMap.set(nombre.toUpperCase(), { feature: f, bbox });
                });
            }

            poblarFiltroParroquias(listaParroquias);
            configurarCapasWebGL();
            actualizarPoligonosMapa(false);
        } catch (e) {
            console.warn('No se pudo cargar la capa de límites parroquiales:', e);
        }
    }

    async function cargarSectoresCensales() {
        try {
            if (AppState.sectoresGeojson && AppState.sectoresGeojson.features && AppState.sectoresGeojson.features.length > 0) {
                return; // Ya cargado en inicializarMapa
            }
            const res = await fetch('assets/sectores_censales.geojson');
            if (!res.ok) return;
            const geojsonData = await res.json();

            AppState.sectoresGeojson = geojsonData;
            AppState.sectoresMap.clear();

            if (geojsonData.features) {
                geojsonData.features.forEach(f => {
                    const p = f.properties || {};
                    const sc = String(p.sc || p.codigo_sc || p.sc_cuenca_sc || '').trim();
                    const tipologia = String(p.tipologia || p.tipologia_sc || '').trim().toUpperCase();
                    const etiquetaSC = sc ? `${sc}${tipologia}` : tipologia;
                    f.properties.etiquetaSC = etiquetaSC;

                    let bbox = null;
                    let centroid = null;
                    if (f.geometry) {
                        bbox = calcularBBOX(f.geometry);
                        centroid = [(bbox[0][0] + bbox[1][0]) / 2, (bbox[0][1] + bbox[1][1]) / 2];
                    }

                    const meta = { feature: f, bbox, centroid, etiquetaSC };
                    if (sc) {
                        AppState.sectoresMap.set(sc, meta);
                        const numSc = parseInt(sc, 10);
                        if (!isNaN(numSc)) AppState.sectoresMap.set(String(numSc), meta);
                        AppState.sectoresMap.set(etiquetaSC, meta);
                    }
                });
            }

            configurarCapasWebGL();
            actualizarPoligonosMapa(false);
        } catch (e) {
            console.warn('No se pudo cargar la capa de sectores censales:', e);
        }
    }

    function poblarFiltroParroquias(lista) {
        if (!UI.parroquiaFilter) return;
        const actual = AppState.parroquiaSeleccionada || 'Todas';
        UI.parroquiaFilter.innerHTML = '<option value="Todas">Todas</option>';

        // Ordenar alfabéticamente
        lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.nombre;
            opt.textContent = `${p.nombre} (${p.tipo})`;
            UI.parroquiaFilter.appendChild(opt);
        });

        UI.parroquiaFilter.value = actual;
    }

    function seleccionarParroquia(nombre) {
        AppState.parroquiaSeleccionada = nombre;
        if (UI.parroquiaFilter) UI.parroquiaFilter.value = nombre;
        renderizarVista(true, true);
    }

    function actualizarPoligonosMapa(ajustarCamara = false) {
        if (!map) return;

        // 1. Polígonos de Parroquias
        if (map.getLayer('parroquias-fill') && map.getLayer('parroquias-line')) {
            if (AppState.parroquiaSeleccionada === 'Todas') {
                map.setPaintProperty('parroquias-fill', 'fill-opacity', 0.0);
                map.setPaintProperty('parroquias-line', 'line-width', 1.5);
                map.setPaintProperty('parroquias-line', 'line-opacity', 0.7);
                map.setPaintProperty('parroquias-line', 'line-color', '#7c3aed');
            } else {
                const targetNom = AppState.parroquiaSeleccionada.toUpperCase();
                map.setPaintProperty('parroquias-fill', 'fill-opacity', [
                    'case',
                    ['==', ['upcase', ['coalesce', ['get', 'nombre'], ['get', 'PARROQUIA'], ['get', 'name'], '']], targetNom],
                    0.16,
                    0.0
                ]);
                map.setPaintProperty('parroquias-line', 'line-width', [
                    'case',
                    ['==', ['upcase', ['coalesce', ['get', 'nombre'], ['get', 'PARROQUIA'], ['get', 'name'], '']], targetNom],
                    3.5,
                    0.4
                ]);

                if (ajustarCamara && AppState.sectorSeleccionado === 'Todos') {
                    const featMeta = AppState.parroquiasMap.get(targetNom);
                    const bbox = featMeta ? (featMeta.bbox || (featMeta.feature && featMeta.feature.properties && featMeta.feature.properties.bbox)) : null;
                    if (bbox) {
                        map.fitBounds(bbox, {
                            padding: { top: 70, bottom: 50, left: 50, right: 50 },
                            maxZoom: 15,
                            duration: 1000
                        });
                    }
                }
            }
        }

        // 2. Polígonos de Sectores Censales y Barra Flotante
        const barraSector = document.getElementById('barraSectorActivo');
        const sectorTitulo = document.getElementById('sectorActivoTitulo');
        const btnGmaps = document.getElementById('btnRutaGoogleMaps');

        if (map.getLayer('sectores-fill') && map.getLayer('sectores-line') && map.getLayer('sectores-label')) {
            const isTodos = (AppState.sectorSeleccionado === 'Todos');
            const targetSC = String(AppState.sectorSeleccionado).trim();

            if (isTodos) {
                // Mostrar todos los sectores censales con bordes ámbar/naranja de alto contraste
                map.setFilter('sectores-fill', null);
                map.setLayoutProperty('sectores-fill', 'visibility', 'visible');
                map.setPaintProperty('sectores-fill', 'fill-color', '#f59e0b');
                map.setPaintProperty('sectores-fill', 'fill-opacity', 0.15);

                map.setFilter('sectores-line', null);
                map.setLayoutProperty('sectores-line', 'visibility', 'visible');
                map.setPaintProperty('sectores-line', 'line-color', '#d97706');
                map.setPaintProperty('sectores-line', 'line-width', [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 2.0,
                    13, 3.2,
                    16, 5.0
                ]);
                map.setPaintProperty('sectores-line', 'line-opacity', 1.0);

                map.setFilter('sectores-label', null);
                map.setLayoutProperty('sectores-label', 'visibility', AppState.mostrarEtiquetas ? 'visible' : 'none');
                map.setLayoutProperty('sectores-label', 'text-size', [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 12,
                    13, 16,
                    16, 24
                ]);
                map.setPaintProperty('sectores-label', 'text-color', '#9a3412');
                map.setPaintProperty('sectores-label', 'text-halo-color', '#ffffff');
                map.setPaintProperty('sectores-label', 'text-halo-width', 4.5);

                if (barraSector) barraSector.style.display = 'none';
            } else {
                // FILTRAR Y DESTACAR ÚNICAMENTE EL SECTOR SELECCIONADO
                const filterSC = ['==', ['to-string', ['get', 'sc']], targetSC];

                map.setFilter('sectores-fill', filterSC);
                map.setPaintProperty('sectores-fill', 'fill-color', '#ea580c');
                map.setPaintProperty('sectores-fill', 'fill-opacity', 0.30);

                map.setFilter('sectores-line', filterSC);
                map.setPaintProperty('sectores-line', 'line-color', '#c2410c');
                map.setPaintProperty('sectores-line', 'line-width', 5.0);
                map.setPaintProperty('sectores-line', 'line-opacity', 1.0);

                map.setFilter('sectores-label', filterSC);
                map.setLayoutProperty('sectores-label', 'visibility', AppState.mostrarEtiquetas ? 'visible' : 'none');
                map.setLayoutProperty('sectores-label', 'text-size', [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    12, 18,
                    15, 26,
                    17, 34
                ]);
                map.setPaintProperty('sectores-label', 'text-color', '#9a3412');
                map.setPaintProperty('sectores-label', 'text-halo-color', '#ffffff');
                map.setPaintProperty('sectores-label', 'text-halo-width', 5.0);

                const sectorMeta = AppState.sectoresMap.get(targetSC) || (parseInt(targetSC, 10) ? AppState.sectoresMap.get(String(parseInt(targetSC, 10))) : null);
                if (sectorMeta) {
                    const etiqueta = sectorMeta.etiquetaSC || targetSC;
                    const centroid = sectorMeta.centroid;
                    const bbox = sectorMeta.bbox;

                    if (barraSector && sectorTitulo && btnGmaps && centroid) {
                        sectorTitulo.textContent = `Sector ${etiqueta}`;
                        btnGmaps.href = `https://www.google.com/maps/dir/?api=1&destination=${centroid[1].toFixed(6)},${centroid[0].toFixed(6)}`;
                        barraSector.style.display = 'flex';
                    }

                    if (ajustarCamara && bbox) {
                        map.fitBounds(bbox, {
                            padding: { top: 80, bottom: 60, left: 60, right: 60 },
                            maxZoom: 16,
                            duration: 1000
                        });
                    }
                } else if (barraSector) {
                    barraSector.style.display = 'none';
                }
            }
        }
    }

    function actualizarMapa(encuestas, ajustarCamara = false) {
        if (!map) return;

        let conGeo = 0;
        let sinGeo = 0;
        const features = [];
        let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;

        for (let i = 0; i < encuestas.length; i++) {
            const enc = encuestas[i];
            const coords = extraerCoordenadas(enc);
            
            if (!coords) {
                sinGeo++;
                continue;
            }

            conGeo++;

            if (AppState.filtroGPS === 'SinGPS') continue;

            const [lat, lng] = coords;
            if (lng < minLng) minLng = lng;
            if (lat < minLat) minLat = lat;
            if (lng > maxLng) maxLng = lng;
            if (lat > maxLat) maxLat = lat;

            const encuestador = enc.encuestador || enc.C_digo_encuestador || campo(enc, AppState.config.campoEncuestador) || 'N/A';
            const supervisor = String(enc.supervisor || enc.C_digo_Supervisor || campo(enc, AppState.config.campoSupervisor) || 'N/A');
            const sc = enc.sc || campo(enc, 'sc') || '';
            const tipologiaRaw = enc.tipologia || campo(enc, 'tipologia') || campo(enc, 'TIPOLOGIA') || '';
            const tipologia = String(tipologiaRaw).trim().toUpperCase();

            let microEtiqueta = '';
            if (sc !== undefined && sc !== null && String(sc).trim() !== '') {
                microEtiqueta = `${sc}${tipologia}`;
            } else if (tipologia) {
                microEtiqueta = tipologia;
            }

            const parroquia = obtenerParroquiaEncuesta(enc) || 'Cuenca';
            const barrio = enc.barrio || campo(enc, 'BARRIO_O_SECTOR') || campo(enc, 'barrio');
            const fecha = enc._submission_time ? enc._submission_time.replace('T', ' ').substring(0, 19) : 'Sin fecha';

            features.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [lng, lat]
                },
                properties: {
                    encuestador,
                    supervisor,
                    sc,
                    tipologia,
                    microEtiqueta,
                    parroquia,
                    barrio,
                    fecha
                }
            });
        }

        const geojsonFC = {
            type: 'FeatureCollection',
            features: features
        };

        const srcPuntos = map.getSource('encuestas-puntos-source');
        if (srcPuntos) srcPuntos.setData(geojsonFC);

        const showLabels = AppState.mostrarEtiquetas ? 'visible' : 'none';

        if (map.getLayer('puntos-layer')) {
            map.setLayoutProperty('puntos-layer', 'visibility', 'visible');
        }
        if (map.getLayer('puntos-label-layer')) {
            map.setLayoutProperty('puntos-label-layer', 'visibility', showLabels);
        }
        if (map.getLayer('puntos-micro-label-layer')) {
            map.setLayoutProperty('puntos-micro-label-layer', 'visibility', showLabels);
        }
        if (map.getLayer('sectores-label')) {
            map.setLayoutProperty('sectores-label', 'visibility', showLabels);
        }

        if (UI.mapStats) {
            UI.mapStats.innerHTML = `<strong>${conGeo.toLocaleString()}</strong> encuestas mapeadas`;
        }

        // Auto-centrar cámara si se solicitó explícitamente
        if (ajustarCamara && features.length > 0 && !AppState.ubicacionSupervisor) {
            // Filtrar outliers extremos para que 1 encuesta de prueba en Quito no aleje el mapa de Cuenca
            const cuencaPoints = features.filter(f => {
                const [lng, lat] = f.geometry.coordinates;
                return lat >= -3.3 && lat <= -2.5 && lng >= -79.5 && lng <= -78.7;
            });
            const pts = cuencaPoints.length > 0 ? cuencaPoints : features;
            let bMinLng = Infinity, bMinLat = Infinity, bMaxLng = -Infinity, bMaxLat = -Infinity;
            pts.forEach(f => {
                const [lng, lat] = f.geometry.coordinates;
                if (lng < bMinLng) bMinLng = lng;
                if (lat < bMinLat) bMinLat = lat;
                if (lng > bMaxLng) bMaxLng = lng;
                if (lat > bMaxLat) bMaxLat = lat;
            });
            if (bMinLng !== Infinity) {
                map.fitBounds([[bMinLng, bMinLat], [bMaxLng, bMaxLat]], {
                    padding: 50,
                    maxZoom: 15,
                    duration: 1000
                });
            }
        }
    }

    // =========================================================================
    // GEOLOCALIZACIÓN DEL SUPERVISOR
    // =========================================================================
    function localizarSupervisor() {
        if (!navigator.geolocation) {
            mostrarToast('Geolocalización no compatible con tu navegador', 'error');
            return;
        }

        mostrarToast('Obteniendo tu ubicación GPS…', 'info');

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                AppState.ubicacionSupervisor = { lat, lng };

                if (map) {
                    map.flyTo({ center: [lng, lat], zoom: 15 });

                    if (!AppState.markerSupervisor) {
                        const el = document.createElement('div');
                        el.className = 'cs-gps-user';
                        el.innerHTML = `<div style="background:#f26419;width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 12px #f26419;animation:cs-pulse 1.5s infinite;"></div>`;

                        AppState.markerSupervisor = new maplibregl.Marker({ element: el })
                            .setLngLat([lng, lat])
                            .setPopup(new maplibregl.Popup({ offset: [0, -10] }).setHTML('<strong>📍 Tu ubicación actual</strong>'))
                            .addTo(map);
                    } else {
                        AppState.markerSupervisor.setLngLat([lng, lat]);
                    }
                }

                mostrarToast('Ubicación fijada ✓', 'success');
                renderizarVista();
            },
            (err) => {
                console.error(err);
                mostrarToast('No se pudo obtener el GPS. Verifica los permisos.', 'error');
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }

    // =========================================================================
    // LEYENDA DINÁMICA DE SUPERVISORES EN EL MAPA
    // =========================================================================
    function actualizarLeyendaMapa(encuestas) {
        if (!UI.mapLegend || !UI.mapLegendItems) return;

        if (!encuestas || encuestas.length === 0) {
            UI.mapLegend.style.display = 'none';
            return;
        }

        const conteoSupervisores = new Map();
        encuestas.forEach(e => {
            const sup = String(e.supervisor || e.C_digo_Supervisor || campo(e, AppState.config.campoSupervisor) || '').trim();
            if (sup && sup !== '98') {
                conteoSupervisores.set(sup, (conteoSupervisores.get(sup) || 0) + 1);
            }
        });

        if (conteoSupervisores.size === 0) {
            UI.mapLegend.style.display = 'none';
            return;
        }

        UI.mapLegend.style.display = 'block';
        UI.mapLegendItems.innerHTML = '';

        const supIds = Array.from(conteoSupervisores.keys()).sort((a, b) => {
            const numA = parseInt(a, 10);
            const numB = parseInt(b, 10);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            return a.localeCompare(b, undefined, { numeric: true });
        });

        const frag = document.createDocumentFragment();
        supIds.forEach(supId => {
            const color = PALETA_SUPERVISORES[supId] || PALETA_SUPERVISORES.default;
            const total = conteoSupervisores.get(supId);
            const item = document.createElement('div');
            item.className = 'cs-map-legend__item';
            item.title = `Supervisor #${supId}: ${total} encuestas`;
            item.innerHTML = `
                <span class="cs-legend-color-dot" style="background-color:${color};"></span>
                <span>Sup #${supId}</span>
                <span class="cs-legend-count">${total}</span>
            `;
            frag.appendChild(item);
        });

        UI.mapLegendItems.appendChild(frag);
    }

    // =========================================================================
    // TABLA DE RENDIMIENTO POR ENCUESTADOR & MÉTRICAS DE TIEMPO
    // =========================================================================
    function formatearMinutos(m) {
        if (m === null || isNaN(m) || m <= 0) return '-';
        if (m < 1) return `${Math.round(m * 60)}s`;
        if (m >= 60) {
            const h = Math.floor(m / 60);
            const rem = Math.round(m % 60);
            return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
        }
        return m % 1 === 0 ? `${m}m` : `${m.toFixed(1)}m`;
    }

    function agruparPorEncuestador(encuestas) {
        const grupos = new Map();
        const total = encuestas.length;

        for (let i = 0; i < total; i++) {
            const enc = encuestas[i];
            const codEnc = String(enc.encuestador || enc.C_digo_encuestador || campo(enc, AppState.config.campoEncuestador) || 'Sin asignar');
            const codSup = String(enc.supervisor || enc.C_digo_Supervisor || campo(enc, AppState.config.campoSupervisor) || '').trim();
            if (codEnc === '98' || codSup === '98') continue;

            let g = grupos.get(codEnc);
            if (!g) {
                const supVal = enc.supervisor || enc.C_digo_Supervisor || campo(enc, AppState.config.campoSupervisor) || '';
                g = {
                    id: codEnc,
                    encuestas: [],
                    duraciones: [],
                    totalMins: 0,
                    supervisor: String(supVal).trim(),
                    promStr: 'Sin datos',
                    minStr: '-',
                    maxStr: '-'
                };
                grupos.set(codEnc, g);
            } else if (!g.supervisor) {
                const supVal = enc.supervisor || enc.C_digo_Supervisor || campo(enc, AppState.config.campoSupervisor) || '';
                if (supVal) g.supervisor = String(supVal).trim();
            }

            g.encuestas.push(enc);

            // Duración por encuesta (filtrando outliers <30s o >3h)
            const s = enc.start;
            const end = enc.end;
            if (s && end) {
                const d1 = new Date(s).getTime();
                const d2 = new Date(end).getTime();
                if (!isNaN(d1) && !isNaN(d2) && d2 > d1) {
                    const diff = (d2 - d1) / 60000;
                    if (diff >= 0.5 && diff <= 180) {
                        g.totalMins += diff;
                        g.duraciones.push(diff);
                    }
                }
            }
        }

        const resultado = [];
        for (const g of grupos.values()) {
            if (g.duraciones.length > 0) {
                const prom = g.totalMins / g.duraciones.length;
                const min = Math.min(...g.duraciones);
                const max = Math.max(...g.duraciones);
                g.promStr = formatearMinutos(prom);
                g.minStr = formatearMinutos(min);
                g.maxStr = formatearMinutos(max);
            }
            resultado.push(g);
        }

        return resultado;
    }

    function actualizarTabla(encuestas) {
        if (!UI.tablaEncuestadoresBody) return;

        let datos = agruparPorEncuestador(encuestas);

        // Búsqueda en vivo
        if (AppState.filtroTabla) {
            const term = AppState.filtroTabla.toLowerCase();
            datos = datos.filter(g => g.id.toLowerCase().includes(term) || (g.supervisor && g.supervisor.toLowerCase().includes(term)));
        }

        UI.tablaEncuestadoresBody.innerHTML = '';

        if (datos.length === 0) {
            if (UI.emptyState) UI.emptyState.style.display = 'flex';
            return;
        }

        if (UI.emptyState) UI.emptyState.style.display = 'none';

        // 1. Agrupar por Supervisor
        const gruposSupervisor = new Map();
        datos.forEach(encuestador => {
            const supId = (encuestador.supervisor && encuestador.supervisor !== 'undefined' && encuestador.supervisor !== 'null') 
                ? encuestador.supervisor 
                : 'Sin asignar';
            if (!gruposSupervisor.has(supId)) {
                gruposSupervisor.set(supId, {
                    id: supId,
                    encuestadores: [],
                    totalEncuestas: 0
                });
            }
            const gSup = gruposSupervisor.get(supId);
            gSup.encuestadores.push(encuestador);
            gSup.totalEncuestas += encuestador.encuestas.length;
        });

        // 2. Ordenar Supervisores numéricamente (1, 2, 3... y 'Sin asignar' al final)
        const supKeys = Array.from(gruposSupervisor.keys()).sort((a, b) => {
            if (a === 'Sin asignar') return 1;
            if (b === 'Sin asignar') return -1;
            const numA = parseInt(a, 10);
            const numB = parseInt(b, 10);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        });

        // 3. Ordenar encuestadores dentro de cada supervisor
        supKeys.forEach(supId => {
            const gSup = gruposSupervisor.get(supId);
            gSup.encuestadores.sort((a, b) => {
                if (AppState.ordenTabla.columna === 'encuestas') {
                    const diff = a.encuestas.length - b.encuestas.length;
                    return AppState.ordenTabla.asc ? diff : -diff;
                } else {
                    const numA = parseInt(a.id, 10);
                    const numB = parseInt(b.id, 10);
                    if (!isNaN(numA) && !isNaN(numB)) {
                        return AppState.ordenTabla.asc ? (numA - numB) : (numB - numA);
                    }
                    const cmp = String(a.id).localeCompare(String(b.id), undefined, { numeric: true, sensitivity: 'base' });
                    return AppState.ordenTabla.asc ? cmp : -cmp;
                }
            });
        });

        const fragment = document.createDocumentFragment();

        // 4. Renderizar grupos de supervisores y sus encuestadores
        supKeys.forEach(supId => {
            const gSup = gruposSupervisor.get(supId);
            const colorSupervisor = PALETA_SUPERVISORES[supId] || PALETA_SUPERVISORES.default;
            const isExplicitlyExpanded = AppState.supervisoresExpandidos && AppState.supervisoresExpandidos.has(supId);
            const isFilteredSup = AppState.supervisorSeleccionado !== 'Todos' && AppState.supervisorSeleccionado === supId;
            const hasSearch = Boolean(AppState.filtroTabla);
            const isExpanded = isExplicitlyExpanded || isFilteredSup || hasSearch;
            const isCollapsed = !isExpanded;

            // Fila de encabezado de grupo (Supervisor)
            const trHeader = document.createElement('tr');
            trHeader.className = `cs-table-group-header ${isCollapsed ? 'is-collapsed' : ''}`;
            trHeader.dataset.supId = supId;

            const supLabel = supId === 'Sin asignar' ? 'Sin Supervisor' : `Supervisor #${supId}`;
            const pluralEnc = gSup.encuestadores.length === 1 ? 'encuestador' : 'encuestadores';
            const pluralEncuestas = gSup.totalEncuestas === 1 ? 'encuesta' : 'encuestas';

            trHeader.innerHTML = `
                <td colspan="2">
                    <div class="cs-table-group-title">
                        <span class="cs-group-toggle-icon">
                            <svg class="cs-group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                        </span>
                        <span class="cs-group-color-dot" style="--sup-dot-color: ${colorSupervisor};"></span>
                        <span class="cs-group-name">${supLabel}</span>
                        <span class="cs-group-pill">${gSup.encuestadores.length} ${pluralEnc} · ${gSup.totalEncuestas} ${pluralEncuestas}</span>
                    </div>
                </td>
            `;

            trHeader.addEventListener('click', () => {
                if (!AppState.supervisoresExpandidos) AppState.supervisoresExpandidos = new Set();
                if (AppState.supervisoresExpandidos.has(supId)) {
                    AppState.supervisoresExpandidos.delete(supId);
                } else {
                    AppState.supervisoresExpandidos.add(supId);
                }
                const encs = obtenerEncuestasFiltradas();
                actualizarTabla(encs);
            });

            fragment.appendChild(trHeader);

            // Filas de encuestadores del supervisor (si no está colapsado)
            if (!isCollapsed) {
                gSup.encuestadores.forEach(grupo => {
                    const tr = document.createElement('tr');
                    tr.className = 'cs-enc-row';
                    if (AppState.encuestadorSeleccionado === grupo.id) {
                        tr.classList.add('selected');
                    }

                    tr.innerHTML = `
                        <td>
                            <div class="cs-enc-card">
                                <div class="cs-enc-avatar" style="--enc-color:${colorSupervisor};">
                                    <svg style="width:12px;height:12px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                                </div>
                                <div class="cs-enc-meta">
                                    <div class="cs-enc-name" title="Encuestador #${grupo.id} (Sup #${supId})">Encuestador #${grupo.id}</div>
                                    <div class="cs-enc-sub">
                                        <span class="cs-time-tag cs-time-tag--avg" title="Tiempo promedio por encuesta">⏱️ ${grupo.promStr}</span>
                                        <span class="cs-time-tag cs-time-tag--min" title="Tiempo mínimo registrado">⬇️ ${grupo.minStr}</span>
                                        <span class="cs-time-tag cs-time-tag--max" title="Tiempo máximo registrado">⬆️ ${grupo.maxStr}</span>
                                    </div>
                                </div>
                            </div>
                        </td>
                        <td style="text-align:right;">
                            <span class="cs-enc-total-pill" title="Total de encuestas recolectadas">${grupo.encuestas.length}</span>
                        </td>
                    `;

                    tr.addEventListener('click', (e) => {
                        e.stopPropagation();
                        seleccionarEncuestador(grupo.id);
                    });

                    fragment.appendChild(tr);
                });
            }
        });

        UI.tablaEncuestadoresBody.appendChild(fragment);
    }

    function seleccionarEncuestador(id) {
        if (AppState.encuestadorSeleccionado === id) {
            AppState.encuestadorSeleccionado = null;
            mostrarToast('Mostrando todo el equipo', 'info');
            renderizarVista(true, true);
            return;
        }

        AppState.encuestadorSeleccionado = id;

        // Auto-adaptar filtros a este encuestador
        const encuestasDelEnc = AppState.encuestas.filter(e => {
            const cod = String(e.encuestador || e.C_digo_encuestador || campo(e, AppState.config.campoEncuestador) || '');
            return cod === String(id);
        });

        let supId = '';
        const coords = [];
        encuestasDelEnc.forEach(e => {
            const sup = String(e.supervisor || e.C_digo_Supervisor || campo(e, AppState.config.campoSupervisor) || '');
            if (sup && !supId) supId = sup;
            const c = extraerCoordenadas(e);
            if (c) coords.push(c);
        });

        if (supId && UI.supervisorFilter) {
            AppState.supervisorSeleccionado = supId;
            UI.supervisorFilter.value = supId;
        }

        mostrarToast(`Encuestador #${id} (Sup #${supId || 'S/N'}) · ${encuestasDelEnc.length} encuestas`, 'info');
        renderizarVista(true, false);

        // Enfocar mapa a sus puntos
        if (coords.length > 0 && map) {
            let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
            coords.forEach(([lat, lng]) => {
                if (lng < minLng) minLng = lng;
                if (lat < minLat) minLat = lat;
                if (lng > maxLng) maxLng = lng;
                if (lat > maxLat) maxLat = lat;
            });

            if (minLng !== Infinity) {
                if (minLng === maxLng && minLat === maxLat) {
                    map.flyTo({ center: [minLng, minLat], zoom: 15, duration: 700 });
                } else {
                    map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
                        padding: { top: 50, bottom: 50, left: 50, right: 50 },
                        maxZoom: 16,
                        duration: 700
                    });
                }
            }
        }
    }

    // =========================================================================
    // EVENTOS Y CONTROLES
    // =========================================================================
    function configurarEventos() {
        // 1. Filtro Supervisor
        if (UI.supervisorFilter) {
            UI.supervisorFilter.addEventListener('change', (e) => {
                AppState.supervisorSeleccionado = e.target.value;
                if (AppState.encuestadorSeleccionado) {
                    const enc = AppState.encuestas.find(x => {
                        const cod = String(x.encuestador || x.C_digo_encuestador || campo(x, AppState.config.campoEncuestador) || '');
                        return cod === String(AppState.encuestadorSeleccionado);
                    });
                    const sup = enc ? String(enc.supervisor || enc.C_digo_Supervisor || campo(enc, AppState.config.campoSupervisor) || '') : '';
                    if (AppState.supervisorSeleccionado !== 'Todos' && sup !== AppState.supervisorSeleccionado) {
                        AppState.encuestadorSeleccionado = null;
                    }
                }
                renderizarVista(true, true);
            });
        }

        // 2. Filtro Parroquia
        if (UI.parroquiaFilter) {
            UI.parroquiaFilter.addEventListener('change', (e) => {
                seleccionarParroquia(e.target.value);
            });
        }

        // 3. Filtro Sector Censal
        if (UI.sectorFilter) {
            UI.sectorFilter.addEventListener('change', (e) => {
                AppState.sectorSeleccionado = e.target.value;
                renderizarVista(true, true);
            });
        }

        // 4. Filtro Fecha (Dropdown)
        if (UI.fechaFilter) {
            UI.fechaFilter.addEventListener('change', (e) => {
                AppState.fechaSeleccionada = e.target.value;
                renderizarVista(true, true);
            });
        }

        // 4.1 Filtro Rápido de Fecha (Pills: Todas, Hoy, Ayer, Semana)
        const datePills = document.querySelectorAll('#datePills .cs-date-pill');
        if (datePills && datePills.length > 0) {
            datePills.forEach(pill => {
                pill.addEventListener('click', () => {
                    const filterVal = pill.dataset.dateFilter;
                    AppState.fechaSeleccionada = filterVal;
                    if (UI.fechaFilter) {
                        UI.fechaFilter.value = 'Todas';
                    }
                    renderizarVista(true, true);
                });
            });
        }

        // 5. Limpiar Filtros
        if (UI.btnLimpiarFiltros) {
            UI.btnLimpiarFiltros.addEventListener('click', () => {
                AppState.supervisorSeleccionado = 'Todos';
                AppState.sectorSeleccionado = 'Todos';
                AppState.parroquiaSeleccionada = 'Todas';
                AppState.fechaSeleccionada = 'Todas';
                AppState.encuestadorSeleccionado = null;
                AppState.mostrarEtiquetas = false;
                AppState.filtroTabla = '';
                if (UI.btnEtiquetasOn) UI.btnEtiquetasOn.classList.remove('active');
                if (UI.btnEtiquetasOff) UI.btnEtiquetasOff.classList.add('active');
                if (UI.searchInput) UI.searchInput.value = '';

                // Restaurar vista y polígonos del mapa
                if (map) {
                    map.easeTo({ center: [-79.004, -2.900], zoom: 12 });
                }

                poblarFiltros();
                renderizarVista(false);
                mostrarToast('Filtros restablecidos', 'info');
            });
        }

        // 5. Conmutador de Etiquetas: Mostrar vs Ocultar
        if (UI.btnEtiquetasOn && UI.btnEtiquetasOff) {
            UI.btnEtiquetasOn.addEventListener('click', () => {
                AppState.mostrarEtiquetas = true;
                UI.btnEtiquetasOn.classList.add('active');
                UI.btnEtiquetasOff.classList.remove('active');
                actualizarClaseZoom();
                mostrarToast('Etiquetas visibles en el mapa', 'info');
            });

            UI.btnEtiquetasOff.addEventListener('click', () => {
                AppState.mostrarEtiquetas = false;
                UI.btnEtiquetasOff.classList.add('active');
                UI.btnEtiquetasOn.classList.remove('active');
                actualizarClaseZoom();
                mostrarToast('Etiquetas ocultadas', 'info');
            });
        }

        // 6. Búsqueda en tabla (con debounce de 100ms para móviles)
        if (UI.searchInput) {
            let searchTimeout = null;
            UI.searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    AppState.filtroTabla = e.target.value.trim();
                    const encuestas = obtenerEncuestasFiltradas();
                    actualizarTabla(encuestas);
                }, 100);
            });
        }

        // 7. Ordenamiento de tabla
        if (UI.headersTabla) {
            UI.headersTabla.forEach(th => {
                th.addEventListener('click', () => {
                    const col = th.dataset.sort;
                    if (!col) return;
                    if (AppState.ordenTabla.columna === col) {
                        AppState.ordenTabla.asc = !AppState.ordenTabla.asc;
                    } else {
                        AppState.ordenTabla.columna = col;
                        AppState.ordenTabla.asc = false;
                    }
                    const encuestas = obtenerEncuestasFiltradas();
                    actualizarTabla(encuestas);
                });
            });
        }

        // 8. Botón GPS Localizar
        if (UI.locateBtn) {
            UI.locateBtn.addEventListener('click', localizarSupervisor);
        }

        // 10. Sincronizar con Kobo
        if (UI.botonSync) {
            UI.botonSync.addEventListener('click', async () => {
                mostrarToast('Sincronizando con KoboToolbox…', 'info');
                try {
                    await fetch('/api/sync', { method: 'POST' });
                    await cargarDatos(false);
                    mostrarToast('Datos sincronizados ✓', 'success');
                } catch (e) {
                    await cargarDatos(false);
                }
            });
        }

        // 11. Modo Oscuro
        if (UI.botonModoOscuro) {
            UI.botonModoOscuro.addEventListener('click', () => {
                document.body.classList.toggle('modo-oscuro');
                const isDark = document.body.classList.contains('modo-oscuro');
                localStorage.setItem('modo_oscuro', isDark ? 'true' : 'false');
            });
        }

        // 12. Drawer cerrar
        if (UI.drawerClose) UI.drawerClose.addEventListener('click', cerrarDrawer);
        if (UI.drawerOverlay) UI.drawerOverlay.addEventListener('click', cerrarDrawer);

        // 13. Reintentar
        if (UI.botonReintentar) {
            UI.botonReintentar.addEventListener('click', () => cargarDatos(true));
        }
    }

    function iniciarReloj() {
        const actualizar = () => {
            const ahora = new Date();
            if (UI.hora) {
                UI.hora.textContent = ahora.toLocaleTimeString('es-EC');
            }
            if (UI.fecha) {
                UI.fecha.textContent = ahora.toLocaleDateString('es-EC', { 
                    weekday: 'short', 
                    day: 'numeric', 
                    month: 'short' 
                });
            }
        };
        actualizar();
        setInterval(actualizar, 1000);
    }

    function configurarModoOscuro() {
        if (localStorage.getItem('modo_oscuro') === 'true') {
            document.body.classList.add('modo-oscuro');
        }
    }

    function mostrarToast(mensaje, tipo = 'info') {
        if (!UI.toast) return;
        UI.toast.textContent = mensaje;
        UI.toast.className = `cs-toast show ${tipo}`;
        setTimeout(() => {
            UI.toast.classList.remove('show');
        }, 3000);
    }

    function mostrarError(mensaje) {
        if (UI.errorBanner) {
            UI.errorBanner.style.display = 'flex';
        }
    }

    function ocultarError() {
        if (UI.errorBanner) {
            UI.errorBanner.style.display = 'none';
        }
    }

    window.filtrarPorParroquia = seleccionarParroquia;

    // Iniciar aplicación
    inicializar();
});
