import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import { crearJornadasFutbolAutomaticas } from '@/lib/server/crearFutbolAutomatico';

// Creación automática de jornadas de fútbol (La Liga y Champions) — 06/10.
// Mira el calendario de ESPN y, en cuanto una jornada tiene horarios
// confirmados en todos sus partidos, crea sus jugadores con precio, las
// cuotas y las mesas (solo las de 10 €, ver lib/tiposDeSala.ts).
// La llama el cron cada 30 minutos y el botón de /admin/resultados-futbol.
// Autorización: cabecera "x-cron-secret" (= CRON_SECRET) o sesión de admin.
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
    const resultados = await crearJornadasFutbolAutomaticas(admin);
    return NextResponse.json({ resultados });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
