'use client';

import * as S from '@/lib/mockupStyles';
import TiraPuestos from '@/components/v2/TiraPuestos';
import { repartoPorDefecto, textoBote, textoPagan, textoPuesto, type Premio } from '@/lib/v2';

export const PREMIO_VACIO: Premio = { tipo: 'nada', aportacion: null, descripcion: '', ganadores: 1, reparto: [100], pagan: 1, ganan: 0 };

// Qué se juega la sala (15/10, Iñi):
//  · Dinero: cuánto pone cada uno, cuántos ganadores y el % del bote de cada puesto.
//  · Otra cosa (una cena, un cubata...): sin porcentajes; qué es y cuántos lo pagan
//    (los últimos de la clasificación).
export default function EditorPremio({ premio, onChange, participantes }: { premio: Premio; onChange: (p: Premio) => void; participantes: number }) {
  const set = (cambios: Partial<Premio>) => onChange({ ...premio, ...cambios });
  const maxGanadores = Math.max(1, Math.min(participantes - 1, 6));
  const numeros = (max: number) => Array.from({ length: max }, (_, i) => i + 1);
  const pillNumero = (on: boolean) => ({ ...S.pill(on), minWidth: 40, textAlign: 'center' as const });

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
          <button key={t} type="button" style={S.pill(premio.tipo === t)} onClick={() => set({ tipo: t, pagan: premio.pagan ?? 1, ganan: premio.ganan ?? 0 })}>
            {l}
          </button>
        ))}
      </div>

      {premio.tipo === 'dinero' && (
        <>
          <label style={S.field}>
            <span style={S.label}>¿Cuánto pone cada uno? (€)</span>
            <input type="number" inputMode="decimal" min={0} step={1} value={premio.aportacion ?? ''} onChange={(e) => set({ aportacion: e.target.value === '' ? null : Number(e.target.value) })} style={S.input} placeholder="Ej. 5" />
          </label>
          <div style={S.field}>
            <span style={S.label}>¿Cuántos ganadores?</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {numeros(maxGanadores).map((n) => (
                <button key={n} type="button" style={pillNumero(premio.ganadores === n)} onClick={() => set({ ganadores: n, reparto: repartoPorDefecto(n) })}>
                  {n}
                </button>
              ))}
            </div>
          </div>
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
            <div>
              {textoBote(premio, participantes)} (con {participantes} jugadores)
            </div>
            {premio.reparto.map((_, i) => (
              <div key={i}>
                {i + 1}º → {textoPuesto(premio, i, participantes)}
              </div>
            ))}
            <div style={{ marginTop: 4, color: S.MUTED_3 }}>Si hay empate, los empatados se reparten a partes iguales lo de sus puestos.</div>
          </div>
        </>
      )}

      {premio.tipo === 'otro' && (() => {
        // 15/10 (Iñi): sin porcentajes. Tres zonas: ganan (los primeros), tierra
        // de nadie (ni ganan ni pagan) y pagan (los últimos). Se mueven los dos umbrales.
        const n = Math.max(2, participantes);
        const pagan = Math.min(Math.max(1, premio.pagan ?? 1), n - 1);
        const ganan = Math.min(Math.max(0, premio.ganan ?? 0), n - pagan);
        const paso = (valor: number, min: number, max: number, cambiar: (v: number) => void, color: string) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" disabled={valor <= min} onClick={() => cambiar(valor - 1)} style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${S.BORDER}`, background: S.PANEL, color: S.TEXT, fontSize: 20, fontWeight: 800, cursor: 'pointer', opacity: valor <= min ? 0.35 : 1 }}>
              −
            </button>
            <span style={{ minWidth: 26, textAlign: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 24, color }}>{valor}</span>
            <button type="button" disabled={valor >= max} onClick={() => cambiar(valor + 1)} style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${S.BORDER}`, background: S.PANEL, color: S.TEXT, fontSize: 20, fontWeight: 800, cursor: 'pointer', opacity: valor >= max ? 0.35 : 1 }}>
              +
            </button>
          </div>
        );
        return (
          <>
            <label style={S.field}>
              <span style={S.label}>¿Qué os jugáis?</span>
              <input value={premio.descripcion} maxLength={60} onChange={(e) => set({ descripcion: e.target.value })} style={S.input} placeholder="Ej. la cena, un cubata para cada uno, los cafés..." />
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ ...S.label, color: '#3DDC84' }}>Ganan los primeros</span>
                {paso(ganan, 0, n - pagan, (v) => set({ ganan: v, pagan }), '#3DDC84')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ ...S.label, color: '#FF8A8A' }}>Pagan los últimos</span>
                {paso(pagan, 1, n - ganan, (v) => set({ pagan: v, ganan }), '#FF8A8A')}
              </div>
            </div>
            {/* Así queda la clasificación, puesto a puesto (la misma tira se ve luego en la sala) */}
            <TiraPuestos premio={{ ...premio, pagan, ganan }} participantes={n} sinTitulo />
            <div style={{ fontSize: 12.5, color: S.MUTED, lineHeight: 1.6, background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontWeight: 700, color: S.TEXT }}>{textoPagan({ ...premio, pagan, ganan }, n)}.</div>
              <div style={{ marginTop: 4, color: S.MUTED_3 }}>Si hay empate justo en un corte, entran todos los empatados (los que pagan, a escote).</div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
