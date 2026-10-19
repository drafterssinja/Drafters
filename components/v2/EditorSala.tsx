'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { V2_COLOR } from '@/components/v2/MarcoV2';
import EditorPremio, { PREMIO_VACIO } from '@/components/v2/EditorPremio';
import SelectorJugadores from '@/components/v2/SelectorJugadores';
import { MODALIDAD_DESC, MODALIDAD_LABEL, efectoCambioModalidad, mensajeError, premioValido, type Amistoso, type Modalidad, type Premio } from '@/lib/v2';

// ============================================================================
// EDITAR UN AMISTOSO (admin de la sala, 16/10)
// ============================================================================
// Iñi: "la mesa la has creado para 8 y al final sois 9 amigos: que se pueda
// añadir uno más; cambiar los puestos que puntúan o que pierden". Nombre,
// número de jugadores (antes de empezar y nunca menos de los que ya están),
// privada/contraseña y lo que se juega. Todo lo comprueba amistoso_editar().
// 16/10 (Iñi): también la modalidad (antes de empezar). Si con la nueva algún
// equipo ya hecho deja de valer, se quita y a su dueño le sale un aviso
// (AvisosV2) con la opción de guardarlo para otra sala.

export default function EditorSala({ amistoso, dentro, empezada, conEquipo = 0, onGuardado, onCancelar }: { amistoso: Amistoso; dentro: number; empezada: boolean; conEquipo?: number; onGuardado: () => void; onCancelar: () => void }) {
  const [nombre, setNombre] = useState(amistoso.nombre);
  const [num, setNum] = useState(amistoso.num_jugadores);
  const [privada, setPrivada] = useState(amistoso.privada);
  const [contrasena, setContrasena] = useState('');
  const [premio, setPremio] = useState<Premio>(amistoso.premio ?? PREMIO_VACIO);
  const [modalidad, setModalidad] = useState<Modalidad>(amistoso.modalidad);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    if (!nombre.trim()) return setError('Ponle un nombre a la sala.');
    if (privada && !amistoso.privada && contrasena.trim().length < 3) return setError('Para hacerla privada pon una contraseña de al menos 3 caracteres.');
    const errPremio = premioValido(premio, num);
    if (errPremio) return setError(errPremio);
    const p: Record<string, unknown> = {};
    if (nombre.trim() !== amistoso.nombre) p.nombre = nombre.trim();
    if (num !== amistoso.num_jugadores) p.num_jugadores = num;
    if (privada !== amistoso.privada || contrasena.trim()) {
      p.privada = privada;
      if (contrasena.trim()) p.contrasena = contrasena.trim();
    }
    if (JSON.stringify(premio) !== JSON.stringify(amistoso.premio ?? PREMIO_VACIO)) p.premio = premio.tipo === 'nada' ? null : premio;
    const cambiaModalidad = modalidad !== amistoso.modalidad;
    if (Object.keys(p).length === 0 && !cambiaModalidad) return onCancelar();
    if (cambiaModalidad && conEquipo > 0 && efecto !== 'ninguno') {
      const texto =
        efecto === 'todos'
          ? `${conEquipo === 1 ? 'Hay 1 jugador que ya ha hecho su equipo' : `Hay ${conEquipo} jugadores que ya han hecho su equipo`}. Al pasar a Draft se quitarán los equipos y les avisaremos (podrán guardarlo para otra sala). ¿Cambiar la modalidad?`
          : 'Los equipos que se pasen de 100.000 € se quitarán y avisaremos a sus dueños (podrán guardarlo para otra sala). ¿Cambiar la modalidad?';
      if (!window.confirm(texto)) return;
    }
    setGuardando(true);
    if (cambiaModalidad) {
      const { error: e } = await supabase.rpc('amistoso_cambiar_modalidad', { p_amistoso: amistoso.id, p_modalidad: modalidad });
      if (e) {
        setGuardando(false);
        return setError(mensajeError(e));
      }
    }
    if (Object.keys(p).length > 0) {
      const { error: e } = await supabase.rpc('amistoso_editar', { p_amistoso: amistoso.id, p });
      if (e) {
        setGuardando(false);
        return setError(mensajeError(e));
      }
    }
    setGuardando(false);
    onGuardado();
  }

  const titulo = (t: string) => <span style={S.sectionLabel}>{t}</span>;
  const efecto = efectoCambioModalidad(amistoso.modalidad, modalidad, amistoso.deporte);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, border: `1px solid ${V2_COLOR}`, borderRadius: 14, padding: 14, background: 'rgba(167,139,250,0.05)' }}>
      <span style={{ fontWeight: 800, fontSize: 15, color: V2_COLOR }}>✏️ Editar la sala</span>

      {titulo('Nombre')}
      <input value={nombre} maxLength={40} onChange={(e) => setNombre(e.target.value)} style={S.input} />

      {titulo('Jugadores en la sala')}
      {empezada ? (
        <span style={{ fontSize: 12.5, color: S.MUTED_3 }}>La sala ya ha empezado: el número de jugadores ya no se puede cambiar.</span>
      ) : (
        <>
          <SelectorJugadores valor={num} onChange={setNum} minimo={Math.max(2, dentro)} />
          {dentro > 2 && <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>Ya hay {dentro} dentro: no puede ser menos.</span>}
        </>
      )}

      {titulo('Modalidad')}
      {empezada ? (
        <span style={{ fontSize: 12.5, color: S.MUTED_3 }}>La sala ya ha empezado: la modalidad ya no se puede cambiar.</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['presupuesto', 'libre', 'draft'] as Modalidad[]).map((m) => (
              <button key={m} type="button" style={S.pill(modalidad === m)} onClick={() => setModalidad(m)}>
                {MODALIDAD_LABEL[m]}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 11.5, color: S.MUTED_2, lineHeight: 1.45 }}>{MODALIDAD_DESC[modalidad]}</span>
          {modalidad !== amistoso.modalidad && conEquipo > 0 && (
            <span style={{ fontSize: 12, lineHeight: 1.45, color: efecto === 'ninguno' ? S.ACCENT : '#F0B94D' }}>
              {efecto === 'todos'
                ? `⚠️ ${conEquipo === 1 ? '1 jugador ya ha hecho su equipo' : `${conEquipo} jugadores ya han hecho su equipo`}: se quitarán (los equipos saldrán del draft) y les saldrá un aviso para que puedan guardarlo para otra sala.`
                : efecto === 'caros'
                  ? '⚠️ Los equipos que se pasen de 100.000 € se quitarán y a sus dueños les saldrá un aviso (podrán guardarlo para otra sala).'
                  : efecto === 'mas_de_2'
                    ? '⚠️ Los equipos con más de 2 jugadores de un mismo equipo se quitarán y a sus dueños les saldrá un aviso (podrán guardarlo para otra sala).'
                  : '✓ Los equipos que ya están hechos siguen valiendo. Les avisaremos del cambio.'}
            </span>
          )}
        </div>
      )}

      {titulo('Privacidad')}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" style={S.pill(privada)} onClick={() => setPrivada(true)}>
          🔒 Privada
        </button>
        <button type="button" style={S.pill(!privada)} onClick={() => setPrivada(false)}>
          🌍 Pública
        </button>
      </div>
      {privada && (
        <input value={contrasena} onChange={(e) => setContrasena(e.target.value)} placeholder={amistoso.privada ? 'Nueva contraseña (vacía = la misma)' : 'Contraseña para entrar'} style={S.input} autoComplete="off" />
      )}

      {titulo('Lo que os jugáis')}
      <EditorPremio premio={premio} onChange={setPremio} participantes={num} />

      {error && <p style={S.errorText}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={guardar} disabled={guardando} style={{ ...S.primaryButton, background: V2_COLOR, marginTop: 0, opacity: guardando ? 0.6 : 1 }}>
          {guardando ? 'Guardando...' : 'Guardar cambios'}
        </button>
        <button type="button" onClick={onCancelar} style={S.secondaryLinkButton}>
          Cancelar
        </button>
      </div>
      <span style={{ fontSize: 11, color: S.MUTED_3 }}>Se avisa a todos en el chat de lo que cambies.</span>
    </div>
  );
}
