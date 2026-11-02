'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import Cargando from '@/components/Cargando';
import { PelotaDeporte, type DeporteV2 } from '@/components/v2/IconosV2';

// ============================================================================
// LIGAS PRIVADAS DE UN DEPORTE (31/10, Iñi) — SQL 71 (lp_lista)
// ============================================================================
// Las tuyas y, debajo, el botón "Unirme a una liga privada" (pantalla aparte
// /v2/liga-privada/unirse con todas las ligas y buscador).

export type FilaLigaPrivada = { id: string; nombre: string; competicion: string; creador: string; miembros: number; soy_miembro: boolean; estado: 'activa' | 'terminada'; created_at: string; mi_puesto?: number | null; aviso?: 'en_juego' | 'sin_equipo' | 'equipo_hecho' | null };

// 02/11 (Iñi, opción N): oro + azul noche en lugar del morado.
const ORO = '#F5C94A';
const ORO_FONDO = 'linear-gradient(180deg,#FFE08A 0%,#E9B532 55%,#C9921E 100%)';

export function TarjetaLigaPrivada({ l }: { l: FilaLigaPrivada }) {
  return (
    <Link href={`/v2/liga-privada/${l.id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, textDecoration: 'none', background: S.PANEL, border: `1px solid ${l.soy_miembro ? 'rgba(245,201,74,0.45)' : S.CARD_BORDER}`, opacity: l.estado === 'terminada' ? 0.6 : 1 }}>
      <span style={{ fontSize: 20 }}>🔒</span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontWeight: 800, fontSize: 15.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.nombre}</span>
        <span style={{ fontSize: 12, color: S.MUTED_2 }}>
          {l.miembros} {l.miembros === 1 ? 'miembro' : 'miembros'} · de @{l.creador}
          {l.estado === 'terminada' ? ' · Terminada' : ''}
        </span>
      </span>
      {l.soy_miembro ? (
        <span style={{ fontSize: 11, fontWeight: 800, color: ORO, whiteSpace: 'nowrap' }}>✓ Ya estás</span>
      ) : (
        <span style={{ color: ORO, fontWeight: 800, fontSize: 18 }}>›</span>
      )}
    </Link>
  );
}

// 01/11 (Iñi): "Unirme a una liga privada", bien visible (botón de color), y
// lleva a una pantalla aparte con todas las ligas y un buscador arriba.
export function BotonUnirmeLigaPrivada({ deporte, discreto = false }: { deporte: DeporteV2; discreto?: boolean }) {
  // 02/11 (Iñi): si ya estás en alguna liga, el botón no les quita protagonismo (solo borde).
  return (
    <Link
      href={`/v2/liga-privada/unirse?deporte=${deporte}`}
      style={
        discreto
          ? { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 16px', borderRadius: 12, textDecoration: 'none', background: 'transparent', border: `1.5px solid ${ORO}`, color: ORO, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 16, textTransform: 'uppercase', letterSpacing: '0.03em' }
          : { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px 16px', borderRadius: 12, textDecoration: 'none', background: ORO_FONDO, color: '#1A1405', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 18, textTransform: 'uppercase', letterSpacing: '0.03em', boxShadow: '0 4px 18px rgba(245,201,74,0.28)' }
      }
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
        mias.map((l) => <MiLiga key={l.id} l={l} deporte={deporte} />)
      )}
      <BotonUnirmeLigaPrivada deporte={deporte} discreto={mias.length > 0} />
    </div>
  );
}

// 02/11 (Iñi): las ligas en las que juegas, bien destacadas: fondo de color,
// tu puesto y qué toca (jornada en juego / haz tu equipo).
function MiLiga({ l, deporte }: { l: FilaLigaPrivada; deporte: DeporteV2 }) {
  const terminada = l.estado === 'terminada';
  const aviso =
    l.aviso === 'en_juego'
      ? { texto: '● En juego', color: '#3DDC84', fondo: 'rgba(61,220,132,0.14)' }
      : l.aviso === 'sin_equipo'
        ? { texto: 'Haz tu equipo', color: '#FF8A4C', fondo: 'rgba(255,138,76,0.16)' }
        : l.aviso === 'equipo_hecho'
          ? { texto: '✓ Equipo hecho', color: '#C9D2CC', fondo: 'rgba(255,255,255,0.06)' }
          : null;
  return (
    <Link
      href={`/v2/liga-privada/${l.id}`}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px', borderRadius: 16, textDecoration: 'none', background: terminada ? S.PANEL : 'linear-gradient(135deg, rgba(40,70,140,0.85) 0%, rgba(40,70,140,0.24) 100%)', border: `1.5px solid ${terminada ? S.CARD_BORDER : 'rgba(245,201,74,0.75)'}`, opacity: terminada ? 0.65 : 1 }}
    >
      <span style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 12, background: 'rgba(11,15,14,0.55)', border: '1px solid rgba(245,201,74,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <PelotaDeporte deporte={deporte} size={26} />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color: S.TEXT, lineHeight: 1.05, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.nombre}</span>
        <span style={{ fontSize: 12, color: '#C8D3EA' }}>
          {terminada ? 'Terminada · ' : ''}
          {l.mi_puesto ? `Vas ${l.mi_puesto}º de ${l.miembros}` : `${l.miembros} ${l.miembros === 1 ? 'miembro' : 'miembros'}`}
        </span>
      </span>
      {aviso ? (
        <span style={{ flexShrink: 0, padding: '6px 10px', borderRadius: 999, background: aviso.fondo, color: aviso.color, fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' }}>{aviso.texto}</span>
      ) : (
        <span style={{ color: ORO, fontWeight: 800, fontSize: 20 }}>›</span>
      )}
    </Link>
  );
}
