# Capa de info del bono de podio + favoritos de equipo (02/10)

## 1. Por qué Iñi veía el bono sin restar en la porra en marcha

Al probar la porra del Open de Francia en directo, Iñi vio que al equipo
con el jugador 1º/2º del torneo no se le estaba restando nada. La causa:
estaba probando la versión TODAVÍA DESPLEGADA (la de antes del cambio
"Bono de podio siempre activo" de este mismo día — ver
`DRAFTERS_Cambios_02-10_Bono_Podio_Siempre_Activo.md`), que seguía
mirando el valor guardado en `porras.bono_podio_activo` (`false` para esa
porra, por el diseño opt-in anterior). El cálculo en sí
(`calcularBonosPodio()`, lib/golfScoring.ts) nunca tuvo el problema — la
condición que lo bloqueaba estaba en las pantallas que lo llaman. Esto ya
quedó arreglado en ese cambio anterior; aquí no ha hecho falta tocar nada
más de esa parte, solo recordar que hace falta desplegar el código +
correr el SQL para que se note en producción.

## 2. Ajustes de la capa de información del bono (pedido de Iñi)

En `app/porras/[id]/clasificacion/page.tsx`:

- Antes, el texto explicando el desempate del bono se mostraba siempre
  entero y empujaba la clasificación hacia abajo. Ahora es una etiqueta
  compacta "Bono de podio (−10 / −5 / −3)" con un botón "i" al lado — de
  primeras no se ve ningún texto.
- Al pasar el ratón por encima del botón "i" (o pulsarlo, en móvil, donde
  no hay hover) se abre una explicación corta en una capa superpuesta
  (`position: absolute`), así que nunca desplaza nada de lo que hay
  debajo — pedido explícito de Iñi: "no quiero que se me desplace la
  clasificación".
- El texto de la explicación se ha resumido en dos frases: qué hace el
  bono (a quién se le resta y cuánto) + la regla de desempate, en vez del
  párrafo largo de antes.

## 3. Favoritos de equipo (nuevo)

Pedido de Iñi: en la clasificación de las **porras** y del **Maratón**
(el resto de mesas Drafters — Doble o Nada, Triple o Nada, Oro y Plata,
Tridente — no lo llevan), poder marcar cualquier equipo como favorito
(no solo el propio) para seguirlo de cerca.

- **Estrellita** al lado de cada equipo de la lista — pulsarla marca/
  desmarca el favorito sin seleccionar el equipo (el click de la estrella
  no dispara la navegación de la fila).
- **Filtro "solo favoritos"**: un botón con forma de estrella al lado del
  buscador de equipo (en porras) o de la etiqueta "Equipos (N)" (en
  Maratón, que no tenía buscador) — al activarlo, la lista solo muestra
  los equipos marcados.
- Los equipos favoritos se ven siempre remarcados en **amarillo** en la
  lista, tengan o no el foco puesto; el equipo que tienes abierto a la
  derecha sigue remarcándose en **verde** como ya funcionaba (si un
  equipo es ambas cosas a la vez, manda el verde — sigue siendo
  claramente el que estás viendo — y la estrella se ve rellena igual).
- El favorito se guarda de verdad en base de datos (tabla nueva
  `equipos_favoritos`, por usuario, sin límite de equipos) — no es solo
  de esta sesión del navegador: se mantiene en próximas visitas y en
  cualquier dispositivo con el mismo usuario.

### Archivos nuevos
- `lib/favoritosEquipo.ts`: cargar los favoritos de un usuario y marcar/
  desmarcar uno.
- `components/EstrellaFavorito.tsx`: el botón de estrella reutilizado en
  ambas pantallas.

### Archivos modificados
- `app/porras/[id]/clasificacion/page.tsx`: estrella + filtro en la
  pestaña "Porra".
- `app/salas/[id]/clasificacion/page.tsx`: estrella + filtro en la
  pestaña "Mesa", solo cuando `sala.tipo === 'maraton'` — el resto de
  tipos de mesa se quedan exactamente igual que antes.
- `drafters-schema.sql`: tabla `equipos_favoritos` (con RLS: cada usuario
  solo ve/toca sus propios favoritos).

## Build

`npx tsc --noEmit` y `npm run build` (28 rutas) sin errores tras los dos
cambios.
