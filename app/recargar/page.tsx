'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';

// ============================================================================
// RECARGA DE SALDO — 10€ gratis al mes + 10€ por cada vídeo visto (27/09,
// décima vuelta)
// ============================================================================
// Antes había 4 botones de recarga instantánea y gratuita (+10/+25/+50/
// +100€). Pedido de Iñi: "cada nuevo usuario, cuando entra, solamente va a
// tener 20 euros de saldo... en la parte de recarga solamente va a tener
// dos botones: uno que es una recarga gratuita de 10 euros, y esa solo la
// puede gastar una vez al mes... después todas las recargas adicionales que
// quiera hacer, de 10 euros, tiene que ser a cambio de ver un vídeo".
//
// - Botón 1, "Recarga gratis": llama a recargar_gratis_mensual() — el
//   servidor comprueba perfiles.ultima_recarga_gratis y rechaza si se usó
//   hace menos de 30 días; aquí, en el cliente, se calcula lo mismo solo
//   para poder deshabilitar el botón y mostrar cuántos días faltan, sin
//   esperar al rechazo del servidor (que sigue siendo la comprobación real).
// - Botón 2, "Ver un vídeo": pide un vídeo activo para este hueco
//   (elegir_anuncio_video('recarga')) y lo reproduce a pantalla completa;
//   solo al terminar de verse entero (evento onEnded) se llama a
//   recargar_por_video(), que es quien de verdad da los 10€ — cerrar el
//   vídeo antes de que acabe no da nada.
const RECARGA_GRATIS_DIAS = 30;
const RECARGA_GRATIS_IMPORTE = 10;
const RECARGA_VIDEO_IMPORTE = 10;

type AnuncioVideo = { id: string; url: string; nombre_referencia: string };

export default function RecargarPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState(false);
  const [confirmacion, setConfirmacion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [modalAbierto, setModalAbierto] = useState(false);
  const [videoAnuncio, setVideoAnuncio] = useState<AnuncioVideo | null>(null);
  const [buscandoVideo, setBuscandoVideo] = useState(false);
  const yaRecompensadoRef = useRef(false);

  useEffect(() => {
    let activo = true;

    async function cargar() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      const { data, error: perfilError } = await supabase.from('perfiles').select('*').eq('id', session.user.id).single();
      if (!activo) return;
      if (perfilError) setError('No se ha podido cargar tu saldo. Inténtalo de nuevo.');
      else setPerfil(data as Perfil);
      setCargando(false);
    }

    cargar();
    return () => {
      activo = false;
    };
  }, [router]);

  async function pedirRecargaGratis() {
    setError(null);
    setConfirmacion(null);
    setProcesando(true);
    const { data, error: rpcError } = await supabase.rpc('recargar_gratis_mensual');
    setProcesando(false);
    if (rpcError) {
      setError('No se ha podido completar la recarga gratuita. Puede que ya la hayas usado este mes.');
      return;
    }
    setPerfil(data as Perfil);
    setConfirmacion(`Has añadido ${RECARGA_GRATIS_IMPORTE} € a tu saldo.`);
  }

  async function abrirVideoParaRecargar() {
    setError(null);
    setConfirmacion(null);
    setBuscandoVideo(true);
    const { data, error: rpcError } = await supabase.rpc('elegir_anuncio_video', { p_ubicacion: 'recarga' });
    setBuscandoVideo(false);
    if (rpcError || !data || data.length === 0) {
      setError('No hay vídeos publicitarios disponibles ahora mismo. Inténtalo más tarde.');
      return;
    }
    yaRecompensadoRef.current = false;
    setVideoAnuncio(data[0] as AnuncioVideo);
    setModalAbierto(true);
  }

  async function alTerminarVideo() {
    if (!videoAnuncio || yaRecompensadoRef.current) return;
    yaRecompensadoRef.current = true;
    setProcesando(true);
    const { data, error: rpcError } = await supabase.rpc('recargar_por_video', { p_video_id: videoAnuncio.id });
    setProcesando(false);
    setModalAbierto(false);
    if (rpcError) {
      setError('El vídeo ha terminado, pero no se ha podido completar la recarga. Inténtalo de nuevo.');
      return;
    }
    setPerfil(data as Perfil);
    setConfirmacion(`Has añadido ${RECARGA_VIDEO_IMPORTE} € a tu saldo.`);
  }

  if (cargando || !perfil) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader />
          <div style={S.accountSection}>
            <p style={{ fontSize: 14, color: S.MUTED }}>Cargando...</p>
          </div>
        </div>
      </main>
    );
  }

  const saldoLabel = `${perfil.saldo_simulado.toFixed(2)} €`;
  const initials = S.iniciales(perfil.nombre, perfil.apellido);

  const msDesdeUltimaGratis = perfil.ultima_recarga_gratis ? Date.now() - new Date(perfil.ultima_recarga_gratis).getTime() : null;
  const msVentanaGratis = RECARGA_GRATIS_DIAS * 24 * 60 * 60 * 1000;
  const puedeRecargaGratis = msDesdeUltimaGratis === null || msDesdeUltimaGratis >= msVentanaGratis;
  const diasParaGratis = puedeRecargaGratis ? 0 : Math.ceil((msVentanaGratis - (msDesdeUltimaGratis as number)) / (24 * 60 * 60 * 1000));

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
        <div style={S.accountSection}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>
              Recargar saldo
            </h1>
            <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>
              Saldo actual: <span style={{ color: S.TEXT, fontWeight: 700 }}>{saldoLabel}</span>
            </p>
          </div>

          {confirmacion && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', background: 'rgba(61,220,132,0.12)', border: '1px solid rgba(61,220,132,0.4)', borderRadius: 10 }}>
              <span style={{ color: S.ACCENT, fontSize: 15, flexShrink: 0 }}>✓</span>
              <span style={{ fontSize: 12.5, color: '#C9D2CC' }}>{confirmacion}</span>
            </div>
          )}
          {error && <p style={S.errorText}>{error}</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={S.sectionLabel}>Elige cómo recargar</span>

            <button
              type="button"
              disabled={procesando || !puedeRecargaGratis}
              onClick={pedirRecargaGratis}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 2,
                background: S.PANEL,
                border: `1px solid ${S.CARD_BORDER}`,
                borderRadius: 12,
                padding: '16px 18px',
                textAlign: 'left',
                cursor: puedeRecargaGratis && !procesando ? 'pointer' : 'default',
                opacity: procesando ? 0.6 : puedeRecargaGratis ? 1 : 0.5,
              }}
            >
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color: S.TEXT }}>
                Recarga gratis · +{RECARGA_GRATIS_IMPORTE} €
              </span>
              <span style={{ fontSize: 12, color: S.MUTED_2 }}>
                {puedeRecargaGratis ? 'Disponible una vez cada 30 días' : `Vuelve a estar disponible en ${diasParaGratis} ${diasParaGratis === 1 ? 'día' : 'días'}`}
              </span>
            </button>

            <button
              type="button"
              disabled={procesando || buscandoVideo}
              onClick={abrirVideoParaRecargar}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 2,
                background: S.PANEL,
                border: `1px solid ${S.CARD_BORDER}`,
                borderRadius: 12,
                padding: '16px 18px',
                textAlign: 'left',
                cursor: procesando || buscandoVideo ? 'default' : 'pointer',
                opacity: procesando || buscandoVideo ? 0.6 : 1,
              }}
            >
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color: S.TEXT }}>
                {buscandoVideo ? 'Buscando vídeo...' : `Ver un vídeo · +${RECARGA_VIDEO_IMPORTE} €`}
              </span>
              <span style={{ fontSize: 12, color: S.MUTED_2 }}>Sin límite de veces — hace falta ver el vídeo entero</span>
            </button>
          </div>

          <span style={{ fontSize: 10, color: S.FAINT }}>
            *Saldo simulado (€) — no hay pasarela de pago real conectada.
          </span>
        </div>
      </div>

      {modalAbierto && videoAnuncio && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.92)',
            zIndex: 200,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <span style={{ position: 'absolute', top: 16, left: 16, fontSize: 11, fontWeight: 700, color: S.MUTED_2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Publicidad
          </span>
          <video
            key={videoAnuncio.id}
            src={videoAnuncio.url}
            autoPlay
            playsInline
            // Sin `controls` a propósito: no se puede saltar el vídeo — es
            // lo que hace que esto sea un "vídeo recompensado" de verdad en
            // vez de un botón gratis con un vídeo de adorno.
            onEnded={alTerminarVideo}
            style={{ width: '100%', maxWidth: 480, maxHeight: '70vh', borderRadius: 12, background: '#000' }}
          />
          <p style={{ marginTop: 16, fontSize: 12.5, color: S.MUTED_2, textAlign: 'center' }}>
            Consigue {RECARGA_VIDEO_IMPORTE} € al terminar de ver el vídeo.
          </p>
        </div>
      )}
    </main>
  );
}
