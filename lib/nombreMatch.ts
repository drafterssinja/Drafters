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
