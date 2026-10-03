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
  // Última vez que se usó la recarga gratuita mensual de 10€ (nuevo, 27/09,
  // décima vuelta) — null si nunca se ha usado. Ver /recargar y
  // recargar_gratis_mensual() en drafters-schema.sql.
  ultima_recarga_gratis?: string | null;
  // Si puede confirmar equipos en Mesas Drafters (nuevo, 01/10) — ver
  // drafters-schema.sql, columna perfiles.acceso_mesas_drafters. Las
  // porras nunca dependen de esto. Puede venir undefined en algún sitio
  // que no la seleccione explícitamente — tratar como false en ese caso.
  acceso_mesas_drafters?: boolean;
  // Consentimiento para recibir por email información y avisos de inicio
  // de porras (nuevo, 03/10) — ver drafters-schema.sql, columna
  // perfiles.acepta_notificaciones_email. Respuesta obligatoria sí/no en
  // el registro, justo debajo del email.
  acepta_notificaciones_email?: boolean;
};

export type Movimiento = {
  id: string;
  usuario_id: string;
  tipo: 'deposito' | 'retiro';
  importe: number;
  creado_en: string;
};
