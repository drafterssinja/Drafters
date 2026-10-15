'use client';

import * as S from '@/lib/mockupStyles';
import { formatoEuros, type Premio } from '@/lib/v2';

// ============================================================================
// TIRA DE PUESTOS (15/10, Iñi): lo que se juega una sala, puesto a puesto
// ============================================================================
// Verde = ganan, gris = tierra de nadie (ni ganan ni pagan), rojo = pagan.
// La misma tira que se ve al crear la sala se enseña después en la sala, en
// la lista de amistosos y en las propuestas del chat. Con dinero: verde con lo
// que cobra cada puesto y gris el resto.

export type ZonaPuesto = 'gana' | 'nada' | 'paga';

export function zonasPremio(premio: Premio | null, participantes: number): ZonaPuesto[] {
  const n = Math.max(2, participantes);
  if (!premio || premio.tipo === 'nada') return Array(n).fill('nada');
  if (premio.tipo === 'dinero') return Array.from({ length: n }, (_, i) => (i < premio.ganadores && (premio.reparto[i] ?? 0) > 0 ? 'gana' : 'nada'));
  const pagan = Math.min(Math.max(1, premio.pagan ?? 1), n - 1);
  const ganan = Math.min(Math.max(0, premio.ganan ?? 0), n - pagan);
  return Array.from({ length: n }, (_, i) => (i >= n - pagan ? 'paga' : i < ganan ? 'gana' : 'nada'));
}

const COLORES: Record<ZonaPuesto, { bg: string; bd: string; tx: string }> = {
  gana: { bg: 'rgba(61,220,132,0.16)', bd: 'rgba(61,220,132,0.6)', tx: '#3DDC84' },
  nada: { bg: 'rgba(255,255,255,0.04)', bd: '#2A3733', tx: '#8B958F' },
  paga: { bg: 'rgba(255,92,92,0.16)', bd: 'rgba(255,92,92,0.6)', tx: '#FF8A8A' },
};

export default function TiraPuestos({ premio, participantes, compacta = false, sinTitulo = false }: { premio: Premio | null; participantes: number; compacta?: boolean; sinTitulo?: boolean }) {
  const zonas = zonasPremio(premio, participantes);
  const n = zonas.length;
  const dinero = premio?.tipo === 'dinero';
  const importe = (i: number) => (dinero && premio ? formatoEuros(Math.round((((premio.aportacion ?? 0) * n * (premio.reparto[i] ?? 0)) / 100) * 100) / 100) : null);
  const hay = (z: ZonaPuesto) => zonas.includes(z);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compacta ? 5 : 8 }}>
      {premio && premio.tipo !== 'nada' && !sinTitulo && (
        <span style={{ fontSize: compacta ? 12 : 13, fontWeight: 700, color: S.TEXT }}>
          {premio.tipo === 'dinero' ? `${formatoEuros(premio.aportacion ?? 0)} cada uno · bote de ${formatoEuros((premio.aportacion ?? 0) * n)}` : `En juego: ${premio.descripcion || 'algo'}`}
        </span>
      )}
      <div style={{ display: 'flex', gap: compacta ? 3 : 4, flexWrap: 'wrap' }}>
        {zonas.map((z, i) => {
          const c = COLORES[z];
          const cobra = z === 'gana' ? importe(i) : null;
          return (
            <span
              key={i}
              style={{
                minWidth: compacta ? 26 : 38,
                padding: compacta ? '3px 0' : cobra ? '5px 4px' : '6px 0',
                textAlign: 'center',
                borderRadius: compacta ? 6 : 8,
                fontSize: compacta ? 10.5 : 12,
                fontWeight: 800,
                background: c.bg,
                border: `1px solid ${c.bd}`,
                color: c.tx,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                lineHeight: 1.15,
              }}
            >
              {i + 1}º{cobra && !compacta && <span style={{ fontSize: 10, fontWeight: 700 }}>{cobra}</span>}
            </span>
          );
        })}
      </div>
      {!compacta && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11.5, color: S.MUTED_2 }}>
          {hay('gana') && (
            <span>
              <span style={{ color: COLORES.gana.tx }}>■</span> {dinero ? 'Cobran' : 'Ganan'}
            </span>
          )}
          {hay('nada') && (
            <span>
              <span style={{ color: S.MUTED_3 }}>■</span> {dinero ? 'No cobran' : 'Ni ganan ni pagan'}
            </span>
          )}
          {hay('paga') && (
            <span>
              <span style={{ color: COLORES.paga.tx }}>■</span> Pagan
            </span>
          )}
        </div>
      )}
    </div>
  );
}
