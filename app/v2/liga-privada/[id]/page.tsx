'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import MarcoV2, { Panel } from '@/components/v2/MarcoV2';
import { useSesionV2 } from '@/components/v2/useSesionV2';
import Cargando from '@/components/Cargando';
import CajaContrasena from '@/components/v2/CajaContrasena';
import InvitarAmigos from '@/components/v2/InvitarAmigos';
import { jornadaBonita } from '@/components/v2/LigaDuelos';
import { UsuarioConNivel, useNiveles } from '@/components/v2/Nivel';
import { etiquetasPosicion } from '@/lib/posicionesEmpate';
import { cadaXSegundos, mensajeError } from '@/lib/v2';

// ============================================================================
// LIGA PRIVADA (31/10, Iñi) — SQL 71
// ============================================================================
// Todos juegan cada sala. En cada sala: 1º = tantos puntos como miembros, …
// último = 1; sin equipo = 0. Sin final: la termina quien la crea.
// 31/10 (Iñi, SQL 72): las salas las publica un administrador de la liga (quien
// la creó y los que él nombre): solo se elige la jornada o el torneo. Una sala
// por jornada. Sin contraseña (ya estás dentro), sin nº de jugadores ni premio.

type Resultado = { usuario_id: string; nombre: string; tiene_equipo: boolean; total: number | null; puesto: number | null; puntos_liga: number | null; soy_yo: boolean };
type Jornada = { id: string; competicion: string; orden: number; cierre: string | null; estado: 'pendiente' | 'en_juego' | 'terminada'; tengo_equipo: boolean; con_jugadores?: boolean; equipos?: number; resultados: Resultado[] };
type Disponible = { competicion: string; cierre: string; ya: boolean; con_jugadores: boolean };
type Info = {
  id: string;
  nombre: string;
  deporte: 'futbol' | 'golf' | 'tenis';
  competicion: string;
  desde: string;
  estado: 'activa' | 'terminada';
  creador_id: string;
  creador: string;
  soy_miembro: boolean;
  soy_creador: boolean;
  soy_admin?: boolean;
  miembros: { id: string; nombre: string; soy_yo: boolean; es_admin?: boolean; es_creador?: boolean }[];
  jornadas: Jornada[];
};
type Fila = { usuario_id: string; nombre: string; pj: number; pts: number; victorias: number; puntos_fantasy: number; soy_yo: boolean };

const VERDE = '#3DDC84';
const ORO = '#F0B94D';
const ICONO: Record<string, string> = { futbol: '⚽', golf: '⛳', tenis: '🎾' };
const n1 = (x: number | null | undefined) => (x === null || x === undefined ? '–' : String(Math.round(Number(x) * 10) / 10).replace('.', ','));
function fecha(iso: string | null, conHora = true): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('es-ES', conHora ? { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' } : { day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' }).format(new Date(iso));
}
const DEPORTE: Record<string, string> = { futbol: 'Fútbol', golf: 'Golf', tenis: 'Tenis' };

function LigaPrivada() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const nueva = useSearchParams().get('nueva') === '1';
  const { perfil, estado } = useSesionV2();
  const [info, setInfo] = useState<Info | null>(null);
  const [tabla, setTabla] = useState<Fila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clave, setClave] = useState('');
  const [errorClave, setErrorClave] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<'terminar' | 'salir' | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [claveCreada, setClaveCreada] = useState<string | null>(null);
  const [quitar, setQuitar] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const [{ data, error: e }, { data: cl }] = await Promise.all([supabase.rpc('lp_info', { p_liga: id }), supabase.rpc('lp_clasificacion', { p_liga: id })]);
    if (e) return setError(mensajeError(e));
    setInfo(data as Info);
    setTabla((cl as Fila[]) ?? []);
  }, [id]);

  useEffect(() => {
    if (estado !== 'ok') return;
    void cargar();
    return cadaXSegundos(() => void cargar(), 60);
  }, [estado, cargar]);

  useEffect(() => {
    if (!nueva) return;
    try {
      setClaveCreada(sessionStorage.getItem(`lp_clave_${id}`));
    } catch {}
  }, [nueva, id]);

  const niveles = useNiveles((info?.miembros ?? []).map((m) => m.id));

  async function entrar() {
    setEntrando(true);
    setErrorClave(null);
    const { error: e } = await supabase.rpc('lp_unirse', { p_liga: id, p_contrasena: clave.trim() });
    setEntrando(false);
    if (e) return setErrorClave(mensajeError(e));
    await cargar();
  }

  async function terminarOSalir(que: 'terminar' | 'salir') {
    const { error: e } = await supabase.rpc(que === 'terminar' ? 'lp_terminar' : 'lp_salir', { p_liga: id });
    setConfirmar(null);
    if (e) return setError(mensajeError(e));
    if (que === 'salir') router.replace(`/v2/${info?.deporte ?? 'futbol'}?modo=privadas`);
    else await cargar();
  }

  async function compartir() {
    const url = `${window.location.origin}/v2/liga-privada/${id}`;
    const texto = `Únete a mi liga privada «${info?.nombre}» en Drafters`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Drafters', text: texto, url });
        return;
      }
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(`${texto}: ${url}`);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {}
  }

  const dep = info?.deporte ?? 'futbol';
  const jornadas = info?.jornadas ?? [];
  const proxima = [...jornadas].filter((j) => j.estado === 'pendiente' && j.cierre && new Date(j.cierre).getTime() > Date.now()).sort((a, b) => a.orden - b.orden)[0] ?? null;
  const posiciones = tabla ? etiquetasPosicion(tabla, (f) => f.pts * 1e6 + Number(f.puntos_fantasy)) : [];
  const n = info?.miembros.length ?? 0;

  return (
    <MarcoV2 perfil={perfil} estado={estado} deporte={dep} volverA={`/v2/${dep}?modo=privadas`}>
      {error && <p style={S.errorText}>{error}</p>}
      {!info && !error && <Cargando compacto />}
      {info && (
        <>
          {/* Cabecera */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#A78BFA' }}>🔒 Liga privada · {ICONO[dep]} {DEPORTE[dep]}</span>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 30, color: S.TEXT, lineHeight: 1.05 }}>{info.nombre}</span>
            <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>
              Creada por @{info.creador} · {n} {n === 1 ? 'miembro' : 'miembros'}
              {info.estado === 'terminada' ? ' · Terminada' : ''}
            </span>
          </div>

          {claveCreada && info.soy_creador && (
            <Panel style={{ gap: 6, border: '1px solid rgba(61,220,132,0.4)' }}>
              <span style={{ fontWeight: 800, fontSize: 15, color: VERDE }}>✓ Liga creada</span>
              <span style={{ fontSize: 13, color: S.MUTED, lineHeight: 1.5 }}>
                Pasa a tus amigos el enlace y la contraseña (<b style={{ color: S.TEXT }}>{claveCreada}</b>), o invítalos desde aquí abajo.
              </span>
            </Panel>
          )}

          {/* No soy miembro: entrar con contraseña */}
          {!info.soy_miembro &&
            (info.estado === 'activa' ? (
              <>
                <CajaContrasena que="liga" valor={clave} onChange={setClave} onEnter={() => void entrar()} creador={info.creador} />
                {errorClave && <p style={S.errorText}>{errorClave}</p>}
                <button type="button" disabled={!clave.trim() || entrando} onClick={() => void entrar()} style={{ ...S.primaryButton, opacity: !clave.trim() || entrando ? 0.6 : 1 }}>
                  {entrando ? 'Entrando…' : 'Entrar en la liga'}
                </button>
              </>
            ) : (
              <p style={{ fontSize: 13.5, color: S.MUTED_2 }}>Esta liga ya ha terminado.</p>
            ))}

          {info.soy_miembro && (
            <>
              {/* Haz tu equipo */}
              {info.estado === 'activa' && proxima && proxima.con_jugadores === false && (
                <Panel style={{ gap: 4 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: VERDE }}>Próxima sala</span>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, color: S.TEXT, lineHeight: 1.1 }}>{jornadaBonita(proxima.competicion, dep)}</span>
                  <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>{dep === 'tenis' ? 'Podrás hacer tu equipo en cuanto salga el cuadro. Te avisamos.' : 'Podrás hacer tu equipo en cuanto estén los jugadores. Te avisamos.'}</span>
                </Panel>
              )}
              {info.estado === 'activa' && proxima && proxima.con_jugadores !== false && (
                <Link
                  href={`/v2/liga-privada/jornada/${proxima.id}/equipo`}
                  style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 16, borderRadius: 16, textDecoration: 'none', background: proxima.tengo_equipo ? S.PANEL : 'linear-gradient(160deg, #15241C 0%, #111614 70%)', border: `1px solid ${proxima.tengo_equipo ? S.CARD_BORDER : 'rgba(61,220,132,0.45)'}` }}
                >
                  <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: proxima.tengo_equipo ? S.MUTED_2 : VERDE }}>{proxima.tengo_equipo ? '✓ Ya tienes equipo' : 'Próxima sala'}</span>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, color: S.TEXT, lineHeight: 1.1 }}>
                    {proxima.tengo_equipo ? 'Cambiar mi equipo' : 'Haz tu equipo'} · {jornadaBonita(proxima.competicion, dep)}
                  </span>
                  <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>Cierra el {fecha(proxima.cierre)}{proxima.tengo_equipo ? '' : ' · 1 crédito'}</span>
                </Link>
              )}
              {info.estado === 'activa' && !proxima && (
                <Panel style={{ gap: 4 }}>
                  <span style={{ fontWeight: 800, fontSize: 14, color: S.TEXT }}>Todavía no hay sala para hacer equipo</span>
                  <span style={{ fontSize: 12.5, color: S.MUTED_2, lineHeight: 1.5 }}>
                    {info.soy_admin ? `Publícala aquí abajo: solo tienes que elegir ${dep === 'futbol' ? 'la jornada' : 'el torneo'}.` : `La publicará un administrador de la liga (@${info.creador}${info.miembros.filter((m) => m.es_admin && !m.es_creador).map((m) => ` o @${m.nombre}`).join('')}). Te avisamos.`}
                  </span>
                </Panel>
              )}

              {info.estado === 'activa' && info.soy_admin && <PublicarSala ligaId={info.id} deporte={dep} onHecho={() => void cargar()} />}

              {/* Clasificación */}
              <Panel style={{ gap: 4, padding: '12px 12px 8px' }}>
                <span style={S.sectionLabel}>{info.estado === 'terminada' ? 'Clasificación final' : 'Clasificación'}</span>
                {tabla === null ? (
                  <Cargando compacto />
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '34px 1fr 30px 30px 44px', gap: 6, fontSize: 10.5, fontWeight: 800, color: S.MUTED_3, textTransform: 'uppercase', padding: '4px 2px' }}>
                      <span>#</span>
                      <span>Jugador</span>
                      <span style={{ textAlign: 'center' }}>PJ</span>
                      <span style={{ textAlign: 'center' }}>1º</span>
                      <span style={{ textAlign: 'right' }}>Pts</span>
                    </div>
                    {tabla.map((f, i) => (
                      <div key={f.usuario_id} style={{ display: 'grid', gridTemplateColumns: '34px 1fr 30px 30px 44px', gap: 6, alignItems: 'center', padding: '8px 2px', borderTop: '1px solid rgba(255,255,255,0.05)', background: f.soy_yo ? 'rgba(61,220,132,0.07)' : 'transparent', borderRadius: f.soy_yo ? 8 : 0 }}>
                        <span style={{ fontWeight: 800, fontSize: 13.5, color: posiciones[i].replace('T', '') === '1' && f.pts > 0 ? ORO : S.MUTED }}>{posiciones[i]}</span>
                        <span style={{ minWidth: 0, fontWeight: 700, fontSize: 13.5, color: f.soy_yo ? VERDE : S.TEXT }}>
                          <UsuarioConNivel id={f.usuario_id} nombre={f.nombre} nivel={niveles.get(f.usuario_id)} miId={perfil?.id} modo="popover" />
                        </span>
                        <span style={{ textAlign: 'center', fontSize: 13, color: S.MUTED }}>{f.pj}</span>
                        <span style={{ textAlign: 'center', fontSize: 13, color: S.MUTED }}>{f.victorias}</span>
                        <span style={{ textAlign: 'right', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 18, color: S.TEXT }}>{f.pts}</span>
                      </div>
                    ))}
                    <span style={{ fontSize: 11, color: S.MUTED_3, marginTop: 4 }}>Cuenta cuando termina cada sala. Empate a puntos: desempatan los puntos de los equipos.</span>
                  </>
                )}
              </Panel>

              {/* Jornadas */}
              <Panel style={{ gap: 0, padding: '12px 12px 4px' }}>
                <span style={{ ...S.sectionLabel, marginBottom: 6 }}>Salas de la liga</span>
                {jornadas.length === 0 && <span style={{ fontSize: 13, color: S.MUTED_2, paddingBottom: 8 }}>Todavía no hay ninguna.</span>}
                {jornadas.map((j, i) => {
                  const yo = j.resultados.find((r) => r.soy_yo);
                  const abiertaJ = abierta === j.id;
                  return (
                    <div key={j.id} style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)' }}>
                      <button type="button" onClick={() => (j.estado === 'pendiente' ? setAbierta(abiertaJ ? null : j.id) : router.push(`/v2/liga-privada/jornada/${j.id}`))} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 2px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={{ fontWeight: 800, fontSize: 14, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{jornadaBonita(j.competicion, dep)}</span>
                          <span style={{ fontSize: 11.5, color: j.estado === 'en_juego' ? VERDE : S.MUTED_3 }}>{j.estado === 'terminada' ? 'Terminada' : j.estado === 'en_juego' ? '● En juego' : `Cierra ${fecha(j.cierre)}`}</span>
                        </span>
                        <span style={{ fontSize: 12, color: S.MUTED_2, textAlign: 'right' }}>
                          {j.estado === 'pendiente' ? (j.tengo_equipo ? '✓ Equipo hecho' : <span style={{ color: '#FF8A8A' }}>Sin equipo</span>) : yo?.puesto ? `${yo.puesto}º` : 'Sin equipo'}
                        </span>
                        {j.estado === 'terminada' && <span style={{ minWidth: 40, textAlign: 'right', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 16, color: (yo?.puntos_liga ?? 0) > 0 ? VERDE : S.MUTED_3 }}>+{yo?.puntos_liga ?? 0}</span>}
                        <span style={{ color: S.MUTED_3, fontSize: j.estado === 'pendiente' ? 11 : 16 }}>{j.estado !== 'pendiente' ? '›' : abiertaJ ? '▾' : '▸'}</span>
                      </button>
                      {abiertaJ && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 2px 12px' }}>
                          {j.estado === 'pendiente' ? (
                            <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>Los equipos de los demás se ven cuando empiece la sala.</span>
                          ) : (
                            j.resultados.map((r) => (
                              <div key={r.usuario_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                                <span style={{ width: 28, fontWeight: 800, color: r.puesto === 1 ? ORO : S.MUTED_2 }}>{r.puesto ? `${r.puesto}º` : '–'}</span>
                                <span style={{ flex: 1, minWidth: 0, color: r.soy_yo ? VERDE : S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>@{r.nombre}</span>
                                <span style={{ color: S.MUTED_2 }}>{r.tiene_equipo ? n1(r.total) : 'sin equipo'}</span>
                                {j.estado === 'terminada' && <span style={{ minWidth: 34, textAlign: 'right', fontWeight: 800, color: (r.puntos_liga ?? 0) > 0 ? VERDE : S.MUTED_3 }}>+{r.puntos_liga ?? 0}</span>}
                              </div>
                            ))
                          )}
                          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                            {j.estado !== 'pendiente' && (
                              <Link href={`/v2/liga-privada/jornada/${j.id}`} style={{ ...S.secondaryLinkButton, flex: 1, marginTop: 0, textAlign: 'center', textDecoration: 'none' }}>
                                Ver los equipos
                              </Link>
                            )}
                            {j.estado === 'pendiente' && info.estado === 'activa' && j.con_jugadores !== false && j.cierre && new Date(j.cierre).getTime() > Date.now() && (
                              <Link href={`/v2/liga-privada/jornada/${j.id}/equipo`} style={{ ...S.secondaryLinkButton, flex: 1, marginTop: 0, textAlign: 'center', textDecoration: 'none' }}>
                                {j.tengo_equipo ? 'Cambiar mi equipo' : 'Hacer mi equipo'}
                              </Link>
                            )}
                          </div>
                          {j.estado === 'pendiente' && info.soy_admin && info.estado === 'activa' && (
                            quitar === j.id ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                                <span style={{ flex: 1, fontSize: 12, color: S.MUTED_2 }}>¿Quitar esta sala?{j.equipos ? ` Se devuelve el crédito a los ${j.equipos} que ya hicieron equipo.` : ''}</span>
                                <button type="button" onClick={() => setQuitar(null)} style={{ background: 'none', border: 'none', color: S.MUTED, fontSize: 12.5, cursor: 'pointer' }}>
                                  No
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const { error: e } = await supabase.rpc('lp_quitar_sala', { p_jornada: j.id });
                                    setQuitar(null);
                                    if (e) setError(mensajeError(e));
                                    await cargar();
                                  }}
                                  style={{ background: 'none', border: 'none', color: '#FF8A8A', fontWeight: 800, fontSize: 12.5, cursor: 'pointer' }}
                                >
                                  Sí, quitarla
                                </button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => setQuitar(j.id)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: S.MUTED_3, fontSize: 12, cursor: 'pointer', padding: '4px 0' }}>
                                Quitar esta sala
                              </button>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </Panel>

              {/* Miembros e invitar */}
              <Panel style={{ gap: 8 }}>
                <span style={S.sectionLabel}>Miembros ({n})</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {info.miembros.map((m) => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: m.soy_yo ? VERDE : S.TEXT }}>
                        <UsuarioConNivel id={m.id} nombre={m.nombre} nivel={niveles.get(m.id)} miId={perfil?.id} />
                      </span>
                      {m.es_admin && <span style={{ fontSize: 10.5, fontWeight: 800, color: ORO }}>👑 ADMIN</span>}
                      {info.soy_admin && info.estado === 'activa' && !m.es_creador && !m.soy_yo && (
                        <button
                          type="button"
                          onClick={async () => {
                            const { error: e } = await supabase.rpc('lp_hacer_admin', { p_liga: info.id, p_usuario: m.id, p_admin: !m.es_admin });
                            if (e) setError(mensajeError(e));
                            await cargar();
                          }}
                          style={{ border: `1px solid ${S.BORDER}`, background: 'transparent', color: S.MUTED, borderRadius: 8, padding: '4px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                        >
                          {m.es_admin ? 'Quitar admin' : 'Hacer admin'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>Los administradores publican las salas de la liga.</span>
                {info.estado === 'activa' && (
                  <>
                    <InvitarAmigos ligaId={info.id} dentro={info.miembros.map((m) => m.id)} />
                    <button type="button" onClick={() => void compartir()} style={{ ...S.secondaryLinkButton, marginTop: 0 }}>
                      {copiado ? '✓ Enlace copiado' : '🔗 Compartir el enlace de la liga'}
                    </button>
                    <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>Para entrar necesitan la contraseña. Quien entre juega desde la siguiente sala que empiece.</span>
                  </>
                )}
              </Panel>

              <Panel style={{ gap: 6 }}>
                <span style={S.sectionLabel}>Cómo se puntúa</span>
                <span style={{ fontSize: 13, color: S.MUTED, lineHeight: 1.5 }}>
                  En cada sala juegan todos los de la liga y se ordena a todos por los puntos de su equipo: con {Math.max(n, 2)} miembros, el primero suma {Math.max(n, 2)}, el segundo {Math.max(n, 2) - 1}… y el último 1. Quien no hace equipo suma 0. Cada sala cuenta también para tu nivel. La liga no se acaba sola: la termina @{info.creador}.
                </span>
              </Panel>

              {/* Terminar / salir */}
              {info.estado === 'activa' &&
                (confirmar ? (
                  <Panel style={{ gap: 10, border: '1px solid rgba(255,138,138,0.4)' }}>
                    <span style={{ fontSize: 13.5, color: S.TEXT, lineHeight: 1.5 }}>
                      {confirmar === 'terminar' ? '¿Seguro que quieres terminar la liga? La clasificación se queda como está y no se juegan más jornadas.' : '¿Seguro que quieres salir de la liga?'}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" onClick={() => setConfirmar(null)} style={{ ...S.secondaryLinkButton, flex: 1, marginTop: 0 }}>
                        No
                      </button>
                      <button type="button" onClick={() => void terminarOSalir(confirmar)} style={{ ...S.secondaryLinkButton, flex: 1, marginTop: 0, borderColor: '#FF8A8A', color: '#FF8A8A' }}>
                        {confirmar === 'terminar' ? 'Sí, terminarla' : 'Sí, salir'}
                      </button>
                    </div>
                  </Panel>
                ) : (
                  <button type="button" onClick={() => setConfirmar(info.soy_creador ? 'terminar' : 'salir')} style={{ background: 'none', border: 'none', color: '#FF8A8A', fontSize: 13, cursor: 'pointer', padding: 8 }}>
                    {info.soy_creador ? 'Terminar la liga' : 'Salir de la liga'}
                  </button>
                ))}
            </>
          )}
        </>
      )}
    </MarcoV2>
  );
}

export default function PaginaLigaPrivada() {
  return (
    <Suspense fallback={<Cargando />}>
      <LigaPrivada />
    </Suspense>
  );
}

// Publicar la sala de una jornada / torneo: solo se elige cuál (31/10, Iñi).
function PublicarSala({ ligaId, deporte, onHecho }: { ligaId: string; deporte: 'futbol' | 'golf' | 'tenis'; onHecho: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState<Disponible[] | null>(null);
  const [elegida, setElegida] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  async function abrir() {
    setAbierto(true);
    setHecho(null);
    const { data } = await supabase.rpc('lp_competiciones_para_liga', { p_liga: ligaId });
    setLista((data as Disponible[]) ?? []);
  }
  async function publicar() {
    if (!elegida) return;
    setEnviando(true);
    setError(null);
    const { error: e } = await supabase.rpc('lp_publicar_sala', { p_liga: ligaId, p_competicion: elegida });
    setEnviando(false);
    if (e) return setError(mensajeError(e));
    setHecho(jornadaBonita(elegida, deporte));
    setElegida(null);
    setAbierto(false);
    onHecho();
  }

  if (!abierto) {
    return (
      <>
        {hecho && <span style={{ fontSize: 13, color: VERDE, fontWeight: 700 }}>✓ Sala de {hecho} publicada. Ya pueden hacer su equipo.</span>}
        <button type="button" onClick={() => void abrir()} style={{ ...S.primaryButton, background: '#A78BFA', marginTop: 0 }}>
          ＋ Publicar sala
        </button>
      </>
    );
  }
  const libres = (lista ?? []).filter((d) => !d.ya);
  const ya = (lista ?? []).filter((d) => d.ya);
  return (
    <Panel style={{ gap: 10, border: '1.5px solid #A78BFA' }}>
      <span style={{ fontWeight: 800, fontSize: 15, color: S.TEXT }}>¿{deporte === 'futbol' ? 'De qué jornada' : 'De qué torneo'} es la sala?</span>
      <span style={{ fontSize: 12, color: S.MUTED_2, lineHeight: 1.45, marginTop: -6 }}>Juegan todos los de la liga y puntúa para la clasificación. Solo puede haber una sala por {deporte === 'futbol' ? 'jornada' : 'torneo'}.</span>
      {lista === null ? (
        <Cargando compacto />
      ) : libres.length === 0 ? (
        <span style={{ fontSize: 13, color: S.MUTED_2 }}>Ahora mismo no hay {deporte === 'futbol' ? 'jornadas' : 'torneos'} disponibles{ya.length ? ' que no tengan ya su sala' : ''}.</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {libres.map((d) => (
            <button
              key={d.competicion}
              type="button"
              onClick={() => setElegida(d.competicion)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', background: elegida === d.competicion ? 'rgba(167,139,250,0.14)' : 'transparent', border: `1.5px solid ${elegida === d.competicion ? '#A78BFA' : S.BORDER}` }}
            >
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontWeight: 800, fontSize: 14, color: S.TEXT }}>{jornadaBonita(d.competicion, deporte)}</span>
                <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>
                  Empieza {fecha(d.cierre)}
                  {!d.con_jugadores ? (deporte === 'tenis' ? ' · cuadro pendiente' : ' · jugadores pendientes') : ''}
                </span>
              </span>
              <span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${elegida === d.competicion ? '#A78BFA' : S.BORDER}`, background: elegida === d.competicion ? '#A78BFA' : 'transparent', flexShrink: 0 }} />
            </button>
          ))}
        </div>
      )}
      {ya.length > 0 && <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>Ya tienen sala: {ya.map((d) => jornadaBonita(d.competicion, deporte)).join(', ')}.</span>}
      {error && <p style={S.errorText}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => setAbierto(false)} style={{ ...S.secondaryLinkButton, flex: 1, marginTop: 0 }}>
          Cancelar
        </button>
        <button type="button" disabled={!elegida || enviando} onClick={() => void publicar()} style={{ ...S.primaryButton, flex: 1, marginTop: 0, background: '#A78BFA', opacity: !elegida || enviando ? 0.5 : 1 }}>
          {enviando ? 'Publicando…' : 'Publicar'}
        </button>
      </div>
    </Panel>
  );
}
