-- Ejecutar en Supabase (SQL Editor). Idempotente.

-- ============================================================================
-- DESAPUNTARSE DE UNA PORRA CLÁSICA (06/10)
-- ============================================================================
-- Igual que desapuntarse_de_sala(): solo mientras la porra no haya empezado
-- (no finalizada y fecha límite sin pasar — misma regla que editar_equipo_porra)
-- y devolviendo el precio de entrada ÍNTEGRO. Aquí el equipo se BORRA del todo
-- (su inscripción se va en cascada) en vez de marcarla 'reembolsada', porque
-- el nombre de equipo es único dentro de la porra (equipos_porra_nombre_equipo_unico)
-- y así el nombre queda libre para volver a usarlo.

create or replace function public.desapuntarse_de_porra(p_equipo_id uuid)
returns numeric
language plpgsql
security definer set search_path = public
as $$
declare
  v_equipo public.equipos;
  v_insc public.inscripciones;
  v_porra record;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into v_equipo from public.equipos
    where id = p_equipo_id and usuario_id = auth.uid() and modo = 'porra' for update;
  if not found then
    raise exception 'Equipo no encontrado';
  end if;

  select * into v_insc from public.inscripciones
    where equipo_id = p_equipo_id and estado <> 'reembolsada' for update;
  if not found then
    raise exception 'Este equipo ya no está inscrito';
  end if;

  select * into v_porra from public.porras where id = v_equipo.porra_id for update;
  if not found or v_porra.estado = 'finalizada' then
    raise exception 'Esta porra ya no admite cambios';
  end if;
  if v_porra.fecha_limite_inscripcion is not null and v_porra.fecha_limite_inscripcion <= now() then
    raise exception 'Ya ha pasado la fecha límite: no puedes desapuntarte de esta porra';
  end if;

  update public.perfiles set saldo_simulado = saldo_simulado + v_insc.importe where id = auth.uid();
  if v_insc.importe > 0 then
    insert into public.movimientos (usuario_id, tipo, importe) values (auth.uid(), 'deposito', v_insc.importe);
  end if;

  delete from public.equipos where id = p_equipo_id;

  return v_insc.importe;
end;
$$;

revoke all on function public.desapuntarse_de_porra(uuid) from public;
grant execute on function public.desapuntarse_de_porra(uuid) to authenticated;
