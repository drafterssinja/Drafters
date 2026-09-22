'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { calcularTramosPorInscritos } from '@/lib/repartoPremios';
import { GRUPO_PORRA_LABELS, GrupoPorra, ORDEN_GRUPOS, COLOR_GRUPO } from '@/lib/porraGrupos';
import { formatEuros, posicionLabel, closesInLabel } from '@/lib/salaShared';

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

type PorraFila = { id: string; major: string; estado: string; precio: number; competicion: string | null; fecha_limite_inscripcion: string | null };
type JugadorRow = { id: string; nombre: string; grupo_porra: GrupoPorra | null; precio: number };

type Tab = 'info' | 'premios' | 'grupos';

export default function PorraDetallePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const porraId = params.id;

  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [porra, setPorra] = useState<PorraFila | null>(null);
  const [jugadores, setJugadores] = useState<JugadorRow[]>([]);
  const [signedUp, setSignedUp] = useState(0);
  const [tengoEquipo, setTengoEquipo] = useState(false);
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
        supabase.from('porras').select('id,major,estado,precio,competicion,fecha_limite_inscripcion').eq('id', porraId).single(),
      ]);

      if (!activo) return;
      if (perfilData) setPerfil(perfilData as Perfil);

      if (!porraData) {
        setError('No se ha encontrado esta porra.');
        setCargando(false);
        return;
      }
      const porraRow = porraData as PorraFila;
      setPorra(porraRow);

      // inscritos_por_porra() es una función de base de datos (RPC): las
      // filas de equipos/inscripciones de otros usuarios no son visibles
      // por RLS, pero el número de inscritos de la porra es un dato
      // agregado y público. Ver drafters-schema.sql. Si tengo equipo propio
      // en esta porra sí se puede consultar directamente (RLS lo permite).
      const [{ data: inscritosPorraData }, { data: miEquipoData }, { data: jugData }] = await Promise.all([
        supabase.rpc('inscritos_por_porra'),
        supabase.from('equipos').select('id, inscripciones(estado)').eq('porra_id', porraId).eq('usuario_id', session.user.id).maybeSingle(),
        porraRow.competicion
          ? supabase.from('jugadores').select('id,nombre,grupo_porra,precio').eq('deporte', 'golf').eq('competicion', porraRow.competicion)
          : Promise.resolve({ data: [] }),
      ]);

      if (!activo) return;

      const filaPorra = ((inscritosPorraData as { porra_id: string; inscritos: number }[]) ?? []).find((f) => f.porra_id === porraId);
      setSignedUp(filaPorra ? Number(filaPorra.inscritos) : 0);

      const miEquipo = miEquipoData as { id: string; inscripciones: { estado: string }[] } | null;
      setTengoEquipo(!!miEquipo && miEquipo.inscripciones.some((i) => i.estado !== 'reembolsada'));

      setJugadores((jugData as JugadorRow[]) ?? []);
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

  const bote = porra.precio * signedUp;
  const tramos = calcularTramosPorInscritos(signedUp);
  const estadoColor = porra.estado === 'disponible' ? '#3DDC84' : porra.estado === 'proximamente' ? '#F0B94D' : S.MUTED_3;
  const estadoLabel = porra.estado === 'disponible' ? 'Disponible' : porra.estado === 'proximamente' ? 'Próximamente' : 'Finalizada';
  const cierra = closesInLabel(porra.fecha_limite_inscripcion);

  const gruposConJugadores = ORDEN_GRUPOS.map((g) => ({
    grupo: g,
    jugadores: jugadores.filter((j) => j.grupo_porra === g).sort((a, b) => a.nombre.localeCompare(b.nombre)),
  })).filter((g) => g.jugadores.length > 0);

  const showJoinCta = !tengoEquipo && porra.estado !== 'finalizada';

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '28px 20px 100px', position: 'relative' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#F0B94D' }}>Porra clásica</span>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: S.TEXT, lineHeight: 1.15 }}>{porra.major}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: estadoColor, flexShrink: 0 }} />
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12.5, color: estadoColor }}>{estadoLabel}</span>
              <span style={{ fontSize: 12.5, color: S.MUTED_3 }}>· Golf</span>
              {cierra && <span style={{ fontSize: 12.5, color: '#FF9F6E' }}>· Cierra en {cierra}</span>}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setTab('info')} style={tabButtonStyle(tab === 'info')}>
              Información
            </button>
            <button type="button" onClick={() => setTab('premios')} style={tabButtonStyle(tab === 'premios')}>
              Premios
            </button>
            <button type="button" onClick={() => setTab('grupos')} style={tabButtonStyle(tab === 'grupos')}>
              Grupos
            </button>
          </div>

          {tab === 'info' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <InfoRow label="Precio de entrada" value={formatEuros(porra.precio)} accent />
              <InfoRow label="Competición" value={porra.competicion ?? '—'} />
              <InfoRow label="Jugadores inscritos" value={String(signedUp)} />
              <InfoRow label="Reparto de premios" value="Por tramos según inscritos" />
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
                  <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 14, color: '#F0B94D' }}>{formatEuros((bote * t.porcentajeCadaUno) / 100)} c/u</span>
                </div>
              ))}
            </div>
          )}

          {tab === 'grupos' && (
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
              Elegir equipo · {formatEuros(porra.precio)}
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
