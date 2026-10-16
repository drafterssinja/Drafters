'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import MarcoSimple, { usePerfil } from '@/components/MarcoSimple';
import Cargando from '@/components/Cargando';
import type { FilaAmigo } from '@/lib/amigos';

// ============================================================================
// GESTOR DE AMIGOS (16/10, Iñi) — desde "Mi perfil"
// ============================================================================
// Buscar usuarios y mandarles solicitud, aceptar/rechazar las que te llegan,
// ver tu lista de amigos (y entrar en su perfil) y elegir qué ven ellos de ti.

type Busqueda = { usuario_id: string; nombre_usuario: string; nombre: string; estado: 'pendiente' | 'aceptada' | null; soy_solicitante: boolean | null };
type Privacidad = { ver_resumen: boolean; ver_en_juego: boolean; ver_historial: boolean; permitir_invitaciones: boolean };

const OPCIONES: { clave: keyof Privacidad; titulo: string; desc: string }[] = [
  { clave: 'ver_resumen', titulo: 'Resumen de resultados', desc: 'Mesas jugadas, premios, victorias, amistosos y cómo vas en la liga.' },
  { clave: 'ver_en_juego', titulo: 'Mis salas en juego', desc: 'En qué mesas, porras y amistosos estás ahora.' },
  { clave: 'ver_historial', titulo: 'Historial reciente', desc: 'Tus últimas mesas terminadas y en qué puesto quedaste.' },
  { clave: 'permitir_invitaciones', titulo: 'Que me inviten a salas', desc: 'Tus amigos pueden mandarte invitaciones a sus amistosos.' },
];

export default function AmigosPage() {
  const perfil = usePerfil();
  const [lista, setLista] = useState<FilaAmigo[] | null>(null);
  const [priv, setPriv] = useState<Privacidad | null>(null);
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<Busqueda[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const [{ data: l }, { data: p }] = await Promise.all([supabase.rpc('amigos_lista'), supabase.rpc('amigos_mi_privacidad')]);
    setLista((l as FilaAmigo[]) ?? []);
    setPriv((p as Privacidad) ?? { ver_resumen: true, ver_en_juego: true, ver_historial: true, permitir_invitaciones: true });
  }, []);

  useEffect(() => {
    if (perfil) void cargar();
  }, [perfil, cargar]);

  // Búsqueda mientras escribes (desde 2 letras).
  useEffect(() => {
    const t = texto.trim();
    if (t.length < 2) {
      setResultados(null);
      return;
    }
    setBuscando(true);
    const id = setTimeout(async () => {
      const { data } = await supabase.rpc('amigos_buscar', { p_texto: t });
      setResultados((data as Busqueda[]) ?? []);
      setBuscando(false);
    }, 300);
    return () => clearTimeout(id);
  }, [texto]);

  async function accion(fn: () => PromiseLike<{ error: { message: string } | null; data?: unknown }>, ok?: string) {
    setError(null);
    setAviso(null);
    const { error: e } = await fn();
    if (e) return setError(e.message.replace(/^ERROR:\s*/i, ''));
    if (ok) setAviso(ok);
    await cargar();
    if (texto.trim().length >= 2) {
      const { data } = await supabase.rpc('amigos_buscar', { p_texto: texto.trim() });
      setResultados((data as Busqueda[]) ?? []);
    }
  }

  async function cambiarPrivacidad(clave: keyof Privacidad, valor: boolean) {
    if (!priv) return;
    const nueva = { ...priv, [clave]: valor };
    setPriv(nueva);
    const { error: e } = await supabase.rpc('amigos_guardar_privacidad', {
      p_resumen: nueva.ver_resumen,
      p_en_juego: nueva.ver_en_juego,
      p_historial: nueva.ver_historial,
      p_invitaciones: nueva.permitir_invitaciones,
    });
    if (e) setError(e.message);
  }

  const amigos = (lista ?? []).filter((f) => f.estado === 'aceptada');
  const recibidas = (lista ?? []).filter((f) => f.estado === 'pendiente' && f.recibida);
  const enviadas = (lista ?? []).filter((f) => f.estado === 'pendiente' && !f.recibida);

  const boton = (texto: string, onClick: () => void, principal = false, peligro = false): JSX.Element => (
    <button
      type="button"
      onClick={onClick}
      style={{
        flexShrink: 0,
        width: 'auto',
        borderRadius: 9,
        padding: '7px 12px',
        fontSize: 12.5,
        fontWeight: 800,
        cursor: 'pointer',
        border: principal ? 'none' : `1px solid ${peligro ? 'rgba(255,92,92,0.45)' : S.BORDER}`,
        background: principal ? S.ACCENT : 'transparent',
        color: principal ? '#04140B' : peligro ? '#FF8A8A' : S.TEXT,
      }}
    >
      {texto}
    </button>
  );

  const avatar = (nombre: string) => (
    <span style={{ flexShrink: 0, width: 34, height: 34, borderRadius: '50%', background: 'rgba(122,167,255,0.16)', color: '#7AA7FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14 }}>{nombre.slice(0, 1).toUpperCase()}</span>
  );

  const fila = (children: React.ReactNode, key: string) => (
    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: `1px solid ${S.CARD_BORDER}` }}>
      {children}
    </div>
  );

  return (
    <MarcoSimple perfil={perfil} cargando={lista === null} volverA="/cuenta">
      <h1 style={{ fontSize: 26, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>👥 Amigos</h1>
      {error && <p style={S.errorText}>{error}</p>}
      {aviso && <p style={{ ...S.infoText, fontSize: 13 }}>{aviso}</p>}

      {/* Buscar */}
      <div style={{ ...S.card, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
        <span style={S.sectionLabel}>Añadir un amigo</span>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="🔍 Busca por nombre de usuario" style={S.input} autoCapitalize="none" autoCorrect="off" />
        {buscando && <Cargando compacto />}
        {!buscando && resultados && resultados.length === 0 && <span style={{ fontSize: 12.5, color: S.MUTED_3 }}>No hay nadie con ese nombre de usuario.</span>}
        {!buscando &&
          resultados?.map((r) =>
            fila(
              <>
                {avatar(r.nombre_usuario)}
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: S.TEXT }}>@{r.nombre_usuario}</span>
                  {r.nombre && <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>{r.nombre}</span>}
                </span>
                {r.estado === 'aceptada' ? (
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#7AA7FF' }}>✓ Amigos</span>
                ) : r.estado === 'pendiente' && r.soy_solicitante ? (
                  <span style={{ fontSize: 12, color: S.MUTED_2 }}>Solicitud enviada</span>
                ) : r.estado === 'pendiente' ? (
                  boton('Aceptar', () => void accion(() => supabase.rpc('amigos_responder', { p_usuario: r.usuario_id, p_acepta: true }), `Ya eres amigo de @${r.nombre_usuario}.`), true)
                ) : (
                  boton('+ Añadir', () => void accion(() => supabase.rpc('amigos_solicitar', { p_usuario: r.usuario_id }), `Solicitud enviada a @${r.nombre_usuario}.`), true)
                )}
              </>,
              r.usuario_id
            )
          )}
      </div>

      {/* Solicitudes recibidas */}
      {recibidas.length > 0 && (
        <div style={{ ...S.card, flexDirection: 'column', alignItems: 'stretch', gap: 4, borderColor: 'rgba(122,167,255,0.5)' }}>
          <span style={{ ...S.sectionLabel, color: '#7AA7FF' }}>Solicitudes de amistad ({recibidas.length})</span>
          {recibidas.map((f) =>
            fila(
              <>
                {avatar(f.nombre_usuario)}
                <span style={{ flex: 1, fontWeight: 700, fontSize: 14, color: S.TEXT }}>@{f.nombre_usuario}</span>
                {boton('Aceptar', () => void accion(() => supabase.rpc('amigos_responder', { p_usuario: f.usuario_id, p_acepta: true }), `Ya eres amigo de @${f.nombre_usuario}.`), true)}
                {boton('No', () => void accion(() => supabase.rpc('amigos_responder', { p_usuario: f.usuario_id, p_acepta: false })))}
              </>,
              f.usuario_id
            )
          )}
        </div>
      )}

      {/* Mis amigos */}
      <div style={{ ...S.card, flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
        <span style={S.sectionLabel}>Mis amigos ({amigos.length})</span>
        {amigos.length === 0 && <span style={{ fontSize: 13, color: S.MUTED_3 }}>Todavía no tienes amigos en Drafters. Búscalos arriba por su nombre de usuario.</span>}
        {amigos.map((f) =>
          fila(
            <>
              {avatar(f.nombre_usuario)}
              <Link href={`/amigos/${f.usuario_id}`} style={{ flex: 1, minWidth: 0, textDecoration: 'none', display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: S.TEXT }}>@{f.nombre_usuario}</span>
                <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>Ver su perfil y estadísticas ›</span>
              </Link>
              {boton('Quitar', () => {
                if (window.confirm(`¿Quitar a @${f.nombre_usuario} de tus amigos?`)) void accion(() => supabase.rpc('amigos_quitar', { p_usuario: f.usuario_id }));
              }, false, true)}
            </>,
            f.usuario_id
          )
        )}
        {enviadas.length > 0 && (
          <>
            <span style={{ ...S.sectionLabel, marginTop: 10 }}>Esperando respuesta ({enviadas.length})</span>
            {enviadas.map((f) =>
              fila(
                <>
                  {avatar(f.nombre_usuario)}
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5, color: S.MUTED }}>@{f.nombre_usuario}</span>
                  {boton('Cancelar', () => void accion(() => supabase.rpc('amigos_quitar', { p_usuario: f.usuario_id })))}
                </>,
                f.usuario_id
              )
            )}
          </>
        )}
      </div>

      {/* Privacidad */}
      {priv && (
        <div style={{ ...S.card, flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <span style={S.sectionLabel}>Lo que ven tus amigos de ti</span>
          {OPCIONES.map((o) => (
            <div key={o.clave} onClick={() => void cambiarPrivacidad(o.clave, !priv[o.clave])} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: `1px solid ${S.CARD_BORDER}`, cursor: 'pointer' }}>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: S.TEXT }}>{o.titulo}</span>
                <span style={{ fontSize: 12, color: S.MUTED_2 }}>{o.desc}</span>
              </span>
              <span
                role="switch"
                aria-checked={priv[o.clave]}
                style={{ flexShrink: 0, width: 46, height: 26, borderRadius: 999, background: priv[o.clave] ? S.ACCENT : '#2A3733', position: 'relative', transition: 'background .15s' }}
              >
                <span style={{ position: 'absolute', top: 3, left: priv[o.clave] ? 23 : 3, width: 20, height: 20, borderRadius: '50%', background: '#F5F7F5', transition: 'left .15s' }} />
              </span>
            </div>
          ))}
          <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>Solo lo ven tus amigos. El resto de usuarios no ve nada de esto.</span>
        </div>
      )}
    </MarcoSimple>
  );
}
