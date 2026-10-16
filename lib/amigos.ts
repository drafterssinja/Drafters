'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

// ============================================================================
// AMIGOS (16/10, Iñi) — ver 46_sql_amigos_16-10.sql
// ============================================================================

export type FilaAmigo = { usuario_id: string; nombre_usuario: string; estado: 'pendiente' | 'aceptada'; recibida: boolean; desde: string };

export type PerfilAmigo = {
  usuario_id: string;
  nombre_usuario: string;
  amigos_desde: string | null;
  privacidad: { resumen: boolean; en_juego: boolean; historial: boolean; invitaciones: boolean };
  resumen: {
    mesas_jugadas: number;
    mesas_premiadas: number;
    victorias: number;
    porras_jugadas: number;
    amistosos_jugados: number;
    liga: { deporte: string; draftis: number; mesas: number; ganadas: number; puesto: number; division: string | null; nivel: number; grupo: number }[];
  } | null;
  en_juego: { tipo: 'mesa' | 'porra' | 'amistoso'; id: string; equipo_id?: string; nombre: string; competicion: string | null; deporte: string; version?: number; privada?: boolean; cierre: string | null; empezada: boolean }[] | null;
  historial: { tipo: 'mesa'; id: string; equipo_id: string; nombre: string; competicion: string; deporte: string; fecha: string | null; posicion: number | null; premio: boolean }[] | null;
};

// Ids de mis amigos (para marcarlos en la liga, etc.).
export function useAmigosIds(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let activo = true;
    supabase.rpc('amigos_lista').then(({ data }) => {
      if (!activo) return;
      setIds(new Set(((data as FilaAmigo[]) ?? []).filter((f) => f.estado === 'aceptada').map((f) => f.usuario_id)));
    });
    return () => {
      activo = false;
    };
  }, []);
  return ids;
}

