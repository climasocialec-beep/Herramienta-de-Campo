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
const ASSET_ID = limpiarVar(process.env.ASSET_ID);
const API_TOKEN = limpiarVar(process.env.API_TOKEN);
const LIMITE_POR_PAGINA = 500;
const CACHE_TTL_MS = (Number(process.env.CACHE_TTL_SEGUNDOS) || 90) * 1000;
const TIMEOUT_MS = 30000;

if (!ASSET_ID || !API_TOKEN) {
    console.error("[SUPERVISOR] ⚠  Faltan variables de entorno: ASSET_ID y/o API_TOKEN.");
    console.error("[SUPERVISOR]    Verifica las variables de entorno en Render o archivo .env.");
}

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

// Sirve la carpeta pública (frontend) con caché óptima
app.use(express.static(path.join(__dirname, "public"), {
    dotfiles: "deny",
    etag: true,
    setHeaders: (res, filePath) => {
        if (/\.(?:geojson|svg|png|jpg|webp|woff2|woff|ttf|pbf)$/i.test(filePath)) {
            // Activos pesados (GeoJSON, fuentes e imágenes): 7 días de caché inmutable
            res.setHeader("Cache-Control", "public, max-age=604800, immutable");
        } else if (/\.(?:html|css|js)$/i.test(filePath)) {
            // Archivos de código: revalidación rápida con ETag
            res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
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
    for (let i = 0; i < claves.length; i++) {
        const k = claves[i];
        if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return String(obj[k]).trim();
    }
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        for (let j = 0; j < claves.length; j++) {
            const k = claves[j];
            if (key.endsWith("/" + k) && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
                return String(obj[key]).trim();
            }
        }
        if (typeof obj[key] === "object" && obj[key] !== null) {
            const nested = extraerValor(obj[key], claves);
            if (nested) return nested;
        }
    }
    return "";
}

function normalizarEncuesta(raw) {
    const id = raw._id || "";
    const submissionTime = raw._submission_time || "";
    const start = raw.start || extraerValor(raw, ["start", "inicio"]) || "";
    const end = raw.end || extraerValor(raw, ["end", "fin"]) || "";
    
    // Geolocation
    let geo = null;
    if (Array.isArray(raw._geolocation) && raw._geolocation.length >= 2 && raw._geolocation[0] !== null) {
        geo = [Number(raw._geolocation[0]), Number(raw._geolocation[1])];
    }

    const campoEnc = process.env.CAMPO_ENCUESTADOR || "C_digo_encuestador";
    const campoSup = process.env.CAMPO_SUPERVISOR || "C_digo_Supervisor";

    const encuestador = extraerValor(raw, [campoEnc, "C_digo_encuestador", "encuestador", "cod_encuestador"]);
    const supervisor = extraerValor(raw, [campoSup, "C_digo_Supervisor", "supervisor", "cod_supervisor"]);
    const sc = extraerValor(raw, ["sc", "codigo_sc", "sector_censal"]);
    const tipologia = (extraerValor(raw, ["tipologia", "TIPOLOGIA", "tipo_sc"]) || "").toUpperCase();
    const barrio = extraerValor(raw, ["BARRIO_O_SECTOR", "barrio", "sector", "barrio_sector"]);
    const parroquia = extraerValor(raw, ["PARROQUIA", "parroquia", "nom_parroquia", "parr"]);

    return {
        _id: id,
        _submission_time: submissionTime,
        start,
        end,
        _geolocation: geo,
        [campoEnc]: encuestador,
        [campoSup]: supervisor,
        encuestador,
        supervisor,
        sc,
        tipologia,
        barrio,
        parroquia
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
        let url = `https://kf.kobotoolbox.org/api/v2/assets/${encodeURIComponent(ASSET_ID)}/data/?limit=${LIMITE_POR_PAGINA}`;
        const resultadosRaw = [];
        let total = 0;

        while (url) {
            const respuesta = await fetchConReintento(url, {
                headers: { Authorization: `Token ${API_TOKEN}` },
                timeout: TIMEOUT_MS,
                maxRedirects: 5
            });

            total = respuesta.data.count;
            resultadosRaw.push(...respuesta.data.results);
            url = respuesta.data.next;
        }

        // Normalización ultra-ligera en memoria: reduce payload en un 95%
        const resultados = resultadosRaw.map(normalizarEncuesta);

        cache.datos = { total, resultados, obtenidoEn: Date.now() };
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
        cacheActiva: Boolean(cache.datos),
        cacheEdadSegundos: cache.datos
            ? Math.round((Date.now() - cache.timestamp) / 1000)
            : null
    });
});

app.get("/api/config", (req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    res.json({
        nombreProyecto: process.env.NOMBRE_PROYECTO || "Supervisión de Campo",
        metaEncuestas: Number(process.env.META_ENCUESTAS) || 1600,
        campoEncuestador: process.env.CAMPO_ENCUESTADOR || "C_digo_encuestador",
        campoSupervisor: process.env.CAMPO_SUPERVISOR || "C_digo_Supervisor"
    });
});

app.get("/api/encuestas", async (req, res) => {
    try {
        if (!ASSET_ID || !API_TOKEN) {
            return res.json({
                total: 0,
                resultados: [],
                obtenidoEn: Date.now(),
                mensaje: "Esperando configuración de nuevo ASSET_ID"
            });
        }
        const datos = await obtenerDatosKobo();
        res.set("Cache-Control", "no-cache");
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

// Cualquier otra ruta → index (SPA)
app.use((req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// =======================================
// ARRANQUE
// =======================================

app.listen(PORT, () => {
    console.log(`[SUPERVISOR] ✅ Servidor iniciado en http://localhost:${PORT}`);
    console.log(`[SUPERVISOR] Kobo ${ASSET_ID ? "configurado ✓" : "NO configurado (faltan ASSET_ID/API_TOKEN)"}`);
});
