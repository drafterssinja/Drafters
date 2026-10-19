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
  libre: 'Sin presupuesto ni precios: cada uno elige a quien quiera, con un máximo de 2 jugadores de cada equipo. Se pueden repetir jugadores entre equipos.',
  draft: 'Por turnos, como en la NBA: sorteo del orden y cada uno elige un jugador. Nadie puede repetir jugador.',
};

export type Premio = {
  tipo: 'dinero' | 'otro' | 'nada';
  aportacion: number | null; // dinero: € que pone cada uno
  descripcion: string; // otro: "una cena", "un cubata"...
  ganadores: number; // dinero: cuántos cobran
  reparto: number[]; // dinero: porcentajes del bote para 1º, 2º... (suman 100)
  // 16/10 (Iñi): con "otra cosa" no hay porcentajes: se dice qué es y cuántos
  // lo pagan (los últimos de la clasificación). Ej.: "los 2 últimos pagan la cena".
  pagan?: number;
  // 15/10 (Iñi): y opcionalmente cuántos ganan (los primeros). Entre medias,
  // "tierra de nadie": ni ganan ni pagan.
  ganan?: number;
  // 16/10 (Iñi): dinero "ganan / pierden". Los `ganan` primeros cobran y los
  // `pagan` últimos pagan; entre medias, ni cobran ni pagan. cobros[i] = € que
  // cobra el puesto i+1; pagos[k] = € que paga el k-ésimo de los que pierden
  // (de mejor a peor: el último es pagos[pagan-1]). Lo que se cobra = lo que se
  // paga. Por defecto, reparto a partes iguales (aportacion = lo que paga cada
  // uno de los que pierden). Las salas antiguas (sin cobros/pagos) siguen con
  // el modelo de bote y porcentajes.
  cobros?: number[];
  pagos?: number[];
};

export type GrupoOtro = 'gana' | 'nada' | 'paga';

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
  // 16/10: true = el mismo equipo para todas las jornadas de la sala.
  equipo_fijo?: boolean;
};

export type AmistosoJornada = {
  id: string;
  amistoso_id: string;
  competicion: string;
  orden: number;
  equipos_permitidos: string[] | null;
  partidos: { local: string; visitante: string }[] | null;
  cierre: string | null;
  // 17/10: un solo día (fútbol) o una sola ronda (golf). Ver lib/tramos.ts.
  tramo?: string | null;
};

export type Resumen = {
  participantes: { usuario_id: string; nombre: string; unido_en: string }[];
  nombres: Record<string, string>;
  equipos_hechos: { competicion: string; usuario_id: string }[];
  jornadas: { competicion: string; publicada?: boolean; empezada: boolean; terminada: boolean; tramo?: string | null }[];
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

// ---------------------------------------------------------------------------
// Dinero "ganan / pierden" (16/10)
// ---------------------------------------------------------------------------
export function esDineroGP(p: Premio | null | undefined): p is Premio & { cobros: number[]; pagos: number[] } {
  return !!p && p.tipo === 'dinero' && Array.isArray(p.cobros) && Array.isArray(p.pagos);
}

const centimos = (x: number) => Math.round(x * 100) / 100;

// Reparto a partes iguales: cada uno de los que pierden paga `cadaUno` y el
// total se reparte igual entre los que ganan (los céntimos que sobren, a los primeros).
export function repartoEquitativoGP(ganan: number, pagan: number, cadaUno: number): { cobros: number[]; pagos: number[] } {
  const g = Math.max(1, ganan);
  const pg = Math.max(1, pagan);
  const pagos = Array(pg).fill(centimos(cadaUno));
  const totalCent = Math.round(cadaUno * 100) * pg;
  const base = Math.floor(totalCent / g);
  const resto = totalCent - base * g;
  const cobros = Array.from({ length: g }, (_, i) => (base + (i < resto ? 1 : 0)) / 100);
  return { cobros, pagos };
}

export function esRepartoEquitativoGP(p: Premio): boolean {
  if (!esDineroGP(p)) return true;
  const eq = repartoEquitativoGP(p.cobros.length, p.pagos.length, p.aportacion ?? 0);
  return eq.cobros.every((c, i) => Math.abs(c - (p.cobros[i] ?? 0)) < 0.005) && eq.pagos.every((c, i) => Math.abs(c - (p.pagos[i] ?? 0)) < 0.005);
}

// € netos de cada puesto (positivo = cobra, negativo = paga).
export function netoPorPuesto(p: Premio, participantes: number): number[] {
  const n = Math.max(2, participantes);
  if (esDineroGP(p)) {
    const ganan = p.cobros.length;
    const pagan = p.pagos.length;
    return Array.from({ length: n }, (_, i) => (i < ganan ? p.cobros[i] ?? 0 : 0) - (i >= n - pagan ? p.pagos[i - (n - pagan)] ?? 0 : 0));
  }
  if (p.tipo === 'dinero') return Array.from({ length: n }, (_, i) => ((p.aportacion ?? 0) * n * (p.reparto[i] ?? 0)) / 100);
  return Array(n).fill(0);
}

export function textoDineroGP(p: Premio): string {
  if (!esDineroGP(p)) return '';
  const ganan = p.cobros.length;
  const pagan = p.pagos.length;
  const total = centimos(p.pagos.reduce((a, b) => a + b, 0));
  const pierden = pagan === 1 ? `El último paga ${formatoEuros(total)}` : esRepartoEquitativoGP(p) ? `Los ${pagan} últimos pagan ${formatoEuros(p.aportacion ?? 0)} cada uno` : `Los ${pagan} últimos pagan ${formatoEuros(total)} en total`;
  const cobran = ganan === 1 ? `el 1º se lo lleva todo` : `los ${ganan} primeros se reparten ${formatoEuros(total)}`;
  return `${pierden} · ${cobran}`;
}

export function textoBote(premio: Premio | null, participantes: number): string | null {
  if (!premio || premio.tipo === 'nada') return null;
  if (esDineroGP(premio)) return textoDineroGP(premio);
  if (premio.tipo === 'dinero') {
    const bote = (premio.aportacion ?? 0) * participantes;
    return `Cada uno pone ${formatoEuros(premio.aportacion ?? 0)} · bote de ${formatoEuros(bote)}`;
  }
  return textoPagan(premio);
}

// "Otra cosa": quién gana, quién se queda en tierra de nadie y quién paga.
export function textoPagan(premio: Premio, participantes?: number): string {
  const pagan = Math.max(1, premio.pagan ?? 1);
  const ganan = Math.max(0, premio.ganan ?? 0);
  const que = premio.descripcion || 'lo que os jugáis';
  const partes = [`${que}: ${pagan === 1 ? 'paga el último' : `pagan los ${pagan} últimos`}`];
  if (ganan > 0) partes.push(ganan === 1 ? 'gana el 1º' : `ganan los ${ganan} primeros`);
  if (participantes && ganan > 0) {
    const desde = ganan + 1;
    const hasta = participantes - pagan;
    if (hasta >= desde) partes.push(desde === hasta ? `el ${desde}º ni gana ni paga` : `del ${desde}º al ${hasta}º ni ganan ni pagan`);
  }
  return partes.join(' · ');
}

export function textoPuesto(premio: Premio, i: number, participantes: number): string {
  const pct = premio.reparto[i] ?? 0;
  return `${formatoEuros(((premio.aportacion ?? 0) * participantes * pct) / 100)} (${pct} %)`;
}

export function formatoEuros(n: number): string {
  return `${n.toLocaleString('es-ES', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })} €`;
}

export type FilaPremio = { usuarioId: string; total: number; puesto: string; premioTexto: string | null; paga: string | null; grupo: GrupoOtro | null };

// filas ordenadas de más a menos puntos. Dinero: los empatados se reparten a
// partes iguales lo de sus puestos. Otra cosa: pagan los N últimos; si hay
// empate justo en el corte, pagan todos los empatados (a escote).
export function repartirPremio(filas: { usuarioId: string; total: number }[], premio: Premio | null): FilaPremio[] {
  const res: FilaPremio[] = [];
  const participantes = filas.length;
  const pagan = premio?.tipo === 'otro' ? Math.min(Math.max(1, premio.pagan ?? 1), Math.max(participantes - 1, 1)) : 0;
  const ganan = premio?.tipo === 'otro' ? Math.min(Math.max(0, premio.ganan ?? 0), participantes - pagan) : 0;
  const corte = participantes - pagan; // índice desde el que se paga
  // Empate en el corte de los ganadores: ganan todos los empatados.
  let i = 0;
  while (i < filas.length) {
    let j = i;
    while (j + 1 < filas.length && filas[j + 1].total === filas[i].total) j++;
    const empatados = j - i + 1;
    const puesto = `${empatados > 1 ? 'T' : ''}${i + 1}º`;
    // Dinero "ganan / pierden": los empatados se reparten (o pagan) a partes
    // iguales lo de los puestos que ocupan.
    if (premio && esDineroGP(premio)) {
      const neto = netoPorPuesto(premio, participantes);
      let suma = 0;
      for (let k = i; k <= j; k++) suma += neto[k] ?? 0;
      const cada = Math.round((suma / empatados) * 100) / 100;
      for (let k = i; k <= j; k++) {
        res.push({ usuarioId: filas[k].usuarioId, total: filas[k].total, puesto, premioTexto: cada > 0 ? formatoEuros(cada) : null, paga: cada < 0 ? formatoEuros(-cada) : null, grupo: cada < 0 ? 'paga' : cada > 0 ? null : 'nada' });
      }
      i = j + 1;
      continue;
    }
    let pctGrupo = 0;
    if (premio?.tipo === 'dinero') for (let k = i; k <= j; k++) pctGrupo += premio.reparto[k] ?? 0;
    const pctCada = pctGrupo / empatados;
    const pagaGrupo = pagan > 0 && participantes > 1 && j >= corte;
    const ganaGrupo = !pagaGrupo && ganan > 0 && i < ganan;
    const grupo: GrupoOtro | null = premio?.tipo === 'otro' ? (pagaGrupo ? 'paga' : ganaGrupo ? 'gana' : 'nada') : null;
    for (let k = i; k <= j; k++) {
      let premioTexto: string | null = null;
      if (premio?.tipo === 'dinero' && pctCada > 0) premioTexto = formatoEuros(Math.round((((premio.aportacion ?? 0) * participantes * pctCada) / 100) * 100) / 100);
      res.push({ usuarioId: filas[k].usuarioId, total: filas[k].total, puesto, premioTexto, paga: pagaGrupo && premio ? premio.descripcion || 'lo que os jugáis' : null, grupo });
    }
    i = j + 1;
  }
  return res;
}

export function premioValido(p: Premio, participantes?: number): string | null {
  if (p.tipo === 'nada') return null;
  if (p.tipo === 'otro') {
    if (!p.descripcion.trim()) return 'Indica qué os jugáis (una cena, un cubata...).';
    if (!p.pagan || p.pagan < 1) return 'Indica cuántos pagan.';
    if (participantes && (p.pagan ?? 1) + (p.ganan ?? 0) > participantes) return 'Entre los que ganan y los que pagan no puede haber más gente que en la sala.';
    return null;
  }
  if (esDineroGP(p)) {
    const ganan = p.cobros.length;
    const pagan = p.pagos.length;
    if (ganan < 1) return 'Tiene que ganar al menos uno.';
    if (pagan < 1) return 'Tiene que perder al menos uno.';
    if (participantes && ganan + pagan > participantes) return `Entre los que ganan (${ganan}) y los que pierden (${pagan}) no puede haber más gente que en la sala (${participantes}).`;
    if ([...p.cobros, ...p.pagos].some((x) => !(x >= 0))) return 'Las cantidades no pueden ser negativas.';
    const cobran = centimos(p.cobros.reduce((a, b) => a + b, 0));
    const pagan$ = centimos(p.pagos.reduce((a, b) => a + b, 0));
    if (pagan$ <= 0) return 'Indica cuánto pagan los que pierden.';
    if (Math.abs(cobran - pagan$) > 0.009) return `No cuadra: los que ganan cobrarían ${formatoEuros(cobran)} y los que pierden pagarían ${formatoEuros(pagan$)}. Tiene que ser lo mismo.`;
    return null;
  }
  if (!p.aportacion || p.aportacion <= 0) return 'Indica cuánto pone cada uno.';
  if (p.ganadores < 1) return 'Tiene que haber al menos un ganador.';
  if (p.reparto.length !== p.ganadores) return 'El reparto no cuadra con el número de ganadores.';
  const suma = p.reparto.reduce((a, b) => a + b, 0);
  if (Math.abs(suma - 100) > 0.01) return `El reparto tiene que sumar 100 % (ahora suma ${suma} %).`;
  return null;
}

export function resumenPremio(p: Premio | null): string {
  if (!p || p.tipo === 'nada') return 'Solo por la gloria';
  if (p.tipo === 'otro') return textoPagan(p);
  if (esDineroGP(p)) return textoDineroGP(p);
  const rep = p.ganadores === 1 ? 'el ganador se lo lleva todo' : `${p.ganadores} ganadores (${p.reparto.map((x) => `${x} %`).join(' / ')})`;
  return `${formatoEuros(p.aportacion ?? 0)} cada uno · ${rep}`;
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

// ---------------------------------------------------------------------------
// 16/10 (Iñi): el admin puede cambiar la modalidad de un amistoso. Al que se le
// quita el equipo le sale un aviso y puede guardarlo para otra sala.
// ---------------------------------------------------------------------------
export type EquipoAviso = { competicion: string; jugadores: string[]; alineacion: string | null; gasto: number };

export type AvisoModalidad = {
  id: number;
  amistoso_id: string;
  modalidad_antes: Modalidad | null;
  modalidad_nueva: Modalidad | null;
  equipo_borrado: boolean;
  equipos: EquipoAviso[] | null;
  created_at: string;
  amistosos: { nombre: string; deporte: 'futbol' | 'golf' | 'tenis'; modalidad: Modalidad } | null;
};

export type EquipoGuardado = { id: string; deporte: string; competicion: string; nombre: string; jugadores: string[]; alineacion: string | null; created_at: string };

// Qué pasa con los equipos ya hechos al pasar de una modalidad a otra.
export function efectoCambioModalidad(antes: Modalidad, despues: Modalidad, deporte?: string): 'todos' | 'caros' | 'mas_de_2' | 'ninguno' {
  if (antes === despues) return 'ninguno';
  if (despues === 'draft') return 'todos';
  if (antes === 'libre' && despues === 'presupuesto') return 'caros';
  // 19/10: en el modo libre de fútbol, máximo 2 jugadores de cada equipo (SQL 57).
  if (despues === 'libre' && deporte === 'futbol') return 'mas_de_2';
  return 'ninguno';
}
