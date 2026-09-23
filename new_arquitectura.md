# DRAFTERS — Arquitectura Técnica del Backend

> Documento vivo. Complementa a `DRAFTERS_Costes_Business_Plan.md` (que ya recoge costes de APIs deportivas y desarrollo en las secciones 3 y 4) centrándose en **cómo se construye técnicamente** el backend: qué stack, qué modelo de datos, qué hace Claude y qué tiene que gestionar Iñi directamente.
> Decisión de partida para este documento (confirmada por Iñi): el backend se construye ya con **usuarios y equipos reales y persistentes**, pero manteniendo **el dinero simulado, denominado en euros (€)** (sin pasarela de pago real todavía) — coherente con el "Camino C" ya decidido (validar con usuarios antes de licencia DGOJ).

---

## 1. Objetivo de esta fase técnica

Pasar el prototipo actual (una maqueta interactiva sin memoria: todo se resetea al recargar) a una aplicación real donde:

- Cualquier persona pueda **registrarse de verdad** y su cuenta quede guardada.
- Los **equipos que monte** (en Salas, MTT o Porras clásicas) se guarden de forma permanente, ligados a su usuario.
- **A partir de ahora, todas las mesas y porras que se abran son reales** — creadas de verdad desde el panel de administración (a mano, o con las automatizaciones de la sección 9), nunca simuladas en el frontend como en el prototipo visual.
- Cada usuario pueda consultar su **historial de partidas jugadas** (mesas y porras en las que ha participado, con su resultado final).
- Exista un **superadministrador** (solo Iñi) con acceso a todos los datos de la plataforma y a un panel propio con estadísticas.
- La **clasificación y los resultados** puedan alimentarse, más adelante, de datos deportivos reales en vez de la simulación actual.
- El **saldo siga siendo ficticio y en euros (€)** — sin pasarela de pago real.
- **Todas las pantallas reales tienen que verse exactamente igual que la maqueta visual** (`Main.dc.html`) construida en Claude Design — mismos colores, tipografías, textos y flujos de navegación, sin inventar pantallas ni comportamientos nuevos sin consultarlo antes. Esto incluye explícitamente las **animaciones** (por ejemplo, la de seleccionar un jugador en el draft): deben reproducirse tal cual están en la maqueta, no solo el aspecto estático.

Esto es exactamente la **Fase 1** de la tabla "Resumen por fases" del business plan ("Validación, sin dinero real"), llevada del prototipo visual a una aplicación funcional de verdad.

---

## 2. Quién hace qué

| Tarea | Quién la hace |
|---|---|
| Diseñar el modelo de datos, escribir el backend, la autenticación, el panel de administración y la integración con APIs deportivas | **Claude** (yo escribo todo el código) |
| Crear la cuenta en el proveedor de base de datos/backend (Supabase) y en el hosting (Vercel) | **Iñi** — hecho |
| Comprar el dominio (ej. drafters.com / drafters.es) | **Iñi** |
| Dar de alta y pagar las suscripciones a las APIs deportivas cuando llegue el momento (Fase 2) | **Iñi** — son contratos comerciales a nombre tuyo o de la SL |
| Mantener el servidor corriendo de forma permanente y accesible al público | La infraestructura de **Supabase + Vercel** (no esta sesión de Claude, que es temporal) |
| Ejecutar el script SQL del esquema y el ascenso a superadministrador | **Iñi** — se pega en el SQL Editor de Supabase (se puede volver a ejecutar cuando haya cambios) |

La idea es que tú no necesitas saber programar para nada de esto — solo crear un par de cuentas, pegar el SQL que te doy, y darme las claves de acceso públicas (nunca la secreta).

---

## 3. Stack técnico

| Pieza | Herramienta | Estado |
|---|---|---|
| Base de datos + autenticación + tiempo real | **Supabase** (Postgres gestionado) | ✅ Cuenta creada, proyecto activo (`yaxzhwodliwjnhleoilq`) |
| Frontend (la app que ve el usuario) | Next.js conectado a Supabase | ✅ Desplegado en Vercel (`drafters-rho.vercel.app`) |
| Fidelidad visual con la maqueta | Portada, login, recuperar/nueva contraseña, registro, verificación, mi cuenta, recargar saldo y panel de admin reconstruidos con los mismos colores/tipografías/textos/estructura que `Main.dc.html` | ✅ Hecho para todas las pantallas que ya existen en la app real |
| Panel de superadministrador | Sección `/admin` de la misma app Next.js, protegida por rol | ✅ Funcionando, con estadísticas reales filtrables |
| Automatización de torneos/jornadas | Botón de servidor para fútbol (football-data.org) + importador de "pegar y listo" para golf/tenis, precio automático por jugador, apertura automática de salas | ✅ Hecho (ver sección 9) |
| Consolidación de mesas incompletas al cierre | Función de base de datos programada (`consolidar_salas_incompletas()`) | ✅ Escrita y probada (ver sección 10) |
| **Pantallas reales del área logueada** (inicio, listado de salas con filtros, detalle de sala, grandes torneos/porras, draft completo) | Next.js, mismas pantallas exactas de `Main.dc.html` (ver secciones 11.5 y 11.6) | ✅ Hecho — falta solo la clasificación en directo (sección 12) |
| Hosting del frontend | **Vercel**, conectado a GitHub para actualizarse solo | ✅ Desplegado |
| Verificación de email | Supabase Auth, por código (OTP) | ✅ Funcionando |
| Datos reales de jugadores | football-data.org (plan gratuito: La Liga, Premier League, Champions League) | ✅ Sincronización automática por jornada desde `/admin` |

---

## 4. Modelo de datos

El esquema completo (con comentarios) vive en `drafters-schema.sql`, pensado para pegarse tal cual en el SQL Editor de Supabase. Resumen de las tablas:

| Tabla | Contenido principal |
|---|---|
| `perfiles` | id, nombre, **apellido**, **nombre de usuario único** (se muestra en salas/MTT), fecha de nacimiento, saldo simulado (€), aceptación de términos, **rol** (`usuario` / `admin`) |
| `salas` | id, **código correlativo único** (ver sección 5), nombre, deporte, competición, tipo (Doble o Nada/Triple o Nada/Oro y Plata/Tridente/Maratón — ver sección 9.5), aforo (nulo solo en Maratón), buy-in, **fecha límite de inscripción/cambios**, estado (incluye `finalizada`), `procesada_cierre_en` (marca si ya se le aplicó la consolidación de cierre, ver sección 10) |
| `porras` | id, **código correlativo único**, major, **fecha límite de inscripción/cambios**, estado (incluye `finalizada`), precio fijo |
| `jugadores` | ficha maestra: nombre, deporte, competición/jornada, equipo real, posición, precio (automático, ver sección 9), **grupo de porra por color y marca de español** (golf, automático al importar, ver sección 11), lesionado, origen externo (football-data.org) — **editable solo por el admin** |
| `equipos` | usuario_id, modo (Sala/MTT/Porra), sala_id o porra_id, nombre del equipo (**obligatorio y único dentro de la misma porra** en modo Porra — en Sala/MTT no hace falta, ahí el jugador se identifica con su nombre de usuario), jugadores, alineación, gasto total, **puntos totales y posición final** (para el historial) |
| `inscripciones` | equipo_id, importe descontado del saldo, fecha, **estado** (`activa` / `trasladada` / `reembolsada` — ver sección 10) |
| `notificaciones` | mensajes para el usuario cuando se le traslada de sala o se le reembolsa por el cierre de una mesa incompleta (ver sección 10) |
| `resultados_evento` | jugador_id, competición, evento (gol, birdie, ace...), puntos, fuente (simulado / API real) |
| `movimientos` | historial de ingresos/retiradas de saldo simulado, siempre a través de `registrar_movimiento()` para que nunca se desincronice del saldo |

La contraseña y el email de cada usuario los gestiona Supabase Auth internamente (tabla `auth.users`) — no se duplican en `perfiles`.

### Nombre de usuario y nombre de equipo

- Al registrarse, cada usuario elige un **nombre de usuario** propio (3-20 caracteres, sin espacios), además de nombre y apellido. Es único en toda la plataforma (sin distinguir mayúsculas/minúsculas) y es el nombre que verán el resto de jugadores cuando participe en una sala o un MTT. La propia pantalla de registro comprueba al momento (con la función `nombre_usuario_disponible()`) si el nombre elegido ya está en uso, antes de intentar crear la cuenta.
- En las **porras clásicas**, en cambio, el usuario pone un **nombre de equipo** en su lugar: es obligatorio (no se puede avanzar sin rellenarlo) y no se puede repetir dentro de la misma porra — ambas reglas están ya aplicadas a nivel de base de datos y probadas.
- La pantalla real para elegir jugadores/crear el equipo y unirse a una sala o porra ya existe (sección 11.6) — el botón "Unirse" de `/salas/[id]` y `/porras/[id]` lleva directamente ahí, y estas dos reglas (nombre de usuario/nombre de equipo) ya se aplican de verdad al confirmar la inscripción.

### Conteos públicos de inscritos (RLS + funciones de base de datos, 23/09)

Las políticas de seguridad a nivel de fila (Row Level Security) de `equipos` e `inscripciones` son intencionadamente estrictas: cada usuario solo puede leer el contenido de su propio equipo (qué jugadores ha elegido, cuánto se ha gastado...) — nadie debería poder ver el equipo de un rival antes de que la sala cierre. Pero el listado de salas, el detalle de sala y "grandes torneos" necesitan un dato agregado que sí es público: cuántos inscritos tiene cada sala/porra ahora mismo. Para eso, sin tener que abrir esa RLS a "cualquiera lee cualquier fila", hay tres funciones de base de datos (`security definer`, mismo mecanismo ya usado por `consolidar_salas_incompletas()`):

- `inscritos_por_sala()` / `inscritos_por_porra()`: nº de inscritos de cada sala/porra (contando siempre por `inscripciones.estado <> 'reembolsada'`, la misma convención de la sección 10).
- `participantes_sala(id)`: el nombre de cada persona inscrita en una sala concreta (para la pestaña "Jugadores" del detalle) — nunca expone qué equipo ha elegido cada una.

---

## 5. Código correlativo de mesa

A partir de ahora, cada sala y cada porra que se crea recibe automáticamente un **código único correlativo**, para poder llevar un registro/historial fiable aunque se abran millones de mesas con el tiempo:

- Formato: **`F` + 8 dígitos** — `F00000001`, `F00000002`, `F00000003`...
- La `F` indica que la mesa se juega con **saldo simulado** (Fase 1). El día que se lance dinero real (Fase 3), se puede introducir un prefijo distinto (p. ej. `R`) sin tocar el histórico ya generado.
- Los 8 dígitos dan capacidad para **99.999.999 mesas** (salas + porras juntas, en una única numeración compartida) antes de necesitar ampliarlo.
- Se genera solo, en la base de datos, en el momento de crear la mesa.

### Disponibilidad de mesas por tipo y regeneración automática

Para cada combinación de deporte + tipo de sala debe existir siempre **más de una mesa abierta a la vez** (mínimo 2). En cuanto una mesa se cierra (`estado = 'finalizada'`), un disparador en Supabase crea automáticamente una mesa nueva y vacía del mismo tipo/deporte/competición — **ya implementado y probado** (ya está en `drafters-schema.sql` y conectado al botón "Cerrar" del panel de admin). Lo mismo ocurre, de entrada, al abrir un torneo/jornada nuevo con las automatizaciones de la sección 9.

---

## 6. Superadministrador

Necesidad planteada: acceso total a los datos de la plataforma, capacidad de editar jugadores en todas las jornadas/competiciones, y visibilidad de estadísticas globales — visible únicamente para Iñi.

### Cómo funciona

| Elemento | Definición |
|---|---|
| Dónde vive el permiso | Un campo `rol` en la tabla `perfiles`, con valor `usuario` (por defecto, todo el mundo) o `admin` |
| Cómo se concede | Iñi se registra primero como un usuario normal (con su email); después, **una sola vez**, ejecuta una línea de SQL en el panel de Supabase que marca su propia cuenta como `admin` |
| Dónde se ve el panel | Una sección `/admin` dentro de la misma aplicación web — solo el usuario con `rol = 'admin'` puede entrar; cualquier otra persona que intente esa URL es redirigida fuera |
| Protección real (no solo visual) | Las políticas de la base de datos (Row Level Security) bloquean a nivel de base de datos cualquier lectura o escritura fuera de lo tuyo salvo que `rol = 'admin'` — **verificado con pruebas**. La automatización de fútbol (sección 9) corre en el servidor con una clave que da acceso total, así que esa ruta comprueba ella misma el rol antes de tocar nada |
| Qué puede hacer el admin | Ver y editar todos los perfiles, crear/editar/cerrar salas y porras (a mano o automáticamente), crear/editar/borrar fichas de jugadores en cualquier competición o jornada, y ver todas las inscripciones de todos los usuarios |

### Panel de estadísticas del admin (ya implementado y desplegado)

El panel `/admin` incluye, filtrable por deporte, tipo de sala, buy-in y periodo (todo el tiempo / 7 días / mes / año):

- Dinero depositado y dinero retirado de la plataforma.
- Partidas jugadas.
- Dinero jugado (volumen total apostado).
- Rake ganado por la plataforma — 10% real del dinero jugado, con los mismos filtros.
- Número de usuarios registrados.
- Mesas en juego ahora mismo, desglosado por deporte (fútbol / golf / tenis).
- Gestión de mesas (crear y cerrar, con reposición automática) y de jugadores (crear, editar, marcar lesionado).
- **Automatización de torneos/jornadas** (sección 9): botón de fútbol e importador de golf/tenis.

Las estadísticas financieras **excluyen las inscripciones con `estado = 'reembolsada'`** (dinero devuelto íntegro por el cierre de una mesa incompleta, ver sección 10) — no cuentan como partida jugada ni como facturación real.

Visualmente, el panel usa las mismas tarjetas, filtros en forma de píldora y listas que la maqueta visual, en vez de tablas y desplegables genéricos.

---

## 7. Historial de partidas del usuario (ya implementado y desplegado)

Cada usuario puede consultar, dentro de "Mi cuenta", el listado de mesas y porras en las que ha participado, con nombre/código, fecha e importe pagado, y resultado final una vez la mesa se marca como `finalizada` (puntos totales y posición final). También hay un historial de ingresos y retiradas de saldo, alimentado siempre por `registrar_movimiento()`.

Mientras una mesa sigue abierta, el resultado se muestra como "en curso"; el cierre y el cálculo del resultado final los hace, por ahora, el admin manualmente (o un proceso automático más adelante, cuando se conecte una API deportiva real en Fase 2).

Nota: en la maqueta visual, cada partida del historial tiene botones "Ver mesa" y "Clasificación" — ya enlazan al detalle real de sala/porra (sección 11.5); la clasificación en directo en sí sigue pendiente (sección 12).

---

## 8. Autenticación y registro

1. Registro con email + contraseña + **nombre + apellido + nombre de usuario único** (comprobado al momento, antes de crear la cuenta) + fecha de nacimiento + aceptación de términos, con confirmación de contraseña.
2. Si el email introducido ya tiene una cuenta confirmada, se avisa claramente en el propio formulario en vez de dejarlo sin respuesta. Si el email ya existe pero todavía no se había verificado, se reenvía el código igual que en un alta nueva.
3. Verificación por código enviado al email (sin subida de DNI todavía — eso se deja para Fase 3, cuando haya dinero real y haga falta KYC). La pantalla avisa con claridad si hay que esperar antes de poder pedir un código nuevo.
4. Si alguien intenta iniciar sesión sin haber verificado el email todavía, se le avisa explícitamente y se le ofrece un enlace directo a la pantalla de verificación, en vez de quedarse sin ninguna indicación.
5. Recuperación de contraseña: `/recuperar` envía el correo de restablecimiento de Supabase, que lleva a `/restablecer` para escribir la contraseña nueva (con confirmación, igual que en el registro) — **hecho**.
6. Login persistente: la sesión se mantiene entre visitas, y los equipos y el saldo simulado quedan ligados a esa cuenta para siempre. Tras iniciar sesión, registrarse o restablecer la contraseña, la app lleva directamente a `/inicio` (sección 11.5) — antes llevaba a "Mi cuenta".

---

## 9. Automatización de torneos/jornadas y conexión con APIs deportivas

Objetivo: que Iñi no tenga que dar de alta cada jugador a mano, y que cada uno tenga un precio "equitativo según su nivel" sin ponerlo uno a uno.

- **Fútbol (100% automático):** botón "Sincronizar próxima jornada" en `/admin`. Corre en el servidor (usa la clave secreta de Supabase y la de football-data.org, que nunca llegan al navegador): busca la próxima jornada de La Liga, Premier League y Champions League, sincroniza los jugadores de los equipos que juegan esa jornada, fija la fecha límite de inscripción al inicio del primer partido, y abre las salas de todas las variantes (sección 9.5) si esa jornada no las tenía ya. El plan gratuito no da estadísticas ni valor de mercado, así que el precio de cada jugador sale de su posición (portero/defensa/centrocampista/delantero) — ajustable a mano en cualquier momento. El día que se contrate el añadido "Deep Data" (~29 €/mes) o cualquier fuente con estadísticas reales, se puede sustituir ese precio por uno calculado con la misma fórmula que golf/tenis (ver abajo) sin rediseñar nada.
- **Golf y tenis (decisión de Iñi, 22/09):** no existe ninguna API gratuita de PGA Tour/DP World Tour/ATP/WTA, y hacer scraping automático de esas webs no es fiable (cambian de estructura sin avisar) ni seguro legalmente (términos de uso de webs comerciales) — así que, en vez de automatizarlo del todo, hay un **importador de "pegar y listo"** en `/admin`: Iñi pega el listado de inscritos o el ranking copiado directamente de la web del circuito (una línea por jugador), la app lo interpreta solo (nombre + posición en la lista), se puede corregir antes de confirmar, y al confirmar se crean los jugadores con precio automático y se abren las salas igual que en fútbol. El día que se decida contratar una de las APIs de pago (Goalserve ~150-200 €/mes por deporte, Tennis-API.com 10-39 $/mes, Sportradar desde ~1.250 $/mes), se puede sustituir la fuente sin cambiar el resto del sistema.
- **Precio automático por jugador:** `lib/pricing.ts` — curva exponencial según la posición en el ranking/listado (el nº1 cuesta bastante más que el resto, como el nivel real del deporte profesional), o precio de partida por posición para fútbol mientras no haya ranking real disponible.
- La tabla `resultados_evento` ya distingue entre eventos `simulado` y `real`, y `jugadores` ya tiene las columnas (`fuente_externa`, `fuente_externa_id`) para sincronizarse automáticamente desde una API sin duplicar.

---

## 9.5. Tipos de sala definitivos (23/09, tabla de Iñi — ya implementado)

Sustituyen a los 4 tipos provisionales que había hasta ahora. Cada uno tiene un aforo (o varios) y un reparto del bote ya fijados por Iñi — implementado en `lib/repartoPremios.ts` (reparto) y `lib/tiposDeSala.ts` (aforos, buy-in provisional y generación automática de salas, usado tanto por el botón de fútbol como por el importador de golf/tenis):

| Tipo | Aforo(s) | Premiados | Reparto del bote |
|---|---|---|---|
| Doble o Nada | 2, 4, 6, 8 o 10 | La mitad | A partes iguales: cada ganador dobla su entrada (x2) |
| Triple o Nada | 3, 6 o 9 | Un tercio | A partes iguales: cada ganador triplica su entrada (x3) |
| Oro y Plata | 5 | 2 | 1º 70% · 2º 30% |
| Tridente | 10 | 3 | 1º 60% · 2º 25% · 3º 15% |
| Maratón | Sin límite | ~15% de los inscritos | Por tramos según nº de inscritos (tabla propia, ver abajo) |

### Escalones de importe (corrección de Iñi, 23/09)

Cada aforo de cada tipo de aforo fijo (Doble o Nada, Triple o Nada, Oro y Plata, Tridente) se abre, además, en **todos los escalones de importe de entrada a la vez** — no hay un único buy-in por variante. Al abrir un torneo/jornada se crean **2 salas por cada combinación (tipo, aforo, importe)**:

- Escalones de importe — **Fase 1 (dinero simulado)**, definitivos: **5€, 10€, 20€, 30€, 50€, 75€ y 100€** (`ESCALONES_BUY_IN` en `lib/tiposDeSala.ts`).
- Total: (5 aforos de Doble o Nada + 3 de Triple o Nada + 1 de Oro y Plata + 1 de Tridente) × 7 importes × 2 salas = **140 salas** de aforo fijo, más **1 sola sala Maratón** (sin escalones, sin aforo fijo) = **141 salas por torneo/jornada**. Probado con datos de ejemplo.
- Iñi solo dio ejemplos explícitos de esto para Doble o Nada y Triple o Nada — se aplicó el mismo criterio a Oro y Plata y Tridente por consistencia (mismo principio de "elige tu importe"). Si esos dos deben quedarse con un único importe, hay que decirlo para revertirlo.
- **⚠️ Pendiente para la Fase 3 (dinero real):** Iñi pidió explícitamente que, cuando se construya la versión con dinero real, se añadan también los escalones **1€, 2€, 200€ y 500€**. Queda anotado como recordatorio en el propio código (`lib/tiposDeSala.ts`) para no olvidarlo en ese momento — no aplica mientras el saldo siga siendo simulado.

**Maratón es distinto al resto**: no tiene aforo fijo (inscripción abierta sin límite) ni escalones de importe (es un único bote acumulado, no varias mesas en paralelo), y, como ya se apuntó, va en el apartado aparte de "grandes torneos" de la app, no mezclado con las demás salas (ver sección 11.5). Por eso no sigue la convención de "2 por variante": se crea 1 sola sala Maratón por torneo/jornada (igual que una porra clásica), y su columna `aforo` en la base de datos es nula (se cambió a permitir null solo para este caso). El disparador que mantiene siempre ≥2 mesas abiertas de cada tipo ahora ignora explícitamente el Maratón (no tendría sentido clonarlo al cerrarse), y la consolidación de salas incompletas (sección 10) también lo excluye explícitamente.

Su reparto sigue la tabla de tramos que dio Iñi (2-6 inscritos → 1 premiado con el 100%, hasta 181-250 → 30 premiados con la tabla exacta que mandó).

**Más de 250 inscritos (corrección de Iñi, 23/09): ya no es una aproximación, es una fórmula cerrada.** Iñi ha tenido porras de hasta 600 participantes y pidió un reparto "bien, bien definido" — con escalones claros al menos hasta 1.000 y un criterio equitativo y determinista más allá, no una estimación. `lib/repartoPremios.ts` calcula ahora, para CUALQUIER número de inscritos por encima de 250, un resultado exacto y reproducible (nunca "a ojo"), calibrado para continuar sin ningún salto justo en el punto 250→251 y para mantener la misma "forma" de reparto que Iñi ya validó en su tabla (1º más grande, luego cae; del 2º al 9º guardan siempre la misma proporción sobre el 1º; el resto se reparte en dos bloques de puestos consecutivos, igual que "10º-18º 1,6% c/u" en su propia tabla). El número de premiados sube poco a poco desde el 12% (el mismo % con el que acaba su tabla fija en 250) hasta acercarse al 15% que pidió para campos grandes, sin superarlo. Comprobado con pruebas que la suma siempre da 100,000% del bote (margen de error por debajo de 0,0001 puntos, es decir, un margen de menos de un céntimo incluso en un bote de varios miles de euros).

Ejemplos calculados por la fórmula, para que Iñi los revise de un vistazo:

| Inscritos | Premiados | Reparto |
|---|---|---|
| 300 | 38 | 1º 20,6% · 2º 13,2% · 3º 9,8% · 4º 7,6% · 5º 6,1% · 6º 4,9% · 7º 3,9% · 8º 3,2% · 9º 2,6% · 10º-21º 1,3% c/u · 22º-38º 0,74% c/u |
| 500 | 68 | 1º 19,4% · 2º 12,4% · 3º 9,2% · 4º 7,2% · 5º 5,7% · 6º 4,6% · 7º 3,7% · 8º 3% · 9º 2,5% · 10º-34º 0,71% c/u · 35º-68º 0,43% c/u |
| 600 | 82 | 1º 19% · 2º 12,2% · 3º 9% · 4º 7% · 5º 5,6% · 6º 4,5% · 7º 3,6% · 8º 3% · 9º 2,4% · 10º-40º 0,60% c/u · 41º-82º 0,36% c/u |
| 1.000 | 143 | 1º 17,9% · 2º 11,4% · 3º 8,5% · 4º 6,6% · 5º 5,2% · 6º 4,2% · 7º 3,4% · 8º 2,8% · 9º 2,3% · 10º-67º 0,36% c/u · 68º-143º 0,22% c/u |
| 1.500 | 217 | 1º 17% · 2º 10,9% · 3º 8,1% · 4º 6,3% · 5º 5% · 6º 4% · 7º 3,2% · 8º 2,7% · 9º 2,2% · 10º-98º 0,25% c/u · 99º-217º 0,15% c/u |
| 2.000 | 293 | 1º 16,4% · 2º 10,5% · 3º 7,8% · 4º 6,1% · 5º 4,8% · 6º 3,9% · 7º 3,1% · 8º 2,6% · 9º 2,1% · 10º-131º 0,19% c/u · 132º-293º 0,12% c/u |

Si alguno de estos números no encaja con lo que Iñi tenía en mente, dímelo y ajusto la fórmula — pero a diferencia de la versión anterior, ahora es una regla fija y con lógica clara detrás, no una estimación.

Pendiente para cuando exista la liquidación real (sección 12): el "premio mínimo ≥1,5x la entrada" que pidió Iñi para este tramo se comprueba sobre el importe en euros ya calculado (bote × este %), no sobre el propio %, así que se aplicará en ese momento.

**Confirmado por Iñi (23/09): las porras clásicas usan exactamente ese mismo reparto por tramos** (la misma tabla, los mismos porcentajes según el número final de inscritos) — de ahí que la función se llame ahora `calcularTramosPorInscritos()` en el código, pensada para los dos casos (Maratón y porra clásica), con `calcularTramosMaraton`/`calcularTramosPorra` como alias del mismo cálculo. **El detalle real de cada porra clásica (sección 11.5) ya tiene su propia pestaña "Premios"**, con el bote total y el reparto por tramos recalculados en directo según los inscritos que tenga en cada momento (pedido de Iñi, 22/09: "que se vaya actualizando en base a los inscritos que hay") — el mismo patrón que ya tenía la pestaña de Premios del detalle de sala normal.

**Importante — lo que esto todavía NO hace**: esto solo describe cómo *debería* repartirse el bote al cerrar una sala o liquidar una porra. Todavía no existe la función que liquide de verdad (calcular puntos, ordenar la clasificación y pagar según estos tramos) — es parte de la clasificación real (sección 12), que sigue pendiente de construir. Tampoco está implementada todavía la regla de empates que diste ("los empatados juntan los premios de las posiciones que ocupan y se los reparten a partes iguales") — queda documentada aquí para cuando se construya esa liquidación.

Migración: las salas que ya existieran con los tipos provisionales antiguos (`duelo`, `trio`) se convierten automáticamente a `doble_o_nada`/`triple_o_nada` la primera vez que se vuelva a ejecutar `drafters-schema.sql` — no hace falta hacer nada a mano, y no se pierde ni se duplica ninguna sala (probado).

---

## 10. Consolidación de mesas incompletas al cierre (nuevo, dictado por Iñi el 22/09 — ya escrito y probado)

Regla de negocio, tal como la dictó Iñi: cuando el contador de inscripción de una sala llega a cero (`fecha_limite_inscripcion` se cumple) y la sala se queda **incompleta**, solo pasa algo si existe **al menos otra sala del mismo deporte + competición + tipo (exactamente igual)** que también esté incompleta en ese momento. En ese caso:

- La sala con **más jugadores inscritos** de ese grupo se convierte en la sala "destino" y se completa con jugadores de la(s) otra(s) sala(s) incompleta(s) del grupo, dando prioridad a quien se inscribió antes.
- A los jugadores que se trasladan les aparece un **mensaje en verde** confirmando que se les ha trasladado y que siguen inscritos con normalidad.
- A los jugadores para los que ya no queda sitio se les **reembolsa el importe íntegro** (incluida la comisión de la casa), con un mensaje de disculpa.
- Si una sala se queda incompleta y **no hay ninguna otra sala idéntica también incompleta**, no se toca — sigue como estaba (no se fuerza el cierre ni se reembolsa a nadie solo por quedarse sola).

Implementado en la función `consolidar_salas_incompletas()` (Postgres/PL-pgSQL, en `drafters-schema.sql`), pensada para ejecutarse periódicamente (`pg_cron`, cada 5 minutos — activación manual pendiente por Iñi desde Supabase → Database → Extensions, instrucciones en el propio archivo). **Probada con un escenario sintético idéntico al ejemplo de Iñi** (Jornada 8 de La Liga, Doble o Nada, una sala con 3/4 y otra con 2/4): el resultado fue el esperado — la sala con 3 se completa a 4/4, el jugador que se apuntó antes en la sala de 2 se traslada (aviso verde), y el que se apuntó después recibe el reembolso íntegro más una notificación de disculpa.

Dos decisiones de diseño que tomé por mi cuenta al llevar la regla a código, y que conviene que confirmes:

1. **Generalicé el ejemplo (2 salas) a cualquier número de salas incompletas del mismo grupo**: si hubiera 3 o más salas incompletas idénticas a la vez, se sigue el mismo criterio (la más llena absorbe a los demás por orden de inscripción, y el resto se reembolsa) en vez de limitarlo estrictamente a parejas de salas.
2. **Una sala que se queda sola e incompleta** (sin ninguna otra sala idéntica también incompleta en ese momento) **no se toca**: sigue abierta con sus inscritos tal cual, no se reembolsa a nadie ni se fuerza su cierre — porque solo describiste qué pasa cuando hay dos o más incompletas a la vez.

Falta todavía, y no está construido: el aviso de consentimiento en el momento de unirse a una sala ("al apuntarte aquí, aceptas que se te pueda trasladar a otra sala idéntica si la tuya no se llena a tiempo") — el flujo de "unirse a una sala" (elegir equipo + pagar) en sí ya está construido (sección 11.6).

---

## 11. Salas maratón, grandes torneos y porras clásicas (22/09, ya implementado para golf)

- **"Salas maratón"** no van agrupadas con el resto de salas normales: van en el apartado separado de **grandes torneos** — ya construido, ver sección 11.5.
- **Porras clásicas de golf — reparto automático por listas de color (ya implementado en el importador de `/admin`):** al importar un torneo de golf (el mismo apartado de "pegar y listo" de la sección 9), además de crear los jugadores y las salas, ahora también se crea la **porra clásica** de ese torneo, y cada jugador se reparte automáticamente en su lista:
  - El admin marca con una casilla **"Es un major"** si el torneo es el Masters de Augusta, el Open Championship, el US Open o el PGA Championship.
  - En la vista previa de jugadores, cada fila tiene una casilla **"ES"** para marcar a los jugadores españoles a mano (la web del circuito no siempre da la nacionalidad de forma fiable).
  - Reglas de reparto (según el puesto en el listado/ranking pegado, sin recalcular al sacar a los españoles):
    - **Majors:** amarillo (1-15), verde (16-35), azul (36 en adelante).
    - **Resto de torneos:** amarillo (1-15), verde (16-35), azul (36-70), morado (71 en adelante).
    - **En cualquier torneo** (major o no) donde haya **3 o más jugadores marcados como españoles**, esos jugadores se sacan de su tramo por ranking y van todos juntos a una lista aparte ("españoles"). Con menos de 3, no hay lista de españoles y cada uno se queda en su tramo normal.
  - Implementado en `lib/porraGrupos.ts` (`calcularGrupoPorra()`, probado con casos de major/no-major/con y sin umbral de españoles) y aplicado en `confirmarImportacionTorneo()` del panel de admin, que guarda el resultado en `jugadores.grupo_porra` y `jugadores.es_espanol`. **Estos grupos ya se ven de verdad** en la pestaña "Grupos" del detalle de cada porra (sección 11.5) y son los que se usan para elegir equipo (sección 11.6).
  - Solo aplica a golf por ahora (tenis no lo pidió Iñi); si se necesita para tenis más adelante, se generaliza fácilmente.
- **Porras clásicas — resto de deportes:** para fútbol (y cualquier futuro deporte con porra clásica) sigue haciendo falta el mismo tipo de apartado de subida de jugadores/grupos, con sus propias reglas — pendiente de que Iñi las defina cuando toque.
- **Fidelidad de las pantallas de selección de jugadores:** el draft (sección 11.6) se ve y se anima exactamente igual que en la maqueta de Claude Design, incluida la animación al seleccionar un jugador, no solo el diseño estático.

## 11.5. Pantallas reales: inicio, listado de salas y detalle de sala (23/09, ya implementado)

Siguiendo la misma maqueta visual (`Main.dc.html`) pantalla a pantalla, ya están construidas y conectadas a datos reales de Supabase (RLS incluida — ver el recuadro de "Conteos públicos" en la sección 4):

- **`/inicio`** (pantalla `isHome` de la maqueta): bienvenida, mis equipos en juego (con aviso de jugador lesionado y acceso a "clasificación en directo" cuando la sala está completa), selector de deporte con el nº real de salas abiertas de cada uno, acceso a "Grandes torneos" y las salas que cierran antes, todo con datos reales.
- **`/salas`** (pantalla `isSalas`): listado filtrable por deporte, tipo de sala, tramo de buy-in y plazas libres/casi llenas, con cabecera ordenable (nombre/tipo/jugadores/buy-in) — adaptado a los 4 tipos y a los 7 escalones de importe definitivos (sección 9.5) en vez de los filtros provisionales (Duelo/Trío) de la maqueta original. Solo muestra los 4 tipos de aforo fijo — Maratón vive aparte.
- **`/salas/[id]`** (pantalla `isSalaDetalle`): las 4 pestañas de la maqueta —
  - **Mi equipo**: campo de fútbol con las líneas DEL/MED/DEF/POR (según la alineación elegida) para fútbol, lista plana para golf/tenis — solo visible si ya tienes equipo en esa sala.
  - **Información**: buy-in, tipo, formato, competición, inscritos, resumen del reparto.
  - **Premios**: bote total (buy-in × inscritos reales) y el reparto exacto por tramos, calculado en directo con `lib/repartoPremios.ts`.
  - **Jugadores**: quién está inscrito (nombre, sin su equipo — ver `participantes_sala()` en la sección 4).
  - Botón de "Unirse" sticky abajo (deshabilitado si la sala está completa, oculto si ya tienes equipo o si ha finalizado) — lleva directamente al draft real (sección 11.6).
- **`/mesas`** (adaptación de `isMesas`): concentra "grandes torneos" en dos pestañas — **Maratón** (con los mismos pills de deporte de la maqueta original) y **Porras clásicas** — tal y como pidió Iñi el 22/09 ("las salas maratón no van a estar con el resto de salas... van a estar en el apartado especial... los grandes torneos... y otra cosa, para las porras clásicas también lo mismo").
- **`/porras/[id]`**: no existía en la maqueta visual (solo había pantalla de detalle para salas normales), así que se ha construido reutilizando la misma estructura de pestañas — Información, **Premios** (bote y reparto por tramos recalculados en directo según los inscritos, pedido de Iñi el 22/09) y **Grupos** (las listas de color de la sección 11, en modo solo lectura).
- El wordmark "DRAFTERS" de la cabecera, dentro del área logueada, ahora lleva a `/inicio` (antes llevaba siempre a la portada pública).

Lo que falta a propósito, y sigue sin pantalla real: la clasificación en directo (`/salas/[id]/clasificacion`) — es el contenido pendiente de la sección 12. El draft en sí (elegir equipo jugador a jugador y confirmar la inscripción) ya está construido — ver sección 11.6.

## 11.6. Draft real: elegir equipo, confirmar y RPCs atómicas (23/09, ya implementado)

El botón "Unirse" de `/salas/[id]` y "Elegir equipo" de `/porras/[id]` llevan ahora a la pantalla real donde el jugador elige a sus jugadores uno a uno y confirma su inscripción con descuento real de saldo — la pieza pendiente más importante del proyecto hasta ahora (pedido explícito de Iñi el 23/09: "falta lo que has dicho tú, que en cada porra elegir al jugador... y lo mismo que tenemos en el otro lado, con el tope máximo de 100.000 euros... se va restando su cantidad... lo mismo que teníamos ahí").

Cada flujo es una única pantalla con dos pasos internos (elegir → confirmar), para no tener que guardar la selección en curso al cambiar de URL — igual que el resto de la app, calcada de `Main.dc.html` (líneas 883-1174 para salas, 1462-1550 para porras), con la misma barra de presupuesto animada, el mismo panel lateral "Tu equipo" con la animación `slotPop` al rellenar un hueco, y el mismo campo de fútbol interactivo.

- **`/salas/[id]/crear-equipo`** — presupuesto de fantasía de **100.000 €** (`EQUIPO_PRESUPUESTO` en `lib/draftConfig.ts`, mismo valor en el cliente y en el servidor): según se van eligiendo jugadores, la barra de arriba muestra cuánto queda, cambia de color (verde → ámbar por debajo del 15% → rojo si se supera) y la barra de progreso se rellena — exactamente como en la maqueta. Dos variantes, igual que la maqueta:
  - **Golf/tenis**: lista plana de jugadores + panel lateral de 5 huecos (`TAMANO_EQUIPO_GOLF_TENIS` — confirmado por Iñi el 23/09 que 5 jugadores está bien).
  - **Fútbol**: selector de alineación (4-3-3 / 4-4-2 / 3-5-2 / 4-2-3-1) + campo interactivo con las 4 líneas (DEL/MED/DEF/POR): cada hueco se llena tocando un jugador de esa posición en la lista, y se puede tocar el propio hueco del campo para quitarlo. Al cambiar de alineación a media selección, se recortan automáticamente los jugadores que ya no quepan en la línea reducida. **Adaptación respecto a la maqueta**: la maqueta filtra la lista por "partidos de la jornada" (dato que no existe en el modelo real, los jugadores no tienen un partido asociado) — aquí la lista se agrupa por posición en su lugar, que es lo que de verdad limita cada hueco.
  - El botón de confirmar queda deshabilitado hasta que el equipo esté completo y dentro de presupuesto; al tocarlo se pasa a la pantalla de confirmación (mismo componente, sin cambiar de URL) con el resumen de jugadores elegidos y el total gastado, y ahí se llama a la función de base de datos `inscribirse_en_sala()`.
- **`/porras/[id]/crear-equipo`** — sin presupuesto (precio de entrada fijo de la porra): nombre de equipo obligatorio, y un hueco por cada grupo de color que tenga esa porra (hasta 5: amarillo/verde/azul/morado/españoles, sección 11) — se toca un hueco del panel lateral para activar su grupo y luego un jugador de la lista (los jugadores de otros grupos aparecen atenuados mientras tanto), con la misma animación `slotPop` al rellenar. **Adaptación respecto a la maqueta**: la maqueta da por hecho un reparto fijo "5+1 reserva" que no corresponde a los grupos reales de esta app — aquí se pide un jugador de cada grupo que la porra tenga de verdad. Al confirmar se llama a `inscribirse_en_porra()`.

### Las dos funciones de base de datos que hacen la inscripción de verdad

Ambas son funciones **`security definer`** en `drafters-schema.sql` (mismo mecanismo que las de conteo público, sección 4) que hacen, en una única transacción atómica, todo lo que antes había que hacer a mano en varios pasos desde el cliente — así nunca puede quedar un equipo a medio crear ni un saldo descontado sin su inscripción:

- **`inscribirse_en_sala(sala, jugadores, alineación, nombre_equipo)`**: comprueba que la sala sigue abierta y no está llena, que el usuario no tiene ya equipo ahí, que todos los jugadores elegidos son de la competición correcta, **recalcula el gasto total del lado del servidor a partir de `jugadores.precio`** (nunca se fía de un total que mande el cliente) y lo compara con el límite de 100.000 €, comprueba que el saldo simulado del usuario cubre el buy-in — y si todo es correcto, crea el equipo, la inscripción y descuenta el saldo, actualizando el estado de la sala a `casi_llena`/`completa` con el mismo criterio que ya usaba el panel de admin.
- **`inscribirse_en_porra(porra, jugadores, nombre_equipo)`**: comprueba que la porra sigue abierta, que el usuario no tiene ya equipo en ella, que el nombre de equipo no está repetido (sin distinguir mayúsculas), que los jugadores son de esa competición y que hay **como mucho uno de cada grupo de color**, y que el saldo cubre el precio fijo de la porra — y si todo es correcto, crea el equipo, la inscripción y descuenta el saldo.

**Probadas exhaustivamente en local**, simulando sesiones reales con RLS activa (no como superusuario, que se salta la RLS y no sirve para probar esto de verdad): sala que se completa correctamente al llenarse (con el mismo criterio `casi_llena`/`completa` del admin), rechazo al intentar unirse a una sala ya completa, rechazo por presupuesto superado (100.000 € exactos como límite), rechazo por jugador de otra competición, equipo dentro de presupuesto creado y saldo descontado correctamente, porra con equipo válido creado y saldo descontado, rechazo por dos jugadores del mismo grupo de color, rechazo por nombre de equipo repetido (sin distinguir mayúsculas), rechazo por segundo equipo del mismo usuario en la misma porra, y segundo usuario distinto creando su propio equipo sin problema. Los 8 escenarios de rechazo/aceptación dieron el resultado esperado.

---

## 12. Lo que esto no resuelve todavía (a propósito)

- **Dinero real:** el saldo sigue siendo simulado. No se conecta ninguna pasarela de pago (Stripe, Bizum, etc.) en esta fase — eso activaría la Ley 13/2011 de juego y la necesidad de licencia DGOJ, que según la decisión ya tomada ("Camino C") se deja para cuando haya inversión asegurada.
- **Fotos y escudos oficiales con licencia:** se mantienen los avatares de iniciales del prototipo hasta que se contrate una API con licencia de imágenes (Fase 2).
- **Verificación de identidad (KYC):** se deja para Fase 3, junto con el dinero real.
- **La clasificación en directo (el hueco más importante ahora mismo):** inicio, listado de salas, detalle de sala, grandes torneos y el draft completo (elegir equipo dentro de presupuesto, confirmar con descuento real de saldo) ya están construidos y conectados a datos reales (secciones 11.5 y 11.6) — con el mismo aspecto exacto de la maqueta. Lo que falta es la pantalla donde se ve la clasificación en directo de una sala/porra ya completa, con la liquidación real (calcular puntos, ordenar posiciones y pagar según el reparto de la sección 9.5). El acceso desde "sala completa · ha empezado" y desde el historial ya existe y apunta a una pantalla de "próximamente" mientras tanto.
- **Porras clásicas:** el flujo completo ya funciona para golf de principio a fin (unirse, elegir equipo por grupo de color, confirmar, sección 11.6) — falta definir el mismo reparto de grupos para el resto de deportes cuando Iñi lo pida.
- **Segunda División de fútbol:** sin datos reales todavía (plan de pago desde 49 €/mes en football-data.org).

---

## 13. Próximos pasos concretos

1. ~~Crear la cuenta de Supabase~~ — hecho.
2. ~~Diseñar y escribir el esquema de base de datos completo~~ — hecho y probado.
3. ~~Iñi ejecuta `drafters-schema.sql` en el SQL Editor de Supabase~~ — hecho (recuerda volver a ejecutarlo: esta versión añade las funciones de conteo público `inscritos_por_sala()`/`inscritos_por_porra()`/`participantes_sala()` de la sección 4, y las de inscripción real `inscribirse_en_sala()`/`inscribirse_en_porra()` de la sección 11.6).
4. ~~Iñi se registra como primer usuario y ejecuta el ascenso a `admin`~~ — hecho.
5. ~~Terminar la app de registro/login/verificación y el panel `/admin`~~ — hecho.
6. ~~Implementar la disponibilidad múltiple de mesas por tipo y su regeneración automática~~ — hecho.
7. ~~Desplegar en Vercel~~ — hecho (`drafters-rho.vercel.app`).
8. ~~Reconstruir visualmente todas las pantallas ya existentes para que coincidan con la maqueta~~ — hecho.
9. ~~Pantalla de "nueva contraseña" tras recuperar la cuenta~~ — hecho.
10. ~~Automatizar la apertura de jornadas de fútbol y el importador de golf/tenis, con precio automático~~ — hecho (falta añadir `SUPABASE_SERVICE_ROLE_KEY` y `FOOTBALL_DATA_API_KEY` en Vercel para que el botón de fútbol funcione en la web ya desplegada — ver README).
11. ~~Diseñar y probar la consolidación automática de salas incompletas al cierre~~ — hecho (pendiente: activar `pg_cron` en Supabase, y confirmar las dos decisiones de diseño de la sección 10).
12. ~~Construir la navegación real tras iniciar sesión — inicio, listado de salas con filtros, salas maratón/grandes torneos aparte, detalle de sala con cuenta atrás~~ — hecho (sección 11.5).
13. ~~Construir el draft real: elegir jugadores dentro de un presupuesto (con la animación de selección igual que la maqueta), confirmar equipo (con descuento real de saldo)~~ — hecho (sección 11.6), incluido el tamaño de equipo de golf/tenis (5 jugadores, confirmado por Iñi el 23/09).
14. ~~Construir el flujo completo de porras clásicas (unirse, elegir equipo jugador a jugador dentro de cada lista de color, confirmar)~~ — hecho para golf (sección 11.6); queda pendiente definir el mismo reparto por grupos para el resto de deportes cuando Iñi lo pida.
15. ~~Recibir de Iñi el listado definitivo de tipos de sala~~ — hecho (sección 9.5). Pendiente: confirmar los buy-in de cada variante (son provisionales) y cerrar el reparto exacto del Maratón para más de 250 inscritos.
16. Golf y tenis: valorar más adelante contratar una API de pago para sustituir el importador manual (sección 9).
17. **Siguiente paso (23/09: lo trabajamos con Iñi en la próxima sesión):** construir la clasificación en directo (`/salas/[id]/clasificacion`) — liquidar de verdad cada mesa/porra al cerrarse (calcular puntos, ordenar posiciones y pagar según el reparto ya definido en la sección 9.5), y enlazarla desde los accesos que ya existen ("sala completa · ha empezado" en el detalle de sala, e historial de "Mi cuenta").

---

> 📌 Este documento se irá actualizando a medida que avancemos en la construcción técnica, igual que el resto de documentos del proyecto.
