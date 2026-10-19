'use client';

import { useEffect, useState } from 'react';
import * as S from '@/lib/mockupStyles';
import TiraPuestos from '@/components/v2/TiraPuestos';
import { esDineroGP, esRepartoEquitativoGP, formatoEuros, repartoEquitativoGP, textoPagan, type Premio } from '@/lib/v2';

// 19/10 (Iñi): en las cajitas de euros, al pinchar el cursor se quedaba a la
// izquierda del número y no se sabía cómo borrarlo. Ahora: al pinchar se
// selecciona todo (lo que escribas lo sustituye), se puede dejar vacía mientras
// escribes, y a la derecha hay flechas ▲▼ que suben y bajan de 1 en 1 €.
function aTexto(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '';
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100).replace('.', ',');
}
function CajaEuros({ valor, onChange, color, ancho = 120, vacioEsNull = false, placeholder }: { valor: number | null; onChange: (v: number | null) => void; color: string; ancho?: number | string; vacioEsNull?: boolean; placeholder?: string }) {
  const [texto, setTexto] = useState(aTexto(valor));
  const [editando, setEditando] = useState(false);
  useEffect(() => {
    if (!editando) setTexto(aTexto(valor));
  }, [valor, editando]);
  const cambiarTexto = (t: string) => {
    const limpio = t.replace(/[^0-9.,]/g, '');
    setTexto(limpio);
    if (limpio === '') return onChange(vacioEsNull ? null : 0);
    const n = Number(limpio.replace(',', '.'));
    if (Number.isFinite(n)) onChange(Math.max(0, Math.round(n * 100) / 100));
  };
  const sumar = (d: number) => {
    setEditando(false);
    onChange(Math.max(0, Math.round(((valor ?? 0) + d) * 100) / 100));
  };
  const flecha = { flex: 1, width: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: S.TEXT, fontSize: 11, cursor: 'pointer', padding: 0 } as const;
  return (
    <div style={{ width: ancho, height: 44, display: 'flex', alignItems: 'stretch', borderRadius: 10, border: `1px solid ${color}66`, background: S.PANEL, overflow: 'hidden', flexShrink: 0 }}>
      <input
        type="text"
        inputMode="decimal"
        value={texto}
        placeholder={placeholder}
        onFocus={(e) => {
          setEditando(true);
          const el = e.currentTarget;
          window.setTimeout(() => el.select(), 0);
        }}
        onBlur={() => setEditando(false)}
        onChange={(e) => cambiarTexto(e.target.value)}
        style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', padding: '0 4px 0 10px', textAlign: 'right', fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 16, color }}
      />
      <span style={{ display: 'flex', alignItems: 'center', paddingRight: 6, fontWeight: 800, fontSize: 14, color }}>€</span>
      <div style={{ display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${color}44` }}>
        <button type="button" aria-label="Subir 1 €" onClick={() => sumar(1)} style={{ ...flecha, borderBottom: `1px solid ${color}44` }}>
          ▲
        </button>
        <button type="button" aria-label="Bajar 1 €" onClick={() => sumar(-1)} disabled={(valor ?? 0) <= 0} style={{ ...flecha, opacity: (valor ?? 0) <= 0 ? 0.35 : 1 }}>
          ▼
        </button>
      </div>
    </div>
  );
}

export const PREMIO_VACIO: Premio = { tipo: 'nada', aportacion: null, descripcion: '', ganadores: 1, reparto: [100], pagan: 1, ganan: 0 };

// Qué se juega la sala (15/10, Iñi):
//  · Dinero (16/10): cuántos ganan y cuántos pierden, cuánto paga cada uno de los
//    que pierden y, si se quiere, cuánto cobra / paga cada puesto (por defecto a
//    partes iguales).
//  · Otra cosa (una cena, un cubata...): sin porcentajes; qué es y cuántos lo pagan
//    (los últimos de la clasificación).
export default function EditorPremio({ premio, onChange, participantes }: { premio: Premio; onChange: (p: Premio) => void; participantes: number }) {
  const set = (cambios: Partial<Premio>) => onChange({ ...premio, ...cambios });
  const [repartoManual, setRepartoManual] = useState(false);
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(
          [
            ['nada', 'Solo por la gloria'],
            ['dinero', 'Dinero'],
            ['otro', 'Otra cosa'],
          ] as const
        ).map(([t, l]) => (
          <button
            key={t}
            type="button"
            style={S.pill(premio.tipo === t)}
            onClick={() =>
              t === 'dinero' && !esDineroGP(premio)
                ? set({ tipo: 'dinero', ganan: 1, pagan: 1, ...repartoEquitativoGP(1, 1, premio.aportacion ?? 0) })
                : set({ tipo: t, pagan: premio.pagan ?? 1, ganan: t === 'otro' && premio.tipo === 'dinero' ? 0 : premio.ganan ?? 0 })
            }
          >
            {l}
          </button>
        ))}
      </div>

      {premio.tipo === 'dinero' && (() => {
        // 16/10 (Iñi): con dinero también se elige cuántos ganan y cuántos
        // pierden, y cuánto cobra / paga cada uno. Por defecto a partes iguales.
        const n = Math.max(2, participantes);
        const gp = esDineroGP(premio) ? premio : { ...premio, ...repartoEquitativoGP(1, 1, premio.aportacion ?? 0) };
        const ganan = Math.min(gp.cobros!.length, n - 1);
        const pagan = Math.min(gp.pagos!.length, n - ganan);
        const equitativo = (g: number, pg: number, cada: number | null) => set({ aportacion: cada, ganan: g, pagan: pg, ...repartoEquitativoGP(g, pg, cada ?? 0) });
        const totalCobra = Math.round(gp.cobros!.reduce((x, y) => x + y, 0) * 100) / 100;
        const totalPaga = Math.round(gp.pagos!.reduce((x, y) => x + y, 0) * 100) / 100;
        const cuadra = Math.abs(totalCobra - totalPaga) < 0.01;
        const manual = repartoManual || !esRepartoEquitativoGP(gp);
        const importe = (valor: number, cambiar: (v: number) => void, color: string) => <CajaEuros valor={valor} onChange={(v) => cambiar(v ?? 0)} color={color} />;
        return (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ ...S.label, color: '#3DDC84' }}>¿Cuántos ganan?</span>
                {paso(ganan, 1, n - pagan, (v) => equitativo(v, pagan, gp.aportacion), '#3DDC84')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ ...S.label, color: '#FF8A8A' }}>¿Cuántos pierden?</span>
                {paso(pagan, 1, n - ganan, (v) => equitativo(ganan, v, gp.aportacion), '#FF8A8A')}
              </div>
            </div>
            <label style={S.field}>
              <span style={S.label}>¿Cuánto paga cada uno de los que pierden? (€)</span>
              <CajaEuros
                valor={gp.aportacion ?? null}
                vacioEsNull
                ancho="100%"
                color={S.TEXT}
                placeholder="Ej. 10"
                onChange={(v) => {
                  setRepartoManual(false);
                  equitativo(ganan, pagan, v);
                }}
              />
            </label>

            <TiraPuestos premio={{ ...gp, ganan, pagan }} participantes={n} sinTitulo />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: S.TEXT }}>{manual ? 'Reparto a mano' : 'Reparto a partes iguales'}</span>
                {manual ? (
                  <button type="button" onClick={() => { setRepartoManual(false); equitativo(ganan, pagan, gp.aportacion); }} style={{ background: 'none', border: 'none', color: '#A78BFA', fontWeight: 700, fontSize: 12, cursor: 'pointer', padding: 0 }}>
                    Volver a partes iguales
                  </button>
                ) : (
                  <button type="button" onClick={() => setRepartoManual(true)} style={{ background: 'none', border: 'none', color: '#A78BFA', fontWeight: 700, fontSize: 12, cursor: 'pointer', padding: 0 }}>
                    ✏️ Cambiar el reparto
                  </button>
                )}
              </div>
              {gp.cobros!.slice(0, ganan).map((c, i) => (
                <div key={`c${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 13, color: S.MUTED }}>
                  <span>
                    <b style={{ color: '#3DDC84' }}>{i + 1}º</b> cobra
                  </span>
                  {manual ? (
                    importe(c, (v) => {
                      const r = [...gp.cobros!];
                      r[i] = v;
                      set({ ganan, pagan, cobros: r, pagos: gp.pagos });
                    }, '#3DDC84')
                  ) : (
                    <b style={{ color: '#3DDC84' }}>{formatoEuros(c)}</b>
                  )}
                </div>
              ))}
              {gp.pagos!.slice(0, pagan).map((c, k) => (
                <div key={`p${k}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 13, color: S.MUTED }}>
                  <span>
                    <b style={{ color: '#FF8A8A' }}>{n - pagan + k + 1}º</b> paga{n - pagan + k + 1 === n ? ' (el último)' : ''}
                  </span>
                  {manual ? (
                    importe(c, (v) => {
                      const r = [...gp.pagos!];
                      r[k] = v;
                      set({ ganan, pagan, cobros: gp.cobros, pagos: r });
                    }, '#FF8A8A')
                  ) : (
                    <b style={{ color: '#FF8A8A' }}>{formatoEuros(c)}</b>
                  )}
                </div>
              ))}
              {n - ganan - pagan > 0 && <span style={{ fontSize: 12, color: S.MUTED_3 }}>{n - ganan - pagan === 1 ? `El ${ganan + 1}º ni cobra ni paga.` : `Del ${ganan + 1}º al ${n - pagan}º ni cobran ni pagan.`}</span>}
              <span style={{ fontSize: 12, fontWeight: 700, color: cuadra ? S.MUTED_2 : '#FF8A8A' }}>
                {cuadra ? `Se mueven ${formatoEuros(totalPaga)} en total (con ${n} jugadores).` : `⚠️ No cuadra: cobran ${formatoEuros(totalCobra)} y pagan ${formatoEuros(totalPaga)}. Tiene que ser lo mismo.`}
              </span>
              <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>Si hay empate, los empatados se reparten a partes iguales lo de sus puestos.</span>
            </div>
          </>
        );
      })()}

      {premio.tipo === 'otro' && (() => {
        // 15/10 (Iñi): sin porcentajes. Tres zonas: ganan (los primeros), tierra
        // de nadie (ni ganan ni pagan) y pagan (los últimos). Se mueven los dos umbrales.
        const n = Math.max(2, participantes);
        const pagan = Math.min(Math.max(1, premio.pagan ?? 1), n - 1);
        const ganan = Math.min(Math.max(0, premio.ganan ?? 0), n - pagan);
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
