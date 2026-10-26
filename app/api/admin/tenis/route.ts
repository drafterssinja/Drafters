import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import { crearTorneoTenis, crearTorneosTenisAutomaticos, listarTorneosSemana, sincronizarTenis, type LigaTenis } from '@/lib/server/tenisEspn';

// Tenis con ESPN (27/10). Solo admin.
//   listar      → torneos de esta semana en ESPN (ATP y WTA) y si ya están creados.
//   crear       → da de alta un torneo: jugadores con precio, cierre y salas de Drafters.
//   sincronizar → marcador, saque, breaks y puntos ahora mismo (el cron lo hace cada minuto).
//   finalizar   → da el torneo por terminado (por si ESPN no marca la final).
//   reabrir     → lo contrario.
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
  let admin;
  try {
    admin = crearClienteAdmin();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  if (!(await esAdmin(req, admin))) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });

  let body: { accion?: string; liga?: string; id?: string; competicion?: string } = {};
  try {
    body = await req.json();
  } catch {
    // vacío
  }
  try {
    if (body.accion === 'listar') {
      const [torneos, { data: creados }] = await Promise.all([
        listarTorneosSemana(admin),
        admin.from('tenis_torneos').select('competicion,liga,desde,finalizado_en,creado_en').order('creado_en', { ascending: false }).limit(12),
      ]);
      return NextResponse.json({ torneos, creados: creados ?? [] });
    }
    if (body.accion === 'crear') {
      const liga: LigaTenis = body.liga === 'wta' ? 'wta' : 'atp';
      if (!body.id) return NextResponse.json({ error: 'Falta el torneo.' }, { status: 400 });
      return NextResponse.json(await crearTorneoTenis(admin, liga, body.id));
    }
    if (body.accion === 'auto') return NextResponse.json({ resultados: await crearTorneosTenisAutomaticos(admin) });
    if (body.accion === 'sincronizar') return NextResponse.json(await sincronizarTenis(admin, body.competicion || undefined));
    if (body.accion === 'finalizar' || body.accion === 'reabrir') {
      if (!body.competicion) return NextResponse.json({ error: 'Falta el torneo.' }, { status: 400 });
      const { error } = await admin
        .from('tenis_torneos')
        .update({ finalizado_en: body.accion === 'finalizar' ? new Date().toISOString() : null })
        .eq('competicion', body.competicion);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Acción no válida.' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
