// ============================================================================
// TIPOS DE SALA — definitivos (tabla de Iñi, 23/09 + corrección 23/09)
// ============================================================================
// Aforos y reparto de cada tipo fijados por Iñi (ver lib/repartoPremios.ts
// para el reparto exacto del bote de cada uno). Además, CADA aforo de CADA
// tipo de formato fijo (Doble o Nada, Triple o Nada, Oro y Plata, Tridente)
// se abre en TODOS los escalones de importe de ESCALONES_BUY_IN — pedido
// explícito de Iñi: "dos salas de 5 euros de 3 jugadores, dos salas de 10
// euros de 3 jugadores... así también de todos los importes". Es decir, no
// hay un único buy-in por variante: hay N salas por cada combinación
// (tipo, aforo, importe) — ver SALAS_POR_VARIANTE_AL_CREAR.
//
// Iñi solo puso ejemplos explícitos de esto para Doble o Nada y Triple o
// Nada — se ha aplicado el mismo criterio a Oro y Plata y Tridente por
// consistencia (mismo principio de "elige tu importe"), ya que no dijo lo
// contrario. Si en realidad esos dos deben quedarse con un único importe,
// hay que decírmelo para revertirlo.
//
// "Maratón" sigue aparte: inscripción sin límite (sin aforo fijo) y va en
// el apartado de "grandes torneos" de la app, no mezclado con el resto de
// salas — no sigue la convención de "N por variante": se crea 1 sola por
// torneo/jornada, igual que una porra clásica, y no tiene escalones de
// importe (es un único bote acumulado, no varias mesas en paralelo).
//
// ⚠️ REDUCIDO PARA LA FASE DE PRUEBAS CON DINERO FICTICIO (25/09, tercera
// vuelta): Iñi pidió explícitamente reducir el número de mesas mientras se
// prueba con pocos jugadores reales — "para esta prueba de dinero con dinero
// ficticio, vamos a reducir el número de mesas... cuando haya ya muchos
// jugadores" se volverá a la versión con más mesas en paralelo. Por eso:
//   - ESCALONES_BUY_IN baja de 7 importes a solo 4 (5€, 10€, 25€, 50€).
//   - SALAS_POR_VARIANTE_AL_CREAR baja de 2 a 1 (una sola mesa por cada
//     combinación tipo+aforo+importe, no dos en paralelo).
// El diseño de PRODUCCIÓN (2 mesas por variante, 7 escalones incluyendo 20€/
// 30€/75€/100€) queda documentado tal cual en la arquitectura técnica del
// proyecto para cuando haya volumen real de usuarios — este archivo es el
// único que hay que tocar para volver a subir estos números en ese momento.
//
// Es el único archivo que hay que tocar para que un cambio en aforos,
// importes o tipos se propague a toda la app (la automatización de fútbol y
// el importador de golf/tenis leen de aquí).
// ============================================================================

import { TipoSala } from './repartoPremios';

// Escalones de importe de entrada. Reducidos el 25/09 (tercera vuelta) de
// [5, 10, 20, 30, 50, 75, 100] a solo 4 — pedido explícito de Iñi para esta
// fase de pruebas con dinero ficticio: "vamos a reducir el número de mesas...
// solamente vamos a poner mesas de 5 euros, de 10 euros, de 25 euros y de 50
// euros, nada más". Cada aforo de cada tipo de formato fijo se abre con
// TODOS estos importes.
export const ESCALONES_BUY_IN: number[] = [5, 10, 25, 50];

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
// genera 5 aforos × 7 importes = 35 variantes. El aforo sigue siendo un dato
// real de cada variante (columna propia en la base de datos y en el listado
// de /salas) aunque, desde el 25/09 (cuarta vuelta), ya no aparezca en el
// propio nombre — ver `label` más abajo.
export const VARIANTES_SALA: VarianteSala[] = AFOROS_POR_TIPO.flatMap(({ tipo, label, aforos }) =>
  aforos.flatMap((aforo) =>
    ESCALONES_BUY_IN.map((buyIn) => ({
      // Nombre de la variante (25/09, cuarta vuelta): ya no lleva el nº de
      // jugadores ("2 jugadores") — pedido de Iñi: "no incluyas tampoco el
      // número de jugadores [en el nombre de la mesa]". Distintos aforos del
      // mismo tipo+importe comparten ahora el mismo nombre (p. ej. "Doble o
      // Nada · 5€" para 2, 4, 6, 8 o 10 jugadores) — el aforo se sigue
      // viendo aparte, como su propia columna/dato en el listado y el
      // detalle de sala, así que no se pierde información, solo se saca del
      // nombre.
      tipo,
      label: `${label} · ${buyIn}€`,
      aforo,
      buyIn,
    }))
  )
);

// Cuántas salas de cada variante (tipo + aforo + importe) se crean
// automáticamente al abrir un torneo/jornada nuevo. Bajado de 2 a 1 el
// 25/09 (tercera vuelta) para la fase de pruebas con dinero ficticio — ver
// la nota de cabecera del archivo.
export const SALAS_POR_VARIANTE_AL_CREAR = 1;

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

  // Nombre de la mesa (25/09, tercera y cuarta vuelta): antes incluía la
  // competición y la jornada delante ("La Liga - Jornada 9 · Doble o Nada ·
  // 2 jugadores · 5€"), pedido de Iñi de simplificarlo — "el nombre de la
  // mesa solamente vamos a llamarla... el doble o nada y con la cantidad y 5
  // euros" (tercera vuelta), y luego "no incluyas tampoco el número de
  // jugadores" (cuarta vuelta). Ahora el nombre es solo tipo + importe
  // (variante.label, ver lib/tiposDeSala.ts arriba) — la competición/
  // jornada y el aforo no desaparecen, se siguen mostrando aparte (etiqueta
  // encima del nombre y su propia columna/dato, respectivamente).
  //
  // Excepción pendiente, pedida por Iñi (cuarta vuelta) para cuando exista:
  // "solo incluirás algo más [en el nombre] cuando en un torneo de golf, la
  // mesa sea de jornada o de torneo" — es decir, si en el futuro un mismo
  // torneo de golf llega a tener mesas para el torneo completo Y mesas por
  // jornada/ronda suelta a la vez, el nombre tendría que distinguir cuál es
  // cuál (p. ej. añadiendo "Jornada 2" o "Torneo completo"). Hoy esa
  // distinción no existe todavía en el modelo de datos: cada importación de
  // golf crea un único "torneo" (competicionLabel), sin separar rondas — así
  // que, de momento, esta función nunca necesita añadir nada más al nombre,
  // lo cual ya cumple la regla tal cual la dio Iñi. En cuanto exista la
  // función de "mesa de jornada" para golf, hay que retomar este comentario.
  const salas: SalaNueva[] = VARIANTES_SALA.flatMap((variante) =>
    Array.from({ length: SALAS_POR_VARIANTE_AL_CREAR }).map(
      (): SalaNueva => ({
        nombre: variante.label,
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
    nombre: MARATON_LABEL,
    deporte,
    competicion: competicionLabel,
    tipo: MARATON_TIPO,
    aforo: null,
    buy_in: MARATON_BUY_IN,
    fecha_limite_inscripcion: fechaLimiteIso,
  });

  return salas;
}
