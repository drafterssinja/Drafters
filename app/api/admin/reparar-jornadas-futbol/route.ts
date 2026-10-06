import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import { repararJornadasFutbol } from '@/lib/server/repararJornadaFutbol';

// Reparación de jornadas de fútbol creadas sin los jugadores de algún equipo
// (07/10, bug de los filiales Celta Fortuna / Real Sociedad B). Solo admin.
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
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  const { data: perfil } = await admin.from('perfiles').select('rol').eq('id', userData.user.id).single();
  if (!perfil || perfil.rol !== 'admin') return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });

  try {
    const resultados = await repararJornadasFutbol(admin);
    return NextResponse.json({ resultados });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
