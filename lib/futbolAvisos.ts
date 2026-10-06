// ============================================================================
// AVISOS DE FÚTBOL EN LA CLASIFICACIÓN DE LAS MESAS DRAFTERS (07/10)
// ============================================================================
// Pedido de Iñi: lo mismo que en golf (aviso de 5 segundos con sonido cuando
// un jugador hace birdie/bogey, y pestaña "Eventos") pero para fútbol — gol,
// penalti, parada, tarjeta... — de los jugadores del EQUIPO del usuario en esa
// mesa, y con las alertas elegibles: cada usuario escoge cuáles quiere recibir
// (se guarda en su cuenta, tabla preferencias_avisos_futbol). Al principio solo
// están activadas las de goles y penaltis; las demás están desactivadas pero se
// pueden activar.
//
// Los eventos los escribe el cron de sincronización con ESPN
// (lib/server/sincronizarFutbolEspn.ts) en la tabla futbol_eventos; la pantalla
// solo los lee cada 20 segundos.

export type TipoAvisoFutbol =
  | 'gol'
  | 'gol_propia'
  | 'penalti_marcado'
  | 'penalti_fallado'
  | 'penalti_parado'
  | 'parada'
  | 'amarilla'
  | 'roja'
  | 'asistencia'
  | 'doblete'
  | 'hat_trick'
  | 'porteria_cero'
  | 'victoria_portero'
  | 'fin_partido';

export type InfoTipoAviso = {
  tipo: TipoAvisoFutbol;
  etiqueta: string;
  icono: string;
  grupo: 'goles' | 'otras';
  porDefecto: boolean;
  color: string;
};

export const TIPOS_AVISO_FUTBOL: InfoTipoAviso[] = [
  { tipo: 'gol', etiqueta: 'Gol', icono: '⚽', grupo: 'goles', porDefecto: true, color: '#3DDC84' },
  { tipo: 'gol_propia', etiqueta: 'Gol en propia puerta', icono: '🥅', grupo: 'goles', porDefecto: true, color: '#FF5C5C' },
  { tipo: 'penalti_marcado', etiqueta: 'Penalti marcado', icono: '🎯', grupo: 'goles', porDefecto: true, color: '#3DDC84' },
  { tipo: 'penalti_fallado', etiqueta: 'Penalti fallado', icono: '❌', grupo: 'goles', porDefecto: true, color: '#FF5C5C' },
  { tipo: 'penalti_parado', etiqueta: 'Penalti parado (tu portero)', icono: '🧤', grupo: 'goles', porDefecto: true, color: '#3DDC84' },
  { tipo: 'parada', etiqueta: 'Parada del portero', icono: '🧤', grupo: 'otras', porDefecto: false, color: '#3DDC84' },
  { tipo: 'amarilla', etiqueta: 'Tarjeta amarilla', icono: '🟨', grupo: 'otras', porDefecto: false, color: '#F5D547' },
  { tipo: 'roja', etiqueta: 'Tarjeta roja', icono: '🟥', grupo: 'otras', porDefecto: false, color: '#FF5C5C' },
  { tipo: 'asistencia', etiqueta: 'Asistencia', icono: '🅰️', grupo: 'otras', porDefecto: false, color: '#3DDC84' },
  { tipo: 'doblete', etiqueta: 'Doblete', icono: '✌️', grupo: 'otras', porDefecto: false, color: '#F0B94D' },
  { tipo: 'hat_trick', etiqueta: 'Hat-trick', icono: '🎩', grupo: 'otras', porDefecto: false, color: '#F0B94D' },
  { tipo: 'porteria_cero', etiqueta: 'Portería a cero (al terminar)', icono: '🛡️', grupo: 'otras', porDefecto: false, color: '#3DDC84' },
  { tipo: 'victoria_portero', etiqueta: 'Victoria del portero (al terminar)', icono: '🏆', grupo: 'otras', porDefecto: false, color: '#3DDC84' },
  { tipo: 'fin_partido', etiqueta: 'Fin del partido de un jugador', icono: '🏁', grupo: 'otras', porDefecto: false, color: '#9AA5A0' },
];

export const TIPOS_AVISO_POR_DEFECTO: TipoAvisoFutbol[] = TIPOS_AVISO_FUTBOL.filter((t) => t.porDefecto).map((t) => t.tipo);

export const INFO_TIPO_AVISO: Record<TipoAvisoFutbol, InfoTipoAviso> = Object.fromEntries(TIPOS_AVISO_FUTBOL.map((t) => [t.tipo, t])) as Record<TipoAvisoFutbol, InfoTipoAviso>;

export type EventoFutbol = {
  id: string;
  tipo: TipoAvisoFutbol;
  jugador_id: string;
  jugador_nombre: string;
  equipo_real: string | null;
  minuto: string | null;
  detalle: string | null;
  creado_en: string;
};

/** Frase corta del aviso, p.ej. "¡Gol de Lamine Yamal! (asistencia de Pedri) · 34'". */
export function textoAvisoFutbol(e: Pick<EventoFutbol, 'tipo' | 'jugador_nombre' | 'minuto' | 'detalle'>): string {
  const n = e.jugador_nombre;
  const d = e.detalle ? ` (${e.detalle})` : '';
  const m = e.minuto ? ` · ${e.minuto}` : '';
  switch (e.tipo) {
    case 'gol':
      return `¡Gol de ${n}!${d}${m}`;
    case 'gol_propia':
      return `Gol en propia puerta de ${n}${m}`;
    case 'penalti_marcado':
      return `${n} marca de penalti${m}`;
    case 'penalti_fallado':
      return `${n} falla un penalti${m}`;
    case 'penalti_parado':
      return `${n} para un penalti${m}`;
    case 'parada':
      return `Parada de ${n}${m}`;
    case 'amarilla':
      return `Tarjeta amarilla para ${n}${m}`;
    case 'roja':
      return `Tarjeta roja para ${n}${m}`;
    case 'asistencia':
      return `Asistencia de ${n}${e.detalle ? ` (a ${e.detalle})` : ''}${m}`;
    case 'doblete':
      return `${n} hace un doblete${m}`;
    case 'hat_trick':
      return `¡Hat-trick de ${n}!${m}`;
    case 'porteria_cero':
      return `${n} deja la portería a cero`;
    case 'victoria_portero':
      return `${n} gana el partido`;
    case 'fin_partido':
      return `Termina el partido de ${n}${d}`;
    default:
      return n;
  }
}
