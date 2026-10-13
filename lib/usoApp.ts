'use client';

import { supabase } from '@/lib/supabaseClient';

// ============================================================================
// ESTADÍSTICAS DE LA APP EN EL MÓVIL (13/10, pedido de Iñi)
// ============================================================================
// Apunta en app_uso_eventos (30_sql_estadisticas_app_movil_13-10.sql):
//   - 'instalada'  → Android avisa de la instalación (appinstalled)
//   - 'apertura'   → Drafters abierto desde el icono (pantalla completa); como
//                    mucho una cada 30 min por móvil, para no inflar la cifra
//   - 'clic_boton' → se ha pulsado "Añadir a iPhone / Android"
// Solo con sesión iniciada. Si no hay sesión, se guarda pendiente en el móvil y
// se manda la próxima vez. Nunca rompe nada si falla.

export type PlataformaApp = 'ios' | 'android' | 'otro';
type TipoUso = 'instalada' | 'apertura' | 'clic_boton';

const CLAVE_PENDIENTES = 'drafters_uso_app_pendiente';
const CLAVE_ULTIMA_APERTURA = 'drafters_uso_app_ultima_apertura';
const MINUTOS_ENTRE_APERTURAS = 30;

export function plataformaActual(): PlataformaApp {
  if (typeof navigator === 'undefined') return 'otro';
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'otro';
}

export function abiertaDesdeIcono(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function leerPendientes(): { tipo: TipoUso; plataforma: PlataformaApp; en: string }[] {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_PENDIENTES) ?? '[]');
  } catch {
    return [];
  }
}

function guardarPendientes(l: { tipo: TipoUso; plataforma: PlataformaApp; en: string }[]) {
  try {
    localStorage.setItem(CLAVE_PENDIENTES, JSON.stringify(l.slice(-20)));
  } catch {
    // sin almacenamiento
  }
}

export async function registrarUsoApp(tipo: TipoUso): Promise<void> {
  try {
    const plataforma = plataformaActual();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      if (tipo !== 'apertura') guardarPendientes([...leerPendientes(), { tipo, plataforma, en: new Date().toISOString() }]);
      return;
    }
    const filas = [...leerPendientes().map((p) => ({ usuario_id: session.user.id, plataforma: p.plataforma, tipo: p.tipo, creado_en: p.en })), { usuario_id: session.user.id, plataforma, tipo }];
    const { error } = await supabase.from('app_uso_eventos').insert(filas);
    if (!error) guardarPendientes([]);
  } catch {
    // las estadísticas nunca deben romper la web
  }
}

/** Apunta una apertura desde el icono, como mucho una cada 30 min en este móvil. */
export async function registrarAperturaSiToca(): Promise<void> {
  if (!abiertaDesdeIcono()) return;
  try {
    const ultima = Number(localStorage.getItem(CLAVE_ULTIMA_APERTURA) ?? 0);
    if (Date.now() - ultima < MINUTOS_ENTRE_APERTURAS * 60000) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return; // se apuntará cuando inicie sesión (vuelve a montarse el layout)
    localStorage.setItem(CLAVE_ULTIMA_APERTURA, String(Date.now()));
  } catch {
    // sin almacenamiento: se apunta igual
  }
  await registrarUsoApp('apertura');
}

// ============================================================================
// ENTRADAS CON SESIÓN GUARDADA (13/10, pedido de Iñi)
// ============================================================================
// Al abrir Drafters (sobre todo desde el icono) ya no se pide usuario y
// contraseña, así que antes no quedaba registrado ningún "login". Ahora cada
// entrada con la sesión ya iniciada se apunta en el Registro de actividad como
// 'login' con detalle { via: 'sesion_guardada', desde: 'app' | 'navegador',
// plataforma }. Como mucho una cada 30 min por móvil/navegador. El login con
// usuario y contraseña marca también la hora, para no contar dos veces.
const CLAVE_ULTIMA_ENTRADA = 'drafters_ultima_entrada';
const MINUTOS_ENTRE_ENTRADAS = 30;

export function marcarEntradaRegistrada(): void {
  try {
    localStorage.setItem(CLAVE_ULTIMA_ENTRADA, String(Date.now()));
  } catch {
    // nada
  }
}

export async function registrarEntradaConSesionGuardada(): Promise<void> {
  try {
    const ultima = Number(localStorage.getItem(CLAVE_ULTIMA_ENTRADA) ?? 0);
    if (Date.now() - ultima < MINUTOS_ENTRE_ENTRADAS * 60000) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    marcarEntradaRegistrada();
    await supabase.rpc('registrar_evento_actividad', {
      p_tipo: 'login',
      p_detalle: { via: 'sesion_guardada', desde: abiertaDesdeIcono() ? 'app' : 'navegador', plataforma: plataformaActual() },
    });
  } catch {
    // nunca debe romper la web
  }
}
