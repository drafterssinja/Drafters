-- ============================================================================
-- AVISOS DE FÚTBOL EN LA CLASIFICACIÓN DE LAS MESAS DRAFTERS (07/10)
-- ============================================================================
-- Idempotente: se puede ejecutar más de una vez.
--
--   futbol_eventos               lo que ha pasado en los partidos (gol, penalti,
--                                parada, tarjeta, asistencia...), por jugador.
--                                Lo escribe el cron de ESPN (service role).
--   preferencias_avisos_futbol   qué alertas quiere recibir cada usuario.

create table if not exists public.futbol_eventos (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique,            -- evita duplicados entre pasadas del cron
  competicion text not null,
  partido_espn_id text,
  jugador_id uuid not null references public.jugadores (id) on delete cascade,
  jugador_nombre text not null,
  equipo_real text,
  tipo text not null,
  minuto text,
  detalle text,
  creado_en timestamptz not null default now()
);
create index if not exists futbol_eventos_competicion_idx on public.futbol_eventos (competicion, creado_en desc);
create index if not exists futbol_eventos_jugador_idx on public.futbol_eventos (jugador_id, creado_en desc);

alter table public.futbol_eventos enable row level security;
drop policy if exists "futbol_eventos_lectura" on public.futbol_eventos;
create policy "futbol_eventos_lectura" on public.futbol_eventos for select to authenticated using (true);

create table if not exists public.preferencias_avisos_futbol (
  usuario_id uuid primary key references public.perfiles (id) on delete cascade,
  tipos text[] not null default array['gol','gol_propia','penalti_marcado','penalti_fallado','penalti_parado'],
  updated_at timestamptz not null default now()
);

alter table public.preferencias_avisos_futbol enable row level security;
drop policy if exists "pref_avisos_futbol_select" on public.preferencias_avisos_futbol;
drop policy if exists "pref_avisos_futbol_insert" on public.preferencias_avisos_futbol;
drop policy if exists "pref_avisos_futbol_update" on public.preferencias_avisos_futbol;
create policy "pref_avisos_futbol_select" on public.preferencias_avisos_futbol for select to authenticated using (usuario_id = auth.uid());
create policy "pref_avisos_futbol_insert" on public.preferencias_avisos_futbol for insert to authenticated with check (usuario_id = auth.uid());
create policy "pref_avisos_futbol_update" on public.preferencias_avisos_futbol for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- Limpieza opcional: los eventos de jornadas viejas se pueden borrar sin más.
-- delete from public.futbol_eventos where creado_en < now() - interval '60 days';
