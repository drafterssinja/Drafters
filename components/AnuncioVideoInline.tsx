'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';

// ============================================================================
// VÍDEO PUBLICITARIO EMBEBIDO (27/09, décima vuelta — con audio, 28/09)
// ============================================================================
// Componente reutilizable para huecos de publicidad que NO reparten saldo
// (a diferencia del de /recargar) — usado debajo de la clasificación en
// directo, pedido de Iñi: "justo debajo de todo... que no interfiera en ver
// la clasificación, pero que el vídeo se esté reproduciendo para que se
// vea"; y, desde el 28/09, también en /mesas ("mesas" — el hueco vivió
// primero, a modo de prueba, en el feed de /inicio, y se movió aquí tras
// simplificar esa pantalla). Se reproduce en bucle, con controles propios
// mínimos: empieza SIEMPRE silenciado (el autoplay con sonido lo bloquean
// los navegadores de todas formas) y un botón propio deja
// activar/desactivar el audio (pedido de Iñi, 28/09) — sin más controles,
// porque es publicidad, no un vídeo que el usuario deba poder pausar o
// saltar.
//
// Si no hay ningún vídeo activo para esta ubicación ahora mismo (o el admin
// no ha subido ninguno todavía, o el admin ha desmarcado esta ubicación en
// todos los vídeos), el componente no pinta nada — la pantalla se queda
// exactamente igual que sin este componente.
export default function AnuncioVideoInline({ ubicacion }: { ubicacion: 'clasificacion' | 'mesas' }) {
  const [video, setVideo] = useState<{ id: string; url: string } | null | 'cargando'>('cargando');
  const [silenciado, setSilenciado] = useState(true);
  const yaRegistradoRef = useRef(false);

  useEffect(() => {
    let activo = true;
    async function cargar() {
      const { data } = await supabase.rpc('elegir_anuncio_video', { p_ubicacion: ubicacion });
      if (!activo) return;
      setVideo(data && data.length > 0 ? { id: data[0].id, url: data[0].url } : null);
    }
    cargar();
    return () => {
      activo = false;
    };
  }, [ubicacion]);

  function alEmpezarReproduccion() {
    if (!video || video === 'cargando' || yaRegistradoRef.current) return;
    yaRegistradoRef.current = true;
    // Solo cuenta como "vista" a efectos de estadísticas del admin — este
    // hueco nunca reparte saldo, así que basta con registrarlo una vez al
    // empezar a reproducirse (no hace falta esperar a que acabe, y con
    // loop=true el evento "ended" no llega a dispararse nunca).
    supabase.rpc('registrar_visualizacion_anuncio', { p_video_id: video.id, p_ubicacion: ubicacion, p_completado: true });
  }

  if (video === 'cargando' || video === null) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 24 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: S.FAINT, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Publicidad</span>
      <div style={{ position: 'relative' }}>
        <video
          key={video.id}
          src={video.url}
          autoPlay
          muted={silenciado}
          loop
          playsInline
          onPlay={alEmpezarReproduccion}
          style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 12, border: `1px solid ${S.CARD_BORDER}`, background: '#000', display: 'block' }}
        />
        <button
          type="button"
          onClick={() => setSilenciado((s) => !s)}
          aria-label={silenciado ? 'Activar el sonido del vídeo' : 'Silenciar el vídeo'}
          style={{
            position: 'absolute',
            bottom: 10,
            right: 10,
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.25)',
            background: 'rgba(6,10,8,0.6)',
            color: '#F5F7F5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {silenciado ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 5 6 9H3v6h3l5 4V5Z" strokeLinejoin="round" />
              <line x1="23" y1="9" x2="17" y2="15" strokeLinecap="round" />
              <line x1="17" y1="9" x2="23" y2="15" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 5 6 9H3v6h3l5 4V5Z" strokeLinejoin="round" />
              <path d="M15.5 8.5a5 5 0 0 1 0 7" strokeLinecap="round" />
              <path d="M18 6a9 9 0 0 1 0 12" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
