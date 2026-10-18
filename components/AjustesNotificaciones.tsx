'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { TIPOS_PUSH, activarPush, desactivarPush, estadoPush, guardarTiposPush, leerTiposPush, type EstadoPush, type TipoPush } from '@/lib/push';

// ============================================================================
// AJUSTES DE NOTIFICACIONES PUSH (18/10, Iñi)
// ============================================================================
// Interruptor para activar / desactivar las notificaciones en este dispositivo
// y qué tipos quieres recibir. Se usa en "Mi cuenta" y en la campana de la
// clasificación de las mesas.
export default function AjustesNotificaciones({ compacto = false }: { compacto?: boolean }) {
  const [uid, setUid] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoPush | null>(null);
  const [tipos, setTipos] = useState<TipoPush[]>([]);
  const [activo, setActivo] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<{ texto: string; ok: boolean } | null>(null);

  useEffect(() => {
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      setUid(session.user.id);
      const [e, p] = await Promise.all([estadoPush(), leerTiposPush(session.user.id)]);
      setEstado(e);
      setTipos(p.tipos);
      setActivo(p.activo);
    })();
  }, []);

  const encendido = estado === 'activo' && activo;

  async function alternar() {
    if (!uid) return;
    setOcupado(true);
    setMensaje(null);
    if (encendido) {
      await desactivarPush();
      await guardarTiposPush(uid, false, tipos);
      setActivo(false);
      setEstado(await estadoPush());
      setMensaje({ texto: 'Notificaciones desactivadas en este dispositivo.', ok: true });
    } else {
      const r = await activarPush();
      if (r.ok) {
        await guardarTiposPush(uid, true, tipos);
        setActivo(true);
        setMensaje({ texto: '¡Listo! Te avisaremos aquí.', ok: true });
      } else setMensaje({ texto: r.error ?? 'No se han podido activar.', ok: false });
      setEstado(await estadoPush());
    }
    setOcupado(false);
  }

  async function alternarTipo(t: TipoPush) {
    if (!uid) return;
    const nuevos = tipos.includes(t) ? tipos.filter((x) => x !== t) : [...tipos, t];
    setTipos(nuevos);
    if (!(await guardarTiposPush(uid, activo, nuevos))) setMensaje({ texto: 'No se ha podido guardar.', ok: false });
  }

  if (estado === null) return <span style={{ fontSize: 12.5, color: S.MUTED_3 }}>Cargando...</span>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compacto ? 10 : 12 }}>
      <button
        type="button"
        disabled={ocupado || estado === 'no_soportado'}
        onClick={() => void alternar()}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 12, cursor: 'pointer', border: `1px solid ${encendido ? 'rgba(61,220,132,0.5)' : S.BORDER}`, background: encendido ? 'rgba(61,220,132,0.1)' : 'transparent', textAlign: 'left' }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontWeight: 800, fontSize: 14, color: S.TEXT }}>{encendido ? '🔔 Notificaciones activadas' : '🔕 Notificaciones desactivadas'}</span>
          <span style={{ fontSize: 11.5, color: S.MUTED_2 }}>
            {estado === 'ios_sin_instalar'
              ? 'En iPhone primero instala la app (Compartir → Añadir a pantalla de inicio).'
              : estado === 'denegado'
                ? 'Están bloqueadas en los ajustes del navegador.'
                : estado === 'no_soportado'
                  ? 'Este navegador no admite notificaciones.'
                  : 'En este dispositivo.'}
          </span>
        </span>
        <span style={{ flexShrink: 0, width: 46, height: 26, borderRadius: 999, background: encendido ? S.ACCENT : '#2A3733', position: 'relative', transition: 'background 0.2s' }}>
          <span style={{ position: 'absolute', top: 3, left: encendido ? 23 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
        </span>
      </button>
      {mensaje && <span style={{ fontSize: 12, fontWeight: 700, color: mensaje.ok ? S.ACCENT : S.ERROR }}>{mensaje.texto}</span>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, opacity: encendido ? 1 : 0.5 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: S.MUTED_3 }}>¿Qué quieres recibir?</span>
        {TIPOS_PUSH.map((t) => {
          const on = tipos.includes(t.tipo);
          return (
            <label key={t.tipo} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={on} onChange={() => void alternarTipo(t.tipo)} style={{ accentColor: '#3DDC84', width: 18, height: 18, marginTop: 1, flexShrink: 0 }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: S.TEXT }}>{t.titulo}</span>
                {!compacto && <span style={{ fontSize: 11.5, color: S.MUTED_2 }}>{t.desc}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// Botón grande de la campana (clasificación) que abre los ajustes.
export function BotonNotificaciones({ extra }: { extra?: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 999, border: '1px solid rgba(240,185,77,0.5)', background: 'rgba(240,185,77,0.12)', color: '#F0B94D', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, textTransform: 'uppercase', letterSpacing: '0.03em', cursor: 'pointer', width: 'auto' }}
      >
        <span style={{ fontSize: 18 }}>🔔</span> Avisos
      </button>
      {abierto && (
        <div onClick={() => setAbierto(false)} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(4,8,6,0.8)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, maxHeight: '88vh', overflowY: 'auto', background: '#0F1513', border: `1px solid ${S.CARD_BORDER}`, borderRadius: '18px 18px 0 0', padding: '18px 18px 26px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, color: S.TEXT }}>🔔 Avisos y notificaciones</span>
              <button type="button" onClick={() => setAbierto(false)} style={{ width: 'auto', background: 'transparent', border: 'none', color: S.MUTED_2, fontSize: 20, cursor: 'pointer' }}>
                ✕
              </button>
            </div>
            {extra}
            <AjustesNotificaciones compacto />
          </div>
        </div>
      )}
    </>
  );
}
