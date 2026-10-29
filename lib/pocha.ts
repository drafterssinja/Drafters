// ============================================================================
// POCHA — HOJA PARA APUNTAR LAS PARTIDAS (19/10, Iñi)
// ============================================================================
// Solo para Iñi y Javier (su socio): ver PERMITIDOS y SQL 58 (la base de datos
// también lo comprueba). De momento es solo la hoja de apuntar: quién pide
// cuántas, si acierta o falla y los puntos de cada uno.
//
// Manos (baraja española de 40 cartas → máximo = 40 / jugadores, redondeando
// hacia abajo: 4 jugadores → 10, 5 → 8, 6 → 6):
//   · de 1 carta, una mano por jugador;
//   · subiendo: 2, 3… hasta máximo − 1;
//   · de todas las cartas, una vuelta (una mano por jugador) por cada tipo
//     elegido: clásica, subastadas y/o a ciegas (20/10: las tres opcionales,
//     al menos una);
//   · bajando: máximo − 1… 2;
//   · de 1 carta otra vez, una mano por jugador.
// Puntos: acertar = 10 + 5 por cada baza pedida (o 10 por baza, si se elige
// al crear la partida); fallar = −5 por cada baza de diferencia. Si pinta oros, la mano vale ×2; si pinta el 5 de bastos, ×3.

const NORMALIZAR = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

// 28/10 (Iñi): + porrasgolfspain@gmail.com (sin la "e"; se dejan las dos formas).
const PERMITIDOS = ['inigo.sinde@gmail.com', 'porrasgolfespain@gmail.com', 'porrasgolfspain@gmail.com', 'javier.murua.alzueta@zabalburu.org'];

export function puedeJugarPocha(email: string | null | undefined): boolean {
  return !!email && PERMITIDOS.includes(NORMALIZAR(email));
}

export const BARAJA = 40;
export const MIN_JUGADORES = 3;
export const MAX_JUGADORES = 8;

export type TipoMano = 'normal' | 'subastada' | 'ciega';
export type Mano = { cartas: number; tipo: TipoMano };
export type Pinta = 1 | 2 | 3; // ×1 normal · ×2 oros · ×3 5 de bastos

// Lo que se apunta de cada mano. resultado: null = sin apuntar, 0 = acertó, n > 0 = falló por n.
export type ManoApuntada = { pedidas: (number | null)[]; resultado: (number | null)[]; pinta: Pinta };

export const PINTAS: { valor: Pinta; texto: string; corto: string }[] = [
  { valor: 1, texto: 'Normal', corto: '' },
  { valor: 2, texto: 'Oros ×2', corto: '×2' },
  { valor: 3, texto: '5 de bastos ×3', corto: '×3' },
];

export const TIPO_TEXTO: Record<TipoMano, string> = { normal: '', subastada: 'Subastada', ciega: 'A ciegas' };

export function cartasMaximas(jugadores: number): number {
  return Math.floor(BARAJA / Math.max(1, jugadores));
}

export type OpcionesPocha = { clasica?: boolean; subastadas: boolean; ciegas: boolean };
export function generarManos(jugadores: number, opciones: OpcionesPocha): Mano[] {
  const n = Math.max(1, jugadores);
  const max = cartasMaximas(n);
  const manos: Mano[] = [];
  const vuelta = (cartas: number, tipo: TipoMano = 'normal') => {
    for (let i = 0; i < n; i++) manos.push({ cartas, tipo });
  };
  vuelta(1);
  for (let c = 2; c < max; c++) manos.push({ cartas: c, tipo: 'normal' });
  if (opciones.clasica !== false) vuelta(max);
  if (opciones.subastadas) vuelta(max, 'subastada');
  if (opciones.ciegas) vuelta(max, 'ciega');
  for (let c = max - 1; c >= 2; c--) manos.push({ cartas: c, tipo: 'normal' });
  vuelta(1);
  return manos;
}

export function manoVacia(jugadores: number): ManoApuntada {
  return { pedidas: Array(jugadores).fill(null), resultado: Array(jugadores).fill(null), pinta: 1 };
}

/** Puntos de un jugador en una mano (null si todavía no se ha apuntado). */
export function puntosMano(pedidas: number | null, resultado: number | null, pinta: Pinta, porBaza = 5): number | null {
  if (resultado === null || resultado === undefined) return null;
  const base = resultado === 0 ? 10 + porBaza * (pedidas ?? 0) : -5 * resultado;
  return base * pinta;
}

/** Acumulado de cada jugador después de cada mano (null donde aún no hay resultado). */
export function acumulados(apuntadas: ManoApuntada[], jugadores: number, porBaza = 5): (number | null)[][] {
  const total = Array(jugadores).fill(0) as number[];
  return apuntadas.map((m) =>
    Array.from({ length: jugadores }, (_, j) => {
      const p = puntosMano(m.pedidas[j] ?? null, m.resultado[j] ?? null, m.pinta, porBaza);
      if (p === null) return null;
      total[j] += p;
      return total[j];
    })
  );
}

export function totales(apuntadas: ManoApuntada[], jugadores: number, porBaza = 5): number[] {
  const t = Array(jugadores).fill(0) as number[];
  apuntadas.forEach((m) => {
    for (let j = 0; j < jugadores; j++) t[j] += puntosMano(m.pedidas[j] ?? null, m.resultado[j] ?? null, m.pinta, porBaza) ?? 0;
  });
  return t;
}

export function manoCompleta(m: ManoApuntada | undefined, jugadores: number): boolean {
  if (!m) return false;
  for (let j = 0; j < jugadores; j++) if (m.resultado[j] === null || m.resultado[j] === undefined) return false;
  return true;
}

/** Quién reparte cada mano: el elegido al empezar y luego va rotando en el orden de la mesa. */
export function quienReparte(mano: number, jugadores: number, primero = 0): number {
  return (primero + mano) % Math.max(1, jugadores);
}

/** Orden en que se pide: empieza el siguiente al que reparte y el que reparte es el último. */
export function ordenDePedir(mano: number, jugadores: number, primero = 0): number[] {
  const r = quienReparte(mano, jugadores, primero);
  return Array.from({ length: jugadores }, (_, k) => (r + 1 + k) % jugadores);
}

export type PartidaPocha = {
  id: string;
  nombre: string;
  jugadores: string[];
  clasica?: boolean;
  subastadas: boolean;
  ciegas: boolean;
  puntos_baza?: number;
  reparte_primero: number;
  manos: ManoApuntada[];
  terminada: boolean;
  created_at: string;
  updated_at: string;
};
