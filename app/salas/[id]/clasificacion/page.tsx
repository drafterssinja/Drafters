'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import AnuncioVideoInline from '@/components/AnuncioVideoInline';
import * as S from '@/lib/mockupStyles';
import { formatEuros, posicionLabel, parteParaPremios, DEPORTE_LABELS, type Deporte } from '@/lib/salaShared';
import { formatGolfScore, COLOR_TIPO_RESULTADO, ETIQUETA_TIPO_RESULTADO, type TipoResultadoHoyo } from '@/lib/golfScoring';
import { calcularReparto, type TipoSala } from '@/lib/repartoPremios';
import { cargarFavoritos, alternarFavoritoEquipo } from '@/lib/favoritosEquipo';
import EstrellaFavorito from '@/components/EstrellaFavorito';

// ============================================================================
// CLASIFICACIÓN EN DIRECTO DE UNA MESA DRAFTERS (nuevo, 30/09)
// ============================================================================
// Hasta ahora esta pantalla era un "próximamente" fijo. Pedido de Iñi
// (30/09): "hay que diseñar la clasificación de las mesas Drafters... que
// ya la tenemos diseñada del Claude Code de lo que decimos aquí, pero le
// tienes que dar utilidad". Se le da utilidad hasta donde hay datos reales:
//
// - Mesas de GOLF: reutiliza exactamente la misma pieza que ya alimenta la
//   clasificación en directo de las porras de golf —
//   jugadores.resultado_en_vivo_* (golpes respecto al par), sincronizados
//   solos cada minuto desde ESPN — así que el diseño y el cálculo son
//   los mismos que en app/porras/[id]/clasificacion/page.tsx, sin el
//   toggle de "bono de podio" (eso es una regla propia de la porra clásica,
//   no de las mesas) ni los grupos de color (las mesas se draftean por
//   presupuesto, no por grupos).
// - Mesas de FÚTBOL y TENIS: todavía no hay ningún motor de resultados en
//   directo montado para esos deportes (decisión explícita de Iñi, 30/09:
//   "de momento vamos a poner 'sin datos en directo todavía' y pensaremos
//   de qué manera introducir datos hasta que lo automaticemos con APIs") —
//   se avisa con claridad en vez de fingir un dato que no existe. La
//   clasificación FINAL de cualquier mesa, sea cual sea el deporte, se
//   sigue decidiendo aparte, a mano, en /admin/pagos-pendientes.
//
// El vídeo publicitario se queda exactamente donde ya estaba (después del
// contenido, nunca antes) en los dos casos.
//
// Favoritos de equipo (02/10, pedido de Iñi): solo tienen sentido en el
// Maratón (sala.tipo === 'maraton' — inscripción libre, muchos equipos, se
// sigue durante días), no en el resto de mesas (Doble o Nada, Triple o
// Nada...), así que la estrellita y el filtro "solo favoritos" de la
// pestaña "Mesa" solo se muestran cuando `esMaraton` es true — ver
// lib/favoritosEquipo.ts y app/porras/[id]/clasificacion/page.tsx (misma
// función, reutilizada igual).

type SalaRow = { id: string; nombre: string; competicion: string; deporte: string; tipo: string; estado: string; fecha_limite_inscripcion: string | null; buy_in: number; aforo: number | null };
type JugadorRow = {
  id: string;
  nombre: string;
  resultado_en_vivo_total: number | null;
  resultado_en_vivo_thru: number | null;
  resultado_en_vivo_ronda: number | null;
  resultado_en_vivo_posicion: string | null;
};
type EquipoClasif = { equipoId: string; nombre: string; jugadores: string[]; createdAt: string };
type HoyoRow = { ronda: number; hoyo: number; par: number; golpes: number; campo_id: string | null; tipo_resultado: TipoResultadoHoyo };

type Vista = 'mesa' | 'torneo' | 'premios';

function totalEquipo(jugadoresIds: string[], jugadoresPorId: Map<string, JugadorRow>): number {
  return jugadoresIds.reduce((acc, id) => {
    const j = jugadoresPorId.get(id);
    if (!j) return acc;
    return acc + (j.resultado_en_vivo_total ?? 0);
  }, 0);
}

// CAMBIO 03/10 (pedido de Iñi): "después de cuántos hoyos lleva ese
// resultado" y, si ha acabado la vuelta, una "F" — mismo criterio que
// cualquier marcador de golf real (ESPN ya lo llama "thru" tal cual).
function estadoJugador(j: JugadorRow): string | null {
  if (j.resultado_en_vivo_posicion === null && j.resultado_en_vivo_thru === null) return null;
  const posicion = j.resultado_en_vivo_posicion ? `Pos. ${j.resultado_en_vivo_posicion}` : null;
  const ronda = j.resultado_en_vivo_ronda ? `Ronda ${j.resultado_en_vivo_ronda}` : null;
  const thru = j.resultado_en_vivo_thru !== null ? (j.resultado_en_vivo_thru >= 18 ? 'F' : `Thru ${j.resultado_en_vivo_thru}`) : null;
  return [posicion, ronda, thru].filter(Boolean).join(' · ') || null;
}

export default function SalaClasificacionPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const salaId = params.id;

  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [sala, setSala] = useState<SalaRow | null>(null);
  const [jugadores, setJugadores] = useState<JugadorRow[]>([]);
  const [equipos, setEquipos] = useState<EquipoClasif[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [vista, setVista] = useState<Vista>('mesa');
  const [equipoSeleccionadoId, setEquipoSeleccionadoId] = useState<string | null>(null);
  const [jugadorFocoId, setJugadorFocoId] = useState<string | null>(null);
  const [hoyosFoco, setHoyosFoco] = useState<HoyoRow[] | 'cargando' | null>(null);
  const [rondaSeleccionada, setRondaSeleccionada] = useState<number | null>(null);
  // Nombre de cada campo (01/10) — mismo criterio que
  // app/porras/[id]/clasificacion/page.tsx: vacío salvo en los pocos
  // torneos con más de un campo que el admin ya haya nombrado.
  const [nombresCampo, setNombresCampo] = useState<Record<string, string>>({});
  // Favoritos de equipo (02/10) — solo se usan/muestran para el Maratón, ver
  // comentario de cabecera del archivo.
  const [favoritos, setFavoritos] = useState<Set<string>>(new Set());
  const [soloFavoritos, setSoloFavoritos] = useState(false);

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

      const [{ data: perfilData }, { data: salaData }, favoritosSet] = await Promise.all([
        supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
        supabase.from('salas').select('id,nombre,competicion,deporte,tipo,estado,fecha_limite_inscripcion,buy_in,aforo').eq('id', salaId).single(),
        cargarFavoritos(session.user.id),
      ]);

      if (!activo) return;
      if (perfilData) setPerfil(perfilData as Perfil);
      setFavoritos(favoritosSet);

      if (!salaData) {
        setError('No se ha encontrado esta mesa.');
        setCargando(false);
        return;
      }
      const salaRow = salaData as SalaRow;
      setSala(salaRow);

      if (salaRow.deporte !== 'golf') {
        // Fútbol/tenis: sin motor de resultados en directo todavía — no hace
        // falta cargar nada más, ver el aviso más abajo.
        setCargando(false);
        return;
      }

      const [{ data: jugData }, { data: equiposData }, { data: camposData }] = await Promise.all([
        supabase
          .from('jugadores')
          .select('id,nombre,resultado_en_vivo_total,resultado_en_vivo_thru,resultado_en_vivo_ronda,resultado_en_vivo_posicion')
          .eq('deporte', 'golf')
          .eq('competicion', salaRow.competicion),
        // equipos_sala_clasificacion() es una función de base de datos
        // (RPC): solo devuelve filas una vez la mesa ha "empezado" (fecha
        // límite de inscripción ya pasada, o mesa finalizada) — antes de
        // eso, lista vacía, tratado más abajo como "todavía no ha empezado".
        supabase.rpc('equipos_sala_clasificacion', { p_sala_id: salaId }),
        // Nombre de cada campo (01/10) — ver comentario de la constante.
        supabase.from('campos_golf_live').select('campo_id,nombre').eq('competicion', salaRow.competicion),
      ]);

      if (!activo) return;

      setJugadores((jugData as JugadorRow[]) ?? []);
      setNombresCampo(Object.fromEntries(((camposData as { campo_id: string; nombre: string }[]) ?? []).map((c) => [c.campo_id, c.nombre])));

      const filasEquipos = (equiposData as { equipo_id: string; nombre: string; jugadores: string[]; created_at: string }[]) ?? [];
      const equiposOrdenados = filasEquipos
        .map((f) => ({ equipoId: f.equipo_id, nombre: f.nombre, jugadores: f.jugadores ?? [], createdAt: f.created_at }))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setEquipos(equiposOrdenados);
      if (equiposOrdenados.length > 0) setEquipoSeleccionadoId(equiposOrdenados[0].equipoId);

      setCargando(false);
    }

    cargar();
    return () => {
      activo = false;
    };
  }, [router, salaId]);

  const jugadoresPorId = useMemo(() => new Map(jugadores.map((j) => [j.id, j])), [jugadores]);
  // A diferencia del "campo completo" de la porra (que se ordena por precio
  // del jugador, pensado como explorador de la plantilla), aquí tiene más
  // sentido ordenar por resultado real — esta pantalla ya es la
  // clasificación en directo, no un selector de jugadores.
  const campoOrdenado = useMemo(() => jugadores.slice().sort((a, b) => (a.resultado_en_vivo_total ?? 0) - (b.resultado_en_vivo_total ?? 0)), [jugadores]);

  // Hoyo a hoyo del jugador con el foco puesto — mismo criterio que
  // app/porras/[id]/clasificacion/page.tsx.
  useEffect(() => {
    let activo = true;
    if (!jugadorFocoId) {
      setHoyosFoco(null);
      setRondaSeleccionada(null);
      return;
    }
    setHoyosFoco('cargando');
    setRondaSeleccionada(null);
    supabase
      .from('resultados_golf_hoyo')
      .select('ronda,hoyo,par,golpes,campo_id,tipo_resultado')
      .eq('jugador_id', jugadorFocoId)
      .order('ronda', { ascending: true })
      .order('hoyo', { ascending: true })
      .then(({ data }) => {
        if (!activo) return;
        const filas = (data as HoyoRow[]) ?? [];
        setHoyosFoco(filas);
        if (filas.length > 0) setRondaSeleccionada(filas[filas.length - 1].ronda);
      });
    return () => {
      activo = false;
    };
  }, [jugadorFocoId]);

  // Marca/desmarca un equipo como favorito (02/10) — ver comentario de
  // cabecera del archivo y lib/favoritosEquipo.ts.
  async function alternarFavorito(equipoId: string) {
    if (!perfil) return;
    const estabaMarcado = favoritos.has(equipoId);
    setFavoritos((prev) => {
      const next = new Set(prev);
      if (estabaMarcado) next.delete(equipoId);
      else next.add(equipoId);
      return next;
    });
    await alternarFavoritoEquipo(perfil.id, equipoId, estabaMarcado);
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
            <p style={{ fontSize: 14, color: S.ERROR }}>{error ?? 'No se ha encontrado esta mesa.'}</p>
          </div>
        </div>
      </main>
    );
  }

  // Fútbol/tenis: todavía sin motor de resultados en directo (30/09,
  // decisión explícita de Iñi — ver la cabecera de este archivo).
  if (sala.deporte !== 'golf') {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '48px 24px', alignItems: 'center', textAlign: 'center' }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif" }}>Clasificación en directo</h1>
            <p style={{ fontSize: 14, color: S.MUTED_2, lineHeight: 1.6 }}>
              Sin datos en directo todavía para mesas de {DEPORTE_LABELS[sala.deporte as Deporte] ?? sala.deporte}. La clasificación final se decide al
              liquidarse la mesa.
            </p>
            <Link href={`/salas/${params.id}`} style={{ ...S.secondaryLinkButton, width: 'auto', padding: '12px 24px', textDecoration: 'none', display: 'inline-flex' }}>
              Volver a la mesa
            </Link>

            <div style={{ width: '100%', maxWidth: 420 }}>
              <AnuncioVideoInline ubicacion="clasificacion" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Golf, pero todavía no ha "empezado" (o no hay ningún equipo inscrito).
  if (equipos.length === 0) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '48px 24px', alignItems: 'center', textAlign: 'center' }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif" }}>Clasificación en directo</h1>
            <p style={{ fontSize: 14, color: S.MUTED_2, lineHeight: 1.6 }}>
              Esta mesa todavía no ha empezado, o todavía no hay equipos inscritos. En cuanto se cierre la inscripción podrás ver aquí la clasificación de
              todos los participantes.
            </p>
            <Link href={`/salas/${params.id}`} style={{ ...S.secondaryLinkButton, width: 'auto', padding: '12px 24px', textDecoration: 'none', display: 'inline-flex' }}>
              Volver a la mesa
            </Link>

            <div style={{ width: '100%', maxWidth: 420 }}>
              <AnuncioVideoInline ubicacion="clasificacion" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  const equipoSeleccionado = equipos.find((e) => e.equipoId === equipoSeleccionadoId) ?? equipos[0];
  const jugadoresDelEquipoSeleccionado = equipoSeleccionado.jugadores.map((id) => jugadoresPorId.get(id)).filter((j): j is JugadorRow => !!j);
  const jugadorFoco = jugadorFocoId
    ? (jugadoresDelEquipoSeleccionado.find((j) => j.id === jugadorFocoId) ?? campoOrdenado.find((j) => j.id === jugadorFocoId) ?? null)
    : null;

  // Ranking por total (golpes respecto al par, menos es mejor) — la lista de
  // equipos que da equipos_sala_clasificacion() viene ordenada por fecha de
  // inscripción, así que aquí se reordena por puntuación para la columna de
  // la izquierda.
  const equiposPorPuntuacion = equipos.slice().sort((a, b) => totalEquipo(a.jugadores, jugadoresPorId) - totalEquipo(b.jugadores, jugadoresPorId));

  // Favoritos (02/10): solo tiene sentido en el Maratón — ver comentario de
  // cabecera del archivo.
  const esMaraton = sala.tipo === 'maraton';
  const equiposVisibles = equiposPorPuntuacion
    .map((eq, i) => ({ eq, rango: i + 1 }))
    .filter(({ eq }) => !esMaraton || !soloFavoritos || favoritos.has(eq.equipoId));

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '24px 20px 40px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#3DDC84' }}>{sala.nombre}</span>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT }}>Clasificación en directo</h1>
            <p style={{ fontSize: 13, color: S.MUTED_2 }}>{equipos.length} equipo{equipos.length === 1 ? '' : 's'} inscrito{equipos.length === 1 ? '' : 's'}</p>
          </div>

          <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-start' }}>
            <button type="button" onClick={() => setVista('mesa')} style={vistaPillStyle(vista === 'mesa')}>
              Mesa
            </button>
            <button type="button" onClick={() => setVista('torneo')} style={vistaPillStyle(vista === 'torneo')}>
              Torneo
            </button>
            <button type="button" onClick={() => setVista('premios')} style={vistaPillStyle(vista === 'premios')}>
              Premios
            </button>
          </div>

          {vista === 'mesa' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              {/* Ancho subido de 126 a 180 (02/10) — mismo motivo que
                  app/porras/[id]/clasificacion/page.tsx: ganar espacio para
                  el nombre completo del equipo, quitándoselo al panel de la
                  derecha, que tenía de más. */}
              <div style={{ flexShrink: 0, width: 180, display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 380, overflowY: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 5 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Equipos ({equipos.length})</span>
                  {/* Filtro "solo favoritos" (02/10, pedido de Iñi) — solo
                      tiene sentido en el Maratón, ver cabecera del archivo. */}
                  {esMaraton && (
                    <button
                      type="button"
                      onClick={() => setSoloFavoritos((v) => !v)}
                      title={soloFavoritos ? 'Ver todos los equipos' : 'Ver solo favoritos'}
                      style={{
                        flexShrink: 0,
                        width: 22,
                        height: 18,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 7,
                        border: `1px solid ${soloFavoritos ? '#F0B94D' : '#1E2723'}`,
                        background: soloFavoritos ? 'rgba(240,185,77,0.15)' : S.PANEL,
                        color: soloFavoritos ? '#F0B94D' : S.MUTED_3,
                        cursor: 'pointer',
                        fontSize: 12,
                        lineHeight: 1,
                      }}
                    >
                      {soloFavoritos ? '★' : '☆'}
                    </button>
                  )}
                </div>
                {equiposVisibles.map(({ eq, rango }) => {
                  const activo = eq.equipoId === equipoSeleccionado.equipoId;
                  const esFavorito = esMaraton && favoritos.has(eq.equipoId);
                  return (
                    <motion.a
                      layout
                      transition={{ type: 'spring', stiffness: 420, damping: 38 }}
                      key={eq.equipoId}
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setEquipoSeleccionadoId(eq.equipoId);
                        setJugadorFocoId(null);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: esMaraton ? 5 : 6,
                        padding: 8,
                        background: activo ? 'rgba(61,220,132,0.1)' : esFavorito ? 'rgba(240,185,77,0.1)' : S.PANEL,
                        border: `1px solid ${activo ? 'rgba(61,220,132,0.4)' : esFavorito ? 'rgba(240,185,77,0.35)' : '#1E2723'}`,
                        borderRadius: 9,
                        textDecoration: 'none',
                      }}
                    >
                      <span style={{ flexShrink: 0, width: esMaraton ? 14 : 16, textAlign: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 11, color: S.MUTED_2 }}>{rango}</span>
                      {esMaraton && <EstrellaFavorito activo={esFavorito} onToggle={() => alternarFavorito(eq.equipoId)} />}
                      <span style={{ flex: 1, minWidth: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 10.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {eq.nombre}
                      </span>
                      <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 12, color: S.MUTED_2 }}>
                        {formatGolfScore(totalEquipo(eq.jugadores, jugadoresPorId))}
                      </span>
                    </motion.a>
                  );
                })}
                {esMaraton && soloFavoritos && !equiposPorPuntuacion.some((eq) => favoritos.has(eq.equipoId)) && (
                  <p style={{ fontSize: 10.5, color: S.MUTED_3, lineHeight: 1.4, padding: '4px 2px' }}>
                    Todavía no tienes ningún equipo marcado como favorito aquí — pulsa la estrella de un equipo para añadirlo.
                  </p>
                )}
              </div>

              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 10 }}>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {equipoSeleccionado.nombre}
                  </span>
                  <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, color: S.MUTED_2 }}>
                    {formatGolfScore(totalEquipo(equipoSeleccionado.jugadores, jugadoresPorId))}
                  </span>
                </div>
                {jugadoresDelEquipoSeleccionado.map((j) => (
                  <motion.a
                    layout
                    transition={{ type: 'spring', stiffness: 420, damping: 38 }}
                    key={j.id}
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setJugadorFocoId((prev) => (prev === j.id ? null : j.id));
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '9px 10px',
                      background: jugadorFocoId === j.id ? 'rgba(61,220,132,0.1)' : S.PANEL,
                      border: `1px solid ${jugadorFocoId === j.id ? 'rgba(61,220,132,0.4)' : '#1E2723'}`,
                      borderRadius: 9,
                      textDecoration: 'none',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.nombre}</span>
                      {estadoJugador(j) && <span style={{ fontSize: 9, color: S.MUTED_3 }}>{estadoJugador(j)}</span>}
                    </div>
                    <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 13, color: S.MUTED_2 }}>
                      {formatGolfScore(j.resultado_en_vivo_total ?? 0)}
                    </span>
                  </motion.a>
                ))}
              </div>
            </div>
          )}

          {vista === 'torneo' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 420, overflowY: 'auto' }}>
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Campo completo ({campoOrdenado.length} jugadores)</span>
              {campoOrdenado.map((j, i) => {
                // Equipos de ESTA mesa que tienen a este jugador (nuevo,
                // 02/10, mismo pedido de Iñi que en la porra — ver
                // app/porras/[id]/clasificacion/page.tsx para el comentario
                // completo). Pulsar un equipo salta a la pestaña Mesa con
                // ese equipo ya seleccionado.
                const equiposConEsteJugador = jugadorFocoId === j.id ? equiposPorPuntuacion.filter((eq) => eq.jugadores.includes(j.id)) : [];
                return (
                  <motion.div layout transition={{ type: 'spring', stiffness: 420, damping: 38 }} key={j.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setJugadorFocoId((prev) => (prev === j.id ? null : j.id));
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '9px 10px',
                        background: jugadorFocoId === j.id ? 'rgba(61,220,132,0.1)' : S.PANEL,
                        border: `1px solid ${jugadorFocoId === j.id ? 'rgba(61,220,132,0.4)' : '#1E2723'}`,
                        borderRadius: 9,
                        textDecoration: 'none',
                      }}
                    >
                      <span style={{ flexShrink: 0, width: 20, textAlign: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 11, color: S.MUTED_2 }}>{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.nombre}</span>
                        {estadoJugador(j) && <span style={{ fontSize: 9, color: S.MUTED_3 }}>{estadoJugador(j)}</span>}
                      </div>
                      <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 13, color: S.MUTED_2 }}>{formatGolfScore(j.resultado_en_vivo_total ?? 0)}</span>
                    </a>
                    {jugadorFocoId === j.id && (
                      <div style={{ margin: '0 0 2px 20px', padding: '7px 9px', background: 'rgba(61,220,132,0.05)', border: '1px dashed rgba(61,220,132,0.3)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>
                          {equiposConEsteJugador.length === 0 ? 'Ningún equipo de esta mesa lo tiene' : `Equipos de esta mesa que lo tienen (${equiposConEsteJugador.length})`}
                        </span>
                        {equiposConEsteJugador.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                            {equiposConEsteJugador.map((eq) => (
                              <a
                                key={eq.equipoId}
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setVista('mesa');
                                  setEquipoSeleccionadoId(eq.equipoId);
                                }}
                                style={{ fontSize: 10.5, fontWeight: 700, color: '#3DDC84', background: 'rgba(61,220,132,0.12)', border: '1px solid rgba(61,220,132,0.3)', borderRadius: 999, padding: '4px 9px', textDecoration: 'none', whiteSpace: 'nowrap' }}
                              >
                                {eq.nombre}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Pestaña Premios (nueva, 02/10) — mismo cálculo que la pestaña
              Premios de /salas/[id] (parteParaPremios + calcularReparto),
              con el acento verde de las pantallas de clasificación en vez
              del dorado de esa pantalla (pedido de Iñi: "tonos negros y
              verdes, no con los amarillos"). A estas alturas (mesa ya
              cerrada/en juego) equipos.length es el aforo real, así que el
              reparto que se ve aquí es ya el definitivo, no una proyección. */}
          {vista === 'premios' &&
            (() => {
              const bote = parteParaPremios(sala.buy_in) * (sala.aforo ?? equipos.length);
              const tramosPremios = calcularReparto(sala.tipo as TipoSala, sala.aforo, equipos.length);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '20px 14px', background: 'rgba(61,220,132,0.08)', border: '1px solid rgba(61,220,132,0.35)', borderRadius: 12 }}>
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#3DDC84' }}>Bote total</span>
                    <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 30, color: '#3DDC84' }}>{formatEuros(bote)}</span>
                  </div>
                  {tramosPremios.length === 0 && <p style={{ fontSize: 13, color: S.MUTED_2 }}>Todavía no hay suficientes equipos inscritos para calcular el reparto.</p>}
                  {tramosPremios.map((t, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '13px 14px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 10 }}>
                      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, color: S.TEXT }}>{posicionLabel(t.desde, t.hasta)}</span>
                      <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 14, color: '#3DDC84' }}>{formatEuros((bote * t.porcentajeCadaUno) / 100)}</span>
                    </div>
                  ))}
                </div>
              );
            })()}

          {jugadorFoco && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color: S.TEXT }}>{jugadorFoco.nombre} · resultados</span>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setJugadorFocoId(null);
                  }}
                  style={{ color: S.MUTED_3, fontSize: 13, textDecoration: 'none' }}
                >
                  ✕
                </a>
              </div>
              {estadoJugador(jugadorFoco) && <span style={{ fontSize: 11, color: S.MUTED_3 }}>{estadoJugador(jugadorFoco)}</span>}

              {hoyosFoco === 'cargando' && <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>Cargando el hoyo a hoyo...</p>}

              {/* CAMBIO 03/10 (pedido de Iñi, mismo cambio que
                  app/porras/[id]/clasificacion/page.tsx): siempre se
                  pintan los 18 huecos de la ronda, vacíos los que
                  todavía no tienen resultado — la ronda por defecto es la
                  EN VIVO del jugador, aunque todavía no tenga ningún hoyo
                  jugado en ella. */}
              {Array.isArray(hoyosFoco) &&
                (() => {
                  const hoyos: HoyoRow[] = hoyosFoco;
                  const rondasConDatos = Array.from(new Set(hoyos.map((h) => h.ronda)));
                  const rondaEnVivo = jugadorFoco.resultado_en_vivo_ronda;
                  const rondasConocidas = Array.from(new Set([...rondasConDatos, ...(rondaEnVivo ? [rondaEnVivo] : [])])).sort((a, b) => a - b);
                  const rondaMostrada = rondaSeleccionada ?? rondaEnVivo ?? rondasConocidas[rondasConocidas.length - 1] ?? 1;
                  const hoyosRonda = hoyos.filter((h) => h.ronda === rondaMostrada);
                  const hoyosPorNumero = new Map(hoyosRonda.map((h) => [h.hoyo, h]));
                  // Nombre del campo de la ronda (01/10) — ver comentario
                  // de nombresCampo más arriba.
                  const campoIdRondaSel = hoyosRonda[0]?.campo_id ?? null;
                  const nombreCampoRondaSel = campoIdRondaSel ? nombresCampo[campoIdRondaSel] : null;
                  return (
                    <>
                      {hoyosRonda.length === 0 && (
                        <p style={{ fontSize: 11.5, lineHeight: 1.5, color: S.MUTED_2, margin: 0 }}>
                          Todavía no hay ningún hoyo registrado para la ronda {rondaMostrada} de {jugadorFoco.nombre} — en cuanto empiece a
                          jugar se irán rellenando los círculos de abajo.
                        </p>
                      )}

                      {rondasConocidas.length > 1 && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {rondasConocidas.map((r) => {
                            const campoIdR = hoyos.find((h) => h.ronda === r)?.campo_id ?? null;
                            const nombreCampoR = campoIdR ? nombresCampo[campoIdR] : null;
                            return (
                              <button key={r} type="button" onClick={() => setRondaSeleccionada(r)} style={vistaPillStyle(rondaMostrada === r)}>
                                Ronda {r}
                                {nombreCampoR ? ` · ${nombreCampoR}` : ''}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {campoIdRondaSel && rondasConocidas.length <= 1 && (
                        <span style={{ fontSize: 10.5, color: S.MUTED_3 }}>
                          {nombreCampoRondaSel ?? `Campo ${campoIdRondaSel} (todavía sin nombre — se puede poner desde el panel de administración)`}
                        </span>
                      )}

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
                        {Array.from({ length: 18 }, (_, i) => i + 1).map((n) => {
                          const h = hoyosPorNumero.get(n);
                          if (!h) {
                            return (
                              <div key={n} title={`Hoyo ${n} — todavía sin resultado`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                                <span style={{ fontSize: 8.5, color: S.MUTED_3 }}>{n} · P–</span>
                                <div
                                  style={{
                                    width: 30,
                                    height: 30,
                                    borderRadius: '50%',
                                    border: `1px dashed ${S.CARD_BORDER}`,
                                    color: S.MUTED_3,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontFamily: "'Barlow Condensed', sans-serif",
                                    fontWeight: 800,
                                    fontSize: 13,
                                  }}
                                >
                                  –
                                </div>
                              </div>
                            );
                          }
                          const color = COLOR_TIPO_RESULTADO[h.tipo_resultado];
                          return (
                            <div
                              key={n}
                              title={`Hoyo ${h.hoyo} · Par ${h.par} · ${ETIQUETA_TIPO_RESULTADO[h.tipo_resultado]}`}
                              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
                            >
                              <span style={{ fontSize: 8.5, color: S.MUTED_3 }}>
                                {h.hoyo} · P{h.par}
                              </span>
                              <div
                                style={{
                                  width: 30,
                                  height: 30,
                                  borderRadius: '50%',
                                  background: color.fondo,
                                  color: color.texto,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontFamily: "'Barlow Condensed', sans-serif",
                                  fontWeight: 800,
                                  fontSize: 13,
                                }}
                              >
                                {h.golpes}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 4, borderTop: `1px solid ${S.CARD_BORDER}` }}>
                        {(Object.keys(ETIQUETA_TIPO_RESULTADO) as TipoResultadoHoyo[]).map((t) => (
                          <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, color: S.MUTED_3 }}>
                            <span style={{ width: 9, height: 9, borderRadius: '50%', background: COLOR_TIPO_RESULTADO[t].fondo, display: 'inline-block' }} />
                            {ETIQUETA_TIPO_RESULTADO[t]}
                          </span>
                        ))}
                      </div>
                    </>
                  );
                })()}
            </div>
          )}

          <span style={{ fontSize: 10, color: S.FAINT }}>
            *Clasificación en directo: resultado respecto al par de cada jugador/equipo (no puntos), actualizado automáticamente cada minuto. Se ve "E"
            (par) mientras un jugador todavía no tiene ningún resultado registrado.
          </span>

          {/* Vídeo publicitario debajo de todo — mismo criterio que en
              porras/[id]/clasificacion/page.tsx. */}
          <div style={{ width: '100%' }}>
            <AnuncioVideoInline ubicacion="clasificacion" />
          </div>
        </div>
      </div>
    </main>
  );
}

function vistaPillStyle(active: boolean) {
  return {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 700,
    fontSize: 12,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
    padding: '7px 12px',
    borderRadius: 999,
    border: `1px solid ${active ? '#3DDC84' : S.BORDER}`,
    background: active ? 'rgba(61,220,132,0.12)' : 'transparent',
    color: active ? '#3DDC84' : S.MUTED,
    cursor: 'pointer',
  };
}
