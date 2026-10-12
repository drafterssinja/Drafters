'use client';

import { useEffect, useState } from 'react';
import * as S from '@/lib/mockupStyles';

// ============================================================================
// AÑADIR DRAFTERS A LA PANTALLA DE INICIO (12/10, pedido de Iñi)
// ============================================================================
// - Detecta el móvil: en iPhone solo sale "Añadir a iPhone", en Android solo
//   "Añadir a Android", en ordenador nada. Si ya se ha abierto desde el icono
//   (app instalada), tampoco sale.
// - Android: el botón abre la ventana de instalación del propio navegador.
// - iPhone: Apple no deja instalar con un botón; se abre una guía de 3 pasos
//   (••• / Compartir → Ver más → Añadir a pantalla de inicio → Añadir).
// - Navegadores dentro de Instagram, Facebook, TikTok…: no dejan instalar; se
//   pide abrir drafters.es en Safari / Chrome.
// Variante 'aviso' (Inicio): se puede cerrar y no vuelve a salir.

type Plataforma = 'ios' | 'android' | null;
type Variante = 'tarjeta' | 'aviso';

const CLAVE_AVISO_CERRADO = 'drafters_aviso_instalar_cerrado';

function detectar(): { plataforma: Plataforma; instalada: boolean; dentroDeApp: boolean } {
  if (typeof window === 'undefined') return { plataforma: null, instalada: false, dentroDeApp: false };
  const ua = navigator.userAgent || '';
  const esIos = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const esAndroid = /Android/i.test(ua);
  const instalada =
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  const dentroDeApp = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|Line\/|Twitter|TikTok|musical_ly|BytedanceWebview|Snapchat|LinkedInApp|GSA\//i.test(ua);
  return { plataforma: esIos ? 'ios' : esAndroid ? 'android' : null, instalada, dentroDeApp };
}

function IconoMovil() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M11 18h2" />
    </svg>
  );
}

function IconoCompartir() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ verticalAlign: '-3px' }}>
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
    </svg>
  );
}

function IconoMas() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ verticalAlign: '-3px' }}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function Paso({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', background: S.ACCENT, color: '#04140B', fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Manrope', sans-serif" }}>{n}</span>
      <span style={{ fontSize: 14, color: S.TEXT, lineHeight: 1.45, paddingTop: 3 }}>{children}</span>
    </div>
  );
}

function Guia({ plataforma, dentroDeApp, onCerrar }: { plataforma: Plataforma; dentroDeApp: boolean; onCerrar: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCerrar}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 420, background: S.PANEL, border: '1px solid #1E2723', borderRadius: 18, padding: '20px 18px 18px', display: 'flex', flexDirection: 'column', gap: 14, marginBottom: plataforma === 'ios' ? 64 : 0 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color: S.TEXT }}>
            {plataforma === 'ios' ? 'Añade Drafters a tu iPhone' : 'Añade Drafters a tu Android'}
          </span>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" style={{ background: 'none', border: 'none', color: S.MUTED_2, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>
            ×
          </button>
        </div>

        {dentroDeApp ? (
          <p style={{ fontSize: 14, color: S.TEXT, margin: 0, lineHeight: 1.5 }}>
            Estás dentro de otra app (Instagram, TikTok…) y desde aquí no se puede instalar. Abre <strong>drafters.es</strong> en{' '}
            {plataforma === 'ios' ? 'Safari' : 'Chrome'} y vuelve a pulsar este botón.
          </p>
        ) : plataforma === 'ios' ? (
          <>
            <Paso n={1}>
              Pulsa <strong>•••</strong> abajo a la derecha (o el botón <strong>Compartir</strong> <IconoCompartir />) y elige <strong>Compartir</strong>.
            </Paso>
            <Paso n={2}>
              Pulsa <strong>Ver más</strong> y después <strong>Añadir a pantalla de inicio</strong> <IconoMas />.
            </Paso>
            <Paso n={3}>
              Pulsa <strong>Añadir</strong>. Drafters aparecerá en tu pantalla de inicio con su icono, como una app más.
            </Paso>
          </>
        ) : (
          <>
            <Paso n={1}>
              Pulsa el menú <strong>⋮</strong> arriba a la derecha del navegador.
            </Paso>
            <Paso n={2}>
              Elige <strong>Instalar aplicación</strong> o <strong>Añadir a pantalla de inicio</strong>.
            </Paso>
            <Paso n={3}>
              Confirma con <strong>Instalar</strong>. Drafters aparecerá con su icono, como una app más.
            </Paso>
          </>
        )}
      </div>
      <style>{`@keyframes drafters-instalar-flecha { 0%, 100% { opacity: 1; transform: translate(0,0); } 50% { opacity: 0.4; transform: translate(4px,4px); } }`}</style>
      {plataforma === 'ios' && !dentroDeApp && (
        <span
          aria-hidden
          style={{ position: 'fixed', bottom: 14, right: 28, fontSize: 34, color: S.ACCENT, lineHeight: 1, animation: 'drafters-instalar-flecha 1.4s ease-in-out infinite' }}
        >
          ↘
        </span>
      )}
    </div>
  );
}

export default function InstalarApp({ variante = 'tarjeta' }: { variante?: Variante }) {
  const [info, setInfo] = useState<{ plataforma: Plataforma; instalada: boolean; dentroDeApp: boolean } | null>(null);
  const [avisoCerrado, setAvisoCerrado] = useState(false);
  const [guiaAbierta, setGuiaAbierta] = useState(false);
  const [, setRefresco] = useState(0);

  useEffect(() => {
    setInfo(detectar());
    try {
      setAvisoCerrado(localStorage.getItem(CLAVE_AVISO_CERRADO) === '1');
    } catch {
      // sin almacenamiento: el aviso se enseña igual
    }
    const refrescar = () => setRefresco((n) => n + 1);
    const instalada = () => setInfo((i) => (i ? { ...i, instalada: true } : i));
    window.addEventListener('drafters-instalable', refrescar);
    window.addEventListener('drafters-instalada', instalada);
    return () => {
      window.removeEventListener('drafters-instalable', refrescar);
      window.removeEventListener('drafters-instalada', instalada);
    };
  }, []);

  if (!info || !info.plataforma || info.instalada) return null;
  if (variante === 'aviso' && avisoCerrado) return null;

  const plataforma = info.plataforma;

  async function instalar() {
    if (plataforma === 'android' && !info?.dentroDeApp) {
      const w = window as unknown as { __draftersInstalar?: (Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null };
      const aviso = w.__draftersInstalar;
      if (aviso) {
        try {
          await aviso.prompt();
          const r = await aviso.userChoice;
          w.__draftersInstalar = null;
          if (r.outcome === 'accepted') setInfo((i) => (i ? { ...i, instalada: true } : i));
          return;
        } catch {
          // si falla, se enseñan los pasos a mano
        }
      }
    }
    setGuiaAbierta(true);
  }

  function cerrarAviso() {
    setAvisoCerrado(true);
    try {
      localStorage.setItem(CLAVE_AVISO_CERRADO, '1');
    } catch {
      // nada
    }
  }

  const etiqueta = plataforma === 'ios' ? 'Añadir a iPhone' : 'Añadir a Android';
  const boton = (
    <button
      type="button"
      onClick={instalar}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: S.ACCENT, color: '#04140B', border: 'none', borderRadius: 10, padding: '10px 14px', fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}
    >
      <IconoMovil />
      {etiqueta}
    </button>
  );

  return (
    <>
      {variante === 'tarjeta' ? (
        <div style={{ ...S.card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: S.TEXT }}>Drafters en tu móvil</span>
            <span style={{ fontSize: 12, color: S.MUTED_2 }}>Ten Drafters en tu pantalla de inicio, como una app más, a pantalla completa.</span>
          </div>
          {boton}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(61,220,132,0.08)', border: '1px solid rgba(61,220,132,0.3)', borderRadius: 12, padding: '10px 12px', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 160, fontSize: 13, color: S.TEXT }}>Ten Drafters en tu pantalla de inicio, como una app.</span>
          {boton}
          <button type="button" onClick={cerrarAviso} aria-label="No volver a mostrar" style={{ background: 'none', border: 'none', color: S.MUTED_2, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>
            ×
          </button>
        </div>
      )}
      {guiaAbierta && <Guia plataforma={plataforma} dentroDeApp={info.dentroDeApp} onCerrar={() => setGuiaAbierta(false)} />}
    </>
  );
}
