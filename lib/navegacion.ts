// ============================================================================
// NAVEGACIÓN "ATRÁS" POR ORDEN DE PANTALLAS (07/10)
// ============================================================================
// Pedido de Iñi (con vídeo): las flechas de volver se metían en un bucle
// (Sala → Crea tu equipo → flecha → Sala → flecha → Crea tu equipo...) porque
// usaban el historial del navegador mezclado con empujes de ruta nuevos. Ahora
// cada pantalla tiene un "padre" fijo y la flecha siempre lleva a él:
//
//   Inicio ← (nada)
//   Mesas Drafters → Inicio;  Salas → Mesas;  Sala → Salas (del deporte);
//   Clasificación / Crear equipo → Sala
//   Porras → Inicio;  Porra → Porras;  Clasificación / Crear equipo → Porra
//   Cuenta, Notificaciones, Recargar → Inicio;  Admin → Cuenta;  Admin/* → Admin
//   Login → portada;  Registro, Recuperar, Restablecer, Verificar → Login
//
// Dentro de la elección de equipo, la flecha va paso a paso (confirmar →
// elegir → cómo puntúan → sala), ver app/{salas,porras}/[id]/crear-equipo.
export function rutaAnterior(pathname: string | null): string {
  const p = (pathname ?? '').replace(/\/+$/, '') || '/';
  if (p === '/inicio') return '/inicio';
  if (p === '/mesas') return '/inicio';
  if (p === '/salas') return '/mesas';
  let m = p.match(/^\/salas\/([^/]+)\/(clasificacion|crear-equipo)$/);
  if (m) return `/salas/${m[1]}`;
  if (/^\/salas\/[^/]+$/.test(p)) return '/salas';
  if (p === '/porras') return '/inicio';
  m = p.match(/^\/porras\/([^/]+)\/(clasificacion|crear-equipo)$/);
  if (m) return `/porras/${m[1]}`;
  if (/^\/porras\/[^/]+$/.test(p)) return '/porras';
  if (p === '/cuenta' || p === '/notificaciones' || p === '/recargar') return '/inicio';
  if (p === '/admin') return '/cuenta';
  if (/^\/admin\/pagos-pendientes\/[^/]+\/[^/]+$/.test(p)) return '/admin/pagos-pendientes';
  if (/^\/admin\/porras-futbol\/[^/]+$/.test(p)) return '/admin/porras-futbol';
  if (p.startsWith('/admin/')) return '/admin';
  if (p === '/login') return '/';
  if (p === '/registro' || p === '/recuperar' || p === '/restablecer' || p === '/verificar') return '/login';
  return '/inicio';
}

// ----------------------------------------------------------------------------
// Origen de una sala / porra (07/10): se puede llegar a una sala desde Inicio,
// Mesas Drafters o Salas; la flecha tiene que volver a LA PANTALLA POR LA QUE
// SE ENTRÓ, no a una fija. Cada pantalla de lista se recuerda al mostrarse
// (sessionStorage, solo en este navegador/pestaña) y el detalle vuelve a ella.
// ----------------------------------------------------------------------------
const CLAVE_ORIGEN = 'drafters_ultima_lista';
const LISTAS_SALA = ['/inicio', '/mesas', '/salas'];
const LISTAS_PORRA = ['/inicio', '/porras'];

export function recordarLista(pathname: string | null, search: string): void {
  try {
    const p = (pathname ?? '').replace(/\/+$/, '');
    if (![...LISTAS_SALA, ...LISTAS_PORRA].includes(p)) return;
    window.sessionStorage.setItem(CLAVE_ORIGEN, p + (p === '/salas' ? search : ''));
  } catch {
    /* sin sessionStorage: se usa la ruta padre fija */
  }
}

export function origenGuardado(pathname: string | null): string | null {
  try {
    const p = (pathname ?? '').replace(/\/+$/, '');
    const listas = /^\/salas\/[^/]+$/.test(p) ? LISTAS_SALA : /^\/porras\/[^/]+$/.test(p) ? LISTAS_PORRA : null;
    if (!listas) return null;
    const guardada = window.sessionStorage.getItem(CLAVE_ORIGEN);
    if (!guardada) return null;
    return listas.includes(guardada.split('?')[0]) ? guardada : null;
  } catch {
    return null;
  }
}
