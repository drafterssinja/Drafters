'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';

// ============================================================================
// VÍDEO PUBLICITARIO EMBEBIDO (27/09, décima vuelta)
// ============================================================================
// Componente reutilizable para huecos de publicidad que NO reparten saldo
// (a diferencia del de /recargar) — usado debajo de la clasificación en
// directo, pedido de Iñi: "justo debajo de todo... que no interfiera en ver
// la clasificación, pero que el vídeo se esté reproduciendo para que se
// vea"; y, desde el 27/09 (a modo de prueba, "ponlo a ver para luego decidir
// si dejarlo o no"), también en el feed de /inicio. Se reproduce en bucle,
// sin sonido (el autoplay con sonido lo bloquean los navegadores de todas
// formas) y sin controles — es publicidad, no un vídeo que el usuario deba
// poder pausar o saltar.
//
// Si no hay ningún vídeo activo para esta ubicación ahora mismo (o el admin
// no ha subido ninguno todavía, o el admin ha desmarcado esta ubicación en
// todos los vídeos), el componente no pinta nada — la pantalla se queda
// exactamente igual que sin este componente.
export default function AnuncioVideoInline({ ubicacion }: { ubicacion: 'clasificacion' | 'inicio' }) {
  const [video, setVideo] = useState<{ id: string; url: string } | null | 'cargando'>('cargando');
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
      <video
        key={video.id}
        src={video.url}
        autoPlay
        muted
        loop
        playsInline
        onPlay={alEmpezarReproduccion}
        style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 12, border: `1px solid ${S.CARD_BORDER}`, background: '#000' }}
      />
    </div>
  );
}
