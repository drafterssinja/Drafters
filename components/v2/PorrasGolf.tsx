'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { fechaCorta } from '@/lib/v2';

// Porras clásicas de golf dentro de la página de golf de V2 (15/10). De
// momento se juegan exactamente igual que en la V1 (mismo flujo).
type Porra = { id: string; major: string; estado: string; competicion: string | null; fecha_limite_inscripcion: string | null };

export default function PorrasGolf() {
  const [porras, setPorras] = useState<Porra[] | null>(null);
  const [inscritos, setInscritos] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    void (async () => {
      const [{ data }, { data: ins }] = await Promise.all([
        supabase.from('porras').select('id,major,estado,competicion,fecha_limite_inscripcion').neq('formato', 'futbol_jornada').order('fecha_limite_inscripcion', { ascending: true }),
        supabase.rpc('inscritos_por_porra'),
      ]);
      setPorras((data as Porra[]) ?? []);
      const m = new Map<string, number>();
      ((ins as { porra_id: string; inscritos: number }[]) ?? []).forEach((f) => m.set(f.porra_id, Number(f.inscritos)));
      setInscritos(m);
    })();
  }, []);

  const ahora = Date.now();
  const activas = (porras ?? []).filter((p) => p.estado !== 'finalizada');
  const finalizadas = (porras ?? []).filter((p) => p.estado === 'finalizada').reverse().slice(0, 5);

  const fila = (p: Porra) => {
    const empezada = p.estado === 'finalizada' || (!!p.fecha_limite_inscripcion && new Date(p.fecha_limite_inscripcion).getTime() <= ahora);
    return (
      <Link key={p.id} href={empezada ? `/porras/${p.id}/clasificacion` : `/porras/${p.id}`} style={{ ...S.card, gap: 12 }}>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontWeight: 800, fontSize: 14.5, color: S.TEXT }}>{p.major}</span>
          <span style={{ fontSize: 11.5, color: S.MUTED_2 }}>
            {inscritos.get(p.id) ?? 0} equipos{p.fecha_limite_inscripcion && !empezada ? ` · cierra ${fechaCorta(p.fecha_limite_inscripcion)}` : ''}
          </span>
        </span>
        <span style={{ fontSize: 12, fontWeight: 800, color: p.estado === 'finalizada' ? S.MUTED_3 : empezada ? '#FF5C5C' : '#FF7A45' }}>{p.estado === 'finalizada' ? 'Resultado' : empezada ? '● En directo' : p.estado === 'proximamente' ? 'Próximamente' : 'Jugar'}</span>
      </Link>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: 13, color: S.MUTED, margin: 0, lineHeight: 1.5 }}>La porra de toda la vida: un jugador de cada grupo de color y a sumar.</p>
      {porras === null && <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>Cargando porras...</p>}
      {porras !== null && activas.length === 0 && <p style={{ fontSize: 13, color: S.MUTED_3, margin: 0 }}>No hay ninguna porra abierta ahora mismo.</p>}
      {activas.map(fila)}
      {finalizadas.length > 0 && (
        <>
          <span style={{ ...S.sectionLabel, marginTop: 6 }}>Finalizadas</span>
          {finalizadas.map(fila)}
        </>
      )}
    </div>
  );
}
