'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import {
  DEPORTES,
  TIPO_SALA_LABELS,
  formatEuros,
  estadoSalaInfo,
  closesInLabel,
  capacidadLabel,
} from '@/lib/salaShared';
import type { TipoSala } from '@/lib/repartoPremios';

const ACCENT = '#3DDC84';

// ============================================================================
// PANTALLA DE INICIO (isHome de Main.dc.html, líneas 366-526)
// ============================================================================
// Bienvenida + mis equipos en juego + selector de deporte + accesos a
// "Grandes torneos" (Maratón y Porras clásicas, que viven aparte del
// listado normal de salas — pedido explícito de Iñi) + salas que cierran
// pronto. Misma estructura y estilos exactos que la maqueta visual.

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

type EquipoFila = {
  id: string;
  modo: string;
  sala_id: string | null;
  porra_id: string | null;
  nombre_equipo: string | null;
  jugadores: string[];
  gasto_total: number;
  salas: { id: string; nombre: string; competicion: string; deporte: string; estado: string; tipo: string } | null;
  porras: { id: string; major: string; estado: string; competicion: string | null } | null;
  inscripciones: { estado: string }[];
};

export default function InicioPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [equipos, setEquipos] = useState<EquipoFila[]>([]);
  const [lesionMap, setLesionMap] = useState<Map<string, { nombre: string; lesionado: boolean }>>(new Map());
  const [salasAbiertas, setSalasAbiertas] = useState<SalaFila[]>([]);
  const [inscritosPorSala, setInscritosPorSala] = useState<Map<string, number>>(new Map());
  const [cargando, setCargando] = useState(true);

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

      const [{ data: perfilData }, { data: equiposData }, { data: salasData }, { data: inscritosData }] = await Promise.all([
        supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
        supabase
          .from('equipos')
          .select(
            'id, modo, sala_id, porra_id, nombre_equipo, jugadores, gasto_total, salas(id,nombre,competicion,deporte,estado,tipo), porras(id,major,estado,competicion), inscripciones(estado)'
          )
          .eq('usuario_id', session.user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('salas')
          .select('id,nombre,competicion,deporte,tipo,aforo,buy_in,estado,fecha_limite_inscripcion')
          .neq('tipo', 'maraton')
          .neq('estado', 'finalizada'),
        // inscritos_por_sala() es una función de base de datos (RPC) — hace
        // falta porque equipos/inscripciones tienen RLS que solo deja ver
        // las filas propias de cada usuario (correcto: nadie debería poder
        // cotillear el equipo de un rival), pero el número de inscritos de
        // cada sala sí es un dato público. Ver drafters-schema.sql.
        supabase.rpc('inscritos_por_sala'),
      ]);

      if (!activo) return;

      if (perfilData) setPerfil(perfilData as Perfil);

      const misEquipos = ((equiposData as unknown as EquipoFila[]) ?? []).filter((eq) =>
        eq.inscripciones.some((i) => i.estado !== 'reembolsada')
      );
      setEquipos(misEquipos);

      const idsJugadores = Array.from(new Set(misEquipos.flatMap((eq) => eq.jugadores ?? [])));
      if (idsJugadores.length > 0) {
        const { data: jugData } = await supabase.from('jugadores').select('id,nombre,lesionado').in('id', idsJugadores);
        const mapa = new Map<string, { nombre: string; lesionado: boolean }>();
        (jugData ?? []).forEach((j) => mapa.set(j.id, { nombre: j.nombre as string, lesionado: j.lesionado as boolean }));
        if (activo) setLesionMap(mapa);
      }

      setSalasAbiertas((salasData as SalaFila[]) ?? []);

      const mapaInscritos = new Map<string, number>();
      ((inscritosData as { sala_id: string; inscritos: number }[]) ?? []).forEach((fila) => mapaInscritos.set(fila.sala_id, Number(fila.inscritos)));
      setInscritosPorSala(mapaInscritos);

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
      if (j?.lesionado) return j.nombre;
    }
    return null;
  }

  const conteoPorDeporte: Record<string, number> = {};
  DEPORTES.forEach((d) => {
    conteoPorDeporte[d] = salasAbiertas.filter((s) => s.deporte === d).length;
  });

  const cierranPronto = salasAbiertas
    .filter((s) => s.fecha_limite_inscripcion && closesInLabel(s.fecha_limite_inscripcion))
    .sort((a, b) => new Date(a.fecha_limite_inscripcion!).getTime() - new Date(b.fecha_limite_inscripcion!).getTime())
    .slice(0, 4);

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
              <Link href="/salas" style={{ ...S.primaryButton, marginTop: 6, textAlign: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                Crear mi equipo
              </Link>
            </div>
          )}

          {equipos.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {equipos.map((eq) => {
                const competicionLabel = eq.salas?.competicion ?? eq.porras?.competicion ?? eq.porras?.major ?? '';
                const salaNombre = eq.salas?.nombre ?? (eq.porras ? `Porra · ${eq.porras.major}` : eq.nombre_equipo ?? 'Mi equipo');
                const href = eq.salas ? `/salas/${eq.sala_id}` : eq.porras ? `/porras/${eq.porra_id}` : '#';
                const clasificacionHref = eq.salas ? `/salas/${eq.sala_id}/clasificacion` : '#';
                const enDirecto = eq.salas?.estado === 'completa';
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
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
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
            <h2 style={{ fontSize: 20, fontWeight: 700, color: S.TEXT }}>Grandes torneos.</h2>
            <Link
              href="/mesas"
              style={{
                position: 'relative',
                display: 'block',
                borderRadius: 16,
                overflow: 'hidden',
                border: '1px solid rgba(240,185,77,0.35)',
                background: 'linear-gradient(135deg, #241A05 0%, #332405 55%, #40300A 100%)',
                padding: '18px 20px',
                textDecoration: 'none',
              }}
            >
              <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontStyle: 'italic', fontSize: 26, color: '#F0B94D' }}>MARATÓN</span>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F0B94D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: '#F0B94D', background: 'rgba(240,185,77,0.14)', border: '1px solid rgba(240,185,77,0.3)', borderRadius: 999, padding: '4px 10px' }}>
                    Jugadores ilimitados
                  </span>
                  <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: '#F0B94D', background: 'rgba(240,185,77,0.14)', border: '1px solid rgba(240,185,77,0.3)', borderRadius: 999, padding: '4px 10px' }}>
                    Torneo o jornada concreta
                  </span>
                </div>
                <span style={{ fontSize: 12, color: 'rgba(245,247,245,0.7)' }}>Un único bote acumulado por torneo o jornada. Sin límite de inscritos.</span>
              </div>
            </Link>

            <Link
              href="/mesas?tab=porras"
              style={{
                position: 'relative',
                display: 'block',
                borderRadius: 16,
                overflow: 'hidden',
                border: '1px solid rgba(61,220,132,0.35)',
                background: 'linear-gradient(135deg, #071A10 0%, #0C2A18 55%, #123B20 100%)',
                padding: '18px 20px',
                textDecoration: 'none',
              }}
            >
              <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontStyle: 'italic', fontSize: 26, color: ACCENT }}>PORRAS</span>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: ACCENT, background: 'rgba(61,220,132,0.14)', border: '1px solid rgba(61,220,132,0.3)', borderRadius: 999, padding: '4px 10px' }}>
                    Sin límite de participantes
                  </span>
                  <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: ACCENT, background: 'rgba(61,220,132,0.14)', border: '1px solid rgba(61,220,132,0.3)', borderRadius: 999, padding: '4px 10px' }}>
                    Los 4 grandes majors
                  </span>
                </div>
                <span style={{ fontSize: 12, color: 'rgba(245,247,245,0.7)' }}>
                  Las porras clásicas de golf de toda la vida: Masters, PGA Championship, Open Championship y US Open.
                </span>
              </div>
            </Link>
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
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#FF9F6E' }}>Cierra en {closesInLabel(sala.fecha_limite_inscripcion)}</span>
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
