// ============================================================================
// TEXTOS DE LOS AVISOS PUSH (19/10, Iñi)
// ============================================================================
// Iñi: "me ha llegado medio cortado"; "un icono del estadio y 'mañana vuelve
// la Champions, haz tu equipo antes de tal' y que se vea solamente eso";
// "que no sea siempre el mismo… para la liga un mensaje diferente".
//   · Títulos CORTOS (≤ 23 caracteres): en la pantalla de bloqueo del iPhone
//     el título va en una sola línea junto a la hora ("hace 4 min") y se
//     corta enseguida. Todo lo demás va en el texto de abajo.
//   · Cada competición tiene sus propias frases (Champions ≠ LaLiga ≠ golf) y
//     van rotando con el número de jornada, así no se repite la misma.
// Huecos: {h} hora de Madrid · {n} número de jornada · {torneo} nombre del torneo.

type Frase = readonly [titulo: string, cuerpo: string];

const CHAMPIONS_DIA_ANTES: Frase[] = [
  ['🏟️ Vuelve la Champions', 'Mañana a las {h}. Haz tu equipo antes de que empiece.'],
  ['✨ Mañana, Champions', 'El himno suena a las {h}. Haz tu equipo antes.'],
  ['🌍 Noche de Champions', 'Mañana a las {h} empieza la Jornada {n}. ¿Tienes ya tu equipo?'],
  ['⭐ Mañana hay Champions', 'Primer partido a las {h}. Que no se te pase hacer tu equipo.'],
];
const LALIGA_DIA_ANTES: Frase[] = [
  ['⚽ Vuelve LaLiga', 'Mañana arranca la Jornada {n} a las {h}. Haz tu equipo antes.'],
  ['🏟️ Mañana hay LaLiga', 'Jornada {n}: primer partido a las {h}. ¿Ya tienes tu once?'],
  ['📋 Jornada {n} de LaLiga', 'Empieza mañana a las {h}. Haz tu equipo antes del pitido.'],
  ['🔥 Vuelve el fútbol', 'Mañana a las {h} empieza la Jornada {n} de LaLiga. Ficha a tu equipo.'],
];
const GOLF_DIA_ANTES: Frase[] = [
  ['⛳ Mañana hay golf', 'El {torneo} empieza a las {h}. Elige a tus golfistas antes.'],
  ['🏌️ Vuelve el golf', 'Primera salida del {torneo} a las {h}. Haz tu equipo antes.'],
  ['⛳ Nuevo torneo mañana', 'El {torneo} sale a las {h}. ¿Tienes ya a tus golfistas?'],
];

const CHAMPIONS_UNA_HORA: Frase[] = [
  ['⏰ Champions en 1 hora', 'Empieza a las {h}. Último momento para hacer tu equipo.'],
  ['🏟️ Se abren las puertas', 'La Champions empieza a las {h}. ¿Tienes ya tu equipo?'],
  ['🔥 Queda 1 hora', 'El himno suena a las {h}. Haz tu equipo antes de que cierre.'],
];
const LALIGA_UNA_HORA: Frase[] = [
  ['⏰ Última llamada', 'La Jornada {n} de LaLiga empieza a las {h}. Haz tu equipo ya.'],
  ['📋 El míster te espera', 'Cierra a las {h}. Mete tu alineación antes del pitido.'],
  ['⚽ Queda 1 hora', 'A las {h} rueda el balón en LaLiga. ¿Tienes tu once?'],
];
const GOLF_UNA_HORA: Frase[] = [
  ['⛳ En 1 hora, al tee', 'El {torneo} empieza a las {h}. Elige a tus golfistas ya.'],
  ['🕐 Queda 1 hora', 'A las {h} sale el {torneo}. Que no te pille sin equipo.'],
];

// 28/10: tenis ({torneo} sin "ATP · " ni el año).
const TENIS_DIA_ANTES: Frase[] = [
  ['🎾 Mañana empieza el torneo', 'El {torneo} arranca a las {h}. Elige a tus tenistas antes.'],
  ['🎾 Vuelve el tenis', 'Primer partido del {torneo} a las {h}. Haz tu equipo antes.'],
];
const TENIS_UNA_HORA: Frase[] = [
  ['🎾 Queda 1 hora', 'A las {h} empieza el {torneo}. Que no te pille sin equipo.'],
  ['🕐 En 1 hora, a la pista', 'El {torneo} arranca a las {h}. Elige a tus tenistas ya.'],
];

function numeroJornada(competicion: string): number | null {
  const n = competicion.match(/Jornada\s*(\d+)/i)?.[1];
  return n ? Number(n) : null;
}
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function elegir(lista: Frase[], competicion: string): Frase {
  const n = numeroJornada(competicion);
  return lista[(n ?? hash(competicion)) % lista.length];
}
function rellenar(texto: string, competicion: string, hora: string): string {
  const n = numeroJornada(competicion);
  const torneo = competicion.replace(/\s*-\s*Jornada\s*\d+/i, '').replace(/^(ATP|WTA)\s*·\s*/i, '').replace(/\s+\d{4}$/, '').trim();
  return texto
    .replace(/\{h\}/g, hora)
    .replace(/\{n\}/g, n ? String(n) : '')
    .replace(/\{torneo\}/g, torneo)
    .replace(/\s{2,}/g, ' ')
    .trim();
}
function lista(deporte: string, competicion: string, cuando: 'dia_antes' | 'una_hora'): Frase[] {
  if (deporte === 'golf') return cuando === 'dia_antes' ? GOLF_DIA_ANTES : GOLF_UNA_HORA;
  if (deporte === 'tenis') return cuando === 'dia_antes' ? TENIS_DIA_ANTES : TENIS_UNA_HORA;
  if (/champions/i.test(competicion)) return cuando === 'dia_antes' ? CHAMPIONS_DIA_ANTES : CHAMPIONS_UNA_HORA;
  return cuando === 'dia_antes' ? LALIGA_DIA_ANTES : LALIGA_UNA_HORA;
}

/** Aviso del día antes (18:00) o de 1 hora antes. `hora` = hora de Madrid "18:45". */
export function mensajeRecordatorio(cuando: 'dia_antes' | 'una_hora', deporte: string, competicion: string, hora: string): { titulo: string; cuerpo: string } {
  const [t, c] = elegir(lista(deporte, competicion, cuando), competicion);
  return { titulo: rellenar(t, competicion, hora), cuerpo: rellenar(c, competicion, hora) };
}

/** Para comprobar que ningún título se pasa de largo. */
export const TODAS_LAS_FRASES: Frase[] = [
  ...CHAMPIONS_DIA_ANTES,
  ...LALIGA_DIA_ANTES,
  ...GOLF_DIA_ANTES,
  ...CHAMPIONS_UNA_HORA,
  ...LALIGA_UNA_HORA,
  ...GOLF_UNA_HORA,
];
