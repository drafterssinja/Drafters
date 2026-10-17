'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { TIPO_SALA_LABELS, DEPORTE_LABELS, Deporte } from '@/lib/salaShared';
import { TipoSala } from '@/lib/repartoPremios';
import { PorraFormato, PORRA_FORMATO_LABELS } from '@/lib/porraFormato';
import Cargando from '@/components/Cargando';
import { etiquetaTramoCorta } from '@/lib/tramos';

// ============================================================================
// PAGOS PENDIENTES — liquidación de salas y porras (nuevo, 29/09)
// ============================================================================
// Pedido de Iñi: "hay que implementar que cuando una porra o una mesa
// drafter acaba, hay que repartir esos pagos... diseña lo que haga falta".
// Aquí "acabada" pasa a significar, a partir de ahora, "ya liquidada": no
// hay un estado intermedio — el admin decide, desde aquí, que los
// resultados de una sala/porra ya están completos, revisa el reparto
// propuesto (con empates ya resueltos, ver lib/repartoPremios.ts) y lo
// confirma. Eso es lo que de verdad reparte el dinero, guarda la posición
// final de cada equipo y marca la sala/porra como 'finalizada' — todo en una
// sola transacción (liquidar_evento() en drafters-schema.sql).
//
// Pedido de Iñi (respuesta a la pregunta de automatizar el pago): "opción 1
// [revisar y confirmar a mano], pero en cuanto nos aseguremos que todo está
// funcionando bien, lo cambiaremos a automático" — de ahí que liquidar_evento()
// ya acepte llamadas de un cron/ruta de servicio además de un admin logueado,
// aunque de momento el único disparador sea el botón de esta pantalla.
//
// Esta pantalla lista TODO lo que todavía no se ha liquidado (no se filtra
// por estado — una sala puede llevar tiempo marcada "finalizada" a mano,
// con el botón antiguo de /admin/mesas-drafters, sin que eso signifique que
// ya se pagó) y deja que sea el admin quien juzgue si ya toca liquidar cada
// una, entrando en su ficha (/admin/pagos-pendientes/sala/[id] o
// .../porra/[id]) para ver el reparto propuesto antes de confirmar.

type SalaFila = { id: string; nombre: string; deporte: Deporte; tipo: TipoSala; estado: string; buy_in: number; competicion: string; tramo?: string | null };
type PorraFila = { id: string; major: string; formato: PorraFormato; estado: string; precio: number };
type LiquidacionFila = { tipo: string; sala_id: string | null; porra_id: string | null };
type EquipoFila = { sala_id: string | null; porra_id: string | null; inscripciones: { estado: string }[] };
// 17/10: un bloque por jornada/torneo Y tramo (completa, un día, una ronda).
type GrupoCompeticion = { clave: string; competicion: string; tramo: string | null; deporte: Deporte; mesas: number };
type EstadoGrupo = { listo: boolean; motivoNoListo: string | null; mesasJugadas: number; equipos: number };

// 12/10, pedido de Iñi: solo se listan las mesas/porras que se han jugado
// (con al menos un equipo con inscripción no reembolsada) — las vacías no
// tienen nada que liquidar. Y antes del listado, un bloque por jornada /
// torneo para liquidar todas sus mesas de golpe
// (/api/admin/liquidar-competicion).
async function todasLasFilas<T>(consulta: (desde: number, hasta: number) => PromiseLike<{ data: unknown }>): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data } = await consulta(desde, desde + 999);
    const lote = (data as T[]) ?? [];
    filas.push(...lote);
    if (lote.length < 1000) break;
  }
  return filas;
}

export default function AdminPagosPendientesPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);

  const [salas, setSalas] = useState<SalaFila[]>([]);
  const [porras, setPorras] = useState<PorraFila[]>([]);
  const [grupos, setGrupos] = useState<GrupoCompeticion[]>([]);
  const [estadoGrupos, setEstadoGrupos] = useState<Record<string, EstadoGrupo>>({});
  const [liquidandoGrupo, setLiquidandoGrupo] = useState<string | null>(null);
  const [mensajeGrupo, setMensajeGrupo] = useState<{ competicion: string; texto: string; ok: boolean } | null>(null);
  const [recargar, setRecargar] = useState(0);

  useEffect(() => {
    let activo = true;

    async function cargar() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      const { data: perfilData } = await supabase.from('perfiles').select('*').eq('id', session.user.id).single();

      if (!activo) return;

      const p = perfilData as Perfil | null;
      if (!p || p.rol !== 'admin') {
        router.push('/cuenta');
        return;
      }

      setPerfil(p);
      setAutorizado(true);

      const [salasData, porrasData, liquidadas, equiposData] = await Promise.all([
        todasLasFilas<SalaFila>((d, h) => supabase.from('salas').select('id, nombre, deporte, tipo, estado, buy_in, competicion, tramo').order('created_at', { ascending: false }).range(d, h)),
        todasLasFilas<PorraFila>((d, h) => supabase.from('porras').select('id, major, formato, estado, precio').order('created_at', { ascending: false }).range(d, h)),
        todasLasFilas<LiquidacionFila>((d, h) => supabase.from('liquidaciones').select('tipo, sala_id, porra_id').range(d, h)),
        todasLasFilas<EquipoFila>((d, h) => supabase.from('equipos').select('sala_id, porra_id, inscripciones(estado)').range(d, h)),
      ]);

      if (!activo) return;

      const salasJugadas = new Set<string>();
      const porrasJugadas = new Set<string>();
      equiposData.forEach((e) => {
        if (!(e.inscripciones ?? []).some((i) => i.estado !== 'reembolsada')) return;
        if (e.sala_id) salasJugadas.add(e.sala_id);
        if (e.porra_id) porrasJugadas.add(e.porra_id);
      });
      const salasLiquidadas = new Set(liquidadas.filter((l) => l.tipo === 'sala').map((l) => l.sala_id));
      const porrasLiquidadas = new Set(liquidadas.filter((l) => l.tipo === 'porra').map((l) => l.porra_id));

      // 04/10, pedido de Iñi: las que ya están finalizadas (el torneo ha
      // terminado) y pendientes de liquidar tienen que verse las primeras —
      // son las urgentes, frente a las que todavía están en juego y a las
      // que todavía les queda esperar. Orden estable: dentro de cada grupo
      // (finalizadas / no finalizadas) se mantiene el orden ya traído de la
      // consulta (created_at descendente).
      const porPrioridadFinalizada = <T extends { estado: string }>(a: T, b: T) =>
        Number(b.estado === 'finalizada') - Number(a.estado === 'finalizada');

      const salasPendientes = salasData.filter((s) => !salasLiquidadas.has(s.id) && salasJugadas.has(s.id)).sort(porPrioridadFinalizada);
      setSalas(salasPendientes);
      setPorras(porrasData.filter((p2) => !porrasLiquidadas.has(p2.id) && porrasJugadas.has(p2.id)).sort(porPrioridadFinalizada));

      const mapaGrupos = new Map<string, GrupoCompeticion>();
      salasPendientes.forEach((s) => {
        const clave = `${s.competicion}|${s.tramo ?? ''}`;
        const g = mapaGrupos.get(clave) ?? { clave, competicion: s.competicion, tramo: s.tramo ?? null, deporte: s.deporte, mesas: 0 };
        g.mesas += 1;
        mapaGrupos.set(clave, g);
      });
      const listaGrupos = Array.from(mapaGrupos.values());
      setGrupos(listaGrupos);

      // Estado de cada jornada/torneo (¿ha terminado ya?) — lo calcula el servidor.
      const estados: Record<string, EstadoGrupo> = {};
      await Promise.all(
        listaGrupos.map(async (g) => {
          try {
            const r = await fetch('/api/admin/liquidar-competicion', {
              method: 'POST',
              headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ competicion: g.competicion, tramo: g.tramo, soloComprobar: true }),
            });
            if (r.ok) estados[g.clave] = (await r.json()) as EstadoGrupo;
          } catch {
            // sin estado: se muestra igual, sin el aviso
          }
        })
      );
      if (activo) setEstadoGrupos(estados);
    }

    cargar();
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, recargar]);

  async function liquidarGrupo(g: GrupoCompeticion) {
    const estado = estadoGrupos[g.clave];
    const nombreGrupo = g.tramo ? `${g.competicion} (${etiquetaTramoCorta(g.tramo, g.deporte)})` : g.competicion;
    const sinMotor = g.deporte !== 'futbol' && g.deporte !== 'golf';
    if (sinMotor) return;
    let forzar = false;
    if (estado && !estado.listo) {
      if (!window.confirm(`OJO: ${estado.motivoNoListo}\n\n¿Liquidar igualmente las ${g.mesas} mesas de ${nombreGrupo} con los puntos actuales? No se puede deshacer.`)) return;
      forzar = true;
    } else if (!window.confirm(`¿Liquidar las ${g.mesas} mesas de ${nombreGrupo}? Se reparten los premios con la clasificación final de cada mesa. No se puede deshacer.`)) {
      return;
    }
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    setLiquidandoGrupo(g.clave);
    setMensajeGrupo(null);
    try {
      const r = await fetch('/api/admin/liquidar-competicion', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ competicion: g.competicion, tramo: g.tramo, forzar }),
      });
      const json = await r.json();
      if (!r.ok) {
        setMensajeGrupo({ competicion: nombreGrupo, texto: json.error ?? 'No se ha podido liquidar.', ok: false });
      } else {
        const fallos = (json.resultados as { ok: boolean; nombre: string; motivo: string }[]).filter((x) => !x.ok);
        setMensajeGrupo({
          competicion: nombreGrupo,
          ok: fallos.length === 0,
          texto:
            `${json.liquidadas} de ${json.mesasJugadas} mesas liquidadas.` +
            (fallos.length ? ' Con error: ' + fallos.map((f) => `${f.nombre} (${f.motivo})`).join('; ') : ''),
        });
        setRecargar((n) => n + 1);
      }
    } catch {
      setMensajeGrupo({ competicion: nombreGrupo, texto: 'No se ha podido conectar. Inténtalo de nuevo.', ok: false });
    }
    setLiquidandoGrupo(null);
  }

  // 12/10 (Iñi): en Pagos pendientes solo se liquida por jornada/torneo, y
  // solo cuando ha terminado. Las mesas sueltas solo salen para deportes sin
  // puntuación automática (tenis).
  const tieneMotor = (d: string) => d === 'futbol' || d === 'golf';
  const gruposListos = grupos.filter((g) => !tieneMotor(g.deporte) || estadoGrupos[g.clave]?.listo);
  const gruposEnJuego = grupos.filter((g) => tieneMotor(g.deporte) && !estadoGrupos[g.clave]?.listo);
  const salasSinMotor = salas.filter((s) => !tieneMotor(s.deporte));

  if (autorizado === null || !perfil) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader sinVolver />
          <div style={{ padding: '40px 20px' }}>
            <Cargando />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader sinVolver saldoLabel={`${perfil.saldo_simulado.toFixed(2)} €`} accountInitials={S.iniciales(perfil.nombre, perfil.apellido)} />
        <div style={S.accountSection}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Link href="/admin" style={{ fontSize: 12, color: S.MUTED_2, textDecoration: 'none' }}>
              ← Panel de administración
            </Link>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>Pagos pendientes</h1>
            <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>
              Todo lo que se ha jugado y todavía no se ha liquidado. Puedes liquidar una jornada o torneo entero de golpe, o entrar en cada una para ver el reparto propuesto (con empates ya resueltos) antes de confirmarlo.
            </p>
          </div>

          {mensajeGrupo && (
            <p style={{ fontSize: 12.5, margin: 0, color: mensajeGrupo.ok ? S.ACCENT : S.ERROR }}>
              {mensajeGrupo.competicion}: {mensajeGrupo.texto}
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={S.sectionLabel}>Jornadas y torneos pendientes de liquidar</span>
              {gruposListos.length === 0 && <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>No hay ninguna jornada ni torneo terminado pendiente de liquidar.</p>}
              {gruposEnJuego.length > 0 && (
                <p style={{ fontSize: 11.5, color: S.MUTED_2, margin: 0 }}>
                  Todavía en juego (aparecerán aquí al terminar): {gruposEnJuego.map((g) => (g.tramo ? `${g.competicion} (${etiquetaTramoCorta(g.tramo, g.deporte)})` : g.competicion)).join(' · ')}
                </p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {gruposListos.map((g) => {
                  const estado = estadoGrupos[g.clave];
                  const sinMotor = g.deporte !== 'futbol' && g.deporte !== 'golf';
                  const ocupado = liquidandoGrupo === g.clave;
                  return (
                    <div
                      key={g.clave}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: S.PANEL, border: `1px solid ${S.ACCENT}`, borderRadius: 12, padding: '12px 14px' }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                        <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 14, color: S.TEXT }}>{g.competicion}
                          {g.tramo ? ` · ${etiquetaTramoCorta(g.tramo, g.deporte)}` : ''} pendiente de liquidar
                        </span>
                        <span style={{ fontSize: 11, color: S.FAINT }}>
                          {DEPORTE_LABELS[g.deporte]} · {g.mesas} {g.mesas === 1 ? 'mesa' : 'mesas'}
                          {estado ? ` · ${estado.equipos} equipos` : ''}
                        </span>
                        {sinMotor ? (
                          <span style={{ fontSize: 11, color: S.MUTED_2 }}>Sin puntuación automática: liquida sus mesas una a una.</span>
                        ) : estado ? (
                          <span style={{ fontSize: 11, color: estado.listo ? S.ACCENT : '#F0B94D' }}>{estado.listo ? 'Terminada: lista para liquidar.' : estado.motivoNoListo}</span>
                        ) : null}
                      </div>
                      {!sinMotor && (
                        <button
                          type="button"
                          onClick={() => liquidarGrupo(g)}
                          disabled={liquidandoGrupo !== null}
                          style={{ flexShrink: 0, background: S.ACCENT, color: '#0B0F0E', border: 'none', borderRadius: 10, padding: '9px 12px', fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 12, cursor: liquidandoGrupo ? 'default' : 'pointer', opacity: liquidandoGrupo && !ocupado ? 0.5 : 1 }}
                        >
                          {ocupado ? 'Liquidando…' : `Liquidar ${g.mesas === 1 ? 'la mesa' : `las ${g.mesas} mesas`}`}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={S.sectionLabel}>Porras</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {porras.length === 0 && <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>No hay ninguna porra jugada pendiente de liquidar.</p>}
              {porras.map((p) => (
                <Link
                  key={p.id}
                  href={`/admin/pagos-pendientes/porra/${p.id}`}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: '12px 14px', textDecoration: 'none' }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.major}</span>
                    <span style={{ fontSize: 11, color: S.FAINT }}>
                      {PORRA_FORMATO_LABELS[p.formato]} · {p.estado} · {p.precio.toFixed(2)} €
                    </span>
                  </div>
                  <span style={{ flexShrink: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: S.ACCENT }}>Liquidar →</span>
                </Link>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={S.sectionLabel}>Mesas sin puntuación automática (liquidar una a una)</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {salasSinMotor.length === 0 && <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>Ninguna: las mesas de fútbol y golf se liquidan por jornada o torneo, arriba.</p>}
              {salasSinMotor.map((s) => (
                <Link
                  key={s.id}
                  href={`/admin/pagos-pendientes/sala/${s.id}`}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: '12px 14px', textDecoration: 'none' }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.nombre}</span>
                    <span style={{ fontSize: 11, color: S.FAINT }}>
                      {DEPORTE_LABELS[s.deporte]} · {TIPO_SALA_LABELS[s.tipo]} · {s.estado} · {s.buy_in.toFixed(2)} €
                    </span>
                  </div>
                  <span style={{ flexShrink: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: S.ACCENT }}>Liquidar →</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
