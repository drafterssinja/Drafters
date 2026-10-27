'use client';

import Cargando from '@/components/Cargando';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { useParams, useSearchParams } from 'next/navigation';
import CrearEquipo from '@/components/equipo/CrearEquipo';

// ============================================================================
// DRAFTERS V2 — HACER EL EQUIPO DE UN AMISTOSO (presupuesto y libre)
// ============================================================================
// 16/10 (Iñi): "ponlo como lo teníamos" — la misma pantalla que las mesas:
// partidos a la izquierda, jugadores a la derecha y el campo abajo. Además se
// puede cargar un equipo guardado, de otro amistoso o de las mesas de la V1.

function EquipoAmistoso() {
  const { id } = useParams<{ id: string }>();
  const competicion = useSearchParams().get('c') ?? '';
  // 28/10 (Iñi): en tenis el torneo se abre antes de que salga el cuadro; sin
  // jugadores todavía no hay equipo que hacer.
  const [hayJugadores, setHayJugadores] = useState<boolean | null>(null);
  useEffect(() => {
    if (!competicion) return setHayJugadores(true);
    void supabase
      .from('jugadores')
      .select('id', { count: 'exact', head: true })
      .eq('competicion', competicion)
      .then(({ count }) => setHayJugadores((count ?? 0) > 0));
  }, [competicion]);
  if (hayJugadores === null) return <Cargando />;
  if (!hayJugadores) {
    return (
      <main style={S.mainReset}>
        <div style={{ ...S.pageFrame, padding: 24, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', textAlign: 'center' }}>
          <span style={{ fontSize: 44 }}>🎾</span>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 24, color: S.TEXT }}>Todavía no ha salido el cuadro</span>
          <span style={{ fontSize: 13.5, color: S.MUTED_2, lineHeight: 1.5, maxWidth: 320 }}>Los jugadores y sus precios se publican en cuanto salga (normalmente el viernes o el sábado). Te avisaremos para que hagas tu equipo.</span>
          <Link href={`/v2/sala/${id}`} style={{ ...S.secondaryLinkButton, width: 'auto', padding: '10px 18px', textDecoration: 'none' }}>
            Volver a la sala
          </Link>
        </div>
      </main>
    );
  }
  return <CrearEquipo amistoso={{ id, competicion }} />;
}

export default function V2Equipo() {
  return (
    <Suspense fallback={<Cargando />}>
      <EquipoAmistoso />
    </Suspense>
  );
}
