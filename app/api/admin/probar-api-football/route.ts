import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';

// ============================================================================
// DIAGNÓSTICO — API-FOOTBALL (01/11, Iñi)
// ============================================================================
// Antes de pagar nada: ver con un partido real de LaLiga / Champions qué
// estadísticas por jugador trae API-Football (entradas, intercepciones,
// duelos, regates, pases clave, nota...). La clave va SOLO en la variable de
// entorno API_FOOTBALL_KEY de Vercel; nunca sale al navegador. Solo admin.
//   accion 'estado'    → plan y consultas gastadas hoy (no gasta consultas)
//   accion 'partidos'  → partidos de una liga en una fecha (1 consulta)
//   accion 'jugadores' → estadísticas por jugador de un partido (1 consulta)
export const maxDuration = 30;

const BASE = 'https://v3.football.api-sports.io';
const LIGAS: Record<string, number> = { laliga: 140, champions: 2 };

async function esAdmin(req: NextRequest, admin: ReturnType<typeof crearClienteAdmin>) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return false;
  const { data: p } = await admin.from('perfiles').select('rol').eq('id', data.user.id).single();
  return !!p && p.rol === 'admin';
}

async function pedir(ruta: string, clave: string): Promise<{ status: number; json: Record<string, unknown> | null; texto: string }> {
  try {
    const r = await fetch(`${BASE}${ruta}`, { headers: { 'x-apisports-key': clave, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const texto = await r.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(texto);
    } catch {
      // no es JSON
    }
    return { status: r.status, json, texto: texto.slice(0, 2000) };
  } catch (e) {
    return { status: 0, json: null, texto: (e as Error).message };
  }
}

/** { a: { b: 1 } } → { 'a.b': 1 } */
function aplanar(obj: unknown, prefijo = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    out[prefijo] = obj;
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) aplanar(v, prefijo ? `${prefijo}.${k}` : k, out);
  return out;
}

/** Los errores de API-Football vienen en "errors" (objeto o lista), p. ej. por el plan. */
function errores(json: Record<string, unknown> | null): string[] {
  const e = json?.errors;
  if (!e) return [];
  if (Array.isArray(e)) return e.map(String);
  if (typeof e === 'object') return Object.entries(e as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`);
  return [String(e)];
}

export async function POST(req: NextRequest) {
  let admin;
  try {
    admin = crearClienteAdmin();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  if (!(await esAdmin(req, admin))) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });

  const clave = process.env.API_FOOTBALL_KEY;
  if (!clave) return NextResponse.json({ error: 'Falta la variable API_FOOTBALL_KEY en Vercel (y volver a desplegar).' }, { status: 400 });

  let body: { accion?: string; liga?: string; temporada?: string; fecha?: string; partido?: string; jornada?: string } = {};
  try {
    body = await req.json();
  } catch {
    // vacío
  }

  if (body.accion === 'estado') {
    const r = await pedir('/status', clave);
    const resp = (r.json?.response ?? {}) as { account?: { firstname?: string; email?: string }; subscription?: { plan?: string; end?: string; active?: boolean }; requests?: { current?: number; limit_day?: number } };
    return NextResponse.json({
      ok: r.status === 200 && errores(r.json).length === 0,
      errores: errores(r.json),
      plan: resp.subscription?.plan ?? null,
      activa: resp.subscription?.active ?? null,
      hasta: resp.subscription?.end ?? null,
      consultas_hoy: resp.requests?.current ?? null,
      limite_dia: resp.requests?.limit_day ?? null,
      crudo: r.json ? undefined : r.texto,
    });
  }

  if (body.accion === 'partidos') {
    const liga = LIGAS[body.liga ?? 'laliga'] ?? 140;
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(body.fecha ?? '') ? body.fecha : new Date().toISOString().slice(0, 10);
    const temporada = /^\d{4}$/.test(body.temporada ?? '') ? body.temporada : String(new Date().getUTCMonth() >= 6 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1);
    // 01/11: el plan gratuito solo deja temporadas pasadas Y fechas de ayer a mañana, así que
    // con una temporada pasada se busca por jornada ("Regular Season - N"), sin fecha.
    const jornada = /^\d{1,2}$/.test(body.jornada ?? '') ? body.jornada : null;
    const filtro = jornada ? `round=${encodeURIComponent(`Regular Season - ${jornada}`)}` : `date=${fecha}`;
    const r = await pedir(`/fixtures?league=${liga}&season=${temporada}&${filtro}&timezone=Europe/Madrid`, clave);
    type Fx = { fixture?: { id?: number; date?: string; status?: { short?: string; elapsed?: number } }; teams?: { home?: { name?: string }; away?: { name?: string } }; goals?: { home?: number | null; away?: number | null } };
    const lista = ((r.json?.response ?? []) as Fx[]).map((f) => ({
      id: f.fixture?.id,
      fecha: f.fixture?.date,
      estado: f.fixture?.status?.short,
      minuto: f.fixture?.status?.elapsed,
      local: f.teams?.home?.name,
      visitante: f.teams?.away?.name,
      marcador: `${f.goals?.home ?? '-'}-${f.goals?.away ?? '-'}`,
    }));
    return NextResponse.json({ errores: errores(r.json), temporada, fecha, partidos: lista, crudo: r.json ? undefined : r.texto });
  }

  if (body.accion === 'jugadores') {
    if (!/^\d+$/.test(body.partido ?? '')) return NextResponse.json({ error: 'Falta el partido.' }, { status: 400 });
    const r = await pedir(`/fixtures/players?fixture=${body.partido}`, clave);
    type Eq = { team?: { name?: string }; players?: { player?: { name?: string }; statistics?: unknown[] }[] };
    const jugadores: Record<string, unknown>[] = [];
    for (const eq of (r.json?.response ?? []) as Eq[]) {
      for (const p of eq.players ?? []) {
        jugadores.push({ equipo: eq.team?.name, jugador: p.player?.name, ...aplanar(p.statistics?.[0] ?? {}) });
      }
    }
    // Qué estadísticas vienen rellenas (en cuántos jugadores tienen valor).
    const cobertura: Record<string, number> = {};
    for (const j of jugadores) {
      for (const [k, v] of Object.entries(j)) {
        if (k === 'equipo' || k === 'jugador') continue;
        cobertura[k] = (cobertura[k] ?? 0) + (v !== null && v !== undefined && v !== '' ? 1 : 0);
      }
    }
    return NextResponse.json({ errores: errores(r.json), total_jugadores: jugadores.length, cobertura, jugadores, crudo: r.json ? undefined : r.texto });
  }

  return NextResponse.json({ error: 'Acción no válida.' }, { status: 400 });
}
