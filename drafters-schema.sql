-- ============================================================================
-- DRAFTERS — Esquema de base de datos (Supabase / Postgres)
-- ============================================================================
-- Cómo usarlo: en el panel de Supabase, ve a "SQL Editor" -> "New query",
-- pega TODO este archivo y pulsa "Run". Se puede ejecutar de una sola vez
-- (y se puede volver a ejecutar sin problema si hace falta: usa "if not
-- exists" / "or replace" / "drop ... if exists" en todas partes).
--
-- Qué crea:
--   1. `perfiles` — datos de cada usuario registrado (nombre, apellido,
--      nombre de usuario único, y el rol: 'usuario' o 'admin').
--   2. `salas` — Duelo/Trío/Doble o Nada/Triple o Nada, con código único
--      correlativo (ver más abajo).
--   3. `porras` — Porras clásicas de golf, con el mismo sistema de código.
--   4. `jugadores` — ficha maestra de jugadores (nombre, deporte,
--      competición/jornada, precio, grupo de porra, lesionado...),
--      editable solo por el superadministrador.
--   5. `equipos` — los equipos que monta cada usuario, con su histórico de
--      puntos/posición final para poder consultar el historial.
--   6. `inscripciones` — historial de cada inscripción y su coste.
--   7. `resultados_evento` — eventos de puntuación, simulados o reales.
--   8. `movimientos` — historial de ingresos y retiradas de saldo simulado,
--      más la función `registrar_movimiento()` que los crea de forma
--      atómica (nunca se puede quedar el saldo desincronizado del historial).
--   9. Un disparador que crea automáticamente el perfil al registrarse.
--  10. Un sistema de código correlativo único para salas y porras
--      (F + 8 dígitos, ver nota más abajo).
--  11. Un disparador sobre `salas` que, cuando una mesa se cierra
--      (estado = 'finalizada'), crea automáticamente mesas nuevas del mismo
--      tipo/deporte/competición hasta que vuelva a haber al menos 2 abiertas
--      — para que nunca quede un único formato sin alternativa.
--  12. Las políticas de seguridad (Row Level Security): cada usuario ve
--      solo lo suyo; el superadministrador (rol = 'admin') puede ver y
--      editar todo.
--
-- Nota sobre los códigos de mesa (F00000001, F00000002...):
--   Iñi pidió que, a partir de ahora, todas las mesas/porras que se creen
--   sean reales (nunca simuladas) y tengan un código propio para poder
--   llevar un registro/historial aunque se abran millones. Mientras el
--   dinero siga siendo simulado (Fase 1, ver DRAFTERS_Arquitectura_Tecnica),
--   el código empieza por "F" seguido de 8 dígitos correlativos —
--   F00000001, F00000002, ... hasta 99.999.999 mesas, más que de sobra
--   para esta fase. El día que se lance dinero real (Fase 3), se puede
--   añadir un prefijo distinto (p.ej. "R") sin tocar nada de lo ya creado.
--   Todas las salas y porras comparten UNA misma numeración correlativa
--   (una única secuencia), para tener un registro unificado de "mesas".
-- ============================================================================

-- Necesario para poder generar ids aleatorios (gen_random_uuid).
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. PERFILES
-- ----------------------------------------------------------------------------
-- Guarda los datos de producto del usuario (nombre, fecha de nacimiento,
-- saldo simulado en €, aceptación de términos, y su rol). El email y la
-- contraseña ya los gestiona Supabase Auth internamente (tabla auth.users)
-- — no se duplican aquí.
create table if not exists public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null,
  apellido text,
  nombre_usuario text,
  fecha_nacimiento date,
  saldo_simulado numeric(10, 2) not null default 150.00, -- € simulados, sin valor monetario real
  terminos_aceptados boolean not null default false,
  terminos_aceptados_en timestamptz,
  rol text not null default 'usuario' check (rol in ('usuario', 'admin')),
  created_at timestamptz not null default now()
);

comment on table public.perfiles is 'Datos de producto de cada usuario registrado. El saldo es siempre simulado (€), sin conexión a ningún sistema de pago real. rol=''admin'' identifica al superadministrador (solo Iñi).';

-- Si la tabla ya existía de una ejecución anterior del esquema (el "create
-- table if not exists" de arriba no la toca en ese caso), estas dos columnas
-- se añaden igualmente aquí.
alter table public.perfiles add column if not exists apellido text;
alter table public.perfiles add column if not exists nombre_usuario text;

comment on column public.perfiles.nombre_usuario is 'Nombre público del usuario: es el que se muestra cuando participa en una sala/MTT. En las porras clásicas el usuario pone en su lugar un nombre de equipo (ver equipos.nombre_equipo).';

-- El nombre de usuario tiene que ser único (sin distinguir mayúsculas de
-- minúsculas), pero se permite null mientras algún perfil antiguo no lo
-- tenga todavía relleno.
create unique index if not exists perfiles_nombre_usuario_unico
  on public.perfiles (lower(nombre_usuario))
  where nombre_usuario is not null;

-- ----------------------------------------------------------------------------
-- CÓDIGO CORRELATIVO ÚNICO DE MESA (compartido por salas y porras)
-- ----------------------------------------------------------------------------
create sequence if not exists public.mesas_codigo_seq;

create or replace function public.generar_codigo_mesa()
returns text
language sql
as $$
  select 'F' || lpad(nextval('public.mesas_codigo_seq')::text, 8, '0');
$$;

-- ----------------------------------------------------------------------------
-- 2. SALAS (Doble o Nada / Triple o Nada / Oro y Plata / Tridente / Maratón)
-- ----------------------------------------------------------------------------
-- Tipos definitivos de Iñi (23/09, tabla "DRAFTERS · Tipos de sala") — ver
-- lib/repartoPremios.ts en la app para el reparto exacto del bote de cada
-- uno, y lib/tiposDeSala.ts para los aforos válidos de cada tipo (Doble o
-- Nada: 2/4/6/8/10, Triple o Nada: 3/6/9, Oro y Plata: 5, Tridente: 10).
-- Maratón no tiene aforo fijo (inscripción sin límite) — de ahí que `aforo`
-- sea NULLABLE, solo para ese caso.
create table if not exists public.salas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default public.generar_codigo_mesa(),
  nombre text not null,
  deporte text not null check (deporte in ('futbol', 'golf', 'tenis')),
  competicion text not null,
  tipo text not null check (tipo in ('doble_o_nada', 'triple_o_nada', 'oro_y_plata', 'tridente', 'maraton')),
  aforo int,
  buy_in numeric(10, 2) not null,
  estado text not null default 'abierta' check (estado in ('abierta', 'casi_llena', 'completa', 'finalizada')),
  -- Fecha y hora límite para inscribirse o cambiar de equipo en esta mesa
  -- (pedido por Iñi: cada torneo/jornada la fija el admin al crearlo). Nula
  -- mientras no se fije — la pantalla no muestra cuenta atrás en ese caso.
  fecha_limite_inscripcion timestamptz,
  created_at timestamptz not null default now()
);

alter table public.salas add column if not exists fecha_limite_inscripcion timestamptz;

-- Marca cuándo se procesó el cierre de inscripción de esta sala (ver
-- consolidar_salas_incompletas() más abajo) — evita que la misma sala se
-- vuelva a procesar en cada pasada del job programado.
alter table public.salas add column if not exists procesada_cierre_en timestamptz;

-- Migración de los 4 tipos provisionales que había antes de que Iñi mandara
-- la tabla definitiva (23/09) — 'duelo' y 'trio' no existen ya como tipos
-- propios: se llevan a la variante de aforo equivalente de 'doble_o_nada' /
-- 'triple_o_nada' (ambos aceptan ese mismo aforo). Es un update idempotente:
-- después de la primera vez no queda ninguna fila con el tipo antiguo, así
-- que en las siguientes ejecuciones no hace nada.
update public.salas set tipo = 'doble_o_nada' where tipo = 'duelo';
update public.salas set tipo = 'triple_o_nada' where tipo = 'trio';

alter table public.salas alter column aforo drop not null;
alter table public.salas drop constraint if exists salas_tipo_check;
alter table public.salas add constraint salas_tipo_check
  check (tipo in ('doble_o_nada', 'triple_o_nada', 'oro_y_plata', 'tridente', 'maraton'));

-- ----------------------------------------------------------------------------
-- 3. PORRAS (Porras clásicas de golf)
-- ----------------------------------------------------------------------------
create table if not exists public.porras (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default public.generar_codigo_mesa(),
  major text not null,
  fecha_limite_inscripcion timestamptz,
  estado text not null default 'proximamente' check (estado in ('disponible', 'proximamente', 'finalizada')),
  precio numeric(10, 2) not null default 20.00,
  -- Igual que salas.competicion: enlaza la porra con la remesa de
  -- `jugadores` correspondiente (mismo valor exacto que se usa al importar
  -- el torneo desde /admin). No hay FK porque jugadores no referencia una
  -- porra concreta (son la ficha maestra del torneo, compartida por las
  -- salas y la porra de esa misma competición).
  competicion text,
  created_at timestamptz not null default now()
);

alter table public.porras add column if not exists fecha_limite_inscripcion timestamptz;
alter table public.porras add column if not exists competicion text;

-- ----------------------------------------------------------------------------
-- 4. JUGADORES (ficha maestra, editable solo por el superadministrador)
-- ----------------------------------------------------------------------------
create table if not exists public.jugadores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  deporte text not null check (deporte in ('futbol', 'golf', 'tenis')),
  competicion text not null, -- p.ej. 'La Liga - Jornada 8', 'PGA Tour', 'ATP · Hangzhou Open'
  equipo_real text, -- club (fútbol) o circuito
  posicion text, -- solo fútbol: portero / defensa / centrocampista / delantero
  precio numeric(10, 2) not null default 0,
  -- Lista por color de la porra clásica (solo golf, de momento — ver
  -- lib/porraGrupos.ts para cómo se calcula automáticamente al importar un
  -- torneo desde /admin): 'amarillo' 1-15, 'verde' 16-35, 'azul' 36+ (o
  -- 36-70 si no es major), 'morado' 71+ (solo si no es major), y
  -- 'espanoles' para los jugadores marcados como españoles cuando hay 3 o
  -- más jugando ese torneo (se sacan de su lista por ranking).
  grupo_porra text check (grupo_porra in ('amarillo', 'verde', 'azul', 'morado', 'espanoles') or grupo_porra is null),
  -- Marcado a mano por el admin al importar el listado (la web del circuito
  -- no siempre indica la nacionalidad de forma fiable para poder
  -- interpretarla automáticamente). Determina si el jugador entra en la
  -- lista de 'espanoles' de grupo_porra en vez de su tramo de ranking.
  es_espanol boolean not null default false,
  lesionado boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  -- De dónde viene esta ficha si no la creó el admin a mano: 'football-data.org'
  -- por ahora (fútbol, plan gratuito). fuente_externa_id es el id del jugador
  -- en esa API, para poder sincronizar sin duplicar en cada ejecución.
  fuente_externa text,
  fuente_externa_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Evita duplicados al volver a sincronizar: como mucho una fila por
-- (fuente_externa, fuente_externa_id). No afecta a los jugadores creados a
-- mano por el admin (fuente_externa_id es null en esos, y el índice los
-- ignora explícitamente).
create unique index if not exists jugadores_fuente_externa_unica
  on public.jugadores (fuente_externa, fuente_externa_id)
  where fuente_externa_id is not null;

alter table public.jugadores add column if not exists es_espanol boolean not null default false;
alter table public.jugadores drop constraint if exists jugadores_grupo_porra_check;
alter table public.jugadores add constraint jugadores_grupo_porra_check
  check (grupo_porra in ('amarillo', 'verde', 'azul', 'morado', 'espanoles') or grupo_porra is null);

-- ----------------------------------------------------------------------------
-- 5. EQUIPOS
-- ----------------------------------------------------------------------------
-- Un equipo pertenece SIEMPRE a una sala (modo 'sala' o 'mtt') o a una porra
-- (modo 'porra'), nunca a las dos — de ahí el check constraint de abajo.
-- puntos_totales/posicion_final quedan a null mientras la mesa está en
-- juego, y se rellenan al finalizar — así el usuario puede consultar su
-- historial de partidas jugadas con el resultado ya cerrado.
create table if not exists public.equipos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfiles (id) on delete cascade,
  modo text not null check (modo in ('sala', 'mtt', 'porra')),
  sala_id uuid references public.salas (id) on delete cascade,
  porra_id uuid references public.porras (id) on delete cascade,
  nombre_equipo text,
  jugadores jsonb not null default '[]'::jsonb, -- lista de ids de jugadores elegidos
  alineacion text, -- solo fútbol: '4-3-3', '4-4-2', '3-5-2', '4-2-3-1'
  gasto_total numeric(10, 2) not null default 0,
  puntos_totales numeric,
  posicion_final int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint equipo_referencia_valida check (
    (modo in ('sala', 'mtt') and sala_id is not null and porra_id is null)
    or
    (modo = 'porra' and porra_id is not null and sala_id is null)
  )
);

-- En salas/MTT el participante se identifica con su nombre_usuario (no hace
-- falta nombre de equipo). En las porras clásicas, en cambio, el nombre de
-- equipo es obligatorio (no se puede avanzar sin ponerlo) y no se puede
-- repetir dentro de la misma porra.
alter table public.equipos drop constraint if exists equipo_porra_nombre_obligatorio;
alter table public.equipos add constraint equipo_porra_nombre_obligatorio check (
  modo <> 'porra' or (nombre_equipo is not null and length(trim(nombre_equipo)) > 0)
);

create unique index if not exists equipos_porra_nombre_equipo_unico
  on public.equipos (porra_id, lower(nombre_equipo))
  where modo = 'porra';

-- Mantiene updated_at al día cada vez que se modifica una fila (reutilizada
-- por equipos y jugadores).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_equipos_updated_at on public.equipos;
create trigger trg_equipos_updated_at
  before update on public.equipos
  for each row execute function public.set_updated_at();

drop trigger if exists trg_jugadores_updated_at on public.jugadores;
create trigger trg_jugadores_updated_at
  before update on public.jugadores
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 6. INSCRIPCIONES
-- ----------------------------------------------------------------------------
-- Historial de cada cobro: qué equipo, cuánto se descontó del saldo y cuándo.
create table if not exists public.inscripciones (
  id uuid primary key default gen_random_uuid(),
  equipo_id uuid not null references public.equipos (id) on delete cascade,
  importe numeric(10, 2) not null,
  fecha timestamptz not null default now(),
  -- 'activa': en juego con normalidad. 'trasladada': su sala no se llenó a
  -- tiempo y se la juntó con otra sala idéntica (ver
  -- consolidar_salas_incompletas() más abajo) — sigue jugando y su dinero
  -- sigue en juego. 'reembolsada': su sala no se llenó y no había sitio en
  -- ninguna sala idéntica con la que juntarla — se le devolvió el dinero
  -- íntegro y no cuenta como partida jugada.
  estado text not null default 'activa' check (estado in ('activa', 'trasladada', 'reembolsada'))
);

alter table public.inscripciones add column if not exists estado text not null default 'activa';
alter table public.inscripciones drop constraint if exists inscripciones_estado_check;
alter table public.inscripciones add constraint inscripciones_estado_check check (estado in ('activa', 'trasladada', 'reembolsada'));

-- ----------------------------------------------------------------------------
-- 7. RESULTADOS_EVENTO
-- ----------------------------------------------------------------------------
-- Cada evento de puntuación (gol, birdie, ace...) de un jugador. `fuente`
-- distingue entre datos de ejemplo/simulados y datos reales de una API
-- deportiva contratada más adelante (Fase 2) — así el día que se conecte una
-- API real no hace falta cambiar el modelo de datos, solo de dónde vienen
-- las filas.
create table if not exists public.resultados_evento (
  id uuid primary key default gen_random_uuid(),
  jugador_id uuid references public.jugadores (id) on delete cascade,
  competicion text not null,
  evento text not null,
  puntos numeric not null,
  fuente text not null default 'simulado' check (fuente in ('simulado', 'real')),
  creado_en timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 8. MOVIMIENTOS (ingresos y retiradas de saldo simulado)
-- ----------------------------------------------------------------------------
-- Alimenta el "historial de ingresos y retiradas" de la cuenta del usuario y
-- las estadísticas de "dinero depositado" / "dinero retirado" del panel de
-- superadministrador. Las filas se crean SIEMPRE a través de la función
-- registrar_movimiento() (más abajo), nunca sueltas, para que el saldo de
-- `perfiles` y este historial no se puedan desincronizar.
create table if not exists public.movimientos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfiles (id) on delete cascade,
  tipo text not null check (tipo in ('deposito', 'retiro')),
  importe numeric(10, 2) not null check (importe > 0),
  creado_en timestamptz not null default now()
);

comment on table public.movimientos is 'Historial de ingresos y retiradas de saldo simulado (€) de cada usuario.';

-- ----------------------------------------------------------------------------
-- NOTIFICACIONES
-- ----------------------------------------------------------------------------
-- Avisos para el usuario cuando pasa algo con su inscripción sin que él haga
-- nada — hoy solo los genera consolidar_salas_incompletas() (ver más abajo):
-- "te hemos trasladado de sala" o "te hemos reembolsado, sentimos las
-- molestias". Pensado para mostrarse en "Mi cuenta" cuando se construya esa
-- pantalla.
create table if not exists public.notificaciones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfiles (id) on delete cascade,
  tipo text not null check (tipo in ('trasladado', 'reembolsado')),
  titulo text not null,
  mensaje text not null,
  leido boolean not null default false,
  created_at timestamptz not null default now()
);

-- Registra un ingreso o retirada de saldo simulado de forma atómica: inserta
-- la fila en `movimientos` Y actualiza `perfiles.saldo_simulado` en la misma
-- transacción. Una retirada nunca puede dejar el saldo en negativo. Se llama
-- desde la app con supabase.rpc('registrar_movimiento', { p_tipo, p_importe }).
-- No es security definer a propósito: se ejecuta con los permisos del propio
-- usuario que llama, así que las políticas de RLS de abajo son las que de
-- verdad protegen esto (nadie puede tocar el saldo de otro usuario).
create or replace function public.registrar_movimiento(p_tipo text, p_importe numeric)
returns public.perfiles
language plpgsql
as $$
declare
  saldo_actual numeric;
  perfil_actualizado public.perfiles;
begin
  if p_importe is null or p_importe <= 0 then
    raise exception 'El importe debe ser mayor que 0';
  end if;
  if p_tipo not in ('deposito', 'retiro') then
    raise exception 'Tipo de movimiento no válido: %', p_tipo;
  end if;

  select saldo_simulado into saldo_actual from public.perfiles where id = auth.uid() for update;

  if p_tipo = 'retiro' and saldo_actual < p_importe then
    raise exception 'Saldo insuficiente para retirar % € (saldo actual: % €)', p_importe, saldo_actual;
  end if;

  insert into public.movimientos (usuario_id, tipo, importe) values (auth.uid(), p_tipo, p_importe);

  update public.perfiles
  set saldo_simulado = saldo_simulado + (case when p_tipo = 'deposito' then p_importe else -p_importe end)
  where id = auth.uid()
  returning * into perfil_actualizado;

  return perfil_actualizado;
end;
$$;

-- ============================================================================
-- REGISTRO AUTOMÁTICO DEL PERFIL AL CREAR LA CUENTA
-- ============================================================================
-- Cuando alguien completa el registro (auth.users), este disparador crea
-- automáticamente su fila en `perfiles`, tomando el nombre, apellido, nombre
-- de usuario y fecha de nacimiento que se le pasaron a supabase.auth.signUp()
-- en `options.data`. El rol siempre se crea como 'usuario' — el ascenso a
-- 'admin' se hace a mano, una sola vez, desde el SQL Editor (ver
-- instrucciones aparte).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.perfiles (id, nombre, apellido, nombre_usuario, fecha_nacimiento, terminos_aceptados, terminos_aceptados_en)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nombre', ''),
    nullif(new.raw_user_meta_data ->> 'apellido', ''),
    nullif(new.raw_user_meta_data ->> 'nombre_usuario', ''),
    nullif(new.raw_user_meta_data ->> 'fecha_nacimiento', '')::date,
    coalesce((new.raw_user_meta_data ->> 'terminos_aceptados')::boolean, false),
    case when (new.raw_user_meta_data ->> 'terminos_aceptados')::boolean then now() else null end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- HELPER: ¿es superadministrador el usuario que hace la petición?
-- ============================================================================
-- security definer: necesario para poder consultar `perfiles` desde dentro
-- de una política de seguridad de la propia tabla `perfiles` sin caer en
-- una referencia circular.
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.rol = 'admin'
  );
$$;

-- ============================================================================
-- DISPONIBILIDAD DEL NOMBRE DE USUARIO (comprobación antes de registrarse)
-- ============================================================================
-- Permite que la pantalla de registro compruebe si un nombre de usuario ya
-- está en uso ANTES de intentar crear la cuenta, para avisar al momento en
-- vez de que el usuario se entere solo al fallar el registro entero.
-- security definer: así se puede llamar sin estar todavía autenticado (en
-- pleno registro) sin dar acceso de lectura al resto de la tabla `perfiles`.
create or replace function public.nombre_usuario_disponible(p_nombre_usuario text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select not exists (
    select 1 from public.perfiles where lower(nombre_usuario) = lower(p_nombre_usuario)
  );
$$;

grant execute on function public.nombre_usuario_disponible(text) to anon, authenticated;

-- ============================================================================
-- CONSOLIDACIÓN DE SALAS INCOMPLETAS AL CERRAR LA INSCRIPCIÓN
-- ============================================================================
-- Pedido explícito de Iñi (22/09): cuando el plazo de inscripción de una
-- sala (fecha_limite_inscripcion) se cumple y esa sala no se ha llenado,
-- solo pasa algo si existe OTRA sala EXACTAMENTE igual (mismo
-- deporte + competición + tipo — p.ej. "La Liga - Jornada 8" + "Doble o
-- Nada") que también esté incompleta en ese momento:
--   - La sala con MÁS jugadores inscritos se completa con jugadores de la
--     otra (o de las otras, si hay más de dos) — por orden de inscripción,
--     el que se apuntó antes tiene prioridad para conservar su sitio.
--   - A quien SÍ se traslada: sigue inscrito con normalidad, se le avisa
--     con una notificación (pensada para verse en verde en "Mi cuenta").
--   - A quien NO cabe en ningún sitio: se le reembolsa el importe ÍNTEGRO
--     (incluida nuestra comisión — como el trato no llega a jugarse, no se
--     cobra nada) y se le avisa con una notificación de disculpa.
-- Si una sala incompleta se queda SIN ninguna otra sala idéntica también
-- incompleta, no se toca — sigue abierta tal cual hasta la siguiente pasada.
--
-- IMPORTANTE — falta todavía la pantalla real de "unirse a una sala", así
-- que esta función no tiene aún ningún caso de uso real que probar de
-- principio a fin; está lista y probada con datos sintéticos para cuando
-- se construya esa pantalla (ver README/documento de arquitectura).
--
-- Para que esto se compruebe solo, sin que nadie tenga que pulsar nada:
-- activa la extensión "pg_cron" desde el panel de Supabase (Database →
-- Extensions → busca "pg_cron" → Enable) y ejecuta UNA VEZ en el SQL Editor:
--
--   select cron.schedule(
--     'consolidar-salas-incompletas',
--     '*/5 * * * *',
--     $$select public.consolidar_salas_incompletas();$$
--   );
create or replace function public.consolidar_salas_incompletas()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  grupo record;
  destino_id uuid;
  destino_aforo int;
  destino_inscritos int;
  huecos int;
  candidato record;
  movidos int;
begin
  for grupo in
    select distinct deporte, competicion, tipo
    from public.salas
    where fecha_limite_inscripcion is not null
      and fecha_limite_inscripcion <= now()
      and procesada_cierre_en is null
      -- Maratón no tiene aforo fijo, así que "incompleta" no aplica — con
      -- aforo null, la comparación count(e.id) < s.aforo ya sale falsa más
      -- abajo, pero se excluye aquí también de forma explícita para que
      -- quede claro y no dependa de ese comportamiento de NULL.
      and tipo <> 'maraton'
  loop
    -- Sala con más jugadores entre las incompletas de este grupo exacto.
    select s.id, s.aforo, count(e.id)
      into destino_id, destino_aforo, destino_inscritos
      from public.salas s
      join public.equipos e on e.sala_id = s.id
      where s.deporte = grupo.deporte and s.competicion = grupo.competicion and s.tipo = grupo.tipo
        and s.fecha_limite_inscripcion <= now() and s.procesada_cierre_en is null
      group by s.id, s.aforo
      having count(e.id) < s.aforo
      order by count(e.id) desc, s.created_at asc
      limit 1;

    if not found then
      -- Ninguna sala del grupo está incompleta con al menos un jugador — no
      -- hay nada que consolidar; se marcan procesadas para no revisarlas.
      update public.salas
        set procesada_cierre_en = now()
        where deporte = grupo.deporte and competicion = grupo.competicion and tipo = grupo.tipo
          and fecha_limite_inscripcion <= now() and procesada_cierre_en is null;
      continue;
    end if;

    -- ¿Hay una segunda sala incompleta con la que consolidar? Si no, se deja
    -- tal cual (sin tocar a sus jugadores ni marcarla procesada), por si el
    -- admin abre otra sala idéntica más adelante.
    if not exists (
      select 1
      from public.salas s
      join public.equipos e on e.sala_id = s.id
      where s.deporte = grupo.deporte and s.competicion = grupo.competicion and s.tipo = grupo.tipo
        and s.id <> destino_id
        and s.fecha_limite_inscripcion <= now() and s.procesada_cierre_en is null
      group by s.id, s.aforo
      having count(e.id) < s.aforo
    ) then
      continue;
    end if;

    huecos := destino_aforo - destino_inscritos;
    movidos := 0;

    for candidato in
      select e.id as equipo_id, e.usuario_id, i.id as inscripcion_id, i.importe
      from public.equipos e
      join public.inscripciones i on i.equipo_id = e.id and i.estado = 'activa'
      join public.salas s on s.id = e.sala_id
      where s.deporte = grupo.deporte and s.competicion = grupo.competicion and s.tipo = grupo.tipo
        and s.id <> destino_id
        and s.fecha_limite_inscripcion <= now() and s.procesada_cierre_en is null
      order by i.fecha asc
    loop
      if movidos < huecos then
        update public.equipos set sala_id = destino_id, updated_at = now() where id = candidato.equipo_id;
        update public.inscripciones set estado = 'trasladada' where id = candidato.inscripcion_id;
        insert into public.notificaciones (usuario_id, tipo, titulo, mensaje) values (
          candidato.usuario_id,
          'trasladado',
          'Te hemos trasladado de sala',
          'Tu sala no llegó a completarse a tiempo, así que te hemos trasladado a otra sala idéntica que sí se ha llenado. Sigues inscrito con normalidad — no tienes que hacer nada más.'
        );
        movidos := movidos + 1;
      else
        update public.inscripciones set estado = 'reembolsada' where id = candidato.inscripcion_id;
        update public.perfiles set saldo_simulado = saldo_simulado + candidato.importe where id = candidato.usuario_id;
        insert into public.movimientos (usuario_id, tipo, importe) values (candidato.usuario_id, 'deposito', candidato.importe);
        insert into public.notificaciones (usuario_id, tipo, titulo, mensaje) values (
          candidato.usuario_id,
          'reembolsado',
          'Sentimos las molestias: te hemos reembolsado tu inscripción',
          'Tu sala no llegó a completarse a tiempo y no quedaba sitio en la sala con la que se ha juntado. Te hemos devuelto tu inscripción íntegra, sin ningún descuento. Sentimos las molestias.'
        );
      end if;
    end loop;

    -- Todas las salas de origen se han quedado sin ningún equipo (cada uno
    -- se ha trasladado o se ha reembolsado) — se cierran.
    update public.salas s
      set estado = 'finalizada', procesada_cierre_en = now()
      where s.deporte = grupo.deporte and s.competicion = grupo.competicion and s.tipo = grupo.tipo
        and s.id <> destino_id
        and s.fecha_limite_inscripcion <= now() and s.procesada_cierre_en is null;

    update public.salas
      set estado = case when movidos >= huecos then 'completa' else estado end,
          procesada_cierre_en = now()
      where id = destino_id;
  end loop;
end;
$$;

revoke all on function public.consolidar_salas_incompletas() from public, anon, authenticated;

-- NOTA IMPORTANTE para cualquier pantalla o consulta futura que muestre
-- "cuántos inscritos tiene esta sala" (listado de salas, detalle de sala,
-- estadísticas de admin, etc.): al reembolsar a un jugador,
-- consolidar_salas_incompletas() NO borra ni desvincula su fila de
-- `equipos` de la sala original (la clave equipo_referencia_valida exige
-- sala_id en equipos de modo 'sala'/'mtt', y además queremos conservar el
-- rastro histórico). Su `equipos.sala_id` se queda apuntando a esa sala
-- aunque ya no cuenta como plaza real. Por eso, NUNCA se debe contar
-- "inscritos" haciendo un simple count(equipos) por sala_id: hay que
-- contarlos siempre a través de `inscripciones` filtrando
-- `estado <> 'reembolsada'` (un jugador 'trasladado' si cuenta, porque su
-- equipo.sala_id ya se actualizó a la sala destino real). Esto ya se
-- respeta en el conteo de estadísticas del admin (ver app/admin/page.tsx).

-- ============================================================================
-- DISPONIBILIDAD DE MESAS: al cerrarse una sala, se regeneran del mismo tipo
-- ============================================================================
-- Pedido por Iñi: nunca puede haber un único formato de mesa disponible —
-- si a alguien no le convence la mesa que ve (por los rivales, el buy-in...)
-- tiene que poder elegir otra igual. Por eso, cada vez que una sala pasa a
-- 'finalizada', este disparador crea automáticamente mesas nuevas y vacías
-- del mismo deporte + tipo + competición hasta que vuelva a haber al menos
-- MINIMO_ABIERTAS abiertas (contando las que ya hubiera, sin contar la que
-- se acaba de cerrar) — cubre tanto "reponer la que se cierra" como
-- "asegurar que siempre haya más de una a la vez".
--
-- Excepción: 'maraton'. Es una sala única de inscripción abierta por
-- torneo/jornada (igual que una porra clásica, no como el resto de tipos,
-- que son varias mesas en paralelo) — no tiene sentido clonarla al
-- cerrarse, así que este disparador la ignora por completo.
create or replace function public.mantener_mesas_disponibles()
returns trigger
language plpgsql
as $$
declare
  minimo_abiertas constant int := 2;
  abiertas_restantes int;
  faltan int;
begin
  if new.tipo = 'maraton' then
    return new;
  end if;

  if new.estado = 'finalizada' and old.estado is distinct from 'finalizada' then
    select count(*) into abiertas_restantes
    from public.salas
    where deporte = new.deporte
      and tipo = new.tipo
      and competicion = new.competicion
      and estado in ('abierta', 'casi_llena')
      and id <> new.id;

    -- greatest(...,1): como mínimo, siempre se repone la que se cierra.
    faltan := greatest(minimo_abiertas - abiertas_restantes, 1);

    for i in 1..faltan loop
      insert into public.salas (nombre, deporte, competicion, tipo, aforo, buy_in, estado)
      values (new.nombre, new.deporte, new.competicion, new.tipo, new.aforo, new.buy_in, 'abierta');
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_salas_mantener_disponibles on public.salas;
create trigger trg_salas_mantener_disponibles
  after update on public.salas
  for each row execute function public.mantener_mesas_disponibles();

-- ============================================================================
-- ROW LEVEL SECURITY — cada usuario solo ve y toca sus propios datos;
-- el superadministrador (es_admin()) puede ver y tocar todo.
-- ============================================================================

alter table public.perfiles enable row level security;
alter table public.salas enable row level security;
alter table public.porras enable row level security;
alter table public.jugadores enable row level security;
alter table public.equipos enable row level security;
alter table public.inscripciones enable row level security;
alter table public.resultados_evento enable row level security;
alter table public.movimientos enable row level security;
alter table public.notificaciones enable row level security;

-- Perfiles: cada usuario lee/actualiza su propia fila; el admin puede leer
-- y actualizar todas (p.ej. para gestionar la plataforma).
drop policy if exists "perfiles_select_propio" on public.perfiles;
create policy "perfiles_select_propio" on public.perfiles
  for select using (auth.uid() = id or public.es_admin());

drop policy if exists "perfiles_update_propio" on public.perfiles;
create policy "perfiles_update_propio" on public.perfiles
  for update using (auth.uid() = id or public.es_admin())
  with check (auth.uid() = id or public.es_admin());

-- Salas y porras: lectura pública (cualquier usuario autenticado ve el
-- listado); solo el admin puede crear/editar/borrar mesas — a partir de
-- ahora todas las mesas se crean así, de verdad, desde el panel de admin,
-- nunca simuladas en el frontend.
drop policy if exists "salas_select_publico" on public.salas;
create policy "salas_select_publico" on public.salas
  for select using (true);

drop policy if exists "salas_admin_todo" on public.salas;
create policy "salas_admin_todo" on public.salas
  for all using (public.es_admin()) with check (public.es_admin());

drop policy if exists "porras_select_publico" on public.porras;
create policy "porras_select_publico" on public.porras
  for select using (true);

drop policy if exists "porras_admin_todo" on public.porras;
create policy "porras_admin_todo" on public.porras
  for all using (public.es_admin()) with check (public.es_admin());

-- Jugadores: lectura pública (hace falta para pintar el draft); solo el
-- admin puede crear/editar/borrar fichas de jugador.
drop policy if exists "jugadores_select_publico" on public.jugadores;
create policy "jugadores_select_publico" on public.jugadores
  for select using (true);

drop policy if exists "jugadores_admin_todo" on public.jugadores;
create policy "jugadores_admin_todo" on public.jugadores
  for all using (public.es_admin()) with check (public.es_admin());

-- Equipos: cada usuario ve/crea/modifica solo los suyos; el admin ve y
-- modifica todos (para poder revisar cualquier historial, como pediste).
drop policy if exists "equipos_select_propio" on public.equipos;
create policy "equipos_select_propio" on public.equipos
  for select using (auth.uid() = usuario_id or public.es_admin());

drop policy if exists "equipos_insert_propio" on public.equipos;
create policy "equipos_insert_propio" on public.equipos
  for insert with check (auth.uid() = usuario_id);

drop policy if exists "equipos_update_propio" on public.equipos;
create policy "equipos_update_propio" on public.equipos
  for update using (auth.uid() = usuario_id or public.es_admin())
  with check (auth.uid() = usuario_id or public.es_admin());

-- Inscripciones: el dueño del equipo ve las suyas; el admin las ve todas
-- (para el conteo de dinero jugado del panel de administración).
drop policy if exists "inscripciones_select_propio" on public.inscripciones;
create policy "inscripciones_select_propio" on public.inscripciones
  for select using (
    public.es_admin()
    or exists (
      select 1 from public.equipos e
      where e.id = inscripciones.equipo_id
      and e.usuario_id = auth.uid()
    )
  );

drop policy if exists "inscripciones_insert_propio" on public.inscripciones;
create policy "inscripciones_insert_propio" on public.inscripciones
  for insert with check (
    exists (
      select 1 from public.equipos e
      where e.id = inscripciones.equipo_id
      and e.usuario_id = auth.uid()
    )
  );

-- Movimientos: cada usuario ve solo los suyos; el admin los ve todos (para
-- las estadísticas de dinero depositado/retirado del panel de admin). Las
-- filas solo se crean a través de registrar_movimiento(), nunca sueltas.
drop policy if exists "movimientos_select_propio" on public.movimientos;
create policy "movimientos_select_propio" on public.movimientos
  for select using (auth.uid() = usuario_id or public.es_admin());

drop policy if exists "movimientos_insert_propio" on public.movimientos;
create policy "movimientos_insert_propio" on public.movimientos
  for insert with check (auth.uid() = usuario_id);

-- Notificaciones: cada usuario ve y marca como leídas solo las suyas; nadie
-- (ni siquiera el admin, salvo que sea la suya propia) puede crearlas a
-- mano desde el cliente — solo las crea consolidar_salas_incompletas(), que
-- al ser security definer se salta RLS.
drop policy if exists "notificaciones_select_propio" on public.notificaciones;
create policy "notificaciones_select_propio" on public.notificaciones
  for select using (auth.uid() = usuario_id);

drop policy if exists "notificaciones_update_propio" on public.notificaciones;
create policy "notificaciones_update_propio" on public.notificaciones
  for update using (auth.uid() = usuario_id)
  with check (auth.uid() = usuario_id);

-- Resultados de eventos: lectura pública (hace falta para pintar la
-- clasificación de todo el mundo, no solo la propia); solo el admin puede
-- escribir (hasta que se conecte una API real en Fase 2).
drop policy if exists "resultados_select_publico" on public.resultados_evento;
create policy "resultados_select_publico" on public.resultados_evento
  for select using (true);

drop policy if exists "resultados_admin_todo" on public.resultados_evento;
create policy "resultados_admin_todo" on public.resultados_evento
  for all using (public.es_admin()) with check (public.es_admin());

-- ============================================================================
-- CONTEOS PÚBLICOS DE INSCRITOS (pantallas reales de inicio/salas/mesas/porras)
-- ============================================================================
-- Las políticas de arriba (equipos_select_propio, inscripciones_select_propio)
-- son correctas y se quedan tal cual: cada usuario solo puede LEER el
-- contenido de su propio equipo (qué jugadores eligió, cuánto se ha
-- gastado...) — nadie más debería poder cotillear el equipo de un rival
-- antes de que la sala cierre. Pero el listado de salas, el detalle de
-- sala y "grandes torneos" sí necesitan un dato agregado que es público de
-- verdad: cuántos inscritos tiene cada sala/porra ahora mismo (siempre
-- contando a través de `inscripciones.estado <> 'reembolsada'`, la misma
-- convención de la nota junto a consolidar_salas_incompletas() más arriba)
-- y la pestaña "Jugadores" del detalle de sala necesita el nombre de cada
-- participante, sin su equipo. De ahí estas tres funciones: son SECURITY
-- DEFINER precisamente para poder calcular ese agregado sin tener que abrir
-- RLS de equipos/inscripciones/perfiles a "cualquiera lee cualquier fila"
-- (que sí filtraría los jugadores elegidos y el gasto de cada rival).
create or replace function public.inscritos_por_sala()
returns table (sala_id uuid, inscritos bigint)
language sql
security definer set search_path = public
stable
as $$
  select e.sala_id, count(*)::bigint
  from public.equipos e
  join public.inscripciones i on i.equipo_id = e.id
  where e.sala_id is not null and i.estado <> 'reembolsada'
  group by e.sala_id;
$$;

revoke all on function public.inscritos_por_sala() from public;
grant execute on function public.inscritos_por_sala() to authenticated;

create or replace function public.inscritos_por_porra()
returns table (porra_id uuid, inscritos bigint)
language sql
security definer set search_path = public
stable
as $$
  select e.porra_id, count(*)::bigint
  from public.equipos e
  join public.inscripciones i on i.equipo_id = e.id
  where e.porra_id is not null and i.estado <> 'reembolsada'
  group by e.porra_id;
$$;

revoke all on function public.inscritos_por_porra() from public;
grant execute on function public.inscritos_por_porra() to authenticated;

-- Nombres de los participantes de una sala concreta (pestaña "Jugadores"
-- del detalle) — nunca expone qué jugadores ha elegido cada uno ni cuánto
-- se ha gastado, solo quién está inscrito y desde cuándo.
create or replace function public.participantes_sala(p_sala_id uuid)
returns table (equipo_id uuid, nombre text, created_at timestamptz)
language sql
security definer set search_path = public
stable
as $$
  select e.id, coalesce(p.nombre_usuario, p.nombre), e.created_at
  from public.equipos e
  join public.inscripciones i on i.equipo_id = e.id
  join public.perfiles p on p.id = e.usuario_id
  where e.sala_id = p_sala_id and i.estado <> 'reembolsada'
  order by e.created_at asc;
$$;

revoke all on function public.participantes_sala(uuid) from public;
grant execute on function public.participantes_sala(uuid) to authenticated;

-- ============================================================================
-- INSCRIBIRSE EN UNA SALA / EN UNA PORRA (draft: elegir equipo y pagar)
-- ============================================================================
-- Estas dos funciones hacen, en una sola transacción atómica, todo lo que
-- antes tocaba hacer a mano desde el cliente en varios pasos (crear el
-- equipo, crear la inscripción, descontar el saldo): así nunca puede
-- quedar un equipo a medio crear ni un saldo descontado sin su
-- inscripción. Son SECURITY DEFINER porque necesitan poder contar cuántos
-- inscritos tiene la sala/porra ya mismo (dato agregado, ver
-- inscritos_por_sala() más arriba) sin depender de lo que la RLS del
-- usuario que llama le deje ver — pero SIEMPRE actúan sobre auth.uid(), es
-- decir, nunca se puede inscribir a nadie más que a uno mismo.
--
-- El presupuesto de fantasía (100.000 €, distinto del saldo real que se
-- descuenta) y el precio de cada jugador se validan aquí también, del lado
-- del servidor — nunca fiándose de un total que mande el cliente — por si
-- alguien manipula la petición saltándose la interfaz. Ver
-- lib/draftConfig.ts (EQUIPO_PRESUPUESTO) para el mismo valor del lado del
-- cliente.
create or replace function public.inscribirse_en_sala(
  p_sala_id uuid,
  p_jugadores jsonb,
  p_alineacion text default null,
  p_nombre_equipo text default null
)
returns public.equipos
language plpgsql
security definer set search_path = public
as $$
declare
  v_sala record;
  v_inscritos int;
  v_saldo numeric;
  v_gasto numeric;
  v_equipo public.equipos;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into v_sala from public.salas where id = p_sala_id for update;
  if not found then
    raise exception 'Sala no encontrada';
  end if;
  if v_sala.estado in ('completa', 'finalizada') then
    raise exception 'Esta sala ya no admite inscripciones';
  end if;

  if exists (
    select 1 from public.equipos e
    join public.inscripciones i on i.equipo_id = e.id
    where e.sala_id = p_sala_id and e.usuario_id = auth.uid() and i.estado <> 'reembolsada'
  ) then
    raise exception 'Ya tienes un equipo en esta sala';
  end if;

  select count(*) into v_inscritos
    from public.equipos e
    join public.inscripciones i on i.equipo_id = e.id
    where e.sala_id = p_sala_id and i.estado <> 'reembolsada';

  if v_sala.aforo is not null and v_inscritos >= v_sala.aforo then
    raise exception 'Esta sala ya está completa';
  end if;

  if p_jugadores is null or jsonb_array_length(p_jugadores) = 0 then
    raise exception 'Tienes que elegir al menos un jugador';
  end if;

  if exists (
    select 1 from public.jugadores j
    where j.id in (select (jsonb_array_elements_text(p_jugadores))::uuid)
      and (j.deporte <> v_sala.deporte or j.competicion <> v_sala.competicion)
  ) then
    raise exception 'Alguno de los jugadores elegidos no pertenece a esta competición';
  end if;

  select coalesce(sum(precio), 0) into v_gasto
    from public.jugadores
    where id in (select (jsonb_array_elements_text(p_jugadores))::uuid);

  if v_gasto > 100000 then
    raise exception 'El equipo supera el presupuesto de 100.000 €';
  end if;

  select saldo_simulado into v_saldo from public.perfiles where id = auth.uid() for update;
  if v_saldo < v_sala.buy_in then
    raise exception 'Saldo insuficiente para unirte a esta sala';
  end if;

  insert into public.equipos (usuario_id, modo, sala_id, nombre_equipo, jugadores, alineacion, gasto_total)
  values (auth.uid(), case when v_sala.tipo = 'maraton' then 'mtt' else 'sala' end, p_sala_id, p_nombre_equipo, p_jugadores, p_alineacion, v_gasto)
  returning * into v_equipo;

  insert into public.inscripciones (equipo_id, importe) values (v_equipo.id, v_sala.buy_in);

  update public.perfiles set saldo_simulado = saldo_simulado - v_sala.buy_in where id = auth.uid();

  -- Mismo criterio que ya usa el panel de admin al crear una sala a mano:
  -- marcar 'completa' al llenarse y 'casi_llena' cuando queda 1 hueco.
  if v_sala.tipo <> 'maraton' and v_sala.aforo is not null then
    if v_inscritos + 1 >= v_sala.aforo then
      update public.salas set estado = 'completa' where id = p_sala_id;
    elsif v_inscritos + 1 >= v_sala.aforo - 1 then
      update public.salas set estado = 'casi_llena' where id = p_sala_id and estado = 'abierta';
    end if;
  end if;

  return v_equipo;
end;
$$;

revoke all on function public.inscribirse_en_sala(uuid, jsonb, text, text) from public;
grant execute on function public.inscribirse_en_sala(uuid, jsonb, text, text) to authenticated;

-- Porra clásica: un jugador por cada grupo de color (sección 11), nombre de
-- equipo obligatorio y único dentro de la porra (ya lo exige el índice
-- equipos_porra_nombre_equipo_unico) — sin presupuesto de fantasía, es un
-- precio de entrada fijo (porras.precio), igual que en la maqueta
-- (isPorraEquipo no tiene barra de presupuesto).
create or replace function public.inscribirse_en_porra(
  p_porra_id uuid,
  p_jugadores jsonb,
  p_nombre_equipo text
)
returns public.equipos
language plpgsql
security definer set search_path = public
as $$
declare
  v_porra record;
  v_saldo numeric;
  v_equipo public.equipos;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if p_nombre_equipo is null or length(trim(p_nombre_equipo)) = 0 then
    raise exception 'Ponle un nombre a tu equipo';
  end if;

  select * into v_porra from public.porras where id = p_porra_id for update;
  if not found then
    raise exception 'Porra no encontrada';
  end if;
  if v_porra.estado = 'finalizada' then
    raise exception 'Esta porra ya no admite inscripciones';
  end if;

  if exists (
    select 1 from public.equipos e
    join public.inscripciones i on i.equipo_id = e.id
    where e.porra_id = p_porra_id and e.usuario_id = auth.uid() and i.estado <> 'reembolsada'
  ) then
    raise exception 'Ya tienes un equipo en esta porra';
  end if;

  if exists (
    select 1 from public.equipos e
    where e.porra_id = p_porra_id and lower(e.nombre_equipo) = lower(trim(p_nombre_equipo))
  ) then
    raise exception 'Ese nombre de equipo ya está en uso en esta porra';
  end if;

  if p_jugadores is null or jsonb_array_length(p_jugadores) = 0 then
    raise exception 'Tienes que elegir al menos un jugador';
  end if;

  if exists (
    select 1 from public.jugadores j
    where j.id in (select (jsonb_array_elements_text(p_jugadores))::uuid)
      and (j.deporte <> 'golf' or j.competicion is distinct from v_porra.competicion)
  ) then
    raise exception 'Alguno de los jugadores elegidos no pertenece a este torneo';
  end if;

  -- Como mucho un jugador de cada grupo de color.
  if (
    select count(distinct j.grupo_porra)
    from public.jugadores j
    where j.id in (select (jsonb_array_elements_text(p_jugadores))::uuid)
  ) < jsonb_array_length(p_jugadores) then
    raise exception 'Solo puedes elegir un jugador de cada grupo';
  end if;

  select saldo_simulado into v_saldo from public.perfiles where id = auth.uid() for update;
  if v_saldo < v_porra.precio then
    raise exception 'Saldo insuficiente para unirte a esta porra';
  end if;

  insert into public.equipos (usuario_id, modo, porra_id, nombre_equipo, jugadores, gasto_total)
  values (auth.uid(), 'porra', p_porra_id, trim(p_nombre_equipo), p_jugadores, 0)
  returning * into v_equipo;

  insert into public.inscripciones (equipo_id, importe) values (v_equipo.id, v_porra.precio);

  update public.perfiles set saldo_simulado = saldo_simulado - v_porra.precio where id = auth.uid();

  return v_equipo;
end;
$$;

revoke all on function public.inscribirse_en_porra(uuid, jsonb, text) from public;
grant execute on function public.inscribirse_en_porra(uuid, jsonb, text) to authenticated;

-- ============================================================================
-- CONVERTIR TU CUENTA EN SUPERADMINISTRADOR (ejecútalo aparte, una sola vez,
-- DESPUÉS de haberte registrado tú mismo en la app con tu email)
-- ============================================================================
-- update public.perfiles set rol = 'admin' where id = (
--   select id from auth.users where email = 'inigo.sinde@gmail.com'
-- );
