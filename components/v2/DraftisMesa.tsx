'use client';

import * as S from '@/lib/mockupStyles';
import { IconoCredito, IconoGema } from '@/components/v2/IconosV2';
import { boteDraftis, draftisPorPuesto, textoDraftis, DRAFTIS_POR_JUGADOR } from '@/lib/draftisMesa';
import { calcularReparto, repartirPremiosConEmpates, type TipoSala } from '@/lib/repartoPremios';
import { etiquetasPosicion } from '@/lib/posicionesEmpate';

// ============================================================================
// MESAS DE LA LIGA (V2, 16/10): formato, premios y entrada en draftis/créditos
// ============================================================================
// Iñi: "en el formato, lo mismo que en las salas amistosos: en verde los
// puestos premiados y en rojo los que pierden"; "los premios son draftis";
// "el buy-in son créditos Drafters". Mismo lenguaje que el diseño de las ligas
// (07/10): el pase verde = crédito, la gema dorada = draftis.

const VERDE = { bg: 'rgba(61,220,132,0.16)', bd: 'rgba(61,220,132,0.6)', tx: '#3DDC84' };
const ROJO = { bg: 'rgba(255,92,92,0.16)', bd: 'rgba(255,92,92,0.6)', tx: '#FF8A8A' };
const ORO = '#F0B94D';

// Tira de puestos: verde los que suman, rojo los que restan.
export function TiraDraftis({ tipo, aforo, compacta = false }: { tipo: string; aforo: number | null; compacta?: boolean }) {
  const netos = draftisPorPuesto(tipo, aforo);
  const ganan = netos.filter((x) => x > 0).length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compacta ? 5 : 8 }}>
      <div style={{ display: 'flex', gap: compacta ? 3 : 4, flexWrap: 'wrap' }}>
        {netos.map((n, i) => {
          const c = n > 0 ? VERDE : ROJO;
          return (
            <span
              key={i}
              style={{
                minWidth: compacta ? 26 : 44,
                padding: compacta ? '3px 0' : '5px 4px',
                textAlign: 'center',
                borderRadius: compacta ? 6 : 8,
                fontSize: compacta ? 10.5 : 12,
                fontWeight: 800,
                background: c.bg,
                border: `1px solid ${c.bd}`,
                color: c.tx,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                lineHeight: 1.15,
              }}
            >
              {i + 1}º{!compacta && <span style={{ fontSize: 10, fontWeight: 700 }}>{textoDraftis(n)}</span>}
            </span>
          );
        })}
      </div>
      {!compacta && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11.5, color: S.MUTED_2 }}>
          <span>
            <span style={{ color: VERDE.tx }}>■</span> {ganan === 1 ? 'Gana' : `Ganan ${ganan}`} · suman draftis
          </span>
          <span>
            <span style={{ color: ROJO.tx }}>■</span> Pierden · restan {DRAFTIS_POR_JUGADOR}
          </span>
        </div>
      )}
    </div>
  );
}

// "1 crédito Drafters" con el pase verde.
export function EntradaCredito({ grande = false }: { grande?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: grande ? 15 : 14, color: S.ACCENT }}>
      <IconoCredito size={grande ? 20 : 17} /> 1 crédito Drafters
    </span>
  );
}

// Premios de la mesa en draftis (estilo tarjetas de la liga).
export function PremiosDraftis({ tipo, aforo, liga }: { tipo: string; aforo: number | null; liga?: string | null }) {
  const netos = draftisPorPuesto(tipo, aforo);
  const bote = boteDraftis(aforo);
  // Agrupa puestos consecutivos con el mismo neto (Doble/Triple: "1º-2º +100").
  const grupos: { desde: number; hasta: number; neto: number }[] = [];
  netos.forEach((n, i) => {
    const g = grupos[grupos.length - 1];
    if (g && g.neto === n) g.hasta = i + 1;
    else grupos.push({ desde: i + 1, hasta: i + 1, neto: n });
  });
  const ganadores = grupos.filter((g) => g.neto > 0);
  const perdedores = grupos.find((g) => g.neto <= 0);
  const puesto = (g: { desde: number; hasta: number }) => (g.desde === g.hasta ? `${g.desde}º` : `${g.desde}º – ${g.hasta}º`);
  const medalla = (i: number) => ['#F3D27A', '#D9DEE3', '#E5A877'][i] ?? ORO;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Bote */}
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          padding: '22px 14px 18px',
          background: 'radial-gradient(120% 90% at 50% 0%, rgba(240,185,77,0.22) 0%, rgba(240,185,77,0.06) 55%, rgba(11,15,14,0) 100%), #111614',
          border: '1px solid rgba(240,185,77,0.4)',
          borderRadius: 16,
        }}
      >
        <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#C9A257' }}>¿Qué me juego en esta mesa?</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 38, lineHeight: 1, color: ORO }}>
          <IconoGema size={30} /> {bote.toLocaleString('es-ES')}
        </span>
        <span style={{ fontSize: 12.5, color: S.MUTED_2, textAlign: 'center', lineHeight: 1.45 }}>
          draftis en juego · cada jugador pone {DRAFTIS_POR_JUGADOR} <IconoGema size={11} /> y se reparten entre los que ganan
        </span>
      </div>

      {/* ¿Cuánto puedo ganar? */}
      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 18, color: S.TEXT, marginTop: 4 }}>¿Cuánto puedo ganar?</span>
      {ganadores.map((g, i) => (
        <div
          key={g.desde}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '13px 14px',
            background: i === 0 ? 'linear-gradient(135deg, #1B2A1F 0%, #16251B 100%)' : S.PANEL,
            border: `1px solid ${i === 0 ? 'rgba(61,220,132,0.5)' : 'rgba(61,220,132,0.28)'}`,
            borderRadius: 12,
          }}
        >
          <span
            style={{
              flexShrink: 0,
              minWidth: 40,
              height: 30,
              padding: '0 8px',
              borderRadius: 999,
              background: medalla(i),
              color: '#1A1407',
              fontFamily: "'Barlow Condensed', sans-serif",
              fontWeight: 800,
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {puesto(g)}
          </span>
          <span style={{ flex: 1, fontSize: 12.5, color: S.MUTED_2 }}>{g.hasta > g.desde ? 'Cada uno se lleva' : 'Se lleva'} {g.neto + DRAFTIS_POR_JUGADOR} y suma</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 24, color: '#3DDC84' }}>
            {textoDraftis(g.neto)} <IconoGema size={18} />
          </span>
        </div>
      ))}
      {perdedores && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'rgba(255,92,92,0.07)', border: '1px solid rgba(255,92,92,0.35)', borderRadius: 12 }}>
          <span style={{ flexShrink: 0, minWidth: 40, height: 30, padding: '0 8px', borderRadius: 999, background: 'rgba(255,92,92,0.18)', color: '#FF8A8A', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {puesto({ desde: perdedores.desde, hasta: netos.length })}
          </span>
          <span style={{ flex: 1, fontSize: 12.5, color: S.MUTED_2 }}>Pierden lo que pusieron</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, color: '#FF8A8A' }}>
            {textoDraftis(-DRAFTIS_POR_JUGADOR)} <IconoGema size={16} />
          </span>
        </div>
      )}
      <span style={{ fontSize: 11.5, color: S.MUTED_3, lineHeight: 1.55 }}>
        Los draftis suman en la clasificación de {liga ?? 'la Liga Drafters'}. Empates: se reparten los draftis de los puestos empatados.
      </span>
    </div>
  );
}

// Mesa terminada: cada equipo con los draftis que suma o resta (empates repartidos).
export function ResultadoDraftis({ tipo, aforo, filas }: { tipo: string; aforo: number | null; filas: { id: string; nombre: string; total: number }[] }) {
  const ordenados = filas.slice().sort((a, b) => b.total - a.total);
  const tramos = calcularReparto(tipo as TipoSala, aforo, ordenados.length);
  const reparto = repartirPremiosConEmpates(
    ordenados.map((o) => ({ equipoId: o.id, valor: o.total })),
    tramos,
    DRAFTIS_POR_JUGADOR * ordenados.length,
    'desc'
  );
  const importe = new Map(reparto.map((r) => [r.equipoId, r.importe]));
  const etiquetas = etiquetasPosicion(ordenados, (o) => o.total);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {ordenados.map((o, i) => {
        const imp = importe.get(o.id) ?? 0;
        const neto = imp > 0 ? Math.round(imp) - DRAFTIS_POR_JUGADOR : -DRAFTIS_POR_JUGADOR;
        return (
          <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: S.PANEL, border: `1px solid ${neto > 0 ? 'rgba(61,220,132,0.35)' : 'rgba(255,92,92,0.3)'}`, borderRadius: 10 }}>
            <span style={{ flexShrink: 0, width: 32, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, color: ORO }}>{etiquetas[i]}</span>
            <span style={{ flex: 1, minWidth: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 13, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.nombre}</span>
            <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, color: S.MUTED_2 }}>{o.total} pts</span>
            <span style={{ flexShrink: 0, width: 74, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 16, color: neto > 0 ? '#3DDC84' : '#FF8A8A' }}>
              {textoDraftis(neto)} <IconoGema size={13} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
