import webpush from 'web-push';
import type { crearClienteAdmin } from './supabaseAdmin';
import { claveEquipoLaLiga } from '@/lib/futbolLaLiga';

// ============================================================================
// NOTIFICACIONES PUSH — QUÉ SE MANDA Y CUÁNDO (18/10, Iñi)
// ============================================================================
// Lo llama /api/cron/notificaciones cada minuto (pg_cron de Supabase, igual que
// las sincronizaciones). Cada aviso tiene una clave única en push_enviados,
// así que nunca se manda dos veces aunque el cron se repita o se solape.
//   1. Recordatorio el día antes de que empiece una jornada / torneo, a las 18:00
//      (hora de Madrid): "mañana empieza… no te olvides de tus equipos".
//   2. Recordatorio 1 hora antes de empezar (con frases que van cambiando).
//   3. Fútbol: gol de uno de tus jugadores.
//   4. Fútbol: final del partido de tus jugadores (resultado y sus puntos).
//   5. Copia como push de las notificaciones de la app: has ganado una mesa o
//      un amistoso (resultado), sorteo de rivales, amigos e invitaciones.
// Cada usuario elige qué tipos quiere (push_preferencias) y en qué
// dispositivos (push_suscripciones).

type Admin = ReturnType<typeof crearClienteAdmin>;
type Tipo = 'recordatorio_dia_antes' | 'recordatorio_hora' | 'gol' | 'fin_partido' | 'ganado' | 'sorteo' | 'social';
type Aviso = { clave: string; usuarioId: string; tipo: Tipo; titulo: string; cuerpo: string; url: string };
type Sub = { id: string; usuario_id: string; endpoint: string; p256dh: string; auth: string };

const TODOS: Tipo[] = ['recordatorio_dia_antes', 'recordatorio_hora', 'gol', 'fin_partido', 'ganado', 'sorteo', 'social'];

function madrid(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) % 24, minuto: Number(p.minute) };
}
function horaMadrid(iso: string): string {
  return new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
function nombreBonito(competicion: string): string {
  return competicion.replace(/\s*-\s*Jornada\s*/i, ' · Jornada ').replace('La Liga', 'LaLiga').replace('Champions League', 'Champions');
}
function jornadaCorta(competicion: string): string {
  const n = competicion.match(/Jornada\s*(\d+)/i)?.[1];
  const liga = /champions/i.test(competicion) ? 'Champions' : 'LaLiga';
  return n ? `la Jornada ${n} de ${liga}` : competicion;
}
const al = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

async function todas<T>(consulta: (d: number, h: number) => PromiseLike<{ data: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let d = 0; ; d += 1000) {
    const { data } = await consulta(d, d + 999);
    const lote = (data as T[]) ?? [];
    out.push(...lote);
    if (lote.length < 1000) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1 y 2. Recordatorios
// ---------------------------------------------------------------------------
async function recordatorios(admin: Admin, usuarios: string[]): Promise<Aviso[]> {
  const ahora = new Date();
  const hasta = new Date(ahora.getTime() + 30 * 3600e3).toISOString();
  const salas = await todas<{ competicion: string; deporte: string; fecha_limite_inscripcion: string }>((d, h) =>
    admin
      .from('salas')
      .select('competicion,deporte,fecha_limite_inscripcion')
      .in('deporte', ['futbol', 'golf'])
      .is('tramo', null)
      .gt('fecha_limite_inscripcion', ahora.toISOString())
      .lte('fecha_limite_inscripcion', hasta)
      .range(d, h)
  );
  const inicio = new Map<string, { deporte: string; inicio: string }>();
  for (const s of salas) {
    const prev = inicio.get(s.competicion);
    if (!prev || s.fecha_limite_inscripcion < prev.inicio) inicio.set(s.competicion, { deporte: s.deporte, inicio: s.fecha_limite_inscripcion });
  }
  const hoy = madrid(ahora);
  const out: Aviso[] = [];
  inicio.forEach((c, competicion) => {
    const ini = new Date(c.inicio);
    const minutos = (ini.getTime() - ahora.getTime()) / 60000;
    const diaInicio = madrid(ini).fecha;
    const manana = madrid(new Date(ahora.getTime() + 24 * 3600e3)).fecha;
    const golf = c.deporte === 'golf';
    const url = `/v2/${c.deporte}`;
    // El día antes, a partir de las 18:00 de Madrid.
    if (diaInicio === manana && hoy.hora >= 18) {
      for (const u of usuarios)
        out.push({
          clave: `rd|${competicion}|${u}`,
          usuarioId: u,
          tipo: 'recordatorio_dia_antes',
          titulo: golf ? `⛳ Mañana empieza el ${competicion}` : `⚽ Mañana empieza ${jornadaCorta(competicion)}`,
          cuerpo: golf
            ? `Primera salida a las ${horaMadrid(c.inicio)}. No te olvides de elegir a tus golfistas.`
            : `Primer partido a las ${horaMadrid(c.inicio)}. No te olvides de hacer tus equipos.`,
          url,
        });
    }
    // Una hora antes (frases distintas para no cansar).
    if (minutos > 0 && minutos <= 60) {
      const futbol = [
        ['⏰ ¡Última llamada!', `En 1 hora arranca ${jornadaCorta(competicion)} y tu once sigue en el vestuario. ¿Lo sacas?`],
        ['🔥 Se calienta el banquillo', `Queda 1 hora para ${jornadaCorta(competicion)}: último momento para fichar.`],
        ['📋 El míster te espera', `A las ${horaMadrid(c.inicio)} cierra ${nombreBonito(competicion)}. Mete tu alineación antes del pitido.`],
        ['🏟️ Abren las puertas del estadio', `En una hora rueda el balón en ${nombreBonito(competicion)}. ¿Tienes ya tu equipo?`],
      ];
      const golfFrases = [
        ['⛳ En 1 hora salen al tee', `El ${competicion} empieza en 1 hora. Elige tus 5 golfistas antes de la primera salida.`],
        ['🏌️ Calentando en el driving range', `Queda 1 hora para el ${competicion}. ¿Ya tienes a tus 5?`],
        ['🕐 Último hoyo para fichar', `A las ${horaMadrid(c.inicio)} cierra el ${competicion}. Que no te pille el tee de salida.`],
      ];
      for (const u of usuarios) {
        const [t, b] = al(golf ? golfFrases : futbol);
        out.push({ clave: `rh|${competicion}|${u}`, usuarioId: u, tipo: 'recordatorio_hora', titulo: t, cuerpo: b, url });
      }
    }
  });
  return out;
}

// Jugadores de cada usuario en una competición de fútbol (mesas en juego y amistosos).
async function jugadoresPorUsuario(admin: Admin, competicion: string): Promise<Map<string, Set<string>>> {
  const m = new Map<string, Set<string>>();
  const meter = (u: string, ids: unknown) => {
    if (!Array.isArray(ids)) return;
    const s = m.get(u) ?? new Set<string>();
    ids.forEach((x) => typeof x === 'string' && s.add(x));
    m.set(u, s);
  };
  const equipos = await todas<{ usuario_id: string; jugadores: unknown; inscripciones: { estado: string }[] }>((d, h) =>
    admin.from('equipos').select('usuario_id,jugadores,inscripciones(estado),salas!inner(competicion)').eq('salas.competicion', competicion).range(d, h)
  );
  equipos.filter((e) => e.inscripciones?.some((i) => i.estado !== 'reembolsada')).forEach((e) => meter(e.usuario_id, e.jugadores));
  const amistosos = await todas<{ usuario_id: string; jugadores: unknown }>((d, h) => admin.from('amistoso_equipos').select('usuario_id,jugadores').eq('competicion', competicion).range(d, h));
  amistosos.forEach((e) => meter(e.usuario_id, e.jugadores));
  return m;
}

// ---------------------------------------------------------------------------
// 3. Goles de tus jugadores
// ---------------------------------------------------------------------------
async function goles(admin: Admin): Promise<Aviso[]> {
  const desde = new Date(Date.now() - 20 * 60000).toISOString();
  const { data } = await admin.from('futbol_eventos').select('id,competicion,jugador_id,jugador_nombre,minuto,detalle,tipo').in('tipo', ['gol', 'penalti_marcado']).gt('creado_en', desde);
  const eventos = (data as { id: string; competicion: string; jugador_id: string; jugador_nombre: string; minuto: string | null; detalle: string | null }[]) ?? [];
  const out: Aviso[] = [];
  const porComp = new Map<string, typeof eventos>();
  eventos.forEach((e) => porComp.set(e.competicion, [...(porComp.get(e.competicion) ?? []), e]));
  for (const [competicion, evs] of Array.from(porComp.entries())) {
    const mapa = await jugadoresPorUsuario(admin, competicion);
    for (const e of evs) {
      mapa.forEach((ids, u) => {
        if (!ids.has(e.jugador_id)) return;
        out.push({
          clave: `gol|${e.id}|${u}`,
          usuarioId: u,
          tipo: 'gol',
          titulo: `⚽ ¡GOL de ${e.jugador_nombre}!`,
          cuerpo: `${e.minuto ? `Minuto ${e.minuto.replace(/'$/, '')}` : 'Acaba de marcar'}${e.detalle ? ` (${e.detalle})` : ''} · suma para tu equipo en ${nombreBonito(competicion)}.`,
          url: `/v2/futbol`,
        });
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. Final del partido de tus jugadores
// ---------------------------------------------------------------------------
async function finalesDePartido(admin: Admin): Promise<Aviso[]> {
  const desde = new Date(Date.now() - 30 * 60000).toISOString();
  const { data } = await admin
    .from('futbol_partidos_jornada')
    .select('competicion,clave_local,clave_visitante,equipo_local,equipo_visitante,goles_local,goles_visitante,estado,finalizado_visto_en')
    .eq('estado', 'finalizado')
    .gt('finalizado_visto_en', desde);
  const partidos = (data as { competicion: string; clave_local: string; clave_visitante: string; equipo_local: string; equipo_visitante: string; goles_local: number | null; goles_visitante: number | null }[]) ?? [];
  const out: Aviso[] = [];
  const porComp = new Map<string, typeof partidos>();
  partidos.forEach((p) => porComp.set(p.competicion, [...(porComp.get(p.competicion) ?? []), p]));
  for (const [competicion, ps] of Array.from(porComp.entries())) {
    const [mapa, jugs, pts] = await Promise.all([
      jugadoresPorUsuario(admin, competicion),
      todas<{ id: string; nombre: string; equipo_real: string | null }>((d, h) => admin.from('jugadores').select('id,nombre,equipo_real').eq('competicion', competicion).range(d, h)),
      todas<{ jugador_id: string; puntos_total: number }>((d, h) => admin.from('futbol_puntos_jugador').select('jugador_id,puntos_total').eq('competicion', competicion).range(d, h)),
    ]);
    const jug = new Map(jugs.map((j) => [j.id, j]));
    const puntos = new Map(pts.map((p) => [p.jugador_id, Number(p.puntos_total) || 0]));
    for (const p of ps) {
      const marcador = `${p.equipo_local} ${p.goles_local ?? 0}-${p.goles_visitante ?? 0} ${p.equipo_visitante}`;
      mapa.forEach((ids, u) => {
        const mios = Array.from(ids)
          .map((id) => jug.get(id))
          .filter((j): j is { id: string; nombre: string; equipo_real: string | null } => !!j && [p.clave_local, p.clave_visitante].includes(claveEquipoLaLiga(j.equipo_real)));
        if (mios.length === 0) return;
        // ¿Ha ganado el equipo de tus jugadores?
        const gl = p.goles_local ?? 0;
        const gv = p.goles_visitante ?? 0;
        const ganador = gl === gv ? null : gl > gv ? p.clave_local : p.clave_visitante;
        const ganaron = ganador && mios.some((j) => claveEquipoLaLiga(j.equipo_real) === ganador);
        out.push({
          clave: `fin|${competicion}|${p.clave_local}|${p.clave_visitante}|${u}`,
          usuarioId: u,
          tipo: 'fin_partido',
          titulo: `🏁 Final: ${marcador}${ganaron ? ' ✅' : ''}`,
          cuerpo: `${ganaron ? '¡Victoria! ' : ''}Tus jugadores: ${mios.map((j) => `${j.nombre} ${puntos.get(j.id) ?? 0} pts`).join(' · ')} (puntos provisionales)`,
          url: `/v2/futbol`,
        });
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. Notificaciones de la app como push
// ---------------------------------------------------------------------------
async function notificacionesApp(admin: Admin): Promise<Aviso[]> {
  const desde = new Date(Date.now() - 15 * 60000).toISOString();
  const { data } = await admin.from('notificaciones').select('id,usuario_id,tipo,titulo,mensaje,link').gt('created_at', desde).in('tipo', ['resultado', 'sorteo', 'reembolsado', 'amistad', 'invitacion']);
  const filas = (data as { id: string; usuario_id: string; tipo: string; titulo: string; mensaje: string; link: string | null }[]) ?? [];
  return filas.map((n) => ({
    clave: `n|${n.id}`,
    usuarioId: n.usuario_id,
    tipo: (n.tipo === 'resultado' ? 'ganado' : n.tipo === 'sorteo' || n.tipo === 'reembolsado' ? 'sorteo' : 'social') as Tipo,
    titulo: n.titulo,
    cuerpo: n.mensaje,
    url: n.link || '/notificaciones',
  }));
}

// ---------------------------------------------------------------------------
export async function enviarNotificacionesPush(admin: Admin): Promise<{ avisos: number; enviados: number; fallidos: number; error?: string }> {
  const publica = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privada = process.env.VAPID_PRIVATE_KEY;
  if (!publica || !privada) return { avisos: 0, enviados: 0, fallidos: 0, error: 'Faltan NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY en Vercel.' };
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://drafters.es', publica, privada);

  const subs = await todas<Sub>((d, h) => admin.from('push_suscripciones').select('id,usuario_id,endpoint,p256dh,auth').range(d, h));
  if (subs.length === 0) return { avisos: 0, enviados: 0, fallidos: 0 };
  const prefs = await todas<{ usuario_id: string; activo: boolean; tipos: Tipo[] }>((d, h) => admin.from('push_preferencias').select('usuario_id,activo,tipos').range(d, h));
  const pref = new Map(prefs.map((p) => [p.usuario_id, p]));
  const subsDe = new Map<string, Sub[]>();
  subs.forEach((s) => subsDe.set(s.usuario_id, [...(subsDe.get(s.usuario_id) ?? []), s]));
  const quiere = (u: string, t: Tipo) => {
    const p = pref.get(u);
    if (!subsDe.has(u)) return false;
    if (p && !p.activo) return false;
    return (p?.tipos ?? TODOS).includes(t);
  };
  const usuarios = Array.from(subsDe.keys());

  const lotes = await Promise.all([recordatorios(admin, usuarios), goles(admin), finalesDePartido(admin), notificacionesApp(admin)]);
  const avisos = lotes.flat().filter((a) => quiere(a.usuarioId, a.tipo));
  if (avisos.length === 0) return { avisos: 0, enviados: 0, fallidos: 0 };

  // Se reservan las claves: solo se manda lo que no estaba ya enviado.
  const nuevas = new Set<string>();
  for (let i = 0; i < avisos.length; i += 500) {
    const { data } = await admin
      .from('push_enviados')
      .upsert(avisos.slice(i, i + 500).map((a) => ({ clave: a.clave, usuario_id: a.usuarioId })), { onConflict: 'clave', ignoreDuplicates: true })
      .select('clave');
    ((data as { clave: string }[]) ?? []).forEach((r) => nuevas.add(r.clave));
  }
  const aEnviar = avisos.filter((a) => nuevas.has(a.clave));

  let enviados = 0;
  let fallidos = 0;
  const caducadas: string[] = [];
  await Promise.all(
    aEnviar.flatMap((a) =>
      (subsDe.get(a.usuarioId) ?? []).map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ titulo: a.titulo, cuerpo: a.cuerpo, url: a.url, tag: a.clave.slice(0, 60) }),
            { TTL: 3600 }
          );
          enviados++;
        } catch (err) {
          fallidos++;
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) caducadas.push(s.id);
        }
      })
    )
  );
  if (caducadas.length) await admin.from('push_suscripciones').delete().in('id', caducadas);
  // Limpieza de vez en cuando.
  if (Math.random() < 0.02) await admin.from('push_enviados').delete().lt('enviado_en', new Date(Date.now() - 10 * 86400e3).toISOString());
  return { avisos: aEnviar.length, enviados, fallidos };
}
