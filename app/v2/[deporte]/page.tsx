'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import * as S from '@/lib/mockupStyles';
import MarcoV2, { EtiquetaBeta, Titulo, V2_COLOR } from '@/components/v2/MarcoV2';
import { useSesionV2 } from '@/components/v2/useSesionV2';
import { BolaTenis, DEPORTE_NOMBRE, esDeporteV2, type DeporteV2 } from '@/components/v2/IconosV2';
import MesasLiga from '@/components/v2/MesasLiga';
import LigaDuelos from '@/components/v2/LigaDuelos';
import ListaAmistosos from '@/components/v2/ListaAmistosos';
import PorrasGolf from '@/components/v2/PorrasGolf';
import MisEquiposV2 from '@/components/v2/MisEquiposV2';
import LigasPrivadas from '@/components/v2/LigasPrivadas';

// ============================================================================
// DRAFTERS V2 — PÁGINA DE CADA DEPORTE (15/10)
// ============================================================================
// Pedido de Iñi: cada deporte tiene su página (se cambia con las pelotas de
// la cabecera) y sus propios créditos. Al entrar se ven directamente las
// salas, sin elegir deporte: en fútbol, Liga o Amistosos; en golf, Liga,
// Amistosos y Porras; el tenis llegará más adelante.

// 31/10 (Iñi): cada deporte, muy claro: "Liga" (la Liga Drafters) y "Privadas"
// (salas de un fin de semana y ligas privadas con tus amigos). Golf, además, Porras.
type Modo = 'liga' | 'privadas' | 'porras';
const MODOS: Record<DeporteV2, { id: Modo; label: string }[]> = {
  futbol: [
    { id: 'liga', label: 'Liga' },
    { id: 'privadas', label: 'Privadas' },
  ],
  golf: [
    { id: 'liga', label: 'Liga' },
    { id: 'privadas', label: 'Privadas' },
    { id: 'porras', label: 'Porras' },
  ],
  // 27/10 (Iñi): tenis — la liga, muy pronto.
  tenis: [
    { id: 'liga', label: 'Liga' },
    { id: 'privadas', label: 'Privadas' },
  ],
};
const porDefecto = (d: DeporteV2): Modo => (d === 'tenis' ? 'privadas' : 'liga');

export default function V2Deporte() {
  const params = useParams<{ deporte: string }>();
  const router = useRouter();
  const modoParam = useSearchParams().get('modo');
  const deporte: DeporteV2 = esDeporteV2(params.deporte) ? params.deporte : 'futbol';
  const { perfil, estado } = useSesionV2();
  const modos = MODOS[deporte];
  const [modo, setModo] = useState<Modo>(porDefecto(deporte));

  useEffect(() => {
    if (!esDeporteV2(params.deporte)) router.replace('/v2/futbol');
  }, [params.deporte, router]);

  // Se recuerda la última pestaña de cada deporte en este dispositivo.
  useEffect(() => {
    let inicial: string | null = modoParam === 'amistosos' ? 'privadas' : modoParam;
    if (!inicial) {
      try {
        inicial = localStorage.getItem(`v2_modo3_${deporte}`);
      } catch {}
    }
    setModo(modos.some((m) => m.id === inicial) ? (inicial as Modo) : porDefecto(deporte));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deporte, modoParam]);

  function elegir(m: Modo) {
    setModo(m);
    try {
      localStorage.setItem(`v2_modo3_${deporte}`, m);
    } catch {}
  }

  return (
    <MarcoV2 perfil={perfil} estado={estado} deporte={deporte}>
      {(
        <>
          {/* 27/10 (Iñi): arriba del todo, Amistosos y Liga (y Porras en golf), cada
              una con su propia ventana y sus propios equipos. */}
          <div style={{ display: 'flex', background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 4, gap: 4 }}>
            {modos.map((m) => {
              const activo = m.id === modo;
              const color = m.id === 'privadas' ? V2_COLOR : m.id === 'porras' ? '#FF7A45' : S.ACCENT;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => elegir(m.id)}
                  style={{
                    flex: 1,
                    padding: '13px 6px',
                    borderRadius: 9,
                    border: 'none',
                    cursor: 'pointer',
                    background: activo ? color : 'transparent',
                    color: activo ? '#0B0F0E' : S.MUTED,
                    fontFamily: "'Barlow Condensed', sans-serif",
                    fontWeight: 800,
                    fontSize: 18,
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                    transition: 'all 0.15s',
                  }}
                >
                  {m.id === 'privadas' ? '🔒 ' : m.id === 'liga' ? '🏆 ' : ''}
                  {m.label}
                </button>
              );
            })}
          </div>


          {modo === 'privadas' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { href: `/v2/crear?deporte=${deporte}`, icono: '🏟️', t: 'Crear sala', d: 'Privada o pública, para una jornada o un fin de semana' },
                  { href: `/v2/liga-privada/crear?deporte=${deporte}`, icono: '🏆', t: 'Crear liga privada', d: 'Con tus amigos, todas las jornadas' },
                ].map((b) => (
                  <Link key={b.t} href={b.href} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '14px 12px', borderRadius: 14, textDecoration: 'none', background: 'rgba(167,139,250,0.10)', border: `1.5px solid ${V2_COLOR}` }}>
                    <span style={{ fontSize: 22 }}>{b.icono}</span>
                    <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 18, color: S.TEXT, lineHeight: 1.1 }}>＋ {b.t}</span>
                    <span style={{ fontSize: 11.5, color: S.MUTED_2, lineHeight: 1.35 }}>{b.d}</span>
                  </Link>
                ))}
              </div>
              <Seccion>🔒 Mis ligas privadas</Seccion>
              <LigasPrivadas deporte={deporte} />
              {perfil && <MisEquiposV2 deporte={deporte} miId={perfil.id} solo="amistosos" />}
              <Seccion>🏟️ Salas</Seccion>
              <ListaAmistosos deporte={deporte} />
            </>
          )}
          {/* 26/10 (Iñi): en fútbol la liga es de duelos 1 contra 1 por divisiones (SQL 60), con su propia página. */}
          {/* 28/10 (Iñi): la liga de golf, exactamente igual que la de fútbol (duelos por divisiones, SQL 69). */}
          {modo === 'liga' && perfil && (deporte === 'futbol' || deporte === 'golf') && <LigaDuelos deporte={deporte} />}
          {modo === 'liga' && deporte === 'tenis' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '40px 10px', textAlign: 'center' }}>
              <BolaTenis size={64} />
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 26, color: S.TEXT }}>Muy pronto</span>
              <span style={{ fontSize: 13.5, color: S.MUTED_2, lineHeight: 1.5, maxWidth: 320 }}>La liga de tenis llega en cuanto tengamos los primeros torneos rodando. De momento, juega en Privadas.</span>
            </div>
          )}
          {modo === 'liga' && perfil && deporte !== 'futbol' && deporte !== 'golf' && deporte !== 'tenis' && (
            <>
              <MisEquiposV2 deporte={deporte} miId={perfil.id} solo="liga" />
              <MesasLiga deporte={deporte} miId={perfil.id} />
            </>
          )}
          {modo === 'porras' && deporte === 'golf' && <PorrasGolf />}
        </>
      )}

      <Link href="/inicio" style={{ fontSize: 12, color: S.MUTED_3, textAlign: 'center', marginTop: 10 }}>
        Volver a Drafters clásico
      </Link>
    </MarcoV2>
  );
}

function Seccion({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 19, textTransform: 'uppercase', letterSpacing: '0.03em', color: S.TEXT, whiteSpace: 'nowrap' }}>{children}</span>
      <span style={{ flex: 1, height: 1, background: S.CARD_BORDER }} />
    </div>
  );
}
