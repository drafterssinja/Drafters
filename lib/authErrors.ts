// Supabase (GoTrue) devuelve los mensajes de error de autenticación en
// inglés y no permite cambiar ese idioma desde la configuración del
// proyecto. Esta función traduce los mensajes más habituales a español para
// mostrárselos al usuario; si no reconoce el mensaje, devuelve uno genérico
// en vez de dejar pasar el texto en inglés sin traducir.
export function traducirErrorAuth(mensaje: string | null | undefined): string {
  const m = (mensaje ?? '').trim();

  const mapaExacto: Record<string, string> = {
    'Invalid login credentials': 'Email o contraseña incorrectos.',
    'Email not confirmed': 'Todavía no has verificado tu email. Revisa tu bandeja de entrada.',
    'User already registered': 'Ya existe una cuenta registrada con este email.',
    'Unable to validate email address: invalid format': 'El formato del email no es válido.',
    'Token has expired or is invalid': 'El código ha caducado o no es válido. Pide uno nuevo.',
    'Email rate limit exceeded': 'Has hecho demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
    'Signup requires a valid password': 'La contraseña no es válida.',
    'Signups not allowed for this instance': 'El registro de nuevas cuentas no está disponible ahora mismo.',
    'User already exists': 'Ya existe una cuenta registrada con este email.',
    'New password should be different from the old password.': 'La nueva contraseña debe ser distinta de la anterior.',
    // Mensaje genérico que da Supabase cuando el disparador que crea el
    // perfil falla (por ejemplo, por el nombre de usuario duplicado) — no da
    // más detalle, así que avisamos de la causa más probable.
    'Database error saving new user': 'No se ha podido crear la cuenta. Es posible que el nombre de usuario ya esté en uso — prueba con otro.',
  };

  if (mapaExacto[m]) return mapaExacto[m];

  if (/password should be at least/i.test(m)) {
    return 'La contraseña es demasiado corta. Usa al menos 8 caracteres.';
  }
  if (/for security purposes.*after (\d+) ?seconds/i.test(m)) {
    const segundos = m.match(/after (\d+) ?seconds/i)?.[1] ?? 'unos segundos';
    return `Por seguridad, espera ${segundos} segundos antes de volver a intentarlo.`;
  }
  if (/already registered|already exists/i.test(m)) {
    return 'Ya existe una cuenta registrada con este email.';
  }
  // Mensaje que puede devolver Supabase al pedir "reenviar código" (resend)
  // para un email que ya está verificado — no hay nada que reenviar, así
  // que lo decimos claro en vez de dejar pasar un genérico "ha ocurrido un
  // error" (pedido de Iñi, 23/09, ver app/verificar/page.tsx).
  if (/already confirmed|already verified/i.test(m)) {
    return 'Ese email ya está verificado. Inicia sesión.';
  }
  if (/invalid.*email|email.*invalid/i.test(m)) {
    return 'El email no es válido.';
  }
  if (/network|fetch/i.test(m)) {
    return 'No se ha podido conectar. Revisa tu conexión e inténtalo de nuevo.';
  }

  return 'Ha ocurrido un error. Inténtalo de nuevo.';
}
