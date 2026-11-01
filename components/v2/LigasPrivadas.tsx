'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import Cargando from '@/components/Cargando';
import type { DeporteV2 } from '@/components/v2/IconosV2';

// ============================================================================
// LIGAS PRIVADAS DE UN DEPORTE (31/10, Iñi) — SQL 71 (lp_lista)
// ============================================================================
// Las tuyas y, debajo, el botón "Unirme a una liga privada" (pantalla aparte
// /v2/liga-privada/unirse con todas las ligas y buscador).

export type FilaLigaPrivada = { id: string; nombre: string; competicion: string; creador: string; miembros: number; soy_miembro: boolean; estado: 'activa' | 'terminada'; created_at: string };

const MORADO = '#A78BFA';

export function TarjetaLigaPrivada({ l }: { l: FilaLigaPrivada }) {
  return (
    <Link href={`/v2/liga-privada/${l.id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, textDecoration: 'none', background: S.PANEL, border: `1px solid ${l.soy_miembro ? 'rgba(167,139,250,0.45)' : S.CARD_BORDER}`, opacity: l.estado === 'terminada' ? 0.6 : 1 }}>
      <span style={{ fontSize: 20 }}>🔒</span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontWeight: 800, fontSize: 15.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.nombre}</span>
        <span style={{ fontSize: 12, color: S.MUTED_2 }}>
          {l.miembros} {l.miembros === 1 ? 'miembro' : 'miembros'} · de @{l.creador}
          {l.estado === 'terminada' ? ' · Terminada' : ''}
        </span>
      </span>
      {l.soy_miembro ? (
        <span style={{ fontSize: 11, fontWeight: 800, color: MORADO, whiteSpace: 'nowrap' }}>✓ Ya estás</span>
      ) : (
        <span style={{ color: MORADO, fontWeight: 800, fontSize: 18 }}>›</span>
      )}
    </Link>
  );
}

// 01/11 (Iñi): "Unirme a una liga privada", bien visible (botón de color), y
// lleva a una pantalla aparte con todas las ligas y un buscador arriba.
export function BotonUnirmeLigaPrivada({ deporte }: { deporte: DeporteV2 }) {
  return (
    <Link
      href={`/v2/liga-privada/unirse?deporte=${deporte}`}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px 16px', borderRadius: 12, textDecoration: 'none', background: MORADO, color: '#140B26', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 18, textTransform: 'uppercase', letterSpacing: '0.03em', boxShadow: '0 4px 18px rgba(167,139,250,0.28)' }}
    >
      🔑 Unirme a una liga privada
    </Link>
  );
}

export default function LigasPrivadas({ deporte }: { deporte: DeporteV2 }) {
  const [lista, setLista] = useState<FilaLigaPrivada[] | null>(null);

  useEffect(() => {
    void supabase.rpc('lp_lista', { p_deporte: deporte }).then(({ data }) => setLista((data as FilaLigaPrivada[]) ?? []));
  }, [deporte]);

  if (lista === null) return <Cargando compacto />;
  const mias = lista.filter((l) => l.soy_miembro);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {mias.length === 0 ? (
        <span style={{ fontSize: 13, color: S.MUTED_2 }}>Todavía no estás en ninguna liga privada. Crea una o únete a la de tus amigos.</span>
      ) : (
        mias.map((l) => <TarjetaLigaPrivada key={l.id} l={l} />)
      )}
      <BotonUnirmeLigaPrivada deporte={deporte} />
    </div>
  );
}
