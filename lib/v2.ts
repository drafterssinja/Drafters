// ============================================================================
// DRAFTERS V2 — AMISTOSOS (15/10)
// ============================================================================
// Tipos y cálculos compartidos de las salas que crean los propios usuarios
// (ver 33_sql_drafters_v2_amistosos_15-10.sql). Las reglas de verdad (turnos
// del draft, alineaciones, presupuesto, premio) están en el servidor; aquí se
// repiten solo para pintar la pantalla.

export type Modalidad = 'presupuesto' | 'libre' | 'draft';

export const MODALIDAD_LABEL: Record<Modalidad, string> = {
  presupuesto: 'Con presupuesto',
  libre: 'Libre',
  draft: 'Draft',
};

export const MODALIDAD_DESC: Record<Modalidad, string> = {
  presupuesto: 'Cada uno hace su equipo con 100.000 € de presupuesto, como en las mesas de siempre.',
  libre: 'Sin presupuesto ni precios: cada uno elige a quien quiera. Se pueden repetir jugadores entre equipos.',
  draft: 'Por turnos, como en la NBA: sorteo del orden y cada uno elige un jugador. Nadie puede repetir jugador.',
};

export type Premio = {
  tipo: 'dinero' | 'otro' | 'nada';
  aportacion: number | null; // dinero: € que pone cada uno
  descripcion: string; // otro: "un cubata", "una cena"...
  ganadores: number;
  reparto: number[]; // porcentajes del bote para 1º, 2º... (suman 100)
};

export type Amistoso = {
  id: string;
  creador_id: string;
  nombre: string;
  deporte: 'futbol' | 'golf' | 'tenis';
  modalidad: Modalidad;
  num_jugadores: number;
  privada: boolean;
  codigo: string;
  estado: 'abierto' | 'completo' | 'finalizado';
  premio: Premio | null;
  created_at: string;
};

export type AmistosoJornada = {
  id: string;
  amistoso_id: string;
  competicion: string;
  orden: number;
  equipos_permitidos: string[] | null;
  partidos: { local: string; visitante: string }[] | null;
  cierre: string | null;
};

export type Resumen = {
  participantes: { usuario_id: string; nombre: string; unido_en: string }[];
  nombres: Record<string, string>;
  equipos_hechos: { competicion: string; usuario_id: string }[];
  jornadas: { competicion: string; empezada: boolean; terminada: boolean }[];
};

export type Mensaje = {
  id: number;
  amistoso_id: string;
  usuario_id: string | null;
  tipo: 'texto' | 'propuesta' | 'sistema';
  texto: string;
  datos: Premio | null;
  estado: 'pendiente' | 'aceptada' | 'rechazada' | null;
  created_at: string;
};

export const TAMANO_EQUIPO_V2: Record<string, number> = { futbol: 11, golf: 5, tenis: 5 };

// ---------------------------------------------------------------------------
// Draft: turno de cada elección. En cada ronda el orden rota una posición: el
// que eligió primero pasa al último y los demás suben un puesto (Iñi, 15/10).
// Mismo cálculo que amistoso_draft_turno() en el servidor.
// ---------------------------------------------------------------------------
export function turnoDraft(orden: string[], numero: number): string {
  const n = orden.length;
  return orden[((numero % n) + Math.floor(numero / n)) % n];
}

export function ordenDeRonda(orden: string[], ronda: number): string[] {
  const n = orden.length;
  return orden.map((_, i) => orden[(i + ronda) % n]);
}

// ---------------------------------------------------------------------------
// Fútbol: las 5 alineaciones válidas (lib/draftConfig.ts).
// ---------------------------------------------------------------------------
export type Conteo = { POR: number; DEF: number; MED: number; DEL: number };
const FORMACIONES: { nombre: string; DEF: number; MED: number; DEL: number }[] = [
  { nombre: '4-3-3', DEF: 4, MED: 3, DEL: 3 },
  { nombre: '4-4-2', DEF: 4, MED: 4, DEL: 2 },
  { nombre: '4-5-1', DEF: 4, MED: 5, DEL: 1 },
  { nombre: '5-4-1', DEF: 5, MED: 4, DEL: 1 },
  { nombre: '3-4-3', DEF: 3, MED: 4, DEL: 3 },
];

export function alineacionPosible(c: Conteo, completo: boolean): string | null {
  for (const f of FORMACIONES) {
    if (c.POR > 1 || c.DEF > f.DEF || c.MED > f.MED || c.DEL > f.DEL) continue;
    if (completo && !(c.POR === 1 && c.DEF === f.DEF && c.MED === f.MED && c.DEL === f.DEL)) continue;
    return f.nombre;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Premio y reparto (con empates: los empatados se reparten a partes iguales
// lo que suman los puestos que ocupan).
// ---------------------------------------------------------------------------
export function repartoPorDefecto(ganadores: number): number[] {
  if (ganadores <= 1) return [100];
  if (ganadores === 2) return [70, 30];
  if (ganadores === 3) return [60, 30, 10];
  if (ganadores === 4) return [50, 25, 15, 10];
  const base = Math.floor(100 / ganadores);
  const r = Array(ganadores).fill(base);
  r[0] += 100 - base * ganadores;
  return r;
}

export function textoBote(premio: Premio | null, participantes: number): string | null {
  if (!premio || premio.tipo === 'nada') return null;
  if (premio.tipo === 'dinero') {
    const bote = (premio.aportacion ?? 0) * participantes;
    return `Cada uno pone ${formatoEuros(premio.aportacion ?? 0)} · bote de ${formatoEuros(bote)}`;
  }
  return `Cada uno pone ${premio.descripcion || 'algo'} · en juego: ${participantes} × ${premio.descripcion || 'algo'}`;
}

export function textoPuesto(premio: Premio, i: number, participantes: number): string {
  const pct = premio.reparto[i] ?? 0;
  if (premio.tipo === 'dinero') return `${formatoEuros(((premio.aportacion ?? 0) * participantes * pct) / 100)} (${pct} %)`;
  const unidades = Math.round(((participantes * pct) / 100) * 10) / 10;
  return `${String(unidades).replace('.', ',')} × ${premio.descripcion || 'premio'} (${pct} %)`;
}

export function formatoEuros(n: number): string {
  return `${n.toLocaleString('es-ES', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })} €`;
}

export type FilaPremio = { usuarioId: string; total: number; puesto: string; premioTexto: string | null };

// filas ordenadas de más a menos puntos.
export function repartirPremio(filas: { usuarioId: string; total: number }[], premio: Premio | null): FilaPremio[] {
  const res: FilaPremio[] = [];
  const participantes = filas.length;
  let i = 0;
  while (i < filas.length) {
    let j = i;
    while (j + 1 < filas.length && filas[j + 1].total === filas[i].total) j++;
    const empatados = j - i + 1;
    const puesto = `${empatados > 1 ? 'T' : ''}${i + 1}º`;
    let pctGrupo = 0;
    if (premio && premio.tipo !== 'nada') for (let k = i; k <= j; k++) pctGrupo += premio.reparto[k] ?? 0;
    const pctCada = pctGrupo / empatados;
    for (let k = i; k <= j; k++) {
      let premioTexto: string | null = null;
      if (premio && premio.tipo !== 'nada' && pctCada > 0) {
        if (premio.tipo === 'dinero') premioTexto = formatoEuros(Math.round(((premio.aportacion ?? 0) * participantes * pctCada) / 100 * 100) / 100);
        else premioTexto = `${String(Math.round(((participantes * pctCada) / 100) * 10) / 10).replace('.', ',')} × ${premio.descripcion || 'premio'}`;
      }
      res.push({ usuarioId: filas[k].usuarioId, total: filas[k].total, puesto, premioTexto });
    }
    i = j + 1;
  }
  return res;
}

export function premioValido(p: Premio): string | null {
  if (p.tipo === 'nada') return null;
  if (p.tipo === 'dinero' && (!p.aportacion || p.aportacion <= 0)) return 'Indica cuánto pone cada uno.';
  if (p.tipo === 'otro' && !p.descripcion.trim()) return 'Indica qué pone cada uno (un cubata, una cena...).';
  if (p.ganadores < 1) return 'Tiene que haber al menos un ganador.';
  if (p.reparto.length !== p.ganadores) return 'El reparto no cuadra con el número de ganadores.';
  const suma = p.reparto.reduce((a, b) => a + b, 0);
  if (Math.abs(suma - 100) > 0.01) return `El reparto tiene que sumar 100 % (ahora suma ${suma} %).`;
  return null;
}

export function resumenPremio(p: Premio | null): string {
  if (!p || p.tipo === 'nada') return 'Solo por la gloria';
  const que = p.tipo === 'dinero' ? `${formatoEuros(p.aportacion ?? 0)} cada uno` : `${p.descripcion} cada uno`;
  const rep = p.ganadores === 1 ? 'el ganador se lo lleva todo' : `${p.ganadores} ganadores (${p.reparto.map((x) => `${x} %`).join(' / ')})`;
  return `${que} · ${rep}`;
}

export function fechaCorta(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Polling con la pantalla a la vista (mismo patrón que el resto de la web).
export function cadaXSegundos(fn: () => void, segundos: number): () => void {
  const id = setInterval(() => {
    if (document.visibilityState === 'visible') fn();
  }, segundos * 1000);
  const alVolver = () => {
    if (document.visibilityState === 'visible') fn();
  };
  document.addEventListener('visibilitychange', alVolver);
  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', alVolver);
  };
}

export function mensajeError(e: { message?: string } | null | undefined): string {
  return (e?.message ?? 'Algo ha fallado.').replace(/^ERROR:\s*/i, '');
}
