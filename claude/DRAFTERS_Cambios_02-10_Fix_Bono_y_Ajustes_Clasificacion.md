# Arreglo del bono de podio + ajustes de la clasificación en directo (02/10)

## 1. El bug real: el líder sin posición numérica se quedaba sin su bono

Probando la porra en marcha, Iñi detectó que Casey Harvis (1º del torneo
real, −11) no le restaba los 10 golpes al equipo "Ugarit Team" que lo
tiene: el total mostraba −23 en vez de −33.

Causa encontrada en `lib/golfScoring.ts` (`calcularBonosPodio()`): la
función exigía que `jugadores.resultado_en_vivo_posicion` parseara como un
puesto numérico limpio ("1", "T4"...) para contar a un jugador como "en
juego" para el podio. Si esa columna viene vacía, con un formato que ESPN
no manda siempre igual, o simplemente no se ha sincronizado todavía
aunque el jugador YA tenga su `resultado_en_vivo_total` real (su golpes
respecto al par), la función lo descartaba en silencio — exactamente lo
que le pasaba al líder real del torneo.

**Arreglo**: el criterio se ha invertido. Un jugador con resultado cuenta
como "en juego" SALVO que su posición diga explícitamente que ya no sigue
compitiendo (`CUT`, `WD`, `DQ`, `DNS`, `MDF`). Una posición ausente o con
un formato inesperado ya no le quita el bono a quien de verdad va
primero/segundo/tercero. Verificado con una prueba puntual
(`calcularBonosPodio` con un líder sin dato de posición y otro jugador
`CUT`): el líder recibe su −10 y el `CUT` queda excluido, como debía ser.

## 2. Repuesto el interruptor de "ver con/sin bono" en la clasificación

Corrigiendo un malentendido de mi parte: el bono siempre se aplica DE
VERDAD al liquidar la porra (eso no cambia, ver
`DRAFTERS_Cambios_02-10_Bono_Podio_Siempre_Activo.md`) — pero en la
pantalla de clasificación en directo (antes de que termine la porra), Iñi
quiere poder elegir VER la clasificación con o sin el bono restado, como
una simulación. Se ha repuesto el botón ON/OFF "Bono de podio (−10 / −5 /
−3)" junto al botón de información — al pulsarlo, cambia solo lo que se
pinta en pantalla (empieza en ON, que es la regla real); la liquidación
final en `/admin/pagos-pendientes` nunca depende de este interruptor.

## 3. Bono del jugador: ahora en pequeñito al lado del nombre

En el panel de la derecha (jugadores del equipo seleccionado), el aviso
"Bono podio −X" ocupaba su propia línea entera debajo del nombre. Ahora es
solo el número (−10/−5/−3), en pequeñito, justo al lado del nombre del
jugador, en la misma línea — menos texto, menos alto por fila.

## 4. Columna de equipos más ancha para el nombre completo

La columna de la izquierda (lista de equipos, en la pestaña "Porra"/
"Mesa") tenía un ancho fijo de 126px, insuficiente para nombres de equipo
largos (se veían cortados con "..."). El panel de la derecha (jugadores
del equipo abierto) tenía de sobra ese mismo espacio de más entre el
nombre y el resultado. Subido el ancho de la columna izquierda a 180px —
al ser el panel derecho `flex: 1`, se ajusta solo y le cede el espacio que
le sobraba, sin necesidad de tocar nada de su propio diseño. Aplicado
igual en `app/porras/[id]/clasificacion/page.tsx` y
`app/salas/[id]/clasificacion/page.tsx` (Maratón), por consistencia.

## Build

`npx tsc --noEmit` y `npm run build` (28 rutas) sin errores. Sin cambios
de esquema SQL en este envío — el SQL adjunto es el mismo de la vez
anterior.
