'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
// pide un jugador de cada uno de los que tenga jugadores.

type PorraRow = { id: string; major: string; precio: number; competicion: string | null; estado: string };
type JugadorRow = { id: string; nombre: string; grupo_porra: GrupoPorra | null; precio: number };

export default function CrearEquipoPorraPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const porraId = params.id;

  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [porra, setPorra] = useState<PorraRow | null>(null);
  const [jugadores, setJugadores] = useState<JugadorRow[]>([]);
  const [nombreEquipo, setNombreEquipo] = useState('');
  const [selected, setSelected] = useState<Map<GrupoPorra, string>>(new Map());
  const [activeGroup, setActiveGroup] = useState<GrupoPorra | null>(null);
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
        router.push(`/porras/${porraId}`);
        return;
      }

      const [{ data: miEquipoData }, { data: jugData }] = await Promise.all([
        supabase.from('equipos').select('id, inscripciones(estado)').eq('porra_id', porraId).eq('usuario_id', session.user.id).maybeSingle(),
        porraRow.competicion
          ? supabase.from('jugadores').select('id,nombre,grupo_porra,precio').eq('deporte', 'golf').eq('competicion', porraRow.competicion)
          : Promise.resolve({ data: [] as JugadorRow[] }),
      ]);

      if (!activo) return;

      const miEquipo = miEquipoData as { id: string; inscripciones: { estado: string }[] } | null;
      if (miEquipo && miEquipo.inscripciones.some((i) => i.estado !== 'reembolsada')) {
        router.push(`/porras/${porraId}`);
        return;
      }

      const jugRows = ((jugData as JugadorRow[]) ?? []).filter((j) => j.grupo_porra !== null);
      setPorra(porraRow);
      setJugadores(jugRows);
      const primerGrupo = ORDEN_GRUPOS.find((g) => jugRows.some((j) => j.grupo_porra === g));
      setActiveGroup(primerGrupo ?? null);
      setCargando(false);
    }

    cargar();
    return () => {
      activo = false;
    };
  }, [router, porraId]);

  const gruposDisponibles = useMemo(() => ORDEN_GRUPOS.filter((g) => jugadores.some((j) => j.grupo_porra === g)), [jugadores]);
  const jugadoresPorId = useMemo(() => new Map(jugadores.map((j) => [j.id, j])), [jugadores]);
  const seleccionados = gruposDisponibles.map((g) => (selected.has(g) ? jugadoresPorId.get(selected.get(g)!) : null)).filter((j): j is JugadorRow => !!j);

  const equipoCompleto = gruposDisponibles.length > 0 && selected.size === gruposDisponibles.length;
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
    // Tras elegir, salta al siguiente grupo que todavía no tenga jugador.
    const siguiente = gruposDisponibles.find((g) => g !== grupo && !selected.has(g));
    if (siguiente) setActiveGroup(siguiente);
  }

  async function confirmarInscripcion() {
    setEnviando(true);
    setErrorEnvio(null);
    const { error: rpcError } = await supabase.rpc('inscribirse_en_porra', {
      p_porra_id: porraId,
      p_jugadores: Array.from(selected.values()),
      p_nombre_equipo: nombreEquipo.trim(),
    });
    if (rpcError) {
      setErrorEnvio(traducirError(rpcError.message));
      setEnviando(false);
      return;
    }
    router.push(`/porras/${porraId}`);
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
                <h1 style={{ fontSize: 24, fontWeight: 800, color: S.TEXT }}>Crea tu equipo</h1>
                <p style={{ fontSize: 13, color: S.MUTED_2 }}>Elige un jugador de cada grupo de color.</p>
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
                      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 16, color: activeGroup ? COLOR_GRUPO[activeGroup] : S.MUTED_3 }}>{activeGroup ? GRUPO_PORRA_LABELS[activeGroup] : '—'}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {gruposDisponibles.map((grupo) =>
                        jugadores
                          .filter((j) => j.grupo_porra === grupo)
                          .sort((a, b) => a.nombre.localeCompare(b.nombre))
                          .map((j) => {
                            const isSelected = selected.get(grupo) === j.id;
                            const isActive = grupo === activeGroup;
                            const disabled = !isSelected && !isActive;
                            return (
                              <a
                                key={j.id}
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (!disabled) toggleJugador(j);
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
                    </div>
                  </div>

                  <span style={{ fontSize: 11, color: '#4E574F' }}>Toca un hueco de la derecha para elegir su grupo, y luego un jugador de la lista.</span>
                </>
              )}
            </div>

            <div style={{ position: 'sticky', bottom: 0, padding: '8px 20px 12px', background: 'linear-gradient(180deg, rgba(11,15,14,0) 0%, #0B0F0E 40%)' }}>
              <button type="button" disabled={!puedeConfirmar} onClick={() => setStep('confirm')} style={submitButtonStyle(puedeConfirmar, '#3DDC84')}>
                {!nombreValido ? 'Ponle nombre a tu equipo' : equipoCompleto ? 'Revisar e inscribirme' : `Faltan ${gruposDisponibles.length - selected.size} grupos`}
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
              <h1 style={{ fontSize: 24, fontWeight: 800, color: S.TEXT }}>Confirma tu equipo</h1>
              <p style={{ fontSize: 13, color: S.MUTED_2 }}>Porra clásica · {formatEuros(porra.precio)} por equipo</p>
            </div>

            <div style={{ background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>{nombreEquipo.trim()}</span>
              {seleccionados.map((j) => (
                <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ flexShrink: 0, width: 32, height: 32, borderRadius: '50%', background: COLOR_GRUPO[j.grupo_porra as GrupoPorra], color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.2)' }}>
                    {inicialesJugador(j.nombre)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.nombre}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: COLOR_GRUPO[j.grupo_porra as GrupoPorra] }}>{GRUPO_PORRA_LABELS[j.grupo_porra as GrupoPorra]}</span>
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #1E2723', marginTop: 4, paddingTop: 10 }}>
                <span style={{ fontSize: 13, color: S.MUTED_2 }}>Precio del equipo</span>
                <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 15, color: '#F0B94D' }}>{formatEuros(porra.precio)}</span>
              </div>
            </div>

            {errorEnvio && <p style={S.errorText}>{errorEnvio}</p>}

            <button type="button" disabled={enviando} onClick={confirmarInscripcion} style={{ ...submitButtonStyle(true, '#3DDC84'), opacity: enviando ? 0.7 : 1, fontSize: 16, padding: 14, minHeight: 44, borderRadius: 10 }}>
              {enviando ? 'Inscribiendo...' : 'Confirmar inscripción'}
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
