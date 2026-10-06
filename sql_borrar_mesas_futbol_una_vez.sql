-- ============================================================================
-- BORRAR LAS MESAS DE FÚTBOL ACTUALES (UNA SOLA VEZ) — 06/10
-- ============================================================================
-- Pedido de Iñi: borrar todas las mesas Drafters de fútbol existentes (con
-- reembolso íntegro) y dejar que se creen solas, ya reducidas (solo mesas de
-- 10 €). ORDEN:
--   1) Ejecutar sql_futbol_auto_jornadas.sql
--   2) Ejecutar ESTE archivo (una vez)
--   3) Desplegar la app y pulsar "Crear jornadas ahora" en
--      /admin/resultados-futbol (o esperar a que lo haga el cron).
--
-- Qué hace:
--  - Guarda el número y el primer partido de cada jornada existente en
--    futbol_jornadas_auto (creada = false) para que la numeración automática
--    siga correcta y las jornadas futuras se vuelvan a crear solas.
--  - Reembolsa a cada inscripción activa de las mesas NO finalizadas
--    (inscripción 'reembolsada' + saldo + movimiento + notificación).
--  - Borra esas mesas. Las ya FINALIZADAS (historial con premios ya
--    repartidos) se conservan, para no reembolsar dos veces; si quieres
--    borrarlas también, cambia v_borrar_finalizadas a true — OJO: las de
--    estado finalizada con premios pagados NO se reembolsan (solo se borran).
--  - NO borra los jugadores: sirven de plantilla para las jornadas nuevas
--    (el sistema retira los duplicados al crear cada jornada).

do $$
declare
  v_borrar_finalizadas boolean := false;
  candidato record;
  v_comp record;
begin
  -- 1) Anclas de numeración.
  for v_comp in
    select s.competicion,
           min(s.fecha_limite_inscripcion) as primer_partido,
           case when s.competicion ilike 'La Liga - Jornada %' then 'La Liga'
                when s.competicion ilike 'Champions League - Jornada %' then 'Champions League' end as liga,
           nullif(regexp_replace(s.competicion, '^.*Jornada\s+(\d+).*$', '\1'), s.competicion)::int as numero
      from public.salas s
     where s.deporte = 'futbol'
       and s.fecha_limite_inscripcion is not null
     group by s.competicion
  loop
    if v_comp.liga is not null and v_comp.numero is not null then
      insert into public.futbol_jornadas_auto (liga, numero, primer_partido, competicion, creada)
      values (v_comp.liga, v_comp.numero, v_comp.primer_partido, v_comp.competicion, false)
      on conflict (liga, numero) do nothing;
    end if;
  end loop;

  -- 2) Reembolso a las inscripciones activas de mesas no finalizadas.
  for candidato in
    select e.usuario_id, i.id as inscripcion_id, i.importe, s.nombre as sala_nombre, s.competicion
      from public.equipos e
      join public.inscripciones i on i.equipo_id = e.id and i.estado <> 'reembolsada'
      join public.salas s on s.id = e.sala_id
     where s.deporte = 'futbol' and s.estado <> 'finalizada'
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
      'Hemos renovado las mesas de fútbol ("' || candidato.competicion || '", ' || candidato.sala_nombre || '). Te hemos devuelto tu inscripción íntegra, sin ningún descuento. Las nuevas mesas ya están disponibles.'
    );
  end loop;

  -- 3) Borrado de las mesas.
  if v_borrar_finalizadas then
    delete from public.salas where deporte = 'futbol';
  else
    delete from public.salas where deporte = 'futbol' and estado <> 'finalizada';
  end if;
end $$;

-- Comprobación: debería quedar 0 (o solo las finalizadas).
select estado, count(*) from public.salas where deporte = 'futbol' group by estado;
