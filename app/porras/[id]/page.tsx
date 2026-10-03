'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { calcularTramosPorInscritos } from '@/lib/repartoPremios';
import { GRUPO_PORRA_LABELS, GrupoPorra, ORDEN_GRUPOS, COLOR_GRUPO } from '@/lib/porraGrupos';
import { formatEuros, posicionLabel, closesAtLabel, parteParaPremios, parteComision } from '@/lib/salaShared';
import { PorraFormato, PORRA_FORMATO_LABELS, PORRA_FORMATO_COLOR, PORRA_FORMATO_DESCRIPCION_LARGA } from '@/lib/porraFormato';
import EscudoEquipoFutbol from '@/components/EscudoEquipoFutbol';

// ============================================================================
// DETALLE DE PORRA CLÁSICA
// ============================================================================
// No hay pantalla de "porra" en la maqueta visual (solo isSalaDetalle para
// salas normales) — esta pantalla reutiliza la misma estructura de pestañas
// (Información / Premios / Grupos) adaptada a lo que ya existe de verdad
// para las porras: los 4-5 grupos de color con los que se importó el
// torneo desde /admin (lib/porraGrupos.ts) y el reparto por tramos según
// inscritos (pedido de Iñi, 22/09: "que se vaya actualizando en base a los
// inscritos que hay"). Elegir equipo jugador a jugador es la siguiente
// pieza pendiente del proyecto — el botón de abajo ya enlaza a su sitio.

type PorraFila = { id: string; major: string; estado: string; precio: number; competicion: string | null; fecha_limite_inscripcion: string | null; formato: PorraFormato };
type JugadorRow = { id: string; nombre: string; grupo_porra: GrupoPorra | null; precio: number };
type EquipoMio = { id: string; nombre_equipo: string | null; jugadores: string[]; gasto_total: number; created_at: string };
type EquipoParticipante = { equipoId: string; nombreEquipo: string | null; createdAt: string; oculto: boolean };

// Porra de fútbol por jornadas (29/09) — los 10 partidos de la porra
// (públicos, iguales para todo el mundo) y, por equipo mío, mis 10
// pronósticos (1/X/2). Ver drafters-schema.sql, tablas
// partidos_porra_futbol/predicciones_porra_futbol.
type PartidoFutbol = {
  id: string;
  orden: number;
  equipo_local: string;
  equipo_visitante: string;
  escudo_local_url: string | null;
  escudo_visitante_url: string | null;
  resultado_real: '1' | 'x' | '2' | null;
};
type ClasificacionFutbolFila = { equipo_id: string; nombre_equipo: string; aciertos: number; partidos_resueltos: number; total_partidos: number };

// La pestaña "Grupos" (por color) solo tiene sentido en el formato clásico;
// el formato "presupuesto" muestra en su lugar "Jugadores" (el campo
// completo, ordenado por precio — no hay grupos de color que enseñar).
type Tab = 'equipo' | 'info' | 'premios' | 'grupos' | 'equipos';

export default function PorraDetallePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const porraId = params.id;

  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [porra, setPorra] = useState<PorraFila | null>(null);
  const [jugadores, setJugadores] = useState<JugadorRow[]>([]);
  const [jugadoresDeMisEquipos, setJugadoresDeMisEquipos] = useState<JugadorRow[]>([]);
  const [signedUp, setSignedUp] = useState(0);
  // Un usuario puede tener varios equipos en la misma porra (pedido de Iñi,
  // 23/09: "en la porra puedo participar todas las veces que quiera") — así
  // que aquí se guarda la lista entera, no un único equipo.
  const [misEquipos, setMisEquipos] = useState<EquipoMio[]>([]);
  const [participantes, setParticipantes] = useState<EquipoParticipante[]>([]);
  const [partidosFutbol, setPartidosFutbol] = useState<PartidoFutbol[]>([]);
  // Mis pronósticos, por equipo: equipoId -> (partidoId -> '1'|'x'|'2').
  const [prediccionesPorEquipo, setPrediccionesPorEquipo] = useState<Map<string, Map<string, string>>>(new Map());
  const [clasificacionFutbol, setClasificacionFutbol] = useState<ClasificacionFutbolFila[]>([]);
  const [tab, setTab] = useState<Tab>('info');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        supabase.from('porras').select('id,major,estado,precio,competicion,fecha_limite_inscripcion,formato').eq('id', porraId).single(),
      ]);

      if (!activo) return;
      if (perfilData) setPerfil(perfilData as Perfil);

      if (!porraData) {
        setError('No se ha encontrado esta porra.');
        setCargando(false);
        return;
      }
      const porraRow = porraData as PorraFila;

      // La porra de fútbol todavía no está visible para usuarios normales
      // (oculta a propósito mientras se termina de probar — el desarrollo
      // sigue intacto, solo no es accesible desde aquí). Se bloquea también
      // el acceso directo por URL, no solo el listado. (29/09)
      if (porraRow.formato === 'futbol_jornada') {
        setError('No se ha encontrado esta porra.');
        setCargando(false);
        return;
      }

      setPorra(porraRow);

      // inscritos_por_porra() es una función de base de datos (RPC): las
      // filas de equipos/inscripciones de otros usuarios no son visibles
      // por RLS, pero el número de inscritos de la porra es un dato
      // agregado y público. Ver drafters-schema.sql. Mis propios equipos en
      // esta porra sí se pueden consultar directamente (RLS lo permite).
      // participantes_porra() da la lista de equipos de TODOS (con el
      // nombre oculto hasta que empiece la porra, calculado en el propio
      // servidor — ver drafters-schema.sql).
      // (Tras el bloqueo de arriba, formato aquí nunca es 'futbol_jornada'
      // en la práctica; se compara como string para no tocar el resto de
      // la lógica de fútbol ya desarrollada más abajo.)
      const esFutbolRow = (porraRow.formato as string) === 'futbol_jornada';

      const [{ data: inscritosPorraData }, { data: misEquiposData }, { data: jugData }, { data: participantesData }, { data: partidosFutbolData }, { data: clasificacionFutbolData }] = await Promise.all([
        supabase.rpc('inscritos_por_porra'),
        supabase
          .from('equipos')
          .select('id, nombre_equipo, jugadores, gasto_total, created_at, inscripciones(estado)')
          .eq('porra_id', porraId)
          .eq('usuario_id', session.user.id)
          .order('created_at', { ascending: true }),
        porraRow.competicion
          ? supabase.from('jugadores').select('id,nombre,grupo_porra,precio').eq('deporte', 'golf').eq('competicion', porraRow.competicion)
          : Promise.resolve({ data: [] }),
        esFutbolRow ? Promise.resolve({ data: [] }) : supabase.rpc('participantes_porra', { p_porra_id: porraId }),
        esFutbolRow
          ? supabase.from('partidos_porra_futbol').select('*').eq('porra_id', porraId).order('orden', { ascending: true })
          : Promise.resolve({ data: [] }),
        esFutbolRow ? supabase.rpc('futbol_porra_clasificacion', { p_porra_id: porraId }) : Promise.resolve({ data: [] }),
      ]);

      if (!activo) return;

      const filaPorra = ((inscritosPorraData as { porra_id: string; inscritos: number }[]) ?? []).find((f) => f.porra_id === porraId);
      setSignedUp(filaPorra ? Number(filaPorra.inscritos) : 0);

      const misEquiposFilas = (misEquiposData as (EquipoMio & { inscripciones: { estado: string }[] })[]) ?? [];
      const misEquiposActivos = misEquiposFilas.filter((e) => e.inscripciones.some((i) => i.estado !== 'reembolsada'));
      setMisEquipos(misEquiposActivos);

      const filasParticipantes = (participantesData as { equipo_id: string; nombre_equipo: string | null; created_at: string; oculto: boolean }[]) ?? [];
      setParticipantes(
        filasParticipantes.map((p) => ({ equipoId: p.equipo_id, nombreEquipo: p.nombre_equipo, createdAt: p.created_at, oculto: p.oculto }))
      );

      const jugRows = (jugData as JugadorRow[]) ?? [];
      setJugadores(jugRows);
      setPartidosFutbol((partidosFutbolData as PartidoFutbol[]) ?? []);
      setClasificacionFutbol((clasificacionFutbolData as ClasificacionFutbolFila[]) ?? []);
      setTab(misEquiposActivos.length > 0 ? 'equipo' : 'info');

      if (esFutbolRow && misEquiposActivos.length > 0) {
        const { data: prediccionesData } = await supabase
          .from('predicciones_porra_futbol')
          .select('equipo_id, partido_id, prediccion')
          .in('equipo_id', misEquiposActivos.map((e) => e.id));
        if (activo) {
          const mapa = new Map<string, Map<string, string>>();
          ((prediccionesData as { equipo_id: string; partido_id: string; prediccion: string }[]) ?? []).forEach((p) => {
            if (!mapa.has(p.equipo_id)) mapa.set(p.equipo_id, new Map());
            mapa.get(p.equipo_id)!.set(p.partido_id, p.prediccion);
          });
          setPrediccionesPorEquipo(mapa);
        }
      }

      const idsMisJugadores = Array.from(new Set(misEquiposActivos.flatMap((e) => e.jugadores ?? [])));
      if (idsMisJugadores.length > 0) {
        const { data: jugMiosData } = await supabase.from('jugadores').select('id,nombre,grupo_porra,precio').in('id', idsMisJugadores);
        if (activo) setJugadoresDeMisEquipos((jugMiosData as JugadorRow[]) ?? []);
      }

      setCargando(false);
    }

    cargar();
    return () => {
      activo = false;
    };
  }, [router, porraId]);

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

  const esFutbol = porra.formato === 'futbol_jornada';

  // Bote real = lo que va a premios (90% del precio de entrada, sin la
  // comisión de la casa) — corregido el 28/09, pedido de Iñi: "en las
  // porras también nos quedamos un 10%", así que el bote ya no es el
  // precio de entrada completo, sino la misma fracción que ya se
  // descontaba en salas (parteParaPremios(), lib/salaShared.ts).
  const bote = parteParaPremios(porra.precio) * signedUp;
  const tramos = calcularTramosPorInscritos(signedUp);
  const estadoColor = porra.estado === 'disponible' ? '#3DDC84' : porra.estado === 'proximamente' ? '#F0B94D' : S.MUTED_3;
  const estadoLabel = porra.estado === 'disponible' ? 'Disponible' : porra.estado === 'proximamente' ? 'Próximamente' : 'Finalizada';
  const cierra = closesAtLabel(porra.fecha_limite_inscripcion);

  const gruposConJugadores = ORDEN_GRUPOS.map((g) => ({
    grupo: g,
    // Ordenado por precio (mejor jugador primero — cuota más baja, precio
    // más alto), no alfabéticamente (pedido de Iñi, 28/09).
    jugadores: jugadores.filter((j) => j.grupo_porra === g).sort((a, b) => b.precio - a.precio),
  })).filter((g) => g.jugadores.length > 0);
  const hayListaEspanoles = gruposConJugadores.some((g) => g.grupo === 'espanoles');

  // Se puede crear otro equipo aunque ya tengas uno o varios (pedido de
  // Iñi, 23/09: "en la porra puedo participar todas las veces que quiera").
  const showJoinCta = porra.estado !== 'finalizada';

  // "Empezada" = ya pasó su fecha límite de inscripción, o ya está
  // finalizada — mismo criterio que ya usa participantes_porra() (sección
  // 11.7 de la arquitectura técnica) para dejar de ocultar los nombres de
  // los equipos. Solo a partir de ahí tiene sentido enlazar a la
  // clasificación en directo.
  const porraEmpezada = porra.estado === 'finalizada' || (!!porra.fecha_limite_inscripcion && new Date(porra.fecha_limite_inscripcion).getTime() <= Date.now());

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '28px 20px 100px', position: 'relative' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span
              style={{
                alignSelf: 'flex-start',
                fontFamily: "'Manrope', sans-serif",
                fontWeight: 700,
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: PORRA_FORMATO_COLOR[porra.formato],
                background: `${PORRA_FORMATO_COLOR[porra.formato]}1F`,
                border: `1px solid ${PORRA_FORMATO_COLOR[porra.formato]}55`,
                borderRadius: 999,
                padding: '3px 9px',
              }}
            >
              {PORRA_FORMATO_LABELS[porra.formato]}
            </span>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: S.TEXT, lineHeight: 1.15 }}>{porra.major}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: estadoColor, flexShrink: 0 }} />
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12.5, color: estadoColor }}>{estadoLabel}</span>
              <span style={{ fontSize: 12.5, color: S.MUTED_3 }}>· {esFutbol ? 'Fútbol' : 'Golf'}</span>
              {cierra && <span style={{ fontSize: 12.5, color: '#FF9F6E' }}>· Cierra el {cierra}</span>}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {misEquipos.length > 0 && (
              <button type="button" onClick={() => setTab('equipo')} style={tabButtonStyle(tab === 'equipo')}>
                Mis equipos{misEquipos.length > 1 ? ` (${misEquipos.length})` : ''}
              </button>
            )}
            <button type="button" onClick={() => setTab('info')} style={tabButtonStyle(tab === 'info')}>
              Información
            </button>
            <button type="button" onClick={() => setTab('premios')} style={tabButtonStyle(tab === 'premios')}>
              Premios
            </button>
            {!esFutbol && (
              <button type="button" onClick={() => setTab('grupos')} style={tabButtonStyle(tab === 'grupos')}>
                {porra.formato === 'presupuesto' ? 'Jugadores' : 'Grupos'}
              </button>
            )}
            <button type="button" onClick={() => setTab('equipos')} style={tabButtonStyle(tab === 'equipos')}>
              {esFutbol ? 'Clasificación' : 'Equipos'}
            </button>
          </div>

          {/* Acceso a la clasificación en directo (isPorraDetalle de
              Main.dc.html, línea 1449) — solo tiene sentido en golf (usa los
              resultados en vivo de ESPN) una vez la porra ha empezado de
              verdad (misma marca de tiempo que usa
              participantes_porra_con_plantilla(), que sigue ocultando la
              PLANTILLA de cada rival hasta ese momento — desde el 28/09 los
              nombres de los equipos ya se ven siempre, ver más abajo). La
              porra de fútbol tiene su propia "clasificación" — la pestaña
              "Clasificación" de aquí arriba, por aciertos. */}
          {/* Habilitado para CUALQUIER usuario logueado, participe o no en
              esta porra (03/10, pedido de Iñi: "que el botón de
              clasificación en vivo esté habilitado para cualquiera, aunque
              no participe en la porra") — antes exigía también
              `misEquipos.length > 0`, así que solo lo veían quienes ya
              tenían equipo aquí. La página de destino
              (/porras/[id]/clasificacion) ya era accesible para cualquier
              usuario logueado de todas formas (ni el cliente ni la RPC
              equipos_porra_clasificacion() comprueban participación, solo
              que la porra haya empezado) — este cambio es solo para que el
              botón deje de ocultarse y la gente que se está dando de alta
              ahora pueda ver la clasificación en directo de la que ya está
              en marcha. */}
          {!esFutbol && porraEmpezada && (
            <Link
              href={`/porras/${porra.id}/clasificacion`}
              style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', padding: '7px 12px', background: 'rgba(240,185,77,0.12)', border: '1px solid rgba(240,185,77,0.4)', borderRadius: 20, textDecoration: 'none' }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF7A45' }} />
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: '#F0B94D' }}>Clasificación en directo</span>
            </Link>
          )}

          {tab === 'equipo' && esFutbol && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {misEquipos.map((eq) => {
                const misPredicciones = prediccionesPorEquipo.get(eq.id) ?? new Map<string, string>();
                const aciertos = partidosFutbol.filter((p) => p.resultado_real && misPredicciones.get(p.id) === p.resultado_real).length;
                const resueltos = partidosFutbol.filter((p) => p.resultado_real).length;
                return (
                  <div key={eq.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 16, color: S.TEXT }}>{eq.nombre_equipo}</span>
                      {resueltos > 0 && (
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#F0B94D' }}>
                          {aciertos} acierto{aciertos === 1 ? '' : 's'} de {resueltos}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {partidosFutbol.map((p) => {
                        const miPronostico = misPredicciones.get(p.id);
                        const acerto = p.resultado_real ? miPronostico === p.resultado_real : null;
                        return (
                          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: '#10150F', border: '1px solid #1E2723', borderRadius: 9 }}>
                            <EscudoEquipoFutbol nombre={p.equipo_local} url={p.escudo_local_url} size={24} />
                            <span style={{ flex: 1, fontSize: 12.5, color: S.TEXT, textAlign: 'right' }}>{p.equipo_local}</span>
                            <span
                              style={{
                                flexShrink: 0,
                                minWidth: 22,
                                textAlign: 'center',
                                fontFamily: "'Barlow Condensed', sans-serif",
                                fontWeight: 800,
                                fontSize: 13,
                                color: acerto === null ? '#F0B94D' : acerto ? '#3DDC84' : S.ERROR,
                              }}
                            >
                              {miPronostico ? miPronostico.toUpperCase() : '—'}
                            </span>
                            <span style={{ flex: 1, fontSize: 12.5, color: S.TEXT }}>{p.equipo_visitante}</span>
                            <EscudoEquipoFutbol nombre={p.equipo_visitante} url={p.escudo_visitante_url} size={24} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'equipo' && !esFutbol && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {misEquipos.map((eq) => {
                const jugadoresDeEsteEquipo = (eq.jugadores ?? [])
                  .map((id) => jugadoresDeMisEquipos.find((j) => j.id === id))
                  .filter((j): j is JugadorRow => !!j);
                return (
                  <div key={eq.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 16, color: S.TEXT }}>{eq.nombre_equipo}</span>
                      {porra.estado !== 'finalizada' && (
                        <Link
                          href={`/porras/${porra.id}/crear-equipo?equipo=${eq.id}`}
                          style={{ flexShrink: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11.5, color: '#3DDC84', textDecoration: 'none', border: '1px solid rgba(61,220,132,0.35)', borderRadius: 8, padding: '6px 11px' }}
                        >
                          Editar equipo
                        </Link>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {jugadoresDeEsteEquipo.map((j) => (
                        <div key={j.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', background: '#10150F', border: '1px solid #1E2723', borderRadius: 9 }}>
                          <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 13, color: S.TEXT }}>{j.nombre}</span>
                          {j.grupo_porra ? (
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: COLOR_GRUPO[j.grupo_porra] }}>{GRUPO_PORRA_LABELS[j.grupo_porra]}</span>
                          ) : (
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: '#F0B94D' }}>{j.precio.toLocaleString('es-ES')} €</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'equipos' && esFutbol && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12, color: S.MUTED_3 }}>
                {signedUp} equipo{signedUp === 1 ? '' : 's'} inscrito{signedUp === 1 ? '' : 's'} · clasificación por aciertos
              </span>
              {clasificacionFutbol.length === 0 && <p style={{ fontSize: 13, color: S.MUTED_2 }}>Todavía no hay ningún equipo inscrito.</p>}
              {clasificacionFutbol.map((c, i) => (
                <div key={c.equipo_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 10 }}>
                  <span
                    style={{
                      flexShrink: 0,
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: '#1E2723',
                      color: S.MUTED_2,
                      fontFamily: "'Barlow Condensed', sans-serif",
                      fontWeight: 700,
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ flex: 1, fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 13.5, color: S.TEXT }}>{c.nombre_equipo}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#F0B94D' }}>
                    {c.aciertos}/{c.partidos_resueltos}
                  </span>
                </div>
              ))}
            </div>
          )}

          {tab === 'equipos' && !esFutbol && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12, color: S.MUTED_3 }}>{signedUp} equipo{signedUp === 1 ? '' : 's'} inscrito{signedUp === 1 ? '' : 's'}</span>
              {participantes.length > 0 && participantes[0].oculto && (
                <p style={{ fontSize: 12, color: S.MUTED_2, margin: 0 }}>Los nombres de los equipos se mantienen ocultos hasta que empiece la porra.</p>
              )}
              {participantes.map((p, i) => (
                <div key={p.equipoId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 10 }}>
                  <span
                    style={{
                      flexShrink: 0,
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: '#1E2723',
                      color: S.MUTED_2,
                      fontFamily: "'Barlow Condensed', sans-serif",
                      fontWeight: 700,
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 13.5, color: p.oculto ? S.MUTED_3 : S.TEXT, fontStyle: p.oculto ? 'italic' : 'normal' }}>
                    {p.oculto ? 'Oculto hasta que empiece' : p.nombreEquipo}
                  </span>
                </div>
              ))}
            </div>
          )}

          {tab === 'info' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Desglose precio + comisión (28/09), mismo criterio que ya
                  usa "Buy-in" en /salas/[id]: "18 € + 2 €" en vez del total
                  seguido de la palabra "comisión" — se entiende sin más
                  aclaración (mismo pedido de Iñi, 25/09, aplicado aquí). */}
              <InfoRow
                label="Precio de entrada"
                value={`${formatEuros(parteParaPremios(porra.precio))} + ${formatEuros(parteComision(porra.precio))}`}
                accent
              />
              {!esFutbol && <InfoRow label="Competición" value={porra.competicion ?? '—'} />}
              <InfoRow label={esFutbol ? 'Equipos inscritos' : 'Jugadores inscritos'} value={String(signedUp)} />

              {/* Instrucciones de cómo se eligen los equipos, con la
                  explicación condicional según si esta porra tiene 3 o más
                  españoles inscritos (pedido de Iñi, 27/09) — mismo texto
                  que se repite, más detallado, en la pantalla de crear
                  equipo (app/porras/[id]/crear-equipo/page.tsx), para que
                  quien quiera participar lo vea también antes de entrar
                  ahí. */}
              {esFutbol ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  <div style={{ background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Cómo se elige el equipo</span>
                    <p style={{ fontSize: 12.5, lineHeight: 1.5, color: S.MUTED_2, margin: 0 }}>{PORRA_FORMATO_DESCRIPCION_LARGA.futbol_jornada}</p>
                  </div>
                  {partidosFutbol.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Partidos de la jornada</span>
                      {partidosFutbol.map((p) => (
                        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 9 }}>
                          <EscudoEquipoFutbol nombre={p.equipo_local} url={p.escudo_local_url} size={22} />
                          <span style={{ flex: 1, fontSize: 12.5, color: S.TEXT, textAlign: 'right' }}>{p.equipo_local}</span>
                          <span style={{ flexShrink: 0, fontSize: 10.5, color: S.MUTED_3 }}>vs</span>
                          <span style={{ flex: 1, fontSize: 12.5, color: S.TEXT }}>{p.equipo_visitante}</span>
                          <EscudoEquipoFutbol nombre={p.equipo_visitante} url={p.escudo_visitante_url} size={22} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : porra.formato === 'presupuesto' ? (
                <div style={{ background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Cómo se elige el equipo</span>
                  <p style={{ fontSize: 12.5, lineHeight: 1.5, color: S.MUTED_2, margin: 0 }}>{PORRA_FORMATO_DESCRIPCION_LARGA.presupuesto}</p>
                </div>
              ) : (
                gruposConJugadores.length > 0 && (
                  <div style={{ background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Cómo se eligen los equipos</span>
                    {hayListaEspanoles ? (
                      <p style={{ fontSize: 12.5, lineHeight: 1.5, color: S.MUTED_2, margin: 0 }}>
                        Elige 5 jugadores: uno de cada grupo de color, más un comodín libre. Como en este torneo participan 3 o más jugadores españoles, hay una lista
                        aparte <strong style={{ color: COLOR_GRUPO.espanoles }}>Españoles</strong> con todos ellos (no cuentan para ningún otro grupo), y el grupo{' '}
                        <strong style={{ color: COLOR_GRUPO.azul }}>Azul</strong> no tiene tope superior (no hay grupo Morado).
                      </p>
                    ) : (
                      <p style={{ fontSize: 12.5, lineHeight: 1.5, color: S.MUTED_2, margin: 0 }}>
                        Elige 5 jugadores: uno de cada grupo de color, más un comodín libre. Como en este torneo participan menos de 3 jugadores españoles, no hay lista
                        aparte de Españoles: el grupo <strong style={{ color: COLOR_GRUPO.azul }}>Azul</strong> va del 36 al 70, y el grupo{' '}
                        <strong style={{ color: COLOR_GRUPO.morado }}>Morado</strong> agrupa del 71 en adelante.
                      </p>
                    )}
                  </div>
                )
              )}
            </div>
          )}

          {tab === 'premios' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '20px 14px', background: 'rgba(240,185,77,0.1)', border: '1px solid rgba(240,185,77,0.35)', borderRadius: 12 }}>
                <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#C9A257' }}>Bote total</span>
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 30, color: '#F0B94D' }}>{formatEuros(bote)}</span>
                <span style={{ fontSize: 11, color: S.MUTED_3 }}>Se actualiza según entran inscritos</span>
              </div>
              {tramos.length === 0 && <p style={{ fontSize: 13, color: S.MUTED_2 }}>Todavía no hay suficientes inscritos para calcular el reparto.</p>}
              {tramos.map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '13px 14px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 10 }}>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, color: S.TEXT }}>{posicionLabel(t.desde, t.hasta)}</span>
                  <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 14, color: '#F0B94D' }}>{formatEuros((bote * t.porcentajeCadaUno) / 100)}</span>
                </div>
              ))}
            </div>
          )}

          {tab === 'grupos' && porra.formato === 'presupuesto' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {jugadores.length === 0 && <p style={{ fontSize: 13, color: S.MUTED_2 }}>Todavía no se ha subido el listado de jugadores de este torneo.</p>}
              {[...jugadores]
                .sort((a, b) => b.precio - a.precio)
                .map((j) => (
                  <div key={j.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 10 }}>
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 13.5, color: S.TEXT }}>{j.nombre}</span>
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 12.5, color: '#F0B94D' }}>{j.precio.toLocaleString('es-ES')} €</span>
                  </div>
                ))}
            </div>
          )}

          {tab === 'grupos' && porra.formato === 'clasica' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {gruposConJugadores.length === 0 && <p style={{ fontSize: 13, color: S.MUTED_2 }}>Todavía no se ha subido el listado de jugadores de este torneo.</p>}
              {gruposConJugadores.map(({ grupo, jugadores: lista }) => (
                <div key={grupo} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: COLOR_GRUPO[grupo], flexShrink: 0 }} />
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_2 }}>
                      {GRUPO_PORRA_LABELS[grupo]} · {lista.length}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {lista.map((j) => (
                      <div key={j.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 10 }}>
                        <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 13.5, color: S.TEXT }}>{j.nombre}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {showJoinCta && (
            <Link
              href={`/porras/${porra.id}/crear-equipo`}
              style={{
                position: 'sticky',
                bottom: 16,
                marginTop: 8,
                fontFamily: "'Barlow Condensed', sans-serif",
                fontWeight: 700,
                fontSize: 16,
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
                color: '#04140B',
                background: '#3DDC84',
                padding: '14px 26px',
                borderRadius: 10,
                minHeight: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                textDecoration: 'none',
              }}
            >
              {misEquipos.length > 0 ? 'Crear otro equipo' : 'Elegir equipo'} · {formatEuros(porra.precio)}
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}

function InfoRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 14px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 10 }}>
      <span style={{ fontSize: 13, color: S.MUTED_2, flexShrink: 0 }}>{label}</span>
      <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: accent ? 800 : 700, fontSize: 14, color: accent ? '#F0B94D' : S.TEXT, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function tabButtonStyle(active: boolean) {
  return {
    flex: 1,
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 700,
    fontSize: 13,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.02em',
    padding: '10px 8px',
    borderRadius: 999,
    border: `1px solid ${active ? '#3DDC84' : S.BORDER}`,
    background: active ? 'rgba(61,220,132,0.12)' : 'transparent',
    color: active ? '#3DDC84' : S.MUTED,
    cursor: 'pointer',
  };
}
