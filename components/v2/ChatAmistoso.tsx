'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import EditorPremio, { PREMIO_VACIO } from '@/components/v2/EditorPremio';
import { V2_COLOR } from '@/components/v2/MarcoV2';
import TiraPuestos from '@/components/v2/TiraPuestos';
import { mensajeError, premioValido, repartoEquitativoGP, resumenPremio, type Mensaje, type Premio } from '@/lib/v2';

type Voto = { mensaje_id: number; usuario_id: string; acepta: boolean };

// Chat de la sala + propuestas de "nos jugamos algo" (las tienen que aceptar
// todos los que están en la sala; si uno dice que no, se cae).
export default function ChatAmistoso({
  amistosoId,
  miId,
  nombres,
  participantes,
  mensajes,
  votos,
  onCambio,
  abrirPropuesta = false,
}: {
  amistosoId: string;
  miId: string;
  nombres: Record<string, string>;
  participantes: number;
  mensajes: Mensaje[];
  votos: Voto[];
  onCambio: () => void;
  // 16/10: abrir directamente el menú de "proponer lo que nos jugamos".
  abrirPropuesta?: boolean;
}) {
  const [texto, setTexto] = useState('');
  const [proponiendo, setProponiendo] = useState(abrirPropuesta);
  // 16/10 (Iñi): el que propone elige en el menú si es dinero, una cena u otra
  // cosa, quiénes ganan y quiénes pierden; los demás aceptan o no.
  const [propuesta, setPropuesta] = useState<Premio>({ ...PREMIO_VACIO, tipo: 'dinero', ganan: 1, pagan: 1, aportacion: 5, ...repartoEquitativoGP(1, 1, 5) });
  useEffect(() => {
    if (abrirPropuesta) setProponiendo(true);
  }, [abrirPropuesta]);
  const [error, setError] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement | null>(null);
  const ultimo = mensajes[mensajes.length - 1]?.id;

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: 'end' });
  }, [ultimo]);

  async function enviar() {
    const t = texto.trim();
    if (!t) return;
    setTexto('');
    const { error: e } = await supabase.rpc('amistoso_mensaje', { p_amistoso: amistosoId, p_texto: t });
    if (e) setError(mensajeError(e));
    onCambio();
  }

  async function proponer() {
    setError(null);
    const err = premioValido(propuesta, participantes);
    if (err) return setError(err);
    if (propuesta.tipo === 'nada') return setError('Elige dinero u otra cosa.');
    const { error: e } = await supabase.rpc('amistoso_proponer_premio', { p_amistoso: amistosoId, p_premio: propuesta });
    if (e) return setError(mensajeError(e));
    setProponiendo(false);
    onCambio();
  }

  async function votar(id: number, acepta: boolean) {
    const { error: e } = await supabase.rpc('amistoso_votar_propuesta', { p_mensaje: id, p_acepta: acepta });
    if (e) setError(mensajeError(e));
    onCambio();
  }

  const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '55vh', overflowY: 'auto', padding: '4px 2px' }}>
        {mensajes.length === 0 && <p style={{ fontSize: 13, color: S.MUTED_3 }}>Todavía no hay mensajes.</p>}
        {mensajes.map((m) => {
          if (m.tipo === 'sistema')
            return (
              <div key={m.id} style={{ alignSelf: 'center', fontSize: 11.5, color: S.MUTED_2, background: 'rgba(255,255,255,0.04)', borderRadius: 999, padding: '4px 12px', textAlign: 'center' }}>
                {m.texto}
                {m.datos ? ` · ${resumenPremio(m.datos)}` : ''}
              </div>
            );
          const mio = m.usuario_id === miId;
          const autor = m.usuario_id ? nombres[m.usuario_id] ?? 'Alguien' : 'Alguien';
          if (m.tipo === 'propuesta') {
            const vs = votos.filter((v) => v.mensaje_id === m.id);
            const si = vs.filter((v) => v.acepta).map((v) => nombres[v.usuario_id] ?? '?');
            const miVoto = vs.find((v) => v.usuario_id === miId);
            return (
              <div key={m.id} style={{ border: `1px solid ${V2_COLOR}`, borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 6, background: 'rgba(167,139,250,0.06)' }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: V2_COLOR }}>🤝 @{autor} propone jugarse algo</span>
                {m.datos && m.datos.tipo !== 'nada' ? <TiraPuestos premio={m.datos} participantes={participantes} /> : <span style={{ fontSize: 13.5, color: S.TEXT, fontWeight: 600 }}>{resumenPremio(m.datos)}</span>}
                <span style={{ fontSize: 11.5, color: S.MUTED_2 }}>
                  {m.estado === 'pendiente' && `Aceptan ${si.length} de ${participantes}: ${si.join(', ')}`}
                  {m.estado === 'aceptada' && '✅ Aceptada por todos: es lo que se juega la sala.'}
                  {m.estado === 'rechazada' &&
                    (() => {
                      const no = vs.filter((v) => !v.acepta).map((v) => '@' + (nombres[v.usuario_id] ?? '?'));
                      return no.length ? `❌ ${no.join(', ')} ha dicho que no. Hablad en el chat cómo queréis jugároslo y que alguien haga otra propuesta.` : '❌ Ya no vale (se aceptó otra propuesta).';
                    })()}
                </span>
                {m.estado === 'pendiente' && !(miVoto && miVoto.acepta) && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => votar(m.id, true)} style={{ ...S.primaryButton, background: V2_COLOR, marginTop: 0, minHeight: 36, padding: 8, fontSize: 14 }}>
                      Acepto
                    </button>
                    <button type="button" onClick={() => votar(m.id, false)} style={{ ...S.secondaryLinkButton, minHeight: 36, padding: 8 }}>
                      No
                    </button>
                  </div>
                )}
              </div>
            );
          }
          return (
            <div key={m.id} style={{ alignSelf: mio ? 'flex-end' : 'flex-start', maxWidth: '82%', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {!mio && <span style={{ fontSize: 10.5, color: V2_COLOR, fontWeight: 700, paddingLeft: 4 }}>@{autor}</span>}
              <div style={{ background: mio ? 'rgba(61,220,132,0.14)' : S.PANEL, border: `1px solid ${mio ? 'rgba(61,220,132,0.3)' : S.CARD_BORDER}`, borderRadius: 14, padding: '8px 12px', fontSize: 13.5, color: S.TEXT, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {m.texto}
              </div>
              <span style={{ fontSize: 10, color: S.FAINT, alignSelf: mio ? 'flex-end' : 'flex-start', padding: '0 4px' }}>{hora(m.created_at)}</span>
            </div>
          );
        })}
        <div ref={finRef} />
      </div>

      {error && <p style={S.errorText}>{error}</p>}

      {proponiendo ? (
        <div style={{ border: `1px solid ${S.BORDER}`, borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={S.sectionLabel}>Propón lo que os jugáis</span>
          <span style={{ fontSize: 12, color: S.MUTED_2, marginTop: -4 }}>Elige si es dinero, una cena u otra cosa, y quiénes ganan y quiénes pierden. Todos los de la sala tienen que aceptarlo.</span>
          <EditorPremio premio={propuesta} onChange={setPropuesta} participantes={participantes} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={proponer} style={{ ...S.primaryButton, background: V2_COLOR, marginTop: 0 }}>
              Proponer
            </button>
            <button type="button" onClick={() => setProponiendo(false)} style={S.secondaryLinkButton}>
              Cancelar
            </button>
          </div>
          <span style={{ fontSize: 11, color: S.MUTED_3 }}>Si todos los de la sala aceptan, pasa a ser lo que se juega. Drafters no cobra ni paga nada: solo calcula cuánto le toca a cada uno.</span>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void enviar();
              }}
              maxLength={500}
              placeholder="Escribe un mensaje..."
              style={{ ...S.input, flex: 1 }}
            />
            <button type="button" onClick={enviar} style={{ ...S.primaryButton, width: 'auto', marginTop: 0, padding: '0 16px' }}>
              Enviar
            </button>
          </div>
          <button type="button" onClick={() => setProponiendo(true)} style={{ ...S.secondaryLinkButton, borderColor: V2_COLOR, color: V2_COLOR }}>
            🤝 Proponer lo que nos jugamos
          </button>
        </>
      )}
    </div>
  );
}
