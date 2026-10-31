'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import EtiquetaTramo from '@/components/v2/EtiquetaTramo';
import { V2_COLOR } from '@/components/v2/MarcoV2';
import TiraPuestos from '@/components/v2/TiraPuestos';
import { IconoCandado, type DeporteV2 } from '@/components/v2/IconosV2';
import { MODALIDAD_LABEL, cadaXSegundos, fechaCorta, mensajeError, type Modalidad, type Premio } from '@/lib/v2';
import Cargando from '@/components/Cargando';

// Amistosos de un deporte: mis salas, las abiertas y crear.
// 16/10 (Iñi): se quita la caja "¿Te han pasado un código?" para ganar espacio
// (las privadas se ven en la lista y se entra con la contraseña).
type FilaLista = {
  id: string;
  nombre: string;
  deporte: string;
  modalidad: Modalidad;
  num_jugadores: number;
  privada: boolean;
  estado: string;
  creador: string;
  inscritos: number;
  soy_participante: boolean;
  competiciones: string[];
  cierre: string | null;
  premio: Premio | null;
  // 16/10 (SQL 43): la sala ya ha empezado (primera jornada cerrada o draft en marcha).
  empezada?: boolean;
  // 16/10 (SQL 44): sala de Drafters (creada sola, sin administrador).
  sistema?: boolean;
  // 17/10 (SQL 49): tramo de cada jornada ('' = completa).
  tramos?: string[] | null;
  // 01/11 (SQL 74): todas sus jornadas/torneos han terminado.
  terminada?: boolean;
};

export default function ListaAmistosos({ deporte }: { deporte: DeporteV2 }) {
  const [lista, setLista] = useState<FilaLista[] | null>(null);
  // 16/10 (Iñi): por defecto siempre "Abiertos", no las salas en las que ya estás.
  const [pestana, setPestana] = useState<'mias' | 'publicas' | 'en_juego'>('publicas');
  // 16/10 (Iñi): se ven también las privadas (con candado) y hay un buscador arriba.
  const [busqueda, setBusqueda] = useState('');
  // 16/10 (Iñi): casilla (de primeras sin marcar) para ver también las salas completas.
  const [verCompletas, setVerCompletas] = useState(false);
  // 16/10 (Iñi): las privadas, de momento, siempre arriba; con una casilla
  // pequeñita encima de la lista para ocultarlas.
  // 28/10 (Iñi): el filtro de privadas, con botones grandes como los de los
  // torneos: todas, solo privadas o solo las de Drafters/públicas.
  const [tipoSala, setTipoSala] = useState<'todas' | 'privadas' | 'publicas'>('todas');
  const pasaTipo = (a: FilaLista) => tipoSala === 'todas' || (tipoSala === 'privadas' ? a.privada : !a.privada);
  // 28/10 (Iñi): pestañas arriba por competición, en todos los deportes: tenis y
  // golf por torneo; fútbol por competición (LaLiga, Champions…).
  const porTorneo = true;
  const [torneo, setTorneo] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data } = await supabase.rpc('amistosos_v2_lista');
    // 31/10 (Iñi): ya no hay salas públicas de Drafters; las que quedan solo las ve quien está dentro.
    setLista(((data as FilaLista[]) ?? []).filter((a) => a.deporte === deporte && (!a.sistema || a.soy_participante)));
  }, [deporte]);

  useEffect(() => {
    // 16/10 (Iñi): siempre tiene que haber salas públicas de Drafters abiertas
    // (próxima jornada de LaLiga y Champions, próximo torneo de cada circuito
    // de golf; de 2, 3, 4 y 6). Se crean las que falten antes de cargar la lista.
    void cargar();
    return cadaXSegundos(cargar, 15);
  }, [cargar]);

  const q = busqueda
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  const coincide = (a: FilaLista) =>
    !q ||
    `${a.nombre} ${a.creador} ${a.competiciones.join(' ')}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .includes(q);
  // Torneos con salas abiertas (o en las que estoy), el que antes cierra primero.
  const torneos = porTorneo
    ? Array.from(
        (lista ?? [])
          .filter((l) => l.estado !== 'finalizado' || l.soy_participante)
          .reduce((m, l) => {
            for (const c0 of l.competiciones) {
              const c = grupoDe(deporte, c0);
              const t = l.cierre ? new Date(l.cierre).getTime() : Infinity;
              if (!m.has(c) || t < (m.get(c) as number)) m.set(c, t);
            }
            return m;
          }, new Map<string, number>())
          .entries()
      )
        .sort((a, b) => a[1] - b[1])
        .map(([c]) => c)
    : [];
  const torneoVisto = porTorneo ? (torneo && torneos.includes(torneo) ? torneo : torneos[0] ?? null) : null;
  const delTorneo = (a: FilaLista) => !torneoVisto || a.competiciones.some((c) => grupoDe(deporte, c) === torneoVisto);
  const mias = (lista ?? []).filter((l) => l.soy_participante && coincide(l) && delTorneo(l));
  // 16/10 (Iñi): en "Abiertos" salen TODAS las salas que no han empezado, también
  // aquellas en las que ya estás; las completas solo con la casilla marcada.
  const abiertaDeVerdad = (a: FilaLista) => !a.empezada && a.estado !== 'finalizado';
  const completa = (a: FilaLista) => a.estado === 'completo' || a.inscritos >= a.num_jugadores;
  const publicas = (lista ?? [])
    .filter((l) => abiertaDeVerdad(l) && (verCompletas || !completa(l)) && pasaTipo(l) && coincide(l) && delTorneo(l))
    .sort((a, b) => Number(b.privada) - Number(a.privada) || Number(completa(a)) - Number(completa(b)) || b.inscritos / b.num_jugadores - a.inscritos / a.num_jugadores);
  const numCompletas = (lista ?? []).filter((l) => abiertaDeVerdad(l) && completa(l) && coincide(l) && delTorneo(l)).length;
  // 30/10 (Iñi): las salas que ya han empezado (públicas y privadas), para verlas aunque no estés (SQL 70).
  // 01/11 (Iñi): "En juego" = han empezado y NO han acabado. Las terminadas van debajo, aparte y marcadas.
  const enJuego = (lista ?? [])
    .filter((l) => l.empezada && !l.terminada && l.estado !== 'finalizado' && pasaTipo(l) && coincide(l) && delTorneo(l))
    .sort((a, b) => Number(b.soy_participante) - Number(a.soy_participante) || Number(b.privada) - Number(a.privada));
  const terminadas = (lista ?? [])
    .filter((l) => (l.terminada || l.estado === 'finalizado') && pasaTipo(l) && coincide(l) && delTorneo(l))
    .sort((a, b) => Number(b.soy_participante) - Number(a.soy_participante) || (b.cierre ?? '').localeCompare(a.cierre ?? ''));
  const fase = (a: FilaLista) => (a.terminada || a.estado === 'finalizado' ? 2 : a.empezada ? 0 : 1);
  const vista = pestana;
  const mostradas = vista === 'mias' ? [...mias].sort((a, b) => fase(a) - fase(b) || Number(b.privada) - Number(a.privada)).filter(pasaTipo) : vista === 'en_juego' ? enJuego : publicas;


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {porTorneo && torneos.length > 1 && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {torneos.map((c) => (
            <button key={c} type="button" onClick={() => setTorneo(c)} style={{ ...S.pill(torneoVisto === c), width: 'auto', flexShrink: 0, whiteSpace: 'nowrap' }}>
              {iconoGrupo(deporte, c)} {nombreGrupo(deporte, c)}
            </button>
          ))}
        </div>
      )}
      <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="🔍 Buscar sala por nombre, creador o jornada" style={S.input} />
      {/* 31/10: el botón de crear sala está arriba, en la pestaña Privadas. */}


      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" style={S.pill(vista === 'publicas')} onClick={() => setPestana('publicas')}>
          Abiertos ({publicas.length})
        </button>
        <button type="button" style={S.pill(vista === 'mias')} onClick={() => setPestana('mias')}>
          Mis amistosos ({mias.length})
        </button>
        <button type="button" style={{ ...S.pill(vista === 'en_juego'), width: 'auto' }} onClick={() => setPestana('en_juego')}>
          ● En juego ({enJuego.length})
        </button>
      </div>

      {/* 28/10 (Iñi): filtros con botones, no casillas pequeñas. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {([
          ['todas', 'Todas'],
          ['privadas', '🔒 Privadas'],
          ['publicas', '⭐ Abiertas a todos'],
        ] as const).map(([k, t]) => (
          <button key={k} type="button" onClick={() => setTipoSala(k)} style={{ ...S.pill(tipoSala === k), width: 'auto', flexShrink: 0 }}>
            {t}
          </button>
        ))}
        {vista === 'publicas' && numCompletas > 0 && (
          <button type="button" onClick={() => setVerCompletas((v) => !v)} style={{ ...S.pill(verCompletas), width: 'auto', flexShrink: 0 }}>
            {verCompletas ? '✓ ' : ''}Completas ({numCompletas})
          </button>
        )}
      </div>

      {lista === null && <Cargando compacto />}
      {lista !== null && mostradas.length === 0 && (
        <p style={{ fontSize: 13, color: S.MUTED_3, margin: 0 }}>{q ? 'Ninguna sala coincide con la búsqueda.' : vista === 'mias' ? 'Todavía no estás en ningún amistoso. Crea uno o únete a uno abierto.' : vista === 'en_juego' ? 'Ahora mismo no hay ninguna sala jugándose.' : numCompletas > 0 && !verCompletas ? `No hay salas con hueco ahora mismo. Pulsa «Completas» para ver las ${numCompletas} que están llenas.` : 'No hay amistosos abiertos ahora mismo. ¡Crea el primero!'}</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {mostradas.map((a) => tarjeta(a))}
        {vista === 'en_juego' && terminadas.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 16, textTransform: 'uppercase', letterSpacing: '0.03em', color: S.MUTED_2, whiteSpace: 'nowrap' }}>🏁 Terminadas ({terminadas.length})</span>
              <span style={{ flex: 1, height: 1, background: S.CARD_BORDER }} />
            </div>
            {terminadas.map((a) => tarjeta(a))}
          </>
        )}
      </div>
    </div>
  );

  function tarjeta(a: FilaLista) {
          const llena = a.inscritos >= a.num_jugadores;
          const acabada = a.terminada || a.estado === 'finalizado';
          return (
            <Link key={a.id} href={a.empezada ? `/v2/sala/${a.id}?tab=clasificacion` : `/v2/sala/${a.id}`} style={{ ...S.card, flexDirection: 'column', alignItems: 'stretch', gap: 6, opacity: acabada ? 0.7 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  {a.privada && <IconoCandado size={18} />}
                  {/* 16/10 (Iñi): el nombre de la mesa bien grande. */}
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, lineHeight: 1.1, color: S.TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nombre}</span>
                </span>
                {a.empezada ? (
                  <span style={{ flexShrink: 0, alignSelf: 'center', fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 999, color: acabada ? S.MUTED_2 : '#FF5C5C', background: acabada ? 'rgba(255,255,255,0.06)' : 'rgba(255,92,92,0.12)' }}>
                    {acabada ? '🏁 Terminada' : '● En juego'}
                  </span>
                ) : (
                  <span style={{ flexShrink: 0, alignSelf: 'center', fontSize: 13, fontWeight: 800, color: llena ? '#F0B94D' : S.ACCENT }}>
                    {a.inscritos}/{a.num_jugadores}
                  </span>
                )}
              </div>
              {a.tramos?.[0] && <EtiquetaTramo tramo={a.tramos[0]} deporte={a.deporte} compacta />}
              <span style={{ fontSize: 11, fontWeight: 700, color: '#F0B94D', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {a.competiciones.length > 1 ? `${a.competiciones[0]} → ${a.competiciones[a.competiciones.length - 1].replace(/^.* - /, '')}` : a.competiciones[0]}
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11.5, color: S.MUTED_2 }}>
                <span style={{ color: V2_COLOR, fontWeight: 700 }}>{MODALIDAD_LABEL[a.modalidad]}</span>
                {/* 15/10 (Iñi): el creador solo se enseña en las privadas (con el candado). */}
                {a.sistema && <span style={{ color: '#3DDC84', fontWeight: 700 }}>· ⭐ Sala de Drafters</span>}
                {a.privada && <span>· creada por @{a.creador}</span>}
                {vista === 'publicas' && a.soy_participante && <span style={{ color: S.ACCENT, fontWeight: 700 }}>· ✓ Estás dentro</span>}
                {vista === 'publicas' && completa(a) && <span style={{ color: '#F0B94D', fontWeight: 700 }}>· Completa</span>}
                {a.cierre && !a.empezada && <span>· empieza {fechaCorta(a.cierre)}</span>}
                {a.empezada && <span>· {a.inscritos} jugadores</span>}
                {vista !== 'publicas' && a.soy_participante && vista === 'en_juego' && <span style={{ color: S.ACCENT, fontWeight: 700 }}>· ✓ Estás dentro</span>}
              </div>
              {a.premio && a.premio.tipo !== 'nada' ? (
                <TiraPuestos premio={a.premio} participantes={a.num_jugadores} compacta />
              ) : (
                a.privada && <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>🏆 Solo por la gloria</span>
              )}
            </Link>
          );
  }
}

/** Grupo de una competición para las pestañas: en fútbol, la competición (sin la jornada); si no, el torneo. */
function grupoDe(deporte: string, c: string): string {
  return deporte === 'futbol' ? c.replace(/\s*-\s*Jornada\s*\d+\s*$/i, '') : c;
}
/** Nombre corto: "ATP · Erste Bank Open 2026" → "Erste Bank Open"; "La Liga" → "LaLiga". */
function nombreGrupo(deporte: string, c: string): string {
  if (deporte === 'futbol') return c === 'La Liga' ? 'LaLiga' : c === 'Champions League' ? 'Champions' : c;
  return c.replace(/^(ATP|WTA)\s*·\s*/i, '').replace(/\s+\d{4}$/, '');
}
function iconoGrupo(deporte: string, c: string): string {
  if (deporte === 'tenis') return '🎾';
  if (deporte === 'golf') return '⛳';
  return /champions/i.test(c) ? '⭐' : '⚽';
}
