-- ============================================================================
-- MESA LLENA → SE CREA OTRA IGUAL Y VACÍA (07/10, pedido de Iñi)
-- ============================================================================
-- "Cuando una mesa Drafters de fútbol o de golf se complete, automáticamente se
-- genere una nueva exactamente igual que la que ya se ha completado, pero vacía."
--
-- Sustituye al disparador antiguo trg_salas_mantener_disponibles, que clonaba
-- las mesas al FINALIZAR (al terminar la jornada/torneo), creando mesas vacías
-- sin fecha límite en competiciones ya acabadas. Ahora:
--   - Se dispara cuando una mesa pasa a 'completa'.
--   - Crea UNA mesa nueva idéntica (nombre, deporte, competición, tipo, aforo,
--     importe, fecha límite, publicada, circuito) y vacía.
--   - No se crea si ya ha pasado la fecha límite de inscripción, si es
--     Maratón (no tiene aforo), o si ya hay otra mesa igual con hueco
--     (abierta o casi llena) — así no se duplican si alguien se desapunta y
--     la mesa se vuelve a llenar.
-- Ejecutar una vez. No hace falta volver a desplegar la app.

create or replace function public.mantener_mesas_disponibles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tipo = 'maraton' or new.aforo is null then
    return new;
  end if;
  if not (new.estado = 'completa' and old.estado is distinct from 'completa') then
    return new;
  end if;
  if new.fecha_limite_inscripcion is not null and new.fecha_limite_inscripcion <= now() then
    return new;
  end if;
  if exists (
    select 1 from public.salas s
     where s.id <> new.id
       and s.deporte = new.deporte
       and s.competicion = new.competicion
       and s.tipo = new.tipo
       and s.aforo = new.aforo
       and s.buy_in = new.buy_in
       and s.estado in ('abierta', 'casi_llena')
  ) then
    return new;
  end if;

  insert into public.salas (nombre, deporte, competicion, tipo, aforo, buy_in, estado, fecha_limite_inscripcion, publicada, circuito)
  values (new.nombre, new.deporte, new.competicion, new.tipo, new.aforo, new.buy_in, 'abierta', new.fecha_limite_inscripcion, new.publicada, new.circuito);
  return new;
end;
$$;

drop trigger if exists trg_salas_mantener_disponibles on public.salas;
create trigger trg_salas_mantener_disponibles
  after update of estado on public.salas
  for each row execute function public.mantener_mesas_disponibles();

-- Limpieza de las mesas vacías que creaba el disparador antiguo al finalizar:
-- sin fecha límite, abiertas, sin ningún equipo, y de competiciones que ya
-- tienen mesas finalizadas.
delete from public.salas s
 where s.estado = 'abierta'
   and s.fecha_limite_inscripcion is null
   and s.tipo <> 'maraton'
   and not exists (select 1 from public.equipos e where e.sala_id = s.id)
   and exists (
     select 1 from public.salas f
      where f.deporte = s.deporte and f.competicion = s.competicion and f.estado = 'finalizada'
   );

-- Mesas que ya están llenas ahora mismo y con plazo abierto: se les crea ya su copia vacía.
insert into public.salas (nombre, deporte, competicion, tipo, aforo, buy_in, estado, fecha_limite_inscripcion, publicada, circuito)
select distinct on (c.deporte, c.competicion, c.tipo, c.aforo, c.buy_in)
       c.nombre, c.deporte, c.competicion, c.tipo, c.aforo, c.buy_in, 'abierta', c.fecha_limite_inscripcion, c.publicada, c.circuito
  from public.salas c
 where c.estado = 'completa'
   and c.tipo <> 'maraton' and c.aforo is not null
   and (c.fecha_limite_inscripcion is null or c.fecha_limite_inscripcion > now())
   and not exists (
     select 1 from public.salas s
      where s.deporte = c.deporte and s.competicion = c.competicion and s.tipo = c.tipo
        and s.aforo = c.aforo and s.buy_in = c.buy_in and s.estado in ('abierta', 'casi_llena')
   )
 order by c.deporte, c.competicion, c.tipo, c.aforo, c.buy_in, c.created_at;
