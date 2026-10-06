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

type SalaFila = { id: string; nombre: string; deporte: Deporte; tipo: TipoSala; estado: string; buy_in: number; competicion: string };
type PorraFila = { id: string; major: string; formato: PorraFormato; estado: string; precio: number };
type LiquidacionFila = { tipo: string; sala_id: string | null; porra_id: string | null };

export default function AdminPagosPendientesPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);

  const [salas, setSalas] = useState<SalaFila[]>([]);
  const [porras, setPorras] = useState<PorraFila[]>([]);

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

      const [{ data: salasData }, { data: porrasData }, { data: liquidacionesData }] = await Promise.all([
        supabase.from('salas').select('id, nombre, deporte, tipo, estado, buy_in, competicion').order('created_at', { ascending: false }),
        supabase.from('porras').select('id, major, formato, estado, precio').order('created_at', { ascending: false }),
        supabase.from('liquidaciones').select('tipo, sala_id, porra_id'),
      ]);

      if (!activo) return;

      const liquidadas = (liquidacionesData as LiquidacionFila[]) ?? [];
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

      setSalas(
        ((salasData as SalaFila[]) ?? []).filter((s) => !salasLiquidadas.has(s.id)).sort(porPrioridadFinalizada)
      );
      setPorras(
        ((porrasData as PorraFila[]) ?? []).filter((p2) => !porrasLiquidadas.has(p2.id)).sort(porPrioridadFinalizada)
      );
    }

    cargar();
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  if (autorizado === null || !perfil) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader sinVolver />
          <div style={{ padding: '40px 20px' }}>
            <p style={{ fontSize: 14, color: S.MUTED }}>Cargando...</p>
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
              Todo lo que todavía no se ha liquidado. Entra en cada una para ver el reparto propuesto (con empates ya resueltos) antes de confirmarlo.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={S.sectionLabel}>Porras</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {porras.length === 0 && <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>No hay ninguna porra pendiente de liquidar.</p>}
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
            <span style={S.sectionLabel}>Salas / Mesas Drafters</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {salas.length === 0 && <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>No hay ninguna sala pendiente de liquidar.</p>}
              {salas.map((s) => (
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
