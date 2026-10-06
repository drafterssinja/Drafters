-- ============================================================================
-- MESAS DRAFTERS DE FÚTBOL — PUNTUACIÓN DRAFTERS CON DATOS DE ESPN (06/10)
-- ============================================================================
-- Sustituye al SQL anterior de LaLiga Fantasy (sql_futbol_puntos_laliga.sql):
-- si ya lo ejecutaste, este lo actualiza; si no, crea todo desde cero.
-- Idempotente: se puede ejecutar más de una vez.
--
-- Qué guarda:
--   futbol_puntos_jugador   puntos de cada jugador en SU partido de la
--                           jornada (tablas "Cómo puntúan los jugadores"),
--                           con el desglose acción a acción.
--   futbol_partidos_jornada marcador en vivo de cada partido (escudos,
--                           minuto, goles con goleador y asistente).
--   futbol_escudos          escudo de cada equipo (LaLiga, Champions, ...),
--                           para enseñarlos en la elección de jugadores.

create table if not exists public.futbol_puntos_jugador (
  jugador_id uuid primary key references public.jugadores (id) on delete cascade,
  competicion text not null,
  puntos_total numeric not null default 0,
  jugo boolean not null default false,
  resultado_equipo text check (resultado_equipo in ('G', 'E', 'P') or resultado_equipo is null),
  partido_estado text not null default 'pendiente' check (partido_estado in ('pendiente', 'en_juego', 'finalizado', 'aplazado', 'sin_partido')),
  -- true = partido terminado: los puntos (0 incluido) son definitivos.
  -- En la pantalla: nombre en verde. En juego = amarillo; si no, rojo.
  actualizado boolean not null default false,
  actualizado_en timestamptz not null default now()
);

-- Columnas de la versión anterior (LaLiga Fantasy): ya no se usan, se dejan
-- opcionales para no romper nada si el SQL antiguo ya se ejecutó.
alter table public.futbol_puntos_jugador add column if not exists base_total numeric;
alter table public.futbol_puntos_jugador add column if not exists base_partidos int;
alter table public.futbol_puntos_jugador add column if not exists total_actual numeric;
alter table public.futbol_puntos_jugador add column if not exists partidos_actual int;
alter table public.futbol_puntos_jugador add column if not exists puntos_fantasy numeric not null default 0;
alter table public.futbol_puntos_jugador add column if not exists bonus_resultado int not null default 0;

-- Nuevas (ESPN):
alter table public.futbol_puntos_jugador add column if not exists minutos int not null default 0;
alter table public.futbol_puntos_jugador add column if not exists espn_atleta_id text;
-- [{clave, etiqueta, cantidad, puntos}] — qué ha dado cada punto
alter table public.futbol_puntos_jugador add column if not exists desglose jsonb not null default '[]'::jsonb;

create index if not exists futbol_puntos_jugador_competicion_idx on public.futbol_puntos_jugador (competicion);

create table if not exists public.futbol_partidos_jornada (
  competicion text not null,
  clave_local text not null,
  clave_visitante text not null,
  espn_id text,
  kickoff timestamptz,
  equipo_local text not null,
  equipo_visitante text not null,
  goles_local int,
  goles_visitante int,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_juego', 'finalizado', 'aplazado')),
  finalizado_visto_en timestamptz,
  jugadores_actualizados int not null default 0,
  actualizado boolean not null default false,
  actualizado_en timestamptz,
  updated_at timestamptz not null default now(),
  primary key (competicion, clave_local, clave_visitante)
);
alter table public.futbol_partidos_jornada add column if not exists logo_local text;
alter table public.futbol_partidos_jornada add column if not exists logo_visitante text;
alter table public.futbol_partidos_jornada add column if not exists reloj text;
alter table public.futbol_partidos_jornada add column if not exists periodo int;
-- [{minuto, equipo:'local'|'visitante', jugador, asistente|null, tipo:'normal'|'penalti'|'propia'}]
alter table public.futbol_partidos_jornada add column if not exists goles_detalle jsonb not null default '[]'::jsonb;

create table if not exists public.futbol_escudos (
  clave text primary key,
  nombre text not null,
  logo text not null,
  liga text,
  updated_at timestamptz not null default now()
);

alter table public.futbol_puntos_jugador enable row level security;
drop policy if exists futbol_puntos_jugador_select on public.futbol_puntos_jugador;
create policy futbol_puntos_jugador_select on public.futbol_puntos_jugador for select using (auth.uid() is not null);
drop policy if exists futbol_puntos_jugador_admin_todo on public.futbol_puntos_jugador;
create policy futbol_puntos_jugador_admin_todo on public.futbol_puntos_jugador for all using (public.es_admin()) with check (public.es_admin());

alter table public.futbol_partidos_jornada enable row level security;
drop policy if exists futbol_partidos_jornada_select on public.futbol_partidos_jornada;
create policy futbol_partidos_jornada_select on public.futbol_partidos_jornada for select using (auth.uid() is not null);
drop policy if exists futbol_partidos_jornada_admin_todo on public.futbol_partidos_jornada;
create policy futbol_partidos_jornada_admin_todo on public.futbol_partidos_jornada for all using (public.es_admin()) with check (public.es_admin());

alter table public.futbol_escudos enable row level security;
drop policy if exists futbol_escudos_select on public.futbol_escudos;
create policy futbol_escudos_select on public.futbol_escudos for select using (auth.uid() is not null);
drop policy if exists futbol_escudos_admin_todo on public.futbol_escudos;
create policy futbol_escudos_admin_todo on public.futbol_escudos for all using (public.es_admin()) with check (public.es_admin());

-- Alias de nombres de jugador de fútbol (nombre en ESPN → nombre en nuestra
-- ficha) se guardan con fuente 'espn'. Se mantiene 'futbolfantasy' por si el
-- SQL anterior ya guardó alguno.
alter table public.alias_nombres_jugador drop constraint if exists alias_nombres_jugador_fuente_check;
alter table public.alias_nombres_jugador add constraint alias_nombres_jugador_fuente_check
  check (fuente in ('espn', 'datagolf', 'manual', 'futbolfantasy'));

-- Cron: UNA sola tarea, cada minuto. La app solo trabaja si hay una jornada
-- en marcha (LaLiga, Champions...) y, si no, responde enseguida.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule('actualizar-futbol-en-vivo');
exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('marcadores-futbol-en-vivo');
exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('futbol-en-vivo');
exception when others then null;
end $$;

select cron.schedule(
  'futbol-en-vivo',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://drafters-rho.vercel.app/api/admin/actualizar-futbol-en-vivo',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'hasiygqef1ojipcs332pj'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) as request_id;
  $cron$
);
-- Para quitarlo: select cron.unschedule('futbol-en-vivo');
