'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { calcularReparto } from '@/lib/repartoPremios';
import type { TipoSala } from '@/lib/repartoPremios';
import {
  DEPORTE_LABELS,
  TIPO_SALA_LABELS,
  formatEuros,
  estadoSalaInfo,
  capacidadLabel,
  posicionLabel,
  inicialesJugador,
  huecosPorLinea,
  lineaDePosicion,
  closesInLabel,
  parteParaPremios,
  parteComision,
  numeroRomano,
  type LineaFutbol,
} from '@/lib/salaShared';

// ============================================================================
// DETALLE DE SALA (isSalaDetalle de Main.dc.html, líneas 634-880)
// ============================================================================
// Mismas 4 pestañas de la maqueta (Mi equipo / Información / Premios /
// Jugadores), mismo campo de fútbol con las 4 líneas DEL/MED/DEF/POR para
// fútbol y lista plana para golf/tenis, mismo banner "sala completa" y
// mismo botón de unirse sticky abajo.

type SalaRow = {
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

type EquipoMio = {
  id: string;
  nombre_equipo: string | null;
  jugadores: string[];
  alineacion: string | null;
  gasto_total: number;
  created_at: string;
};

type JugadorRow = { id: string; nombre: string; posicion: string | null; precio: number; lesionado: boolean };

type ParticipanteRow = { equipoId: string; nombre: string; createdAt: string };

type Tab = 'equipo' | 'info' | 'premios' | 'jugadores';

const AVATAR_POR_LINEA: Record<LineaFutbol, string> = { POR: '#FF7A45', DEF: '#8FB6FF', MED: '#F0B94D', DEL: '#3DDC84' };

export default function SalaDetallePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const salaId = params.id;

  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [sala, setSala] = useState<SalaRow | null>(null);
  // Antes era un único equipo (equipoMio). En Maratón un mismo usuario puede
  // tener varios equipos a la vez (nuevo, 26/09 novena vuelta, pedido de
  // Iñi) — así que ahora es siempre una lista, ordenada por fecha de
  // inscripción; para el resto de tipos de sala (donde sigue habiendo como
  // mucho uno) el comportamiento visual no cambia en nada.
  const [misEquipos, setMisEquipos] = useState<EquipoMio[]>([]);
  const [jugadoresPorEquipo, setJugadoresPorEquipo] = useState<Record<string, JugadorRow[]>>({});
  const [signedUp, setSignedUp] = useState(0);
  const [participantes, setParticipantes] = useState<ParticipanteRow[]>([]);
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

      const [{ data: perfilData }, { data: salaData }] = await Promise.all([
        supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
        supabase.from('salas').select('id,nombre,competicion,deporte,tipo,aforo,buy_in,estado,fecha_limite_inscripcion').eq('id', salaId).single(),
      ]);

      if (!activo) return;

      if (perfilData) setPerfil(perfilData as Perfil);

      if (!salaData) {
        setError('No se ha encontrado esta sala.');
        setCargando(false);
        return;
      }
      setSala(salaData as SalaRow);

      // participantes_sala() es una función de base de datos (RPC), no una
      // select directa: equipos/inscripciones tienen RLS que solo deja ver
      // las filas propias de cada usuario (correcto — nadie debería poder
      // cotillear el equipo de un rival), pero la lista de "quién está
      // inscrito" (sin su equipo) sí es pública. Ver drafters-schema.sql.
      const [{ data: participantesData }, { data: misEquiposData }] = await Promise.all([
        supabase.rpc('participantes_sala', { p_sala_id: salaId }),
        // Antes era .maybeSingle() (esperaba como mucho un equipo). En
        // Maratón un usuario puede tener varios (nuevo, 26/09 novena
        // vuelta) — se lee siempre como lista, ordenada por fecha de
        // inscripción, y se filtran los reembolsados igual que antes.
        supabase
          .from('equipos')
          .select('id, nombre_equipo, jugadores, alineacion, gasto_total, created_at, inscripciones(estado)')
          .eq('sala_id', salaId)
          .eq('usuario_id', session.user.id)
          .order('created_at', { ascending: true }),
      ]);

      if (!activo) return;

      const filasParticipantes = (participantesData as { equipo_id: string; nombre: string; created_at: string }[]) ?? [];
      setSignedUp(filasParticipantes.length);
      setParticipantes(filasParticipantes.map((p) => ({ equipoId: p.equipo_id, nombre: p.nombre, createdAt: p.created_at })));

      const misEquiposActivos = ((misEquiposData as (EquipoMio & { inscripciones: { estado: string }[] })[]) ?? []).filter((e) =>
        e.inscripciones.some((i) => i.estado !== 'reembolsada')
      );
      setMisEquipos(misEquiposActivos);
      setTab(misEquiposActivos.length > 0 ? 'equipo' : 'info');

      const todosLosIds = Array.from(new Set(misEquiposActivos.flatMap((e) => e.jugadores ?? [])));
      if (todosLosIds.length > 0) {
        const { data: jugData } = await supabase.from('jugadores').select('id,nombre,posicion,precio,lesionado').in('id', todosLosIds);
        const jugadoresPorId = new Map(((jugData as JugadorRow[]) ?? []).map((j) => [j.id, j]));
        const mapa: Record<string, JugadorRow[]> = {};
        misEquiposActivos.forEach((e) => {
          mapa[e.id] = (e.jugadores ?? []).map((id) => jugadoresPorId.get(id)).filter((j): j is JugadorRow => !!j);
        });
        if (activo) setJugadoresPorEquipo(mapa);
      }

      setCargando(false);
    }

    cargar();
    return () => {
      activo = false;
    };
  }, [router, salaId]);

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

  if (error || !sala) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
          <div style={{ padding: '40px 20px' }}>
            <p style={{ fontSize: 14, color: S.ERROR }}>{error ?? 'No se ha encontrado esta sala.'}</p>
          </div>
        </div>
      </main>
    );
  }

  const estadoInfo = estadoSalaInfo(sala.estado, sala.aforo, signedUp);
  const tipoLabel = TIPO_SALA_LABELS[sala.tipo as TipoSala] ?? sala.tipo;
  // Bote real = lo que aporta cada inscripción a premios (90% del buy-in,
  // sin la comisión de la casa) — corregido el 25/09 (tercera vuelta): antes
  // multiplicaba el buy-in completo, incluyendo el 10% de comisión, así que
  // el bote mostrado salía inflado un 10% de más.
  //
  // Bote y premio del 1º con la sala LLENA (25/09, quinta vuelta): antes se
  // multiplicaba por signedUp (inscritos ahora mismo), así que en una sala a
  // medio llenar el bote y los premios se veían más pequeños de lo que
  // realmente van a ser — pedido de Iñi: "no esperes a que haya dinero
  // dentro para ver cuál es el bote total. Tú pon cuál es el bote total en
  // el caso de que la sala esté llena... y cuánto se llevaría el primero en
  // caso de que la sala esté llena". Ahora se multiplica por el aforo (la
  // capacidad fija de estos 4 tipos de sala), no por los inscritos reales;
  // como el reparto por tramos (calcularReparto) ya usa el aforo y no los
  // inscritos, el premio del 1º (primer tramo) sale automáticamente
  // calculado también "a sala llena".
  const bote = parteParaPremios(sala.buy_in) * (sala.aforo ?? signedUp);
  const tramos = calcularReparto(sala.tipo as TipoSala, sala.aforo, signedUp);
  const cierraEn = closesInLabel(sala.fecha_limite_inscripcion);
  const isFull = sala.estado === 'completa';
  const isFinalizada = sala.estado === 'finalizada';
  const hasEquipo = misEquipos.length > 0;
  const isFutbol = sala.deporte === 'futbol';
  const isMaraton = sala.tipo === 'maraton';

  // Botón de "Unirse" (nuevo, 26/09 novena vuelta): en el resto de tipos de
  // sala, en cuanto ya tienes un equipo el botón desaparece (solo se
  // permite uno). En Maratón, en cambio, se puede seguir creando equipos
  // nuevos aunque ya tengas alguno — mismo patrón que "Crear otro equipo"
  // ya usado en las porras clásicas (sección 11.7) — así que ahí el botón
  // sigue visible y solo cambia de texto.
  const showJoinCta = (!hasEquipo || isMaraton) && !isFinalizada;
  const joinLabel = isFull
    ? 'Sala completa'
    : hasEquipo && isMaraton
      ? `Crear otro equipo · ${formatEuros(sala.buy_in)}`
      : `Unirse · ${formatEuros(sala.buy_in)}`;
  const joinDisabled = isFull;

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '28px 20px 100px', position: 'relative' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#F0B94D' }}>{sala.competicion}</span>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: S.TEXT, lineHeight: 1.15 }}>{sala.nombre}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: estadoInfo.color, flexShrink: 0 }} />
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12.5, color: estadoInfo.color }}>{estadoInfo.label}</span>
              <span style={{ fontSize: 12.5, color: S.MUTED_3 }}>
                · {DEPORTE_LABELS[sala.deporte as keyof typeof DEPORTE_LABELS] ?? sala.deporte} · {tipoLabel}
              </span>
            </div>
          </div>

          {isFull && (
            <Link
              href={`/salas/${sala.id}/clasificacion`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                background: 'rgba(61,220,132,0.08)',
                border: '1px solid rgba(61,220,132,0.35)',
                borderRadius: 12,
                padding: '13px 16px',
                textDecoration: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FF7A45', flexShrink: 0 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14.5, textTransform: 'uppercase', letterSpacing: '0.02em', color: S.TEXT }}>
                    Sala completa · ha empezado
                  </span>
                  <span style={{ fontSize: 11.5, color: S.MUTED_2 }}>Ver la clasificación en directo</span>
                </div>
              </div>
              <span style={{ flexShrink: 0, color: '#3DDC84', fontSize: 18, fontWeight: 700 }}>→</span>
            </Link>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            {hasEquipo && (
              <button type="button" onClick={() => setTab('equipo')} style={tabButtonStyle(tab === 'equipo')}>
                Mi equipo
              </button>
            )}
            <button type="button" onClick={() => setTab('info')} style={tabButtonStyle(tab === 'info')}>
              Información
            </button>
            <button type="button" onClick={() => setTab('premios')} style={tabButtonStyle(tab === 'premios')}>
              Premios
            </button>
            <button type="button" onClick={() => setTab('jugadores')} style={tabButtonStyle(tab === 'jugadores')}>
              Jugadores
            </button>
          </div>

          {tab === 'equipo' && misEquipos.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
              {misEquipos.map((equipo, i) => (
                <EquipoPanel
                  key={equipo.id}
                  equipo={equipo}
                  jugadores={jugadoresPorEquipo[equipo.id] ?? []}
                  isFutbol={isFutbol}
                  // Título por equipo (nuevo, 26/09 novena vuelta) — solo
                  // hace falta distinguirlos cuando hay más de uno (siempre
                  // Maratón, el único tipo de sala que lo permite): mismo
                  // criterio de numeración que participantes_sala() en
                  // drafters-schema.sql ("Tu equipo" / "Tu equipo (II)" /
                  // "Tu equipo (III)"...).
                  titulo={misEquipos.length > 1 ? (i === 0 ? 'Tu equipo' : `Tu equipo (${numeroRomano(i + 1)})`) : undefined}
                />
              ))}
            </div>
          )}

          {tab === 'info' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Desglose del buy-in (25/09, quinta vuelta): antes mostraba el
                  total + el desglose + la palabra "comisión" ("10 € · 9 € + 1
                  € comisión") — pedido de Iñi viendo la sala de 10 €: "solo
                  pon 9 euros más 1 euro. No hace falta que pongas ni que el
                  total es 10, ni que... el 1 euro es de comisión... ya se
                  entiende". Ahora solo el desglose en sí (9 € + 1 €; 4,50 €
                  + 0,50 € en la de 5 €), sin el total delante ni la etiqueta. */}
              <InfoRow
                label="Buy-in"
                value={`${formatEuros(parteParaPremios(sala.buy_in))} + ${formatEuros(parteComision(sala.buy_in))}`}
                accent
              />
              <InfoRow label="Tipo de sala" value={tipoLabel} />
              <InfoRow label="Formato" value={tipoLabel} />
              <InfoRow label="Competición" value={sala.competicion} />
              <InfoRow label="Jugadores inscritos" value={`${signedUp}/${capacidadLabel(sala.aforo)}`} />
              {!isFinalizada && <InfoRow label="Se cierra en" value={cierraEn ?? 'Sin fecha fijada'} />}
            </div>
          )}

          {tab === 'premios' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '20px 14px', background: 'rgba(240,185,77,0.1)', border: '1px solid rgba(240,185,77,0.35)', borderRadius: 12 }}>
                <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#C9A257' }}>Bote total</span>
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 30, color: '#F0B94D' }}>{formatEuros(bote)}</span>
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

          {tab === 'jugadores' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12, color: S.MUTED_3 }}>
                {signedUp}/{capacidadLabel(sala.aforo)} inscritos
              </span>
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
                  <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 13.5, color: S.TEXT }}>{p.nombre}</span>
                </div>
              ))}
            </div>
          )}

          {showJoinCta && (
            <Link
              href={joinDisabled ? '#' : `/salas/${sala.id}/crear-equipo`}
              aria-disabled={joinDisabled}
              style={{
                pointerEvents: joinDisabled ? 'none' : 'auto',
                position: 'sticky',
                bottom: 16,
                marginTop: 8,
                fontFamily: "'Barlow Condensed', sans-serif",
                fontWeight: 700,
                fontSize: 16,
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
                color: joinDisabled ? S.MUTED_3 : '#04140B',
                background: joinDisabled ? S.PANEL : '#3DDC84',
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
              {joinLabel}
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}

// Un equipo del usuario (campo de fútbol o lista plana + total gastado) —
// extraído a su propio componente (26/09, novena vuelta) para poder pintar
// varios seguidos cuando el usuario tiene más de un equipo en la misma sala
// (solo posible en Maratón, ver arriba). Cada equipo calcula su propia
// alineación/huecos — antes esto vivía como estado de la página entera,
// pensado para un único equipo; ahora cada instancia es independiente, así
// que dos equipos Maratón de fútbol con alineaciones distintas se pintan
// cada uno con la suya, sin pisarse.
function EquipoPanel({
  equipo,
  jugadores,
  isFutbol,
  titulo,
}: {
  equipo: EquipoMio;
  jugadores: JugadorRow[];
  isFutbol: boolean;
  titulo?: string;
}) {
  const huecos = huecosPorLinea(equipo.alineacion ?? null);
  const porLinea: Record<LineaFutbol, JugadorRow[]> = { POR: [], DEF: [], MED: [], DEL: [] };
  jugadores.forEach((j) => porLinea[lineaDePosicion(j.posicion)].push(j));

  function lineaSlots(linea: LineaFutbol) {
    const cantidad = huecos[linea];
    const jugs = porLinea[linea];
    return Array.from({ length: cantidad }).map((_, i) => jugs[i] ?? null);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {titulo && (
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, textTransform: 'uppercase', letterSpacing: '0.03em', color: S.TEXT }}>
          {titulo}
        </span>
      )}
      {isFutbol ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_2 }}>Alineación</span>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color: '#F0B94D' }}>{equipo.alineacion ?? '4-3-3'}</span>
          </div>
          <div
            style={{
              position: 'relative',
              background: 'linear-gradient(180deg, #163A24 0%, #0F2A1A 100%)',
              border: '1px solid #1E4A2C',
              borderRadius: 14,
              padding: '18px 10px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 14,
              minHeight: 300,
              overflow: 'hidden',
            }}
          >
            <div style={{ position: 'absolute', left: '8%', right: '8%', top: '50%', height: 1, background: 'rgba(255,255,255,0.14)' }} />
            <div style={{ position: 'absolute', left: '50%', top: '50%', width: 64, height: 64, marginLeft: -32, marginTop: -32, border: '1px solid rgba(255,255,255,0.14)', borderRadius: '50%' }} />
            {(['DEL', 'MED', 'DEF', 'POR'] as LineaFutbol[]).map((linea) => (
              <div key={linea} style={{ position: 'relative', display: 'flex', gap: 4 }}>
                {lineaSlots(linea).map((jug, i) =>
                  jug ? (
                    <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, width: '100%', maxWidth: 66 }}>
                        <div style={{ position: 'relative', display: 'inline-flex' }}>
                          <span
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: '50%',
                              background: AVATAR_POR_LINEA[linea],
                              color: '#04140B',
                              fontFamily: "'Barlow Condensed', sans-serif",
                              fontWeight: 800,
                              fontSize: 11.5,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              border: '2px solid #F0B94D',
                              boxShadow: '0 2px 6px rgba(0,0,0,0.45)',
                            }}
                          >
                            {inicialesJugador(jug.nombre)}
                          </span>
                          {jug.lesionado && (
                            <span
                              style={{
                                position: 'absolute',
                                top: -3,
                                right: -3,
                                width: 13,
                                height: 13,
                                borderRadius: '50%',
                                background: '#FF5C5C',
                                border: '1.5px solid #0B0F0E',
                              }}
                            />
                          )}
                        </div>
                        <span style={{ fontSize: 8, fontWeight: 700, color: S.TEXT, textAlign: 'center', lineHeight: 1.15, width: '100%' }}>{jug.nombre}</span>
                      </div>
                    </div>
                  ) : (
                    <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center' }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', border: '1.5px dashed rgba(255,255,255,0.3)' }} />
                    </div>
                  )
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        jugadores.map((j) => (
          <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 10 }}>
            <span
              style={{
                flexShrink: 0,
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: '#3DDC84',
                color: '#04140B',
                fontFamily: "'Barlow Condensed', sans-serif",
                fontWeight: 800,
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(255,255,255,0.18)',
              }}
            >
              {inicialesJugador(j.nombre)}
            </span>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ minWidth: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {j.nombre}
              </span>
              {j.lesionado && <span style={{ flexShrink: 0, width: 13, height: 13, borderRadius: '50%', background: '#FF5C5C' }} />}
            </div>
            <span style={{ flexShrink: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 13, color: '#F0B94D' }}>{formatEuros(j.precio)}</span>
          </div>
        ))
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'rgba(240,185,77,0.1)', border: '1px solid rgba(240,185,77,0.3)', borderRadius: 10 }}>
        <span style={{ fontSize: 13, color: '#C9A257' }}>Total gastado</span>
        <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 14, color: '#F0B94D' }}>{formatEuros(equipo.gasto_total)}</span>
      </div>
      <span
        style={{
          marginTop: 4,
          fontFamily: "'Barlow Condensed', sans-serif",
          fontWeight: 700,
          fontSize: 14,
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
          color: S.MUTED_3,
          background: 'transparent',
          border: '1px solid rgba(240,185,77,0.25)',
          padding: '12px 20px',
          borderRadius: 10,
          minHeight: 42,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        Modificar equipo (próximamente)
      </span>
    </div>
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
