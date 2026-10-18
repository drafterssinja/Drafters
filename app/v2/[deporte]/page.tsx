'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import * as S from '@/lib/mockupStyles';
import MarcoV2, { EtiquetaBeta, Titulo, V2_COLOR } from '@/components/v2/MarcoV2';
import { useSesionV2 } from '@/components/v2/useSesionV2';
import { BolaTenis, DEPORTE_NOMBRE, esDeporteV2, type DeporteV2 } from '@/components/v2/IconosV2';
import MesasLiga from '@/components/v2/MesasLiga';
import ListaAmistosos from '@/components/v2/ListaAmistosos';
import PorrasGolf from '@/components/v2/PorrasGolf';
import MisEquiposV2 from '@/components/v2/MisEquiposV2';

// ============================================================================
// DRAFTERS V2 — PÁGINA DE CADA DEPORTE (15/10)
// ============================================================================
// Pedido de Iñi: cada deporte tiene su página (se cambia con las pelotas de
// la cabecera) y sus propios créditos. Al entrar se ven directamente las
// salas, sin elegir deporte: en fútbol, Liga o Amistosos; en golf, Liga,
// Amistosos y Porras; el tenis llegará más adelante.

type Modo = 'liga' | 'amistosos' | 'porras';
const MODOS: Record<DeporteV2, { id: Modo; label: string }[]> = {
  futbol: [
    { id: 'amistosos', label: 'Amistosos' },
    { id: 'liga', label: 'Liga' },
  ],
  // 17/10 (Iñi): en golf, igual que en fútbol: la Liga (con sus mesas de torneo,
  // de cada ronda y de fin de semana) y además las Porras.
  golf: [
    { id: 'amistosos', label: 'Amistosos' },
    { id: 'liga', label: 'Liga' },
    { id: 'porras', label: 'Porras' },
  ],
  tenis: [],
};

export default function V2Deporte() {
  const params = useParams<{ deporte: string }>();
  const router = useRouter();
  const modoParam = useSearchParams().get('modo');
  const deporte: DeporteV2 = esDeporteV2(params.deporte) ? params.deporte : 'futbol';
  const { perfil, estado } = useSesionV2();
  const modos = MODOS[deporte];
  // 16/10 (Iñi): de momento, de serie primero los amistosos y luego la liga.
  const [modo, setModo] = useState<Modo>('amistosos');

  useEffect(() => {
    if (!esDeporteV2(params.deporte)) router.replace('/v2/futbol');
  }, [params.deporte, router]);

  // Se recuerda la última pestaña de cada deporte en este dispositivo.
  useEffect(() => {
    let inicial: string | null = modoParam;
    if (!inicial) {
      try {
        inicial = localStorage.getItem(`v2_modo2_${deporte}`);
      } catch {}
    }
    setModo(modos.some((m) => m.id === inicial) ? (inicial as Modo) : 'amistosos');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deporte, modoParam]);

  function elegir(m: Modo) {
    setModo(m);
    try {
      localStorage.setItem(`v2_modo2_${deporte}`, m);
    } catch {}
  }

  return (
    <MarcoV2 perfil={perfil} estado={estado} deporte={deporte}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
        <Titulo>{DEPORTE_NOMBRE[deporte]}</Titulo>
        <EtiquetaBeta />
      </div>

      {deporte === 'tenis' ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '40px 10px', textAlign: 'center' }}>
          <BolaTenis size={64} />
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 26, color: S.TEXT }}>Muy pronto</span>
          <span style={{ fontSize: 13.5, color: S.MUTED_2, lineHeight: 1.5, maxWidth: 320 }}>Estamos preparando el tenis en directo: mesas, amistosos y draft, con sus propios créditos.</span>
        </div>
      ) : (
        <>
          {/* 16/10 (Iñi): "mis equipos" como en la V1, encima de Amistosos / Liga. */}
          {perfil && <MisEquiposV2 deporte={deporte} miId={perfil.id} />}
          {/* 18/10 (Iñi): que se distinga bien "mis equipos" de las salas para jugar. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 19, textTransform: 'uppercase', letterSpacing: '0.03em', color: S.TEXT, whiteSpace: 'nowrap' }}>🏟️ Salas para jugar</span>
            <span style={{ flex: 1, height: 1, background: S.CARD_BORDER }} />
          </div>
          <div style={{ display: 'flex', background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 4, gap: 4 }}>
            {modos.map((m) => {
              const activo = m.id === modo;
              const color = m.id === 'amistosos' ? V2_COLOR : m.id === 'porras' ? '#FF7A45' : S.ACCENT;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => elegir(m.id)}
                  style={{
                    flex: 1,
                    padding: '10px 6px',
                    borderRadius: 9,
                    border: 'none',
                    cursor: 'pointer',
                    background: activo ? color : 'transparent',
                    color: activo ? '#0B0F0E' : S.MUTED,
                    fontFamily: "'Barlow Condensed', sans-serif",
                    fontWeight: 800,
                    fontSize: 16,
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                    transition: 'all 0.15s',
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          {modo === 'liga' && perfil && <MesasLiga deporte={deporte} miId={perfil.id} />}
          {modo === 'amistosos' && <ListaAmistosos deporte={deporte} />}
          {modo === 'porras' && deporte === 'golf' && <PorrasGolf />}
        </>
      )}

      <Link href="/inicio" style={{ fontSize: 12, color: S.MUTED_3, textAlign: 'center', marginTop: 10 }}>
        Volver a Drafters clásico
      </Link>
    </MarcoV2>
  );
}
