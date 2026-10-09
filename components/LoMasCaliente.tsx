'use client';

// ============================================================================
// "LO MÁS CALIENTE, AHORA" CON DATOS REALES (09/10, pedido de Iñi)
// ============================================================================
// Los jugadores que más puntos Drafters están sacando, por deporte, leídos de
// la función lo_mas_caliente() (ver 16_sql_...sql): mejores de la jornada de
// fútbol más reciente y del torneo de golf más reciente. Va cambiando solo de
// deporte cada 3 segundos, empezando SIEMPRE por fútbol; las pastillas dejan
// saltar a uno concreto (y el cambio automático sigue desde ahí).
//
// Se usa en la portada (sin sesión) y en /inicio, debajo de todo.
// Si todavía no hay datos reales (o el SQL no se ha ejecutado), se enseña el
// ejemplo ilustrativo de siempre, marcado como tal.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { formatPuntos } from '@/lib/futbolLaLiga';

const ACCENT = '#3DDC84';
const SEGUNDOS_POR_DEPORTE = 3;
const ORDEN: Deporte[] = ['futbol', 'golf', 'tenis'];
const NOMBRE_DEPORTE: Record<Deporte, string> = { futbol: 'Fútbol', golf: 'Golf', tenis: 'Tenis' };

type Deporte = 'futbol' | 'golf' | 'tenis';
type Linea = { clave?: string; etiqueta: string; cantidad?: number; puntos: number };
type FilaApi = { deporte: Deporte; competicion: string; nombre: string; contexto: string | null; puntos: number | string; desglose: Linea[] | null; en_vivo: boolean };

type Jugador = { nombre: string; contexto: string; total: string; acciones: { label: string; pts: string }[]; highlight: string };
type Bloque = { etiqueta: string; enVivo: boolean; ejemplo: boolean; lider: Jugador; otros: Jugador[] };

function signo(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatPuntos(Math.abs(n))}`;
}

function accionesDe(desglose: Linea[] | null): { label: string; pts: string }[] {
  return (desglose ?? [])
    .filter((l) => typeof l.puntos === 'number' && l.puntos !== 0)
    .sort((a, b) => Math.abs(b.puntos) - Math.abs(a.puntos))
    .slice(0, 3)
    .map((l) => ({ label: `${l.etiqueta}${l.cantidad && l.cantidad > 1 ? ` ×${l.cantidad}` : ''}`, pts: signo(l.puntos) }));
}

function aJugador(f: FilaApi): Jugador {
  const acciones = accionesDe(f.desglose);
  return {
    nombre: f.nombre,
    contexto: f.contexto ?? '',
    total: `${formatPuntos(Number(f.puntos))} pts`,
    acciones,
    highlight: acciones[0] ? `${acciones[0].label} ${acciones[0].pts}` : '',
  };
}

// Ejemplo ilustrativo (lo que había antes en la portada) — solo si no hay datos reales.
const EJEMPLO: Record<Deporte, Bloque> = {
  futbol: {
    etiqueta: 'Fútbol · Jornada 8',
    enVivo: true,
    ejemplo: true,
    lider: { nombre: 'I. Etxarri', contexto: "Real Sociedad 2-1 Athletic · Min 63'", total: '17 pts', highlight: '', acciones: [{ label: 'Gol marcado', pts: '+10' }, { label: 'Asistencia', pts: '+6' }, { label: 'Disparo a puerta', pts: '+1' }] },
    otros: [
      { nombre: 'B. Zabaleta', contexto: "Min 78'", total: '12 pts', highlight: 'Asistencia +6', acciones: [] },
      { nombre: 'O. Larrea (GK)', contexto: "Min 90'", total: '9 pts', highlight: 'Portería a cero +6', acciones: [] },
    ],
  },
  golf: {
    etiqueta: 'Golf · Ronda 3',
    enVivo: true,
    ejemplo: true,
    lider: { nombre: 'A. Ibarra', contexto: 'Hoyo 16 · Par 5', total: '18 pts', highlight: '', acciones: [{ label: 'Birdie en hoyo 13', pts: '+3' }, { label: 'Eagle en hoyo 9', pts: '+8' }, { label: 'Racha de 3 birdies', pts: '+3' }] },
    otros: [
      { nombre: 'M. Lizarraga', contexto: 'Hoyo 16', total: '15 pts', highlight: 'Birdie hoyo 15 +3', acciones: [] },
      { nombre: 'J. Etxeberria', contexto: 'Hoyo 12', total: '13 pts', highlight: 'Vuelta sin bogeys +4', acciones: [] },
    ],
  },
  tenis: {
    etiqueta: 'Tenis · ATP 500',
    enVivo: true,
    ejemplo: true,
    lider: { nombre: 'C. Mendive', contexto: 'vs L. Ansorena · Set 2, 4-3', total: '19 pts', highlight: '', acciones: [{ label: 'Break conseguido', pts: '+0,75' }, { label: 'Game ganado', pts: '+2,5' }, { label: 'Ace', pts: '+0,4' }] },
    otros: [
      { nombre: 'A. Goikoetxea', contexto: 'Set 1, 6-4', total: '14 pts', highlight: 'Set en blanco +4', acciones: [] },
      { nombre: 'P. Sagasti', contexto: 'Set 3, 3-2', total: '11 pts', highlight: 'Break conseguido +0,75', acciones: [] },
    ],
  },
};

function pillStyle(isActive: boolean, disabled: boolean): React.CSSProperties {
  return {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 700,
    fontSize: 14,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    padding: '9px 16px',
    borderRadius: 999,
    border: `1px solid ${isActive ? ACCENT : '#2A3733'}`,
    background: isActive ? ACCENT : 'transparent',
    color: isActive ? '#04140B' : disabled ? '#4E574F' : '#AAB4AE',
    cursor: disabled ? 'default' : 'pointer',
    width: 'auto',
  };
}

export default function LoMasCaliente({ titulo = 'Lo más caliente, ahora.' }: { titulo?: string }) {
  const [reales, setReales] = useState<Partial<Record<Deporte, Bloque>> | null>(null);
  const [deporte, setDeporte] = useState<Deporte>('futbol');
  // Cambia en cada clic para reiniciar la cuenta atrás de 3 s (y la barrita).
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    let activo = true;
    async function cargar() {
      const { data, error } = await supabase.rpc('lo_mas_caliente', { p_limite: 3 });
      if (!activo) return;
      if (error || !Array.isArray(data)) {
        setReales({});
        return;
      }
      const porDeporte: Partial<Record<Deporte, Bloque>> = {};
      for (const d of ORDEN) {
        const filas = (data as FilaApi[]).filter((f) => f.deporte === d);
        if (filas.length === 0) continue;
        const enVivo = filas.some((f) => f.en_vivo);
        porDeporte[d] = {
          etiqueta: `${NOMBRE_DEPORTE[d]} · ${filas[0].competicion.replace(/\s+-\s+/g, ' · ')}`,
          enVivo,
          ejemplo: false,
          lider: aJugador(filas[0]),
          otros: filas.slice(1).map(aJugador),
        };
      }
      setReales(porDeporte);
    }
    cargar();
    const intervalo = setInterval(cargar, 60000);
    return () => {
      activo = false;
      clearInterval(intervalo);
    };
  }, []);

  const hayReales = !!reales && Object.keys(reales).length > 0;
  // Deportes que entran en la rotación: con datos reales, solo los que tienen
  // datos; sin ninguno, el ejemplo de los tres.
  const disponibles = useMemo<Deporte[]>(() => (hayReales ? ORDEN.filter((d) => reales?.[d]) : ORDEN), [hayReales, reales]);

  useEffect(() => {
    if (!disponibles.includes(deporte)) setDeporte(disponibles[0] ?? 'futbol');
  }, [disponibles, deporte]);

  useEffect(() => {
    if (disponibles.length < 2) return;
    const t = setTimeout(() => {
      const i = disponibles.indexOf(deporte);
      setDeporte(disponibles[(i + 1) % disponibles.length]);
    }, SEGUNDOS_POR_DEPORTE * 1000);
    return () => clearTimeout(t);
  }, [deporte, disponibles, vuelta]);

  const activo: Bloque = (hayReales ? reales?.[deporte] : EJEMPLO[deporte]) ?? EJEMPLO[deporte];
  const etiquetaEstado = activo.enVivo ? 'En vivo' : deporte === 'futbol' ? 'Última jornada' : 'Último torneo';

  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <style>{`@keyframes lmc-barra { from { width: 0% } to { width: 100% } } @keyframes lmc-entra { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }`}</style>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#F5F7F5', margin: 0 }}>{titulo}</h2>

      <div style={{ display: 'flex', gap: 8 }}>
        {ORDEN.map((d) => {
          const deshabilitado = !disponibles.includes(d);
          return (
            <button
              key={d}
              type="button"
              disabled={deshabilitado}
              title={deshabilitado ? 'Muy pronto, con puntuación en directo' : undefined}
              onClick={() => {
                setDeporte(d);
                setVuelta((v) => v + 1);
              }}
              style={pillStyle(deporte === d, deshabilitado)}
            >
              {NOMBRE_DEPORTE[d]}
              {deshabilitado ? ' · pronto' : ''}
            </button>
          );
        })}
      </div>

      {disponibles.length > 1 && (
        <div style={{ height: 3, borderRadius: 2, background: '#1E2723', overflow: 'hidden' }}>
          <div key={`${deporte}-${vuelta}`} style={{ height: '100%', background: ACCENT, animation: `lmc-barra ${SEGUNDOS_POR_DEPORTE}s linear both` }} />
        </div>
      )}

      <div key={`card-${deporte}`} style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: 'lmc-entra .35s ease-out both' }}>
        <div style={{ background: '#131917', border: '1px solid #22302B', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#8B958F', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activo.etiqueta}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: activo.enVivo ? '#FF7A45' : '#6B756F' }} />
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: activo.enVivo ? '#FF9F6E' : '#8B958F' }}>{etiquetaEstado}</span>
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 13, color: '#04140B', background: ACCENT, borderRadius: 6, padding: '1px 7px' }}>1</span>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20, color: '#F5F7F5' }}>{activo.lider.nombre}</span>
            </div>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 13, color: '#6B756F' }}>
              {activo.lider.contexto}
              {activo.ejemplo ? ' · *ejemplo ilustrativo' : ''}
            </div>
          </div>

          {activo.lider.acciones.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activo.lider.acciones.map((a) => (
                <div key={a.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 14, color: '#C7CFC9' }}>{a.label}</span>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color: a.pts.startsWith('−') ? '#FF7A6B' : ACCENT }}>{a.pts}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ height: 1, background: '#22302B' }} />

          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 12, color: '#6B756F', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {activo.enVivo ? 'Puntos en vivo' : 'Puntos Drafters'}
            </span>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 32, color: ACCENT }}>{activo.lider.total}</span>
          </div>
        </div>

        {activo.otros.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activo.otros.map((o, i) => (
              <div key={`${o.nombre}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#131917', border: '1px solid #1E2723', borderRadius: 12, padding: '12px 14px' }}>
                <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', background: '#1E2723', color: '#8B958F', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {i + 2}
                </span>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color: '#F5F7F5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.nombre}</span>
                  <span style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: '#6B756F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.contexto}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, color: ACCENT }}>{o.total}</span>
                  {o.highlight && <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 11, color: '#8B958F' }}>{o.highlight}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
