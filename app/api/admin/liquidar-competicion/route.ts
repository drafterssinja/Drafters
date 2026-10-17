import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import { liquidarMesasDeCompeticion } from '@/lib/server/liquidarMesasCompeticion';

// Liquidar de golpe todas las mesas jugadas de una jornada / torneo (12/10).
// Solo para administradores (sesión con Bearer token). Ver
// lib/server/liquidarMesasCompeticion.ts.
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
  if (!(await estaAutorizado(req, admin))) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  let body: { competicion?: string; soloComprobar?: boolean; forzar?: boolean; tramo?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición no válida.' }, { status: 400 });
  }
  const competicion = (body.competicion ?? '').trim();
  if (!competicion) return NextResponse.json({ error: 'Falta la competición.' }, { status: 400 });

  try {
    const resultado = await liquidarMesasDeCompeticion(admin, competicion, { soloComprobar: !!body.soloComprobar, forzar: !!body.forzar, tramo: body.tramo ?? null });
    return NextResponse.json(resultado);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
