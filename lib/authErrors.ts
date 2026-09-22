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
  if (/invalid.*email|email.*invalid/i.test(m)) {
    return 'El email no es válido.';
  }
  if (/network|fetch/i.test(m)) {
    return 'No se ha podido conectar. Revisa tu conexión e inténtalo de nuevo.';
  }

  return 'Ha ocurrido un error. Inténtalo de nuevo.';
}
