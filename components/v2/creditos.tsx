'use client';

import Cargando from '@/components/Cargando';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { DEPORTE_NOMBRE, IconoCredito, PelotaDeporte, type DeporteV2 } from '@/components/v2/IconosV2';
import { mensajeError } from '@/lib/v2';

// ============================================================================
// CRÉDITOS DRAFTERS POR DEPORTE (V2, 15/10) — ver SQL 34
// ============================================================================

export type InfoCreditos = { saldo: number; gratis_semana: number; caducan: string };
export type CreditosV2 = Record<DeporteV2, InfoCreditos>;

const EVENTO = 'v2-creditos-cambiados';

export function avisarCambioCreditos() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO));
}

export function useCreditosV2(activo: boolean) {
  const [creditos, setCreditos] = useState<CreditosV2 | null>(null);
  const cargar = useCallback(async () => {
    const { data } = await supabase.rpc('v2_mis_creditos');
    const filas = (data as ({ deporte: DeporteV2 } & InfoCreditos)[]) ?? [];
    if (filas.length === 0) return;
    const r = {} as CreditosV2;
    filas.forEach((f) => (r[f.deporte] = { saldo: f.saldo, gratis_semana: f.gratis_semana, caducan: f.caducan }));
    setCreditos(r);
  }, []);
  useEffect(() => {
    if (!activo) return;
    void cargar();
    const f = () => void cargar();
    window.addEventListener(EVENTO, f);
    return () => window.removeEventListener(EVENTO, f);
  }, [activo, cargar]);
  return { creditos, recargar: cargar };
}

// ---------------------------------------------------------------------------
// Vídeo a pantalla completa: al verlo entero se recargan los créditos que
// faltan para llegar a las 3 mesas del periodo (solo de ese deporte).
// ---------------------------------------------------------------------------
export function RecargaVideo({ deporte, salaId, onCerrar, onRecargado }: { deporte: DeporteV2; salaId?: string | null; onCerrar: () => void; onRecargado?: (saldo: number) => void }) {
  const [video, setVideo] = useState<{ id: string; url: string } | null | 'cargando'>('cargando');
  const [estado, setEstado] = useState<'viendo' | 'ok' | 'error'>('viendo');
  const [mensaje, setMensaje] = useState('');
  const hecho = useRef(false);

  useEffect(() => {
    supabase.rpc('elegir_anuncio_video', { p_ubicacion: 'recarga' }).then(({ data }) => {
      const d = data as { id: string; url: string }[] | null;
      setVideo(d && d.length > 0 ? { id: d[0].id, url: d[0].url } : null);
    });
  }, []);

  async function alTerminar() {
    if (hecho.current || !video || video === 'cargando') return;
    hecho.current = true;
    const { data, error } = await supabase.rpc('v2_recargar_creditos_video', { p_video_id: video.id, p_deporte: deporte, p_sala: salaId ?? null });
    if (error) {
      setEstado('error');
      setMensaje(mensajeError(error));
      return;
    }
    setEstado('ok');
    setMensaje(`Ya tienes ${data} crédito${data === 1 ? '' : 's'} de ${DEPORTE_NOMBRE[deporte].toLowerCase()}.`);
    avisarCambioCreditos();
    onRecargado?.(Number(data));
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.94)', zIndex: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 14 }}>
      <span style={{ position: 'absolute', top: 16, left: 16, fontSize: 11, fontWeight: 700, color: S.MUTED_2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Publicidad</span>
      {video === 'cargando' && <Cargando texto="Buscando vídeo" />}
      {video === null && (
        <>
          <p style={{ color: S.MUTED, textAlign: 'center' }}>Ahora mismo no hay ningún vídeo disponible. Prueba un poco más tarde.</p>
          <button type="button" onClick={onCerrar} style={{ ...S.secondaryLinkButton, maxWidth: 320 }}>
            Cerrar
          </button>
        </>
      )}
      {video && video !== 'cargando' && estado === 'viendo' && (
        <>
          <video key={video.id} src={video.url} autoPlay playsInline onEnded={alTerminar} style={{ width: '100%', maxWidth: 480, maxHeight: '70vh', borderRadius: 12, background: '#000' }} />
          <p style={{ fontSize: 12.5, color: S.MUTED_2, textAlign: 'center' }}>Al terminar el vídeo se recargan tus créditos de {DEPORTE_NOMBRE[deporte].toLowerCase()}.</p>
          <button type="button" onClick={onCerrar} style={{ background: 'none', border: 'none', color: S.MUTED_3, fontSize: 12, textDecoration: 'underline', cursor: 'pointer' }}>
            Salir sin recargar
          </button>
        </>
      )}
      {estado !== 'viendo' && (
        <>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <IconoCredito size={30} />
          </span>
          <p style={{ color: estado === 'ok' ? S.ACCENT : S.ERROR, fontWeight: 700, textAlign: 'center' }}>{mensaje}</p>
          <button type="button" onClick={onCerrar} style={{ ...S.primaryButton, maxWidth: 320 }}>
            Seguir
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ficha de créditos de un deporte (se abre al pulsar el saldo de la cabecera).
// ---------------------------------------------------------------------------
export function FichaCreditos({ deporte, info, onCerrar }: { deporte: DeporteV2; info: InfoCreditos | null; onCerrar: () => void }) {
  const [video, setVideo] = useState(false);
  const caduca = info ? new Date(`${info.caducan}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  const periodo = deporte === 'futbol' ? 'jornada de cada competición (Liga y Champions cuentan aparte)' : 'semana, aunque haya varios torneos a la vez';
  return (
    <>
      <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, zIndex: 250, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: S.PANEL, borderTop: `2px solid ${S.ACCENT}`, borderRadius: '18px 18px 0 0', padding: '20px 20px 30px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <PelotaDeporte deporte={deporte} size={26} />
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, color: S.TEXT }}>Créditos de {DEPORTE_NOMBRE[deporte].toLowerCase()}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <IconoCredito size={28} />
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 40, color: S.ACCENT, lineHeight: 1 }}>{info?.saldo ?? '–'}</span>
            <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>{info ? `caducan el ${caduca}` : ''}</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: S.MUTED, lineHeight: 1.5 }}>
            <li>Cada mesa cuesta 1 crédito.</li>
            <li>
              {deporte === 'futbol' && (info?.gratis_semana ?? 1) > 1
                ? `Esta semana tienes ${info?.gratis_semana} gratis porque hay Champions (normalmente, 1). Caducan el domingo.`
                : `Cada semana tienes 1 gratis${deporte === 'futbol' ? ' (2 las semanas con Champions)' : ''}. Caducan el domingo.`}
            </li>
            <li>Puedes jugar como mucho 3 mesas por {periodo}.</li>
            <li>¿Quieres más? Con un solo vídeo se recargan todos los que te faltan hasta las 3 mesas.</li>
            <li>Los créditos de cada deporte van por separado y nunca se compran.</li>
          </ul>
          <button type="button" onClick={() => setVideo(true)} style={S.primaryButton}>
            ▶ Ver un vídeo y recargar
          </button>
          <button type="button" onClick={onCerrar} style={S.secondaryLinkButton}>
            Cerrar
          </button>
        </div>
      </div>
      {video && <RecargaVideo deporte={deporte} onCerrar={() => setVideo(false)} />}
    </>
  );
}
