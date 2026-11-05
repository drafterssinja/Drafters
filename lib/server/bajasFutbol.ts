import type { crearClienteAdmin } from './supabaseAdmin';
import { pedirApif, temporadaApif, claveApif } from './apiFootball';
import { LIGAS_VALOR_FUTBOL, claveJugadorFutbol } from '@/lib/valorFutbolClave';

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
// automáticas); si la ficha es de antes, por nombre y equipo.
// Se hace cada hora desde el cron (unas pocas consultas cada vez).

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

export async function actualizarBajasFutbol(admin: Admin): Promise<Record<string, unknown>> {
  if (!claveApif()) return { saltado: 'sin API_FOOTBALL_KEY' };
  const ahora = Date.now();
  const temporada = temporadaApif(new Date());
  // Jornadas abiertas o en juego: las que tienen partidos entre hace 3 h y dentro de 8 días.
  const { data: partidos } = await admin
    .from('futbol_partidos_jornada')
    .select('competicion,kickoff,estado')
    .gt('kickoff', new Date(ahora - 3 * 3600e3).toISOString())
    .lt('kickoff', new Date(ahora + 8 * 86400e3).toISOString());
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
    const lesiones: Lesion[] = [];
    try {
      for (const dia of Array.from(dias)) {
        const json = await pedirApif(`/injuries?league=${liga.apif}&season=${temporada}&date=${dia}`);
        lesiones.push(...(((json?.response ?? []) as Lesion[]).filter((l) => l?.player?.id)));
      }
    } catch (e) {
      res[competicion] = { error: (e as Error).message };
      continue; // si falla algún día, no se toca nada de esta jornada
    }
    // id de API-Football → jugador de la plantilla automática (futbol_valor).
    const { data: fv } = await admin.from('futbol_valor').select('id,clave,apif_id').eq('liga', liga.prefijo).not('apif_id', 'is', null);
    const porApif = new Map<number, { id: string; clave: string }>();
    for (const f of (fv as { id: string; clave: string; apif_id: number }[]) ?? []) porApif.set(f.apif_id, f);
    const bajaPorValor = new Map<string, { ausencia: string; motivo: string }>();
    const bajaPorClave = new Map<string, { ausencia: string; motivo: string }>();
    for (const l of lesiones) {
      const f = porApif.get(l.player.id);
      if (!f) continue;
      const b = { ausencia: tipoDe(l), motivo: motivoEs(l.player.reason) };
      // Si hay varias entradas del mismo jugador, manda la más grave (no juega > duda).
      const previa = bajaPorValor.get(f.id);
      if (previa && previa.ausencia !== 'duda') continue;
      bajaPorValor.set(f.id, b);
      bajaPorClave.set(f.clave, b);
    }
    // Fichas de esta jornada.
    const fichas: { id: string; nombre: string; equipo_real: string | null; metadata: Record<string, unknown> | null; ausencia: string | null; ausencia_motivo: string | null }[] = [];
    for (let d = 0; ; d += 1000) {
      const { data, error } = await admin.from('jugadores').select('id,nombre,equipo_real,metadata,ausencia,ausencia_motivo').eq('deporte', 'futbol').eq('competicion', competicion).range(d, d + 999);
      if (error) {
        res[competicion] = { error: error.message };
        break;
      }
      const lote = (data as typeof fichas) ?? [];
      fichas.push(...lote);
      if (lote.length < 1000) break;
    }
    const enEs = new Date().toISOString();
    let marcados = 0;
    const cambios: { id: string; ausencia: string | null; ausencia_motivo: string | null }[] = [];
    for (const j of fichas) {
      const vid = typeof j.metadata?.futbol_valor_id === 'string' ? (j.metadata.futbol_valor_id as string) : null;
      const b = (vid ? bajaPorValor.get(vid) : undefined) ?? bajaPorClave.get(claveJugadorFutbol(j.nombre, j.equipo_real)) ?? null;
      if (b) marcados++;
      const nueva = b?.ausencia ?? null;
      const motivo = b?.motivo ?? null;
      if (nueva !== j.ausencia || motivo !== j.ausencia_motivo) cambios.push({ id: j.id, ausencia: nueva, ausencia_motivo: motivo });
    }
    for (const c of cambios) {
      await admin.from('jugadores').update({ ausencia: c.ausencia, ausencia_motivo: c.ausencia_motivo, ausencia_en: enEs }).eq('id', c.id);
    }
    res[competicion] = { lesiones: lesiones.length, marcados, cambios: cambios.length };
  }
  return res;
}
