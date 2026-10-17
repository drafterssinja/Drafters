'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { TIPO_SALA_LABELS } from '@/lib/salaShared';
import type { TipoSala } from '@/lib/repartoPremios';
import type { DeporteV2 } from '@/components/v2/IconosV2';
import ResumenClasificacionMesa from '@/components/ResumenClasificacionMesa';
import ResumenClasificacionAmistoso from '@/components/v2/ResumenClasificacionAmistoso';
import EtiquetaTramo from '@/components/v2/EtiquetaTramo';
import { MODALIDAD_LABEL, cadaXSegundos, type Modalidad, type Resumen } from '@/lib/v2';

// ============================================================================
// MIS EQUIPOS EN V2 (16/10, Iñi)
// ============================================================================
// "El recuadro de mis equipos como teníamos en Drafters V1", encima de
// Amistosos / Liga: pestañas Finalizadas / En juego (por defecto En juego),
// cada sala con su "Vas 2º de 6 · 109 pts ▾" que despliega la clasificación,
// "Ver mi equipo" y "Clasificación en directo". Se ven 2 y el resto detrás
// de "Mostrar más", para no tapar la lista de salas.

type MesaLiga = {
  id: string;
  sala_id: string;
  salas: { id: string; nombre: string; competicion: string; tipo: TipoSala; aforo: number | null; estado: string; fecha_limite_inscripcion: string | null; deporte: string; tramo?: string | null } | null;
  inscripciones: { estado: string }[];
};
type FilaAmistoso = { id: string; nombre: string; deporte: string; modalidad: Modalidad; competiciones: string[]; soy_participante: boolean; estado: string; created_at: string; tramos?: string[] | null };
type Item =
  | { tipo: 'mesa'; key: string; orden: number; finalizada: boolean; empezada: boolean; mesa: MesaLiga }
  | { tipo: 'amistoso'; key: string; orden: number; finalizada: boolean; empezada: boolean; am: FilaAmistoso; resumen: Resumen };

const LIMITE = 2;

function etiquetaComp(deporte: DeporteV2, c: string): string {
  if (deporte !== 'futbol') return c;
  const liga = c.replace(/\s*-\s*Jornada.*$/i, '');
  const n = c.match(/Jornada\s*(\d+)/i)?.[1];
  return n ? `${liga.replace('Champions League', 'Champions')} · J${n}` : c;
}

export default function MisEquiposV2({ deporte, miId }: { deporte: DeporteV2; miId: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [pestana, setPestana] = useState<'en_juego' | 'finalizadas'>('en_juego');
  const [mostrarTodos, setMostrarTodos] = useState(false);

  const cargar = useCallback(async () => {
    const [{ data: mesas }, { data: lista }] = await Promise.all([
      supabase
        .from('equipos')
        .select('id,sala_id,created_at,salas!inner(id,nombre,competicion,tipo,aforo,estado,fecha_limite_inscripcion,deporte,tramo),inscripciones(estado)')
        .eq('usuario_id', miId)
        .eq('salas.deporte', deporte)
        .eq('salas.version', 2)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase.rpc('amistosos_v2_lista'),
    ]);
    const ahora = Date.now();
    const out: Item[] = [];
    for (const m of ((mesas as unknown as (MesaLiga & { created_at: string })[]) ?? []).filter((e) => e.inscripciones.some((i) => i.estado !== 'reembolsada'))) {
      const s = m.salas;
      if (!s) continue;
      const empezada = !!s.fecha_limite_inscripcion && new Date(s.fecha_limite_inscripcion).getTime() <= ahora;
      out.push({ tipo: 'mesa', key: `m-${m.id}`, orden: new Date(m.created_at).getTime(), finalizada: s.estado === 'finalizada', empezada, mesa: m });
    }
    const mios = ((lista as FilaAmistoso[]) ?? []).filter((a) => a.soy_participante && a.deporte === deporte).slice(0, 20);
    const resumenes = await Promise.all(mios.map((a) => supabase.rpc('amistoso_resumen', { p_amistoso: a.id })));
    mios.forEach((a, k) => {
      const r = resumenes[k].data as Resumen | null;
      if (!r) return;
      const terminada = a.estado === 'finalizado' || (r.jornadas.length > 0 && r.jornadas.every((j) => j.terminada));
      const empezada = r.jornadas.some((j) => j.empezada);
      out.push({ tipo: 'amistoso', key: `a-${a.id}`, orden: new Date(a.created_at).getTime(), finalizada: terminada, empezada, am: a, resumen: r });
    });
    // En juego primero las que ya han empezado; dentro, las más recientes.
    out.sort((x, y) => Number(y.empezada) - Number(x.empezada) || y.orden - x.orden);
    setItems(out);
  }, [deporte, miId]);

  useEffect(() => {
    setItems(null);
    void cargar();
    return cadaXSegundos(cargar, 60);
  }, [cargar]);

  if (!items || items.length === 0) return null;
  const enJuego = items.filter((i) => !i.finalizada);
  const finalizadas = items.filter((i) => i.finalizada);
  const lista = pestana === 'en_juego' ? enJuego : finalizadas;
  const visibles = mostrarTodos ? lista : lista.slice(0, LIMITE);

  const botonVer: React.CSSProperties = { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#04140B', background: S.ACCENT, borderRadius: 8, padding: '8px 12px', whiteSpace: 'nowrap', textDecoration: 'none' };
  const botonClasif: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#FF7A45', background: 'rgba(255,122,69,0.14)', border: '1px solid rgba(255,122,69,0.45)', borderRadius: 8, padding: '6px 10px', whiteSpace: 'nowrap', textDecoration: 'none' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-start' }}>
        <button type="button" onClick={() => { setPestana('finalizadas'); setMostrarTodos(false); }} style={S.pill(pestana === 'finalizadas')}>
          Finalizadas ({finalizadas.length})
        </button>
        <button type="button" onClick={() => { setPestana('en_juego'); setMostrarTodos(false); }} style={S.pill(pestana === 'en_juego')}>
          En juego ({enJuego.length})
        </button>
      </div>
      {lista.length === 0 && <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>{pestana === 'en_juego' ? 'No tienes ninguna sala en juego ahora mismo.' : 'Todavía no tienes ninguna sala finalizada.'}</p>}

      {visibles.map((it) => {
        if (it.tipo === 'mesa') {
          const s = it.mesa.salas!;
          return (
            <div key={it.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
                <Link href={`/salas/${s.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, textDecoration: 'none' }}>
                  <span style={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#F0B94D' }}>Liga · {etiquetaComp(deporte, s.competicion)}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {TIPO_SALA_LABELS[s.tipo] ?? s.nombre} · {s.aforo} jugadores
                  </span>
                  {s.tramo && <EtiquetaTramo tramo={s.tramo} deporte={s.deporte} compacta />}
                </Link>
                {(it.empezada || it.finalizada) && <ResumenClasificacionMesa salaId={s.id} competicion={s.competicion} deporte={s.deporte} miEquipoId={it.mesa.id} finalizada={it.finalizada} tramo={s.tramo ?? null} />}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                <Link href={`/salas/${s.id}`} style={botonVer}>
                  Ver mi equipo
                </Link>
                {(it.empezada || it.finalizada) && (
                  <Link href={`/salas/${s.id}/clasificacion`} style={botonClasif}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#FF7A45', flexShrink: 0 }} />
                    {it.finalizada ? 'Clasificación final' : 'Clasificación en directo'}
                  </Link>
                )}
              </div>
            </div>
          );
        }
        const a = it.am;
        const comps = a.competiciones.length > 1 ? `${etiquetaComp(deporte, a.competiciones[0])} → ${etiquetaComp(deporte, a.competiciones[a.competiciones.length - 1])}` : etiquetaComp(deporte, a.competiciones[0] ?? '');
        return (
          <div key={it.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
              <Link href={`/v2/sala/${a.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, textDecoration: 'none' }}>
                <span style={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#F0B94D', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Amistoso · {comps}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.nombre} · <span style={{ color: '#A78BFA' }}>{MODALIDAD_LABEL[a.modalidad]}</span>
                </span>
                {a.tramos?.[0] && <EtiquetaTramo tramo={a.tramos[0]} deporte={a.deporte} compacta />}
              </Link>
              {(it.empezada || it.finalizada) && <ResumenClasificacionAmistoso amistosoId={a.id} deporte={a.deporte} resumen={it.resumen} miId={miId} finalizada={it.finalizada} />}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
              <Link href={`/v2/sala/${a.id}`} style={botonVer}>
                {it.empezada || a.modalidad !== 'draft' ? 'Ver mi equipo' : 'Ir a la sala'}
              </Link>
              {(it.empezada || it.finalizada) && (
                <Link href={`/v2/sala/${a.id}?tab=clasificacion`} style={botonClasif}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#FF7A45', flexShrink: 0 }} />
                  {it.finalizada ? 'Clasificación final' : 'Clasificación en directo'}
                </Link>
              )}
            </div>
          </div>
        );
      })}

      {lista.length > LIMITE && (
        <button type="button" onClick={() => setMostrarTodos((v) => !v)} style={{ alignSelf: 'center', background: 'transparent', border: 'none', color: S.ACCENT, fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: '4px 8px' }}>
          {mostrarTodos ? 'Mostrar menos' : `Mostrar más (${lista.length - LIMITE})`}
        </button>
      )}
    </div>
  );
}
