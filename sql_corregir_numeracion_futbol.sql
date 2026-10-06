-- ============================================================================
-- CORREGIR LA NUMERACIÓN DE JORNADAS CREADAS AUTOMÁTICAMENTE (06/10)
-- ============================================================================
-- Problema: la primera jornada que creó sola la app salió como "Jornada 1"
-- cuando era la 9. Ahora el número se calcula contando los partidos de cada
-- equipo desde el inicio de temporada (el partido nº 9 de un equipo es de la
-- jornada 9), pero hay que limpiar lo ya creado mal. Ejecutar UNA vez:
--   1) este archivo (reembolsa y borra las mesas creadas solas, sus jugadores
--      clonados, cuotas y anclas),
--   2) desplegar la nueva versión,
--   3) pulsar "Crear jornadas ahora" en /admin/resultados-futbol.
-- Las mesas creadas a mano (o ya finalizadas) no se tocan.

do $$
declare
  v_comp record;
  candidato record;
begin
  for v_comp in
    select distinct competicion from public.futbol_jornadas_auto where creada
  loop
    -- Reembolso íntegro a quien se hubiera apuntado a esas mesas.
    for candidato in
      select e.usuario_id, i.id as inscripcion_id, i.importe, s.nombre as sala_nombre
        from public.equipos e
        join public.inscripciones i on i.equipo_id = e.id and i.estado <> 'reembolsada'
        join public.salas s on s.id = e.sala_id
       where s.competicion = v_comp.competicion and s.estado <> 'finalizada'
    loop
      update public.inscripciones set estado = 'reembolsada' where id = candidato.inscripcion_id;
      update public.perfiles set saldo_simulado = saldo_simulado + candidato.importe where id = candidato.usuario_id;
      if candidato.importe > 0 then
        insert into public.movimientos (usuario_id, tipo, importe) values (candidato.usuario_id, 'deposito', candidato.importe);
      end if;
      insert into public.notificaciones (usuario_id, tipo, titulo, mensaje) values (
        candidato.usuario_id,
        'eliminado',
        'Tu mesa se ha borrado, se te ha devuelto el importe',
        'La jornada "' || v_comp.competicion || '" se había creado con un número equivocado (' || candidato.sala_nombre || '). Te hemos devuelto tu inscripción íntegra; la jornada correcta aparecerá en unos minutos.'
      );
    end loop;

    delete from public.salas where competicion = v_comp.competicion and estado <> 'finalizada';
    delete from public.jugadores where competicion = v_comp.competicion and coalesce(metadata->>'creada_automaticamente', '') = 'true';
    delete from public.cuotas_partido_futbol where competicion = v_comp.competicion;
  end loop;

  -- Anclas: se vuelven a calcular solas contando partidos por equipo.
  delete from public.futbol_jornadas_auto;
end $$;

select competicion, count(*) as mesas from public.salas where deporte = 'futbol' group by competicion order by competicion;
