import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import { actualizarCalendarioFutbol } from '@/lib/server/calendarioFutbol';

// Actualiza el calendario de jornadas de La Liga y Champions (15/10), que usa
// /admin/ligas para que las temporadas empiecen y acaben con una jornada.
export const maxDuration = 60;

async function estaAutorizado(req: NextRequest, admin: ReturnType<typeof crearClienteAdmin>): Promise<boolean> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { data: userData, error } = await admin.auth.getUser(token);
  if (error || !userData.user) return false;
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
  if (!(await estaAutorizado(req, admin))) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  try {
    const r = await actualizarCalendarioFutbol(admin);
    return NextResponse.json(r, { status: r.error ? 502 : 200 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
