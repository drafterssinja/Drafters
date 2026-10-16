'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import MarcoV2, { EtiquetaBeta, Panel, Titulo, V2_COLOR } from '@/components/v2/MarcoV2';
import { useSesionV2 } from '@/components/v2/useSesionV2';
import { IconoCandado } from '@/components/v2/IconosV2';
import ChatAmistoso from '@/components/v2/ChatAmistoso';
import EditorPartidos from '@/components/v2/EditorPartidos';
import TiraPuestos from '@/components/v2/TiraPuestos';
import EditorSala from '@/components/v2/EditorSala';
import ClasificacionAmistoso from '@/components/v2/ClasificacionAmistoso';
import EditorPremio, { PREMIO_VACIO } from '@/components/v2/EditorPremio';
import { MODALIDAD_DESC, MODALIDAD_LABEL, cadaXSegundos, fechaCorta, mensajeError, premioValido,  type Amistoso, type AmistosoJornada, type Mensaje, type Premio, type Resumen } from '@/lib/v2';

// ============================================================================
// DRAFTERS V2 — PANTALLA DE UNA SALA (15/10)
// ============================================================================
// Pestañas: Sala (quién está, qué se juega, jornadas y equipos), Chat y
// Clasificación. Si no estás dentro: botón para unirte (con contraseña si es
// privada). Se actualiza sola.

type Draft = { competicion: string; listos: string[]; orden: string[] | null; iniciado_en: string | null; terminado_en: string | null };
type Voto = { mensaje_id: number; usuario_id: string; acepta: boolean };

export default function V2Sala() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { perfil, estado } = useSesionV2();
  const [amistoso, setAmistoso] = useState<Amistoso | null | undefined>(undefined);
  const [jornadas, setJornadas] = useState<AmistosoJornada[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [votos, setVotos] = useState<Voto[]>([]);
  const [pestana, setPestana] = useState<'sala' | 'chat' | 'clasificacion'>('sala');
  const [vistosHasta, setVistosHasta] = useState(0);
  const [contrasena, setContrasena] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editandoPremio, setEditandoPremio] = useState<Premio | null>(null);
  const [copiado, setCopiado] = useState(false);
  // 16/10 (Iñi): el admin edita la sala, cede el mando y puede empezar con menos jugadores.
  const [editandoSala, setEditandoSala] = useState(false);
  const [codigoCopiado, setCodigoCopiado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const miId = perfil?.id ?? '';
  const soyParticipante = !!resumen?.participantes.some((p) => p.usuario_id === miId);

  const cargarSala = useCallback(async () => {
    const [{ data: a }, { data: js }, { data: r }] = await Promise.all([
      supabase.from('amistosos').select('*').eq('id', id).maybeSingle(),
      supabase.from('amistoso_jornadas').select('*').eq('amistoso_id', id).order('orden'),
      supabase.rpc('amistoso_resumen', { p_amistoso: id }),
    ]);
    setAmistoso((a as Amistoso) ?? null);
    setJornadas((js as AmistosoJornada[]) ?? []);
    if (r) setResumen(r as Resumen);
    const { data: ds } = await supabase.from('amistoso_draft').select('competicion,listos,orden,iniciado_en,terminado_en').eq('amistoso_id', id);
    setDrafts((ds as Draft[]) ?? []);
  }, [id]);

  const cargarChat = useCallback(async () => {
    const { data: ms } = await supabase.from('amistoso_mensajes').select('*').eq('amistoso_id', id).order('id', { ascending: false }).limit(200);
    const lista = ((ms as Mensaje[]) ?? []).reverse();
    setMensajes(lista);
    const propuestas = lista.filter((m) => m.tipo === 'propuesta').map((m) => m.id);
    if (propuestas.length) {
      const { data: vs } = await supabase.from('amistoso_votos').select('*').in('mensaje_id', propuestas);
      setVotos((vs as Voto[]) ?? []);
    }
  }, [id]);

  useEffect(() => {
    if (estado !== 'ok') return;
    void cargarSala();
    return cadaXSegundos(cargarSala, 10);
  }, [estado, cargarSala]);

  useEffect(() => {
    if (estado !== 'ok' || !soyParticipante) return;
    void cargarChat();
    return cadaXSegundos(cargarChat, pestana === 'chat' ? 4 : 15);
  }, [estado, soyParticipante, cargarChat, pestana]);

  // Mensajes sin leer (se guarda el último visto en este dispositivo).
  useEffect(() => {
    try {
      setVistosHasta(Number(localStorage.getItem(`v2_chat_${id}`) ?? 0));
    } catch {}
  }, [id]);
  const ultimoId = mensajes[mensajes.length - 1]?.id ?? 0;
  useEffect(() => {
    if (pestana === 'chat' && ultimoId) {
      setVistosHasta(ultimoId);
      try {
        localStorage.setItem(`v2_chat_${id}`, String(ultimoId));
      } catch {}
    }
  }, [pestana, ultimoId, id]);
  const sinLeer = mensajes.filter((m) => m.id > vistosHasta && m.usuario_id !== miId && m.tipo !== 'sistema').length;

  async function unirse() {
    setError(null);
    const { error: e } = await supabase.rpc('amistoso_unirse', { p_amistoso: id, p_contrasena: contrasena || null });
    if (e) return setError(mensajeError(e));
    await cargarSala();
  }

  async function salir() {
    if (!window.confirm('¿Seguro que quieres salir de la sala?')) return;
    const { error: e } = await supabase.rpc('amistoso_salir', { p_amistoso: id });
    if (e) return setError(mensajeError(e));
    router.replace(`/v2/${amistoso?.deporte ?? 'futbol'}?modo=amistosos`);
  }

  async function borrar() {
    if (!window.confirm('¿Borrar la sala para todos? No se puede deshacer.')) return;
    const { error: e } = await supabase.rpc('amistoso_borrar', { p_amistoso: id });
    if (e) return setError(mensajeError(e));
    router.replace(`/v2/${amistoso?.deporte ?? 'futbol'}?modo=amistosos`);
  }

  async function guardarPremio() {
    if (!editandoPremio) return;
    const err = premioValido(editandoPremio, amistoso?.num_jugadores);
    if (err) return setError(err);
    const { error: e } = await supabase.rpc('amistoso_editar_premio', { p_amistoso: id, p_premio: editandoPremio.tipo === 'nada' ? null : editandoPremio });
    if (e) return setError(mensajeError(e));
    setEditandoPremio(null);
    await Promise.all([cargarSala(), cargarChat()]);
  }

  async function copiarCodigo() {
    if (!amistoso) return;
    try {
      await navigator.clipboard.writeText(amistoso.codigo);
      setCodigoCopiado(true);
      setTimeout(() => setCodigoCopiado(false), 2000);
    } catch {
      window.prompt('Copia el código:', amistoso.codigo);
    }
  }

  async function cederAdmin(usuarioId: string, nombre: string) {
    if (!window.confirm(`¿Hacer a @${nombre} administrador de la sala? Tú dejarás de serlo.`)) return;
    const { error: e } = await supabase.rpc('amistoso_ceder_admin', { p_amistoso: id, p_usuario: usuarioId });
    if (e) return setError(mensajeError(e));
    await Promise.all([cargarSala(), cargarChat()]);
  }

  async function empezarConLosQueHay(dentro: number) {
    if (!window.confirm(`¿Cerrar la sala y jugar los ${dentro} que estáis? Después ajusta quién gana y quién paga.`)) return;
    const { error: e } = await supabase.rpc('amistoso_cerrar_plazas', { p_amistoso: id });
    if (e) return setError(mensajeError(e));
    await Promise.all([cargarSala(), cargarChat()]);
    setAviso(`Sala cerrada con ${dentro} jugadores. Revisa quién gana y quién paga con ${dentro}.`);
    setEditandoSala(true);
  }

  async function compartir() {
    if (!amistoso) return;
    const url = `${window.location.origin}/v2/sala/${amistoso.id}`;
    const texto = `¡Únete a mi sala "${amistoso.nombre}" en Drafters! Código: ${amistoso.codigo}${amistoso.privada ? ' (te paso la contraseña aparte)' : ''}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Drafters', text: texto, url });
        return;
      }
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(`${texto}\n${url}`);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {}
  }

  if (estado === 'ok' && amistoso === null) {
    return (
      <MarcoV2 perfil={perfil} estado={estado} volverA="/v2/futbol?modo=amistosos">
        <p style={{ fontSize: 14, color: S.MUTED }}>Esta sala no existe o ya se ha borrado.</p>
        <Link href="/v2/futbol?modo=amistosos" style={{ ...S.secondaryLinkButton, textAlign: 'center', textDecoration: 'none' }}>
          Volver a amistosos
        </Link>
      </MarcoV2>
    );
  }

  const cargando = !amistoso || !resumen;
  const esCreador = amistoso?.creador_id === miId;
  const n = resumen?.participantes.length ?? 0;
  const empezada = !!resumen?.jornadas.some((j) => j.empezada);
  const primeraCierre = jornadas[0]?.cierre ?? null;
  const draftEmpezado = drafts.some((d) => d.iniciado_en);

  return (
    <MarcoV2 perfil={perfil} estado={estado} deporte={amistoso?.deporte ?? 'futbol'} volverA={`/v2/${amistoso?.deporte ?? 'futbol'}?modo=amistosos`}>
      {cargando ? (
        <p style={{ fontSize: 14, color: S.MUTED }}>Cargando sala...</p>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <EtiquetaBeta />
              {/* 15/10 (Iñi): en las privadas, candado y quién la ha creado; en las públicas, nada más. */}
              {amistoso.privada && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: S.MUTED_2 }}>
                  <IconoCandado size={13} /> Privada · creada por @{resumen.nombres[amistoso.creador_id] ?? '...'}
                </span>
              )}
            </div>
            <Titulo>{amistoso.nombre}</Titulo>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: '#F0B94D', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{jornadas.map((j) => j.competicion).join(' · ')}</span>
            <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>
              <span style={{ color: V2_COLOR, fontWeight: 700 }}>{MODALIDAD_LABEL[amistoso.modalidad]}</span> · {n}/{amistoso.num_jugadores} jugadores
              {primeraCierre && !empezada ? ` · empieza ${fechaCorta(primeraCierre)}` : ''}
            </span>
          </div>

          {!soyParticipante && (
            <Panel>
              <span style={{ fontSize: 13, color: S.MUTED, lineHeight: 1.5 }}>{MODALIDAD_DESC[amistoso.modalidad]}</span>
              {amistoso.premio && amistoso.premio.tipo !== 'nada' ? (
                <TiraPuestos premio={amistoso.premio} participantes={amistoso.num_jugadores} />
              ) : (
                <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>🏆 Solo por la gloria</span>
              )}
              {empezada ? (
                <span style={{ fontSize: 13, color: S.MUTED_3 }}>Esta sala ya ha empezado.</span>
              ) : n >= amistoso.num_jugadores ? (
                <span style={{ fontSize: 13, color: S.MUTED_3 }}>La sala está completa.</span>
              ) : (
                <>
                  {amistoso.privada && <input value={contrasena} onChange={(e) => setContrasena(e.target.value)} placeholder="Contraseña de la sala" style={S.input} autoComplete="off" />}
                  <button type="button" onClick={unirse} style={{ ...S.primaryButton, background: V2_COLOR }}>
                    Unirme a la sala
                  </button>
                </>
              )}
              {error && <p style={S.errorText}>{error}</p>}
            </Panel>
          )}

          {soyParticipante && (
            <>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" style={S.pill(pestana === 'sala')} onClick={() => setPestana('sala')}>
                  Sala
                </button>
                <button type="button" style={S.pill(pestana === 'chat')} onClick={() => setPestana('chat')}>
                  Chat{sinLeer > 0 && pestana !== 'chat' ? ` · ${sinLeer}` : ''}
                </button>
                <button type="button" style={S.pill(pestana === 'clasificacion')} onClick={() => setPestana('clasificacion')}>
                  Clasificación
                </button>
              </div>
              {error && <p style={S.errorText}>{error}</p>}

              {pestana === 'chat' && <ChatAmistoso amistosoId={id} miId={miId} nombres={resumen.nombres} participantes={n} mensajes={mensajes} votos={votos} onCambio={cargarChat} />}

              {pestana === 'clasificacion' && <ClasificacionAmistoso amistoso={amistoso} jornadas={jornadas} resumen={resumen} miId={miId} />}

              {pestana === 'sala' && (
                <>
                  {esCreador && (
                    <Panel style={{ borderColor: 'rgba(240,185,77,0.45)' }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#F0B94D', textTransform: 'uppercase', letterSpacing: '0.05em' }}>👑 Eres el administrador</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>Código</span>
                        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 26, letterSpacing: '0.18em', color: S.TEXT }}>{amistoso.codigo}</span>
                        <button type="button" onClick={copiarCodigo} style={{ marginLeft: 'auto', border: `1px solid ${codigoCopiado ? S.ACCENT : S.BORDER}`, background: codigoCopiado ? 'rgba(61,220,132,0.12)' : 'transparent', color: codigoCopiado ? S.ACCENT : S.TEXT, borderRadius: 10, padding: '8px 12px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
                          {codigoCopiado ? '✓ Copiado' : '📋 Copiar'}
                        </button>
                      </div>
                      {aviso && <span style={{ fontSize: 12.5, color: '#F0B94D' }}>{aviso}</span>}
                      {editandoSala ? (
                        <EditorSala
                          amistoso={amistoso}
                          dentro={n}
                          empezada={empezada || draftEmpezado}
                          onCancelar={() => {
                            setEditandoSala(false);
                            setAviso(null);
                          }}
                          onGuardado={() => {
                            setEditandoSala(false);
                            setAviso(null);
                            void Promise.all([cargarSala(), cargarChat()]);
                          }}
                        />
                      ) : (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button type="button" onClick={() => setEditandoSala(true)} style={{ border: `1px solid ${V2_COLOR}`, color: V2_COLOR, background: 'transparent', borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                            ✏️ Editar sala
                          </button>
                          {!empezada && !draftEmpezado && n >= 2 && n < amistoso.num_jugadores && (
                            <button type="button" onClick={() => empezarConLosQueHay(n)} style={{ border: `1px solid ${S.BORDER}`, color: S.TEXT, background: 'transparent', borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                              ▶ Empezar con los {n} que estamos
                            </button>
                          )}
                        </div>
                      )}
                      {!editandoSala && <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>Para pasar el mando a otro, pulsa &quot;Hacer admin&quot; junto a su nombre en la lista de jugadores.</span>}
                    </Panel>
                  )}

                  <Panel>
                    <span style={S.sectionLabel}>
                      {amistoso.modalidad === 'draft' ? (amistoso.equipo_fijo ? 'Draft (un equipo para todas las jornadas)' : 'Drafts') : amistoso.equipo_fijo ? 'Tu equipo (el mismo para todas las jornadas)' : 'Tu equipo'}
                    </span>
                    {/* 15/10: con equipo fijo solo se hace (o se draftea) en la primera jornada. */}
                    {(amistoso.equipo_fijo ? jornadas.slice(0, 1) : jornadas).map((j) => {
                      const info = resumen.jornadas.find((x) => x.competicion === j.competicion);
                      const hechos = resumen.equipos_hechos.filter((e) => e.competicion === j.competicion);
                      const tengo = hechos.some((e) => e.usuario_id === miId);
                      const d = drafts.find((x) => x.competicion === j.competicion);
                      const cerrada = !!info?.empezada;
                      const publicada = !!j.cierre;
                      const puedeElegirPartidos = esCreador && amistoso.deporte === 'futbol' && publicada && !cerrada && hechos.length === 0 && !d?.iniciado_en;
                      return (
                        <div key={j.competicion} style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${S.CARD_BORDER}`, paddingTop: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                            <span style={{ fontWeight: 700, fontSize: 13.5, color: S.TEXT }}>{j.competicion}</span>
                            <span style={{ fontSize: 11, color: info?.terminada ? S.MUTED_3 : cerrada ? '#FF5C5C' : S.MUTED_2 }}>{info?.terminada ? 'Terminada' : cerrada ? 'En juego' : j.cierre ? `Cierra ${fechaCorta(j.cierre)}` : ''}</span>
                          </div>
                          {j.partidos && <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>Solo {j.partidos.map((p) => `${p.local}–${p.visitante}`).join(', ')}</span>}
                          {puedeElegirPartidos && <EditorPartidos amistosoId={id} competicion={j.competicion} actuales={j.partidos} onGuardado={() => void Promise.all([cargarSala(), cargarChat()])} />}
                          {!publicada ? (
                            <span style={{ fontSize: 12, color: S.MUTED_3 }}>Sin horarios todavía. {amistoso.modalidad === 'draft' ? 'El draft' : 'El equipo'} se podrá hacer cuando se publique la jornada.</span>
                          ) : amistoso.modalidad === 'draft' ? (
                            <>
                              <span style={{ fontSize: 12, color: S.MUTED_2 }}>
                                {d?.terminado_en
                                  ? '✅ Draft terminado'
                                  : d?.iniciado_en
                                    ? '🔥 Draft en marcha'
                                    : n < amistoso.num_jugadores
                                      ? `Esperando a que se llene la sala (${n}/${amistoso.num_jugadores})`
                                      : `Listos ${d?.listos.length ?? 0} de ${n}`}
                              </span>
                              <Link href={`/v2/sala/${id}/draft?c=${encodeURIComponent(j.competicion)}`} style={{ ...S.primaryButton, background: V2_COLOR, textAlign: 'center', textDecoration: 'none', marginTop: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {d?.iniciado_en && !d.terminado_en ? 'Entrar al draft' : d?.terminado_en ? 'Ver el draft' : 'Ir a la sala del draft'}
                              </Link>
                            </>
                          ) : (
                            <>
                              <span style={{ fontSize: 12, color: S.MUTED_2 }}>
                                Equipos hechos: {hechos.length} de {n}
                                {hechos.length > 0 && ` (${hechos.map((h) => '@' + (resumen.nombres[h.usuario_id] ?? '?')).join(', ')})`}
                              </span>
                              {!cerrada && (
                                <Link href={`/v2/sala/${id}/equipo?c=${encodeURIComponent(j.competicion)}`} style={{ ...(tengo ? S.secondaryLinkButton : { ...S.primaryButton, marginTop: 0 }), textAlign: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {tengo ? 'Cambiar mi equipo' : 'Hacer mi equipo'}
                                </Link>
                              )}
                              {cerrada && !tengo && <span style={{ fontSize: 12, color: '#FF5C5C' }}>No hiciste equipo para esta jornada.</span>}
                            </>
                          )}
                        </div>
                      );
                    })}
                    {amistoso.equipo_fijo && jornadas.length > 1 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: `1px solid ${S.CARD_BORDER}`, paddingTop: 10 }}>
                        <span style={{ fontSize: 12, color: S.MUTED_2 }}>Ese mismo equipo juega también:</span>
                        {jornadas.slice(1).map((j) => {
                          const info = resumen.jornadas.find((x) => x.competicion === j.competicion);
                          return (
                            <div key={j.competicion} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
                              <span style={{ color: S.TEXT }}>{j.competicion}</span>
                              <span style={{ color: info?.terminada ? S.MUTED_3 : info?.empezada ? '#FF5C5C' : S.MUTED_3 }}>{info?.terminada ? 'Terminada' : info?.empezada ? 'En juego' : j.cierre ? `Empieza ${fechaCorta(j.cierre)}` : 'Sin horarios todavía'}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Panel>

                  <Panel>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={S.sectionLabel}>Lo que os jugáis</span>
                      {esCreador && !editandoPremio && !editandoSala && (
                        <button type="button" onClick={() => setEditandoPremio(amistoso.premio ?? PREMIO_VACIO)} style={{ background: 'none', border: 'none', color: V2_COLOR, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
                          Editar
                        </button>
                      )}
                    </div>
                    {editandoPremio ? (
                      <>
                        <EditorPremio premio={editandoPremio} onChange={setEditandoPremio} participantes={amistoso.num_jugadores} />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button type="button" onClick={guardarPremio} style={{ ...S.primaryButton, background: V2_COLOR, marginTop: 0 }}>
                            Guardar
                          </button>
                          <button type="button" onClick={() => setEditandoPremio(null)} style={S.secondaryLinkButton}>
                            Cancelar
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        {/* 15/10 (Iñi): la misma tira de puestos que al crear la sala. */}
                        {amistoso.premio && amistoso.premio.tipo !== 'nada' ? (
                          <TiraPuestos premio={amistoso.premio} participantes={amistoso.num_jugadores} />
                        ) : (
                          <span style={{ fontSize: 13.5, color: S.TEXT, fontWeight: 600 }}>Solo por la gloria</span>
                        )}
                        {!amistoso.privada && (
                          <button type="button" onClick={() => setPestana('chat')} style={{ ...S.secondaryLinkButton, borderColor: V2_COLOR, color: V2_COLOR }}>
                            🤝 Proponer jugarnos algo (en el chat)
                          </button>
                        )}
                        <span style={{ fontSize: 11, color: S.MUTED_3 }}>Drafters no cobra ni paga nada en los amistosos: solo calcula cuánto le toca a cada uno.</span>
                      </>
                    )}
                  </Panel>

                  <Panel>
                    <span style={S.sectionLabel}>
                      Jugadores ({n}/{amistoso.num_jugadores})
                    </span>
                    {resumen.participantes.map((p) => (
                      <div key={p.usuario_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: S.TEXT }}>
                        <span style={{ width: 28, height: 28, borderRadius: 999, background: 'rgba(167,139,250,0.15)', color: V2_COLOR, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>{p.nombre.slice(0, 1).toUpperCase()}</span>
                        <span style={{ flex: 1 }}>
                          @{p.nombre}
                          {p.usuario_id === miId ? ' (tú)' : ''}
                        </span>
                        {p.usuario_id === amistoso.creador_id && <span style={{ fontSize: 10.5, fontWeight: 700, color: '#F0B94D' }}>👑 ADMIN</span>}
                        {esCreador && p.usuario_id !== miId && (
                          <button type="button" onClick={() => cederAdmin(p.usuario_id, p.nombre)} style={{ border: `1px solid ${S.BORDER}`, background: 'transparent', color: S.MUTED, borderRadius: 8, padding: '4px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                            Hacer admin
                          </button>
                        )}
                      </div>
                    ))}
                    {amistoso.num_jugadores - n > 4 ? (
                      <div style={{ fontSize: 12.5, color: S.FAINT }}>{amistoso.num_jugadores - n} huecos libres</div>
                    ) : (
                      Array.from({ length: Math.max(0, amistoso.num_jugadores - n) }).map((_, i) => (
                        <div key={i} style={{ fontSize: 12.5, color: S.FAINT }}>
                          Hueco libre
                        </div>
                      ))
                    )}
                    {!empezada && n < amistoso.num_jugadores && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                        {!esCreador && (
                          <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>
                            Código de la sala: <b style={{ color: S.TEXT, letterSpacing: '0.15em' }}>{amistoso.codigo}</b>
                          </span>
                        )}
                        <button type="button" onClick={compartir} style={{ ...S.primaryButton, background: V2_COLOR, marginTop: 0 }}>
                          {copiado ? '¡Copiado!' : 'Invitar amigos'}
                        </button>
                      </div>
                    )}
                  </Panel>

                  {!empezada && !draftEmpezado && (
                    <button type="button" onClick={esCreador ? borrar : salir} style={{ ...S.secondaryLinkButton, color: '#FF5C5C', borderColor: 'rgba(255,92,92,0.4)' }}>
                      {esCreador ? 'Borrar la sala' : 'Salir de la sala'}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </MarcoV2>
  );
}
