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
import { fechaCorta, mensajeError } from '@/lib/v2';

// ============================================================================
// MESAS DE LIGA DE UN DEPORTE (V2, 15/10)
// ============================================================================
// Las mesas Drafters de siempre, pero se entra con 1 crédito del deporte (no
// con €). Se enseña una mesa de cada tipo y tamaño (las de 10 €; el importe ya
// no cuenta en V2). Máximo 3 mesas por jornada (fútbol) o semana (golf/tenis).

type Sala = { id: string; nombre: string; competicion: string; tipo: TipoSala; aforo: number | null; buy_in: number; estado: string; fecha_limite_inscripcion: string | null };
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
  const [verMias, setVerMias] = useState<'en_juego' | 'finalizadas'>('en_juego');
  const [aviso, setAviso] = useState<string | null>(null);
  const [recargarPara, setRecargarPara] = useState<string | null>(null);
  const [entrando, setEntrando] = useState<string | null>(null);
  const [cambiadas, setCambiadas] = useState<Set<string>>(new Set());
  const previos = useRef<Map<string, number> | null>(null);

  const cargarSalas = useCallback(async () => {
    const { data } = await todasLasFilas<Sala>((d, h) =>
      supabase.from('salas').select('id,nombre,competicion,tipo,aforo,buy_in,estado,fecha_limite_inscripcion').eq('deporte', deporte).neq('tipo', 'maraton').order('id').range(d, h)
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
    () => (salas ?? []).filter((s) => Number(s.buy_in) === 10 && s.estado !== 'finalizada' && s.estado !== 'completa' && (!s.fecha_limite_inscripcion || new Date(s.fecha_limite_inscripcion).getTime() > ahora)),
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
        const k = `${s.tipo}-${s.aforo}`;
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

  const salaRef = mesas[0] ?? abiertas.find((s) => s.competicion === compActiva) ?? null;
  const periodoActivo = salaRef ? periodoDe(deporte, salaRef) : null;
  const misEnPeriodo = misEquipos.filter((e) => e.salas && periodoDe(deporte, e.salas) === periodoActivo).length;

  async function entrar(s: Sala) {
    setAviso(null);
    setEntrando(s.id);
    const { data, error } = await supabase.rpc('v2_info_entrada', { p_sala: s.id });
    setEntrando(null);
    if (error) return setAviso(mensajeError(error));
    const info = data as { saldo: number; mesas: number; maximo: number };
    if (info.mesas >= info.maximo) return setAviso(`Ya tienes ${info.maximo} mesas ${deporte === 'futbol' ? 'en esta jornada' : 'esta semana'}: es el máximo.`);
    if (info.saldo < 1) return setRecargarPara(s.id);
    router.push(`/salas/${s.id}/crear-equipo?v2=1`);
  }

  const enJuego = misEquipos.filter((e) => e.salas && e.salas.estado !== 'finalizada');
  const finalizadas = misEquipos.filter((e) => e.salas && e.salas.estado === 'finalizada');
  const listaMias = verMias === 'en_juego' ? enJuego : finalizadas;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 15/10 (Iñi): enlace a la clasificación de la liga del deporte. */}
      <Link
        href={`/v2/${deporte}/clasificacion`}
        style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', borderRadius: 14, padding: '13px 16px', border: '1px solid rgba(240,185,77,0.45)', background: 'linear-gradient(135deg, #2A2210 0%, #3A2E12 100%)' }}
      >
        <span style={{ fontSize: 22 }}>🏆</span>
        <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 18, color: '#F0B94D' }}>Clasificación de la liga</span>
          <span style={{ fontSize: 11.5, color: S.MUTED_2 }}>Tus draftis y los de todos los que juegan la liga de {deporte === 'futbol' ? 'fútbol' : deporte}</span>
        </span>
        <span style={{ fontSize: 18, color: '#F0B94D' }}>›</span>
      </Link>

      {misEquipos.length > 0 && (
        <Panel>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" style={S.pill(verMias === 'en_juego')} onClick={() => setVerMias('en_juego')}>
              Mis mesas en juego ({enJuego.length})
            </button>
            <button type="button" style={S.pill(verMias === 'finalizadas')} onClick={() => setVerMias('finalizadas')}>
              Finalizadas ({finalizadas.length})
            </button>
          </div>
          {listaMias.length === 0 && <span style={{ fontSize: 12.5, color: S.MUTED_3 }}>Nada por aquí.</span>}
          {listaMias.slice(0, 8).map((e) => {
            const s = e.salas as Sala;
            const empezada = !!s.fecha_limite_inscripcion && new Date(s.fecha_limite_inscripcion).getTime() <= ahora;
            return (
              <Link key={e.id} href={empezada ? `/salas/${s.id}/clasificacion` : `/salas/${s.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', padding: '8px 0', borderTop: `1px solid ${S.CARD_BORDER}` }}>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: '#F0B94D', textTransform: 'uppercase' }}>{etiquetaComp(deporte, s.competicion)}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: S.TEXT }}>
                    {TIPO_SALA_LABELS[s.tipo]} · {s.aforo} jugadores
                  </span>
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: s.estado === 'finalizada' ? S.MUTED_3 : empezada ? '#FF5C5C' : S.ACCENT }}>{s.estado === 'finalizada' ? 'Ver resultado' : empezada ? '● En directo' : 'Esperando'}</span>
              </Link>
            );
          })}
        </Panel>
      )}

      {salas === null && <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>Cargando mesas...</p>}
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mesas.map((s) => {
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
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ fontWeight: 800, fontSize: 15, color: S.TEXT }}>{TIPO_SALA_LABELS[s.tipo]}</span>
                    <span style={{ fontSize: 11.5, color: S.MUTED_2 }}>
                      {aforo} jugadores · {ganan === 1 ? 'gana 1' : `ganan ${ganan}`}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, maxWidth: 140, height: 5, borderRadius: 99, background: '#1E2723', overflow: 'hidden' }}>
                        <motion.div animate={{ width: `${aforo ? (n / aforo) * 100 : 0}%` }} style={{ height: '100%', background: S.ACCENT }} />
                      </div>
                      <span style={{ fontSize: 11, color: S.MUTED_3 }}>
                        {n}/{aforo}
                      </span>
                    </div>
                  </div>
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
        </>
      )}

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
