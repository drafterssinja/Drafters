// ============================================================================
// ETIQUETAS Y FORMATO COMPARTIDOS — pantallas reales de salas/mesas/porras
// ============================================================================
// Punto único para las etiquetas y pequeñas reglas de formato que usan tanto
// el panel de admin como las pantallas reales (inicio, salas, detalle de
// sala, grandes torneos, porras) — así un cambio de etiqueta o de umbral no
// hay que repetirlo pantalla a pantalla. Los tipos y aforos en sí siguen
// viviendo en lib/tiposDeSala.ts (single source of truth de Iñi).

import { ACCENT, MUTED_3 } from './mockupStyles';
import type { TipoSala } from './repartoPremios';

export const DEPORTES = ['futbol', 'golf', 'tenis'] as const;
export type Deporte = (typeof DEPORTES)[number];

export const DEPORTE_LABELS: Record<Deporte, string> = {
  futbol: 'Fútbol',
  golf: 'Golf',
  tenis: 'Tenis',
};

// Los 4 tipos de aforo fijo que se listan mezclados en /salas — Maratón vive
// aparte, en /mesas ("grandes torneos"), tal y como pidió Iñi (23/09).
export const TIPOS_SALA_FIJA: Exclude<TipoSala, 'maraton'>[] = [
  'doble_o_nada',
  'triple_o_nada',
  'oro_y_plata',
  'tridente',
];

export const TIPO_SALA_LABELS: Record<TipoSala, string> = {
  doble_o_nada: 'Doble o Nada',
  triple_o_nada: 'Triple o Nada',
  oro_y_plata: 'Oro y Plata',
  tridente: 'Tridente',
  maraton: 'Maratón',
};

export type NivelBuyIn = 'bajo' | 'medio' | 'alto';
export const BUYIN_LABELS: Record<NivelBuyIn, string> = { bajo: 'Hasta 25 €', medio: '25–100 €', alto: '+100 €' };

// Mismos umbrales en toda la app (admin y pantallas reales): bajo ≤25€,
// medio ≤100€, alto >100€. Los escalones de Fase 1 (5..100€, ver
// lib/tiposDeSala.ts) caen todos en bajo/medio — "alto" queda listo para
// cuando entren los escalones de dinero real (200€, 500€).
export function nivelBuyIn(buyIn: number): NivelBuyIn {
  if (buyIn <= 25) return 'bajo';
  if (buyIn <= 100) return 'medio';
  return 'alto';
}

// Formato de euros (25/09, tercera vuelta): antes siempre mostraba dos
// decimales ("100000.00 €", sin separador de miles) — pedido de Iñi para el
// presupuesto de fantasía: "no tiene que haber decimales... falta el punto
// de separación de los miles". En vez de crear una función aparte solo para
// el presupuesto, formatEuros se vuelve "inteligente": números enteros
// (100.000, 5, 20.000...) se muestran sin decimales, y los que de verdad
// tienen céntimos (4,50 € del desglose de buy-in, por ejemplo) se muestran
// siempre con los dos decimales — en los dos casos con el punto de miles y
// la coma decimal españolas (Intl.NumberFormat('es-ES', ...)).
export function formatEuros(importe: number): string {
  const esEntero = Math.abs(importe - Math.round(importe)) < 0.005;
  const formateado = new Intl.NumberFormat('es-ES', {
    // useGrouping explícito (25/09, sexta vuelta): sin esto, el propio
    // Intl.NumberFormat('es-ES') de Node/el navegador NO añade el punto de
    // miles en números de exactamente 4 cifras (3200 salía "3200", no
    // "3.200") — es un comportamiento real de los datos CLDR del idioma
    // español, que solo agrupa a partir de 5 cifras salvo que se pida
    // explícitamente. Pedido de Iñi viendo los precios de jugadores (que
    // rondan las 4 cifras, p.ej. 3.200€): "cuando la cifra es de cuatro
    // números... tampoco me pones el punto que separa los miles... el
    // 3200, por ejemplo... inclúyemelo". Con useGrouping: true, los números
    // de 5+ cifras (22.000, 100.000) siguen exactamente igual que antes.
    useGrouping: true,
    minimumFractionDigits: esEntero ? 0 : 2,
    maximumFractionDigits: esEntero ? 0 : 2,
  }).format(importe);
  return `${formateado} €`;
}

// Comisión de la casa sobre cada inscripción (10%, ya usada en las
// estadísticas del panel de admin — "Rake ganado (10%)") — centralizada
// aquí el 25/09 (tercera vuelta) para poder calcular el desglose de buy-in
// ("4,50 € + 0,50 €") y el bote real (importe que va a premios, sin la
// comisión) en las pantallas de sala/porra, no solo en las estadísticas.
export const RAKE_FRACCION = 0.1;

/** Parte de un buy-in que va al bote de premios (90%), redondeada a céntimos. */
export function parteParaPremios(buyIn: number): number {
  return Math.round(buyIn * (1 - RAKE_FRACCION) * 100) / 100;
}

/** Parte de un buy-in que se queda la casa como comisión (10%), redondeada a céntimos. */
export function parteComision(buyIn: number): number {
  return Math.round(buyIn * RAKE_FRACCION * 100) / 100;
}

export function estadoSalaInfo(estado: string, aforo: number | null, signedUp: number): { label: string; color: string } {
  if (estado === 'finalizada') return { label: 'Finalizada', color: MUTED_3 };
  if (estado === 'completa') return { label: 'Completa · en juego', color: '#FF7A45' };
  if (estado === 'casi_llena') return { label: 'Casi llena', color: '#F0B94D' };
  if (aforo != null) {
    const libres = Math.max(0, aforo - signedUp);
    return { label: `${libres} ${libres === 1 ? 'plaza libre' : 'plazas libres'}`, color: ACCENT };
  }
  return { label: `${signedUp} ${signedUp === 1 ? 'inscrito' : 'inscritos'}`, color: ACCENT };
}

export function capacidadLabel(aforo: number | null): string {
  return aforo != null ? String(aforo) : '∞';
}

// Cuenta atrás legible a partir de fecha_limite_inscripcion. Null cuando no
// hay fecha fijada todavía (el admin no la ha puesto) o ya ha pasado.
export function closesInLabel(fechaLimiteIso: string | null): string | null {
  if (!fechaLimiteIso) return null;
  const ms = new Date(fechaLimiteIso).getTime() - Date.now();
  if (ms <= 0) return null;
  const minutos = Math.floor(ms / 60000);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas} h ${minutos % 60} min`;
  const dias = Math.floor(horas / 24);
  if (dias < 7) return `${dias} ${dias === 1 ? 'día' : 'días'}`;
  const semanas = Math.floor(dias / 7);
  return `${semanas} ${semanas === 1 ? 'semana' : 'semanas'}`;
}

// Iniciales cortas para avatares de jugadores (distinto de S.iniciales, que
// es para nombre+apellido del usuario) — a partir del nombre completo del
// jugador ("Iker Etxarri" -> "IE"; "Rafael Nadal" -> "RN").
export function inicialesJugador(nombre: string): string {
  const partes = nombre.trim().split(/\s+/);
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return `${partes[0].charAt(0)}${partes[partes.length - 1].charAt(0)}`.toUpperCase();
}

// Conteo real de inscritos de cada sala — SIEMPRE a través de
// `inscripciones` filtrando estado <> 'reembolsada' (ver la nota en
// drafters-schema.sql junto a consolidar_salas_incompletas(): el
// equipos.sala_id de un jugador reembolsado se queda apuntando a su sala
// original y NO cuenta como plaza real). Recibe las filas ya cargadas
// (sala_id de cada equipo + estado de cada una de sus inscripciones) y
// agrega en memoria.
export function contarInscritosPorSala(filas: { sala_id: string | null; estado: string }[]): Map<string, number> {
  const conteo = new Map<string, number>();
  for (const fila of filas) {
    if (!fila.sala_id || fila.estado === 'reembolsada') continue;
    conteo.set(fila.sala_id, (conteo.get(fila.sala_id) ?? 0) + 1);
  }
  return conteo;
}

export function posicionLabel(desde: number, hasta: number): string {
  return desde === hasta ? `${desde}º` : `${desde}º–${hasta}º`;
}

// Resumen corto del reparto para la pestaña "Información" (una sola línea).
export function repartoResumenLabel(tipo: string): string {
  switch (tipo) {
    case 'doble_o_nada':
      return 'x2 tu apuesta (a la mitad)';
    case 'triple_o_nada':
      return 'x3 tu apuesta (al tercio)';
    case 'oro_y_plata':
      return '1º 70% · 2º 30%';
    case 'tridente':
      return '1º 60% · 2º 25% · 3º 15%';
    case 'maraton':
      return 'Por tramos según inscritos';
    default:
      return '—';
  }
}

// Número romano para distinguir los varios equipos de un mismo usuario en
// un torneo Maratón (nuevo, 26/09 novena vuelta) — pedido de Iñi: "se debe
// permitir hacer más de un equipo... el nombre de usuario, y el segundo
// equipo pondrá entre paréntesis un 2 en número romano, el 3 un 3 en número
// romano, así consecutivamente". Solo se usa para el primer equipo de un
// usuario en pantalla (sin sufijo); el resto añade " (II)", " (III)"... La
// misma numeración "de verdad" (para lo que ven los demás participantes) la
// calcula `participantes_sala()` en drafters-schema.sql — esta versión en
// TypeScript es solo para pintar los equipos propios del usuario en su
// propia pantalla, con el mismo criterio.
export function numeroRomano(numero: number): string {
  if (!Number.isFinite(numero) || numero < 1) return '';
  const valores: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let resto = Math.floor(numero);
  let resultado = '';
  for (const [valor, simbolo] of valores) {
    while (resto >= valor) {
      resultado += simbolo;
      resto -= valor;
    }
  }
  return resultado;
}

// Posición de fútbol (jugadores.posicion) -> línea del campo del mockup.
export type LineaFutbol = 'POR' | 'DEF' | 'MED' | 'DEL';

export function lineaDePosicion(posicion: string | null): LineaFutbol {
  switch (posicion) {
    case 'portero':
      return 'POR';
    case 'defensa':
      return 'DEF';
    case 'centrocampista':
      return 'MED';
    case 'delantero':
      return 'DEL';
    default:
      return 'MED';
  }
}

// A partir de la alineación elegida ('4-3-3', '4-4-2', '3-5-2', '4-2-3-1' —
// convención DEF-MED-DEL, portero siempre 1) da cuántos huecos pintar en
// cada línea del campo. Para '4-2-3-1' (def=4, resto=[2,3,1]): el último
// número es siempre delanteros, todo lo de en medio se suma como centro del
// campo (med = 2+3 = 5).
export function huecosPorLinea(alineacion: string | null): Record<LineaFutbol, number> {
  const partes = (alineacion ?? '4-3-3').split('-').map((n) => parseInt(n, 10) || 0);
  const [def, ...resto] = partes;
  const del = resto.length > 0 ? resto[resto.length - 1] : 0;
  const med = resto.slice(0, -1).reduce((suma, n) => suma + n, 0);
  return { POR: 1, DEF: def, MED: med, DEL: del };
}
