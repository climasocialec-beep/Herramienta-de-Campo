# 🗺️ Arquitectura de Navegación y Estándares GIS Móvil

Este documento define las reglas de ingeniería implementadas para garantizar navegación fluida en todos los dispositivos (iPhone, iPad/Tablets, Android y PC).

---

## 1. Reglas Inviolables de Interacción

### A. Directiva CSS de Hardware (`touch-action`)
Todo contenedor que aloje el canvas de MapLibre (`.cs-map-wrapper`, `#map`, `.maplibregl-canvas-container`, `.maplibregl-canvas`) **DEBE** tener:
```css
touch-action: none !important;
-webkit-user-select: none;
user-select: none;
```
Esto previene que navegadores móviles (iOS Safari / Android Chrome) secuestren los eventos táctiles para scroll de página nativo.

### B. Intercepción No-Pasiva (`passive: false`)
En `public/script.js`, el contenedor `#map` tiene un controlador de gestos con:
```javascript
mapContainer.addEventListener('touchmove', (e) => {
    if (e.cancelable) e.preventDefault();
}, { passive: false });
```
Sin esta regla, WebKit (iOS) emite un evento `touchcancel` inmediatamente tras iniciar el arrastre, congelando el mapa.

### C. Prohibición de `map.resize()` en el evento `idle`
**NUNCA** registrar:
```javascript
// ❌ PROHIBIDO:
map.on('idle', () => map.resize());
```
En MapLibre GL JS, `map.resize()` invoca internamente `this.stop()`, cancelando inmediatamente cualquier paneo, inercia de arrastre o transición de cámara en curso.

### D. Doble Capa de Respaldo (`map.panBy`)
Si por alguna condición del sistema operativo el gestor interno de MapLibre queda inactivo (`!map.dragPan.isActive()`), el controlador universal despacha directamente el desplazamiento en píxeles:
```javascript
map.panBy([-dx, -dy], { duration: 0 });
```
Esto asegura 100% de confiabilidad en cualquier dispositivo sin depender de peculiaridades del navegador.

---

## 2. Ergonomía Responsiva de Filtros

En pantallas medianas y móviles:
- `.cs-ribbon-main` debe ser `flex-direction: column; width: 100%;`.
- El encabezado `.cs-ribbon-heading` ocupa el 100% con un divisor sutil inferior.
- `.cs-ribbon-grid` se distribuye en 2 columnas (`repeat(2, minmax(0, 1fr))`) para Supervisor, Parroquia y Sector Censal.
- El filtro de Fecha (`.cs-ribbon-field--date`) ocupa el 100% de la fila inferior (`grid-column: 1 / -1`) para alojar las pastillas rápidas y el selector desplegable sin truncar textos.
