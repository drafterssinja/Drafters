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
// Amistosos / Liga (04/11: sin pestañas; en juego + finalizadas < 48 h),
// cada sala con su "Vas 2º de 6 · 109 pts ▾" que despliega la clasificación,
// "Ver mi equipo" y "Clasificación en directo". Se ven 2 y el resto detrás
// de "Mostrar más", para no tapar la lista de salas.

type MesaLiga = {
  id: string;
  sala_id: string;
  salas: { id: string; nombre: string; competicion: string; tipo: TipoSala; aforo: number | null; estado: string; fecha_limite_inscripcion: string | null; deporte: string; tramo?: string | null; bolsa?: boolean | null } | null;
  inscripciones: { estado: string }[];
};
type FilaAmistoso = { id: string; nombre: string; deporte: string; modalidad: Modalidad; competiciones: string[]; soy_participante: boolean; estado: string; created_at: string; tramos?: string[] | null };
// 02/11 (Iñi): también los equipos de las ligas privadas (SQL 88, lp_mis_equipos).
type FilaLp = { jornada_id: string; liga_id: string; liga_nombre: string; numero: number; competicion: string; estado: 'pendiente' | 'en_juego' | 'terminada'; cierre: string | null; mi_puesto: number | null; mi_total: number | null; con_equipo: number; creado: string };
type Item =
  | { tipo: 'mesa'; key: string; orden: number; finalizada: boolean; empezada: boolean; comps: [string, string | null][]; mesa: MesaLiga }
  | { tipo: 'lp'; key: string; orden: number; finalizada: boolean; empezada: boolean; comps: [string, string | null][]; lp: FilaLp }
  | { tipo: 'amistoso'; key: string; orden: number; finalizada: boolean; empezada: boolean; comps: [string, string | null][]; am: FilaAmistoso; resumen: Resumen };

// 04/11 (Iñi): sin pestañas Finalizadas / En juego. Salen las que están en
// juego (o por empezar) y las finalizadas hace menos de 48 horas; pasado ese
// tiempo desaparecen solas (el historial completo está en Mi nivel).
const HORAS_FINALIZADAS = 48;

const LIMITE = 2;

function etiquetaComp(deporte: DeporteV2, c: string): string {
  if (deporte !== 'futbol') return c;
  const liga = c.replace(/\s*-\s*Jornada.*$/i, '');
  const n = c.match(/Jornada\s*(\d+)/i)?.[1];
  return n ? `${liga.replace('Champions League', 'Champions')} · J${n}` : c;
}

// 27/10 (Iñi): Amistosos y Liga van en pestañas separadas, cada una con sus equipos.
export default function MisEquiposV2({ deporte, miId, solo }: { deporte: DeporteV2; miId: string; solo?: 'amistosos' | 'liga' }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [mostrarTodos, setMostrarTodos] = useState(false);
  // 18/10 (Iñi): "mis equipos" en su propia caja, que se pliega y despliega
  // pulsando la cabecera (se recuerda en este dispositivo).
  const [plegado, setPlegado] = useState(false);
  useEffect(() => {
    try {
      setPlegado(localStorage.getItem('v2_mis_equipos_plegado') === '1');
    } catch {}
  }, []);
  function alternarPlegado() {
    setPlegado((v) => {
      try {
        localStorage.setItem('v2_mis_equipos_plegado', v ? '0' : '1');
      } catch {}
      return !v;
    });
  }

  const cargar = useCallback(async () => {
    const [{ data: mesas }, { data: lista }, { data: lps }] = await Promise.all([
      solo === 'amistosos'
        ? Promise.resolve({ data: [] as unknown[] })
        : supabase
        .from('equipos')
        .select('id,sala_id,created_at,salas!inner(id,nombre,competicion,tipo,aforo,estado,fecha_limite_inscripcion,deporte,tramo,bolsa),inscripciones(estado)')
        .eq('usuario_id', miId)
        .eq('salas.deporte', deporte)
        .eq('salas.version', 2)
        .order('created_at', { ascending: false })
        .limit(30),
      solo === 'liga' ? Promise.resolve({ data: [] as unknown[] }) : supabase.rpc('amistosos_v2_lista'),
      solo === 'liga' ? Promise.resolve({ data: [] as unknown[] }) : supabase.rpc('lp_mis_equipos', { p_deporte: deporte }),
    ]);
    const ahora = Date.now();
    const out: Item[] = [];
    for (const m of ((mesas as unknown as (MesaLiga & { created_at: string })[]) ?? []).filter((e) => e.inscripciones.some((i) => i.estado !== 'reembolsada'))) {
      const s = m.salas;
      if (!s) continue;
      const empezada = !!s.fecha_limite_inscripcion && new Date(s.fecha_limite_inscripcion).getTime() <= ahora;
      out.push({ tipo: 'mesa', key: `m-${m.id}`, orden: new Date(m.created_at).getTime(), finalizada: s.estado === 'finalizada', empezada, comps: [[s.competicion, s.tramo ?? null]], mesa: m });
    }
    const mios = ((lista as FilaAmistoso[]) ?? []).filter((a) => a.soy_participante && a.deporte === deporte).slice(0, 20);
    const resumenes = await Promise.all(mios.map((a) => supabase.rpc('amistoso_resumen', { p_amistoso: a.id })));
    mios.forEach((a, k) => {
      const r = resumenes[k].data as Resumen | null;
      if (!r) return;
      const terminada = a.estado === 'finalizado' || (r.jornadas.length > 0 && r.jornadas.every((j) => j.terminada));
      const empezada = r.jornadas.some((j) => j.empezada);
      out.push({ tipo: 'amistoso', key: `a-${a.id}`, orden: new Date(a.created_at).getTime(), finalizada: terminada, empezada, comps: a.competiciones.map((c, i) => [c, a.tramos?.[i] || null] as [string, string | null]), am: a, resumen: r });
    });
    for (const f of (lps as FilaLp[] | null) ?? []) {
      out.push({ tipo: 'lp', key: `lp-${f.jornada_id}`, orden: new Date(f.cierre ?? f.creado).getTime(), finalizada: f.estado === 'terminada', empezada: f.estado !== 'pendiente', comps: [[f.competicion, null]], lp: f });
    }
    // Las finalizadas solo si terminaron hace menos de 48 h (SQL 95).
    const fin = out.filter((i) => i.finalizada);
    let recientes = out;
    if (fin.length > 0) {
      const pares = Array.from(new Map(fin.flatMap((i) => i.comps).map(([c, t]) => [`${c}|${t ?? ''}`, { c, t }])).values());
      const { data: fechas, error } = await supabase.rpc('mis_equipos_terminados_en', { p_items: pares });
      const cuando = new Map(((fechas as { competicion: string; tramo: string | null; terminado_en: string | null }[]) ?? []).map((f) => [`${f.competicion}|${f.tramo ?? ''}`, f.terminado_en]));
      const limite = ahora - HORAS_FINALIZADAS * 3600e3;
      recientes = out.filter((i) => {
        if (!i.finalizada) return true;
        if (error) return i.orden >= ahora - 7 * 86400e3; // sin el SQL 95: las de la última semana
        const ts = i.comps.map(([c, t]) => cuando.get(`${c}|${t ?? ''}`)).filter((x): x is string => !!x).map((x) => new Date(x).getTime());
        return ts.length > 0 && Math.max(...ts) >= limite;
      });
    }
    // En juego primero las que ya han empezado; dentro, las más recientes; las finalizadas al final.
    recientes.sort((x, y) => Number(x.finalizada) - Number(y.finalizada) || Number(y.empezada) - Number(x.empezada) || y.orden - x.orden);
    setItems(recientes);
  }, [deporte, miId, solo]);

  useEffect(() => {
    setItems(null);
    void cargar();
    return cadaXSegundos(cargar, 60);
  }, [cargar]);

  if (!items || items.length === 0) return null;
  const enJuego = items.filter((i) => !i.finalizada);
  const lista = items;
  const visibles = mostrarTodos ? lista : lista.slice(0, LIMITE);

  const botonVer: React.CSSProperties = { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#04140B', background: S.ACCENT, borderRadius: 8, padding: '8px 12px', whiteSpace: 'nowrap', textDecoration: 'none' };
  const botonClasif: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#FF7A45', background: 'rgba(255,122,69,0.14)', border: '1px solid rgba(255,122,69,0.45)', borderRadius: 8, padding: '6px 10px', whiteSpace: 'nowrap', textDecoration: 'none' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderRadius: 16, border: '1px solid rgba(61,220,132,0.35)', background: 'linear-gradient(180deg, rgba(61,220,132,0.07) 0%, rgba(17,22,20,0.6) 100%)', padding: plegado ? '4px 6px' : '6px 12px 14px' }}>
      <button
        type="button"
        onClick={alternarPlegado}
        aria-expanded={!plegado}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: 'transparent', border: 'none', padding: '8px 4px', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🧾</span>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 19, textTransform: 'uppercase', letterSpacing: '0.03em', color: S.TEXT }}>Mis equipos</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#04140B', background: S.ACCENT, borderRadius: 999, padding: '1px 8px' }}>{enJuego.length} en juego</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: S.MUTED_2 }}>
          {plegado ? 'Mostrar' : 'Ocultar'}
          <span style={{ fontSize: 14, color: S.ACCENT, transform: plegado ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.2s' }}>▼</span>
        </span>
      </button>
      {!plegado && (
      <>
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
                  {s.bolsa && <span style={{ fontSize: 11.5, fontWeight: 700, color: S.ACCENT }}>🎲 En espera del sorteo de rivales</span>}
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
        if (it.tipo === 'lp') {
          const f = it.lp;
          return (
            <div key={it.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: S.PANEL, border: '1px solid rgba(245,201,74,0.45)', borderRadius: 12, padding: '12px 14px' }}>
              <Link href={`/v2/liga-privada/${f.liga_id}`} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1, textDecoration: 'none' }}>
                <span style={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#F5C94A' }}>🔒 Liga privada</span>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.liga_nombre}</span>
                <span style={{ fontSize: 12, color: S.MUTED_2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Jornada {f.numero} · {etiquetaComp(deporte, f.competicion)}
                </span>
                {it.empezada && f.mi_puesto ? (
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: it.finalizada ? S.MUTED_2 : S.ACCENT }}>
                    {it.finalizada ? 'Quedaste' : 'Vas'} {f.mi_puesto}º de {f.con_equipo} · {String(Math.round(Number(f.mi_total ?? 0) * 10) / 10).replace('.', ',')} pts
                  </span>
                ) : (
                  <span style={{ fontSize: 12, color: S.MUTED_2 }}>✓ Equipo hecho · empieza {f.cierre ? new Date(f.cierre).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) : 'pronto'}</span>
                )}
              </Link>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                <Link href={it.empezada ? `/v2/liga-privada/jornada/${f.jornada_id}` : `/v2/liga-privada/jornada/${f.jornada_id}/equipo`} style={botonVer}>
                  {it.empezada ? 'Ver mi equipo' : 'Cambiar equipo'}
                </Link>
                {it.empezada && (
                  <Link href={`/v2/liga-privada/jornada/${f.jornada_id}`} style={botonClasif}>
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
                  {a.nombre} · <span style={{ color: '#F5C94A' }}>{MODALIDAD_LABEL[a.modalidad]}</span>
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
      </>
      )}
    </div>
  );
}
