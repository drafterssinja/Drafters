'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { todasLasFilas } from '@/lib/paginar';
import * as S from '@/lib/mockupStyles';
import MarcoV2, { EtiquetaBeta, Panel, Titulo, V2_COLOR } from '@/components/v2/MarcoV2';
import EditorPremio, { PREMIO_VACIO } from '@/components/v2/EditorPremio';
import { useSesionV2 } from '@/components/v2/useSesionV2';
import { MODALIDAD_DESC, MODALIDAD_LABEL, fechaCorta, mensajeError, premioValido, type Modalidad, type Premio } from '@/lib/v2';

// ============================================================================
// DRAFTERS V2 — CREAR UNA SALA (15/10)
// ============================================================================
// Pedido de Iñi: ya no hay mesas creadas de antemano; cada uno crea la suya y
// decide: deporte, una jornada o varias seguidas (p.ej. Liga J8 a J11), qué
// partidos entran (si es una sola jornada), cuántos jugadores, modalidad
// (presupuesto / libre / draft), pública o privada con contraseña y, en las
// privadas, lo que se juega cada uno y cómo se reparte.

type Comp = { deporte: string; competicion: string; cierre: string };
type Partido = { local: string; visitante: string; kickoff: string | null };

function ligaDe(competicion: string): string {
  return competicion.replace(/\s*-\s*Jornada\s*\d+\s*$/i, '');
}
function numeroJornada(competicion: string): number {
  const m = competicion.match(/Jornada\s*(\d+)/i);
  return m ? Number(m[1]) : 0;
}

export default function V2Crear() {
  return (
    <Suspense fallback={null}>
      <V2CrearInner />
    </Suspense>
  );
}

function V2CrearInner() {
  const router = useRouter();
  const { perfil, estado } = useSesionV2();
  const [comps, setComps] = useState<Comp[] | null>(null);

  const [nombre, setNombre] = useState('');
  // 15/10: se crea desde la página de un deporte, así que ya viene elegido.
  const deporte: 'futbol' | 'golf' = useSearchParams().get('deporte') === 'golf' ? 'golf' : 'futbol';
  const [liga, setLiga] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [torneo, setTorneo] = useState('');
  const [partidos, setPartidos] = useState<Partido[]>([]);
  const [partidosOn, setPartidosOn] = useState<Set<string>>(new Set());
  const [jugadoresPorEquipo, setJugadoresPorEquipo] = useState<Map<string, Record<string, number>>>(new Map());
  const [numJugadores, setNumJugadores] = useState(4);
  const [modalidad, setModalidad] = useState<Modalidad>('presupuesto');
  const [privada, setPrivada] = useState(true);
  const [contrasena, setContrasena] = useState('');
  const [premio, setPremio] = useState<Premio>(PREMIO_VACIO);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (estado !== 'ok') return;
    supabase.rpc('amistoso_competiciones_disponibles').then(({ data }) => setComps((data as Comp[]) ?? []));
  }, [estado]);

  const futbol = useMemo(() => (comps ?? []).filter((c) => c.deporte === 'futbol'), [comps]);
  const golf = useMemo(() => (comps ?? []).filter((c) => c.deporte === 'golf'), [comps]);
  const ligas = useMemo(() => Array.from(new Set(futbol.map((c) => ligaDe(c.competicion)))), [futbol]);
  const jornadasLiga = useMemo(() => futbol.filter((c) => ligaDe(c.competicion) === liga).sort((a, b) => numeroJornada(a.competicion) - numeroJornada(b.competicion)), [futbol, liga]);

  // Valores por defecto al cargar / cambiar de liga.
  useEffect(() => {
    if (!liga && ligas.length) setLiga(ligas[0]);
  }, [ligas, liga]);
  useEffect(() => {
    if (jornadasLiga.length) {
      setDesde(jornadasLiga[0].competicion);
      setHasta(jornadasLiga[0].competicion);
    }
  }, [jornadasLiga]);
  useEffect(() => {
    if (!torneo && golf.length) setTorneo(golf[0].competicion);
  }, [golf, torneo]);

  const seleccion: string[] = useMemo(() => {
    if (deporte === 'golf') return torneo ? [torneo] : [];
    const a = jornadasLiga.findIndex((c) => c.competicion === desde);
    const b = jornadasLiga.findIndex((c) => c.competicion === hasta);
    if (a < 0 || b < 0 || b < a) return [];
    return jornadasLiga.slice(a, b + 1).map((c) => c.competicion);
  }, [deporte, torneo, jornadasLiga, desde, hasta]);

  const unaJornadaFutbol = deporte === 'futbol' && seleccion.length === 1 ? seleccion[0] : null;

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
        supabase.from('futbol_partidos_jornada').select('equipo_local,equipo_visitante,kickoff').eq('competicion', unaJornadaFutbol),
        todasLasFilas<{ equipo_real: string | null; posicion: string | null }>((d, h) =>
          supabase.from('jugadores').select('equipo_real,posicion').eq('competicion', unaJornadaFutbol).not('baja', 'is', true).order('id').range(d, h)
        ),
      ]);
      if (!activo) return;
      const kick = new Map(((jornada as { equipo_local: string; equipo_visitante: string; kickoff: string | null }[]) ?? []).map((p) => [`${p.equipo_local}|${p.equipo_visitante}`, p.kickoff]));
      const lista = ((cuotas as { equipo_local: string; equipo_visitante: string }[]) ?? []).map((c) => ({ local: c.equipo_local, visitante: c.equipo_visitante, kickoff: kick.get(`${c.equipo_local}|${c.equipo_visitante}`) ?? null }));
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

  // En el draft nadie repite jugador: tiene que haber suficientes de cada puesto.
  const avisoDraft = useMemo(() => {
    if (modalidad !== 'draft' || !unaJornadaFutbol || todosLosPartidos || partidos.length === 0) return null;
    const c: Record<string, number> = {};
    partidos.forEach((p) => {
      if (!partidosOn.has(`${p.local}|${p.visitante}`)) return;
      [p.local, p.visitante].forEach((e) => Object.entries(jugadoresPorEquipo.get(e) ?? {}).forEach(([pos, n]) => (c[pos] = (c[pos] ?? 0) + n)));
    });
    const n = numJugadores;
    if ((c.portero ?? 0) < n) return `Con esos partidos solo hay ${c.portero ?? 0} porteros y sois ${n}: en el draft cada uno necesita uno. Añade más partidos.`;
    if ((c.defensa ?? 0) < 3 * n || (c.centrocampista ?? 0) < 3 * n || (c.delantero ?? 0) < n) return 'Con esos partidos no hay jugadores suficientes para que todos completéis el equipo en el draft. Añade más partidos.';
    return null;
  }, [modalidad, unaJornadaFutbol, todosLosPartidos, partidos, partidosOn, jugadoresPorEquipo, numJugadores]);

  async function crear() {
    setError(null);
    if (!nombre.trim()) return setError('Ponle un nombre a la sala.');
    if (seleccion.length === 0) return setError(deporte === 'golf' ? 'Elige un torneo.' : 'Elige la jornada (o la primera y la última).');
    if (privada && contrasena.trim().length < 3) return setError('Pon una contraseña de al menos 3 caracteres.');
    if (unaJornadaFutbol && partidos.length > 0 && partidosOn.size === 0) return setError('Elige al menos un partido.');
    if (avisoDraft) return setError(avisoDraft);
    const premioFinal = privada ? premio : PREMIO_VACIO;
    const errPremio = premioValido(premioFinal);
    if (errPremio) return setError(errPremio);

    const jornadas = seleccion.map((competicion) => {
      if (competicion === unaJornadaFutbol && partidos.length > 0 && !todosLosPartidos) {
        const elegidos = partidos.filter((p) => partidosOn.has(`${p.local}|${p.visitante}`));
        return { competicion, equipos_permitidos: elegidos.flatMap((p) => [p.local, p.visitante]), partidos: elegidos.map((p) => ({ local: p.local, visitante: p.visitante })) };
      }
      return { competicion, equipos_permitidos: null, partidos: null };
    });

    setEnviando(true);
    const { data, error: e } = await supabase.rpc('amistoso_crear', {
      p: { nombre: nombre.trim(), deporte, modalidad, num_jugadores: numJugadores, privada, contrasena: privada ? contrasena.trim() : null, premio: premioFinal.tipo === 'nada' ? null : premioFinal, jornadas },
    });
    setEnviando(false);
    if (e) return setError(mensajeError(e));
    router.replace(`/v2/sala/${data as string}`);
  }

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
        <Titulo>Nuevo amistoso de {deporte === 'golf' ? 'golf' : 'fútbol'}</Titulo>
      </div>

      {bloque('Nombre', <input value={nombre} maxLength={40} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. La liga de los jueves" style={S.input} />)}

      {comps === null && <p style={{ fontSize: 13, color: S.MUTED_2 }}>Cargando jornadas y torneos...</p>}

      {comps !== null && deporte === 'futbol' &&
        bloque(
          'Jornadas',
          futbol.length === 0 ? (
            <span style={{ fontSize: 13, color: S.MUTED_3 }}>Ahora mismo no hay ninguna jornada por empezar.</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {ligas.map((l) => (
                  <button key={l} type="button" style={S.pill(liga === l)} onClick={() => setLiga(l)}>
                    {l}
                  </button>
                ))}
              </div>
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
                    {jornadasLiga.map((c) => (
                      <option key={c.competicion} value={c.competicion}>
                        Jornada {numeroJornada(c.competicion)}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ ...S.field, flex: 1 }}>
                  <span style={S.label}>Hasta</span>
                  <select value={hasta} onChange={(e) => setHasta(e.target.value)} style={S.selectInput}>
                    {jornadasLiga
                      .filter((c) => numeroJornada(c.competicion) >= numeroJornada(desde))
                      .map((c) => (
                        <option key={c.competicion} value={c.competicion}>
                          Jornada {numeroJornada(c.competicion)}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <span style={{ fontSize: 12, color: S.MUTED_2 }}>
                {seleccion.length > 1 ? `${seleccion.length} jornadas seguidas: gana quien más puntos sume entre todas. Se hace un equipo${modalidad === 'draft' ? ' (y un draft)' : ''} por jornada.` : jornadasLiga.find((c) => c.competicion === desde) ? `Empieza ${fechaCorta(jornadasLiga.find((c) => c.competicion === desde)?.cierre ?? null)}` : ''}
              </span>
            </div>
          ),
          'Una sola jornada o varias seguidas de la misma competición. Solo salen las que ya están cargadas.'
        )}

      {comps !== null && deporte === 'golf' &&
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

      {unaJornadaFutbol &&
        partidos.length > 0 &&
        bloque(
          `Partidos (${partidosOn.size} de ${partidos.length})`,
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" style={S.pill(todosLosPartidos)} onClick={() => setPartidosOn(new Set(partidos.map((p) => `${p.local}|${p.visitante}`)))}>
                Todos
              </button>
              <button type="button" style={S.pill(false)} onClick={() => setPartidosOn(new Set())}>
                Ninguno
              </button>
            </div>
            {partidos.map((p) => {
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
          'Solo se podrán elegir jugadores de los partidos marcados.'
        )}

      {bloque(
        'Jugadores en la sala',
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
            <button key={n} type="button" style={{ ...S.pill(numJugadores === n), minWidth: 38 }} onClick={() => setNumJugadores(n)}>
              {n}
            </button>
          ))}
        </div>
      )}

      {bloque(
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

      {bloque(
        'Privacidad',
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" style={S.pill(privada)} onClick={() => setPrivada(true)}>
              🔒 Privada
            </button>
            <button type="button" style={S.pill(!privada)} onClick={() => setPrivada(false)}>
              🌍 Pública
            </button>
          </div>
          {privada ? (
            <input value={contrasena} onChange={(e) => setContrasena(e.target.value)} placeholder="Contraseña para entrar" style={S.input} autoComplete="off" />
          ) : (
            <span style={{ fontSize: 12, color: S.MUTED_2, lineHeight: 1.5 }}>Cualquiera con Drafters V2 la verá y podrá entrar. En las públicas no se juega nada de inicio; en el chat se puede proponer jugarse algo y, si lo aceptan todos, queda fijado.</span>
          )}
        </div>
      )}

      {privada &&
        bloque(
          '¿Qué os jugáis?',
          <EditorPremio premio={premio} onChange={setPremio} participantes={numJugadores} />,
          'Lo puedes cambiar después desde la sala (se avisa a todos en el chat).'
        )}

      <p style={{ fontSize: 11.5, color: S.MUTED_3, lineHeight: 1.5, margin: 0 }}>Drafters no cobra ni paga nada en los amistosos: solo calcula la clasificación y cuánto le toca a cada uno.</p>

      {error && <p style={S.errorText}>{error}</p>}
      <button type="button" onClick={crear} disabled={enviando} style={{ ...S.primaryButton, background: V2_COLOR, opacity: enviando ? 0.6 : 1 }}>
        {enviando ? 'Creando...' : 'Crear sala'}
      </button>
    </MarcoV2>
  );
}
