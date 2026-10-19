'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import MarcoPocha, { ORO, ROJO, VERDE, useAccesoPocha } from '@/components/pocha/MarcoPocha';
import { PINTAS, TIPO_TEXTO, acumulados, generarManos, manoCompleta, ordenDePedir, puntosMano, quienReparte, totales, type ManoApuntada, type PartidaPocha, type Pinta } from '@/lib/pocha';

// ============================================================================
// HOJA DE LA POCHA (19/10, Iñi)
// ============================================================================
// Como la hoja de papel: a la izquierda lo que pide cada uno, en el centro las
// manos (1, 1, 1, 1, 2, 3… hasta todas y bajando) y a la derecha los puntos
// acumulados de cada uno.
// Iñi: "que sea muy dinámico… el cursor siempre en el siguiente del que
// reparte… y simplemente tenga que dar a los números". Debajo hay un teclado
// propio siempre a la vista (el del móvil se cierra en cuanto tocas otra
// cosa): tocas el número y salta solo al siguiente. Primero se apunta lo que
// pide cada uno (empezando por el siguiente al que reparte) y luego, en el
// mismo orden, si ha acertado (✓) o por cuántas ha fallado (✗ 1, 2, 3…).
// Pinta oros ×2 · pinta el 5 de bastos ×3.

type Cursor = { fase: 'pide' | 'resultado'; jugador: number } | null;

function cursorInicial(m: ManoApuntada, orden: number[]): Cursor {
  const sinPedir = orden.find((j) => m.pedidas[j] === null || m.pedidas[j] === undefined);
  if (sinPedir !== undefined) return { fase: 'pide', jugador: sinPedir };
  const sinResultado = orden.find((j) => m.resultado[j] === null || m.resultado[j] === undefined);
  if (sinResultado !== undefined) return { fase: 'resultado', jugador: sinResultado };
  return null;
}

function corto(nombre: string, max = 6): string {
  return nombre.length <= max ? nombre : nombre.slice(0, max - 1) + '.';
}

export default function HojaPocha() {
  const { id } = useParams<{ id: string }>();
  const { perfil, estado } = useAccesoPocha();
  const [partida, setPartida] = useState<PartidaPocha | null>(null);
  const [noExiste, setNoExiste] = useState(false);
  const [sel, setSel] = useState(0);
  const [cursor, setCursor] = useState<Cursor>(null);
  const [guardado, setGuardado] = useState<'ok' | 'guardando' | 'error'>('ok');
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tablaRef = useRef<HTMLDivElement | null>(null);

  const n = partida?.jugadores.length ?? 0;
  const primero = partida?.reparte_primero ?? 0;
  const defs = useMemo(() => (partida ? generarManos(n, { subastadas: partida.subastadas, ciegas: partida.ciegas }) : []), [partida, n]);

  // Carga
  useEffect(() => {
    if (estado !== 'ok' || !id) return;
    void supabase
      .from('pocha_partidas')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        const p = data as PartidaPocha | null;
        if (!p) return setNoExiste(true);
        const jug = p.jugadores.length;
        const d = generarManos(jug, { subastadas: p.subastadas, ciegas: p.ciegas });
        // Por si acaso: tantas manos apuntadas como manos tiene la partida.
        const manos = d.map((_, i) => p.manos[i] ?? { pedidas: Array(jug).fill(null), resultado: Array(jug).fill(null), pinta: 1 as Pinta });
        const partidaOk = { ...p, reparte_primero: p.reparte_primero ?? 0, manos };
        setPartida(partidaOk);
        const primeraAbierta = manos.findIndex((m) => !manoCompleta(m, jug));
        const i = primeraAbierta === -1 ? manos.length - 1 : primeraAbierta;
        setSel(i);
        setCursor(cursorInicial(manos[i], ordenDePedir(i, jug, partidaOk.reparte_primero)));
      });
  }, [estado, id]);

  // La mano elegida, a la vista en la hoja.
  useEffect(() => {
    const fila = tablaRef.current?.querySelector(`[data-mano="${sel}"]`) as HTMLElement | null;
    const caja = tablaRef.current;
    if (fila && caja) caja.scrollTo({ top: Math.max(0, fila.offsetTop - caja.clientHeight / 2 + fila.clientHeight), behavior: 'smooth' });
  }, [sel, partida?.id]);

  const guardar = useCallback(
    (p: PartidaPocha) => {
      setGuardado('guardando');
      if (temporizador.current) clearTimeout(temporizador.current);
      temporizador.current = setTimeout(async () => {
        const terminada = p.manos.every((m) => manoCompleta(m, p.jugadores.length));
        const { error } = await supabase.from('pocha_partidas').update({ manos: p.manos, terminada, updated_at: new Date().toISOString() }).eq('id', p.id);
        setGuardado(error ? 'error' : 'ok');
      }, 500);
    },
    []
  );

  function cambiarMano(i: number, cambio: (m: ManoApuntada) => ManoApuntada) {
    if (!partida) return;
    const manos = partida.manos.map((m, k) => (k === i ? cambio({ pedidas: [...m.pedidas], resultado: [...m.resultado], pinta: m.pinta }) : m));
    const p = { ...partida, manos, terminada: manos.every((m) => manoCompleta(m, n)) };
    setPartida(p);
    guardar(p);
    return p.manos[i];
  }

  function elegirMano(i: number) {
    if (!partida) return;
    setSel(i);
    setCursor(cursorInicial(partida.manos[i], ordenDePedir(i, n, primero)));
  }

  // Tecla del teclado: apunta y salta al siguiente.
  function pulsar(valor: number) {
    if (!partida || !cursor) return;
    const orden = ordenDePedir(sel, n, primero);
    const pos = orden.indexOf(cursor.jugador);
    const m = cambiarMano(sel, (x) => {
      if (cursor.fase === 'pide') x.pedidas[cursor.jugador] = valor;
      else x.resultado[cursor.jugador] = valor;
      return x;
    });
    if (!m) return;
    if (pos < orden.length - 1) {
      // Siguiente en el orden (en "pide", al siguiente aunque ya tuviera algo: así se puede corregir de corrido).
      setCursor({ fase: cursor.fase, jugador: orden[pos + 1] });
    } else if (cursor.fase === 'pide') {
      setCursor({ fase: 'resultado', jugador: orden[0] });
    } else {
      const falta = cursorInicial(m, orden);
      setCursor(falta);
    }
  }

  function siguienteMano() {
    if (!partida) return;
    const i = Math.min(sel + 1, partida.manos.length - 1);
    elegirMano(i);
  }

  if (estado === 'ok' && noExiste)
    return (
      <MarcoPocha perfil={perfil} estado={estado} volverA="/pocha">
        <span style={{ color: S.MUTED }}>Esta partida no existe.</span>
      </MarcoPocha>
    );

  if (!partida)
    return (
      <MarcoPocha perfil={perfil} estado={estado === 'ok' ? 'cargando' : estado} volverA="/pocha">
        {null}
      </MarcoPocha>
    );

  const jugadores = partida.jugadores;
  const acum = acumulados(partida.manos, n);
  const tot = totales(partida.manos, n);
  const ranking = jugadores.map((nombre, j) => ({ nombre, j, total: tot[j] })).sort((a, b) => b.total - a.total);
  const hechas = partida.manos.filter((m) => manoCompleta(m, n)).length;
  const terminada = hechas === partida.manos.length;
  const def = defs[sel];
  const mano = partida.manos[sel];
  const orden = ordenDePedir(sel, n, primero);
  const reparte = quienReparte(sel, n, primero);
  const sumaPedidas = mano.pedidas.reduce<number>((s, x) => s + (x ?? 0), 0);
  const todasPedidas = mano.pedidas.every((x) => x !== null && x !== undefined);
  const completa = manoCompleta(mano, n);

  // Anchos de la hoja: que quepa en el móvil.
  // (~356 px útiles en un móvil de 390: 2 columnas por jugador + 46 de la mano)
  const anchoCol = Math.min(40, Math.floor(308 / (2 * n)));
  const letras = n <= 4 ? 6 : n <= 5 ? 5 : 3;
  const celda = { width: anchoCol, minWidth: anchoCol, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: n <= 5 ? 13 : 11, fontWeight: 800 } as const;

  return (
    <MarcoPocha perfil={perfil} estado={estado} volverA="/pocha">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 26, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{partida.nombre || 'Pocha'}</h1>
          <span style={{ fontSize: 12, color: S.MUTED_2 }}>
            {terminada ? 'Partida terminada' : `Mano ${Math.min(hechas + 1, partida.manos.length)} de ${partida.manos.length}`}
            {partida.subastadas ? ' · subastadas' : ''}
            {partida.ciegas ? ' · a ciegas' : ''}
          </span>
        </div>
        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: guardado === 'error' ? S.ERROR : S.MUTED_3 }}>{guardado === 'guardando' ? 'Guardando…' : guardado === 'error' ? 'Sin guardar' : 'Guardado ✓'}</span>
      </div>

      {/* Clasificación */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        {ranking.map((r, k) => (
          <div key={r.j} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 999, background: k === 0 && hechas > 0 ? 'rgba(240,185,77,0.14)' : S.PANEL, border: `1px solid ${k === 0 && hechas > 0 ? 'rgba(240,185,77,0.5)' : S.CARD_BORDER}` }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: k === 0 && hechas > 0 ? ORO : S.MUTED_3 }}>{k + 1}º</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: S.TEXT }}>{r.nombre}</span>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 17, fontWeight: 800, color: r.total < 0 ? ROJO : VERDE }}>{r.total}</span>
          </div>
        ))}
      </div>

      {terminada && (
        <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(240,185,77,0.12)', border: '1px solid rgba(240,185,77,0.5)', textAlign: 'center', fontWeight: 800, color: ORO }}>
          🏆 ¡Gana {ranking[0].nombre} con {ranking[0].total} puntos!
        </div>
      )}

      {/* Hoja: pide | manos | puntos */}
      <div ref={tablaRef} style={{ maxHeight: '38vh', overflow: 'auto', borderRadius: 12, border: `1px solid ${S.CARD_BORDER}`, background: '#0E1311', position: 'relative' }}>
        <div style={{ display: 'flex', flexDirection: 'column', width: 'max-content', minWidth: '100%' }}>
          <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 2, background: '#141B18', borderBottom: `1px solid ${S.CARD_BORDER}`, justifyContent: 'center' }}>
            {jugadores.map((nombre, j) => (
              <span key={`pi${j}`} style={{ ...celda, height: 34, fontSize: 10.5, color: S.MUTED, flexDirection: 'column', lineHeight: 1.05 }}>
                {corto(nombre, letras)}
                <span style={{ fontSize: 8.5, color: S.MUTED_3, fontWeight: 700 }}>pide</span>
              </span>
            ))}
            <span style={{ ...celda, width: 46, minWidth: 46, height: 34, fontSize: 10, color: S.MUTED_3, borderLeft: `1px solid ${S.CARD_BORDER}`, borderRight: `1px solid ${S.CARD_BORDER}` }}>Mano</span>
            {jugadores.map((nombre, j) => (
              <span key={`pu${j}`} style={{ ...celda, height: 34, fontSize: 10.5, color: S.MUTED, flexDirection: 'column', lineHeight: 1.05 }}>
                {corto(nombre, letras)}
                <span style={{ fontSize: 8.5, color: S.MUTED_3, fontWeight: 700 }}>{n <= 5 ? 'puntos' : 'pts'}</span>
              </span>
            ))}
          </div>
          {defs.map((d, i) => {
            const m = partida.manos[i];
            const activa = i === sel;
            const rep = quienReparte(i, n, primero);
            const pinta = PINTAS.find((p) => p.valor === m.pinta);
            return (
              <button
                key={i}
                type="button"
                data-mano={i}
                onClick={() => elegirMano(i)}
                style={{ display: 'flex', justifyContent: 'center', width: '100%', padding: 0, border: 'none', borderTop: '1px solid #18201C', background: activa ? 'rgba(61,220,132,0.12)' : 'transparent', outline: activa ? `1.5px solid ${S.ACCENT}` : 'none', outlineOffset: -1.5, cursor: 'pointer' }}
              >
                {jugadores.map((_, j) => {
                  const pd = m.pedidas[j];
                  return (
                    <span key={`p${j}`} style={{ ...celda, color: S.TEXT, position: 'relative' }}>
                      {pd ?? ''}
                      {j === rep && <span style={{ position: 'absolute', bottom: 3, left: '50%', transform: 'translateX(-50%)', width: 14, height: 2, borderRadius: 2, background: ORO }} />}
                    </span>
                  );
                })}
                <span style={{ ...celda, width: 46, minWidth: 46, flexDirection: 'column', lineHeight: 1, borderLeft: `1px solid ${S.CARD_BORDER}`, borderRight: `1px solid ${S.CARD_BORDER}`, background: d.tipo === 'subastada' ? 'rgba(240,185,77,0.13)' : d.tipo === 'ciega' ? 'rgba(167,139,250,0.15)' : 'transparent' }}>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 17, color: d.tipo === 'subastada' ? ORO : d.tipo === 'ciega' ? '#A78BFA' : S.TEXT }}>{d.cartas}</span>
                  {(pinta?.corto || d.tipo !== 'normal') && <span style={{ fontSize: 7.5, fontWeight: 800, color: pinta?.corto ? ORO : S.MUTED_3 }}>{pinta?.corto || (d.tipo === 'subastada' ? 'SUB' : 'CIEGA')}</span>}
                </span>
                {jugadores.map((_, j) => {
                  const v = acum[i][j];
                  const r = m.resultado[j];
                  return (
                    <span key={`t${j}`} style={{ ...celda, color: v === null ? S.MUTED_3 : r === 0 ? VERDE : ROJO }}>
                      {v ?? ''}
                    </span>
                  );
                })}
              </button>
            );
          })}
        </div>
      </div>
      <span style={{ fontSize: 11, color: S.MUTED_3, marginTop: -8 }}>
        <span style={{ display: 'inline-block', width: 12, height: 2, background: ORO, verticalAlign: 'middle', marginRight: 4 }} />
        reparte · toca una mano para verla o corregirla
      </span>

      {/* Mano elegida */}
      <div style={{ background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 21, color: S.TEXT }}>
              Mano {sel + 1} · {def.cartas} {def.cartas === 1 ? 'carta' : 'cartas'}
              {def.tipo !== 'normal' && <span style={{ marginLeft: 8, fontSize: 14, color: def.tipo === 'subastada' ? ORO : '#A78BFA' }}>{TIPO_TEXTO[def.tipo]}</span>}
            </span>
            <span style={{ fontSize: 12, color: S.MUTED_2 }}>
              Reparte <b style={{ color: ORO }}>{jugadores[reparte]}</b> · piden {sumaPedidas} de {def.cartas}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" aria-label="Mano anterior" disabled={sel === 0} onClick={() => elegirMano(sel - 1)} style={{ width: 34, height: 34, padding: 0, borderRadius: 9, border: `1px solid ${S.BORDER}`, background: 'transparent', color: S.TEXT, cursor: 'pointer', opacity: sel === 0 ? 0.3 : 1 }}>
              ‹
            </button>
            <button type="button" aria-label="Mano siguiente" disabled={sel === partida.manos.length - 1} onClick={() => elegirMano(sel + 1)} style={{ width: 34, height: 34, padding: 0, borderRadius: 9, border: `1px solid ${S.BORDER}`, background: 'transparent', color: S.TEXT, cursor: 'pointer', opacity: sel === partida.manos.length - 1 ? 0.3 : 1 }}>
              ›
            </button>
          </div>
        </div>

        {/* Qué pinta */}
        <div style={{ display: 'flex', gap: 6 }}>
          {PINTAS.map((p) => (
            <button key={p.valor} type="button" onClick={() => cambiarMano(sel, (x) => ({ ...x, pinta: p.valor }))} style={{ ...S.pill(mano.pinta === p.valor), width: 'auto', flex: 1, padding: '7px 6px', fontSize: 12 }}>
              {p.valor === 2 ? '🟡 ' : p.valor === 3 ? '🪵 ' : ''}
              {p.texto}
            </button>
          ))}
        </div>

        {/* Jugadores en el orden de pedir */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {orden.map((j) => {
            const pd = mano.pedidas[j];
            const r = mano.resultado[j];
            const pts = puntosMano(pd ?? null, r ?? null, mano.pinta);
            const enPide = cursor?.fase === 'pide' && cursor.jugador === j;
            const enRes = cursor?.fase === 'resultado' && cursor.jugador === j;
            return (
              <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 4px 4px 10px', borderRadius: 10, background: enPide || enRes ? 'rgba(61,220,132,0.08)' : 'transparent' }}>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 800, fontSize: 14, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {jugadores[j]}
                  {j === reparte && <span style={{ marginLeft: 6, fontSize: 10.5, color: ORO }}>reparte</span>}
                </span>
                <button type="button" onClick={() => setCursor({ fase: 'pide', jugador: j })} style={{ width: 62, height: 36, padding: 0, borderRadius: 9, border: `2px solid ${enPide ? S.ACCENT : S.BORDER}`, background: enPide ? 'rgba(61,220,132,0.12)' : 'transparent', color: S.TEXT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <span style={{ fontSize: 9.5, color: S.MUTED_3, fontWeight: 700 }}>pide</span>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 19 }}>{pd ?? '–'}</span>
                </button>
                <button
                  type="button"
                  disabled={pd === null || pd === undefined}
                  onClick={() => setCursor({ fase: 'resultado', jugador: j })}
                  style={{ width: 62, height: 36, padding: 0, borderRadius: 9, border: `2px solid ${enRes ? S.ACCENT : S.BORDER}`, background: enRes ? 'rgba(61,220,132,0.12)' : 'transparent', color: r === 0 ? VERDE : r ? ROJO : S.MUTED_3, cursor: 'pointer', fontWeight: 800, fontSize: 14, opacity: pd === null || pd === undefined ? 0.4 : 1 }}
                >
                  {r === 0 ? '✓' : r ? `✗ ${r}` : '?'}
                </button>
                <span style={{ width: 44, textAlign: 'right', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 18, color: pts === null ? S.MUTED_3 : pts >= 0 ? VERDE : ROJO }}>{pts === null ? '' : pts > 0 ? `+${pts}` : pts}</span>
              </div>
            );
          })}
        </div>

        {/* Teclado */}
        {cursor ? (
          <div data-teclado="" style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4, borderTop: `1px solid ${S.CARD_BORDER}` }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: S.TEXT, textAlign: 'center' }}>
              {cursor.fase === 'pide' ? (
                <>
                  ¿Cuántas pide <span style={{ color: S.ACCENT }}>{jugadores[cursor.jugador]}</span>?
                </>
              ) : (
                <>
                  ¿<span style={{ color: S.ACCENT }}>{jugadores[cursor.jugador]}</span> ha hecho {mano.pedidas[cursor.jugador] ?? 0}?
                </>
              )}
            </span>
            {cursor.fase === 'pide' ? (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${def.cartas + 1 <= 6 ? def.cartas + 1 : Math.min(7, Math.ceil((def.cartas + 1) / 2))}, 1fr)`, gap: 6 }}>
                {Array.from({ length: def.cartas + 1 }).map((_, v) => {
                  // El que reparte: si pide este número, la suma cuadra con las cartas.
                  const otras = sumaPedidas - (mano.pedidas[cursor.jugador] ?? 0);
                  const cuadra = cursor.jugador === reparte && otras + v === def.cartas;
                  return (
                    <button key={v} type="button" onClick={() => pulsar(v)} style={{ height: 52, padding: 0, borderRadius: 12, border: `1px solid ${cuadra ? 'rgba(255,138,138,0.6)' : S.BORDER}`, background: mano.pedidas[cursor.jugador] === v ? 'rgba(61,220,132,0.18)' : '#1A211D', color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 26, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                      {v}
                      {cuadra && <span style={{ fontFamily: "'Manrope', sans-serif", fontSize: 8.5, fontWeight: 700, color: ROJO }}>cuadra</span>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button type="button" onClick={() => pulsar(0)} style={{ height: 52, borderRadius: 12, border: '1px solid rgba(61,220,132,0.6)', background: 'rgba(61,220,132,0.16)', color: VERDE, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, cursor: 'pointer' }}>
                  ✓ Acertada
                </button>
                <span style={{ fontSize: 12, fontWeight: 700, color: ROJO, textAlign: 'center' }}>✗ Fallada por:</span>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(def.cartas, 7)}, 1fr)`, gap: 6 }}>
                  {Array.from({ length: def.cartas }).map((_, k) => (
                    <button key={k} type="button" onClick={() => pulsar(k + 1)} style={{ height: 46, padding: 0, borderRadius: 12, border: '1px solid rgba(255,138,138,0.45)', background: mano.resultado[cursor.jugador] === k + 1 ? 'rgba(255,92,92,0.22)' : 'rgba(255,92,92,0.08)', color: ROJO, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, cursor: 'pointer' }}>
                      {k + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          completa &&
          sel < partida.manos.length - 1 && (
            <button type="button" onClick={siguienteMano} style={{ ...S.primaryButton }}>
              Siguiente mano →
            </button>
          )
        )}
        {!todasPedidas && cursor?.fase === 'resultado' && <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>Faltan pedidas por apuntar.</span>}
      </div>
    </MarcoPocha>
  );
}
