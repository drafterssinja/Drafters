'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { formatEuros, closesInLabel } from '@/lib/salaShared';
import { PorraFormato, PORRA_FORMATO_LABELS, PORRA_FORMATO_COLOR } from '@/lib/porraFormato';

// ============================================================================
// PORRAS CLÁSICAS DE GOLF — pantalla índice (isPorras de Main.dc.html,
// líneas 1393-1414)
// ============================================================================
// Nueva landing (27/09, undécima vuelta): antes esta lista vivía como una
// pestaña dentro de /mesas ("Grandes torneos" → "Porras clásicas"); ahora,
// al dividir /inicio en dos recuadros ("Mesas Drafters" / "Porras clásicas
// de golf"), pasa a ser su propia pantalla de nivel superior, con el mismo
// listado y estilo que ya tenía esa pestaña.

type PorraFila = {
  id: string;
  major: string;
  estado: string;
  precio: number;
  competicion: string | null;
  fecha_limite_inscripcion: string | null;
  formato: PorraFormato;
};

export default function PorrasIndexPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [porras, setPorras] = useState<PorraFila[]>([]);
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

      const [{ data: perfilData }, { data: porraData }, { data: inscritosPorraData }] = await Promise.all([
        supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
        supabase
          .from('porras')
          .select('id,major,estado,precio,competicion,fecha_limite_inscripcion,formato')
          .neq('estado', 'finalizada')
          .order('fecha_limite_inscripcion', { ascending: true }),
        // inscritos_por_porra() es una función de base de datos (RPC): las
        // filas de equipos/inscripciones de otros usuarios no son visibles
        // por RLS, pero el número de inscritos es un dato agregado y
        // público. Ver drafters-schema.sql.
        supabase.rpc('inscritos_por_porra'),
      ]);

      if (!activo) return;

      if (perfilData) setPerfil(perfilData as Perfil);
      setPorras((porraData as PorraFila[]) ?? []);

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
            <h1 style={{ fontSize: 26, fontWeight: 800, color: S.TEXT }}>Porras clásicas de golf</h1>
            <p style={{ fontSize: 13, color: S.MUTED_2 }}>Sin límite de participantes. Elige tu equipo por grupos y compite.</p>
          </div>

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
                    <span
                      style={{
                        flexShrink: 0,
                        fontFamily: "'Manrope', sans-serif",
                        fontWeight: 700,
                        fontSize: 9.5,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: PORRA_FORMATO_COLOR[p.formato],
                        background: `${PORRA_FORMATO_COLOR[p.formato]}1F`,
                        border: `1px solid ${PORRA_FORMATO_COLOR[p.formato]}55`,
                        borderRadius: 999,
                        padding: '3px 8px',
                      }}
                    >
                      {PORRA_FORMATO_LABELS[p.formato]}
                    </span>
                    <span style={{ fontSize: 12, color: estadoColor, fontWeight: 700 }}>{estadoLabel}</span>
                    <span style={{ fontSize: 12, color: S.MUTED_2 }}>{signedUp} equipo{signedUp === 1 ? '' : 's'}</span>
                    <span style={{ marginLeft: 'auto', fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 13, color: '#F0B94D' }}>{formatEuros(p.precio)}</span>
                  </div>
                </Link>
              );
            })}
          </div>

          <span style={{ fontSize: 11, color: S.FAINT }}>*Sin límite de participantes. Equipos ilimitados por participante.</span>
        </div>
      </div>
    </main>
  );
}
