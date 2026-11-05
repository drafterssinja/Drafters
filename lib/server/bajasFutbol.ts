import type { crearClienteAdmin } from './supabaseAdmin';
import { pedirApif, temporadaApif, claveApif } from './apiFootball';
import { LIGAS_VALOR_FUTBOL, claveJugadorFutbol } from '@/lib/valorFutbolClave';
import { nombreParecido, normalizarNombre } from './valorFutbol';

// ============================================================================
// BAJAS DE FÚTBOL: LESIONADOS, SANCIONADOS Y DUDAS (05/11, Iñi)
// ============================================================================
// Para cada jornada de LaLiga / Champions que empieza en los próximos días (o
// está en juego), se piden a API-Football las lesiones de los días de sus
// partidos (/injuries?league&season&date, una consulta por día) y se apunta en
// la ficha de cada jugador de esa jornada:
//   ausencia: 'lesion' (no juega por lesión), 'sancion' (no juega por sanción)
//             o 'duda'; ausencia_motivo: el motivo en castellano.
// Al elegir el equipo: cruz roja, tarjeta roja o "?" (ver IconoAusencia).
// Los jugadores se casan por su id de API-Football (futbol_valor, plantillas
// automáticas); si no, por nombre dentro del mismo equipo.
// 05/11: API-Football publica la lista de cada partido uno o dos días antes;
// mientras no está, se usa la del último partido del equipo (lesionados y
// dudas). Se hace cada hora desde el cron.

type Admin = ReturnType<typeof crearClienteAdmin>;
type Lesion = { player: { id: number; name: string; type: string | null; reason: string | null }; team: { id: number; name: string }; fixture: { id: number; date: string } };

const MOTIVOS: [RegExp, string][] = [
  [/red card/i, 'Tarjeta roja'],
  [/yellow card/i, 'Acumulación de amarillas'],
  [/suspen/i, 'Sancionado'],
  [/knee/i, 'Lesión de rodilla'],
  [/hamstring/i, 'Lesión en el isquiotibial'],
  [/calf/i, 'Lesión en el gemelo'],
  [/groin|adductor/i, 'Lesión en el aductor'],
  [/thigh|quadriceps/i, 'Lesión en el muslo'],
  [/ankle/i, 'Lesión de tobillo'],
  [/foot|toe/i, 'Lesión en el pie'],
  [/achilles/i, 'Lesión en el tendón de Aquiles'],
  [/back/i, 'Lesión de espalda'],
  [/hip/i, 'Lesión de cadera'],
  [/shoulder/i, 'Lesión de hombro'],
  [/head|concussion/i, 'Golpe en la cabeza'],
  [/muscle/i, 'Lesión muscular'],
  [/ligament|cruciate|acl/i, 'Lesión de ligamentos'],
  [/broken|fracture/i, 'Fractura'],
  [/knock/i, 'Golpe'],
  [/illness|virus|flu|sick/i, 'Enfermedad'],
  [/personal/i, 'Motivos personales'],
  [/coach|technical/i, 'Decisión técnica'],
  [/international/i, 'Con su selección'],
  [/lack of fitness|fitness/i, 'Falta de forma'],
  [/injur/i, 'Lesión'],
];
function motivoEs(reason: string | null): string {
  const r = (reason ?? '').trim();
  if (!r) return 'Lesión';
  for (const [re, es] of MOTIVOS) if (re.test(r)) return es;
  return r;
}
function tipoDe(l: Lesion): 'lesion' | 'sancion' | 'duda' {
  if (/questionable|doubt/i.test(l.player.type ?? '')) return 'duda';
  if (/suspen|red card|yellow card/i.test(l.player.reason ?? '')) return 'sancion';
  return 'lesion';
}
const diaMadrid = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(iso));

type FilaValor = { id: string; clave: string; nombre: string; equipo_real: string | null; apif_id: number | null; apif_equipo_id: number | null };
type Ficha = { id: string; nombre: string; equipo_real: string | null; metadata: Record<string, unknown> | null; ausencia: string | null; ausencia_motivo: string | null };
type Baja = { ausencia: string; motivo: string };

/** El único candidato cuyo nombre se parece (si hay 0 o varios, ninguno). */
function unico<T>(lista: T[], nombre: (x: T) => string, buscado: string): T | null {
  const c = lista.filter((x) => nombreParecido(buscado, nombre(x)));
  return c.length === 1 ? c[0] : null;
}

export async function actualizarBajasFutbol(admin: Admin): Promise<Record<string, unknown>> {
  if (!claveApif()) return { saltado: 'sin API_FOOTBALL_KEY' };
  const ahora = Date.now();
  const desde = ahora - 3 * 3600e3;
  const hasta = ahora + 8 * 86400e3;
  const temporada = temporadaApif(new Date());
  // Jornadas abiertas o en juego: las que tienen partidos entre hace 3 h y dentro de 8 días.
  const { data: partidos } = await admin
    .from('futbol_partidos_jornada')
    .select('competicion,kickoff,estado')
    .gt('kickoff', new Date(desde).toISOString())
    .lt('kickoff', new Date(hasta).toISOString());
  const porComp = new Map<string, Set<string>>();
  for (const p of (partidos as { competicion: string; kickoff: string | null }[]) ?? []) {
    if (!p.kickoff) continue;
    const liga = LIGAS_VALOR_FUTBOL.find((l) => p.competicion.startsWith(`${l.prefijo} - `));
    if (!liga) continue;
    const s = porComp.get(p.competicion) ?? new Set<string>();
    s.add(diaMadrid(p.kickoff));
    porComp.set(p.competicion, s);
  }
  const res: Record<string, unknown> = {};
  for (const [competicion, dias] of Array.from(porComp.entries())) {
    const liga = LIGAS_VALOR_FUTBOL.find((l) => competicion.startsWith(`${l.prefijo} - `))!;

    // Fichas de esta jornada.
    const fichas: Ficha[] = [];
    let errorFichas: string | null = null;
    for (let d = 0; ; d += 1000) {
      const { data, error } = await admin.from('jugadores').select('id,nombre,equipo_real,metadata,ausencia,ausencia_motivo').eq('deporte', 'futbol').eq('competicion', competicion).range(d, d + 999);
      if (error) {
        errorFichas = error.message;
        break;
      }
      const lote = (data as Ficha[]) ?? [];
      fichas.push(...lote);
      if (lote.length < 1000) break;
    }
    if (errorFichas) {
      res[competicion] = { error: errorFichas };
      continue;
    }

    // Plantilla automática de la liga (valor Drafters).
    const fv: FilaValor[] = [];
    for (let d = 0; ; d += 1000) {
      const { data } = await admin.from('futbol_valor').select('id,clave,nombre,equipo_real,apif_id,apif_equipo_id').eq('liga', liga.prefijo).range(d, d + 999);
      const lote = (data as FilaValor[]) ?? [];
      fv.push(...lote);
      if (lote.length < 1000) break;
    }
    const porApif = new Map<number, FilaValor>();
    const porClave = new Map<string, FilaValor>();
    const porEquipoApif = new Map<number, FilaValor[]>();
    const votosEquipo = new Map<string, Map<number, number>>(); // nuestro equipo → id de equipo de API-Football
    for (const f of fv) {
      if (f.apif_id) porApif.set(f.apif_id, f);
      porClave.set(f.clave, f);
      if (f.apif_equipo_id) {
        porEquipoApif.set(f.apif_equipo_id, [...(porEquipoApif.get(f.apif_equipo_id) ?? []), f]);
        const k = normalizarNombre(f.equipo_real ?? '');
        const v = votosEquipo.get(k) ?? new Map<number, number>();
        v.set(f.apif_equipo_id, (v.get(f.apif_equipo_id) ?? 0) + 1);
        votosEquipo.set(k, v);
      }
    }
    const apifDeEquipo = (equipo: string | null): number | null => {
      const v = votosEquipo.get(normalizarNombre(equipo ?? ''));
      if (!v) return null;
      return Array.from(v.entries()).sort((a, b) => b[1] - a[1])[0][0];
    };
    const fichasPorEquipoApif = new Map<number, Ficha[]>();
    for (const j of fichas) {
      const a = apifDeEquipo(j.equipo_real);
      if (a) fichasPorEquipoApif.set(a, [...(fichasPorEquipoApif.get(a) ?? []), j]);
    }
    const equiposJornada = Array.from(fichasPorEquipoApif.keys());

    // 1) Lista de bajas de los días de los partidos (lo que API-Football ya ha
    //    publicado para esta jornada).
    const lesiones: Lesion[] = [];
    try {
      for (const dia of Array.from(dias)) {
        const json = await pedirApif(`/injuries?league=${liga.apif}&season=${temporada}&date=${dia}`);
        lesiones.push(...(((json?.response ?? []) as Lesion[]).filter((l) => l?.player?.id && l?.team?.id)));
      }
    } catch (e) {
      res[competicion] = { error: (e as Error).message };
      continue; // si falla algún día, no se toca nada de esta jornada
    }
    const proximo = (l: Lesion) => {
      const t = new Date(l.fixture?.date ?? 0).getTime();
      return t > desde && t < hasta;
    };
    const vistas = new Set<string>();
    const usadas: Lesion[] = lesiones.filter((l) => {
      const k = `${l.player.id}|${l.fixture?.id}`;
      if (vistas.has(k) || !proximo(l)) return false;
      vistas.add(k);
      return true;
    });
    const conLista = new Set(usadas.map((l) => l.team.id));

    // 2) Equipos de la jornada sin lista publicada todavía (API-Football la
    //    publica uno o dos días antes del partido): se usa la de su último
    //    partido (lesionados y dudas; las sanciones ya se cumplieron), si es
    //    de hace menos de 3 semanas. En cuanto se publique la del partido,
    //    manda esa.
    let deUltimoPartido = 0;
    const sinLista = equiposJornada.filter((e) => !conLista.has(e));
    for (let i = 0; i < sinLista.length; i += 5) {
      const lote = sinLista.slice(i, i + 5);
      const respuestas = await Promise.all(
        lote.map((equipo) => pedirApif(`/injuries?league=${liga.apif}&season=${temporada}&team=${equipo}`).then((j) => ((j?.response ?? []) as Lesion[]).filter((l) => l?.player?.id)).catch(() => null)),
      );
      for (const lista of respuestas) {
        if (!lista || lista.length === 0) continue;
        const delProximo = lista.filter(proximo);
        if (delProximo.length) {
          usadas.push(...delProximo);
          continue;
        }
        const pasados = lista.filter((l) => {
          const t = new Date(l.fixture?.date ?? 0).getTime();
          return t <= desde && t > ahora - 21 * 86400e3;
        });
        if (!pasados.length) continue;
        const ultimo = Math.max(...pasados.map((l) => new Date(l.fixture.date).getTime()));
        const delUltimo = pasados.filter((l) => new Date(l.fixture.date).getTime() === ultimo && tipoDe(l) !== 'sancion');
        deUltimoPartido += delUltimo.length;
        usadas.push(...delUltimo);
      }
    }

    // 3) Casar cada baja con la ficha de esta jornada: por id de API-Football,
    //    y si no, por nombre dentro del mismo equipo.
    const bajaPorValor = new Map<string, Baja>();
    const bajaPorFicha = new Map<string, Baja>();
    const sinCasar: string[] = [];
    const poner = (mapa: Map<string, Baja>, k: string, b: Baja) => {
      // Si hay varias entradas del mismo jugador, manda la más grave (no juega > duda).
      const previa = mapa.get(k);
      if (previa && previa.ausencia !== 'duda') return;
      mapa.set(k, b);
    };
    for (const l of usadas) {
      const b: Baja = { ausencia: tipoDe(l), motivo: motivoEs(l.player.reason) };
      const f = porApif.get(l.player.id) ?? unico(porEquipoApif.get(l.team.id) ?? [], (x) => x.nombre, l.player.name);
      if (f) {
        poner(bajaPorValor, f.id, b);
        continue;
      }
      const j = unico(fichasPorEquipoApif.get(l.team.id) ?? [], (x) => x.nombre, l.player.name);
      if (j) poner(bajaPorFicha, j.id, b);
      else if (!sinCasar.includes(`${l.player.name} (${l.team.name})`)) sinCasar.push(`${l.player.name} (${l.team.name})`);
    }

    const enEs = new Date().toISOString();
    let marcados = 0;
    const cambios: { id: string; ausencia: string | null; ausencia_motivo: string | null }[] = [];
    for (const j of fichas) {
      const vid = typeof j.metadata?.futbol_valor_id === 'string' ? (j.metadata.futbol_valor_id as string) : porClave.get(claveJugadorFutbol(j.nombre, j.equipo_real))?.id;
      const b = (vid ? bajaPorValor.get(vid) : undefined) ?? bajaPorFicha.get(j.id) ?? null;
      if (b) marcados++;
      const nueva = b?.ausencia ?? null;
      const motivo = b?.motivo ?? null;
      if (nueva !== j.ausencia || motivo !== j.ausencia_motivo) cambios.push({ id: j.id, ausencia: nueva, ausencia_motivo: motivo });
    }
    for (const c of cambios) {
      await admin.from('jugadores').update({ ausencia: c.ausencia, ausencia_motivo: c.ausencia_motivo, ausencia_en: enEs }).eq('id', c.id);
    }
    res[competicion] = {
      lesiones: usadas.length,
      equipos: equiposJornada.length,
      equiposConLista: new Set(usadas.map((l) => l.team.id)).size,
      deUltimoPartido,
      marcados,
      cambios: cambios.length,
      sinCasar: sinCasar.slice(0, 20),
    };
  }
  return res;
}
