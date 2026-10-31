'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LogoDrafters from '@/components/LogoDrafters';
import { supabase, type Perfil } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { DEPORTES_V2, DEPORTE_NOMBRE, IconoCartas, IconoCredito, PelotaDeporte, type DeporteV2 } from '@/components/v2/IconosV2';
import { puedeJugarPocha } from '@/lib/pocha';
import { FichaCreditos, useCreditosV2 } from '@/components/v2/creditos';
import { NivelBadge, useNiveles } from '@/components/v2/Nivel';

// ============================================================================
// CABECERA DE DRAFTERS V2 (15/10)
// ============================================================================
// Pedido de Iñi: a la derecha de DRAFTERS, la pelota de cada deporte; cada
// deporte es su propia página, con sus propios créditos (mismo icono, saldo
// por separado). Lo de la derecha: avisos, créditos del deporte en el que
// estás (al pulsarlo, la ficha con las reglas y el vídeo de recarga) y Mi cuenta.

export default function CabeceraV2({ perfil, deporte: deporteOPocha, volverA }: { perfil: Perfil | null; deporte: DeporteV2 | 'pocha'; volverA?: string }) {
  // 19/10 (Iñi): en la hoja de la pocha no hay deporte; los créditos son los de fútbol.
  const enPocha = deporteOPocha === 'pocha';
  const deporte: DeporteV2 = enPocha ? 'futbol' : (deporteOPocha as DeporteV2);
  const router = useRouter();
  const { creditos } = useCreditosV2(!!perfil);
  // 31/10 (Iñi): mi nivel en la cabecera, delante de mi cuenta.
  const misNiveles = useNiveles(perfil ? [perfil.id] : []);
  const miNivel = perfil ? misNiveles.get(perfil.id) : undefined;
  const [ficha, setFicha] = useState(false);
  const [noLeidas, setNoLeidas] = useState(0);
  // 19/10 (Iñi): el icono de cartas (pocha) solo lo ven Iñi y Javier.
  const [pocha, setPocha] = useState(false);
  useEffect(() => {
    if (!perfil) return;
    if (puedeJugarPocha(perfil.email)) return setPocha(true);
    void supabase.auth.getSession().then(({ data }) => setPocha(puedeJugarPocha(data.session?.user.email)));
  }, [perfil]);
  // 15/10 (Iñi: "la parte superior está muy achatada"): más alta, y tres
  // tamaños según el ancho del móvil para que todo quepa sin aplastarse.
  const [ancho, setAncho] = useState(400);
  useEffect(() => {
    const medir = () => setAncho(window.innerWidth);
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
  const t = ancho >= 400 ? { logo: 26, bola: 30, icono: 21, boton: 32, pad: 16 } : ancho >= 370 ? { logo: 23, bola: 27, icono: 19, boton: 31, pad: 14 } : { logo: 21, bola: 25, icono: 18, boton: 29, pad: 12 };

  return (
    <div className="v2">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minHeight: 68, padding: `18px ${t.pad}px`, borderBottom: '1px solid #1A211D' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Link href="/v2/futbol" style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }} aria-label="Drafters">
            <LogoDrafters size={pocha ? t.logo - 2 : t.logo} />
          </Link>
          <nav style={{ display: 'flex', alignItems: 'center', gap: pocha ? 0 : 2, flexShrink: 0 }} aria-label="Deportes">
            {DEPORTES_V2.map((d) => {
              const activo = !enPocha && d === deporte;
              return (
                <Link
                  key={d}
                  href={`/v2/${d}`}
                  aria-label={DEPORTE_NOMBRE[d]}
                  aria-current={activo ? 'page' : undefined}
                  style={{
                    height: pocha ? t.icono + 7 : t.bola + 2,
                    minWidth: pocha ? t.icono + 3 : t.bola,
                    flexShrink: 0,
                    padding: activo && !pocha ? '0 10px 0 4px' : 0,
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
                  <PelotaDeporte deporte={d} size={t.icono} />
                  {/* 15/10 (Iñi): el nombre del deporte solo junto a la pelota seleccionada. */}
                  {activo && !pocha && <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: ancho >= 400 ? 13 : 12, color: S.ACCENT, whiteSpace: 'nowrap' }}>{DEPORTE_NOMBRE[d]}</span>}
                </Link>
              );
            })}
            {pocha && (
              <Link
                href="/pocha"
                aria-label="Pocha"
                aria-current={enPocha ? 'page' : undefined}
                style={{
                  height: pocha ? t.icono + 7 : t.bola + 2,
                  minWidth: pocha ? t.icono + 3 : t.bola,
                  flexShrink: 0,
                  padding: 0,
                  borderRadius: 999,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  background: enPocha ? 'rgba(61,220,132,0.16)' : 'transparent',
                  border: `1.5px solid ${enPocha ? S.ACCENT : 'transparent'}`,
                  opacity: enPocha ? 1 : 0.5,
                  textDecoration: 'none',
                  transition: 'all 0.15s',
                }}
              >
                <IconoCartas size={t.icono} />
              </Link>
            )}
          </nav>
        </div>

        {perfil && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <Link href="/notificaciones" aria-label="Notificaciones" style={{ position: 'relative', flexShrink: 0, width: t.boton, height: t.boton, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C9D2CC', background: '#131917', border: '1px solid #2A3733', borderRadius: 8 }}>
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
              style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, height: t.boton, background: '#131917', border: '1px solid #2A3733', borderRadius: 8, padding: '0 9px', cursor: 'pointer' }}
            >
              <IconoCredito size={15} />
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 13, color: S.TEXT }}>{info ? info.saldo : '–'}</span>
            </button>
            {miNivel ? (
              <Link href="/v2/nivel" aria-label={`Mi nivel: ${miNivel}`} style={{ display: 'flex', flexShrink: 0 }}>
                <NivelBadge nivel={miNivel} size={t.boton} />
              </Link>
            ) : null}
            <Link href="/cuenta" aria-label="Mi cuenta" style={{ flexShrink: 0, width: t.boton, height: t.boton, borderRadius: '50%', background: S.ACCENT, color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 12.5, display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
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
    </div>
  );
}
