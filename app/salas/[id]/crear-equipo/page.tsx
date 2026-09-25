'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { EQUIPO_PRESUPUESTO, TAMANO_EQUIPO_GOLF_TENIS, FORMACIONES_FUTBOL, colorPresupuesto } from '@/lib/draftConfig';
import { formatEuros, inicialesJugador, huecosPorLinea, lineaDePosicion, type LineaFutbol } from '@/lib/salaShared';
import { tablaPuntuacionPorDeporte } from '@/lib/puntuaciones';

// ============================================================================
// CREAR EQUIPO EN UNA SALA (isCrearEquipo + isConfirmarEquipo de Main.dc.html,
// líneas 883-1174) — elegir jugadores uno a uno dentro del presupuesto de
// fantasía de 100.000 € (lib/draftConfig.ts), con el mismo panel lateral
// "Tu equipo" animado (slotPop) y la misma barra de presupuesto que cambia
// de color según lo que quede (colorPresupuesto). Es un único componente
// con estado interno de "paso" (draft/confirm) para no tener que serializar
// la selección en curso entre dos rutas.
//
// Adaptación respecto a la maqueta (25/09, ya corregida): la maqueta filtra
// la lista de fútbol por "partidos de la jornada" (futbolPartidosList) — al
// principio no existía ese dato en el modelo real, así que la lista se
// agrupaba solo por posición. Ahora que las cuotas 1X2 de cada jornada se
// cargan y se guardan en cuotas_partido_futbol (ver "Nuevo torneo o
// jornada" en /admin), se recupera el filtro de partidos de la maqueta: una
// columna a la izquierda con los partidos de la jornada para elegir cuáles
// ver, y la lista de jugadores (agrupada por línea, como antes) a la
// derecha, filtrada a los equipos de los partidos marcados.

type SalaRow = {
  id: string;
  nombre: string;
  competicion: string;
  deporte: string;
  tipo: string;
  aforo: number | null;
  buy_in: number;
  estado: string;
};

type JugadorRow = { id: string; nombre: string; posicion: string | null; precio: number; lesionado: boolean; equipo_real: string | null };
type PartidoRow = { equipo_local: string; equipo_visitante: string; cuota_1: number; cuota_x: number; cuota_2: number };

const AVATAR_POR_LINEA: Record<LineaFutbol, string> = { POR: '#FF7A45', DEF: '#8FB6FF', MED: '#F0B94D', DEL: '#3DDC84' };
const LINEAS_ORDEN: LineaFutbol[] = ['DEL', 'MED', 'DEF', 'POR'];
const POSICION_LABEL: Record<LineaFutbol, string> = { POR: 'Portero', DEF: 'Defensa', MED: 'Centrocampista', DEL: 'Delantero' };
const POSICION_LABEL_PLURAL: Record<LineaFutbol, string> = { POR: 'Porteros', DEF: 'Defensas', MED: 'Centrocampistas', DEL: 'Delanteros' };

// Cuántos jugadores se ven por defecto en cada línea antes del botón
// "Mostrar más" (pedido de Iñi, 25/09 tercera vuelta: "en porteros que se
// vean los 20 con más valor... en defensas pues los 50 mejores"). Solo dio
// ejemplos explícitos de porteros y defensas — se aplica el mismo criterio
// de "50" al resto de líneas por consistencia (son igual de numerosas).
const MOSTRAR_TOP_N: Record<LineaFutbol, number> = { POR: 20, DEF: 50, MED: 50, DEL: 50 };

// Mismo patrón para golf/tenis, que no se agrupan por posición (inferencia
// propia, no pedida explícitamente por Iñi para estos dos deportes — solo
// describió posiciones de fútbol — pero mantiene consistente la pantalla
// cuando hay muchos jugadores en el listado plano).
const MOSTRAR_TOP_N_FLAT = 50;

function partidoKey(p: { equipo_local: string; equipo_visitante: string }): string {
  return `${p.equipo_local}|||${p.equipo_visitante}`;
}

function normalizarBusqueda(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export default function CrearEquipoPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const salaId = params.id;

  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [sala, setSala] = useState<SalaRow | null>(null);
  const [jugadores, setJugadores] = useState<JugadorRow[]>([]);
  const [partidos, setPartidos] = useState<PartidoRow[]>([]);
  const [partidosSeleccionados, setPartidosSeleccionados] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string[]>([]);
  const [alineacion, setAlineacion] = useState<string>('4-3-3');
  // 'info' (25/09, tercera vuelta): pantalla previa "cómo puntúan los
  // jugadores" que se ve siempre antes de la selección — pedido de Iñi
  // "para que la gente se vaya conociéndolo" — con un botón "Entendido" que
  // lleva a 'draft'. Se muestra en los tres deportes.
  const [step, setStep] = useState<'info' | 'draft' | 'confirm'>('info');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  // Buscador de nombre de jugador (25/09, tercera vuelta) — "para todos los
  // deportes... incluir un buscador... que se vaya filtrando según lo que
  // escribes".
  const [busqueda, setBusqueda] = useState('');

  // Desplegables por línea (fútbol) — abiertas por defecto, y con un tope de
  // jugadores visibles hasta pulsar "Mostrar más" (pedido de Iñi, ver
  // MOSTRAR_TOP_N arriba).
  const [lineasAbiertas, setLineasAbiertas] = useState<Record<LineaFutbol, boolean>>({ POR: true, DEF: true, MED: true, DEL: true });
  const [lineasExpandidas, setLineasExpandidas] = useState<Record<LineaFutbol, boolean>>({ POR: false, DEF: false, MED: false, DEL: false });

  // Mismo tope para el listado plano de golf/tenis.
  const [mostrarTodosFlat, setMostrarTodosFlat] = useState(false);

  useEffect(() => {
    let activo = true;

    async function cargar() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }

      const [{ data: perfilData }, { data: salaData }] = await Promise.all([
        supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
        supabase.from('salas').select('id,nombre,competicion,deporte,tipo,aforo,buy_in,estado').eq('id', salaId).single(),
      ]);

      if (!activo) return;
      if (perfilData) setPerfil(perfilData as Perfil);

      if (!salaData) {
        setError('No se ha encontrado esta sala.');
        setCargando(false);
        return;
      }
      const salaRow = salaData as SalaRow;

      if (salaRow.estado === 'completa' || salaRow.estado === 'finalizada') {
        // replace, no push: esto es un redirect de "no deberías estar aquí",
        // no una navegación del usuario — con push, la flecha "volver" de la
        // cabecera (que usa el historial) rebotaba de vuelta a esta misma
        // pantalla en vez de salir a /salas (bug reportado por Iñi, 23/09).
        router.replace(`/salas/${salaId}`);
        return;
      }

      const [{ data: miEquipoData }, { data: jugData }, { data: partidosData }] = await Promise.all([
        supabase.from('equipos').select('id, inscripciones(estado)').eq('sala_id', salaId).eq('usuario_id', session.user.id).maybeSingle(),
        supabase.from('jugadores').select('id,nombre,posicion,precio,lesionado,equipo_real').eq('deporte', salaRow.deporte).eq('competicion', salaRow.competicion).order('precio', { ascending: false }),
        salaRow.deporte === 'futbol'
          ? supabase.from('cuotas_partido_futbol').select('equipo_local,equipo_visitante,cuota_1,cuota_x,cuota_2').eq('competicion', salaRow.competicion)
          : Promise.resolve({ data: [] as PartidoRow[] }),
      ]);

      if (!activo) return;

      const miEquipo = miEquipoData as { id: string; inscripciones: { estado: string }[] } | null;
      if (miEquipo && miEquipo.inscripciones.some((i) => i.estado !== 'reembolsada')) {
        router.replace(`/salas/${salaId}`);
        return;
      }

      setSala(salaRow);
      setJugadores((jugData as JugadorRow[]) ?? []);
      setPartidos((partidosData as PartidoRow[] | null) ?? []);
      setCargando(false);
    }

    cargar();
    return () => {
      activo = false;
    };
  }, [router, salaId]);

  const isFutbol = sala?.deporte === 'futbol';
  const huecos = useMemo(() => huecosPorLinea(isFutbol ? alineacion : null), [isFutbol, alineacion]);
  const totalHuecos = huecos.POR + huecos.DEF + huecos.MED + huecos.DEL;

  // Equipos que juegan los partidos marcados en el filtro de la izquierda —
  // null cuando no hay ninguno marcado ("Todos"), que es como se ve la
  // plantilla completa de la jornada.
  const equiposVisibles = useMemo(() => {
    if (partidosSeleccionados.size === 0) return null;
    const equipos = new Set<string>();
    partidos.forEach((p) => {
      if (partidosSeleccionados.has(partidoKey(p))) {
        equipos.add(p.equipo_local);
        equipos.add(p.equipo_visitante);
      }
    });
    return equipos;
  }, [partidos, partidosSeleccionados]);

  const terminoBusqueda = useMemo(() => normalizarBusqueda(busqueda), [busqueda]);
  const busquedaActiva = terminoBusqueda.length > 0;

  const jugadoresFiltrados = useMemo(() => {
    const base = equiposVisibles === null ? jugadores : jugadores.filter((j) => j.equipo_real && equiposVisibles.has(j.equipo_real));
    if (!busquedaActiva) return base;
    return base.filter((j) => normalizarBusqueda(j.nombre).includes(terminoBusqueda));
  }, [jugadores, equiposVisibles, busquedaActiva, terminoBusqueda]);

  // Mismo buscador para el listado plano de golf/tenis (no pasa por el
  // filtro de partidos, que es exclusivo de fútbol).
  const jugadoresGolfTenisFiltrados = useMemo(() => {
    if (!busquedaActiva) return jugadores;
    return jugadores.filter((j) => normalizarBusqueda(j.nombre).includes(terminoBusqueda));
  }, [jugadores, busquedaActiva, terminoBusqueda]);

  function togglePartido(key: string) {
    setPartidosSeleccionados((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(key)) siguiente.delete(key);
      else siguiente.add(key);
      return siguiente;
    });
  }

  const jugadoresPorId = useMemo(() => new Map(jugadores.map((j) => [j.id, j])), [jugadores]);
  const seleccionados = selected.map((id) => jugadoresPorId.get(id)).filter((j): j is JugadorRow => !!j);
  const gasto = seleccionados.reduce((suma, j) => suma + j.precio, 0);
  const restante = EQUIPO_PRESUPUESTO - gasto;
  const overBudget = restante < 0;
  const color = colorPresupuesto(restante);
  const spentPct = Math.max(0, Math.min(100, (gasto / EQUIPO_PRESUPUESTO) * 100));

  const equipoCompleto = isFutbol ? selected.length === totalHuecos : selected.length === TAMANO_EQUIPO_GOLF_TENIS;
  const puedeConfirmar = equipoCompleto && !overBudget;

  // Recuenta cuántos jugadores hay ya elegidos de cada línea (fútbol), para
  // saber si un hueco está lleno.
  const seleccionadosPorLinea = useMemo(() => {
    const mapa: Record<LineaFutbol, number> = { POR: 0, DEF: 0, MED: 0, DEL: 0 };
    seleccionados.forEach((j) => {
      mapa[lineaDePosicion(j.posicion)] += 1;
    });
    return mapa;
  }, [seleccionados]);

  function cambiarFormacion(nuevaAlineacion: string) {
    const nuevosHuecos = huecosPorLinea(nuevaAlineacion);
    setAlineacion(nuevaAlineacion);
    // Si la nueva formación tiene menos huecos en alguna línea que
    // jugadores ya elegidos ahí, se recortan los últimos que sobren.
    setSelected((prev) => {
      const conteo: Record<LineaFutbol, number> = { POR: 0, DEF: 0, MED: 0, DEL: 0 };
      const resultado: string[] = [];
      for (const id of prev) {
        const j = jugadoresPorId.get(id);
        if (!j) continue;
        const linea = lineaDePosicion(j.posicion);
        if (conteo[linea] < nuevosHuecos[linea]) {
          conteo[linea] += 1;
          resultado.push(id);
        }
      }
      return resultado;
    });
  }

  function toggleJugador(jugador: JugadorRow) {
    const yaElegido = selected.includes(jugador.id);
    if (yaElegido) {
      setSelected((prev) => prev.filter((id) => id !== jugador.id));
      return;
    }
    if (isFutbol) {
      const linea = lineaDePosicion(jugador.posicion);
      if (seleccionadosPorLinea[linea] >= huecos[linea]) return; // línea llena
      setSelected((prev) => [...prev, jugador.id]);
    } else {
      if (selected.length >= TAMANO_EQUIPO_GOLF_TENIS) return; // equipo lleno
      setSelected((prev) => [...prev, jugador.id]);
    }
  }

  async function confirmarInscripcion() {
    setEnviando(true);
    setErrorEnvio(null);
    const { error: rpcError } = await supabase.rpc('inscribirse_en_sala', {
      p_sala_id: salaId,
      p_jugadores: selected,
      p_alineacion: isFutbol ? alineacion : null,
      p_nombre_equipo: null,
    });
    if (rpcError) {
      setErrorEnvio(traducirError(rpcError.message));
      setEnviando(false);
      return;
    }
    // replace: al confirmar, esta pantalla de crear equipo deja de tener
    // sentido en el historial (si vuelves a ella, redirige otra vez a la
    // sala) — con push, la flecha de "volver" quedaba atrapada rebotando
    // entre las dos pantallas en vez de salir a /salas.
    router.replace(`/salas/${salaId}`);
  }

  if (cargando || !perfil) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader />
          <div style={{ padding: '40px 20px' }}>
            <p style={{ fontSize: 14, color: S.MUTED }}>Cargando...</p>
          </div>
        </div>
      </main>
    );
  }

  const saldoLabel = formatEuros(perfil.saldo_simulado);
  const initials = S.iniciales(perfil.nombre, perfil.apellido);

  if (error || !sala) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
          <div style={{ padding: '40px 20px' }}>
            <p style={{ fontSize: 14, color: S.ERROR }}>{error ?? 'No se ha encontrado esta sala.'}</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />

        <style jsx>{`
          .partidos-scroll::-webkit-scrollbar {
            width: 5px;
          }
          .partidos-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .partidos-scroll::-webkit-scrollbar-thumb {
            background: #2a3733;
            border-radius: 999px;
          }
          .partidos-scroll::-webkit-scrollbar-thumb:hover {
            background: #3ddc84;
          }
        `}</style>

        {step === 'info' ? (
          <PuntuacionInfoScreen deporte={sala.deporte} competicion={sala.competicion} onEntendido={() => setStep('draft')} onVolver={() => router.push(`/salas/${salaId}`)} />
        ) : step === 'draft' ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 20px 18px' }}>
              <button type="button" onClick={() => router.push(`/salas/${salaId}`)} style={backArrowStyle}>
                ←
              </button>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#F0B94D' }}>{sala.competicion}</span>
                <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT }}>Crea tu equipo</h1>
              </div>

              <div style={{ position: 'sticky', top: 0, zIndex: 5, background: S.BG, paddingTop: 2, paddingBottom: 6, margin: '0 -20px', paddingLeft: 20, paddingRight: 20 }}>
                <div style={{ background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, boxShadow: '0 10px 14px -8px rgba(0,0,0,0.5)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_2 }}>Presupuesto disponible</span>
                    <span style={{ fontSize: 11, color: S.MUTED_3 }}>
                      {selected.length}/{isFutbol ? totalHuecos : TAMANO_EQUIPO_GOLF_TENIS} elegidos
                    </span>
                  </div>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 28, color }}>{formatEuros(restante)}</span>
                  <div style={{ height: 6, borderRadius: 999, background: '#1B2420', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${spentPct}%`, background: color, borderRadius: 999 }} />
                  </div>
                </div>
              </div>

              {overBudget && (
                <div style={{ background: 'rgba(255,92,92,0.1)', border: '1px solid rgba(255,92,92,0.35)', borderRadius: 10, padding: '8px 12px' }}>
                  <span style={{ fontSize: 11, color: '#FF5C5C', fontWeight: 600 }}>Te has pasado del presupuesto de {formatEuros(EQUIPO_PRESUPUESTO)}. No podrás inscribir este equipo hasta que bajes del límite.</span>
                </div>
              )}

              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar jugador por nombre..."
                  style={{
                    width: '100%',
                    fontFamily: "'Manrope', sans-serif",
                    fontSize: 13,
                    color: S.TEXT,
                    background: S.PANEL,
                    border: `1px solid ${busqueda ? '#3DDC84' : S.BORDER}`,
                    borderRadius: 10,
                    padding: '10px 34px 10px 12px',
                  }}
                />
                {busqueda && (
                  <button
                    type="button"
                    onClick={() => setBusqueda('')}
                    aria-label="Borrar búsqueda"
                    style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', width: 24, height: 24, border: 'none', background: 'transparent', color: S.MUTED_3, fontSize: 16, cursor: 'pointer' }}
                  >
                    ×
                  </button>
                )}
              </div>

              {isFutbol ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  {partidos.length > 0 && (
                    <div className="partidos-scroll" style={{ flexShrink: 0, width: 90, display: 'flex', flexDirection: 'column', gap: 6, position: 'sticky', top: 128, maxHeight: 'calc(100vh - 160px)', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#2A3733 transparent' } as React.CSSProperties}>
                      <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3, textAlign: 'center' }}>Partidos</span>
                      <button
                        type="button"
                        onClick={() => setPartidosSeleccionados(new Set())}
                        style={{
                          fontFamily: "'Barlow Condensed', sans-serif",
                          fontWeight: 700,
                          fontSize: 11,
                          padding: '6px 4px',
                          borderRadius: 8,
                          border: `1px solid ${partidosSeleccionados.size === 0 ? '#3DDC84' : S.BORDER}`,
                          background: partidosSeleccionados.size === 0 ? 'rgba(61,220,132,0.12)' : 'transparent',
                          color: partidosSeleccionados.size === 0 ? '#3DDC84' : S.MUTED,
                          cursor: 'pointer',
                        }}
                      >
                        Todos
                      </button>
                      {partidos.map((p) => {
                        const key = partidoKey(p);
                        const activo = partidosSeleccionados.has(key);
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => togglePartido(key)}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 1,
                              fontFamily: "'Manrope', sans-serif",
                              fontWeight: 700,
                              fontSize: 9.5,
                              lineHeight: 1.25,
                              padding: '6px 5px',
                              borderRadius: 8,
                              textAlign: 'center',
                              border: `1px solid ${activo ? '#3DDC84' : S.BORDER}`,
                              background: activo ? 'rgba(61,220,132,0.12)' : S.PANEL,
                              color: activo ? '#3DDC84' : S.MUTED_2,
                              cursor: 'pointer',
                            }}
                          >
                            <span>{p.equipo_local}</span>
                            <span style={{ color: S.MUTED_3, fontSize: 8, fontWeight: 600 }}>vs</span>
                            <span>{p.equipo_visitante}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {LINEAS_ORDEN.slice()
                      .reverse()
                      .map((linea) => {
                        const filasTodas = jugadoresFiltrados.filter((j) => lineaDePosicion(j.posicion) === linea);
                        if (filasTodas.length === 0) return null;
                        const abierta = lineasAbiertas[linea];
                        const mostrarTodas = busquedaActiva || lineasExpandidas[linea];
                        const tope = MOSTRAR_TOP_N[linea];
                        const filas = mostrarTodas ? filasTodas : filasTodas.slice(0, tope);
                        const restantes = filasTodas.length - filas.length;
                        return (
                          <div key={linea} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <button
                              type="button"
                              onClick={() => setLineasAbiertas((prev) => ({ ...prev, [linea]: !prev[linea] }))}
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'transparent', border: 'none', padding: '2px 0', cursor: 'pointer' }}
                            >
                              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>
                                {POSICION_LABEL_PLURAL[linea]} · {seleccionadosPorLinea[linea]}/{huecos[linea]} · {filasTodas.length}
                              </span>
                              <span style={{ fontSize: 11, color: S.MUTED_3 }}>{abierta ? '▾' : '▸'}</span>
                            </button>
                            {abierta && (
                              <>
                                {filas.map((j) => (
                                  <PlayerRow key={j.id} jugador={j} selected={selected.includes(j.id)} disabled={!selected.includes(j.id) && seleccionadosPorLinea[linea] >= huecos[linea]} onToggle={() => toggleJugador(j)} />
                                ))}
                                {restantes > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setLineasExpandidas((prev) => ({ ...prev, [linea]: true }))}
                                    style={mostrarMasButtonStyle}
                                  >
                                    Mostrar {restantes} más
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    {jugadoresFiltrados.length === 0 && (
                      <p style={{ fontSize: 12, color: S.MUTED_3, margin: 0 }}>{busquedaActiva ? 'Ningún jugador coincide con esa búsqueda.' : 'Ningún jugador de los partidos marcados.'}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {(busquedaActiva || mostrarTodosFlat ? jugadoresGolfTenisFiltrados : jugadoresGolfTenisFiltrados.slice(0, MOSTRAR_TOP_N_FLAT)).map((j) => (
                      <PlayerRow key={j.id} jugador={j} selected={selected.includes(j.id)} disabled={!selected.includes(j.id) && selected.length >= TAMANO_EQUIPO_GOLF_TENIS} onToggle={() => toggleJugador(j)} />
                    ))}
                    {!busquedaActiva && !mostrarTodosFlat && jugadoresGolfTenisFiltrados.length > MOSTRAR_TOP_N_FLAT && (
                      <button type="button" onClick={() => setMostrarTodosFlat(true)} style={mostrarMasButtonStyle}>
                        Mostrar {jugadoresGolfTenisFiltrados.length - MOSTRAR_TOP_N_FLAT} más
                      </button>
                    )}
                    {jugadoresGolfTenisFiltrados.length === 0 && (
                      <p style={{ fontSize: 12, color: S.MUTED_3, margin: 0 }}>Ningún jugador coincide con esa búsqueda.</p>
                    )}
                  </div>

                  <div style={{ flexShrink: 0, width: 96, display: 'flex', flexDirection: 'column', gap: 6, position: 'sticky', top: 128 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3, textAlign: 'center' }}>Tu equipo</span>
                    {Array.from({ length: TAMANO_EQUIPO_GOLF_TENIS }).map((_, i) => {
                      const j = seleccionados[i];
                      return j ? (
                        <a
                          key={j.id}
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            toggleJugador(j);
                          }}
                          style={{ animation: 'slotPop 0.4s cubic-bezier(.34,1.56,.64,1) both', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'rgba(240,185,77,0.12)', border: '1px solid rgba(240,185,77,0.4)', borderRadius: 9, padding: '6px 3px', textDecoration: 'none', width: '100%' }}
                        >
                          <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#3DDC84', color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.2)' }}>
                            {inicialesJugador(j.nombre)}
                          </span>
                          <span style={{ width: '100%', fontSize: 8.5, fontWeight: 700, color: S.TEXT, textAlign: 'center', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.nombre}</span>
                          <span style={{ fontSize: 8, fontWeight: 700, color: '#F0B94D', lineHeight: 1.15 }}>{formatEuros(j.precio)}</span>
                        </a>
                      ) : (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 56, border: '1.5px dashed #2A3733', borderRadius: 9, color: '#4E574F', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12 }}>
                          {i + 1}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {isFutbol && (
              <div style={{ position: 'sticky', bottom: 0, zIndex: 10, background: S.BG, borderTop: '1px solid #1E2723', boxShadow: '0 -10px 24px rgba(0,0,0,0.5)', padding: '7px 20px 9px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto' }}>
                  <span style={{ flexShrink: 0, fontSize: 7.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Alineación</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {FORMACIONES_FUTBOL.map((f) => (
                      <button key={f.alineacion} type="button" onClick={() => cambiarFormacion(f.alineacion)} style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 11, padding: '4px 10px', borderRadius: 999, border: `1px solid ${alineacion === f.alineacion ? '#3DDC84' : S.BORDER}`, background: alineacion === f.alineacion ? 'rgba(61,220,132,0.12)' : 'transparent', color: alineacion === f.alineacion ? '#3DDC84' : S.MUTED, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ position: 'relative', background: 'linear-gradient(180deg, #163A24 0%, #0F2A1A 100%)', border: '1px solid #1E4A2C', borderRadius: 12, padding: '10px 6px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 6, minHeight: 156, overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', left: '8%', right: '8%', top: '50%', height: 1, background: 'rgba(255,255,255,0.14)' }} />
                  <div style={{ position: 'absolute', left: '50%', top: '50%', width: 36, height: 36, marginLeft: -18, marginTop: -18, border: '1px solid rgba(255,255,255,0.14)', borderRadius: '50%' }} />
                  {(['DEL', 'MED', 'DEF', 'POR'] as LineaFutbol[]).map((linea) => (
                    <div key={linea} style={{ position: 'relative', display: 'flex', gap: 2 }}>
                      {Array.from({ length: huecos[linea] }).map((_, i) => {
                        const j = seleccionados.filter((s) => lineaDePosicion(s.posicion) === linea)[i];
                        return (
                          <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center' }}>
                            {j ? (
                              <a
                                key={j.id}
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  toggleJugador(j);
                                }}
                                style={{ animation: 'slotPop 0.4s cubic-bezier(.34,1.56,.64,1) both', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, textDecoration: 'none', width: '100%', maxWidth: 46 }}
                              >
                                <span style={{ width: 19, height: 19, borderRadius: '50%', background: AVATAR_POR_LINEA[linea], color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 7.5, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid #F0B94D', boxShadow: '0 2px 6px rgba(0,0,0,0.45)' }}>
                                  {inicialesJugador(j.nombre)}
                                </span>
                                <span style={{ fontSize: 6, fontWeight: 700, color: S.TEXT, textAlign: 'center', lineHeight: 1.1, width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.nombre}</span>
                              </a>
                            ) : (
                              <div style={{ width: 19, height: 19, borderRadius: '50%', border: '1.5px dashed rgba(255,255,255,0.3)' }} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>

                <button type="button" disabled={!puedeConfirmar} onClick={() => setStep('confirm')} style={{ ...submitButtonStyle(puedeConfirmar), fontSize: 12, padding: '7px 20px', minHeight: 28, borderRadius: 8 }}>
                  {equipoCompleto ? (overBudget ? 'Supera el presupuesto' : 'Revisar e inscribirme') : `Faltan ${totalHuecos - selected.length} jugadores`}
                </button>
              </div>
            )}

            {!isFutbol && (
              <div style={{ position: 'sticky', bottom: 0, padding: '8px 20px 12px', background: 'linear-gradient(180deg, rgba(11,15,14,0) 0%, #0B0F0E 40%)' }}>
                <button type="button" disabled={!puedeConfirmar} onClick={() => setStep('confirm')} style={submitButtonStyle(puedeConfirmar)}>
                  {equipoCompleto ? (overBudget ? 'Supera el presupuesto' : 'Revisar e inscribirme') : `Faltan ${TAMANO_EQUIPO_GOLF_TENIS - selected.length} jugadores`}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '28px 20px 56px' }}>
            <button type="button" onClick={() => setStep('draft')} style={backArrowStyle}>
              ←
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#F0B94D' }}>{sala.competicion}</span>
              <h1 style={{ fontSize: 24, fontWeight: 800, color: S.TEXT }}>Confirma tu inscripción</h1>
              <p style={{ fontSize: 13, color: S.MUTED_2 }}>
                {sala.nombre} · Buy-in {formatEuros(sala.buy_in)}
              </p>
            </div>

            <div style={{ background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Tu equipo</span>
              {seleccionados.map((j) => (
                <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ flexShrink: 0, width: 32, height: 32, borderRadius: '50%', background: isFutbol ? AVATAR_POR_LINEA[lineaDePosicion(j.posicion)] : '#3DDC84', color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.2)' }}>
                    {inicialesJugador(j.nombre)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ minWidth: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.nombre}</span>
                    {j.lesionado && <span style={{ flexShrink: 0, width: 13, height: 13, borderRadius: '50%', background: '#FF5C5C' }} />}
                  </div>
                  <span style={{ flexShrink: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 13, color: '#F0B94D' }}>{formatEuros(j.precio)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #1E2723', marginTop: 4, paddingTop: 10 }}>
                <span style={{ fontSize: 13, color: S.MUTED_2 }}>Total gastado</span>
                <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 15, color: '#F0B94D' }}>{formatEuros(gasto)}</span>
              </div>
            </div>

            <p style={{ fontSize: 11, lineHeight: 1.5, color: S.MUTED_3, margin: 0 }}>
              El listado de jugadores es el oficial facilitado por la competición/circuito correspondiente. Drafters
              no se hace responsable de que algún jugador cause baja de última hora y, por tanto, no puntúe —
              recomendamos comprobar que los jugadores elegidos siguen confirmados antes de que empiece.
            </p>

            {errorEnvio && <p style={S.errorText}>{errorEnvio}</p>}

            <button type="button" disabled={enviando} onClick={confirmarInscripcion} style={{ ...submitButtonStyle(true), opacity: enviando ? 0.7 : 1 }}>
              {enviando ? 'Inscribiendo...' : 'Confirmar inscripción'}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

// Pantalla previa "cómo puntúan los jugadores" (25/09, tercera vuelta) — se
// ve siempre antes de la selección de jugadores, en los tres deportes, con
// un botón "Entendido" que lleva al draft. Usa las tablas resumen de
// lib/puntuaciones.ts (más adelante, cuando ya no haga falta mostrarla
// siempre, Iñi pidió dejar solo un enlace a esta misma tabla).
function PuntuacionInfoScreen({ deporte, competicion, onEntendido, onVolver }: { deporte: string; competicion: string; onEntendido: () => void; onVolver: () => void }) {
  const tablas = tablaPuntuacionPorDeporte(deporte);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 20px 100px' }}>
      <button type="button" onClick={onVolver} style={backArrowStyle}>
        ←
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#F0B94D' }}>{competicion}</span>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT }}>Cómo puntúan los jugadores</h1>
        <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>Un resumen rápido antes de elegir tu equipo.</p>
      </div>

      {tablas.map((tabla) => (
        <div key={tabla.titulo} style={{ background: S.PANEL, border: `1px solid ${S.BORDER}`, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12, color: S.TEXT, marginBottom: 4 }}>{tabla.titulo}</span>
          {tabla.filas.map((fila) => (
            <div key={fila.accion} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '4px 0', borderTop: `1px solid ${S.BORDER}` }}>
              <span style={{ fontSize: 12.5, color: S.MUTED }}>{fila.accion}</span>
              <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: '#F0B94D' }}>{fila.puntos}</span>
            </div>
          ))}
        </div>
      ))}

      <div style={{ position: 'sticky', bottom: 0, padding: '8px 0 12px', background: 'linear-gradient(180deg, rgba(11,15,14,0) 0%, #0B0F0E 40%)' }}>
        <button type="button" onClick={onEntendido} style={submitButtonStyle(true)}>
          Entendido, elegir jugadores
        </button>
      </div>
    </div>
  );
}

function PlayerRow({ jugador, selected, disabled, onToggle }: { jugador: JugadorRow; selected: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault();
        if (!disabled) onToggle();
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '9px 8px',
        background: selected ? 'rgba(61,220,132,0.1)' : S.PANEL,
        border: `1px solid ${selected ? 'rgba(61,220,132,0.4)' : '#1E2723'}`,
        borderRadius: 10,
        textDecoration: 'none',
        opacity: disabled ? 0.4 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <span style={{ minWidth: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{jugador.nombre}</span>
          {jugador.lesionado && <span style={{ flexShrink: 0, width: 13, height: 13, borderRadius: '50%', background: '#FF5C5C' }} />}
        </div>
        {jugador.equipo_real && <span style={{ fontSize: 10, color: S.MUTED_3 }}>{jugador.equipo_real}</span>}
      </div>
      <span style={{ flexShrink: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 11.5, color: '#F0B94D' }}>{formatEuros(jugador.precio)}</span>
      <span
        style={{
          flexShrink: 0,
          width: 23,
          height: 23,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 800,
          fontSize: 14,
          border: `1px solid ${selected ? '#3DDC84' : S.BORDER}`,
          background: selected ? '#3DDC84' : 'transparent',
          color: selected ? '#04140B' : S.MUTED,
        }}
      >
        {selected ? '−' : '+'}
      </span>
    </a>
  );
}

const backArrowStyle: React.CSSProperties = { width: 34, height: 34, padding: 0, margin: '0 0 4px', border: 'none', background: 'transparent', color: '#3DDC84', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 20, alignSelf: 'flex-start' };

// Botón "Mostrar N más" bajo cada lista con tope (posiciones de fútbol, y el
// listado plano de golf/tenis) — pedido de Iñi, 25/09 tercera vuelta.
const mostrarMasButtonStyle: React.CSSProperties = {
  fontFamily: "'Manrope', sans-serif",
  fontWeight: 700,
  fontSize: 12,
  color: '#3DDC84',
  background: 'transparent',
  border: '1px solid rgba(61,220,132,0.35)',
  borderRadius: 9,
  padding: '7px 10px',
  cursor: 'pointer',
  textAlign: 'center',
};

function submitButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    pointerEvents: enabled ? 'auto' : 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 700,
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    color: enabled ? '#04140B' : S.MUTED_3,
    background: enabled ? '#F0B94D' : S.PANEL,
    padding: '9px 24px',
    borderRadius: 9,
    minHeight: 34,
    textAlign: 'center',
    width: '100%',
    border: 'none',
    cursor: enabled ? 'pointer' : 'default',
  };
}

function traducirError(mensaje: string): string {
  // Los mensajes que manda inscribirse_en_sala() ya están en español (ver
  // drafters-schema.sql) — se devuelven tal cual, quitando el prefijo
  // técnico que añade PostgREST delante.
  return mensaje.replace(/^ERROR:\s*/i, '');
}
