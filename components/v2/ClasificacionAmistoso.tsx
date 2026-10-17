'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { puntosGolfTramo, type PorRonda } from '@/lib/tramos';
import { formatPuntos } from '@/lib/futbolLaLiga';
import { V2_COLOR } from '@/components/v2/MarcoV2';
import Cargando from '@/components/Cargando';
import ClasificacionMesaFutbol, { type EquipoExterno } from '@/components/ClasificacionMesaFutbol';
import { cadaXSegundos, repartirPremio, textoBote, type Amistoso, type AmistosoJornada, type Resumen } from '@/lib/v2';

type Equipo = { competicion: string; usuario_id: string; jugadores: string[]; alineacion: string | null };
type Jug = { id: string; nombre: string; posicion: string | null; equipo_real: string | null };

const ORDEN_POS: Record<string, number> = { portero: 0, defensa: 1, centrocampista: 2, delantero: 3 };
const ABREV_POS: Record<string, string> = { portero: 'POR', defensa: 'DEF', centrocampista: 'MED', delantero: 'DEL' };

// Clasificación de la sala (suma de todas sus jornadas) con lo que le toca a
// cada uno según lo que se juega. Empates con T.
type Props = { amistoso: Amistoso; jornadas: AmistosoJornada[]; resumen: Resumen; miId: string };

// 16/10 (Iñi): en fútbol, la clasificación de un amistoso es EXACTAMENTE la de
// las mesas de siempre (ClasificacionMesaFutbol): equipos a la izquierda,
// jugadores con sus colores a la derecha, desglose de puntos y marcador al
// pulsar, eventos y premios. Con varias jornadas, una pestaña por jornada y
// "Total" con la suma. Golf sigue con la lista.
export default function ClasificacionAmistoso(props: Props) {
  if (props.amistoso.deporte === 'futbol') return <ClasificacionAmistosoFutbol {...props} />;
  return <ListaClasificacionAmistoso {...props} />;
}

function ClasificacionAmistosoFutbol(props: Props) {
  const { amistoso, jornadas, resumen, miId } = props;
  const [equipos, setEquipos] = useState<Equipo[] | null>(null);
  const empezadas = resumen.jornadas.filter((j) => j.empezada).map((j) => j.competicion);
  const porDefecto = empezadas[empezadas.length - 1] ?? jornadas[0]?.competicion ?? 'total';
  const [vista, setVista] = useState<string>(porDefecto);

  useEffect(() => {
    let activo = true;
    async function cargar() {
      const { data } = await supabase.rpc('amistoso_equipos_clasificacion', { p_amistoso: amistoso.id });
      if (activo) setEquipos((data as Equipo[]) ?? []);
    }
    void cargar();
    const parar = cadaXSegundos(cargar, 60);
    return () => {
      activo = false;
      parar();
    };
  }, [amistoso.id]);

  if (empezadas.length === 0 && amistoso.modalidad !== 'draft') {
    return <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>La clasificación aparece cuando empiece la primera jornada. Hasta entonces nadie ve el equipo de los demás.</p>;
  }

  const unido = new Map(resumen.participantes.map((p) => [p.usuario_id, p.unido_en]));
  const deJornada = (comp: string): EquipoExterno[] =>
    (equipos ?? [])
      .filter((e) => e.competicion === comp)
      .map((e) => ({ equipoId: e.usuario_id, nombre: `@${resumen.nombres[e.usuario_id] ?? 'Alguien'}`, jugadores: e.jugadores, createdAt: unido.get(e.usuario_id) ?? '' }));
  const terminada = (comp: string) => resumen.jornadas.find((j) => j.competicion === comp)?.terminada ?? false;
  const premios = <ListaClasificacionAmistoso {...props} vistaInicial="total" sinPestanas />;
  const equiposVista = vista === 'total' ? [] : deJornada(vista);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {jornadas.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {jornadas.map((j) => (
            <button key={j.competicion} type="button" style={S.pill(vista === j.competicion)} onClick={() => setVista(j.competicion)}>
              {j.competicion.replace(/^.* - /, '')}
            </button>
          ))}
          <button type="button" style={S.pill(vista === 'total')} onClick={() => setVista('total')}>
            Total
          </button>
        </div>
      )}
      {vista === 'total' ? (
        <ListaClasificacionAmistoso {...props} vistaInicial="total" sinPestanas />
      ) : equipos === null ? (
        <Cargando compacto />
      ) : (
        <ClasificacionMesaFutbol
          key={vista}
          embebido
          sala={{ id: amistoso.id, nombre: amistoso.nombre, competicion: vista, tipo: 'amistoso', estado: terminada(vista) ? 'finalizada' : 'abierta', buy_in: 0, aforo: amistoso.num_jugadores, fecha_limite_inscripcion: null, tramo: jornadas.find((j) => j.competicion === vista)?.tramo ?? null }}
          externo={{ equipos: equiposVista, misJugadores: equiposVista.find((e) => e.equipoId === miId)?.jugadores ?? [] }}
          premios={premios}
        />
      )}
    </div>
  );
}

function ListaClasificacionAmistoso({ amistoso, jornadas, resumen, miId, vistaInicial = 'total', sinPestanas = false }: Props & { vistaInicial?: string; sinPestanas?: boolean }) {
  const [equipos, setEquipos] = useState<Equipo[]>([]);
  const [jugs, setJugs] = useState<Map<string, Jug>>(new Map());
  const [puntos, setPuntos] = useState<Map<string, number>>(new Map()); // `${competicion}|${jugador}`
  const [vista, setVista] = useState<string>(vistaInicial);
  const [abierto, setAbierto] = useState<string | null>(null);

  const empezadas = resumen.jornadas.filter((j) => j.empezada).map((j) => j.competicion);
  const todasTerminadas = resumen.jornadas.length > 0 && resumen.jornadas.every((j) => j.terminada);
  const hayAlgoEnJuego = empezadas.length > 0 && !todasTerminadas;
  const tabla = amistoso.deporte === 'golf' ? 'golf_puntos_jugador' : 'futbol_puntos_jugador';

  useEffect(() => {
    let activo = true;
    let nombresCargados = new Set<string>();
    async function cargar() {
      // 15/10: por función, para que con "el mismo equipo todas las jornadas"
      // el equipo de la primera se traslade a cada jornada siguiente.
      const { data } = await supabase.rpc('amistoso_equipos_clasificacion', { p_amistoso: amistoso.id });
      const eqs = (data as Equipo[]) ?? [];
      const ids = Array.from(new Set(eqs.flatMap((e) => e.jugadores)));
      const faltan = ids.filter((id) => !nombresCargados.has(id));
      const nuevos: Jug[] = [];
      for (let i = 0; i < faltan.length; i += 200) {
        const { data: js } = await supabase.from('jugadores').select('id,nombre,posicion,equipo_real').in('id', faltan.slice(i, i + 200));
        nuevos.push(...(((js as Jug[]) ?? [])));
      }
      const pts = new Map<string, number>();
      for (const comp of Array.from(new Set(eqs.map((e) => e.competicion)))) {
        const idsComp = Array.from(new Set(eqs.filter((e) => e.competicion === comp).flatMap((e) => e.jugadores)));
        for (let i = 0; i < idsComp.length; i += 200) {
          // 17/10: en una ronda suelta de golf solo cuentan sus puntos.
          const { data: ps } = await supabase.from(tabla).select(tabla === 'golf_puntos_jugador' ? 'jugador_id,puntos_total,por_ronda' : 'jugador_id,puntos_total').eq('competicion', comp).in('jugador_id', idsComp.slice(i, i + 200));
          ((ps as unknown as { jugador_id: string; puntos_total: number; por_ronda?: PorRonda }[]) ?? []).forEach((p) => pts.set(`${comp}|${p.jugador_id}`, puntosGolfTramo(p, tabla === 'golf_puntos_jugador' ? resumen.jornadas.find((j) => j.competicion === comp)?.tramo ?? null : null).total));
        }
      }
      if (!activo) return;
      nombresCargados = new Set([...Array.from(nombresCargados), ...nuevos.map((n) => n.id)]);
      setEquipos(eqs);
      setJugs((prev) => {
        const m = new Map(prev);
        nuevos.forEach((n) => m.set(n.id, n));
        return m;
      });
      setPuntos(pts);
    }
    void cargar();
    const parar = hayAlgoEnJuego ? cadaXSegundos(cargar, 30) : () => {};
    return () => {
      activo = false;
      parar();
    };
  }, [amistoso.id, tabla, hayAlgoEnJuego]);

  const totalEquipo = (e: Equipo) => e.jugadores.reduce((a, id) => a + (puntos.get(`${e.competicion}|${id}`) ?? 0), 0);

  const filas = useMemo(() => {
    const lista = resumen.participantes.map((p) => {
      const suyos = equipos.filter((e) => e.usuario_id === p.usuario_id && (vista === 'total' || e.competicion === vista));
      const total = Math.round(suyos.reduce((a, e) => a + totalEquipo(e), 0) * 100) / 100;
      return { usuarioId: p.usuario_id, total };
    });
    lista.sort((a, b) => b.total - a.total);
    return repartirPremio(lista, vista === 'total' ? amistoso.premio : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumen.participantes, equipos, puntos, vista, amistoso.premio]);

  if (empezadas.length === 0 && amistoso.modalidad !== 'draft') {
    return <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>La clasificación aparece cuando empiece la primera jornada. Hasta entonces nadie ve el equipo de los demás.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontWeight: 800, fontSize: 16, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif" }}>{todasTerminadas ? 'Clasificación final' : 'Clasificación en directo'}</span>
        {hayAlgoEnJuego && <span style={{ fontSize: 10.5, fontWeight: 800, color: '#FF5C5C' }}>● EN DIRECTO</span>}
      </div>
      {jornadas.length > 1 && !sinPestanas && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" style={S.pill(vista === 'total')} onClick={() => setVista('total')}>
            Total
          </button>
          {jornadas.map((j) => (
            <button key={j.competicion} type="button" style={S.pill(vista === j.competicion)} onClick={() => setVista(j.competicion)}>
              {j.competicion.replace(/^.* - /, '')}
            </button>
          ))}
        </div>
      )}
      {amistoso.premio && amistoso.premio.tipo !== 'nada' && vista === 'total' && (
        <span style={{ fontSize: 12, color: S.MUTED_2 }}>
          🏆 {textoBote(amistoso.premio, resumen.participantes.length)}
          {!todasTerminadas && ' · así quedaría el reparto ahora mismo'}
        </span>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filas.map((f) => {
          const yo = f.usuarioId === miId;
          const nombre = resumen.nombres[f.usuarioId] ?? 'Alguien';
          const suyos = equipos.filter((e) => e.usuario_id === f.usuarioId && (vista === 'total' || e.competicion === vista)).sort((a, b) => a.competicion.localeCompare(b.competicion));
          return (
            <motion.div layout key={f.usuarioId} style={{ background: yo ? 'rgba(61,220,132,0.08)' : S.PANEL, border: `1px solid ${yo ? 'rgba(61,220,132,0.35)' : S.CARD_BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
              <button type="button" onClick={() => setAbierto(abierto === f.usuarioId ? null : f.usuarioId)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ width: 36, fontWeight: 800, fontSize: 14, color: f.puesto.replace('T', '') === '1º' ? '#F0B94D' : S.MUTED }}>{f.puesto}</span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontWeight: 700, fontSize: 13.5, color: S.TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{nombre}</span>
                  {f.premioTexto && <span style={{ fontSize: 11.5, color: V2_COLOR, fontWeight: 700 }}>{todasTerminadas ? 'Se lleva' : 'Iría'} {f.premioTexto}</span>}
                  {f.grupo === 'paga' && <span style={{ fontSize: 11.5, color: '#FF8A8A', fontWeight: 700 }}>{todasTerminadas ? 'Paga' : 'Ahora mismo pagaría'} {f.paga}</span>}
                  {f.grupo === 'gana' && <span style={{ fontSize: 11.5, color: S.ACCENT, fontWeight: 700 }}>🏆 {todasTerminadas ? 'Gana' : 'Ahora mismo ganaría'}</span>}
                  {f.grupo === 'nada' && <span style={{ fontSize: 11.5, color: S.MUTED_3, fontWeight: 700 }}>Ni gana ni paga</span>}
                </span>
                <span style={{ fontWeight: 800, fontSize: 15, color: S.TEXT }}>{formatPuntos(f.total)}</span>
                <span style={{ fontSize: 11, color: S.MUTED_3 }}>{abierto === f.usuarioId ? '▲' : '▼'}</span>
              </button>
              {abierto === f.usuarioId && (
                <div style={{ padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {suyos.length === 0 && <span style={{ fontSize: 12, color: S.MUTED_3 }}>Sin equipo {vista === 'total' ? 'todavía' : 'en esta jornada'}.</span>}
                  {suyos.map((e) => (
                    <div key={e.competicion} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {(vista === 'total' && jornadas.length > 1) || e.alineacion ? (
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: '#F0B94D', textTransform: 'uppercase' }}>
                          {jornadas.length > 1 ? e.competicion : ''} {e.alineacion ? `· ${e.alineacion}` : ''}
                        </span>
                      ) : null}
                      {[...e.jugadores]
                        .sort((a, b) => (ORDEN_POS[jugs.get(a)?.posicion ?? ''] ?? 9) - (ORDEN_POS[jugs.get(b)?.posicion ?? ''] ?? 9))
                        .map((id) => {
                          const j = jugs.get(id);
                          const p = puntos.get(`${e.competicion}|${id}`);
                          return (
                            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                              {amistoso.deporte === 'futbol' && <span style={{ width: 30, fontSize: 10, fontWeight: 700, color: S.MUTED_3 }}>{ABREV_POS[j?.posicion ?? ''] ?? ''}</span>}
                              <span style={{ flex: 1, color: S.TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {j?.nombre ?? '...'}
                                {j?.equipo_real && amistoso.deporte === 'futbol' ? <span style={{ color: S.MUTED_3 }}> · {j.equipo_real}</span> : null}
                              </span>
                              <span style={{ fontWeight: 700, color: p === undefined ? S.FAINT : S.TEXT }}>{p === undefined ? '–' : formatPuntos(p)}</span>
                            </div>
                          );
                        })}
                      <span style={{ fontSize: 11.5, color: S.MUTED_2, alignSelf: 'flex-end' }}>Total: {formatPuntos(totalEquipo(e))}</span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
      <span style={{ fontSize: 11, color: S.MUTED_3 }}>Puntos con las mismas reglas que las mesas de siempre. Drafters no cobra ni paga nada en los amistosos.</span>
    </div>
  );
}
