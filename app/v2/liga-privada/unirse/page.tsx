'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import MarcoV2, { Titulo } from '@/components/v2/MarcoV2';
import { useSesionV2 } from '@/components/v2/useSesionV2';
import { esDeporteV2, type DeporteV2 } from '@/components/v2/IconosV2';
import Cargando from '@/components/Cargando';
import { TarjetaLigaPrivada, type FilaLigaPrivada } from '@/components/v2/LigasPrivadas';

// ============================================================================
// UNIRME A UNA LIGA PRIVADA (01/11, Iñi)
// ============================================================================
// Pantalla aparte con todas las ligas privadas del deporte que siguen en
// marcha, con un buscador arriba (por nombre de la liga o de quien la creó).
// Al pulsar una se entra en su página, donde se pone la contraseña.

const ICONO: Record<DeporteV2, string> = { futbol: '⚽', golf: '⛳', tenis: '🎾' };
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function Unirse() {
  const dp = useSearchParams().get('deporte') ?? 'futbol';
  const deporte: DeporteV2 = esDeporteV2(dp) ? dp : 'futbol';
  const { perfil, estado } = useSesionV2();
  const [lista, setLista] = useState<FilaLigaPrivada[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!perfil) return;
    void supabase.rpc('lp_lista', { p_deporte: deporte }).then(({ data }) => setLista((data as FilaLigaPrivada[]) ?? []));
  }, [deporte, perfil]);

  const activas = (lista ?? []).filter((l) => l.estado === 'activa');
  // Primero las que no son tuyas (para unirte), luego las tuyas; dentro, las más nuevas primero.
  const ordenadas = [...activas].sort((a, b) => Number(a.soy_miembro) - Number(b.soy_miembro) || b.created_at.localeCompare(a.created_at));
  const t = norm(q.trim());
  const vistas = t ? ordenadas.filter((l) => norm(`${l.nombre} ${l.creador}`).includes(t)) : ordenadas;

  return (
    <MarcoV2 perfil={perfil} estado={estado} deporte={deporte} volverA={`/v2/${deporte}?modo=privadas`}>
      <Titulo>{ICONO[deporte]} Unirme a una liga privada</Titulo>
      <span style={{ fontSize: 13, color: S.MUTED_2, lineHeight: 1.5, marginTop: -6 }}>
        Busca la liga de tus amigos, entra y escribe la contraseña que te hayan pasado.
      </span>

      <div style={{ position: 'sticky', top: 0, zIndex: 2, background: S.BG, paddingBottom: 4 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔎 Buscar por nombre o creador"
          autoComplete="off"
          style={{ ...S.input, fontSize: 16, border: `1.5px solid #A78BFA` }}
        />
      </div>

      {lista === null ? (
        <Cargando compacto />
      ) : vistas.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', padding: '24px 8px', textAlign: 'center' }}>
          <span style={{ fontSize: 13.5, color: S.MUTED_2 }}>{t ? 'No hay ninguna liga con ese nombre.' : 'Todavía no hay ligas privadas de este deporte.'}</span>
          <Link href={`/v2/liga-privada/crear?deporte=${deporte}`} style={{ ...S.secondaryLinkButton, marginTop: 0 }}>
            ＋ Crear una liga privada
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 12, color: S.MUTED_3 }}>
            {vistas.length} {vistas.length === 1 ? 'liga' : 'ligas'}
          </span>
          {vistas.map((l) => (
            <TarjetaLigaPrivada key={l.id} l={l} />
          ))}
        </div>
      )}
    </MarcoV2>
  );
}

export default function UnirmeLigaPrivada() {
  return (
    <Suspense fallback={<Cargando />}>
      <Unirse />
    </Suspense>
  );
}
