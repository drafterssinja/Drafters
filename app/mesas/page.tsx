'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { DEPORTES, Deporte, DEPORTE_LABELS, formatEuros, estadoSalaInfo, closesInLabel } from '@/lib/salaShared';

// ============================================================================
// GRANDES TORNEOS (adaptación de isMesas, Main.dc.html líneas 528-560)
// ============================================================================
// Iñi (23/09): "las salas maratón no van a estar con el resto de salas...
// van a estar en el apartado especial... los grandes torneos" y "para las
// porras clásicas también lo mismo". Esta pantalla junta las dos cosas en
// un selector superior — Maratón conserva los pills de deporte de la
// maqueta original (isMesas), Porras clásicas es solo golf así que no los
// necesita.

type MaratonFila = {
  id: string;
  nombre: string;
  competicion: string;
  deporte: string;
  buy_in: number;
  estado: string;
  fecha_limite_inscripcion: string | null;
};

type PorraFila = {
  id: string;
  major: string;
  estado: string;
  precio: number;
  competicion: string | null;
  fecha_limite_inscripcion: string | null;
};

function MesasPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tabPrincipal, setTabPrincipal] = useState<'maraton' | 'porras'>(searchParams.get('tab') === 'porras' ? 'porras' : 'maraton');
  const [deporte, setDeporte] = useState<Deporte>('futbol');

  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [maratones, setMaratones] = useState<MaratonFila[]>([]);
  const [porras, setPorras] = useState<PorraFila[]>([]);
  const [inscritosPorSala, setInscritosPorSala] = useState<Map<string, number>>(new Map());
  const [inscritosPorPorra, setInscritosPorPorra] = useState<Map<string, number>>(new Map());
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

      // inscritos_por_sala()/inscritos_por_porra() son funciones de base de
      // datos (RPC), no selects directas: equipos/inscripciones tienen RLS
      // que solo deja ver las filas propias de cada usuario — el número de
      // inscritos de cada sala/porra es agregado y público. Ver
      // drafters-schema.sql.
      const [{ data: perfilData }, { data: maratonData }, { data: porraData }, { data: inscritosSalaData }, { data: inscritosPorraData }] = await Promise.all([
        supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
        supabase
          .from('salas')
          .select('id,nombre,competicion,deporte,buy_in,estado,fecha_limite_inscripcion')
          .eq('tipo', 'maraton')
          .neq('estado', 'finalizada'),
        supabase
          .from('porras')
          .select('id,major,estado,precio,competicion,fecha_limite_inscripcion')
          .neq('estado', 'finalizada')
          .order('fecha_limite_inscripcion', { ascending: true }),
        supabase.rpc('inscritos_por_sala'),
        supabase.rpc('inscritos_por_porra'),
      ]);

      if (!activo) return;

      if (perfilData) setPerfil(perfilData as Perfil);
      setMaratones((maratonData as MaratonFila[]) ?? []);
      setPorras((porraData as PorraFila[]) ?? []);

      const mapaSala = new Map<string, number>();
      ((inscritosSalaData as { sala_id: string; inscritos: number }[]) ?? []).forEach((fila) => mapaSala.set(fila.sala_id, Number(fila.inscritos)));
      setInscritosPorSala(mapaSala);

      const mapaPorra = new Map<string, number>();
      ((inscritosPorraData as { porra_id: string; inscritos: number }[]) ?? []).forEach((fila) => mapaPorra.set(fila.porra_id, Number(fila.inscritos)));
      setInscritosPorPorra(mapaPorra);

      setCargando(false);
    }

    cargar();
    return () => {
      activo = false;
    };
  }, [router]);

  const maratonesDelDeporte = useMemo(
    () =>
      maratones
        .filter((m) => m.deporte === deporte)
        .slice()
        .sort((a, b) => {
          const da = a.fecha_limite_inscripcion ? new Date(a.fecha_limite_inscripcion).getTime() : Infinity;
          const db = b.fecha_limite_inscripcion ? new Date(b.fecha_limite_inscripcion).getTime() : Infinity;
          return da - db;
        }),
    [maratones, deporte]
  );

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

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={formatEuros(perfil.saldo_simulado)} accountInitials={S.iniciales(perfil.nombre, perfil.apellido)} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '32px 20px 56px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: S.TEXT }}>Grandes torneos</h1>
            <p style={{ fontSize: 13, color: S.MUTED_2 }}>Maratón y porras clásicas — aparte del resto de salas, sin límite de inscritos.</p>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setTabPrincipal('maraton')} style={pillStyle(tabPrincipal === 'maraton')}>
              Maratón
            </button>
            <button type="button" onClick={() => setTabPrincipal('porras')} style={pillStyle(tabPrincipal === 'porras')}>
              Porras clásicas
            </button>
          </div>

          {tabPrincipal === 'maraton' && (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                {DEPORTES.map((d) => (
                  <button key={d} type="button" onClick={() => setDeporte(d)} style={pillStyle(deporte === d)}>
                    {DEPORTE_LABELS[d]}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {maratonesDelDeporte.length === 0 && <p style={{ fontSize: 13, color: S.MUTED_2 }}>No hay ningún Maratón abierto de {DEPORTE_LABELS[deporte].toLowerCase()} ahora mismo.</p>}
                {maratonesDelDeporte.map((m) => {
                  const signedUp = inscritosPorSala.get(m.id) ?? 0;
                  const estadoInfo = estadoSalaInfo(m.estado, null, signedUp);
                  const cierra = closesInLabel(m.fecha_limite_inscripcion);
                  return (
                    <Link
                      key={m.id}
                      href={`/salas/${m.id}`}
                      style={{ background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, textDecoration: 'none' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color: S.TEXT }}>{m.nombre}</span>
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
                            Cierra en {cierra}
                          </span>
                        )}
                      </div>
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
                    </Link>
                  );
                })}
              </div>

              <span style={{ fontSize: 11, color: S.FAINT }}>*Bote único acumulado. Sin límite de plazas.</span>
            </>
          )}

          {tabPrincipal === 'porras' && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {porras.length === 0 && <p style={{ fontSize: 13, color: S.MUTED_2 }}>No hay ninguna porra clásica disponible ahora mismo.</p>}
                {porras.map((p) => {
                  const signedUp = inscritosPorPorra.get(p.id) ?? 0;
                  const cierra = closesInLabel(p.fecha_limite_inscripcion);
                  const estadoColor = p.estado === 'disponible' ? '#3DDC84' : p.estado === 'proximamente' ? '#F0B94D' : S.MUTED_3;
                  const estadoLabel = p.estado === 'disponible' ? 'Disponible' : p.estado === 'proximamente' ? 'Próximamente' : 'Finalizada';
                  return (
                    <Link
                      key={p.id}
                      href={`/porras/${p.id}`}
                      style={{ background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, textDecoration: 'none' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color: S.TEXT }}>{p.major}</span>
                        {cierra && (
                          <span style={{ flexShrink: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: '#FF9F6E', background: 'rgba(255,159,110,0.12)', padding: '4px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                            Cierra en {cierra}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: estadoColor, fontWeight: 700 }}>{estadoLabel}</span>
                        <span style={{ fontSize: 12, color: S.MUTED_2 }}>{signedUp} inscritos</span>
                        <span style={{ marginLeft: 'auto', fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 13, color: '#F0B94D' }}>{formatEuros(p.precio)}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>

              <span style={{ fontSize: 11, color: S.FAINT }}>*Sin límite de participantes. Los 4 grandes majors.</span>
            </>
          )}
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
