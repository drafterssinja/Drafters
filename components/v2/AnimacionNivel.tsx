'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { insigniaSvg, rango } from '@/components/v2/Insignia';

// ============================================================================
// ANIMACIÓN DE NIVEL (02/11, Iñi)
// ============================================================================
// Cuando termina una partida y tu puntuación de nivel ha cambiado desde la
// última vez que la viste, baja desde la cabecera (debajo de la insignia) una
// ventanita con la barra de progreso subiendo o bajando. Si cambias de nivel:
// la barra se llena (o se vacía), destello y el número salta al nuevo nivel
// (en rojo y temblando si baja). Se cierra sola o tocándola.
// La última puntuación vista se guarda en el móvil (localStorage, por
// usuario). La primera vez no se anima: solo se guarda.

type Ultima = { titulo: string; terminado_en: string };
type MiNivel = { nivel: number; xp: number; ultimas?: Ultima[] };
type Visto = { xp: number; t: number };

const nivelDe = (xp: number) => Math.max(1, Math.floor(xp / 100));
const pctDe = (xp: number) => Math.max(0, Math.min(100, xp - nivelDe(xp) * 100));
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const coma = (x: number) => x.toFixed(1).replace('.', ',');

function leer(k: string): Visto | null {
  try {
    const v = JSON.parse(localStorage.getItem(k) ?? 'null');
    return v && typeof v.xp === 'number' ? v : null;
  } catch {
    return null;
  }
}
function guardar(k: string, v: Visto) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // sin almacenamiento: no pasa nada
  }
}

const CSS = `
@keyframes dnv-glow{50%{box-shadow:0 0 16px 3px var(--dnv-c)}}
@keyframes dnv-shake{20%{transform:translateX(-5px) rotate(-4deg)}40%{transform:translateX(5px) rotate(4deg)}60%{transform:translateX(-4px)}80%{transform:translateX(3px)}}
@keyframes dnv-rays{0%{opacity:0;transform:scale(.3) rotate(0)}25%{opacity:1}100%{opacity:0;transform:scale(1.25) rotate(40deg)}}
@keyframes dnv-flash{0%{opacity:0}15%{opacity:.75}100%{opacity:0}}
@keyframes dnv-brillo{to{transform:translateX(100%)}}
.dnv-fill::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent);transform:translateX(-100%);animation:dnv-brillo 1.4s linear infinite}
.dnv-pop{transform:scale(1.35);filter:drop-shadow(0 0 14px var(--dnv-c)) brightness(1.4)}
.dnv-shake{animation:dnv-shake .5s}
.dnv-rays-on{animation:dnv-rays 1.2s ease-out}
.dnv-flash-on{animation:dnv-flash .9s ease-out}
`;

/**
 * Pon <AnimacionNivel /> en la cabecera. `onNivel` recibe el nivel que hay que
 * enseñar en la insignia de la cabecera mientras dura la animación (null al
 * terminar) y `onBrillo` si la insignia de la cabecera tiene que brillar.
 */
export default function AnimacionNivel({ usuarioId, anclaRef, onNivel, onBrillo }: { usuarioId: string | null | undefined; anclaRef: React.RefObject<HTMLElement>; onNivel: (n: number | null) => void; onBrillo: (b: boolean) => void }) {
  const router = useRouter();
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [montado, setMontado] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [top, setTop] = useState(68);
  const [nivel, setNivel] = useState(1);
  const [eti, setEti] = useState('');
  const [titulo, setTitulo] = useState<React.ReactNode>(null);
  const [sub, setSub] = useState('');
  const [pts, setPts] = useState(0);
  const [color, setColor] = useState('#3DDC84');
  const [pop, setPop] = useState<'pop' | 'shake' | null>(null);
  const [destello, setDestello] = useState(false);
  const fillRef = useRef<HTMLDivElement>(null);
  const cerrarRef = useRef<() => void>(() => undefined);
  const enMarcha = useRef(false);

  useEffect(() => setMontado(true), []);

  useEffect(() => {
    if (!usuarioId || enMarcha.current) return;
    const k = `drafters_nivel_visto:${usuarioId}`;
    let vivo = true;
    void supabase.rpc('mi_nivel').then(({ data }) => {
      if (!vivo || !data) return;
      const n = data as MiNivel;
      const xp = Number(n.xp);
      if (!Number.isFinite(xp)) return;
      const visto = leer(k);
      const ahora = Date.now();
      if (!visto) return guardar(k, { xp, t: ahora });
      if (Math.abs(xp - visto.xp) < 0.05) return;
      guardar(k, { xp, t: ahora });
      const nuevas = (n.ultimas ?? []).filter((u) => new Date(u.terminado_en).getTime() > visto.t);
      const etiqueta = nuevas.length === 1 ? nuevas[0].titulo : nuevas.length > 1 ? `${nuevas.length} partidas terminadas` : n.ultimas?.[0]?.titulo ?? 'Tu nivel';
      enMarcha.current = true;
      void animar(visto.xp, xp, etiqueta);
    });
    return () => {
      vivo = false;
    };
  }, [usuarioId]); // eslint-disable-line react-hooks/exhaustive-deps

  function barra(pct: number, sinAnim = false) {
    const f = fillRef.current;
    if (!f) return;
    if (sinAnim) {
      f.style.transition = 'none';
      f.style.width = `${pct}%`;
      void f.offsetWidth;
      f.style.transition = '';
    } else f.style.width = `${pct}%`;
  }
  function contar(desde: number, hasta: number, ms: number) {
    const t0 = performance.now();
    return new Promise<void>((res) => {
      const paso = (t: number) => {
        const k = Math.min(1, (t - t0) / ms);
        const e = 1 - Math.pow(1 - k, 3);
        setPts(desde + (hasta - desde) * e);
        if (k < 1) requestAnimationFrame(paso);
        else res();
      };
      requestAnimationFrame(paso);
    });
  }

  async function animar(antes: number, despues: number, etiqueta: string) {
    const sube = despues > antes;
    let n = nivelDe(antes);
    const nFin = nivelDe(despues);
    const r = anclaRef.current?.getBoundingClientRect();
    setTop(r ? Math.max(0, r.bottom) : 68);
    setNivel(n);
    onNivel(n);
    setColor(rango(n).metal[0]);
    setEti(etiqueta);
    setTitulo(
      <>
        <span style={{ color: sube ? '#3DDC84' : '#FF6B6B' }}>
          {sube ? '+' : '−'}
          {coma(Math.abs(despues - antes))}
        </span>{' '}
        puntos de nivel
      </>
    );
    setSub(`${rango(n).nombre} · nivel ${n}`);
    setPts(antes);
    await espera(60);
    barra(pctDe(antes), true);
    let cerrar = false;
    cerrarRef.current = () => {
      cerrar = true;
    };
    setAbierto(true);
    onBrillo(true);
    await espera(900);
    let xp = antes;
    while (n !== nFin && !cerrar) {
      if (sube) {
        if (fillRef.current) fillRef.current.style.background = rango(n).metal[0];
        barra(100);
        await contar(xp, (n + 1) * 100, 1000);
        xp = (n + 1) * 100;
        setPop('pop');
        setDestello(true);
        await espera(260);
        const anterior = rango(n).nombre;
        n += 1;
        setNivel(n);
        onNivel(n);
        setColor(rango(n).metal[0]);
        setTitulo(<span style={{ color: rango(n).metal[0] }}>¡Subes al nivel {n}!</span>);
        setSub(rango(n).nombre !== anterior ? `¡Subes a ${rango(n).nombre}!` : `Nueva insignia · ${rango(n).nombre}`);
        await espera(420);
        setPop(null);
        barra(0, true);
        await espera(300);
        setDestello(false);
      } else {
        if (fillRef.current) fillRef.current.style.background = '#FF6B6B';
        barra(0);
        await contar(xp, n * 100, 900);
        xp = n * 100;
        setPop('shake');
        await espera(250);
        const anterior = rango(n).nombre;
        n -= 1;
        setNivel(n);
        onNivel(n);
        setColor(rango(n).metal[0]);
        setTitulo(<span style={{ color: '#FF8A8A' }}>Bajas al nivel {n}</span>);
        setSub(rango(n).nombre !== anterior ? `Vuelves a ${rango(n).nombre}` : `${rango(n).nombre} · nivel ${n}`);
        await espera(400);
        setPop(null);
        barra(100, true);
        await espera(200);
      }
    }
    if (fillRef.current) fillRef.current.style.background = rango(n).metal[0];
    barra(pctDe(despues));
    await contar(xp, despues, 1000);
    for (let i = 0; i < 25 && !cerrar; i++) await espera(100);
    setAbierto(false);
    onBrillo(false);
    await espera(600);
    onNivel(null);
    enMarcha.current = false;
  }

  if (!montado) return null;
  const nv = nivelDe(pts);
  const falta = Math.max(0, Math.ceil((nv + 1) * 100 - pts));
  return createPortal(
    <>
      <style>{CSS}</style>
      <div onClick={() => cerrarRef.current()} style={{ position: 'fixed', left: 0, right: 0, top, bottom: 0, background: 'rgba(0,0,0,0.5)', opacity: abierto ? 1 : 0, pointerEvents: abierto ? 'auto' : 'none', transition: 'opacity .35s', zIndex: 60 }} />
      {/* Recorte: al cerrarse, el panel se esconde detrás de la cabecera. */}
      <div style={{ position: 'fixed', top, left: 0, right: 0, height: 420, overflow: 'hidden', pointerEvents: 'none', zIndex: 61 }}>
      <div
        role="status"
        onClick={() => cerrarRef.current()}
        style={
          {
            position: 'absolute',
            top: 0,
            pointerEvents: abierto ? 'auto' : 'none',
            left: '50%',
            width: 'min(470px, calc(100vw - 20px))',
            zIndex: 61,
            transform: `translate(-50%, ${abierto ? '0' : '-115%'})`,
            transition: 'transform .55s cubic-bezier(.2,.9,.25,1.15)',
            borderRadius: '0 0 20px 20px',
            background: 'linear-gradient(180deg,#141C19 0%,#0F1513 100%)',
            border: '1px solid #24312C',
            borderTop: 'none',
            padding: '16px 16px 18px',
            boxShadow: '0 18px 40px rgba(0,0,0,.55)',
            overflow: 'hidden',
            cursor: 'pointer',
            fontFamily: "'Manrope', sans-serif",
            color: '#F5F7F5',
            ['--dnv-c' as string]: color,
          } as React.CSSProperties
        }
      >
        <div className={destello ? 'dnv-flash-on' : ''} style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 54px 54px, ${color} 0%, transparent 60%)`, opacity: 0, pointerEvents: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, position: 'relative' }}>
          <div style={{ position: 'relative', width: 76, height: 76, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div
              className={destello ? 'dnv-rays-on' : ''}
              style={{
                position: 'absolute',
                inset: -30,
                borderRadius: '50%',
                opacity: 0,
                background: `conic-gradient(from 0deg, transparent 0 6%, ${color} 6% 9%, transparent 9% 19%, ${color} 19% 22%, transparent 22% 32%, ${color} 32% 35%, transparent 35% 45%, ${color} 45% 48%, transparent 48% 58%, ${color} 58% 61%, transparent 61% 71%, ${color} 71% 74%, transparent 74% 84%, ${color} 84% 87%, transparent 87% 100%)`,
                WebkitMask: 'radial-gradient(circle, transparent 30%, #000 32%, transparent 70%)',
                mask: 'radial-gradient(circle, transparent 30%, #000 32%, transparent 70%)',
              }}
            />
            <span
              className={pop === 'pop' ? 'dnv-pop' : pop === 'shake' ? 'dnv-shake' : ''}
              style={{ display: 'inline-flex', lineHeight: 0, transition: 'transform .35s cubic-bezier(.2,1.6,.4,1), filter .35s' }}
              dangerouslySetInnerHTML={{ __html: insigniaSvg(nivel, 70, `anim${id}`) }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#8FA39A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{eti}</div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 25, lineHeight: 1.05, marginTop: 2 }}>{titulo}</div>
            <div style={{ fontSize: 12.5, color: '#8FA39A', marginTop: 3 }}>{sub}</div>
          </div>
        </div>
        <div style={{ marginTop: 14, position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 700, color: '#8FA39A', marginBottom: 6 }}>
            <span>Nivel {nivel}</span>
            <span>Nivel {nivel + 1}</span>
          </div>
          <div style={{ height: 12, borderRadius: 999, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
            <div ref={fillRef} className="dnv-fill" style={{ height: '100%', width: 0, borderRadius: 999, position: 'relative', overflow: 'hidden', background: color, transition: 'width 1.1s cubic-bezier(.35,0,.25,1), background .3s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12, color: '#8FA39A' }}>
            <span>
              Puntuación <b style={{ color: '#F5F7F5', fontFamily: "'Barlow Condensed', sans-serif", fontSize: 17 }}>{Math.floor(pts)}</b>
            </span>
            <span>{abierto ? `faltan ${falta} para subir` : ''}</span>
          </div>
          <div
            onClick={(e) => {
              e.stopPropagation();
              cerrarRef.current();
              router.push('/v2/nivel');
            }}
            style={{ marginTop: 10, textAlign: 'center', fontSize: 12, fontWeight: 800, color: '#3DDC84' }}
          >
            Ver mi nivel ›
          </div>
        </div>
      </div>
      </div>
    </>,
    document.body
  );
}
