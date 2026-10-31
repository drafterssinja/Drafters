import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import { enviarNotificacionesPush } from '@/lib/server/notificacionesPush';
import { crearTorneosTenisAutomaticos, sincronizarTenis } from '@/lib/server/tenisEspn';

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
    // 27/10: liga de duelos — jornadas recién publicadas (sorteo de duelos) y cierre de temporada.
    await admin.rpc('duelos_actualizar');
    // 31/10: ligas privadas (jornadas nuevas) y niveles (puntos de nivel de las partidas terminadas), cada 5 minutos.
    const minuto = new Date().getUTCMinutes();
    if (minuto % 5 === 0) await admin.rpc('lp_actualizar');
    if (minuto % 5 === 2) await admin.rpc('xp_procesar');
    // Tenis en directo (27/10): marcador, saque y breaks de ESPN cada minuto.
    let tenis: unknown = null;
    try {
      // 28/10: cada 15 minutos, alta automática de los torneos con cuadro publicado.
      if (new Date().getUTCMinutes() % 15 === 0) await crearTorneosTenisAutomaticos(admin);
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
