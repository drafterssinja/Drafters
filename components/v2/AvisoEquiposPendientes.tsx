'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { PelotaDeporte, type DeporteV2 } from '@/components/v2/IconosV2';

// ============================================================================
// AVISO "TE FALTA EL EQUIPO" (02/11, Iñi — opción B)
// ============================================================================
// "Cuando queden 24 horas para empezar la siguiente jornada, que le salga en la
// pantalla que todavía no ha hecho el equipo de la liga tal" → hoja desde
// abajo, cada vez que entra en Drafters.
//  · Lista TODAS las jornadas (ligas privadas, Liga Drafters y salas en las
//    que estás dentro) que empiezan en menos de 24 h y en las que no tienes
//    equipo (SQL 89, equipos_pendientes).
//  · Cada una con su botón HACER, que lleva directo a hacer el equipo.
//  · Sale una vez cada vez que entras en la app (y otra vez si vuelves
//    después de más de 30 min fuera). "Ahora no" la cierra.
//  · No sale en la propia pantalla de hacer el equipo.

type Pendiente = { tipo: 'privada' | 'drafters' | 'sala'; id: string; liga: string; numero: number; competicion: string; deporte: DeporteV2; cierre: string; rival: string | null };

const AMBAR = '#F0B94D';
const ROJIZO = '#FF8A8A';
const CLAVE = 'drafters_aviso_equipos';
const FUERA_MIN = 30;

let vistoEnMemoria = false;
let ocultoDesde: number | null = null;

function yaVisto(): boolean {
  try {
    return vistoEnMemoria || !!sessionStorage.getItem(CLAVE);
  } catch {
    return vistoEnMemoria;
  }
}
function marcarVisto(si: boolean) {
  vistoEnMemoria = si;
  try {
    if (si) sessionStorage.setItem(CLAVE, String(Date.now()));
    else sessionStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento: vale con la memoria */
  }
}

function faltan(iso: string): string {
  const min = Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  if (min < 60) return `${min} min`;
  return `${Math.round(min / 60)} h`;
}
function competicionCorta(c: string, deporte: DeporteV2): string {
  if (deporte !== 'futbol') return c.replace(/^(ATP|WTA)\s*·\s*/i, '').replace(/\s+\d{4}$/, '');
  const n = c.match(/Jornada\s*(\d+)/i)?.[1] ?? '';
  return /champions/i.test(c) ? `J${n} Champions` : `J${n} LaLiga`;
}
function enlace(p: Pendiente): string {
  if (p.tipo === 'sala') return `/v2/sala/${p.id}/equipo?c=${encodeURIComponent(p.competicion)}`;
  return p.tipo === 'privada' ? `/v2/liga-privada/jornada/${p.id}/equipo` : `/v2/liga/${p.id}/equipo`;
}

export default function AvisoEquiposPendientes({ usuarioId }: { usuarioId?: string }) {
  const ruta = usePathname() ?? '';
  const [lista, setLista] = useState<Pendiente[]>([]);
  const [abierto, setAbierto] = useState(false);
  const enEquipo = /\/equipo(\/|$)/.test(ruta);

  useEffect(() => {
    if (!usuarioId || enEquipo) return;
    let vivo = true;
    let espera: ReturnType<typeof setTimeout> | undefined;
    const comprobar = () => {
      if (yaVisto()) return;
      void supabase.rpc('equipos_pendientes').then(({ data, error }) => {
        if (!vivo) return;
        const filas = error ? [] : ((data as Pendiente[]) ?? []).filter((p) => new Date(p.cierre).getTime() > Date.now());
        if (!filas.length) return marcarVisto(true);
        setLista(filas);
        // Un respiro para que cargue la pantalla antes de subir la hoja. Si
        // cambias de pantalla antes, sale en la siguiente.
        espera = setTimeout(() => {
          if (!vivo || yaVisto()) return;
          marcarVisto(true);
          setAbierto(true);
        }, 1200);
      });
    };
    const alCambiar = () => {
      if (document.visibilityState === 'hidden') {
        ocultoDesde = Date.now();
      } else if (ocultoDesde && Date.now() - ocultoDesde >= FUERA_MIN * 60000) {
        ocultoDesde = null;
        marcarVisto(false);
        comprobar();
      }
    };
    comprobar();
    document.addEventListener('visibilitychange', alCambiar);
    return () => {
      vivo = false;
      if (espera) clearTimeout(espera);
      document.removeEventListener('visibilitychange', alCambiar);
    };
  }, [usuarioId, enEquipo]);

  if (!abierto || !lista.length || enEquipo) return null;
  const cerrar = () => setAbierto(false);
  const varios = lista.length > 1;

  return (
    <div onClick={cerrar} style={{ position: 'fixed', inset: 0, zIndex: 260, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', animation: 'aep-fondo .25s ease-out' }}>
      <style>{'@keyframes aep-fondo{from{opacity:0}} @keyframes aep-sube{from{transform:translateY(100%)}}'}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Equipos sin hacer"
        style={{ width: '100%', maxWidth: 520, maxHeight: '80vh', overflowY: 'auto', background: '#111715', borderTop: `2px solid ${AMBAR}`, borderRadius: '20px 20px 0 0', padding: '12px 16px calc(20px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 10, animation: 'aep-sube .35s cubic-bezier(.2,.9,.3,1)' }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 9, background: S.BORDER, alignSelf: 'center', marginBottom: 4 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 28, lineHeight: 1 }}>⏰</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 23, color: S.TEXT, lineHeight: 1.1 }}>
              {varios ? `Te faltan ${lista.length} equipos` : 'Te falta el equipo'}
            </span>
            <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>{varios ? 'Las jornadas empiezan' : 'La jornada empieza'} en menos de 24 h</span>
          </span>
        </div>
        {lista.map((p) => {
          const h = (new Date(p.cierre).getTime() - Date.now()) / 3600e3;
          const detalle = p.rival ? `vs ${p.rival}` : competicionCorta(p.competicion, p.deporte);
          const lineaJornada = p.tipo === 'sala' ? `Sala · ${detalle}` : `Jornada ${p.numero} · ${detalle}`;
          const colorCaja = p.tipo === 'privada' ? '167,139,250' : p.tipo === 'sala' ? '240,185,77' : '61,220,132';
          return (
            <Link
              key={`${p.tipo}-${p.id}-${p.competicion}`}
              href={enlace(p)}
              onClick={cerrar}
              style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: '#0E1311', border: '1px solid #1E2723' }}
            >
              <span style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `rgba(${colorCaja},.16)`, border: `1px solid rgba(${colorCaja},.5)` }}>
                <PelotaDeporte deporte={p.deporte} size={20} />
              </span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontWeight: 800, fontSize: 13.5, color: S.TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.liga}</span>
                <span style={{ fontSize: 11.5, color: S.MUTED_2 }}>
                  {lineaJornada} · <span style={{ color: h < 6 ? ROJIZO : AMBAR, fontWeight: 800, whiteSpace: 'nowrap' }}>cierra en {faltan(p.cierre)}</span>
                </span>
              </span>
              <span style={{ flexShrink: 0, padding: '8px 10px', borderRadius: 10, background: S.ACCENT, color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 14, textTransform: 'uppercase' }}>Hacer</span>
            </Link>
          );
        })}
        <button type="button" onClick={cerrar} style={{ ...S.secondaryLinkButton, marginTop: 2 }}>
          Ahora no
        </button>
      </div>
    </div>
  );
}
