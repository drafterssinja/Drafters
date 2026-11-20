'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import * as S from '@/lib/mockupStyles';
import { DEPORTE_NOMBRE, IconoCredito, type DeporteV2 } from '@/components/v2/IconosV2';
import { RecargaVideo } from '@/components/v2/creditos';

// ============================================================================
// AVISO "NO TE QUEDAN CRÉDITOS" EN MITAD DE LA PANTALLA (20/11, Iñi)
// ============================================================================
// "Cuando no haya créditos, no debe aparecer el mensaje rojo abajo, sino un
// pop-up en mitad de la pantalla diciendo lo mismo y con un botón para ir
// directamente a ver el vídeo." Al recargar, se vuelve a guardar el equipo solo
// (onRecargado).

/** ¿Es el error de "no te quedan créditos" de la base de datos? */
export function esErrorSinCreditos(mensaje: string | null | undefined): boolean {
  return /no te quedan cr[eé]ditos/i.test(mensaje ?? '');
}

export default function AvisoSinCreditos({
  deporte,
  texto = 'Cada jornada de la liga cuesta 1 crédito. Mira un vídeo para recargarlos y guarda tu equipo.',
  onCerrar,
  onRecargado,
}: {
  deporte: DeporteV2;
  texto?: string;
  onCerrar: () => void;
  onRecargado: () => void;
}) {
  const [video, setVideo] = useState(false);
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  if (!montado) return null;
  // Fuera de la barra de abajo (portal), para que ocupe toda la pantalla.
  if (video)
    return createPortal(
      <RecargaVideo
        deporte={deporte}
        onCerrar={() => setVideo(false)}
        onRecargado={() => onRecargado()}
      />,
      document.body
    );
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCerrar}
      style={{ position: 'fixed', inset: 0, zIndex: 250, background: 'rgba(3,6,5,0.72)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'relative', width: '100%', maxWidth: 360, background: S.PANEL, border: '1px solid rgba(61,220,132,0.35)', borderRadius: 22, padding: '26px 22px 18px', boxShadow: '0 20px 60px rgba(0,0,0,0.6)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}
      >
        <button type="button" aria-label="Cerrar" onClick={onCerrar} style={{ position: 'absolute', right: 10, top: 6, width: 'auto', background: 'none', border: 'none', color: S.MUTED_3, fontSize: 24, cursor: 'pointer', padding: 6 }}>
          ×
        </button>
        <span style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(61,220,132,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <IconoCredito size={36} />
        </span>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 27, lineHeight: 1.05, color: S.TEXT }}>
          No te quedan créditos de {DEPORTE_NOMBRE[deporte].toLowerCase()}
        </span>
        <span style={{ fontSize: 14.5, color: S.MUTED, lineHeight: 1.5 }}>{texto}</span>
        <button
          type="button"
          onClick={() => setVideo(true)}
          style={{ marginTop: 6, width: '100%', height: 54, borderRadius: 14, border: 'none', background: S.ACCENT, color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 18, letterSpacing: '0.02em', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer' }}
        >
          <span style={{ fontSize: 15 }}>▶</span> VER UN VÍDEO Y RECARGAR
        </button>
        <button type="button" onClick={onCerrar} style={{ width: 'auto', background: 'none', border: 'none', color: S.MUTED_2, fontSize: 14, fontWeight: 700, cursor: 'pointer', padding: 8 }}>
          Ahora no
        </button>
      </div>
    </div>,
    document.body
  );
}
