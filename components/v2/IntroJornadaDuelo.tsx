'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import EscudoEquipo from '@/components/EscudoEquipo';
import { useEscudos } from '@/components/equipo/useEscudos';
import { useNiveles } from '@/components/v2/Nivel';
import { insigniaSvg, rango } from '@/components/v2/Insignia';
import { inicialesJugador, lineaDePosicion, type LineaFutbol } from '@/lib/salaShared';

// ============================================================================
// LIGA DRAFTERS · ANIMACIÓN DE INICIO DE JORNADA (24/11, Iñi)
// ============================================================================
// La primera vez que entras con la jornada ya empezada: a pantalla completa,
// arriba tu rival (entra desde la izquierda con un destello) y abajo tú (desde
// la derecha), cada uno con su insignia, nivel, puesto en la liga y su
// alineación. Los dos equipos enfrentados: el portero del rival arriba del
// todo, el tuyo abajo del todo, y los delanteros frente a frente en el centro.
// "VS" dorado en medio, "Omitir" arriba y "¡A jugar!" al final.
// Se ve una sola vez por enfrentamiento (localStorage, ver yaVistaIntro).

type Jugador = { id: string; nombre: string; posicion: string | null; equipo_real: string | null };
type Lado = { id: string; nombre: string; soy_yo: boolean; visible: boolean; alineacion: string | null; jugadores: Jugador[] | null } | null;
type Detalle = { local: Lado; visitante: Lado; competicion: string };

const COLOR: Record<LineaFutbol, string> = { POR: '#FF7A45', DEF: '#8FB6FF', MED: '#F0B94D', DEL: '#3DDC84' };
const claveVista = (partido: string) => `drafters_intro_jornada_${partido}`;

export function yaVistaIntro(partido: string): boolean {
  try {
    return localStorage.getItem(claveVista(partido)) === '1';
  } catch {
    return true; // sin almacenamiento, mejor no molestar cada vez
  }
}

export default function IntroJornadaDuelo({ partido, division, deporte, numero, onCerrar }: { partido: string; division: string | null; deporte: string; numero: number; onCerrar: () => void }) {
  const [det, setDet] = useState<Detalle | null>(null);
  const [puestos, setPuestos] = useState<Map<string, number>>(new Map());
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  useEffect(() => {
    void supabase.rpc('duelos_partido_detalle', { p_partido: partido }).then(({ data, error }) => {
      if (error || !data) return onCerrar();
      setDet(data as Detalle);
    });
    if (division)
      void supabase.rpc('duelos_clasificacion', { p_division: division }).then(({ data }) => {
        setPuestos(new Map(((data as { usuario_id: string }[]) ?? []).map((f, i) => [f.usuario_id, i + 1])));
      });
  }, [partido, division]); // eslint-disable-line react-hooks/exhaustive-deps

  const yo = det ? (det.local?.soy_yo ? det.local : det.visitante) : null;
  const rival = det ? (det.local?.soy_yo ? det.visitante : det.local) : null;
  const niveles = useNiveles([yo?.id, rival?.id].filter(Boolean) as string[]);

  function cerrar() {
    try {
      localStorage.setItem(claveVista(partido), '1');
    } catch {}
    onCerrar();
  }

  // Sin rival (descansa) o sin equipos que enseñar: no hay animación.
  useEffect(() => {
    if (det && (!yo || !rival || !(yo.jugadores?.length || rival.jugadores?.length))) cerrar();
  }, [det]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!montado || !det || !yo || !rival) return null;

  return createPortal(
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 400, background: '#05080A', overflow: 'hidden', fontFamily: "'Manrope', sans-serif", color: '#F5F7F5' }}>
      <style>{CSS}</style>
      <span className="ijd-titulo">
        LIGA DRAFTERS · JORNADA {numero}
      </span>
      <button type="button" className="ijd-omitir" onClick={cerrar}>
        Omitir ›
      </button>

      <div className="ijd-mitad ijd-arriba">
        <div className="ijd-raya" />
        <Cabecera lado={rival} nivel={niveles.get(rival.id)} puesto={puestos.get(rival.id)} id="r" />
        <Equipo lado={rival} deporte={deporte} porteroArriba />
        <div className="ijd-flash" />
      </div>

      <div className="ijd-mitad ijd-abajo">
        <div className="ijd-raya" />
        <Cabecera lado={yo} nivel={niveles.get(yo.id)} puesto={puestos.get(yo.id)} id="y" yo />
        <Equipo lado={yo} deporte={deporte} porteroArriba={false} />
        <div className="ijd-flash" />
      </div>

      <div className="ijd-vs">VS</div>
      <Link href={`/v2/liga/duelo/${partido}`} className="ijd-vamos" onClick={() => cerrar()}>
        ¡A JUGAR! ›
      </Link>
    </div>,
    document.body
  );
}

function Cabecera({ lado, nivel, puesto, id, yo = false }: { lado: NonNullable<Lado>; nivel: number | undefined; puesto: number | undefined; id: string; yo?: boolean }) {
  const n = nivel ?? 1;
  const nombre = lado.nombre.replace(/(^|\s)(\S)/g, (_m, sp: string, c: string) => sp + c.toUpperCase());
  const esquema = (() => {
    const js = lado.jugadores ?? [];
    if (!js.length || !js.some((j) => j.posicion)) return lado.alineacion ?? '';
    const c = (l: LineaFutbol) => js.filter((j) => lineaDePosicion(j.posicion) === l).length;
    return `${c('DEF')}-${c('MED')}-${c('DEL')}`;
  })();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
      <span style={{ width: 58, height: 58, flexShrink: 0, filter: 'drop-shadow(0 4px 10px rgba(0,0,0,.6))' }} dangerouslySetInnerHTML={{ __html: insigniaSvg(n, 58, `ijd${id}`) }} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 26, lineHeight: 1, color: yo ? '#3DDC84' : '#F5F7F5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {yo ? `Tú · ${nombre}` : nombre}
        </span>
        <span style={{ display: 'block', fontSize: 12, color: '#AAB4AE', marginTop: 3 }}>
          Nivel {n} · {rango(n).nombre}
          {esquema ? ` · ${esquema}` : ''}
        </span>
      </span>
      {puesto && (
        <span style={{ flexShrink: 0, textAlign: 'center', padding: '4px 10px', borderRadius: 12, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)' }}>
          <b style={{ display: 'block', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 24, lineHeight: 1 }}>{puesto}º</b>
          <span style={{ fontSize: 9.5, color: '#AAB4AE', textTransform: 'uppercase', letterSpacing: '.05em' }}>en la liga</span>
        </span>
      )}
    </div>
  );
}

function Equipo({ lado, deporte, porteroArriba }: { lado: NonNullable<Lado>; deporte: string; porteroArriba: boolean }) {
  const { escudoDe, escudoAlternativo } = useEscudos();
  const js = lado.jugadores ?? [];
  if (deporte !== 'futbol') {
    return (
      <div className="ijd-campo" style={{ justifyContent: 'center', gap: 8, padding: '10px 14px' }}>
        {js.map((j, i) => (
          <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 800 }}>
            <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#3DDC84', color: '#04140B', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
            {j.nombre}
          </div>
        ))}
      </div>
    );
  }
  const porLinea: Record<LineaFutbol, Jugador[]> = { POR: [], DEF: [], MED: [], DEL: [] };
  js.forEach((j) => porLinea[lineaDePosicion(j.posicion)].push(j));
  const orden: LineaFutbol[] = porteroArriba ? ['POR', 'DEF', 'MED', 'DEL'] : ['DEL', 'MED', 'DEF', 'POR'];
  return (
    <div className="ijd-campo">
      <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 2, background: 'rgba(255,255,255,.14)' }} />
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: 56, height: 56, margin: -28, border: '2px solid rgba(255,255,255,.14)', borderRadius: '50%' }} />
      {orden.map((l) => (
        <div key={l} style={{ position: 'relative', display: 'flex', justifyContent: 'space-evenly' }}>
          {porLinea[l].map((j) => (
            <div key={j.id} style={{ width: 70, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
              <span style={{ position: 'relative', width: 30, height: 30, borderRadius: '50%', border: '2px solid #F5F7F5', background: COLOR[l], color: '#04140B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 12, boxShadow: '0 3px 8px rgba(0,0,0,.45)' }}>
                {inicialesJugador(j.nombre)}
                {j.equipo_real && (
                  <span style={{ position: 'absolute', right: -7, bottom: -5, background: '#F5F7F5', borderRadius: '50%', padding: 1.5, display: 'flex' }}>
                    <EscudoEquipo url={escudoDe(j.equipo_real)} alternativa={escudoAlternativo(j.equipo_real)} nombre={j.equipo_real} tam={14} />
                  </span>
                )}
              </span>
              <span style={{ maxWidth: '100%', fontSize: 10, fontWeight: 800, textShadow: '0 1px 3px #000', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {j.nombre.length <= 11 ? j.nombre : j.nombre.split(' ').slice(-1)[0]}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const CSS = `
.ijd-titulo{position:absolute;top:calc(12px + env(safe-area-inset-top));left:14px;z-index:9;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:13px;color:#F5C94A;letter-spacing:.08em}
.ijd-omitir{position:absolute;top:calc(8px + env(safe-area-inset-top));right:12px;z-index:9;width:auto;font-size:13px;font-weight:800;color:#F5F7F5;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.25);border-radius:20px;padding:6px 12px;cursor:pointer}
.ijd-mitad{position:absolute;left:0;right:0;height:50%;overflow:hidden;padding:0 14px 10px;display:flex;flex-direction:column}
.ijd-arriba{top:0;padding-top:calc(46px + env(safe-area-inset-top));background:linear-gradient(160deg,#2A0E14 0%,#12080B 70%);transform:translateX(-110%);animation:ijd-in .55s cubic-bezier(.2,.9,.2,1) .25s forwards}
.ijd-abajo{bottom:0;padding-top:34px;padding-bottom:calc(70px + env(safe-area-inset-bottom));background:linear-gradient(200deg,#0B2A1A 0%,#08120D 70%);transform:translateX(110%);animation:ijd-in .55s cubic-bezier(.2,.9,.2,1) .95s forwards}
@keyframes ijd-in{to{transform:translateX(0)}}
.ijd-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none}
.ijd-arriba .ijd-flash{animation:ijd-fl .5s ease-out .72s}
.ijd-abajo .ijd-flash{animation:ijd-fl .5s ease-out 1.42s}
@keyframes ijd-fl{0%{opacity:.95}100%{opacity:0}}
.ijd-raya{position:absolute;inset:-40%;background:linear-gradient(105deg,transparent 45%,rgba(255,255,255,.35) 50%,transparent 55%);transform:translateX(-100%);pointer-events:none}
.ijd-arriba .ijd-raya{animation:ijd-sw 1s ease-out .8s}
.ijd-abajo .ijd-raya{animation:ijd-sw 1s ease-out 1.5s}
@keyframes ijd-sw{to{transform:translateX(100%)}}
.ijd-campo{position:relative;flex:1;min-height:0;border-radius:12px;border:2px solid rgba(255,255,255,.16);background:repeating-linear-gradient(180deg,#17402A 0 37px,#143923 37px 74px);display:flex;flex-direction:column;justify-content:space-around;padding:6px 2px}
.ijd-arriba .ijd-campo{margin-bottom:30px}
.ijd-vs{position:absolute;left:50%;top:50%;width:76px;height:76px;margin:-38px;border-radius:50%;background:linear-gradient(180deg,#FFE08A,#E9B532 55%,#C9921E);color:#1A1405;display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:34px;z-index:5;box-shadow:0 0 0 5px #05080A,0 0 40px rgba(240,185,77,.6);transform:scale(0);animation:ijd-pop .45s cubic-bezier(.3,1.6,.5,1) 1.75s forwards}
@keyframes ijd-pop{to{transform:scale(1)}}
.ijd-vamos{position:absolute;left:50%;bottom:calc(14px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9;opacity:0;animation:ijd-ap .4s ease-out 2.4s forwards;background:#3DDC84;color:#04140B;border-radius:24px;padding:10px 26px;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:17px;white-space:nowrap;text-decoration:none}
@keyframes ijd-ap{to{opacity:1}}
`;
