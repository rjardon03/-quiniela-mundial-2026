# Quiniela Mundialista 2026 — V5.5 Hotfix

Corrección sobre V5.5 para restaurar navegación y vistas:

- Pronósticos
- Eliminatorias
- Mi Mundial
- Ranking
- Admin

Cambios:

- `assets/app.js` ahora protege cada vista con manejo de errores independiente.
- Si una vista falla, ya no bloquea las demás.
- Se normaliza el estado local y remoto para evitar errores por datos incompletos.
- Se mantiene el look & feel V5.5.
- Se mantienen banderas SVG de England y Scotland.

Archivos principales a reemplazar en GitHub:

- `index.html`
- `assets/app.js`
- `assets/styles.css`
- `data/matches.json`
- `data/teams.json`

Después de subirlos, hacer recarga dura:

- Mac: CMD + SHIFT + R
- Windows: CTRL + F5

Si GitHub Pages tarda, esperar 1-2 minutos.
