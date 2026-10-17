'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import { etiquetasPosicion } from '@/lib/posicionesEmpate';
import { formatPuntos } from '@/lib/futbolLaLiga';
import * as S from '@/lib/mockupStyles';
import { puntosGolfTramo, type PorRonda } from '@/lib/tramos';
import type { Resumen } from '@/lib/v2';

// "Vas 2º de 6 · 109 pts ▾" de un amistoso (16/10, Iñi): lo mismo que en "mis
// equipos" de la V1, pero sumando todas las jornadas de la sala. Al pulsarlo
// se despliega la clasificación. Empates con T.

type Fila = { usuarioId: string; nombre: string; total: number };

export default function ResumenClasificacionAmistoso({ amistosoId, deporte, resumen, miId, finalizada = false }: { amistosoId: string; deporte: string; resumen: Resumen; miId: string; finalizada?: boolean }) {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (deporte !== 'futbol' && deporte !== 'golf') return;
    let activo = true;
    const tabla = deporte === 'golf' ? 'golf_puntos_jugador' : 'futbol_puntos_jugador';
    async function cargar() {
      const { data } = await supabase.rpc('amistoso_equipos_clasificacion', { p_amistoso: amistosoId });
      const eqs = (data as { competicion: string; usuario_id: string; jugadores: string[] }[]) ?? [];
      const pts = new Map<string, number>();
      for (const comp of Array.from(new Set(eqs.map((e) => e.competicion)))) {
        const ids = Array.from(new Set(eqs.filter((e) => e.competicion === comp).flatMap((e) => e.jugadores)));
        for (let i = 0; i < ids.length; i += 200) {
          // 17/10: en una ronda suelta de golf solo cuentan sus puntos.
          const { data: ps } = await supabase.from(tabla).select(tabla === 'golf_puntos_jugador' ? 'jugador_id,puntos_total,por_ronda' : 'jugador_id,puntos_total').eq('competicion', comp).in('jugador_id', ids.slice(i, i + 200));
          ((ps as unknown as { jugador_id: string; puntos_total: number; por_ronda?: PorRonda }[]) ?? []).forEach((p) => pts.set(`${comp}|${p.jugador_id}`, puntosGolfTramo(p, tabla === 'golf_puntos_jugador' ? resumen.jornadas.find((j) => j.competicion === comp)?.tramo ?? null : null).total));
        }
      }
      const lista = resumen.participantes
        .map((p) => ({
          usuarioId: p.usuario_id,
          nombre: `@${p.nombre}`,
          total: Math.round(eqs.filter((e) => e.usuario_id === p.usuario_id).reduce((a, e) => a + e.jugadores.reduce((b, id) => b + (pts.get(`${e.competicion}|${id}`) ?? 0), 0), 0) * 100) / 100,
        }))
        .sort((a, b) => b.total - a.total);
      if (activo) setFilas(lista);
    }
    void cargar();
    if (finalizada) return () => {
      activo = false;
    };
    const intervalo = setInterval(() => {
      if (document.visibilityState === 'visible') void cargar();
    }, 30000);
    return () => {
      activo = false;
      clearInterval(intervalo);
    };
  }, [amistosoId, deporte, resumen, finalizada]);

  if (!filas || filas.length === 0) return null;
  const etiquetas = etiquetasPosicion(filas, (f) => f.total);
  const i = filas.findIndex((f) => f.usuarioId === miId);
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
          {finalizada ? 'Quedaste' : 'Vas'} {etiquetas[i].startsWith('T') ? etiquetas[i] : `${etiquetas[i]}º`} de {filas.length}
        </span>
        <span style={{ fontSize: 11.5, color: S.MUTED_2, fontWeight: 600 }}>· {formatPuntos(filas[i].total)} pts</span>
        <span aria-hidden style={{ fontSize: 10, color: S.MUTED_2, transform: abierto ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▾</span>
      </button>
      {abierto && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 8px', background: 'rgba(255,255,255,0.03)', border: '1px solid #1E2723', borderRadius: 8 }}>
          {filas.map((f, k) => {
            const mio = f.usuarioId === miId;
            return (
              <motion.div layout transition={{ type: 'spring', stiffness: 420, damping: 38 }} key={f.usuarioId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
