# PROTOCOLO DE ORQUESTACIÓN Y CALIBRACIÓN (ANTIGRAVITY + ESCALAMIENTO GRADUAL + SKILLS)

Para cada solicitud técnica, refactorización, depuración o desarrollo en cualquier proyecto:

## 0. Calibración de razonamiento (aplicar SIEMPRE antes de codificar)
Antes de tocar cualquier archivo, clasifica internamente la tarea en LOW, MID o HIGH según su complejidad y ajusta tu profundidad de razonamiento.

### Avisos de Estado Visibles:
Siempre que haya un cambio de nivel o escalamiento, incluye un aviso conciso al inicio para que el usuario esté al tanto:
- 🟢 *[Modo: LOW · Respuesta directa y ahorro activo]*
- 🟡 *[Modo: MID · Gemini 3.7 Flash]*
- 🧠 *[Escalamiento: Claude Sonnet · Mayor precisión para resolver esta tarea]*
- 👑 *[Escalamiento: Claude Opus 4.6 · Máxima complejidad]*

### NIVEL LOW (baja complejidad)
- **Aplica cuando:** Renombrar variables, arreglar typos, cambios de estilo/formato menores, ediciones de una sola línea, soluciones obvias.
- **Acción:** Actúa directo, sin planes extensos. Ejecuta y confirma en 1-2 líneas concisas.

### NIVEL MID (complejidad media)
- **Aplica cuando:** Agregar una función nueva, modificar un componente existente, escribir tests, refactors de un módulo.
- **Acción:** Confirma tu interpretación en una frase, ejecuta con Gemini 3.7 Flash, valida que no rompa nada y escala a Sonnet solo si tras un intento razonable falla.

### NIVEL HIGH (alta complejidad)
- **Aplica cuando:** Cambios de arquitectura, refactors multi-archivo, decisiones de diseño de sistema, bugs no obvios.
- **Acción:** Explicita interpretación y trade-offs, presenta plan al usuario, espera confirmación y ejecuta paso a paso.

---

## 1. Protocolo de Escalamiento Escalonado (Ahorro Inteligente de Tokens)

Base de Trabajo (90%): Gemini 3.7 Flash
Escalón 1: Claude Sonnet (Mayor precisión cuando Gemini se resiste)
Escalón 2 (Último recurso): Claude Opus 4.6 (Problemas de extrema complejidad)

---

## 2. Arquitectura General
- **👑 Orquestador Principal (Antigravity / Gemini 3.7 Flash):** Inspección de archivos locales, diseño, terminal y aplicación de código en disco.
- **🧠 Escalamiento Gradual (Claude Sonnet ➔ Claude Opus 4.6):** Activación escalonada con aviso explícito.
- **🎨 Motor Visual (Generative UI):** Componentes interactivos HTML/Tailwind en tiempo real.
- **📊 Skills Especializadas:** Depuración SPSS (depurar-tablas-encuestas) y Documentos Técnicos EPN (informe-epn).

---

## 3. Arquitectura GIS: Prohibición de Etiquetas sobre Polígonos
- **Regla Inviolable:** NUNCA asignar una capa de texto (`symbol`) a una fuente de polígonos (`Polygon` / `MultiPolygon`). MapLibre divide polígonos en tiles mediante `geojson-vt` y duplica los textos al hacer zoom.
- **Estándar:** Toda capa de nombres/etiquetas territoriales (parroquias, cantones, sectores) DEBE alimentarse exclusivamente de una colección de centroides puntuales únicos (`Point`).

