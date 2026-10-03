// ============================================================================
// SONIDO DE AVISO DE RESULTADO (nuevo, 03/10, pedido de Iñi)
// ============================================================================
// Pedido: cuando llega un resultado de hoyo que no es par (birdie, eagle,
// bogey, doble bogey...), que suene un aviso además de verse la tira de 5
// segundos. En vez de cargar un archivo de audio (y tener que alojarlo),
// se genera el sonido en el propio navegador con la Web Audio API — un
// "ding" corto de dos tonos, sin depender de ningún archivo ni de red.
//
// Los navegadores bloquean el audio hasta que ha habido alguna interacción
// del usuario en la página (pulsar algo) — normal aquí, porque para llegar
// a esta pantalla ya se ha hecho clic en varios sitios. Si aun así el
// navegador lo bloquea, se ignora en silencio: el aviso visual (la tira)
// sigue apareciendo igual, el sonido es solo un extra.
export function reproducirSonidoAviso(): void {
  try {
    const AudioCtxCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtxCtor) return;
    const ctx = new AudioCtxCtor();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1180, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);

    const cerrar = () => {
      ctx.close().catch(() => {});
    };
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
    osc.onended = cerrar;

    // Algunos navegadores crean el AudioContext en estado "suspended" hasta
    // que se confirma la interacción — resume() no hace nada si ya estaba
    // activo, y si falla (navegador que lo bloquea del todo) ya lo recoge
    // el catch de más abajo sin romper nada.
    ctx.resume().catch(() => {});
  } catch {
    // Ignorado a propósito — ver comentario de cabecera.
  }
}

const CLAVE_PREFERENCIA = 'drafters_sonido_avisos';

/** Preferencia guardada en este dispositivo (02/10: por dispositivo, no por
 * usuario — no hay necesidad de que viaje entre dispositivos). Por
 * defecto, activado. */
export function leerPreferenciaSonido(): boolean {
  try {
    const guardado = window.localStorage.getItem(CLAVE_PREFERENCIA);
    return guardado === null ? true : guardado === '1';
  } catch {
    return true;
  }
}

export function guardarPreferenciaSonido(activado: boolean): void {
  try {
    window.localStorage.setItem(CLAVE_PREFERENCIA, activado ? '1' : '0');
  } catch {
    // Si localStorage no está disponible (modo privado, etc.), no pasa
    // nada — simplemente no se recuerda entre visitas.
  }
}
