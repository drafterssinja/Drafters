import webpush from 'web-push';
import type { crearClienteAdmin } from './supabaseAdmin';
import { claveEquipoLaLiga } from '@/lib/futbolLaLiga';
import { mensajeRecordatorio } from '@/lib/mensajesPush';

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
// dispositivos (push_suscripciones). 19/10: de serie solo 1 y 2 (lo demás se
// enciende en el perfil); textos cortos y variados en lib/mensajesPush.ts.

type Admin = ReturnType<typeof crearClienteAdmin>;
type Tipo = 'recordatorio_dia_antes' | 'recordatorio_hora' | 'gol' | 'fin_partido' | 'ganado' | 'sorteo' | 'social' | 'admin_alta';
type Aviso = { clave: string; usuarioId: string; tipo: Tipo; titulo: string; cuerpo: string; url: string };
type Sub = { id: string; usuario_id: string; endpoint: string; p256dh: string; auth: string };

// 19/10 (Iñi): "de serie solamente… que empieza una nueva jornada y que no te
// olvides de hacer tu equipo. No quiero todavía ninguna de goles y demás".
// El resto se puede encender a mano en el perfil.
const POR_DEFECTO: Tipo[] = ['recordatorio_dia_antes', 'recordatorio_hora'];

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
      .in('deporte', ['futbol', 'golf', 'tenis'])
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
  for (const [competicion, c] of Array.from(inicio.entries())) {
    const ini = new Date(c.inicio);
    const minutos = (ini.getTime() - ahora.getTime()) / 60000;
    const diaInicio = madrid(ini).fecha;
    const manana = madrid(new Date(ahora.getTime() + 24 * 3600e3)).fecha;
    const url = `/v2/${c.deporte}`;
    const hora = horaMadrid(c.inicio);
    // El día antes, a partir de las 18:00 de Madrid: "mañana vuelve…".
    if (diaInicio === manana && hoy.hora >= 18) {
      const m = mensajeRecordatorio('dia_antes', c.deporte, competicion, hora);
      for (const u of usuarios) out.push({ clave: `rd|${competicion}|${u}`, usuarioId: u, tipo: 'recordatorio_dia_antes', titulo: m.titulo, cuerpo: m.cuerpo, url });
    }
    // Una hora antes: "no te olvides de hacer tu equipo". 19/10: solo a quien
    // todavía no tiene ningún equipo en esa jornada / torneo.
    if (minutos > 0 && minutos <= 60) {
      const conEquipo = await usuariosConEquipo(admin, competicion);
      const m = mensajeRecordatorio('una_hora', c.deporte, competicion, hora);
      for (const u of usuarios) {
        if (conEquipo.has(u)) continue;
        out.push({ clave: `rh|${competicion}|${u}`, usuarioId: u, tipo: 'recordatorio_hora', titulo: m.titulo, cuerpo: m.cuerpo, url });
      }
    }
  }
  return out;
}

// Usuarios que ya tienen algún equipo en una jornada / torneo (mesas o amistosos).
async function usuariosConEquipo(admin: Admin, competicion: string): Promise<Set<string>> {
  const out = new Set<string>();
  const equipos = await todas<{ usuario_id: string }>((d, h) => admin.from('equipos').select('usuario_id,salas!inner(competicion)').eq('salas.competicion', competicion).range(d, h));
  equipos.forEach((e) => out.add(e.usuario_id));
  const amistosos = await todas<{ usuario_id: string }>((d, h) => admin.from('amistoso_equipos').select('usuario_id').eq('competicion', competicion).range(d, h));
  amistosos.forEach((e) => out.add(e.usuario_id));
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
// 28/10 (Iñi): tenis — los torneos se abren 6 días antes, sin jugadores; en
// cuanto sale el cuadro, aviso a los que están en sus salas para que hagan el
// equipo. Va con el tipo "recordatorio_dia_antes" (de serie, encendido).
// ---------------------------------------------------------------------------
async function cuadrosDeTenis(admin: Admin): Promise<Aviso[]> {
  const desde = new Date(Date.now() - 6 * 3600e3).toISOString();
  const { data } = await admin.from('tenis_torneos').select('competicion,cuadro_en,desde').gte('cuadro_en', desde);
  const torneos = ((data as { competicion: string; cuadro_en: string; desde: string | null }[] | null) ?? []).filter((t) => !t.desde || new Date(t.desde).getTime() > Date.now());
  const avisos: Aviso[] = [];
  for (const t of torneos) {
    const { data: js } = await admin.from('amistoso_jornadas').select('amistoso_id').eq('competicion', t.competicion);
    const ids = Array.from(new Set(((js as { amistoso_id: string }[] | null) ?? []).map((j) => j.amistoso_id)));
    if (ids.length === 0) continue;
    const parts = await todas<{ usuario_id: string; amistoso_id: string }>((d, h) => admin.from('amistoso_participantes').select('usuario_id,amistoso_id').in('amistoso_id', ids).range(d, h));
    const nombre = t.competicion.replace(/^ATP · |^WTA · /, '');
    for (const u of Array.from(new Set(parts.map((p) => p.usuario_id)))) {
      avisos.push({ clave: `cuadro:${t.competicion}:${u}`, usuarioId: u, tipo: 'recordatorio_dia_antes', titulo: '🎾 Ya ha salido el cuadro', cuerpo: `Ya puedes hacer tu equipo de ${nombre}.`, url: '/v2/tenis?modo=privadas' });
    }
  }
  return avisos;
}

// ---------------------------------------------------------------------------
// 29/10 (Iñi): aviso cuando se registra un usuario nuevo. De momento SOLO para
// él (no sale en las preferencias de nadie ni se puede activar).
// ---------------------------------------------------------------------------
// 29/10: "cuando hablo de mí en Drafters, siempre es porrasgolfspain@gmail.com" (se deja también la forma con "e").
const AVISO_ALTAS = ['porrasgolfspain@gmail.com', 'porrasgolfespain@gmail.com'];

async function altasNuevas(admin: Admin): Promise<Aviso[]> {
  const { data: dest } = await admin.from('perfiles').select('id,email').in('email', AVISO_ALTAS);
  const destinatarios = ((dest as { id: string }[] | null) ?? []).map((d) => d.id);
  if (destinatarios.length === 0) {
    // Por si el perfil no tiene el email copiado: se busca en las cuentas.
    const { data: us } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of us?.users ?? []) if (u.email && AVISO_ALTAS.includes(u.email.toLowerCase())) destinatarios.push(u.id);
  }
  if (destinatarios.length === 0) return [];
  const desde = new Date(Date.now() - 2 * 3600e3).toISOString();
  const { data } = await admin.from('perfiles').select('id,nombre,apellido,nombre_usuario,created_at').gte('created_at', desde).order('created_at');
  const nuevos = (data as { id: string; nombre: string | null; apellido: string | null; nombre_usuario: string | null }[] | null) ?? [];
  const { count } = await admin.from('perfiles').select('id', { count: 'exact', head: true });
  const avisos: Aviso[] = [];
  for (const n of nuevos) {
    if (destinatarios.includes(n.id)) continue;
    const quien = [n.nombre, n.apellido].filter(Boolean).join(' ').trim();
    for (const d of destinatarios) {
      avisos.push({
        clave: `alta:${n.id}:${d}`,
        usuarioId: d,
        tipo: 'admin_alta',
        titulo: '👤 Nuevo usuario en Drafters',
        cuerpo: `${n.nombre_usuario ? `@${n.nombre_usuario}` : quien || 'Alguien'}${quien && n.nombre_usuario ? ` (${quien})` : ''} se acaba de registrar.${count ? ` Ya sois ${count}.` : ''}`,
        url: '/admin/usuarios',
      });
    }
  }
  return avisos;
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
    // El aviso de altas va siempre (solo lo reciben las cuentas de AVISO_ALTAS).
    if (t === 'admin_alta') return true;
    if (p && !p.activo) return false;
    return (p?.tipos ?? POR_DEFECTO).includes(t);
  };
  const usuarios = Array.from(subsDe.keys());

  const lotes = await Promise.all([recordatorios(admin, usuarios), goles(admin), finalesDePartido(admin), notificacionesApp(admin), cuadrosDeTenis(admin).catch(() => [] as Aviso[]), altasNuevas(admin).catch(() => [] as Aviso[])]);
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
