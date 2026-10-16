'use client';

import Cargando from '@/components/Cargando';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import MarcoSimple, { usePerfil } from '@/components/MarcoSimple';
import ResumenClasificacionMesa from '@/components/ResumenClasificacionMesa';
import { DEPORTE_NOMBRE, PelotaDeporte, type DeporteV2 } from '@/components/v2/IconosV2';
import { fechaCorta } from '@/lib/v2';
import type { PerfilAmigo } from '@/lib/amigos';

// ============================================================================
// PERFIL DE UN AMIGO (16/10, Iñi)
// ============================================================================
// Lo que tu amigo deja ver (lo elige él en su gestor de amigos): resumen de
// resultados y liga, sus salas en juego, su historial reciente; y un botón
// para invitarle a uno de tus amistosos.

type MiSala = { id: string; nombre: string; deporte: string; soy_participante: boolean; empezada?: boolean; estado: string; inscritos: number; num_jugadores: number; privada: boolean };

function Bloqueado({ nombre, que }: { nombre: string; que: string }) {
  return <span style={{ fontSize: 13, color: S.MUTED_3 }}>🔒 @{nombre} no comparte {que}.</span>;
}

export default function PerfilAmigoPage() {
  const { id } = useParams<{ id: string }>();
  const perfil = usePerfil();
  const [datos, setDatos] = useState<PerfilAmigo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [misSalas, setMisSalas] = useState<MiSala[] | null>(null);
  const [invitando, setInvitando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('amigo_perfil', { p_usuario: id });
    if (e) return setError(e.message.replace(/^ERROR:\s*/i, ''));
    setDatos(data as PerfilAmigo);
  }, [id]);

  useEffect(() => {
    if (perfil) void cargar();
  }, [perfil, cargar]);

  async function abrirInvitar() {
    setInvitando(true);
    setAviso(null);
    const { data } = await supabase.rpc('amistosos_v2_lista');
    setMisSalas(((data as MiSala[]) ?? []).filter((s) => s.soy_participante && !s.empezada && s.estado === 'abierto'));
  }

  async function invitar(s: MiSala) {
    setAviso(null);
    const { error: e } = await supabase.rpc('amistoso_invitar', { p_amistoso: s.id, p_usuario: id });
    if (e) return setAviso(`❌ ${e.message.replace(/^ERROR:\s*/i, '')}`);
    setAviso(`✓ Invitación enviada a @${datos?.nombre_usuario} para «${s.nombre}»${s.privada ? '. Pásale la contraseña.' : '.'}`);
    setInvitando(false);
  }

  const n = datos?.nombre_usuario ?? '';
  const tarjeta = (titulo: string, children: React.ReactNode) => (
    <div style={{ ...S.card, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <span style={S.sectionLabel}>{titulo}</span>
      {children}
    </div>
  );
  const cifra = (valor: number, etiqueta: string, color: string = S.TEXT) => (
    <div style={{ flex: '1 1 30%', minWidth: 90, background: 'rgba(255,255,255,0.03)', border: `1px solid ${S.CARD_BORDER}`, borderRadius: 10, padding: '10px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 26, color, lineHeight: 1 }}>{valor}</span>
      <span style={{ fontSize: 11, color: S.MUTED_2, textAlign: 'center' }}>{etiqueta}</span>
    </div>
  );

  return (
    <MarcoSimple perfil={perfil} cargando={!datos && !error} volverA="/amigos">
      {error ? (
        <>
          <p style={S.errorText}>{error}</p>
          <Link href="/amigos" style={{ ...S.secondaryLinkButton, textAlign: 'center', textDecoration: 'none' }}>
            Volver a mis amigos
          </Link>
        </>
      ) : datos ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(122,167,255,0.16)', color: '#7AA7FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 24 }}>{n.slice(0, 1).toUpperCase()}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 28, color: S.TEXT, lineHeight: 1 }}>@{n}</span>
              <span style={{ fontSize: 12, color: '#7AA7FF', fontWeight: 700 }}>👥 Amigos{datos.amigos_desde ? ` desde el ${new Date(datos.amigos_desde).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</span>
            </div>
          </div>

          {/* Invitar */}
          {datos.privacidad.invitaciones && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!invitando ? (
                <button type="button" onClick={() => void abrirInvitar()} style={{ ...S.primaryButton, marginTop: 0 }}>
                  ✉️ Invitar a @{n} a una sala
                </button>
              ) : (
                tarjeta(
                  'Invitar a una de tus salas',
                  misSalas === null ? (
                    <Cargando compacto />
                  ) : misSalas.length === 0 ? (
                    <span style={{ fontSize: 13, color: S.MUTED_3 }}>No estás en ningún amistoso abierto. Crea uno o entra en alguno y vuelve a invitarle.</span>
                  ) : (
                    <>
                      {misSalas.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => void invitar(s)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: 'transparent', border: `1px solid ${S.CARD_BORDER}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer' }}
                        >
                          {(s.deporte === 'futbol' || s.deporte === 'golf' || s.deporte === 'tenis') && <PelotaDeporte deporte={s.deporte as DeporteV2} size={20} />}
                          <span style={{ flex: 1, fontWeight: 700, fontSize: 14, color: S.TEXT }}>
                            {s.privada ? '🔒 ' : ''}
                            {s.nombre}
                          </span>
                          <span style={{ fontSize: 12, color: S.MUTED_2 }}>
                            {s.inscritos}/{s.num_jugadores}
                          </span>
                        </button>
                      ))}
                      <button type="button" onClick={() => setInvitando(false)} style={S.secondaryLinkButton}>
                        Cancelar
                      </button>
                    </>
                  )
                )
              )}
              {aviso && <span style={{ fontSize: 13, color: aviso.startsWith('✓') ? S.ACCENT : '#FF8A8A' }}>{aviso}</span>}
            </div>
          )}

          {/* Resumen */}
          {tarjeta(
            'Resumen de resultados',
            !datos.resumen ? (
              <Bloqueado nombre={n} que="su resumen de resultados" />
            ) : (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {cifra(datos.resumen.mesas_jugadas, 'Mesas jugadas')}
                  {cifra(datos.resumen.mesas_premiadas, 'Mesas con premio', S.ACCENT)}
                  {cifra(datos.resumen.victorias, 'Victorias (1º)', '#F0B94D')}
                  {cifra(datos.resumen.porras_jugadas, 'Porras jugadas')}
                  {cifra(datos.resumen.amistosos_jugados, 'Amistosos jugados', '#A78BFA')}
                </div>
                {datos.resumen.liga.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: S.MUTED_2 }}>Liga Drafters (temporada en curso)</span>
                    {datos.resumen.liga.map((l) => (
                      <div key={l.deporte} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: S.TEXT }}>
                        {(l.deporte === 'futbol' || l.deporte === 'golf' || l.deporte === 'tenis') && <PelotaDeporte deporte={l.deporte as DeporteV2} size={20} />}
                        <span style={{ flex: 1 }}>
                          {DEPORTE_NOMBRE[l.deporte as DeporteV2] ?? l.deporte}
                          {l.division ? ` · ${l.division}` : ''}
                          {l.grupo > 1 ? ` · grupo ${l.grupo}` : ''}
                        </span>
                        <b style={{ color: '#F0B94D' }}>{l.puesto}º</b>
                        <span style={{ color: l.draftis >= 0 ? S.ACCENT : '#FF8A8A', fontWeight: 700 }}>
                          {l.draftis > 0 ? '+' : ''}
                          {l.draftis} draftis
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )
          )}

          {/* En juego */}
          {tarjeta(
            'Sus salas en juego',
            !datos.en_juego ? (
              <Bloqueado nombre={n} que="sus salas en juego" />
            ) : datos.en_juego.length === 0 ? (
              <span style={{ fontSize: 13, color: S.MUTED_3 }}>Ahora mismo no está en ninguna sala.</span>
            ) : (
              datos.en_juego.map((e) => {
                const href = e.tipo === 'amistoso' ? `/v2/sala/${e.id}` : e.tipo === 'porra' ? `/porras/${e.id}` : e.empezada ? `/salas/${e.id}/clasificacion` : `/salas/${e.id}`;
                return (
                  <div key={`${e.tipo}-${e.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${S.CARD_BORDER}`, paddingTop: 8 }}>
                    <Link href={href} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: '#F0B94D', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {e.tipo === 'amistoso' ? 'Amistoso' : e.tipo === 'porra' ? 'Porra' : e.version === 2 ? 'Liga V2' : 'Mesa'} · {e.competicion}
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: S.TEXT }}>
                          {e.privada ? '🔒 ' : ''}
                          {e.nombre}
                        </span>
                      </span>
                      <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, color: e.empezada ? '#FF5C5C' : S.MUTED_2 }}>{e.empezada ? '● En directo' : e.cierre ? `Empieza ${fechaCorta(e.cierre)}` : ''}</span>
                    </Link>
                    {e.tipo === 'mesa' && e.empezada && e.equipo_id && <ResumenClasificacionMesa salaId={e.id} competicion={e.competicion ?? ''} deporte={e.deporte} miEquipoId={e.equipo_id} tercera />}
                  </div>
                );
              })
            )
          )}

          {/* Historial */}
          {tarjeta(
            'Historial reciente',
            !datos.historial ? (
              <Bloqueado nombre={n} que="su historial" />
            ) : datos.historial.length === 0 ? (
              <span style={{ fontSize: 13, color: S.MUTED_3 }}>Todavía no ha terminado ninguna mesa.</span>
            ) : (
              datos.historial.map((h) => (
                <Link key={h.equipo_id} href={`/salas/${h.id}/clasificacion`} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', borderTop: `1px solid ${S.CARD_BORDER}`, paddingTop: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#F0B94D', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h.competicion}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: S.TEXT }}>{h.nombre}</span>
                  </span>
                  <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 18, color: h.posicion === 1 ? '#F0B94D' : h.premio ? S.ACCENT : S.MUTED_2 }}>
                    {h.posicion ? `${h.posicion === 1 ? '🏆 ' : ''}${h.posicion}º` : h.premio ? 'Premio' : 'Sin premio'}
                  </span>
                </Link>
              ))
            )
          )}
        </>
      ) : null}
    </MarcoSimple>
  );
}
