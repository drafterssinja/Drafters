'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import AnuncioVideoInline from '@/components/AnuncioVideoInline';
import * as S from '@/lib/mockupStyles';
import { formatEuros } from '@/lib/salaShared';
import { GRUPO_PORRA_LABELS, ORDEN_GRUPOS, COLOR_GRUPO, type GrupoPorra } from '@/lib/porraGrupos';
import { formatGolfScore, bonoPodioParaJugador, COLOR_TIPO_RESULTADO, ETIQUETA_TIPO_RESULTADO, type TipoResultadoHoyo } from '@/lib/golfScoring';
import { normalizarNombre } from '@/lib/nombreMatch';

// ============================================================================
// PORRA CLÁSICA — CLASIFICACIÓN EN DIRECTO (nuevo, 27/09, undécima vuelta)
// ============================================================================
// Reproduce el diseño exacto de isPorraClasificacion (Main.dc.html, líneas
// 1553-1667) — pedido explícito de Iñi: "tienes tú el diseño que hicimos
// para la parte de la clasificación de las porras. Está perfecto... lo
// quiero tal como lo teníamos, tanto la parte de la clasificación de los
// participantes, que cuando pulsan un participante se vean los cinco
// jugadores que tienes, que cuando pulsas encima de un jugador, abajo se
// vean la parte de los jugadores con los resultados que van haciendo. Todo
// eso tiene que ser así."
//
// Lo que es real aquí: la porra, sus jugadores/grupos de color, la
// plantilla real de 5 jugadores de cada equipo inscrito
// (equipos_porra_clasificacion()) y — desde el 28/09 — la puntuación en
// vivo de verdad: `jugadores.resultado_en_vivo_*` y
// `resultados_golf_hoyo` se rellenan solos cada 5 minutos desde ESPN (ver
// app/api/admin/actualizar-golf-en-vivo/route.ts y el admin
// /admin/resultados-golf, donde se conecta cada competición con su torneo
// de ESPN). Mientras un jugador no tenga ningún resultado todavía
// (torneo sin empezar, o su competición sin conectar en el admin) se ve
// como "E" (par) — mismo placeholder de antes, pero ahora es el estado
// real de "sin datos todavía", no un valor inventado. El botón "simular
// resultado" de la maqueta (pensado para pruebas internas) se ha quitado a
// propósito — no es algo que deba ver un usuario real, mismo criterio que
// ya aplicó Iñi para el vídeo explicativo.
//
// Corrección de Iñi (28/09): la porra clásica NO puntúa por el sistema de
// puntos de las Mesas Drafters — puntúa con el resultado de golf de
// siempre (golpes respecto al par: birdie -1, bogey +1, eagle -2, doble
// bogey +2...), exactamente el mismo criterio con el que ya estaba
// diseñado el panel "hoyo a hoyo" de la maqueta. Ver lib/golfScoring.ts.
//
// El toggle "Bonos de podio" ya es de verdad (nuevo, 29/09): cada porra
// guarda si tiene el bono activo (porras.bono_podio_activo, configurable al
// crear/editar la porra en /admin/porras-golf — pedido de Iñi: "el primer
// jugador del torneo va a restar menos 10, el segundo menos 5 y el tercero
// menos 3"). Este toggle inicia con el valor real guardado en la porra,
// pero se puede seguir activando/desactivando aquí como VISTA PREVIA — "la
// posibilidad de ver la clasificación... activando la resta de esos golpes
// con la clasificación actual del momento o no" (pedido de Iñi). Lo que de
// verdad se aplica al liquidar los premios de la porra es siempre el valor
// guardado en la base de datos, no lo que un espectador tenga activado en
// su propia pantalla (ver /admin/pagos-pendientes/porra/[id]).

type PorraRow = { id: string; major: string; competicion: string | null; estado: string; fecha_limite_inscripcion: string | null; bono_podio_activo: boolean; formato: string };
type JugadorRow = {
  id: string;
  nombre: string;
  grupo_porra: GrupoPorra | null;
  precio: number;
  resultado_en_vivo_total: number | null;
  resultado_en_vivo_thru: number | null;
  resultado_en_vivo_ronda: number | null;
  resultado_en_vivo_posicion: string | null;
};
type EquipoClasif = { equipoId: string; nombreEquipo: string | null; jugadores: string[]; createdAt: string };
type HoyoRow = { ronda: number; hoyo: number; par: number; golpes: number; campo_id: string | null; tipo_resultado: TipoResultadoHoyo };

type Vista = 'porra' | 'torneo';

// Total de un equipo: suma de los totales (respecto al par) de sus 5
// jugadores — a los que todavía no tienen resultado (no han salido, o su
// torneo no está conectado) se les cuenta como 0 (par) en la suma, para no
// dejar el total del equipo en blanco solo porque a uno le falte por
// empezar.
function totalEquipo(jugadoresIds: string[], jugadoresPorId: Map<string, JugadorRow>, aplicarBonoPodio: boolean): number {
  return jugadoresIds.reduce((acc, id) => {
    const j = jugadoresPorId.get(id);
    if (!j) return acc;
    const bono = aplicarBonoPodio ? bonoPodioParaJugador(j.resultado_en_vivo_posicion) : 0;
    return acc + (j.resultado_en_vivo_total ?? 0) + bono;
  }, 0);
}

function estadoJugador(j: JugadorRow): string | null {
  if (j.resultado_en_vivo_posicion === null && j.resultado_en_vivo_thru === null) return null;
  const posicion = j.resultado_en_vivo_posicion ? `Pos. ${j.resultado_en_vivo_posicion}` : null;
  const ronda = j.resultado_en_vivo_ronda ? `Ronda ${j.resultado_en_vivo_ronda}` : null;
  const thru = j.resultado_en_vivo_thru !== null ? (j.resultado_en_vivo_thru >= 18 ? 'Hoyo 18 (terminada)' : `Va por el hoyo ${j.resultado_en_vivo_thru}`) : null;
  return [posicion, ronda, thru].filter(Boolean).join(' · ') || null;
}

export default function PorraClasificacionPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const porraId = params.id;

  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [porra, setPorra] = useState<PorraRow | null>(null);
  const [jugadores, setJugadores] = useState<JugadorRow[]>([]);
  const [equipos, setEquipos] = useState<EquipoClasif[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [vista, setVista] = useState<Vista>('porra');
  const [bonosPodio, setBonosPodio] = useState(false);
  const [equipoSeleccionadoId, setEquipoSeleccionadoId] = useState<string | null>(null);
  const [jugadorFocoId, setJugadorFocoId] = useState<string | null>(null);
  const [hoyosFoco, setHoyosFoco] = useState<HoyoRow[] | 'cargando' | null>(null);
  const [rondaSeleccionada, setRondaSeleccionada] = useState<number | null>(null);
  // Nombre de cada campo, solo para torneos con más de uno (01/10, pedido de
  // Iñi) — competicion -> campo_id -> nombre. Vacío en el 99% de los
  // torneos (un solo campo, nunca hay filas en campos_golf_live para esa
  // competición), así que no afecta en nada si el torneo no lo necesita.
  const [nombresCampo, setNombresCampo] = useState<Record<string, string>>({});
  // Buscadores (nuevo, 01/10, pedido de Iñi): filtran la lista ya ordenada
  // sin tocar la posición que se muestra — el número de cada fila sigue
  // siendo su puesto real en la clasificación completa, no su puesto dentro
  // del resultado filtrado.
  const [busquedaEquipo, setBusquedaEquipo] = useState('');
  const [busquedaJugador, setBusquedaJugador] = useState('');

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

      const [{ data: perfilData }, { data: porraData }] = await Promise.all([
        supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
        supabase.from('porras').select('id,major,competicion,estado,fecha_limite_inscripcion,bono_podio_activo,formato').eq('id', porraId).single(),
      ]);

      if (!activo) return;
      if (perfilData) setPerfil(perfilData as Perfil);

      if (!porraData) {
        setError('No se ha encontrado esta porra.');
        setCargando(false);
        return;
      }

      // Esta pantalla es la clasificación en directo de golf; la porra de
      // fútbol todavía no está visible para usuarios normales (oculta a
      // propósito mientras se termina de probar). (29/09)
      if ((porraData as PorraRow).formato === 'futbol_jornada') {
        setError('No se ha encontrado esta porra.');
        setCargando(false);
        return;
      }
      const porraRow = porraData as PorraRow;
      setPorra(porraRow);
      setBonosPodio(porraRow.bono_podio_activo);

      const [{ data: jugData }, { data: equiposData }, { data: camposData }] = await Promise.all([
        porraRow.competicion
          ? supabase
              .from('jugadores')
              .select('id,nombre,grupo_porra,precio,resultado_en_vivo_total,resultado_en_vivo_thru,resultado_en_vivo_ronda,resultado_en_vivo_posicion')
              .eq('deporte', 'golf')
              .eq('competicion', porraRow.competicion)
          : Promise.resolve({ data: [] as JugadorRow[] }),
        // equipos_porra_clasificacion() es una función de base de datos
        // (RPC): solo devuelve filas una vez la porra ha "empezado" (misma
        // marca que participantes_porra()) — antes de eso, da una lista
        // vacía, y esta pantalla lo trata como "todavía no ha empezado"
        // más abajo.
        supabase.rpc('equipos_porra_clasificacion', { p_porra_id: porraId }),
        // Nombre de cada campo (01/10) — vacío salvo en los pocos torneos
        // con más de un campo que el admin ya haya nombrado.
        porraRow.competicion
          ? supabase.from('campos_golf_live').select('campo_id,nombre').eq('competicion', porraRow.competicion)
          : Promise.resolve({ data: [] as { campo_id: string; nombre: string }[] }),
      ]);

      if (!activo) return;

      setJugadores(((jugData as JugadorRow[]) ?? []).filter((j) => j.grupo_porra !== null));
      setNombresCampo(Object.fromEntries(((camposData as { campo_id: string; nombre: string }[]) ?? []).map((c) => [c.campo_id, c.nombre])));

      const filasEquipos = (equiposData as { equipo_id: string; nombre_equipo: string | null; jugadores: string[]; created_at: string }[]) ?? [];
      const equiposOrdenados = filasEquipos
        .map((f) => ({ equipoId: f.equipo_id, nombreEquipo: f.nombre_equipo, jugadores: f.jugadores ?? [], createdAt: f.created_at }))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setEquipos(equiposOrdenados);
      if (equiposOrdenados.length > 0) setEquipoSeleccionadoId(equiposOrdenados[0].equipoId);

      setCargando(false);
    }

    cargar();
    return () => {
      activo = false;
    };
  }, [router, porraId]);

  const jugadoresPorId = useMemo(() => new Map(jugadores.map((j) => [j.id, j])), [jugadores]);

  // Orden de la vista "Torneo" (corregido 01/10, aviso de Iñi: "quiero que
  // salga ordenado por clasificación" — antes salía agrupado por lista de
  // color/precio, p.ej. todos los "Azul" juntos y dentro de ese bloque sin
  // relación con su puesto real en el torneo).
  // Segunda corrección de Iñi, mismo día: "la E es como si fuese el par, es
  // decir, el cero... cuando acabe el menos uno, el siguiente no es el más
  // uno... las E's cuentan como un 0" — por eso aquí NO hay un tratamiento
  // especial para "sin resultado todavía": al no tener resultado,
  // `resultado_en_vivo_total` es null y `?? 0` lo trata exactamente igual
  // que una E de verdad, así que cae solo en su sitio correcto del orden
  // (entre los -1 y los +1), nunca al final. A igualdad de golpes se
  // desempata por precio, para que el orden no salte sin motivo entre
  // sincronizaciones de 5 en 5 minutos (y es lo único que manda antes de
  // que empiece el torneo, cuando nadie tiene resultado todavía).
  const campoOrdenado = useMemo(() => {
    return jugadores.slice().sort((a, b) => {
      const diff = (a.resultado_en_vivo_total ?? 0) - (b.resultado_en_vivo_total ?? 0);
      return diff !== 0 ? diff : b.precio - a.precio;
    });
  }, [jugadores]);

  // Orden de la vista "Porra" (nuevo, 01/10, aviso de Iñi: "no se queda
  // ordenada la porra... que el primero sea el que va a menos golpes") —
  // antes la lista de equipos salía por orden de inscripción. totalEquipo()
  // ya trata a un jugador sin resultado como 0 (ver su comentario arriba),
  // así que una E de equipo cae igual de bien colocada que en campoOrdenado,
  // sin necesidad de ningún caso especial aquí tampoco.
  const equiposOrdenados = useMemo(() => {
    return equipos.slice().sort((a, b) => {
      const diff = totalEquipo(a.jugadores, jugadoresPorId, bonosPodio) - totalEquipo(b.jugadores, jugadoresPorId, bonosPodio);
      return diff !== 0 ? diff : a.createdAt.localeCompare(b.createdAt);
    });
  }, [equipos, jugadoresPorId, bonosPodio]);

  // Hoyo a hoyo del jugador con el foco puesto (pedido de Iñi, 28/09: "cuando
  // pinchas en un resultado, abajo se ven los resultados hoyo a hoyo... de
  // qué par es cada hoyo... y el color según sea eagle/birdie/par/bogey/doble
  // bogey"). Se pide solo cuando hace falta (no de golpe para los 5 del
  // equipo), y solo se guarda lo más reciente por si el usuario cambia de
  // jugador rápido mientras todavía está cargando el anterior.
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

  if (error || !porra) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
          <div style={{ padding: '40px 20px' }}>
            <p style={{ fontSize: 14, color: S.ERROR }}>{error ?? 'No se ha encontrado esta porra.'}</p>
          </div>
        </div>
      </main>
    );
  }

  // Todavía no ha empezado (o no tiene ningún equipo inscrito todavía) —
  // mismo tratamiento honesto que ya usa salas/[id]/clasificacion/page.tsx
  // mientras no existe el motor de puntuación en directo.
  if (equipos.length === 0) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '48px 24px', alignItems: 'center', textAlign: 'center' }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif" }}>Clasificación en directo</h1>
            <p style={{ fontSize: 14, color: S.MUTED_2, lineHeight: 1.6 }}>
              Esta porra todavía no ha empezado, o todavía no hay equipos inscritos. En cuanto empiece podrás ver aquí la clasificación de todos los participantes.
            </p>
            <Link href={`/porras/${porra.id}`} style={{ ...S.secondaryLinkButton, width: 'auto', padding: '12px 24px', textDecoration: 'none', display: 'inline-flex' }}>
              Volver a la porra
            </Link>
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

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '24px 20px 40px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#3DDC84' }}>{porra.major}</span>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT }}>Clasificación en directo</h1>
            <p style={{ fontSize: 13, color: S.MUTED_2 }}>{equipos.length} equipo{equipos.length === 1 ? '' : 's'} inscrito{equipos.length === 1 ? '' : 's'}</p>
          </div>

          <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-start' }}>
            <button type="button" onClick={() => setVista('porra')} style={vistaPillStyle(vista === 'porra')}>
              Porra
            </button>
            <button type="button" onClick={() => setVista('torneo')} style={vistaPillStyle(vista === 'torneo')}>
              Torneo
            </button>
          </div>

          <button
            type="button"
            onClick={() => setBonosPodio((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 10, textAlign: 'left', cursor: 'pointer' }}
          >
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12.5, color: S.TEXT }}>Bonos de podio (−10 / −5 / −3)</span>
              <span style={{ fontSize: 10, color: S.MUTED_3 }}>
                {porra.bono_podio_activo ? 'Activado en esta porra — así se liquidará al acabar.' : 'No activado en esta porra — esto es solo una vista previa.'}
              </span>
            </div>
            <div style={{ flexShrink: 0, width: 40, height: 22, borderRadius: 999, background: bonosPodio ? 'rgba(61,220,132,0.35)' : '#232B26', position: 'relative' }}>
              <div style={{ position: 'absolute', top: 2, left: bonosPodio ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#F5F7F5', transition: 'left 0.15s ease' }} />
            </div>
          </button>

          {vista === 'porra' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flexShrink: 0, width: 126, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Equipos ({equipos.length})</span>
                <input
                  value={busquedaEquipo}
                  onChange={(e) => setBusquedaEquipo(e.target.value)}
                  placeholder="Buscar equipo..."
                  style={{ ...S.input, padding: '6px 8px', fontSize: 11 }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 340, overflowY: 'auto' }}>
                  {equiposOrdenados
                    .map((eq, i) => ({ eq, rango: i + 1 }))
                    .filter(({ eq }) => !busquedaEquipo.trim() || normalizarNombre(eq.nombreEquipo ?? '').includes(normalizarNombre(busquedaEquipo)))
                    .map(({ eq, rango }) => {
                      const activo = eq.equipoId === equipoSeleccionado.equipoId;
                      return (
                        <a
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
                          <span style={{ flexShrink: 0, width: 16, textAlign: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 11, color: S.MUTED_2 }}>{rango}</span>
                          <span style={{ flex: 1, minWidth: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 10.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {eq.nombreEquipo}
                          </span>
                          <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 12, color: S.MUTED_2 }}>
                            {formatGolfScore(totalEquipo(eq.jugadores, jugadoresPorId, bonosPodio))}
                          </span>
                        </a>
                      );
                    })}
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Cabecera del equipo, separada visualmente de la lista de
                    jugadores de abajo (corregido 01/10, aviso de Iñi: "se me
                    abre a la derecha... digamos que están de la misma forma
                    visualizados... me gustaría que... esté un poquito más
                    separada la cajita del nombre del equipo de los
                    jugadores con una línea en medio") — fondo e borde con un
                    tinte verde y una línea de acento más gruesa debajo, más
                    separación con el primer jugador. */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    background: 'rgba(61,220,132,0.08)',
                    border: '1px solid rgba(61,220,132,0.35)',
                    borderBottom: '2px solid #3DDC84',
                    borderRadius: 10,
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 14.5, color: '#3DDC84', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {equipoSeleccionado.nombreEquipo}
                  </span>
                  <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, color: S.TEXT }}>
                    {formatGolfScore(totalEquipo(equipoSeleccionado.jugadores, jugadoresPorId, bonosPodio))}
                  </span>
                </div>
                {jugadoresDelEquipoSeleccionado.map((j) => (
                  <a
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
                      {j.grupo_porra && <span style={{ fontSize: 9.5, fontWeight: 700, color: COLOR_GRUPO[j.grupo_porra] }}>{GRUPO_PORRA_LABELS[j.grupo_porra]}</span>}
                      {estadoJugador(j) && <span style={{ fontSize: 9, color: S.MUTED_3 }}>{estadoJugador(j)}</span>}
                      {bonosPodio && bonoPodioParaJugador(j.resultado_en_vivo_posicion) !== 0 && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#F0B94D' }}>Bono podio {bonoPodioParaJugador(j.resultado_en_vivo_posicion)}</span>
                      )}
                    </div>
                    <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 13, color: S.MUTED_2 }}>
                      {formatGolfScore((j.resultado_en_vivo_total ?? 0) + (bonosPodio ? bonoPodioParaJugador(j.resultado_en_vivo_posicion) : 0))}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {vista === 'torneo' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Campo completo ({campoOrdenado.length} jugadores)</span>
              <input
                value={busquedaJugador}
                onChange={(e) => setBusquedaJugador(e.target.value)}
                placeholder="Buscar jugador..."
                style={{ ...S.input, padding: '7px 10px', fontSize: 12 }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 380, overflowY: 'auto' }}>
                {campoOrdenado
                  .map((j, i) => ({ j, rango: i + 1 }))
                  .filter(({ j }) => !busquedaJugador.trim() || normalizarNombre(j.nombre).includes(normalizarNombre(busquedaJugador)))
                  .map(({ j, rango }) => (
                    <a
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
                      <span style={{ flexShrink: 0, width: 20, textAlign: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 11, color: S.MUTED_2 }}>{rango}</span>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.nombre}</span>
                        {j.grupo_porra && <span style={{ fontSize: 9.5, fontWeight: 700, color: COLOR_GRUPO[j.grupo_porra] }}>{GRUPO_PORRA_LABELS[j.grupo_porra]}</span>}
                        {estadoJugador(j) && <span style={{ fontSize: 9, color: S.MUTED_3 }}>{estadoJugador(j)}</span>}
                      </div>
                      <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 13, color: S.MUTED_2 }}>{formatGolfScore(j.resultado_en_vivo_total ?? 0)}</span>
                    </a>
                  ))}
              </div>
            </div>
          )}

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

              {hoyosFoco !== 'cargando' && (!hoyosFoco || hoyosFoco.length === 0) && (
                <p style={{ fontSize: 12.5, lineHeight: 1.5, color: S.MUTED_2, margin: 0 }}>
                  Todavía no hay ningún hoyo registrado para {jugadorFoco.nombre} — en cuanto empiece a jugar (o su torneo se conecte con ESPN
                  desde el panel de administración), aquí verás el desglose hoyo a hoyo, golpe a golpe.
                </p>
              )}

              {Array.isArray(hoyosFoco) &&
                hoyosFoco.length > 0 &&
                (() => {
                  const hoyos: HoyoRow[] = hoyosFoco;
                  const rondas = Array.from(new Set(hoyos.map((h) => h.ronda))).sort((a, b) => a - b);
                  const hoyosRonda = hoyos.filter((h) => h.ronda === rondaSeleccionada);
                  // Nombre del campo de la ronda (01/10) — solo aparece en
                  // los pocos torneos con más de un campo (ver
                  // campos_golf_live); en el resto, campo_id siempre es
                  // null y esto no pinta nada.
                  const campoIdRondaSel = hoyosRonda[0]?.campo_id ?? null;
                  const nombreCampoRondaSel = campoIdRondaSel ? nombresCampo[campoIdRondaSel] : null;
                  return (
                    <>
                      {rondas.length > 1 && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {rondas.map((r) => {
                            const campoIdR = hoyos.find((h) => h.ronda === r)?.campo_id ?? null;
                            const nombreCampoR = campoIdR ? nombresCampo[campoIdR] : null;
                            return (
                              <button key={r} type="button" onClick={() => setRondaSeleccionada(r)} style={vistaPillStyle(rondaSeleccionada === r)}>
                                Ronda {r}
                                {nombreCampoR ? ` · ${nombreCampoR}` : ''}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {campoIdRondaSel && rondas.length <= 1 && (
                        <span style={{ fontSize: 10.5, color: S.MUTED_3 }}>
                          {nombreCampoRondaSel ?? `Campo ${campoIdRondaSel} (todavía sin nombre — se puede poner desde el panel de administración)`}
                        </span>
                      )}

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
                        {hoyosRonda.map((h) => {
                          const color = COLOR_TIPO_RESULTADO[h.tipo_resultado];
                          return (
                            <div
                              key={h.hoyo}
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
            *Clasificación en directo: resultado respecto al par de cada jugador/equipo (no puntos), actualizado automáticamente cada 5 minutos. Se ve "E" (par)
            mientras un jugador todavía no tiene ningún resultado registrado.
          </span>

          {/* Vídeo publicitario debajo de todo (mismo criterio que en
              salas/[id]/clasificacion/page.tsx — pedido de Iñi, 27/09: "en
              alguna parte que sea accesible pero que tampoco moleste,
              vamos a meter los ítems de publicidad"). */}
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
