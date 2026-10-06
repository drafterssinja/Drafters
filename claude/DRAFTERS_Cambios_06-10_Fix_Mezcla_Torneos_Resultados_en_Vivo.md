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

## Dunhill sin cerrarse (06/10, mismo día)
La Alfred Dunhill seguía "vigente" dos días después de acabar (finalizado_en vacío). Causa más probable: el nº de rondas guardado (`rondas_totales`) se queda bajo por la contaminación de `field-updates` (que ya devuelve el Open de España, con solo la ronda 1 publicada) y la detección exige que todos estén en la última ronda con 18 hoyos — con un valor demasiado bajo no se cumple nunca.
- `route.ts`: el nº de rondas efectivo es ahora `max(guardado, ronda más alta vista jugando)` y se guarda si sube. Así un valor bajo atascado se corrige solo en el siguiente ciclo, sin tocar la regla de cierre (todos los que compiten en la última ronda con thru 18, y 1 hora de espera).
- `/admin/resultados-golf`, en cada torneo: botón **¿Por qué no se cierra solo?** (rondas guardadas, ronda máxima vista, cuántos jugadores siguen compitiendo y cuáles no han terminado) y botón **Dar por finalizado** (marca `finalizado_en`: desaparece de la pantalla y deja de sincronizarse; NO liquida porras, eso sigue en Pagos pendientes).

## Causa real de la Dunhill (diagnóstico de Iñi, 06/10 20:11)
El botón de diagnóstico dio: rondas guardadas 4, ronda más alta vista 4, 154 jugadores con resultado, 66 compitiendo, y **1 sin terminar: Benjamin Follett-Smith con ronda/hoyo/posición vacíos**. Un jugador con resultado pero sin ronda ni hoyo (Data Golf lo dejó sin estado, típico de una retirada) bloqueaba el cierre. Arreglo: tanto la sincronización como el diagnóstico ignoran a quien tiene `resultado_en_vivo_ronda` vacío al decidir si el torneo ha terminado. El arreglo del nº de rondas de más arriba no era la causa en este caso.

## Enlazar jugadores ANTES de que empiece el torneo (06/10)
Pedido de Iñi: poder ir enlazando jugadores sin esperar al en vivo. Antes, los nombres "sin emparejar" solo salían tras una sincronización con datos del torneo.
- Nuevo botón **Comprobar jugadores** (junto a "Actualizar ahora") en `/admin/resultados-golf`. Llama a `POST /api/admin/comprobar-emparejamiento-golf` (solo admin), que compara el campo que Data Golf publica en `field-updates` (sin aficionados, mismos nombres que usará el en vivo) con los jugadores cargados en la porra de cada competición vigente de Data Golf, aplicando los alias ya guardados. No escribe nada.
- Muestra: nº del campo de Data Golf emparejados con la porra; los nombres de Data Golf sin emparejar (con el mismo formulario de alias de siempre para enlazarlos); y los jugadores de la porra que Data Golf NO tiene en el campo (candidatos a quitar con la × de Porras de golf → Jugadores).
- Si Data Golf todavía publica el campo de otro torneo, avisa y no compara.
- `nombreTorneoCoincide()` pasó a `lib/nombreMatch.ts` (compartida con la sincronización).
