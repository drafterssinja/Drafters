'use client';

import { useId } from 'react';
// Iconos de Drafters V2 (15/10): la pelota de cada deporte (selector de
// deporte de la cabecera) y el crédito Drafters ("el pase": entrada verde con
// la D, diseño aprobado por Iñi el 07/10). El crédito es el mismo icono en
// los tres deportes; lo que cambia es el saldo, que va por separado.

export type DeporteV2 = 'futbol' | 'golf' | 'tenis';

// 16/10 (Iñi): balón realista. Caras de un icosaedro truncado (el balón de
// toda la vida) proyectadas sobre una esfera, con luz y sombra.
const CARAS_BALON: [string, string][] = [
  ['h', 'M80.5 84.7L78.0 86.2L75.3 87.7L72.5 89.0L69.6 90.1L66.6 91.0L63.6 91.7L61.5 93.2L59.3 94.5L57.0 95.5L54.7 96.4L52.4 97.1L50.1 97.5L50.7 97.8L51.3 98.0L51.9 97.9L52.5 97.6L53.1 97.0L53.6 96.3L56.5 95.6L59.4 94.8L62.3 93.7L65.2 92.4L67.9 90.9L70.5 89.2L73.0 88.7L75.5 88.0L77.8 87.1L80.0 86.0L82.1 84.8L84.0 83.4L83.8 84.0L83.4 84.5L82.9 84.8L82.2 84.9L81.4 84.8Z'],
  ['p', 'M46.4 3.7L49.1 4.0L51.9 4.6L54.7 5.3L57.5 6.3L60.2 7.5L62.9 8.8L65.3 8.6L67.8 8.7L70.1 8.9L72.4 9.3L74.5 9.9L76.5 10.7L75.5 9.6L74.3 8.7L73.0 7.9L71.6 7.3L70.1 7.0L68.5 6.8L65.6 5.6L62.5 4.5L59.4 3.7L56.2 3.1L53.0 2.7L49.9 2.5L49.3 2.1L48.7 2.0L48.1 2.1L47.5 2.4L46.9 3.0Z'],
  ['h', 'M94.4 54.5L93.4 57.2L92.3 59.9L90.9 62.6L89.3 65.2L87.6 67.8L85.7 70.2L85.2 72.8L84.6 75.5L83.8 78.0L82.8 80.4L81.7 82.6L80.5 84.7L81.4 84.8L82.2 84.9L82.9 84.8L83.4 84.5L83.8 84.0L84.0 83.4L85.8 81.2L87.5 78.7L89.1 76.1L90.5 73.4L91.7 70.6L92.7 67.7L94.0 65.5L95.2 63.1L96.2 60.7L97.0 58.2L97.5 55.7L97.9 53.2L97.8 53.5L97.6 53.7L97.1 53.9L96.4 54.1L95.5 54.3Z'],
  ['h', 'M31.5 93.2L30.4 92.0L29.4 90.6L28.4 88.9L27.6 87.1L26.9 85.2L26.3 83.1L23.8 81.1L21.3 78.9L19.0 76.6L16.8 74.2L14.8 71.6L13.0 69.0L11.2 68.6L9.6 68.1L8.1 67.5L6.8 66.8L5.8 66.0L5.0 65.1L5.3 67.0L5.9 68.9L6.7 70.6L7.7 72.3L8.8 73.8L10.2 75.3L12.0 77.9L13.9 80.5L16.1 83.0L18.4 85.3L20.9 87.4L23.4 89.3L24.5 90.4L25.7 91.3L27.0 92.1L28.4 92.7L29.9 93.0Z'],
  ['p', 'M89.8 24.7L90.2 26.5L90.4 28.4L90.5 30.4L90.3 32.5L89.9 34.6L89.4 36.9L90.7 39.7L91.8 42.6L92.8 45.6L93.5 48.6L94.1 51.5L94.4 54.5L95.5 54.3L96.4 54.1L97.1 53.9L97.6 53.7L97.8 53.5L97.9 53.2L98.0 50.2L97.8 47.1L97.4 43.9L96.8 40.8L96.0 37.8L95.0 34.9L94.7 33.0L94.1 31.1L93.3 29.4L92.3 27.7L91.2 26.1Z'],
  ['h', 'M13.0 69.0L13.4 66.8L14.1 64.5L14.9 62.0L15.8 59.6L17.0 57.0L18.2 54.6L17.4 51.5L16.7 48.4L16.1 45.3L15.7 42.2L15.5 39.1L15.4 36.2L13.6 35.4L12.0 34.6L10.6 33.9L9.3 33.3L8.2 32.7L7.3 32.3L6.0 34.5L4.8 36.9L3.8 39.3L3.0 41.8L2.5 44.3L2.1 46.8L2.0 49.8L2.2 52.9L2.6 56.1L3.1 59.2L4.0 62.2L5.0 65.1L5.8 66.0L6.8 66.8L8.1 67.5L9.6 68.1L11.2 68.6Z'],
  ['p', 'M15.4 36.2L17.3 33.8L19.4 31.4L21.6 29.1L24.0 26.9L26.5 24.8L29.1 22.9L28.9 20.5L28.8 18.3L28.8 16.1L28.9 14.2L29.2 12.3L29.5 10.8L27.0 11.3L24.5 12.0L22.2 12.9L20.0 14.0L17.9 15.2L16.1 16.6L14.2 18.8L12.5 21.3L10.9 23.9L9.5 26.6L8.3 29.4L7.3 32.3L8.2 32.7L9.3 33.3L10.6 33.9L12.0 34.6L13.6 35.4Z'],
  ['h', 'M58.3 81.6L55.3 81.2L52.2 80.7L49.0 80.0L45.8 79.2L42.7 78.3L39.7 77.3L37.3 78.5L34.9 79.7L32.6 80.8L30.4 81.7L28.3 82.5L26.3 83.1L26.9 85.2L27.6 87.1L28.4 88.9L29.4 90.6L30.4 92.0L31.5 93.2L34.4 94.4L37.5 95.5L40.6 96.3L43.8 96.9L47.0 97.3L50.1 97.5L52.4 97.1L54.7 96.4L57.0 95.5L59.3 94.5L61.5 93.2L63.6 91.7L62.8 90.5L62.0 89.0L61.2 87.4L60.3 85.6L59.3 83.6Z'],
  ['h', 'M62.5 20.9L64.8 22.9L67.2 25.1L69.5 27.5L71.7 29.9L73.8 32.4L75.7 34.9L78.3 35.1L80.9 35.3L83.3 35.6L85.5 36.0L87.6 36.4L89.4 36.9L89.9 34.6L90.3 32.5L90.5 30.4L90.4 28.4L90.2 26.5L89.8 24.7L88.0 22.1L86.0 19.5L83.9 17.0L81.5 14.7L79.1 12.6L76.5 10.7L74.5 9.9L72.4 9.3L70.1 8.9L67.8 8.7L65.3 8.6L62.9 8.8L63.0 10.4L63.0 12.1L62.9 14.1L62.8 16.3L62.7 18.5Z'],
  ['p', 'M72.0 68.3L70.0 70.7L67.8 73.1L65.5 75.5L63.1 77.6L60.7 79.7L58.3 81.6L59.3 83.6L60.3 85.6L61.2 87.4L62.0 89.0L62.8 90.5L63.6 91.7L66.6 91.0L69.6 90.1L72.5 89.0L75.3 87.7L78.0 86.2L80.5 84.7L81.7 82.6L82.8 80.4L83.8 78.0L84.6 75.5L85.2 72.8L85.7 70.2L83.8 70.1L81.7 69.9L79.5 69.6L77.1 69.3L74.6 68.8Z'],
  ['h', 'M29.1 22.9L31.6 23.4L34.3 24.1L37.0 24.9L39.9 25.8L42.7 26.9L45.6 28.0L48.4 26.5L51.2 25.2L54.1 23.9L57.0 22.8L59.8 21.8L62.5 20.9L62.7 18.5L62.8 16.3L62.9 14.1L63.0 12.1L63.0 10.4L62.9 8.8L60.2 7.5L57.5 6.3L54.7 5.3L51.9 4.6L49.1 4.0L46.4 3.7L43.5 4.4L40.6 5.2L37.7 6.3L34.8 7.6L32.1 9.1L29.5 10.8L29.2 12.3L28.9 14.2L28.8 16.1L28.8 18.3L28.9 20.5Z'],
  ['h', 'M75.7 34.9L74.6 37.4L73.3 40.0L71.8 42.6L70.3 45.3L68.7 48.0L67.0 50.6L68.1 53.6L69.0 56.6L69.9 59.7L70.7 62.6L71.4 65.5L72.0 68.3L74.6 68.8L77.1 69.3L79.5 69.6L81.7 69.9L83.8 70.1L85.7 70.2L87.6 67.8L89.3 65.2L90.9 62.6L92.3 59.9L93.4 57.2L94.4 54.5L94.1 51.5L93.5 48.6L92.8 45.6L91.8 42.6L90.7 39.7L89.4 36.9L87.6 36.4L85.5 36.0L83.3 35.6L80.9 35.3L78.3 35.1Z'],
  ['p', 'M39.7 77.3L38.7 74.6L37.8 71.8L36.9 68.8L36.1 65.8L35.4 62.7L34.7 59.6L31.8 58.9L28.8 58.1L26.0 57.2L23.2 56.4L20.6 55.5L18.2 54.6L17.0 57.0L15.8 59.6L14.9 62.0L14.1 64.5L13.4 66.8L13.0 69.0L14.8 71.6L16.8 74.2L19.0 76.6L21.3 78.9L23.8 81.1L26.3 83.1L28.3 82.5L30.4 81.7L32.6 80.8L34.9 79.7L37.3 78.5Z'],
  ['h', 'M34.7 59.6L36.8 57.5L39.1 55.3L41.4 53.0L43.7 50.8L46.1 48.5L48.4 46.3L47.9 43.2L47.4 40.0L46.9 36.9L46.4 33.8L46.0 30.8L45.6 28.0L42.7 26.9L39.9 25.8L37.0 24.9L34.3 24.1L31.6 23.4L29.1 22.9L26.5 24.8L24.0 26.9L21.6 29.1L19.4 31.4L17.3 33.8L15.4 36.2L15.5 39.1L15.7 42.2L16.1 45.3L16.7 48.4L17.4 51.5L18.2 54.6L20.6 55.5L23.2 56.4L26.0 57.2L28.8 58.1L31.8 58.9Z'],
  ['p', 'M45.6 28.0L46.0 30.8L46.4 33.8L46.9 36.9L47.4 40.0L47.9 43.2L48.4 46.3L51.5 47.0L54.7 47.7L57.9 48.5L61.0 49.2L64.1 49.9L67.0 50.6L68.7 48.0L70.3 45.3L71.8 42.6L73.3 40.0L74.6 37.4L75.7 34.9L73.8 32.4L71.7 29.9L69.5 27.5L67.2 25.1L64.8 22.9L62.5 20.9L59.8 21.8L57.0 22.8L54.1 23.9L51.2 25.2L48.4 26.5Z'],
  ['h', 'M67.0 50.6L64.1 49.9L61.0 49.2L57.9 48.5L54.7 47.7L51.5 47.0L48.4 46.3L46.1 48.5L43.7 50.8L41.4 53.0L39.1 55.3L36.8 57.5L34.7 59.6L35.4 62.7L36.1 65.8L36.9 68.8L37.8 71.8L38.7 74.6L39.7 77.3L42.7 78.3L45.8 79.2L49.0 80.0L52.2 80.7L55.3 81.2L58.3 81.6L60.7 79.7L63.1 77.6L65.5 75.5L67.8 73.1L70.0 70.7L72.0 68.3L71.4 65.5L70.7 62.6L69.9 59.7L69.0 56.6L68.1 53.6Z'],
];

export function BalonFutbol({ size = 24 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <clipPath id={`bc${id}`}>
          <circle cx="50" cy="50" r="48" />
        </clipPath>
        <radialGradient id={`bl${id}`} cx="36%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
          <stop offset="35%" stopColor="#FFFFFF" stopOpacity="0.05" />
          <stop offset="70%" stopColor="#000000" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.5" />
        </radialGradient>
      </defs>
      <g clipPath={`url(#bc${id})`}>
        <circle cx="50" cy="50" r="48" fill="#F4F4F2" />
        {CARAS_BALON.map(([t, d], i) => (
          <path key={i} d={d} fill={t === 'p' ? '#161616' : '#F4F4F2'} stroke="#3A3A3A" strokeWidth={size < 28 ? 1.6 : 1.1} strokeLinejoin="round" />
        ))}
        <circle cx="50" cy="50" r="48" fill={`url(#bl${id})`} />
      </g>
      <circle cx="50" cy="50" r="48" fill="none" stroke="#1E1E1E" strokeWidth={size < 28 ? 2 : 1} />
    </svg>
  );
}

export function BolaGolf({ size = 24 }: { size?: number }) {
  const hoyuelos = [
    [9, 8], [13, 7], [16.5, 9.5], [7, 11.5], [11, 11], [15, 12.5], [9, 15], [13, 15.5], [17, 15], [11, 18.5], [6.5, 15.5], [15, 18],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10.5" fill="#F5F7F5" />
      {hoyuelos.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="0.95" fill="#C9D1D9" />
      ))}
      <path d="M5 16.5a9 9 0 0 0 12.5 3" stroke="#AAB4AE" strokeWidth="1" fill="none" opacity="0.6" />
    </svg>
  );
}

export function BolaTenis({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10.5" fill="#D8F04A" />
      <path d="M4.2 5.2c3.6 3.2 3.6 10.4 0 13.6" stroke="#F5F7F5" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M19.8 5.2c-3.6 3.2-3.6 10.4 0 13.6" stroke="#F5F7F5" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function PelotaDeporte({ deporte, size = 24 }: { deporte: DeporteV2; size?: number }) {
  if (deporte === 'golf') return <BolaGolf size={size} />;
  if (deporte === 'tenis') return <BolaTenis size={size} />;
  return <BalonFutbol size={size} />;
}

// Crédito Drafters — "el pase": entrada verde con muescas y la D.
// `oscuro`: para ponerlo encima de un botón verde (entrada oscura, D verde).
export function IconoCredito({ size = 18, oscuro = false }: { size?: number; oscuro?: boolean }) {
  const fondo = oscuro ? '#04140B' : '#3DDC84';
  const trazo = oscuro ? '#3DDC84' : '#04140B';
  return (
    <svg width={size * 1.45} height={size} viewBox="0 0 29 20" aria-hidden style={{ flexShrink: 0 }}>
      <path d="M3 1h23a2 2 0 0 1 2 2v4.2a2.8 2.8 0 0 0 0 5.6V17a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-4.2a2.8 2.8 0 0 0 0-5.6V3a2 2 0 0 1 2-2z" fill={fondo} />
      <path d="M8.5 3.5v13" stroke={trazo} strokeWidth="1" strokeDasharray="1.6 1.6" opacity="0.55" />
      <path d="M13.5 5.5h3.4a4.5 4.5 0 0 1 0 9h-3.4z" fill="none" stroke={trazo} strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}

export const DEPORTE_NOMBRE: Record<DeporteV2, string> = { futbol: 'Fútbol', golf: 'Golf', tenis: 'Tenis' };
export const DEPORTES_V2: DeporteV2[] = ['futbol', 'golf', 'tenis'];
export function esDeporteV2(x: string | null | undefined): x is DeporteV2 {
  return x === 'futbol' || x === 'golf' || x === 'tenis';
}

// Candado de las salas privadas (15/10, Iñi).
export function IconoCandado({ size = 13, color = '#F0B94D' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-label="Privada" style={{ flexShrink: 0 }}>
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.2" fill={color} fillOpacity="0.18" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

// Draftis — "la gema" (hexágono tallado con la D; oro = Primera, diseño 07/10).
export function IconoGema({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ flexShrink: 0 }}>
      <path d="M12 1.5l9.1 5.25v10.5L12 22.5l-9.1-5.25V6.75z" fill="#D4A537" />
      <path d="M12 1.5l9.1 5.25L12 12 2.9 6.75z" fill="#F3D27A" />
      <path d="M12 12l9.1-5.25v10.5L12 22.5z" fill="#9C7419" />
      <path d="M9.6 8.2h2.2a3.8 3.8 0 0 1 0 7.6H9.6z" fill="none" stroke="#3A2A08" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

// 19/10 (Iñi): icono de cartas para la hoja de la pocha (solo Iñi y Javier).
// Dos naipes abiertos en abanico; el de delante con un oro.
export function IconoCartas({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <g transform="rotate(-14 12 13)">
        <rect x="4.5" y="4" width="10" height="15" rx="1.8" fill="#E9EEEA" stroke="#0B0F0E" strokeWidth="0.8" />
        <rect x="6" y="5.5" width="7" height="12" rx="1" fill="none" stroke="#C0392B" strokeWidth="0.9" />
      </g>
      <g transform="rotate(12 12 13)">
        <rect x="9" y="4.5" width="10" height="15" rx="1.8" fill="#FFFFFF" stroke="#0B0F0E" strokeWidth="0.8" />
        <circle cx="14" cy="12" r="3.1" fill="#F0B94D" stroke="#B7832A" strokeWidth="0.8" />
        <circle cx="14" cy="12" r="1.3" fill="none" stroke="#B7832A" strokeWidth="0.7" />
      </g>
    </svg>
  );
}
