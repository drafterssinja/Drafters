'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { MODALIDAD_LABEL, cadaXSegundos, mensajeError, type AvisoModalidad } from '@/lib/v2';

// ============================================================================
// AVISO: "HA CAMBIADO LA MODALIDAD DE TU SALA" (16/10, Iñi)
// ============================================================================
// Sale en cualquier pantalla de V2 al que tenía equipo hecho en un amistoso
// cuyo admin ha cambiado la modalidad. Si su equipo ya no vale (se ha quitado),
// se le dice qué tiene que hacer ahora (equipo nuevo o draft) y se le pregunta
// si quiere guardar el equipo para usarlo en otra sala.

type Nombres = Record<string, string>;
// (el mismo morado de V2; aquí sin importar de MarcoV2, que es quien pinta este aviso)
const V2_COLOR = '#A78BFA';

export default function AvisosV2() {
  const router = useRouter();
  const pathname = usePathname();
  const [avisos, setAvisos] = useState<AvisoModalidad[]>([]);
  const [nombres, setNombres] = useState<Nombres>({});
  const [paso, setPaso] = useState<'pregunta' | 'guardado' | 'descartado'>('pregunta');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from('amistoso_avisos')
      .select('id,amistoso_id,modalidad_antes,modalidad_nueva,equipo_borrado,equipos,created_at,amistosos(nombre,deporte,modalidad)')
      .eq('visto', false)
      .order('id');
    const lista = ((data as unknown as AvisoModalidad[]) ?? []).map((a) => ({ ...a, amistosos: Array.isArray(a.amistosos) ? (a.amistosos[0] ?? null) : a.amistosos }));
    setAvisos((prev) => (paso !== 'pregunta' && prev[0] ? [prev[0], ...lista.filter((x) => x.id !== prev[0].id)] : lista));
  }, [paso]);

  useEffect(() => {
    void cargar();
    return cadaXSegundos(cargar, 20);
  }, [cargar]);

  const aviso = avisos[0] ?? null;

  // Nombres de los jugadores del equipo que se ha quitado.
  useEffect(() => {
    const ids = (aviso?.equipos ?? []).flatMap((e) => e.jugadores).filter((x) => !nombres[x]);
    if (ids.length === 0) return;
    void (async () => {
      const { data } = await supabase.from('jugadores').select('id,nombre').in('id', ids);
      const n: Nombres = {};
      ((data as { id: string; nombre: string }[]) ?? []).forEach((j) => (n[j.id] = j.nombre));
      setNombres((prev) => ({ ...prev, ...n }));
    })();
  }, [aviso, nombres]);

  if (!aviso) return null;

  const sala = aviso.amistosos?.nombre ?? 'tu sala';
  const ahora = aviso.amistosos?.modalidad ?? aviso.modalidad_nueva ?? 'presupuesto';
  const enLaSala = pathname === `/v2/sala/${aviso.amistoso_id}`;

  async function responder(guardar: boolean) {
    if (!aviso) return;
    setError(null);
    setEnviando(true);
    const { error: e } = await supabase.rpc('amistoso_aviso_responder', { p_aviso: aviso.id, p_guardar: guardar });
    setEnviando(false);
    if (e) return setError(mensajeError(e));
    if (!aviso.equipo_borrado) return siguiente();
    setPaso(guardar ? 'guardado' : 'descartado');
  }

  function siguiente(destino?: string) {
    setPaso('pregunta');
    setAvisos((prev) => prev.slice(1));
    if (destino && destino !== pathname) router.push(destino);
  }

  const queHacer =
    ahora === 'draft'
      ? 'Ahora los equipos se hacen en un draft por turnos: entra en la sala para el sorteo del orden cuando estéis todos.'
      : ahora === 'presupuesto'
        ? 'Tu equipo se pasaba de los 100.000 € de presupuesto: tienes que hacer uno nuevo antes de que empiece la jornada.'
        : 'Tienes que hacer un equipo nuevo antes de que empiece la jornada.';

  const boton = (texto: string, onClick: () => void, principal = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={enviando}
      style={{
        flex: 1,
        borderRadius: 12,
        padding: '13px 14px',
        fontSize: 14,
        fontWeight: 800,
        cursor: 'pointer',
        border: principal ? 'none' : `1px solid ${S.BORDER}`,
        background: principal ? V2_COLOR : 'transparent',
        color: principal ? '#120B24' : S.TEXT,
        opacity: enviando ? 0.6 : 1,
      }}
    >
      {texto}
    </button>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" style={{ width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto', background: S.PANEL, border: `1px solid ${V2_COLOR}`, borderRadius: 18, padding: 20, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <span style={{ fontSize: 30, lineHeight: 1 }}>{aviso.equipo_borrado ? '⚠️' : '🔄'}</span>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 24, color: S.TEXT, lineHeight: 1.1 }}>Ha cambiado la modalidad</span>
        <span style={{ fontSize: 14, color: S.MUTED, lineHeight: 1.5 }}>
          En <b style={{ color: S.TEXT }}>{sala}</b> el administrador ha cambiado la modalidad
          {aviso.modalidad_antes && aviso.modalidad_antes !== ahora ? ` de ${MODALIDAD_LABEL[aviso.modalidad_antes]}` : ''}: ahora es <b style={{ color: V2_COLOR }}>{MODALIDAD_LABEL[ahora]}</b>.
        </span>

        {!aviso.equipo_borrado ? (
          <>
            <span style={{ fontSize: 13.5, color: S.ACCENT, lineHeight: 1.5 }}>✓ Tu equipo sigue valiendo. Si quieres, puedes cambiarlo hasta que empiece la jornada.</span>
            {error && <p style={S.errorText}>{error}</p>}
            <div style={{ display: 'flex', gap: 8 }}>{boton('Entendido', () => void responder(false), true)}</div>
          </>
        ) : paso === 'pregunta' ? (
          <>
            <div style={{ background: 'rgba(255,92,92,0.08)', border: '1px solid rgba(255,92,92,0.35)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: '#FF8A8A' }}>Tu equipo ya no está en la sala</span>
              {(aviso.equipos ?? []).map((e) => (
                <div key={e.competicion} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#F0B94D', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {e.competicion}
                    {e.alineacion ? ` · ${e.alineacion}` : ''}
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {e.jugadores.map((j) => (
                      <span key={j} style={{ fontSize: 11, color: S.MUTED, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 999, padding: '2px 8px' }}>
                        {nombres[j] ?? '…'}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <span style={{ fontSize: 13.5, color: S.MUTED, lineHeight: 1.5 }}>{queHacer}</span>
            <span style={{ fontSize: 14.5, fontWeight: 800, color: S.TEXT }}>¿Quieres guardar tu equipo para usarlo en otra sala?</span>
            {error && <p style={S.errorText}>{error}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              {boton('No, gracias', () => void responder(false))}
              {boton('💾 Sí, guardarlo', () => void responder(true), true)}
            </div>
          </>
        ) : (
          <>
            {paso === 'guardado' && (
              <span style={{ fontSize: 13.5, color: S.ACCENT, lineHeight: 1.5 }}>✓ Equipo guardado. Cuando hagas tu equipo en otra sala, pulsa «Usar un equipo guardado».</span>
            )}
            <span style={{ fontSize: 13.5, color: S.MUTED, lineHeight: 1.5 }}>{queHacer}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {boton('Cerrar', () => siguiente())}
              {ahora === 'draft' || !aviso.equipos?.[0]
                ? boton(enLaSala ? 'Entendido' : 'Ir a la sala', () => siguiente(`/v2/sala/${aviso.amistoso_id}`), true)
                : boton('Hacer equipo nuevo', () => siguiente(`/v2/sala/${aviso.amistoso_id}/equipo?c=${encodeURIComponent(aviso.equipos![0].competicion)}`), true)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
