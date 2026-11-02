'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import CabeceraV2 from '@/components/v2/CabeceraV2';
import AvisosV2 from '@/components/v2/AvisosV2';
import ResultadoJornadaV2 from '@/components/v2/ResultadoJornadaV2';
import AvisoActivarNotificaciones from '@/components/AvisoActivarNotificaciones';
import type { DeporteV2 } from '@/components/v2/IconosV2';
import type { Perfil } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import Cargando from '@/components/Cargando';

// 02/11 (Iñi, opción N): salas y ligas privadas en oro (botones en oro metálico)
// y tarjetas en azul noche; el verde queda para la Liga Drafters.
export const V2_COLOR = '#F5C94A';
export const V2_ORO = 'linear-gradient(180deg,#FFE08A 0%,#E9B532 55%,#C9921E 100%)';

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
              <span style={{ fontWeight: 700, color: S.TEXT }}>No se ha podido cargar tu cuenta</span>
              <span style={{ fontSize: 13, color: S.MUTED_2 }}>Vuelve a intentarlo en un momento.</span>
              <Link href="/login" style={{ ...S.secondaryLinkButton, textAlign: 'center', textDecoration: 'none' }}>
                Volver a entrar
              </Link>
            </div>
          )}
          {estado === 'ok' && children}
          {/* 16/10: aviso si el admin de un amistoso tuyo ha cambiado la modalidad */}
          {estado === 'ok' && <AvisosV2 />}
          {/* 16/10: pop-up con los draftis y el puesto al cerrarse tu jornada de liga */}
          {estado === 'ok' && <ResultadoJornadaV2 />}
          {/* 19/10: "ya llegan las notificaciones" (una vez por sesión) */}
          {estado === 'ok' && <AvisoActivarNotificaciones />}
        </div>
      </div>
    </main>
  );
}

// 01/11 (Iñi): ya no es "V2 · beta", es Drafters: la etiqueta ya no se enseña.
export function EtiquetaBeta() {
  return null;
}

export function Titulo({ children }: { children: ReactNode }) {
  return <h1 style={{ fontSize: 26, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0, lineHeight: 1.1 }}>{children}</h1>;
}

export function Panel({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, ...style }}>{children}</div>;
}
