'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';

// ============================================================================
// NIVELES (31/10, Iñi) — SQL 71
// ============================================================================
// Cada usuario tiene un nivel (empieza en el 1) que sube con los puntos de
// nivel que da cada partida terminada. Al lado del nombre se ve su insignia:
// cada 10 niveles cambia la forma y el color:
//   1-10 círculo · 11-20 cuadrado · 21-30 triángulo · 31-40 rombo ·
//   41-50 pentágono · 51-60 hexágono · 61+ estrella
// Al pulsar un usuario: su nivel y tu historial contra él (ganadas/perdidas)
// con el botón "Ver historial".

const TRAMOS = [
  { forma: 'circulo', color: '#3DDC84' },
  { forma: 'cuadrado', color: '#4FA3FF' },
  { forma: 'triangulo', color: '#A78BFA' },
  { forma: 'rombo', color: '#F0B94D' },
  { forma: 'pentagono', color: '#FF8A4C' },
  { forma: 'hexagono', color: '#FF5C8A' },
  { forma: 'estrella', color: '#FFD84D' },
] as const;

export function tramoNivel(nivel: number) {
  return TRAMOS[Math.min(TRAMOS.length - 1, Math.floor((Math.max(1, nivel) - 1) / 10))];
}

function poligono(lados: number, r: number, c: number, giro = -Math.PI / 2): string {
  return Array.from({ length: lados }, (_, i) => {
    const a = giro + (i * 2 * Math.PI) / lados;
    return `${(c + r * Math.cos(a)).toFixed(2)},${(c + r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
}
function estrella(r: number, c: number): string {
  return Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.55;
    return `${(c + rr * Math.cos(a)).toFixed(2)},${(c + rr * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
}

/** Insignia de nivel: la forma y el color según el tramo, con el número dentro. */
export function NivelBadge({ nivel, size = 22 }: { nivel: number | null | undefined; size?: number }) {
  if (!nivel) return null;
  const t = tramoNivel(nivel);
  const c = 50;
  const relleno = `${t.color}26`;
  const forma = (() => {
    switch (t.forma) {
      case 'circulo':
        return <circle cx={c} cy={c} r={44} fill={relleno} stroke={t.color} strokeWidth={7} />;
      case 'cuadrado':
        return <rect x={9} y={9} width={82} height={82} rx={14} fill={relleno} stroke={t.color} strokeWidth={7} />;
      case 'triangulo':
        return <polygon points={poligono(3, 50, c, -Math.PI / 2)} transform="translate(0,8)" fill={relleno} stroke={t.color} strokeWidth={7} strokeLinejoin="round" />;
      case 'rombo':
        return <polygon points={poligono(4, 46, c)} fill={relleno} stroke={t.color} strokeWidth={7} strokeLinejoin="round" />;
      case 'pentagono':
        return <polygon points={poligono(5, 46, c)} fill={relleno} stroke={t.color} strokeWidth={7} strokeLinejoin="round" />;
      case 'hexagono':
        return <polygon points={poligono(6, 46, c)} fill={relleno} stroke={t.color} strokeWidth={7} strokeLinejoin="round" />;
      default:
        return <polygon points={estrella(48, c)} fill={relleno} stroke={t.color} strokeWidth={6} strokeLinejoin="round" />;
    }
  })();
  const fs = nivel >= 100 ? 30 : nivel >= 10 ? 38 : 44;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }} aria-label={`Nivel ${nivel}`}>
      {forma}
      <text x={c} y={t.forma === 'triangulo' ? 70 : 54} textAnchor="middle" dominantBaseline="middle" fontFamily="'Barlow Condensed', sans-serif" fontWeight={800} fontSize={t.forma === 'triangulo' ? fs * 0.92 : fs} fill="#FFFFFF">
        {nivel}
      </text>
    </svg>
  );
}

// Caché sencilla de niveles para no pedirlos una y otra vez.
const cache = new Map<string, number>();
export function useNiveles(ids: string[]): Map<string, number> {
  const [mapa, setMapa] = useState<Map<string, number>>(new Map(ids.filter((i) => cache.has(i)).map((i) => [i, cache.get(i) as number])));
  const clave = Array.from(new Set(ids)).sort().join(',');
  useEffect(() => {
    const faltan = clave ? clave.split(',').filter((i) => i && !cache.has(i)) : [];
    const listo = () => setMapa(new Map(clave.split(',').filter((i) => cache.has(i)).map((i) => [i, cache.get(i) as number])));
    if (faltan.length === 0) return listo();
    void supabase.rpc('niveles_de', { p_usuarios: faltan }).then(({ data }) => {
      ((data as { usuario_id: string; nivel: number }[]) ?? []).forEach((n) => cache.set(n.usuario_id, n.nivel));
      listo();
    });
  }, [clave]);
  return mapa;
}

/**
 * Nombre con su nivel delante (01/11, Iñi):
 *  · modo "popover" (en las clasificaciones): al pulsarlo se abre una ventanita
 *    pequeña, sin salir de la página, con el resumen contra él y "Ver más".
 *  · modo "historial" (fuera de las clasificaciones): lleva directamente al
 *    historial contigo (o a "Mi nivel" si eres tú).
 */
export function UsuarioConNivel({ id, nombre, nivel, miId, estilo, sinArroba = false, modo = 'historial' }: { id: string; nombre: string; nivel?: number; miId?: string; estilo?: React.CSSProperties; sinArroba?: boolean; modo?: 'popover' | 'historial' }) {
  const router = useRouter();
  const { abrirFicha, ficha } = useFichaUsuario();
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (modo === 'popover') return abrirFicha(id, e.currentTarget);
          router.push(miId && miId === id ? '/v2/nivel' : `/v2/historial/${id}`);
        }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', textAlign: 'left', ...estilo }}
      >
        <NivelBadge nivel={nivel} size={20} />
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sinArroba ? '' : '@'}
          {nombre}
        </span>
      </button>
      {ficha}
    </>
  );
}

/** Ventanita pequeña junto al nombre (como en Ludoteka): nivel, ganadas/perdidas, última vez y "Ver más". */
export function PopoverUsuario({ id, ancla, onCerrar }: { id: string; ancla: DOMRect; onCerrar: () => void }) {
  const [nivel, setNivel] = useState<number | null>(null);
  const [h, setH] = useState<(H2H & { nombre?: string }) | null>(null);
  const [yoId, setYoId] = useState<string | undefined>(undefined);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setYoId(data.session?.user.id));
    void supabase.rpc('niveles_de', { p_usuarios: [id] }).then(({ data }) => setNivel(((data as { nivel: number }[]) ?? [])[0]?.nivel ?? 1));
    void supabase.rpc('h2h_resumen', { p_rival: id }).then(({ data }) => setH(data as H2H & { nombre?: string }));
  }, [id]);
  useEffect(() => {
    const cerrar = () => onCerrar();
    window.addEventListener('scroll', cerrar, true);
    window.addEventListener('resize', cerrar);
    return () => {
      window.removeEventListener('scroll', cerrar, true);
      window.removeEventListener('resize', cerrar);
    };
  }, [onCerrar]);
  const yo = yoId === id;
  const ANCHO = 216;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 400;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const left = Math.max(8, Math.min(vw - ANCHO - 8, ancla.left));
  const abajo = ancla.bottom + 150 < vh;
  const fecha = h?.ultima ? new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' }).format(new Date(h.ultima)) : null;
  const num = (v: number, t: string, c: string) => (
    <span style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 19, lineHeight: 1, color: c }}>{v}</span>
      <span style={{ fontSize: 9, color: S.MUTED_3, whiteSpace: 'nowrap' }}>{t}</span>
    </span>
  );
  return (
    <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCerrar(); }} style={{ position: 'fixed', inset: 0, zIndex: 90 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'fixed', left, ...(abajo ? { top: ancla.bottom + 6 } : { bottom: vh - ancla.top + 6 }), width: ANCHO, background: '#141B18', border: '1px solid #2E3A35', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.55)', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <NivelBadge nivel={nivel} size={26} />
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontWeight: 800, fontSize: 13, color: S.TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{h?.nombre ?? '…'}</span>
            <span style={{ fontSize: 10.5, color: S.MUTED_2 }}>{nivel ? `Nivel ${nivel}` : ''}</span>
          </span>
        </div>
        {!h ? (
          <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>Cargando…</span>
        ) : yo ? (
          <span style={{ fontSize: 11.5, color: S.MUTED_2 }}>Eres tú.</span>
        ) : h.total === 0 ? (
          <span style={{ fontSize: 11.5, color: S.MUTED_2, lineHeight: 1.35 }}>Todavía no habéis coincidido en ninguna partida terminada.</span>
        ) : (
          <>
            <div style={{ display: 'flex', padding: '6px 0', borderRadius: 8, background: 'rgba(255,255,255,0.03)' }}>
              {num(h.ganadas, 'Le has ganado', '#3DDC84')}
              {num(h.perdidas, 'Te ha ganado', '#FF8A8A')}
              {num(h.empates, 'Empates', S.MUTED_2)}
            </div>
            <span style={{ fontSize: 10.5, color: S.MUTED_2, lineHeight: 1.35 }}>
              {h.total} {h.total === 1 ? 'partida juntos' : 'partidas juntos'}
              {fecha ? ` · la última, el ${fecha}` : ''}
            </span>
          </>
        )}
        <Link href={yo ? '/v2/nivel' : `/v2/historial/${id}`} onClick={(e) => e.stopPropagation()} style={{ alignSelf: 'flex-end', fontSize: 12, fontWeight: 800, color: '#3DDC84', textDecoration: 'none' }}>
          Ver más ›
        </Link>
      </div>
    </div>
  );
}

type Nivel = { nivel: number; xp: number; xp_en_nivel: number; xp_siguiente: number; para_subir?: number; jugadas: number; ganadas: number; nombre: string };
type H2H = { ganadas: number; perdidas: number; empates: number; total: number; ultima?: string | null };

// 31/10 (Iñi, como en Ludoteka): puntuación de nivel; cada 100 puntos, un nivel (3821 = nivel 38).
export function BarraNivel({ n }: { n: Pick<Nivel, 'nivel' | 'xp' | 'xp_en_nivel' | 'xp_siguiente' | 'para_subir'> }) {
  const t = tramoNivel(n.nivel);
  const pct = Math.max(2, Math.min(100, Math.round((n.xp_en_nivel / Math.max(1, n.xp_siguiente)) * 100)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: t.color }} />
      </div>
      <span style={{ fontSize: 11.5, color: S.MUTED_2 }}>
        Puntuación {Math.floor(Number(n.xp))} · para subir al nivel {n.nivel + 1} necesitas {n.para_subir ?? 100 * (n.nivel + 1)}
      </span>
    </div>
  );
}

export function FichaUsuario({ id, miId, onCerrar }: { id: string; miId?: string; onCerrar: () => void }) {
  const [n, setN] = useState<Nivel | null>(null);
  const [h, setH] = useState<H2H | null>(null);
  // Sin miId (p. ej. desde la clasificación de una sala), se mira la sesión.
  const [yoId, setYoId] = useState<string | undefined>(miId);
  useEffect(() => {
    if (miId) return setYoId(miId);
    void supabase.auth.getSession().then(({ data }) => setYoId(data.session?.user.id));
  }, [miId]);
  const yo = yoId === id;
  useEffect(() => {
    void supabase.rpc('mi_nivel', { p_usuario: id }).then(({ data }) => setN(data as Nivel));
    if (!yo) void supabase.rpc('h2h_resumen', { p_rival: id }).then(({ data }) => setH(data as H2H));
  }, [id, yo]);
  return (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: '#121815', borderTop: '1px solid #26302B', borderRadius: '18px 18px 0 0', padding: '18px 18px 26px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!n ? (
          <span style={{ color: S.MUTED_2, fontSize: 13 }}>Cargando…</span>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <NivelBadge nivel={n.nivel} size={48} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, color: S.TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{n.nombre}</span>
                <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>
                  Nivel {n.nivel} · {n.jugadas} {n.jugadas === 1 ? 'partida' : 'partidas'} · {n.ganadas} {n.ganadas === 1 ? 'ganada' : 'ganadas'}
                </span>
              </div>
            </div>
            <BarraNivel n={n} />
            {!yo && h && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid #1E2823' }}>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: S.MUTED_3 }}>Tú contra @{n.nombre}</span>
                {h.total > 0 && (
                  <span style={{ fontSize: 12.5, color: S.MUTED, lineHeight: 1.4 }}>
                    Habéis coincidido en <b style={{ color: S.TEXT }}>{h.total} {h.total === 1 ? 'partida' : 'partidas'}</b>
                    {h.ultima ? ` · la última, el ${new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' }).format(new Date(h.ultima))}` : ''}
                  </span>
                )}
                {h.total === 0 ? (
                  <span style={{ fontSize: 13, color: S.MUTED_2 }}>Todavía no habéis coincidido en ninguna partida terminada.</span>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[
                      ['Le has ganado', h.ganadas, '#3DDC84'],
                      ['Te ha ganado', h.perdidas, '#FF8A8A'],
                      ['Empates', h.empates, S.MUTED_2],
                    ].map(([t, v, c]) => (
                      <div key={t as string} style={{ flex: 1, textAlign: 'center', padding: '8px 4px', borderRadius: 10, background: 'rgba(255,255,255,0.03)' }}>
                        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 26, color: c as string, lineHeight: 1 }}>{v as number}</div>
                        <div style={{ fontSize: 10.5, color: S.MUTED_3, marginTop: 3 }}>{t as string}</div>
                      </div>
                    ))}
                  </div>
                )}
                <Link href={`/v2/historial/${id}`} style={{ ...S.secondaryLinkButton, marginTop: 2, textDecoration: 'none', textAlign: 'center' }}>
                  Ver historial
                </Link>
              </div>
            )}
            {yo && (
              <Link href="/v2/nivel" style={{ ...S.secondaryLinkButton, marginTop: 0, textDecoration: 'none', textAlign: 'center' }}>
                Ver mi nivel y mis partidas
              </Link>
            )}
            <button type="button" onClick={onCerrar} style={{ background: 'none', border: 'none', color: S.MUTED_3, fontSize: 13, cursor: 'pointer' }}>
              Cerrar
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** 01/11 (Iñi): abre la ventanita del usuario junto al elemento pulsado. */
export function useFichaUsuario() {
  const [abierta, setAbierta] = useState<{ id: string; ancla: DOMRect } | null>(null);
  return {
    abrirFicha: (id: string, el: Element) => setAbierta({ id, ancla: el.getBoundingClientRect() }),
    ficha: abierta ? <PopoverUsuario id={abierta.id} ancla={abierta.ancla} onCerrar={() => setAbierta(null)} /> : null,
  };
}
