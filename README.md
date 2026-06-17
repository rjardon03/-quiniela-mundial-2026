# Quiniela Mundialista 2026 - GitHub Pages

Sitio estático listo para publicar en GitHub Pages. Incluye calendario completo, registro de participantes, pronósticos, resultados reales, ranking y exportación a Excel.

## Publicación rápida
1. Crear un repositorio nuevo en GitHub.
2. Subir todos los archivos de esta carpeta.
3. Ir a Settings > Pages.
4. En Source seleccionar `Deploy from a branch`.
5. Branch: `main`, folder: `/root`.
6. Abrir el link público generado por GitHub Pages.

## Importante
GitHub Pages no guarda información centralizada porque es estático. Por defecto, esta versión guarda en el navegador de cada usuario.

Para que todos participen desde celular y vean la misma tabla, activar Supabase en `config.js` y crear estas tablas:

```sql
create table participants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table predictions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid references participants(id),
  match_id int not null,
  home_goals int,
  away_goals int,
  updated_at timestamptz default now(),
  unique(participant_id, match_id)
);

create table results (
  match_id int primary key,
  home_goals int,
  away_goals int,
  updated_at timestamptz default now()
);
```

Activar Row Level Security según el nivel de control que se quiera. Para una quiniela simple y cerrada, puede dejarse con políticas de lectura/escritura pública durante el torneo, o restringirse por password más adelante.
