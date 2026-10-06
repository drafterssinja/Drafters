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
//
// ----------------------------------------------------------------------
// FIX 01/10 (aviso de Iñi: "el vídeo de publicidad de la página de
// clasificación no funciona, está colgado. Solamente se ve una imagen
// congelada"): el componente confiaba solo en los atributos de HTML
// `autoPlay`/`muted` del <video>. Esto puede fallar silenciosamente de dos
// formas típicas de Next.js: (1) la página se renderiza primero en el
// servidor y el navegador "hidrata" el <video> después — en ese proceso el
// arranque automático se puede interrumpir y el vídeo se queda parado en su
// primer fotograma (de ahí la "imagen congelada"); (2) el navegador puede
// bloquear el autoplay sin avisar en ningún sitio visible (la promesa de
// `.play()` se rechaza en silencio si no se gestiona). Como `onPlay` nunca
// llegaba a dispararse en ese caso, tampoco se registraba la visualización
// — encaja con que SOLO pasara en algunas pantallas y no en otras.
//
// Ahora se controla la reproducción de forma explícita (vía ref, no solo
// con los atributos JSX) y, si el arranque automático falla o se queda
// colgado más de unos segundos, se muestra un botón de "▶ Reproducir"
// encima del vídeo para que un toque del usuario lo arranque manualmente
// (un gesto del usuario siempre está permitido por los navegadores, aunque
// el autoplay esté bloqueado).
export default function AnuncioVideoInline({ ubicacion }: { ubicacion: 'clasificacion' | 'mesas' }) {
  const [video, setVideo] = useState<{ id: string; url: string; enlace: string | null } | null | 'cargando'>('cargando');
  const [silenciado, setSilenciado] = useState(true);
  const [necesitaToque, setNecesitaToque] = useState(false);
  // Proporción real del vídeo (ancho/alto), para la caja de escritorio.
  const [proporcion, setProporcion] = useState<number | null>(null);
  const yaRegistradoRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let activo = true;
    async function cargar() {
      const { data } = await supabase.rpc('elegir_anuncio_video', { p_ubicacion: ubicacion });
      if (!activo) return;
      setVideo(data && data.length > 0 ? { id: data[0].id, url: data[0].url, enlace: data[0].enlace_destino ?? null } : null);
    }
    cargar();
    return () => {
      activo = false;
    };
  }, [ubicacion]);

  // Arranque explícito de la reproducción (ver nota de más arriba) — se
  // repite cada vez que cambia el vídeo elegido. Si el navegador bloquea el
  // autoplay (promesa rechazada) o si, pasados unos segundos, el vídeo
  // sigue sin avanzar de fotograma (archivo colgándose al cargar), se ofrece
  // el botón manual en vez de dejar la "imagen congelada" sin explicación.
  useEffect(() => {
    if (!video || video === 'cargando') return;
    const el = videoRef.current;
    if (!el) return;

    setNecesitaToque(false);
    el.muted = true;

    const intentarReproducir = () => {
      el.play().catch(() => {
        setNecesitaToque(true);
      });
    };
    intentarReproducir();

    const avisoSiSigueColgado = window.setTimeout(() => {
      if (el.paused || el.readyState < 2) setNecesitaToque(true);
    }, 4000);

    return () => window.clearTimeout(avisoSiSigueColgado);
  }, [video]);

  function reproducirManualmente() {
    const el = videoRef.current;
    if (!el) return;
    el.muted = silenciado;
    el.play()
      .then(() => setNecesitaToque(false))
      .catch(() => setNecesitaToque(true));
  }

  function alEmpezarReproduccion() {
    if (!video || video === 'cargando' || yaRegistradoRef.current) return;
    yaRegistradoRef.current = true;
    // Solo cuenta como "vista" a efectos de estadísticas del admin — este
    // hueco nunca reparte saldo, así que basta con registrarlo una vez al
    // empezar a reproducirse (no hace falta esperar a que acabe, y con
    // loop=true el evento "ended" no llega a dispararse nunca).
    //
    // 28/09 (aviso de Iñi: veía el vídeo pero no se quedaba registrado, ni
    // una sola vez, ni en /mesas ni en clasificación): esta llamada era
    // "fire and forget", sin comprobar el resultado — si por lo que fuera
    // fallaba (el caso más probable: el esquema SQL de esta pantalla,
    // 'mesas' como ubicación válida, todavía no se había vuelto a ejecutar
    // en Supabase), no había ni un solo rastro del fallo en ningún sitio,
    // así que era imposible diagnosticarlo. Ahora, si falla, al menos
    // queda un error real en la consola del navegador (F12 → Console).
    supabase.rpc('registrar_visualizacion_anuncio', { p_video_id: video.id, p_ubicacion: ubicacion, p_completado: true }).then(({ error }) => {
      if (error) {
        // eslint-disable-next-line no-console
        console.error('No se ha podido registrar la visualización del vídeo publicitario:', error.message);
      }
    });
  }

  if (video === 'cargando' || video === null) return null;

  // Clic en el vídeo → al enlace cargado en /admin (nuevo, 01/10, pedido de
  // Iñi: "que cuando tú cliques encima del vídeo de publicidad nos enlace a
  // la página web que pongamos en las propiedades del vídeo"). Sin enlace
  // cargado, el vídeo se comporta exactamente igual que antes (no clicable).
  // Los dos botones propios (silenciar, reproducir) cortan la propagación
  // del clic para que pulsarlos nunca abra también el enlace.
  //
  // Registro del clic (nuevo, 03/10, pedido de Iñi: "quiero que se quede
  // registrado cuántas veces se pulsa encima del vídeo y, por lo tanto, se
  // visita la página del publicitante") — fire-and-forget, igual que
  // alEmpezarReproduccion() más arriba: nunca debe poder retrasar ni
  // bloquear la apertura real del enlace, que es lo que de verdad le
  // importa a quien ha pulsado.
  function irAlEnlace() {
    if (video === 'cargando' || video === null || !video.enlace) return;
    supabase.rpc('registrar_clic_anuncio', { p_video_id: video.id, p_ubicacion: ubicacion }).then(({ error }) => {
      if (error) {
        // eslint-disable-next-line no-console
        console.error('No se ha podido registrar el clic en el vídeo publicitario:', error.message);
      }
    });
    window.open(video.enlace, '_blank', 'noopener,noreferrer');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 24 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: S.FAINT, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Publicidad</span>
      <div
        className="anuncio-video-caja"
        onClick={irAlEnlace}
        style={{ position: 'relative', cursor: video.enlace ? 'pointer' : 'default', ...(proporcion ? ({ '--ratio': String(proporcion) } as React.CSSProperties) : {}) }}
      >
        <video
          key={video.id}
          ref={videoRef}
          src={video.url}
          autoPlay
          muted={silenciado}
          loop
          playsInline
          onPlay={() => {
            setNecesitaToque(false);
            alEmpezarReproduccion();
          }}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) setProporcion(v.videoWidth / v.videoHeight);
          }}
          onError={() => {
            // eslint-disable-next-line no-console
            console.error('No se ha podido cargar el vídeo publicitario:', video.url);
            setNecesitaToque(true);
          }}
          style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 12, border: `1px solid ${S.CARD_BORDER}`, background: '#000', display: 'block' }}
        />
        {necesitaToque && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              reproducirManualmente();
            }}
            aria-label="Reproducir el vídeo"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(6,10,8,0.45)',
              border: 'none',
              borderRadius: 12,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <span
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: 'rgba(6,10,8,0.75)',
                border: '1px solid rgba(255,255,255,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="#F5F7F5">
                <path d="M8 5v14l11-7Z" />
              </svg>
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSilenciado((s) => !s);
          }}
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
