'use client';

import { Suspense } from 'react';
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
  return <CrearEquipo amistoso={{ id, competicion }} />;
}

export default function V2Equipo() {
  return (
    <Suspense fallback={null}>
      <EquipoAmistoso />
    </Suspense>
  );
}
