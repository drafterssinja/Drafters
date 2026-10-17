'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import { etiquetasPosicion } from '@/lib/posicionesEmpate';
import { formatPuntos } from '@/lib/futbolLaLiga';
import * as S from '@/lib/mockupStyles';
import { puntosGolfTramo, type PorRonda } from '@/lib/tramos';

// ============================================================================
// "VAS 2º DE 6" EN EL RESUMEN DE MIS MESAS (Inicio) — 13/10, pedido de Iñi
// ============================================================================
// Debajo del nombre de la mesa se ve en qué puesto va tu equipo y con cuántos
// puntos. Al pulsarlo se despliega la clasificación de la mesa (puesto, equipo
// y puntos), con tu equipo resaltado. Mismos datos que la clasificación en
// directo: equipos_sala_clasificacion() + puntos Drafters por jugador
// (futbol_puntos_jugador / golf_puntos_jugador). Empates con T.

type Fila = { equipoId: string; nombre: string; total: number };

// 16/10: `tercera` = se habla de otro (perfil de un amigo): "Va 2º de 6".
// 17/10: `tramo` = mesa de una ronda de golf (solo cuentan esas rondas).
export default function ResumenClasificacionMesa({ salaId, competicion, deporte, miEquipoId, finalizada = false, tercera = false, tramo = null }: { salaId: string; competicion: string; deporte: string; miEquipoId: string; finalizada?: boolean; tercera?: boolean; tramo?: string | null }) {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (deporte !== 'futbol' && deporte !== 'golf') return;
    let activo = true;
    let equipos: { id: string; nombre: string; jugadores: string[] }[] | null = null;
    // 13/10 (Iñi): se actualiza sola, como la clasificación en directo: los
    // equipos se leen una vez y los puntos cada 20 s (solo con la pantalla a
    // la vista y mientras la mesa no esté finalizada).
    async function cargar() {
      if (equipos === null) {
        const { data: eqs } = await supabase.rpc('equipos_sala_clasificacion', { p_sala_id: salaId });
        equipos = ((eqs as { equipo_id: string; nombre: string; jugadores: string[] }[]) ?? []).map((e) => ({ id: e.equipo_id, nombre: e.nombre, jugadores: e.jugadores ?? [] }));
      }
      if (equipos.length === 0) {
        if (activo) setFilas([]);
        return;
      }
      const ids = Array.from(new Set(equipos.flatMap((e) => e.jugadores)));
      const tabla = deporte === 'golf' ? 'golf_puntos_jugador' : 'futbol_puntos_jugador';
      const puntos = new Map<string, number>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase.from(tabla).select(deporte === 'golf' ? 'jugador_id,puntos_total,por_ronda' : 'jugador_id,puntos_total').eq('competicion', competicion).in('jugador_id', ids.slice(i, i + 200));
        ((data as unknown as { jugador_id: string; puntos_total: number; por_ronda?: PorRonda }[]) ?? []).forEach((p) => puntos.set(p.jugador_id, puntosGolfTramo(p, deporte === 'golf' ? tramo : null).total));
      }
      const lista = equipos
        .map((e) => ({ equipoId: e.id, nombre: e.nombre, total: Math.round(e.jugadores.reduce((a, id) => a + (puntos.get(id) ?? 0), 0) * 100) / 100 }))
        .sort((a, b) => b.total - a.total);
      if (activo) setFilas(lista);
    }
    void cargar();
    if (finalizada) return () => {
      activo = false;
    };
    const intervalo = setInterval(() => {
      if (document.visibilityState === 'visible') void cargar();
    }, 20000);
    const alVolver = () => {
      if (document.visibilityState === 'visible') void cargar();
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      activo = false;
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [salaId, competicion, deporte, finalizada, tramo]);

  if (!filas || filas.length === 0) return null;
  const etiquetas = etiquetasPosicion(filas, (f) => f.total);
  const i = filas.findIndex((f) => f.equipoId === miEquipoId);
  if (i < 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setAbierto((a) => !a);
        }}
        aria-expanded={abierto}
        style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(61,220,132,0.08)', border: '1px solid rgba(61,220,132,0.3)', borderRadius: 8, padding: '4px 9px', cursor: 'pointer' }}
      >
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 13, color: S.ACCENT }}>
          {finalizada ? (tercera ? 'Quedó' : 'Quedaste') : tercera ? 'Va' : 'Vas'} {etiquetas[i].startsWith('T') ? etiquetas[i] : `${etiquetas[i]}º`} de {filas.length}
        </span>
        <span style={{ fontSize: 11.5, color: S.MUTED_2, fontWeight: 600 }}>· {formatPuntos(filas[i].total)} pts</span>
        <span aria-hidden style={{ fontSize: 10, color: S.MUTED_2, transform: abierto ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▾</span>
      </button>
      {abierto && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 8px', background: 'rgba(255,255,255,0.03)', border: '1px solid #1E2723', borderRadius: 8 }}>
          {filas.map((f, k) => {
            const mio = f.equipoId === miEquipoId;
            return (
              <motion.div layout transition={{ type: 'spring', stiffness: 420, damping: 38 }} key={f.equipoId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flexShrink: 0, width: 28, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 13, color: mio ? S.ACCENT : '#F0B94D' }}>{etiquetas[k]}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: mio ? 800 : 600, color: mio ? S.ACCENT : S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.nombre}</span>
                <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: mio ? S.ACCENT : S.MUTED }}>{formatPuntos(f.total)} pts</span>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
