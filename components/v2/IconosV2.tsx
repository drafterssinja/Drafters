// Iconos de Drafters V2 (15/10): la pelota de cada deporte (selector de
// deporte de la cabecera) y el crédito Drafters ("el pase": entrada verde con
// la D, diseño aprobado por Iñi el 07/10). El crédito es el mismo icono en
// los tres deportes; lo que cambia es el saldo, que va por separado.

export type DeporteV2 = 'futbol' | 'golf' | 'tenis';

export function BalonFutbol({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10.5" fill="#F5F7F5" stroke="#0B0F0E" strokeWidth="1" />
      <path d="M12 7.2l3.4 2.5-1.3 4h-4.2l-1.3-4z" fill="#0B0F0E" />
      <path d="M12 7.2V3.1M15.4 9.7l3.9-1.3M14.1 13.7l2.4 3.3M9.9 13.7l-2.4 3.3M8.6 9.7L4.7 8.4" stroke="#0B0F0E" strokeWidth="1.1" />
      <path d="M8.3 2.2l3.7 0.9 3.7-0.9M20.6 7l-1.3 1.4 0.6 3.8M18.6 19.5l-2.1-2.5-3.6 0.6M5.4 19.5l2.1-2.5 3.6 0.6M3.4 7l1.3 1.4-0.6 3.8" stroke="#0B0F0E" strokeWidth="1" fill="none" />
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
