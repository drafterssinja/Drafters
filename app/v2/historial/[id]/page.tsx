'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import MarcoV2, { Panel, Titulo } from '@/components/v2/MarcoV2';
import { useSesionV2 } from '@/components/v2/useSesionV2';
import Cargando from '@/components/Cargando';
import { NivelBadge, useNiveles } from '@/components/v2/Nivel';

// ============================================================================
// HISTORIAL CONTRA UN RIVAL (31/10, Iñi) — SQL 71 (h2h_resumen, h2h_historial)
// ============================================================================

type Fila = { titulo: string; deporte: string; link: string | null; terminado_en: string; participantes: number; mi_puesto: number | null; su_puesto: number | null; mis_puntos: number | null; sus_puntos: number | null; resultado: 'G' | 'P' | 'E' };
type Resumen = { nombre: string; ganadas: number; perdidas: number; empates: number; total: number };
const ICONO: Record<string, string> = { futbol: '⚽', golf: '⛳', tenis: '🎾' };
const pts = (x: number | null) => (x === null || x === undefined ? '–' : String(Math.round(Number(x) * 10) / 10).replace('.', ','));

export default function HistorialRival() {
  const { id } = useParams<{ id: string }>();
  const { perfil, estado } = useSesionV2();
  const [res, setRes] = useState<Resumen | null>(null);
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const niveles = useNiveles([id]);

  useEffect(() => {
    if (estado !== 'ok') return;
    void supabase.rpc('h2h_resumen', { p_rival: id }).then(({ data }) => setRes(data as Resumen));
    void supabase.rpc('h2h_historial', { p_rival: id }).then(({ data }) => setFilas((data as Fila[]) ?? []));
  }, [estado, id]);

  return (
    <MarcoV2 perfil={perfil} estado={estado} deporte="futbol">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <NivelBadge nivel={niveles.get(id)} size={34} />
        <Titulo>Tú contra @{res?.nombre ?? '…'}</Titulo>
      </div>
      {res && (
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            ['Le has ganado', res.ganadas, '#3DDC84'],
            ['Te ha ganado', res.perdidas, '#FF8A8A'],
            ['Empates', res.empates, S.MUTED_2],
          ].map(([t, v, c]) => (
            <Panel key={t as string} style={{ flex: 1, alignItems: 'center', padding: 12, gap: 2 }}>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 30, color: c as string, lineHeight: 1 }}>{v as number}</span>
              <span style={{ fontSize: 11, color: S.MUTED_3 }}>{t as string}</span>
            </Panel>
          ))}
        </div>
      )}
      {filas === null ? (
        <Cargando compacto />
      ) : filas.length === 0 ? (
        <p style={{ fontSize: 13, color: S.MUTED_2 }}>Todavía no habéis coincidido en ninguna partida terminada.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 12, background: '#0E1311', border: '1px solid #1A221E', overflow: 'hidden' }}>
          {filas.map((f, i) => {
            const color = f.resultado === 'G' ? '#3DDC84' : f.resultado === 'P' ? '#FF8A8A' : '#F0B94D';
            const contenido = (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.045)' }}>
                <span style={{ width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, background: `${color}22`, color }}>{f.resultado}</span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 13, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {ICONO[f.deporte] ?? ''} {f.titulo}
                  </span>
                  <span style={{ fontSize: 11, color: S.MUTED_3 }}>
                    {new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: '2-digit' }).format(new Date(f.terminado_en))} · tú {f.mi_puesto ? `${f.mi_puesto}º` : 'sin equipo'} · él {f.su_puesto ? `${f.su_puesto}º` : 'sin equipo'} de {f.participantes}
                  </span>
                </span>
                <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, color: S.TEXT }}>
                  {pts(f.mis_puntos)} – {pts(f.sus_puntos)}
                </span>
              </div>
            );
            return f.link ? (
              <Link key={i} href={f.link} style={{ textDecoration: 'none' }}>
                {contenido}
              </Link>
            ) : (
              <div key={i}>{contenido}</div>
            );
          })}
        </div>
      )}
    </MarcoV2>
  );
}
