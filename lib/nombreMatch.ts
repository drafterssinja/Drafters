// ============================================================================
// COMPARAR NOMBRES DE JUGADOR ENTRE LISTADOS DISTINTOS
// ============================================================================
// Se usa para cotejar el listado de inscritos de un torneo (pegado por Iñi)
// contra el ranking mundial guardado (también pegado por Iñi, por
// separado) — cada web escribe el mismo nombre con acentos, mayúsculas o
// espacios ligeramente distintos ("Jon Rahm" vs "JON RAHM", "José María
// Olazábal" vs "Jose Maria Olazabal"), así que la comparación normaliza
// ambos lados antes de comparar. Es una igualdad exacta tras normalizar, no
// una búsqueda difusa — si un nombre no coincide del todo, se trata como
// "no encontrado en el ranking mundial" en vez de arriesgarse a emparejar
// mal a dos jugadores distintos.

export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos/diacríticos
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ') // fuera puntuación, iniciales con punto, etc.
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿El nombre de un torneo de Data Golf es esta competición? Compara los
 * nombres normalizados (uno contenido en el otro, el más corto de al menos 8
 * caracteres). Si falta el nombre de Data Golf no se puede comprobar y se
 * deja pasar, para no bloquear nada por un dato que falte. */
export function nombreTorneoCoincide(competicion: string, eventName: string | null): boolean {
  if (!eventName || !eventName.trim()) return true;
  const a = normalizarNombre(competicion);
  const b = normalizarNombre(eventName);
  if (!a || !b) return true;
  const corto = a.length <= b.length ? a : b;
  const largo = a.length <= b.length ? b : a;
  return corto.length >= 8 && largo.includes(corto);
}
