# Cambios 06/10 — Bajas de jugadores en porras/mesas de golf ya creadas

**Requisito de Iñi**: el que ya tiene al jugador que no va a jugar se queda así; si empieza el torneo sin haberlo cambiado, pierde a ese jugador y sus puntos. Nadie nuevo puede fichar a la baja.

## Admin → Porras de golf
Cada porra tiene el botón **Jugadores** (publicada) o **Revisar** (borrador): lista completa con una **×** por jugador.
- **Nadie lo ha fichado**: la × borra la ficha (desaparece de la porra y de las mesas del torneo). Si aún no hay ningún equipo, se recalculan las listas por color.
- **Ya lo tienen equipos**: la × lo marca `baja = true` (nuevo campo en `jugadores`, SQL al final de `drafters-schema.sql`). Los equipos conservan al jugador, no se tocan. Sale tachado con la etiqueta BAJA y un botón **Deshacer baja**.

## Lo que ve el usuario
- Inicio y Mesas: bajo el equipo sale el aviso rojo "X no va a jugar. Haz un cambio." (mismo mecanismo que el aviso de lesión).
- Crear/editar equipo (porra y mesas): las bajas no aparecen en la lista; al editar un equipo que tenía una baja, ese hueco queda libre para elegir otro. Se puede editar hasta el cierre de inscripciones, como siempre.
- Si no cambia nada y empieza el torneo, el jugador baja no aparece en el leaderboard, no recibe resultado en vivo y suma 0. Tampoco bloquea el cierre automático del torneo (solo cuentan los jugadores con resultado).

## IMPORTANTE al desplegar
Ejecutar primero en Supabase el SQL nuevo (`alter table public.jugadores add column if not exists baja boolean not null default false;`) y después desplegar la app: las pantallas leen la columna `baja` y fallarían sin ella.

## Fix 06/10 — quitar jugador elegido al editar equipo (porra clásica)
Aviso de Iñi: al editar un equipo, tocar al jugador ya elegido no lo quitaba. En `app/porras/[id]/crear-equipo/page.tsx` un jugador elegido (titular o comodín) ahora se puede tocar para quitarlo en cualquier momento, esté o no activa su lista o el modo comodín; al quitarlo se deja activa esa lista (o el comodín) para elegir enseguida al sustituto. Antes, un jugador elegido como comodín, o uno elegido mientras estaba activo el modo comodín, quedaba bloqueado.
