import { supabase } from '@/lib/supabaseClient';

// ============================================================================
// NOTIFICACIONES PUSH (18/10, Iñi)
// ============================================================================
// Este dispositivo se suscribe con la clave pública VAPID
// (NEXT_PUBLIC_VAPID_PUBLIC_KEY) y la suscripción se guarda en Supabase
// (push_guardar_suscripcion, SQL 52). Las manda /api/cron/notificaciones.
// En iPhone solo funcionan con la app instalada (Añadir a pantalla de inicio).

export type TipoPush = 'recordatorio_dia_antes' | 'recordatorio_hora' | 'gol' | 'fin_partido' | 'ganado' | 'sorteo' | 'social';

export const TIPOS_PUSH: { tipo: TipoPush; titulo: string; desc: string }[] = [
  { tipo: 'recordatorio_dia_antes', titulo: 'El día antes, a las 18:00', desc: 'Mañana empieza la jornada o el torneo: no te olvides de tus equipos.' },
  { tipo: 'recordatorio_hora', titulo: '1 hora antes de empezar', desc: 'Último aviso antes de que cierren las mesas.' },
  { tipo: 'gol', titulo: 'Goles de tus jugadores', desc: 'Fútbol: cada vez que marca uno de tus jugadores.' },
  { tipo: 'fin_partido', titulo: 'Final de partido', desc: 'Fútbol: resultado y puntos de tus jugadores al acabar su partido.' },
  { tipo: 'ganado', titulo: 'Resultados', desc: 'Cuando ganas una mesa o un amistoso.' },
  { tipo: 'sorteo', titulo: 'Sorteo de la liga', desc: 'Cuando se sortean tus rivales en las mesas de la liga.' },
  { tipo: 'social', titulo: 'Amigos', desc: 'Solicitudes de amistad e invitaciones a salas.' },
];
export const TODOS_LOS_TIPOS: TipoPush[] = TIPOS_PUSH.map((t) => t.tipo);

export type EstadoPush = 'no_soportado' | 'ios_sin_instalar' | 'denegado' | 'activo' | 'inactivo';

function esIos(): boolean {
  return typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function instalada(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
}

function claveAUint8(base64: string): Uint8Array {
  const relleno = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + relleno).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registro(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const r = (await navigator.serviceWorker.getRegistration('/sw.js')) ?? (await navigator.serviceWorker.register('/sw.js'));
  return navigator.serviceWorker.ready.then(() => r);
}

export async function estadoPush(): Promise<EstadoPush> {
  if (typeof window === 'undefined') return 'no_soportado';
  if (esIos() && !instalada()) return 'ios_sin_instalar';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'no_soportado';
  if (Notification.permission === 'denied') return 'denegado';
  const r = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await r?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'activo' : 'inactivo';
}

export async function activarPush(): Promise<{ ok: boolean; error?: string }> {
  const clave = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!clave) return { ok: false, error: 'Las notificaciones todavía no están configuradas en el servidor.' };
  if (esIos() && !instalada()) return { ok: false, error: 'En iPhone primero instala la app: Compartir → "Añadir a pantalla de inicio".' };
  if (!('Notification' in window) || !('PushManager' in window)) return { ok: false, error: 'Este navegador no admite notificaciones.' };
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return { ok: false, error: 'No has dado permiso para las notificaciones. Puedes activarlo en los ajustes del navegador.' };
  const r = await registro();
  if (!r) return { ok: false, error: 'No se ha podido preparar el dispositivo.' };
  let sub = await r.pushManager.getSubscription();
  if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveAUint8(clave) as unknown as BufferSource });
  const j = sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
  const { error } = await supabase.rpc('push_guardar_suscripcion', {
    p_endpoint: j.endpoint,
    p_p256dh: j.keys?.p256dh ?? '',
    p_auth: j.keys?.auth ?? '',
    p_dispositivo: navigator.userAgent.slice(0, 180),
  });
  if (error) return { ok: false, error: 'No se ha podido guardar. Inténtalo de nuevo.' };
  return { ok: true };
}

export async function desactivarPush(): Promise<void> {
  const r = await navigator.serviceWorker?.getRegistration('/sw.js');
  const sub = await r?.pushManager.getSubscription();
  if (sub) {
    await supabase.rpc('push_borrar_suscripcion', { p_endpoint: sub.endpoint });
    await sub.unsubscribe().catch(() => {});
  }
}

export async function leerTiposPush(uid: string): Promise<{ activo: boolean; tipos: TipoPush[] }> {
  const { data } = await supabase.from('push_preferencias').select('activo,tipos').eq('usuario_id', uid).maybeSingle();
  const d = data as { activo: boolean; tipos: TipoPush[] } | null;
  return { activo: d?.activo ?? true, tipos: d?.tipos ?? TODOS_LOS_TIPOS };
}

export async function guardarTiposPush(uid: string, activo: boolean, tipos: TipoPush[]): Promise<boolean> {
  const { error } = await supabase.from('push_preferencias').upsert({ usuario_id: uid, activo, tipos, updated_at: new Date().toISOString() }, { onConflict: 'usuario_id' });
  return !error;
}
