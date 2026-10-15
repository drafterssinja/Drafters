'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import MarcoV2, { EtiquetaBeta, Titulo } from '@/components/v2/MarcoV2';
import { useSesionV2 } from '@/components/v2/useSesionV2';
import { DEPORTE_NOMBRE, IconoGema, esDeporteV2, type DeporteV2 } from '@/components/v2/IconosV2';
import { etiquetasPosicion } from '@/lib/posicionesEmpate';

// ============================================================================
// CLASIFICACIÓN DE LA LIGA DE UN DEPORTE (V2, 15/10)
// ============================================================================
// Pedido de Iñi: desde la pestaña Liga, un enlace a la clasificación. Temporada
// de pruebas: draftis de las mesas de liga en las que se ha entrado con crédito
// y ya están liquidadas (v2_clasificacion_liga, SQL 35). Empates con T.

type Fila = { usuario_id: string; nombre: string; draftis: number; mesas: number; ganadas: number; soy_yo: boolean };

export default function V2ClasificacionLiga() {
  const params = useParams<{ deporte: string }>();
  const deporte: DeporteV2 = esDeporteV2(params.deporte) ? params.deporte : 'futbol';
  const { perfil, estado } = useSesionV2();
  const [filas, setFilas] = useState<Fila[] | null>(null);

  useEffect(() => {
    if (estado !== 'ok') return;
    supabase.rpc('v2_clasificacion_liga', { p_deporte: deporte }).then(({ data }) => setFilas((data as Fila[]) ?? []));
  }, [estado, deporte]);

  const etiquetas = filas ? etiquetasPosicion(filas, (f) => f.draftis) : [];
  const yo = filas?.findIndex((f) => f.soy_yo) ?? -1;

  return (
    <MarcoV2 perfil={perfil} estado={estado} deporte={deporte} volverA={`/v2/${deporte}?modo=liga`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <EtiquetaBeta />
        <Titulo>Clasificación · Liga de {DEPORTE_NOMBRE[deporte].toLowerCase()}</Titulo>
        <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>Temporada de pruebas</span>
      </div>

      {filas !== null && yo >= 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderRadius: 14, padding: '14px 16px', border: '1px solid rgba(61,220,132,0.45)', background: 'rgba(61,220,132,0.08)' }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 30, color: S.ACCENT }}>{etiquetas[yo].replace(/^(\d+)$/, '$1º').replace(/^T(\d+)$/, 'T$1º')}</span>
          <span style={{ flex: 1, fontSize: 13, color: S.MUTED }}>
            Vas {etiquetas[yo]}º de {filas.length} · {filas[yo].mesas} mesas, {filas[yo].ganadas} ganadas
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 800, fontSize: 17, color: S.TEXT }}>
            {filas[yo].draftis > 0 ? '+' : ''}
            {filas[yo].draftis} <IconoGema size={16} />
          </span>
        </div>
      )}

      {filas === null && <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>Cargando clasificación...</p>}
      {filas !== null && filas.length === 0 && (
        <p style={{ fontSize: 13, color: S.MUTED_3, margin: 0, lineHeight: 1.5 }}>Todavía no hay ninguna mesa de liga terminada. La clasificación aparece en cuanto se cierre la primera.</p>
      )}

      {filas !== null && filas.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 10, padding: '10px 14px', fontSize: 10.5, fontWeight: 700, color: S.MUTED_3, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${S.CARD_BORDER}` }}>
            <span style={{ width: 34 }}>Pos.</span>
            <span style={{ flex: 1 }}>Jugador</span>
            <span style={{ width: 52, textAlign: 'center' }}>Mesas</span>
            <span style={{ width: 70, textAlign: 'right' }}>Draftis</span>
          </div>
          {filas.map((f, i) => (
            <motion.div
              key={f.usuario_id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 20) * 0.02 }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: `1px solid ${S.CARD_BORDER}`, background: f.soy_yo ? 'rgba(61,220,132,0.08)' : 'transparent' }}
            >
              <span style={{ width: 34, fontWeight: 800, fontSize: 13.5, color: etiquetas[i].replace('T', '') === '1' ? '#F0B94D' : S.MUTED }}>{etiquetas[i]}</span>
              <span style={{ flex: 1, minWidth: 0, fontWeight: f.soy_yo ? 800 : 600, fontSize: 13.5, color: S.TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{f.nombre}</span>
              <span style={{ width: 52, textAlign: 'center', fontSize: 12, color: S.MUTED_2 }}>
                {f.ganadas}/{f.mesas}
              </span>
              <span style={{ width: 70, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, fontWeight: 800, fontSize: 14, color: f.draftis >= 0 ? S.TEXT : '#FF8A8A' }}>
                {f.draftis > 0 ? '+' : ''}
                {f.draftis} <IconoGema size={13} />
              </span>
            </motion.div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 11.5, color: S.MUTED_3, lineHeight: 1.6 }}>
        <div>Cada mesa pone en juego 100 draftis por jugador. Si ganas sumas y si pierdes restas 100:</div>
        <div>Doble o Nada +100 · Triple o Nada +200 · Oro y Plata +250 / +50 · Tridente +500 / +150 / +50.</div>
        <div>Cuentan las mesas de liga en las que entras con crédito, en cuanto se cierran. &quot;Mesas&quot; = ganadas / jugadas.</div>
      </div>
    </MarcoV2>
  );
}
