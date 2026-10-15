'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { PelotaDeporte, type DeporteV2 } from '@/components/v2/IconosV2';
import { mensajeError } from '@/lib/v2';

// ============================================================================
// PANEL DE LA LIGA (V2, 15/10): información de la temporada + apuntarse
// ============================================================================
// Lo que se ve directamente al entrar en la pestaña Liga si todavía no estás
// apuntado (Iñi: sin paso previo), y arriba de la clasificación de la liga:
// fechas, jornadas que cuentan, división en la que empiezas, Gran Final,
// descensos, grupos, botón grande para apuntarse y lista de apuntados.

export type Division = { nivel: number; nombre: string; grupos: number; jugadores: number };
export type Info = {
  temporada_id: string;
  liga: string;
  numero: number;
  inicio: string;
  fin: string;
  en_curso: boolean;
  divisiones: Division[];
  apuntados: number;
  yo: { nivel: number; grupo: number } | null;
  lista: { usuario_id: string; nombre: string; nivel: number; grupo: number; soy_yo: boolean }[];
  // 15/10 (Iñi): qué jornadas de Liga y de Champions cuentan en la temporada.
  jornadas?: { liga: string; desde: number; hasta: number; total: number }[];
};
export type Fila = { usuario_id: string; nombre: string; draftis: number; mesas: number; ganadas: number; soy_yo: boolean; nivel: number; grupo: number };

const COLOR_NIVEL: Record<number, string> = { 1: '#D4A537', 2: '#BCC3CB', 3: '#B9763E' };
const NOMBRE_NIVEL: Record<number, string> = { 1: 'Primera', 2: 'Segunda', 3: 'Tercera' };
const UMBRAL_DIVISION_UNICA = 150;
const MIN_FINALISTAS = 30;

function fechaLarga(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' });
}

// Cifras de la temporada a partir de los apuntados y las divisiones.
function reglas(info: Info) {
  const divs = info.divisiones.length > 0 ? info.divisiones : [{ nivel: 1, nombre: 'Primera', grupos: 1, jugadores: info.apuntados }];
  const unica = divs.length === 1;
  const primera = divs[0];
  const enPrimera = unica ? info.apuntados : primera.jugadores;
  const finalistas = Math.max(MIN_FINALISTAS, Math.ceil(enPrimera * 0.3));
  const nombreDe = (nivel: number) => divs.find((d) => d.nivel === nivel)?.nombre ?? NOMBRE_NIVEL[nivel] ?? `División ${nivel}`;
  // Con varias divisiones: sube el 15 % de cada grupo de abajo y baja el mismo número.
  const movimientos = divs.slice(1).map((d) => {
    const porGrupo = Math.max(1, Math.round((d.jugadores / Math.max(1, d.grupos)) * 0.15));
    const arriba = divs.find((x) => x.nivel === d.nivel - 1);
    return { de: d, arriba, suben: porGrupo, bajanTotal: porGrupo * d.grupos, bajanPorGrupo: Math.round((porGrupo * d.grupos) / Math.max(1, arriba?.grupos ?? 1)) };
  });
  return { divs, unica, enPrimera, finalistas, nombreDe, movimientos, bajanSiSeParte: info.apuntados > UMBRAL_DIVISION_UNICA ? info.apuntados - Math.ceil(info.apuntados / 3) : 0 };
}


export default function PanelLiga({ info, deporte, onApuntado, conLista = true }: { info: Info; deporte: DeporteV2; onApuntado: () => void; conLista?: boolean }) {
  const [apuntando, setApuntando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recienApuntado, setRecienApuntado] = useState(false);
  const r = reglas(info);
  const yo = info.yo;

  async function apuntarme() {
    setApuntando(true);
    setError(null);
    const { error: e } = await supabase.rpc('v2_apuntarse_liga', { p_deporte: deporte });
    setApuntando(false);
    if (e) return setError(mensajeError(e));
    setRecienApuntado(true);
    try {
      navigator.vibrate?.(60);
    } catch {}
    onApuntado();
  }

  return (
    <>
          {/* ---------------- Información de la temporada ---------------- */}
          <div style={{ borderRadius: 18, padding: '18px 18px 20px', border: '1px solid rgba(240,185,77,0.45)', background: 'linear-gradient(160deg, #2A2210 0%, #1A1608 55%, #12100A 100%)', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <PelotaDeporte deporte={deporte} size={28} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, color: '#F3D27A', lineHeight: 1.05 }}>
                  {info.en_curso ? `Temporada ${info.numero} en juego` : `La Temporada ${info.numero} empieza pronto`}
                </span>
                <span style={{ fontSize: 12.5, color: S.MUTED }}>
                  {info.en_curso ? `Termina el ${fechaLarga(info.fin)}` : `Del ${fechaLarga(info.inicio)} al ${fechaLarga(info.fin)}`}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {deporte === 'futbol' && (
                <Dato icono="📅" titulo="Jornadas que cuentan">
                  {info.jornadas && info.jornadas.length > 0 ? (
                    info.jornadas.map((j) => (
                      <span key={j.liga} style={{ display: 'block' }}>
                        <b style={{ color: S.TEXT }}>{j.liga.replace('Champions League', 'Champions')}</b>: {j.desde === j.hasta ? `jornada ${j.desde}` : `jornadas ${j.desde} a ${j.hasta}`} ({j.total})
                      </span>
                    ))
                  ) : (
                    <>Todas las jornadas de Liga y de Champions que se jueguen entre esas fechas.</>
                  )}
                </Dato>
              )}
              <Dato icono="🎯" titulo={yo ? 'Tu división' : 'Empezarías en'}>
                {yo ? (
                  <>
                    <b style={{ color: COLOR_NIVEL[yo.nivel] ?? S.TEXT }}>{r.nombreDe(yo.nivel)}</b>
                    {(r.divs.find((d) => d.nivel === yo.nivel)?.grupos ?? 1) > 1 ? ` · Grupo ${yo.grupo}` : ''}
                    {r.unica ? ' (división única)' : ''}
                  </>
                ) : r.unica ? (
                  <>
                    <b style={{ color: COLOR_NIVEL[1] }}>Primera</b> — de momento hay una única división y jugáis todos juntos.
                  </>
                ) : (
                  <>
                    <b style={{ color: COLOR_NIVEL[r.divs[r.divs.length - 1].nivel] ?? S.TEXT }}>{r.divs[r.divs.length - 1].nombre}</b>
                    {r.divs[r.divs.length - 1].grupos > 1 ? `, en el grupo con menos gente (hay ${r.divs[r.divs.length - 1].grupos} grupos)` : ''}. Los nuevos empiezan en la división más baja.
                  </>
                )}
              </Dato>

              <Dato icono="🏆" titulo="Gran Final">
                Pasan los <b style={{ color: S.TEXT }}>{r.finalistas} mejores</b> de {r.unica ? 'la clasificación' : r.nombreDe(1)}
                {r.enPrimera > 0 && r.enPrimera <= r.finalistas ? ` (de momento sois ${r.enPrimera}: entraríais todos)` : ''}, más una plaza para el que más amigos traiga.
              </Dato>

              <Dato icono="⬇️" titulo="Descensos">
                {r.unica ? (
                  r.bajanSiSeParte > 0 ? (
                    <>
                      Ya sois {info.apuntados}: al acabar la temporada <b style={{ color: '#FF8A8A' }}>bajan los {r.bajanSiSeParte} últimos</b> y la próxima se abre la Segunda división.
                    </>
                  ) : (
                    <>No baja nadie: hasta {UMBRAL_DIVISION_UNICA} jugadores hay una sola división. Si al final sois más, los últimos bajarán y se abrirá la Segunda.</>
                  )
                ) : (
                  r.movimientos.map((m) => (
                    <span key={m.de.nivel} style={{ display: 'block' }}>
                      {m.arriba?.nombre ?? r.nombreDe(m.de.nivel - 1)} ↔ {m.de.nombre}: <b style={{ color: '#FF8A8A' }}>bajan {m.bajanPorGrupo}</b>
                      {(m.arriba?.grupos ?? 1) > 1 ? ' de cada grupo' : ''} y <b style={{ color: S.ACCENT }}>suben los {m.suben} mejores</b>
                      {m.de.grupos > 1 ? ` de cada grupo de ${m.de.nombre}` : ` de ${m.de.nombre}`}.
                    </span>
                  ))
                )}
              </Dato>

              {r.divs.some((d) => d.grupos > 1) && (
                <Dato icono="👥" titulo="Grupos">
                  {r.divs
                    .filter((d) => d.grupos > 1)
                    .map((d) => `${d.nombre}: ${d.grupos} grupos`)
                    .join(' · ')}
                  . Cada grupo tiene su propia clasificación.
                </Dato>
              )}
            </div>

            {yo ? (
              <motion.div initial={recienApuntado ? { scale: 0.9, opacity: 0 } : false} animate={{ scale: 1, opacity: 1 }} style={{ textAlign: 'center', padding: '14px 12px', borderRadius: 14, border: `1.5px solid ${S.ACCENT}`, background: 'rgba(61,220,132,0.12)', color: S.ACCENT, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20 }}>
                ✓ {recienApuntado ? '¡Ya estás dentro!' : 'Estás apuntado a la liga'}
              </motion.div>
            ) : (
              <button
                type="button"
                onClick={apuntarme}
                disabled={apuntando}
                style={{ width: '100%', padding: '18px 12px', borderRadius: 14, border: 'none', background: 'linear-gradient(135deg, #F3D27A 0%, #D4A537 100%)', color: '#2A1E05', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: '0.03em', cursor: 'pointer', boxShadow: '0 8px 24px rgba(212,165,55,0.3)', opacity: apuntando ? 0.6 : 1 }}
              >
                {apuntando ? 'APUNTANDO...' : 'APUNTARME A LA LIGA'}
              </button>
            )}
            {!yo && <span style={{ fontSize: 11.5, color: S.MUTED_2, textAlign: 'center', marginTop: -6 }}>Es gratis. Solo cuentan para la liga las mesas de los que estáis apuntados.</span>}
            {error && <p style={S.errorText}>{error}</p>}
          </div>

          {/* ---------------- Apuntados (antes de empezar) ---------------- */}
          {conLista && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={S.sectionLabel}>Apuntados ({info.apuntados})</span>
              {info.lista.length === 0 && <span style={{ fontSize: 13, color: S.MUTED_3 }}>Todavía no se ha apuntado nadie. ¡Sé el primero!</span>}
              <div style={{ display: 'flex', flexDirection: 'column', background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
                {info.lista.map((p, i) => (
                  <div key={p.usuario_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: i ? `1px solid ${S.CARD_BORDER}` : 'none', background: p.soy_yo ? 'rgba(61,220,132,0.08)' : 'transparent' }}>
                    <span style={{ width: 26, height: 26, borderRadius: 999, background: 'rgba(240,185,77,0.15)', color: '#F0B94D', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>{p.nombre.slice(0, 1).toUpperCase()}</span>
                    <span style={{ flex: 1, fontSize: 13.5, fontWeight: p.soy_yo ? 800 : 600, color: S.TEXT }}>
                      @{p.nombre}
                      {p.soy_yo ? ' (tú)' : ''}
                    </span>
                    {!r.unica && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: COLOR_NIVEL[p.nivel] ?? S.MUTED }}>
                        {r.nombreDe(p.nivel)}
                        {(r.divs.find((d) => d.nivel === p.nivel)?.grupos ?? 1) > 1 ? ` · G${p.grupo}` : ''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
    </>
  );
}

function Dato({ icono, titulo, children }: { icono: string; titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 18, width: 24, textAlign: 'center', flexShrink: 0 }}>{icono}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#F0B94D', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{titulo}</span>
        <span style={{ fontSize: 13, color: S.MUTED, lineHeight: 1.5 }}>{children}</span>
      </div>
    </div>
  );
}
