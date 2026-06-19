# Quiniela Mundialista 2026 · GitHub Pages + Supabase

## 1) Publicar en GitHub Pages

1. Crear un repositorio en GitHub, por ejemplo `quiniela-mundial-2026`.
2. Subir todos los archivos de esta carpeta.
3. Entrar a **Settings > Pages**.
4. En **Build and deployment**, seleccionar **Deploy from a branch**.
5. Seleccionar rama `main` y carpeta `/root`.
6. Guardar. GitHub generará una URL pública.

## 2) Crear base de datos Supabase

1. Crear proyecto en Supabase.
2. Ir a **SQL Editor**.
3. Abrir el archivo `supabase_schema.sql`.
4. Copiar todo el contenido, pegarlo y ejecutar **Run**.
5. Cambiar el PIN de administrador ejecutando:

```sql
update public.app_settings
set value = 'TU-PIN-SECRETO'
where key = 'admin_pin';
```

## 3) Conectar la página con Supabase

1. En Supabase, ir a **Project Settings > API**.
2. Copiar:
   - `Project URL`
   - `anon public key`
3. Abrir `config.js`.
4. Completar:

```js
window.QUINIELA_CONFIG = {
  appName: 'Quiniela Mundialista 2026',
  supabaseUrl: 'https://TU-PROYECTO.supabase.co',
  supabaseAnonKey: 'TU-ANON-KEY',
  lockPredictionsAtKickoff: true
};
```

5. Subir el cambio a GitHub.

## 4) Uso

- Participantes: cualquier persona puede registrarse.
- Pronósticos: cada participante selecciona su nombre y guarda marcadores.
- Resultados reales: solo se guardan usando el PIN administrador.
- Ranking: se recalcula automáticamente con esta regla:
  - 1 punto por pegar ganador/empate.
  - 1 punto por pegar goles del equipo local.
  - 1 punto por pegar goles del equipo visitante.
  - 1 punto extra por marcador exacto.
  - Máximo: 4 puntos por partido.

## Nota importante de seguridad

Esta versión está pensada para una quiniela entre amigos/familia/equipo. Permite pronósticos públicos para mantener el flujo simple desde celular. Para una quiniela con dinero real o control estricto, conviene agregar login individual por participante.


## Cambios v3
- Horarios corregidos a Costa Rica (UTC-6), calculados desde el horario ET oficial de FIFA menos 2 horas.
- Nueva vista **Grupos** con tabla de posiciones por grupo.
- Reglas de clasificación: victoria 3 pts, empate 1 pt, derrota 0 pts; desempates principales por puntos, diferencia de goles, goles a favor y enfrentamientos directos.


## Ajuste de banderas
- Curaçao corregido a 🇨🇼.
- England y Scotland usan banderas regionales Unicode.
- Partidos de eliminación directa mantienen ⚪ porque aún no tienen equipos definidos.
