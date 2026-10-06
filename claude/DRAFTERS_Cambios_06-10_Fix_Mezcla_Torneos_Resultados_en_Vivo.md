# Cambios 06/10 — Resultados de golf en vivo: no mezclar torneos y solo mostrar los vigentes

## Problema
Los endpoints de Data Golf son por TOUR, no por torneo. `in-play` sigue devolviendo el torneo que acaba de terminar (Alfred Dunhill) hasta que arranca el siguiente. La sincronización emparejaba por nombre, así que los jugadores que repiten en el Open de España (aún sin empezar) recibían los resultados en vivo de la Dunhill (puntos, posición, hoyo a hoyo, penalización de corte). Esto encaja con el síntoma que vio Iñi.

## Arreglo (`app/api/admin/actualizar-golf-en-vivo/route.ts`)
- `nombreTorneoCoincide()`: solo se actualizan jugadores si el nombre del evento que devuelve `in-play` (`info.event_name`) coincide con la competición (uno contenido en el otro, ≥ 8 caracteres). Si no coincide, no se escribe nada en jugadores, hoyos ni cortes, y el resultado trae un `aviso` con el nombre que devuelve Data Golf. Si Data Golf no manda nombre, se deja pasar.
- El cierre automático de inscripciones y la detección de torneo terminado siguen funcionando.
- Si el nombre de la competición es muy distinto al de Data Golf, la sincronización se salta siempre y lo dice en el aviso: hay que renombrar la competición.

## Pantalla Resultados de golf en vivo
- Solo se listan las competiciones vigentes (`finalizado_en` vacío); las finalizadas desaparecen de la pantalla (siguen en la base de datos). La sincronización ya ignoraba las finalizadas.
- "Actualizar ahora" muestra el aviso en ámbar cuando Data Golf aún devuelve otro torneo.
- El "x/80 jugadores emparejados" que se ve tras actualizar: el 80 es el nº de jugadores que la competición tiene en la base de datos (la lista cargada en la porra), NO los que trae Data Golf. Si el campo real tiene más (127), la lista cargada está incompleta.

## Limpieza de datos ya contaminados
`sql_limpiar_resultados_open_espana.sql`: vacía resultados en vivo, hoyo a hoyo y penalización de corte de los jugadores del Open de España (competición que contenga "Open de Espa"). No toca porras, equipos ni precios.
