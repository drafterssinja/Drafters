-- ============================================================================
-- MESAS DRAFTERS DE GOLF — PUNTOS DRAFTERS POR JUGADOR (07/10)
-- ============================================================================
-- Idempotente: se puede ejecutar más de una vez.
--
-- golf_puntos_jugador guarda, para cada jugador de golf, los puntos Drafters
-- (hoyo a hoyo, rachas, vuelta sin bogeys, hole in one y posición final) con su
-- desglose. Lo escribe la sincronización de Data Golf (service role) cada
-- minuto; las mesas de golf lo leen para clasificar (más puntos = mejor).

create table if not exists public.golf_puntos_jugador (
  jugador_id uuid primary key references public.jugadores (id) on delete cascade,
  competicion text not null,
  puntos_total numeric not null default 0,
  -- [{clave, etiqueta, cantidad, puntos}]
  desglose jsonb not null default '[]'::jsonb,
  -- Avisos para el admin: "Ronda 2: faltan 1 hoyo por registrar"...
  avisos jsonb not null default '[]'::jsonb,
  hoyos_contados int not null default 0,
  torneo_terminado boolean not null default false,
  actualizado_en timestamptz not null default now()
);

create index if not exists golf_puntos_jugador_competicion_idx on public.golf_puntos_jugador (competicion);

alter table public.golf_puntos_jugador enable row level security;
drop policy if exists "golf_puntos_jugador_lectura" on public.golf_puntos_jugador;
create policy "golf_puntos_jugador_lectura" on public.golf_puntos_jugador for select to authenticated using (true);
