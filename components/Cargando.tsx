'use client';

import { useState } from 'react';
import { BalonFutbol, BolaGolf, BolaTenis } from '@/components/v2/IconosV2';

// ============================================================================
// ICONO DE "CARGANDO" (16/10, Iñi)
// ============================================================================
// En vez del texto "Cargando...": una pelota que bota cada segundo dentro del
// típico circulito que gira. En cada bote cambia de deporte: balón de fútbol,
// bola de golf y pelota de tenis.

const PELOTAS = [BalonFutbol, BolaGolf, BolaTenis];

export default function Cargando({ compacto = false, texto }: { compacto?: boolean; texto?: string }) {
  const [i, setI] = useState(0);
  const anillo = compacto ? 64 : 104;
  const pelota = compacto ? 22 : 34;
  const salto = compacto ? 14 : 22;
  const Pelota = PELOTAS[i % PELOTAS.length];

  return (
    <div role="status" aria-label={texto ?? 'Cargando'} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: compacto ? '14px 0' : '56px 0', width: '100%' }}>
      <style>{`
        @keyframes drafters-girar { to { transform: rotate(360deg); } }
        @keyframes drafters-botar {
          0%, 100% { transform: translateY(0) scale(1.12, 0.86); animation-timing-function: cubic-bezier(.2,.7,.4,1); }
          12% { transform: translateY(-4%) scale(0.94, 1.08); }
          50% { transform: translateY(calc(-1 * var(--salto))) scale(1, 1); animation-timing-function: cubic-bezier(.6,0,.8,.3); }
          92% { transform: translateY(-4%) scale(0.96, 1.05); }
        }
        @keyframes drafters-sombra {
          0%, 100% { transform: scaleX(1); opacity: 0.55; }
          50% { transform: scaleX(0.5); opacity: 0.2; }
        }
        @media (prefers-reduced-motion: reduce) {
          .drafters-cargando-anillo, .drafters-cargando-pelota, .drafters-cargando-sombra { animation-duration: 3s !important; }
        }
      `}</style>
      <div style={{ position: 'relative', width: anillo, height: anillo }}>
        {/* El circulito que gira */}
        <svg className="drafters-cargando-anillo" width={anillo} height={anillo} viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, animation: 'drafters-girar 1s linear infinite' }} aria-hidden>
          <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
          <circle cx="50" cy="50" r="45" fill="none" stroke="#3DDC84" strokeWidth="6" strokeLinecap="round" strokeDasharray="70 213" />
        </svg>
        {/* La sombra en el suelo */}
        <span
          className="drafters-cargando-sombra"
          style={{ position: 'absolute', left: '50%', bottom: anillo * 0.2, width: pelota * 0.9, height: pelota * 0.18, marginLeft: -(pelota * 0.45), borderRadius: '50%', background: 'rgba(255,255,255,0.18)', animation: 'drafters-sombra 1s infinite' }}
        />
        {/* La pelota que bota (cambia de deporte en cada bote) */}
        <span
          className="drafters-cargando-pelota"
          onAnimationIteration={() => setI((n) => n + 1)}
          style={{ position: 'absolute', left: '50%', bottom: anillo * 0.22, marginLeft: -pelota / 2, width: pelota, height: pelota, display: 'flex', transformOrigin: '50% 100%', animation: 'drafters-botar 1s infinite', ['--salto' as string]: `${salto}px` } as React.CSSProperties}
        >
          <Pelota size={pelota} />
        </span>
      </div>
      {texto && <span style={{ fontSize: 12.5, color: '#8B958F' }}>{texto}</span>}
    </div>
  );
}
