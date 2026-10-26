import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import { enviarNotificacionesPush } from '@/lib/server/notificacionesPush';
import { sincronizarTenis } from '@/lib/server/tenisEspn';

// Notificaciones push (18/10). La llama pg_cron de Supabase cada minuto con la
// cabecera "x-cron-secret" (= CRON_SECRET), igual que las sincronizaciones.
// Ver lib/server/notificacionesPush.ts y el SQL 52.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

async function ejecutar(req: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get('x-cron-secret') !== secreto) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }
  try {
    const admin = crearClienteAdmin();
    // De paso, los sorteos de las mesas de la liga que ya han cerrado.
    await admin.rpc('v2_sortear_pendientes');
    // Tenis en directo (27/10): marcador, saque y breaks de ESPN cada minuto.
    let tenis: unknown = null;
    try {
      tenis = await sincronizarTenis(admin);
    } catch (e) {
      tenis = { error: (e as Error).message };
    }
    const r = await enviarNotificacionesPush(admin);
    return NextResponse.json({ ...r, tenis });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return ejecutar(req);
}
export async function GET(req: NextRequest) {
  return ejecutar(req);
}
