import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import { sincronizarFutbol, sincronizarEscudos } from '@/lib/server/sincronizarFutbolEspn';

// Puntos y marcadores en vivo de las mesas de fútbol (LaLiga, Champions...)
// — 06/10. Ver lib/server/sincronizarFutbolEspn.ts para el detalle.
//
// Acciones (campo "accion" del cuerpo JSON):
//   - (por defecto) "sync" / "marcadores": marcadores y puntos Drafters en
//     vivo desde ESPN. La llama el cron cada minuto.
//   - "comprobar": informa de qué equipos y jugadores no se han podido
//     emparejar con ESPN; no escribe nada. Solo admin.
//   - "forzar": como "sync" pero sin esperar a que la jornada esté cerca ni
//     saltarse partidos congelados. Solo admin.
//   - "escudos": descarga los escudos de LaLiga, Champions y Premier. Solo admin.
//
// Autorización: cabecera "x-cron-secret" (= CRON_SECRET) o sesión de
// administrador — mismo patrón que /api/admin/actualizar-golf-en-vivo.
export const maxDuration = 60;

async function estaAutorizado(req: NextRequest, admin: ReturnType<typeof crearClienteAdmin>): Promise<{ ok: boolean; esCron: boolean }> {
  const cronSecret = process.env.CRON_SECRET;
  const cabeceraCron = req.headers.get('x-cron-secret');
  if (cronSecret && cabeceraCron && cabeceraCron === cronSecret) return { ok: true, esCron: true };

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return { ok: false, esCron: false };

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return { ok: false, esCron: false };

  const { data: perfil } = await admin.from('perfiles').select('rol').eq('id', userData.user.id).single();
  return { ok: !!perfil && perfil.rol === 'admin', esCron: false };
}

export async function POST(req: NextRequest) {
  let admin;
  try {
    admin = crearClienteAdmin();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const auth = await estaAutorizado(req, admin);
  if (!auth.ok) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  let cuerpo: { accion?: string; competicion?: string } = {};
  try {
    cuerpo = await req.json();
  } catch {
    cuerpo = {};
  }
  const accion = cuerpo.accion ?? 'sync';

  try {
    if (accion === 'comprobar') {
      return NextResponse.json(await sincronizarFutbol(admin, { soloComprobar: true, competicion: cuerpo.competicion }));
    }
    if (accion === 'escudos') {
      if (auth.esCron) return NextResponse.json({ error: 'Acción solo para administradores.' }, { status: 403 });
      return NextResponse.json({ escudos: await sincronizarEscudos(admin) });
    }
    if (accion === 'forzar') {
      if (auth.esCron) return NextResponse.json({ error: 'Acción solo para administradores.' }, { status: 403 });
      return NextResponse.json(await sincronizarFutbol(admin, { forzar: true, competicion: cuerpo.competicion }));
    }
    return NextResponse.json(await sincronizarFutbol(admin, { competicion: cuerpo.competicion }));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
