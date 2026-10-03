'use client';

import type { ReactNode } from 'react';
import * as S from '@/lib/mockupStyles';
import { COLOR_TIPO_RESULTADO, formatGolfScore, type TipoResultadoHoyo } from '@/lib/golfScoring';

// ============================================================================
// TABLA HOYO A HOYO ESTILO TARJETA DE GOLF (nuevo, 03/10, pedido de Iñi)
// ============================================================================
// Reemplaza la tira de 18 círculos en una sola fila (con pestañas para
// cambiar de ronda, una ronda visible cada vez) por una tabla única con el
// formato exacto que pidió Iñi (pasó una captura de referencia): una fila
// "Par" fija arriba, y una fila por cada ronda jugada (R1, R2...) debajo —
// todas a la vez, sin tener que cambiar de pestaña — con columnas 1-18 +
// "Out" (suma hoyos 1-9) + "In" (suma hoyos 10-18) + "Total" + "To Par",
// igual que cualquier tarjeta de resultados de golf real.
//
// Colores: un resultado que NO es par se pinta con el mismo criterio de
// color ya usado en el resto de la app (lib/golfScoring.ts) — círculo para
// birdie/eagle (bajo par), cuadrado para bogey/doble bogey (sobre par). Un
// resultado igual al par se deja en texto plano, sin círculo ni cuadrado —
// igual que en una tarjeta de golf de verdad, donde solo se marca lo que se
// sale del par.
//
// El par de cada hoyo (fila "Par") se intenta mostrar completo desde el
// principio del torneo, aunque todavía no se haya jugado ningún hoyo — lo
// calcula quien use este componente (ver `paresCompletos`), normalmente a
// partir de la biblioteca de campos (campos_golf_biblioteca), que con Data
// Golf se rellena sola desde el primer ciclo de sincronización.
//
// Reutilizada tal cual en app/porras/[id]/clasificacion/page.tsx y
// app/salas/[id]/clasificacion/page.tsx.

export type CasillaHoyo = { par: number; golpes: number; tipo_resultado: TipoResultadoHoyo } | null;

export type FilaRondaTabla = {
  numero: number;
  nombreCampo: string | null;
  /** 18 posiciones, índice 0 = hoyo 1. */
  casillas: CasillaHoyo[];
};

type Props = {
  /** 18 posiciones (índice 0 = hoyo 1) — el par de cada hoyo si ya se conoce, null si todavía no. */
  paresCompletos: (number | null)[];
  filas: FilaRondaTabla[];
};

const ANCHO_CELDA = 27;
const ANCHO_ETIQUETA = 46;
const ANCHO_SUBTOTAL = 42;
const FONDO_RESALTADO = 'rgba(170,180,174,0.07)';
// CAMBIO 03/10 (pedido de Iñi): el bogey se pinta en negro (#0B0F0E, ver
// COLOR_TIPO_RESULTADO en lib/golfScoring.ts) y, sin un fondo propio para
// la tarjeta, esta tabla heredaba el fondo oscuro de la pantalla
// (S.PANEL, #131917 — casi idéntico a ese negro), así que el cuadrado del
// bogey casi no se distinguía del resto de la tarjeta. Fondo propio, un
// punto más claro, solo para esta tabla.
const FONDO_TARJETA = '#1C2621';

function sumaOGuion(valores: (number | null)[]): number | null {
  const conocidos = valores.filter((v): v is number => v !== null);
  if (conocidos.length === 0) return null;
  return conocidos.reduce((a, b) => a + b, 0);
}

function Celda({ children, resaltado = false, cabecera = false }: { children: ReactNode; resaltado?: boolean; cabecera?: boolean }) {
  return (
    <td
      style={{
        width: ANCHO_CELDA,
        minWidth: ANCHO_CELDA,
        textAlign: 'center',
        padding: '6px 2px',
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: cabecera ? 700 : 600,
        fontSize: cabecera ? 10.5 : 12,
        color: cabecera ? S.MUTED_3 : S.TEXT,
        background: resaltado ? FONDO_RESALTADO : 'transparent',
        borderBottom: `1px solid ${S.CARD_BORDER}`,
        borderLeft: `1px solid ${S.CARD_BORDER}`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </td>
  );
}

function celdaResultado(casilla: CasillaHoyo) {
  if (!casilla) return <span style={{ color: S.FAINT }}>–</span>;
  if (casilla.tipo_resultado === 'par') {
    return <span>{casilla.golpes}</span>;
  }
  const color = COLOR_TIPO_RESULTADO[casilla.tipo_resultado];
  // Círculo para lo bueno (eagle/birdie, bajo par), cuadrado para lo malo
  // (bogey/doble bogey, sobre par) — mismo convenio que una tarjeta de golf
  // de papel real.
  const esCirculo = casilla.tipo_resultado === 'eagle_o_mejor' || casilla.tipo_resultado === 'birdie';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 21,
        height: 21,
        borderRadius: esCirculo ? '50%' : 5,
        background: color.fondo,
        color: color.texto,
        fontWeight: 800,
      }}
    >
      {casilla.golpes}
    </span>
  );
}

export default function TablaHoyoAHoyo({ paresCompletos, filas }: Props) {
  const parOut = sumaOGuion(paresCompletos.slice(0, 9));
  const parIn = sumaOGuion(paresCompletos.slice(9, 18));
  const parTotal = sumaOGuion(paresCompletos);

  const estiloEtiqueta = {
    position: 'sticky' as const,
    left: 0,
    zIndex: 1,
    width: ANCHO_ETIQUETA,
    minWidth: ANCHO_ETIQUETA,
    textAlign: 'left' as const,
    padding: '6px 8px',
    fontFamily: "'Barlow Condensed', sans-serif",
    background: FONDO_TARJETA,
    borderBottom: `1px solid ${S.CARD_BORDER}`,
  };

  const estiloToPar = {
    width: ANCHO_SUBTOTAL,
    minWidth: ANCHO_SUBTOTAL,
    textAlign: 'center' as const,
    padding: '6px 2px',
    fontFamily: "'Barlow Condensed', sans-serif",
    background: FONDO_RESALTADO,
    borderBottom: `1px solid ${S.CARD_BORDER}`,
    borderLeft: `1px solid ${S.CARD_BORDER}`,
    whiteSpace: 'nowrap' as const,
  };

  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${S.CARD_BORDER}`, borderRadius: 10, background: FONDO_TARJETA }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={{ ...estiloEtiqueta, fontWeight: 700, fontSize: 10.5, color: S.MUTED_3 }}>Hoyo</th>
            {Array.from({ length: 9 }, (_, i) => (
              <Celda key={i} cabecera>
                {i + 1}
              </Celda>
            ))}
            <Celda cabecera resaltado>
              Out
            </Celda>
            {Array.from({ length: 9 }, (_, i) => (
              <Celda key={i + 9} cabecera>
                {i + 10}
              </Celda>
            ))}
            <Celda cabecera resaltado>
              In
            </Celda>
            <Celda cabecera resaltado>
              Total
            </Celda>
            <th style={{ ...estiloToPar, fontWeight: 700, fontSize: 10.5, color: S.MUTED_3 }}>To Par</th>
          </tr>
        </thead>
        <tbody>
          {/* Fila de pares — referencia fija del campo (igual en todas las
              rondas, salvo los pocos torneos con varios campos en rotación,
              donde se usa el campo más reciente que se conozca). */}
          <tr>
            <td style={{ ...estiloEtiqueta, fontWeight: 700, fontSize: 11, color: S.MUTED_2 }}>Par</td>
            {paresCompletos.slice(0, 9).map((p, i) => (
              <Celda key={i}>{p ?? '–'}</Celda>
            ))}
            <Celda resaltado>{parOut ?? '–'}</Celda>
            {paresCompletos.slice(9, 18).map((p, i) => (
              <Celda key={i + 9}>{p ?? '–'}</Celda>
            ))}
            <Celda resaltado>{parIn ?? '–'}</Celda>
            <Celda resaltado>{parTotal ?? '–'}</Celda>
            <td style={{ ...estiloToPar, fontWeight: 700, fontSize: 12, color: S.MUTED_3 }}>E</td>
          </tr>

          {filas.map((f) => {
            const golpesOut = sumaOGuion(f.casillas.slice(0, 9).map((c) => c?.golpes ?? null));
            const golpesIn = sumaOGuion(f.casillas.slice(9, 18).map((c) => c?.golpes ?? null));
            const golpesTotal = sumaOGuion(f.casillas.map((c) => c?.golpes ?? null));
            const parJugadoTotal = sumaOGuion(f.casillas.map((c) => c?.par ?? null));
            const toPar = golpesTotal !== null && parJugadoTotal !== null ? golpesTotal - parJugadoTotal : null;
            return (
              <tr key={f.numero}>
                <td style={{ ...estiloEtiqueta, fontWeight: 800, fontSize: 12, color: S.TEXT }} title={f.nombreCampo ?? undefined}>
                  R{f.numero}
                </td>
                {f.casillas.slice(0, 9).map((c, i) => (
                  <Celda key={i}>{celdaResultado(c)}</Celda>
                ))}
                <Celda resaltado>{golpesOut ?? '–'}</Celda>
                {f.casillas.slice(9, 18).map((c, i) => (
                  <Celda key={i + 9}>{celdaResultado(c)}</Celda>
                ))}
                <Celda resaltado>{golpesIn ?? '–'}</Celda>
                <Celda resaltado>{golpesTotal ?? '–'}</Celda>
                <td style={{ ...estiloToPar, fontWeight: 800, fontSize: 12, color: S.TEXT }}>{toPar !== null ? formatGolfScore(toPar) : '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
