require("dotenv").config();

const path = require("path");
const express = require("express");
const axios = require("axios");
const compression = require("compression");

const app = express();

// =======================================
// MIDDLEWARE DE COMPRESIÓN GZIP (ALTO RENDIMIENTO)
// =======================================
app.use(compression({
    threshold: 1024,
    level: 6
}));

// =======================================
// CONFIGURACIÓN
// =======================================

function limpiarVar(val) {
    if (!val) return "";
    let s = String(val).trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).trim();
    }
    return s;
}

const PORT = Number(process.env.PORT) || 3001;

// El identificador y el token se reciben por variables de entorno de Render (con fallback oficial de Otavalo).
const ASSET_ID = limpiarVar(
    process.env.ASSET_ID ||
    process.env.ASSET_ID_OTAVALO ||
    process.env.ASSET_ID_MORONA ||
    process.env.ASSET_ID_PICHINCHA ||
    "aqytRCeMM2bpTSgPnzhdRB"
);
const API_TOKEN = limpiarVar(
    process.env.API_TOKEN ||
    process.env.KOBO_API_TOKEN ||
    process.env.KOBO_TOKEN
);

function campoFormularioActual(valor, esperado, aliasAnteriores) {
    const candidato = limpiarVar(valor);
    return !candidato || aliasAnteriores.includes(candidato.toLowerCase()) ? esperado : candidato;
}

// El XLSForm vigente de Otavalo usa codenc/codsup.
const CAMPO_ENCUESTADOR = campoFormularioActual(process.env.CAMPO_ENCUESTADOR, "codenc", ["cenc", "cod_encu", "codencu", "encuestador"]);
const CAMPO_SUPERVISOR = campoFormularioActual(process.env.CAMPO_SUPERVISOR, "codsup", ["csup", "cod_sup", "codsup", "supervisor"]);
const LIMITE_POR_PAGINA = 3000;
const CACHE_TTL_MS = (Number(process.env.CACHE_TTL_SEGUNDOS) || 90) * 1000;
const TIMEOUT_MS = 30000;

console.log(`[SUPERVISOR] 📡 Formulario Kobo configurado: ${ASSET_ID} (${API_TOKEN ? "Token presente ✓" : "Sin token ⚠️"})`);

// =======================================
// MIDDLEWARE DE SEGURIDAD
// =======================================

app.use((req, res, next) => {
    res.set({
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "Referrer-Policy": "no-referrer",
        "X-XSS-Protection": "0"
    });
    next();
});

// Sirve la carpeta pública (frontend) con caché óptima y control anti-stale estricto
app.use(express.static(path.join(__dirname, "public"), {
    dotfiles: "deny",
    etag: true,
    setHeaders: (res, filePath) => {
        if (/service-worker\.js$/i.test(filePath)) {
            // Service Worker: NUNCA almacenar en caché, siempre validar con el servidor
            res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
        } else if (/\.(?:html)$/i.test(filePath)) {
            // HTML: nunca almacenar en caché bajo ninguna circunstancia (evita títulos y cantones obsoletos)
            res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
        } else if (/\.(?:json|webmanifest)$/i.test(filePath)) {
            // Manifiesto y configuraciones
            res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
        } else if (/\.geojson$/i.test(filePath)) {
            // GeoJSON: revalidación inmediata (permite actualizar capas sin caché residual)
            res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
        } else if (/\.(?:css|js)$/i.test(filePath)) {
            // Código CSS y JS de la aplicación: sin caché para forzar la versión actual en móviles/Brave
            res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
        } else if (/\.(?:svg|png|jpg|webp|woff2|woff|ttf|pbf)$/i.test(filePath)) {
            // Fuentes e imágenes estáticas
            res.setHeader("Cache-Control", "public, max-age=604800, immutable");
        }
    }
}));

// =======================================
// CACHÉ EN MEMORIA PARA KOBO
// =======================================

let cache = {
    datos: null,
    timestamp: 0,
    enProceso: null
};


function extraerValor(obj, claves) {
    if (!obj || typeof obj !== "object") return "";
    const valorTexto = value => value === undefined || value === null || typeof value === "object"
        ? "" : String(value).trim();
    for (let i = 0; i < claves.length; i++) {
        const k = claves[i];
        const valor = valorTexto(obj[k]);
        if (valor) return valor;
    }
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        for (let j = 0; j < claves.length; j++) {
            const k = claves[j];
            const valor = valorTexto(obj[key]);
            if (key.endsWith("/" + k) && valor) {
                return valor;
            }
        }
        if (typeof obj[key] === "object" && obj[key] !== null) {
            const nested = extraerValor(obj[key], claves);
            if (nested) return nested;
        }
    }
    return "";
}

function normalizarCoordenadas(valores, validarEcuador = false) {
    if (!Array.isArray(valores) || valores.length < 2) return null;
    const par = valores.slice(0, 2);
    if (par.some(v => (typeof v !== "number" && typeof v !== "string") || String(v).trim() === "")) return null;
    let [lat, lng] = par.map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    // Invertir si vienen como [lng, lat]
    if (lat < -50 && lng > -10 && lng < 10) {
        const tmp = lat; lat = lng; lng = tmp;
    }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    if (validarEcuador && !(lat >= -5.0 && lat <= 2.5 && lng >= -92.0 && lng <= -75.0)) return null;
    return [lat, lng];
}

// Diccionarios oficiales de decodificación de choices de Kobo (Encuesta Cantonal Otavalo 2026 - XLSForm oficial)
const PARROQUIAS_FORMULARIO = {
    "1040": "DR MIGUEL EGAS / PEGUCHE",
    "1215": "EUGENIO ESPEJO",
    "1360": "GONZALEZ SUAREZ",
    "2785": "PATAQUI",
    "3490": "SAN JOSE DE QUICHINCHE",
    "3525": "SAN JUAN DE ILUMAN",
    "3590": "SAN PABLO",
    "3630": "SAN RAFAEL",
    "3810": "SELVA ALEGRE",
    "5490": "JORDAN",
    "5980": "SAN LUIS"
};

const CANTONES_FORMULARIO = {
    "1004": "Otavalo",
    "035": "Otavalo",
    "otavalo": "Otavalo"
};

const TIPOLOGIAS_FORMULARIO = {
    "1": "A", "2": "B", "3": "C", "4": "D", "5": "E", "6": "F", "7": "G", "8": "H",
    "a": "A", "b": "B", "c": "C", "d": "D", "e": "E", "f": "F", "g": "G", "h": "H"
};

function normalizarEncuesta(raw) {
    const id = raw._id || "";
    const submissionTime = raw._submission_time || "";
    const start = raw.start || extraerValor(raw, ["start", "inicio"]) || "";
    const end = raw.end || extraerValor(raw, ["end", "fin"]) || "";
    
    // Geolocation: tolerante a _geolocation, ya_registrado, gps, ubicacion_gps, etc.
    let geo = normalizarCoordenadas(raw._geolocation);
    if (!geo) {
        const gps = extraerValor(raw, [
            "ya_registrado", "gps", "ubicacion_gps", "coordenadas",
            "geopoint", "punto_gps", "punto", "ubicacion"
        ]);
        if (gps) geo = normalizarCoordenadas(gps.split(/\s+/));
    }
    // Fallback de escaneo universal de claves si aún no hay coordenadas
    if (!geo) {
        for (const [k, v] of Object.entries(raw)) {
            if (typeof v === "string" && v.includes(" ")) {
                const partes = v.trim().split(/\s+/);
                if (partes.length >= 2) {
                    const testGeo = normalizarCoordenadas(partes, true);
                    if (testGeo) {
                        geo = testGeo;
                        break;
                    }
                }
            }
        }
    }

    const campoEnc = CAMPO_ENCUESTADOR;
    const campoSup = CAMPO_SUPERVISOR;

    let encuestador = extraerValor(raw, [campoEnc, "cenc", "codenc", "codencu", "cod_encu", "cod_enc", "C_digo_encuestador", "encuestador", "cod_encuestador"]);
    let supervisor = extraerValor(raw, [campoSup, "csup", "codsup", "cod_sup", "C_digo_Supervisor", "supervisor", "cod_supervisor"]);


    // Consentimiento: 1 = SÍ, 2 = NO / Rechazo
    const rawConsen = extraerValor(raw, ["consent", "consen", "consentimiento", "acepta"]);
    const noConsent = rawConsen === "2" || String(rawConsen).trim().toLowerCase() === "no" || String(rawConsen).trim().toLowerCase() === "rechaza";
    const consentimiento = noConsent ? "NO" : "SI";

    // En el XLSForm vigente el punto se guarda en group_localizacion/seccensal.
    const sc = extraerValor(raw, ["seccensal", "sc", "sectorcen", "p_ref", "codigo_sc", "sector_censal", "sector", "punto", "num_muestra"]);
    const rawTipol = String(extraerValor(raw, ["tipol", "tipologia", "TIPOLOGIA", "tipo_sc"]) || "").trim().toLowerCase();
    const tipologia = TIPOLOGIAS_FORMULARIO[rawTipol] || rawTipol.toUpperCase();
    const barrio = extraerValor(raw, ["barrio", "barr", "BARRIO_O_SECTOR", "sector", "barrio_sector"]);
    
    // Parroquia: decodificación por choices del XLSForm oficial
    const rawParroquia = extraerValor(raw, ["parroquia", "PARROQUIA", "nom_parroquia", "parr"]) || "";
    const parroquia = PARROQUIAS_FORMULARIO[rawParroquia] || String(rawParroquia).trim().toUpperCase();

    // Cantón: Extraer dinámicamente o decodificar (sin fallback forzado que contamine otros cantones)
    const rawCanton = extraerValor(raw, ["canton", "CANTON", "canton_nombre", "nom_can", "nom_canton"]) || "";
    const canton = CANTONES_FORMULARIO[rawCanton] || String(rawCanton).trim();

    // Circunscripción (No aplica en Morona Santiago)
    const circunscripcion = "";

    // Extracción tolerante de Género (p1: 1=Masculino, 2=Femenino, 3=LGBTIQ+, 0=Otro; p1_1: 1=Hombre, 2=Mujer)
    const rawGen = extraerValor(raw, [
        "p1", "p1_1", "genero", "p_genero", "sexo", "gender",
        "1. ¿CUÁL ES SU GÉNERO?", "1._CU_L_ES_SU_G_NERO",
        "genero_resp", "p1_genero"
    ]) || "";

    let genero = rawGen;
    if (rawGen === "1" || rawGen.toLowerCase().includes("masc") || rawGen.toLowerCase().includes("hombre")) {
        genero = "Hombre";
    } else if (rawGen === "2" || rawGen.toLowerCase().includes("fem") || rawGen.toLowerCase().includes("mujer")) {
        genero = "Mujer";
    } else if (rawGen === "3") {
        genero = "LGBTIQ+";
    } else if (rawGen === "0") {
        genero = "Otro";
    }

    // Edad (p2: edad cumplida en años)
    const edadRaw = extraerValor(raw, [
        "p2", "edad", "p_edad", "age",
        "2. ¿CUÁL ES SU EDAD? (edad cumplida en años)",
        "2._CU_L_ES_SU_EDAD_edad_cumplida_en_a_os",
        "2. ¿CUÁNTOS AÑOS TIENE?",
        "p2_edad"
    ]) || "";
    const edadNum = Number(edadRaw);
    const edad = (!isNaN(edadNum) && edadNum > 0 && edadNum < 120) ? edadNum : null;

    return {
        _id: id,
        _submission_time: submissionTime,
        start,
        end,
        _geolocation: geo,
        [campoEnc]: encuestador,
        [campoSup]: supervisor,
        cod_enc: encuestador,
        cod_sup: supervisor,
        cenc: encuestador,
        csup: supervisor,
        encuestador,
        supervisor,
        sc,
        tipologia,
        barrio,
        parroquia,
        canton,
        circunscripcion,
        genero,
        edad,
        consentimiento,
        consen: rawConsen || (noConsent ? "2" : "1")
    };
}

async function fetchConReintento(url, opciones, maxReintentos = 2) {
    for (let intento = 0; intento <= maxReintentos; intento++) {
        try {
            return await axios.get(url, opciones);
        } catch (err) {
            const esTransitorio = !err.response || err.response.status >= 500 || err.code === "ECONNABORTED";
            if (intento < maxReintentos && esTransitorio) {
                const espera = (intento + 1) * 1200;
                await new Promise(r => setTimeout(r, espera));
                continue;
            }
            throw err;
        }
    }
}

async function obtenerDatosKobo() {
    const ahora = Date.now();

    // Cache válida: devolver los datos en memoria
    if (cache.datos && ahora - cache.timestamp < CACHE_TTL_MS) {
        return cache.datos;
    }

    // Evitar peticiones duplicadas en paralelo
    if (cache.enProceso) {
        return cache.enProceso;
    }

    cache.enProceso = (async () => {
        const origenKobo = new URL(`https://kf.kobotoolbox.org/api/v2/assets/${encodeURIComponent(ASSET_ID)}/data/`);
        let url = `${origenKobo.href}?limit=${LIMITE_POR_PAGINA}`;
        const resultadosRaw = [];
        const paginasVisitadas = new Set();
        let total = null;

        while (url) {
            const pagina = new URL(url, origenKobo);
            if (pagina.origin !== origenKobo.origin || pagina.pathname !== origenKobo.pathname || pagina.username || pagina.password || paginasVisitadas.has(pagina.href)) {
                throw new Error("Paginación de Kobo inválida: destino ajeno al formulario o página repetida.");
            }
            paginasVisitadas.add(pagina.href);
            url = pagina.href;
            const respuesta = await fetchConReintento(url, {
                headers: { Authorization: `Token ${API_TOKEN}` },
                timeout: TIMEOUT_MS,
                maxRedirects: 0
            });

            const data = respuesta.data;
            if (!data || !Array.isArray(data.results) || !Number.isInteger(data.count) || data.count < 0 ||
                (data.next !== null && data.next !== undefined && typeof data.next !== "string")) {
                throw new Error("Respuesta de Kobo inválida: estructura de paginación no reconocida.");
            }
            total = data.count;
            resultadosRaw.push(...data.results);
            url = data.next;
        }
        if (resultadosRaw.length !== total) {
            throw new Error("Respuesta de Kobo incompleta: el conteo no coincide con las boletas recibidas.");
        }

        // Normalización ultra-ligera en memoria: reduce payload en un 95%
        // Se excluye código 98 (pruebas de campo) y encuestas sin consentimiento (consen == '2' o NO)
        const resultados = resultadosRaw
            .map(normalizarEncuesta)
            .filter(e => {
                if (String(e.encuestador).trim() === "98" || String(e.supervisor).trim() === "98") return false;
                if (e.consentimiento === "NO" || String(e.consen).trim() === "2") return false;
                return true;
            });

        cache.datos = { total: resultados.length, resultados, obtenidoEn: Date.now() };
        cache.timestamp = Date.now();
        return cache.datos;
    })();

    try {
        const datos = await cache.enProceso;
        return datos;
    } finally {
        cache.enProceso = null;
    }
}

// =======================================
// RUTAS DE API
// =======================================

app.get("/api/health", (req, res) => {
    res.json({
        estado: "ok",
        koboConfigurado: Boolean(ASSET_ID && API_TOKEN),
        cacheActiva: Boolean(cache.datos),
        cacheEdadSegundos: cache.datos
            ? Math.round((Date.now() - cache.timestamp) / 1000)
            : null
    });
});

const TITULO_OFICIAL = "Encuesta Cantonal Otavalo 2026";

app.get("/api/config", (req, res) => {
    res.set({
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0"
    });
    let nombre = process.env.NOMBRE_PROYECTO || TITULO_OFICIAL;

    let centroLng = process.env.MAPA_CENTRO_LNG ? Number(process.env.MAPA_CENTRO_LNG) : -78.2625;
    let centroLat = process.env.MAPA_CENTRO_LAT ? Number(process.env.MAPA_CENTRO_LAT) : 0.2245;

    res.json({
        nombreProyecto: nombre,
        metaEncuestas: Number(process.env.META_ENCUESTAS) || 500,
        campoEncuestador: CAMPO_ENCUESTADOR,
        campoSupervisor: CAMPO_SUPERVISOR,
        centroLng: centroLng,
        centroLat: centroLat,
        zoomInicial: process.env.MAPA_ZOOM_INICIAL ? Number(process.env.MAPA_ZOOM_INICIAL) : 11
    });
});

app.get("/api/encuestas", async (req, res) => {
    try {
        if (!ASSET_ID || !API_TOKEN) {
            return res.json({
                total: 0,
                resultados: [],
                obtenidoEn: Date.now(),
                mensaje: "Esperando configuración de formulario para " + (process.env.NOMBRE_PROYECTO || TITULO_OFICIAL)
            });
        }
        res.set({
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0"
        });
        // Si el cliente pide fresh=1 (botón de sync), se invalida la caché en memoria para consulta en vivo
        if (req.query.fresh === "1") {
            cache.datos = null;
            cache.timestamp = 0;
        }
        const datos = await obtenerDatosKobo();
        res.json(datos);
    } catch (error) {
        const mensaje = error.response
            ? `Kobo respondió ${error.response.status}`
            : error.code === "ECONNABORTED"
                ? "Kobo tardó demasiado en responder"
                : error.message;
        console.error(`[${new Date().toLocaleTimeString("es-EC")}] Error al consultar Kobo: ${mensaje}`);
        res.status(502).json({ error: "No fue posible acceder a Kobo.", detalle: mensaje });
    }
});

// Forzar refresco de caché
app.post("/api/sync", async (req, res) => {
    try {
        if (!ASSET_ID || !API_TOKEN) {
            return res.json({ estado: "ok", total: 0, obtenidoEn: Date.now(), mensaje: "Esperando ASSET_ID" });
        }
        cache.datos = null;
        cache.timestamp = 0;
        const datos = await obtenerDatosKobo();
        res.json({ estado: "ok", total: datos.total, obtenidoEn: datos.obtenidoEn });
    } catch (error) {
        res.status(502).json({ error: "No fue posible sincronizar con Kobo." });
    }
});

// API no encontrada
app.use("/api", (req, res) => {
    res.status(404).json({ error: "Ruta de API no encontrada." });
});

// Cualquier otra ruta → index (SPA con cero caché para móviles)
app.use((req, res) => {
    res.set({
        "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0"
    });
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// =======================================
// ARRANQUE
// =======================================

app.listen(PORT, () => {
    console.log(`[SUPERVISOR] ✅ Servidor iniciado en http://localhost:${PORT}`);
    console.log(`[SUPERVISOR] Kobo ${ASSET_ID ? "configurado ✓" : "NO configurado (faltan ASSET_ID/API_TOKEN)"}`);
});
