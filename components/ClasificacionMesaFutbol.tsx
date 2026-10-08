'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import AnuncioVideoInline from '@/components/AnuncioVideoInline';
import { etiquetasPosicion } from '@/lib/posicionesEmpate';
import * as S from '@/lib/mockupStyles';
import { formatEuros, parteParaPremios } from '@/lib/salaShared';
import { calcularReparto, type TipoSala } from '@/lib/repartoPremios';
import { claveEquipoLaLiga, escudoLaLiga, formatPuntos } from '@/lib/futbolLaLiga';
import type { LineaDesglose } from '@/lib/futbolPuntuacion';
import { reproducirSonidoAviso, leerPreferenciaSonido, guardarPreferenciaSonido } from '@/lib/sonidoAviso';
import { TIPOS_AVISO_FUTBOL, TIPOS_AVISO_POR_DEFECTO, INFO_TIPO_AVISO, textoAvisoFutbol, type EventoFutbol, type TipoAvisoFutbol } from '@/lib/futbolAvisos';

// ============================================================================
// CLASIFICACIÓN EN DIRECTO DE UNA MESA DRAFTERS DE FÚTBOL (06/10)
// ============================================================================
// Cada jugador puntúa con las tablas de Drafters ("Cómo puntúan los
// jugadores") calculadas con las estadísticas por jugador de ESPN, en directo
// (pedido de Iñi, 06/10; antes puntuaba con LaLiga Fantasy). Los datos los
// escribe el cron (lib/server/sincronizarFutbolEspn.ts) en
// futbol_puntos_jugador (con el desglose acción a acción) y
// futbol_partidos_jornada; esta pantalla solo los lee y se refresca sola.
//
// Reglas de pantalla pedidas por Iñi:
// - Nombre del jugador en AMARILLO si el partido de su equipo se está
//   jugando; en VERDE cuando su partido ha terminado y los puntos son
//   definitivos (incluidos los 0); en ROJO si todavía no están actualizados.
// - Al pulsar un jugador, justo debajo se abre su partido: escudos de los dos
//   equipos, marcador (0-0 si no ha empezado), hora si no ha empezado, minuto
//   parpadeando si se está jugando, y los goles con minuto, goleador, balón y
//   —si se sabe— asistente entre paréntesis con una "A" blanca sobre rojo.
// - Clasificación ordenada por puntuación real (requisito permanente).
// - Indicar de dónde vienen los puntos.

type SalaMin = {
  id: string;
  nombre: string;
  competicion: string;
  tipo: string;
  estado: string;
  buy_in: number;
  aforo: number | null;
  fecha_limite_inscripcion: string | null;
};

type JugadorF = { id: string; nombre: string; equipo_real: string | null; posicion: string | null };
type PuntosF = {
  jugador_id: string;
  jugo: boolean;
  minutos: number | null;
  resultado_equipo: 'G' | 'E' | 'P' | null;
  puntos_total: number;
  partido_estado: string;
  actualizado: boolean;
  desglose: LineaDesglose[] | null;
};
type GolF = { minuto: string; equipo: 'local' | 'visitante'; jugador: string; asistente: string | null; tipo: 'normal' | 'penalti' | 'propia' };
type PartidoF = {
  clave_local: string;
  clave_visitante: string;
  kickoff: string | null;
  equipo_local: string;
  equipo_visitante: string;
  logo_local: string | null;
  logo_visitante: string | null;
  goles_local: number | null;
  goles_visitante: number | null;
  estado: 'pendiente' | 'en_juego' | 'finalizado' | 'aplazado';
  reloj: string | null;
  goles_detalle: GolF[] | null;
};
type EquipoF = { equipoId: string; nombre: string; jugadores: string[]; createdAt: string };

const COLOR_EN_JUEGO = '#F5D547'; // amarillo: partido de su equipo en juego (06/10)
const POSICION_CORTA: Record<string, string> = { portero: 'POR', defensa: 'DEF', centrocampista: 'MED', delantero: 'DEL' };

function formatoHora(iso: string | null): string {
  if (!iso) return 'Hora por confirmar';
  const d = new Date(iso);
  const dia = new Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone: 'Europe/Madrid' }).format(d);
  const hora = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Madrid' }).format(d);
  const fecha = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' }).format(d);
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} ${fecha} a las ${hora}`;
}

function Escudo({ url, nombre, tam = 26 }: { url: string | null; nombre: string; tam?: number }) {
  const [falla, setFalla] = useState(false);
  if (!url || falla) {
    return (
      <span
        style={{
          width: tam,
          height: tam,
          flexShrink: 0,
          borderRadius: '50%',
          background: '#1E2723',
          color: S.MUTED_2,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: Math.max(8, tam * 0.36),
          fontWeight: 800,
          fontFamily: "'Manrope', sans-serif",
        }}
      >
        {nombre.slice(0, 3).toUpperCase()}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={nombre} width={tam} height={tam} onError={() => setFalla(true)} style={{ width: tam, height: tam, flexShrink: 0, objectFit: 'contain' }} />;
}

function InsigniaAsistencia() {
  return (
    <span
      title="Asistencia"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 12,
        height: 12,
        borderRadius: 3,
        background: '#E5372E',
        color: '#fff',
        fontSize: 8,
        fontWeight: 800,
        lineHeight: 1,
        fontFamily: "'Manrope', sans-serif",
        flexShrink: 0,
      }}
    >
      A
    </span>
  );
}

function ListaGoles({ goles, lado }: { goles: GolF[]; lado: 'local' | 'visitante' }) {
  const propios = goles.filter((g) => g.equipo === lado);
  if (propios.length === 0) return <div style={{ flex: 1, minWidth: 0 }} />;
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, alignItems: lado === 'local' ? 'flex-start' : 'flex-end' }}>
      {propios.map((g, i) => (
        <div key={`${g.minuto}-${g.jugador}-${i}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, justifyContent: lado === 'local' ? 'flex-start' : 'flex-end', fontSize: 11, color: S.TEXT, lineHeight: 1.3 }}>
          <span aria-label="Gol" style={{ fontSize: 11 }}>
            ⚽
          </span>
          <span style={{ color: S.MUTED_2, fontWeight: 700 }}>{g.minuto}</span>
          <span style={{ fontWeight: 700 }}>
            {g.jugador}
            {g.tipo === 'penalti' ? ' (p)' : g.tipo === 'propia' ? ' (p.p.)' : ''}
          </span>
          {g.asistente && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: S.MUTED }}>
              (<InsigniaAsistencia />
              {g.asistente})
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function TarjetaPartido({ partido, claveEquipoJugador, escudos }: { partido: PartidoF | null; claveEquipoJugador: string; escudos: Map<string, string> }) {
  if (!partido) {
    return (
      <p style={{ fontSize: 11.5, color: S.MUTED_3, margin: 0 }}>
        Todavía no tenemos el partido de este jugador (puede estar aplazado o la jornada aún no está publicada).
      </p>
    );
  }
  const empezado = partido.estado !== 'pendiente';
  const enDescanso = partido.estado === 'en_juego' && partido.reloj === 'HT';
  const golesL = empezado ? (partido.goles_local ?? 0) : 0;
  const golesV = empezado ? (partido.goles_visitante ?? 0) : 0;
  const goles = partido.goles_detalle ?? [];

  let cabecera: React.ReactNode;
  if (partido.estado === 'en_juego') {
    cabecera = enDescanso ? (
      <span style={{ fontSize: 11, fontWeight: 800, color: '#F0B94D', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Descanso</span>
    ) : (
      <span className="drafters-parpadeo" style={{ fontSize: 13, fontWeight: 800, color: '#FF5C5C', fontFamily: "'Barlow Condensed', sans-serif" }}>
        {partido.reloj ?? 'En juego'}
      </span>
    );
  } else if (partido.estado === 'finalizado') {
    cabecera = <span style={{ fontSize: 11, fontWeight: 800, color: S.MUTED_2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Final</span>;
  } else if (partido.estado === 'aplazado') {
    cabecera = <span style={{ fontSize: 11, fontWeight: 800, color: '#F0B94D', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Aplazado</span>;
  } else {
    cabecera = <span style={{ fontSize: 11.5, fontWeight: 700, color: S.MUTED }}>{formatoHora(partido.kickoff)}</span>;
  }

  const ladoPropio = partido.clave_local === claveEquipoJugador ? 'local' : 'visitante';
  const estiloEquipo = (lado: 'local' | 'visitante') => ({
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    gap: 4,
    opacity: ladoPropio === lado ? 1 : 0.85,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 10px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid #1E2723', borderRadius: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'center' }}>{cabecera}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={estiloEquipo('local')}>
          <Escudo url={partido.logo_local ?? escudos.get(partido.clave_local) ?? escudoLaLiga(partido.equipo_local)} nombre={partido.equipo_local} tam={34} />
          <span style={{ fontSize: 10.5, fontWeight: 700, color: ladoPropio === 'local' ? '#3DDC84' : S.TEXT, textAlign: 'center', lineHeight: 1.2 }}>{partido.equipo_local}</span>
        </div>
        <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 26, color: S.TEXT, minWidth: 64, textAlign: 'center' }}>
          {golesL} - {golesV}
        </span>
        <div style={estiloEquipo('visitante')}>
          <Escudo url={partido.logo_visitante ?? escudos.get(partido.clave_visitante) ?? escudoLaLiga(partido.equipo_visitante)} nombre={partido.equipo_visitante} tam={34} />
          <span style={{ fontSize: 10.5, fontWeight: 700, color: ladoPropio === 'visitante' ? '#3DDC84' : S.TEXT, textAlign: 'center', lineHeight: 1.2 }}>{partido.equipo_visitante}</span>
        </div>
      </div>
      {goles.length > 0 && (
        <div style={{ display: 'flex', gap: 10, paddingTop: 6, borderTop: '1px solid #1E2723' }}>
          <ListaGoles goles={goles} lado="local" />
          <ListaGoles goles={goles} lado="visitante" />
        </div>
      )}
    </div>
  );
}

function signo(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatPuntos(Math.abs(n))}`;
}

/** Línea corta bajo el nombre del jugador. */
function textoResumen(p: PuntosF | undefined, partido: PartidoF | null): string {
  if (!p) return 'Sin datos todavía';
  if (p.partido_estado === 'sin_partido') return 'Sin partido esta jornada';
  if (p.partido_estado === 'aplazado') return 'Partido aplazado';
  if (p.partido_estado === 'pendiente') return partido ? 'Pendiente de su partido' : 'Sin datos todavía';
  if (!p.jugo) return p.partido_estado === 'finalizado' ? 'No ha jugado' : 'Todavía no ha jugado';
  const lineas = p.desglose ?? [];
  if (lineas.length === 0) return '0 puntos';
  return lineas.map((l) => `${l.etiqueta}${l.cantidad > 1 ? ` ×${l.cantidad}` : ''} ${signo(l.puntos)}`).join(' · ');
}

/** Desglose acción a acción de los puntos del jugador (al pulsarlo). */
function DesglosePuntos({ p }: { p: PuntosF | null }) {
  if (!p || !p.jugo) return null;
  const lineas = p.desglose ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid #1E2723', borderRadius: 10 }}>
      <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>
        Desglose de puntos{p.partido_estado === 'en_juego' ? ' (en directo)' : ''}
      </span>
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
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 14, color: S.TEXT }}>{formatPuntos(p.puntos_total)}</span>
      </div>
      <span style={{ fontSize: 9.5, color: S.MUTED_3 }}>Portería a cero, victoria y partido completo se suman al terminar el partido.</span>
    </div>
  );
}

function vistaPillStyle(active: boolean) {
  return {
    padding: '7px 14px',
    borderRadius: 999,
    border: `1px solid ${active ? 'rgba(61,220,132,0.5)' : '#1E2723'}`,
    background: active ? 'rgba(61,220,132,0.12)' : S.PANEL,
    color: active ? '#3DDC84' : S.MUTED_2,
    fontFamily: "'Manrope', sans-serif",
    fontWeight: 700,
    fontSize: 12,
    cursor: 'pointer',
  } as const;
}

export default function ClasificacionMesaFutbol({ sala, saldoLabel, initials }: { sala: SalaMin; saldoLabel: string; initials: string }) {
  const [cargando, setCargando] = useState(true);
  const [jugadores, setJugadores] = useState<JugadorF[]>([]);
  const [equipos, setEquipos] = useState<EquipoF[]>([]);
  const [puntos, setPuntos] = useState<Map<string, PuntosF>>(new Map());
  const [partidos, setPartidos] = useState<PartidoF[]>([]);
  const [escudos, setEscudos] = useState<Map<string, string>>(new Map());
  const [vista, setVista] = useState<'mesa' | 'eventos' | 'premios'>('mesa');

  // Avisos y eventos (07/10, pedido de Iñi): como en golf, pero para los
  // jugadores del EQUIPO del usuario en esta mesa y con las alertas
  // elegibles (guardadas en su cuenta). Ver lib/futbolAvisos.ts.
  const [usuarioId, setUsuarioId] = useState<string | null>(null);
  const [misIds, setMisIds] = useState<string[]>([]);
  const [tiposActivos, setTiposActivos] = useState<Set<TipoAvisoFutbol>>(new Set(TIPOS_AVISO_POR_DEFECTO));
  const [eventos, setEventos] = useState<EventoFutbol[] | null>(null);
  const [avisos, setAvisos] = useState<EventoFutbol[]>([]);
  const [sonidoActivado, setSonidoActivado] = useState(true);
  const [errorPreferencias, setErrorPreferencias] = useState<string | null>(null);
  const tiposActivosRef = useRef(tiposActivos);
  tiposActivosRef.current = tiposActivos;
  const sonidoActivadoRef = useRef(sonidoActivado);
  sonidoActivadoRef.current = sonidoActivado;
  const eventosVistosRef = useRef<Set<string> | null>(null);
  const [equipoSeleccionadoId, setEquipoSeleccionadoId] = useState<string | null>(null);
  const [jugadorFocoId, setJugadorFocoId] = useState<string | null>(null);

  // Carga inicial: plantilla de jugadores y equipos de la mesa.
  useEffect(() => {
    let activo = true;
    async function cargar() {
      const [{ data: jug }, { data: eqs }, { data: esc }] = await Promise.all([
        supabase.from('jugadores').select('id,nombre,equipo_real,posicion').eq('deporte', 'futbol').eq('competicion', sala.competicion),
        // Solo devuelve filas cuando la inscripción ya se ha cerrado.
        supabase.rpc('equipos_sala_clasificacion', { p_sala_id: sala.id }),
        supabase.from('futbol_escudos').select('clave,logo'),
      ]);
      if (!activo) return;
      // Mi equipo en esta mesa (puede haber varios en el Maratón) y mis alertas.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session && activo) {
        setUsuarioId(session.user.id);
        const [{ data: misEquipos }, { data: pref }] = await Promise.all([
          supabase.from('equipos').select('jugadores').eq('sala_id', sala.id).eq('usuario_id', session.user.id),
          supabase.from('preferencias_avisos_futbol').select('tipos').eq('usuario_id', session.user.id).maybeSingle(),
        ]);
        if (!activo) return;
        const ids = new Set<string>();
        for (const e of (misEquipos as { jugadores: unknown }[] | null) ?? []) if (Array.isArray(e.jugadores)) for (const id of e.jugadores) if (typeof id === 'string') ids.add(id);
        setMisIds(Array.from(ids));
        const tipos = (pref as { tipos: string[] } | null)?.tipos;
        if (tipos) setTiposActivos(new Set(tipos.filter((t): t is TipoAvisoFutbol => t in INFO_TIPO_AVISO)));
      }
      setEscudos(new Map(((esc as { clave: string; logo: string }[]) ?? []).map((e) => [e.clave, e.logo])));
      setJugadores((jug as JugadorF[]) ?? []);
      const lista = ((eqs as { equipo_id: string; nombre: string; jugadores: string[]; created_at: string }[]) ?? [])
        .map((f) => ({ equipoId: f.equipo_id, nombre: f.nombre, jugadores: f.jugadores ?? [], createdAt: f.created_at }))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setEquipos(lista);
      if (lista.length > 0) setEquipoSeleccionadoId(lista[0].equipoId);
      setCargando(false);
    }
    cargar();
    return () => {
      activo = false;
    };
  }, [sala.id, sala.competicion]);

  // Puntos y marcadores: se refrescan solos cada 20 segundos.
  useEffect(() => {
    let activo = true;
    async function refrescar() {
      const [{ data: pts }, { data: pts2 }] = await Promise.all([
        supabase
          .from('futbol_puntos_jugador')
          .select('jugador_id,jugo,minutos,resultado_equipo,puntos_total,partido_estado,actualizado,desglose')
          .eq('competicion', sala.competicion),
        supabase
          .from('futbol_partidos_jornada')
          .select('clave_local,clave_visitante,kickoff,equipo_local,equipo_visitante,logo_local,logo_visitante,goles_local,goles_visitante,estado,reloj,goles_detalle')
          .eq('competicion', sala.competicion),
      ]);
      if (!activo) return;
      setPuntos(new Map(((pts as PuntosF[]) ?? []).map((p) => [p.jugador_id, p])));
      setPartidos((pts2 as PartidoF[]) ?? []);
    }
    refrescar();
    const intervalo = setInterval(refrescar, 20000);
    return () => {
      activo = false;
      clearInterval(intervalo);
    };
  }, [sala.competicion]);

  useEffect(() => {
    setSonidoActivado(leerPreferenciaSonido());
  }, []);

  // Eventos de MIS jugadores, cada 20 segundos. La primera lectura solo se
  // anota (nada de avisos por lo que ya había pasado); a partir de ahí, cada
  // evento nuevo cuyo tipo esté activado sale como aviso de 5 segundos con
  // sonido, igual que en golf.
  const misIdsClave = misIds.join(',');
  useEffect(() => {
    if (misIds.length === 0) {
      setEventos([]);
      return;
    }
    let activo = true;
    async function revisar() {
      const { data } = await supabase
        .from('futbol_eventos')
        .select('id,tipo,jugador_id,jugador_nombre,equipo_real,minuto,detalle,creado_en')
        .eq('competicion', sala.competicion)
        .in('jugador_id', misIds)
        .order('creado_en', { ascending: false })
        .limit(300);
      if (!activo) return;
      const filas = ((data as EventoFutbol[]) ?? []).filter((e) => e.tipo in INFO_TIPO_AVISO);
      setEventos(filas);
      const vistos = eventosVistosRef.current;
      if (vistos === null) {
        eventosVistosRef.current = new Set(filas.map((e) => e.id));
        return;
      }
      const nuevos = filas.filter((e) => !vistos.has(e.id)).reverse(); // del más antiguo al más nuevo
      nuevos.forEach((e) => vistos.add(e.id));
      const aAvisar = nuevos.filter((e) => tiposActivosRef.current.has(e.tipo));
      if (aAvisar.length > 0) {
        setAvisos((prev) => [...prev, ...aAvisar]);
        if (sonidoActivadoRef.current) reproducirSonidoAviso();
      }
    }
    revisar();
    const intervalo = setInterval(revisar, 20000);
    return () => {
      activo = false;
      clearInterval(intervalo);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [misIdsClave, sala.competicion]);

  // El aviso dura 5 segundos; si llega otro detrás, no reinicia el cronómetro del actual.
  useEffect(() => {
    if (avisos.length === 0) return;
    const idAMostrar = avisos[0].id;
    const timer = setTimeout(() => setAvisos((prev) => prev.filter((a) => a.id !== idAMostrar)), 5000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avisos.length > 0 ? avisos[0].id : null]);

  async function alternarTipoAviso(tipo: TipoAvisoFutbol) {
    if (!usuarioId) return;
    const nuevo = new Set(tiposActivos);
    if (nuevo.has(tipo)) nuevo.delete(tipo);
    else nuevo.add(tipo);
    setTiposActivos(nuevo);
    setErrorPreferencias(null);
    const { error } = await supabase
      .from('preferencias_avisos_futbol')
      .upsert({ usuario_id: usuarioId, tipos: Array.from(nuevo), updated_at: new Date().toISOString() }, { onConflict: 'usuario_id' });
    if (error) setErrorPreferencias('No se han podido guardar tus alertas. Inténtalo de nuevo.');
  }

  const jugadoresPorId = useMemo(() => new Map(jugadores.map((j) => [j.id, j])), [jugadores]);

  function totalEquipo(ids: string[]): number {
    return ids.reduce((acc, id) => acc + (puntos.get(id)?.puntos_total ?? 0), 0);
  }

  function partidoDe(j: JugadorF): { partido: PartidoF | null; clave: string } {
    const clave = claveEquipoLaLiga(j.equipo_real);
    const partido = partidos.find((p) => p.clave_local === clave || p.clave_visitante === clave) ?? null;
    return { partido, clave };
  }

  // Más puntos = mejor. Ordenada por puntuación real, nunca por inscripción;
  // el empate se mantiene por orden de inscripción (sort estable).
  const equiposPorPuntuacion = useMemo(
    () => equipos.slice().sort((a, b) => totalEquipo(b.jugadores) - totalEquipo(a.jugadores)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [equipos, puntos]
  );

  const encabezado = (
    <>
      <style>{`@keyframes drafters-parpadeo { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } } .drafters-parpadeo { animation: drafters-parpadeo 1.8s ease-in-out infinite; }`}</style>
      <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
    </>
  );

  if (cargando) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          {encabezado}
          <div style={{ padding: '40px 20px' }}>
            <p style={{ fontSize: 14, color: S.MUTED }}>Cargando...</p>
          </div>
        </div>
      </main>
    );
  }

  if (equipos.length === 0) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          {encabezado}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '48px 24px', alignItems: 'center', textAlign: 'center' }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif" }}>Clasificación en directo</h1>
            <p style={{ fontSize: 14, color: S.MUTED_2, lineHeight: 1.6 }}>
              Esta mesa todavía no ha empezado, o todavía no hay equipos inscritos. En cuanto se cierre la inscripción podrás ver aquí la clasificación de todos los participantes.
            </p>
            <Link href={`/salas/${sala.id}`} style={{ ...S.secondaryLinkButton, width: 'auto', padding: '12px 24px', textDecoration: 'none', display: 'inline-flex' }}>
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

  // Puesto con "T" si hay empate (08/10, ver lib/posicionesEmpate.ts).
  const etiquetasEquipos = etiquetasPosicion(equiposPorPuntuacion, (eq) => totalEquipo(eq.jugadores));
  const equipoSeleccionado = equiposPorPuntuacion.find((e) => e.equipoId === equipoSeleccionadoId) ?? equiposPorPuntuacion[0];
  const jugadoresDelEquipo = equipoSeleccionado.jugadores.map((id) => jugadoresPorId.get(id)).filter((j): j is JugadorF => !!j);

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        {encabezado}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '24px 20px 40px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#3DDC84' }}>{sala.nombre}</span>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT }}>Clasificación en directo</h1>
            <p style={{ fontSize: 13, color: S.MUTED_2 }}>
              {equipos.length} equipo{equipos.length === 1 ? '' : 's'} inscrito{equipos.length === 1 ? '' : 's'} · {sala.competicion}
            </p>
            {/* De dónde salen los puntos (pedido de Iñi, 30/09 y 06/10). */}
            <p style={{ fontSize: 11, color: S.MUTED_3, lineHeight: 1.45, margin: 0 }}>
              Puntos según las tablas de Drafters con las estadísticas de cada jugador en directo. Pulsa un jugador para ver el desglose y su partido. El color del nombre indica el estado de sus puntos (leyenda bajo los jugadores).
            </p>
          </div>

          <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-start' }}>
            <button type="button" onClick={() => setVista('mesa')} style={vistaPillStyle(vista === 'mesa')}>
              Mesa
            </button>
            <button type="button" onClick={() => setVista('eventos')} style={vistaPillStyle(vista === 'eventos')}>
              Eventos
            </button>
            <button type="button" onClick={() => setVista('premios')} style={vistaPillStyle(vista === 'premios')}>
              Premios
            </button>
            {/* Campanita de sonido (07/10): igual que en golf; se recuerda
                por dispositivo (lib/sonidoAviso.ts). */}
            <button
              type="button"
              onClick={() => {
                const nuevoValor = !sonidoActivado;
                setSonidoActivado(nuevoValor);
                guardarPreferenciaSonido(nuevoValor);
              }}
              aria-pressed={sonidoActivado}
              aria-label={sonidoActivado ? 'Desactivar el sonido de los avisos' : 'Activar el sonido de los avisos'}
              title={sonidoActivado ? 'Sonido de avisos activado' : 'Sonido de avisos desactivado'}
              style={{
                flexShrink: 0,
                width: 30,
                height: 30,
                alignSelf: 'center',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                cursor: 'pointer',
                border: `1px solid ${sonidoActivado ? 'rgba(61,220,132,0.4)' : 'rgba(255,92,92,0.4)'}`,
                background: sonidoActivado ? 'rgba(61,220,132,0.12)' : 'rgba(255,92,92,0.12)',
              }}
            >
              {sonidoActivado ? '🔔' : '🔕'}
            </button>
          </div>

          {/* Aviso de evento de uno de MIS jugadores (07/10): tira de 5
              segundos con sonido, en cualquier pestaña. */}
          {avisos.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '9px 14px',
                borderRadius: 10,
                alignSelf: 'flex-start',
                background: 'rgba(61,220,132,0.1)',
                border: '1px solid rgba(61,220,132,0.4)',
              }}
            >
              <span style={{ fontSize: 15, flexShrink: 0 }}>{INFO_TIPO_AVISO[avisos[0].tipo].icono}</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: S.TEXT }}>{textoAvisoFutbol(avisos[0])}</span>
            </div>
          )}

          {vista === 'mesa' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flexShrink: 0, width: 150, display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 520, overflowY: 'auto' }}>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Equipos ({equipos.length})</span>
                {equiposPorPuntuacion.map((eq, i) => {
                  const activo = eq.equipoId === equipoSeleccionado.equipoId;
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
                        gap: 6,
                        padding: 8,
                        background: activo ? 'rgba(61,220,132,0.1)' : S.PANEL,
                        border: `1px solid ${activo ? 'rgba(61,220,132,0.4)' : '#1E2723'}`,
                        borderRadius: 9,
                        textDecoration: 'none',
                      }}
                    >
                      <span style={{ flexShrink: 0, minWidth: 16, textAlign: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 11, color: S.MUTED_2 }}>{etiquetasEquipos[i]}</span>
                      <span style={{ flex: 1, minWidth: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 10.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{eq.nombre}</span>
                      <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 12, color: S.MUTED_2 }}>{formatPuntos(totalEquipo(eq.jugadores))}</span>
                    </motion.a>
                  );
                })}
              </div>

              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 10 }}>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{equipoSeleccionado.nombre}</span>
                  <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, color: '#3DDC84' }}>{formatPuntos(totalEquipo(equipoSeleccionado.jugadores))} pts</span>
                </div>

                {jugadoresDelEquipo.map((j) => {
                  const p = puntos.get(j.id);
                  const definitivo = !!p?.actualizado;
                  const enFoco = jugadorFocoId === j.id;
                  const { partido, clave } = partidoDe(j);
                  // 06/10 (Iñi): tercer color — AMARILLO si el partido de su
                  // equipo se está jugando ahora; verde = terminado y puntos
                  // actualizados; rojo = todavía sin actualizar.
                  const enJuego = partido?.estado === 'en_juego';
                  const colorNombre = enJuego ? COLOR_EN_JUEGO : definitivo ? S.ACCENT : S.ERROR;
                  const detalle = textoResumen(p, partido);
                  return (
                    <motion.div layout transition={{ type: 'spring', stiffness: 420, damping: 38 }} key={j.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
                          background: enFoco ? 'rgba(61,220,132,0.1)' : S.PANEL,
                          border: `1px solid ${enFoco ? 'rgba(61,220,132,0.4)' : '#1E2723'}`,
                          borderRadius: 9,
                          textDecoration: 'none',
                        }}
                      >
                        <Escudo url={(partido ? (partido.clave_local === clave ? partido.logo_local : partido.logo_visitante) : null) ?? escudos.get(clave) ?? escudoLaLiga(j.equipo_real)} nombre={j.equipo_real ?? '?'} tam={20} />
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}>
                            <span
                              style={{
                                minWidth: 0,
                                flexShrink: 1,
                                fontFamily: "'Barlow Condensed', sans-serif",
                                fontWeight: 700,
                                fontSize: 13,
                                color: colorNombre,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {j.nombre}
                            </span>
                            {j.posicion && <span style={{ flexShrink: 0, fontSize: 8.5, fontWeight: 700, color: S.MUTED_3 }}>{POSICION_CORTA[j.posicion] ?? ''}</span>}
                          </span>
                          <span style={{ fontSize: 9, color: S.MUTED_3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detalle}</span>
                        </div>
                        <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 14, color: S.TEXT }}>{formatPuntos(p?.puntos_total ?? 0)}</span>
                      </a>
                      {enFoco && <DesglosePuntos p={p ?? null} />}
                      {enFoco && <TarjetaPartido partido={partido} claveEquipoJugador={clave} escudos={escudos} />}
                    </motion.div>
                  );
                })}

                {/* Leyenda de los tres colores (pedido de Iñi, 06/10). */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', padding: '4px 2px 0' }}>
                  {[
                    { color: COLOR_EN_JUEGO, texto: 'Partido en juego' },
                    { color: S.ACCENT, texto: 'Puntos actualizados' },
                    { color: S.ERROR, texto: 'Sin actualizar' },
                  ].map((l) => (
                    <span key={l.texto} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, color: S.MUTED_3 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: l.color, flexShrink: 0 }} />
                      {l.texto}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {vista === 'eventos' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: 12.5, color: S.MUTED_2, margin: 0, lineHeight: 1.45 }}>
                Elige de qué quieres que te avisemos cuando le pase a un jugador de tu equipo en esta mesa. Los avisos salen en esta pantalla con sonido (la campanita de arriba lo activa o lo silencia).
              </p>

              {(['goles', 'otras'] as const).map((grupo) => (
                <div key={grupo} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>
                    {grupo === 'goles' ? 'Goles y penaltis' : 'Otras alertas (desactivadas al principio)'}
                  </span>
                  {TIPOS_AVISO_FUTBOL.filter((t) => t.grupo === grupo).map((t) => {
                    const on = tiposActivos.has(t.tipo);
                    return (
                      <button
                        key={t.tipo}
                        type="button"
                        onClick={() => alternarTipoAviso(t.tipo)}
                        aria-pressed={on}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '10px 12px',
                          background: on ? 'rgba(61,220,132,0.08)' : S.PANEL,
                          border: `1px solid ${on ? 'rgba(61,220,132,0.4)' : '#1E2723'}`,
                          borderRadius: 9,
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <span style={{ fontSize: 15, flexShrink: 0, width: 22, textAlign: 'center' }}>{t.icono}</span>
                        <span style={{ flex: 1, minWidth: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12.5, color: on ? S.TEXT : S.MUTED_2 }}>{t.etiqueta}</span>
                        <span
                          style={{
                            flexShrink: 0,
                            width: 38,
                            height: 22,
                            borderRadius: 999,
                            background: on ? '#3DDC84' : '#2A3330',
                            position: 'relative',
                            transition: 'background 0.15s',
                          }}
                        >
                          <span style={{ position: 'absolute', top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: '50%', background: on ? '#04140B' : '#8A9490', transition: 'left 0.15s' }} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
              {errorPreferencias && <p style={{ fontSize: 12, color: S.ERROR, margin: 0 }}>{errorPreferencias}</p>}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Lo último de tus jugadores</span>
                {misIds.length === 0 ? (
                  <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>No tienes ningún equipo en esta mesa, así que no hay eventos que mostrar.</p>
                ) : eventos === null ? (
                  <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>Cargando...</p>
                ) : (
                  (() => {
                    const visibles = eventos.filter((e) => tiposActivos.has(e.tipo));
                    if (visibles.length === 0) return <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>Todavía no ha pasado nada de lo que has elegido con los jugadores de tu equipo.</p>;
                    return visibles.map((e) => (
                      <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 9 }}>
                        <span style={{ fontSize: 15, flexShrink: 0, width: 22, textAlign: 'center' }}>{INFO_TIPO_AVISO[e.tipo].icono}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: S.TEXT }}>{textoAvisoFutbol(e)}</span>
                        <span style={{ flexShrink: 0, fontSize: 10.5, color: S.MUTED_3 }}>
                          {new Date(e.creado_en).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}
                        </span>
                      </div>
                    ));
                  })()
                )}
              </div>
            </div>
          )}

          {vista === 'premios' &&
            (() => {
              const bote = parteParaPremios(sala.buy_in) * (sala.aforo ?? equipos.length);
              const tramos = calcularReparto(sala.tipo as TipoSala, sala.aforo, equipos.length);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '20px 14px', background: 'rgba(240,185,77,0.1)', border: '1px solid rgba(240,185,77,0.35)', borderRadius: 12 }}>
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#C9A257' }}>Bote total</span>
                    <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 30, color: '#F0B94D' }}>{formatEuros(bote)}</span>
                  </div>
                  {tramos.length === 0 && <p style={{ fontSize: 13, color: S.MUTED_2 }}>Todavía no hay suficientes equipos inscritos para calcular el reparto.</p>}
                  {tramos.map((t, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '13px 14px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 10 }}>
                      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, color: S.TEXT }}>{t.desde === t.hasta ? `${t.desde}º` : `${t.desde}º–${t.hasta}º`}</span>
                      <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 14, color: '#F0B94D' }}>{formatEuros((bote * t.porcentajeCadaUno) / 100)}</span>
                    </div>
                  ))}
                  <p style={{ fontSize: 10.5, color: S.MUTED_3, lineHeight: 1.4, margin: 0 }}>Prueba con dinero ficticio: el pago real de la mesa se confirma a mano.</p>
                </div>
              );
            })()}

          <Link href={`/salas/${sala.id}`} style={{ ...S.secondaryLinkButton, width: 'auto', padding: '12px 24px', textDecoration: 'none', display: 'inline-flex', alignSelf: 'center' }}>
            Volver a la mesa
          </Link>
          <div style={{ width: '100%', maxWidth: 420, alignSelf: 'center' }}>
            <AnuncioVideoInline ubicacion="clasificacion" />
          </div>
        </div>
      </div>
    </main>
  );
}
