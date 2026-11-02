// ============================================================================
// INSIGNIAS DE NIVEL — UNA POR NIVEL (02/11, Iñi)
// ============================================================================
// 100 insignias distintas:
//  · Cada 10 niveles cambia el MARCO (metal, forma y adornos de fuera):
//      1-10 Bronce (placa) · 11-20 Plata (placa) · 21-30 Oro (placa con esquinas
//      cortadas y remaches) · 31-40 Platino (escudo) · 41-50 Esmeralda ·
//      51-60 Zafiro (doble borde) · 61-70 Amatista (+ laurel por fuera, brillo) ·
//      71-80 Rubí (+ espadas cruzadas) · 81-90 Ónix (negro y oro, alas y
//      espadas) · 91-100 Diamante (alas, corona y brillo de colores).
//  · Dentro de cada marco, el distintivo sube del 1 al 10: 1-3 galones (∨),
//    4-6 barras, 7-9 estrellas y 10 estrella grande con laurel.
// Del 101 en adelante se queda el marco Diamante.

export type Marco = { nombre: string; metal: [string, string]; forma: 'placa' | 'octogono' | 'escudo'; remaches?: boolean; doble?: boolean; laurelFuera?: boolean; espadas?: boolean; alas?: boolean; corona?: boolean; brillo?: boolean; arcoiris?: boolean; fondo?: string };
export const MARCOS: Marco[] = [
  { nombre: 'Bronce', metal: ['#F2B27A', '#B9672C'], forma: 'placa' },
  { nombre: 'Plata', metal: ['#F1F5F8', '#8E9BA6'], forma: 'placa' },
  { nombre: 'Oro', metal: ['#FFE38A', '#C9921E'], forma: 'octogono', remaches: true },
  { nombre: 'Platino', metal: ['#DDF8FF', '#6FB6CF'], forma: 'escudo' },
  { nombre: 'Esmeralda', metal: ['#A8F7CB', '#13A35E'], forma: 'escudo' },
  { nombre: 'Zafiro', metal: ['#A9CFFF', '#2B5FE0'], forma: 'escudo', doble: true },
  { nombre: 'Amatista', metal: ['#E2CCFF', '#8B5CF6'], forma: 'escudo', doble: true, laurelFuera: true, brillo: true },
  { nombre: 'Rubí', metal: ['#FFB3BC', '#D7263D'], forma: 'escudo', doble: true, laurelFuera: true, espadas: true, brillo: true },
  { nombre: 'Ónix', metal: ['#FFE9A8', '#B8860B'], forma: 'escudo', doble: true, alas: true, espadas: true, brillo: true, fondo: '#050607' },
  { nombre: 'Diamante', metal: ['#7CF5FF', '#FF7CF0'], forma: 'escudo', doble: true, alas: true, corona: true, brillo: true, arcoiris: true },
];
export function marcoDe(n: number): Marco { return MARCOS[Math.min(MARCOS.length - 1, Math.floor((Math.max(1, n) - 1) / 10))]; }
export function pasoDe(n: number): number { return ((Math.max(1, n) - 1) % 10) + 1; }

const F = '{U}';
function star(cx: number, cy: number, r: number, ri = 0.45): string {
  const p: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * ri;
    p.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `<polygon points="${p.join(' ')}" fill="url(#m${F})"/>`;
}
function galon(y: number, w = 34, h = 9, g = 6.2): string {
  return `<path d="M${50 - w / 2},${y} L50,${y + h} L${50 + w / 2},${y}" fill="none" stroke="url(#m${F})" stroke-width="${g}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function laurelRama(lado: number, cy: number): string {
  const hojas = [[43, 90, 15], [37, 86.5, 35], [33.5, 81, 55], [32, 74.5, 72], [32.2, 68, 88]];
  const tallo = `<path d="M46,92 Q33,88 32,64" fill="none" stroke="url(#m${F})" stroke-width="2.2" stroke-linecap="round"/>`;
  const h = hojas.map(([x, y, a]) => `<ellipse cx="${x - 3.2}" cy="${y - 1.2}" rx="5" ry="2.1" transform="rotate(${a} ${x} ${y})" fill="url(#m${F})"/>`).join('');
  return `<g transform="translate(0 ${cy - 74})${lado > 0 ? ' translate(100 0) scale(-1 1)' : ''}">${tallo + h}</g>`;
}
function distintivo(p: number): string {
  let s = '';
  if (p <= 3) {
    const sep = 9.5, base = 64 + ((3 - p) * sep) / 2;
    for (let i = 0; i < p; i++) s += galon(base + i * sep);
  } else if (p <= 6) {
    const k = p - 3, w = 9, gap = 6, tot = k * w + (k - 1) * gap;
    for (let i = 0; i < k; i++) s += `<rect x="${(50 - tot / 2 + i * (w + gap)).toFixed(1)}" y="61" width="${w}" height="25" rx="2.5" fill="url(#m${F})"/>`;
  } else if (p <= 9) {
    const k = p - 6, R = k === 1 ? 11 : k === 2 ? 9.5 : 8.2, gap = R * 2.15;
    for (let i = 0; i < k; i++) s += star(50 - ((k - 1) * gap) / 2 + i * gap, 73, R);
  } else {
    s += star(50, 74, 11) + laurelRama(-1, 74) + laurelRama(1, 74);
  }
  return s;
}
const FORMAS: Record<string, string> = {
  placa: 'M18,5 H82 Q95,5 95,18 V78 Q95,95 78,95 H22 Q5,95 5,78 V18 Q5,5 18,5 Z',
  octogono: 'M24,5 H76 L95,24 V76 L76,95 H24 L5,76 V24 Z',
  escudo: 'M50,4 L90,14 L90,52 C90,76 72,90 50,97 C28,90 10,76 10,52 L10,14 Z',
  escudoInt: 'M50,11 L83,19.5 L83,52 C83,72 68,84 50,90 C32,84 17,72 17,52 L17,19.5 Z',
};
function exterior(m: Marco): string {
  // adornos de fuera (en coordenadas de la insignia completa, 0-100)
  let s = '';
  if (m.espadas) {
    s += `<g stroke="url(#m${F})" stroke-linecap="round"><line x1="6" y1="96" x2="94" y2="10" stroke-width="5"/><line x1="94" y1="96" x2="6" y2="10" stroke-width="5"/><line x1="8" y1="82" x2="22" y2="96" stroke-width="4"/><line x1="92" y1="82" x2="78" y2="96" stroke-width="4"/></g>`;
  }
  if (m.alas) {
    const ala = `<g fill="url(#m${F})">${[0, 1, 2, 3].map((i) => `<path d="M${22 - i * 4.5},${36 + i * 9} Q${4 - i * 2},${30 + i * 10} ${-2 + i * 1},${18 + i * 12} Q${12 - i * 2},${40 + i * 9} ${24 - i * 3},${44 + i * 9} Z"/>`).join('')}</g>`;
    s += ala + `<g transform="translate(100 0) scale(-1 1)">${ala}</g>`;
  }
  if (m.laurelFuera) {
    s += `<g transform="translate(50 50) scale(1.55) translate(-50 -58)">${laurelRama(-1, 74)}${laurelRama(1, 74)}</g>`;
  }
  return s;
}
function corona(): string {
  return `<g transform="translate(0 -3)"><path d="M34,18 L32,4 L41,11 L50,0 L59,11 L68,4 L66,18 Z" fill="url(#m${F})"/><circle cx="32" cy="3" r="2.4" fill="url(#m${F})"/><circle cx="50" cy="-1" r="2.6" fill="url(#m${F})"/><circle cx="68" cy="3" r="2.4" fill="url(#m${F})"/></g>`;
}
/** SVG (texto) de la insignia del nivel n. `id`: único en la página (gradientes). */
export function insigniaSvg(n: number, size: number, id: string): string {
  const m = marcoDe(n), p = pasoDe(n);
  const U = id.replace(/[^a-zA-Z0-9_-]/g, '');
  const [c1, c2] = m.metal;
  const fondo = m.fondo || '#141B18';
  const forma = FORMAS[m.forma];
  const fs = n >= 100 ? 26 : n >= 10 ? 32 : 36;
  const ny = m.forma === 'escudo' ? 36 : 33;
  // escala de la insignia si lleva adornos fuera
  const esc = m.alas ? 0.68 : m.espadas || m.laurelFuera ? 0.8 : 1;
  const dy = m.corona ? 7 : 2;
  const interior =
    `<path d="${forma}" fill="${fondo}" stroke="url(#m${U})" stroke-width="6"/>` +
    (m.doble ? `<path d="${FORMAS.escudoInt}" fill="none" stroke="url(#m${U})" stroke-width="1.6" stroke-opacity="0.65"/>` : '') +
    (m.remaches ? [[17, 17], [83, 17], [17, 83], [83, 83]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="url(#m${U})"/>`).join('') : '') +
    `<text x="50" y="${ny}" text-anchor="middle" dominant-baseline="middle" font-family="'Barlow Condensed',sans-serif" font-weight="800" font-size="${fs}" fill="#FFFFFF">${n}</text>` +
    distintivo(p).replaceAll(F, U);
  const brillo = m.brillo ? `<path d="${forma}" fill="none" stroke="${c2}" stroke-opacity="0.55" stroke-width="12" filter="url(#b${U})"/>` : '';
  const grupo = esc === 1 ? brillo + interior : `<g transform="translate(50 ${50 + dy}) scale(${esc}) translate(-50 -50)">${brillo + interior}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" style="display:inline-block;vertical-align:middle;overflow:visible">
  <defs>
    <linearGradient id="m${U}" x1="0" y1="0" x2="0.4" y2="1">${m.arcoiris
      ? '<stop offset="0" stop-color="#7CF5FF"/><stop offset="0.5" stop-color="#C9A6FF"/><stop offset="1" stop-color="#FF7CF0"/>'
      : `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>`}</linearGradient>
    <filter id="b${U}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>
  </defs>
  ${exterior(m).replaceAll(F, U)}
  ${grupo}
  ${m.corona ? corona().replaceAll(F, U) : ''}
</svg>`;
}

/** Compatibilidad: el "rango" es el marco (Bronce, Plata, Oro…). */
export function rango(n: number): Marco {
  return marcoDe(n);
}
