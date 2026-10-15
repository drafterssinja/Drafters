'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import MarcoV2, { EtiquetaBeta, Titulo } from '@/components/v2/MarcoV2';
import { useSesionV2 } from '@/components/v2/useSesionV2';
import { DEPORTE_NOMBRE, IconoGema, PelotaDeporte, esDeporteV2, type DeporteV2 } from '@/components/v2/IconosV2';
import { etiquetasPosicion } from '@/lib/posicionesEmpate';
import { mensajeError } from '@/lib/v2';

// ============================================================================
// LIGA DE UN DEPORTE: APUNTARSE + CLASIFICACIÓN (V2, 15/10)
// ============================================================================
// Pedido de Iñi: para jugar la liga hay que apuntarse. Lo primero que se ve es
// la información de la temporada (cuándo empieza y acaba, en qué división
// empiezas, cuántos van a la Gran Final, cuántos bajan, grupos), un botón grande
// para apuntarse y la lista de apuntados. Con la temporada en marcha, la
// clasificación en draftis (solo apuntados). Reglas: diseño de ligas del 07/10.

type Division = { nivel: number; nombre: string; grupos: number; jugadores: number };
type Info = {
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
};
type Fila = { usuario_id: string; nombre: string; draftis: number; mesas: number; ganadas: number; soy_yo: boolean; nivel: number; grupo: number };

const COLOR_NIVEL: Record<number, string> = { 1: '#D4A537', 2: '#BCC3CB', 3: '#B9763E' };
const NOMBRE_NIVEL: Record<number, string> = { 1: 'Primera', 2: 'Segunda', 3: 'Tercera' };
const UMBRAL_DIVISION_UNICA = 150;
const MIN_FINALISTAS = 30;

function fechaLarga(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
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

export default function V2Liga() {
  const params = useParams<{ deporte: string }>();
  const deporte: DeporteV2 = esDeporteV2(params.deporte) ? params.deporte : 'futbol';
  const { perfil, estado } = useSesionV2();
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [apuntando, setApuntando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recienApuntado, setRecienApuntado] = useState(false);

  const cargar = useCallback(async () => {
    const { data } = await supabase.rpc('v2_liga_info', { p_deporte: deporte });
    const i = (data as Info | null) ?? null;
    setInfo(i);
    if (i?.en_curso) {
      const { data: c } = await supabase.rpc('v2_clasificacion_liga', { p_deporte: deporte, p_temporada: i.temporada_id });
      setFilas((c as Fila[]) ?? []);
    } else if (!i) {
      // Sin temporadas: clasificación de pruebas con quien haya jugado mesas de liga.
      const { data: c } = await supabase.rpc('v2_clasificacion_liga', { p_deporte: deporte, p_temporada: null });
      setFilas((c as Fila[]) ?? []);
    } else setFilas(null);
  }, [deporte]);

  useEffect(() => {
    if (estado === 'ok') void cargar();
  }, [estado, cargar]);

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
    await cargar();
  }

  const r = info ? reglas(info) : null;
  const yo = info?.yo ?? null;
  const etiquetas = filas ? etiquetasPosicion(filas, (f) => f.draftis) : [];

  return (
    <MarcoV2 perfil={perfil} estado={estado} deporte={deporte} volverA={`/v2/${deporte}?modo=liga`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <EtiquetaBeta />
        <Titulo>{info ? info.liga : `Liga de ${DEPORTE_NOMBRE[deporte].toLowerCase()}`}</Titulo>
        {info && <span style={{ fontSize: 13, fontWeight: 700, color: '#F0B94D' }}>Temporada {info.numero}</span>}
      </div>

      {info === undefined && <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>Cargando...</p>}

      {info === null && (
        <div style={{ background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontWeight: 800, fontSize: 15, color: S.TEXT }}>Todavía no hay ninguna temporada abierta</span>
          <span style={{ fontSize: 13, color: S.MUTED_2, lineHeight: 1.5 }}>En cuanto se abra la primera temporada podrás apuntarte desde aquí. Mientras tanto, las mesas de liga cuentan para esta clasificación de pruebas.</span>
        </div>
      )}

      {info && r && (
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
          {!info.en_curso && (
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
      )}

      {/* ---------------- Clasificación (temporada en juego o pruebas) ---------------- */}
      {filas && (info === null || info?.en_curso) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={S.sectionLabel}>{info ? `Clasificación · ${info.apuntados} apuntados` : 'Clasificación de pruebas'}</span>
          {filas.length === 0 && <span style={{ fontSize: 13, color: S.MUTED_3 }}>Todavía no hay nadie en la clasificación.</span>}
          {filas.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ display: 'flex', gap: 10, padding: '10px 14px', fontSize: 10.5, fontWeight: 700, color: S.MUTED_3, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${S.CARD_BORDER}` }}>
                <span style={{ width: 34 }}>Pos.</span>
                <span style={{ flex: 1 }}>Jugador</span>
                <span style={{ width: 52, textAlign: 'center' }}>Mesas</span>
                <span style={{ width: 70, textAlign: 'right' }}>Draftis</span>
              </div>
              {filas.map((f, i) => (
                <div key={f.usuario_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: `1px solid ${S.CARD_BORDER}`, background: f.soy_yo ? 'rgba(61,220,132,0.08)' : 'transparent' }}>
                  <span style={{ width: 34, fontWeight: 800, fontSize: 13.5, color: etiquetas[i].replace('T', '') === '1' ? '#F0B94D' : S.MUTED }}>{etiquetas[i]}</span>
                  <span style={{ flex: 1, minWidth: 0, fontWeight: f.soy_yo ? 800 : 600, fontSize: 13.5, color: S.TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{f.nombre}</span>
                  <span style={{ width: 52, textAlign: 'center', fontSize: 12, color: S.MUTED_2 }}>
                    {f.ganadas}/{f.mesas}
                  </span>
                  <span style={{ width: 70, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, fontWeight: 800, fontSize: 14, color: f.draftis >= 0 ? S.TEXT : '#FF8A8A' }}>
                    {f.draftis > 0 ? '+' : ''}
                    {f.draftis} <IconoGema size={13} />
                  </span>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: S.MUTED_3, lineHeight: 1.6 }}>
            <div>Cada mesa pone en juego 100 draftis por jugador. Si ganas sumas y si pierdes restas 100: Doble o Nada +100 · Triple o Nada +200 · Oro y Plata +250 / +50 · Tridente +500 / +150 / +50.</div>
            <div>&quot;Mesas&quot; = ganadas / jugadas. Empates con T.</div>
          </div>
        </div>
      )}
    </MarcoV2>
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
