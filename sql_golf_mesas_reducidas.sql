-- ============================================================================
-- MESAS DE GOLF REDUCIDAS + MESA TRIDENTE (10 jugadores, 3 ganadores) — 07/10
-- ============================================================================
-- Pedido de Iñi: en golf, igual que en fútbol, solo los tipos acordados y solo
-- de 10 €; borrar todas las demás mesas de golf (con reembolso íntegro) y que
-- se cree también la mesa de 10 jugadores con 3 ganadores (Tridente).
--
-- ORDEN: ejecutar ESTE archivo (una vez) y después desplegar la app.
--
-- SE QUEDAN (de 10, 25 y 50 €, una de cada tipo — ampliado el 07/10):
--   Doble o Nada de 2 y de 4 jugadores · Triple o Nada de 3 y de 6 ·
--   Oro y Plata de 5 · Tridente de 10 · y el Maratón (solo 10 €).
-- Es IDEMPOTENTE: se puede ejecutar aunque ya se ejecutara la versión anterior
-- (la de solo 10 €); en ese caso solo añade las mesas de 25 y 50 que falten.
-- SE BORRAN: el resto de mesas de golf NO finalizadas (otros importes, otros
--   aforos, otros tipos). Las FINALIZADAS no se tocan (premios ya repartidos).
--   No toca el tenis ni las porras de golf (que no son mesas).
-- Las mesas que se quedan conservan sus inscritos.
-- Antes de borrar, completa las competiciones abiertas (golf y fútbol, plazo
-- vigente) con las mesas del conjunto que les falten: cada tipo a 10, 25 y 50 €.

do $$
declare
  candidato record;
begin
  -- 0) Completa las competiciones abiertas (golf y fútbol, con plazo de inscripción
  --    todavía vigente) con las mesas que les falten del conjunto acordado, entre
  --    ellas la nueva Tridente de 10 jugadores y 3 ganadores.
  insert into public.salas (nombre, deporte, competicion, tipo, aforo, buy_in, fecha_limite_inscripcion, publicada, circuito)
  select v.nombre || ' · ' || b.buy_in || '€', c.deporte, c.competicion, v.tipo, v.aforo, b.buy_in, c.fecha_limite_inscripcion, c.publicada, c.circuito
    from (
      select distinct on (deporte, competicion) deporte, competicion, fecha_limite_inscripcion, publicada, circuito
        from public.salas
       where deporte in ('golf', 'futbol')
         and estado <> 'finalizada'
         and (fecha_limite_inscripcion is null or fecha_limite_inscripcion > now())
       order by deporte, competicion, created_at
    ) c
    cross join (values
      ('Doble o Nada',  'doble_o_nada',  2),
      ('Doble o Nada',  'doble_o_nada',  4),
      ('Triple o Nada', 'triple_o_nada', 3),
      ('Triple o Nada', 'triple_o_nada', 6),
      ('Oro y Plata',   'oro_y_plata',   5),
      ('Tridente',      'tridente',      10)
    ) as v(nombre, tipo, aforo)
    cross join (values (10), (25), (50)) as b(buy_in)
   where not exists (
     select 1 from public.salas t
      where t.deporte = c.deporte and t.competicion = c.competicion
        and t.tipo = v.tipo and t.aforo = v.aforo and t.buy_in = b.buy_in
   );

  -- 1) Reembolso íntegro a las inscripciones activas de las mesas que se borran.
  for candidato in
    select e.usuario_id, i.id as inscripcion_id, i.importe, s.nombre as sala_nombre, s.competicion
      from public.equipos e
      join public.inscripciones i on i.equipo_id = e.id and i.estado <> 'reembolsada'
      join public.salas s on s.id = e.sala_id
     where s.deporte = 'golf'
       and s.estado <> 'finalizada'
       and not (
         s.buy_in in (10, 25, 50) and (
           (s.tipo = 'maraton' and s.buy_in = 10)
           or (s.tipo = 'doble_o_nada'  and s.aforo in (2, 4))
           or (s.tipo = 'triple_o_nada' and s.aforo in (3, 6))
           or (s.tipo = 'oro_y_plata'   and s.aforo = 5)
           or (s.tipo = 'tridente'      and s.aforo = 10)
         )
       )
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
      'Hemos simplificado las mesas de golf ("' || candidato.competicion || '", ' || candidato.sala_nombre || '). Te hemos devuelto tu inscripción íntegra, sin ningún descuento. Las mesas que quedan siguen disponibles.'
    );
  end loop;

  -- 2) Borrado de esas mesas.
  delete from public.salas s
   where s.deporte = 'golf'
     and s.estado <> 'finalizada'
     and not (
       s.buy_in in (10, 25, 50) and (
         (s.tipo = 'maraton' and s.buy_in = 10)
         or (s.tipo = 'doble_o_nada'  and s.aforo in (2, 4))
         or (s.tipo = 'triple_o_nada' and s.aforo in (3, 6))
         or (s.tipo = 'oro_y_plata'   and s.aforo = 5)
         or (s.tipo = 'tridente'      and s.aforo = 10)
       )
     );

end $$;

-- Comprobación: solo deberían quedar las mesas de 10/25/50 € de los tipos acordados (y las finalizadas).
select tipo, aforo, buy_in, estado, count(*) from public.salas where deporte = 'golf' group by tipo, aforo, buy_in, estado order by tipo, aforo;
