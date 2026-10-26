import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';

// ============================================================================
// DIAGNÓSTICO — LIVE TENNIS API (13/10, antes de montar el tenis en directo)
// ============================================================================
// Llama a un endpoint de Live Tennis API con la clave de la variable de entorno
// LIVE_TENNIS_API_KEY y devuelve la respuesta CRUDA, para ver qué campos trae
// de verdad cada plan antes de construir la puntuación. Solo admin. La clave
// nunca sale al navegador.
export const maxDuration = 30;

const BASE = 'https://api.livetennisapi.com/api/public/v1';
const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/tennis';
const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/tennis';

async function pedir(url: string): Promise<{ status: number; json: unknown; texto: string }> {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store', signal: AbortSignal.timeout(12000) });
    const texto = await r.text();
    let json: unknown = null;
    try {
      json = JSON.parse(texto);
    } catch {
      // no es JSON
    }
    return { status: r.status, json, texto: texto.slice(0, 3000) };
  } catch (e) {
    return { status: 0, json: null, texto: (e as Error).message };
  }
}

// Busca en el JSON lo que nos interesa para puntuar (saque, aces, dobles
// faltas, breaks, juegos por set...) y devuelve dónde está y qué vale.
const INTERES = /ace|double|fault|serv|break|possession|linescore|tiebreak|point|game|set|stat/i;
function buscar(obj: unknown, ruta: string, out: { ruta: string; valor: unknown }[], prof = 0) {
  if (out.length >= 80 || prof > 9 || obj === null || obj === undefined) return;
  if (Array.isArray(obj)) {
    obj.slice(0, 6).forEach((x, i) => buscar(x, `${ruta}[${i}]`, out, prof + 1));
    return;
  }
  if (typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const r = ruta ? `${ruta}.${k}` : k;
    const simple = v === null || typeof v !== 'object';
    if (INTERES.test(k) && (simple || Array.isArray(v))) out.push({ ruta: r, valor: simple ? v : `[${(v as unknown[]).length} elementos]` });
    else if (simple && typeof v === 'string' && /ace|double fault|break point|serv/i.test(v)) out.push({ ruta: r, valor: v });
    if (!simple) buscar(v, r, out, prof + 1);
  }
}

type Comp = { id?: string; status?: { type?: { state?: string; description?: string } }; competitors?: unknown[]; $ref?: string };
function partidos(json: unknown): { eventId: string; comp: Comp }[] {
  const out: { eventId: string; comp: Comp }[] = [];
  const evs = ((json as { events?: unknown[] })?.events ?? []) as { id?: string; competitions?: Comp[]; groupings?: { competitions?: Comp[] }[] }[];
  for (const e of evs) {
    for (const c of e.competitions ?? []) out.push({ eventId: String(e.id ?? ''), comp: c });
    for (const g of e.groupings ?? []) for (const c of g.competitions ?? []) out.push({ eventId: String(e.id ?? ''), comp: c });
  }
  return out;
}

// Análisis automático: marcador de hoy → un partido en juego (o acabado) →
// summary y API "core" de ese partido, y qué campos útiles trae cada una.
async function analizarEspn(liga: 'atp' | 'wta') {
  const informe: Record<string, unknown> = { liga };
  const sb = await pedir(`${ESPN_SITE}/${liga}/scoreboard`);
  const lista = partidos(sb.json);
  informe.scoreboard = { status: sb.status, partidos: lista.length, estados: lista.reduce<Record<string, number>>((m, p) => ((m[p.comp.status?.type?.state ?? '?'] = (m[p.comp.status?.type?.state ?? '?'] ?? 0) + 1), m), {}) };
  const elegido = lista.find((p) => p.comp.status?.type?.state === 'in') ?? lista.find((p) => p.comp.status?.type?.state === 'post') ?? lista[0];
  if (!elegido) return { ...informe, conclusion: 'ESPN no devuelve partidos ahora mismo.', muestra: sb.json ?? sb.texto };
  const campos: { ruta: string; valor: unknown }[] = [];
  buscar(elegido.comp, 'partido', campos);
  informe.partido_elegido = { eventId: elegido.eventId, competicionId: elegido.comp.id, estado: elegido.comp.status?.type?.description, campos_utiles_en_scoreboard: campos };
  informe.partido_crudo = elegido.comp;

  const intentos = [
    `${ESPN_SITE}/${liga}/summary?event=${elegido.comp.id}`,
    `${ESPN_SITE}/${liga}/summary?event=${elegido.eventId}&competition=${elegido.comp.id}`,
    `${ESPN_CORE}/leagues/${liga}/events/${elegido.eventId}/competitions/${elegido.comp.id}`,
  ];
  const resultados: unknown[] = [];
  for (const url of intentos) {
    const r = await pedir(url);
    const c: { ruta: string; valor: unknown }[] = [];
    buscar(r.json, '', c);
    resultados.push({ url, status: r.status, campos_utiles: c.slice(0, 60) });
    // En la API "core", las estadísticas de cada jugador van en enlaces aparte.
    if (url.includes('sports.core') && r.json) {
      const comps = ((r.json as { competitors?: { $ref?: string; statistics?: { $ref?: string } }[] }).competitors ?? []).slice(0, 2);
      for (const cp of comps) {
        const ref = cp.statistics?.$ref ?? (cp.$ref ? `${cp.$ref.split('?')[0]}/statistics` : null);
        if (!ref) continue;
        const st = await pedir(ref.replace('http://', 'https://'));
        const c2: { ruta: string; valor: unknown }[] = [];
        buscar(st.json, '', c2);
        resultados.push({ url: ref, status: st.status, campos_utiles: c2.slice(0, 60) });
      }
    }
  }
  informe.detalle = resultados;
  return informe;
}

async function esAdmin(req: NextRequest, admin: ReturnType<typeof crearClienteAdmin>) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return false;
  const { data: p } = await admin.from('perfiles').select('rol').eq('id', data.user.id).single();
  return !!p && p.rol === 'admin';
}

export async function POST(req: NextRequest) {
  let admin;
  try {
    admin = crearClienteAdmin();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  if (!(await esAdmin(req, admin))) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });

  let body: { ruta?: string; fuente?: 'livetennis' | 'espn' | 'espn-auto'; liga?: string } = {};
  try {
    body = await req.json();
  } catch {
    // vacío
  }
  // 26/10 (Iñi): probar ESPN, gratis (como en fútbol y golf).
  if (body.fuente === 'espn-auto') return NextResponse.json(await analizarEspn(body.liga === 'wta' ? 'wta' : 'atp'));
  if (body.fuente === 'espn') {
    const r0 = (body.ruta ?? '/atp/scoreboard').trim();
    if (!r0.startsWith('/') || r0.includes('..') || r0.includes('://')) return NextResponse.json({ error: 'Ruta no válida (p. ej. /atp/scoreboard).' }, { status: 400 });
    const url = r0.startsWith('/core/') ? `${ESPN_CORE}${r0.slice(5)}` : `${ESPN_SITE}${r0}`;
    const r = await pedir(url);
    return NextResponse.json({ url, status: r.status, respuesta: r.json ?? r.texto });
  }

  const clave = process.env.LIVE_TENNIS_API_KEY;
  if (!clave) return NextResponse.json({ error: 'Falta la variable de entorno LIVE_TENNIS_API_KEY en Vercel.' }, { status: 500 });
  const ruta = (body.ruta ?? '/usage').trim();
  if (!ruta.startsWith('/') || ruta.includes('..') || ruta.includes('://')) {
    return NextResponse.json({ error: 'Ruta no válida (tiene que empezar por / , p. ej. /matches).' }, { status: 400 });
  }

  try {
    const r = await fetch(`${BASE}${ruta}`, { headers: { Authorization: `Bearer ${clave}`, Accept: 'application/json' }, cache: 'no-store' });
    const texto = await r.text();
    let json: unknown = null;
    try {
      json = JSON.parse(texto);
    } catch {
      // no es JSON
    }
    return NextResponse.json({ ruta, status: r.status, respuesta: json ?? texto.slice(0, 20000) });
  } catch (err) {
    return NextResponse.json({ ruta, error: (err as Error).message }, { status: 502 });
  }
}
