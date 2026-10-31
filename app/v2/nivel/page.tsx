'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import MarcoV2, { Panel, Titulo } from '@/components/v2/MarcoV2';
import { useSesionV2 } from '@/components/v2/useSesionV2';
import Cargando from '@/components/Cargando';
import { BarraNivel, NivelBadge, UsuarioConNivel, useNiveles } from '@/components/v2/Nivel';

// ============================================================================
// MI NIVEL (31/10, Iñi) — como en Ludoteka (SQL 71)
// ============================================================================
// Puntuación de nivel (cada 100, un nivel), cómo se calcula y las últimas
// partidas. 01/11 (Iñi): al pulsar una partida se ve cómo quedó (todos), el
// botón "Ver la partida" (a la clasificación con detalle) y, debajo y plegado,
// el cálculo de los puntos de nivel.

type Detalle = { previa: number; contribucion: number; diferencia: number; coef_diferencia: number; ajuste: number; premio: number; premios?: number[]; integra: number; coef_reduccion: number; ajustada: number; anadido: number; nueva: number };
type Ultima = { ref_tipo: string; ref_id: string; ref_sub: string; titulo: string; deporte: string; posicion: number | null; participantes: number; puntos: number | null; xp: number; terminado_en: string; link: string | null; detalle: Detalle | null };
type FilaPartida = { usuario_id: string; nombre: string; posicion: number | null; puntos: number | null; xp: number; jugo: boolean; soy_yo: boolean };
type Nivel = { nivel: number; xp: number; xp_en_nivel: number; xp_siguiente: number; para_subir: number; jugadas: number; ganadas: number; nombre: string; ultimas: Ultima[] };
const ICONO: Record<string, string> = { futbol: '⚽', golf: '⛳', tenis: '🎾' };
const ROJO = '#FF8A8A';
const VERDE = '#3DDC84';
const f2 = (x: number | null | undefined) => (x === null || x === undefined ? '–' : Number(x).toFixed(2).replace('.', ','));
const conSigno = (x: number) => `${x > 0 ? '+' : ''}${f2(x)}`;

export default function MiNivel() {
  const { perfil, estado } = useSesionV2();
  const [n, setN] = useState<Nivel | null>(null);
  const [abierta, setAbierta] = useState<number | null>(null);
  useEffect(() => {
    if (estado !== 'ok') return;
    void supabase.rpc('mi_nivel').then(({ data }) => setN(data as Nivel));
  }, [estado]);

  return (
    <MarcoV2 perfil={perfil} estado={estado} deporte="futbol">
      <Titulo>Mi nivel</Titulo>
      {!n ? (
        <Cargando compacto />
      ) : (
        <>
          <Panel style={{ gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <NivelBadge nivel={n.nivel} size={64} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 30, color: S.TEXT, lineHeight: 1 }}>Nivel {n.nivel}</span>
                <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>
                  {n.jugadas} {n.jugadas === 1 ? 'partida' : 'partidas'} · {n.ganadas} {n.ganadas === 1 ? 'ganada' : 'ganadas'}
                </span>
              </div>
            </div>
            <BarraNivel n={n} />
          </Panel>

          <Panel style={{ gap: 6 }}>
            <span style={S.sectionLabel}>Últimas partidas</span>
            {n.ultimas.length === 0 && <span style={{ fontSize: 13, color: S.MUTED_2 }}>Todavía no has terminado ninguna partida.</span>}
            {n.ultimas.map((u, i) => {
              const abiertaU = abierta === i;
              return (
                <div key={i} style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)' }}>
                  <button type="button" onClick={() => setAbierta(abiertaU ? null : i)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {ICONO[u.deporte] ?? ''} {u.titulo}
                    </span>
                    <span style={{ fontSize: 12, color: S.MUTED_2 }}>{u.posicion ? `${u.posicion}º de ${u.participantes}` : 'sin equipo'}</span>
                    <span style={{ minWidth: 52, textAlign: 'right', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, color: u.xp > 0 ? VERDE : u.xp < 0 ? ROJO : S.MUTED_3 }}>{conSigno(Number(u.xp))}</span>
                    <span style={{ color: S.MUTED_3, fontSize: 11 }}>{abiertaU ? '▾' : '▸'}</span>
                  </button>
                  {abiertaU && <PartidaAbierta u={u} />}
                </div>
              );
            })}
          </Panel>

          <Panel style={{ gap: 8 }}>
            <span style={S.sectionLabel}>Cómo se sube (y se baja) de nivel</span>
            {[
              ['📈', 'Empiezas con 100 puntos (nivel 1). Cada 100 puntos, un nivel: con 3.821 eres nivel 38 y subes al 39 al llegar a 3.900. Si pierdes puntos, puedes bajar (nunca por debajo del nivel 1).'],
              ['💰', 'En cada partida terminada (sala, duelo de la liga o jornada de una liga privada) cada jugador pone 35 puntos en un bote, y el bote se reparte por puestos: el primero se lleva la mayor parte y el último, nada.'],
              ['⬆️', 'Ajuste por nivel: si tus rivales tienen más nivel que tú, sumas algo más; si tienen menos, algo menos.'],
              ['⚖️', 'Cuanto más alto es tu nivel, más se reduce lo que ganas (no lo que pierdes), así que arriba cuesta más subir.'],
              ['🎁', 'Y por jugar, un pequeño valor añadido: más en los primeros niveles y casi nada en los altos.'],
              ['🙅', 'Si no haces equipo, esa partida no cuenta para tu nivel.'],
              ['🔷', 'Cada 10 niveles cambia tu insignia: círculo, cuadrado, triángulo, rombo, pentágono, hexágono y estrella.'],
            ].map(([i, t]) => (
              <div key={t} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 16 }}>{i}</span>
                <span style={{ fontSize: 13, color: S.MUTED, lineHeight: 1.45 }}>{t}</span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              {[1, 11, 21, 31, 41, 51, 61].map((x) => (
                <NivelBadge key={x} nivel={x} size={28} />
              ))}
            </div>
          </Panel>
        </>
      )}
    </MarcoV2>
  );
}

function PartidaAbierta({ u }: { u: Ultima }) {
  const [filas, setFilas] = useState<FilaPartida[] | null>(null);
  const [verCalculo, setVerCalculo] = useState(false);
  const niveles = useNiveles((filas ?? []).map((f) => f.usuario_id));
  useEffect(() => {
    void supabase.rpc('partida_clasificacion', { p_tipo: u.ref_tipo, p_id: u.ref_id, p_sub: u.ref_sub }).then(({ data }) => setFilas((data as FilaPartida[]) ?? []));
  }, [u.ref_tipo, u.ref_id, u.ref_sub]);
  const d = u.detalle;
  const miId = filas?.find((f) => f.soy_yo)?.usuario_id;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '0 0 12px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid #1E2823', padding: '4px 12px' }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: S.MUTED_3, padding: '6px 0 2px' }}>Clasificación</span>
        {filas === null ? (
          <Cargando compacto />
        ) : (
          filas.map((f) => (
            <div key={f.usuario_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 13 }}>
              <span style={{ width: 26, fontWeight: 800, color: f.posicion === 1 ? '#F0B94D' : S.MUTED_2 }}>{f.posicion ? `${f.posicion}º` : '–'}</span>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 700, color: f.soy_yo ? VERDE : S.TEXT }}>
                <UsuarioConNivel id={f.usuario_id} nombre={f.nombre} nivel={niveles.get(f.usuario_id)} miId={miId} />
              </span>
              <span style={{ color: S.MUTED_2, fontSize: 12.5 }}>{f.jugo ? `${f2(f.puntos).replace(/,00$/, '')} pts` : 'sin equipo'}</span>
              <span style={{ minWidth: 50, textAlign: 'right', fontWeight: 800, fontSize: 12.5, color: f.xp > 0 ? VERDE : f.xp < 0 ? ROJO : S.MUTED_3 }}>{f.jugo ? conSigno(Number(f.xp)) : ''}</span>
            </div>
          ))
        )}
        <span style={{ fontSize: 10.5, color: S.MUTED_3, padding: '4px 0 6px' }}>A la derecha, lo que ganó o perdió cada uno de nivel.</span>
      </div>
      {u.link && (
        <Link href={u.link} style={{ ...S.secondaryLinkButton, marginTop: 0, textAlign: 'center', textDecoration: 'none' }}>
          Ver la partida
        </Link>
      )}
      {d && (
        <button type="button" onClick={() => setVerCalculo(!verCalculo)} style={{ alignSelf: 'center', background: 'none', border: 'none', color: S.MUTED_2, fontSize: 12.5, cursor: 'pointer', padding: 4 }}>
          {verCalculo ? '▾ Ocultar el cálculo de tus puntos de nivel' : '▸ Ver cómo se han calculado tus puntos de nivel'}
        </button>
      )}
      {d && verCalculo && (
        <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid #1E2823', padding: '4px 12px' }}>
          {(
            [
              ['Puntuación previa', f2(d.previa), true],
              ['Contribución fija de cada jugador', f2(d.contribucion), true],
              ['Diferencia de nivel con los rivales', f2(d.diferencia), false],
              ['Coeficiente de diferencia de nivel', f2(d.coef_diferencia), false],
              ['Ajuste por diferencia de nivel', f2(d.ajuste), true],
              ['Puntos según el puesto', (d.premios ?? []).slice(0, -1).map((p, k) => `${k + 1}: ${f2(p)}`).join(' | '), false],
              ['Suma por tu puesto', f2(d.premio), true],
              ['Suma íntegra', f2(d.integra), true],
              ['Coeficiente de reducción', Number(d.coef_reduccion).toFixed(3).replace('.', ','), false],
              ['Suma ajustada', f2(d.ajustada), true],
              ['Valor añadido según tu nivel', f2(d.anadido), false],
              ['Nueva puntuación', f2(d.nueva), true],
            ] as [string, string, boolean][]
          ).map(([t, v, fuerte]) => (
            <div key={t} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 12.5 }}>
              <span style={{ color: S.MUTED }}>{t}</span>
              <span style={{ textAlign: 'right', fontWeight: fuerte ? 800 : 600, color: fuerte ? S.TEXT : S.MUTED_2 }}>{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
