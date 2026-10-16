'use client';

import * as S from '@/lib/mockupStyles';
import EscudoEquipo from '@/components/EscudoEquipo';
import { useEscudos } from '@/components/equipo/useEscudos';
import { inicialesJugador, lineaDePosicion, type LineaFutbol } from '@/lib/salaShared';

// ============================================================================
// EQUIPO DIBUJADO EN UN CAMPO (16/10, Iñi)
// ============================================================================
// "Una vez finalizado el draft, los equipos los tienes que poner en un dibujo
// de alineación en un campo, en función de cuántos de cada posición se hayan
// elegido". Cada línea del campo lleva tantos jugadores como haya de esa
// posición (p. ej. 1-4-3-3), con delanteros arriba y portero abajo.

export type JugCampo = { id: string; nombre: string; posicion: string | null; equipo_real: string | null };

const COLOR_LINEA: Record<LineaFutbol, string> = { POR: '#FF7A45', DEF: '#8FB6FF', MED: '#F0B94D', DEL: '#3DDC84' };
const ORDEN: LineaFutbol[] = ['DEL', 'MED', 'DEF', 'POR'];

export default function CampoAlineacion({ jugadores, titulo }: { jugadores: JugCampo[]; titulo?: string }) {
  const { escudoDe, escudoAlternativo } = useEscudos();
  const porLinea: Record<LineaFutbol, JugCampo[]> = { POR: [], DEF: [], MED: [], DEL: [] };
  jugadores.forEach((j) => porLinea[lineaDePosicion(j.posicion)].push(j));
  const esquema = `${porLinea.DEF.length}-${porLinea.MED.length}-${porLinea.DEL.length}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        {titulo && <span style={{ fontWeight: 800, fontSize: 14, color: S.TEXT }}>{titulo}</span>}
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color: S.ACCENT, marginLeft: 'auto' }}>{esquema}</span>
      </div>
      <div
        style={{
          position: 'relative',
          background: 'repeating-linear-gradient(180deg, #17402A 0px, #17402A 44px, #143923 44px, #143923 88px)',
          border: '2px solid rgba(255,255,255,0.18)',
          borderRadius: 14,
          padding: '14px 6px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 14,
          minHeight: 380,
          overflow: 'hidden',
        }}
      >
        {/* Líneas del campo */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 2, background: 'rgba(255,255,255,0.16)' }} />
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: 70, height: 70, marginLeft: -35, marginTop: -35, border: '2px solid rgba(255,255,255,0.16)', borderRadius: '50%' }} />
        <div style={{ position: 'absolute', left: '25%', right: '25%', bottom: 0, height: 54, border: '2px solid rgba(255,255,255,0.16)', borderBottom: 'none' }} />
        <div style={{ position: 'absolute', left: '25%', right: '25%', top: 0, height: 54, border: '2px solid rgba(255,255,255,0.16)', borderTop: 'none' }} />

        {ORDEN.map((l) => (
          <div key={l} style={{ position: 'relative', display: 'flex', justifyContent: 'space-evenly', alignItems: 'flex-start', gap: 2, minHeight: 64 }}>
            {porLinea[l].length === 0 ? (
              <span style={{ alignSelf: 'center', fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>Sin {l === 'POR' ? 'portero' : l === 'DEF' ? 'defensas' : l === 'MED' ? 'medios' : 'delanteros'}</span>
            ) : (
              porLinea[l].map((j) => (
                <div key={j.id} style={{ flex: 1, minWidth: 0, maxWidth: 80, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ position: 'relative' }}>
                    <span style={{ width: 36, height: 36, borderRadius: '50%', background: COLOR_LINEA[l], color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #F5F7F5', boxShadow: '0 3px 8px rgba(0,0,0,0.45)' }}>
                      {inicialesJugador(j.nombre)}
                    </span>
                    {j.equipo_real && (
                      <span style={{ position: 'absolute', right: -6, bottom: -4, background: '#F5F7F5', borderRadius: '50%', padding: 1.5, display: 'flex', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
                        <EscudoEquipo url={escudoDe(j.equipo_real)} alternativa={escudoAlternativo(j.equipo_real)} nombre={j.equipo_real} tam={16} />
                      </span>
                    )}
                  </div>
                  <span style={{ width: '100%', textAlign: 'center', fontSize: 10.5, fontWeight: 800, color: '#F5F7F5', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>{j.nombre.length <= 13 ? j.nombre : j.nombre.split(' ').slice(-1)[0]}</span>
                  {j.equipo_real && <span style={{ width: '100%', textAlign: 'center', fontSize: 8.5, color: 'rgba(255,255,255,0.65)', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.equipo_real}</span>}
                </div>
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
