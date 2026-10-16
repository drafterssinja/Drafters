'use client';

import { useAmigosIds } from '@/lib/amigos';
import MarcaAmigo from '@/components/MarcaAmigo';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import MarcoV2, { EtiquetaBeta, Titulo } from '@/components/v2/MarcoV2';
import { useSesionV2 } from '@/components/v2/useSesionV2';
import { DEPORTE_NOMBRE, IconoGema, esDeporteV2, type DeporteV2 } from '@/components/v2/IconosV2';
import { etiquetasPosicion } from '@/lib/posicionesEmpate';

// ============================================================================
// LIGA DE UN DEPORTE: APUNTARSE + CLASIFICACIÓN (V2, 15/10)
// ============================================================================
// Pedido de Iñi: para jugar la liga hay que apuntarse. Lo primero que se ve es
// la información de la temporada (cuándo empieza y acaba, en qué división
// empiezas, cuántos van a la Gran Final, cuántos bajan, grupos), un botón grande
// para apuntarse y la lista de apuntados. Con la temporada en marcha, la
// clasificación en draftis (solo apuntados). Reglas: diseño de ligas del 07/10.

import PanelLiga, { type Fila, type Info } from '@/components/v2/PanelLiga';
import Cargando from '@/components/Cargando';

export default function V2Liga() {
  const amigos = useAmigosIds();
  const params = useParams<{ deporte: string }>();
  const deporte: DeporteV2 = esDeporteV2(params.deporte) ? params.deporte : 'futbol';
  const { perfil, estado } = useSesionV2();
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  const [filas, setFilas] = useState<Fila[] | null>(null);

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

  const etiquetas = filas ? etiquetasPosicion(filas, (f) => f.draftis) : [];

  return (
    <MarcoV2 perfil={perfil} estado={estado} deporte={deporte} volverA={`/v2/${deporte}?modo=liga`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <EtiquetaBeta />
        <Titulo>{info ? info.liga : `Liga de ${DEPORTE_NOMBRE[deporte].toLowerCase()}`}</Titulo>
        {info && <span style={{ fontSize: 13, fontWeight: 700, color: '#F0B94D' }}>Temporada {info.numero}</span>}
      </div>

      {info === undefined && <Cargando compacto />}

      {info === null && (
        <div style={{ background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontWeight: 800, fontSize: 15, color: S.TEXT }}>Todavía no hay ninguna temporada abierta</span>
          <span style={{ fontSize: 13, color: S.MUTED_2, lineHeight: 1.5 }}>En cuanto se abra la primera temporada podrás apuntarte desde aquí. Mientras tanto, las mesas de liga cuentan para esta clasificación de pruebas.</span>
        </div>
      )}

      {info && <PanelLiga info={info} deporte={deporte} onApuntado={() => void cargar()} conLista={!info.en_curso} />}

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
                  <span style={{ flex: 1, minWidth: 0, fontWeight: f.soy_yo ? 800 : 600, fontSize: 13.5, color: S.TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{f.nombre}
                    {amigos.has(f.usuario_id) && <MarcaAmigo compacta />}
                  </span>
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

