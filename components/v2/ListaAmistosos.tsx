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
};

export default function ListaAmistosos({ deporte }: { deporte: DeporteV2 }) {
  const [lista, setLista] = useState<FilaLista[] | null>(null);
  // 16/10 (Iñi): por defecto siempre "Abiertos", no las salas en las que ya estás.
  const [pestana, setPestana] = useState<'mias' | 'publicas'>('publicas');
  // 16/10 (Iñi): se ven también las privadas (con candado) y hay un buscador arriba.
  const [busqueda, setBusqueda] = useState('');
  // 16/10 (Iñi): casilla (de primeras sin marcar) para ver también las salas completas.
  const [verCompletas, setVerCompletas] = useState(false);
  // 16/10 (Iñi): las privadas, de momento, siempre arriba; con una casilla
  // pequeñita encima de la lista para ocultarlas.
  const [ocultarPrivadas, setOcultarPrivadas] = useState(false);
  // 28/10 (Iñi): en tenis, pestañas arriba para elegir el torneo (Viena, Basilea…)
  // y ver solo sus salas, en vez de todos los torneos juntos.
  const porTorneo = deporte === 'tenis';
  const [torneo, setTorneo] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data } = await supabase.rpc('amistosos_v2_lista');
    setLista(((data as FilaLista[]) ?? []).filter((a) => a.deporte === deporte));
  }, [deporte]);

  useEffect(() => {
    // 16/10 (Iñi): siempre tiene que haber salas públicas de Drafters abiertas
    // (próxima jornada de LaLiga y Champions, próximo torneo de cada circuito
    // de golf; de 2, 3, 4 y 6). Se crean las que falten antes de cargar la lista.
    void (async () => {
      try {
        await supabase.rpc('v2_asegurar_salas_sistema');
      } catch {}
      await cargar();
    })();
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
          .filter((l) => (!l.empezada && l.estado !== 'finalizado') || l.soy_participante)
          .reduce((m, l) => {
            for (const c of l.competiciones) {
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
  const delTorneo = (a: FilaLista) => !torneoVisto || a.competiciones.includes(torneoVisto);
  const mias = (lista ?? []).filter((l) => l.soy_participante && coincide(l) && delTorneo(l));
  // 16/10 (Iñi): en "Abiertos" salen TODAS las salas que no han empezado, también
  // aquellas en las que ya estás; las completas solo con la casilla marcada.
  const abiertaDeVerdad = (a: FilaLista) => !a.empezada && a.estado !== 'finalizado';
  const completa = (a: FilaLista) => a.estado === 'completo' || a.inscritos >= a.num_jugadores;
  const publicas = (lista ?? [])
    .filter((l) => abiertaDeVerdad(l) && (verCompletas || !completa(l)) && (!ocultarPrivadas || !l.privada) && coincide(l) && delTorneo(l))
    .sort((a, b) => Number(b.privada) - Number(a.privada) || Number(completa(a)) - Number(completa(b)) || b.inscritos / b.num_jugadores - a.inscritos / a.num_jugadores);
  const numCompletas = (lista ?? []).filter((l) => abiertaDeVerdad(l) && completa(l) && coincide(l) && delTorneo(l)).length;
  const vista = pestana;
  const mostradas = vista === 'mias' ? [...mias].sort((a, b) => Number(b.privada) - Number(a.privada)).filter((l) => !ocultarPrivadas || !l.privada) : publicas;


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {porTorneo && torneos.length > 0 && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {torneos.map((c) => (
            <button key={c} type="button" onClick={() => setTorneo(c)} style={{ ...S.pill(torneoVisto === c), width: 'auto', flexShrink: 0, whiteSpace: 'nowrap' }}>
              🎾 {nombreTorneoCorto(c)}
            </button>
          ))}
        </div>
      )}
      <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="🔍 Buscar sala por nombre, creador o jornada" style={S.input} />
      <Link href={`/v2/crear?deporte=${deporte}${torneoVisto ? `&torneo=${encodeURIComponent(torneoVisto)}` : ''}`} style={{ ...S.primaryButton, background: V2_COLOR, textAlign: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 0 }}>
        🔒 Crear sala privada
      </Link>


      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" style={S.pill(vista === 'publicas')} onClick={() => setPestana('publicas')}>
          Abiertos ({publicas.length})
        </button>
        <button type="button" style={S.pill(vista === 'mias')} onClick={() => setPestana('mias')}>
          Mis amistosos ({mias.length})
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: -4 }}>
        {vista === 'publicas' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: S.MUTED_3, cursor: 'pointer' }}>
            <input type="checkbox" checked={verCompletas} onChange={(e) => setVerCompletas(e.target.checked)} style={{ width: 14, height: 14, accentColor: V2_COLOR }} />
            Ver también las completas{numCompletas > 0 ? ` (${numCompletas})` : ''}
          </label>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: S.MUTED_3, cursor: 'pointer' }}>
          <input type="checkbox" checked={ocultarPrivadas} onChange={(e) => setOcultarPrivadas(e.target.checked)} style={{ width: 14, height: 14, accentColor: V2_COLOR }} />
          Ocultar mesas privadas
        </label>
      </div>

      {lista === null && <Cargando compacto />}
      {lista !== null && mostradas.length === 0 && (
        <p style={{ fontSize: 13, color: S.MUTED_3, margin: 0 }}>{q ? 'Ninguna sala coincide con la búsqueda.' : vista === 'mias' ? 'Todavía no estás en ningún amistoso. Crea uno o únete a uno abierto.' : numCompletas > 0 && !verCompletas ? `No hay salas con hueco ahora mismo. Marca «Ver también las salas completas» para ver las ${numCompletas} completas.` : 'No hay amistosos abiertos ahora mismo. ¡Crea el primero!'}</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {mostradas.map((a) => {
          const llena = a.inscritos >= a.num_jugadores;
          return (
            <Link key={a.id} href={`/v2/sala/${a.id}`} style={{ ...S.card, flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  {a.privada && <IconoCandado size={18} />}
                  {/* 16/10 (Iñi): el nombre de la mesa bien grande. */}
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, lineHeight: 1.1, color: S.TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nombre}</span>
                </span>
                <span style={{ flexShrink: 0, alignSelf: 'center', fontSize: 13, fontWeight: 800, color: llena ? '#F0B94D' : S.ACCENT }}>
                  {a.inscritos}/{a.num_jugadores}
                </span>
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
                {a.cierre && <span>· empieza {fechaCorta(a.cierre)}</span>}
              </div>
              {a.premio && a.premio.tipo !== 'nada' ? (
                <TiraPuestos premio={a.premio} participantes={a.num_jugadores} compacta />
              ) : (
                a.privada && <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>🏆 Solo por la gloria</span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** "ATP · Erste Bank Open 2026" → "Erste Bank Open". */
function nombreTorneoCorto(c: string): string {
  return c.replace(/^(ATP|WTA)\s*·\s*/i, '').replace(/\s+\d{4}$/, '');
}
