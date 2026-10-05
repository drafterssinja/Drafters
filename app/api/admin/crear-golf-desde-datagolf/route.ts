import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import { crearGolfDesdeDataGolf } from '@/lib/server/crearGolfDesdeDataGolf';

// Creación automática de porra + mesas de golf desde las cuotas de Data Golf
// (05/10) — ver lib/server/crearGolfDesdeDataGolf.ts y el bloque "CREACIÓN
// AUTOMÁTICA..." de drafters-schema.sql. Lo llama el cron cada 10 minutos
// (cabecera x-cron-secret, mismo CRON_SECRET que el resto) o un admin logueado
// (para probarlo a mano). Siempre devuelve el resumen de lo que ha hecho.
export const maxDuration = 60;

async function estaAutorizado(req: NextRequest, admin: ReturnType<typeof crearClienteAdmin>): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  const cabeceraCron = req.headers.get('x-cron-secret');
  if (cronSecret && cabeceraCron && cabeceraCron === cronSecret) return true;

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return false;
  const { data: perfil } = await admin.from('perfiles').select('rol').eq('id', userData.user.id).single();
  return !!perfil && perfil.rol === 'admin';
}

export async function POST(req: NextRequest) {
  let admin;
  try {
    admin = crearClienteAdmin();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  if (!(await estaAutorizado(req, admin))) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  try {
    const resultados = await crearGolfDesdeDataGolf(admin);
    return NextResponse.json({ ok: true, resultados });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
