# Cambios 05/10 — Creación automática de porra + mesas de golf desde Data Golf

## Qué hace
Cada 10 minutos un cron (`crear-golf-desde-datagolf`, SQL al final de `drafters-schema.sql`) llama a `/api/admin/crear-golf-desde-datagolf`, que revisa **DP World Tour (euro) y PGA Tour (pga)**. Cuando el próximo torneo tiene cuotas publicadas, crea solo:
- Los jugadores (el campo de `field-updates`, sin aficionados) con precio calculado por cuota.
- La porra clásica (precio de entrada 20 €) y las mesas Drafters del torneo.
- La fila de `torneos_golf_live` (fuente Data Golf) para resultados en vivo y cierre automático de inscripciones. Si ya hay otro torneo activo y sin finalizar en ese tour, se crea desactivada.

Todo nace como **BORRADOR** (`publicada = false` en porras y salas): oculto para los usuarios (política RLS `publicada or es_admin()`) y **sin correos**. El correo de nueva porra sale al publicar (trigger `on_porra_publicada_notificar`, cuando `publicada` pasa de false a true).

Iñi revisa en **Admin → Porras de golf**: botón *Revisar* (marcar/desmarcar españoles y *Guardar españoles*, que recalcula los grupos de color) y botón *Publicar* (publica mesas y después la porra).

## Aviso al admin
Cuando se crea un borrador, la ruta inserta una notificación (tipo nuevo `borrador_golf`, icono ⛳) para cada admin en la zona de Notificaciones, con enlace a `/admin/porras-golf`. Sale con el punto rojo de la cabecera como cualquier otra. SQL: amplía el check de `notificaciones.tipo` (final de `drafters-schema.sql`).

## Decisiones
- **Cuota = bet365** (pedido de Iñi). Jugador sin cuota de bet365 → precio mínimo.
- **Españoles** marcados solos por `country = "ESP"` de `field-updates`. El país no es del todo fiable (Adrián Otaegui sale como "UAE"), por eso se revisa siempre antes de publicar.
- **Aficionados** (`am = 1`) excluidos.
- No se vuelve a crear un torneo ya procesado (tabla `golf_autocreacion_torneos`), aunque se borre el borrador.
- No se crea si el torneo ya ha empezado (primera salida pasada o `date_start` <= hoy).
- Mínimo 20 jugadores del campo con cuota para considerar que "ya hay cuotas".

## Formas de Data Golf confirmadas (05/10, respuestas reales)
- `field-updates`: raíz con `event_name`, `event_id`, `date_start`, `date_end`, `course_name`, `current_round`, `multi_course`, `tour`, `tz_offset`, `last_updated`, `field[]`. Cada jugador: `player_name` ("Apellido, Nombre"), `dg_id`, `country`, `am`, `dg_rank`, `owgr_rank`, `teetimes` (vacío hasta que se publican).
- `betting-tools/outrights`: raíz con `event_name`, `market`, `books_offering`, `notes`, `last_updated`, `odds[]`. Cada jugador: `dg_id`, `player_name`, `datagolf {baseline, baseline_history_fit}` y una clave por casa con cuota decimal (si la casa no ofrece precio, la clave no aparece).

## Trampa importante: los endpoints son por TOUR y NO cambian de torneo a la vez
El 05/10, `field-updates` ya devolvía el Open de España mientras `outrights` seguía devolviendo la Alfred Dunhill (con `notes: "Tournament is live"`). Por eso la creación solo usa las cuotas si son del **mismo torneo** que el campo (mismo nombre, o ≥ 90% de los jugadores con cuota dentro del campo); si no, espera.

Misma causa raíz que el bug de la Dunhill sin finalizar (ver `DRAFTERS_Cambios_04-10_Fix_Pestanas_Apiladas_y_Deteccion_Torneo_Finalizado.md`). Medida adicional: la sincronización en vivo ya **no procesa torneos con `finalizado_en`**, para que el torneo siguiente no pise la clasificación final del anterior (los jugadores que repiten se emparejan por nombre).

## Lo que sigue manual
- Revisar españoles y publicar cada borrador.
- Activar en `/admin/resultados-golf` el torneo de resultados en vivo si se creó desactivado.
- Fecha límite de inscripción: queda vacía hasta que Data Golf publique horas de salida; en cuanto las publica, el propio cron de creación (cada 10 min) la fija 5 minutos antes de la primera salida en la porra y las mesas, SIN depender de que la fila de resultados en vivo esté activa (`aplicar_cierre_automatico_inscripciones`, idempotente: nunca pisa una fecha puesta a mano).
