// ============================================================================
// TIPOS DE SALA — definitivos (tabla de Iñi, 23/09 + corrección 23/09)
// ============================================================================
// Aforos y reparto de cada tipo fijados por Iñi (ver lib/repartoPremios.ts
// para el reparto exacto del bote de cada uno). Además, CADA aforo de CADA
// tipo de formato fijo (Doble o Nada, Triple o Nada, Oro y Plata, Tridente)
// se abre en TODOS los escalones de importe de ESCALONES_BUY_IN — pedido
// explícito de Iñi: "dos salas de 5 euros de 3 jugadores, dos salas de 10
// euros de 3 jugadores... así también de todos los importes". Es decir, no
// hay un único buy-in por variante: hay 2 salas por cada combinación
// (tipo, aforo, importe).
//
// Iñi solo puso ejemplos explícitos de esto para Doble o Nada y Triple o
// Nada — se ha aplicado el mismo criterio a Oro y Plata y Tridente por
// consistencia (mismo principio de "elige tu importe"), ya que no dijo lo
// contrario. Si en realidad esos dos deben quedarse con un único importe,
// hay que decírmelo para revertirlo.
//
// "Maratón" sigue aparte: inscripción sin límite (sin aforo fijo) y va en
// el apartado de "grandes torneos" de la app, no mezclado con el resto de
// salas — no sigue la convención de "2 por variante": se crea 1 sola por
// torneo/jornada, igual que una porra clásica, y no tiene escalones de
// importe (es un único bote acumulado, no varias mesas en paralelo).
//
// Es el único archivo que hay que tocar para que un cambio en aforos,
// importes o tipos se propague a toda la app (la automatización de fútbol y
// el importador de golf/tenis leen de aquí).
// ============================================================================

import { TipoSala } from './repartoPremios';

// Escalones de importe de entrada — Fase 1 (dinero simulado), tal como los
// dio Iñi el 23/09. Cada aforo de cada tipo de formato fijo se abre con
// TODOS estos importes.
export const ESCALONES_BUY_IN: number[] = [5, 10, 20, 30, 50, 75, 100];

// ⚠️ FASE 3 (dinero real) — pendiente, NO activar todavía: cuando se
// construya la versión de la app con dinero real (ver sección 10 de
// DRAFTERS_Costes_Business_Plan.md, "Camino C"), Iñi pidió explícitamente
// añadir también los escalones 1€, 2€, 200€ y 500€ a esta lista. Recordarlo
// en ese momento — no aplica mientras el saldo siga siendo simulado.
// export const ESCALONES_BUY_IN_DINERO_REAL: number[] = [1, 2, 5, 10, 20, 30, 50, 75, 100, 200, 500];

// Aforos válidos de cada tipo de formato fijo (no aplica a maratón).
const AFOROS_POR_TIPO: { tipo: TipoSala; label: string; aforos: number[] }[] = [
  { tipo: 'doble_o_nada', label: 'Doble o Nada', aforos: [2, 4, 6, 8, 10] },
  { tipo: 'triple_o_nada', label: 'Triple o Nada', aforos: [3, 6, 9] },
  { tipo: 'oro_y_plata', label: 'Oro y Plata', aforos: [5] },
  { tipo: 'tridente', label: 'Tridente', aforos: [10] },
];

export interface VarianteSala {
  tipo: TipoSala;
  label: string;
  aforo: number;
  buyIn: number;
}

// Una fila por cada combinación (tipo, aforo, importe) — p.ej. Doble o Nada
// genera 5 aforos × 7 importes = 35 variantes.
export const VARIANTES_SALA: VarianteSala[] = AFOROS_POR_TIPO.flatMap(({ tipo, label, aforos }) =>
  aforos.flatMap((aforo) =>
    ESCALONES_BUY_IN.map((buyIn) => ({
      tipo,
      label: `${label} · ${aforo} jugadores · ${buyIn}€`,
      aforo,
      buyIn,
    }))
  )
);

// Cuántas salas de cada variante (tipo + aforo + importe) se crean
// automáticamente al abrir un torneo/jornada nuevo.
export const SALAS_POR_VARIANTE_AL_CREAR = 2;

export const MARATON_TIPO: TipoSala = 'maraton';
export const MARATON_LABEL = 'Maratón';
export const MARATON_BUY_IN = 10; // provisional — sin escalones, sala única

export interface SalaNueva {
  nombre: string;
  deporte: string;
  competicion: string;
  tipo: TipoSala;
  aforo: number | null;
  buy_in: number;
  fecha_limite_inscripcion: string | null;
}

// Genera todas las salas que hay que crear al abrir un torneo/jornada nuevo:
// 2 de cada variante (tipo + aforo + importe), más 1 sola sala Maratón (sin
// aforo ni escalones de importe).
export function generarSalasParaTorneo(params: {
  competicionLabel: string;
  deporte: string;
  fechaLimiteIso: string | null;
}): SalaNueva[] {
  const { competicionLabel, deporte, fechaLimiteIso } = params;

  const salas: SalaNueva[] = VARIANTES_SALA.flatMap((variante) =>
    Array.from({ length: SALAS_POR_VARIANTE_AL_CREAR }).map(
      (): SalaNueva => ({
        nombre: `${competicionLabel} · ${variante.label}`,
        deporte,
        competicion: competicionLabel,
        tipo: variante.tipo,
        aforo: variante.aforo,
        buy_in: variante.buyIn,
        fecha_limite_inscripcion: fechaLimiteIso,
      })
    )
  );

  salas.push({
    nombre: `${competicionLabel} · ${MARATON_LABEL}`,
    deporte,
    competicion: competicionLabel,
    tipo: MARATON_TIPO,
    aforo: null,
    buy_in: MARATON_BUY_IN,
    fecha_limite_inscripcion: fechaLimiteIso,
  });

  return salas;
}
