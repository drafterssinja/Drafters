import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import { encolarValorFutbol, procesarColaValorFutbol } from '@/lib/server/valorFutbol';
import { claveApif } from '@/lib/server/apiFootball';
import { actualizarBajasFutbol } from '@/lib/server/bajasFutbol';

// ============================================================================
// ADMIN — VALOR DE LOS JUGADORES DE FÚTBOL (03/11, Iñi)
// ============================================================================
// Botones de Admin → Valor de los jugadores (lo mismo que hace el cron solo):
//   accion 'plantillas' → repasar ahora las plantillas (encola los equipos)
//   accion 'valores'    → actualizar ahora los valores (encola las estadísticas)
//   accion 'procesar'   → hacer unas cuantas consultas de la cola
// Ver lib/server/valorFutbol.ts. Solo admin.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

async function esAdmin(req: NextRequest, admin: ReturnType<typeof crearClienteAdmin>) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return false;
  const { data: p } = await admin.from('perfiles').select('rol').eq('id', data.user.id).single();
  return !!p && p.rol === 'admin';
}

export async function POST(req: NextRequest) {
  const admin = crearClienteAdmin();
  if (!(await esAdmin(req, admin))) return NextResponse.json({ error: 'Solo admin.' }, { status: 403 });
  if (!claveApif()) return NextResponse.json({ error: 'Falta API_FOOTBALL_KEY en Vercel.' }, { status: 400 });
  const { accion } = (await req.json().catch(() => ({}))) as { accion?: string };
  try {
    if (accion === 'plantillas') return NextResponse.json(await encolarValorFutbol(admin, 'plantilla'));
    if (accion === 'valores') return NextResponse.json(await encolarValorFutbol(admin, 'stats'));
    if (accion === 'procesar') return NextResponse.json(await procesarColaValorFutbol(admin, 10));
    // 05/11: lesionados, sancionados y dudas de las jornadas abiertas.
    if (accion === 'bajas') return NextResponse.json(await actualizarBajasFutbol(admin));
    return NextResponse.json({ error: 'Acción desconocida.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
