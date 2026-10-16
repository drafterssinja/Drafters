'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { IconoGema } from '@/components/v2/IconosV2';
import { TIPO_SALA_LABELS } from '@/lib/salaShared';
import type { TipoSala } from '@/lib/repartoPremios';
import { cadaXSegundos } from '@/lib/v2';
import { competicionBonita, textoDraftis } from '@/lib/draftisMesa';

// ============================================================================
// POP-UP "RESULTADO DE LA JORNADA" (V2 · liga, 16/10, Iñi)
// ============================================================================
// Cuando se cierran todas tus mesas de la jornada (o del torneo): primero una
// etiqueta grande con los draftis que has sumado o restado y, después, una
// ventanita de la clasificación con 5 nombres (los 2 de encima y los 2 de
// debajo) en la que se ve cómo subes o bajas, puesto a puesto, del puesto de
// antes al de ahora. Datos: v2_resultado_jornada() (SQL 48).

type Fila = { pos: number; etiqueta: string; nombre: string; draftis: number; soy_yo: boolean };
type Mesa = { sala_id: string; nombre: string; competicion: string; tipo: string; aforo: number | null; posicion: number | null; draftis: number };
export type ResultadoJornada = {
  deporte: string;
  competiciones: string[];
  mesas: Mesa[];
  total: number;
  antes: number | null;
  despues: number | null;
  etiqueta_antes: string | null;
  etiqueta_despues: string | null;
  draftis_antes: number | null;
  draftis_despues: number | null;
  jugadores: number;
  filas: Fila[];
  liga: { liga: string; numero: number } | null;
};

const H = 44; // alto de cada fila de la ventanita
const VISIBLES = 5;
const VERDE = '#3DDC84';
const ROJO = '#FF6B6B';
const ORO = '#F0B94D';

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export default function ResultadoJornadaV2() {
  const [res, setRes] = useState<ResultadoJornada | null>(null);
  const [cerrando, setCerrando] = useState(false);
  const abierto = useRef(false);

  const cargar = useCallback(async () => {
    if (abierto.current) return;
    const { data, error } = await supabase.rpc('v2_resultado_jornada');
    if (error || !data) return;
    abierto.current = true;
    setRes(data as ResultadoJornada);
  }, []);

  useEffect(() => {
    void cargar();
    return cadaXSegundos(cargar, 90);
  }, [cargar]);

  async function cerrar() {
    if (!res) return;
    setCerrando(true);
    await supabase.rpc('v2_resultado_jornada_visto', { p_salas: res.mesas.map((m) => m.sala_id) });
    setRes(null);
    setCerrando(false);
    abierto.current = false;
    // ¿Hay otra jornada pendiente (por ejemplo, de otro deporte)?
    window.setTimeout(() => void cargar(), 400);
  }

  return (
    <AnimatePresence>
      {res && (
        <motion.div
          key="resultado-jornada"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(4,8,6,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            style={{ width: '100%', maxWidth: 400, maxHeight: '92vh', overflowY: 'auto', background: '#0F1513', border: `1px solid ${S.CARD_BORDER}`, borderRadius: 20, padding: '20px 18px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <Contenido res={res} />
            <div style={{ display: 'flex', gap: 8 }}>
              <Link
                href={`/v2/${res.deporte}/clasificacion`}
                onClick={() => void cerrar()}
                style={{ flex: 1, textAlign: 'center', textDecoration: 'none', padding: '12px 10px', borderRadius: 12, border: `1px solid rgba(240,185,77,0.45)`, color: ORO, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, textTransform: 'uppercase' }}
              >
                Ver clasificación
              </Link>
              <button
                type="button"
                disabled={cerrando}
                onClick={() => void cerrar()}
                style={{ flex: 1, width: 'auto', padding: '12px 10px', borderRadius: 12, border: 'none', background: S.ACCENT, color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, textTransform: 'uppercase', cursor: 'pointer' }}
              >
                Seguir
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Lo de dentro del pop-up (exportado también para la página de pruebas).
export function Contenido({ res }: { res: ResultadoJornada }) {
  const suma = res.total > 0;
  const resta = res.total < 0;
  const color = suma ? VERDE : resta ? ROJO : S.MUTED;
  const titulo = res.competiciones.map(competicionBonita).join(' · ');

  // Cuenta de draftis 0 → total.
  const [cuenta, setCuenta] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const dur = 900;
    const paso = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      setCuenta(Math.round(res.total * easeInOut(k)));
      if (k < 1) raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [res.total]);

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textAlign: 'center' }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#C9A257' }}>
          {res.liga ? `${res.liga.liga} · Temporada ${res.liga.numero}` : 'Liga Drafters'}
        </span>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, color: S.TEXT, lineHeight: 1.1 }}>{titulo} · cerrada</span>
      </div>

      {/* Etiqueta: has sumado / has restado */}
      <motion.div
        initial={{ scale: 0.4, opacity: 0, rotate: -6 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 14, delay: 0.15 }}
        style={{
          alignSelf: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          padding: '12px 26px 14px',
          borderRadius: 18,
          background: suma ? 'rgba(61,220,132,0.12)' : resta ? 'rgba(255,107,107,0.12)' : 'rgba(255,255,255,0.05)',
          border: `2px solid ${color}`,
          boxShadow: `0 0 34px ${suma ? 'rgba(61,220,132,0.28)' : resta ? 'rgba(255,107,107,0.25)' : 'transparent'}`,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color }}>{suma ? 'Has sumado' : resta ? 'Has restado' : 'Te quedas igual'}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 46, lineHeight: 1, color }}>
          {textoDraftis(cuenta)} <IconoGema size={34} />
        </span>
        <span style={{ fontSize: 12, color: S.MUTED_2 }}>draftis</span>
      </motion.div>

      {/* Mis mesas de la jornada */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {res.mesas.map((m) => (
          <div key={m.sala_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: S.MUTED_2, padding: '7px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: `1px solid ${S.CARD_BORDER}` }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <strong style={{ color: S.TEXT }}>{TIPO_SALA_LABELS[m.tipo as TipoSala] ?? m.nombre}</strong>
              {m.aforo ? ` · ${m.aforo} jugadores` : ''}
              {m.posicion ? ` · ${m.posicion}º` : ''}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 800, color: m.draftis > 0 ? VERDE : ROJO }}>
              {textoDraftis(m.draftis)} <IconoGema size={12} />
            </span>
          </div>
        ))}
      </div>

      {res.despues != null && res.filas.length > 0 && <VentanaClasificacion res={res} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Ventanita de la clasificación con la animación de subir/bajar.
// ---------------------------------------------------------------------------
function VentanaClasificacion({ res }: { res: ResultadoJornada }) {
  const despues = res.despues as number;
  const antes = res.antes ?? despues;
  const filas = res.filas;
  const lo = filas[0].pos;
  const hi = filas[filas.length - 1].pos;
  const seguidas = filas.length === hi - lo + 1;
  const yo = filas.find((f) => f.soy_yo);
  const otros = filas.filter((f) => !f.soy_yo);
  const desde = seguidas ? antes : despues;

  const [p, setP] = useState(desde);
  const [acabado, setAcabado] = useState(desde === despues);
  useEffect(() => {
    if (desde === despues) return;
    let raf = 0;
    const espera = 1300;
    const dur = Math.min(3600, 1100 + Math.abs(despues - desde) * 110);
    const t0 = performance.now() + espera;
    const paso = (t: number) => {
      const k = Math.max(0, Math.min(1, (t - t0) / dur));
      setP(desde + (despues - desde) * easeInOut(k));
      if (k < 1) raf = requestAnimationFrame(paso);
      else setAcabado(true);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [desde, despues]);

  // Puesto en el que se pinta cada uno ahora mismo: los demás se apartan un
  // hueco cuando pasas por su lado.
  const slotDe = (q: number) => {
    const r = q < despues ? q : q - 1;
    return r + Math.max(0, Math.min(1, r - p + 1));
  };
  const arriba = Math.max(lo, Math.min(p - 2, hi - (VISIBLES - 1)));
  const sube = despues < antes;
  const baja = despues > antes;
  const salto = Math.abs(despues - antes);
  const colorYo = sube ? VERDE : baja ? ROJO : ORO;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: S.MUTED_2 }}>Tu puesto en la liga</span>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 17, color: S.TEXT }}>
          {res.etiqueta_antes ?? '—'} <span style={{ color: S.MUTED_3 }}>→</span> <span style={{ color: colorYo }}>{acabado ? res.etiqueta_despues : Math.round(p)}</span>
        </span>
      </div>

      <div style={{ position: 'relative', height: H * Math.min(VISIBLES, hi - lo + 1), overflow: 'hidden', borderRadius: 14, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}` }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, transform: `translateY(${-(arriba - lo) * H}px)` }}>
          {otros.map((f) => (
            <FilaVentana key={`${f.pos}-${f.nombre}`} top={(seguidas ? slotDe(f.pos) : f.pos) - lo} etiqueta={f.etiqueta} nombre={f.nombre} draftis={f.draftis} />
          ))}
          {yo && <FilaVentana top={p - lo} etiqueta={acabado ? yo.etiqueta : String(Math.round(p))} nombre={yo.nombre} draftis={acabado || desde === despues ? yo.draftis : Math.round((res.draftis_antes ?? yo.draftis) + (yo.draftis - (res.draftis_antes ?? yo.draftis)) * ((p - desde) / (despues - desde)))} soyYo color={colorYo} moviendo={!acabado && desde !== despues} />}
        </div>
        {/* Difuminado arriba y abajo para que se note que la lista sigue */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(180deg, rgba(17,22,20,0.85) 0%, rgba(17,22,20,0) 18%, rgba(17,22,20,0) 82%, rgba(17,22,20,0.85) 100%)' }} />
      </div>

      <AnimatePresence>
        {acabado && (
          <motion.span
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ alignSelf: 'center', fontSize: 13, fontWeight: 800, color: colorYo, padding: '5px 12px', borderRadius: 999, border: `1px solid ${colorYo}`, background: 'rgba(255,255,255,0.03)' }}
          >
            {sube ? `▲ Subes ${salto} ${salto === 1 ? 'puesto' : 'puestos'}` : baja ? `▼ Bajas ${salto} ${salto === 1 ? 'puesto' : 'puestos'}` : '● Mantienes tu puesto'}
            {res.jugadores ? <span style={{ color: S.MUTED_2, fontWeight: 600 }}> · de {res.jugadores}</span> : null}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function FilaVentana({ top, etiqueta, nombre, draftis, soyYo = false, color, moviendo = false }: { top: number; etiqueta: string; nombre: string; draftis: number; soyYo?: boolean; color?: string; moviendo?: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: soyYo ? 4 : 0,
        right: soyYo ? 4 : 0,
        top: top * H + (soyYo ? 3 : 0),
        height: soyYo ? H - 6 : H,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: soyYo ? '0 10px' : '0 14px',
        zIndex: soyYo ? 2 : 1,
        borderBottom: soyYo ? 'none' : `1px solid ${S.CARD_BORDER}`,
        background: soyYo ? '#18221E' : 'transparent',
        border: soyYo ? `1.5px solid ${color}` : undefined,
        borderRadius: soyYo ? 10 : 0,
        boxShadow: soyYo ? `0 6px 22px rgba(0,0,0,0.55)${moviendo ? `, 0 0 18px ${color}55` : ''}` : 'none',
        transform: soyYo && moviendo ? 'scale(1.03)' : 'none',
      }}
    >
      <span style={{ width: 34, fontWeight: 800, fontSize: 13.5, color: soyYo ? color : S.MUTED }}>{etiqueta}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: soyYo ? 800 : 600, fontSize: 13.5, color: S.TEXT }}>
        @{nombre}
        {soyYo && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 800, color, textTransform: 'uppercase' }}>tú</span>}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 800, fontSize: 13.5, color: draftis >= 0 ? S.TEXT : '#FF8A8A' }}>
        {draftis > 0 ? '+' : ''}
        {draftis} <IconoGema size={12} />
      </span>
    </div>
  );
}
