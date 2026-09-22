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
-- 2. SALAS (Duelo / Trío / Doble o Nada / Triple o Nada)
-- ----------------------------------------------------------------------------
create table if not exists public.salas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default public.generar_codigo_mesa(),
  nombre text not null,
  deporte text not null check (deporte in ('futbol', 'golf', 'tenis')),
  competicion text not null,
  tipo text not null check (tipo in ('duelo', 'trio', 'doble_o_nada', 'triple_o_nada')),
  aforo int not null,
  buy_in numeric(10, 2) not null,
  estado text not null default 'abierta' check (estado in ('abierta', 'casi_llena', 'completa', 'finalizada')),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. PORRAS (Porras clásicas de golf)
-- ----------------------------------------------------------------------------
create table if not exists public.porras (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default public.generar_codigo_mesa(),
  major text not null,
  estado text not null default 'proximamente' check (estado in ('disponible', 'proximamente', 'finalizada')),
  precio numeric(10, 2) not null default 20.00,
  created_at timestamptz not null default now()
);

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
  grupo_porra text check (grupo_porra in ('amarillo', 'verde', 'azul', 'liv') or grupo_porra is null),
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
  fecha timestamptz not null default now()
);

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
create or replace function public.mantener_mesas_disponibles()
returns trigger
language plpgsql
as $$
declare
  minimo_abiertas constant int := 2;
  abiertas_restantes int;
  faltan int;
begin
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
-- CONVERTIR TU CUENTA EN SUPERADMINISTRADOR (ejecútalo aparte, una sola vez,
-- DESPUÉS de haberte registrado tú mismo en la app con tu email)
-- ============================================================================
-- update public.perfiles set rol = 'admin' where id = (
--   select id from auth.users where email = 'inigo.sinde@gmail.com'
-- );
