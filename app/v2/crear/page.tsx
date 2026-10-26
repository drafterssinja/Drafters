'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { todasLasFilas } from '@/lib/paginar';
import * as S from '@/lib/mockupStyles';
import MarcoV2, { EtiquetaBeta, Panel, Titulo, V2_COLOR } from '@/components/v2/MarcoV2';
import EditorPremio, { PREMIO_VACIO } from '@/components/v2/EditorPremio';
import SelectorJugadores from '@/components/v2/SelectorJugadores';
import { useSesionV2 } from '@/components/v2/useSesionV2';
import CosteCredito from '@/components/v2/CosteCredito';
import { avisarCambioCreditos } from '@/components/v2/creditos';
import { MODALIDAD_DESC, MODALIDAD_LABEL, fechaCorta, mensajeError, premioValido, type Modalidad, type Premio } from '@/lib/v2';
import Cargando from '@/components/Cargando';
import { diaDeTramo, etiquetaTramo, fechaMadrid, ordenTramo } from '@/lib/tramos';
import { claveEquipoLaLiga } from '@/lib/futbolLaLiga';

// ============================================================================
// DRAFTERS V2 — CREAR UNA SALA (15/10)
// ============================================================================
// Pedido de Iñi: ya no hay mesas creadas de antemano; cada uno crea la suya y
// decide: deporte, una jornada o varias seguidas (p.ej. Liga J8 a J11), qué
// partidos entran (si es una sola jornada), cuántos jugadores, modalidad
// (presupuesto / libre / draft), pública o privada con contraseña y, en las
// privadas, lo que se juega cada uno y cómo se reparte.

type Comp = { deporte: string; competicion: string; cierre: string | null; soloTramos?: boolean };
// 17/10: tramos (un día de fútbol con 3+ partidos / una ronda de golf) que siguen abiertos.
type TramoDisp = { competicion: string; tramo: string; cierre: string; partidos: number | null };

// 15/10 (Iñi): se puede llegar hasta cualquier jornada de la competición,
// aunque todavía no tenga horarios; se va completando sola al publicarse.
const JORNADAS_POR_LIGA: Record<string, number> = { 'La Liga': 38, 'Premier League': 38, 'Champions League': 8 };
type Partido = { local: string; visitante: string; kickoff: string | null };

// 16/10 (Iñi): al crear un amistoso de fútbol hay que elegir de qué competición es.
const COMPETICIONES_FUTBOL = ['La Liga', 'Champions League'];
const NOMBRE_COMPETICION: Record<string, string> = { 'La Liga': 'LaLiga', 'Champions League': 'Champions League' };

function ligaDe(competicion: string): string {
  return competicion.replace(/\s*-\s*Jornada\s*\d+\s*$/i, '');
}
function numeroJornada(competicion: string): number {
  const m = competicion.match(/Jornada\s*(\d+)/i);
  return m ? Number(m[1]) : 0;
}

export default function V2Crear() {
  return (
    <Suspense fallback={<Cargando />}>
      <V2CrearInner />
    </Suspense>
  );
}

function V2CrearInner() {
  const router = useRouter();
  const { perfil, estado } = useSesionV2();
  const [comps, setComps] = useState<Comp[] | null>(null);
  const [tramosDisp, setTramosDisp] = useState<TramoDisp[]>([]);
  const [tramo, setTramo] = useState<string | null>(null);

  const [nombre, setNombre] = useState('');
  // 15/10: se crea desde la página de un deporte, así que ya viene elegido.
  const depParam = useSearchParams().get('deporte');
  const deporte: 'futbol' | 'golf' | 'tenis' = depParam === 'golf' ? 'golf' : depParam === 'tenis' ? 'tenis' : 'futbol';
  // 27/10: golf y tenis se juegan por torneo (no por jornadas).
  const porTorneo = deporte !== 'futbol';
  const [liga, setLiga] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [torneo, setTorneo] = useState('');
  const [partidos, setPartidos] = useState<Partido[]>([]);
  const [partidosOn, setPartidosOn] = useState<Set<string>>(new Set());
  const [jugadoresPorEquipo, setJugadoresPorEquipo] = useState<Map<string, Record<string, number>>>(new Map());
  const [numJugadores, setNumJugadores] = useState(4);
  const [modalidad, setModalidad] = useState<Modalidad>('presupuesto');
  // 26/10 (Iñi): crear es solo para salas privadas; las públicas ya están creadas de serie (salas de Drafters).
  const privada = true;
  const [contrasena, setContrasena] = useState('');
  const [premio, setPremio] = useState<Premio>(PREMIO_VACIO);
  const [equipoFijo, setEquipoFijo] = useState(false);
  const [paso, setPaso] = useState(1);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (estado !== 'ok') return;
    void Promise.all([supabase.rpc('amistoso_competiciones_disponibles'), supabase.rpc('v2_tramos_disponibles', { p_deporte: deporte })]).then(([c, t]) => {
      const lista = ((c.data as Comp[]) ?? []).slice();
      const tramos = (t.data as TramoDisp[]) ?? [];
      // Jornadas/torneos ya empezados que todavía tienen algún día o ronda abierto.
      for (const x of tramos) {
        if (!lista.some((l) => l.competicion === x.competicion)) lista.push({ deporte, competicion: x.competicion, cierre: x.cierre, soloTramos: true });
      }
      setTramosDisp(tramos);
      setComps(lista);
    });
  }, [estado, deporte]);

  const futbol = useMemo(() => (comps ?? []).filter((c) => c.deporte === 'futbol'), [comps]);
  const golf = useMemo(() => (comps ?? []).filter((c) => c.deporte === deporte), [comps, deporte]);
  const ligas = useMemo(() => Array.from(new Set(futbol.map((c) => ligaDe(c.competicion)))), [futbol]);
  const publicadasLiga = useMemo(() => futbol.filter((c) => ligaDe(c.competicion) === liga).sort((a, b) => numeroJornada(a.competicion) - numeroJornada(b.competicion)), [futbol, liga]);
  // Publicadas + las que vienen detrás (sin horarios todavía) hasta el final de la competición.
  const jornadasLiga = useMemo(() => {
    if (publicadasLiga.length === 0) return [] as Comp[];
    const ultima = numeroJornada(publicadasLiga[publicadasLiga.length - 1].competicion);
    const maximo = Math.max(JORNADAS_POR_LIGA[liga] ?? 38, ultima);
    const futuras: Comp[] = [];
    for (let n = ultima + 1; n <= maximo; n++) futuras.push({ deporte: 'futbol', competicion: `${liga} - Jornada ${n}`, cierre: null });
    return [...publicadasLiga, ...futuras];
  }, [publicadasLiga, liga]);

  // Valores por defecto al cargar / cambiar de liga.
  useEffect(() => {
    // 16/10 (Iñi): la competición (LaLiga o Champions) la elige siempre el usuario;
    // solo se marca sola si no hay más que una con jornada abierta.
    if (!liga && ligas.length === 1 && COMPETICIONES_FUTBOL.length <= 1) setLiga(ligas[0]);
  }, [ligas, liga]);
  useEffect(() => {
    if (publicadasLiga.length) {
      setDesde(publicadasLiga[0].competicion);
      setHasta(publicadasLiga[0].competicion);
    }
  }, [publicadasLiga]);
  useEffect(() => {
    if (!torneo && golf.length) setTorneo(golf[0].competicion);
  }, [golf, torneo]);

  const seleccion: string[] = useMemo(() => {
    if (porTorneo) return torneo ? [torneo] : [];
    const a = jornadasLiga.findIndex((c) => c.competicion === desde);
    const b = jornadasLiga.findIndex((c) => c.competicion === hasta);
    if (a < 0 || b < 0 || b < a) return [];
    return jornadasLiga.slice(a, b + 1).map((c) => c.competicion);
  }, [porTorneo, torneo, jornadasLiga, desde, hasta]);

  // Los partidos se eligen aquí solo para la primera jornada; los de las
  // siguientes, desde la sala cuando se publiquen (15/10, Iñi).
  const unaJornadaFutbol = deporte === 'futbol' && seleccion.length >= 1 ? seleccion[0] : null;
  const varias = seleccion.length > 1;

  // Partidos de la jornada (solo si es una) para elegir cuáles entran.
  useEffect(() => {
    if (!unaJornadaFutbol) {
      setPartidos([]);
      return;
    }
    let activo = true;
    (async () => {
      const [{ data: cuotas }, { data: jornada }, jugs] = await Promise.all([
        supabase.from('cuotas_partido_futbol').select('equipo_local,equipo_visitante').eq('competicion', unaJornadaFutbol),
        supabase.from('futbol_partidos_jornada').select('equipo_local,equipo_visitante,clave_local,clave_visitante,kickoff').eq('competicion', unaJornadaFutbol),
        todasLasFilas<{ equipo_real: string | null; posicion: string | null }>((d, h) =>
          supabase.from('jugadores').select('equipo_real,posicion').eq('competicion', unaJornadaFutbol).not('baja', 'is', true).order('id').range(d, h)
        ),
      ]);
      if (!activo) return;
      // 17/10: los nombres de ESPN y los nuestros no siempre coinciden → por clave de equipo.
      const filasJ = (jornada as { equipo_local: string; equipo_visitante: string; clave_local: string; clave_visitante: string; kickoff: string | null }[]) ?? [];
      const kick = new Map<string, string | null>();
      filasJ.forEach((p) => {
        kick.set(`${p.equipo_local}|${p.equipo_visitante}`, p.kickoff);
        kick.set(`${p.clave_local}|${p.clave_visitante}`, p.kickoff);
      });
      const lista = ((cuotas as { equipo_local: string; equipo_visitante: string }[]) ?? []).map((c) => ({
        local: c.equipo_local,
        visitante: c.equipo_visitante,
        kickoff: kick.get(`${c.equipo_local}|${c.equipo_visitante}`) ?? kick.get(`${claveEquipoLaLiga(c.equipo_local)}|${claveEquipoLaLiga(c.equipo_visitante)}`) ?? null,
      }));
      lista.sort((a, b) => (a.kickoff ?? '9').localeCompare(b.kickoff ?? '9'));
      setPartidos(lista);
      setPartidosOn(new Set(lista.map((p) => `${p.local}|${p.visitante}`)));
      const porEquipo = new Map<string, Record<string, number>>();
      for (const j of jugs.data) {
        if (!j.equipo_real) continue;
        const r = porEquipo.get(j.equipo_real) ?? {};
        r[j.posicion ?? 'centrocampista'] = (r[j.posicion ?? 'centrocampista'] ?? 0) + 1;
        porEquipo.set(j.equipo_real, r);
      }
      setJugadoresPorEquipo(porEquipo);
    })();
    return () => {
      activo = false;
    };
  }, [unaJornadaFutbol]);

  const todosLosPartidos = partidos.length > 0 && partidosOn.size === partidos.length;

  // 17/10 (Iñi): partidos de un solo día (3+ partidos) o una sola ronda de golf.
  const compTramos = porTorneo ? torneo : unaJornadaFutbol;
  const tramosDeSeleccion = useMemo(() => tramosDisp.filter((t) => t.competicion === compTramos).sort((a, b) => ordenTramo(a.tramo).localeCompare(ordenTramo(b.tramo))), [tramosDisp, compTramos]);
  const compElegida = (comps ?? []).find((c) => c.competicion === compTramos);
  const completaDisponible = !!compElegida && !compElegida.soloTramos;
  // Al cambiar de jornada/torneo: si la completa ya ha empezado, el primer tramo abierto.
  useEffect(() => {
    if (!compTramos) return setTramo(null);
    if (completaDisponible) return setTramo(null);
    setTramo(tramosDeSeleccion[0]?.tramo ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compTramos, completaDisponible, tramosDeSeleccion.length]);
  // Con un día elegido: solo sus partidos (y una sola jornada).
  const partidosVisibles = useMemo(() => {
    const dia = diaDeTramo(tramo);
    return dia ? partidos.filter((p) => p.kickoff && fechaMadrid(p.kickoff) === dia) : partidos;
  }, [partidos, tramo]);
  // Días de la jornada (hora de Madrid) para los atajos "solo los del sábado".
  const diasDePartidos = useMemo(() => {
    const m = new Map<string, string[]>();
    partidos.forEach((p) => {
      if (!p.kickoff) return;
      const d = fechaMadrid(p.kickoff);
      m.set(d, [...(m.get(d) ?? []), `${p.local}|${p.visitante}`]);
    });
    return Array.from(m.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dia, claves]) => ({ dia, claves, etiqueta: new Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone: 'Europe/Madrid' }).format(new Date(`${dia}T12:00:00Z`)) }));
  }, [partidos]);
  function elegirDia(dia: string, claves: string[]) {
    // Si ese día tiene sus propias mesas (3+ partidos), la sala cierra al empezar ese día.
    const t = tramosDeSeleccion.find((x) => x.tramo === `dia:${dia}`);
    if (t) setTramo(t.tramo);
    else {
      if (!completaDisponible) return;
      if (tramo === null) setPartidosOn(new Set(claves));
      else {
        seleccionPendiente.current = claves;
        setTramo(null);
      }
    }
  }
  const seleccionPendiente = useRef<string[] | null>(null);
  useEffect(() => {
    if (deporte !== 'futbol') return;
    const dia = diaDeTramo(tramo);
    if (dia) {
      setPartidosOn(new Set(partidosVisibles.map((p) => `${p.local}|${p.visitante}`)));
      setHasta(desde);
    } else if (seleccionPendiente.current) {
      setPartidosOn(new Set(seleccionPendiente.current));
      seleccionPendiente.current = null;
    } else if (partidos.length) setPartidosOn(new Set(partidos.map((p) => `${p.local}|${p.visitante}`)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tramo, partidos]);

  // En el draft nadie repite jugador: tiene que haber suficientes de cada puesto.
  const avisoDraft = useMemo(() => {
    if ((modalidad !== 'draft' && modalidad !== 'libre') || !unaJornadaFutbol || todosLosPartidos || partidos.length === 0) return null;
    // 19/10 (Iñi): en el modo libre también, máximo 2 jugadores de cada equipo → al menos 3 partidos.
    if (modalidad === 'libre') return partidosOn.size < 3 ? 'En el modo libre solo se pueden coger 2 jugadores de cada equipo: elige al menos 3 partidos (o todos).' : null;
    const c: Record<string, number> = {};
    partidos.forEach((p) => {
      if (!partidosOn.has(`${p.local}|${p.visitante}`)) return;
      [p.local, p.visitante].forEach((e) => Object.entries(jugadoresPorEquipo.get(e) ?? {}).forEach(([pos, n]) => (c[pos] = (c[pos] ?? 0) + n)));
    });
    const n = numJugadores;
    // 16/10 (Iñi): en el draft solo 2 jugadores por equipo → hacen falta 6 equipos (3 partidos).
    if (partidosOn.size < 3) return 'En el draft solo se pueden coger 2 jugadores de cada equipo: elige al menos 3 partidos (o todos).';
    if ((c.portero ?? 0) < n) return `Con esos partidos solo hay ${c.portero ?? 0} porteros y sois ${n}: en el draft cada uno necesita uno. Añade más partidos.`;
    if ((c.defensa ?? 0) < 3 * n || (c.centrocampista ?? 0) < 3 * n || (c.delantero ?? 0) < n) return 'Con esos partidos no hay jugadores suficientes para que todos completéis el equipo en el draft. Añade más partidos.';
    return null;
  }, [modalidad, unaJornadaFutbol, todosLosPartidos, partidos, partidosOn, jugadoresPorEquipo, numJugadores]);

  async function crear() {
    setError(null);
    if (!nombre.trim()) return setError('Ponle un nombre a la sala.');
    if (deporte === 'futbol' && !liga) return setError('Elige si la sala es de LaLiga o de la Champions.');
    if (seleccion.length === 0) return setError(porTorneo ? 'Elige un torneo.' : 'Elige la jornada (o la primera y la última).');
    if (privada && contrasena.trim().length < 3) return setError('Pon una contraseña de al menos 3 caracteres.');
    if (unaJornadaFutbol && partidos.length > 0 && partidosOn.size === 0) return setError('Elige al menos un partido.');
    if (!tramo && compTramos && !completaDisponible) return setError(porTorneo ? 'El torneo ya ha empezado: elige una ronda.' : 'La jornada ya ha empezado: elige los partidos de un día.');
    if (tramo && seleccion.length > 1) return setError('Los partidos de un solo día solo se pueden elegir en salas de una jornada.');
    if (avisoDraft) return setError(avisoDraft);
    const premioFinal = privada ? premio : PREMIO_VACIO;
    const errPremio = premioValido(premioFinal, numJugadores);
    if (errPremio) return setError(errPremio);

    const jornadas = seleccion.map((competicion, i) => {
      const t = i === 0 ? tramo : null;
      if (competicion === unaJornadaFutbol && partidos.length > 0 && (!todosLosPartidos || diaDeTramo(t))) {
        const elegidos = partidos.filter((p) => partidosOn.has(`${p.local}|${p.visitante}`));
        return { competicion, tramo: t, equipos_permitidos: elegidos.flatMap((p) => [p.local, p.visitante]), partidos: elegidos.map((p) => ({ local: p.local, visitante: p.visitante })) };
      }
      return { competicion, tramo: t, equipos_permitidos: null, partidos: null };
    });

    setEnviando(true);
    const { data, error: e } = await supabase.rpc('amistoso_crear', {
      p: { nombre: nombre.trim(), deporte, modalidad, num_jugadores: numJugadores, privada, contrasena: privada ? contrasena.trim() : null, premio: premioFinal.tipo === 'nada' ? null : premioFinal, jornadas, equipo_fijo: varias && equipoFijo },
    });
    setEnviando(false);
    if (e) return setError(mensajeError(e));
    avisarCambioCreditos();
    // 16/10 (Iñi): en las salas con presupuesto o libres, al crearla vas directo
    // a cómo puntúan y a hacer tu equipo (en draft, a la sala).
    if (modalidad !== 'draft' && seleccion.length > 0) {
      router.replace(`/v2/sala/${data as string}/equipo?c=${encodeURIComponent(seleccion[0])}`);
      return;
    }
    router.replace(`/v2/sala/${data as string}`);
  }

  // 18/10 (Iñi): la configuración va apareciendo poco a poco: nombre →
  // competición y jornada → partidos → jugadores → modalidad → privacidad.
  const hayPasoPartidos = (!!compTramos && (tramosDeSeleccion.length > 0 || !completaDisponible)) || (!!unaJornadaFutbol && partidos.length > 0);
  const okPaso: Record<number, string | null> = {
    1: nombre.trim() ? null : 'Ponle un nombre a la sala.',
    2: deporte === 'futbol' && !liga ? 'Elige si la sala es de LaLiga o de la Champions.' : seleccion.length === 0 ? (porTorneo ? 'Elige un torneo.' : 'Elige la jornada.') : null,
    3: unaJornadaFutbol && partidos.length > 0 && partidosOn.size === 0 ? 'Elige al menos un partido.' : !tramo && compTramos && !completaDisponible ? (porTorneo ? 'El torneo ya ha empezado: elige una ronda.' : 'La jornada ya ha empezado: elige los partidos de un día.') : null,
    4: null,
    5: avisoDraft,
  };
  function avanzar(n: number) {
    const problema = okPaso[n];
    if (problema) return setError(problema);
    setError(null);
    const siguiente = n === 2 && porTorneo && !hayPasoPartidos ? 4 : n + 1;
    setPaso((p) => Math.max(p, siguiente));
    window.setTimeout(() => document.getElementById(`paso-${siguiente}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }
  const continuar = (n: number) =>
    paso === n ? (
      <button type="button" onClick={() => avanzar(n)} style={{ ...S.primaryButton, background: V2_COLOR, opacity: okPaso[n] ? 0.5 : 1 }}>
        Continuar
      </button>
    ) : null;

  // 19/10 (Iñi): "que vaya poniendo 1 de 6, 2 de 6… así se ve que hay más
  // cosas luego que completar". En golf sin rondas que elegir son 5 pasos.
  const totalPasos = porTorneo && !hayPasoPartidos ? 5 : 6;
  const cabeceraPaso = (n: number) => {
    const num = totalPasos === 5 && n > 3 ? n - 1 : n;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: n > 1 ? 10 : 0 }}>
        <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 14, letterSpacing: '0.04em', textTransform: 'uppercase', color: V2_COLOR }}>
          Paso {num} de {totalPasos}
        </span>
        <span style={{ flex: 1, display: 'flex', gap: 4 }}>
          {Array.from({ length: totalPasos }).map((_, i) => (
            <span key={i} style={{ flex: 1, height: 5, borderRadius: 999, background: i < num ? V2_COLOR : S.BORDER, transition: 'background 0.3s' }} />
          ))}
        </span>
      </div>
    );
  };

  const bloque = (titulo: string, contenido: React.ReactNode, ayuda?: string) => (
    <Panel>
      <span style={S.sectionLabel}>{titulo}</span>
      {ayuda && <span style={{ fontSize: 12, color: S.MUTED_3, marginTop: -6 }}>{ayuda}</span>}
      {contenido}
    </Panel>
  );

  return (
    <MarcoV2 perfil={perfil} estado={estado} deporte={deporte} volverA={`/v2/${deporte}?modo=amistosos`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <EtiquetaBeta />
        <Titulo>Nueva sala privada de {deporte === 'golf' ? 'golf' : deporte === 'tenis' ? 'tenis' : 'fútbol'}</Titulo>
      </div>

      {cabeceraPaso(1)}
      {bloque(
        'Nombre',
        <input
          value={nombre}
          maxLength={40}
          autoFocus
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') avanzar(1);
          }}
          placeholder="Ej. La liga de los jueves"
          style={S.input}
        />
      )}
      {paso === 1 && error && <p style={S.errorText}>{error}</p>}
      {continuar(1)}

      {paso >= 2 && <div id="paso-2" />}
      {paso >= 2 && cabeceraPaso(2)}
      {paso >= 2 && comps === null && <Cargando compacto />}

      {paso >= 2 && comps !== null && deporte === 'futbol' &&
        bloque(
          'Competición y jornadas',
          futbol.length === 0 ? (
            <span style={{ fontSize: 13, color: S.MUTED_3 }}>Ahora mismo no hay ninguna jornada por empezar.</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={S.label}>¿De qué competición?</span>
              <div style={{ display: 'flex', gap: 8 }}>
                {Array.from(new Set([...COMPETICIONES_FUTBOL, ...ligas])).map((l) => {
                  const hay = ligas.includes(l);
                  const on = liga === l;
                  return (
                    <button
                      key={l}
                      type="button"
                      disabled={!hay}
                      onClick={() => setLiga(l)}
                      style={{ flex: 1, textAlign: 'center', padding: '12px 8px', borderRadius: 12, cursor: hay ? 'pointer' : 'default', border: `1.5px solid ${on ? V2_COLOR : S.BORDER}`, background: on ? 'rgba(167,139,250,0.14)' : 'transparent', opacity: hay ? 1 : 0.45, display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}
                    >
                      <span style={{ fontWeight: 800, fontSize: 15, color: on ? V2_COLOR : S.TEXT }}>{NOMBRE_COMPETICION[l] ?? l}</span>
                      <span style={{ fontSize: 11, color: S.MUTED_2 }}>{hay ? `Próxima: J${numeroJornada(futbol.filter((c) => ligaDe(c.competicion) === l).sort((x, y) => numeroJornada(x.competicion) - numeroJornada(y.competicion))[0]?.competicion ?? '')}` : 'Sin jornada abierta'}</span>
                    </button>
                  );
                })}
              </div>
              {!liga && <span style={{ fontSize: 12.5, color: '#F0B94D' }}>👆 Elige primero si la sala es de LaLiga o de la Champions.</span>}
              {liga && (
              <>
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={{ ...S.field, flex: 1 }}>
                  <span style={S.label}>Desde</span>
                  <select
                    value={desde}
                    onChange={(e) => {
                      setDesde(e.target.value);
                      if (numeroJornada(hasta) < numeroJornada(e.target.value)) setHasta(e.target.value);
                    }}
                    style={S.selectInput}
                  >
                    {publicadasLiga.map((c) => (
                      <option key={c.competicion} value={c.competicion}>
                        Jornada {numeroJornada(c.competicion)}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ ...S.field, flex: 1 }}>
                  <span style={S.label}>Hasta</span>
                  <select value={hasta} disabled={!!tramo} onChange={(e) => setHasta(e.target.value)} style={{ ...S.selectInput, opacity: tramo ? 0.5 : 1 }}>
                    {jornadasLiga
                      .filter((c) => numeroJornada(c.competicion) >= numeroJornada(desde))
                      .map((c) => (
                        <option key={c.competicion} value={c.competicion}>
                          Jornada {numeroJornada(c.competicion)}
                          {c.cierre ? '' : ' (sin horarios aún)'}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <span style={{ fontSize: 12, color: S.MUTED_2, lineHeight: 1.5 }}>
                {publicadasLiga.find((c) => c.competicion === desde) ? `Empieza ${fechaCorta(publicadasLiga.find((c) => c.competicion === desde)?.cierre ?? null)}. ` : ''}
                {varias ? `${seleccion.length} jornadas seguidas: gana quien más puntos sume entre todas. Las que todavía no tienen horarios se completan solas cuando se publiquen.` : ''}
              </span>
              </>
              )}
              {varias && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  <span style={S.label}>Equipo</span>
                  {(
                    [
                      [false, 'Un equipo nuevo cada jornada', modalidad === 'draft' ? 'Un draft antes de cada jornada.' : 'Cada fin de semana cada uno hace su equipo.'],
                      [true, 'El mismo equipo para todas', modalidad === 'draft' ? 'Un solo draft al principio y ese equipo juega todas las jornadas.' : 'Se hace en la primera jornada y juega todas las demás.'],
                    ] as const
                  ).map(([valor, titulo, desc]) => (
                    <button
                      key={String(valor)}
                      type="button"
                      onClick={() => setEquipoFijo(valor)}
                      style={{ textAlign: 'left', background: equipoFijo === valor ? 'rgba(167,139,250,0.12)' : 'transparent', border: `1px solid ${equipoFijo === valor ? V2_COLOR : S.BORDER}`, borderRadius: 12, padding: '11px 14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3 }}
                    >
                      <span style={{ fontWeight: 800, fontSize: 13.5, color: equipoFijo === valor ? V2_COLOR : S.TEXT }}>{titulo}</span>
                      <span style={{ fontSize: 12, color: S.MUTED_2 }}>{desc}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ),
          'Desde la próxima jornada publicada hasta la que quieras de la misma competición.'
        )}

      {paso >= 2 && comps !== null && porTorneo &&
        bloque(
          'Torneo',
          golf.length === 0 ? (
            <span style={{ fontSize: 13, color: S.MUTED_3 }}>Ahora mismo no hay ningún torneo por empezar.</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {golf.map((c) => (
                <button key={c.competicion} type="button" style={{ ...S.pill(torneo === c.competicion), textAlign: 'left', borderRadius: 10, padding: '10px 12px' }} onClick={() => setTorneo(c.competicion)}>
                  {c.competicion} · empieza {fechaCorta(c.cierre)}
                </button>
              ))}
            </div>
          )
        )}

      {paso === 2 && error && <p style={S.errorText}>{error}</p>}
      {continuar(2)}

      {paso >= 3 && <div id="paso-3" />}
      {paso >= 3 && (!porTorneo || hayPasoPartidos) && cabeceraPaso(3)}
      {/* 17/10 (Iñi): jornada/torneo completo, solo los partidos de un día o una sola ronda. */}
      {paso >= 3 && compTramos &&
        (tramosDeSeleccion.length > 0 || !completaDisponible) &&
        bloque(
          deporte === 'golf' ? '¿Qué rondas cuentan?' : '¿Qué partidos cuentan?',
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[{ tramo: null as string | null, cierre: compElegida?.soloTramos ? null : compElegida?.cierre ?? null, partidos: null as number | null, ok: completaDisponible }, ...tramosDeSeleccion.map((t) => ({ ...t, ok: true }))].map((t) => {
              const on = tramo === t.tramo;
              return (
                <button
                  key={t.tramo ?? 'completa'}
                  type="button"
                  disabled={!t.ok}
                  onClick={() => setTramo(t.tramo)}
                  style={{ textAlign: 'left', background: on ? 'rgba(167,139,250,0.12)' : 'transparent', border: `1px solid ${on ? V2_COLOR : S.BORDER}`, borderRadius: 12, padding: '10px 14px', cursor: t.ok ? 'pointer' : 'default', opacity: t.ok ? 1 : 0.45, display: 'flex', flexDirection: 'column', gap: 2 }}
                >
                  <span style={{ fontWeight: 800, fontSize: 13.5, color: on ? V2_COLOR : S.TEXT }}>{etiquetaTramo(t.tramo, deporte, t.partidos)}</span>
                  <span style={{ fontSize: 11.5, color: S.MUTED_2 }}>{t.ok ? (t.cierre ? `Empieza ${fechaCorta(t.cierre)}` : '') : 'Ya ha empezado'}</span>
                </button>
              );
            })}
            {deporte === 'golf' && !tramosDeSeleccion.some((t) => t.tramo === 'r3') && <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>La ronda 3, la 4 y el fin de semana se abren en cuanto se sepa el corte, solo con los que lo pasan.</span>}
          </div>,
          deporte === 'golf' ? 'Solo puntúan las rondas elegidas.' : 'Solo días con al menos 3 partidos. Sirve si se te ha pasado el inicio de la jornada.'
        )}

      {paso >= 3 && unaJornadaFutbol &&
        partidos.length > 0 &&
        bloque(
          `Partidos${varias ? ` de la jornada ${numeroJornada(unaJornadaFutbol)}` : ''} (${partidosOn.size} de ${partidosVisibles.length})`,
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" style={S.pill(partidosOn.size === partidosVisibles.length)} onClick={() => setPartidosOn(new Set(partidosVisibles.map((p) => `${p.local}|${p.visitante}`)))}>
                Todos
              </button>
              <button type="button" style={S.pill(false)} onClick={() => setPartidosOn(new Set())}>
                Ninguno
              </button>
            </div>
            {/* 18/10 (Iñi): atajos "solo los del sábado / domingo" (o martes / miércoles en Champions). */}
            {diasDePartidos.length > 1 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {diasDePartidos.map((d) => {
                  const on = partidosOn.size === d.claves.length && d.claves.every((k) => partidosOn.has(k));
                  return (
                    <button key={d.dia} type="button" style={S.pill(on)} onClick={() => elegirDia(d.dia, d.claves)}>
                      Solo {d.etiqueta} ({d.claves.length})
                    </button>
                  );
                })}
              </div>
            )}
            {partidosVisibles.map((p) => {
              const k = `${p.local}|${p.visitante}`;
              const on = partidosOn.has(k);
              return (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: on ? S.TEXT : S.MUTED_3, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const s = new Set(partidosOn);
                      if (on) s.delete(k);
                      else s.add(k);
                      setPartidosOn(s);
                    }}
                    style={{ accentColor: V2_COLOR, width: 18, height: 18 }}
                  />
                  <span style={{ flex: 1 }}>
                    {p.local} – {p.visitante}
                  </span>
                  {p.kickoff && <span style={{ fontSize: 11, color: S.MUTED_3 }}>{fechaCorta(p.kickoff)}</span>}
                </label>
              );
            })}
          </div>,
          varias
            ? equipoFijo
              ? 'Solo se podrán elegir jugadores de los partidos marcados. Con el mismo equipo para todas, los partidos solo se eligen en la primera jornada.'
              : 'Solo se podrán elegir jugadores de los partidos marcados. Los de las siguientes jornadas los eliges desde la sala cuando se publiquen (si no, entran todos).'
            : 'Solo se podrán elegir jugadores de los partidos marcados.'
        )}

      {paso === 3 && error && <p style={S.errorText}>{error}</p>}
      {paso >= 3 && continuar(3)}

      {paso >= 4 && <div id="paso-4" />}
      {paso >= 4 && cabeceraPaso(4)}
      {paso >= 4 && bloque(
        'Jugadores en la sala',
        <SelectorJugadores valor={numJugadores} onChange={setNumJugadores} />,
        'Si al final sois menos, el administrador puede empezar con los que haya y ajustar quién gana y quién paga.'
      )}

      {continuar(4)}

      {paso >= 5 && <div id="paso-5" />}
      {paso >= 5 && cabeceraPaso(5)}
      {paso >= 5 && bloque(
        'Modalidad',
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(['presupuesto', 'libre', 'draft'] as Modalidad[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModalidad(m)}
              style={{
                textAlign: 'left',
                background: modalidad === m ? 'rgba(167,139,250,0.12)' : 'transparent',
                border: `1px solid ${modalidad === m ? V2_COLOR : S.BORDER}`,
                borderRadius: 12,
                padding: '12px 14px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <span style={{ fontWeight: 800, fontSize: 14, color: modalidad === m ? V2_COLOR : S.TEXT }}>{MODALIDAD_LABEL[m]}</span>
              <span style={{ fontSize: 12, color: S.MUTED_2, lineHeight: 1.45 }}>{MODALIDAD_DESC[m]}</span>
            </button>
          ))}
          {avisoDraft && <p style={{ ...S.errorText, fontSize: 12 }}>{avisoDraft}</p>}
        </div>
      )}

      {paso === 5 && error && <p style={S.errorText}>{error}</p>}
      {continuar(5)}

      {paso >= 6 && <div id="paso-6" />}
      {paso >= 6 && cabeceraPaso(6)}
      {paso >= 6 && bloque(
        '🔒 Contraseña',
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input value={contrasena} onChange={(e) => setContrasena(e.target.value)} placeholder="Contraseña para entrar" style={S.input} autoComplete="off" />
          <span style={{ fontSize: 12, color: S.MUTED_2, lineHeight: 1.5 }}>Solo entra quien tenga el enlace o el código y la contraseña. Para jugar con cualquiera, entra en una de las salas abiertas de Drafters.</span>
        </div>
      )}

      {paso >= 6 && privada &&
        bloque(
          '¿Qué os jugáis?',
          <EditorPremio premio={premio} onChange={setPremio} participantes={numJugadores} />,
          'Lo puedes cambiar después desde la sala (se avisa a todos en el chat).'
        )}

      {paso >= 6 && (
        <>
          <p style={{ fontSize: 11.5, color: S.MUTED_3, lineHeight: 1.5, margin: 0 }}>Drafters no cobra ni paga nada en los amistosos: solo calcula la clasificación y cuánto le toca a cada uno.</p>

          {/* 16/10 (Iñi): crear la sala (y entrar en ella) cuesta 1 crédito Drafters (SQL 45). */}
          <CosteCredito deporte={deporte} accion="Crear la sala (y entrar en ella)" />
          {error && <p style={S.errorText}>{error}</p>}
          <button type="button" onClick={crear} disabled={enviando} style={{ ...S.primaryButton, background: V2_COLOR, opacity: enviando ? 0.6 : 1 }}>
            {enviando ? 'Creando...' : 'Crear sala · 1 crédito'}
          </button>
        </>
      )}
    </MarcoV2>
  );
}
