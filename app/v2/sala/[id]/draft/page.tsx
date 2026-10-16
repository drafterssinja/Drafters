'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { todasLasFilas } from '@/lib/paginar';
import * as S from '@/lib/mockupStyles';
import MarcoV2, { EtiquetaBeta, Panel, Titulo, V2_COLOR } from '@/components/v2/MarcoV2';
import { useSesionV2 } from '@/components/v2/useSesionV2';
import SorteoDraft from '@/components/v2/SorteoDraft';
import CampoAlineacion from '@/components/v2/CampoAlineacion';
import SelectorDraft, { MAX_POR_EQUIPO_DRAFT, type PartidoDraft } from '@/components/v2/SelectorDraft';
import { lineaDePosicion, type LineaFutbol } from '@/lib/salaShared';
import { reproducirSonidoAviso } from '@/lib/sonidoAviso';
import { TAMANO_EQUIPO_V2, alineacionPosible, cadaXSegundos, fechaCorta, mensajeError, ordenDeRonda, turnoDraft, type Amistoso, type AmistosoJornada, type Resumen } from '@/lib/v2';

// ============================================================================
// DRAFTERS V2 — SALA DEL DRAFT (15/10)
// ============================================================================
// Pedido de Iñi: sala cerrada; cada uno marca "estoy listo"; cuando lo están
// todos, sorteo animado del orden y se elige un jugador por turno, sin
// repetir. En cada ronda el orden rota (el 1º pasa al último y los demás
// suben uno) hasta completar los equipos (11 en fútbol, 5 en golf).
// 16/10 (Iñi): partidos a la izquierda y jugadores a la derecha (SelectorDraft),
// máximo 2 jugadores del mismo equipo, el turno fijo arriba al desplazarte y un
// aviso "@fulano ha cogido a X" cada vez que alguien elige.

type Draft = { listos: string[]; orden: string[] | null; iniciado_en: string | null; terminado_en: string | null };
type Pick = { numero: number; usuario_id: string; jugador_id: string };
type Jug = { id: string; nombre: string; posicion: string | null; precio: number; equipo_real: string | null; lesionado: boolean };


export default function V2Draft() {
  const { id } = useParams<{ id: string }>();
  const competicion = useSearchParams().get('c') ?? '';
  const { perfil, estado } = useSesionV2();
  const [amistoso, setAmistoso] = useState<Amistoso | null>(null);
  const [jornada, setJornada] = useState<AmistosoJornada | null>(null);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [jugadores, setJugadores] = useState<Jug[]>([]);
  const [verSorteo, setVerSorteo] = useState(false);
  const [partidos, setPartidos] = useState<PartidoDraft[]>([]);
  const [candidato, setCandidato] = useState<Jug | null>(null);
  const [equipoVisto, setEquipoVisto] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const miId = perfil?.id ?? '';
  const claveSorteo = `v2_sorteo_${id}_${competicion}`;

  const cargarEstado = useCallback(async () => {
    const [{ data: d }, { data: ps }, { data: r }] = await Promise.all([
      supabase.from('amistoso_draft').select('listos,orden,iniciado_en,terminado_en').eq('amistoso_id', id).eq('competicion', competicion).maybeSingle(),
      supabase.from('amistoso_picks').select('numero,usuario_id,jugador_id').eq('amistoso_id', id).eq('competicion', competicion).order('numero'),
      supabase.rpc('amistoso_resumen', { p_amistoso: id }),
    ]);
    setDraft((d as Draft) ?? null);
    setPicks((ps as Pick[]) ?? []);
    if (r) setResumen(r as Resumen);
  }, [id, competicion]);

  useEffect(() => {
    if (estado !== 'ok') return;
    (async () => {
      const [{ data: a }, { data: j }] = await Promise.all([
        supabase.from('amistosos').select('*').eq('id', id).maybeSingle(),
        supabase.from('amistoso_jornadas').select('*').eq('amistoso_id', id).eq('competicion', competicion).maybeSingle(),
      ]);
      const am = a as Amistoso | null;
      const jo = j as AmistosoJornada | null;
      if (!am || !jo) {
        setError('No se ha encontrado este draft.');
        return;
      }
      const { data: js } = await todasLasFilas<Jug & { baja: boolean | null }>((d, h) =>
        supabase.from('jugadores').select('id,nombre,posicion,precio,equipo_real,lesionado,baja').eq('competicion', competicion).eq('deporte', am.deporte).order('precio', { ascending: false }).order('id').range(d, h)
      );
      const permitidos = jo.equipos_permitidos ? new Set(jo.equipos_permitidos) : null;
      setJugadores(js.filter((x) => !x.baja && (!permitidos || (x.equipo_real && permitidos.has(x.equipo_real)))));
      if (am.deporte === 'futbol') {
        const { data: cs } = await supabase.from('cuotas_partido_futbol').select('equipo_local,equipo_visitante').eq('competicion', competicion);
        setPartidos(
          ((cs as { equipo_local: string; equipo_visitante: string }[]) ?? [])
            .filter((c) => !permitidos || (permitidos.has(c.equipo_local) && permitidos.has(c.equipo_visitante)))
            .map((c) => ({ local: c.equipo_local, visitante: c.equipo_visitante }))
        );
      }
      setAmistoso(am);
      setJornada(jo);
    })();
  }, [estado, id, competicion]);

  // Ritmo de refresco: rápido durante el draft, más tranquilo antes.
  const enMarcha = !!draft?.iniciado_en && !draft?.terminado_en;
  useEffect(() => {
    if (estado !== 'ok') return;
    void cargarEstado();
    return cadaXSegundos(cargarEstado, enMarcha ? 2.5 : 4);
  }, [estado, cargarEstado, enMarcha]);

  // El sorteo se ve una vez por persona y draft.
  useEffect(() => {
    if (!draft?.iniciado_en || draft.terminado_en) return;
    try {
      if (!localStorage.getItem(claveSorteo)) setVerSorteo(true);
    } catch {
      setVerSorteo(true);
    }
  }, [draft?.iniciado_en, draft?.terminado_en, claveSorteo]);

  function cerrarSorteo() {
    setVerSorteo(false);
    try {
      localStorage.setItem(claveSorteo, '1');
    } catch {}
  }

  const n = draft?.orden?.length ?? 0;
  const tamano = TAMANO_EQUIPO_V2[amistoso?.deporte ?? 'golf'];
  const totalPicks = n * tamano;
  const numero = picks.length;
  const turno = draft?.orden && numero < totalPicks ? turnoDraft(draft.orden, numero) : null;
  const ronda = n ? Math.floor(numero / n) : 0;
  const esMiTurno = !!turno && turno === miId && !draft?.terminado_en;
  const nombres = resumen?.nombres ?? {};
  const futbol = amistoso?.deporte === 'futbol';

  // Aviso (sonido + vibración) cuando pasa a ser tu turno.
  const turnoPrevio = useRef<string | null>(null);
  useEffect(() => {
    if (esMiTurno && turnoPrevio.current !== `${numero}`) {
      turnoPrevio.current = `${numero}`;
      try {
        reproducirSonidoAviso();
        navigator.vibrate?.([80, 60, 80]);
      } catch {}
    }
  }, [esMiTurno, numero]);

  const porId = useMemo(() => new Map(jugadores.map((j) => [j.id, j])), [jugadores]);
  const elegidoPor = useMemo(() => new Map(picks.map((p) => [p.jugador_id, p.usuario_id])), [picks]);
  const misPicks = picks.filter((p) => p.usuario_id === miId).map((p) => porId.get(p.jugador_id)).filter(Boolean) as Jug[];
  const conteo = (lista: Jug[]) => {
    const c = { POR: 0, DEF: 0, MED: 0, DEL: 0 };
    lista.forEach((j) => (c[lineaDePosicion(j.posicion)] += 1));
    return c;
  };
  const miConteo = conteo(misPicks);
  // ¿Puedo coger a alguien de esta línea sin quedarme sin alineación posible?
  const lineaPosible = (l: LineaFutbol) => !futbol || alineacionPosible({ ...miConteo, [l]: miConteo[l] + 1 }, false) !== null;

  // Cuántos llevo de cada equipo real (máximo 2 en fútbol).
  const miPorEquipo = useMemo(() => {
    const m = new Map<string, number>();
    misPicks.forEach((j) => j.equipo_real && m.set(j.equipo_real, (m.get(j.equipo_real) ?? 0) + 1));
    return m;
  }, [misPicks]);
  const puedoCoger = (j: Jug) => !elegidoPor.has(j.id) && (!futbol || (lineaPosible(lineaDePosicion(j.posicion)) && (!j.equipo_real || (miPorEquipo.get(j.equipo_real) ?? 0) < MAX_POR_EQUIPO_DRAFT)));
  const sinOpciones = esMiTurno && jugadores.length > 0 && !jugadores.some(puedoCoger);

  // ---- Turno fijo arriba al desplazarte (16/10) ----
  const tarjetaTurnoRef = useRef<HTMLDivElement | null>(null);
  const [turnoFijo, setTurnoFijo] = useState(false);
  useEffect(() => {
    const comprobar = () => {
      const el = tarjetaTurnoRef.current;
      setTurnoFijo(!!el && el.getBoundingClientRect().bottom < 0);
    };
    comprobar();
    window.addEventListener('scroll', comprobar, { passive: true });
    window.addEventListener('resize', comprobar);
    return () => {
      window.removeEventListener('scroll', comprobar);
      window.removeEventListener('resize', comprobar);
    };
  }, [enMarcha]);

  // ---- Aviso "@fulano ha cogido a X" cada vez que alguien elige (16/10) ----
  const vistosPicks = useRef<number | null>(null);
  const [anuncios, setAnuncios] = useState<Pick[]>([]);
  useEffect(() => {
    if (!draft) return;
    if (vistosPicks.current === null) {
      vistosPicks.current = picks.length; // al entrar no se repiten las elecciones de antes
      return;
    }
    if (picks.length > vistosPicks.current) {
      const nuevos = picks.slice(vistosPicks.current);
      vistosPicks.current = picks.length;
      setAnuncios((a) => [...a, ...nuevos].slice(-4));
    } else if (picks.length < vistosPicks.current) {
      vistosPicks.current = picks.length;
    }
  }, [picks, draft]);
  const anuncio = anuncios[0] ?? null;
  useEffect(() => {
    if (!anuncio) return;
    const t = window.setTimeout(() => setAnuncios((a) => a.slice(1)), anuncios.length > 1 ? 1800 : 3200);
    return () => window.clearTimeout(t);
  }, [anuncio, anuncios.length]);

  async function elegir() {
    if (!candidato) return;
    setEnviando(true);
    setError(null);
    const { error: e } = await supabase.rpc('amistoso_draft_elegir', { p_amistoso: id, p_competicion: competicion, p_jugador: candidato.id });
    setEnviando(false);
    if (e) setError(mensajeError(e));
    setCandidato(null);
    await cargarEstado();
  }

  async function marcarListo(listo: boolean) {
    setError(null);
    const { error: e } = await supabase.rpc('amistoso_draft_listo', { p_amistoso: id, p_competicion: competicion, p_listo: listo });
    if (e) setError(mensajeError(e));
    await cargarEstado();
  }

  const cargando = !amistoso || !jornada || !resumen || !draft;
  const participantes = resumen?.participantes ?? [];
  const llena = !!amistoso && participantes.length >= amistoso.num_jugadores;
  const estoyListo = !!draft?.listos.includes(miId);

  return (
    <MarcoV2 perfil={perfil} estado={estado} deporte={amistoso?.deporte ?? 'futbol'} volverA={`/v2/sala/${id}`}>
      {verSorteo && draft?.orden && <SorteoDraft orden={draft.orden} nombres={nombres} miId={miId} onTerminar={cerrarSorteo} />}

      {/* Turno fijo arriba mientras te desplazas por la lista (16/10, Iñi) */}
      {enMarcha && turnoFijo && turno && (
        <div style={{ position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 'var(--page-max-width)', zIndex: 60, boxSizing: 'border-box', padding: '8px 16px', background: esMiTurno ? 'linear-gradient(135deg, #0F3320, #12452A)' : 'linear-gradient(135deg, #1E1838, #2A1F4D)', borderBottom: `2px solid ${esMiTurno ? S.ACCENT : V2_COLOR}`, boxShadow: '0 8px 20px rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', gap: 10, minHeight: 52 }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: S.MUTED_2, whiteSpace: 'nowrap' }}>
            R{ronda + 1} · {numero + 1}/{totalPicks}
          </span>
          <span style={{ flex: 1, minWidth: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontStyle: 'italic', fontSize: 22, color: esMiTurno ? S.ACCENT : S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {esMiTurno ? '¡TE TOCA ELEGIR!' : `Turno de @${nombres[turno] ?? '?'}`}
          </span>
        </div>
      )}

      {/* "@fulano ha cogido a X" (16/10, Iñi) */}
      <AnimatePresence>
        {anuncio && (
          <motion.div
            key={anuncio.numero}
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10 }}
            style={{ position: 'fixed', top: 64, left: '50%', x: '-50%', zIndex: 70, width: 'calc(100% - 32px)', maxWidth: 420, pointerEvents: 'none', background: S.PANEL, border: `1.5px solid ${anuncio.usuario_id === miId ? S.ACCENT : '#F0B94D'}`, borderRadius: 14, padding: '12px 14px', boxShadow: '0 12px 30px rgba(0,0,0,0.55)', display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: anuncio.usuario_id === miId ? S.ACCENT : '#F0B94D' }}>ELECCIÓN {anuncio.numero + 1}</span>
            <span style={{ fontSize: 15, color: S.TEXT, lineHeight: 1.35 }}>
              {anuncio.usuario_id === miId ? 'Has cogido a ' : <><b>@{nombres[anuncio.usuario_id] ?? '?'}</b> ha cogido a </>}
              <b style={{ color: anuncio.usuario_id === miId ? S.ACCENT : '#F0B94D' }}>{porId.get(anuncio.jugador_id)?.nombre ?? 'un jugador'}</b>
            </span>
            {futbol && porId.get(anuncio.jugador_id) && (
              <span style={{ fontSize: 12, color: S.MUTED_2 }}>
                {lineaDePosicion(porId.get(anuncio.jugador_id)?.posicion ?? null)} · {porId.get(anuncio.jugador_id)?.equipo_real}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {cargando ? (
        <p style={{ fontSize: 14, color: error ? S.ERROR : S.MUTED }}>{error ?? 'Cargando draft...'}</p>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <EtiquetaBeta />
            <Titulo>Draft · {competicion.replace(/^.* - /, '')}</Titulo>
            <span style={{ fontSize: 12, color: S.MUTED_2 }}>
              {amistoso.nombre} · {competicion}
              {jornada.cierre ? ` · tiene que terminar antes de ${fechaCorta(jornada.cierre)}` : ''}
            </span>
          </div>
          {error && <p style={S.errorText}>{error}</p>}

          {/* ------------------------- ANTES DE EMPEZAR ------------------------- */}
          {!draft.iniciado_en && (
            <>
              <Panel>
                <span style={S.sectionLabel}>
                  Sala del draft · {draft.listos.length}/{amistoso.num_jugadores} listos
                </span>
                {participantes.map((p) => {
                  const listo = draft.listos.includes(p.usuario_id);
                  return (
                    <motion.div layout key={p.usuario_id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: S.TEXT }}>
                      <span style={{ width: 22, height: 22, borderRadius: 999, background: listo ? S.ACCENT : 'transparent', border: `1.5px solid ${listo ? S.ACCENT : S.BORDER}`, color: '#04140B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900 }}>{listo ? '✓' : ''}</span>
                      <span style={{ flex: 1 }}>
                        @{p.nombre}
                        {p.usuario_id === miId ? ' (tú)' : ''}
                      </span>
                      <span style={{ fontSize: 11, color: listo ? S.ACCENT : S.MUTED_3 }}>{listo ? 'Listo' : 'Esperando'}</span>
                    </motion.div>
                  );
                })}
                {Array.from({ length: Math.max(0, amistoso.num_jugadores - participantes.length) }).map((_, i) => (
                  <div key={i} style={{ fontSize: 12.5, color: S.FAINT }}>
                    Hueco libre
                  </div>
                ))}
                <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, border: `1.5px solid ${estoyListo ? S.ACCENT : V2_COLOR}`, background: estoyListo ? 'rgba(61,220,132,0.1)' : 'rgba(167,139,250,0.08)', cursor: 'pointer', marginTop: 6 }}>
                  <input type="checkbox" checked={estoyListo} onChange={(e) => marcarListo(e.target.checked)} style={{ width: 22, height: 22, accentColor: S.ACCENT }} />
                  <span style={{ fontWeight: 800, fontSize: 14.5, color: S.TEXT }}>Estoy listo para el draft</span>
                </label>
                <span style={{ fontSize: 12, color: S.MUTED_2, lineHeight: 1.5 }}>
                  {llena ? 'Cuando estéis todos listos se sortea el orden y empieza el draft. Quédate en esta pantalla.' : `Falta gente: el draft empieza cuando la sala esté llena (${participantes.length}/${amistoso.num_jugadores}) y todos listos.`}
                </span>
              </Panel>
              <Panel>
                <span style={S.sectionLabel}>Cómo funciona</span>
                <span style={{ fontSize: 12.5, color: S.MUTED, lineHeight: 1.6 }}>
                  Cada uno elige un jugador en su turno y nadie puede repetir.{futbol ? ` Como mucho ${MAX_POR_EQUIPO_DRAFT} jugadores del mismo equipo.` : ''} En cada ronda el orden rota: el que eligió primero pasa al último y los demás suben un puesto. Se sigue hasta completar los equipos ({tamano} jugadores
                  {futbol ? ' en una alineación válida: 4-3-3, 4-4-2, 4-5-1, 5-4-1 o 3-4-3' : ''}).
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: S.MUTED_2 }}>
                  {[0, 1, 2].map((r) => (
                    <div key={r}>
                      Ronda {r + 1}: {ordenDeRonda(['A', 'B', 'C', 'D'], r).join(' → ')}
                    </div>
                  ))}
                </div>
              </Panel>
            </>
          )}

          {/* ------------------------- DRAFT EN MARCHA / TERMINADO ------------------------- */}
          {draft.iniciado_en && draft.orden && (
            <>
              {!draft.terminado_en ? (
                <motion.div
                  ref={tarjetaTurnoRef}
                  key={numero}
                  initial={{ scale: 0.96, opacity: 0.6 }}
                  animate={{ scale: 1, opacity: 1 }}
                  style={{
                    borderRadius: 16,
                    padding: '16px 18px',
                    background: esMiTurno ? 'linear-gradient(135deg, #0F3320, #12452A)' : 'linear-gradient(135deg, #1E1838, #2A1F4D)',
                    border: `1.5px solid ${esMiTurno ? S.ACCENT : V2_COLOR}`,
                    boxShadow: esMiTurno ? '0 0 26px rgba(61,220,132,0.35)' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: S.MUTED_2 }}>
                    RONDA {ronda + 1} DE {tamano} · ELECCIÓN {numero + 1} DE {totalPicks}
                  </span>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontStyle: 'italic', fontSize: 30, color: esMiTurno ? S.ACCENT : S.TEXT }}>{esMiTurno ? '¡TE TOCA ELEGIR!' : `Turno de @${nombres[turno ?? ''] ?? '?'}`}</span>
                </motion.div>
              ) : (
                <Panel style={{ borderColor: S.ACCENT }}>
                  <span style={{ fontWeight: 800, fontSize: 16, color: S.ACCENT }}>✅ Draft terminado</span>
                  <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>Los equipos ya están hechos. La clasificación se ve en la sala cuando empiece la jornada.</span>
                  <Link href={`/v2/sala/${id}`} style={{ ...S.primaryButton, background: V2_COLOR, textAlign: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    Volver a la sala
                  </Link>
                </Panel>
              )}

              {/* Orden de esta ronda */}
              {!draft.terminado_en && (
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                  {ordenDeRonda(draft.orden, ronda).map((u, i) => {
                    const ya = i < numero % n;
                    const ahora = i === numero % n;
                    return (
                      <motion.div layout key={`${ronda}-${u}`} style={{ flexShrink: 0, padding: '6px 10px', borderRadius: 10, fontSize: 12, fontWeight: 700, border: `1.5px solid ${ahora ? '#F0B94D' : S.CARD_BORDER}`, background: ahora ? 'rgba(240,185,77,0.12)' : 'transparent', color: ya ? S.FAINT : u === miId ? S.ACCENT : S.TEXT }}>
                        {i + 1}. @{nombres[u] ?? '?'}
                      </motion.div>
                    );
                  })}
                  {ronda + 1 < tamano && <span style={{ flexShrink: 0, alignSelf: 'center', fontSize: 11, color: S.MUTED_3, paddingLeft: 4 }}>Siguiente ronda empieza @{nombres[ordenDeRonda(draft.orden, ronda + 1)[0]] ?? '?'}</span>}
                </div>
              )}

              {/* Equipos */}
              <Panel>
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
                  {draft.orden.map((u) => {
                    const cuantos = picks.filter((p) => p.usuario_id === u).length;
                    const activo = (equipoVisto || miId) === u;
                    return (
                      <button key={u} type="button" onClick={() => setEquipoVisto(u)} style={{ ...S.pill(activo), flexShrink: 0 }}>
                        @{nombres[u] ?? '?'} {cuantos}/{tamano}
                      </button>
                    );
                  })}
                </div>
                {(() => {
                  const u = equipoVisto || miId;
                  const suyos = picks.filter((p) => p.usuario_id === u);
                  if (suyos.length === 0) return <span style={{ fontSize: 12.5, color: S.MUTED_3 }}>Todavía no ha elegido a nadie.</span>;
                  const js = suyos.map((p) => ({ p, j: porId.get(p.jugador_id) }));
                  const c = conteo(js.map((x) => x.j).filter(Boolean) as Jug[]);
                  // 16/10 (Iñi): con el draft terminado, cada equipo se ve dibujado en un campo.
                  if (draft.terminado_en && futbol) {
                    return <CampoAlineacion key={u} titulo={`@${nombres[u] ?? '?'}${u === miId ? ' (tú)' : ''}`} jugadores={js.map((x) => x.j).filter(Boolean) as Jug[]} />;
                  }
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {futbol && (
                        <span style={{ fontSize: 11, color: S.MUTED_3 }}>
                          POR {c.POR} · DEF {c.DEF} · MED {c.MED} · DEL {c.DEL}
                          {suyos.length === tamano ? ` · ${alineacionPosible(c, true) ?? ''}` : ''}
                        </span>
                      )}
                      <AnimatePresence initial={false}>
                        {js.map(({ p, j }) => (
                          <motion.div key={p.numero} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} style={{ display: 'flex', gap: 8, fontSize: 13, color: S.TEXT }}>
                            <span style={{ width: 26, fontSize: 11, color: S.MUTED_3 }}>#{p.numero + 1}</span>
                            {futbol && <span style={{ width: 30, fontSize: 10.5, fontWeight: 700, color: S.MUTED_2 }}>{lineaDePosicion(j?.posicion ?? null)}</span>}
                            <span style={{ flex: 1 }}>{j?.nombre ?? '...'}</span>
                            {futbol && <span style={{ fontSize: 11, color: S.MUTED_3 }}>{j?.equipo_real}</span>}
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  );
                })()}
              </Panel>

              {/* Últimas elecciones */}
              {picks.length > 0 && !draft.terminado_en && (
                <span style={{ fontSize: 12, color: S.MUTED_2 }}>
                  Última: @{nombres[picks[picks.length - 1].usuario_id] ?? '?'} eligió a <b style={{ color: S.TEXT }}>{porId.get(picks[picks.length - 1].jugador_id)?.nombre ?? '...'}</b>
                </span>
              )}

              {/* Jugadores disponibles: partidos a la izquierda, jugadores a la derecha (16/10) */}
              {!draft.terminado_en && (
                <>
                  {sinOpciones && (
                    <p style={{ ...S.errorText, fontSize: 12.5 }}>
                      No te queda ningún jugador que encaje (línea llena o ya tienes {MAX_POR_EQUIPO_DRAFT} de cada equipo que queda). Avisa al administrador de la sala.
                    </p>
                  )}
                  <SelectorDraft
                    jugadores={jugadores}
                    partidos={partidos}
                    futbol={futbol}
                    elegidoPor={elegidoPor}
                    nombres={nombres}
                    esMiTurno={esMiTurno}
                    miConteo={miConteo}
                    miPorEquipo={miPorEquipo}
                    lineaPosible={lineaPosible}
                    topOffset={64}
                    onElegir={(j) => setCandidato(porId.get(j.id) ?? null)}
                  />
                </>
              )}
            </>
          )}

          {/* Confirmación de la elección */}
          <AnimatePresence>
            {candidato && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setCandidato(null)} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                <motion.div initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }} onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: S.PANEL, borderTop: `2px solid ${S.ACCENT}`, borderRadius: '18px 18px 0 0', padding: '20px 20px 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span style={{ fontSize: 12, color: S.MUTED_2 }}>¿Eliges a...?</span>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 28, color: S.TEXT }}>{candidato.nombre}</span>
                  {futbol && (
                    <span style={{ fontSize: 12.5, color: S.MUTED }}>
                      {lineaDePosicion(candidato.posicion)} · {candidato.equipo_real}
                    </span>
                  )}
                  <button type="button" onClick={elegir} disabled={enviando} style={{ ...S.primaryButton, opacity: enviando ? 0.6 : 1 }}>
                    {enviando ? 'Eligiendo...' : 'Sí, lo elijo'}
                  </button>
                  <button type="button" onClick={() => setCandidato(null)} style={S.secondaryLinkButton}>
                    Cancelar
                  </button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </MarcoV2>
  );
}
