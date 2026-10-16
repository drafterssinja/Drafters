'use client';

import { useMemo, useState } from 'react';
import * as S from '@/lib/mockupStyles';
import EscudoEquipo from '@/components/EscudoEquipo';
import { useEscudos } from '@/components/equipo/useEscudos';
import { lineaDePosicion, type LineaFutbol } from '@/lib/salaShared';

// ============================================================================
// ELEGIR JUGADOR EN EL DRAFT (16/10, Iñi)
// ============================================================================
// "La pantalla en la que se vean los partidos a la izquierda con los jugadores
// a la derecha, que puedas ir seleccionando de cada partido qué jugadores ver".
// Igual que la de crear equipo de las mesas: columna de partidos (con escudos)
// para filtrar y, a la derecha, los jugadores por línea. Los que ya ha cogido
// alguien salen tachados (o se ocultan), y se avisa de por qué no puedes coger
// a uno (posición llena o ya tienes 2 de ese equipo).

export type JugDraft = { id: string; nombre: string; posicion: string | null; equipo_real: string | null; lesionado: boolean };
export type PartidoDraft = { local: string; visitante: string };

const LINEAS: LineaFutbol[] = ['POR', 'DEF', 'MED', 'DEL'];
const LINEA_PLURAL: Record<LineaFutbol, string> = { POR: 'Porteros', DEF: 'Defensas', MED: 'Centrocampistas', DEL: 'Delanteros' };
const TOPE: Record<LineaFutbol, number> = { POR: 20, DEF: 50, MED: 50, DEL: 50 };
export const MAX_POR_EQUIPO_DRAFT = 2;

function normalizar(t: string) {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export default function SelectorDraft({
  jugadores,
  partidos,
  futbol,
  elegidoPor,
  nombres,
  esMiTurno,
  miConteo,
  miPorEquipo,
  lineaPosible,
  topOffset,
  onElegir,
}: {
  jugadores: JugDraft[];
  partidos: PartidoDraft[];
  futbol: boolean;
  elegidoPor: Map<string, string>;
  nombres: Record<string, string>;
  esMiTurno: boolean;
  miConteo: Record<LineaFutbol, number>;
  miPorEquipo: Map<string, number>;
  lineaPosible: (l: LineaFutbol) => boolean;
  topOffset: number;
  onElegir: (j: JugDraft) => void;
}) {
  const { escudoDe, escudoAlternativo } = useEscudos();
  const [busqueda, setBusqueda] = useState('');
  const [partidosOn, setPartidosOn] = useState<Set<string>>(new Set());
  const [ocultarElegidos, setOcultarElegidos] = useState(true);
  const [abiertas, setAbiertas] = useState<Record<LineaFutbol, boolean>>({ POR: true, DEF: true, MED: true, DEL: true });
  const [expandidas, setExpandidas] = useState<Record<LineaFutbol, boolean>>({ POR: false, DEF: false, MED: false, DEL: false });
  const [verTodosPlano, setVerTodosPlano] = useState(false);
  const clave = (p: PartidoDraft) => `${p.local}|||${p.visitante}`;

  const equiposVisibles = useMemo(() => {
    if (partidosOn.size === 0) return null;
    const s = new Set<string>();
    partidos.forEach((p) => {
      if (partidosOn.has(clave(p))) {
        s.add(p.local);
        s.add(p.visitante);
      }
    });
    return s;
  }, [partidos, partidosOn]);

  const q = normalizar(busqueda);
  const filtrados = useMemo(
    () =>
      jugadores.filter((j) => {
        if (ocultarElegidos && elegidoPor.has(j.id)) return false;
        if (equiposVisibles && !(j.equipo_real && equiposVisibles.has(j.equipo_real))) return false;
        if (q && !normalizar(j.nombre).includes(q)) return false;
        return true;
      }),
    [jugadores, ocultarElegidos, elegidoPor, equiposVisibles, q]
  );

  // Por qué no se puede coger a un jugador (null = se puede).
  function motivo(j: JugDraft): string | null {
    if (elegidoPor.has(j.id)) return null;
    if (futbol && !lineaPosible(lineaDePosicion(j.posicion))) return 'Línea llena';
    if (futbol && j.equipo_real && (miPorEquipo.get(j.equipo_real) ?? 0) >= MAX_POR_EQUIPO_DRAFT) return `Ya tienes ${MAX_POR_EQUIPO_DRAFT} de este equipo`;
    return null;
  }

  function fila(j: JugDraft) {
    const de = elegidoPor.get(j.id);
    const bloqueo = motivo(j);
    const puede = esMiTurno && !de && !bloqueo;
    return (
      <button
        key={j.id}
        type="button"
        disabled={!puede}
        onClick={() => onElegir(j)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          width: '100%',
          textAlign: 'left',
          padding: '9px 8px',
          background: S.PANEL,
          border: `1px solid ${puede ? 'rgba(61,220,132,0.35)' : '#1E2723'}`,
          borderRadius: 10,
          cursor: puede ? 'pointer' : 'default',
          opacity: de ? 0.4 : bloqueo ? 0.55 : 1,
        }}
      >
        {futbol && j.equipo_real && <EscudoEquipo url={escudoDe(j.equipo_real)} alternativa={escudoAlternativo(j.equipo_real)} nombre={j.equipo_real} tam={18} />}
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: de ? 'line-through' : 'none' }}>
            {j.nombre} {j.lesionado ? '🚑' : ''}
          </span>
          {j.equipo_real && <span style={{ fontSize: 10, color: S.MUTED_3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.equipo_real}</span>}
        </span>
        {de ? (
          <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: '#A78BFA' }}>@{nombres[de] ?? '?'}</span>
        ) : bloqueo ? (
          <span style={{ flexShrink: 0, maxWidth: 82, fontSize: 9.5, fontWeight: 700, color: '#F0B94D', textAlign: 'right', lineHeight: 1.2 }}>{bloqueo}</span>
        ) : esMiTurno ? (
          <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 800, color: '#04140B', background: S.ACCENT, borderRadius: 8, padding: '5px 8px' }}>Elegir</span>
        ) : (
          <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', border: `1px solid ${S.BORDER}` }} />
        )}
      </button>
    );
  }

  const columnaAlta = `calc(100vh - ${topOffset + 16}px)`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ position: 'relative' }}>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar jugador por nombre..."
          style={{ ...S.input, fontSize: 13, padding: '10px 34px 10px 12px', border: `1px solid ${busqueda ? S.ACCENT : S.BORDER}` }}
        />
        {busqueda && (
          <button type="button" onClick={() => setBusqueda('')} aria-label="Borrar búsqueda" style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', width: 24, height: 24, border: 'none', background: 'transparent', color: S.MUTED_3, fontSize: 16, cursor: 'pointer' }}>
            ×
          </button>
        )}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: S.MUTED_2, cursor: 'pointer' }}>
        <input type="checkbox" checked={ocultarElegidos} onChange={(e) => setOcultarElegidos(e.target.checked)} style={{ width: 16, height: 16, accentColor: S.ACCENT }} />
        Ocultar los jugadores que ya ha cogido alguien
      </label>

      {futbol ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          {partidos.length > 0 && (
            <div style={{ flexShrink: 0, width: 84, display: 'flex', flexDirection: 'column', gap: 4, position: 'sticky', top: topOffset, maxHeight: columnaAlta, overflowY: 'auto', scrollbarWidth: 'thin' } as React.CSSProperties}>
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3, textAlign: 'center' }}>Partidos</span>
              <button
                type="button"
                onClick={() => setPartidosOn(new Set())}
                style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 11, padding: '4px 4px', borderRadius: 8, border: `1px solid ${partidosOn.size === 0 ? S.ACCENT : S.BORDER}`, background: partidosOn.size === 0 ? 'rgba(61,220,132,0.12)' : 'transparent', color: partidosOn.size === 0 ? S.ACCENT : S.MUTED, cursor: 'pointer' }}
              >
                Todos
              </button>
              {partidos.map((p) => {
                const k = clave(p);
                const on = partidosOn.has(k);
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() =>
                      setPartidosOn((prev) => {
                        const s = new Set(prev);
                        if (s.has(k)) s.delete(k);
                        else s.add(k);
                        return s;
                      })
                    }
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, padding: '4px 3px', borderRadius: 8, border: `1px solid ${on ? S.ACCENT : S.BORDER}`, background: on ? 'rgba(61,220,132,0.12)' : S.PANEL, cursor: 'pointer' }}
                  >
                    <EscudoEquipo url={escudoDe(p.local)} alternativa={escudoAlternativo(p.local)} nombre={p.local} tam={24} />
                    <span style={{ color: S.MUTED_3, fontSize: 7.5, fontWeight: 600 }}>vs</span>
                    <EscudoEquipo url={escudoDe(p.visitante)} alternativa={escudoAlternativo(p.visitante)} nombre={p.visitante} tam={24} />
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {LINEAS.map((l) => {
              const todas = filtrados.filter((j) => lineaDePosicion(j.posicion) === l);
              if (todas.length === 0) return null;
              const mostrar = q || expandidas[l] ? todas : todas.slice(0, TOPE[l]);
              const resto = todas.length - mostrar.length;
              return (
                <div key={l} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button type="button" onClick={() => setAbiertas((a) => ({ ...a, [l]: !a[l] }))} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'transparent', border: 'none', padding: '2px 0', cursor: 'pointer' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: lineaPosible(l) ? S.MUTED_3 : '#F0B94D' }}>
                      {LINEA_PLURAL[l]} · tienes {miConteo[l]} · {todas.length}
                      {!lineaPosible(l) ? ' · llena' : ''}
                    </span>
                    <span style={{ fontSize: 11, color: S.MUTED_3 }}>{abiertas[l] ? '▾' : '▸'}</span>
                  </button>
                  {abiertas[l] && (
                    <>
                      {mostrar.map(fila)}
                      {resto > 0 && (
                        <button type="button" onClick={() => setExpandidas((e) => ({ ...e, [l]: true }))} style={{ fontSize: 12, fontWeight: 700, color: S.ACCENT, background: 'transparent', border: '1px solid rgba(61,220,132,0.35)', borderRadius: 9, padding: '7px 10px', cursor: 'pointer' }}>
                          Mostrar {resto} más
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {filtrados.length === 0 && <p style={{ fontSize: 12, color: S.MUTED_3, margin: 0 }}>{q ? 'Ningún jugador coincide con esa búsqueda.' : 'No quedan jugadores libres en los partidos marcados.'}</p>}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(q || verTodosPlano ? filtrados : filtrados.slice(0, 50)).map(fila)}
          {!q && !verTodosPlano && filtrados.length > 50 && (
            <button type="button" onClick={() => setVerTodosPlano(true)} style={{ fontSize: 12, fontWeight: 700, color: S.ACCENT, background: 'transparent', border: '1px solid rgba(61,220,132,0.35)', borderRadius: 9, padding: '7px 10px', cursor: 'pointer' }}>
              Mostrar {filtrados.length - 50} más
            </button>
          )}
          {filtrados.length === 0 && <p style={{ fontSize: 12, color: S.MUTED_3, margin: 0 }}>Ningún jugador coincide con esa búsqueda.</p>}
        </div>
      )}
    </div>
  );
}
