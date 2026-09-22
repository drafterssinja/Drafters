import { createClient } from '@supabase/supabase-js';

// Cliente con la clave "service role" — SOLO se importa desde código de
// servidor (rutas app/api/**/route.ts), nunca desde un componente 'use
// client'. Da acceso total a la base de datos sin pasar por Row Level
// Security, así que cada ruta que lo use tiene que comprobar ella misma que
// quien llama es el administrador antes de hacer nada con él.
export function crearClienteAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno del servidor (Vercel → Settings → Environment Variables).'
    );
  }
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}
