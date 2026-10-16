'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import CabeceraV2 from '@/components/v2/CabeceraV2';
import AvisosV2 from '@/components/v2/AvisosV2';
import ResultadoJornadaV2 from '@/components/v2/ResultadoJornadaV2';
import type { DeporteV2 } from '@/components/v2/IconosV2';
import type { Perfil } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import Cargando from '@/components/Cargando';

export const V2_COLOR = '#A78BFA';

// Envoltorio común de las pantallas de Drafters V2 (cabecera + aviso de beta).
export default function MarcoV2({ perfil, estado, volverA, deporte = 'futbol', children }: { perfil: Perfil | null; estado: 'cargando' | 'ok' | 'sin_acceso'; volverA?: string; deporte?: DeporteV2; children: ReactNode }) {
  return (
    <main className="v2" style={S.mainReset}>
      <div style={S.pageFrame}>
        <CabeceraV2 perfil={estado === 'ok' ? perfil : null} deporte={deporte} volverA={volverA} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '20px 20px 64px' }}>
          {estado === 'cargando' && <Cargando />}
          {estado === 'sin_acceso' && (
            <div style={{ ...S.card, flexDirection: 'column', alignItems: 'flex-start' }}>
              <span style={{ fontWeight: 700, color: S.TEXT }}>Drafters V2 está en pruebas</span>
              <span style={{ fontSize: 13, color: S.MUTED_2 }}>Todavía no tienes acceso. Te avisaremos cuando se abra para todos.</span>
              <Link href="/inicio" style={{ ...S.secondaryLinkButton, textAlign: 'center', textDecoration: 'none' }}>
                Volver a inicio
              </Link>
            </div>
          )}
          {estado === 'ok' && children}
          {/* 16/10: aviso si el admin de un amistoso tuyo ha cambiado la modalidad */}
          {estado === 'ok' && <AvisosV2 />}
          {/* 16/10: pop-up con los draftis y el puesto al cerrarse tu jornada de liga */}
          {estado === 'ok' && <ResultadoJornadaV2 />}
        </div>
      </div>
    </main>
  );
}

export function EtiquetaBeta() {
  return (
    <span style={{ alignSelf: 'flex-start', fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', color: V2_COLOR, border: `1px solid ${V2_COLOR}`, borderRadius: 999, padding: '2px 8px', textTransform: 'uppercase' }}>
      V2 · beta
    </span>
  );
}

export function Titulo({ children }: { children: ReactNode }) {
  return <h1 style={{ fontSize: 26, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0, lineHeight: 1.1 }}>{children}</h1>;
}

export function Panel({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, ...style }}>{children}</div>;
}
