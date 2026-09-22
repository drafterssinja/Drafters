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

- Registro (email + contraseña + nombre + fecha de nacimiento + términos).
- Verificación por código. Login persistente.
- Página "Mi cuenta": saldo simulado (€), botón de recarga (saldo simulado,
  sin pasarela de pago real), historial de partidas jugadas e historial de
  ingresos/retiradas.
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

## Qué falta todavía (siguientes pasos)

- Reconstruir las pantallas visuales completas del prototipo (draft con
  presupuesto virtual, campo de fútbol, clasificación en directo animada,
  Porras clásicas) conectadas a esta misma base de datos.
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
