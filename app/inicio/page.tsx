'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { formatEuros } from '@/lib/salaShared';

const ACCENT = '#3DDC84';
const PORRAS_COLOR = '#FF7A45';

// ============================================================================
// PANTALLA DE INICIO — rediseñada (27/09, undécima vuelta)
// ============================================================================
// Iñi, 27/09 (tras cerrar el tema del vídeo): "vamos a darle una vuelta a
// la pantalla de inicio... la parte de arriba donde seguimos viendo los
// equipos que tienes hechos o te da la opción de crear tu propio equipo,
// la mantenemos igual. Y debajo, lo único que se va a ver van a ser dos
// recuadros... el de la izquierda Mesas Drafters, el de la derecha Porras
// clásicas de golf." Se mantiene intacta la cabecera + bienvenida + "mis
// equipos en juego" (con aviso de lesionado y acceso a "clasificación en
// directo", ahora también para equipos de porra — ver más abajo); todo lo
// que antes iba debajo (selector de deporte, Grandes torneos, Cierran
// pronto, y el vídeo publicitario de prueba) se ha movido a /mesas, que
// pasa a ser la landing de "Mesas Drafters" — el vídeo publicitario del
// feed de inicio se ha quitado sin más, tal y como pidió Iñi ("lo único
// que se va a ver van a ser dos recuadros").
//
// Mesas Drafters lleva a /mesas (todo lo construido hasta ahora, sin
// porras); Porras clásicas de golf lleva a /porras (nueva pantalla índice,
// antes una pestaña dentro de /mesas).

type EquipoFila = {
  id: string;
  modo: string;
  sala_id: string | null;
  porra_id: string | null;
  nombre_equipo: string | null;
  jugadores: string[];
  gasto_total: number;
  salas: { id: string; nombre: string; competicion: string; deporte: string; estado: string; tipo: string } | null;
  porras: { id: string; major: string; estado: string; competicion: string | null; fecha_limite_inscripcion: string | null } | null;
  inscripciones: { estado: string }[];
};

export default function InicioPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [equipos, setEquipos] = useState<EquipoFila[]>([]);
  const [lesionMap, setLesionMap] = useState<Map<string, { nombre: string; lesionado: boolean; baja: boolean }>>(new Map());
  const [cargando, setCargando] = useState(true);
  // "Mostrar más/menos" en "mis equipos en juego" (28/09, pedido de Iñi:
  // con muchos equipos a la vez la lista se hacía muy larga y empujaba los
  // recuadros de Mesas Drafters/Porras muy abajo) — se ven los 3 primeros
  // de entrada y el resto queda detrás de un botón, con su contrario para
  // volver a colapsar la lista.
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const LIMITE_EQUIPOS_VISIBLE = 3;
  // Pestañas "Finalizadas" / "En juego" encima de la lista (05/10, pedido de
  // Iñi): primera pestaña (izquierda) = porras y mesas finalizadas, segunda =
  // en juego, y por defecto se ve "En juego".
  const [pestanaEquipos, setPestanaEquipos] = useState<'finalizadas' | 'en_juego'>('en_juego');

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

      const [{ data: perfilData }, { data: equiposData }] = await Promise.all([
        supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
        supabase
          .from('equipos')
          .select(
            'id, modo, sala_id, porra_id, nombre_equipo, jugadores, gasto_total, salas(id,nombre,competicion,deporte,estado,tipo), porras(id,major,estado,competicion,fecha_limite_inscripcion), inscripciones(estado)'
          )
          .eq('usuario_id', session.user.id)
          .order('created_at', { ascending: false }),
      ]);

      if (!activo) return;

      if (perfilData) setPerfil(perfilData as Perfil);

      const misEquipos = ((equiposData as unknown as EquipoFila[]) ?? []).filter((eq) =>
        eq.inscripciones.some((i) => i.estado !== 'reembolsada')
      );
      setEquipos(misEquipos);

      const idsJugadores = Array.from(new Set(misEquipos.flatMap((eq) => eq.jugadores ?? [])));
      if (idsJugadores.length > 0) {
        const { data: jugData } = await supabase.from('jugadores').select('id,nombre,lesionado,baja').in('id', idsJugadores);
        const mapa = new Map<string, { nombre: string; lesionado: boolean; baja: boolean }>();
        (jugData ?? []).forEach((j) => mapa.set(j.id, { nombre: j.nombre as string, lesionado: j.lesionado as boolean, baja: !!j.baja }));
        if (activo) setLesionMap(mapa);
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

  const saldoLabel = formatEuros(perfil.saldo_simulado);
  const initials = S.iniciales(perfil.nombre, perfil.apellido);

  function lesionadoDe(eq: EquipoFila): string | null {
    for (const id of eq.jugadores ?? []) {
      const j = lesionMap.get(id);
      if (j?.baja) return `${j.nombre} no va a jugar`;
      if (j?.lesionado) return `${j.nombre} está lesionado`;
    }
    return null;
  }

  const estaFinalizado = (eq: EquipoFila) => eq.salas?.estado === 'finalizada' || eq.porras?.estado === 'finalizada';
  const equiposFinalizados = equipos.filter(estaFinalizado);
  const equiposEnJuego = equipos.filter((eq) => !estaFinalizado(eq));
  const equiposPestana = pestanaEquipos === 'finalizadas' ? equiposFinalizados : equiposEnJuego;

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '40px 20px 56px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: S.TEXT }}>¡Bienvenido, {perfil.nombre}!</h1>
            <p style={{ fontSize: 14, color: S.MUTED }}>
              {equipos.length === 0 ? 'Tu cuenta está verificada. Vamos a crear tu primer equipo.' : 'Esto es lo que tienes en juego ahora mismo.'}
            </p>
          </div>

          {equipos.length === 0 && (
            <div
              style={{
                background: S.PANEL,
                border: `1px solid ${S.CARD_BORDER}`,
                borderRadius: 16,
                padding: 24,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: 12,
              }}
            >
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="1.6">
                <path d="M8 21h8" strokeLinecap="round" />
                <path d="M12 17v4" strokeLinecap="round" />
                <path d="M6 4h12v3a6 6 0 0 1-12 0V4Z" strokeLinejoin="round" />
                <path d="M6 5H3v1a4 4 0 0 0 4 4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M18 5h3v1a4 4 0 0 1-4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, color: S.TEXT }}>
                Todavía no tienes ningún equipo
              </span>
              <span style={{ fontSize: 13, lineHeight: 1.5, color: S.MUTED_2 }}>
                Crea tu equipo para unirte a tu primera liga de fútbol, golf o tenis.
              </span>
              <Link href="/mesas" style={{ ...S.primaryButton, marginTop: 6, textAlign: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                Crear mi equipo
              </Link>
            </div>
          )}

          {equipos.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-start' }}>
                <button type="button" onClick={() => { setPestanaEquipos('finalizadas'); setMostrarTodos(false); }} style={S.pill(pestanaEquipos === 'finalizadas')}>
                  Finalizadas ({equiposFinalizados.length})
                </button>
                <button type="button" onClick={() => { setPestanaEquipos('en_juego'); setMostrarTodos(false); }} style={S.pill(pestanaEquipos === 'en_juego')}>
                  En juego ({equiposEnJuego.length})
                </button>
              </div>
              {equiposPestana.length === 0 && (
                <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>
                  {pestanaEquipos === 'finalizadas' ? 'Todavía no tienes ninguna porra ni mesa finalizada.' : 'No tienes ninguna porra ni mesa en juego ahora mismo.'}
                </p>
              )}
              {(mostrarTodos ? equiposPestana : equiposPestana.slice(0, LIMITE_EQUIPOS_VISIBLE)).map((eq) => {
                const competicionLabel = eq.salas?.competicion ?? eq.porras?.competicion ?? eq.porras?.major ?? '';
                const salaNombre = eq.salas?.nombre ?? (eq.porras ? `Porra · ${eq.porras.major}` : eq.nombre_equipo ?? 'Mi equipo');
                const href = eq.salas ? `/salas/${eq.sala_id}` : eq.porras ? `/porras/${eq.porra_id}` : '#';
                const porraEmpezada =
                  !!eq.porras &&
                  (eq.porras.estado === 'finalizada' ||
                    (!!eq.porras.fecha_limite_inscripcion && new Date(eq.porras.fecha_limite_inscripcion).getTime() <= Date.now()));
                const clasificacionHref = eq.salas ? `/salas/${eq.sala_id}/clasificacion` : eq.porras ? `/porras/${eq.porra_id}/clasificacion` : '#';
                const esFinalizadoEq = estaFinalizado(eq);
                const enDirecto = eq.salas?.estado === 'completa' || porraEmpezada;
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
                          {competicionLabel}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {salaNombre}
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
                            background: ACCENT,
                            borderRadius: 8,
                            padding: '8px 12px',
                            whiteSpace: 'nowrap',
                            textDecoration: 'none',
                          }}
                        >
                          Ver mi equipo
                        </Link>
                        {(enDirecto || esFinalizadoEq) && (
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
                            {esFinalizadoEq ? 'Clasificación final' : 'Clasificación en directo'}
                          </Link>
                        )}
                      </div>
                    </div>
                    {lesionado && !esFinalizadoEq && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px' }}>
                        <span style={{ flexShrink: 0, width: 13, height: 13, borderRadius: '50%', background: '#FF5C5C' }} />
                        <span style={{ fontSize: 11, color: '#FF5C5C', fontWeight: 600 }}>{lesionado}. Haz un cambio.</span>
                      </div>
                    )}
                  </div>
                );
              })}
              {equiposPestana.length > LIMITE_EQUIPOS_VISIBLE && (
                <button
                  type="button"
                  onClick={() => setMostrarTodos((v) => !v)}
                  style={{
                    alignSelf: 'center',
                    marginTop: 2,
                    background: 'transparent',
                    border: 'none',
                    color: ACCENT,
                    fontFamily: "'Manrope', sans-serif",
                    fontWeight: 700,
                    fontSize: 12.5,
                    cursor: 'pointer',
                    padding: '6px 10px',
                  }}
                >
                  {mostrarTodos ? 'Mostrar menos ▴' : `Mostrar más (${equiposPestana.length - LIMITE_EQUIPOS_VISIBLE}) ▾`}
                </button>
              )}
            </div>
          )}

          {/* Los dos únicos recuadros de más abajo (pedido de Iñi, 27/09):
              izquierda = Mesas Drafters (todo lo construido hasta ahora,
              salas + maratón, sin porras), derecha = Porras clásicas de
              golf. Ocupan cada uno la mitad del ancho, con bastante alto
              para que sean lo único que se vea debajo de "mis equipos". */}
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <Link
              href="/mesas"
              style={{
                flex: 1,
                minWidth: 0,
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                height: 240,
                borderRadius: 18,
                overflow: 'hidden',
                border: `1px solid rgba(61,220,132,0.35)`,
                background: 'linear-gradient(135deg, #0B2318 0%, #0F3320 55%, #12452A 100%)',
                padding: '18px 16px',
                textDecoration: 'none',
              }}
            >
              <span
                style={{
                  fontFamily: "'Barlow Condensed', sans-serif",
                  fontWeight: 800,
                  fontStyle: 'italic',
                  fontSize: 26,
                  lineHeight: 1.05,
                  color: ACCENT,
                  textShadow: '0 3px 0 rgba(0,0,0,0.45), 0 6px 16px rgba(0,0,0,0.55)',
                }}
              >
                MESAS
                <br />
                DRAFTERS
              </span>
              <span style={{ marginTop: 8, fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 12, color: 'rgba(245,247,245,0.75)' }}>
                Fútbol, golf y tenis. Salas, maratón y draft de fantasía.
              </span>
            </Link>

            <Link
              href="/porras"
              style={{
                flex: 1,
                minWidth: 0,
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                height: 240,
                borderRadius: 18,
                overflow: 'hidden',
                border: `1px solid rgba(255,122,69,0.35)`,
                background: 'linear-gradient(135deg, #241505 0%, #3B230A 55%, #4A2A0A 100%)',
                padding: '18px 16px',
                textDecoration: 'none',
              }}
            >
              <span
                style={{
                  fontFamily: "'Barlow Condensed', sans-serif",
                  fontWeight: 800,
                  fontStyle: 'italic',
                  fontSize: 26,
                  lineHeight: 1.05,
                  color: PORRAS_COLOR,
                  textShadow: '0 3px 0 rgba(0,0,0,0.45), 0 6px 16px rgba(0,0,0,0.55)',
                }}
              >
                PORRAS
                <br />
                CLÁSICAS DE GOLF
              </span>
              <span style={{ marginTop: 8, fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 12, color: 'rgba(245,247,245,0.75)' }}>
                La porra de toda la vida: elige tu equipo por grupos.
              </span>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
