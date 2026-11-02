'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import LogoDrafters from '@/components/LogoDrafters';
import { supabase, type Perfil } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { DEPORTE_NOMBRE, IconoCredito, PelotaDeporte, type DeporteV2 } from '@/components/v2/IconosV2';
import { FichaCreditos, useCreditosV2 } from '@/components/v2/creditos';
import { NivelBadge, tramoNivel, useNiveles } from '@/components/v2/Nivel';
import AnimacionNivel from '@/components/v2/AnimacionNivel';

// ============================================================================
// CABECERA DE DRAFTERS V2 (15/10)
// ============================================================================
// Pedido de Iñi: a la derecha de DRAFTERS, la pelota de cada deporte; cada
// deporte es su propia página, con sus propios créditos (mismo icono, saldo
// por separado). Lo de la derecha: avisos, créditos del deporte en el que
// estás (al pulsarlo, la ficha con las reglas y el vídeo de recarga) y Mi cuenta.

export default function CabeceraV2({ perfil, deporte: deporteOPocha, volverA, sinDeporte = false }: { perfil: Perfil | null; deporte: DeporteV2 | 'pocha'; volverA?: string; sinDeporte?: boolean }) {
  // 19/10 (Iñi): en la hoja de la pocha no hay deporte; los créditos son los de fútbol.
  const enPocha = deporteOPocha === 'pocha';
  const deporte: DeporteV2 = enPocha ? 'futbol' : (deporteOPocha as DeporteV2);
  const router = useRouter();
  const { creditos } = useCreditosV2(!!perfil);
  // 31/10 (Iñi): mi nivel en la cabecera, delante de mi cuenta.
  const misNiveles = useNiveles(perfil ? [perfil.id] : []);
  // 02/11 (Iñi): al cambiar tu nivel, animación desde la insignia (AnimacionNivel).
  const [nivelAnim, setNivelAnim] = useState<number | null>(null);
  const [brilloNivel, setBrilloNivel] = useState(false);
  const [xpNivel, setXpNivel] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const cabeceraRef = useRef<HTMLDivElement>(null);
  const miNivel = nivelAnim ?? (perfil ? misNiveles.get(perfil.id) : undefined);
  const [ficha, setFicha] = useState(false);
  const [noLeidas, setNoLeidas] = useState(0);
  // 01/11 (Iñi): de momento, fuera las cartas (pocha) para todos.
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
  // 02/11 (Iñi, "Mezcla 1"): dos líneas, con más aire.
  //  · Arriba: DRAFTERS (separado del resto) · mi nivel (insignia + "NIVEL N"
  //    + barrita) · créditos del deporte · mi cuenta (con el número de avisos
  //    en rojo; al pulsarla, un desplegable: Notificaciones / Mi perfil).
  //  · Debajo: pestañas Fútbol · Tenis · Golf.
  const estrecho = ancho < 375;
  const pctNivel = xpNivel === null ? null : Math.max(3, Math.min(100, xpNivel - Math.max(1, Math.floor(xpNivel / 100)) * 100));
  const colorNivel = miNivel ? tramoNivel(miNivel).color : S.ACCENT;
  const ORDEN_TABS: DeporteV2[] = ['futbol', 'tenis', 'golf'];

  return (
    <div className="v2">
      <div ref={cabeceraRef} style={{ borderBottom: '1px solid #1A211D' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: estrecho ? 6 : 8, padding: `14px ${estrecho ? 12 : 16}px 8px` }}>
          <Link href="/v2/futbol" style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }} aria-label="Drafters">
            <LogoDrafters size={estrecho ? 27 : 30} />
          </Link>
          <span style={{ flex: 1 }} />
          {perfil && (
            <>
              {miNivel ? (
                <Link
                  href="/v2/nivel"
                  aria-label={`Mi nivel: ${miNivel}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, height: 38, padding: '0 9px 0 4px', borderRadius: 11, background: '#111715', border: '1px solid #2A3733', textDecoration: 'none', animation: brilloNivel ? 'dnv-glow 1.4s ease-in-out infinite' : undefined, ['--dnv-c' as string]: colorNivel } as React.CSSProperties}
                >
                  <NivelBadge nivel={miNivel} size={30} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 10, letterSpacing: '0.05em', color: colorNivel, whiteSpace: 'nowrap' }}>NIVEL {miNivel}</span>
                    <span style={{ width: estrecho ? 34 : 42, height: 4, borderRadius: 9, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                      <span style={{ display: 'block', width: `${pctNivel ?? 0}%`, height: '100%', borderRadius: 9, background: colorNivel, transition: 'width .8s' }} />
                    </span>
                  </span>
                </Link>
              ) : null}
              <button
                type="button"
                onClick={() => setFicha(true)}
                aria-label={`Créditos de ${DEPORTE_NOMBRE[deporte]}`}
                style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, width: 'auto', height: 38, background: '#131917', border: '1px solid #2A3733', borderRadius: 10, padding: '0 9px', cursor: 'pointer' }}
              >
                <IconoCredito size={16} />
                <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 14, color: S.TEXT }}>{info ? info.saldo : '–'}</span>
              </button>
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => setMenu(!menu)}
                  aria-label="Mi cuenta y notificaciones"
                  style={{ position: 'relative', width: 38, height: 38, padding: 0, borderRadius: '50%', border: 'none', background: S.ACCENT, color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                >
                  {S.iniciales(perfil.nombre, perfil.apellido)}
                  {noLeidas > 0 && (
                    <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 17, height: 17, padding: '0 4px', borderRadius: 999, background: '#FF5C5C', color: '#FFF', fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 9.5, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid #0B0F0E' }}>
                      {noLeidas > 99 ? '99+' : noLeidas}
                    </span>
                  )}
                </button>
                {menu && (
                  <>
                    <div onClick={() => setMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
                    <div style={{ position: 'absolute', right: 0, top: 46, zIndex: 91, width: 220, borderRadius: 14, background: '#141B18', border: '1px solid #2A3733', boxShadow: '0 14px 34px rgba(0,0,0,.55)', overflow: 'hidden' }}>
                      {[
                        { href: '/notificaciones', icono: '🔔', texto: 'Notificaciones', extra: noLeidas > 0 ? String(noLeidas > 99 ? '99+' : noLeidas) : null },
                        { href: '/cuenta', icono: '👤', texto: 'Mi perfil', extra: null },
                      ].map((o, k) => (
                        <Link key={o.href} href={o.href} onClick={() => setMenu(false)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 14px', borderTop: k === 0 ? 'none' : '1px solid #1E2723', textDecoration: 'none', color: S.TEXT, fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 14 }}>
                          <span style={{ fontSize: 16 }}>{o.icono}</span>
                          <span style={{ flex: 1 }}>{o.texto}</span>
                          {o.extra && <span style={{ minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: '#FF5C5C', color: '#FFF', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{o.extra}</span>}
                        </Link>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
        <nav style={{ display: 'flex' }} aria-label="Deportes">
          {ORDEN_TABS.map((d) => {
            const activo = !enPocha && !sinDeporte && d === deporte;
            return (
              <Link
                key={d}
                href={`/v2/${d}`}
                aria-current={activo ? 'page' : undefined}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px 0 8px', borderBottom: `3px solid ${activo ? S.ACCENT : 'transparent'}`, textDecoration: 'none' }}
              >
                <PelotaDeporte deporte={d} size={22} />
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 18, color: activo ? S.TEXT : S.MUTED_2 }}>{DEPORTE_NOMBRE[d]}</span>
              </Link>
            );
          })}
        </nav>
      </div>
      {volverA && (
        <div style={{ padding: '6px 16px 0' }}>
          <button type="button" onClick={() => router.push(volverA)} aria-label="Volver" style={{ width: 34, height: 34, padding: 0, border: 'none', background: 'transparent', color: S.ACCENT, fontSize: 20, cursor: 'pointer' }}>
            ←
          </button>
        </div>
      )}
      {ficha && <FichaCreditos deporte={deporte} info={info} onCerrar={() => setFicha(false)} />}
      <AnimacionNivel usuarioId={perfil?.id} anclaRef={cabeceraRef} onNivel={setNivelAnim} onBrillo={setBrilloNivel} onXp={setXpNivel} />
    </div>
  );
}
