-- =========================================================
-- QUINIELA MUNDIALISTA 2026 - OPCIÓN A SIMPLE
-- Participantes sin login. Datos centralizados en Supabase.
-- =========================================================

create extension if not exists pgcrypto;

drop table if exists public.predictions cascade;
drop table if exists public.results cascade;
drop table if exists public.participants cascade;
drop table if exists public.app_settings cascade;

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz default now()
);

create table public.predictions (
  participant_id uuid references public.participants(id) on delete cascade,
  match_id integer not null,
  home_goals integer check (home_goals >= 0),
  away_goals integer check (away_goals >= 0),
  updated_at timestamptz default now(),
  primary key (participant_id, match_id)
);

create table public.results (
  match_id integer primary key,
  home_goals integer check (home_goals >= 0),
  away_goals integer check (away_goals >= 0),
  updated_at timestamptz default now()
);

create table public.app_settings (
  key text primary key,
  value text not null
);

insert into public.app_settings(key, value)
values ('admin_pin', '1234');

alter table public.participants enable row level security;
alter table public.predictions enable row level security;
alter table public.results enable row level security;
alter table public.app_settings enable row level security;

create policy "read participants"
on public.participants for select using (true);

create policy "insert participants"
on public.participants for insert with check (true);

create policy "read predictions"
on public.predictions for select using (true);

create policy "insert predictions"
on public.predictions for insert with check (true);

create policy "update predictions"
on public.predictions for update using (true) with check (true);

create policy "read results"
on public.results for select using (true);

-- No se crea política pública para app_settings.
-- El PIN solo se consulta desde funciones SECURITY DEFINER.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists predictions_set_updated_at on public.predictions;
create trigger predictions_set_updated_at
before update on public.predictions
for each row execute function public.set_updated_at();

drop trigger if exists results_set_updated_at on public.results;
create trigger results_set_updated_at
before update on public.results
for each row execute function public.set_updated_at();

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

  if admin_pin <> saved_pin then
    raise exception 'PIN administrador inválido';
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

  if admin_pin <> saved_pin then
    raise exception 'PIN administrador inválido';
  end if;

  delete from public.participants where id = participant;
end;
$$;
