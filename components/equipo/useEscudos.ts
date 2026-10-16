'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { escudoLaLiga, claveEquipoFutbol } from '@/lib/futbolLaLiga';
import { esEquipoFilial, nombrePrimerEquipo } from '@/lib/aliasEquipos';

// Escudos de los equipos (tabla futbol_escudos; si falta, el mapa fijo). Mismo
// criterio que la pantalla de crear equipo de las mesas.
export function useEscudos() {
  const [escudosBD, setEscudosBD] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let activo = true;
    supabase
      .from('futbol_escudos')
      .select('clave,logo')
      .then(({ data }) => {
        if (activo) setEscudosBD(new Map(((data as { clave: string; logo: string }[]) ?? []).map((e) => [e.clave, e.logo])));
      });
    return () => {
      activo = false;
    };
  }, []);
  const primero = (nombre: string) => (esEquipoFilial(nombre) ? nombrePrimerEquipo(nombre) : nombre);
  // 16/10 (Iñi: "no se carga el escudo del Barça"): para los equipos de LaLiga
  // primero el escudo fijo de ESPN, que siempre carga; el guardado, para el resto.
  const escudoDe = (nombre: string): string | null => escudoLaLiga(primero(nombre)) ?? escudosBD.get(claveEquipoFutbol(primero(nombre))) ?? null;
  const escudoAlternativo = (nombre: string): string | null => escudosBD.get(claveEquipoFutbol(primero(nombre))) ?? null;
  return { escudoDe, escudoAlternativo };
}
