'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LogoDrafters from '@/components/LogoDrafters';
import { supabase, type Perfil } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { DEPORTES_V2, DEPORTE_NOMBRE, IconoCredito, PelotaDeporte, type DeporteV2 } from '@/components/v2/IconosV2';
import { FichaCreditos, useCreditosV2 } from '@/components/v2/creditos';

// ============================================================================
// CABECERA DE DRAFTERS V2 (15/10)
// ============================================================================
// Pedido de Iñi: a la derecha de DRAFTERS, la pelota de cada deporte; cada
// deporte es su propia página, con sus propios créditos (mismo icono, saldo
// por separado). Lo de la derecha: avisos, créditos del deporte en el que
// estás (al pulsarlo, la ficha con las reglas y el vídeo de recarga) y Mi cuenta.

export default function CabeceraV2({ perfil, deporte, volverA }: { perfil: Perfil | null; deporte: DeporteV2; volverA?: string }) {
  const router = useRouter();
  const { creditos } = useCreditosV2(!!perfil);
  const [ficha, setFicha] = useState(false);
  const [noLeidas, setNoLeidas] = useState(0);
  // Con el nombre del deporte al lado de su pelota, en móviles estrechos se encoge el logo.
  const [estrecho, setEstrecho] = useState(false);
  useEffect(() => {
    const medir = () => setEstrecho(window.innerWidth < 370);
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, []);

  useEffect(() => {
    if (!perfil) return;
    supabase
      .from('notificaciones')
      .select('id', { count: 'exact', head: true })
      .eq('leido', false)
      .then(({ count }) => setNoLeidas(count ?? 0));
  }, [perfil]);

  const info = creditos?.[deporte] ?? null;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: estrecho ? '16px 12px' : '16px 14px', borderBottom: '1px solid #1A211D' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Link href="/v2/futbol" style={{ display: 'inline-flex', alignItems: 'center', minWidth: 0, flexShrink: 1, overflow: 'hidden' }} aria-label="Drafters">
            <LogoDrafters size={estrecho ? 21 : 25} />
          </Link>
          <nav style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }} aria-label="Deportes">
            {DEPORTES_V2.map((d) => {
              const activo = d === deporte;
              return (
                <Link
                  key={d}
                  href={`/v2/${d}`}
                  aria-label={DEPORTE_NOMBRE[d]}
                  aria-current={activo ? 'page' : undefined}
                  style={{
                    height: 28,
                    minWidth: estrecho && !activo ? 24 : 28,
                    padding: activo ? '0 9px 0 3px' : 0,
                    borderRadius: 999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    background: activo ? 'rgba(61,220,132,0.16)' : 'transparent',
                    border: `1.5px solid ${activo ? S.ACCENT : 'transparent'}`,
                    opacity: activo ? 1 : 0.5,
                    textDecoration: 'none',
                    transition: 'all 0.15s',
                  }}
                >
                  <PelotaDeporte deporte={d} size={19} />
                  {/* 15/10 (Iñi): el nombre del deporte solo junto a la pelota seleccionada. */}
                  {activo && <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 11.5, color: S.ACCENT, whiteSpace: 'nowrap' }}>{DEPORTE_NOMBRE[d]}</span>}
                </Link>
              );
            })}
          </nav>
        </div>

        {perfil && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <Link href="/notificaciones" aria-label="Notificaciones" style={{ position: 'relative', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C9D2CC', background: '#131917', border: '1px solid #2A3733', borderRadius: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {noLeidas > 0 && (
                <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 15, height: 15, padding: '0 3px', borderRadius: 999, background: '#FF5C5C', color: '#FFF', fontWeight: 800, fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid #0B0F0E' }}>
                  {noLeidas > 99 ? '99+' : noLeidas}
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={() => setFicha(true)}
              aria-label={`Créditos de ${DEPORTE_NOMBRE[deporte]}`}
              style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#131917', border: '1px solid #2A3733', borderRadius: 8, padding: '5px 7px', cursor: 'pointer' }}
            >
              <IconoCredito size={14} />
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 13, color: S.TEXT }}>{info ? info.saldo : '–'}</span>
            </button>
            <Link href="/cuenta" aria-label="Mi cuenta" style={{ width: 28, height: 28, borderRadius: '50%', background: S.ACCENT, color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 12.5, display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
              {S.iniciales(perfil.nombre, perfil.apellido)}
            </Link>
          </div>
        )}
      </div>
      {volverA && (
        <div style={{ padding: '6px 16px 0' }}>
          <button type="button" onClick={() => router.push(volverA)} aria-label="Volver" style={{ width: 34, height: 34, padding: 0, border: 'none', background: 'transparent', color: S.ACCENT, fontSize: 20, cursor: 'pointer' }}>
            ←
          </button>
        </div>
      )}
      {ficha && <FichaCreditos deporte={deporte} info={info} onCerrar={() => setFicha(false)} />}
    </>
  );
}
