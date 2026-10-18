'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import { todasLasFilas } from '@/lib/paginar';
import * as S from '@/lib/mockupStyles';
import { TIPO_SALA_LABELS } from '@/lib/salaShared';
import type { TipoSala } from '@/lib/repartoPremios';
import { IconoCredito, type DeporteV2 } from '@/components/v2/IconosV2';
import { RecargaVideo, avisarCambioCreditos } from '@/components/v2/creditos';
import { Panel } from '@/components/v2/MarcoV2';
import PanelLiga, { type Info as InfoLiga } from '@/components/v2/PanelLiga';
import { fechaCorta, mensajeError } from '@/lib/v2';
import Cargando from '@/components/Cargando';
import EtiquetaTramo from '@/components/v2/EtiquetaTramo';
import { ordenTramo } from '@/lib/tramos';

// ============================================================================
// MESAS DE LIGA DE UN DEPORTE (V2, 15/10)
// ============================================================================
// Mesas propias de la liga V2 (salas.version = 2, separadas de las de la V1
// desde el 15/10): se entra con 1 crédito del deporte y se juegan draftis. Se
// enseña una mesa de cada tipo y tamaño. Máximo 3 mesas por jornada (fútbol) o
// semana (golf/tenis).

type Sala = { id: string; nombre: string; competicion: string; tipo: TipoSala; aforo: number | null; buy_in: number; estado: string; fecha_limite_inscripcion: string | null; tramo?: string | null; bolsa?: boolean };
type MiEquipo = { id: string; sala_id: string; salas: Sala | null; inscripciones: { estado: string }[] };

const GANAN: Record<string, (aforo: number) => number> = {
  doble_o_nada: (a) => a / 2,
  triple_o_nada: (a) => a / 3,
  oro_y_plata: () => 2,
  tridente: () => 3,
};

function lunes(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const dia = (d.getDay() + 6) % 7;
  const l = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dia);
  return l.toISOString().slice(0, 10);
}
function periodoDe(deporte: DeporteV2, s: Sala): string {
  return deporte === 'futbol' ? s.competicion : `semana ${lunes(s.fecha_limite_inscripcion)}`;
}
function etiquetaComp(deporte: DeporteV2, c: string): string {
  if (deporte !== 'futbol') return c;
  const liga = c.replace(/\s*-\s*Jornada.*$/i, '');
  const n = c.match(/Jornada\s*(\d+)/i)?.[1];
  return n ? `${liga.replace('Champions League', 'Champions')} · J${n}` : c;
}

export default function MesasLiga({ deporte, miId }: { deporte: DeporteV2; miId: string }) {
  const router = useRouter();
  const [salas, setSalas] = useState<Sala[] | null>(null);
  const [inscritos, setInscritos] = useState<Map<string, number>>(new Map());
  const [misEquipos, setMisEquipos] = useState<MiEquipo[]>([]);
  const [comp, setComp] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [recargarPara, setRecargarPara] = useState<string | null>(null);
  const [entrando, setEntrando] = useState<string | null>(null);
  const [cambiadas, setCambiadas] = useState<Set<string>>(new Set());
  const [pedirApuntarse, setPedirApuntarse] = useState<Sala | null>(null);
  const [apuntando, setApuntando] = useState(false);
  // Nº de partidos de cada día (para la etiqueta "Solo partidos del sábado · 4 partidos").
  const [partidosPorTramo, setPartidosPorTramo] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (deporte !== 'futbol') return;
    void supabase.rpc('v2_tramos_disponibles', { p_deporte: deporte }).then(({ data }) => {
      const m = new Map<string, number>();
      ((data as { competicion: string; tramo: string; partidos: number | null }[]) ?? []).forEach((x) => x.partidos && m.set(`${x.competicion}|${x.tramo}`, x.partidos));
      setPartidosPorTramo(m);
    });
  }, [deporte, salas]);
  const previos = useRef<Map<string, number> | null>(null);
  // 15/10 (Iñi): las mesas de la liga son solo para los apuntados. Si no lo
  // estás, en vez de las mesas se ve directamente la información de la
  // temporada con el botón grande para apuntarte.
  const [temporada, setTemporada] = useState<InfoLiga | null | undefined>(undefined);
  const cargarLiga = useCallback(async () => {
    const { data } = await supabase.rpc('v2_liga_info', { p_deporte: deporte });
    setTemporada((data as InfoLiga | null) ?? null);
  }, [deporte]);
  useEffect(() => {
    void cargarLiga();
  }, [cargarLiga]);
  const sinApuntar = !!temporada && !temporada.yo;

  const cargarSalas = useCallback(async () => {
    // 17/10: antes de leerlas, que existan las mesas de un solo día (fútbol)
    // o de una sola ronda (golf) de las jornadas/torneos abiertos (SQL 49).
    await supabase.rpc('v2_asegurar_mesas_tramo', { p_deporte: deporte });
    // 18/10: las mesas de la liga se sortean al cerrar (SQL 52); por si el cron no ha pasado aún.
    await supabase.rpc('v2_sortear_pendientes');
    const { data } = await todasLasFilas<Sala>((d, h) =>
      supabase.from('salas').select('id,nombre,competicion,tipo,aforo,buy_in,estado,fecha_limite_inscripcion,tramo,bolsa').eq('deporte', deporte).eq('version', 2).neq('tipo', 'maraton').order('id').range(d, h)
    );
    setSalas(data);
  }, [deporte]);

  const cargarInscritos = useCallback(async () => {
    const { data } = await supabase.rpc('inscritos_por_sala');
    const m = new Map<string, number>();
    ((data as { sala_id: string; inscritos: number }[]) ?? []).forEach((f) => m.set(f.sala_id, Number(f.inscritos)));
    if (previos.current) {
      const c = new Set<string>();
      m.forEach((n, id) => previos.current?.get(id) !== n && c.add(id));
      if (c.size) {
        setCambiadas(c);
        setTimeout(() => setCambiadas(new Set()), 2500);
      }
    }
    previos.current = m;
    setInscritos(m);
  }, []);

  const cargarMios = useCallback(async () => {
    const { data } = await supabase
      .from('equipos')
      .select('id,sala_id,salas!inner(id,nombre,competicion,tipo,aforo,buy_in,estado,fecha_limite_inscripcion,deporte),inscripciones(estado)')
      .eq('usuario_id', miId)
      .eq('salas.deporte', deporte)
      .eq('salas.version', 2)
      .order('created_at', { ascending: false });
    setMisEquipos(((data as unknown as MiEquipo[]) ?? []).filter((e) => e.inscripciones.some((i) => i.estado !== 'reembolsada')));
  }, [miId, deporte]);

  useEffect(() => {
    void Promise.all([cargarSalas(), cargarInscritos(), cargarMios()]);
    let vueltas = 0;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      vueltas++;
      void cargarInscritos();
      if (vueltas % 6 === 0) void Promise.all([cargarSalas(), cargarMios()]);
    }, 5000);
    return () => clearInterval(id);
  }, [cargarSalas, cargarInscritos, cargarMios]);

  const ahora = Date.now();
  const abiertas = useMemo(
    () => (salas ?? []).filter((s) => s.estado !== 'finalizada' && s.estado !== 'completa' && (!s.fecha_limite_inscripcion || new Date(s.fecha_limite_inscripcion).getTime() > ahora)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [salas]
  );
  // Competiciones abiertas, la más próxima primero.
  const competiciones = useMemo(() => {
    const m = new Map<string, number>();
    abiertas.forEach((s) => {
      const t = s.fecha_limite_inscripcion ? new Date(s.fecha_limite_inscripcion).getTime() : Infinity;
      m.set(s.competicion, Math.min(m.get(s.competicion) ?? Infinity, t));
    });
    return Array.from(m.entries()).sort((a, b) => a[1] - b[1]).map(([c, t]) => ({ c, t }));
  }, [abiertas]);
  const compActiva = comp && competiciones.some((x) => x.c === comp) ? comp : competiciones[0]?.c ?? null;

  const tCierre = competiciones.find((x) => x.c === compActiva)?.t;
  const cierreActivo = tCierre && Number.isFinite(tCierre) ? new Date(tCierre).toISOString() : null;
  const misSalaIds = new Set(misEquipos.map((e) => e.sala_id));
  // Una mesa por tipo y tamaño: la que tenga más gente (sin estar llena).
  const mesas = useMemo(() => {
    const porVariante = new Map<string, Sala>();
    abiertas
      .filter((s) => s.competicion === compActiva)
      .forEach((s) => {
        const k = `${s.tramo ?? ''}-${s.tipo}-${s.aforo}`;
        const actual = porVariante.get(k);
        const yoEstoy = misSalaIds.has(s.id);
        if (!actual || (yoEstoy && !misSalaIds.has(actual.id)) || (!misSalaIds.has(actual.id) && (inscritos.get(s.id) ?? 0) > (inscritos.get(actual.id) ?? 0))) porVariante.set(k, s);
      });
    return Array.from(porVariante.values()).sort((a, b) => {
      const fa = (inscritos.get(a.id) ?? 0) / (a.aforo ?? 1);
      const fb = (inscritos.get(b.id) ?? 0) / (b.aforo ?? 1);
      return fb - fa || (a.aforo ?? 0) - (b.aforo ?? 0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abiertas, compActiva, inscritos, misEquipos]);

  // Tramos de la competición elegida (completa primero) y su cierre.
  const tramosVisibles = Array.from(new Set(mesas.map((s) => s.tramo ?? ''))).sort((a, b) => ordenTramo(a || null).localeCompare(ordenTramo(b || null)));
  const cierreDeTramo = (t: string): string | null => {
    const fechas = abiertas.filter((s) => s.competicion === compActiva && (s.tramo ?? '') === t && s.fecha_limite_inscripcion).map((s) => s.fecha_limite_inscripcion as string);
    return fechas.length ? fechas.sort()[0] : null;
  };
  const partidosDeTramo = (t: string): number | null => (t ? (partidosPorTramo.get(`${compActiva}|${t}`) ?? null) : null);

  const salaRef = mesas[0] ?? abiertas.find((s) => s.competicion === compActiva) ?? null;
  const periodoActivo = salaRef ? periodoDe(deporte, salaRef) : null;
  const misEnPeriodo = misEquipos.filter((e) => e.salas && periodoDe(deporte, e.salas) === periodoActivo).length;

  async function entrar(s: Sala) {
    setAviso(null);
    setEntrando(s.id);
    const { data, error } = await supabase.rpc('v2_info_entrada', { p_sala: s.id });
    setEntrando(null);
    if (error) return setAviso(mensajeError(error));
    const info = data as { saldo: number; mesas: number; maximo: number; apuntado?: boolean };
    if (info.apuntado === false) return setPedirApuntarse(s);
    if (info.mesas >= info.maximo) return setAviso(`Ya tienes ${info.maximo} mesas ${deporte === 'futbol' ? 'en esta jornada' : 'esta semana'}: es el máximo.`);
    if (info.saldo < 1) return setRecargarPara(s.id);
    router.push(`/salas/${s.id}/crear-equipo?v2=1`);
  }


  if (temporada === undefined) return <Cargando compacto />;
  if (temporada === null)
    return (
      <div style={{ background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontWeight: 800, fontSize: 15, color: S.TEXT }}>La liga todavía no ha abierto temporada</span>
        <span style={{ fontSize: 13, color: S.MUTED_2, lineHeight: 1.5 }}>En cuanto se abra podrás apuntarte desde aquí y jugar sus mesas. Mientras tanto puedes jugar amistosos.</span>
      </div>
    );
  // 18/10 (Iñi): aunque no estés apuntado, primero se ven las mesas (y cuánta
  // gente hay); te apuntas al entrar en la primera, y la info de la liga va abajo.
  async function apuntarseYEntrar(s: Sala) {
    setApuntando(true);
    const { error } = await supabase.rpc('v2_apuntarse_liga', { p_deporte: deporte });
    setApuntando(false);
    if (error) return setAviso(mensajeError(error));
    setPedirApuntarse(null);
    await cargarLiga();
    void entrar(s);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {sinApuntar && temporada && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderRadius: 12, padding: '10px 14px', border: '1px solid rgba(240,185,77,0.4)', background: 'rgba(240,185,77,0.07)' }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#F0B94D' }}>Todavía no estás apuntado a la {temporada.liga}</span>
          <span style={{ fontSize: 12, color: S.MUTED_2, lineHeight: 1.45 }}>Es gratis: te apuntamos al entrar en tu primera mesa. Debajo tienes toda la información de la temporada y quién está apuntado.</span>
        </div>
      )}
      {/* 15/10 (Iñi): enlace a la clasificación de la liga del deporte. */}
      <Link
        href={`/v2/${deporte}/clasificacion`}
        style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', borderRadius: 14, padding: '13px 16px', border: '1px solid rgba(240,185,77,0.45)', background: 'linear-gradient(135deg, #2A2210 0%, #3A2E12 100%)' }}
      >
        <span style={{ fontSize: 22 }}>🏆</span>
        <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 18, color: '#F0B94D' }}>Clasificación · {temporada.liga}</span>
          <span style={{ fontSize: 11.5, color: S.MUTED_2 }}>
            {temporada
              ? temporada.en_curso
                ? `Temporada ${temporada.numero} en juego · tus draftis y los de todos`
                : `La Temporada ${temporada.numero} empieza el ${new Date(temporada.inicio).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`
              : `Tus draftis y los de todos los que juegan la liga de ${deporte === 'futbol' ? 'fútbol' : deporte}`}
          </span>
        </span>
        <span style={{ fontSize: 18, color: '#F0B94D' }}>›</span>
      </Link>

      {/* 16/10: "mis mesas" se ve ahora arriba, en el recuadro de mis equipos (MisEquiposV2). */}

      {salas === null && <Cargando compacto />}
      {salas !== null && competiciones.length === 0 && <p style={{ fontSize: 13, color: S.MUTED_3, margin: 0 }}>Ahora mismo no hay mesas abiertas. En cuanto se abra la próxima {deporte === 'futbol' ? 'jornada' : 'semana de torneos'}, aparecerán aquí.</p>}

      {competiciones.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
            {competiciones.map(({ c }) => (
              <button key={c} type="button" style={{ ...S.pill(c === compActiva), flexShrink: 0 }} onClick={() => setComp(c)}>
                {etiquetaComp(deporte, c)}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12, color: S.MUTED_2 }}>
            <span>{cierreActivo ? `Cierra ${fechaCorta(cierreActivo)}` : ''}</span>
            <span style={{ fontWeight: 700, color: misEnPeriodo >= 3 ? '#F0B94D' : S.MUTED }}>
              {misEnPeriodo}/3 mesas {deporte === 'futbol' ? 'esta jornada' : 'esta semana'}
            </span>
          </div>
          {aviso && <p style={{ ...S.errorText, fontSize: 12.5 }}>{aviso}</p>}

          {/* 17/10 (Iñi): un bloque por tramo — jornada/torneo completo, cada día
              con 3+ partidos (fútbol) y cada ronda / fin de semana (golf). */}
          {tramosVisibles.map((t) => (
          <div key={t || 'completa'} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
              <EtiquetaTramo tramo={t || null} deporte={deporte} completa partidos={partidosDeTramo(t)} />
              {cierreDeTramo(t) && <span style={{ fontSize: 11.5, color: S.MUTED_2 }}>Cierra {fechaCorta(cierreDeTramo(t))}</span>}
            </div>
            {mesas.filter((s) => (s.tramo ?? '') === t).map((s) => {
              const n = inscritos.get(s.id) ?? 0;
              const aforo = s.aforo ?? 0;
              const dentro = misSalaIds.has(s.id);
              const ganan = GANAN[s.tipo]?.(aforo) ?? 1;
              return (
                <motion.div
                  layout
                  key={s.id}
                  style={{ background: cambiadas.has(s.id) ? 'rgba(61,220,132,0.1)' : S.PANEL, border: `1px solid ${dentro ? 'rgba(61,220,132,0.45)' : S.CARD_BORDER}`, borderRadius: 14, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, transition: 'background 0.6s' }}
                >
                  <Link href={`/salas/${s.id}`} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5, textDecoration: 'none' }}>
                    <span style={{ fontWeight: 800, fontSize: 15, color: S.TEXT }}>
                      {TIPO_SALA_LABELS[s.tipo]} <span style={{ fontSize: 11, color: S.MUTED_3, fontWeight: 700 }}>ⓘ</span>
                    </span>
                    {s.tramo && <EtiquetaTramo tramo={s.tramo} deporte={deporte} compacta />}
                    <span style={{ fontSize: 11.5, color: S.MUTED_2 }}>
                      Mesas de {aforo} · {ganan === 1 ? 'gana 1' : `ganan ${ganan}`}
                    </span>
                    {s.bolsa ? (
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: n > 0 ? S.ACCENT : S.MUTED_3 }}>
                          👥 {n} {n === 1 ? 'apuntado' : 'apuntados'}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: S.MUTED_3 }}>🎲 Rivales por sorteo al cerrar</span>
                      </span>
                    ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, maxWidth: 140, height: 5, borderRadius: 99, background: '#1E2723', overflow: 'hidden' }}>
                        <motion.div animate={{ width: `${aforo ? (n / aforo) * 100 : 0}%` }} style={{ height: '100%', background: S.ACCENT }} />
                      </div>
                      <span style={{ fontSize: 11, color: S.MUTED_3 }}>
                        {n}/{aforo}
                      </span>
                    </div>
                    )}
                  </Link>
                  {dentro ? (
                    <Link href={`/salas/${s.id}`} style={{ flexShrink: 0, whiteSpace: 'nowrap', fontSize: 12, fontWeight: 800, color: S.ACCENT, textDecoration: 'none', border: `1px solid rgba(61,220,132,0.45)`, borderRadius: 10, padding: '8px 10px' }}>
                      Ya estás ✓
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled={entrando === s.id}
                      onClick={() => entrar(s)}
                      style={{ flexShrink: 0, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 7, background: S.ACCENT, color: '#04140B', border: 'none', borderRadius: 10, padding: '10px 14px', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 16, letterSpacing: '0.02em', cursor: 'pointer', opacity: entrando === s.id ? 0.6 : 1 }}
                    >
                      ENTRAR · 1 <IconoCredito size={13} oscuro />
                    </button>
                  )}
                </motion.div>
              );
            })}
          </div>
          ))}
        </>
      )}

      {pedirApuntarse && temporada && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(4,8,6,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 380, background: '#0F1513', border: `1px solid ${S.CARD_BORDER}`, borderRadius: 18, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, color: S.TEXT }}>Apúntate a la {temporada.liga}</span>
            <span style={{ fontSize: 13, color: S.MUTED_2, lineHeight: 1.5 }}>
              Las mesas de la liga son para los apuntados. Es gratis: te apuntamos a la Temporada {temporada.numero} ({temporada.apuntados} {temporada.apuntados === 1 ? 'apuntado' : 'apuntados'} ya) y sigues a hacer tu equipo.
            </span>
            <button type="button" disabled={apuntando} onClick={() => void apuntarseYEntrar(pedirApuntarse)} style={{ ...S.primaryButton, opacity: apuntando ? 0.6 : 1 }}>
              {apuntando ? 'Apuntando...' : 'Apuntarme gratis y entrar'}
            </button>
            <button type="button" onClick={() => setPedirApuntarse(null)} style={{ background: 'transparent', border: 'none', color: S.MUTED_2, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              Ahora no
            </button>
          </div>
        </div>
      )}

      {sinApuntar && temporada && <PanelLiga info={temporada} deporte={deporte} onApuntado={() => void cargarLiga()} />}

      {recargarPara && (
        <RecargaVideo
          deporte={deporte}
          salaId={recargarPara}
          onCerrar={() => setRecargarPara(null)}
          onRecargado={() => {
            avisarCambioCreditos();
          }}
        />
      )}
    </div>
  );
}
