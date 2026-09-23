'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { formatEuros, inicialesJugador } from '@/lib/salaShared';
import { GRUPO_PORRA_LABELS, ORDEN_GRUPOS, COLOR_GRUPO, type GrupoPorra } from '@/lib/porraGrupos';

// ============================================================================
// CREAR EQUIPO EN UNA PORRA CLÁSICA (isPorraEquipo + isPorraConfirmar de
// Main.dc.html, líneas 1462-1550) — un jugador como mucho por cada grupo de
// color, nombre de equipo obligatorio, sin presupuesto de fantasía (precio
// de entrada fijo). Mismo patrón de un único componente con paso interno
// (draft/confirm) que la pantalla equivalente de salas.
//
// Adaptación respecto a la maqueta: la maqueta da por hecho un reparto fijo
// de grupos (Amarillo/Verde/Azul/LIV + libre + reserva); aquí los huecos
// del panel "Tu equipo" salen de los grupos que de verdad tiene esta porra
// (lib/porraGrupos.ts, hasta 5: amarillo/verde/azul/morado/españoles) — se
// pide un jugador de cada uno de los que tenga jugadores, más un hueco
// adicional de "comodín" (corrección de Iñi, 23/09): el comodín se puede
// rellenar con cualquier jugador de cualquiera de esas listas, repitiendo
// grupo — solo no se permite repetir el mismo jugador físico (eso ya lo
// impide, además, inscribirse_en_porra() en el esquema SQL).

type PorraRow = { id: string; major: string; precio: number; competicion: string | null; estado: string };
type JugadorRow = { id: string; nombre: string; grupo_porra: GrupoPorra | null; precio: number };

const COMODIN_COLOR = '#2DD4BF';

export default function CrearEquipoPorraPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const porraId = params.id;
  const searchParams = useSearchParams();
  // Con ?equipo=<id> esta misma pantalla edita un equipo ya inscrito, en vez
  // de crear uno nuevo (pedido de Iñi, 23/09: "en las porras puedo
  // participar todas las veces que quiera" — así que ya no se bloquea por
  // tener equipo, y además se puede editar el que ya tienes).
  const equipoEditandoId = searchParams.get('equipo');
  const modoEdicion = !!equipoEditandoId;

  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [porra, setPorra] = useState<PorraRow | null>(null);
  const [jugadores, setJugadores] = useState<JugadorRow[]>([]);
  const [nombreEquipo, setNombreEquipo] = useState('');
  const [selected, setSelected] = useState<Map<GrupoPorra, string>>(new Map());
  const [comodinId, setComodinId] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<GrupoPorra | 'comodin' | null>(null);
  const [step, setStep] = useState<'draft' | 'confirm'>('draft');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

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
        supabase.from('porras').select('id,major,precio,competicion,estado').eq('id', porraId).single(),
      ]);

      if (!activo) return;
      if (perfilData) setPerfil(perfilData as Perfil);

      if (!porraData) {
        setError('No se ha encontrado esta porra.');
        setCargando(false);
        return;
      }
      const porraRow = porraData as PorraRow;

      if (porraRow.estado === 'finalizada') {
        // replace, no push — ver el mismo comentario en salas/[id]/crear-equipo (bug de la flecha de volver, 23/09).
        router.replace(`/porras/${porraId}`);
        return;
      }

      const [{ data: jugData }, { data: equipoEditandoData }] = await Promise.all([
        porraRow.competicion
          ? supabase.from('jugadores').select('id,nombre,grupo_porra,precio').eq('deporte', 'golf').eq('competicion', porraRow.competicion)
          : Promise.resolve({ data: [] as JugadorRow[] }),
        equipoEditandoId
          ? supabase
              .from('equipos')
              .select('id, nombre_equipo, jugadores, usuario_id')
              .eq('id', equipoEditandoId)
              .eq('porra_id', porraId)
              .eq('usuario_id', session.user.id)
              .maybeSingle()
          : Promise.resolve({ data: null as { id: string; nombre_equipo: string | null; jugadores: string[] } | null }),
      ]);

      if (!activo) return;

      const jugRows = ((jugData as JugadorRow[]) ?? []).filter((j) => j.grupo_porra !== null);
      setPorra(porraRow);
      setJugadores(jugRows);

      if (equipoEditandoId) {
        const equipoEditando = equipoEditandoData as { id: string; nombre_equipo: string | null; jugadores: string[] } | null;
        if (!equipoEditando) {
          setError('No se ha encontrado ese equipo, o no es tuyo.');
          setCargando(false);
          return;
        }
        // Reconstruye qué jugador es el titular de cada grupo y cuál es el
        // comodín a partir de la lista de ids guardada — un grupo con dos
        // jugadores guardados es el grupo del comodín (da igual cuál de los
        // dos se pinte como "titular" y cuál como "comodín", el resultado
        // final es el mismo equipo).
        const jugadoresPorIdLocal = new Map(jugRows.map((j) => [j.id, j]));
        const porGrupo = new Map<GrupoPorra, string[]>();
        (equipoEditando.jugadores ?? []).forEach((id) => {
          const j = jugadoresPorIdLocal.get(id);
          if (!j || !j.grupo_porra) return;
          const arr = porGrupo.get(j.grupo_porra) ?? [];
          arr.push(id);
          porGrupo.set(j.grupo_porra, arr);
        });
        const nuevoSelected = new Map<GrupoPorra, string>();
        let nuevoComodin: string | null = null;
        porGrupo.forEach((ids, grupo) => {
          const ordenados = [...ids].sort();
          nuevoSelected.set(grupo, ordenados[0]);
          if (ordenados[1]) nuevoComodin = ordenados[1];
        });
        setNombreEquipo(equipoEditando.nombre_equipo ?? '');
        setSelected(nuevoSelected);
        setComodinId(nuevoComodin);
      }

      const primerGrupo = ORDEN_GRUPOS.find((g) => jugRows.some((j) => j.grupo_porra === g));
      setActiveGroup(primerGrupo ?? null);
      setCargando(false);
    }

    cargar();
    return () => {
      activo = false;
    };
  }, [router, porraId, equipoEditandoId]);

  const gruposDisponibles = useMemo(() => ORDEN_GRUPOS.filter((g) => jugadores.some((j) => j.grupo_porra === g)), [jugadores]);
  const jugadoresPorId = useMemo(() => new Map(jugadores.map((j) => [j.id, j])), [jugadores]);
  const seleccionados: { jugador: JugadorRow; esComodin: boolean }[] = [
    ...gruposDisponibles
      .map((g) => (selected.has(g) ? jugadoresPorId.get(selected.get(g)!) : null))
      .filter((j): j is JugadorRow => !!j)
      .map((j) => ({ jugador: j, esComodin: false })),
    ...(comodinId && jugadoresPorId.has(comodinId) ? [{ jugador: jugadoresPorId.get(comodinId)!, esComodin: true }] : []),
  ];

  const totalHuecos = gruposDisponibles.length > 0 ? gruposDisponibles.length + 1 : 0;
  const huecosRellenos = selected.size + (comodinId ? 1 : 0);
  const equipoCompleto = totalHuecos > 0 && huecosRellenos === totalHuecos;
  const nombreValido = nombreEquipo.trim().length > 0;
  const puedeConfirmar = equipoCompleto && nombreValido;

  function toggleJugador(jugador: JugadorRow) {
    const grupo = jugador.grupo_porra;
    if (!grupo) return;
    setSelected((prev) => {
      const nuevo = new Map(prev);
      if (nuevo.get(grupo) === jugador.id) {
        nuevo.delete(grupo);
      } else {
        nuevo.set(grupo, jugador.id);
      }
      return nuevo;
    });
    // Tras elegir, salta al siguiente grupo que todavía no tenga jugador; si
    // ya están todos los grupos de color completos, salta al comodín.
    const siguiente = gruposDisponibles.find((g) => g !== grupo && !selected.has(g));
    if (siguiente) setActiveGroup(siguiente);
    else if (!comodinId) setActiveGroup('comodin');
  }

  function toggleComodin(jugador: JugadorRow) {
    setComodinId((prev) => (prev === jugador.id ? null : jugador.id));
  }

  async function confirmarInscripcion() {
    setEnviando(true);
    setErrorEnvio(null);
    const jugadoresElegidos = [...Array.from(selected.values()), ...(comodinId ? [comodinId] : [])];
    const { error: rpcError } = modoEdicion
      ? await supabase.rpc('editar_equipo_porra', {
          p_equipo_id: equipoEditandoId,
          p_jugadores: jugadoresElegidos,
          p_nombre_equipo: nombreEquipo.trim(),
        })
      : await supabase.rpc('inscribirse_en_porra', {
          p_porra_id: porraId,
          p_jugadores: jugadoresElegidos,
          p_nombre_equipo: nombreEquipo.trim(),
        });
    if (rpcError) {
      setErrorEnvio(traducirError(rpcError.message));
      setEnviando(false);
      return;
    }
    // replace, no push — ver el mismo comentario en salas/[id]/crear-equipo (bug de la flecha de volver, 23/09).
    router.replace(`/porras/${porraId}`);
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

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />

        {step === 'draft' ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '20px 20px 24px' }}>
              <button type="button" onClick={() => router.push(`/porras/${porraId}`)} style={backArrowStyle}>
                ←
              </button>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#3DDC84' }}>{porra.major}</span>
                <h1 style={{ fontSize: 24, fontWeight: 800, color: S.TEXT }}>{modoEdicion ? 'Edita tu equipo' : 'Crea tu equipo'}</h1>
                <p style={{ fontSize: 13, color: S.MUTED_2 }}>Elige un jugador de cada grupo de color, más un comodín de cualquier lista.</p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_2 }}>Nombre del equipo</label>
                <input type="text" value={nombreEquipo} onChange={(e) => setNombreEquipo(e.target.value)} placeholder="Ej. Los Birdies de Iñi" style={S.input} />
              </div>

              {gruposDisponibles.length === 0 ? (
                <p style={{ fontSize: 13, color: S.MUTED_2 }}>Todavía no se ha subido el listado de jugadores de este torneo.</p>
              ) : (
                <>
                  <div style={{ position: 'sticky', top: 0, zIndex: 5, background: S.BG, paddingTop: 2, paddingBottom: 6, margin: '0 -20px', paddingLeft: 20, paddingRight: 20 }}>
                    <div style={{ background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_2 }}>Grupo activo</span>
                      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 16, color: activeGroup === 'comodin' ? COMODIN_COLOR : activeGroup ? COLOR_GRUPO[activeGroup] : S.MUTED_3 }}>
                        {activeGroup === 'comodin' ? 'Comodín (cualquier lista)' : activeGroup ? GRUPO_PORRA_LABELS[activeGroup] : '—'}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {gruposDisponibles.map((grupo) =>
                        jugadores
                          .filter((j) => j.grupo_porra === grupo)
                          .sort((a, b) => a.nombre.localeCompare(b.nombre))
                          .map((j) => {
                            const modoComodin = activeGroup === 'comodin';
                            const isSelectedPrimario = selected.get(grupo) === j.id;
                            const isSelectedComodin = comodinId === j.id;
                            const isSelected = modoComodin ? isSelectedComodin : isSelectedPrimario;
                            // No se puede usar el mismo jugador físico dos veces: si ya
                            // está puesto como comodín, no se puede volver a elegir como
                            // titular de su grupo, y viceversa.
                            const usadoEnOtroHueco = modoComodin
                              ? Array.from(selected.values()).includes(j.id) && !isSelectedComodin
                              : comodinId === j.id && !isSelectedPrimario;
                            const isActive = modoComodin ? true : grupo === activeGroup;
                            const disabled = usadoEnOtroHueco || (!isSelected && !isActive);
                            return (
                              <a
                                key={j.id}
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (disabled) return;
                                  if (modoComodin) toggleComodin(j);
                                  else toggleJugador(j);
                                }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  padding: '9px 8px',
                                  background: isSelected ? 'rgba(61,220,132,0.1)' : S.PANEL,
                                  border: `1px solid ${isSelected ? 'rgba(61,220,132,0.4)' : '#1E2723'}`,
                                  borderRadius: 10,
                                  textDecoration: 'none',
                                  opacity: disabled ? 0.4 : 1,
                                  pointerEvents: disabled ? 'none' : 'auto',
                                }}
                              >
                                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.nombre}</span>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: COLOR_GRUPO[grupo] }}>{GRUPO_PORRA_LABELS[grupo]}</span>
                                </div>
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
                                    border: `1px solid ${isSelected ? '#3DDC84' : S.BORDER}`,
                                    background: isSelected ? '#3DDC84' : 'transparent',
                                    color: isSelected ? '#04140B' : S.MUTED,
                                  }}
                                >
                                  {isSelected ? '−' : '+'}
                                </span>
                              </a>
                            );
                          })
                      )}
                    </div>

                    <div style={{ flexShrink: 0, width: 96, display: 'flex', flexDirection: 'column', gap: 6, position: 'sticky', top: 128 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3, textAlign: 'center' }}>Tu equipo</span>
                      {gruposDisponibles.map((grupo) => {
                        const jugadorId = selected.get(grupo);
                        const j = jugadorId ? jugadoresPorId.get(jugadorId) : null;
                        const isActive = grupo === activeGroup;
                        return (
                          <a
                            key={grupo}
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              setActiveGroup(grupo);
                            }}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 2,
                              background: isActive ? 'rgba(61,220,132,0.08)' : 'transparent',
                              border: `1.5px solid ${isActive ? '#3DDC84' : COLOR_GRUPO[grupo] + '55'}`,
                              borderRadius: 9,
                              padding: '6px 3px',
                              textDecoration: 'none',
                              width: '100%',
                            }}
                          >
                            {j ? (
                              <span key={j.id} style={{ animation: 'slotPop 0.4s cubic-bezier(.34,1.56,.64,1) both', width: 26, height: 26, borderRadius: '50%', background: COLOR_GRUPO[grupo], color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.2)' }}>
                                {inicialesJugador(j.nombre)}
                              </span>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', border: `1.5px dashed ${COLOR_GRUPO[grupo]}` }} />
                            )}
                            {j && <span style={{ width: '100%', fontSize: 8.5, fontWeight: 700, color: S.TEXT, textAlign: 'center', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.nombre}</span>}
                            <span style={{ fontSize: 7.5, fontWeight: 700, color: COLOR_GRUPO[grupo], lineHeight: 1.15, textAlign: 'center' }}>{GRUPO_PORRA_LABELS[grupo].split(' ')[0]}</span>
                          </a>
                        );
                      })}

                      {(() => {
                        const j = comodinId ? jugadoresPorId.get(comodinId) : null;
                        const isActive = activeGroup === 'comodin';
                        return (
                          <a
                            key="comodin"
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              setActiveGroup('comodin');
                            }}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 2,
                              background: isActive ? 'rgba(61,220,132,0.08)' : 'transparent',
                              border: `1.5px solid ${isActive ? '#3DDC84' : COMODIN_COLOR + '55'}`,
                              borderRadius: 9,
                              padding: '6px 3px',
                              textDecoration: 'none',
                              width: '100%',
                            }}
                          >
                            {j ? (
                              <span key={j.id} style={{ animation: 'slotPop 0.4s cubic-bezier(.34,1.56,.64,1) both', width: 26, height: 26, borderRadius: '50%', background: COMODIN_COLOR, color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.2)' }}>
                                {inicialesJugador(j.nombre)}
                              </span>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', border: `1.5px dashed ${COMODIN_COLOR}` }} />
                            )}
                            {j && <span style={{ width: '100%', fontSize: 8.5, fontWeight: 700, color: S.TEXT, textAlign: 'center', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.nombre}</span>}
                            <span style={{ fontSize: 7.5, fontWeight: 700, color: COMODIN_COLOR, lineHeight: 1.15, textAlign: 'center' }}>Comodín</span>
                          </a>
                        );
                      })()}
                    </div>
                  </div>

                  <span style={{ fontSize: 11, color: '#4E574F' }}>Toca un hueco de la derecha para elegir su grupo, y luego un jugador de la lista. El hueco "Comodín" acepta un jugador de cualquiera de las listas.</span>
                </>
              )}
            </div>

            <div style={{ position: 'sticky', bottom: 0, padding: '8px 20px 12px', background: 'linear-gradient(180deg, rgba(11,15,14,0) 0%, #0B0F0E 40%)' }}>
              <button type="button" disabled={!puedeConfirmar} onClick={() => setStep('confirm')} style={submitButtonStyle(puedeConfirmar, '#3DDC84')}>
                {!nombreValido ? 'Ponle nombre a tu equipo' : equipoCompleto ? (modoEdicion ? 'Revisar cambios' : 'Revisar e inscribirme') : `Faltan ${totalHuecos - huecosRellenos} jugadores`}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '28px 20px 56px' }}>
            <button type="button" onClick={() => setStep('draft')} style={backArrowStyle}>
              ←
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#3DDC84' }}>{porra.major}</span>
              <h1 style={{ fontSize: 24, fontWeight: 800, color: S.TEXT }}>{modoEdicion ? 'Confirma los cambios' : 'Confirma tu equipo'}</h1>
              <p style={{ fontSize: 13, color: S.MUTED_2 }}>
                Porra clásica{modoEdicion ? ' · sin coste adicional, ya está pagado' : ` · ${formatEuros(porra.precio)} por equipo`}
              </p>
            </div>

            <div style={{ background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>{nombreEquipo.trim()}</span>
              {seleccionados.map(({ jugador: j, esComodin }) => {
                const color = esComodin ? COMODIN_COLOR : COLOR_GRUPO[j.grupo_porra as GrupoPorra];
                const etiqueta = esComodin ? `Comodín · ${GRUPO_PORRA_LABELS[j.grupo_porra as GrupoPorra]}` : GRUPO_PORRA_LABELS[j.grupo_porra as GrupoPorra];
                return (
                  <div key={`${j.id}-${esComodin ? 'comodin' : 'titular'}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ flexShrink: 0, width: 32, height: 32, borderRadius: '50%', background: color, color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.2)' }}>
                      {inicialesJugador(j.nombre)}
                    </span>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.nombre}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color }}>{etiqueta}</span>
                    </div>
                  </div>
                );
              })}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #1E2723', marginTop: 4, paddingTop: 10 }}>
                <span style={{ fontSize: 13, color: S.MUTED_2 }}>{modoEdicion ? 'Ya pagado' : 'Precio del equipo'}</span>
                <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 15, color: '#F0B94D' }}>{formatEuros(porra.precio)}</span>
              </div>
            </div>

            {errorEnvio && <p style={S.errorText}>{errorEnvio}</p>}

            <button type="button" disabled={enviando} onClick={confirmarInscripcion} style={{ ...submitButtonStyle(true, '#3DDC84'), opacity: enviando ? 0.7 : 1, fontSize: 16, padding: 14, minHeight: 44, borderRadius: 10 }}>
              {enviando ? (modoEdicion ? 'Guardando...' : 'Inscribiendo...') : modoEdicion ? 'Guardar cambios' : 'Confirmar inscripción'}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

const backArrowStyle: React.CSSProperties = { width: 34, height: 34, padding: 0, margin: '0 0 4px', border: 'none', background: 'transparent', color: '#3DDC84', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 20, alignSelf: 'flex-start' };

function submitButtonStyle(enabled: boolean, activeColor: string): React.CSSProperties {
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
    background: enabled ? activeColor : S.PANEL,
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
  return mensaje.replace(/^ERROR:\s*/i, '');
}
