// ============================================================================
// SUGERENCIAS DE EMPAREJAMIENTO DE JUGADORES (07/10, pedido de Iñi)
// ============================================================================
// "Hay que buscar una forma de enlazar los jugadores que no empareja... haz tú
// un primer estimado en base a nombres que se parezcan y sean del mismo equipo
// y déjamelos listados para ir confirmándolos uno a uno."
//
// Dado el jugador de ESPN sin pareja y la lista de NUESTROS jugadores sin
// pareja, propone para cada uno el jugador nuestro del MISMO equipo cuyo nombre
// más se le parezca (apellido igual, inicial + apellido, una letra de
// diferencia, nombre contenido en el otro, apodo...). Es solo una propuesta: no
// se guarda nada hasta que Iñi confirma (entonces se guarda un alias en
// alias_nombres_jugador, que vale para todas las jornadas futuras).
//
// Función pura (sin red ni base de datos): se usa en el navegador.

import { normalizarNombre } from './nombreMatch';
import { claveEquipoFutbol } from './futbolLaLiga';

export type JugadorEspnSinPareja = { nombre: string; equipo: string | null };
export type FichaSinPareja = { id: string; nombre: string; equipo: string | null };

export type Candidato = { fichaId: string; fichaNombre: string; puntuacion: number };

export type SugerenciaAlias = {
  espn: string;
  equipo: string | null;
  mejor: Candidato;
  /** Otros jugadores nuestros del mismo equipo, por si la mejor propuesta no es. */
  alternativas: Candidato[];
  /** 'alta' ≥ 0,85 · 'media' ≥ 0,7 · 'baja' el resto */
  confianza: 'alta' | 'media' | 'baja';
};

function distancia(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previa = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    for (let j = 1; j <= b.length; j++) {
      actual[j] = Math.min(previa[j] + 1, actual[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previa = actual;
  }
  return previa[b.length];
}

function similitud(a: string, b: string): number {
  const m = Math.max(a.length, b.length);
  return m === 0 ? 0 : 1 - distancia(a, b) / m;
}

// Palabras de enlace que no ayudan a identificar a nadie.
const RELLENO = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'da', 'do', 'dos', 'das', 'van', 'von', 'der', 'den', 'di', 'le', 'jr', 'junior']);

function palabras(n: string): string[] {
  return n.split(' ').filter((t) => t && !RELLENO.has(t));
}

function nombresDeFicha(nombre: string): string[] {
  const apodo = /\(([^)]+)\)\s*$/.exec(nombre)?.[1];
  const principal = nombre.replace(/\([^)]*\)\s*$/, '');
  return [normalizarNombre(principal), apodo ? normalizarNombre(apodo) : ''].filter(Boolean);
}

/** Parecido entre dos nombres ya normalizados, de 0 a 1. */
function puntuarPar(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = palabras(a);
  const tb = palabras(b);
  if (ta.length === 0 || tb.length === 0) return similitud(a, b) * 0.8;

  let mejor = similitud(a, b) * 0.9;

  // Todas las palabras del nombre corto están (casi) en el largo: "Take Kubo" ⊂ "Takefusa Kubo".
  const [corto, largo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const casan = corto.map((t) =>
    largo.some((u) => {
      if (t === u) return true;
      if (t.length >= 3 && u.startsWith(t)) return true; // "Take" → "Takefusa"
      if (u.length >= 3 && t.startsWith(u)) return true;
      if (t.length === 1 && u.startsWith(t)) return true; // inicial: "J." → "Julian"
      if (t.length >= 5 && u.length >= 5 && distancia(t, u) <= (t.length >= 8 ? 2 : 1)) return true; // errata
      return false;
    })
  );
  const algunaPalabraLarga = corto.some((t) => t.length >= 3);
  if (casan.every(Boolean) && algunaPalabraLarga) {
    // Más puntos cuanto más largo es lo que casa (un apellido de verdad frente a una inicial).
    const peso = Math.min(1, corto.filter((t) => t.length >= 3).length / 2 + 0.5);
    mejor = Math.max(mejor, 0.72 + 0.2 * peso);
  }

  // Mismo apellido (última palabra larga) y nombre/inicial compatible o distinto: "Kubo" / "Takefusa Kubo".
  const apA = ta[ta.length - 1];
  const apB = tb[tb.length - 1];
  if (apA.length >= 4 && apB.length >= 4) {
    const s = similitud(apA, apB);
    if (s >= 0.99) {
      const pa = ta.slice(0, -1);
      const pb = tb.slice(0, -1);
      const nombreCompatible = pa.length === 0 || pb.length === 0 || pa.some((x) => pb.some((y) => y[0] === x[0]));
      mejor = Math.max(mejor, nombreCompatible ? 0.85 : 0.62);
    } else if (s >= 0.8) {
      mejor = Math.max(mejor, 0.6 + 0.2 * s);
    }
  }

  // Algún apellido/palabra larga en común (segundo apellido, apodo...).
  const comunes = ta.filter((t) => t.length >= 4 && tb.includes(t));
  if (comunes.length > 0) mejor = Math.max(mejor, 0.66 + Math.min(0.1, comunes.length * 0.05));

  return Math.min(1, mejor);
}

function puntuarFicha(espn: string, ficha: FichaSinPareja): number {
  const e = normalizarNombre(espn);
  return Math.max(0, ...nombresDeFicha(ficha.nombre).map((n) => puntuarPar(e, n)));
}

const MINIMO = 0.6;

/**
 * Propone una pareja de nuestra ficha para cada jugador de ESPN sin emparejar.
 * Solo se miran jugadores nuestros del MISMO equipo, y un jugador nuestro no
 * se propone a dos de ESPN a la vez (gana la propuesta más fuerte).
 */
export function sugerirParejas(espn: JugadorEspnSinPareja[], fichas: FichaSinPareja[]): { sugerencias: SugerenciaAlias[]; sinCandidato: JugadorEspnSinPareja[] } {
  const porEquipo = new Map<string, FichaSinPareja[]>();
  for (const f of fichas) {
    const k = claveEquipoFutbol(f.equipo);
    if (!k) continue;
    const l = porEquipo.get(k) ?? [];
    l.push(f);
    porEquipo.set(k, l);
  }

  type Fila = { e: JugadorEspnSinPareja; puntuados: Candidato[] };
  const filas: Fila[] = [];
  const sinCandidato: JugadorEspnSinPareja[] = [];
  const vistos = new Set<string>();
  for (const e of espn) {
    const dedupe = `${normalizarNombre(e.nombre)}|${claveEquipoFutbol(e.equipo)}`;
    if (vistos.has(dedupe)) continue;
    vistos.add(dedupe);
    const candidatas = porEquipo.get(claveEquipoFutbol(e.equipo)) ?? [];
    const puntuados = candidatas
      .map((f) => ({ fichaId: f.id, fichaNombre: f.nombre, puntuacion: puntuarFicha(e.nombre, f) }))
      .filter((c) => c.puntuacion >= MINIMO)
      .sort((a, b) => b.puntuacion - a.puntuacion);
    if (puntuados.length === 0) sinCandidato.push(e);
    else filas.push({ e, puntuados });
  }

  // Reparto codicioso: primero las propuestas más seguras.
  const todas = filas.flatMap((f, i) => f.puntuados.map((c) => ({ i, c }))).sort((a, b) => b.c.puntuacion - a.c.puntuacion);
  const asignadaA = new Map<number, Candidato>();
  const fichaUsada = new Set<string>();
  for (const { i, c } of todas) {
    if (asignadaA.has(i) || fichaUsada.has(c.fichaId)) continue;
    asignadaA.set(i, c);
    fichaUsada.add(c.fichaId);
  }

  const sugerencias: SugerenciaAlias[] = [];
  filas.forEach((f, i) => {
    const mejor = asignadaA.get(i);
    if (!mejor) {
      sinCandidato.push(f.e); // todos sus candidatos se los llevó otro de ESPN con más parecido
      return;
    }
    sugerencias.push({
      espn: f.e.nombre,
      equipo: f.e.equipo,
      mejor,
      alternativas: f.puntuados.filter((c) => c.fichaId !== mejor.fichaId).slice(0, 4),
      confianza: mejor.puntuacion >= 0.85 ? 'alta' : mejor.puntuacion >= 0.7 ? 'media' : 'baja',
    });
  });
  sugerencias.sort((a, b) => b.mejor.puntuacion - a.mejor.puntuacion);
  return { sugerencias, sinCandidato };
}
