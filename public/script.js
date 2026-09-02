/**
 * Supervisor de Campo — Clima Social
 * Frontend Logic: Layout 2 Columnas, Filtros Cruzados (Sector, Supervisor, Fecha), 
 * Modo Puntos Individuales vs Clusters y Seguimiento en Tiempo Real.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Normalizador universal de texto (remueve tildes, diacríticos y espacios)
    const normTexto = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();

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
        circunscripcionSeleccionada: 'Todas',
        sectorSeleccionado: 'Todos',
        parroquiaSeleccionada: 'Todas',
        fechaSeleccionada: 'Todas',
        encuestadorSeleccionado: null,
        mostrarEtiquetas: false,
        capasVisibles: {
            muestreo: true,
            llegada: true,
            sectores: true,
            circunscripciones: true
        },
        filtroGPS: 'Todos', // 'Todos', 'ConGPS', 'SinGPS'
        filtroTabla: '',
        modoVisualizacion: 'puntos', // 'puntos' | 'cluster'
        ordenTabla: { columna: 'encuestador', asc: true },
        supervisoresExpandidos: new Set(),
        ubicacionSupervisor: null,
        markerSupervisor: null,
        mapLoaded: false,
        circunscripcionesGeojson: null,
        parroquiasGeojson: null,
        parroquiasMap: new Map(),
        sectoresGeojson: null,
        sectoresMap: new Map(),
        puntosLlegadaGeojson: null,
        puntosMuestreoGeojson: null
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
        circunscripcionFilter: document.getElementById('circunscripcionFilter'),
        sectorFilter: document.getElementById('sectorFilter'),
        parroquiaFilter: document.getElementById('parroquiaFilter'),
        fechaFilter: document.getElementById('fechaFilter'),
        datePills: document.querySelectorAll('#datePills .cs-date-pill'),
        btnLimpiarFiltros: document.getElementById('btnLimpiarFiltros'),
        txtLimpiarFiltros: document.getElementById('txtLimpiarFiltros'),
        activeFilterChipsWrap: document.getElementById('activeFilterChipsWrap'),
        activeFilterChips: document.getElementById('activeFilterChips'),
        
        // Mapa, Capas y Modos
        mapContainer: document.getElementById('map'),
        mapLegend: document.getElementById('mapLegend'),
        mapLegendItems: document.getElementById('mapLegendItems'),
        locateBtn: document.getElementById('locateBtn'),
        btnEtiquetasOn: document.getElementById('btnEtiquetasOn'),
        btnEtiquetasOff: document.getElementById('btnEtiquetasOff'),
        mapStats: document.getElementById('mapStats'),
        toggleMuestreo: document.getElementById('toggleMuestreo'),
        toggleLlegada: document.getElementById('toggleLlegada'),
        toggleSectores: document.getElementById('toggleSectores'),
        toggleCircunscripciones: document.getElementById('toggleCircunscripciones'),
        
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
        // 1. Diccionario dinámico generado a partir del GeoJSON cargado
        if (AppState.diccionarioParroquias && AppState.diccionarioParroquias[strVal]) {
            return AppState.diccionarioParroquias[strVal];
        }
        // 2. Fallbacks estáticos
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

        // 1. Limpieza de caché previa y Boot Instantáneo Machala 2026
        try {
            if (localStorage.getItem('cs_encuestas_cache')) {
                localStorage.removeItem('cs_encuestas_cache');
            }
            const cached = localStorage.getItem('cs_encuestas_machala_v1');
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
            poblarFiltros();
            renderizarVista(false, false);

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
            const res = await fetch('/api/config', { cache: 'no-store' });
            if (res.ok) {
                const configData = await res.json();
                AppState.config = { ...AppState.config, ...configData };
            }
            if (UI.tituloProyecto) {
                let nom = AppState.config.nombreProyecto || 'Encuesta Cantonal Machala 2026';
                if (nom.toLowerCase().includes('cuenca')) {
                    nom = 'Encuesta Cantonal Machala 2026';
                    AppState.config.nombreProyecto = nom;
                }
                UI.tituloProyecto.textContent = nom;
                document.title = 'Clima Social · ' + nom;
            }
            if (UI.kpiMeta) {
                UI.kpiMeta.textContent = `Meta: ${(AppState.config.metaEncuestas || 0).toLocaleString()}`;
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
            const res = await fetch('/api/encuestas', { cache: 'no-store' });
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
                localStorage.setItem('cs_encuestas_machala_v1', JSON.stringify(AppState.encuestas));
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
        if (UI.circunscripcionFilter) {
            const isAct = AppState.circunscripcionSeleccionada !== 'Todas';
            UI.circunscripcionFilter.classList.toggle('is-active', isAct);
            if (isAct) {
                activeCount++;
                chips.push({
                    tipo: 'circunscripcion',
                    label: `Circunscripción: ${AppState.circunscripcionSeleccionada}`,
                    onClear: () => {
                        AppState.circunscripcionSeleccionada = 'Todas';
                        if (UI.circunscripcionFilter) UI.circunscripcionFilter.value = 'Todas';
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
                const secMeta = AppState.sectoresMap.get(AppState.sectorSeleccionado);
                const isPM = secMeta && secMeta.esPuntoMuestreo;
                const chipLbl = isPM ? `Punto #${AppState.sectorSeleccionado}` : `Sector: ${AppState.sectorSeleccionado}`;
                chips.push({
                    tipo: 'sector',
                    label: chipLbl,
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

        const encuestas = AppState.encuestas || [];
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

        const PARROQUIAS_POR_CIRCUNSCRIPCION = {
            'Circunscripción 1': ['PUERTO BOLIVAR', 'MACHALA', 'JUBONES', 'JAMBELI'],
            'Circunscripción 2': ['EL CAMBIO', '9 DE MAYO', 'LA PROVIDENCIA']
        };

        // 1.1 Selector Circunscripción
        if (UI.circunscripcionFilter) {
            const actualCirc = AppState.circunscripcionSeleccionada || 'Todas';
            UI.circunscripcionFilter.innerHTML = `
                <option value="Todas">Todas las circunscripciones</option>
                <option value="Circunscripción 1">Circunscripción 1 (Urbana)</option>
                <option value="Circunscripción 2">Circunscripción 2 (Urbana)</option>
            `;
            // Limpiar si tenía Zona Rural seleccionada
            UI.circunscripcionFilter.value = (actualCirc === 'Zona Rural') ? 'Todas' : actualCirc;
            if (actualCirc === 'Zona Rural') AppState.circunscripcionSeleccionada = 'Todas';
        }

        // 2. Selector Unificado de Muestra Territorial (Sectores Censales y Puntos de Muestreo: 1 al 70)
        if (UI.sectorFilter) {
            const actualSec = AppState.sectorSeleccionado || 'Todos';
            UI.sectorFilter.innerHTML = '<option value="Todos">Todos (1 al 70)</option>';
            
            // Catálogo unificado de 1 al 70 proveniente de sectores y puntos de muestreo
            const mapaMuestraUnica = new Map();
            const parActivaNorm = (AppState.parroquiaSeleccionada !== 'Todas') ? normTexto(AppState.parroquiaSeleccionada) : null;

            // 1. Sectores Censales (Polígonos: Códigos 1..15 y 41..52)
            if (AppState.sectoresGeojson && AppState.sectoresGeojson.features) {
                AppState.sectoresGeojson.features.forEach(f => {
                    const p = f.properties || {};
                    const scNum = String(p.codigo_muestra || p.sc || '').trim();
                    const tipologia = String(p.tipologia || '').trim().toUpperCase();
                    const etiqueta = p.etiquetaSC || `${scNum}${tipologia}`;
                    const parroquia = String(p.parroquia || p.parroquia_especifica || p.nom_par || p.PARROQUIA || '').trim();
                    const ref = p.punto_referencial || '';

                    if (parActivaNorm && parroquia) {
                        const pNorm = normTexto(parroquia);
                        if (!pNorm.includes(parActivaNorm) && !parActivaNorm.includes(pNorm)) {
                            return;
                        }
                    }

                    if (scNum && !mapaMuestraUnica.has(scNum)) {
                        mapaMuestraUnica.set(scNum, {
                            sc: scNum,
                            tipo: 'Sector',
                            etiqueta: `Sector ${etiqueta}`,
                            detalle: ref ? `Sector ${etiqueta} — ${ref}` : `Sector ${etiqueta}`,
                            parroquia: parroquia
                        });
                    }
                });
            }

            // 2. Puntos de Muestreo (Puntos: Códigos 16..40 y 53..70)
            if (AppState.puntosMuestreoGeojson && AppState.puntosMuestreoGeojson.features) {
                AppState.puntosMuestreoGeojson.features.forEach(f => {
                    const p = f.properties || {};
                    const codNum = String(p.codigo_muestra || '').trim();
                    const tipologia = String(p.tipologia || '').trim().toUpperCase();
                    const etiqueta = `${codNum}${tipologia}`;
                    const parroquia = String(p.parroquia || '').trim();
                    const nombrePto = p.nombre_acortado || p.nombre_referencia || '';

                    if (parActivaNorm && parroquia) {
                        const pNorm = normTexto(parroquia);
                        if (!pNorm.includes(parActivaNorm) && !parActivaNorm.includes(pNorm)) {
                            return;
                        }
                    }

                    if (codNum && !mapaMuestraUnica.has(codNum)) {
                        mapaMuestraUnica.set(codNum, {
                            sc: codNum,
                            tipo: 'Muestreo',
                            etiqueta: `Pto. ${codNum} (${tipologia})`,
                            detalle: nombrePto ? `Pto. ${codNum} (${tipologia}) — ${nombrePto}` : `Pto. ${codNum} (${tipologia})`,
                            parroquia: parroquia
                        });
                    }
                });
            }

            // Ordenamiento natural numérico exacto del 1 al 70
            const listaMuestra = Array.from(mapaMuestraUnica.values()).sort((a, b) => {
                return (parseInt(a.sc, 10) || 0) - (parseInt(b.sc, 10) || 0);
            });
            
            const frag = document.createDocumentFragment();
            const sectoresValidos = new Set();

            listaMuestra.forEach(item => {
                const count = sectores.get(item.sc) || 0;
                
                // Si hay filtro activo de encuestas, SOLO mostrar ítems con encuestas en ese contexto
                if (hayFiltroActivo && count === 0 && AppState.encuestas.length > 0) {
                    return;
                }

                const normStr = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();

                // Filtrar por Circunscripción si está activa
                if (AppState.circunscripcionSeleccionada !== 'Todas' && item.parroquia) {
                    const permitidas = PARROQUIAS_POR_CIRCUNSCRIPCION[AppState.circunscripcionSeleccionada] || [];
                    const nItem = normStr(item.parroquia);
                    const match = permitidas.some(p => {
                        const nP = normStr(p);
                        return nItem.includes(nP) || nP.includes(nItem);
                    });
                    if (!match) return;
                }

                // Si hay filtro de parroquia y no coincide
                if (targetPar && item.parroquia) {
                    const nItem = normStr(item.parroquia);
                    const nTarget = normStr(targetPar);
                    if (!nItem.includes(nTarget) && !nTarget.includes(nItem)) {
                        return;
                    }
                }

                sectoresValidos.add(item.sc);

                const opt = document.createElement('option');
                opt.value = item.sc;
                opt.textContent = count > 0 ? `${item.detalle} (${count} enc.)` : item.detalle;
                opt.title = `${item.detalle}${item.parroquia ? ` [${item.parroquia}]` : ''}${count > 0 ? ` (${count} encuestas)` : ''}`;
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

        // 3. Selector Parroquias (Filtrado en cascada por Circunscripción)
        if (UI.parroquiaFilter) {
            const actualPar = AppState.parroquiaSeleccionada || 'Todas';
            UI.parroquiaFilter.innerHTML = '<option value="Todas">Todas las parroquias</option>';
            const normStr = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
            
            let parList = [];
            if (AppState.parroquiasGeojson && AppState.parroquiasGeojson.features) {
                AppState.parroquiasGeojson.features.forEach(f => {
                    const p = (f.properties.nombre || f.properties.PARROQUIA || f.properties.name || '').toUpperCase();
                    if (p && !parList.includes(p)) parList.push(p);
                });
            }
            if (parList.length === 0) {
                parList = Array.from(parroquias.keys());
            }

            // Filtrar por sector seleccionado si está activo (Cascada Sector ➔ Parroquia)
            if (AppState.sectorSeleccionado !== 'Todos') {
                const targetSC = String(AppState.sectorSeleccionado).trim();
                const secMeta = AppState.sectoresMap.get(targetSC) || (parseInt(targetSC, 10) ? AppState.sectoresMap.get(String(parseInt(targetSC, 10))) : null);
                const parSector = secMeta ? String(secMeta.parroquia || secMeta.parroquia_especifica || secMeta.nom_par || secMeta.PARROQUIA || '').trim() : '';
                if (parSector) {
                    const normParSec = normStr(parSector);
                    const parEncontrada = parList.find(p => normStr(p).includes(normParSec) || normParSec.includes(normStr(p)));
                    if (parEncontrada) {
                        parList = [parEncontrada];
                    }
                }
            } else if (AppState.circunscripcionSeleccionada !== 'Todas') {
                // Filtrar por circunscripción si está activa y no hay sector puntual
                const permitidas = PARROQUIAS_POR_CIRCUNSCRIPCION[AppState.circunscripcionSeleccionada] || [];
                parList = parList.filter(p => {
                    const nP = normStr(p);
                    return permitidas.some(pp => {
                        const nPP = normStr(pp);
                        return nP.includes(nPP) || nPP.includes(nP);
                    });
                });
            }

            parList.sort((a, b) => a.localeCompare(b, 'es'));
            const frag = document.createDocumentFragment();
            parList.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p;
                const count = parroquias.get(p) || 0;
                opt.textContent = count > 0 ? `${p} (${count} enc.)` : p;
                frag.appendChild(opt);
            });
            UI.parroquiaFilter.appendChild(frag);
            UI.parroquiaFilter.value = parList.includes(actualPar) ? actualPar : 'Todas';
            if (!parList.includes(actualPar) && actualPar !== 'Todas') AppState.parroquiaSeleccionada = 'Todas';
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

        // Filtro por Circunscripción
        if (AppState.circunscripcionSeleccionada !== 'Todas') {
            const PARROQUIAS_POR_CIRCUNSCRIPCION = {
                'Circunscripción 1': ['PUERTO BOLIVAR', 'MACHALA', 'JUBONES', 'JAMBELI'],
                'Circunscripción 2': ['EL CAMBIO', '9 DE MAYO', 'LA PROVIDENCIA']
            };
            const parsPermitidas = PARROQUIAS_POR_CIRCUNSCRIPCION[AppState.circunscripcionSeleccionada] || [];
            const normStr = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
            filtradas = filtradas.filter(e => {
                const nP = normStr(obtenerParroquiaEncuesta(e));
                return parsPermitidas.some(pp => {
                    const nPP = normStr(pp);
                    return nP.includes(nPP) || nPP.includes(nP);
                });
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

        // Pre-cargar GeoJSONs oficiales antes de crear el mapa (Cero Glitches)
        let sectoresData = { type: 'FeatureCollection', features: [] };
        let parroquiasData = { type: 'FeatureCollection', features: [] };
        let circunscripcionesData = { type: 'FeatureCollection', features: [] };
        let puntosLlegadaData = { type: 'FeatureCollection', features: [] };
        let puntosMuestreoData = { type: 'FeatureCollection', features: [] };

        try {
            const cacheBuster = '?v=3.6.0';
            const [resSec, resPar, resCirc, resLleg, resMuest] = await Promise.all([
                fetch('assets/sectores_censales.geojson' + cacheBuster),
                fetch('assets/parroquias.geojson' + cacheBuster),
                fetch('assets/circunscripciones.geojson' + cacheBuster),
                fetch('assets/puntos_llegada.geojson' + cacheBuster),
                fetch('assets/puntos_muestreo.geojson' + cacheBuster)
            ]);
            if (resSec.ok) sectoresData = await resSec.json();
            if (resPar.ok) parroquiasData = await resPar.json();
            if (resCirc.ok) circunscripcionesData = await resCirc.json();
            if (resLleg.ok) puntosLlegadaData = await resLleg.json();
            if (resMuest.ok) puntosMuestreoData = await resMuest.json();
        } catch (e) {
            console.warn('[Mapa] Error pre-cargando GeoJSONs:', e);
        }

        AppState.sectoresGeojson = sectoresData;
        AppState.parroquiasGeojson = parroquiasData;
        AppState.circunscripcionesGeojson = circunscripcionesData;
        AppState.puntosLlegadaGeojson = puntosLlegadaData;
        AppState.puntosMuestreoGeojson = puntosMuestreoData;

        // Puntos únicos representativos para etiquetas de Circunscripción (evita duplicación en MultiPolygons)
        const circunscripcionesLabelsData = {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [-79.9780, -3.2380] // Núcleo urbano despejado Circunscripción 1
                    },
                    properties: {
                        circunscripcion: 'Circunscripción 1',
                        nombre: 'Circunscripción 1'
                    }
                },
                {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [-79.9280, -3.2780] // Núcleo urbano Circunscripción 2
                    },
                    properties: {
                        circunscripcion: 'Circunscripción 2',
                        nombre: 'Circunscripción 2'
                    }
                }
            ]
        };
        AppState.circunscripcionesLabelsGeojson = circunscripcionesLabelsData;

        // Enriquecer Circunscripciones con bbox
        AppState.circunscripcionesMap = new Map();
        if (circunscripcionesData.features) {
            circunscripcionesData.features.forEach(f => {
                const p = f.properties || {};
                const cNom = p.circunscripcion || p.nombre || '';
                if (f.geometry) {
                    const b = calcularBBOX(f.geometry);
                    f.properties.bbox = b;
                    if (cNom) {
                        AppState.circunscripcionesMap.set(cNom, { feature: f, bbox: b });
                    }
                }
            });
        }

        // Enriquecer sectores con etiquetaSC, bbox y centroid único
        const centroidesFeatures = [];
        if (sectoresData.features) {
            sectoresData.features.forEach(f => {
                const p = f.properties || {};
                const sc = String(p.codigo_muestra || p.sc || p.sec_anm || '').trim();
                const tipologia = String(p.tipologia || '').trim().toUpperCase();
                f.properties.sc = sc;
                f.properties.etiquetaSC = sc ? `${sc}${tipologia}` : tipologia;
                const parSector = String(p.parroquia_especifica || p.nom_par || p.PARROQUIA || p.parroquia || '').trim();
                if (parSector) f.properties.parroquia = parSector;
                if (f.geometry) {
                    const bbox = calcularBBOX(f.geometry);
                    f.properties.bbox = bbox;
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
                            parroquia: parSector
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

        // Indexar Puntos de Muestreo (Códigos 16..40 y 53..70) en AppState.puntosMuestreoMap y AppState.sectoresMap
        AppState.puntosMuestreoMap = new Map();
        if (puntosMuestreoData.features) {
            puntosMuestreoData.features.forEach(f => {
                const p = f.properties || {};
                const cod = String(p.codigo_muestra || '').trim();
                const tip = String(p.tipologia || '').trim().toUpperCase();
                const etiq = p.etiqueta_completa || `${cod} - ${tip} | ${p.nombre_referencia || ''}`;
                p.sc = cod;
                p.tipologia = tip;
                p.etiquetaSC = `${cod}${tip}`;
                p.etiqueta_muestra = etiq;
                p.esPuntoMuestreo = true;

                let bbox = null;
                let centroid = null;
                if (f.geometry && f.geometry.coordinates) {
                    const coords = f.geometry.coordinates;
                    centroid = [coords[0], coords[1]];
                    // Pequeño bbox de 0.003 grados (~300m) para encuadre focalizado
                    const delta = 0.0025;
                    bbox = [
                        [coords[0] - delta, coords[1] - delta],
                        [coords[0] + delta, coords[1] + delta]
                    ];
                    p.bbox = bbox;
                    p.centroid = centroid;
                }

                if (cod) {
                    AppState.puntosMuestreoMap.set(cod, p);
                    // También agregar a sectoresMap para cobertura universal de 1 a 70
                    AppState.sectoresMap.set(cod, p);
                    AppState.sectoresMap.set(`${cod}${tip}`, p);
                    const n = parseInt(cod, 10);
                    if (!isNaN(n)) {
                        AppState.puntosMuestreoMap.set(String(n), p);
                        AppState.sectoresMap.set(String(n), p);
                    }
                }
            });
        }

        // Enriquecer parroquias con bbox y construir diccionario dinámico de códigos
        AppState.diccionarioParroquias = AppState.diccionarioParroquias || {};
        AppState.parroquiasMap.clear();
        if (parroquiasData.features) {
            parroquiasData.features.forEach(f => {
                const p = f.properties || {};
                const nombre = (p.nombre || p.PARROQUIA || p.name || '').toUpperCase();
                const cod = p.CODPAR || p.cod || p.codigo || '';
                if (cod && nombre) {
                    AppState.diccionarioParroquias[String(cod).trim()] = nombre;
                    const n = parseInt(cod, 10);
                    if (!isNaN(n)) AppState.diccionarioParroquias[String(n)] = nombre;
                }
                const b = f.geometry ? calcularBBOX(f.geometry) : null;
                f.properties.bbox = b;
                if (nombre) {
                    const meta = { feature: f, bbox: b };
                    AppState.parroquiasMap.set(nombre, meta);
                    AppState.parroquiasMap.set(normTexto(nombre), meta);
                }
            });
            AppState.parroquiasGeojson = parroquiasData;
            poblarFiltros();
        }

        // Actualizar visualización y conteos de botones de capas según datos existentes
        const numMuestreo = (puntosMuestreoData.features || []).length;
        const numLlegada = (puntosLlegadaData.features || []).length;
        const numSectores = (sectoresData.features || []).length;

        if (UI.toggleMuestreo) {
            UI.toggleMuestreo.style.display = numMuestreo > 0 ? 'inline-flex' : 'none';
            const lbl = document.getElementById('lblToggleMuestreo');
            if (lbl) lbl.textContent = `Muestreo (${numMuestreo})`;
        }
        if (UI.toggleLlegada) {
            UI.toggleLlegada.style.display = numLlegada > 0 ? 'inline-flex' : 'none';
            const lbl = document.getElementById('lblToggleLlegada');
            if (lbl) lbl.textContent = `Pts. Referenciales (${numLlegada})`;
        }
        if (UI.toggleSectores) {
            UI.toggleSectores.style.display = numSectores > 0 ? 'inline-flex' : 'none';
            const lbl = document.getElementById('lblToggleSectores');
            if (lbl) lbl.textContent = `Sectores (${numSectores})`;
        }

        // Auto-calcular Bounding Box global y centro del cantón desde los datos vectoriales
        let globalMinX = Infinity, globalMinY = Infinity, globalMaxX = -Infinity, globalMaxY = -Infinity;
        const featuresParaBBox = (sectoresData.features && sectoresData.features.length > 0)
            ? sectoresData.features
            : (parroquiasData.features || []);

        featuresParaBBox.forEach(f => {
            if (f.geometry) {
                const b = calcularBBOX(f.geometry);
                if (b) {
                    if (b[0][0] < globalMinX) globalMinX = b[0][0];
                    if (b[0][1] < globalMinY) globalMinY = b[0][1];
                    if (b[1][0] > globalMaxX) globalMaxX = b[1][0];
                    if (b[1][1] > globalMaxY) globalMaxY = b[1][1];
                }
            }
        });

        let mapCenter = [-79.9554, -3.2581]; // Coordenadas de Machala, El Oro
        let initialBounds = null;
        AppState.cantonBbox = [[-80.05, -3.35], [-79.85, -3.15]]; // BBox preliminar de Machala

        if (globalMinX !== Infinity && globalMaxX !== -Infinity) {
            mapCenter = [(globalMinX + globalMaxX) / 2, (globalMinY + globalMaxY) / 2];
            initialBounds = [[globalMinX, globalMinY], [globalMaxX, globalMaxY]];
            AppState.cantonBbox = initialBounds;
        }

        // Si se especifican coordenadas de centro en la configuración del servidor, tienen prioridad
        if (AppState.config) {
            if (AppState.config.centroLng && AppState.config.centroLat) {
                mapCenter = [AppState.config.centroLng, AppState.config.centroLat];
            }
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
                    'osm-tiles': {
                        type: 'raster',
                        tiles: [
                            'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
                            'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
                            'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
                        ],
                        tileSize: 256,
                        maxzoom: 19,
                        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
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
                    },
                    'circunscripciones-source': {
                        type: 'geojson',
                        data: circunscripcionesData
                    },
                    'circunscripciones-labels-source': {
                        type: 'geojson',
                        data: circunscripcionesLabelsData
                    },
                    'puntos-llegada-source': {
                        type: 'geojson',
                        data: puntosLlegadaData
                    },
                    'puntos-muestreo-source': {
                        type: 'geojson',
                        data: puntosMuestreoData
                    }
                },
                layers: [
                    {
                        id: 'osm-layer',
                        type: 'raster',
                        source: 'osm-tiles',
                        minzoom: 0,
                        maxzoom: 22
                    },
                    // 1. Circunscripciones Urbanas (Límites mayores diferenciados por color)
                    {
                        id: 'circunscripciones-fill',
                        type: 'fill',
                        source: 'circunscripciones-source',
                        paint: {
                            'fill-color': [
                                'match',
                                ['get', 'circunscripcion'],
                                'Circunscripción 1', '#2563eb', // Azul Real Clima Social
                                'Circunscripción 2', '#9333ea', // Púrpura Vibrante
                                '#4f46e5'
                            ],
                            'fill-opacity': 0.08
                        }
                    },
                    {
                        id: 'circunscripciones-line',
                        type: 'line',
                        source: 'circunscripciones-source',
                        paint: {
                            'line-color': [
                                'match',
                                ['get', 'circunscripcion'],
                                'Circunscripción 1', '#1d4ed8', // Azul Real Intenso
                                'Circunscripción 2', '#7e22ce', // Púrpura Intenso
                                '#4f46e5'
                            ],
                            'line-width': 2.8,
                            'line-dasharray': [4, 2],
                            'line-opacity': 0.90
                        }
                    },
                    {
                        id: 'circunscripciones-label',
                        type: 'symbol',
                        source: 'circunscripciones-labels-source',
                        minzoom: 10,
                        maxzoom: 14.5,
                        layout: {
                            'text-field': ['get', 'circunscripcion'],
                            'text-font': ['Open Sans Bold'],
                            'text-size': 13,
                            'text-anchor': 'center'
                        },
                        paint: {
                            'text-color': [
                                'match',
                                ['get', 'circunscripcion'],
                                'Circunscripción 1', '#1e40af',
                                'Circunscripción 2', '#6b21a8',
                                '#1e1b4b'
                            ],
                            'text-halo-color': '#ffffff',
                            'text-halo-width': 4.0
                        }
                    },
                    // 2. Límites Parroquiales
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
                    // 3. Sectores Censales (Polígonos de Muestreo)
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
                    },
                    // 4. Puntos de Llegada / Hitos de Acceso a Sectores (Discretos para no competir)
                    {
                        id: 'puntos-llegada-circle',
                        type: 'circle',
                        source: 'puntos-llegada-source',
                        minzoom: 12.0,
                        paint: {
                            'circle-radius': [
                                'interpolate', ['linear'], ['zoom'],
                                12, 4.5,
                                15, 6.5,
                                18, 9.5
                            ],
                            'circle-color': '#d97706',
                            'circle-stroke-color': '#ffffff',
                            'circle-stroke-width': 1.8,
                            'circle-opacity': 0.9
                        }
                    },
                    {
                        id: 'puntos-llegada-labels',
                        type: 'symbol',
                        source: 'puntos-llegada-source',
                        minzoom: 14.5,
                        layout: {
                            'text-field': ['get', 'nombre_acortado'],
                            'text-font': ['Open Sans Regular'],
                            'text-size': 10.5,
                            'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
                            'text-radial-offset': 0.7,
                            'text-allow-overlap': false
                        },
                        paint: {
                            'text-color': '#78350f',
                            'text-halo-color': '#ffffff',
                            'text-halo-width': 2.5
                        }
                    },
                    // 5. Puntos de Muestreo Oficiales (Símbolo discreto, elegante y profesional)
                    {
                        id: 'puntos-muestreo-halo',
                        type: 'circle',
                        source: 'puntos-muestreo-source',
                        paint: {
                            'circle-radius': [
                                'interpolate', ['linear'], ['zoom'],
                                10, 4.0,
                                13, 5.5,
                                16, 7.5
                            ],
                            'circle-color': '#0d9488', // Teal/Esmeralda sobrio y distinguido
                            'circle-stroke-color': '#ffffff',
                            'circle-stroke-width': 2.0,
                            'circle-opacity': 0.95
                        }
                    },
                    {
                        id: 'puntos-muestreo-dot',
                        type: 'circle',
                        source: 'puntos-muestreo-source',
                        paint: {
                            'circle-radius': [
                                'interpolate', ['linear'], ['zoom'],
                                10, 1.5,
                                13, 2.0,
                                16, 2.8
                            ],
                            'circle-color': '#ffffff'
                        }
                    },
                    {
                        id: 'puntos-muestreo-labels',
                        type: 'symbol',
                        source: 'puntos-muestreo-source',
                        minzoom: 13.0,
                        layout: {
                            'text-field': [
                                'coalesce',
                                ['get', 'etiqueta_completa'],
                                ['get', 'nombre_referencia'],
                                ''
                            ],
                            'text-font': ['Open Sans Bold'],
                            'text-size': 10.5,
                            'text-variable-anchor': ['bottom', 'top', 'right', 'left'],
                            'text-radial-offset': 0.75,
                            'text-allow-overlap': false
                        },
                        paint: {
                            'text-color': '#0f766e',
                            'text-halo-color': '#ffffff',
                            'text-halo-width': 2.5
                        }
                    }
                ]
            },
            center: mapCenter,
            zoom: (AppState.config && AppState.config.zoomInicial) ? AppState.config.zoomInicial : 12.0,
            bounds: initialBounds || undefined,
            fitBoundsOptions: initialBounds ? { padding: 35, maxZoom: 14 } : undefined,
            minZoom: 8,
            maxZoom: 20,
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

        // =====================================================================
        // CONTROLADOR UNIVERSAL DE GESTOS TÁCTILES Y DE RATÓN
        // Garantiza paneo y navegación 100% fluidos en iOS Safari, Android Chrome y PC
        // =====================================================================
        const mapContainer = document.getElementById('map');
        if (mapContainer) {
            let isTouching = false;
            let lastTouchX = 0, lastTouchY = 0;
            let pinchInitialDist = 0;
            let isMouseDown = false;
            let lastMouseX = 0, lastMouseY = 0;

            // --- Soporte Táctil (Móvil / Tablet) ---
            mapContainer.addEventListener('touchstart', (e) => {
                if (e.touches.length === 1) {
                    isTouching = true;
                    lastTouchX = e.touches[0].clientX;
                    lastTouchY = e.touches[0].clientY;
                } else if (e.touches.length === 2) {
                    isTouching = true;
                    pinchInitialDist = Math.hypot(
                        e.touches[0].clientX - e.touches[1].clientX,
                        e.touches[0].clientY - e.touches[1].clientY
                    );
                }
            }, { passive: true });

            mapContainer.addEventListener('touchmove', (e) => {
                if (!isTouching || !map) return;

                // Bloquea estrictamente el scroll vertical del navegador para que MapLibre reciba el gesto
                if (e.cancelable) {
                    e.preventDefault();
                }

                if (e.touches.length === 1) {
                    const curX = e.touches[0].clientX;
                    const curY = e.touches[0].clientY;
                    const dx = curX - lastTouchX;
                    const dy = curY - lastTouchY;

                    // Si el handler interno de MapLibre está pausado por el SO, forzamos paneo directo
                    if (!map.dragPan.isActive()) {
                        map.panBy([-dx, -dy], { duration: 0 });
                    }
                    lastTouchX = curX;
                    lastTouchY = curY;
                } else if (e.touches.length === 2 && pinchInitialDist > 0) {
                    const curDist = Math.hypot(
                        e.touches[0].clientX - e.touches[1].clientX,
                        e.touches[0].clientY - e.touches[1].clientY
                    );
                    const zoomDelta = Math.log2(curDist / pinchInitialDist);
                    if (Math.abs(zoomDelta) > 0.03 && !map.touchZoomRotate.isActive()) {
                        map.setZoom(map.getZoom() + zoomDelta * 0.12);
                        pinchInitialDist = curDist;
                    }
                }
            }, { passive: false });

            const endTouch = () => { isTouching = false; pinchInitialDist = 0; };
            mapContainer.addEventListener('touchend', endTouch, { passive: true });
            mapContainer.addEventListener('touchcancel', endTouch, { passive: true });

            // --- Soporte Ratón / Trackpad (PC / Laptop) ---
            mapContainer.addEventListener('mousedown', (e) => {
                if (e.button === 0) {
                    isMouseDown = true;
                    lastMouseX = e.clientX;
                    lastMouseY = e.clientY;
                }
            });

            window.addEventListener('mousemove', (e) => {
                if (!isMouseDown || !map) return;
                const dx = e.clientX - lastMouseX;
                const dy = e.clientY - lastMouseY;
                if (!map.dragPan.isActive()) {
                    map.panBy([-dx, -dy], { duration: 0 });
                }
                lastMouseX = e.clientX;
                lastMouseY = e.clientY;
            });

            window.addEventListener('mouseup', () => { isMouseDown = false; });
        }

        map.on('error', (e) => {
            console.warn('[MapLibre Error]', e);
        });

        map.on('load', () => {
            AppState.mapLoaded = true;
            configurarCapasWebGL();
            renderizarVista(false, false);
            // Asegurar dimensiones óptimas
            setTimeout(() => { if (map) map.resize(); }, 150);
            setTimeout(() => { if (map) map.resize(); }, 600);
        });

        // pageshow: captura el Back/Forward Cache de iOS Safari y Chrome Android
        window.addEventListener('pageshow', (e) => {
            if (map) setTimeout(() => map.resize(), 100);
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
        if (AppState.circunscripcionesGeojson && map.getSource('circunscripciones-source')) {
            map.getSource('circunscripciones-source').setData(AppState.circunscripcionesGeojson);
        }
        if (AppState.circunscripcionesLabelsGeojson && map.getSource('circunscripciones-labels-source')) {
            map.getSource('circunscripciones-labels-source').setData(AppState.circunscripcionesLabelsGeojson);
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

        // Popup interactivo para Puntos de Muestreo (Prominentes)
        map.on('click', 'puntos-muestreo-halo', (e) => {
            if (!e.features || !e.features.length) return;
            const p = e.features[0].properties;
            const coords = e.features[0].geometry.coordinates;
            const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${coords[1]},${coords[0]}`;

            new maplibregl.Popup({ offset: [0, -10], closeButton: true })
                .setLngLat(coords)
                .setHTML(`
                    <div class="cs-map-popup">
                        <div class="cs-popup-badge cs-popup-badge--muestreo">🎯 Punto de Muestreo #${p.codigo_muestra || ''}</div>
                        <h4 class="cs-popup-title">${p.etiqueta_completa || p.nombre_referencia || 'Punto de Muestreo'}</h4>
                        <div class="cs-popup-row"><span>Parroquia:</span> <strong>${p.parroquia || ''}</strong></div>
                        <div class="cs-popup-row"><span>Circunscripción:</span> <strong>${p.circunscripcion || ''}</strong></div>
                        ${p.tipologia ? `<div class="cs-popup-row"><span>Tipología:</span> <strong>${p.tipologia}</strong></div>` : ''}
                        <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" class="cs-popup-btn-gmaps">
                            <svg class="cs-icon" style="width:13px;height:13px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                            Cómo llegar (Google Maps)
                        </a>
                    </div>
                `)
                .addTo(map);
        });

        // Popup interactivo para Puntos Referenciales dentro de Sectores Censales
        map.on('click', 'puntos-llegada-circle', (e) => {
            if (!e.features || !e.features.length) return;
            const p = e.features[0].properties;
            const coords = e.features[0].geometry.coordinates;
            const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${coords[1]},${coords[0]}`;
            const secCorto = p.sec_anm ? p.sec_anm.slice(-3) : '';

            new maplibregl.Popup({ offset: [0, -8], closeButton: true })
                .setLngLat(coords)
                .setHTML(`
                    <div class="cs-map-popup">
                        <div class="cs-popup-badge cs-popup-badge--llegada">📌 Pto. Referencial · Sector ${secCorto}</div>
                        <h4 class="cs-popup-title">${p.nombre_referencia || 'Punto Referencial'}</h4>
                        <div class="cs-popup-row"><span>Tipo:</span> <strong>${p.tipo_referencia || 'Referencia'}</strong></div>
                        <div class="cs-popup-row"><span>Parroquia:</span> <strong>${p.parroquia || ''}</strong></div>
                        <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" class="cs-popup-btn-gmaps">
                            <svg class="cs-icon" style="width:13px;height:13px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                            Cómo llegar (Google Maps)
                        </a>
                    </div>
                `)
                .addTo(map);
        });

        // Cursores interactivos
        map.on('mouseenter', 'sectores-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'sectores-fill', () => { map.getCanvas().style.cursor = ''; });
        map.on('mouseenter', 'puntos-layer', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'puntos-layer', () => { map.getCanvas().style.cursor = ''; });
        map.on('mouseenter', 'puntos-muestreo-halo', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'puntos-muestreo-halo', () => { map.getCanvas().style.cursor = ''; });
        map.on('mouseenter', 'puntos-llegada-circle', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'puntos-llegada-circle', () => { map.getCanvas().style.cursor = ''; });

        // Conectar botones para Prender / Apagar capas en el mapa
        const togglesMap = [
            { btn: UI.toggleMuestreo, key: 'muestreo', layers: ['puntos-muestreo-halo', 'puntos-muestreo-dot', 'puntos-muestreo-labels'] },
            { btn: UI.toggleLlegada, key: 'llegada', layers: ['puntos-llegada-circle', 'puntos-llegada-labels'] },
            { btn: UI.toggleSectores, key: 'sectores', layers: ['sectores-fill', 'sectores-line', 'sectores-label'] },
            { btn: UI.toggleCircunscripciones, key: 'circunscripciones', layers: ['circunscripciones-fill', 'circunscripciones-line', 'circunscripciones-label'] }
        ];

        togglesMap.forEach(({ btn, key, layers }) => {
            if (!btn) return;
            btn.onclick = () => {
                const actual = AppState.capasVisibles[key];
                const nuevo = !actual;
                AppState.capasVisibles[key] = nuevo;
                btn.classList.toggle('active', nuevo);
                const vis = nuevo ? 'visible' : 'none';
                layers.forEach(ly => {
                    if (map.getLayer(ly)) {
                        map.setLayoutProperty(ly, 'visibility', vis);
                    }
                });
            };
        });

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
                AppState.diccionarioParroquias = AppState.diccionarioParroquias || {};
                geojsonData.features.forEach(f => {
                    const p = f.properties || {};
                    const nombre = p.nombre || p.PARROQUIA || p.name || 'Parroquia';
                    const canton = p.CANTON || p.canton || '';
                    const tipo = p.ESTADO || 'Rural';
                    const cod = p.CODPAR || p.cod || p.codigo || '';

                    if (cod && nombre) {
                        AppState.diccionarioParroquias[String(cod).trim()] = nombre.toUpperCase();
                        const n = parseInt(cod, 10);
                        if (!isNaN(n)) AppState.diccionarioParroquias[String(n)] = nombre.toUpperCase();
                    }

                    listaParroquias.push({ nombre, canton, tipo, cod });
                    const bbox = f.geometry ? calcularBBOX(f.geometry) : null;
                    AppState.parroquiasMap.set(nombre.toUpperCase(), { feature: f, bbox });
                });
            }

            poblarFiltros();
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
                    const sc = String(p.codigo_muestra || p.sc || p.sec_anm || p.codigo_sc || p.sc_cuenca_sc || '').trim();
                    const tipologia = String(p.tipologia || p.tipologia_sc || '').trim().toUpperCase();
                    const etiquetaSC = sc ? `${sc}${tipologia}` : tipologia;
                    f.properties.sc = sc;
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

    function poblarFiltroParroquias() {
        poblarFiltros();
    }

    function seleccionarParroquia(nombre) {
        AppState.parroquiaSeleccionada = nombre;
        if (UI.parroquiaFilter) UI.parroquiaFilter.value = nombre;
        
        // Si el sector seleccionado no pertenece a esta nueva parroquia, resetear a 'Todos'
        if (AppState.sectorSeleccionado !== 'Todos') {
            const secMeta = AppState.sectoresMap.get(AppState.sectorSeleccionado);
            const parSec = secMeta ? String(secMeta.parroquia || secMeta.parroquia_especifica || secMeta.nom_par || secMeta.PARROQUIA || '').trim().toUpperCase() : '';
            if (nombre !== 'Todas' && parSec && !parSec.includes(nombre) && !nombre.includes(parSec)) {
                AppState.sectorSeleccionado = 'Todos';
            }
        }
        poblarFiltros();
        renderizarVista(true, true);
    }

    function actualizarPoligonosMapa(ajustarCamara = false) {
        if (!map) return;

        // 0. Polígonos de Circunscripciones (Destacar visualmente según filtro)
        if (map.getLayer('circunscripciones-fill') && map.getLayer('circunscripciones-line')) {
            if (AppState.circunscripcionSeleccionada === 'Todas') {
                map.setPaintProperty('circunscripciones-fill', 'fill-opacity', 0.08);
                map.setPaintProperty('circunscripciones-line', 'line-width', 2.8);
                map.setPaintProperty('circunscripciones-line', 'line-opacity', 0.90);
            } else if (AppState.circunscripcionSeleccionada === 'Circunscripción 1') {
                map.setPaintProperty('circunscripciones-fill', 'fill-opacity', [
                    'match',
                    ['get', 'circunscripcion'],
                    'Circunscripción 1', 0.16,
                    0.02
                ]);
                map.setPaintProperty('circunscripciones-line', 'line-width', [
                    'match',
                    ['get', 'circunscripcion'],
                    'Circunscripción 1', 3.8,
                    1.4
                ]);
                map.setPaintProperty('circunscripciones-line', 'line-opacity', [
                    'match',
                    ['get', 'circunscripcion'],
                    'Circunscripción 1', 1.0,
                    0.30
                ]);
            } else if (AppState.circunscripcionSeleccionada === 'Circunscripción 2') {
                map.setPaintProperty('circunscripciones-fill', 'fill-opacity', [
                    'match',
                    ['get', 'circunscripcion'],
                    'Circunscripción 2', 0.16,
                    0.02
                ]);
                map.setPaintProperty('circunscripciones-line', 'line-width', [
                    'match',
                    ['get', 'circunscripcion'],
                    'Circunscripción 2', 3.8,
                    1.4
                ]);
                map.setPaintProperty('circunscripciones-line', 'line-opacity', [
                    'match',
                    ['get', 'circunscripcion'],
                    'Circunscripción 2', 1.0,
                    0.30
                ]);
            }
        }

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
                const sectorMeta = AppState.sectoresMap.get(targetSC) || (parseInt(targetSC, 10) ? AppState.sectoresMap.get(String(parseInt(targetSC, 10))) : null);
                const isPuntoMuestreo = sectorMeta && sectorMeta.esPuntoMuestreo;

                if (isPuntoMuestreo) {
                    // Si se seleccionó un punto de muestreo directo (16..40 o 53..70), ocultar polígonos de sectores
                    map.setLayoutProperty('sectores-fill', 'visibility', 'none');
                    map.setLayoutProperty('sectores-line', 'visibility', 'none');
                    map.setLayoutProperty('sectores-label', 'visibility', 'none');
                } else {
                    // FILTRAR Y DESTACAR ÚNICAMENTE EL POLÍGONO DEL SECTOR CENSAL
                    const filterSC = ['==', ['to-string', ['get', 'sc']], targetSC];

                    map.setLayoutProperty('sectores-fill', 'visibility', 'visible');
                    map.setFilter('sectores-fill', filterSC);
                    map.setPaintProperty('sectores-fill', 'fill-color', '#ea580c');
                    map.setPaintProperty('sectores-fill', 'fill-opacity', 0.30);

                    map.setLayoutProperty('sectores-line', 'visibility', 'visible');
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
                }

                if (sectorMeta) {
                    const etiqueta = sectorMeta.etiqueta_muestra || sectorMeta.etiquetaSC || `Muestra #${targetSC}`;
                    const centroid = sectorMeta.centroid;

                    if (barraSector && sectorTitulo && btnGmaps && centroid) {
                        sectorTitulo.textContent = isPuntoMuestreo ? `Punto #${targetSC} — ${sectorMeta.nombre_acortado || sectorMeta.nombre_referencia || ''}` : `Sector ${sectorMeta.etiquetaSC || targetSC}`;
                        btnGmaps.href = `https://www.google.com/maps/dir/?api=1&destination=${centroid[1].toFixed(6)},${centroid[0].toFixed(6)}`;
                        barraSector.style.display = 'flex';
                    }
                } else if (barraSector) {
                    barraSector.style.display = 'none';
                }
            }
        }

        // =====================================================================
        // 3. ZOOM AUTOMÁTICO INTELIGENTE EN CASCADA SEGÚN FILTROS ACTIVOS
        // =====================================================================
        if (ajustarCamara) {
            if (AppState.sectorSeleccionado !== 'Todos') {
                // Nivel 1: Zoom al Sector Censal o Punto de Muestreo seleccionado (1 al 70)
                const targetSC = String(AppState.sectorSeleccionado).trim();
                const sectorMeta = AppState.sectoresMap.get(targetSC) || (parseInt(targetSC, 10) ? AppState.sectoresMap.get(String(parseInt(targetSC, 10))) : null);
                const bbox = sectorMeta ? (sectorMeta.bbox || (sectorMeta.feature && sectorMeta.feature.properties && sectorMeta.feature.properties.bbox)) : null;
                if (bbox) {
                    map.fitBounds(bbox, {
                        padding: { top: 75, bottom: 60, left: 60, right: 60 },
                        maxZoom: sectorMeta && sectorMeta.esPuntoMuestreo ? 17.5 : 16.5,
                        duration: 900
                    });
                }
            } else if (AppState.parroquiaSeleccionada !== 'Todas') {
                // Nivel 2: Zoom a la Parroquia seleccionada
                const targetNom = AppState.parroquiaSeleccionada.toUpperCase();
                const normTarget = normTexto(targetNom);
                const featMeta = AppState.parroquiasMap.get(targetNom) || AppState.parroquiasMap.get(normTarget);
                const bbox = featMeta ? (featMeta.bbox || (featMeta.feature && featMeta.feature.properties && featMeta.feature.properties.bbox)) : null;
                if (bbox) {
                    map.fitBounds(bbox, {
                        padding: { top: 65, bottom: 50, left: 50, right: 50 },
                        maxZoom: 15.0,
                        duration: 900
                    });
                }
            } else if (AppState.circunscripcionSeleccionada !== 'Todas') {
                // Nivel 3: Zoom a la Circunscripción seleccionada
                const circMeta = AppState.circunscripcionesMap ? AppState.circunscripcionesMap.get(AppState.circunscripcionSeleccionada) : null;
                let circBbox = circMeta ? circMeta.bbox : null;
                
                if (!circBbox) {
                    if (AppState.circunscripcionSeleccionada === 'Circunscripción 1') {
                        // BBox calculado de Circunscripción 1
                        circBbox = [[-80.0044, -3.2742], [-79.8945, -3.1706]];
                    } else if (AppState.circunscripcionSeleccionada === 'Circunscripción 2') {
                        // BBox calculado de Circunscripción 2
                        circBbox = [[-80.0294, -3.3557], [-79.8388, -3.2301]];
                    }
                }
                if (circBbox) {
                    map.fitBounds(circBbox, {
                        padding: { top: 60, bottom: 50, left: 50, right: 50 },
                        maxZoom: 14.5,
                        duration: 900
                    });
                }
            } else {
                // Nivel 4: Vista global del Cantón Machala
                const cantonBbox = AppState.cantonBbox || [[-80.015, -3.300], [-79.885, -3.230]];
                map.fitBounds(cantonBbox, {
                    padding: { top: 55, bottom: 45, left: 45, right: 45 },
                    maxZoom: 13.0,
                    duration: 900
                });
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

            const parroquia = obtenerParroquiaEncuesta(enc) || '';
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
            // Filtrar outliers que caigan fuera del cantón actual con margen de tolerancia (0.20°)
            const cantonBbox = AppState.cantonBbox;
            const validPoints = cantonBbox ? features.filter(f => {
                const [lng, lat] = f.geometry.coordinates;
                return lat >= cantonBbox[0][1] - 0.20 && lat <= cantonBbox[1][1] + 0.20 &&
                       lng >= cantonBbox[0][0] - 0.20 && lng <= cantonBbox[1][0] + 0.20;
            }) : features;
            const pts = validPoints.length > 0 ? validPoints : features;
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

        // 1.1 Filtro Circunscripción (Electoral / Territorial)
        if (UI.circunscripcionFilter) {
            UI.circunscripcionFilter.addEventListener('change', (e) => {
                AppState.circunscripcionSeleccionada = e.target.value;
                AppState.parroquiaSeleccionada = 'Todas';
                AppState.sectorSeleccionado = 'Todos';
                poblarFiltros();
                renderizarVista(true, true);
            });
        }

        // 2. Filtro Parroquia
        if (UI.parroquiaFilter) {
            UI.parroquiaFilter.addEventListener('change', (e) => {
                seleccionarParroquia(e.target.value);
            });
        }

        // 3. Filtro Sector Censal (Con auto-sincronización a Parroquia)
        if (UI.sectorFilter) {
            UI.sectorFilter.addEventListener('change', (e) => {
                const secVal = e.target.value;
                AppState.sectorSeleccionado = secVal;
                
                if (secVal !== 'Todos') {
                    // Obtener parroquia asociada al sector
                    const secMeta = AppState.sectoresMap.get(secVal) || (parseInt(secVal, 10) ? AppState.sectoresMap.get(String(parseInt(secVal, 10))) : null);
                    const parSector = secMeta ? String(secMeta.parroquia || secMeta.parroquia_especifica || secMeta.nom_par || secMeta.PARROQUIA || '').trim() : '';
                    if (parSector) {
                        AppState.parroquiaSeleccionada = parSector.toUpperCase();
                    }
                }
                
                poblarFiltros();
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
                AppState.circunscripcionSeleccionada = 'Todas';
                AppState.sectorSeleccionado = 'Todos';
                AppState.parroquiaSeleccionada = 'Todas';
                AppState.fechaSeleccionada = 'Todas';
                AppState.encuestadorSeleccionado = null;
                AppState.mostrarEtiquetas = false;
                AppState.filtroTabla = '';
                if (UI.btnEtiquetasOn) UI.btnEtiquetasOn.classList.remove('active');
                if (UI.btnEtiquetasOff) UI.btnEtiquetasOff.classList.add('active');
                if (UI.searchInput) UI.searchInput.value = '';

                poblarFiltros();
                renderizarVista(true, true);
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
