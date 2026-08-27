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
        ordenTabla: { columna: 'encuestas', asc: false },
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
        btnLimpiarFiltros: document.getElementById('btnLimpiarFiltros'),
        
        // Mapa y Modos
        mapContainer: document.getElementById('map'),
        locateBtn: document.getElementById('locateBtn'),
        btnModoPuntos: document.getElementById('btnModoPuntos'),
        btnModoCluster: document.getElementById('btnModoCluster'),
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
    async function inicializar() {
        iniciarReloj();
        configurarModoOscuro();
        configurarEventos();
        
        try {
            await cargarConfiguracion();
            inicializarMapa();
            await Promise.all([cargarLimitesParroquiales(), cargarSectoresCensales()]);
            await cargarDatos(true);
            
            // Auto-refresco inteligente (pausa si la pantalla se apaga o se cambia de app)
            AppState.intervaloPolling = setInterval(() => cargarDatos(false), 180000);
            
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    clearInterval(AppState.intervaloPolling);
                    AppState.intervaloPolling = null;
                } else {
                    cargarDatos(false);
                    if (!AppState.intervaloPolling) {
                        AppState.intervaloPolling = setInterval(() => cargarDatos(false), 180000);
                    }
                }
            });
        } catch (error) {
            console.error('Error al inicializar:', error);
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
            AppState.encuestas = data.resultados || [];
            
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
            }
            if (UI.badgeTexto) UI.badgeTexto.textContent = 'Sin conexión';
            mostrarToast('Error al conectar con Kobo', 'error');
        } finally {
            if (mostrarOverlay && UI.cargaOverlay) UI.cargaOverlay.style.display = 'none';
        }
    }

    // =========================================================================
    // FILTROS CRUZADOS INTELIGENTES Y DINÁMICOS (Single-Pass O(N) Ultra-Rápido)
    // =========================================================================
    function poblarFiltros() {
        if (!AppState.encuestas || AppState.encuestas.length === 0) return;

        const selSup = AppState.supervisorSeleccionado;
        const selSec = AppState.sectorSeleccionado;
        const selPar = AppState.parroquiaSeleccionada;
        const selFec = AppState.fechaSeleccionada;
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
            const sc = String(e.sc || campo(e, 'sc') || '');
            const parr = obtenerParroquiaEncuesta(e);
            const fec = e._submission_time ? e._submission_time.substring(0, 10) : '';

            const matchSup = (selSup === 'Todos' || sup === selSup);
            const matchSec = (selSec === 'Todos' || sc === selSec);
            const matchFec = (selFec === 'Todas' || fec === selFec);
            let matchPar = true;
            if (targetPar) {
                const uParr = parr.toUpperCase();
                matchPar = (uParr.includes(targetPar) || targetPar.includes(uParr));
            }

            // Opciones de Supervisores (coincide con Sector + Parroquia + Fecha)
            if (sup && matchSec && matchPar && matchFec) {
                supervisores.set(sup, (supervisores.get(sup) || 0) + 1);
            }

            // Opciones de Sectores (coincide con Supervisor + Parroquia + Fecha)
            if (sc && matchSup && matchPar && matchFec) {
                sectores.set(sc, (sectores.get(sc) || 0) + 1);
            }

            // Opciones de Parroquias (coincide con Supervisor + Sector + Fecha)
            if (parr && matchSup && matchSec && matchFec) {
                parroquias.set(parr, (parroquias.get(parr) || 0) + 1);
            }

            // Opciones de Fechas (coincide con Supervisor + Sector + Parroquia)
            if (fec && matchSup && matchSec && matchPar) {
                fechas.set(fec, (fechas.get(fec) || 0) + 1);
            }
        }

        // 1. Selector Supervisores
        if (UI.supervisorFilter) {
            const actualSup = AppState.supervisorSeleccionado || 'Todos';
            UI.supervisorFilter.innerHTML = '<option value="Todos">Todos</option>';
            const supList = Array.from(supervisores.keys()).sort((a, b) => (parseInt(a, 10) || a) - (parseInt(b, 10) || b));
            const frag = document.createDocumentFragment();
            supList.forEach(sup => {
                const opt = document.createElement('option');
                opt.value = sup;
                opt.textContent = `Supervisor #${sup} (${supervisores.get(sup)})`;
                frag.appendChild(opt);
            });
            UI.supervisorFilter.appendChild(frag);
            UI.supervisorFilter.value = supervisores.has(actualSup) ? actualSup : 'Todos';
            if (!supervisores.has(actualSup) && actualSup !== 'Todos') AppState.supervisorSeleccionado = 'Todos';
        }

        // 2. Selector Sectores Censales
        if (UI.sectorFilter) {
            const actualSec = AppState.sectorSeleccionado || 'Todos';
            UI.sectorFilter.innerHTML = '<option value="Todos">Todos</option>';
            const secList = Array.from(sectores.keys()).sort((a, b) => (parseInt(a, 10) || a) - (parseInt(b, 10) || b));
            const frag = document.createDocumentFragment();
            secList.forEach(sc => {
                const opt = document.createElement('option');
                opt.value = sc;
                opt.textContent = `${sc} (${sectores.get(sc)})`;
                frag.appendChild(opt);
            });
            UI.sectorFilter.appendChild(frag);
            UI.sectorFilter.value = sectores.has(actualSec) ? actualSec : 'Todos';
            if (!sectores.has(actualSec) && actualSec !== 'Todos') AppState.sectorSeleccionado = 'Todos';
        }

        // 3. Selector Parroquias
        if (UI.parroquiaFilter) {
            const actualPar = AppState.parroquiaSeleccionada || 'Todas';
            UI.parroquiaFilter.innerHTML = '<option value="Todas">Todas</option>';
            const parList = Array.from(parroquias.keys()).sort((a, b) => a.localeCompare(b, 'es'));
            const frag = document.createDocumentFragment();
            parList.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p;
                opt.textContent = `${p} (${parroquias.get(p)})`;
                frag.appendChild(opt);
            });
            UI.parroquiaFilter.appendChild(frag);
            UI.parroquiaFilter.value = parroquias.has(actualPar) ? actualPar : 'Todas';
            if (!parroquias.has(actualPar) && actualPar !== 'Todas') AppState.parroquiaSeleccionada = 'Todas';
        }

        // 4. Selector Fechas
        if (UI.fechaFilter) {
            const actualFec = AppState.fechaSeleccionada || 'Todas';
            UI.fechaFilter.innerHTML = '<option value="Todas">Todas</option>';
            const fecList = Array.from(fechas.keys()).sort().reverse();
            const frag = document.createDocumentFragment();
            fecList.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f;
                opt.textContent = `${f} (${fechas.get(f)})`;
                frag.appendChild(opt);
            });
            UI.fechaFilter.appendChild(frag);
            UI.fechaFilter.value = fechas.has(actualFec) ? actualFec : 'Todas';
            if (!fechas.has(actualFec) && actualFec !== 'Todas') AppState.fechaSeleccionada = 'Todas';
        }
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
            filtradas = filtradas.filter(e => {
                const sc = String(e.sc || campo(e, 'sc') || '');
                return sc === AppState.sectorSeleccionado;
            });
        }

        // Filtro por Encuestador (al hacer clic en la tabla)
        if (AppState.encuestadorSeleccionado) {
            filtradas = filtradas.filter(e => {
                const enc = String(e.encuestador || e.C_digo_encuestador || campo(e, AppState.config.campoEncuestador) || '');
                return enc === AppState.encuestadorSeleccionado;
            });
        }

        // Filtro por Fecha
        if (AppState.fechaSeleccionada !== 'Todas') {
            filtradas = filtradas.filter(e => {
                if (!e._submission_time) return false;
                return e._submission_time.substring(0, 10) === AppState.fechaSeleccionada;
            });
        }
        
        return filtradas;
    }

    function renderizarVista(actualizarSelects = false, ajustarCamara = false) {
        if (actualizarSelects) {
            poblarFiltros();
        }
        actualizarPoligonosMapa(ajustarCamara);
        const encuestas = obtenerEncuestasFiltradas();
        actualizarKPIs(encuestas);
        actualizarMapa(encuestas, ajustarCamara && AppState.sectorSeleccionado === 'Todos' && AppState.parroquiaSeleccionada === 'Todas');
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
        const duracion = 400;
        const pasos = 15;
        const incremento = valorFinal / pasos;
        let actual = 0;
        const pasoTiempo = duracion / pasos;

        const timer = setInterval(() => {
            actual += incremento;
            if (actual >= valorFinal) {
                elemento.textContent = valorFinal.toLocaleString();
                clearInterval(timer);
            } else {
                elemento.textContent = Math.floor(actual).toLocaleString();
            }
        }, pasoTiempo);
    }

    // =========================================================================
    // MAPA WEBGL MAPLIBRE (Aceleración GPU 100% Nativa - Cero Glitches)
    // =========================================================================
    function inicializarMapa() {
        if (!UI.mapContainer || !window.maplibregl) return;

        map = new maplibregl.Map({
            container: 'map',
            style: {
                version: 8,
                glyphs: 'fonts/{fontstack}/{range}.pbf',
                sources: {
                    'osm-hot-tiles': {
                        type: 'raster',
                        tiles: [
                            'https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
                            'https://b.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png'
                        ],
                        tileSize: 256,
                        attribution: '&copy; OpenStreetMap contributors · Humanitarian map style · Clima Social'
                    }
                },
                layers: [
                    {
                        id: 'osm-hot-layer',
                        type: 'raster',
                        source: 'osm-hot-tiles',
                        minzoom: 0,
                        maxzoom: 19
                    }
                ]
            },
            center: [-78.9983, -2.9334],
            zoom: 12.0,
            minZoom: 8,
            maxZoom: 19
        });

        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
        window.map = map;
        function alCargarMapa() {
            AppState.mapLoaded = true;
            configurarCapasWebGL();
            renderizarVista(false, false);
        }

        map.on('load', alCargarMapa);
        map.on('style.load', alCargarMapa);
        map.on('styledata', () => {
            configurarCapasWebGL();
        });
        setTimeout(alCargarMapa, 200);
    }

    function configurarCapasWebGL() {
        if (!map) return;

        // 1. Capa de Parroquias
        if (AppState.parroquiasGeojson) {
            if (!map.getSource('parroquias-source')) {
                map.addSource('parroquias-source', {
                    type: 'geojson',
                    data: AppState.parroquiasGeojson
                });

                map.addLayer({
                    id: 'parroquias-fill',
                    type: 'fill',
                    source: 'parroquias-source',
                    paint: {
                        'fill-color': '#8b5cf6',
                        'fill-opacity': 0.0
                    }
                });

                map.addLayer({
                    id: 'parroquias-line',
                    type: 'line',
                    source: 'parroquias-source',
                    paint: {
                        'line-color': '#7c3aed',
                        'line-width': 1.5,
                        'line-opacity': 0.65
                    }
                });
            } else {
                map.getSource('parroquias-source').setData(AppState.parroquiasGeojson);
            }
        }

        // 2. Capa de Sectores Censales
        if (AppState.sectoresGeojson) {
            if (!map.getSource('sectores-source')) {
                map.addSource('sectores-source', {
                    type: 'geojson',
                    data: AppState.sectoresGeojson
                });

                map.addLayer({
                    id: 'sectores-fill',
                    type: 'fill',
                    source: 'sectores-source',
                    paint: {
                        'fill-color': '#028090',
                        'fill-opacity': 0.18
                    }
                });

                map.addLayer({
                    id: 'sectores-line',
                    type: 'line',
                    source: 'sectores-source',
                    paint: {
                        'line-color': '#028090',
                        'line-width': [
                            'interpolate',
                            ['linear'],
                            ['zoom'],
                            10, 2.5,
                            14, 4.0,
                            17, 6.0
                        ],
                        'line-opacity': 1.0
                    }
                });

                map.addLayer({
                    id: 'sectores-label',
                    type: 'symbol',
                    source: 'sectores-source',
                    layout: {
                        'text-field': ['get', 'etiquetaSC'],
                        'text-font': ['Open Sans Bold'],
                        'text-size': [
                            'interpolate',
                            ['linear'],
                            ['zoom'],
                            10, 13,
                            13, 16,
                            16, 24
                        ],
                        'text-allow-overlap': true,
                        'text-ignore-placement': true
                    },
                    paint: {
                        'text-color': '#0f172a',
                        'text-halo-color': '#ffffff',
                        'text-halo-width': 4.0,
                        'text-halo-blur': 0.5
                    }
                });
            } else {
                map.getSource('sectores-source').setData(AppState.sectoresGeojson);
            }
        }

        // 3. Capas de Encuestas: Modo Puntos y Modo Clúster
        if (!map.getSource('encuestas-puntos-source')) {
            // Fuente para Modo Puntos Individuales (Sin agrupar)
            map.addSource('encuestas-puntos-source', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
                cluster: false
            });

            // Fuente para Modo Clúster
            map.addSource('encuestas-cluster-source', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
                cluster: true,
                clusterMaxZoom: 14,
                clusterRadius: 35
            });

            // --- MODO PUNTOS INDIVIDUALES ---
            // 1. Capa de Etiquetas (debajo de los puntos para que nunca tapen los círculos)
            map.addLayer({
                id: 'puntos-label-layer',
                type: 'symbol',
                source: 'encuestas-puntos-source',
                layout: {
                    'text-field': ['get', 'microEtiqueta'],
                    'text-font': ['Open Sans Bold'],
                    'text-size': [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        12, 11,
                        15, 14,
                        17, 18
                    ],
                    'text-offset': [0, -1.6],
                    'text-anchor': 'bottom',
                    'text-allow-overlap': true,
                    'visibility': AppState.mostrarEtiquetas ? 'visible' : 'none'
                },
                paint: {
                    'text-color': '#0f172a',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 3.0,
                    'text-halo-blur': 0.5
                }
            });

            // 2. Círculos de Puntos (Encima de las etiquetas)
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
                    'circle-radius': 7.0,
                    'circle-stroke-width': 2.5,
                    'circle-stroke-color': '#ffffff',
                    'circle-opacity': 1.0
                }
            });

            // --- MODO CLÚSTER ---
            map.addLayer({
                id: 'clusters-circle',
                type: 'circle',
                source: 'encuestas-cluster-source',
                filter: ['has', 'point_count'],
                layout: {
                    'visibility': 'none'
                },
                paint: {
                    'circle-color': '#0d2137',
                    'circle-radius': [
                        'step',
                        ['get', 'point_count'],
                        16,
                        10, 19,
                        30, 23,
                        75, 28
                    ],
                    'circle-stroke-width': 2.5,
                    'circle-stroke-color': '#f26419',
                    'circle-opacity': 0.95
                }
            });

            map.addLayer({
                id: 'clusters-count',
                type: 'symbol',
                source: 'encuestas-cluster-source',
                filter: ['has', 'point_count'],
                layout: {
                    'text-field': '{point_count_abbreviated}',
                    'text-font': ['Open Sans Bold'],
                    'text-size': 13,
                    'visibility': 'none'
                },
                paint: {
                    'text-color': '#ffffff'
                }
            });

            map.addLayer({
                id: 'cluster-unclustered-label',
                type: 'symbol',
                source: 'encuestas-cluster-source',
                filter: ['!', ['has', 'point_count']],
                layout: {
                    'text-field': ['get', 'microEtiqueta'],
                    'text-font': ['Open Sans Bold'],
                    'text-size': [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        12, 11,
                        15, 14,
                        17, 18
                    ],
                    'text-offset': [0, -1.6],
                    'text-anchor': 'bottom',
                    'text-allow-overlap': true,
                    'visibility': 'none'
                },
                paint: {
                    'text-color': '#0f172a',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 3.0,
                    'text-halo-blur': 0.5
                }
            });

            map.addLayer({
                id: 'cluster-unclustered-point',
                type: 'circle',
                source: 'encuestas-cluster-source',
                filter: ['!', ['has', 'point_count']],
                layout: {
                    'visibility': 'none'
                },
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
                    'circle-radius': 7.0,
                    'circle-stroke-width': 2.5,
                    'circle-stroke-color': '#ffffff',
                    'circle-opacity': 1.0
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
        map.on('click', 'cluster-unclustered-point', abrirPopupEncuesta);

        // Clic en Clúster (Zoom expansivo suave)
        map.on('click', 'clusters-circle', (e) => {
            const features = map.queryRenderedFeatures(e.point, { layers: ['clusters-circle'] });
            if (!features.length) return;
            const clusterId = features[0].properties.cluster_id;
            map.getSource('encuestas-cluster-source').getClusterExpansionZoom(clusterId, (err, zoom) => {
                if (err) return;
                map.easeTo({
                    center: features[0].geometry.coordinates,
                    zoom: zoom + 0.5
                });
            });
        });

        // Cursores
        map.on('mouseenter', 'sectores-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'sectores-fill', () => { map.getCanvas().style.cursor = ''; });
        map.on('mouseenter', 'puntos-layer', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'puntos-layer', () => { map.getCanvas().style.cursor = ''; });
        map.on('mouseenter', 'cluster-unclustered-point', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'cluster-unclustered-point', () => { map.getCanvas().style.cursor = ''; });
        map.on('mouseenter', 'clusters-circle', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'clusters-circle', () => { map.getCanvas().style.cursor = ''; });

        actualizarPoligonosMapa(false);
    }

    function actualizarClaseZoom() {
        if (!map || !AppState.mapLoaded) return;
        const isCluster = (AppState.modoVisualizacion === 'cluster');
        const show = AppState.mostrarEtiquetas ? 'visible' : 'none';

        if (map.getLayer('puntos-label-layer')) {
            map.setLayoutProperty('puntos-label-layer', 'visibility', !isCluster ? show : 'none');
        }
        if (map.getLayer('cluster-unclustered-label')) {
            map.setLayoutProperty('cluster-unclustered-label', 'visibility', isCluster ? show : 'none');
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
                    AppState.parroquiasMap.set(nombre.toUpperCase(), f);

                    if (f.geometry) {
                        f.properties.bbox = calcularBBOX(f.geometry);
                    }
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
                    const etiquetaSC = `${sc}${tipologia}`;
                    f.properties.etiquetaSC = etiquetaSC;

                    if (f.geometry) {
                        const bbox = calcularBBOX(f.geometry);
                        f.properties.bbox = bbox;
                        f.properties.centroid = [(bbox[0][0] + bbox[1][0]) / 2, (bbox[0][1] + bbox[1][1]) / 2];
                    }

                    if (sc) {
                        AppState.sectoresMap.set(sc, f);
                        const numSc = parseInt(sc, 10);
                        if (!isNaN(numSc)) AppState.sectoresMap.set(String(numSc), f);
                        AppState.sectoresMap.set(etiquetaSC, f);
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
                map.setPaintProperty('parroquias-line', 'line-width', 1.2);
                map.setPaintProperty('parroquias-line', 'line-opacity', 0.6);
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
                    const feat = AppState.parroquiasMap.get(targetNom);
                    if (feat && feat.properties && feat.properties.bbox) {
                        map.fitBounds(feat.properties.bbox, {
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
                // Mostrar todos los sectores en estilo normal
                map.setFilter('sectores-fill', null);
                map.setLayoutProperty('sectores-fill', 'visibility', 'visible');
                map.setPaintProperty('sectores-fill', 'fill-color', '#028090');
                map.setPaintProperty('sectores-fill', 'fill-opacity', 0.18);

                map.setFilter('sectores-line', null);
                map.setLayoutProperty('sectores-line', 'visibility', 'visible');
                map.setPaintProperty('sectores-line', 'line-color', '#028090');
                map.setPaintProperty('sectores-line', 'line-width', [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 2.5,
                    14, 4.0,
                    17, 6.0
                ]);
                map.setPaintProperty('sectores-line', 'line-opacity', 1.0);

                map.setFilter('sectores-label', null);
                map.setLayoutProperty('sectores-label', 'visibility', 'visible');
                map.setLayoutProperty('sectores-label', 'text-size', [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 13,
                    13, 16,
                    16, 24
                ]);
                map.setPaintProperty('sectores-label', 'text-color', '#0f172a');
                map.setPaintProperty('sectores-label', 'text-halo-color', '#ffffff');
                map.setPaintProperty('sectores-label', 'text-halo-width', 4.0);

                if (barraSector) barraSector.style.display = 'none';
            } else {
                // FILTRAR Y DESTACAR ÚNICAMENTE EL SECTOR SELECCIONADO
                const filterSC = ['==', ['to-string', ['get', 'sc']], targetSC];

                map.setFilter('sectores-fill', filterSC);
                map.setPaintProperty('sectores-fill', 'fill-color', '#f26419');
                map.setPaintProperty('sectores-fill', 'fill-opacity', 0.25);

                map.setFilter('sectores-line', filterSC);
                map.setPaintProperty('sectores-line', 'line-color', '#f26419');
                map.setPaintProperty('sectores-line', 'line-width', 4.5);
                map.setPaintProperty('sectores-line', 'line-opacity', 1.0);

                map.setFilter('sectores-label', filterSC);
                map.setLayoutProperty('sectores-label', 'visibility', 'visible');
                map.setLayoutProperty('sectores-label', 'text-size', [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    12, 18,
                    15, 26,
                    17, 32
                ]);
                map.setPaintProperty('sectores-label', 'text-color', '#c2410c');
                map.setPaintProperty('sectores-label', 'text-halo-color', '#ffffff');
                map.setPaintProperty('sectores-label', 'text-halo-width', 4.5);

                const sectorFeat = AppState.sectoresMap.get(targetSC) || (parseInt(targetSC, 10) ? AppState.sectoresMap.get(String(parseInt(targetSC, 10))) : null);
                if (sectorFeat && sectorFeat.properties) {
                    const p = sectorFeat.properties;
                    const etiqueta = p.etiquetaSC || `${p.sc || ''}${p.tipologia || ''}`;

                    if (barraSector && sectorTitulo && btnGmaps && p.centroid) {
                        sectorTitulo.textContent = `Sector ${etiqueta}`;
                        btnGmaps.href = `https://www.google.com/maps/dir/?api=1&destination=${p.centroid[1].toFixed(6)},${p.centroid[0].toFixed(6)}`;
                        barraSector.style.display = 'flex';
                    }

                    if (ajustarCamara && p.bbox) {
                        map.fitBounds(p.bbox, {
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

        const srcCluster = map.getSource('encuestas-cluster-source');
        if (srcCluster) srcCluster.setData(geojsonFC);

        // Modos: Puntos vs Clústeres
        const isCluster = (AppState.modoVisualizacion === 'cluster');
        const showLabels = AppState.mostrarEtiquetas ? 'visible' : 'none';

        if (map.getLayer('puntos-layer')) {
            map.setLayoutProperty('puntos-layer', 'visibility', !isCluster ? 'visible' : 'none');
        }
        if (map.getLayer('puntos-label-layer')) {
            map.setLayoutProperty('puntos-label-layer', 'visibility', !isCluster ? showLabels : 'none');
        }
        if (map.getLayer('clusters-circle')) {
            map.setLayoutProperty('clusters-circle', 'visibility', isCluster ? 'visible' : 'none');
        }
        if (map.getLayer('clusters-count')) {
            map.setLayoutProperty('clusters-count', 'visibility', isCluster ? 'visible' : 'none');
        }
        if (map.getLayer('cluster-unclustered-point')) {
            map.setLayoutProperty('cluster-unclustered-point', 'visibility', isCluster ? 'visible' : 'none');
        }
        if (map.getLayer('cluster-unclustered-label')) {
            map.setLayoutProperty('cluster-unclustered-label', 'visibility', isCluster ? showLabels : 'none');
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
    // TABLA DE RENDIMIENTO POR ENCUESTADOR
    // =========================================================================
    function agruparPorEncuestador(encuestas) {
        const grupos = new Map();
        const total = encuestas.length;

        for (let i = 0; i < total; i++) {
            const enc = encuestas[i];
            const codEnc = String(enc.encuestador || enc.C_digo_encuestador || campo(enc, AppState.config.campoEncuestador) || 'Sin asignar');

            let g = grupos.get(codEnc);
            if (!g) {
                g = {
                    id: codEnc,
                    encuestas: [],
                    totalMins: 0,
                    validDurCount: 0,
                    supervisor: enc.supervisor || enc.C_digo_Supervisor || '',
                    promDuracion: 'Sin registro'
                };
                grupos.set(codEnc, g);
            }

            g.encuestas.push(enc);

            // Cálculo O(1) de duración por encuesta
            const s = enc.start;
            const end = enc.end;
            if (s && end) {
                const d1 = new Date(s).getTime();
                const d2 = new Date(end).getTime();
                const diff = (d2 - d1) / 60000;
                if (diff > 0.3 && diff < 300) {
                    g.totalMins += diff;
                    g.validDurCount++;
                }
            }
        }

        const resultado = [];
        for (const g of grupos.values()) {
            if (g.validDurCount > 0) {
                const prom = g.totalMins / g.validDurCount;
                g.promDuracion = prom < 1 ? `${Math.round(prom * 60)} seg prom.` : `${prom.toFixed(1)} min prom.`;
            } else {
                g.promDuracion = 'Sin registro de tiempo';
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
            datos = datos.filter(g => g.id.toLowerCase().includes(term));
        }

        // Ordenamiento
        datos.sort((a, b) => {
            let valA, valB;
            switch(AppState.ordenTabla.columna) {
                case 'encuestador':
                    valA = parseInt(a.id, 10) || a.id;
                    valB = parseInt(b.id, 10) || b.id;
                    break;
                case 'encuestas':
                default:
                    valA = a.encuestas.length;
                    valB = b.encuestas.length;
            }

            if (valA < valB) return AppState.ordenTabla.asc ? -1 : 1;
            if (valA > valB) return AppState.ordenTabla.asc ? 1 : -1;
            return 0;
        });

        UI.tablaEncuestadoresBody.innerHTML = '';

        if (datos.length === 0) {
            if (UI.emptyState) UI.emptyState.style.display = 'flex';
            return;
        }

        if (UI.emptyState) UI.emptyState.style.display = 'none';

        const fragment = document.createDocumentFragment();

        datos.forEach(grupo => {
            const tr = document.createElement('tr');
            if (AppState.encuestadorSeleccionado === grupo.id) {
                tr.classList.add('selected');
            }

            const supervisorId = grupo.supervisor || (grupo.encuestas[0] ? (grupo.encuestas[0].supervisor || grupo.encuestas[0].C_digo_Supervisor || '') : '');
            const colorSupervisor = PALETA_SUPERVISORES[supervisorId] || PALETA_SUPERVISORES.default;

            tr.innerHTML = `
                <td>
                    <div class="cs-enc-card">
                        <div class="cs-enc-avatar" style="--enc-color:${colorSupervisor};">
                            <svg style="width:12px;height:12px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                        </div>
                        <div class="cs-enc-meta">
                            <div class="cs-enc-name">Encuestador #${grupo.id}</div>
                            <div class="cs-enc-sub">
                                <svg class="cs-icon cs-icon--sm" style="width:11px;height:11px;opacity:0.7;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                <span>${grupo.promDuracion}</span>
                            </div>
                        </div>
                    </div>
                </td>
                <td style="text-align:right;">
                    <span class="cs-enc-total-pill">${grupo.encuestas.length}</span>
                </td>
            `;

            tr.addEventListener('click', () => seleccionarEncuestador(grupo.id));

            fragment.appendChild(tr);
        });

        UI.tablaEncuestadoresBody.appendChild(fragment);
    }

    function seleccionarEncuestador(id) {
        if (AppState.encuestadorSeleccionado === id) {
            AppState.encuestadorSeleccionado = null;
            mostrarToast('Mostrando todos los encuestadores', 'info');
        } else {
            AppState.encuestadorSeleccionado = id;
            mostrarToast(`Filtrado por Encuestador #${id}`, 'info');
        }
        renderizarVista();
    }

    // =========================================================================
    // EVENTOS Y CONTROLES
    // =========================================================================
    function configurarEventos() {
        // 1. Filtro Supervisor
        if (UI.supervisorFilter) {
            UI.supervisorFilter.addEventListener('change', (e) => {
                AppState.supervisorSeleccionado = e.target.value;
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

        // 4. Filtro Fecha
        if (UI.fechaFilter) {
            UI.fechaFilter.addEventListener('change', (e) => {
                AppState.fechaSeleccionada = e.target.value;
                renderizarVista(true, true);
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

        // 5. Conmutador de Modo: Puntos vs Agrupado
        if (UI.btnModoPuntos && UI.btnModoCluster) {
            UI.btnModoPuntos.addEventListener('click', () => {
                UI.btnModoPuntos.classList.add('active');
                UI.btnModoCluster.classList.remove('active');
                AppState.modoVisualizacion = 'puntos';
                const encuestas = obtenerEncuestasFiltradas();
                actualizarMapa(encuestas);
            });

            UI.btnModoCluster.addEventListener('click', () => {
                UI.btnModoCluster.classList.add('active');
                UI.btnModoPuntos.classList.remove('active');
                AppState.modoVisualizacion = 'cluster';
                const encuestas = obtenerEncuestasFiltradas();
                actualizarMapa(encuestas);
            });
        }

        // 6. Conmutador de Etiquetas: Activadas vs Desactivadas
        if (UI.btnEtiquetasOn && UI.btnEtiquetasOff) {
            UI.btnEtiquetasOn.addEventListener('click', () => {
                AppState.mostrarEtiquetas = true;
                UI.btnEtiquetasOn.classList.add('active');
                UI.btnEtiquetasOff.classList.remove('active');
                actualizarClaseZoom();
                mostrarToast('Etiquetas activadas en el mapa', 'info');
            });

            UI.btnEtiquetasOff.addEventListener('click', () => {
                AppState.mostrarEtiquetas = false;
                UI.btnEtiquetasOff.classList.add('active');
                UI.btnEtiquetasOn.classList.remove('active');
                actualizarClaseZoom();
                mostrarToast('Etiquetas desactivadas (modo inteligente)', 'info');
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
