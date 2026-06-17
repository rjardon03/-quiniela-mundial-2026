-- Quiniela Mundialista 2026 · Supabase schema
-- Ejecutar en Supabase > SQL Editor > New query > Run.

create extension if not exists pgcrypto;

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.predictions (
  participant_id uuid not null references public.participants(id) on delete cascade,
  match_id integer not null,
  home_goals integer,
  away_goals integer,
  updated_at timestamptz not null default now(),
  primary key (participant_id, match_id),
  constraint predictions_non_negative check (
    (home_goals is null or home_goals >= 0) and
    (away_goals is null or away_goals >= 0)
  )
);

create table if not exists public.results (
  match_id integer primary key,
  home_goals integer,
  away_goals integer,
  updated_at timestamptz not null default now(),
  constraint results_non_negative check (
    (home_goals is null or home_goals >= 0) and
    (away_goals is null or away_goals >= 0)
  )
);

create table if not exists public.app_settings (
  key text primary key,
  value text not null
);

insert into public.app_settings(key, value)
values ('admin_pin', 'CAMBIAME-2026')
on conflict (key) do nothing;

alter table public.participants enable row level security;
alter table public.predictions enable row level security;
alter table public.results enable row level security;
alter table public.app_settings enable row level security;

-- Lectura pública para que todos vean participantes, pronósticos, resultados y ranking.
drop policy if exists participants_select_all on public.participants;
create policy participants_select_all on public.participants for select using (true);

drop policy if exists predictions_select_all on public.predictions;
create policy predictions_select_all on public.predictions for select using (true);

drop policy if exists results_select_all on public.results;
create policy results_select_all on public.results for select using (true);

-- Alta de participantes desde la página pública.
drop policy if exists participants_insert_all on public.participants;
create policy participants_insert_all on public.participants for insert with check (true);

-- Pronósticos: público para simplificar el juego familiar/grupal.
-- Nota: no es seguridad fuerte. Para una quiniela con dinero real, usar login por participante.
drop policy if exists predictions_insert_all on public.predictions;
create policy predictions_insert_all on public.predictions for insert with check (true);

drop policy if exists predictions_update_all on public.predictions;
create policy predictions_update_all on public.predictions for update using (true) with check (true);

-- No se crean políticas de escritura directa para results ni app_settings.
-- Los resultados reales se escriben solo por función RPC con PIN de administrador.

create or replace function public.admin_upsert_results(admin_pin text, payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_pin text;
  item jsonb;
begin
  select value into saved_pin from public.app_settings where key = 'admin_pin';
  if saved_pin is null or admin_pin is null or admin_pin <> saved_pin then
    raise exception 'PIN de administrador inválido';
  end if;

  for item in select * from jsonb_array_elements(payload)
  loop
    insert into public.results(match_id, home_goals, away_goals, updated_at)
    values (
      (item->>'match_id')::integer,
      nullif(item->>'home_goals','')::integer,
      nullif(item->>'away_goals','')::integer,
      now()
    )
    on conflict (match_id) do update set
      home_goals = excluded.home_goals,
      away_goals = excluded.away_goals,
      updated_at = now();
  end loop;
end;
$$;

create or replace function public.admin_delete_participant(admin_pin text, participant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_pin text;
begin
  select value into saved_pin from public.app_settings where key = 'admin_pin';
  if saved_pin is null or admin_pin is null or admin_pin <> saved_pin then
    raise exception 'PIN de administrador inválido';
  end if;
  delete from public.participants where id = participant;
end;
$$;

-- Cambiar el PIN después de probar:
-- update public.app_settings set value = 'TU-PIN-SECRETO' where key = 'admin_pin';
