'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { todasLasFilas } from '@/lib/paginar';
import * as S from '@/lib/mockupStyles';
import MarcoV2, { EtiquetaBeta, Panel, Titulo, V2_COLOR } from '@/components/v2/MarcoV2';
import { useSesionV2 } from '@/components/v2/useSesionV2';
import { EQUIPO_PRESUPUESTO, FORMACIONES_FUTBOL, colorPresupuesto } from '@/lib/draftConfig';
import { formatEuros, huecosPorLinea, lineaDePosicion, type LineaFutbol } from '@/lib/salaShared';
import { TAMANO_EQUIPO_V2, fechaCorta, mensajeError, type Amistoso, type AmistosoJornada } from '@/lib/v2';

// ============================================================================
// DRAFTERS V2 — HACER EL EQUIPO (modalidades "presupuesto" y "libre") (15/10)
// ============================================================================
// Presupuesto: 100.000 €, como en las mesas de siempre. Libre: sin precios ni
// presupuesto. Solo salen los jugadores de los partidos que entran en la sala.

type Jug = { id: string; nombre: string; posicion: string | null; precio: number; equipo_real: string | null; lesionado: boolean };

const LINEAS: LineaFutbol[] = ['POR', 'DEF', 'MED', 'DEL'];
const LINEA_LABEL: Record<LineaFutbol, string> = { POR: 'Porteros', DEF: 'Defensas', MED: 'Centrocampistas', DEL: 'Delanteros' };

function normalizar(t: string) {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export default function V2Equipo() {
  const { id } = useParams<{ id: string }>();
  const competicion = useSearchParams().get('c') ?? '';
  const router = useRouter();
  const { perfil, estado } = useSesionV2();
  const [amistoso, setAmistoso] = useState<Amistoso | null>(null);
  const [jornada, setJornada] = useState<AmistosoJornada | null>(null);
  const [jugadores, setJugadores] = useState<Jug[]>([]);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [alineacion, setAlineacion] = useState('4-3-3');
  const [busqueda, setBusqueda] = useState('');
  const [filtroEquipo, setFiltroEquipo] = useState<string>('');
  const [linea, setLinea] = useState<LineaFutbol>('POR');
  const [verMas, setVerMas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (estado !== 'ok' || !perfil) return;
    (async () => {
      const [{ data: a }, { data: j }, { data: mio }] = await Promise.all([
        supabase.from('amistosos').select('*').eq('id', id).maybeSingle(),
        supabase.from('amistoso_jornadas').select('*').eq('amistoso_id', id).eq('competicion', competicion).maybeSingle(),
        supabase.from('amistoso_equipos').select('jugadores,alineacion').eq('amistoso_id', id).eq('competicion', competicion).eq('usuario_id', perfil.id).maybeSingle(),
      ]);
      const am = a as Amistoso | null;
      const jo = j as AmistosoJornada | null;
      if (!am || !jo) {
        setError('No se ha encontrado esta sala o esta jornada.');
        setCargando(false);
        return;
      }
      const { data: js } = await todasLasFilas<Jug & { baja: boolean | null }>((d, h) =>
        supabase.from('jugadores').select('id,nombre,posicion,precio,equipo_real,lesionado,baja').eq('competicion', competicion).eq('deporte', am.deporte).order('precio', { ascending: false }).order('id').range(d, h)
      );
      const permitidos = jo.equipos_permitidos ? new Set(jo.equipos_permitidos) : null;
      setJugadores(js.filter((x) => !x.baja && (!permitidos || (x.equipo_real && permitidos.has(x.equipo_real)))));
      setAmistoso(am);
      setJornada(jo);
      const m = mio as { jugadores: string[]; alineacion: string | null } | null;
      if (m) {
        setSeleccion(m.jugadores);
        if (m.alineacion) setAlineacion(m.alineacion);
      }
      setCargando(false);
    })();
  }, [estado, perfil, id, competicion]);

  const futbol = amistoso?.deporte === 'futbol';
  const conPrecios = amistoso?.modalidad === 'presupuesto';
  const tamano = TAMANO_EQUIPO_V2[amistoso?.deporte ?? 'golf'];
  const huecos = huecosPorLinea(futbol ? alineacion : null);
  const porId = useMemo(() => new Map(jugadores.map((j) => [j.id, j])), [jugadores]);
  const elegidos = seleccion.map((x) => porId.get(x)).filter(Boolean) as Jug[];
  const gasto = elegidos.reduce((a, j) => a + Number(j.precio), 0);
  const restante = EQUIPO_PRESUPUESTO - gasto;
  const cuentaLinea = (l: LineaFutbol) => elegidos.filter((j) => lineaDePosicion(j.posicion) === l).length;
  const equiposReales = useMemo(() => Array.from(new Set(jugadores.map((j) => j.equipo_real).filter(Boolean) as string[])).sort(), [jugadores]);
  const cerrada = !!jornada?.cierre && new Date(jornada.cierre).getTime() <= Date.now();

  const lista = useMemo(() => {
    const q = normalizar(busqueda);
    return jugadores.filter((j) => {
      if (q && !normalizar(j.nombre).includes(q)) return false;
      if (filtroEquipo && j.equipo_real !== filtroEquipo) return false;
      if (futbol && !q && lineaDePosicion(j.posicion) !== linea) return false;
      return true;
    });
  }, [jugadores, busqueda, filtroEquipo, futbol, linea]);

  function toggle(j: Jug) {
    setError(null);
    if (seleccion.includes(j.id)) return setSeleccion(seleccion.filter((x) => x !== j.id));
    if (seleccion.length >= tamano) return setError(`Ya tienes ${tamano} jugadores. Quita uno para cambiarlo.`);
    if (futbol) {
      const l = lineaDePosicion(j.posicion);
      if (cuentaLinea(l) >= huecos[l]) return setError(`Ya tienes todos los ${LINEA_LABEL[l].toLowerCase()} de la ${alineacion}.`);
    }
    if (conPrecios && gasto + Number(j.precio) > EQUIPO_PRESUPUESTO) return setError('Te pasas del presupuesto.');
    setSeleccion([...seleccion, j.id]);
  }

  function cambiarAlineacion(a: string) {
    const h = huecosPorLinea(a);
    // Si sobran jugadores de alguna línea con la nueva alineación, se quitan los últimos elegidos.
    const nueva: string[] = [];
    const cuenta: Record<LineaFutbol, number> = { POR: 0, DEF: 0, MED: 0, DEL: 0 };
    for (const x of seleccion) {
      const l = lineaDePosicion(porId.get(x)?.posicion ?? null);
      if (cuenta[l] < h[l]) {
        cuenta[l]++;
        nueva.push(x);
      }
    }
    setSeleccion(nueva);
    setAlineacion(a);
  }

  async function guardar() {
    setError(null);
    if (seleccion.length !== tamano) return setError(`Te faltan ${tamano - seleccion.length} jugadores.`);
    setGuardando(true);
    const { error: e } = await supabase.rpc('amistoso_guardar_equipo', { p_amistoso: id, p_competicion: competicion, p_jugadores: seleccion, p_alineacion: futbol ? alineacion : null });
    setGuardando(false);
    if (e) return setError(mensajeError(e));
    router.replace(`/v2/sala/${id}`);
  }

  const visibles = verMas ? lista : lista.slice(0, 60);

  return (
    <MarcoV2 perfil={perfil} estado={estado} deporte={amistoso?.deporte ?? 'futbol'} volverA={`/v2/sala/${id}`}>
      {cargando ? (
        <p style={{ fontSize: 14, color: S.MUTED }}>{error ?? 'Cargando jugadores...'}</p>
      ) : !amistoso || !jornada ? (
        <p style={S.errorText}>{error}</p>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <EtiquetaBeta />
            <Titulo>Tu equipo</Titulo>
            <span style={{ fontSize: 12, color: S.MUTED_2 }}>
              {amistoso.nombre} · {competicion}
              {jornada.cierre ? ` · cierra ${fechaCorta(jornada.cierre)}` : ''}
            </span>
          </div>
          {cerrada && <p style={S.errorText}>La jornada ya ha empezado: no se puede cambiar el equipo.</p>}

          <Panel style={{ position: 'sticky', top: 0, zIndex: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 800, fontSize: 14, color: S.TEXT }}>
                {seleccion.length}/{tamano} jugadores
              </span>
              {conPrecios ? <span style={{ fontWeight: 800, fontSize: 14, color: colorPresupuesto(restante) }}>Quedan {formatEuros(restante)}</span> : <span style={{ fontSize: 12, color: V2_COLOR, fontWeight: 700 }}>Modo libre · sin presupuesto</span>}
            </div>
            {futbol && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {FORMACIONES_FUTBOL.map((f) => (
                  <button key={f.alineacion} type="button" style={S.pill(alineacion === f.alineacion)} onClick={() => cambiarAlineacion(f.alineacion)}>
                    {f.label}
                  </button>
                ))}
              </div>
            )}
            {elegidos.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {elegidos.map((j) => (
                  <button key={j.id} type="button" onClick={() => toggle(j)} style={{ fontSize: 11.5, color: S.TEXT, background: 'rgba(61,220,132,0.12)', border: '1px solid rgba(61,220,132,0.35)', borderRadius: 999, padding: '4px 10px', cursor: 'pointer' }}>
                    {futbol ? `${lineaDePosicion(j.posicion)} · ` : ''}
                    {j.nombre} ✕
                  </button>
                ))}
              </div>
            )}
            {error && <p style={S.errorText}>{error}</p>}
            <button type="button" onClick={guardar} disabled={guardando || cerrada} style={{ ...S.primaryButton, background: V2_COLOR, opacity: guardando || cerrada || seleccion.length !== tamano ? 0.55 : 1 }}>
              {guardando ? 'Guardando...' : 'Guardar equipo'}
            </button>
          </Panel>

          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar jugador..." style={S.input} />
          {futbol && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {LINEAS.map((l) => (
                <button key={l} type="button" style={S.pill(linea === l)} onClick={() => setLinea(l)}>
                  {LINEA_LABEL[l]} {cuentaLinea(l)}/{huecos[l]}
                </button>
              ))}
            </div>
          )}
          {futbol && equiposReales.length > 1 && (
            <select value={filtroEquipo} onChange={(e) => setFiltroEquipo(e.target.value)} style={S.selectInput}>
              <option value="">Todos los equipos ({equiposReales.length})</option>
              {equiposReales.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {visibles.map((j) => {
              const on = seleccion.includes(j.id);
              return (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => toggle(j)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', background: on ? 'rgba(61,220,132,0.1)' : S.PANEL, border: `1px solid ${on ? 'rgba(61,220,132,0.45)' : S.CARD_BORDER}`, borderRadius: 12, padding: '10px 12px', cursor: 'pointer' }}
                >
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontWeight: 700, fontSize: 13.5, color: S.TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {j.nombre} {j.lesionado ? '🚑' : ''}
                    </span>
                    {futbol && <span style={{ fontSize: 11, color: S.MUTED_3 }}>{j.equipo_real}</span>}
                  </span>
                  {conPrecios && <span style={{ fontWeight: 700, fontSize: 13, color: S.MUTED }}>{formatEuros(Number(j.precio))}</span>}
                  <span style={{ width: 24, height: 24, borderRadius: 999, border: `1.5px solid ${on ? S.ACCENT : S.BORDER}`, background: on ? S.ACCENT : 'transparent', color: '#04140B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 13 }}>{on ? '✓' : '+'}</span>
                </button>
              );
            })}
            {lista.length > visibles.length && (
              <button type="button" onClick={() => setVerMas(true)} style={S.secondaryLinkButton}>
                Mostrar los {lista.length - visibles.length} restantes
              </button>
            )}
            {lista.length === 0 && <p style={{ fontSize: 13, color: S.MUTED_3 }}>{jugadores.length === 0 ? 'Todavía no hay jugadores cargados para esta jornada. Podrás hacer el equipo en cuanto se publique.' : 'No hay jugadores con ese filtro.'}</p>}
          </div>
        </>
      )}
    </MarcoV2>
  );
}
