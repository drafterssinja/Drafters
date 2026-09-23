'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const ACCENT = '#3DDC84';

type Props = {
  // Cuando se pasan, el header añade el saldo y el avatar a la derecha,
  // igual que en la maqueta visual para las pantallas "dentro de la cuenta"
  // (isLoggedInArea). Si se omiten, el header es solo flecha + wordmark
  // (pantallas de login/registro/verificación, antes de tener sesión).
  saldoLabel?: string;
  accountInitials?: string;
  // A dónde lleva el wordmark "DRAFTERS". Por defecto: a /inicio cuando el
  // header lleva saldo+avatar (estamos dentro de la cuenta, como en la
  // maqueta), y a la portada pública "/" si no (login/registro/verificación,
  // todavía sin sesión).
  homeHref?: string;
};

// Cabecera reutilizada en todas las pantallas salvo la portada — misma
// estructura exacta que la maqueta visual (Main.dc.html): flecha de
// "volver" (usa el historial del navegador) + wordmark "DRAFTERS" que
// lleva a la portada.
export default function DraftersHeader({ saldoLabel, accountInitials, homeHref }: Props) {
  const router = useRouter();
  const destino = homeHref ?? (saldoLabel && accountInitials ? '/inicio' : '/');
  const enAreaDeCuenta = !!(saldoLabel && accountInitials);

  // Icono de notificaciones (pedido de Iñi, 23/09): puntito rojo con el
  // número de notificaciones sin leer. Solo tiene sentido dentro del área
  // de cuenta (con saldo+avatar ya visibles) — se resuelve solo, sin que
  // cada pantalla que usa esta cabecera tenga que pasarle nada nuevo.
  const [noLeidas, setNoLeidas] = useState(0);

  useEffect(() => {
    if (!enAreaDeCuenta) return;
    let activo = true;
    supabase
      .from('notificaciones')
      .select('id', { count: 'exact', head: true })
      .eq('leido', false)
      .then(({ count }) => {
        if (activo) setNoLeidas(count ?? 0);
      });
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enAreaDeCuenta]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '18px 20px',
        borderBottom: '1px solid #1A211D',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Volver"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            color: ACCENT,
            flexShrink: 0,
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <Link
          href={destino}
          style={{
            fontFamily: "'Barlow Condensed', sans-serif",
            fontWeight: 800,
            fontSize: 22,
            letterSpacing: '0.06em',
            color: '#F5F7F5',
          }}
        >
          DRAFTERS
        </Link>
      </div>

      {saldoLabel && accountInitials && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <Link
            href="/notificaciones"
            aria-label={noLeidas > 0 ? `Notificaciones (${noLeidas} sin leer)` : 'Notificaciones'}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              flexShrink: 0,
              color: '#C9D2CC',
              background: '#131917',
              border: '1px solid #2A3733',
              borderRadius: 8,
              textDecoration: 'none',
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {noLeidas > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: -5,
                  right: -5,
                  minWidth: 16,
                  height: 16,
                  padding: '0 3px',
                  borderRadius: 999,
                  background: '#FF5C5C',
                  color: '#FFF',
                  fontFamily: "'Manrope', sans-serif",
                  fontWeight: 800,
                  fontSize: 9.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1.5px solid #0B0F0E',
                }}
              >
                {noLeidas > 99 ? '99+' : noLeidas}
              </span>
            )}
          </Link>
          <Link
            href="/recargar"
            aria-label="Recargar saldo"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: '#131917',
              border: '1px solid #2A3733',
              borderRadius: 8,
              padding: '7px 10px',
              textDecoration: 'none',
            }}
          >
            <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 12.5, color: '#F5F7F5', whiteSpace: 'nowrap' }}>
              {saldoLabel}
            </span>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 13, color: ACCENT }}>+</span>
          </Link>
          <Link
            href="/cuenta"
            aria-label="Mi cuenta"
            style={{
              flexShrink: 0,
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: ACCENT,
              color: '#04140B',
              fontFamily: "'Barlow Condensed', sans-serif",
              fontWeight: 800,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textDecoration: 'none',
            }}
          >
            {accountInitials}
          </Link>
        </div>
      )}
    </div>
  );
}
