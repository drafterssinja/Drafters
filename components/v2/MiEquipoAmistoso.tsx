'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import Cargando from '@/components/Cargando';
import CampoAlineacion, { type JugCampo } from '@/components/v2/CampoAlineacion';

// Tu equipo de una jornada del amistoso, dibujado en el campo (16/10, Iñi: "que
// se vea ahí directamente cuál es tu equipo, como en el draft, en un campo con
// los nombres y el circulito con el escudo"). En golf, la lista de jugadores.
export default function MiEquipoAmistoso({ amistosoId, competicion, deporte, miId, version = 0 }: { amistosoId: string; competicion: string; deporte: string; miId: string; version?: number }) {
  const [jugs, setJugs] = useState<JugCampo[] | null>(null);

  useEffect(() => {
    let activo = true;
    void (async () => {
      const { data: eq } = await supabase.from('amistoso_equipos').select('jugadores').eq('amistoso_id', amistosoId).eq('competicion', competicion).eq('usuario_id', miId).maybeSingle();
      const ids = ((eq as { jugadores: string[] } | null)?.jugadores ?? []) as string[];
      if (ids.length === 0) {
        if (activo) setJugs([]);
        return;
      }
      const { data } = await supabase.from('jugadores').select('id,nombre,posicion,equipo_real').in('id', ids);
      const porId = new Map(((data as JugCampo[]) ?? []).map((j) => [j.id, j]));
      if (activo) setJugs(ids.map((x) => porId.get(x)).filter(Boolean) as JugCampo[]);
    })();
    return () => {
      activo = false;
    };
  }, [amistosoId, competicion, miId, version]);

  if (jugs === null) return <Cargando compacto />;
  if (jugs.length === 0) return null;
  if (deporte === 'futbol') return <CampoAlineacion jugadores={jugs} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {jugs.map((j, i) => (
        <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: S.TEXT }}>
          <span style={{ width: 22, height: 22, borderRadius: '50%', background: S.ACCENT, color: '#04140B', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
          {j.nombre}
        </div>
      ))}
    </div>
  );
}
