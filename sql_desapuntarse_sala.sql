-- ============================================================================
-- DESAPUNTARSE DE UNA MESA DRAFTERS (06/10)
-- ============================================================================
-- Pedido de Iñi: donde sale "Modificar equipo" también tiene que salir
-- "Borrar equipo" (desapuntarse de la sala), SOLO mientras la sala no haya
-- empezado (misma regla que editar_equipo_sala(): no finalizada y fecha límite
-- de inscripción sin pasar). Se devuelve el buy-in ÍNTEGRO.
--
-- Mismo mecanismo que ya usa el reembolso automático de salas incompletas:
-- la inscripción pasa a 'reembolsada' (deja de contar en aforo, listas y
-- clasificación), el saldo vuelve al usuario y queda un movimiento en el
-- historial. Idempotente: se puede ejecutar más de una vez.

create or replace function public.desapuntarse_de_sala(p_equipo_id uuid)
returns numeric
language plpgsql
security definer set search_path = public
as $$
declare
  v_equipo public.equipos;
  v_insc public.inscripciones;
  v_sala record;
  v_inscritos int;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if not public.tiene_acceso_mesas_drafters() then
    raise exception 'Todavía no tienes acceso a Mesas Drafters — de momento es solo un adelanto. Muy pronto estará disponible. Puedes seguir participando en las porras.';
  end if;

  select * into v_equipo from public.equipos
    where id = p_equipo_id and usuario_id = auth.uid() and modo in ('sala', 'mtt') for update;
  if not found then
    raise exception 'Equipo no encontrado';
  end if;

  select * into v_insc from public.inscripciones
    where equipo_id = p_equipo_id and estado <> 'reembolsada' for update;
  if not found then
    raise exception 'Este equipo ya no está inscrito';
  end if;

  select * into v_sala from public.salas where id = v_equipo.sala_id for update;
  if not found or v_sala.estado = 'finalizada' then
    raise exception 'Esta sala ya no admite cambios';
  end if;
  if v_sala.fecha_limite_inscripcion is not null and now() >= v_sala.fecha_limite_inscripcion then
    raise exception 'Ya ha pasado la fecha límite: no puedes desapuntarte de esta sala';
  end if;

  update public.inscripciones set estado = 'reembolsada' where id = v_insc.id;
  update public.perfiles set saldo_simulado = saldo_simulado + v_insc.importe where id = auth.uid();
  if v_insc.importe > 0 then
    insert into public.movimientos (usuario_id, tipo, importe) values (auth.uid(), 'deposito', v_insc.importe);
  end if;

  -- Si la sala estaba llena o casi llena, vuelve a tener hueco (mismo criterio
  -- que inscribirse_en_sala(): 'completa' al llenarse, 'casi_llena' con 1 hueco).
  if v_sala.tipo <> 'maraton' and v_sala.aforo is not null and v_sala.estado in ('completa', 'casi_llena') then
    select count(*) into v_inscritos
      from public.equipos e
      join public.inscripciones i on i.equipo_id = e.id
      where e.sala_id = v_sala.id and i.estado <> 'reembolsada';
    if v_inscritos >= v_sala.aforo then
      update public.salas set estado = 'completa' where id = v_sala.id;
    elsif v_inscritos >= v_sala.aforo - 1 then
      update public.salas set estado = 'casi_llena' where id = v_sala.id;
    else
      update public.salas set estado = 'abierta' where id = v_sala.id;
    end if;
  end if;

  return v_insc.importe;
end;
$$;

revoke all on function public.desapuntarse_de_sala(uuid) from public;
grant execute on function public.desapuntarse_de_sala(uuid) to authenticated;
