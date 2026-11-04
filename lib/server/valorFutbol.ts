import type { crearClienteAdmin } from './supabaseAdmin';
import { pedirApif, temporadaApif, mismoNombre, claveApif } from './apiFootball';
import { emparejarEquipo } from '@/lib/aliasEquipos';
import { normalizarNombre } from '@/lib/nombreMatch';
import { LIGAS_VALOR_FUTBOL, claveJugadorFutbol, VALOR_MAX_SEMANA, VALOR_MAX_SIN_JUGAR, VALOR_TOPE_TOTAL } from '@/lib/valorFutbolClave';

// ============================================================================
// VALOR DRAFTERS DE FÚTBOL + PLANTILLAS AUTOMÁTICAS (03/11, Iñi)
// ============================================================================
// 1. PLANTILLAS (cada noche, 04:05 de Madrid): con API-Football
//    (/players/squads) se repasa quién está en cada equipo de LaLiga y de la
//    Champions:
//      · un jugador que aparece en otro equipo de la misma liga → cambia de
//        equipo (traspaso);
//      · uno que ya no está en ningún equipo → fuera (tras 2 noches seguidas
//        sin aparecer, por si API-Football falla un día);
//      · uno nuevo → entra con un valor estimado (la mediana de su posición en
//        su equipo) y queda marcado para que el admin lo revise.
//    La primera noche solo se "presentan" los jugadores (se guarda su id de
//    API-Football); los que no casan entonces (canteranos, etc.) se ignoran
//    para no meter de golpe a cientos de juveniles.
// 2. VALOR (cada lunes, 04:20): con API-Football (/players por equipo) se
//    guardan los totales de temporada de cada jugador. Comparando con lunes
//    anteriores sale lo que ha hecho en sus últimas ~5 semanas: minutos,
//    nota media del partido, goles y asistencias. Con eso su valor sube o baja
//    como mucho un 5 % (sin jugar: como mucho -2 %) y nunca más de un 30 %
//    respecto al valor cargado.
// Las consultas se hacen poco a poco (unas pocas por minuto) desde el cron,
// con una cola en la base de datos (futbol_valor_cola).

type Admin = ReturnType<typeof crearClienteAdmin>;
type Fila = {
  id: string;
  liga: string;
  clave: string;
  nombre: string;
  equipo_real: string | null;
  posicion: string | null;
  valor_base: number | null;
  valor: number | null;
  apif_id: number | null;
  apif_equipo_id: number | null;
  activo: boolean;
  nuevo: boolean;
  visto_en: string | null;
  ausente_desde: string | null;
};
type Tarea = { id: number; lote: string; tipo: 'plantilla' | 'stats'; liga: string; apif_liga: number; apif_equipo_id: number; apif_equipo: string | null; pagina: number };
type Stats = { minutos: number; partidos: number; rating_suma: number; rating_n: number; goles: number; asistencias: number };

const POS_APIF: Record<string, string> = { Goalkeeper: 'portero', Defender: 'defensa', Midfielder: 'centrocampista', Attacker: 'delantero' };

// ----------------------------------------------------------------------------
// Utilidades
// ----------------------------------------------------------------------------
function madrid(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) % 24, minuto: Number(p.minute), diaSemana: String(p.weekday) };
}
const hoy = () => madrid().fecha;

async function leerEstado(admin: Admin, clave: string): Promise<Record<string, unknown> | null> {
  const { data } = await admin.from('futbol_valor_estado').select('valor').eq('clave', clave).maybeSingle();
  return ((data as { valor: Record<string, unknown> } | null)?.valor as Record<string, unknown>) ?? null;
}
async function guardarEstado(admin: Admin, clave: string, valor: unknown) {
  await admin.from('futbol_valor_estado').upsert({ clave, valor, actualizado_en: new Date().toISOString() }, { onConflict: 'clave' });
}
async function evento(admin: Admin, liga: string, tipo: 'alta' | 'baja' | 'traspaso' | 'valor' | 'aviso', jugador: string | null, detalle: string) {
  await admin.from('futbol_valor_eventos').insert({ liga, tipo, jugador, detalle });
}
async function filasLiga(admin: Admin, liga: string): Promise<Fila[]> {
  const out: Fila[] = [];
  for (let d = 0; ; d += 1000) {
    const { data, error } = await admin.from('futbol_valor').select('*').eq('liga', liga).order('id').range(d, d + 999);
    if (error) throw new Error(`futbol_valor: ${error.message}`);
    const lote = (data as Fila[]) ?? [];
    out.push(...lote);
    if (lote.length < 1000) break;
  }
  return out;
}
function mediana(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
function medianaSimple(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
function unico<T>(xs: T[]): T | null {
  return xs.length === 1 ? xs[0] : null;
}

// ----------------------------------------------------------------------------
// Semilla: la primera vez, futbol_valor se rellena con la plantilla actual
// (lo que hay cargado en `jugadores`). Lo llama plantillaDeLaLiga.
// ----------------------------------------------------------------------------
export async function sembrarFutbolValor(
  admin: Admin,
  prefijo: string,
  plantilla: { nombre: string; equipo_real: string | null; posicion: string | null; valor_mercado: number | null }[]
): Promise<number> {
  const { count, error } = await admin.from('futbol_valor').select('id', { count: 'exact', head: true }).eq('liga', prefijo);
  if (error) throw new Error(`futbol_valor: ${error.message}`);
  if ((count ?? 0) > 0 || plantilla.length === 0) return 0;
  const vistas = new Set<string>();
  const filas = [];
  // 04/11: fichas repetidas sin equipo (p. ej. "Kylian Mbappé" con y sin equipo):
  // si el mismo nombre ya tiene una ficha con equipo, la que no tiene se descarta.
  const conEquipo = new Set(plantilla.filter((j) => j.equipo_real).map((j) => normalizarNombre(j.nombre)));
  for (const j of plantilla) {
    if (!j.equipo_real && conEquipo.has(normalizarNombre(j.nombre))) continue;
    const clave = claveJugadorFutbol(j.nombre, j.equipo_real);
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    const v = typeof j.valor_mercado === 'number' && j.valor_mercado > 0 ? j.valor_mercado : null;
    filas.push({ liga: prefijo, clave, nombre: j.nombre, equipo_real: j.equipo_real, posicion: j.posicion, valor_base: v, valor: v, fecha_base: hoy() });
  }
  for (let d = 0; d < filas.length; d += 500) {
    const { error: e } = await admin.from('futbol_valor').upsert(filas.slice(d, d + 500), { onConflict: 'liga,clave', ignoreDuplicates: true });
    if (e) throw new Error(`futbol_valor: ${e.message}`);
  }
  await evento(admin, prefijo, 'aviso', null, `Plantilla de partida guardada (${filas.length} jugadores, con los valores cargados).`);
  return filas.length;
}

// ----------------------------------------------------------------------------
// Encolar trabajos
// ----------------------------------------------------------------------------
export async function encolarValorFutbol(admin: Admin, tipo: 'plantilla' | 'stats'): Promise<{ lote: string; equipos: number }> {
  const temporada = temporadaApif(new Date());
  const lote = `${tipo}:${new Date().toISOString()}`;
  const filas: Omit<Tarea, 'id'>[] = [];
  // 04/11 (bug de Iñi: "No sé qué equipo nuestro es Real Madrid…"): la tabla
  // futbol_valor estaba vacía porque solo se rellenaba al crear una jornada.
  // Ahora se rellena aquí también, antes de repasar nada.
  const { plantillaDeLaLiga } = await import('./crearFutbolAutomatico');
  for (const liga of LIGAS_VALOR_FUTBOL) {
    await plantillaDeLaLiga(admin, liga.prefijo);
    const vistos = new Set<number>();
    const meter = (id: number, nombre: string) => {
      if (!id || vistos.has(id)) return;
      vistos.add(id);
      filas.push({ lote, tipo, liga: liga.prefijo, apif_liga: liga.apif, apif_equipo_id: id, apif_equipo: nombre, pagina: 1 });
    };
    // 04/11: en la Champions, /teams devuelve también los equipos de las previas
    // (Atert Bissen, Drita…). Solo cuentan los de la clasificación (fase de liga).
    const tabla = await pedirApif(`/standings?league=${liga.apif}&season=${temporada}`).catch(() => null);
    const grupos = (tabla?.response?.[0]?.league?.standings ?? []) as { team: { id: number; name: string } }[][];
    for (const g of grupos) for (const r of g) meter(r.team.id, r.team.name);
    if (vistos.size === 0) {
      const json = await pedirApif(`/teams?league=${liga.apif}&season=${temporada}`);
      for (const r of (json?.response ?? []) as { team: { id: number; name: string } }[]) meter(r.team.id, r.team.name);
    }
  }
  if (filas.length > 0) {
    const { error } = await admin.from('futbol_valor_cola').insert(filas);
    if (error) throw new Error(`futbol_valor_cola: ${error.message}`);
  }
  await guardarEstado(admin, `${tipo}_lote`, { lote, inicio: new Date().toISOString(), equipos: filas.length, cerrado: false });
  return { lote, equipos: filas.length };
}

// ----------------------------------------------------------------------------
// Qué equipo nuestro es un equipo de API-Football
// ----------------------------------------------------------------------------
function equipoNuestro(filas: Fila[], apifEquipoId: number, apifNombre: string | null, nombresJugadores: string[]): string | null {
  // 1) Ya casado otras veces (filas con ese id de equipo).
  const porId = new Map<string, number>();
  for (const f of filas) if (f.apif_equipo_id === apifEquipoId && f.equipo_real) porId.set(f.equipo_real, (porId.get(f.equipo_real) ?? 0) + 1);
  if (porId.size > 0) return Array.from(porId.entries()).sort((a, b) => b[1] - a[1])[0][0];
  const candidatos = Array.from(new Set(filas.map((f) => f.equipo_real).filter((e): e is string => !!e)));
  const comunes = (c: string) => {
    const nuestros = filas.filter((f) => f.equipo_real === c);
    return nombresJugadores.filter((nj) => nuestros.some((f) => mismoNombre(nj, f.nombre))).length;
  };
  // 2) Por el nombre del equipo, pero solo si además comparten jugadores (al
  //    menos 3), para no casar dos equipos distintos por un nombre parecido.
  const porNombre = apifNombre ? emparejarEquipo(apifNombre, candidatos) : null;
  if (porNombre && comunes(porNombre) >= 3) return porNombre;
  // 3) Por los jugadores: el equipo nuestro con más nombres en común (al menos 5).
  let mejor: string | null = null;
  let max = 0;
  for (const c of candidatos) {
    const n = comunes(c);
    if (n > max) {
      max = n;
      mejor = c;
    }
  }
  return max >= 5 ? mejor : null;
}

// 04/11: dentro de un MISMO equipo, comparación de nombres más flexible que
// mismoNombre (que exige que todas las palabras de API-Football estén en el
// nuestro): API-Football pone a veces el segundo apellido ("Pau Cubarsí
// Paredes") o solo el apellido. Vale si:
//  · mismoNombre en cualquiera de los dos sentidos, o
//  · coincide el apellido principal (la última palabra de nuestro nombre, o la
//    primera si el nuestro es de una sola palabra) y, si los dos tienen nombre
//    de pila, la inicial.
// Solo se usa dentro del equipo y exigiendo que el candidato sea único.
function palabras(s: string): string[] {
  return normalizarNombre(s).replace(/[.-]/g, ' ').split(' ').filter((t) => t.length > 1);
}
export function nombreParecido(apif: string, nuestro: string): boolean {
  if (mismoNombre(apif, nuestro) || mismoNombre(nuestro, apif)) return true;
  const a = palabras(apif);
  const n = palabras(nuestro);
  if (a.length === 0 || n.length === 0) return false;
  const apellido = n[n.length - 1];
  if (!a.includes(apellido)) return false;
  if (n.length === 1) return true;
  const inicialApif = normalizarNombre(apif).trim()[0];
  return inicialApif === n[0][0] || a.includes(n[0]);
}

function nombreBonito(p: { name?: string | null; firstname?: string | null; lastname?: string | null }): string {
  const name = (p.name ?? '').trim();
  if (name && !/^\p{L}\.\s/u.test(name)) return name;
  const pila = (p.firstname ?? '').trim().split(/\s+/)[0];
  if (name && pila) return `${pila} ${name.replace(/^\p{L}\.\s*/u, '')}`;
  return name || `${p.firstname ?? ''} ${p.lastname ?? ''}`.trim();
}

// ----------------------------------------------------------------------------
// 1. Plantilla de un equipo
// ----------------------------------------------------------------------------
async function procesarPlantilla(admin: Admin, t: Tarea) {
  const json = await pedirApif(`/players/squads?team=${t.apif_equipo_id}`);
  const plantilla = ((json?.response?.[0]?.players ?? []) as { id: number; name: string; position: string }[]).filter((p) => p && p.id);
  if (plantilla.length === 0) throw new Error('Plantilla vacía');
  const filas = await filasLiga(admin, t.liga);
  const equipo = equipoNuestro(filas, t.apif_equipo_id, t.apif_equipo, plantilla.map((p) => p.name));
  if (!equipo) throw new Error(`Equipo sin casar: ${t.apif_equipo}`);
  const ahora = new Date().toISOString();
  const claveIgnorados = `ignorados:${t.liga}:${t.apif_equipo_id}`;
  const ignoradosPrevios = await leerEstado(admin, claveIgnorados);
  const primeraVez = !ignoradosPrevios;
  const ignorados = new Set<number>(((ignoradosPrevios?.ids as number[]) ?? []).map(Number));
  const usados = new Set<string>();
  const cambios: Record<string, unknown>[] = [];
  const altas: { id: number; name: string; position: string }[] = [];

  for (const p of plantilla) {
    const libres = (fs: Fila[]) => fs.filter((f) => !usados.has(f.id));
    let f: Fila | null =
      unico(libres(filas.filter((x) => x.apif_id === p.id))) ??
      unico(libres(filas.filter((x) => !x.apif_id && x.equipo_real === equipo && mismoNombre(p.name, x.nombre)))) ??
      unico(libres(filas.filter((x) => !x.apif_id && x.equipo_real === equipo && nombreParecido(p.name, x.nombre)))) ??
      // Fichas que se cargaron sin equipo: se les pone el suyo (no es un traspaso).
      unico(libres(filas.filter((x) => !x.apif_id && !x.equipo_real && mismoNombre(p.name, x.nombre))));
    // 04/11 (Iñi: "pone a Josep Martínez traspasado al Real Madrid y es del
    // Inter"): ya NO se casan por nombre jugadores de otro equipo (con nombres
    // como "J. Martínez" se confundía). Un cambio de equipo solo se da cuando el
    // MISMO jugador de API-Football (mismo id, ya casado antes con su equipo)
    // aparece en la plantilla de otro equipo.
    if (!f) {
      if (primeraVez) ignorados.add(p.id);
      else if (!ignorados.has(p.id)) altas.push(p);
      continue;
    }
    usados.add(f.id);
    const upd: Record<string, unknown> = { id: f.id, liga: f.liga, clave: f.clave, nombre: f.nombre, apif_id: p.id, apif_equipo_id: t.apif_equipo_id, visto_en: ahora, ausente_desde: null, actualizado_en: ahora };
    if (f.equipo_real !== equipo) {
      upd.equipo_real = equipo;
      if (f.equipo_real) await evento(admin, t.liga, 'traspaso', f.nombre, `${f.equipo_real} → ${equipo}`);
      else await evento(admin, t.liga, 'aviso', f.nombre, `No tenía equipo cargado: se le pone ${equipo}.`);
    }
    if (!f.activo) {
      upd.activo = true;
      await evento(admin, t.liga, 'alta', f.nombre, `Vuelve a la plantilla de ${equipo}.`);
    }
    if (!f.posicion && POS_APIF[p.position]) upd.posicion = POS_APIF[p.position];
    cambios.push(upd);
  }
  for (let d = 0; d < cambios.length; d += 200) {
    const { error } = await admin.from('futbol_valor').upsert(cambios.slice(d, d + 200), { onConflict: 'id' });
    if (error) throw new Error(`futbol_valor: ${error.message}`);
  }
  if (primeraVez) await guardarEstado(admin, claveIgnorados, { ids: Array.from(ignorados) });

  // Altas: jugadores nuevos de verdad (no estaban la primera vez).
  if (altas.length > 0) {
    const temporada = temporadaApif(new Date());
    const delEquipo = filas.filter((x) => x.equipo_real === equipo && x.activo);
    for (const p of altas.slice(0, 8)) {
      let nombre = p.name;
      try {
        const info = await pedirApif(`/players?id=${p.id}&season=${temporada}`);
        const pl = info?.response?.[0]?.player;
        if (pl) nombre = nombreBonito(pl);
      } catch {
        // nos quedamos con el nombre corto
      }
      const posicion = POS_APIF[p.position] ?? null;
      const valor = mediana(delEquipo.filter((x) => x.posicion === posicion).map((x) => Number(x.valor))) ?? mediana(filas.filter((x) => x.posicion === posicion && x.activo).map((x) => Number(x.valor)));
      const clave = claveJugadorFutbol(nombre, equipo);
      const { error } = await admin.from('futbol_valor').upsert(
        { liga: t.liga, clave, nombre, equipo_real: equipo, posicion, valor_base: valor, valor, fecha_base: hoy(), apif_id: p.id, apif_equipo_id: t.apif_equipo_id, activo: true, nuevo: true, visto_en: ahora, actualizado_en: ahora },
        { onConflict: 'liga,clave' }
      );
      if (error) throw new Error(`futbol_valor: ${error.message}`);
      await evento(admin, t.liga, 'alta', nombre, `Nuevo en ${equipo}${valor ? ` · valor estimado ${Math.round(valor).toLocaleString('es-ES')} (revísalo)` : ' · sin valor (ponle uno)'}.`);
    }
  }
}

/** Al terminar el repaso de plantillas: fuera los que llevan 2 noches sin aparecer en su equipo. */
async function cerrarPlantillas(admin: Admin, lote: string, inicio: string) {
  const { data } = await admin.from('futbol_valor_cola').select('liga,apif_equipo_id,apif_equipo,error').eq('lote', lote);
  const todas = (data as { liga: string; apif_equipo_id: number; apif_equipo: string | null; error: string | null }[]) ?? [];
  const hechos = todas.filter((x) => !x.error);
  // Un solo aviso por liga con lo que no se ha podido repasar.
  for (const liga of Array.from(new Set(todas.map((x) => x.liga)))) {
    const malos = todas.filter((x) => x.liga === liga && x.error);
    const bien = todas.filter((x) => x.liga === liga && !x.error).length;
    await evento(
      admin,
      liga,
      'aviso',
      null,
      malos.length === 0
        ? `Plantillas repasadas: ${bien} equipos.`
        : `Plantillas repasadas: ${bien} equipos. Sin repasar (${malos.length}): ${malos.map((m) => `${m.apif_equipo ?? m.apif_equipo_id}${m.error && !m.error.startsWith('Equipo sin casar') ? ` (${m.error})` : ''}`).join(', ')}.`
    );
  }
  const porLiga = new Map<string, Set<number>>();
  for (const h of hechos) {
    const s = porLiga.get(h.liga) ?? new Set<number>();
    s.add(h.apif_equipo_id);
    porLiga.set(h.liga, s);
  }
  const ahora = Date.now();
  for (const [liga, equipos] of Array.from(porLiga.entries())) {
    const filas = await filasLiga(admin, liga);
    for (const f of filas) {
      if (!f.activo || !f.apif_id || !f.apif_equipo_id || !equipos.has(f.apif_equipo_id)) continue;
      if (f.visto_en && f.visto_en >= inicio) continue;
      if (!f.ausente_desde) {
        await admin.from('futbol_valor').update({ ausente_desde: new Date().toISOString() }).eq('id', f.id);
      } else if (ahora - new Date(f.ausente_desde).getTime() > 30 * 3600e3) {
        await admin.from('futbol_valor').update({ activo: false, actualizado_en: new Date().toISOString() }).eq('id', f.id);
        await evento(admin, liga, 'baja', f.nombre, `Ya no está en ${f.equipo_real ?? 'su equipo'}.`);
      }
    }
  }
}

// ----------------------------------------------------------------------------
// 2. Estadísticas de un equipo (una página de 20 jugadores)
// ----------------------------------------------------------------------------
async function procesarStats(admin: Admin, t: Tarea) {
  const temporada = temporadaApif(new Date());
  const json = await pedirApif(`/players?team=${t.apif_equipo_id}&season=${temporada}&page=${t.pagina}`);
  type R = {
    player: { id: number; name: string; firstname: string | null; lastname: string | null };
    statistics: { team?: { id: number }; games?: { appearences: number | null; minutes: number | null; rating: string | null }; goals?: { total: number | null; assists: number | null } }[];
  };
  const resp = (json?.response ?? []) as R[];
  const filas = await filasLiga(admin, t.liga);
  const fecha = hoy();
  const stats: Record<string, unknown>[] = [];
  const enlaces: Record<string, unknown>[] = [];
  const usados = new Set<string>(filas.filter((f) => f.apif_id).map((f) => f.id));
  const equipo = equipoNuestro(filas, t.apif_equipo_id, t.apif_equipo, resp.map((r) => r.player.name));
  for (const r of resp) {
    const s: Stats = { minutos: 0, partidos: 0, rating_suma: 0, rating_n: 0, goles: 0, asistencias: 0 };
    for (const st of r.statistics ?? []) {
      if (st.team && st.team.id !== t.apif_equipo_id) continue;
      const ap = Number(st.games?.appearences ?? 0) || 0;
      s.minutos += Number(st.games?.minutes ?? 0) || 0;
      s.partidos += ap;
      const nota = st.games?.rating ? Number(st.games.rating) : NaN;
      if (Number.isFinite(nota) && ap > 0) {
        s.rating_suma += nota * ap;
        s.rating_n += ap;
      }
      s.goles += Number(st.goals?.total ?? 0) || 0;
      s.asistencias += Number(st.goals?.assists ?? 0) || 0;
    }
    stats.push({ liga: t.liga, apif_id: r.player.id, fecha, ...s, rating_suma: Math.round(s.rating_suma * 100) / 100 });
    // De paso, se presenta (id de API-Football) a quien aún no lo tenga, por su nombre completo.
    if (equipo && !filas.some((f) => f.apif_id === r.player.id)) {
      const completo = `${r.player.firstname ?? ''} ${r.player.lastname ?? ''}`.trim();
      const cand = filas.filter((f) => !usados.has(f.id) && f.equipo_real === equipo && (mismoNombre(r.player.name, f.nombre) || (completo && mismoNombre(f.nombre, completo))));
      const cand2 = cand.length > 0 ? cand : filas.filter((f) => !usados.has(f.id) && f.equipo_real === equipo && (nombreParecido(r.player.name, f.nombre) || (completo && nombreParecido(completo, f.nombre))));
      const f = unico(cand2);
      if (f) {
        usados.add(f.id);
        enlaces.push({ id: f.id, liga: f.liga, clave: f.clave, nombre: f.nombre, apif_id: r.player.id, apif_equipo_id: t.apif_equipo_id });
      }
    }
  }
  if (stats.length > 0) {
    const { error } = await admin.from('futbol_valor_stats').upsert(stats, { onConflict: 'liga,apif_id,fecha' });
    if (error) throw new Error(`futbol_valor_stats: ${error.message}`);
  }
  if (enlaces.length > 0) await admin.from('futbol_valor').upsert(enlaces, { onConflict: 'id' });
  const total = Number(json?.paging?.total ?? 1);
  if (t.pagina < total) {
    await admin.from('futbol_valor_cola').insert({ lote: t.lote, tipo: 'stats', liga: t.liga, apif_liga: t.apif_liga, apif_equipo_id: t.apif_equipo_id, apif_equipo: t.apif_equipo, pagina: t.pagina + 1 });
  }
}

// ----------------------------------------------------------------------------
// 3. Recalcular el valor (al terminar las estadísticas del lunes)
// ----------------------------------------------------------------------------
type Calculo = { id: string; nombre: string; antes: number; despues: number; cambio: number };

/** Cálculo puro (sin base de datos), para poder probarlo. */
export function calcularCambiosValor(
  filas: { id: string; nombre: string; equipo_real: string | null; posicion: string | null; valor_base: number | null; valor: number | null; apif_id: number | null }[],
  ahora: Map<number, Stats>,
  semanaAntes: Map<number, Stats>,
  inicioVentana: Map<number, Stats>
): Calculo[] {
  const resta = (a: Stats | undefined, b: Stats | undefined): Stats | null => {
    if (!a || !b) return null;
    return {
      minutos: Math.max(0, a.minutos - b.minutos),
      partidos: Math.max(0, a.partidos - b.partidos),
      rating_suma: Math.max(0, a.rating_suma - b.rating_suma),
      rating_n: Math.max(0, a.rating_n - b.rating_n),
      goles: Math.max(0, a.goles - b.goles),
      asistencias: Math.max(0, a.asistencias - b.asistencias),
    };
  };
  const datos = filas
    .filter((f) => f.apif_id && f.valor && f.valor_base)
    .map((f) => ({ f, ventana: resta(ahora.get(f.apif_id!), inicioVentana.get(f.apif_id!)), semana: resta(ahora.get(f.apif_id!), semanaAntes.get(f.apif_id!)) }))
    .filter((x) => x.ventana && x.semana) as { f: (typeof filas)[number]; ventana: Stats; semana: Stats }[];
  // Minutos que ha podido jugar su equipo (el que más ha jugado de su equipo).
  const maxEq = new Map<string, number>();
  const maxEqSemana = new Map<string, number>();
  for (const d of datos) {
    const e = d.f.equipo_real ?? '';
    maxEq.set(e, Math.max(maxEq.get(e) ?? 0, d.ventana.minutos));
    maxEqSemana.set(e, Math.max(maxEqSemana.get(e) ?? 0, d.semana.minutos));
  }
  // Medias de su posición (jugadores con al menos 90 minutos en la ventana).
  const medias = new Map<string, { nota: number; ga90: number }>();
  for (const pos of ['portero', 'defensa', 'centrocampista', 'delantero']) {
    const xs = datos.filter((d) => d.f.posicion === pos && d.ventana.minutos >= 90);
    const notas = xs.filter((d) => d.ventana.rating_n > 0).map((d) => d.ventana.rating_suma / d.ventana.rating_n);
    const ga = xs.map((d) => ((d.ventana.goles + d.ventana.asistencias) / d.ventana.minutos) * 90);
    // Mediana (no media), para que unas pocas estrellas no muevan la referencia de todos.
    medias.set(pos, { nota: medianaSimple(notas) ?? 6.7, ga90: medianaSimple(ga) ?? 0.2 });
  }
  const out: Calculo[] = [];
  for (const d of datos) {
    const e = d.f.equipo_real ?? '';
    const mEq = maxEq.get(e) ?? 0;
    if (mEq <= 0 || (maxEqSemana.get(e) ?? 0) <= 0) continue; // su equipo no ha jugado (parón): no cambia
    const med = medias.get(d.f.posicion ?? '') ?? { nota: 6.7, ga90: 0.2 };
    const m = clamp(d.ventana.minutos / mEq, 0, 1);
    const notaRel = d.ventana.rating_n > 0 ? clamp((d.ventana.rating_suma / d.ventana.rating_n - med.nota) / 0.6, -1, 1) : 0;
    const gaRel = d.ventana.minutos >= 90 ? clamp((((d.ventana.goles + d.ventana.asistencias) / d.ventana.minutos) * 90 - med.ga90) / Math.max(med.ga90, 0.15), -1, 1) : 0;
    // Minutos: jugar casi siempre (80 % o más de lo que ha jugado su equipo) es lo
    // normal y no sube nada; jugar menos baja. Lo que sube es jugar bien.
    const sMin = m >= 0.8 ? 0 : (m - 0.8) / 0.8;
    const defensivo = d.f.posicion === 'portero' || d.f.posicion === 'defensa';
    const s = defensivo ? 0.4 * sMin + 0.6 * notaRel : 0.35 * sMin + 0.45 * notaRel + 0.2 * gaRel;
    let cambio = clamp(VALOR_MAX_SEMANA * s, -VALOR_MAX_SEMANA, VALOR_MAX_SEMANA);
    if (d.semana.minutos === 0) cambio = Math.max(cambio, -VALOR_MAX_SIN_JUGAR); // lesión / no juega: baja poco a poco
    const base = Number(d.f.valor_base);
    const antes = Number(d.f.valor);
    const despues = Math.round(clamp(antes * (1 + cambio), base * (1 - VALOR_TOPE_TOTAL), base * (1 + VALOR_TOPE_TOTAL)));
    if (despues === Math.round(antes)) continue;
    out.push({ id: d.f.id, nombre: d.f.nombre, antes, despues, cambio: despues / antes - 1 });
  }
  return out;
}

async function statsDe(admin: Admin, liga: string, fecha: string): Promise<Map<number, Stats>> {
  const m = new Map<number, Stats>();
  for (let d = 0; ; d += 1000) {
    const { data } = await admin.from('futbol_valor_stats').select('apif_id,minutos,partidos,rating_suma,rating_n,goles,asistencias').eq('liga', liga).eq('fecha', fecha).range(d, d + 999);
    const lote = (data as (Stats & { apif_id: number })[]) ?? [];
    for (const s of lote) m.set(s.apif_id, { minutos: s.minutos, partidos: s.partidos, rating_suma: Number(s.rating_suma), rating_n: s.rating_n, goles: s.goles, asistencias: s.asistencias });
    if (lote.length < 1000) break;
  }
  return m;
}

export async function recalcularValores(admin: Admin): Promise<Record<string, number>> {
  const res: Record<string, number> = {};
  for (const liga of LIGAS_VALOR_FUTBOL.map((l) => l.prefijo)) {
    const { data } = await admin.from('futbol_valor_stats').select('fecha').eq('liga', liga).order('fecha', { ascending: false }).limit(3000);
    const fechas = Array.from(new Set(((data as { fecha: string }[]) ?? []).map((x) => x.fecha))).slice(0, 6);
    if (fechas.length < 2) {
      await evento(admin, liga, 'aviso', null, 'Primera foto de las estadísticas guardada: los valores empiezan a moverse el próximo lunes.');
      res[liga] = 0;
      continue;
    }
    const [ahora, antes, inicio] = await Promise.all([statsDe(admin, liga, fechas[0]), statsDe(admin, liga, fechas[1]), statsDe(admin, liga, fechas[Math.min(5, fechas.length - 1)])]);
    const filas = (await filasLiga(admin, liga)).filter((f) => f.activo);
    const cambios = calcularCambiosValor(filas, ahora, antes, inicio);
    const fecha = hoy();
    const ahoraIso = new Date().toISOString();
    for (let d = 0; d < cambios.length; d += 200) {
      const lote = cambios.slice(d, d + 200);
      const filasPorId = new Map(filas.map((f) => [f.id, f]));
      await admin.from('futbol_valor').upsert(
        lote.map((c) => {
          const f = filasPorId.get(c.id)!;
          return { id: c.id, liga: f.liga, clave: f.clave, nombre: f.nombre, valor: c.despues, ultimo_cambio: Math.round(c.cambio * 1000) / 10, actualizado_en: ahoraIso };
        }),
        { onConflict: 'id' }
      );
      await admin.from('futbol_valor_historial').upsert(lote.map((c) => ({ jugador_id: c.id, fecha, valor: c.despues })), { onConflict: 'jugador_id,fecha' });
    }
    const grandes = cambios.filter((c) => Math.abs(c.cambio) >= 0.04).sort((a, b) => b.cambio - a.cambio);
    for (const c of grandes.slice(0, 40)) await evento(admin, liga, 'valor', c.nombre, `${c.cambio > 0 ? 'Sube' : 'Baja'} un ${Math.abs(Math.round(c.cambio * 1000) / 10).toLocaleString('es-ES')} %`);
    await evento(admin, liga, 'aviso', null, `Valores de la semana actualizados: ${cambios.length} jugadores cambian (${cambios.filter((c) => c.cambio > 0).length} suben, ${cambios.filter((c) => c.cambio < 0).length} bajan).`);
    res[liga] = cambios.length;
  }
  return res;
}

// ----------------------------------------------------------------------------
// Procesar la cola (unas pocas consultas cada vez)
// ----------------------------------------------------------------------------
export async function procesarColaValorFutbol(admin: Admin, max = 6): Promise<{ hechas: number; pendientes: number }> {
  const { data } = await admin.from('futbol_valor_cola').select('*').eq('hecho', false).order('id').limit(max);
  const tareas = (data as Tarea[]) ?? [];
  for (const t of tareas) {
    let error: string | null = null;
    try {
      if (t.tipo === 'plantilla') await procesarPlantilla(admin, t);
      else await procesarStats(admin, t);
    } catch (e) {
      error = (e as Error).message.slice(0, 300);
    }
    await admin.from('futbol_valor_cola').update({ hecho: true, error }).eq('id', t.id);
  }
  const { count } = await admin.from('futbol_valor_cola').select('id', { count: 'exact', head: true }).eq('hecho', false);
  const pendientes = count ?? 0;
  // ¿Ha terminado algún lote?
  for (const tipo of ['plantilla', 'stats'] as const) {
    const est = await leerEstado(admin, `${tipo}_lote`);
    if (!est || est.cerrado) continue;
    const { count: quedan } = await admin.from('futbol_valor_cola').select('id', { count: 'exact', head: true }).eq('hecho', false).eq('lote', String(est.lote));
    if ((quedan ?? 0) > 0) continue;
    if (tipo === 'plantilla') await cerrarPlantillas(admin, String(est.lote), String(est.inicio));
    else await recalcularValores(admin);
    await guardarEstado(admin, `${tipo}_lote`, { ...est, cerrado: true, fin: new Date().toISOString() });
  }
  // Limpieza: tareas hechas de hace más de 15 días.
  if (tareas.length > 0) await admin.from('futbol_valor_cola').delete().eq('hecho', true).lt('creado', new Date(Date.now() - 15 * 86400e3).toISOString());
  return { hechas: tareas.length, pendientes };
}

// ----------------------------------------------------------------------------
// Lo que hace el cron cada minuto
// ----------------------------------------------------------------------------
export async function tareasValorFutbol(admin: Admin): Promise<Record<string, unknown>> {
  if (!claveApif()) return { saltado: 'sin API_FOOTBALL_KEY' };
  const t = madrid();
  const out: Record<string, unknown> = {};
  if (t.hora === 4 && t.minuto >= 5) {
    const est = await leerEstado(admin, 'plantilla_dia');
    if (est?.fecha !== t.fecha) {
      await guardarEstado(admin, 'plantilla_dia', { fecha: t.fecha });
      out.plantilla = await encolarValorFutbol(admin, 'plantilla');
    }
  }
  if (t.diaSemana === 'Mon' && t.hora === 4 && t.minuto >= 20) {
    const est = await leerEstado(admin, 'stats_dia');
    if (est?.fecha !== t.fecha) {
      await guardarEstado(admin, 'stats_dia', { fecha: t.fecha });
      out.stats = await encolarValorFutbol(admin, 'stats');
    }
  }
  const { count } = await admin.from('futbol_valor_cola').select('id', { count: 'exact', head: true }).eq('hecho', false);
  if ((count ?? 0) > 0) out.cola = await procesarColaValorFutbol(admin, 6);
  return out;
}

export { normalizarNombre };
