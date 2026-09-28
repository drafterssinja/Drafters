// ============================================================================
// TIEMPO MÁXIMO PARA UNA LLAMADA A SUPABASE (28/09)
// ============================================================================
// Pedido de Iñi: la pantalla de "Vídeos publicitarios" se quedaba a veces
// colgada en "Comprobando acceso..." sin mostrar nada ni ningún error — si
// `supabase.auth.getSession()` o la consulta del perfil no llegaban a
// responder (red lenta, un token de sesión atascado, etc.), no había nada
// que sacara la pantalla de ese estado de carga: se quedaba así para
// siempre. Esta función pone un límite de tiempo a cualquier promesa de
// Supabase — si no responde a tiempo, se rechaza con un mensaje claro en
// vez de dejar la pantalla esperando indefinidamente. Se usa en el
// useEffect de comprobación de acceso de las pantallas de /admin (de
// momento, publicidad y actividad — el mismo patrón se puede llevar a
// cualquier otra si vuelve a pasar).
// `PromiseLike<T>`, no `Promise<T>`, a propósito: las consultas de Supabase
// (`.select().single()`, etc.) son "thenables" propios (PostgrestBuilder),
// no instancias reales de Promise, así que exigir `Promise<T>` aquí las
// rechazaría en tiempo de compilación aunque funcionen igual en tiempo de
// ejecución — `Promise.resolve()` las normaliza a una Promise de verdad.
export function conTiempoMaximo<T>(promesa: PromiseLike<T>, queHace: string, segundos = 10): Promise<T> {
  return Promise.race([
    Promise.resolve(promesa),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`La operación de ${queHace} ha tardado demasiado.`)), segundos * 1000)),
  ]);
}
