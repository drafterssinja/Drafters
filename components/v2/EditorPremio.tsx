'use client';

import * as S from '@/lib/mockupStyles';
import { repartoPorDefecto, textoBote, textoPuesto, type Premio } from '@/lib/v2';

export const PREMIO_VACIO: Premio = { tipo: 'nada', aportacion: null, descripcion: '', ganadores: 1, reparto: [100] };

// Qué se juega la sala: dinero, otra cosa (un cubata, una cena...) o nada;
// cuántos ganadores y cómo se reparte el bote.
export default function EditorPremio({ premio, onChange, participantes }: { premio: Premio; onChange: (p: Premio) => void; participantes: number }) {
  const set = (cambios: Partial<Premio>) => onChange({ ...premio, ...cambios });
  const maxGanadores = Math.max(1, Math.min(participantes - 1, 6));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(
          [
            ['nada', 'Solo por la gloria'],
            ['dinero', 'Dinero'],
            ['otro', 'Otra cosa'],
          ] as const
        ).map(([t, l]) => (
          <button key={t} type="button" style={S.pill(premio.tipo === t)} onClick={() => set({ tipo: t })}>
            {l}
          </button>
        ))}
      </div>

      {premio.tipo === 'dinero' && (
        <label style={S.field}>
          <span style={S.label}>¿Cuánto pone cada uno? (€)</span>
          <input type="number" inputMode="decimal" min={0} step={1} value={premio.aportacion ?? ''} onChange={(e) => set({ aportacion: e.target.value === '' ? null : Number(e.target.value) })} style={S.input} placeholder="Ej. 5" />
        </label>
      )}
      {premio.tipo === 'otro' && (
        <label style={S.field}>
          <span style={S.label}>¿Qué pone cada uno?</span>
          <input value={premio.descripcion} maxLength={60} onChange={(e) => set({ descripcion: e.target.value })} style={S.input} placeholder="Ej. un cubata, una cena, un café..." />
        </label>
      )}

      {premio.tipo !== 'nada' && (
        <>
          <label style={S.field}>
            <span style={S.label}>¿Cuántos ganadores?</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Array.from({ length: maxGanadores }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" style={S.pill(premio.ganadores === n)} onClick={() => set({ ganadores: n, reparto: repartoPorDefecto(n) })}>
                  {n}
                </button>
              ))}
            </div>
          </label>
          {premio.ganadores > 1 && (
            <div style={S.field}>
              <span style={S.label}>Reparto del bote (%)</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {premio.reparto.map((pct, i) => (
                  <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: S.MUTED }}>
                    {i + 1}º
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      value={pct}
                      onChange={(e) => {
                        const r = [...premio.reparto];
                        r[i] = Number(e.target.value) || 0;
                        set({ reparto: r });
                      }}
                      style={{ ...S.input, width: 64, padding: '8px 8px' }}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
          <div style={{ fontSize: 12, color: S.MUTED_2, lineHeight: 1.6, background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 12px' }}>
            <div>{textoBote(premio, participantes)} (con {participantes} jugadores)</div>
            {premio.reparto.map((_, i) => (
              <div key={i}>
                {i + 1}º → {textoPuesto(premio, i, participantes)}
              </div>
            ))}
            <div style={{ marginTop: 4, color: S.MUTED_3 }}>Si hay empate, los empatados se reparten a partes iguales lo de sus puestos.</div>
          </div>
        </>
      )}
    </div>
  );
}
