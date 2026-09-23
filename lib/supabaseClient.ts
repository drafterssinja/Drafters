import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // Esto solo debería pasar si falta el archivo .env.local — avisamos claro
  // en vez de dejar que Supabase falle con un error críptico más adelante.
  // eslint-disable-next-line no-console
  console.warn(
    'Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local'
  );
}

// Cliente de navegador: guarda la sesión en localStorage y la renueva sola
// (login persistente, tal y como se decidió en la arquitectura técnica).
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type Perfil = {
  id: string;
  nombre: string;
  apellido: string | null;
  nombre_usuario: string | null;
  fecha_nacimiento: string | null;
  saldo_simulado: number;
  terminos_aceptados: boolean;
  rol: 'usuario' | 'admin';
  created_at: string;
  // Copia de solo lectura del email de auth.users (nuevo, ronda de
  // correcciones del 23/09) — solo para que el admin la vea en el listado
  // de usuarios registrados (/admin/usuarios). Puede venir null en algún
  // perfil muy antiguo hasta que se vuelva a pegar el esquema.
  email?: string | null;
};

export type Movimiento = {
  id: string;
  usuario_id: string;
  tipo: 'deposito' | 'retiro';
  importe: number;
  creado_en: string;
};
