import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import { recalcularPreciosGolfSinEmpezar } from '@/lib/server/crearGolfDesdeDataGolf';

// Recalcular los precios de los torneos de golf que no han empezado (14/10). Solo admin.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let admin;
  try {
    admin = crearClienteAdmin();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  const { data: u, error: eu } = await admin.auth.getUser(token);
  if (eu || !u.user) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  const { data: perfil } = await admin.from('perfiles').select('rol').eq('id', u.user.id).single();
  if (!perfil || perfil.rol !== 'admin') return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  try {
    return NextResponse.json({ resultados: await recalcularPreciosGolfSinEmpezar(admin) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
