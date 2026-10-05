# Cambios 04/10 — Fix pestañas apiladas en móvil + fix detección "torneo finalizado" (Dunhill)

Dos arreglos pedidos por Iñi tras ver la pantalla de clasificación de la Alfred Dunhill Links Championship en producción, horas después de terminar el torneo.

## 1. Pestañas (PORRA/TORNEO/PREMIOS/...) apiladas a todo el ancho en móvil

**Causa real:** en los cambios del día anterior (ocultar la pestaña "Porra"/"Mesa" una vez finalizado el torneo) se añadió `flexWrap: 'wrap'` al contenedor de las pestañas en `app/porras/[id]/clasificacion/page.tsx` y `app/salas/[id]/clasificacion/page.tsx`, sin necesidad real — no arreglaba nada, y en pantallas estrechas hacía que cada pestaña ocupara su propia fila a todo el ancho en vez de ir en una sola fila horizontal con scroll/ajuste natural, que es como estaba antes y como tenía que seguir.

**Arreglo:** se ha quitado ese `flexWrap: 'wrap'` en los dos archivos — el contenedor vuelve a ser exactamente `{ display: 'flex', gap: 6, alignSelf: 'flex-start' }`, igual que estaba antes de esos cambios.

## 2. El torneo no se marcaba como finalizado aunque ya había acabado hace horas

Iñi apuntó como sospecha que podía ser por los jugadores que no pasan el corte (no juegan la 4ª ronda, así que nunca llegan a "thru 18 en la ronda 4"). Se ha revisado el código y esa parte **ya estaba bien**: el chequeo de "¿ha terminado el torneo?" ya excluye de antes a los jugadores con CUT/WD/DQ/DNS/MDF antes de comprobar si todos están a *thru* 18 — así que ese no era el problema.

**La causa real** estaba en otro sitio, más de fondo: para saber el número de rondas del torneo, se llama cada ciclo a `field-updates` de Data Golf — pero esa llamada se pide **por tour** (p.ej. "euro" para el DP World Tour), no por torneo concreto, porque Data Golf no tiene forma de pedir "el campo DE ESTE torneo en concreto". En cuanto la Dunhill terminó, esa misma llamada empezó a devolver (bajo el mismo "tour=euro") el campo del **siguiente torneo** del calendario — que normalmente solo tiene publicada la ronda 1 todavía.

El código se quedaba con "lo detectado en este ciclo, o si no lo que ya tenía guardado" — así que en cuanto empezó a recibir datos del torneo siguiente, el número de rondas pasó de 4 (la Dunhill) a 1 (el que viene), contaminado. Y el chequeo de "¿están todos a *thru* 18 en la última ronda?" pasó a comprobar "¿están todos en la ronda 1?" — que nunca se cumple, porque los jugadores de la Dunhill ya habían jugado las 4 rondas. Esto además reiniciaba cada ciclo el reloj de la espera de una hora antes de liquidar, así que nunca llegaba a completarse.

**Arreglo:** una vez que el número de rondas de un torneo se conoce (se guarda en `torneos_golf_live.rondas_totales`), ya no se puede volver a bajar — ni al guardarlo en la base de datos ni al usarlo para comprobar si el torneo ha terminado. Solo puede confirmarse o subir (necesario para torneos con amateurs, como la Dunhill, donde se va descubriendo poco a poco quién juega las 4 rondas y quién menos). Así, aunque `field-updates` empiece a devolver el torneo siguiente, ya no puede pisar el dato correcto del torneo que nos interesa.

Este arreglo es en `app/api/admin/actualizar-golf-en-vivo/route.ts` — no ha hecho falta ningún cambio de SQL.

## Verificación

- `npx tsc --noEmit` limpio.
- `npm run build` compila sin errores.
- No ha hecho falta tocar `drafters-schema.sql` en esta vuelta.
