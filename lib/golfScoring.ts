import type { GrupoPorra } from '@/lib/porraGrupos';

// ============================================================================
// PUNTUACIÓN DE LA PORRA CLÁSICA DE GOLF — golpes respecto al par, no puntos
// ============================================================================
// Corrección de Iñi (28/09): "para la puntuación de la porra no va a ir por
// puntos... aquí va a ser directamente el resultado de los jugadores...
// como se puntúa en golf, que los birdies puntúan menos uno, los bogeys más
// uno, eagles menos dos, dobles bogeys más dos, etc." — a diferencia de las
// Mesas Drafters (que sí usan el sistema de puntos propio de
// claude/Puntuaciones_Drafters_actualizado.md, con un valor distinto por
// acción), la porra clásica de golf puntúa con el criterio de golf de toda
// la vida: el resultado de cada jugador es directamente su recuento de
// golpes respecto al par (relación 1 a 1, sin tabla de puntos de por
// medio).
//
// Colores del hoyo a hoyo — pedido explícito de Iñi (28/09), ampliando los 4
// colores originales de la maqueta a 5, separando el bogey normal del doble
// bogey o peor: "cuando sea un birdie, un golpe por debajo del par... en
// rojo, si es un eagle en amarillo, si es un par lo dejas en gris, un bogey
// en negro y doble bogey o peor en azul". Se pintan como FONDO de una
// pastilla/círculo con el número de golpes dentro (no como color de texto
// sobre el fondo oscuro de la app — un texto literalmente negro sería
// invisible ahí) — mismo criterio que ya usa una tarjeta de resultados de
// golf en papel (círculo/cuadro de color alrededor del número), y cada
// color de fondo lleva emparejado el color de texto que mejor contrasta.

export type GolpesVsPar = number;

/** "E" (even, al par), "-3" (bajo par) o "+2" (sobre par) — formato estándar de golf. */
export function formatGolfScore(golpesVsPar: GolpesVsPar): string {
  if (golpesVsPar === 0) return 'E';
  return golpesVsPar > 0 ? `+${golpesVsPar}` : `${golpesVsPar}`;
}

export type TipoResultadoHoyo = 'eagle_o_mejor' | 'birdie' | 'par' | 'bogey' | 'doble_bogey_o_peor';

/** Clasifica un resultado de UN hoyo (golpes de ese hoyo menos su par) en uno de los 5 tipos. */
export function tipoResultadoHoyo(golpes: number, par: number): TipoResultadoHoyo {
  const vsPar = golpes - par;
  if (vsPar <= -2) return 'eagle_o_mejor';
  if (vsPar === -1) return 'birdie';
  if (vsPar === 0) return 'par';
  if (vsPar === 1) return 'bogey';
  return 'doble_bogey_o_peor';
}

export const ETIQUETA_TIPO_RESULTADO: Record<TipoResultadoHoyo, string> = {
  eagle_o_mejor: 'Eagle o mejor',
  birdie: 'Birdie',
  par: 'Par',
  bogey: 'Bogey',
  doble_bogey_o_peor: 'Doble bogey o peor',
};

/** Fondo de la pastilla + color de texto que mejor contrasta con ese fondo. */
export const COLOR_TIPO_RESULTADO: Record<TipoResultadoHoyo, { fondo: string; texto: string }> = {
  eagle_o_mejor: { fondo: '#F5D147', texto: '#241C02' }, // amarillo
  birdie: { fondo: '#FF5C5C', texto: '#2B0000' }, // rojo
  par: { fondo: '#AAB4AE', texto: '#0B0F0E' }, // gris
  bogey: { fondo: '#0B0F0E', texto: '#F5F7F5' }, // negro
  doble_bogey_o_peor: { fondo: '#3D7BFF', texto: '#F5F7F5' }, // azul
};

// Mantenido por compatibilidad con el total (no hoyo a hoyo) de un
// jugador/equipo — usa los mismos 5 colores, pero aplicado al RESULTADO
// TOTAL respecto al par en vez de a un hoyo suelto (aquí no hay un
// concepto de "bogey vs. doble bogey" tan marcado, así que un total
// positivo cualquiera se trata como el tramo "sobre par" más suave: bogey).
export function colorGolfScore(golpesVsPar: GolpesVsPar): { fondo: string; texto: string } {
  if (golpesVsPar <= -2) return COLOR_TIPO_RESULTADO.eagle_o_mejor;
  if (golpesVsPar === -1) return COLOR_TIPO_RESULTADO.birdie;
  if (golpesVsPar === 0) return COLOR_TIPO_RESULTADO.par;
  if (golpesVsPar <= 2) return COLOR_TIPO_RESULTADO.bogey;
  return COLOR_TIPO_RESULTADO.doble_bogey_o_peor;
}

// ============================================================================
// BONO DE PODIO (nuevo, 29/09; reglas de empate añadidas 01/10)
// ============================================================================
// Pedido de Iñi, para toda porra de golf ('clasica' o 'presupuesto'):
// "el primer jugador del torneo va a restar menos 10, el segundo menos 5 y
// el tercero menos 3". Corrección de Iñi (02/10): esto NO es una opción
// configurable por porra — es una regla fija que se aplica siempre, en
// todas las porras de golf (antes había un toggle por porra,
// porras.bono_podio_activo, ya retirado — ver drafters-schema.sql).
// Importante: esto es el 1º/2º/3er clasificado REAL DEL TORNEO, NO el
// 1º/2º/3er puesto de la porra — el bono se resta al resultado de
// CUALQUIER equipo de la porra que tenga a ese jugador en su plantilla
// (app/porras/[id]/clasificacion/page.tsx y, para la liquidación real,
// app/admin/pagos-pendientes/[tipo]/[id]/page.tsx).
const BONO_PODIO_POR_PUESTO: Record<number, number> = { 1: -10, 2: -5, 3: -3 };

// Reglas de empate (01/10, pedido explícito de Iñi, confirmado tras
// preguntarle directamente por la dirección): "en caso de empate de esos
// primero, segundo y tercero... el desempate... va a ser en función de...
// si hay un jugador azul y uno verde, siempre va a ser el azul el que gane
// al verde, y el verde va a ganar al amarillo... en caso de que haya grupo
// morado, también. Y en caso de que los dos empatados sean del mismo
// grupo... la resta de golpes se reparte entre los jugadores empatados."
//
// Es decir: para decidir quién ocupa el 1º/2º/3er puesto de verdad cuando
// dos o más jugadores empatan a golpes, NO se usa la posición "T1"/"T2" tal
// cual la da ESPN (eso dejaría posiciones compartidas) — se calcula el
// orden real a partir del resultado (resultado_en_vivo_total) y, en caso de
// empate exacto:
//   1. Si los empatados son de grupos de color distintos, gana el de PEOR
//      grupo (Morado > Azul > Verde > Amarillo) — se premia la sorpresa: el
//      que menos se esperaba llegar tan lejos se queda con la posición
//      mejor, y el resto cae a la siguiente posición libre.
//   2. Si los empatados son del mismo grupo de color, no hay más desempate
//      posible: el bono de la posición (o posiciones, si el empate ocupa
//      más de una) se reparte a partes iguales entre todos ellos — mismo
//      criterio que ya usa el reparto de premios en euros para los empates
//      (lib/repartoPremios.ts), aplicado aquí a golpes en vez de a euros.
// El grupo 'espanoles' (que mezcla jugadores de cualquier tramo de ranking,
// ver lib/porraGrupos.ts) no tiene un lugar claro en esta prioridad — Iñi
// no lo mencionó al explicar esta regla. Mientras no se aclare, un empate
// en el que participe un jugador 'espanoles' se trata como si fuera del
// mismo grupo que el resto de empatados (se reparte), en vez de inventar un
// orden de prioridad que nadie ha pedido.
const PRIORIDAD_DESEMPATE_PODIO: Record<GrupoPorra, number> = {
  morado: 4,
  azul: 3,
  verde: 2,
  amarillo: 1,
  espanoles: 0,
};

export type JugadorParaBonoPodio = {
  id: string;
  resultado_en_vivo_total: number | null;
  resultado_en_vivo_posicion: string | null;
  grupo_porra: GrupoPorra | null;
};

/** true si la posición de ESPN es un puesto numérico real ("1", "T4"...) — false para "CUT"/"WD"/null/sin dato. */
function posicionEnJuego(posicion: string | null): boolean {
  if (!posicion) return false;
  const soloNumero = posicion.trim().replace(/^T/i, '');
  return Number.isFinite(parseInt(soloNumero, 10));
}

/**
 * Calcula el bono de podio de CADA jugador del campo de un torneo (no solo
 * los de una porra concreta — el campo completo, para poder resolver bien
 * los empates), aplicando las reglas de desempate de más arriba. Devuelve
 * un Map jugador_id -> bono; un jugador sin bono (fuera del podio, CUT,
 * WD, sin resultado...) simplemente no aparece en el mapa. El bono puede
 * salir con decimales cuando hay reparto entre empatados del mismo grupo
 * (redondeado a 1 decimal, por limpieza).
 */
export function calcularBonosPodio(campo: JugadorParaBonoPodio[]): Map<string, number> {
  const bonos = new Map<string, number>();

  // Solo entran en juego los que siguen vivos en el torneo (posición
  // numérica real) — de esos, el orden real lo da el resultado en vivo, no
  // la posición de ESPN (que es solo para filtrar quién sigue en pie).
  const enJuego = campo
    .filter((j) => j.resultado_en_vivo_total !== null && posicionEnJuego(j.resultado_en_vivo_posicion))
    .sort((a, b) => (a.resultado_en_vivo_total as number) - (b.resultado_en_vivo_total as number));

  let puesto = 1;
  let i = 0;
  while (i < enJuego.length && puesto <= 3) {
    // Bloque de jugadores empatados exactamente al mismo resultado.
    let fin = i + 1;
    while (fin < enJuego.length && enJuego[fin].resultado_en_vivo_total === enJuego[i].resultado_en_vivo_total) fin++;
    const bloque = enJuego.slice(i, fin);

    if (bloque.length === 1) {
      const bono = BONO_PODIO_POR_PUESTO[puesto] ?? 0;
      if (bono !== 0) bonos.set(bloque[0].id, bono);
      puesto += 1;
    } else {
      // Empate real: se agrupa por prioridad de desempate (peor grupo
      // primero) y se recorren los subgrupos en ese orden, consumiendo
      // tantos puestos como jugadores tenga cada subgrupo.
      const porPrioridad = new Map<number, JugadorParaBonoPodio[]>();
      bloque.forEach((j) => {
        const prioridad = j.grupo_porra ? PRIORIDAD_DESEMPATE_PODIO[j.grupo_porra] : 0;
        const lista = porPrioridad.get(prioridad) ?? [];
        lista.push(j);
        porPrioridad.set(prioridad, lista);
      });
      const prioridadesDeMayorAMenor = Array.from(porPrioridad.keys()).sort((a, b) => b - a);

      for (const prioridad of prioridadesDeMayorAMenor) {
        if (puesto > 3) break;
        const subgrupo = porPrioridad.get(prioridad) as JugadorParaBonoPodio[];
        const puestosQueOcupa = subgrupo.length;
        const sumaBonos = Array.from({ length: puestosQueOcupa }, (_, k) => BONO_PODIO_POR_PUESTO[puesto + k] ?? 0).reduce((a, b) => a + b, 0);
        const bonoRepartido = Math.round((sumaBonos / puestosQueOcupa) * 10) / 10;
        if (bonoRepartido !== 0) subgrupo.forEach((j) => bonos.set(j.id, bonoRepartido));
        puesto += puestosQueOcupa;
      }
    }

    i = fin;
  }

  return bonos;
}
