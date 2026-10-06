-- ============================================================================
-- CREACIÓN AUTOMÁTICA DE JORNADAS DE FÚTBOL + PESTAÑAS DE /SALAS (06/10)
-- ============================================================================
-- Ejecutar en el SQL Editor de Supabase ANTES de desplegar la nueva versión.
-- Es idempotente: se puede ejecutar más de una vez.
--
-- 1) futbol_jornadas_auto: ancla del número de jornada (ESPN no da el número)
--    y marca de "jornada ya creada automáticamente".
-- 2) salas.circuito: 'pga' | 'eur' en golf (para las pestañas PGA Tour / DP
--    World Tour de /salas). En fútbol las pestañas salen del nombre de la
--    competición ("La Liga - Jornada 9"). Se rellena sola al crear el torneo
--    desde Data Golf; aquí se rellenan los ya existentes.
-- 3) Cron cada 30 minutos que llama a /api/admin/crear-futbol-automatico.

create table if not exists public.futbol_jornadas_auto (
  liga text not null,                 -- 'La Liga' | 'Champions League'
  numero int not null,
  primer_partido timestamptz not null,
  competicion text not null,
  creada boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (liga, numero)
);

alter table public.futbol_jornadas_auto enable row level security;
drop policy if exists "futbol_jornadas_auto_admin_todo" on public.futbol_jornadas_auto;
create policy "futbol_jornadas_auto_admin_todo" on public.futbol_jornadas_auto
  for all using (public.es_admin()) with check (public.es_admin());

alter table public.salas add column if not exists circuito text;

-- Golf ya existente: el circuito sale de la sincronización en vivo del torneo.
update public.salas s
   set circuito = t.tour
  from public.torneos_golf_live t
 where s.deporte = 'golf'
   and s.circuito is null
   and t.competicion = s.competicion
   and t.tour in ('pga', 'eur');

-- Cron: crea las jornadas cuando ya hay horarios confirmados.
do $$
begin
  perform cron.unschedule('crear-futbol-automatico');
exception when others then null;
end $$;

select cron.schedule(
  'crear-futbol-automatico',
  '*/30 * * * *',
  $cron$
  select net.http_post(
    url := 'https://drafters-rho.vercel.app/api/admin/crear-futbol-automatico',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'hasiygqef1ojipcs332pj'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) as request_id;
  $cron$
);
-- Para quitarlo: select cron.unschedule('crear-futbol-automatico');
