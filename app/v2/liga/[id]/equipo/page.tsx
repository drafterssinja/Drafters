'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import Cargando from '@/components/Cargando';
import CrearEquipo from '@/components/equipo/CrearEquipo';

// ============================================================================
// LIGA DRAFTERS (DUELOS) — HACER EL EQUIPO DE UNA JORNADA (26/10)
// ============================================================================
// La misma pantalla de siempre (partidos a la izquierda, jugadores a la
// derecha, campo abajo), con presupuesto. Se guarda con duelos_guardar_equipo.

function EquipoDuelo() {
  const { id } = useParams<{ id: string }>();
  return <CrearEquipo duelo={{ ronda: id }} />;
}

export default function V2EquipoLiga() {
  return (
    <Suspense fallback={<Cargando />}>
      <EquipoDuelo />
    </Suspense>
  );
}
