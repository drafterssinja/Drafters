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
  saldo_simulado numeric(10, 2) not null default 60.00, -- € simulados, sin valor monetario real — 60€ de partida (28/09; antes 20€ desde el 27/09, y 150€ antes de eso — ver ALTER más abajo para cuentas ya existentes en una base de datos previa)
  terminos_aceptados boolean not null default false,
  terminos_aceptados_en timestamptz,
  rol text not null default 'usuario' check (rol in ('usuario', 'admin')),
  created_at timestamptz not null default now()
);

comment on table public.perfiles is 'Datos de producto de cada usuario registrado. El saldo es siempre simulado (€), sin conexión a ningún sistema de pago real. rol=''admin'' identifica al superadministrador (solo Iñi).';

-- Si la tabla ya existía de una ejecución anterior del esquema (el "create
-- table if not exists" de arriba no la toca en ese caso), estas columnas se
-- añaden igualmente aquí.
alter table public.perfiles add column if not exists apellido text;
alter table public.perfiles add column if not exists nombre_usuario text;

-- Saldo inicial de cuenta nueva: de 150€ a 20€ (27/09, décima vuelta) y de
-- 20€ a 60€ (28/09, pedido de Iñi). Esto solo cambia el DEFAULT de la
-- columna (ver también la propia definición de la tabla, arriba) — nunca
-- toca el saldo actual de ninguna cuenta que ya exista, solo aplica a las
-- que se registren a partir de ahora.
alter table public.perfiles alter column saldo_simulado set default 60.00;

-- Última vez que este usuario usó la recarga gratuita mensual de 10€ (ver
-- recargar_gratis_mensual() más abajo) — null hasta que la use por primera
-- vez.
alter table public.perfiles add column if not exists ultima_recarga_gratis timestamptz;

comment on column public.perfiles.nombre_usuario is 'Nombre público del usuario: es el que se muestra cuando participa en una sala/MTT. En las porras clásicas el usuario pone en su lugar un nombre de equipo (ver equipos.nombre_equipo).';

-- email (nuevo, ronda de correcciones del 23/09): copia de solo lectura del
-- email de auth.users, guardada aquí SOLO para que el admin pueda verla en
-- el listado de "Usuarios registrados" (sección 6/11.9) sin tener que
-- consultar auth.users directamente (el cliente no tiene permiso, y no hay
-- forma de hacer un join contra ese esquema desde RLS normal). Se mantiene
-- al día sola: handle_new_user() la rellena en cada alta nueva (ver más
-- abajo), y este update rellena aquí, una sola vez, los perfiles que ya
-- existían de antes de esta columna. Sigue protegida por la misma RLS que
-- el resto de `perfiles` (el propio usuario, o el admin) — nunca es
-- pública.
alter table public.perfiles add column if not exists email text;
update public.perfiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

-- El nombre de usuario tiene que ser único (sin distinguir mayúsculas de
-- minúsculas), pero se permite null mientras algún perfil antiguo no lo
-- tenga todavía relleno.
create unique index if not exists perfiles_nombre_usuario_unico
  on public.perfiles (lower(nombre_usuario))
  where nombre_usuario is not null;

-- Relleno de emergencia: cualquier perfil antiguo (de antes de que el
-- registro pidiera nombre_usuario) que todavía no tenga uno recibe aquí un
-- valor provisional no identificativo, derivado de su id, en vez de quedarse
-- en null. El nombre real del usuario (columna "nombre") NUNCA debe usarse
-- como sustituto en ningún sitio donde se muestre a otros usuarios: es un
-- dato privado. El usuario puede cambiar este nombre provisional por uno a
-- su gusto desde "Mi cuenta".
update public.perfiles
set nombre_usuario = 'jugador-' || replace(id::text, '-', '')
where nombre_usuario is null;

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

-- Formato de la porra (nuevo, 28/09 — pedido de Iñi: "me va a dar dos
-- posibilidades, crearla en el formato que actualmente estamos haciendo de
-- porras clásicas o en el formato de sueldo de 100.000 con un valor de cada
-- uno de los jugadores"): 'clasica' es el reparto por grupos de color de
-- siempre (lib/porraGrupos.ts, sin cambios); 'presupuesto' es un draft por
-- presupuesto de fantasía de 100.000 €, igual mecanismo que ya usan las
-- Mesas Drafters de golf/tenis (lib/draftConfig.ts) pero dentro de una
-- porra (sin aforo, con precio de entrada fijo = porras.precio, y equipos
-- ilimitados por participante — eso no cambia con el formato). Todas las
-- porras existentes antes de esta columna se quedan como 'clasica' (valor
-- por defecto), que es lo que ya eran.
alter table public.porras add column if not exists formato text not null default 'clasica';
alter table public.porras drop constraint if exists porras_formato_check;
-- 'futbol_jornada' añadido el 29/09 — nuevo tipo de porra de fútbol de
-- Primera División, una por jornada de liga, ver la sección "PORRA DE
-- FÚTBOL POR JORNADAS" más abajo en este archivo.
alter table public.porras add constraint porras_formato_check check (formato in ('clasica', 'presupuesto', 'futbol_jornada'));

-- Bono de podio de la clasificación en directo (nuevo, 29/09): activable por
-- porra, solo tiene sentido para porras de golf formato 'clasica' (se marca
-- al crear/editar la porra en /admin/porras-golf). Cuando está activo, al
-- liquidar la porra (y en la vista previa de la clasificación en directo) se
-- resta al resultado del equipo que tenga al 1er/2º/3er clasificado REAL del
-- torneo (por posición ESPN, no por equipo de la porra) menos 10/menos
-- 5/menos 3 golpes respectivamente — pedido de Iñi: "el primer jugador del
-- torneo va a restar menos 10, el segundo menos 5 y el tercero menos 3".
alter table public.porras add column if not exists bono_podio_activo boolean not null default false;

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
-- 4.5. RANKINGS MUNDIALES (golf y tenis) — mantenido a mano por el admin,
-- independiente de cualquier torneo concreto
-- ----------------------------------------------------------------------------
-- Pedido por Iñi (23/09): un ranking mundial de golf y otro de tenis que él
-- pueda actualizar cuando quiera desde /admin, para que al importar un
-- torneo nuevo la app compare el listado de inscritos contra ESTE ranking
-- (en vez de asumir que el orden en que se pegó el listado de inscritos ya
-- es el ranking real) — tanto para el precio de cada jugador
-- (lib/pricing.ts) como para las listas por color de la porra clásica
-- (lib/porraGrupos.ts). Ver confirmarImportacionTorneo() en
-- app/admin/page.tsx, que hace el cruce por nombre.
create table if not exists public.rankings_mundiales (
  id uuid primary key default gen_random_uuid(),
  deporte text not null check (deporte in ('golf', 'tenis')),
  nombre text not null,
  puesto int not null,
  actualizado_en timestamptz not null default now()
);

-- Guardar el ranking de un deporte reemplaza SIEMPRE la lista entera para
-- ese deporte (se borran las filas anteriores y se insertan las nuevas en
-- una sola operación, ver guardarRanking() en app/admin/page.tsx) — no es
-- un merge fila a fila. Este índice es solo una red de seguridad contra un
-- nombre repetido dentro del mismo pegado (sin distinguir mayúsculas);
-- para comparar contra el listado de un torneo concreto, que sí necesita
-- ignorar acentos ("José María Olazábal" = "Jose Maria Olazabal"), la
-- normalización real vive en lib/nombreMatch.ts, del lado de la app.
create unique index if not exists rankings_mundiales_jugador_unico
  on public.rankings_mundiales (deporte, lower(nombre));

-- ----------------------------------------------------------------------------
-- 4.6. VALOR DE MERCADO Y CUOTAS 1X2 DE FÚTBOL (ENCARGO_precios_futbol_y_
-- correccion_golf_tenis.md, parte A, 24/09/2026)
-- ----------------------------------------------------------------------------
-- El precio de fútbol dejaba de salir solo de la posición (PRECIO_POR_POSICION_
-- FUTBOL, lib/pricing.ts — se mantiene como respaldo, ver A.5) y pasa a salir
-- del valor de mercado de un fantasy oficial por competición (LaLiga/Premier/
-- Champions), ajustado por las cuotas 1X2 de cada partido de la jornada (ver
-- lib/precioFutbol.ts). El emparejamiento nombre+equipo entre la tabla de
-- valores pegada por Iñi y los jugadores ya sincronizados desde football-data.org
-- se hace en el cliente (app/admin/page.tsx, con lib/nombreMatch.ts y
-- lib/aliasEquipos.ts) — aquí solo se guarda el resultado ya resuelto, con la
-- misma RLS de "solo el admin" que jugadores/rankings_mundiales le permite
-- actualizar directamente sin necesitar una función aparte.

alter table public.jugadores add column if not exists valor_mercado numeric;
alter table public.jugadores add column if not exists probabilidad_titular numeric;
-- true si el jugador no tenía valor de mercado al cargar la tabla de esa
-- competición y se le puso el precio mediano de su posición como respaldo
-- (caso A.5 del encargo) — para que la vista previa lo marque como pendiente
-- de revisar, no se borra solo al recalcular.
alter table public.jugadores add column if not exists valor_a_revisar boolean not null default false;

-- Cuándo se cargó (o se refrescó) por última vez la tabla de valores de
-- mercado de cada competición — un registro por liga, para pintar en /admin
-- "valores de LaLiga cargados el dd/mm" (pedido explícito del encargo, A.4).
create table if not exists public.cargas_valor_mercado_futbol (
  liga text primary key check (liga in ('la_liga', 'premier', 'champions')),
  cargado_en timestamptz not null default now(),
  jugadores_actualizados int not null default 0
);

-- Cuotas 1X2 de cada partido de la jornada, tal como las pega Iñi — se
-- guardan (además de usarse para calcular el precio al confirmar) para
-- llevar un histórico y poder recalcular sin tener que volver a pegarlas.
-- Único por (competicion, equipo_local, equipo_visitante): volver a pegar
-- las cuotas de la misma jornada actualiza la fila en vez de duplicarla.
create table if not exists public.cuotas_partido_futbol (
  id uuid primary key default gen_random_uuid(),
  competicion text not null, -- mismo valor que jugadores.competicion, p.ej. 'La Liga - Jornada 8'
  equipo_local text not null,
  equipo_visitante text not null,
  cuota_1 numeric not null,
  cuota_x numeric not null,
  cuota_2 numeric not null,
  created_at timestamptz not null default now()
);

create unique index if not exists cuotas_partido_futbol_unico
  on public.cuotas_partido_futbol (competicion, equipo_local, equipo_visitante);

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

-- 'premio' añadido el 29/09 (liquidación de premios) — se inserta SIEMPRE
-- desde liquidar_evento() (security definer, ver más abajo), nunca desde el
-- cliente directamente, igual que 'deposito'/'retiro' solo se insertan desde
-- registrar_movimiento(). El `drop`+`add` hace falta porque la tabla puede
-- ya existir en una base de datos con la restricción vieja (mismo criterio
-- que en eventos_actividad, ver esa tabla más abajo).
alter table public.movimientos drop constraint if exists movimientos_tipo_check;
alter table public.movimientos add constraint movimientos_tipo_check check (tipo in ('deposito', 'retiro', 'premio'));

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

-- 'eliminado': el admin ha borrado el torneo/jornada o la porra en la que
-- participabas y se te ha reembolsado (ver eliminar_torneo()/eliminar_porra()
-- más abajo). 'resultado': tu mesa/porra ha finalizado — posición final y
-- cuánto has ganado (pedido de Iñi, 23/09; queda preparado en el modelo de
-- datos, pero todavía no hay ningún sitio en la app que calcule
-- automáticamente resultados/premios de verdad, así que por ahora nada
-- genera notificaciones de este tipo todavía). 'nuevo_usuario' (23/09,
-- segunda ronda): aviso solo para el/los admin cuando alguien completa el
-- registro — ver handle_new_user() más abajo.
alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check
  check (tipo in ('trasladado', 'reembolsado', 'eliminado', 'resultado', 'nuevo_usuario'));

-- A dónde lleva la notificación al tocarla (p.ej. la sala/porra en cuestión)
-- — null si no aplica (como en 'eliminado', que ya no tiene sala que ver).
alter table public.notificaciones add column if not exists link text;

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
--
-- Además (nuevo, 23/09, pedido de Iñi), avisa al superadministrador: cada
-- perfil con rol='admin' recibe una notificación 'nuevo_usuario' con el
-- nombre de usuario de la persona recién registrada. Nota de interpretación:
-- el aviso se genera en el momento de rellenar el formulario de registro
-- (que es cuando se crea de verdad la fila en `perfiles`), no al verificar
-- el código del email — así que también avisa de registros que luego
-- queden sin verificar. Si prefieres que solo avise tras verificar el
-- email, dímelo y lo cambio.
--
-- También copia el email a `perfiles.email` (nuevo, ronda de correcciones
-- del 23/09) para que el listado de "Usuarios registrados" del admin lo
-- pueda mostrar sin tocar auth.users directamente.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_nombre_usuario text := nullif(new.raw_user_meta_data ->> 'nombre_usuario', '');
begin
  insert into public.perfiles (id, nombre, apellido, nombre_usuario, fecha_nacimiento, terminos_aceptados, terminos_aceptados_en, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nombre', ''),
    nullif(new.raw_user_meta_data ->> 'apellido', ''),
    v_nombre_usuario,
    nullif(new.raw_user_meta_data ->> 'fecha_nacimiento', '')::date,
    coalesce((new.raw_user_meta_data ->> 'terminos_aceptados')::boolean, false),
    case when (new.raw_user_meta_data ->> 'terminos_aceptados')::boolean then now() else null end,
    new.email
  );

  insert into public.notificaciones (usuario_id, tipo, titulo, mensaje)
  select
    p.id,
    'nuevo_usuario',
    'Nuevo usuario registrado',
    'Se acaba de registrar en Drafters el usuario "' || coalesce(v_nombre_usuario, '(sin nombre de usuario)') || '".'
  from public.perfiles p
  where p.rol = 'admin';

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
-- p_excluir_id (nuevo, 23/09): al comprobar disponibilidad desde "Mi cuenta"
-- (para poder CAMBIAR tu propio nombre de usuario, no solo elegirlo en el
-- registro), hay que ignorar tu propia fila — si no, comprobar tu nombre
-- actual sin cambiarlo saldría siempre "no disponible" porque ya lo tienes
-- tú mismo. Se quita primero la versión de un solo parámetro para no dejar
-- dos funciones distintas (ambigüedad al llamarla con un solo argumento) —
-- la llamada ya existente desde el registro (solo con p_nombre_usuario)
-- sigue funcionando igual, p_excluir_id se queda en null por defecto.
drop function if exists public.nombre_usuario_disponible(text);

create or replace function public.nombre_usuario_disponible(p_nombre_usuario text, p_excluir_id uuid default null)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select not exists (
    select 1 from public.perfiles
    where lower(nombre_usuario) = lower(p_nombre_usuario)
      and (p_excluir_id is null or id <> p_excluir_id)
  );
$$;

revoke all on function public.nombre_usuario_disponible(text, uuid) from public;
grant execute on function public.nombre_usuario_disponible(text, uuid) to anon, authenticated;

-- ============================================================================
-- CONSOLIDACIÓN DE SALAS INCOMPLETAS AL CERRAR LA INSCRIPCIÓN
-- ============================================================================
-- Pedido explícito de Iñi (22/09, precisado el 30/09): cuando el plazo de
-- inscripción de una sala (fecha_limite_inscripcion) se cumple y esa sala
-- no se ha llenado, solo pasa algo si existe OTRA sala EXACTAMENTE igual —
-- mismo deporte + competición/jornada + tipo de mesa + aforo + buy-in
-- (misma "cantidad", pedido explícito de Iñi el 30/09: dos mesas del mismo
-- tipo pero con distinto aforo o distinto buy-in NUNCA se consideran
-- iguales, aunque compartan tipo) — que también esté incompleta en ese
-- momento:
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
-- Programada para ejecutarse sola cada 5 minutos (nuevo, 30/09) — ver el
-- bloque final de este archivo, "CRON DE CONSOLIDACIÓN DE MESAS", que no
-- necesita ningún dato manual (a diferencia del cron de resultados de golf,
-- esta función es SQL puro, no llama a ninguna URL externa). Antes había
-- que programarla a mano desde Supabase; ya no hace falta.
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
    -- "Exactamente igual" (precisado por Iñi el 30/09) incluye ahora
    -- también el aforo y el buy-in ("la misma cantidad"), no solo
    -- deporte + competición + tipo — dos mesas del mismo tipo pero con
    -- distinto número de plazas o distinto importe de entrada nunca se
    -- fusionan entre sí.
    select distinct deporte, competicion, tipo, aforo, buy_in
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
        and s.aforo = grupo.aforo and s.buy_in = grupo.buy_in
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
          and aforo = grupo.aforo and buy_in = grupo.buy_in
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
        and s.aforo = grupo.aforo and s.buy_in = grupo.buy_in
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
        and s.aforo = grupo.aforo and s.buy_in = grupo.buy_in
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
        and s.aforo = grupo.aforo and s.buy_in = grupo.buy_in
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
alter table public.rankings_mundiales enable row level security;
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

-- Rankings mundiales: solo lo usa el propio admin (para cotejar al
-- importar un torneo), nunca se muestra a los usuarios — así que, a
-- diferencia de jugadores/salas/porras, ni siquiera hay lectura pública.
drop policy if exists "rankings_mundiales_admin_todo" on public.rankings_mundiales;
create policy "rankings_mundiales_admin_todo" on public.rankings_mundiales
  for all using (public.es_admin()) with check (public.es_admin());

-- Valor de mercado de fútbol: datos de trabajo del admin para calcular
-- precios, nunca se muestran tal cual a los usuarios (el resultado ya
-- resuelto sí se ve, en jugadores.precio) — mismo caso que rankings_mundiales.
alter table public.cargas_valor_mercado_futbol enable row level security;
drop policy if exists "cargas_valor_mercado_futbol_admin_todo" on public.cargas_valor_mercado_futbol;
create policy "cargas_valor_mercado_futbol_admin_todo" on public.cargas_valor_mercado_futbol
  for all using (public.es_admin()) with check (public.es_admin());

-- Cuotas 1x2 de fútbol: a diferencia del valor de mercado, esto SÍ se
-- muestra a los usuarios (25/09) — el filtro de "partidos de la jornada" en
-- la pantalla de crear equipo (app/salas/[id]/crear-equipo) lo lee para
-- pintar la columna de partidos y filtrar la lista de jugadores por equipo.
alter table public.cuotas_partido_futbol enable row level security;
drop policy if exists "cuotas_partido_futbol_admin_todo" on public.cuotas_partido_futbol;
create policy "cuotas_partido_futbol_admin_todo" on public.cuotas_partido_futbol
  for all using (public.es_admin()) with check (public.es_admin());

drop policy if exists "cuotas_partido_futbol_select_publico" on public.cuotas_partido_futbol;
create policy "cuotas_partido_futbol_select_publico" on public.cuotas_partido_futbol
  for select using (true);

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

-- Número romano para distinguir los varios equipos de un mismo usuario en
-- un torneo Maratón (nuevo, 26/09 novena vuelta) — ver participantes_sala()
-- más abajo, que es quien lo usa. Pedido de Iñi: "en los torneos maratón
-- se puede hacer más de un equipo... el nombre de usuario, y el segundo
-- equipo pondrá entre paréntesis un 2 en número romano... así
-- consecutivamente".
create or replace function public.numero_romano(p_numero int)
returns text
language plpgsql
immutable
as $$
declare
  v_valores int[] := array[1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  v_simbolos text[] := array['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
  v_resultado text := '';
  v_resto int := p_numero;
  i int;
begin
  if p_numero is null or p_numero < 1 then
    return '';
  end if;
  for i in 1..array_length(v_valores, 1) loop
    while v_resto >= v_valores[i] loop
      v_resultado := v_resultado || v_simbolos[i];
      v_resto := v_resto - v_valores[i];
    end loop;
  end loop;
  return v_resultado;
end;
$$;

-- Nombres de los participantes de una sala concreta (pestaña "Jugadores"
-- del detalle) — nunca expone qué jugadores ha elegido cada uno ni cuánto
-- se ha gastado, solo quién está inscrito y desde cuándo.
--
-- Numeración de equipos repetidos (nuevo, 26/09 novena vuelta): en los
-- torneos Maratón un mismo usuario puede tener más de un equipo en la misma
-- sala (ver inscribirse_en_sala() más abajo, que ya no lo bloquea para
-- tipo='maraton'). Pedido de Iñi: el primer equipo de cada usuario se sigue
-- viendo con su nombre de usuario tal cual; el segundo, tercero... llevan
-- detrás " (II)", " (III)"... en número romano, por orden de inscripción.
-- Para el resto de tipos de sala esto no cambia nada en la práctica, porque
-- ahí ya está prohibido tener más de un equipo (row_number() siempre da 1).
create or replace function public.participantes_sala(p_sala_id uuid)
returns table (equipo_id uuid, nombre text, created_at timestamptz)
language sql
security definer set search_path = public
stable
as $$
  select
    e.id,
    case when e.rn = 1 then e.base_nombre else e.base_nombre || ' (' || public.numero_romano(e.rn::int) || ')' end,
    e.created_at
  from (
    -- Nunca se usa p.nombre (nombre real) aquí: si por lo que sea un perfil
    -- no tiene nombre_usuario, se muestra un identificador provisional
    -- derivado de su id en vez del nombre real (el relleno de arriba en la
    -- tabla perfiles ya debería evitar que esto pase, pero se deja como red
    -- de seguridad porque los nombres reales no pueden aparecer nunca).
    select
      eq.id,
      eq.created_at,
      coalesce(p.nombre_usuario, 'jugador-' || replace(p.id::text, '-', '')) as base_nombre,
      row_number() over (partition by eq.usuario_id order by eq.created_at asc) as rn
    from public.equipos eq
    join public.inscripciones i on i.equipo_id = eq.id
    join public.perfiles p on p.id = eq.usuario_id
    where eq.sala_id = p_sala_id and i.estado <> 'reembolsada'
  ) e
  order by e.created_at asc;
$$;

revoke all on function public.numero_romano(int) from public;
grant execute on function public.numero_romano(int) to authenticated;

revoke all on function public.participantes_sala(uuid) from public;
grant execute on function public.participantes_sala(uuid) to authenticated;

-- Equipos participantes de una porra clásica (pestaña "Equipos" del
-- detalle). Antes (23/09) el nombre se ocultaba hasta que la porra hubiera
-- empezado de verdad — **corregido el 28/09, pedido explícito de Iñi:
-- "tienen que verse los nombres de los equipos inscritos"** — ahora el
-- nombre de cada equipo se ve siempre, desde el momento en que se inscribe.
-- La columna `oculto` se deja en la firma (devuelve siempre `false`) para
-- no tener que tocar también el resto de sitios que leen esta función.
create or replace function public.participantes_porra(p_porra_id uuid)
returns table (equipo_id uuid, nombre_equipo text, created_at timestamptz, oculto boolean)
language sql
security definer set search_path = public
stable
as $$
  select
    e.id,
    e.nombre_equipo,
    e.created_at,
    false
  from public.equipos e
  join public.inscripciones i on i.equipo_id = e.id
  where e.porra_id = p_porra_id and i.estado <> 'reembolsada'
  order by e.created_at asc;
$$;

revoke all on function public.participantes_porra(uuid) from public;
grant execute on function public.participantes_porra(uuid) to authenticated;

-- Equipos participantes de una porra clásica CON su plantilla de 5
-- jugadores (nuevo, 28/09) — para la pantalla real de "Clasificación en
-- directo" (app/porras/[id]/clasificacion/page.tsx), que necesita poder
-- mostrar, al pulsar un equipo del ranking, sus 5 jugadores — algo que
-- participantes_porra() no da (solo el nombre del equipo, nunca su
-- plantilla, porque esa función también se usa en la pestaña "Equipos" del
-- detalle de porra, ANTES de que empiece, donde la plantilla de un rival
-- nunca debe verse). Aquí, en cambio, la plantilla completa solo se expone
-- una vez la porra ha "empezado" (mismo criterio que participantes_porra:
-- fecha límite de inscripción ya pasada, o porra finalizada) — antes de
-- eso, esta función no devuelve ninguna fila, tal y como corresponde a una
-- pantalla de clasificación que solo tiene sentido una vez la porra está en
-- juego. Pedido de Iñi (27/09): "cuando pulsan un participante se vean los
-- cinco jugadores que tienes". La puntuación en vivo de cada jugador
-- (resultados_evento) todavía no existe — esta función solo da la
-- composición de cada equipo; el total en puntos lo calcula el cliente a
-- partir de datos reales en cuanto exista esa pieza (sección 12 de la
-- arquitectura técnica).
create or replace function public.equipos_porra_clasificacion(p_porra_id uuid)
returns table (equipo_id uuid, nombre_equipo text, jugadores jsonb, created_at timestamptz)
language sql
security definer set search_path = public
stable
as $$
  select e.id, e.nombre_equipo, to_jsonb(e.jugadores), e.created_at
  from public.equipos e
  join public.inscripciones i on i.equipo_id = e.id
  where e.porra_id = p_porra_id
    and i.estado <> 'reembolsada'
    and exists (
      select 1 from public.porras p
      where p.id = p_porra_id
        and (p.estado = 'finalizada' or (p.fecha_limite_inscripcion is not null and p.fecha_limite_inscripcion <= now()))
    )
  order by e.created_at asc;
$$;

revoke all on function public.equipos_porra_clasificacion(uuid) from public;
grant execute on function public.equipos_porra_clasificacion(uuid) to authenticated;

-- Equipos participantes de una mesa Drafters CON su plantilla (nuevo,
-- 30/09) — para la pantalla real de "Clasificación en directo" de las
-- mesas (app/salas/[id]/clasificacion/page.tsx), mismo criterio que
-- equipos_porra_clasificacion() de arriba: solo devuelve filas una vez la
-- mesa ha "empezado" (fecha límite de inscripción ya pasada, o mesa
-- finalizada) — antes de eso, lista vacía. A diferencia de las porras, en
-- una mesa el equipo no tiene nombre propio (equipos.nombre_equipo es
-- siempre null aquí — ver el comentario de la tabla equipos): el nombre
-- mostrado es el nombre de usuario del dueño, numerado en números romanos
-- si tiene más de un equipo en la misma mesa (solo posible en Maratón) —
-- mismo criterio exacto que participantes_sala() más arriba.
create or replace function public.equipos_sala_clasificacion(p_sala_id uuid)
returns table (equipo_id uuid, nombre text, jugadores jsonb, created_at timestamptz)
language sql
security definer set search_path = public
stable
as $$
  select
    e.id,
    case when e.rn = 1 then e.base_nombre else e.base_nombre || ' (' || public.numero_romano(e.rn::int) || ')' end,
    to_jsonb(e.jugadores),
    e.created_at
  from (
    select
      eq.id,
      eq.jugadores,
      eq.created_at,
      coalesce(p.nombre_usuario, 'jugador-' || replace(p.id::text, '-', '')) as base_nombre,
      row_number() over (partition by eq.usuario_id order by eq.created_at asc) as rn
    from public.equipos eq
    join public.inscripciones i on i.equipo_id = eq.id
    join public.perfiles p on p.id = eq.usuario_id
    where eq.sala_id = p_sala_id and i.estado <> 'reembolsada'
  ) e
  where exists (
    select 1 from public.salas s
    where s.id = p_sala_id
      and (s.estado = 'finalizada' or (s.fecha_limite_inscripcion is not null and s.fecha_limite_inscripcion <= now()))
  )
  order by e.created_at asc;
$$;

revoke all on function public.equipos_sala_clasificacion(uuid) from public;
grant execute on function public.equipos_sala_clasificacion(uuid) to authenticated;

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

  -- Maratón es la excepción: se permite más de un equipo por usuario
  -- (nuevo, 26/09 novena vuelta, pedido de Iñi: "en los torneos maratón se
  -- puede hacer más de un equipo") — el resto de tipos de sala se quedan
  -- exactamente igual, con el límite de uno solo.
  if v_sala.tipo <> 'maraton' and exists (
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
  v_gasto numeric;
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

  -- Un usuario puede tener varios equipos en la misma porra (pedido de Iñi,
  -- 23/09: "en la porra puedo participar todas las veces que quiera") — así
  -- que, a diferencia de las salas normales, aquí NO se bloquea por ya tener
  -- un equipo. Lo único que tiene que ser único es el nombre del equipo
  -- dentro de la porra (regla que ya existía).
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

  -- No se puede elegir dos veces al mismo jugador (ni siquiera como
  -- "comodín" — el comodín es para repetir GRUPO, nunca jugador).
  if jsonb_array_length(p_jugadores) <> (
    select count(distinct v) from jsonb_array_elements_text(p_jugadores) v
  ) then
    raise exception 'No puedes elegir el mismo jugador más de una vez';
  end if;

  -- Regla de composición del equipo: depende del formato de la porra
  -- (nuevo, 28/09 — porras.formato, ver más arriba en este esquema).
  if v_porra.formato = 'clasica' then
    -- Un jugador de cada grupo de color, más un único "comodín" que puede
    -- repetir grupo (regla corregida por Iñi el 23/09: el quinto jugador del
    -- equipo siempre puede salir de cualquiera de las listas ya usadas) — así
    -- que como mucho un grupo puede aparecer dos veces, nunca más de dos, y
    -- nunca dos grupos repetidos a la vez.
    if (
      jsonb_array_length(p_jugadores) - (
        select count(distinct j.grupo_porra)
        from public.jugadores j
        where j.id in (select (jsonb_array_elements_text(p_jugadores))::uuid)
      )
    ) > 1 then
      raise exception 'Como mucho puedes repetir un grupo de color (tu jugador comodín)';
    end if;
  else
    -- Formato "presupuesto" (nuevo, 28/09, pedido de Iñi): sin grupos de
    -- color ni comodín — el equipo se elige libremente, jugador a jugador,
    -- dentro de un presupuesto de fantasía de 100.000 €, mismo mecanismo que
    -- ya usan las Mesas Drafters de golf/tenis (lib/draftConfig.ts,
    -- EQUIPO_PRESUPUESTO, e inscribirse_en_sala() más arriba en este mismo
    -- archivo) — el precio de entrada de la porra (v_porra.precio) es aparte
    -- y no cambia con esto.
    select coalesce(sum(precio), 0) into v_gasto
      from public.jugadores
      where id in (select (jsonb_array_elements_text(p_jugadores))::uuid);

    if v_gasto > 100000 then
      raise exception 'El equipo supera el presupuesto de 100.000 €';
    end if;
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

-- Editar un equipo YA inscrito en una porra (pedido de Iñi, 23/09): cambia
-- el nombre y/o los jugadores elegidos sin volver a cobrar (la inscripción y
-- el importe ya existentes no se tocan). Repite las mismas validaciones que
-- inscribirse_en_porra() salvo la de "ya tienes un equipo" (aquí no aplica:
-- se está editando uno que ya existe) y excluye el propio equipo al
-- comprobar que el nombre no esté repetido.
create or replace function public.editar_equipo_porra(
  p_equipo_id uuid,
  p_jugadores jsonb,
  p_nombre_equipo text
)
returns public.equipos
language plpgsql
security definer set search_path = public
as $$
declare
  v_equipo public.equipos;
  v_porra record;
  v_gasto numeric;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into v_equipo from public.equipos where id = p_equipo_id and usuario_id = auth.uid() and modo = 'porra' for update;
  if not found then
    raise exception 'Equipo no encontrado';
  end if;

  select * into v_porra from public.porras where id = v_equipo.porra_id for update;
  if not found or v_porra.estado = 'finalizada' then
    raise exception 'Esta porra ya no admite cambios';
  end if;

  if p_nombre_equipo is null or length(trim(p_nombre_equipo)) = 0 then
    raise exception 'Ponle un nombre a tu equipo';
  end if;

  if exists (
    select 1 from public.equipos e
    where e.porra_id = v_equipo.porra_id and e.id <> p_equipo_id and lower(e.nombre_equipo) = lower(trim(p_nombre_equipo))
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

  if jsonb_array_length(p_jugadores) <> (
    select count(distinct v) from jsonb_array_elements_text(p_jugadores) v
  ) then
    raise exception 'No puedes elegir el mismo jugador más de una vez';
  end if;

  -- Misma regla de composición que inscribirse_en_porra(), según el formato
  -- de la porra (28/09).
  if v_porra.formato = 'clasica' then
    if (
      jsonb_array_length(p_jugadores) - (
        select count(distinct j.grupo_porra)
        from public.jugadores j
        where j.id in (select (jsonb_array_elements_text(p_jugadores))::uuid)
      )
    ) > 1 then
      raise exception 'Como mucho puedes repetir un grupo de color (tu jugador comodín)';
    end if;
  else
    select coalesce(sum(precio), 0) into v_gasto
      from public.jugadores
      where id in (select (jsonb_array_elements_text(p_jugadores))::uuid);

    if v_gasto > 100000 then
      raise exception 'El equipo supera el presupuesto de 100.000 €';
    end if;
  end if;

  update public.equipos
    set nombre_equipo = trim(p_nombre_equipo), jugadores = p_jugadores
    where id = p_equipo_id
    returning * into v_equipo;

  return v_equipo;
end;
$$;

revoke all on function public.editar_equipo_porra(uuid, jsonb, text) from public;
grant execute on function public.editar_equipo_porra(uuid, jsonb, text) to authenticated;

-- Editar un equipo YA inscrito en una sala/MTT (nuevo, 27/09, décima vuelta)
-- — antes el botón de "Modificar equipo" del detalle de sala estaba
-- deshabilitado ("próximamente"); pedido de Iñi: "habilítalo ya, que se
-- pueda editar tu equipo y volver a confirmar". Mismo patrón que
-- editar_equipo_porra() de arriba — cambia los jugadores elegidos y la
-- alineación (fútbol) SIN volver a cobrar el buy-in (la inscripción y el
-- importe ya existentes no se tocan).
--
-- A diferencia de INSCRIBIRSE (que sí exige que la sala no esté completa),
-- aquí "completa" NO bloquea — corrección explícita de Iñi el mismo día:
-- "el botón de modificar equipo va a estar disponible hasta que finalice la
-- hora de inscripción, da igual si la sala está llena o no". Lo único que
-- bloquea es que la sala ya haya finalizado, o que ya haya pasado su fecha
-- límite de inscripción (si tiene una fijada) — mismo momento en el que
-- tampoco se puede ya entrar a inscribirse.
create or replace function public.editar_equipo_sala(
  p_equipo_id uuid,
  p_jugadores jsonb,
  p_alineacion text default null
)
returns public.equipos
language plpgsql
security definer set search_path = public
as $$
declare
  v_equipo public.equipos;
  v_sala record;
  v_gasto numeric;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into v_equipo from public.equipos where id = p_equipo_id and usuario_id = auth.uid() and modo in ('sala', 'mtt') for update;
  if not found then
    raise exception 'Equipo no encontrado';
  end if;

  select * into v_sala from public.salas where id = v_equipo.sala_id for update;
  if not found or v_sala.estado = 'finalizada' then
    raise exception 'Esta sala ya no admite cambios';
  end if;
  if v_sala.fecha_limite_inscripcion is not null and now() > v_sala.fecha_limite_inscripcion then
    raise exception 'Ya ha pasado la fecha límite para modificar tu equipo en esta sala';
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

  if jsonb_array_length(p_jugadores) <> (
    select count(distinct v) from jsonb_array_elements_text(p_jugadores) v
  ) then
    raise exception 'No puedes elegir el mismo jugador más de una vez';
  end if;

  select coalesce(sum(precio), 0) into v_gasto
    from public.jugadores
    where id in (select (jsonb_array_elements_text(p_jugadores))::uuid);

  if v_gasto > 100000 then
    raise exception 'El equipo supera el presupuesto de 100.000 €';
  end if;

  update public.equipos
    set jugadores = p_jugadores, alineacion = p_alineacion, gasto_total = v_gasto
    where id = p_equipo_id
    returning * into v_equipo;

  return v_equipo;
end;
$$;

revoke all on function public.editar_equipo_sala(uuid, jsonb, text) from public;
grant execute on function public.editar_equipo_sala(uuid, jsonb, text) to authenticated;

-- Reemplaza de golpe todo el ranking mundial de un deporte (golf o tenis)
-- por el listado que acaba de pegar el admin — en una única transacción,
-- para que un fallo a mitad de camino nunca deje la tabla vacía (ver
-- guardarRanking() en app/admin/page.tsx, que llama a esto en vez de hacer
-- el borrado y la inserción como dos llamadas sueltas desde el cliente).
-- Es SECURITY DEFINER para poder saltarse la RLS de rankings_mundiales
-- (que solo permite acceso al admin) sin tener que abrirla más — pero
-- comprueba el rol ella misma, así que sigue siendo tan seguro como la RLS.
create or replace function public.reemplazar_ranking_mundial(p_deporte text, p_jugadores jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede actualizar el ranking mundial';
  end if;
  if p_deporte not in ('golf', 'tenis') then
    raise exception 'Deporte no válido';
  end if;

  delete from public.rankings_mundiales where deporte = p_deporte;

  insert into public.rankings_mundiales (deporte, nombre, puesto)
  select p_deporte, (elem ->> 'nombre'), (elem ->> 'puesto')::int
  from jsonb_array_elements(p_jugadores) as elem;
end;
$$;

revoke all on function public.reemplazar_ranking_mundial(text, jsonb) from public;
grant execute on function public.reemplazar_ranking_mundial(text, jsonb) to authenticated;

-- ============================================================================
-- ELIMINAR TORNEO/JORNADA Y ELIMINAR PORRA (panel de admin, pedido de Iñi
-- 23/09: "que me deje eliminar algún torneo... y en el caso de que
-- eliminemos un torneo o una jornada, hay que quitar a todos los
-- participantes, devolverles el dinero y lanzarles un mensaje")
-- ============================================================================
-- Borra TODAS las mesas (salas) de un torneo/jornada (mismo valor exacto de
-- `competicion` que se usó al crearlas/importarlas) — antes de borrar nada,
-- reembolsa íntegramente a cualquier inscrito activo y le deja una
-- notificación. Las salas se borran de verdad (on delete cascade se lleva
-- por delante sus equipos/inscripciones), pero el reembolso ya ha quedado
-- registrado en `movimientos` de forma independiente, así que el historial
-- de saldo del usuario no se pierde. La porra clásica de ese mismo torneo
-- (si la hay) NO se toca aquí — es una entidad aparte que se borra con
-- eliminar_porra() más abajo, tal y como las trata el propio panel de admin.
create or replace function public.eliminar_torneo(p_competicion text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  candidato record;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede eliminar un torneo o jornada';
  end if;
  if p_competicion is null or length(trim(p_competicion)) = 0 then
    raise exception 'Competición no válida';
  end if;

  for candidato in
    select e.id as equipo_id, e.usuario_id, i.id as inscripcion_id, i.importe, s.nombre as sala_nombre
    from public.equipos e
    join public.inscripciones i on i.equipo_id = e.id and i.estado <> 'reembolsada'
    join public.salas s on s.id = e.sala_id
    where s.competicion = p_competicion
  loop
    update public.inscripciones set estado = 'reembolsada' where id = candidato.inscripcion_id;
    update public.perfiles set saldo_simulado = saldo_simulado + candidato.importe where id = candidato.usuario_id;
    insert into public.movimientos (usuario_id, tipo, importe) values (candidato.usuario_id, 'deposito', candidato.importe);
    insert into public.notificaciones (usuario_id, tipo, titulo, mensaje) values (
      candidato.usuario_id,
      'eliminado',
      'Tu mesa se ha borrado, se te ha devuelto el importe',
      'El torneo/jornada "' || p_competicion || '" (' || candidato.sala_nombre || ') se ha eliminado. Te hemos devuelto tu inscripción íntegra, sin ningún descuento.'
    );
  end loop;

  delete from public.salas where competicion = p_competicion;
end;
$$;

revoke all on function public.eliminar_torneo(text) from public;
grant execute on function public.eliminar_torneo(text) to authenticated;

-- Borra una porra clásica concreta, con el mismo reembolso + notificación
-- que eliminar_torneo() para cualquier equipo activo. Pensado sobre todo
-- para el caso real que reportó Iñi: importar el mismo torneo dos veces deja
-- los jugadores duplicados dentro de la porra ya existente — borrarla y
-- volver a crearla (desde "Nuevo torneo", marcando solo el check de "crear
-- porra") es la forma de dejarla limpia otra vez.
create or replace function public.eliminar_porra(p_porra_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  candidato record;
  v_major text;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede eliminar una porra';
  end if;

  select major into v_major from public.porras where id = p_porra_id;
  if not found then
    raise exception 'Porra no encontrada';
  end if;

  for candidato in
    select e.id as equipo_id, e.usuario_id, i.id as inscripcion_id, i.importe
    from public.equipos e
    join public.inscripciones i on i.equipo_id = e.id and i.estado <> 'reembolsada'
    where e.porra_id = p_porra_id
  loop
    update public.inscripciones set estado = 'reembolsada' where id = candidato.inscripcion_id;
    update public.perfiles set saldo_simulado = saldo_simulado + candidato.importe where id = candidato.usuario_id;
    insert into public.movimientos (usuario_id, tipo, importe) values (candidato.usuario_id, 'deposito', candidato.importe);
    insert into public.notificaciones (usuario_id, tipo, titulo, mensaje) values (
      candidato.usuario_id,
      'eliminado',
      'Tu porra se ha borrado, se te ha devuelto el importe',
      'La porra "' || v_major || '" se ha eliminado. Te hemos devuelto tu inscripción íntegra, sin ningún descuento.'
    );
  end loop;

  delete from public.porras where id = p_porra_id;
end;
$$;

revoke all on function public.eliminar_porra(uuid) from public;
grant execute on function public.eliminar_porra(uuid) to authenticated;

-- ============================================================================
-- PUBLICIDAD EN VÍDEO (nuevo, 27/09, décima vuelta)
-- ============================================================================
-- Pedido de Iñi: monetizar con vídeos publicitarios de patrocinadores, en
-- estos huecos de la app:
--  1) Recarga de saldo (/recargar): la pantalla deja de tener los 4 botones
--     de recarga instantánea y pasa a tener solo dos opciones — una recarga
--     GRATIS de 20€ (como mucho una vez cada 30 días, ver
--     recargar_gratis_mensual() más abajo) y, a partir de ahí, tantas
--     recargas de 20€ como quiera el usuario SIEMPRE que vea antes un vídeo
--     publicitario completo (recargar_por_video()). Antes eran 10€ cada una
--     — subido a 20€ el 28/09, pedido de Iñi: "para que si uno quiere
--     comprar 20 euros ficticios para apuntarse una porra, que no tenga que
--     ver dos vídeos".
--  2) Clasificación en directo (/salas/[id]/clasificacion): un vídeo
--     publicitario reproduciéndose debajo del contenido de la pantalla, sin
--     interferir con la vista de la clasificación — aquí solo cuenta como
--     "visualización" a efectos de estadísticas para el admin, no reparte
--     saldo (registrar_visualizacion_anuncio()).
--  3) Pantalla /mesas (28/09): un vídeo embebido entre "tus mesas en
--     juego" y "Elige tu deporte" — vivió primero como prueba en el feed de
--     /inicio (27/09), se quitó de ahí el mismo día al simplificar esa
--     pantalla a dos recuadros, y el 28/09 Iñi pidió recuperar el hueco,
--     esta vez en /mesas. Se puede desactivar sin tocar código en ningún
--     momento: basta con desmarcar "Mesas Drafters" en cada vídeo desde
--     /admin (o dejar simplemente que ningún vídeo activo lo tenga
--     marcado). Igual que en clasificación, solo cuenta como
--     "visualización" para las estadísticas, no reparte saldo.
--
-- En los huecos 2 y 3 (los que no reparten saldo), el vídeo se reproduce
-- silenciado de serie con un botón propio para activar/desactivar el
-- sonido (pedido de Iñi, 28/09) — ver components/AnuncioVideoInline.tsx. Y,
-- como esos dos huecos reproducen en bucle, cada usuario cuenta como mucho
-- una visualización por vídeo al día para las estadísticas (pedido de Iñi,
-- 28/09) — ver registrar_visualizacion_anuncio() más abajo. El hueco 1
-- (recarga) no tiene este límite: ahí cada visualización va ligada a un
-- +20€ real, así que sigue contando todas, sin límite de veces al día.
--
-- Los vídeos en sí se guardan en Supabase Storage, en un bucket nuevo
-- llamado "anuncios" — público de LECTURA (hace falta para que el <video>
-- del navegador los reproduzca con una URL directa), de ESCRITURA solo el
-- admin (políticas de storage.objects más abajo). Se suben desde una
-- sección nueva en /admin ("Publicidad en vídeo").

create table if not exists public.anuncios_video (
  id uuid primary key default gen_random_uuid(),
  nombre_referencia text not null, -- solo para uso interno del admin (qué anunciante es)
  url text not null, -- URL pública del vídeo en el bucket "anuncios"
  prioridad int not null default 0 check (prioridad >= 0), -- cuanto más alto, más veces sale — ver elegir_anuncio_video()
  activo boolean not null default true,
  mostrar_en_recarga boolean not null default true,
  mostrar_en_clasificacion boolean not null default true,
  mostrar_en_mesas boolean not null default true, -- pantalla /mesas, entre "tus mesas en juego" y el selector de deporte (movido aquí el 28/09 — antes era el feed de /inicio, ver más abajo)
  fecha_inicio timestamptz not null default now(),
  fecha_fin timestamptz, -- null = sin fecha de fin
  creado_at timestamptz not null default now()
);

comment on table public.anuncios_video is 'Vídeos publicitarios subidos desde /admin. La prioridad decide, mediante un sorteo ponderado (ver elegir_anuncio_video()), cuántas veces sale cada uno — sin que ninguno activo pueda quedarse casi sin verse.';

-- Tercer hueco: pantalla /mesas, entre "tus mesas en juego" y el selector
-- de deporte (28/09 — Iñi pidió recuperar este hueco, que había quedado sin
-- usarse desde que se quitó del feed de /inicio el 27/09; ahora vive en
-- /mesas en su lugar). Si el esquema ya se había ejecutado con el nombre
-- antiguo de la columna (mostrar_en_inicio, de cuando este hueco vivía en
-- /inicio), se renombra para no perder lo que el admin ya tuviera marcado;
-- si la tabla es nueva o ya tiene el nombre actual, no hace nada.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'anuncios_video' and column_name = 'mostrar_en_inicio')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'anuncios_video' and column_name = 'mostrar_en_mesas') then
    alter table public.anuncios_video rename column mostrar_en_inicio to mostrar_en_mesas;
  end if;
end $$;
alter table public.anuncios_video add column if not exists mostrar_en_mesas boolean not null default true;

alter table public.anuncios_video enable row level security;
drop policy if exists "anuncios_video_admin_todo" on public.anuncios_video;
create policy "anuncios_video_admin_todo" on public.anuncios_video
  for all using (public.es_admin()) with check (public.es_admin());
-- Sin política de lectura pública a propósito (mismo caso que
-- rankings_mundiales o el valor de mercado de fútbol, sección 4/9): un
-- usuario normal nunca lee esta tabla directamente — recibe el vídeo ya
-- elegido a través de elegir_anuncio_video(), que solo devuelve id/url/
-- nombre del vídeo sorteado, nunca la prioridad de nadie ni el resto de la
-- tabla.

-- Un registro por cada vez que un vídeo se reproduce (completo o no) — para
-- dos cosas: dar de comer al panel de admin ("cuántas veces se ha visto
-- cada vídeo", para poder enseñárselo al anunciante) y, en el caso de
-- 'recarga', es la prueba de que el vídeo se vio de verdad antes de dar los
-- 20€ (ver recargar_por_video()).
create table if not exists public.anuncios_video_reproducciones (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.anuncios_video(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  ubicacion text not null check (ubicacion in ('recarga', 'clasificacion', 'mesas')),
  completado boolean not null default false,
  creado_at timestamptz not null default now()
);

-- Sustituye 'inicio' por 'mesas' como ubicación válida (28/09 — el hueco se
-- ha movido de /inicio a /mesas, ver más arriba). Sin necesidad de migrar
-- filas existentes: 'inicio' nunca llegó a registrar ninguna visualización
-- real (registrar_visualizacion_anuncio() nunca la permitió como valor,
-- solo 'recarga' y 'clasificacion' — ver esa función más abajo), así que no
-- puede haber ninguna fila con ubicacion = 'inicio' que este cambio deje
-- huérfana.
alter table public.anuncios_video_reproducciones drop constraint if exists anuncios_video_reproducciones_ubicacion_check;
alter table public.anuncios_video_reproducciones add constraint anuncios_video_reproducciones_ubicacion_check
  check (ubicacion in ('recarga', 'clasificacion', 'mesas'));

-- Acelera las consultas por usuario+vídeo (estadísticas del admin). Hasta
-- el 01/10 también aceleraba la comprobación de "una visualización al día"
-- que hacía registrar_visualizacion_anuncio() — ese límite se ha quitado
-- (ver esa función más abajo), pero el índice se mantiene porque sigue
-- siendo útil para los recuentos del panel de admin.
create index if not exists anuncios_video_reproducciones_usuario_video_idx
  on public.anuncios_video_reproducciones (video_id, usuario_id, creado_at);

alter table public.anuncios_video_reproducciones enable row level security;
drop policy if exists "anuncios_video_reproducciones_admin_lee" on public.anuncios_video_reproducciones;
create policy "anuncios_video_reproducciones_admin_lee" on public.anuncios_video_reproducciones
  for select using (public.es_admin());
-- Sin política de insert/update/delete para nadie: solo se escribe desde
-- dentro de las funciones security definer de más abajo, nunca directamente
-- desde el cliente — así nadie puede insertarse a sí mismo una
-- "visualización completa" falsa saltándose recargar_por_video().

insert into storage.buckets (id, name, public)
values ('anuncios', 'anuncios', true)
on conflict (id) do nothing;

drop policy if exists "anuncios_bucket_admin_insert" on storage.objects;
create policy "anuncios_bucket_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'anuncios' and public.es_admin());

drop policy if exists "anuncios_bucket_admin_update" on storage.objects;
create policy "anuncios_bucket_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'anuncios' and public.es_admin());

drop policy if exists "anuncios_bucket_admin_delete" on storage.objects;
create policy "anuncios_bucket_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'anuncios' and public.es_admin());

-- Elige qué vídeo tocaba mostrar en un hueco concreto ('recarga' o
-- 'clasificacion') mediante un sorteo aleatorio ponderado por prioridad —
-- el peso real de cada vídeo es SIEMPRE 1 (de base) + su prioridad, así que
-- un vídeo con prioridad 0 nunca deja de poder salir, solo sale menos veces
-- de media que uno con más prioridad (pedido de Iñi: "la frecuencia tiene
-- que ser más o menos parecida... no vamos a hacer que casi no se vea el
-- vídeo de alguien que paga menos"). Algoritmo de sorteo ponderado estándar
-- (random() ^ (1/peso), gana el mayor) — no hace falta ninguna extensión de
-- Postgres. Devuelve cero filas si no hay ningún vídeo activo para ese
-- hueco ahora mismo (la pantalla, en ese caso, simplemente no muestra
-- ningún hueco de publicidad).
create or replace function public.elegir_anuncio_video(p_ubicacion text)
returns table (id uuid, url text, nombre_referencia text)
language sql
security definer set search_path = public
as $$
  select v.id, v.url, v.nombre_referencia
  from public.anuncios_video v
  where v.activo = true
    and v.fecha_inicio <= now()
    and (v.fecha_fin is null or v.fecha_fin >= now())
    and (
      (p_ubicacion = 'recarga' and v.mostrar_en_recarga) or
      (p_ubicacion = 'clasificacion' and v.mostrar_en_clasificacion) or
      (p_ubicacion = 'mesas' and v.mostrar_en_mesas)
    )
  order by random() ^ (1.0 / (1 + v.prioridad)) desc
  limit 1;
$$;

revoke all on function public.elegir_anuncio_video(text) from public;
grant execute on function public.elegir_anuncio_video(text) to authenticated;

-- Registra que un usuario ha visto un vídeo en un hueco que NO reparte
-- saldo ('clasificacion' o 'mesas') — únicamente para las estadísticas del
-- admin. p_completado indica si llegó al final o lo cortó antes de acabar.
--
-- CAMBIO 01/10 (corrige el criterio del 28/09): antes se limitaba a una
-- única visualización por usuario y por vídeo AL DÍA. Iñi ha pedido ahora
-- justo lo contrario para las visitas: "cuando se está repitiendo en bucle
-- el vídeo, quiero que cuente una única visualización, pero si un mismo
-- usuario entra, por ejemplo, a las 8 de la mañana... y veo el vídeo, eso
-- me cuenta una vez... pero si yo luego entro a las 10 de la mañana, me
-- tiene que contar una segunda vez... y luego una tercera si entro a las 5
-- de la tarde". Es decir: el límite ya NO es "una vez al día", sino "una
-- vez por visita a la pantalla" — cada vez que el usuario entra de nuevo
-- (recarga la página, vuelve a /mesas o a la clasificación) debe contar
-- como una visualización nueva, por muchas veces que el vídeo se repita en
-- bucle DENTRO de esa misma visita.
--
-- El bucle ya no puede inflar el contador: eso lo sigue garantizando el
-- propio componente (components/AnuncioVideoInline.tsx), que solo llama a
-- esta función una vez por "montaje" en pantalla (useRef que se resetea
-- únicamente al entrar de nuevo a la página), nunca en cada vuelta del
-- bucle. Por eso esta función ya no necesita comprobar nada: cada llamada
-- que le llega es, por diseño, una visita real distinta, así que
-- simplemente se inserta.
--
-- Esto NO afecta a recargar_por_video() (más abajo): esa función ya
-- insertaba directamente su propia fila sin pasar por aquí, porque la
-- recarga a cambio de vídeo siempre ha podido repetirse sin límite de veces
-- al día.
create or replace function public.registrar_visualizacion_anuncio(p_video_id uuid, p_ubicacion text, p_completado boolean default false)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_ubicacion not in ('recarga', 'clasificacion', 'mesas') then
    raise exception 'Ubicación de anuncio no válida: %', p_ubicacion;
  end if;

  insert into public.anuncios_video_reproducciones (video_id, usuario_id, ubicacion, completado)
  values (p_video_id, auth.uid(), p_ubicacion, p_completado);
end;
$$;

revoke all on function public.registrar_visualizacion_anuncio(uuid, text, boolean) from public;
grant execute on function public.registrar_visualizacion_anuncio(uuid, text, boolean) to authenticated;

-- Total de visualizaciones de cada vídeo, para el panel de admin — pensado
-- para poder enseñarle el dato real a cada anunciante. Solo el admin puede
-- llamarla (comprobado dentro, con el mismo criterio que el resto de
-- funciones exclusivas de admin).
--
-- Separado en dos columnas (28/09, pedido de Iñi): "pasivas" (clasificación
-- en directo + Mesas Drafters — se reproducen solas, sin que el usuario
-- pida nada) y "recarga" (el usuario decide activamente verlo a cambio de
-- 20€) — son audiencias muy distintas para un anunciante, así que no tiene
-- sentido sumarlas en un único número. `total_visualizaciones` se mantiene
-- para no romper nada que ya lo usara, pero siempre es la suma de las
-- otras dos. `total_completadas` ya no aporta nada de más: con el diseño
-- actual, tanto las pasivas como las de recarga se registran siempre con
-- completado=true (ver registrar_visualizacion_anuncio() y
-- recargar_por_video() más abajo), así que se retira de aquí para no dar
-- una columna que siempre coincide con el total.
-- El `drop` de antes es necesario porque esta función cambió las columnas
-- que devuelve (antes era total_visualizaciones/total_completadas, ahora es
-- visualizaciones_pasivas/visualizaciones_recarga/total_visualizaciones) —
-- Postgres no permite que `create or replace function` cambie las columnas
-- de salida de una función ya existente, así que hay que borrarla primero.
drop function if exists public.estadisticas_anuncios_video();

create or replace function public.estadisticas_anuncios_video()
returns table (video_id uuid, visualizaciones_pasivas bigint, visualizaciones_recarga bigint, total_visualizaciones bigint)
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede consultar las estadísticas de publicidad';
  end if;

  return query
    select
      r.video_id,
      count(*) filter (where r.ubicacion in ('clasificacion', 'mesas')) as visualizaciones_pasivas,
      count(*) filter (where r.ubicacion = 'recarga') as visualizaciones_recarga,
      count(*) as total_visualizaciones
    from public.anuncios_video_reproducciones r
    group by r.video_id;
end;
$$;

revoke all on function public.estadisticas_anuncios_video() from public;
grant execute on function public.estadisticas_anuncios_video() to authenticated;

-- Recarga gratuita de 10€ — como mucho una vez cada 30 días por usuario
-- (pedido de Iñi: "una vez al mes"; se implementa como ventana móvil de 30
-- días desde el último uso, no como "se resetea el día 1 del mes natural",
-- para que sea un criterio simple e igual de justo sea cual sea el día en
-- que cada uno empezó a jugar).
create or replace function public.recargar_gratis_mensual()
returns public.perfiles
language plpgsql
security definer set search_path = public
as $$
declare
  v_ultima timestamptz;
  v_perfil public.perfiles;
begin
  select ultima_recarga_gratis into v_ultima from public.perfiles where id = auth.uid() for update;

  if v_ultima is not null and v_ultima > now() - interval '30 days' then
    raise exception 'Ya has usado tu recarga gratuita de este mes';
  end if;

  update public.perfiles set ultima_recarga_gratis = now() where id = auth.uid();

  v_perfil := public.registrar_movimiento('deposito', 20);
  -- Registro de actividad (28/09, pedido de Iñi) — se llama a
  -- registrar_evento_actividad() aunque esté definida más abajo en este
  -- mismo archivo: en Postgres el cuerpo de una función plpgsql no se
  -- resuelve hasta que se ejecuta de verdad, así que basta con que exista
  -- en la base de datos en el momento en que alguien pida una recarga, no
  -- en el momento en que se ejecuta este CREATE.
  perform public.registrar_evento_actividad('recarga', jsonb_build_object('tipo_recarga', 'gratuita'));
  return v_perfil;
end;
$$;

revoke all on function public.recargar_gratis_mensual() from public;
grant execute on function public.recargar_gratis_mensual() to authenticated;

-- Recarga de 20€ a cambio de ver un vídeo publicitario completo — sin
-- límite de veces (a diferencia de la gratuita). Se llama SOLO cuando el
-- vídeo ha terminado de reproducirse de verdad en el cliente (evento
-- `onEnded` del <video>) — como cualquier "vídeo recompensado", no hay
-- forma 100% infalible de impedir que alguien llame a esta función sin
-- haber visto el vídeo; para Fase 1, con saldo ficticio sin valor real, se
-- acepta ese riesgo. Si el día de mañana esto reparte algo con valor real,
-- hace falta blindarlo más (por ejemplo, validando la reproducción del
-- lado del proveedor de vídeo, no solo confiando en el evento del cliente).
create or replace function public.recargar_por_video(p_video_id uuid)
returns public.perfiles
language plpgsql
security definer set search_path = public
as $$
declare
  v_perfil public.perfiles;
begin
  if not exists (
    select 1 from public.anuncios_video
    where id = p_video_id and activo = true and mostrar_en_recarga = true
      and fecha_inicio <= now() and (fecha_fin is null or fecha_fin >= now())
  ) then
    raise exception 'Este vídeo ya no está disponible';
  end if;

  insert into public.anuncios_video_reproducciones (video_id, usuario_id, ubicacion, completado)
  values (p_video_id, auth.uid(), 'recarga', true);

  v_perfil := public.registrar_movimiento('deposito', 20);
  -- Registro de actividad (28/09, pedido de Iñi) — igual que en
  -- recargar_gratis_mensual(), diferenciando el tipo de recarga en el
  -- `detalle` para que el panel de admin pueda distinguirlas.
  perform public.registrar_evento_actividad('recarga', jsonb_build_object('tipo_recarga', 'video'));
  return v_perfil;
end;
$$;

revoke all on function public.recargar_por_video(uuid) from public;
grant execute on function public.recargar_por_video(uuid) to authenticated;

-- ============================================================================
-- REGISTRO DE ACTIVIDAD (nuevo, 28/09)
-- ============================================================================
-- Pedido de Iñi: un registro de actividad de los usuarios — de momento solo
-- dos tipos de evento: 'login' (cada vez que alguien accede con su usuario y
-- contraseña) e 'inscripcion' (cada vez que alguien se inscribe, por
-- primera vez, en una mesa o una porra — no al editar un equipo ya
-- inscrito). Decidido con Iñi: un único registro global, no una pantalla
-- por usuario — se puede filtrar por usuario desde ahí (app/admin/actividad).
--
-- `registrar_evento_actividad()` es la única forma de escribir en la tabla
-- (security definer, sin política de insert para el usuario normal): cada
-- pantalla que necesite registrar un evento llama a esta función con su
-- propio usuario ya autenticado (auth.uid()), nunca escribe la tabla
-- directamente — así no hace falta abrir una política de insert pública.
create table if not exists public.eventos_actividad (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfiles(id) on delete cascade,
  tipo text not null check (tipo in ('login', 'inscripcion', 'recarga', 'premio')),
  -- Detalle libre según el tipo — en 'inscripcion', algo como {"modo":
  -- "sala", "nombre": "Duelo Golf #4"}; en 'recarga' (añadido 28/09, pedido
  -- de Iñi), {"tipo_recarga": "gratuita"} o {"tipo_recarga": "video"} — así
  -- para poder mostrarlo en el registro sin tener que volver a cruzar con
  -- `equipos`/`salas`/`porras` (que además pueden haberse borrado ya).
  detalle jsonb,
  creado_en timestamptz not null default now()
);

-- 'recarga' se añade el 28/09 a un check constraint que ya existía con solo
-- ('login', 'inscripcion') — en una base de datos donde la tabla ya estaba
-- creada, `create table if not exists` de arriba no toca la restricción ya
-- puesta, así que hace falta reemplazarla a mano (nombre por defecto que le
-- da Postgres a un check puesto en línea sobre una columna: `<tabla>_<
-- columna>_check`). Si la tabla se crea nueva de cero, este bloque no hace
-- nada (la restricción ya sale bien puesta desde el create table).
-- 'premio' añadido el 29/09 (liquidación de premios) — se inserta
-- directamente desde liquidar_evento() (no a través de
-- registrar_evento_actividad(), porque el evento es del usuario GANADOR, no
-- del admin que confirma el reparto; liquidar_evento() es security definer
-- así que puede escribir en la tabla sin pasar por RLS).
alter table public.eventos_actividad drop constraint if exists eventos_actividad_tipo_check;
alter table public.eventos_actividad add constraint eventos_actividad_tipo_check check (tipo in ('login', 'inscripcion', 'recarga', 'premio'));

create index if not exists eventos_actividad_usuario_idx on public.eventos_actividad (usuario_id);
create index if not exists eventos_actividad_creado_idx on public.eventos_actividad (creado_en desc);

alter table public.eventos_actividad enable row level security;

-- Nadie lee la tabla directamente (ni siquiera el admin) — la lectura pasa
-- siempre por eventos_actividad_admin(), que ya comprueba el rol y además
-- junta el nombre/email del usuario. Sin política de select: RLS deniega
-- todo por defecto salvo lo que entre por una función security definer.

create or replace function public.registrar_evento_actividad(p_tipo text, p_detalle jsonb default null)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  -- No interrumpe el flujo del usuario si por lo que sea no hay sesión o el
  -- tipo no se reconoce — registrar actividad nunca debe poder romper un
  -- login, una inscripción o una recarga real. 'recarga' añadido el 28/09
  -- (pedido de Iñi) — se llama desde recargar_gratis_mensual() y
  -- recargar_por_video() más abajo, con p_detalle indicando de cuál de las
  -- dos se trata.
  if auth.uid() is null or p_tipo not in ('login', 'inscripcion', 'recarga') then
    return;
  end if;

  insert into public.eventos_actividad (usuario_id, tipo, detalle) values (auth.uid(), p_tipo, p_detalle);
end;
$$;

revoke all on function public.registrar_evento_actividad(text, jsonb) from public;
grant execute on function public.registrar_evento_actividad(text, jsonb) to authenticated;

-- Lectura para el panel de admin (app/admin/actividad/page.tsx): un único
-- listado global, más reciente primero, opcionalmente filtrado por usuario
-- y/o por un rango de fechas (p_fecha_desde/p_fecha_hasta, añadido 28/09 a
-- petición de Iñi: "que haya también un filtro por fechas, de tal día a
-- tal día") — junta nombre/apellido/email para no tener que hacer una
-- segunda consulta a `perfiles` por cada fila.
--
-- El `drop` de antes es necesario porque se añaden parámetros nuevos: para
-- Postgres, una función con distinta lista de parámetros es una función
-- distinta (podría quedarse la de dos parámetros conviviendo con esta como
-- una sobrecarga), así que se borra primero la versión vieja para que no
-- quede duplicada.
drop function if exists public.eventos_actividad_admin(uuid, int);

create or replace function public.eventos_actividad_admin(
  p_usuario_id uuid default null,
  p_limite int default 200,
  p_fecha_desde timestamptz default null,
  p_fecha_hasta timestamptz default null
)
returns table (
  id uuid,
  usuario_id uuid,
  nombre text,
  apellido text,
  email text,
  tipo text,
  detalle jsonb,
  creado_en timestamptz
)
language plpgsql
security definer set search_path = public
as $$
begin
  -- Ojo (28/09): NO usar "where id = auth.uid()" aquí — como esta función
  -- devuelve una columna que también se llama "id" (returns table (id
  -- uuid, ...)), Postgres no sabe si "id" se refiere a esa columna de
  -- salida o a perfiles.id, y falla con "column reference id is
  -- ambiguous". Se usa es_admin() en su lugar, que vive en su propia
  -- función y no tiene ese conflicto.
  if not public.es_admin() then
    raise exception 'No autorizado';
  end if;

  return query
  select e.id, e.usuario_id, p.nombre, p.apellido, p.email, e.tipo, e.detalle, e.creado_en
  from public.eventos_actividad e
  join public.perfiles p on p.id = e.usuario_id
  where (p_usuario_id is null or e.usuario_id = p_usuario_id)
    and (p_fecha_desde is null or e.creado_en >= p_fecha_desde)
    and (p_fecha_hasta is null or e.creado_en <= p_fecha_hasta)
  order by e.creado_en desc
  limit greatest(1, least(coalesce(p_limite, 200), 1000));
end;
$$;

revoke all on function public.eventos_actividad_admin(uuid, int, timestamptz, timestamptz) from public;
grant execute on function public.eventos_actividad_admin(uuid, int, timestamptz, timestamptz) to authenticated;

-- ============================================================================
-- RESULTADOS EN VIVO DE GOLF, SACADOS AUTOMÁTICAMENTE DE ESPN (28/09)
-- ============================================================================
-- Pedido de Iñi: que la clasificación en directo de las porras se actualice
-- sola, hoyo a hoyo, sin que él tenga que cargar nada a mano — usando los
-- endpoints públicos (no oficiales, gratuitos) del sitio de ESPN, que cubren
-- tanto el PGA Tour ('pga') como el DP World Tour ('eur'). Ya se dejó
-- documentado como opción de pago más adelante Data Golf (30€/mes, con más
-- garantías) para cuando interese más fiabilidad — ver el addendum de este
-- mismo día en el proyecto.
--
-- Cómo encaja todo:
--   1. `torneos_golf_live`: el admin apunta, por cada torneo que se importe
--      a Drafters, a qué evento de ESPN corresponde (tour + id de evento).
--      Es la única parte manual de todo esto — ver app/admin/resultados-golf.
--   2. app/api/admin/actualizar-golf-en-vivo/route.ts (código, no SQL): la
--      ruta de servidor que de verdad llama a ESPN, empareja jugadores por
--      nombre y escribe los resultados. La llama tanto un botón "Actualizar
--      ahora" en /admin/resultados-golf como, automáticamente, un cron de
--      Supabase (pg_cron + pg_net) cada 5 minutos — ver el bloque final de
--      este archivo, "CRON DE RESULTADOS DE GOLF", que necesita rellenarse
--      con la URL real de la app y una clave secreta antes de ejecutarse.
--   3. Resultado total (golpes respecto al par, en qué hoyo va, posición) se
--      guarda directamente en `jugadores` (columnas resultado_en_vivo_*) —
--      cada fila de `jugadores` ya pertenece a un único torneo (ver el
--      comentario de la propia tabla), así que no hace falta ninguna tabla
--      aparte para esto.
--   4. El desglose hoyo a hoyo (lo que se ve al pulsar un resultado) vive en
--      `resultados_golf_hoyo`, con el par de cada hoyo y el tipo de
--      resultado ya calculado (para no repetir esa lógica en el cliente).

create table if not exists public.torneos_golf_live (
  id uuid primary key default gen_random_uuid(),
  -- Tiene que coincidir EXACTO con el valor de `jugadores.competicion` de
  -- ese mismo torneo (el que se usó al importar el listado desde /admin) —
  -- mismo criterio de enlace por texto que ya usan `porras.competicion` y
  -- `salas.competicion`.
  competicion text not null unique,
  -- Slug del circuito en ESPN: 'pga' (PGA Tour) o 'eur' (DP World Tour).
  tour text not null check (tour in ('pga', 'eur')),
  -- Id numérico del torneo en ESPN — se encuentra en la propia URL de la
  -- clasificación pública de ESPN para ese torneo, p.ej.
  -- espn.com/golf/leaderboard/_/tournamentid/401811952 → sería "401811952"
  -- (también aparece como events[].id al llamar al endpoint de scoreboard
  -- del circuito correspondiente).
  espn_event_id text not null,
  temporada int not null,
  -- Apagar un torneo (sin borrar la fila) para que el cron deje de gastar
  -- llamadas a ESPN en un torneo ya terminado, sin perder el mapeo por si
  -- hiciera falta reactivarlo.
  activo boolean not null default true,
  ultima_actualizacion timestamptz,
  -- Último error de la sincronización, si lo hubo (para poder diagnosticar
  -- desde /admin/resultados-golf sin tener que mirar los logs de Vercel).
  ultimo_error text,
  created_at timestamptz not null default now()
);

alter table public.torneos_golf_live enable row level security;
drop policy if exists "torneos_golf_live_admin_todo" on public.torneos_golf_live;
create policy "torneos_golf_live_admin_todo" on public.torneos_golf_live
  for all using (public.es_admin()) with check (public.es_admin());
-- Sin política de lectura pública: es una tabla de configuración interna,
-- nunca se muestra a un usuario normal. La ruta de sincronización la lee
-- con la clave de servicio (sin pasar por RLS).

-- Resultado en vivo de cada jugador en SU torneo (cada fila de `jugadores`
-- ya es específica de un torneo, ver el comentario de esa tabla más
-- arriba) — golpes respecto al par (positivo o negativo), en qué hoyo va
-- de la ronda actual, en qué ronda está, y la posición tal cual la da ESPN
-- (admite "T5", "CUT", "WD", etc., así que se guarda como texto).
alter table public.jugadores add column if not exists resultado_en_vivo_total int;
alter table public.jugadores add column if not exists resultado_en_vivo_thru int;
alter table public.jugadores add column if not exists resultado_en_vivo_ronda int;
alter table public.jugadores add column if not exists resultado_en_vivo_posicion text;
alter table public.jugadores add column if not exists resultado_en_vivo_actualizado_en timestamptz;

-- Desglose hoyo a hoyo — una fila por jugador+ronda+hoyo. `tipo_resultado`
-- ya viene calculado aquí (golpes respecto al par de ESE hoyo) para que el
-- cliente solo tenga que pintar el color, sin repetir la lógica de
-- lib/golfScoring.ts en cada sitio que lo necesite.
create table if not exists public.resultados_golf_hoyo (
  id uuid primary key default gen_random_uuid(),
  jugador_id uuid not null references public.jugadores(id) on delete cascade,
  ronda int not null,
  hoyo int not null check (hoyo between 1 and 18),
  par int not null check (par between 3 and 5),
  golpes int not null check (golpes > 0),
  tipo_resultado text not null check (tipo_resultado in ('eagle_o_mejor', 'birdie', 'par', 'bogey', 'doble_bogey_o_peor')),
  actualizado_en timestamptz not null default now(),
  unique (jugador_id, ronda, hoyo)
);

create index if not exists resultados_golf_hoyo_jugador_idx on public.resultados_golf_hoyo (jugador_id, ronda, hoyo);

alter table public.resultados_golf_hoyo enable row level security;
drop policy if exists "resultados_golf_hoyo_select_publico" on public.resultados_golf_hoyo;
create policy "resultados_golf_hoyo_select_publico" on public.resultados_golf_hoyo
  -- Lectura pública, mismo criterio que `jugadores` (sección 6): hace falta
  -- que cualquier usuario logueado pueda ver el hoyo a hoyo de cualquier
  -- jugador desde la clasificación en directo de una porra.
  for select using (true);
drop policy if exists "resultados_golf_hoyo_admin_todo" on public.resultados_golf_hoyo;
create policy "resultados_golf_hoyo_admin_todo" on public.resultados_golf_hoyo
  for all using (public.es_admin()) with check (public.es_admin());
-- La ruta de sincronización escribe con la clave de servicio (sin pasar
-- por RLS) — la política de admin de aquí arriba es solo por si algún día
-- hiciera falta corregir un dato a mano desde el propio SQL Editor.

-- ============================================================================
-- CAMPO DE CADA RONDA, PARA TORNEOS CON VARIOS CAMPOS (nuevo, 01/10)
-- ============================================================================
-- Pedido de Iñi: esta semana el torneo de la porra de golf se juega en tres
-- campos distintos (rotación habitual en algunos torneos del DP World Tour,
-- como el Alfred Dunhill Links Championship) — cada jugador puede jugar una
-- ronda en un campo y otra ronda distinta en otro, con su propio par por
-- hoyo. ESPN sí distingue esto en el desglose por jugador (campo `courseId`
-- dentro de cada ronda, playersummary) — el par de cada hoyo YA se guardaba
-- bien por ronda en `resultados_golf_hoyo` (no hacía falta tocar eso), lo que
-- faltaba era poder IDENTIFICAR de qué campo era cada ronda, para que la
-- pantalla de clasificación pueda decir "Ronda 2 · Carnoustie" en vez de solo
-- "Ronda 2". Diseñado en general (no hardcodeado a este torneo) por si se
-- repite en otro con varios campos.
alter table public.resultados_golf_hoyo add column if not exists campo_id text;

-- Nombre legible de cada campo, por torneo — ESPN solo da un id (texto u
-- número) del campo dentro del hoyo a hoyo de cada jugador, nunca el nombre;
-- el admin lo escribe a mano una vez ve qué id corresponde a qué campo real
-- (p.ej. comprobándolo en la propia web de ESPN), desde /admin/resultados-golf.
create table if not exists public.campos_golf_live (
  id uuid primary key default gen_random_uuid(),
  -- Igual que `torneos_golf_live.competicion`: tiene que coincidir exacto
  -- con `jugadores.competicion` de ese torneo.
  competicion text not null,
  campo_id text not null,
  nombre text not null,
  created_at timestamptz not null default now(),
  unique (competicion, campo_id)
);

alter table public.campos_golf_live enable row level security;
drop policy if exists "campos_golf_live_select_publico" on public.campos_golf_live;
create policy "campos_golf_live_select_publico" on public.campos_golf_live
  -- Lectura pública: la pantalla de clasificación de cualquier porra/mesa de
  -- este torneo necesita poder traducir campo_id -> nombre.
  for select using (true);
drop policy if exists "campos_golf_live_admin_todo" on public.campos_golf_live;
create policy "campos_golf_live_admin_todo" on public.campos_golf_live
  for all using (public.es_admin()) with check (public.es_admin());

-- Qué campo_id aparecen ya en el hoyo a hoyo de este torneo, con su nombre
-- si ya se le puso uno (para pintar el formulario de /admin/resultados-golf:
-- un campo de texto por cada id detectado, vacío si todavía no tiene nombre).
create or replace function public.campos_golf_detectados(p_competicion text)
returns table (campo_id text, nombre text)
language sql
security definer set search_path = public
stable
as $$
  select distinct h.campo_id, cgl.nombre
  from public.resultados_golf_hoyo h
  join public.jugadores j on j.id = h.jugador_id
  left join public.campos_golf_live cgl on cgl.competicion = p_competicion and cgl.campo_id = h.campo_id
  where j.competicion = p_competicion and j.deporte = 'golf' and h.campo_id is not null
  order by h.campo_id;
$$;
revoke all on function public.campos_golf_detectados(text) from public;
grant execute on function public.campos_golf_detectados(text) to authenticated;

-- ============================================================================
-- BIBLIOTECA DE PARES DE CAMPO DE GOLF (nuevo, 01/10)
-- ============================================================================
-- Pedido de Iñi: "habilita un campo en el superadmin para que... tenga que
-- cargar yo cuál es el par de cada uno de los hoyos" — un plan de respaldo
-- manual para el par de cada hoyo de un campo de golf, pensado para que
-- funcione igual con cualquier fuente de datos en vivo (hoy ESPN, más
-- adelante Data Golf u otra): "si yo lo he puesto a mano, pues coges el de
-- a mano, y si no, cuando actualicemos la extracción de ESPN, que nos traiga
-- también los pares de cada hoyo".
--
-- A diferencia de `campos_golf_live` (que solo guarda el NOMBRE de cada
-- campo, por torneo, solo para los pocos torneos con varios campos en
-- rotación), esta es una BIBLIOTECA aparte de cualquier torneo concreto,
-- pensada para reutilizarse año tras año: el par de un hoyo de un campo real
-- (p.ej. St Andrews Old Course) no cambia aunque el torneo que se juegue
-- allí sí lo haga, así que una vez cargado un campo aquí, nunca hay que
-- volver a cargarlo — ni a mano, ni por cualquier otro torneo futuro que se
-- juegue en el mismo sitio.
--
-- Dos formas de rellenarse, con el mismo criterio que pidió Iñi:
--   1. A MANO, desde /admin/resultados-golf — Iñi escribe el nombre del
--      campo y el par de sus 18 hoyos. Esto SIEMPRE tiene prioridad: una vez
--      un campo tiene `origen = 'manual'`, ningún proceso automático lo
--      vuelve a tocar.
--   2. AUTOMÁTICO, desde la sincronización de ESPN (ver
--      app/api/admin/actualizar-golf-en-vivo/route.ts): ESPN ya da el par de
--      cada hoyo dentro de su propio hoyo a hoyo (`resultados_golf_hoyo.par`,
--      sin necesidad de ninguna fuente externa) — en cuanto, para un campo
--      ya nombrado en `campos_golf_live`, se tienen los 18 pares completos
--      (puede tardar, porque hace falta que ALGÚN jugador haya completado
--      cada uno de los 18 hoyos, no necesariamente el mismo jugador), la
--      sincronización los guarda aquí solos, sin que Iñi tenga que escribir
--      nada — pero SOLO si todavía no existe ese campo aquí, o si existe con
--      `origen = 'espn'` (nunca pisa un `origen = 'manual'`).
--
-- El día que se conecte Data Golf (o cualquier otro proveedor) para el DP
-- World Tour, esa integración puede usar esta misma biblioteca tal cual
-- (buscando por nombre de campo) sin ningún cambio de esquema — por eso se
-- diseña aparte de ESPN desde el principio.
create table if not exists public.campos_golf_biblioteca (
  id uuid primary key default gen_random_uuid(),
  -- Nombre tal cual se escribió/recibió (se muestra así en el admin).
  nombre text not null,
  -- Mismo criterio de normalización que ya usa lib/nombreMatch.ts para
  -- jugadores (sin acentos, minúsculas, espacios colapsados) — calculado en
  -- el código, nunca en SQL, para no duplicar esa lógica en dos sitios; así
  -- "St Andrews" y "st   andrews" terminan siendo el mismo campo.
  nombre_normalizado text not null unique,
  par_h1 smallint check (par_h1 is null or par_h1 between 3 and 5),
  par_h2 smallint check (par_h2 is null or par_h2 between 3 and 5),
  par_h3 smallint check (par_h3 is null or par_h3 between 3 and 5),
  par_h4 smallint check (par_h4 is null or par_h4 between 3 and 5),
  par_h5 smallint check (par_h5 is null or par_h5 between 3 and 5),
  par_h6 smallint check (par_h6 is null or par_h6 between 3 and 5),
  par_h7 smallint check (par_h7 is null or par_h7 between 3 and 5),
  par_h8 smallint check (par_h8 is null or par_h8 between 3 and 5),
  par_h9 smallint check (par_h9 is null or par_h9 between 3 and 5),
  par_h10 smallint check (par_h10 is null or par_h10 between 3 and 5),
  par_h11 smallint check (par_h11 is null or par_h11 between 3 and 5),
  par_h12 smallint check (par_h12 is null or par_h12 between 3 and 5),
  par_h13 smallint check (par_h13 is null or par_h13 between 3 and 5),
  par_h14 smallint check (par_h14 is null or par_h14 between 3 and 5),
  par_h15 smallint check (par_h15 is null or par_h15 between 3 and 5),
  par_h16 smallint check (par_h16 is null or par_h16 between 3 and 5),
  par_h17 smallint check (par_h17 is null or par_h17 between 3 and 5),
  par_h18 smallint check (par_h18 is null or par_h18 between 3 and 5),
  -- 'manual' = lo escribió Iñi en el admin (nunca se pisa solo).
  -- 'espn' = lo ha rellenado solo la sincronización, a partir del hoyo a
  -- hoyo real que ya trae ESPN.
  origen text not null default 'manual' check (origen in ('manual', 'espn')),
  actualizado_en timestamptz not null default now()
);

alter table public.campos_golf_biblioteca enable row level security;
drop policy if exists "campos_golf_biblioteca_select_publico" on public.campos_golf_biblioteca;
create policy "campos_golf_biblioteca_select_publico" on public.campos_golf_biblioteca
  -- Lectura pública: no hay nada sensible, y puede ser útil mostrarlo en
  -- pantallas futuras (p.ej. la clasificación en directo).
  for select using (true);
drop policy if exists "campos_golf_biblioteca_admin_todo" on public.campos_golf_biblioteca;
create policy "campos_golf_biblioteca_admin_todo" on public.campos_golf_biblioteca
  for all using (public.es_admin()) with check (public.es_admin());

-- Rellena/actualiza un campo de la biblioteca a partir de lo que ya trae
-- ESPN, SIN pisar nunca un campo que Iñi ya haya cargado a mano. Pensada
-- para llamarse solo desde la ruta de sincronización (clave de servicio) —
-- por eso no se concede su ejecución a 'authenticated' más abajo.
create or replace function public.actualizar_par_biblioteca_desde_espn(
  p_nombre text,
  p_nombre_normalizado text,
  p_pares smallint[] -- exactamente 18 posiciones, hoyo 1 a 18; null si no se sabe todavía
) returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_origen_actual text;
begin
  if p_nombre_normalizado is null or btrim(p_nombre_normalizado) = '' then
    return;
  end if;
  if p_pares is null or array_length(p_pares, 1) is distinct from 18 then
    return; -- solo se guarda cuando ya se conocen los 18 hoyos
  end if;

  select origen into v_origen_actual
  from public.campos_golf_biblioteca
  where nombre_normalizado = p_nombre_normalizado;

  if v_origen_actual = 'manual' then
    return; -- Iñi ya lo cargó a mano — nunca se toca automáticamente
  end if;

  insert into public.campos_golf_biblioteca (
    nombre, nombre_normalizado,
    par_h1, par_h2, par_h3, par_h4, par_h5, par_h6, par_h7, par_h8, par_h9,
    par_h10, par_h11, par_h12, par_h13, par_h14, par_h15, par_h16, par_h17, par_h18,
    origen, actualizado_en
  )
  values (
    p_nombre, p_nombre_normalizado,
    p_pares[1], p_pares[2], p_pares[3], p_pares[4], p_pares[5], p_pares[6], p_pares[7], p_pares[8], p_pares[9],
    p_pares[10], p_pares[11], p_pares[12], p_pares[13], p_pares[14], p_pares[15], p_pares[16], p_pares[17], p_pares[18],
    'espn', now()
  )
  on conflict (nombre_normalizado) do update set
    nombre = excluded.nombre,
    par_h1 = excluded.par_h1, par_h2 = excluded.par_h2, par_h3 = excluded.par_h3, par_h4 = excluded.par_h4,
    par_h5 = excluded.par_h5, par_h6 = excluded.par_h6, par_h7 = excluded.par_h7, par_h8 = excluded.par_h8,
    par_h9 = excluded.par_h9, par_h10 = excluded.par_h10, par_h11 = excluded.par_h11, par_h12 = excluded.par_h12,
    par_h13 = excluded.par_h13, par_h14 = excluded.par_h14, par_h15 = excluded.par_h15, par_h16 = excluded.par_h16,
    par_h17 = excluded.par_h17, par_h18 = excluded.par_h18,
    origen = 'espn',
    actualizado_en = now();
end;
$$;
revoke all on function public.actualizar_par_biblioteca_desde_espn(text, text, smallint[]) from public;
-- A propósito, sin "grant execute ... to authenticated": solo la llama la
-- ruta de sincronización, que usa la clave de servicio (se salta RLS y los
-- grants de rol igualmente) — así ningún usuario normal puede llamarla
-- directamente desde el navegador.

-- Para cada campo_id ya nombrado de un torneo (campos_golf_live), reconstruye
-- los 18 pares a partir de lo que YA está guardado en resultados_golf_hoyo
-- (el par de cada hoyo que ya trae ESPN) — null en las posiciones todavía
-- sin ningún jugador que haya llegado a ese hoyo. La ruta de sincronización
-- llama a esto después de guardar el hoyo a hoyo de cada ciclo, y si el
-- array resultante ya tiene los 18 completos, lo pasa a
-- actualizar_par_biblioteca_desde_espn() para guardarlo en la biblioteca.
create or replace function public.pares_conocidos_campo(p_competicion text, p_campo_id text)
returns smallint[]
language sql
security definer set search_path = public
stable
as $$
  select array(
    select (
      select h.par
      from public.resultados_golf_hoyo h
      join public.jugadores j on j.id = h.jugador_id
      where j.competicion = p_competicion and j.deporte = 'golf'
        and h.campo_id = p_campo_id and h.hoyo = n
      limit 1
    )
    from generate_series(1, 18) as n
  );
$$;
revoke all on function public.pares_conocidos_campo(text, text) from public;
grant execute on function public.pares_conocidos_campo(text, text) to authenticated;

-- ============================================================================
-- LIQUIDACIÓN DE PREMIOS (nuevo, 29/09)
-- ============================================================================
-- Pedido de Iñi: "hay que implementar que... cuando una porra o una mesa
-- drafter acaba, hay que repartir esos pagos... diseña lo que haga falta".
--
-- Cuándo se considera "acabada" una sala/porra: a partir de ahora, ese mismo
-- momento es el de la liquidación. No hay un estado intermedio de "ya
-- terminó pero todavía no se ha pagado" — es el propio admin quien decide,
-- desde la pantalla nueva /admin/pagos-pendientes, que los resultados ya
-- están completos y confirma el reparto (pedido explícito de Iñi: "opción 1
-- [revisar y confirmar a mano], pero en cuanto nos aseguremos que todo está
-- funcionando bien, lo cambiaremos a automático"). Al confirmar se llama a
-- liquidar_evento() (más abajo), que en una sola transacción: reparte el
-- dinero, dejan constancia en movimientos/eventos_actividad/notificaciones,
-- guarda la posición final de cada equipo, y por fin marca
-- estado = 'finalizada' en la sala o porra — ese es el momento exacto en que
-- pasa a estar "acabada" de verdad.
--
-- Preparado para más adelante hacerse automático sin rediseñar nada: cuando
-- Iñi lo pida, un cron (mismo patrón que ya usa la sincronización de golf en
-- vivo — pg_cron/pg_net llamando a una ruta protegida con CRON_SECRET, o esa
-- misma ruta llamando directamente a esta función con la clave de servicio)
-- puede llamar a liquidar_evento() en vez de un clic del admin — la función
-- ya acepta llamadas de auth.role() = 'service_role' además de un admin
-- logueado, así que no hará falta tocar esta parte del esquema, solo montar
-- la ruta/cron que decida cuándo llamarla.
--
-- Desempates (pedido explícito de Iñi): "en caso de que dos puestos estén
-- empatados, se repartirán el premio entre todos... el premio de los
-- puestos que les corresponden se reparte entre los empatados". Este cálculo
-- (agrupar posiciones empatadas y repartir a partes iguales la suma de sus
-- tramos) se hace en el cliente, en lib/repartoPremios.ts — liquidar_evento()
-- solo APLICA el resultado ya calculado (recibe el reparto final en
-- p_reparto), no lo calcula él mismo, porque el criterio de "quién va en qué
-- puesto" depende del tipo de sala/porra (puntos de golf/fútbol/tenis,
-- aciertos de la porra de fútbol, etc.) y ya vive en TypeScript.
create table if not exists public.liquidaciones (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('sala', 'porra')),
  sala_id uuid references public.salas (id) on delete cascade,
  porra_id uuid references public.porras (id) on delete cascade,
  -- Copia exacta del reparto aplicado (equipo_id/importe/posición de cada
  -- equipo premiado) — queda guardado tal cual para poder consultarlo
  -- después sin tener que reconstruirlo a partir de movimientos.
  reparto jsonb not null,
  total_repartido numeric(10, 2) not null default 0,
  liquidado_por uuid references public.perfiles (id),
  creado_en timestamptz not null default now(),
  constraint liquidacion_referencia_valida check (
    (tipo = 'sala' and sala_id is not null and porra_id is null)
    or
    (tipo = 'porra' and porra_id is not null and sala_id is null)
  )
);

-- Un único índice único por sala/porra: es la guarda que impide pagar dos
-- veces la misma sala/porra (liquidar_evento() comprueba esto también a
-- mano antes de nada, pero el índice es la última línea de defensa a nivel
-- de base de datos, por si dos peticiones llegaran a la vez).
create unique index if not exists liquidaciones_sala_unico on public.liquidaciones (sala_id) where sala_id is not null;
create unique index if not exists liquidaciones_porra_unico on public.liquidaciones (porra_id) where porra_id is not null;

alter table public.liquidaciones enable row level security;
drop policy if exists "liquidaciones_admin_todo" on public.liquidaciones;
create policy "liquidaciones_admin_todo" on public.liquidaciones
  for all using (public.es_admin()) with check (public.es_admin());

-- Aplica de una vez, en una sola transacción, el reparto de premios de una
-- sala o porra ya calculado en el cliente: acredita el saldo de cada
-- ganador, deja constancia en movimientos ('premio')/eventos_actividad
-- ('premio')/notificaciones ('resultado'), guarda la posición final de cada
-- equipo (equipos.posicion_final) y marca la sala/porra como 'finalizada'.
-- Bloqueada por el índice único de arriba contra un doble pago.
--
-- p_reparto: array de objetos, uno por CADA equipo al que se le asigna una
-- posición final (gane premio o no) — p.ej.
-- [{"equipo_id": "...", "posicion": 1, "importe": 45.00},
--  {"equipo_id": "...", "posicion": 3, "importe": 0}, ...]
-- Solo se acredita saldo/se genera movimiento+notificación en las filas con
-- importe > 0 — un equipo con importe 0 solo sirve para dejar constancia de
-- en qué puesto quedó.
create or replace function public.liquidar_evento(
  p_tipo text,
  p_id uuid,
  p_reparto jsonb
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_item jsonb;
  v_equipo record;
  v_importe numeric;
  v_posicion int;
  v_total numeric := 0;
  v_nombre_evento text;
begin
  if not (public.es_admin() or auth.role() = 'service_role') then
    raise exception 'No autorizado';
  end if;

  if p_tipo not in ('sala', 'porra') then
    raise exception 'Tipo de liquidación no válido: %', p_tipo;
  end if;

  if exists (
    select 1 from public.liquidaciones l
    where (p_tipo = 'sala' and l.sala_id = p_id) or (p_tipo = 'porra' and l.porra_id = p_id)
  ) then
    raise exception 'Esto ya se había liquidado antes — no se puede repartir dos veces';
  end if;

  if p_tipo = 'sala' then
    select nombre into v_nombre_evento from public.salas where id = p_id for update;
  else
    select major into v_nombre_evento from public.porras where id = p_id for update;
  end if;
  if v_nombre_evento is null then
    raise exception 'No se encuentra lo que se quiere liquidar (tipo=%, id=%)', p_tipo, p_id;
  end if;

  if p_reparto is null or jsonb_array_length(p_reparto) = 0 then
    raise exception 'No hay ningún reparto que aplicar';
  end if;

  for v_item in select * from jsonb_array_elements(p_reparto)
  loop
    select e.*, p.nombre_usuario as apodo into v_equipo
      from public.equipos e
      join public.perfiles p on p.id = e.usuario_id
      where e.id = (v_item->>'equipo_id')::uuid
      for update of e;

    if not found then
      raise exception 'Equipo % no encontrado', v_item->>'equipo_id';
    end if;
    if (p_tipo = 'sala' and v_equipo.sala_id is distinct from p_id) or (p_tipo = 'porra' and v_equipo.porra_id is distinct from p_id) then
      raise exception 'El equipo % no pertenece a esta liquidación', v_equipo.id;
    end if;

    v_importe := coalesce((v_item->>'importe')::numeric, 0);
    v_posicion := nullif(v_item->>'posicion', '')::int;

    update public.equipos set posicion_final = v_posicion where id = v_equipo.id;

    if v_importe > 0 then
      update public.perfiles set saldo_simulado = saldo_simulado + v_importe where id = v_equipo.usuario_id;

      insert into public.movimientos (usuario_id, tipo, importe) values (v_equipo.usuario_id, 'premio', v_importe);

      insert into public.eventos_actividad (usuario_id, tipo, detalle) values (
        v_equipo.usuario_id,
        'premio',
        jsonb_build_object(
          'modo', p_tipo,
          'nombre', v_nombre_evento,
          'equipo', coalesce(v_equipo.nombre_equipo, v_equipo.apodo),
          'posicion', v_posicion,
          'importe', v_importe
        )
      );

      insert into public.notificaciones (usuario_id, tipo, titulo, mensaje, link) values (
        v_equipo.usuario_id,
        'resultado',
        '¡Has ganado un premio!',
        'Tu equipo "' || coalesce(v_equipo.nombre_equipo, v_equipo.apodo, '') || '" ha quedado ' ||
          coalesce(v_posicion::text || 'º', 'clasificado') || ' en "' || v_nombre_evento || '" y has ganado ' ||
          to_char(v_importe, 'FM999999990.00') || ' €.',
        case when p_tipo = 'sala' then '/salas/' || p_id else '/porras/' || p_id end
      );

      v_total := v_total + v_importe;
    end if;
  end loop;

  if p_tipo = 'sala' then
    update public.salas set estado = 'finalizada' where id = p_id;
  else
    update public.porras set estado = 'finalizada' where id = p_id;
  end if;

  insert into public.liquidaciones (tipo, sala_id, porra_id, reparto, total_repartido, liquidado_por)
  values (
    p_tipo,
    case when p_tipo = 'sala' then p_id else null end,
    case when p_tipo = 'porra' then p_id else null end,
    p_reparto,
    v_total,
    auth.uid()
  );
end;
$$;

revoke all on function public.liquidar_evento(text, uuid, jsonb) from public;
grant execute on function public.liquidar_evento(text, uuid, jsonb) to authenticated, service_role;

-- ============================================================================
-- PORRA DE FÚTBOL POR JORNADAS (nuevo, 29/09)
-- ============================================================================
-- Pedido de Iñi: una porra de fútbol de Primera División por cada jornada de
-- liga. El admin carga los 10 partidos de la jornada desde una pantalla
-- nueva de superadmin (/admin/porras-futbol, con la porra ya creada con
-- formato = 'futbol_jornada', precio = 2.00€); cada usuario pronostica 1/X/2
-- en los 10 partidos y se apunta cuantas veces quiera (cada apunte es un
-- "equipo" más, igual que las porras clásicas — pedido de Iñi: "cada
-- jugador, cada usuario se puede participar todas las veces que quiera").
-- Los resultados reales se marcan a mano por el admin, partido a partido, en
-- la misma pantalla, una vez jugados (decisión de Iñi: "lo marcas tú a
-- mano", en vez de conectar una API de resultados de fútbol en directo).
--
-- Nombre automático del equipo (pedido de Iñi, con su propio ejemplo: "yo en
-- mi usuario que es Sindeler... el primer equipo será Sindeler, la segunda
-- Sindeler 2 en números romanos, la tercera Sindeler 3 en números
-- romanos"): SIN paréntesis, a propósito distinto de la numeración de
-- Maratón (que sí usa " (II)", ver numero_romano() más arriba) — aquí lo
-- calcula inscribirse_en_porra_futbol() más abajo, reutilizando la misma
-- numero_romano().
--
-- Escudos de los equipos: el admin puede pegar una URL de imagen al cargar
-- cada partido (escudo_local_url/escudo_visitante_url, opcionales) — Drafters
-- no incluye ni aloja escudos oficiales de los clubes (ver
-- DRAFTERS_Costes_Business_Plan.md: el uso de escudos/fotos con licencia
-- queda para una fase de pago posterior), así que si el admin no pone URL la
-- pantalla pinta un círculo con las iniciales del equipo en vez del escudo.
create table if not exists public.partidos_porra_futbol (
  id uuid primary key default gen_random_uuid(),
  porra_id uuid not null references public.porras (id) on delete cascade,
  orden int not null check (orden between 1 and 10),
  equipo_local text not null,
  equipo_visitante text not null,
  escudo_local_url text,
  escudo_visitante_url text,
  -- Resultado real marcado a mano por el admin una vez jugado el partido —
  -- null mientras no se haya jugado/marcado todavía.
  resultado_real text check (resultado_real in ('1', 'x', '2')),
  created_at timestamptz not null default now(),
  unique (porra_id, orden)
);

alter table public.partidos_porra_futbol enable row level security;
drop policy if exists "partidos_porra_futbol_select_publico" on public.partidos_porra_futbol;
create policy "partidos_porra_futbol_select_publico" on public.partidos_porra_futbol
  for select using (true);
drop policy if exists "partidos_porra_futbol_admin_todo" on public.partidos_porra_futbol;
create policy "partidos_porra_futbol_admin_todo" on public.partidos_porra_futbol
  for all using (public.es_admin()) with check (public.es_admin());

-- Pronóstico de un equipo (apunte) para un partido concreto — un equipo de
-- porra de fútbol pronostica los 10 partidos de una vez, al inscribirse (ver
-- inscribirse_en_porra_futbol() más abajo); no hay pantalla de editar
-- pronósticos ya enviados en esta primera vuelta.
create table if not exists public.predicciones_porra_futbol (
  id uuid primary key default gen_random_uuid(),
  equipo_id uuid not null references public.equipos (id) on delete cascade,
  partido_id uuid not null references public.partidos_porra_futbol (id) on delete cascade,
  prediccion text not null check (prediccion in ('1', 'x', '2')),
  creado_en timestamptz not null default now(),
  unique (equipo_id, partido_id)
);

create index if not exists predicciones_porra_futbol_equipo_idx on public.predicciones_porra_futbol (equipo_id);
create index if not exists predicciones_porra_futbol_partido_idx on public.predicciones_porra_futbol (partido_id);

alter table public.predicciones_porra_futbol enable row level security;
drop policy if exists "predicciones_porra_futbol_select_propio" on public.predicciones_porra_futbol;
create policy "predicciones_porra_futbol_select_propio" on public.predicciones_porra_futbol
  for select using (
    public.es_admin()
    or exists (select 1 from public.equipos e where e.id = predicciones_porra_futbol.equipo_id and e.usuario_id = auth.uid())
  );
drop policy if exists "predicciones_porra_futbol_admin_todo" on public.predicciones_porra_futbol;
create policy "predicciones_porra_futbol_admin_todo" on public.predicciones_porra_futbol
  for all using (public.es_admin()) with check (public.es_admin());
-- Sin política de insert para el usuario normal a propósito: los pronósticos
-- se escriben SIEMPRE a través de inscribirse_en_porra_futbol() (security
-- definer, más abajo), nunca sueltos desde el cliente.

-- Inscribe un nuevo equipo (= un apunte más) en una porra de fútbol: valida
-- que haya un pronóstico para cada uno de los partidos cargados, calcula el
-- nombre automático del equipo (Sindeler / Sindeler II / Sindeler III...),
-- cobra el precio de la porra y guarda los 10 pronósticos. Mismo patrón que
-- inscribirse_en_porra() (arriba) pero sin jugadores ni presupuesto.
create or replace function public.inscribirse_en_porra_futbol(
  p_porra_id uuid,
  -- [{"partido_id": "...", "prediccion": "1"|"x"|"2"}, ...] — uno por cada
  -- partido cargado en la porra.
  p_predicciones jsonb
)
returns public.equipos
language plpgsql
security definer set search_path = public
as $$
declare
  v_porra record;
  v_saldo numeric;
  v_equipo public.equipos;
  v_base_nombre text;
  v_num_equipos_previos int;
  v_nombre_final text;
  v_num_partidos int;
  v_item jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into v_porra from public.porras where id = p_porra_id for update;
  if not found then
    raise exception 'Porra no encontrada';
  end if;
  if v_porra.formato <> 'futbol_jornada' then
    raise exception 'Esta porra no es de fútbol';
  end if;
  if v_porra.estado = 'finalizada' then
    raise exception 'Esta porra ya no admite inscripciones';
  end if;
  if v_porra.fecha_limite_inscripcion is not null and v_porra.fecha_limite_inscripcion <= now() then
    raise exception 'El plazo de inscripción de esta porra ya ha cerrado';
  end if;

  select count(*) into v_num_partidos from public.partidos_porra_futbol where porra_id = p_porra_id;
  if v_num_partidos = 0 then
    raise exception 'Esta porra todavía no tiene partidos cargados';
  end if;
  if p_predicciones is null or jsonb_array_length(p_predicciones) <> v_num_partidos then
    raise exception 'Tienes que marcar un pronóstico (1, X o 2) en los % partidos de la jornada', v_num_partidos;
  end if;

  -- Nombre de equipo automático: "NombreUsuario" para el primer apunte de
  -- este usuario en esta porra, "NombreUsuario II"/"III"... para los
  -- siguientes (sin paréntesis, a propósito, ver el comentario de la
  -- sección de arriba).
  select coalesce(nombre_usuario, 'jugador-' || replace(auth.uid()::text, '-', '')) into v_base_nombre
    from public.perfiles where id = auth.uid();

  select count(*) into v_num_equipos_previos from public.equipos
    where usuario_id = auth.uid() and porra_id = p_porra_id;

  v_nombre_final := case
    when v_num_equipos_previos = 0 then v_base_nombre
    else v_base_nombre || ' ' || public.numero_romano(v_num_equipos_previos + 1)
  end;

  select saldo_simulado into v_saldo from public.perfiles where id = auth.uid() for update;
  if v_saldo < v_porra.precio then
    raise exception 'Saldo insuficiente para unirte a esta porra';
  end if;

  insert into public.equipos (usuario_id, modo, porra_id, nombre_equipo, jugadores, gasto_total)
  values (auth.uid(), 'porra', p_porra_id, v_nombre_final, '[]'::jsonb, 0)
  returning * into v_equipo;

  for v_item in select * from jsonb_array_elements(p_predicciones)
  loop
    if (v_item->>'prediccion') not in ('1', 'x', '2') then
      raise exception 'Pronóstico no válido: %', v_item->>'prediccion';
    end if;
    if not exists (
      select 1 from public.partidos_porra_futbol
      where id = (v_item->>'partido_id')::uuid and porra_id = p_porra_id
    ) then
      raise exception 'Alguno de los partidos no pertenece a esta porra';
    end if;

    insert into public.predicciones_porra_futbol (equipo_id, partido_id, prediccion)
    values (v_equipo.id, (v_item->>'partido_id')::uuid, v_item->>'prediccion');
  end loop;

  insert into public.inscripciones (equipo_id, importe) values (v_equipo.id, v_porra.precio);
  update public.perfiles set saldo_simulado = saldo_simulado - v_porra.precio where id = auth.uid();

  return v_equipo;
end;
$$;

revoke all on function public.inscribirse_en_porra_futbol(uuid, jsonb) from public;
grant execute on function public.inscribirse_en_porra_futbol(uuid, jsonb) to authenticated;

-- Clasificación de una porra de fútbol (aciertos sobre los partidos ya
-- resueltos) — para la pantalla de clasificación/premios y para que
-- /admin/pagos-pendientes pueda proponer el reparto automáticamente. Nunca
-- expone los pronósticos en sí de cada equipo (solo el recuento de
-- aciertos), así nadie puede ver el pronóstico de un rival en un partido
-- que todavía no se ha jugado.
create or replace function public.futbol_porra_clasificacion(p_porra_id uuid)
returns table (
  equipo_id uuid,
  nombre_equipo text,
  aciertos int,
  partidos_resueltos int,
  total_partidos int,
  created_at timestamptz
)
language sql
security definer set search_path = public
stable
as $$
  select
    e.id,
    e.nombre_equipo,
    count(*) filter (where pp.resultado_real is not null and pf.prediccion = pp.resultado_real)::int as aciertos,
    count(*) filter (where pp.resultado_real is not null)::int as partidos_resueltos,
    (select count(*) from public.partidos_porra_futbol where porra_id = p_porra_id)::int as total_partidos,
    e.created_at
  from public.equipos e
  join public.inscripciones i on i.equipo_id = e.id and i.estado <> 'reembolsada'
  left join public.predicciones_porra_futbol pf on pf.equipo_id = e.id
  left join public.partidos_porra_futbol pp on pp.id = pf.partido_id
  where e.porra_id = p_porra_id
  group by e.id, e.nombre_equipo, e.created_at
  order by aciertos desc, e.created_at asc;
$$;

revoke all on function public.futbol_porra_clasificacion(uuid) from public;
grant execute on function public.futbol_porra_clasificacion(uuid) to authenticated;

-- ============================================================================
-- CONVERTIR TU CUENTA EN SUPERADMINISTRADOR
-- ============================================================================
-- Activo (sin comentar): cada vez que se vuelva a pegar y ejecutar este
-- archivo completo en el SQL Editor de Supabase, esta línea se asegura de
-- que tu cuenta (porrasgolfspain@gmail.com) tenga rol = 'admin' — no hace
-- nada si ya lo tenía (es idempotente, como el resto del esquema). Si el
-- email todavía no existe en auth.users (no te has registrado aún en la
-- app con ese email), la subconsulta no encuentra ningún id y el UPDATE
-- simplemente no toca ninguna fila — no da error.
update public.perfiles set rol = 'admin' where id = (
  select id from auth.users where email = 'porrasgolfspain@gmail.com'
);

-- Cuando me digas el segundo usuario que debe tener acceso al panel de
-- admin, añado aquí una línea igual que esta con su email — no hace falta
-- tocar nada más del código, la tarjeta de "Mi cuenta" y la protección de
-- /admin ya funcionan para cualquier cuenta con rol = 'admin'.

-- ============================================================================
-- CRON DE RESULTADOS DE GOLF — PASO MANUAL, RELLENAR ANTES DE EJECUTAR
-- ============================================================================
-- Este bloque programa, dentro de la propia base de datos de Supabase, que
-- se llame cada 5 minutos a la ruta que sincroniza los resultados de golf
-- desde ESPN (app/api/admin/actualizar-golf-en-vivo/route.ts) — así no
-- depende de tener activado ningún plan de pago de Vercel (su "Cron Jobs"
-- gratuito solo deja programar como mucho una vez al día, no cada 5
-- minutos; con esto se programa desde Supabase en su lugar, que si lo
-- permite gratis).
--
-- ANTES DE EJECUTAR ESTE BLOQUE EN CONCRETO (el resto del archivo, por
-- encima de este punto, se puede pegar y ejecutar tal cual como siempre):
--   1. En Vercel (tu proyecto → Settings → Environment Variables), añade
--      una variable nueva CRON_SECRET con cualquier cadena larga y
--      aleatoria que tú elijas (por ejemplo, generada en
--      https://1password.com/password-generator o similar) — y vuelve a
--      desplegar la app para que la recoja.
--   2. Sustituye 'PON_AQUI_TU_CRON_SECRET' aquí abajo por ESE MISMO valor
--      exacto.
--   3. Si tu dominio de producción no es drafters-rho.vercel.app (por
--      ejemplo, si ya has puesto un dominio propio), cambia también la URL.
--   4. Entonces sí, ejecuta este bloque (una vez basta — no hace falta
--      repetirlo cada vez que vuelvas a pegar el resto del archivo; si lo
--      ejecutas de nuevo no pasa nada raro, cron.schedule() con el mismo
--      nombre de tarea simplemente la reemplaza por la misma).
--
-- Para comprobar que está funcionando: `select * from cron.job;` lista las
-- tareas programadas, y `select * from cron.job_run_details order by
-- start_time desc limit 20;` enseña las últimas ejecuciones.
-- Para quitarlo: `select cron.unschedule('actualizar-golf-en-vivo');`

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'actualizar-golf-en-vivo',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://drafters-rho.vercel.app/api/admin/actualizar-golf-en-vivo',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'hasiygqef1ojipcs332pj'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) as request_id;
  $cron$
);

-- ============================================================================
-- CRON DE CONSOLIDACIÓN DE MESAS — ningún dato manual, se puede pegar tal cual
-- ============================================================================
-- Pedido de Iñi (30/09): que la fusión de mesas idénticas sin llenar
-- (public.consolidar_salas_incompletas(), ver más arriba) sea automática de
-- verdad, no algo que haya que lanzar a mano. A diferencia del cron de
-- arriba, esta función es SQL puro dentro de la propia base de datos — no
-- llama a ninguna URL de la app, así que no necesita CRON_SECRET ni
-- dominio: se puede pegar y ejecutar exactamente igual que el resto de este
-- archivo, sin ningún paso previo.
--
-- Se ejecuta cada 5 minutos, igual que el de resultados de golf. Para
-- comprobarlo o quitarlo, mismos comandos que arriba con el nombre
-- 'consolidar-salas-incompletas'.
select cron.schedule(
  'consolidar-salas-incompletas',
  '*/5 * * * *',
  $$select public.consolidar_salas_incompletas();$$
);
