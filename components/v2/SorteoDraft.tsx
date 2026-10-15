'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import * as S from '@/lib/mockupStyles';
import { V2_COLOR } from '@/components/v2/MarcoV2';

// ============================================================================
// SORTEO DEL ORDEN DEL DRAFT — animación tipo tragaperras (15/10)
// ============================================================================
// Iñi: "que se haga un sorteo de forma chula... visual bonito". El orden ya
// lo ha sorteado el servidor; aquí se desvela puesto a puesto: los nombres
// giran cada vez más despacio hasta pararse en el que ha tocado.

const PAUSAS = [55, 55, 55, 60, 65, 70, 80, 90, 105, 125, 150, 185, 230, 290, 360];
const COLORES_PUESTO = ['#F0B94D', '#C9D1D9', '#E08A4F'];

export default function SorteoDraft({ orden: ordenProp, nombres: nombresProp, miId, onTerminar }: { orden: string[]; nombres: Record<string, string>; miId: string; onTerminar: () => void }) {
  // Copia fija: el padre se refresca cada pocos segundos y no debe reiniciar la animación.
  const [orden] = useState(ordenProp);
  const [nombres] = useState(nombresProp);
  const [revelados, setRevelados] = useState(0);
  const [girando, setGirando] = useState<string>('');
  const [tick, setTick] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (revelados >= orden.length) return;
    const restantes = orden.slice(revelados);
    let t = 600; // pequeña pausa antes de cada puesto
    PAUSAS.forEach((p, i) => {
      t += p;
      timers.current.push(
        setTimeout(() => {
          const azar = restantes[Math.floor(Math.random() * restantes.length)];
          setGirando(nombres[azar] ?? '?');
          setTick((x) => x + 1);
          if (i === PAUSAS.length - 1) setGirando(nombres[orden[revelados]] ?? '?');
        }, t)
      );
    });
    timers.current.push(
      setTimeout(() => {
        try {
          navigator.vibrate?.(40);
        } catch {}
        setRevelados((r) => r + 1);
        setGirando('');
      }, t + 650)
    );
    const ts = timers.current;
    return () => {
      ts.forEach(clearTimeout);
      timers.current = [];
    };
  }, [revelados, orden, nombres]);

  const terminado = revelados >= orden.length;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'radial-gradient(circle at 50% 20%, #2A1F4D 0%, #0B0F0E 70%)', display: 'flex', flexDirection: 'column', alignItems: 'center', overflowY: 'auto', padding: '40px 20px' }}>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.2em', color: V2_COLOR }}>DRAFT</span>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 800, fontSize: 38, color: S.TEXT, textShadow: `0 0 24px ${V2_COLOR}` }}>SORTEO DEL ORDEN</span>
      </motion.div>

      <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {orden.map((u, i) => {
          const visible = i < revelados;
          const actual = i === revelados;
          const yo = u === miId;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '12px 16px',
                borderRadius: 14,
                border: `1.5px solid ${visible ? (yo ? S.ACCENT : V2_COLOR) : actual ? '#F0B94D' : S.CARD_BORDER}`,
                background: visible ? (yo ? 'rgba(61,220,132,0.12)' : 'rgba(167,139,250,0.1)') : 'rgba(255,255,255,0.03)',
                boxShadow: actual ? '0 0 22px rgba(240,185,77,0.35)' : visible ? `0 0 14px ${yo ? 'rgba(61,220,132,0.25)' : 'rgba(167,139,250,0.2)'}` : 'none',
                overflow: 'hidden',
              }}
            >
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 26, width: 44, color: COLORES_PUESTO[i] ?? S.MUTED }}>{i + 1}º</span>
              <span style={{ flex: 1, height: 30, position: 'relative', overflow: 'hidden' }}>
                <AnimatePresence mode="popLayout">
                  {visible ? (
                    <motion.span key="fijo" initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 18 }} style={{ position: 'absolute', left: 0, top: 2, fontWeight: 800, fontSize: 19, color: yo ? S.ACCENT : S.TEXT, transformOrigin: 'left center' }}>
                      @{nombres[u] ?? '?'} {yo ? '(tú)' : ''}
                    </motion.span>
                  ) : actual && girando ? (
                    <motion.span key={`g${tick}`} initial={{ y: -26, opacity: 0.2 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 26, opacity: 0 }} transition={{ duration: 0.05 }} style={{ position: 'absolute', left: 0, top: 2, fontWeight: 800, fontSize: 19, color: '#F0B94D' }}>
                      @{girando}
                    </motion.span>
                  ) : (
                    <motion.span key="q" style={{ position: 'absolute', left: 0, top: 2, fontWeight: 800, fontSize: 19, color: S.FAINT }}>
                      ? ? ?
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            </motion.div>
          );
        })}
      </div>

      <div style={{ width: '100%', maxWidth: 420, marginTop: 28, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <AnimatePresence>
          {terminado && (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: S.MUTED, textAlign: 'center', lineHeight: 1.5 }}>En cada ronda el orden rota: el primero pasa al último y los demás suben un puesto.</span>
              <button type="button" onClick={onTerminar} style={{ ...S.primaryButton, background: V2_COLOR }}>
                ¡Que empiece el draft!
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        {!terminado && (
          <button type="button" onClick={onTerminar} style={{ background: 'none', border: 'none', color: S.MUTED_3, fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline' }}>
            Saltar animación
          </button>
        )}
      </div>
    </div>
  );
}
