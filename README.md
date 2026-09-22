# Drafters — app real (registro, login, historial, panel de admin y mesas reales)

Guía pensada para alguien sin experiencia programando: sigue los pasos en orden,
copiando y pegando donde se indica. No hace falta entender el código.

## 1. Ejecutar el esquema de base de datos

En el panel de Supabase (supabase.com → tu proyecto) ve a **SQL Editor → New query**,
pega el contenido completo de `drafters-schema.sql` (en la carpeta raíz del
proyecto) y pulsa **Run**. Se puede ejecutar más de una vez sin problema — está
pensado para eso.

Esto incluye, entre otras cosas:

- El trigger que hace que **siempre haya al menos 2 mesas abiertas** de cada
  tipo/deporte/competición, y que se creen solas mesas nuevas cuando cierras una.
- La tabla `movimientos` y la función `registrar_movimiento()` que llevan el
  historial de ingresos/retiradas de saldo simulado sin que se pueda
  desincronizar del saldo real de cada usuario.
- `nombre_usuario_disponible()`, que la pantalla de registro usa para avisar
  al momento si un nombre de usuario ya está en uso. **Si ya tenías el
  esquema anterior instalado, vuelve a pegar y ejecutar el archivo entero —
  es seguro, no borra nada — para que esta función se añada.**

## 2. Configurar el email de verificación por código

Por defecto Supabase manda un ENLACE para confirmar el email. Para que mande
un CÓDIGO (como pide el flujo de Drafters), hay que cambiar la plantilla:

1. Ve a **Authentication → Email Templates → Confirm signup**.
2. Sustituye el contenido por algo como:

   ```
   <h2>Confirma tu cuenta de Drafters</h2>
   <p>Tu código de verificación es:</p>
   <h1>{{ .Token }}</h1>
   ```
3. Guarda.

Sin este cambio, la app seguirá funcionando, pero el usuario recibirá un
enlace en vez de un código de 6 dígitos.

## 2.5. Activar el botón "Sincronizar próxima jornada" (fútbol) en la web ya desplegada

Este botón vive en el servidor, no en tu navegador, así que además de tenerlo
en tu `.env.local`/`.env` para probarlo en tu ordenador, hace falta añadir
estas dos variables también en Vercel para que funcione en
`drafters-rho.vercel.app`:

1. Ve a tu proyecto en vercel.com → **Settings → Environment Variables**.
2. Añade `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API →
   "service_role") y `FOOTBALL_DATA_API_KEY` (la misma que ya tengas de
   football-data.org).
3. **No marques la casilla de "exponer al navegador"** en ninguna de las
   dos — son secretas, solo las usa el servidor.
4. Vuelve a desplegar (Deployments → "..." → Redeploy) para que se apliquen.

## 3. Instalar y arrancar en local

```
npm install
npm run dev
```

Abre `http://localhost:3000`.

## 4. Convertirte en superadministrador

1. Regístrate tú mismo desde la propia app (con tu email real).
2. Verifica tu email con el código que te llegue.
3. En el SQL Editor de Supabase, ejecuta (ya está también al final de
   `drafters-schema.sql`, comentado):

   ```sql
   update public.perfiles set rol = 'admin' where id = (
     select id from auth.users where email = 'TU_EMAIL_AQUI'
   );
   ```
4. Cierra sesión y vuelve a entrar. En `/cuenta` verás un botón
   "Panel de administración" que lleva a `/admin`.
5. Desde ahí crea al menos 2 mesas de cada tipo (Duelo, Trío, Doble o Nada,
   Triple o Nada) por deporte/competición — a partir de ahí el sistema se
   encarga solo de reponerlas cuando las cierres.

## 5. Desplegar, para que cualquiera pueda entrar desde una URL

**¿Qué es GitHub y por qué hace falta?** GitHub es donde vive el código en
internet (como una carpeta en la nube, pero para código). Vercel — el
servicio que hace que la web sea accesible por cualquiera — funciona
conectado a un repositorio de GitHub: subes el código una vez, lo conectas
con Vercel, y a partir de ahí cada cambio se publica solo.

1. **Crea una cuenta en github.com** (gratis, con tu email o con Google).
2. Crea un repositorio nuevo (puede ser privado) y sube esta carpeta —
   la forma más sencilla es arrastrar los archivos desde la web de GitHub
   ("Add file → Upload files"), sin necesidad de usar la terminal.
   *Importante: el archivo `.env.local` NUNCA se sube — ya está excluido
   automáticamente (ver `.gitignore`), porque contiene claves.*
3. **Crea una cuenta en vercel.com** (puedes entrar directamente con tu
   cuenta de GitHub, es lo más cómodo).
4. En Vercel, pulsa **"Add New Project"** e importa el repositorio que acabas
   de subir a GitHub.
5. En las variables de entorno del proyecto en Vercel, añade estas dos (los
   valores están en tu `.env.local`, o en Supabase → Project Settings → API):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
6. Pulsa **Deploy**. En un par de minutos tendrás una URL pública tipo
   `drafters.vercel.app` — ya accesible para cualquiera, desde cualquier
   dispositivo. Cada vez que subas un cambio a GitHub, Vercel lo actualiza solo.
7. Más adelante, si compras un dominio (drafters.com/.es), se lo añades a
   este mismo proyecto de Vercel desde su panel ("Domains").

## 6. Jugadores reales de fútbol (La Liga, Premier League, Champions League)

Football-data.org da acceso gratuito **para siempre** a estas tres
competiciones (no incluye la Segunda División — esa necesita un plan de pago
desde 49 €/mes). El script `scripts/sync-football-data.mjs` trae los
jugadores y equipos reales de esas competiciones a la tabla `jugadores`.

**Qué SÍ hace:** nombres y equipos reales de los jugadores, actualizables
cuando quieras volviendo a ejecutar el script.
**Qué NO hace (limitación del plan gratuito):** no trae goles/tarjetas/puntos
de cada jornada — eso requiere el añadido de pago "Deep Data" (~29 €/mes) de
football-data.org. Mientras tanto, quién puntúa en cada jornada lo sigues
introduciendo tú a mano desde el panel de admin, como hasta ahora.

Pasos:

1. Consigue una clave gratuita en
   [football-data.org/client/register](https://www.football-data.org/client/register).
2. Copia `.env.example` a un archivo `.env` (aparte de `.env.local`) y rellena:
   - `FOOTBALL_DATA_API_KEY` (la que acabas de conseguir).
   - `NEXT_PUBLIC_SUPABASE_URL` (la misma de siempre).
   - `SUPABASE_SERVICE_ROLE_KEY` — la clave **secreta** de Supabase (Project
     Settings → API → "service_role"). **Nunca la compartas conmigo ni la
     subas a GitHub** — da acceso total a la base de datos sin restricciones.
     Ya está excluida en `.gitignore`.
3. Ejecuta:

   ```
   npm run sync:futbol
   ```

   Tarda unos minutos (el plan gratuito limita a 10 peticiones/minuto). Verás
   en la terminal cuántos jugadores se han sincronizado por competición.
4. Repítelo cuando quieras refrescar plantillas (fichajes, etc.) — no duplica
   jugadores ya sincronizados, los actualiza.

Golf (PGA Tour / DP World Tour) y tenis (ATP / WTA) siguen a mano por ahora,
tal y como decidiste, mientras se valora contratar una API de pago para esos
dos deportes más adelante.

## Qué incluye esta versión

- Todas las pantallas reales (portada, login, recuperar contraseña, registro,
  verificación, mi cuenta, recargar saldo, panel de administración) están
  reconstruidas para que coincidan visualmente con la maqueta de Claude
  Design (`Main.dc.html`) — mismos colores, tipografías, textos y estructura,
  con la cabecera (flecha de volver + "DRAFTERS") igual en todas menos la
  portada.
- Registro (email + contraseña + nombre + apellido + nombre de usuario único
  + fecha de nacimiento + términos). El nombre de usuario es el que verán
  los demás jugadores cuando participes en una sala/MTT. Al escribirlo se
  comprueba al momento si ya está en uso (antes de intentar crear la
  cuenta), y si el email ya tiene una cuenta creada se avisa claramente en
  vez de dejar el formulario sin respuesta.
- Verificación por código, con aviso claro si hay que esperar antes de poder
  reenviarlo. Si intentas iniciar sesión sin haber verificado el email
  todavía, se avisa y se ofrece un enlace directo a la pantalla de
  verificación. Login persistente.
- Página "Mi cuenta": datos editables (nombre, apellido, email, fecha de
  nacimiento, contraseña) que se guardan de verdad en la base de datos,
  saldo simulado (€), historial de partidas jugadas e historial de
  ingresos/retiradas. La recarga de saldo vive ahora en su propia pantalla
  (`/recargar`), igual que en la maqueta.
- Panel de administración (`/admin`, solo visible para `rol = 'admin'`):
  - Estadísticas reales y filtrables por deporte, tipo de sala, buy-in y
    periodo: dinero depositado, dinero retirado, partidas jugadas, dinero
    jugado, rake ganado (10% real del dinero jugado) y usuarios registrados.
  - Mesas en juego ahora mismo, por deporte.
  - Crear mesas (código correlativo automático `F00000001`, `F00000002`...) y
    cerrarlas — al cerrar una, el sistema repone solo mesas del mismo tipo
    hasta que vuelva a haber al menos 2 abiertas.
  - Crear y editar (marcar lesionado) jugadores.
- Sincronización de jugadores reales de fútbol desde football-data.org
  (La Liga, Premier League, Champions League — plan gratuito).

## Novedades de esta versión (automatización de torneos)

- **Botón "Sincronizar próxima jornada"** en `/admin`: trae la próxima
  jornada real de La Liga, Premier League y Champions League desde
  football-data.org, sincroniza los jugadores de los equipos que juegan,
  les pone un precio automático por posición, fija la fecha límite de
  inscripción al inicio del primer partido y abre 2 salas de cada tipo si
  esa jornada no las tenía ya. **Necesita dos variables de entorno nuevas en
  Vercel** (no solo en local) — ver el aviso al final de este documento.
- **Importador de golf y tenis**: no existe ninguna API gratuita (ni forma
  fiable/legal de hacer scraping) de PGA Tour/DP World Tour/ATP/WTA, así que
  en su lugar hay una caja en `/admin` para pegar el listado copiado
  directamente de la web del circuito — se interpreta solo, se puede corregir
  antes de confirmar, y el precio de cada jugador sale de su posición en ese
  listado.
- Cada sala y porra puede tener ya una **fecha límite de inscripción/cambios**
  (se rellena sola con la automatización de fútbol, o a mano en el
  importador de golf/tenis).
- Nueva pantalla **"Crea tu nueva contraseña"** (`/restablecer`), a la que
  llega el usuario tras pulsar el enlace del correo de recuperación — con
  campo de confirmar contraseña, igual que en el registro.

## Qué falta todavía (siguientes pasos)

- Construir las pantallas de navegación real tras iniciar sesión: inicio con
  "elige tu deporte", listado de salas con filtros, detalle de una sala con
  cuenta atrás, y el draft (elegir jugadores dentro de un presupuesto,
  confirmar equipo, clasificación) — de momento el historial de "Mi cuenta"
  no enlaza a "Ver mesa" ni "Clasificación" porque esas pantallas todavía no
  existen, y las salas/jugadores que ya se crean (a mano o con las
  automatizaciones de arriba) no tienen aún dónde verse ni un flujo real
  para unirse a ellas.
- Porras clásicas: mismo flujo que las salas, pendiente de construir.
- Los **tipos de sala** (aforo y buy-in) que usan las dos automatizaciones
  nuevas son de ejemplo, en `lib/tiposDeSala.ts` — en cuanto tengas el
  listado definitivo, se actualiza ese único archivo y ya se propaga a todo.
- Flujo de inscripción de un usuario normal en una mesa (de momento solo el
  admin crea mesas; falta la pantalla para que un usuario normal elija
  jugadores, confirme su equipo y quede descontado el saldo).
- Cierre de mesas y cálculo automático de posición final (de momento el
  campo `puntos_totales`/`posicion_final` existe en la base de datos pero se
  rellenaría a mano hasta que se automatice).
- Eventos de puntuación reales de fútbol (goles, tarjetas...) — requiere el
  añadido de pago de football-data.org o esperar a decidirlo.
- Golf y tenis: seguir a mano, o contratar una API de pago cuando se decida
  (Goalserve, Tennis-API.com, Sportradar...).
