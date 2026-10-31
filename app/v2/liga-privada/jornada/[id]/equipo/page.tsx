'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import Cargando from '@/components/Cargando';
import CrearEquipo from '@/components/equipo/CrearEquipo';

// ============================================================================
// LIGA PRIVADA — HACER EL EQUIPO DE UNA JORNADA (31/10, Iñi)
// ============================================================================
// La misma pantalla de siempre, con presupuesto. Se guarda con lp_guardar_equipo (SQL 71).

function EquipoLigaPrivada() {
  const { id } = useParams<{ id: string }>();
  return <CrearEquipo duelo={{ ronda: id, privada: true }} />;
}

export default function V2EquipoLigaPrivada() {
  return (
    <Suspense fallback={<Cargando />}>
      <EquipoLigaPrivada />
    </Suspense>
  );
}
