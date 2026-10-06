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
import { calcularReparto, repartirPremiosConEmpates, type TipoSala, type ClasificacionEntrada } from '@/lib/repartoPremios';
import { cargarFavoritos, alternarFavoritoEquipo } from '@/lib/favoritosEquipo';
import { cargarFavoritosJugador } from '@/lib/favoritosJugador';
import { cargarParesBiblioteca } from '@/lib/paresBiblioteca';
import EstrellaFavorito from '@/components/EstrellaFavorito';
import ClasificacionMesaFutbol from '@/components/ClasificacionMesaFutbol';
import { formatPuntos } from '@/lib/futbolLaLiga';
import type { LineaDesglose } from '@/lib/futbolPuntuacion';
import TablaHoyoAHoyo, { type CasillaHoyo, type FilaRondaTabla } from '@/components/TablaHoyoAHoyo';

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
type PuntosGolfRow = { jugador_id: string; puntos_total: number; desglose: LineaDesglose[] | null };
type EquipoClasif = { equipoId: string; nombre: string; jugadores: string[]; createdAt: string };
type HoyoRow = { ronda: number; hoyo: number; par: number; golpes: number; campo_id: string | null; tipo_resultado: TipoResultadoHoyo };

type Vista = 'mesa' | 'torneo' | 'premios' | 'eventos';

// Puntos Drafters de golf de todo el campo de la competición (07/10).
async function cargarPuntosGolf(competicion: string): Promise<Map<string, PuntosGolfRow>> {
  const mapa = new Map<string, PuntosGolfRow>();
  for (let desde = 0; ; desde += 1000) {
    const { data } = await supabase.from('golf_puntos_jugador').select('jugador_id,puntos_total,desglose').eq('competicion', competicion).range(desde, desde + 999);
    const filas = (data as PuntosGolfRow[]) ?? [];
    filas.forEach((f) => mapa.set(f.jugador_id, f));
    if (filas.length < 1000) break;
  }
  return mapa;
}

// CAMBIO 03/10 (pedido de Iñi): "después de cuántos hoyos lleva ese
// resultado" y, si ha acabado la vuelta, una "F" — mismo criterio que
// cualquier marcador de golf real (ESPN ya lo llama "thru" tal cual).
function estadoJugador(j: JugadorRow): string | null {
  if (j.resultado_en_vivo_posicion === null && j.resultado_en_vivo_thru === null) return null;
  const posicion = j.resultado_en_vivo_posicion ? `Pos. ${j.resultado_en_vivo_posicion}` : null;
  const ronda = j.resultado_en_vivo_ronda ? `Ronda ${j.resultado_en_vivo_ronda}` : null;
  const thru = j.resultado_en_vivo_thru !== null ? (j.resultado_en_vivo_thru >= 18 ? 'F' : `Thru ${j.resultado_en_vivo_thru}`) : null;
  const alPar = j.resultado_en_vivo_total !== null ? formatGolfScore(j.resultado_en_vivo_total) : null;
  return [posicion, ronda, thru, alPar].filter(Boolean).join(' · ') || null;
}

export default function SalaClasificacionPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const salaId = params.id;

  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [sala, setSala] = useState<SalaRow | null>(null);
  const [jugadores, setJugadores] = useState<JugadorRow[]>([]);
  // Puntos Drafters de cada jugador de golf (07/10, tabla golf_puntos_jugador,
  // la escribe la sincronización de Data Golf — ver lib/golfPuntuacion.ts).
  const [puntosGolf, setPuntosGolf] = useState<Map<string, PuntosGolfRow>>(new Map());
  const [equipos, setEquipos] = useState<EquipoClasif[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [vista, setVista] = useState<Vista>('mesa');
  // Torneo terminado (04/10, segunda vuelta — pedido de Iñi, mismo
  // mecanismo que app/porras/[id]/clasificacion/page.tsx):
  // torneos_golf_live.finalizado_en es compartido por competición, así que
  // sirve igual para una mesa que para una porra — en cuanto está puesto,
  // la pestaña "Mesa" desaparece y "Premios" pasa a llamarse "Clasificación
  // final" con el reparto real ya calculado (antes esta pantalla nunca
  // hacía ese cambio: siempre mostraba el reparto por tramos, aunque la
  // mesa ya hubiera terminado — aviso honesto: esto sigue siendo solo
  // informativo, el pago real de una mesa se decide aparte, a mano, en
  // /admin/pagos-pendientes, que puede no coincidir si hay un empate que de
  // verdad no se resuelve con un desempate automático).
  const [torneoFinalizado, setTorneoFinalizado] = useState(false);
  useEffect(() => {
    if (torneoFinalizado) setVista((v) => (v === 'mesa' ? 'premios' : v));
  }, [torneoFinalizado]);
  const [equipoSeleccionadoId, setEquipoSeleccionadoId] = useState<string | null>(null);
  const [jugadorFocoId, setJugadorFocoId] = useState<string | null>(null);
  const [hoyosFoco, setHoyosFoco] = useState<HoyoRow[] | 'cargando' | null>(null);
  // Nombre de cada campo (01/10) — mismo criterio que
  // app/porras/[id]/clasificacion/page.tsx: vacío salvo en los pocos
  // torneos con más de un campo que el admin ya haya nombrado.
  const [nombresCampo, setNombresCampo] = useState<Record<string, string>>({});
  // Par de los 18 hoyos de cada campo, desde la biblioteca reutilizable
  // (03/10) — ver lib/paresBiblioteca.ts y el mismo comentario en
  // app/porras/[id]/clasificacion/page.tsx.
  const [paresPorCampoId, setParesPorCampoId] = useState<Record<string, (number | null)[]>>({});
  // Favoritos de equipo (02/10) — solo se usan/muestran para el Maratón, ver
  // comentario de cabecera del archivo.
  const [favoritos, setFavoritos] = useState<Set<string>>(new Set());
  const [soloFavoritos, setSoloFavoritos] = useState(false);
  // Favoritos de JUGADOR (04/10, pedido de Iñi: "esto ya va para todo, para
  // las porras y para las mesas drafters") — hasta ahora esta pantalla no
  // los leía para nada; hace falta para la pestaña "Eventos" nueva (ver más
  // abajo). No hay estrellita propia todavía en esta pantalla para
  // marcarlos a mano (eso solo existe hoy en la clasificación de porras) —
  // lo que sí llega ya marcado de serie son los 5 jugadores de tu propio
  // equipo (marcarFavoritosPorDefecto() al crear el equipo, ver
  // app/salas/[id]/crear-equipo).
  const [favoritosJugador, setFavoritosJugador] = useState<Set<string>>(new Set());
  // Historial de eventos de MIS jugadores (04/10) — mismo mecanismo que
  // app/porras/[id]/clasificacion/page.tsx: resultados_golf_hoyo ya es un
  // historial permanente, esta pestaña solo lo lee filtrado a favoritos.
  const [eventos, setEventos] = useState<
    { id: string; jugador: string; tipo: TipoResultadoHoyo; hoyo: number; ronda: number; actualizadoEn: string }[] | 'cargando' | null
  >(null);

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

      const [{ data: perfilData }, { data: salaData }, favoritosSet, favoritosJugadorSet] = await Promise.all([
        supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
        supabase.from('salas').select('id,nombre,competicion,deporte,tipo,estado,fecha_limite_inscripcion,buy_in,aforo').eq('id', salaId).single(),
        cargarFavoritos(session.user.id),
        cargarFavoritosJugador(session.user.id),
      ]);

      if (!activo) return;
      if (perfilData) setPerfil(perfilData as Perfil);
      setFavoritos(favoritosSet);
      setFavoritosJugador(favoritosJugadorSet);

      if (!salaData) {
        setError('No se ha encontrado esta mesa.');
        setCargando(false);
        return;
      }
      const salaRow = salaData as SalaRow;
      setSala(salaRow);

      // Registro de actividad (03/10, pedido de Iñi, mismo criterio que
      // app/porras/[id]/clasificacion/page.tsx): un evento por cada vez que
      // alguien abre la clasificación en directo de una mesa drafter,
      // participe o no en ella. Fire-and-forget: no debe retrasar ni poder
      // romper la carga de la clasificación.
      //
      // FIX 04/10 (mismo aviso de Iñi que en app/porras/[id]/clasificacion —
      // ver el comentario completo ahí): se cambia a comprobar el error en
      // vez de descartarlo en silencio, por si está fallando de verdad.
      supabase.rpc('registrar_evento_actividad', { p_tipo: 'clasificacion', p_detalle: { modo: 'sala', nombre: salaRow.nombre } }).then(({ error }) => {
        if (error) {
          // eslint-disable-next-line no-console
          console.error('No se ha podido registrar la visita a la clasificación:', error.message);
        }
      });

      if (salaRow.deporte !== 'golf') {
        // Fútbol/tenis: sin motor de resultados en directo todavía — no hace
        // falta cargar nada más, ver el aviso más abajo.
        setCargando(false);
        return;
      }

      const [{ data: jugData }, { data: equiposData }, { data: camposData }, { data: estadoTorneoData }] = await Promise.all([
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
        // Si el torneo ya se dio por terminado (04/10, segunda vuelta) —
        // ver el comentario de torneoFinalizado más arriba.
        supabase.rpc('obtener_estado_torneo_golf', { p_competicion: salaRow.competicion }),
      ]);

      if (!activo) return;

      const filaEstadoTorneo = ((estadoTorneoData as { finalizado_en: string | null }[]) ?? [])[0];
      setTorneoFinalizado(!!filaEstadoTorneo?.finalizado_en);

      const jugadoresCargados = (jugData as JugadorRow[]) ?? [];
      setJugadores(jugadoresCargados);
      cargarPuntosGolf(salaRow.competicion).then((m) => {
        if (activo) setPuntosGolf(m);
      });
      const camposArr = (camposData as { campo_id: string; nombre: string }[]) ?? [];
      setNombresCampo(Object.fromEntries(camposArr.map((c) => [c.campo_id, c.nombre])));
      if (camposArr.length > 0) {
        setParesPorCampoId(await cargarParesBiblioteca(camposArr));
      }

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
  // Puntos Drafters (más = mejor). Un jugador sin fila todavía = 0.
  const puntosDe = (id: string): number => puntosGolf.get(id)?.puntos_total ?? 0;
  const totalEquipo = (jugadoresIds: string[]): number => jugadoresIds.reduce((acc, id) => acc + puntosDe(id), 0);
  // A diferencia del "campo completo" de la porra (que se ordena por precio
  // del jugador, pensado como explorador de la plantilla), aquí tiene más
  // sentido ordenar por resultado real — esta pantalla ya es la
  // clasificación en directo, no un selector de jugadores.
  const campoOrdenado = useMemo(() => jugadores.slice().sort((a, b) => (puntosGolf.get(b.id)?.puntos_total ?? 0) - (puntosGolf.get(a.id)?.puntos_total ?? 0) || (a.resultado_en_vivo_total ?? 0) - (b.resultado_en_vivo_total ?? 0)), [jugadores, puntosGolf]);

  // Hoyo a hoyo del jugador con el foco puesto — mismo criterio que
  // app/porras/[id]/clasificacion/page.tsx. CAMBIO 03/10: ya no hay una
  // "ronda seleccionada" — la tabla de hoyo a hoyo (ver más abajo) muestra
  // TODAS las rondas conocidas a la vez, una fila por ronda.
  useEffect(() => {
    let activo = true;
    if (!jugadorFocoId) {
      setHoyosFoco(null);
      return;
    }
    setHoyosFoco('cargando');
    supabase
      .from('resultados_golf_hoyo')
      .select('ronda,hoyo,par,golpes,campo_id,tipo_resultado')
      .eq('jugador_id', jugadorFocoId)
      .order('ronda', { ascending: true })
      .order('hoyo', { ascending: true })
      .then(({ data }) => {
        if (!activo) return;
        setHoyosFoco((data as HoyoRow[]) ?? []);
      });
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jugadorFocoId]);

  // Carga del historial de eventos (04/10) — mismo criterio que
  // app/porras/[id]/clasificacion/page.tsx: solo se pide cuando se está
  // mirando la pestaña, y se refresca sola cada minuto mientras siga
  // abierta.
  useEffect(() => {
    if (vista !== 'eventos') return;
    const competicion = sala?.competicion;
    if (!competicion) return;

    let activo = true;

    async function cargarEventos() {
      setEventos((prev) => (prev === null ? 'cargando' : prev));
      const idsFavoritos = Array.from(favoritosJugador).filter((id) => jugadoresPorId.has(id));
      if (idsFavoritos.length === 0) {
        if (activo) setEventos([]);
        return;
      }
      const { data } = await supabase
        .from('resultados_golf_hoyo')
        .select('jugador_id,ronda,hoyo,tipo_resultado,actualizado_en')
        .in('jugador_id', idsFavoritos)
        .neq('tipo_resultado', 'par')
        .order('actualizado_en', { ascending: false })
        .limit(150);
      if (!activo) return;
      const filas = (data as { jugador_id: string; ronda: number; hoyo: number; tipo_resultado: TipoResultadoHoyo; actualizado_en: string }[]) ?? [];
      setEventos(
        filas.map((f) => ({
          id: `${f.jugador_id}:::${f.ronda}:::${f.hoyo}`,
          jugador: jugadoresPorId.get(f.jugador_id)?.nombre ?? '?',
          tipo: f.tipo_resultado,
          hoyo: f.hoyo,
          ronda: f.ronda,
          actualizadoEn: f.actualizado_en,
        }))
      );
    }

    cargarEventos();
    const intervalo = setInterval(cargarEventos, 60000);
    return () => {
      activo = false;
      clearInterval(intervalo);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista, sala?.competicion, favoritosJugador, jugadoresPorId]);

  // Refresco automático cada minuto (07/10): resultado en vivo de los
  // jugadores y sus puntos Drafters. Una vez terminado el torneo ya no cambia.
  useEffect(() => {
    const competicion = sala?.competicion;
    if (!competicion || sala?.deporte !== 'golf' || torneoFinalizado) return;
    let activo = true;
    async function refrescar() {
      const [{ data: jugData }, mapa] = await Promise.all([
        supabase
          .from('jugadores')
          .select('id,nombre,resultado_en_vivo_total,resultado_en_vivo_thru,resultado_en_vivo_ronda,resultado_en_vivo_posicion')
          .eq('deporte', 'golf')
          .eq('competicion', competicion as string),
        cargarPuntosGolf(competicion as string),
      ]);
      if (!activo) return;
      if (jugData && (jugData as JugadorRow[]).length > 0) setJugadores(jugData as JugadorRow[]);
      setPuntosGolf(mapa);
    }
    const intervalo = setInterval(refrescar, 60000);
    return () => {
      activo = false;
      clearInterval(intervalo);
    };
  }, [sala?.competicion, sala?.deporte, torneoFinalizado]);

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

  // Fútbol (06/10): clasificación con la puntuación Drafters calculada con ESPN (LaLiga y Champions).
  // victoria/empate y marcador en vivo — ver components/ClasificacionMesaFutbol.tsx.
  if (sala.deporte === 'futbol') {
    return <ClasificacionMesaFutbol sala={sala} saldoLabel={saldoLabel} initials={initials} />;
  }

  // Tenis: todavía sin motor de resultados en directo (30/09, decisión
  // explícita de Iñi — ver la cabecera de este archivo).
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
  const equiposPorPuntuacion = equipos.slice().sort((a, b) => totalEquipo(b.jugadores) - totalEquipo(a.jugadores));

  // Favoritos (02/10): solo tiene sentido en el Maratón — ver comentario de
  // cabecera del archivo.
  const esMaraton = sala.tipo === 'maraton';
  const equiposVisibles = equiposPorPuntuacion
    .map((eq, i) => ({ eq, rango: i + 1 }))
    .filter(({ eq }) => !esMaraton || !soloFavoritos || favoritos.has(eq.equipoId));

  // Desglose de los puntos Drafters del jugador (07/10): de dónde sale cada
  // punto + las dos acciones que Data Golf todavía no da ("Próximamente").
  function desglosePuntosJugador(jugador: JugadorRow) {
    const fila = puntosGolf.get(jugador.id);
    const lineas = fila?.desglose ?? [];
    const signo = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatPuntos(Math.abs(n))}`;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid #1E2723', borderRadius: 10 }}>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Desglose de puntos{torneoFinalizado ? '' : ' (en directo)'}</span>
        {lineas.length === 0 && <span style={{ fontSize: 11.5, color: S.MUTED }}>Todavía sin acciones que puntúen.</span>}
        {lineas.map((l) => (
          <div key={l.clave} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 11.5 }}>
            <span style={{ color: S.MUTED }}>
              {l.etiqueta}
              {l.cantidad > 1 ? ` ×${l.cantidad}` : ''}
            </span>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: l.puntos < 0 ? S.ERROR : '#F0B94D' }}>{signo(l.puntos)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTop: '1px solid #1E2723', paddingTop: 4, marginTop: 2 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: S.TEXT }}>Total</span>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 14, color: S.TEXT }}>{formatPuntos(puntosDe(jugador.id))}</span>
        </div>
        <span style={{ fontSize: 9.5, color: S.MUTED_3, lineHeight: 1.4 }}>
          {torneoFinalizado ? 'Incluye los puntos por la posición final.' : 'Los puntos por la posición final se suman cuando termina el torneo.'} Putt de +30 pies y approach metido: próximamente (todavía no puntúan).
        </span>
      </div>
    );
  }

  // Tabla de hoyo a hoyo del jugador con el foco puesto (03/10, formato
  // nuevo — ver components/TablaHoyoAHoyo.tsx) — mismo criterio que
  // app/porras/[id]/clasificacion/page.tsx: se usa en dos sitios, debajo de
  // todo en la pestaña "Mesa" y, justo debajo de los equipos que lo tienen,
  // en la pestaña "Torneo". Siempre pinta los 18 hoyos de cada ronda
  // conocida, llenos o vacíos.
  function tablaResultadosJugador(jugador: JugadorRow) {
    if (hoyosFoco === 'cargando') {
      return <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>Cargando el hoyo a hoyo...</p>;
    }
    if (!Array.isArray(hoyosFoco)) return null;
    const hoyos: HoyoRow[] = hoyosFoco;
    const rondaEnVivo = jugador.resultado_en_vivo_ronda;
    const rondasConocidas = Array.from(new Set([...hoyos.map((h) => h.ronda), ...(rondaEnVivo ? [rondaEnVivo] : [])])).sort((a, b) => a - b);
    const rondasAMostrar = rondasConocidas.length > 0 ? rondasConocidas : [1];

    let campoIdReferencia: string | null = null;
    for (let i = rondasAMostrar.length - 1; i >= 0 && !campoIdReferencia; i--) {
      campoIdReferencia = hoyos.find((h) => h.ronda === rondasAMostrar[i])?.campo_id ?? null;
    }

    const paresCompletos: (number | null)[] = Array.from({ length: 18 }, (_, i) => {
      const desdeBiblioteca = campoIdReferencia ? (paresPorCampoId[campoIdReferencia]?.[i] ?? null) : null;
      if (desdeBiblioteca !== null) return desdeBiblioteca;
      return hoyos.find((h) => h.hoyo === i + 1)?.par ?? null;
    });

    const filas: FilaRondaTabla[] = rondasAMostrar.map((numero) => {
      const hoyosRonda = hoyos.filter((h) => h.ronda === numero);
      const hoyosPorNumero = new Map(hoyosRonda.map((h) => [h.hoyo, h]));
      const campoId = hoyosRonda[0]?.campo_id ?? null;
      const casillas: CasillaHoyo[] = Array.from({ length: 18 }, (_, i) => {
        const h = hoyosPorNumero.get(i + 1);
        return h ? { par: h.par, golpes: h.golpes, tipo_resultado: h.tipo_resultado } : null;
      });
      return { numero, nombreCampo: campoId ? (nombresCampo[campoId] ?? null) : null, casillas };
    });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <TablaHoyoAHoyo paresCompletos={paresCompletos} filas={filas} />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {(Object.keys(ETIQUETA_TIPO_RESULTADO) as TipoResultadoHoyo[]).map((t) => (
            <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, color: S.MUTED_3 }}>
              <span
                style={{
                  width: 9,
                  height: 9,
                  flexShrink: 0,
                  borderRadius: t === 'eagle_o_mejor' || t === 'birdie' ? '50%' : t === 'par' ? '50%' : 3,
                  background: t === 'par' ? 'transparent' : COLOR_TIPO_RESULTADO[t].fondo,
                  border: t === 'par' ? `1px solid ${S.MUTED_3}` : 'none',
                  display: 'inline-block',
                }}
              />
              {ETIQUETA_TIPO_RESULTADO[t]}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '24px 20px 40px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#3DDC84' }}>{sala.nombre}</span>
            {/* CAMBIO 04/10 (pedido de Iñi, mismo criterio que
                app/porras/[id]/clasificacion/page.tsx): en cuanto el torneo
                termina, el título deja de decir "en directo". */}
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT }}>{torneoFinalizado ? 'Clasificación final' : 'Clasificación en directo'}</h1>
            <p style={{ fontSize: 13, color: S.MUTED_2 }}>{equipos.length} equipo{equipos.length === 1 ? '' : 's'} inscrito{equipos.length === 1 ? '' : 's'}</p>
          </div>

          <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-start' }}>
            {/* CAMBIO 04/10 (pedido de Iñi, mismo criterio que
                app/porras/[id]/clasificacion/page.tsx): en cuanto el
                torneo termina, la pestaña "Mesa" desaparece — solo quedan
                Clasificación final (pestaña Premios, ver abajo), Torneo y
                Eventos. */}
            {!torneoFinalizado && (
              <button type="button" onClick={() => setVista('mesa')} style={vistaPillStyle(vista === 'mesa')}>
                Mesa
              </button>
            )}
            <button type="button" onClick={() => setVista('torneo')} style={vistaPillStyle(vista === 'torneo')}>
              Torneo
            </button>
            <button type="button" onClick={() => setVista('premios')} style={vistaPillStyle(vista === 'premios')}>
              {torneoFinalizado ? 'Clasificación final' : 'Premios'}
            </button>
            {/* Pestaña Eventos (nueva, 04/10, pedido de Iñi, mismo criterio
                que app/porras/[id]/clasificacion/page.tsx — ver el
                comentario completo ahí). */}
            <button type="button" onClick={() => setVista('eventos')} style={vistaPillStyle(vista === 'eventos')}>
              Eventos
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
                        {formatPuntos(totalEquipo(eq.jugadores))}
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
                    {formatPuntos(totalEquipo(equipoSeleccionado.jugadores))} pts
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
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}>
                        <span
                          style={{
                            minWidth: 0,
                            flexShrink: 1,
                            fontFamily: "'Barlow Condensed', sans-serif",
                            fontWeight: 700,
                            fontSize: 12.5,
                            color: S.TEXT,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {j.nombre}
                        </span>
                      </span>
                      {estadoJugador(j) && <span style={{ fontSize: 9, color: S.MUTED_3 }}>{estadoJugador(j)}</span>}
                    </div>
                    <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 13, color: S.MUTED_2 }}>
                      {formatPuntos(puntosDe(j.id))}
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
                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}>
                          <span
                            style={{
                              minWidth: 0,
                              flexShrink: 1,
                              fontFamily: "'Barlow Condensed', sans-serif",
                              fontWeight: 700,
                              fontSize: 12.5,
                              color: S.TEXT,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {j.nombre}
                          </span>
                        </span>
                        {estadoJugador(j) && <span style={{ fontSize: 9, color: S.MUTED_3 }}>{estadoJugador(j)}</span>}
                      </div>
                      <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 13, color: S.MUTED_2 }}>{formatPuntos(puntosDe(j.id))}</span>
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
                                  // Si el torneo ya terminó, la pestaña
                                  // "Mesa" ha desaparecido — se manda en su
                                  // lugar a la clasificación final.
                                  setVista(torneoFinalizado ? 'premios' : 'mesa');
                                  setEquipoSeleccionadoId(eq.equipoId);
                                }}
                                style={{ fontSize: 10.5, fontWeight: 700, color: '#3DDC84', background: 'rgba(61,220,132,0.12)', border: '1px solid rgba(61,220,132,0.3)', borderRadius: 999, padding: '4px 9px', textDecoration: 'none', whiteSpace: 'nowrap' }}
                              >
                                {eq.nombre}
                              </a>
                            ))}
                          </div>
                        )}

                        {/* Resultados hoyo a hoyo (03/10, pedido de Iñi): en
                            la pestaña Torneo va JUSTO debajo de los equipos
                            que tienen a este jugador, no abajo del todo de
                            la página (eso se queda solo para la pestaña
                            Mesa, ver más abajo). */}
                        <div style={{ paddingTop: 2, borderTop: `1px solid ${S.CARD_BORDER}`, display: 'flex', flexDirection: 'column', gap: 5 }}>
                          {estadoJugador(j) && <span style={{ fontSize: 9, color: S.MUTED_3 }}>{estadoJugador(j)}</span>}
                          {desglosePuntosJugador(j)}
                          {tablaResultadosJugador(j)}
                        </div>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Pestaña Premios / Clasificación final (02/10 y 04/10 segunda
              vuelta, pedido de Iñi — mismo criterio que
              app/porras/[id]/clasificacion/page.tsx): mientras el torneo no
              se ha dado por terminado se ve solo el reparto por tramos,
              igual que siempre; en cuanto termina, se ve la clasificación
              real de cada equipo con su premio ya calculado — a partir del
              puesto que no gana nada, solo el nombre. ÚNICA diferencia con
              la porra: aquí esto es siempre una PROPUESTA informativa, no
              una liquidación automática — las mesas no tienen motor de
              puntuación automático (ver cabecera del archivo) y el pago
              real se decide a mano en /admin/pagos-pendientes, que puede
              resolver un empate real de otra forma. */}
          {vista === 'premios' &&
            (() => {
              const bote = parteParaPremios(sala.buy_in) * (sala.aforo ?? equipos.length);
              const tramosPremios = calcularReparto(sala.tipo as TipoSala, sala.aforo, equipos.length);

              if (torneoFinalizado) {
                const clasificacionFinal: ClasificacionEntrada[] = equiposPorPuntuacion.map((eq) => ({
                  equipoId: eq.equipoId,
                  valor: totalEquipo(eq.jugadores),
                }));
                const repartoFinal = repartirPremiosConEmpates(clasificacionFinal, tramosPremios, bote, 'desc').sort((a, b) => a.posicion - b.posicion);
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '20px 14px', background: 'rgba(61,220,132,0.08)', border: '1px solid rgba(61,220,132,0.35)', borderRadius: 12 }}>
                      <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#3DDC84' }}>Mesa terminada · Bote total</span>
                      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 30, color: '#3DDC84' }}>{formatEuros(bote)}</span>
                    </div>
                    {repartoFinal.map((r) => {
                      const eq = equiposPorPuntuacion.find((e) => e.equipoId === r.equipoId);
                      if (r.importe <= 0) {
                        return (
                          <div key={r.equipoId} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 10 }}>
                            <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 13, color: S.MUTED_2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {eq?.nombre ?? 'Equipo'}
                            </span>
                          </div>
                        );
                      }
                      return (
                        <div key={r.equipoId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 10 }}>
                          <span style={{ flexShrink: 0, width: 32, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, color: '#F0B94D' }}>{r.posicion}º</span>
                          <span style={{ flex: 1, minWidth: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 13, color: S.TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {eq?.nombre ?? 'Equipo'}
                          </span>
                          <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, color: S.MUTED_2 }}>{eq ? `${formatPuntos(totalEquipo(eq.jugadores))} pts` : ''}</span>
                          <span style={{ flexShrink: 0, width: 70, textAlign: 'right', fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 13, color: '#3DDC84' }}>
                            {formatEuros(r.importe)}
                          </span>
                        </div>
                      );
                    })}
                    <p style={{ fontSize: 10.5, color: S.MUTED_3, lineHeight: 1.4, margin: 0 }}>
                      Reparto calculado a partir de la clasificación final — el pago real se confirma a mano y puede variar si hay un empate que se resuelva de otra forma.
                    </p>
                  </div>
                );
              }

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

          {/* Pestaña Eventos (nueva, 04/10) — mismo diseño que
              app/porras/[id]/clasificacion/page.tsx. */}
          {vista === 'eventos' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ fontSize: 12.5, color: S.MUTED_2, margin: 0 }}>
                Lo último que ha pasado con tus jugadores favoritos de esta mesa — los 5 de tu propio equipo ya vienen marcados de serie.
              </p>
              {eventos === null || eventos === 'cargando' ? (
                <p style={{ fontSize: 13, color: S.MUTED_2 }}>Cargando...</p>
              ) : eventos.length === 0 ? (
                <p style={{ fontSize: 13, color: S.MUTED_2 }}>
                  Todavía no hay ningún evento que mostrar — o no tienes ningún jugador marcado como favorito en esta mesa.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {eventos.map((e) => (
                    <div
                      key={e.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '9px 10px',
                        background: S.PANEL,
                        border: '1px solid #1E2723',
                        borderRadius: 9,
                      }}
                    >
                      <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: COLOR_TIPO_RESULTADO[e.tipo].fondo }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: S.TEXT }}>
                        <strong>{e.jugador}</strong> ha hecho {ETIQUETA_TIPO_RESULTADO[e.tipo].toLowerCase()} · Hoyo {e.hoyo} · Ronda {e.ronda}
                      </span>
                      <span style={{ flexShrink: 0, fontSize: 10.5, color: S.MUTED_3 }}>
                        {new Date(e.actualizadoEn).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* CAMBIO 03/10 (pedido de Iñi): este bloque de abajo del todo
              solo se usa en la pestaña Mesa (y Premios, por si acaso) — en
              la pestaña Torneo, los resultados del jugador con foco se
              pintan justo debajo de "equipos que lo tienen" (ver más
              arriba), no aquí abajo. */}
          {jugadorFoco && vista !== 'torneo' && vista !== 'eventos' && (
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

              {desglosePuntosJugador(jugadorFoco)}
              {tablaResultadosJugador(jugadorFoco)}
            </div>
          )}

          <span style={{ fontSize: 10, color: S.FAINT }}>
            *Clasificación en directo por puntos Drafters (hoyo a hoyo, rachas, vuelta sin bogeys, hole in one y posición final), actualizada automáticamente cada minuto. Pulsa un jugador para ver el desglose y su hoyo a hoyo. Los puntos por la posición final se suman cuando termina el torneo.
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
