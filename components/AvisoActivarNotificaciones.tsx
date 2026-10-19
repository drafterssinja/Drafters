'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { activarPush, estadoPush } from '@/lib/push';

// ============================================================================
// VENTANA "YA LLEGAN LAS NOTIFICACIONES" AL ENTRAR (19/10, Iñi)
// ============================================================================
// Iñi: "un botón al principio de activar las notificaciones cuando entras en
// Drafters… el típico pop-up que puede decir no volver a mostrar… que se
// explique que ya están aquí las notificaciones, que con un botón le dé a
// activar y luego le indicamos que en su perfil, en el logo de su perfil, ahí
// puede activar o desactivar las que quiera".
// Solo sale si este dispositivo puede recibirlas y todavía no están activadas
// (en iPhone, con la app ya instalada; si no, sale antes la de instalar).
// Una vez por sesión, salvo "No volver a mostrar". Espera a que no haya otra
// ventana abierta (instalar la app, resultado de la jornada).

const CLAVE_NO_MOSTRAR = 'drafters_popup_notificaciones_no_mostrar';
const CLAVE_SESION = 'drafters_popup_notificaciones_visto_sesion';

function leer(almacen: 'local' | 'session', clave: string): boolean {
  try {
    return (almacen === 'local' ? localStorage : sessionStorage).getItem(clave) === '1';
  } catch {
    return false;
  }
}
function guardar(almacen: 'local' | 'session', clave: string) {
  try {
    (almacen === 'local' ? localStorage : sessionStorage).setItem(clave, '1');
  } catch {
    // sin almacenamiento: no pasa nada
  }
}

export default function AvisoActivarNotificaciones() {
  const [paso, setPaso] = useState<'cerrado' | 'invitar' | 'hecho'>('cerrado');
  const [noVolver, setNoVolver] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inicial, setInicial] = useState('D');

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return;
    if (leer('local', CLAVE_NO_MOSTRAR) || leer('session', CLAVE_SESION)) return;
    let vivo = true;
    let intentos = 0;
    let t: ReturnType<typeof setTimeout>;
    const probar = async () => {
      if (!vivo) return;
      // Otra ventana abierta: se espera un poco y se vuelve a mirar.
      if (document.querySelector('[data-drafters-popup]')) {
        if (++intentos < 30) t = setTimeout(probar, 2000);
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!vivo || !session) return;
      if ((await estadoPush()) !== 'inactivo') return;
      if (!vivo || leer('session', CLAVE_SESION)) return;
      const { data: perfil } = await supabase.from('perfiles').select('nombre,apellido').eq('id', session.user.id).maybeSingle();
      const p = perfil as { nombre: string | null; apellido: string | null } | null;
      if (p) setInicial(S.iniciales(p.nombre ?? '', p.apellido ?? '') || 'D');
      guardar('session', CLAVE_SESION);
      setPaso('invitar');
    };
    t = setTimeout(probar, 1500);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, []);

  if (paso === 'cerrado') return null;

  function cerrar() {
    if (noVolver) guardar('local', CLAVE_NO_MOSTRAR);
    setPaso('cerrado');
  }

  async function activar() {
    setOcupado(true);
    setError(null);
    const r = await activarPush();
    setOcupado(false);
    if (r.ok) setPaso('hecho');
    else setError(r.error ?? 'No se han podido activar.');
  }

  const boton = { width: '100%', border: 'none', borderRadius: 12, padding: '14px 16px', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 18, textTransform: 'uppercase' as const, letterSpacing: '0.03em', cursor: 'pointer' };

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-drafters-popup=""
      onClick={cerrar}
      style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(4,8,6,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 400, background: '#0F1513', border: `1px solid ${S.CARD_BORDER}`, borderRadius: 20, padding: '24px 20px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}
      >
        {paso === 'invitar' ? (
          <>
            <span style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(61,220,132,0.14)', border: '1px solid rgba(61,220,132,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>🔔</span>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 26, lineHeight: 1.05, color: S.TEXT }}>¡Ya llegan las notificaciones!</span>
            <span style={{ fontSize: 14, color: S.MUTED, lineHeight: 1.5 }}>Actívalas y te avisamos para que no se te pase ninguna jornada:</span>
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
              {[
                ['🏟️', 'Nueva jornada', 'El día antes: mañana vuelve la Champions, LaLiga o el golf.'],
                ['⏰', 'No te olvides de tu equipo', 'Una hora antes, si todavía no lo has hecho.'],
              ].map(([icono, t, d]) => (
                <div key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 12px', background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12 }}>
                  <span style={{ fontSize: 22, lineHeight: 1 }}>{icono}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontWeight: 800, fontSize: 14, color: S.TEXT }}>{t}</span>
                    <span style={{ fontSize: 12.5, color: S.MUTED_2, lineHeight: 1.4 }}>{d}</span>
                  </span>
                </div>
              ))}
            </div>
            {error && <span style={{ fontSize: 12.5, fontWeight: 700, color: S.ERROR }}>{error}</span>}
            <button type="button" disabled={ocupado} onClick={() => void activar()} style={{ ...boton, background: S.ACCENT, color: '#04140B', opacity: ocupado ? 0.6 : 1 }}>
              {ocupado ? 'Activando…' : '🔔 Activar notificaciones'}
            </button>
            <button type="button" onClick={cerrar} style={{ width: '100%', background: 'transparent', color: S.MUTED, border: `1px solid ${S.BORDER}`, borderRadius: 12, padding: '11px 14px', fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              Ahora no
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: S.MUTED_2, cursor: 'pointer' }}>
              <input type="checkbox" checked={noVolver} onChange={(e) => setNoVolver(e.target.checked)} style={{ width: 18, height: 18, accentColor: S.ACCENT }} />
              No volver a mostrar
            </label>
          </>
        ) : (
          <>
            <span style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(61,220,132,0.14)', border: '1px solid rgba(61,220,132,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>✅</span>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 26, lineHeight: 1.05, color: S.TEXT }}>¡Notificaciones activadas!</span>
            <span style={{ fontSize: 14, color: S.MUTED, lineHeight: 1.5 }}>
              Cuando quieras puedes elegir cuáles recibir o apagarlas: toca tu logo de perfil, arriba a la derecha, y entra en <b style={{ color: S.TEXT }}>Notificaciones</b>.
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px 8px 8px', borderRadius: 999, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}` }}>
              <span style={{ width: 34, height: 34, borderRadius: '50%', background: S.ACCENT, color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{inicial}</span>
              <span style={{ fontSize: 16, color: S.MUTED_2 }}>→</span>
              <span style={{ fontWeight: 800, fontSize: 13.5, color: S.TEXT }}>🔔 Notificaciones</span>
            </span>
            <button type="button" onClick={() => setPaso('cerrado')} style={{ ...boton, background: S.ACCENT, color: '#04140B' }}>
              Entendido
            </button>
            <Link href="/cuenta#notificaciones" onClick={() => setPaso('cerrado')} style={{ fontSize: 13, fontWeight: 700, color: S.ACCENT, textDecoration: 'none' }}>
              Elegir mis avisos ahora ›
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
