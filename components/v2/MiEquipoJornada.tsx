'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import Cargando from '@/components/Cargando';
import CampoAlineacion, { type JugCampo } from '@/components/v2/CampoAlineacion';

// ============================================================================
// TU EQUIPO DE LA PRÓXIMA JORNADA EN EL CAMPO (24/11, Iñi)
// ============================================================================
// "Una vez hecho el equipo, que la previsualización sea en todos sitios como en
// las salas: el campo con los iconos de los jugadores y el escudo pequeñito."
// Para las ligas privadas y la Liga Drafters (las salas ya lo tenían con
// MiEquipoAmistoso). En golf y tenis, la lista de jugadores.
export default function MiEquipoJornada({ ronda, privada, deporte, titulo }: { ronda: string; privada: boolean; deporte: string; titulo?: string }) {
  const [jugs, setJugs] = useState<JugCampo[] | null>(null);

  useEffect(() => {
    let activo = true;
    void (async () => {
      const { data } = await supabase.rpc(privada ? 'lp_ronda_para_equipo' : 'duelos_ronda_para_equipo', { p_ronda: ronda });
      const ids = ((data as { mi_equipo: { jugadores: string[] } | null } | null)?.mi_equipo?.jugadores ?? []) as string[];
      if (ids.length === 0) {
        if (activo) setJugs([]);
        return;
      }
      const { data: js } = await supabase.from('jugadores').select('id,nombre,posicion,equipo_real').in('id', ids);
      const porId = new Map(((js as JugCampo[]) ?? []).map((j) => [j.id, j]));
      if (activo) setJugs(ids.map((x) => porId.get(x)).filter(Boolean) as JugCampo[]);
    })();
    return () => {
      activo = false;
    };
  }, [ronda, privada]);

  if (jugs === null) return <Cargando compacto />;
  if (jugs.length === 0) return null;
  if (deporte === 'futbol') return <CampoAlineacion jugadores={jugs} titulo={titulo ?? 'Tu equipo'} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontWeight: 800, fontSize: 14, color: S.TEXT }}>{titulo ?? 'Tu equipo'}</span>
      {jugs.map((j, i) => (
        <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: S.TEXT }}>
          <span style={{ width: 22, height: 22, borderRadius: '50%', background: S.ACCENT, color: '#04140B', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
          {j.nombre}
        </div>
      ))}
    </div>
  );
}
