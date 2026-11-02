'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { cadaXSegundos } from '@/lib/v2';
import { UsuarioConNivel, useNiveles } from '@/components/v2/Nivel';

// ============================================================================
// CLASIFICACIÓN DE UNA LIGA PRIVADA, EN DIRECTO (02/11, Iñi)
// ============================================================================
// "Que la clasificación de la liga sea en directo: si en la jornada el primero
// suma 5 puntos, que en la de la liga ya se cuenten y vaya bailando. Que se
// note sin escribirlo, como en SofaScore/FlashScore."
//  · Base: la clasificación con las jornadas terminadas (lp_clasificacion).
//  · Encima, la jornada (o jornadas) en juego: cada uno suma ya los puntos de
//    liga que le darían su puesto actual en la jornada (n − puesto + 1), los
//    puntos de su equipo a PF y la jornada a PJ.
//  · Visual: insignia "EN DIRECTO" con latido, flechas ▲▼ de lo que sube o
//    baja respecto a antes de la jornada, "+4" en verde junto a los Pts, y
//    los puntos que lleva su equipo en la jornada en una pastilla verde.

export type ResultadoJornada = { usuario_id: string; nombre: string; tiene_equipo: boolean; total: number | null; puesto: number | null; puntos_liga: number | null; soy_yo: boolean };
export type JornadaLP = { id: string; estado: 'pendiente' | 'en_juego' | 'terminada'; resultados: ResultadoJornada[] };
type Fila = { usuario_id: string; nombre: string; pj: number; pts: number; victorias: number; puntos_fantasy: number; soy_yo: boolean };

const VERDE = '#3DDC84';
const ROJO = '#FF6B6B';
const ORO = '#F0B94D';
const n1 = (x: number | null | undefined) => String(Math.round(Number(x ?? 0) * 10) / 10).replace('.', ',');

export default function ClasificacionLigaPrivada({ ligaId, jornadas, miId, titulo = 'Clasificación', terminada = false }: { ligaId: string; jornadas: JornadaLP[]; miId?: string; titulo?: string; terminada?: boolean }) {
  const [base, setBase] = useState<Fila[] | null>(null);
  useEffect(() => {
    const cargar = () => void supabase.rpc('lp_clasificacion', { p_liga: ligaId }).then(({ data }) => setBase((data as Fila[]) ?? []));
    cargar();
    return cadaXSegundos(cargar, 60);
  }, [ligaId]);
  const niveles = useNiveles((base ?? []).map((f) => f.usuario_id));

  if (base === null) return <span style={{ fontSize: 12.5, color: S.MUTED_3 }}>Cargando…</span>;

  // Lo que suma cada uno con las jornadas en juego.
  const enJuego = jornadas.filter((j) => j.estado === 'en_juego');
  const vivo = new Map<string, { pts: number; pf: number; pj: number }>();
  for (const j of enJuego) {
    const n = j.resultados.length;
    for (const r of j.resultados) {
      if (!r.tiene_equipo || !r.puesto) continue;
      const v = vivo.get(r.usuario_id) ?? { pts: 0, pf: 0, pj: 0 };
      v.pts += Math.max(0, n - r.puesto + 1);
      v.pf += Number(r.total ?? 0);
      v.pj += 1;
      vivo.set(r.usuario_id, v);
    }
  }
  const hayDirecto = enJuego.length > 0;
  const antes = new Map(base.map((f, i) => [f.usuario_id, i]));
  const filas = base
    .map((f) => {
      const v = vivo.get(f.usuario_id);
      return { ...f, ptsT: f.pts + (v?.pts ?? 0), pfT: Number(f.puntos_fantasy) + (v?.pf ?? 0), pjT: f.pj + (v?.pj ?? 0), vivo: v ?? null };
    })
    .sort((a, b) => b.ptsT - a.ptsT || b.pfT - a.pfT || a.nombre.localeCompare(b.nombre));
  // Puesto con empates (mismos Pts y PF → mismo puesto).
  const puestos = filas.map((f, i) => {
    let k = i;
    while (k > 0 && filas[k - 1].ptsT === f.ptsT && Math.abs(filas[k - 1].pfT - f.pfT) < 0.001) k--;
    return k + 1;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 12px 8px', borderRadius: 14, background: S.PANEL, border: `1px solid ${hayDirecto ? 'rgba(61,220,132,0.45)' : S.CARD_BORDER}` }}>
      <style>{'@keyframes clp-latido{50%{opacity:.25}} @keyframes clp-entra{from{background:rgba(61,220,132,.25)}to{background:transparent}}'}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <span style={S.sectionLabel}>{terminada ? 'Clasificación final' : titulo}</span>
        {hayDirecto && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 999, background: 'rgba(61,220,132,0.14)', border: '1px solid rgba(61,220,132,0.5)', fontSize: 10.5, fontWeight: 800, letterSpacing: '0.07em', color: VERDE }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: VERDE, animation: 'clp-latido 1.2s ease-in-out infinite' }} />
            EN DIRECTO
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '34px 1fr 26px 46px 52px', gap: 6, padding: '0 2px 4px', fontSize: 10.5, fontWeight: 700, color: S.MUTED_3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        <span>#</span>
        <span>Jugador</span>
        <span style={{ textAlign: 'center' }}>PJ</span>
        <span style={{ textAlign: 'right' }}>PF</span>
        <span style={{ textAlign: 'right' }}>Pts</span>
      </div>
      {filas.map((f, i) => {
        const mov = hayDirecto ? (antes.get(f.usuario_id) ?? i) - i : 0;
        const soyYo = f.soy_yo || f.usuario_id === miId;
        return (
          <div
            key={f.usuario_id}
            style={{ display: 'grid', gridTemplateColumns: '34px 1fr 26px 46px 52px', gap: 6, alignItems: 'center', padding: '8px 2px', borderTop: '1px solid rgba(255,255,255,0.05)', background: soyYo ? 'rgba(61,220,132,0.07)' : 'transparent', borderRadius: soyYo ? 8 : 0, boxShadow: f.vivo ? `inset 3px 0 0 ${VERDE}` : 'none' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, paddingLeft: f.vivo ? 5 : 0 }}>
              <span style={{ fontWeight: 800, fontSize: 13.5, color: puestos[i] === 1 && f.ptsT > 0 ? ORO : S.MUTED }}>{puestos[i]}</span>
              {mov !== 0 && <span style={{ fontSize: 9, fontWeight: 800, color: mov > 0 ? VERDE : ROJO }}>{mov > 0 ? '▲' : '▼'}{Math.abs(mov)}</span>}
            </span>
            <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ minWidth: 0, fontWeight: 700, fontSize: 13.5, color: soyYo ? VERDE : S.TEXT, overflow: 'hidden' }}>
                <UsuarioConNivel id={f.usuario_id} nombre={f.nombre} nivel={niveles.get(f.usuario_id)} miId={miId} modo="popover" />
              </span>
              {f.vivo && (
                <span title="Puntos de su equipo en la jornada en juego" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '1px 6px', borderRadius: 999, background: 'rgba(61,220,132,0.12)', color: VERDE, fontSize: 10.5, fontWeight: 800 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: VERDE, animation: 'clp-latido 1.2s ease-in-out infinite' }} />
                  {n1(f.vivo.pf)}
                </span>
              )}
            </span>
            <span style={{ textAlign: 'center', fontSize: 13, color: f.vivo ? VERDE : S.MUTED }}>{f.pjT}</span>
            <span style={{ textAlign: 'right', fontSize: 12.5, color: f.vivo ? '#BDF5D6' : S.MUTED }}>{n1(f.pfT)}</span>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
              {f.vivo && f.vivo.pts > 0 && <span style={{ fontSize: 10, fontWeight: 800, color: '#04140B', background: VERDE, borderRadius: 6, padding: '1px 4px' }}>+{f.vivo.pts}</span>}
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 18, color: S.TEXT }}>{f.ptsT}</span>
            </span>
          </div>
        );
      })}
      <span style={{ fontSize: 10.5, color: S.MUTED_3, marginTop: 4 }}>PJ: jornadas jugadas · PF: puntos a favor · Pts: puntos de liga · empate a Pts: desempata PF</span>
    </div>
  );
}
