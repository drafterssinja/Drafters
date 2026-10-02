# Bono de podio: pasa de opción por porra a regla fija (02/10)

## Qué pedía Iñi

Al ver que la pantalla de clasificación de la porra del Open de Francia
decía que el bono de podio (−10/−5/−3 golpes al 1º/2º/3er clasificado real
del torneo) "no estaba activo", Iñi aclaró que había un malentendido: el
bono **siempre** tiene que funcionar, para **todas** las porras de golf,
no solo para esta. No es ni debe ser una opción configurable por porra —
cita textual: *"el bono de esos tres primeros jugadores siempre va a
funcionar... no tiene ni que estar como opción en la configuración de la
porra"*.

Esto reemplaza el diseño anterior (29/09–01/10), en el que `bono_podio_activo`
era un booleano por porra, configurable al crear la porra en
`/admin/porras-golf` y con un botón ON/OFF en su listado, y que en la
clasificación en directo se podía además "previsualizar" con un toggle
independiente del valor real guardado.

## Qué se ha hecho

El bono de podio ahora se aplica siempre, de forma incondicional, a
cualquier porra de golf (`clasica` o `presupuesto`) — tanto en la
clasificación en directo como en la liquidación final de premios. Ya no
existe ningún interruptor, ni al crear la porra ni después:

- **`app/admin/porras-golf/page.tsx`**: quitado el checkbox "Bono de podio"
  del formulario de creación y el botón "Bono podio ON/OFF" del listado de
  porras. Ya no se guarda nada relacionado al crear una porra.
- **`app/porras/[id]/clasificacion/page.tsx`**: quitado el toggle de
  "vista previa" del bono — ahora la clasificación siempre se calcula con
  el bono aplicado, y el aviso de la regla de desempate (grupo de color
  peor clasificado gana el empate) se muestra siempre, no solo con el
  toggle encendido.
- **`app/admin/pagos-pendientes/[tipo]/[id]/page.tsx`** (liquidación real
  de premios): el bono se calcula siempre para cualquier porra de golf, ya
  no depende de ningún valor guardado en la porra.
- **`drafters-schema.sql`**: la columna `porras.bono_podio_activo` se
  elimina (`alter table ... drop column if exists ...`, seguro de volver a
  ejecutar). Al correr este SQL actualizado en producción, la columna
  desaparece — eso no borra ni afecta ninguna otra cosa.
- **`lib/golfScoring.ts`**: comentario actualizado (el cálculo del bono en
  sí, `calcularBonosPodio()`, no cambia — nunca dependió de la columna, la
  usaban solo las pantallas que lo mostraban/aplicaban).

## Efecto inmediato

Al desplegar esto, la porra del Open de Francia (y cualquier otra porra de
golf, pasada o futura) empieza a aplicar el bono de podio tanto en su
clasificación en directo como en su liquidación final — sin que Iñi tenga
que activar nada a mano. No hace falta ningún paso manual en producción
más allá de desplegar el código y correr el SQL actualizado (que solo
retira la columna ya sin uso).

## Build

`npx tsc --noEmit` y `npm run build` (28 rutas) sin errores tras el
cambio.
