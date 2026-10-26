import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import { deportesTenis } from '@/lib/server/oddsApi';
import { rankingEspn } from '@/lib/server/tenisEspn';

// ============================================================================
// DIAGNÓSTICO — LIVE TENNIS API (13/10, antes de montar el tenis en directo)
// ============================================================================
// Llama a un endpoint de Live Tennis API con la clave de la variable de entorno
// LIVE_TENNIS_API_KEY y devuelve la respuesta CRUDA, para ver qué campos trae
// de verdad cada plan antes de construir la puntuación. Solo admin. La clave
// nunca sale al navegador.
export const maxDuration = 60;

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

// 27/10: Sofascore (sin clave). Mira si responde desde Vercel y si trae aces y
// dobles faltas de un partido en juego.
async function analizarSofascore() {
  const SF = 'https://api.sofascore.com/api/v1';
  const vivos = await pedir(`${SF}/sport/tennis/events/live`);
  const eventos = ((vivos.json as { events?: { id?: number; homeTeam?: { name?: string }; awayTeam?: { name?: string }; tournament?: { name?: string } }[] })?.events ?? []);
  const informe: Record<string, unknown> = { en_juego: { status: vivos.status, partidos: eventos.length, muestra: eventos.length ? undefined : vivos.texto.slice(0, 500) } };
  const ev = eventos[0];
  if (!ev?.id) return { ...informe, conclusion: vivos.status === 403 ? 'Sofascore bloquea las peticiones desde el servidor (403).' : 'No hay partidos en juego ahora o no responde.' };
  informe.partido = `${ev.homeTeam?.name} vs ${ev.awayTeam?.name} · ${ev.tournament?.name}`;
  const st = await pedir(`${SF}/event/${ev.id}/statistics`);
  const c: { ruta: string; valor: unknown }[] = [];
  buscar(st.json, '', c);
  const texto = JSON.stringify(st.json ?? '');
  informe.estadisticas = { status: st.status, trae_aces: /aces/i.test(texto), trae_dobles_faltas: /double ?faults/i.test(texto), campos_utiles: c.slice(0, 40) };
  return informe;
}

// 27/10: cuotas de fútbol que ve ESPN en los próximos días (para saber por qué
// una jornada no se crea todavía).
async function cuotasFutbol(slug: string) {
  const site = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}`;
  const hoy = new Date();
  const fin = new Date(hoy.getTime() + 16 * 86400000);
  const f = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const sb = await pedir(`${site}/scoreboard?dates=${f(hoy)}-${f(fin)}&limit=100`);
  const evs = ((sb.json as { events?: any[] })?.events ?? []).slice(0, 25);
  const filas: unknown[] = [];
  for (const e of evs) {
    const comp = e.competitions?.[0] ?? {};
    const sm = await pedir(`${site}/summary?event=${e.id}`);
    const core = await pedir(`https://sports.core.api.espn.com/v2/sports/soccer/leagues/${slug}/events/${e.id}/competitions/${e.id}/odds`);
    const items = ((core.json as { items?: any[] })?.items ?? []);
    filas.push({
      partido: e.name, fecha: e.date, hora_confirmada: comp.timeValid !== false,
      cuotas_calendario: (comp.odds ?? []).length,
      cuotas_resumen: ((sm.json as any)?.odds ?? []).length, pickcenter: ((sm.json as any)?.pickcenter ?? []).length,
      cuotas_core: { status: core.status, casas: items.length, primera: items[0] ? JSON.stringify(items[0]).slice(0, 400) : null },
    });
  }
  return { status: sb.status, partidos: evs.length, filas };
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

  let body: { ruta?: string; fuente?: 'livetennis' | 'espn' | 'espn-auto' | 'sofascore' | 'cuotas-futbol' | 'oddsapi' | 'ranking'; liga?: string } = {};
  try {
    body = await req.json();
  } catch {
    // vacío
  }
  // 26/10 (Iñi): probar ESPN, gratis (como en fútbol y golf).
  // 28/10: The Odds API — torneos de tenis que tiene ahora y créditos que quedan (no gasta créditos).
  if (body.fuente === 'oddsapi') {
    try {
      const r = await deportesTenis();
      return NextResponse.json({ creditos_restantes: r.restantes, creditos_usados: r.usados, torneos_activos: r.deportes.filter((d) => d.active).map((d) => `${d.key} · ${d.title}${d.has_outrights ? ' · CUOTA AL GANADOR' : ' · cuotas de partidos'}`), otros: r.deportes.filter((d) => !d.active).length });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }
  // 28/10: ¿saca la app sola el ranking de ESPN?
  if (body.fuente === 'ranking') {
    const liga = body.liga === 'wta' ? 'wta' : 'atp';
    const r = await rankingEspn(liga);
    const lista = Array.from(r.values()).sort((x, y) => x.puesto - y.puesto);
    return NextResponse.json({ liga, jugadores_con_ranking: lista.length, conclusion: lista.length >= 20 ? 'OK: la app coge el ranking sola de ESPN.' : 'ESPN no da el ranking: habría que cargarlo en Admin → Rankings.', primeros: lista.slice(0, 15).map((x) => `${x.puesto}. ${x.nombre}`) });
  }
  if (body.fuente === 'sofascore') return NextResponse.json(await analizarSofascore());
  if (body.fuente === 'cuotas-futbol') return NextResponse.json(await cuotasFutbol(body.liga === 'uefa.champions' ? 'uefa.champions' : 'esp.1'));
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
