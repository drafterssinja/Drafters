# Drafters — Cambios 29/09: liquidación de premios, bono de podio y porra de fútbol

Resumen de la vuelta grande de funcionalidad pedida por Iñi: "diseña lo que haga falta para que esos pagos... queden hechos" (reparto de premios), la regla de desempates, el bono de podio de la clasificación de golf, y la nueva porra de fútbol de Primera División por jornada.

## 1. Liquidación de premios (pagos de verdad)

**Qué significa "acabada" ahora**: no hay un estado intermedio. Una sala o porra pasa a estar `finalizada` en el mismo momento en que el admin confirma su liquidación desde la pantalla nueva **Pagos pendientes** (`/admin/pagos-pendientes`). Antes de eso, aunque el torneo ya haya terminado en la vida real, la sala/porra sigue "abierta" a efectos de la app hasta que el admin decide pagar.

Decisión de Iñi sobre automatizar esto: *"la opción 1 [revisar y confirmar a mano], pero en cuanto nos aseguremos que todo está funcionando bien, lo cambiaremos a automático"*. Por eso `liquidar_evento()` (la función de base de datos que reparte el dinero) ya acepta ser llamada tanto por un admin logueado como por una llamada de `service_role` (el mismo patrón que ya usa el cron de resultados de golf) — el día que se quiera automatizar, basta con montar un cron/ruta que la llame, sin tocar el esquema.

**Flujo**:
1. `/admin/pagos-pendientes` lista todas las salas y porras que todavía no tienen una liquidación (no se filtra por estado, así que también aparece algo marcado "finalizada" a mano con el botón antiguo si nunca se le repartió premio).
2. Al entrar en una (`/admin/pagos-pendientes/[sala|porra]/[id]`), la pantalla propone un reparto:
   - **Porra de golf** (clásica o presupuesto): clasificación automática por la suma de golpes en vivo de cada equipo (los mismos datos de ESPN que ya alimentan la clasificación en directo), con el bono de podio restado si la porra lo tiene activo.
   - **Porra de fútbol**: clasificación automática por aciertos sobre los partidos ya resueltos.
   - **Salas** (fútbol/tenis/golf, cualquier tipo): no hay motor de puntuación real todavía para ellas, así que el admin escribe a mano la posición final de cada equipo.
3. El reparto en euros se calcula con los tramos por inscritos/aforo de siempre (`lib/repartoPremios.ts`), con los empates ya resueltos (ver más abajo).
4. Al pulsar "Confirmar y repartir", se llama a `liquidar_evento()`, que en una sola transacción: acredita el saldo de cada ganador, deja constancia en el historial (`movimientos` tipo `'premio'`, `eventos_actividad` tipo `'premio'`, una notificación `'resultado'` para cada ganador), guarda la posición final de cada equipo y marca la sala/porra como `finalizada`. Queda bloqueada contra un doble pago por la tabla nueva `liquidaciones`.

## 2. Desempates

Regla de Iñi: *"en caso de que dos puestos estén empatados, se repartirán el premio entre todos... el premio de los puestos que les corresponden se reparte entre los empatados"*.

Nueva función `repartirPremiosConEmpates()` en `lib/repartoPremios.ts`: agrupa automáticamente los equipos con el mismo valor (golpes, aciertos o posición manual), suma los % de tramo de TODAS las posiciones que ocupa el grupo (aunque tengan % distinto entre sí, o alguna caiga fuera de premios) y reparte esa suma a partes iguales entre los empatados.

## 3. Bono de podio

Regla de Iñi: *"el primer jugador del torneo va a restar menos 10, el segundo menos 5 y el tercero menos 3"*.

- Nueva función `bonoPodioParaJugador()` en `lib/golfScoring.ts` — a partir de la posición real de ESPN (admite el prefijo "T" de empate).
- Nueva columna `porras.bono_podio_activo` (booleano, por defecto apagado) — se marca al crear/editar la porra en `/admin/porras-golf`, o se puede encender/apagar después con un botón en el listado de porras de esa misma pantalla.
- La pantalla de **clasificación en directo** (`/porras/[id]/clasificacion`) inicia su toggle "Bonos de podio" con el valor real guardado en la porra, pero se puede seguir activando/desactivando ahí mismo como vista previa — igual que pidió Iñi ("poner la posibilidad de ver la clasificación... activando la resta... o no"). Lo que de verdad se aplica al pagar los premios es siempre el valor guardado en la base de datos, nunca lo que un espectador tenga activado en su propia pantalla.

## 4. Porra de fútbol de Primera División (por jornada)

Especificación de Iñi, implementada tal cual:
- Un tercer formato de porra, `futbol_jornada` (`porras.formato`).
- El admin crea la jornada y carga los 10 partidos (equipo local, equipo visitante, escudo opcional de cada uno) desde `/admin/porras-futbol`.
- El usuario pronostica 1/X/2 en los 10 partidos, con la estructura exacta pedida: escudo — nombre del equipo local — botones 1/X/2 — nombre del equipo visitante — escudo.
- Inscripción libre y repetible: 2€ por defecto (configurable), con la comisión del 10% de siempre (1,80€ al bote). Cada apunte es un equipo nuevo, nombrado automáticamente como el nombre de usuario — "Sindeler", "Sindeler II", "Sindeler III"... (sin paréntesis, a propósito distinto de la numeración de Maratón).
- El admin marca a mano el resultado real de cada partido en cuanto se juega (decisión explícita de Iñi: nada de conectar una API de resultados de fútbol en directo esta vuelta).
- La clasificación se calcula por aciertos sobre los partidos ya resueltos (`futbol_porra_clasificacion()`).

**Escudos — aviso importante**: Drafters no incluye ni aloja escudos oficiales con licencia (ver `DRAFTERS_Costes_Business_Plan.md`, que ya dejaba esto para una fase de pago posterior). El admin puede pegar una URL de imagen si quiere mostrar el escudo real; si no lo hace, la app pinta un círculo con las iniciales del equipo en su lugar. Es la única desviación consciente de la petición literal ("pon la foto de su escudo") — todo lo demás está implementado tal cual se pidió.

## Archivos nuevos/cambiados

- `drafters-schema.sql`: tabla `liquidaciones`, columna `porras.bono_podio_activo`, formato `futbol_jornada`, tablas `partidos_porra_futbol`/`predicciones_porra_futbol`, funciones `liquidar_evento()`, `inscribirse_en_porra_futbol()`, `futbol_porra_clasificacion()`, y las columnas `'premio'` añadidas a `movimientos.tipo`/`eventos_actividad.tipo`.
- `lib/repartoPremios.ts`: `repartirPremiosConEmpates()`.
- `lib/golfScoring.ts`: `bonoPodioParaJugador()`.
- `lib/porraFormato.ts`: tercer formato `futbol_jornada`.
- `components/EscudoEquipoFutbol.tsx`: escudo o iniciales, nuevo.
- `app/admin/porras-futbol/` (índice + `[id]`): crear jornada, cargar partidos, marcar resultados.
- `app/admin/pagos-pendientes/` (índice + `[tipo]/[id]`): liquidación.
- `app/admin/porras-golf/page.tsx`: checkbox/toggle de bono de podio.
- `app/porras/[id]/page.tsx`, `app/porras/[id]/crear-equipo/page.tsx`, `app/porras/[id]/clasificacion/page.tsx`, `app/porras/page.tsx`: ramas para el formato de fútbol y el bono de podio real.
- `app/admin/page.tsx`: enlaces a las dos pantallas nuevas.

Verificado: `tsc --noEmit` limpio y `npm run build` completo sin errores (28 rutas generadas).
