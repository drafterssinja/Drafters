import { supabase } from './supabaseClient';
import { normalizarNombre } from './nombreMatch';

// ============================================================================
// PAR COMPLETO DE UN CAMPO, DESDE LA BIBLIOTECA REUTILIZABLE (nuevo, 03/10)
// ============================================================================
// Pedido de Iñi: que la tabla de hoyo a hoyo (components/TablaHoyoAHoyo.tsx)
// pueda mostrar la fila "Par" completa desde el principio del torneo, sin
// esperar a que se haya jugado ningún hoyo. La fuente es
// campos_golf_biblioteca (ver drafters-schema.sql) — con Data Golf (fuente
// por defecto desde el 03/10) esto se rellena solo desde el primer ciclo de
// sincronización, porque Data Golf da los 18 pares del campo de golpe; con
// ESPN solo si el torneo ya tiene un nombre de campo puesto en
// campos_golf_live (normalmente solo torneos con rotación de varios
// campos). Reutilizada igual en app/porras/[id]/clasificacion/page.tsx y
// app/salas/[id]/clasificacion/page.tsx.

// Nombres de las 18 columnas de par en campos_golf_biblioteca (par_h1..par_h18).
const COLUMNAS_PAR_BIBLIOTECA = Array.from({ length: 18 }, (_, i) => `par_h${i + 1}`);

/**
 * Trae, para cada campo_id de la lista, el par de sus 18 hoyos si ya está en
 * la biblioteca (buscando por nombre normalizado, mismo criterio que
 * lib/nombreMatch.ts) — un campo sin biblioteca todavía (torneo recién
 * conectado) simplemente no aparece en el mapa devuelto.
 */
export async function cargarParesBiblioteca(campos: { campo_id: string; nombre: string }[]): Promise<Record<string, (number | null)[]>> {
  const nombresNormalizados = Array.from(new Set(campos.map((c) => normalizarNombre(c.nombre))));
  if (nombresNormalizados.length === 0) return {};

  const { data } = await supabase
    .from('campos_golf_biblioteca')
    .select(
      'nombre_normalizado,par_h1,par_h2,par_h3,par_h4,par_h5,par_h6,par_h7,par_h8,par_h9,par_h10,par_h11,par_h12,par_h13,par_h14,par_h15,par_h16,par_h17,par_h18'
    )
    .in('nombre_normalizado', nombresNormalizados);

  const filas = (data as Record<string, string | number | null>[]) ?? [];
  const paresPorNombreNorm = new Map<string, (number | null)[]>(
    filas.map((fila) => [fila.nombre_normalizado as string, COLUMNAS_PAR_BIBLIOTECA.map((col) => (fila[col] as number | null) ?? null)])
  );

  const resultado: Record<string, (number | null)[]> = {};
  for (const c of campos) {
    const pares = paresPorNombreNorm.get(normalizarNombre(c.nombre));
    if (pares) resultado[c.campo_id] = pares;
  }
  return resultado;
}
