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
// Arriba, las tuyas; debajo (plegadas), las demás activas para entrar con contraseña.

type Fila = { id: string; nombre: string; competicion: string; creador: string; miembros: number; soy_miembro: boolean; estado: 'activa' | 'terminada'; created_at: string };

const MORADO = '#A78BFA';

export default function LigasPrivadas({ deporte }: { deporte: DeporteV2 }) {
  const [lista, setLista] = useState<Fila[] | null>(null);
  const [verOtras, setVerOtras] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    void supabase.rpc('lp_lista', { p_deporte: deporte }).then(({ data }) => setLista((data as Fila[]) ?? []));
  }, [deporte]);

  if (lista === null) return <Cargando compacto />;
  const mias = lista.filter((l) => l.soy_miembro);
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const otras = lista.filter((l) => !l.soy_miembro && l.estado === 'activa' && (!q.trim() || norm(`${l.nombre} ${l.creador}`).includes(norm(q.trim()))));

  const tarjeta = (l: Fila) => (
    <Link key={l.id} href={`/v2/liga-privada/${l.id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, textDecoration: 'none', background: S.PANEL, border: `1px solid ${l.soy_miembro ? 'rgba(167,139,250,0.45)' : S.CARD_BORDER}`, opacity: l.estado === 'terminada' ? 0.6 : 1 }}>
      <span style={{ fontSize: 20 }}>🔒</span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontWeight: 800, fontSize: 15.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.nombre}</span>
        <span style={{ fontSize: 12, color: S.MUTED_2 }}>
          {l.miembros} {l.miembros === 1 ? 'miembro' : 'miembros'} · de @{l.creador}
          {l.estado === 'terminada' ? ' · Terminada' : ''}
        </span>
      </span>
      <span style={{ color: MORADO, fontWeight: 800, fontSize: 18 }}>›</span>
    </Link>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {mias.length === 0 ? (
        <span style={{ fontSize: 13, color: S.MUTED_2 }}>Todavía no estás en ninguna liga privada. Crea una y pásale la contraseña a tus amigos.</span>
      ) : (
        mias.map(tarjeta)
      )}
      {otras.length > 0 || q ? (
        verOtras ? (
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar una liga por nombre o creador" style={{ ...S.input, fontSize: 14 }} />
            {otras.map(tarjeta)}
            {otras.length === 0 && <span style={{ fontSize: 12.5, color: S.MUTED_3 }}>No hay ninguna con ese nombre.</span>}
          </>
        ) : (
          <button type="button" onClick={() => setVerOtras(true)} style={{ ...S.secondaryLinkButton, marginTop: 0 }}>
            Entrar en otra liga privada ({otras.length})
          </button>
        )
      ) : null}
    </div>
  );
}
