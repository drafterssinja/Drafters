'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import AnuncioVideoInline from '@/components/AnuncioVideoInline';
import * as S from '@/lib/mockupStyles';
import {
  DEPORTES,
  Deporte,
  DEPORTE_LABELS,
  TIPO_SALA_LABELS,
  formatEuros,
  estadoSalaInfo,
  closesAtLabel,
  capacidadLabel,
} from '@/lib/salaShared';
import type { TipoSala } from '@/lib/repartoPremios';

// ============================================================================
// MESAS DRAFTERS (27/09, undécima vuelta) — antes "Grandes torneos"
// ============================================================================
// Iñi (27/09): al dividir la pantalla de inicio en dos recuadros ("Mesas
// Drafters" a la izquierda, "Porras clásicas de golf" a la derecha —
// app/inicio/page.tsx), pidió dejar todo lo de Mesas Drafters "tal como lo
// teníamos". Esta pantalla pasa a ser esa landing: reúne el selector de
// deporte y "Cierran pronto" que antes vivían en /inicio, más el Maratón
// que ya vivía aquí — la pestaña de Porras clásicas se ha quitado de esta
// pantalla porque ahora tiene su propia landing en /porras (enlazada desde
// el otro recuadro de /inicio), tal y como pidió Iñi.
//
// 28/09: Iñi pidió recuperar aquí, arriba del todo, el listado de "tus
// mesas en juego" (solo mesas — a propósito NUNCA porras, aunque el
// usuario también tenga equipos de porra: esas se gestionan y se ven desde
// /porras) y, debajo, el hueco de vídeo publicitario que antes vivía en el
// feed de /inicio — ver AnuncioVideoInline y drafters-schema.sql
// (mostrar_en_mesas). El selector de deporte pasa a ir después de los dos.

type SalaFila = {
  id: string;
  nombre: string;
  competicion: string;
  deporte: string;
  tipo: string;
  aforo: number | null;
  buy_in: number;
  estado: string;
  fecha_limite_inscripcion: string | null;
};

type MaratonFila = {
  id: string;
  nombre: string;
  competicion: string;
  deporte: string;
  buy_in: number;
  estado: string;
  fecha_limite_inscripcion: string | null;
};

// Solo mesas (modo 'sala'/'mtt') — a propósito, nunca equipos de porra, que
// se gestionan desde /porras (pedido de Iñi, 28/09).
type EquipoMesaFila = {
  id: string;
  sala_id: string;
  nombre_equipo: string | null;
  jugadores: string[];
  salas: { id: string; nombre: string; competicion: string; deporte: string; estado: string; tipo: string } | null;
  inscripciones: { estado: string }[];
};

function MesasPageInner() {
  const router = useRouter();
  const [deporte, setDeporte] = useState<Deporte>('futbol');

  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [salasAbiertas, setSalasAbiertas] = useState<SalaFila[]>([]);
  const [maratones, setMaratones] = useState<MaratonFila[]>([]);
  const [inscritosPorSala, setInscritosPorSala] = useState<Map<string, number>>(new Map());
  const [misMesas, setMisMesas] = useState<EquipoMesaFila[]>([]);
  const [lesionMap, setLesionMap] = useState<Map<string, { nombre: string; lesionado: boolean }>>(new Map());
  const [cargando, setCargando] = useState(true);
  // Maratones finalizados (04/10, corrección de Iñi): no se ven de primeras
  // al entrar — se quedan plegados detrás de un desplegable, que empieza
  // cerrado.

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

      const [{ data: perfilData }, { data: salasData }, { data: maratonData }, { data: inscritosData }, { data: equiposData }] = await Promise.all([
        supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
        supabase
          .from('salas')
          .select('id,nombre,competicion,deporte,tipo,aforo,buy_in,estado,fecha_limite_inscripcion')
          .neq('tipo', 'maraton')
          .neq('estado', 'finalizada'),
        // CAMBIO 04/10 (pedido de Iñi): a diferencia de la consulta de
        // arriba (salasAbiertas — esa sí sigue excluyendo las finalizadas,
        // porque solo se usa para contar "salas abiertas" y para "cierran
        // pronto"), aquí NO se excluyen: los Maratones finalizados se
        // quedan accesibles detrás de un desplegable que empieza cerrado
        // (ver mostrarMaratonesFinalizados más abajo), con el botón
        // "Clasificación final" en vez de "Clasificación en directo".
        supabase.from('salas').select('id,nombre,competicion,deporte,buy_in,estado,fecha_limite_inscripcion').eq('tipo', 'maraton'),
        // inscritos_por_sala() es una función de base de datos (RPC) — hace
        // falta porque equipos/inscripciones tienen RLS que solo deja ver
        // las filas propias de cada usuario, pero el número de inscritos de
        // cada sala sí es un dato público. Ver drafters-schema.sql.
        supabase.rpc('inscritos_por_sala'),
        // "Tus mesas en juego" (28/09) — solo modo 'sala'/'mtt', nunca
        // 'porra' (esas viven en /porras, no aquí).
        supabase
          .from('equipos')
          .select('id, sala_id, nombre_equipo, jugadores, salas(id,nombre,competicion,deporte,estado,tipo), inscripciones(estado)')
          .eq('usuario_id', session.user.id)
          .neq('modo', 'porra')
          .order('created_at', { ascending: false }),
      ]);

      if (!activo) return;

      if (perfilData) setPerfil(perfilData as Perfil);
      setSalasAbiertas((salasData as SalaFila[]) ?? []);
      setMaratones((maratonData as MaratonFila[]) ?? []);

      const mapaInscritos = new Map<string, number>();
      ((inscritosData as { sala_id: string; inscritos: number }[]) ?? []).forEach((fila) => mapaInscritos.set(fila.sala_id, Number(fila.inscritos)));
      setInscritosPorSala(mapaInscritos);

      const mesas = ((equiposData as unknown as EquipoMesaFila[]) ?? []).filter((eq) => eq.inscripciones.some((i) => i.estado !== 'reembolsada'));
      setMisMesas(mesas);

      const idsJugadores = Array.from(new Set(mesas.flatMap((eq) => eq.jugadores ?? [])));
      if (idsJugadores.length > 0) {
        const { data: jugData } = await supabase.from('jugadores').select('id,nombre,lesionado').in('id', idsJugadores);
        const mapaLesion = new Map<string, { nombre: string; lesionado: boolean }>();
        (jugData ?? []).forEach((j) => mapaLesion.set(j.id, { nombre: j.nombre as string, lesionado: j.lesionado as boolean }));
        if (activo) setLesionMap(mapaLesion);
      }

      setCargando(false);
    }

    cargar();
    return () => {
      activo = false;
    };
  }, [router]);

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

  const conteoPorDeporte: Record<string, number> = {};
  DEPORTES.forEach((d) => {
    conteoPorDeporte[d] = salasAbiertas.filter((s) => s.deporte === d).length;
  });

  // Activos primero, finalizados aparte (ver mostrarMaratonesFinalizados) —
  // mismo criterio que porrasActivas/porrasFinalizadas en app/porras/page.tsx.
  const maratonesDelDeporte = maratones
    .filter((m) => m.deporte === deporte && m.estado !== 'finalizada')
    .slice()
    .sort((a, b) => {
      const da = a.fecha_limite_inscripcion ? new Date(a.fecha_limite_inscripcion).getTime() : Infinity;
      const db = b.fecha_limite_inscripcion ? new Date(b.fecha_limite_inscripcion).getTime() : Infinity;
      return da - db;
    });

  const maratonesFinalizadosDelDeporte = maratones
    .filter((m) => m.deporte === deporte && m.estado === 'finalizada')
    .slice()
    .sort((a, b) => {
      const da = a.fecha_limite_inscripcion ? new Date(a.fecha_limite_inscripcion).getTime() : 0;
      const db = b.fecha_limite_inscripcion ? new Date(b.fecha_limite_inscripcion).getTime() : 0;
      return db - da;
    });

  const cierranPronto = salasAbiertas
    .filter((s) => s.fecha_limite_inscripcion && closesAtLabel(s.fecha_limite_inscripcion))
    .sort((a, b) => new Date(a.fecha_limite_inscripcion!).getTime() - new Date(b.fecha_limite_inscripcion!).getTime())
    .slice(0, 6);

  // Tarjeta de un Maratón (extraída a función — mismo motivo que
  // tarjetaPorra() en app/porras/page.tsx: se usa tanto en la lista de
  // activos como en la de finalizados, con el mismo diseño, cambiando solo
  // el botón).
  function tarjetaMaraton(m: MaratonFila) {
    const signedUp = inscritosPorSala.get(m.id) ?? 0;
    const estadoInfo = estadoSalaInfo(m.estado, null, signedUp);
    const cierra = closesAtLabel(m.fecha_limite_inscripcion);
    // Empezada (03/10, pedido de Iñi, mismo criterio que en
    // app/porras/page.tsx y app/salas/page.tsx): la fecha
    // límite ya ha pasado.
    const empezada = !!m.fecha_limite_inscripcion && new Date(m.fecha_limite_inscripcion).getTime() <= Date.now();
    const esFinalizado = m.estado === 'finalizada';
    const mostrarBotonClasificacion = esFinalizado || (!cierra && empezada);
    const textoBotonClasificacion = esFinalizado ? 'Clasificación final' : 'Clasificación en directo';
    return (
      <div
        key={m.id}
        onClick={() => router.push(`/salas/${m.id}`)}
        style={{ background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color: S.TEXT }}>{m.nombre}</span>
          {cierra && (
            <span
              style={{
                flexShrink: 0,
                fontFamily: "'Manrope', sans-serif",
                fontWeight: 700,
                fontSize: 11,
                color: '#FF9F6E',
                background: 'rgba(255,159,110,0.12)',
                padding: '4px 8px',
                borderRadius: 999,
                whiteSpace: 'nowrap',
              }}
            >
              Cierra el {cierra}
            </span>
          )}
        </div>
        {/* FIX 04/10 (mismo aviso de Iñi que en app/porras/page.tsx
            — el botón se salía de la pantalla con nombres
            largos de Maratón): se mueve a su propia fila, igual
            que ya funcionaba bien en app/salas/page.tsx. */}
        {mostrarBotonClasificacion && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/salas/${m.id}/clasificacion`);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontFamily: "'Barlow Condensed', sans-serif",
                fontWeight: 700,
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
                color: '#FF7A45',
                background: 'rgba(255,122,69,0.14)',
                border: '1px solid rgba(255,122,69,0.45)',
                borderRadius: 8,
                padding: '6px 10px',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#FF7A45', flexShrink: 0 }} />
              {textoBotonClasificacion}
            </button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontFamily: "'Manrope', sans-serif",
              fontWeight: 700,
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: '#F0B94D',
              background: 'rgba(240,185,77,0.12)',
              border: '1px solid rgba(240,185,77,0.3)',
              borderRadius: 6,
              padding: '3px 7px',
            }}
          >
            {m.competicion}
          </span>
          <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: S.MUTED_2, background: '#1B2420', border: '1px solid #22302B', borderRadius: 6, padding: '3px 7px' }}>
            {formatEuros(m.buy_in)}
          </span>
          <span style={{ fontSize: 12, color: estadoInfo.color }}>{estadoInfo.label}</span>
        </div>
      </div>
    );
  }

  function lesionadoDe(eq: EquipoMesaFila): string | null {
    for (const id of eq.jugadores ?? []) {
      const j = lesionMap.get(id);
      if (j?.lesionado) return j.nombre;
    }
    return null;
  }

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={formatEuros(perfil.saldo_simulado)} accountInitials={S.iniciales(perfil.nombre, perfil.apellido)} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '32px 20px 56px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: S.TEXT }}>Mesas Drafters</h1>
            <p style={{ fontSize: 13, color: S.MUTED_2 }}>Fútbol, golf y tenis — salas, maratón y draft de fantasía.</p>
          </div>

          {misMesas.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: S.TEXT }}>Tus mesas en juego.</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {misMesas.map((eq) => {
                  const sala = eq.salas;
                  const nombre = sala?.nombre ?? eq.nombre_equipo ?? 'Mi equipo';
                  const href = sala ? `/salas/${eq.sala_id}` : '#';
                  const clasificacionHref = sala ? `/salas/${eq.sala_id}/clasificacion` : '#';
                  const enDirecto = sala?.estado === 'completa';
                  const lesionado = lesionadoDe(eq);
                  return (
                    <div key={eq.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 10,
                          background: S.PANEL,
                          border: `1px solid ${S.CARD_BORDER}`,
                          borderRadius: 12,
                          padding: '12px 14px',
                        }}
                      >
                        <Link href={href} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1, textDecoration: 'none' }}>
                          <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#F0B94D' }}>
                            {sala?.competicion ?? ''}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {nombre}
                          </span>
                        </Link>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                          <Link
                            href={href}
                            style={{
                              fontFamily: "'Barlow Condensed', sans-serif",
                              fontWeight: 700,
                              fontSize: 12,
                              textTransform: 'uppercase',
                              letterSpacing: '0.03em',
                              color: '#04140B',
                              background: '#3DDC84',
                              borderRadius: 8,
                              padding: '8px 12px',
                              whiteSpace: 'nowrap',
                              textDecoration: 'none',
                            }}
                          >
                            Ver mi equipo
                          </Link>
                          {enDirecto && (
                            <Link
                              href={clasificacionHref}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                fontFamily: "'Barlow Condensed', sans-serif",
                                fontWeight: 700,
                                fontSize: 11,
                                textTransform: 'uppercase',
                                letterSpacing: '0.03em',
                                color: '#FF7A45',
                                background: 'rgba(255,122,69,0.14)',
                                border: '1px solid rgba(255,122,69,0.45)',
                                borderRadius: 8,
                                padding: '6px 10px',
                                whiteSpace: 'nowrap',
                                textDecoration: 'none',
                              }}
                            >
                              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#FF7A45', flexShrink: 0 }} />
                              Clasificación en directo
                            </Link>
                          )}
                        </div>
                      </div>
                      {lesionado && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px' }}>
                          <span style={{ flexShrink: 0, width: 13, height: 13, borderRadius: '50%', background: '#FF5C5C' }} />
                          <span style={{ fontSize: 11, color: '#FF5C5C', fontWeight: 600 }}>{lesionado} está lesionado. Haz un cambio.</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <AnuncioVideoInline ubicacion="mesas" />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: S.TEXT }}>Elige tu deporte.</h2>

            <Link
              href="/salas?deporte=futbol"
              style={{
                position: 'relative',
                display: 'block',
                height: 138,
                borderRadius: 18,
                overflow: 'hidden',
                border: '1px solid rgba(61,220,132,0.35)',
                background: 'linear-gradient(135deg, #0B2318 0%, #0F3320 55%, #12452A 100%)',
                textDecoration: 'none',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 14,
                  background: 'rgba(6,10,8,0.55)',
                  border: '1px solid rgba(255,255,255,0.14)',
                  borderRadius: 999,
                  padding: '4px 10px',
                  fontFamily: "'Manrope', sans-serif",
                  fontWeight: 700,
                  fontSize: 11,
                  color: '#EAF7EE',
                }}
              >
                {conteoPorDeporte.futbol} salas abiertas
              </div>
              <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '16px 20px' }}>
                <span
                  style={{
                    fontFamily: "'Barlow Condensed', sans-serif",
                    fontWeight: 800,
                    fontStyle: 'italic',
                    fontSize: 38,
                    lineHeight: 1,
                    color: '#3DDC84',
                    textShadow: '0 3px 0 rgba(0,0,0,0.45), 0 6px 16px rgba(0,0,0,0.55)',
                  }}
                >
                  FÚTBOL
                </span>
                <span style={{ marginTop: 4, fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 12, color: 'rgba(245,247,245,0.75)' }}>
                  Puntuación jugada a jugada
                </span>
              </div>
            </Link>

            <Link
              href="/salas?deporte=golf"
              style={{
                position: 'relative',
                display: 'block',
                height: 138,
                borderRadius: 18,
                overflow: 'hidden',
                border: '1px solid rgba(255,122,69,0.35)',
                background: 'linear-gradient(135deg, #241505 0%, #3B230A 55%, #4A2A0A 100%)',
                textDecoration: 'none',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 14,
                  background: 'rgba(10,7,3,0.55)',
                  border: '1px solid rgba(255,255,255,0.14)',
                  borderRadius: 999,
                  padding: '4px 10px',
                  fontFamily: "'Manrope', sans-serif",
                  fontWeight: 700,
                  fontSize: 11,
                  color: '#FCEEE3',
                }}
              >
                {conteoPorDeporte.golf} salas abiertas
              </div>
              <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '16px 20px' }}>
                <span
                  style={{
                    fontFamily: "'Barlow Condensed', sans-serif",
                    fontWeight: 800,
                    fontStyle: 'italic',
                    fontSize: 38,
                    lineHeight: 1,
                    color: '#FF7A45',
                    textShadow: '0 3px 0 rgba(0,0,0,0.45), 0 6px 16px rgba(0,0,0,0.55)',
                  }}
                >
                  GOLF
                </span>
                <span style={{ marginTop: 4, fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 12, color: 'rgba(245,247,245,0.75)' }}>
                  Golpe a golpe, hoyo a hoyo
                </span>
              </div>
            </Link>

            <Link
              href="/salas?deporte=tenis"
              style={{
                position: 'relative',
                display: 'block',
                height: 138,
                borderRadius: 18,
                overflow: 'hidden',
                border: '1px solid rgba(215,255,61,0.35)',
                background: 'linear-gradient(135deg, #141607 0%, #1E2408 55%, #263109 100%)',
                textDecoration: 'none',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 14,
                  background: 'rgba(9,11,4,0.55)',
                  border: '1px solid rgba(255,255,255,0.14)',
                  borderRadius: 999,
                  padding: '4px 10px',
                  fontFamily: "'Manrope', sans-serif",
                  fontWeight: 700,
                  fontSize: 11,
                  color: '#F3FADD',
                }}
              >
                {conteoPorDeporte.tenis} salas abiertas
              </div>
              <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '16px 20px' }}>
                <span
                  style={{
                    fontFamily: "'Barlow Condensed', sans-serif",
                    fontWeight: 800,
                    fontStyle: 'italic',
                    fontSize: 38,
                    lineHeight: 1,
                    color: '#D7FF3D',
                    textShadow: '0 3px 0 rgba(0,0,0,0.45), 0 6px 16px rgba(0,0,0,0.55)',
                  }}
                >
                  TENIS
                </span>
                <span style={{ marginTop: 4, fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 12, color: 'rgba(245,247,245,0.75)' }}>
                  Punto a punto, set a set
                </span>
              </div>
            </Link>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: S.TEXT }}>Maratón.</h2>
              <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>Un único bote acumulado por torneo o jornada. Sin límite de inscritos.</p>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {DEPORTES.map((d) => (
                <button key={d} type="button" onClick={() => setDeporte(d)} style={pillStyle(deporte === d)}>
                  {DEPORTE_LABELS[d]}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {maratonesDelDeporte.length === 0 && <p style={{ fontSize: 13, color: S.MUTED_2 }}>No hay ningún Maratón abierto de {DEPORTE_LABELS[deporte].toLowerCase()} ahora mismo.</p>}
              {maratonesDelDeporte.map((m) => tarjetaMaraton(m))}
              {/* CAMBIO 04/10 (corrección de Iñi): al entrar, los Maratones
                  finalizados NO se ven — se quedan detrás de un desplegable
                  que empieza cerrado, con el botón "Clasificación final" en
                  vez de "Clasificación en directo" — ver tarjetaMaraton()
                  más arriba. */}
              {maratonesFinalizadosDelDeporte.length > 0 && (
                <div style={{ marginTop: 2, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* 05/10 (corrección de Iñi): los finalizados ya no van
                      ocultos tras un desplegable — se ven siempre, debajo
                      de todos los abiertos. */}
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>
                    Finalizados ({maratonesFinalizadosDelDeporte.length})
                  </span>
                  {maratonesFinalizadosDelDeporte.map((m) => tarjetaMaraton(m))}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: S.TEXT }}>Cierran pronto.</h2>
              <Link href="/salas" style={{ fontSize: 13, fontWeight: 600, color: S.TEXT }}>
                Ver todas
              </Link>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {cierranPronto.length === 0 && <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>No hay ninguna sala a punto de cerrar ahora mismo.</p>}
              {cierranPronto.map((sala) => {
                const signedUp = inscritosPorSala.get(sala.id) ?? 0;
                const estadoInfo = estadoSalaInfo(sala.estado, sala.aforo, signedUp);
                const juegoLabel = TIPO_SALA_LABELS[sala.tipo as TipoSala] ?? sala.tipo;
                return (
                  <Link
                    key={sala.id}
                    href={`/salas/${sala.id}`}
                    style={{
                      background: S.PANEL,
                      border: '1px solid #1E2723',
                      borderRadius: 10,
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      textDecoration: 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ flex: 1, minWidth: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color: S.TEXT }}>{sala.nombre}</span>
                      <span
                        style={{
                          flexShrink: 0,
                          fontFamily: "'Manrope', sans-serif",
                          fontWeight: 700,
                          fontSize: 10,
                          textTransform: 'uppercase',
                          letterSpacing: '0.03em',
                          color: '#F0B94D',
                          background: 'rgba(240,185,77,0.12)',
                          border: '1px solid rgba(240,185,77,0.3)',
                          borderRadius: 999,
                          padding: '3px 8px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {sala.competicion}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: estadoInfo.color }}>{estadoInfo.label}</span>
                      <span style={{ flexShrink: 0, width: 84, textAlign: 'center', fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 10.5, lineHeight: 1.2, color: S.MUTED_2 }}>{juegoLabel}</span>
                      <span style={{ flexShrink: 0, width: 42, textAlign: 'center', fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12, color: S.MUTED }}>
                        {signedUp}/{capacidadLabel(sala.aforo)}
                      </span>
                      <span style={{ flexShrink: 0, width: 58, textAlign: 'right', fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 13, color: '#F0B94D' }}>{formatEuros(sala.buy_in)}</span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#FF9F6E' }}>Cierra el {closesAtLabel(sala.fecha_limite_inscripcion)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function pillStyle(active: boolean) {
  return {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 700,
    fontSize: 14,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
    padding: '9px 16px',
    borderRadius: 999,
    border: `1px solid ${active ? '#3DDC84' : S.BORDER}`,
    background: active ? 'rgba(61,220,132,0.12)' : 'transparent',
    color: active ? '#3DDC84' : S.MUTED,
    cursor: 'pointer',
  };
}

export default function MesasPage() {
  return (
    <Suspense fallback={null}>
      <MesasPageInner />
    </Suspense>
  );
}
