import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import { enviarNotificacionesPush } from '@/lib/server/notificacionesPush';
import { crearTorneosTenisAutomaticos, sincronizarTenis } from '@/lib/server/tenisEspn';
import { tareasValorFutbol } from '@/lib/server/valorFutbol';
import { actualizarBajasFutbol } from '@/lib/server/bajasFutbol';

// Notificaciones push (18/10). La llama pg_cron de Supabase cada minuto con la
// cabecera "x-cron-secret" (= CRON_SECRET), igual que las sincronizaciones.
// Ver lib/server/notificacionesPush.ts y el SQL 52.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** ¿Toca hacer esta tarea? (han pasado al menos `minutos` desde la última vez).
 * Si la tabla de estado no existe (SQL 92 sin ejecutar), se hace siempre. */
async function toca(admin: ReturnType<typeof crearClienteAdmin>, tarea: string, minutos: number): Promise<boolean> {
  const { data, error } = await admin.from('futbol_valor_estado').select('actualizado_en').eq('clave', `cron:${tarea}`).maybeSingle();
  if (error) return true;
  const ultima = (data as { actualizado_en: string } | null)?.actualizado_en;
  return !ultima || Date.now() - new Date(ultima).getTime() >= minutos * 60000 - 15000;
}

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
    // 31/10: ligas privadas (jornadas nuevas) y niveles (puntos de nivel de las partidas terminadas).
    // 01/11 (Iñi): salas cuyas jornadas han terminado todas → finalizadas (dejan de salir "En juego").
    // 04/11 (bug de Iñi: "la animación del nivel no sale hasta que ejecuto un SQL"): antes
    // dependían de que el cron cayera justo en un minuto concreto (minuto % 5 === 2…) y, si el
    // cron no pasa exactamente cada minuto, no se hacían nunca. Ahora cada tarea se hace si han
    // pasado X minutos desde la última vez (se apunta en futbol_valor_estado) y se guarda el
    // resultado o el error, para poder verlo.
    const tareas: Record<string, unknown> = {};
    for (const [rpc, min] of [['xp_procesar', 2], ['v2_cerrar_salas_terminadas', 3], ['lp_actualizar', 5]] as const) {
      if (!(await toca(admin, rpc, min))) continue;
      const { data, error } = await admin.rpc(rpc);
      tareas[rpc] = error ? { error: error.message } : data;
      await admin.from('futbol_valor_estado').upsert({ clave: `cron:${rpc}`, valor: { en: new Date().toISOString(), resultado: data ?? null, error: error?.message ?? null }, actualizado_en: new Date().toISOString() }, { onConflict: 'clave' });
    }
    // Tenis en directo (27/10): marcador, saque y breaks de ESPN cada minuto.
    let tenis: unknown = null;
    try {
      // 28/10: cada 15 minutos, alta automática de los torneos con cuadro publicado.
      if (new Date().getUTCMinutes() % 15 === 0) await crearTorneosTenisAutomaticos(admin);
      tenis = await sincronizarTenis(admin);
    } catch (e) {
      tenis = { error: (e as Error).message };
    }
    // 03/11 (Iñi): plantillas de fútbol cada noche y valor Drafters cada lunes (API-Football).
    let valorFutbol: unknown = null;
    try {
      valorFutbol = await tareasValorFutbol(admin);
    } catch (e) {
      valorFutbol = { error: (e as Error).message };
    }
    // 05/11 (Iñi): lesionados, sancionados y dudas de las jornadas abiertas (API-Football), cada hora.
    let bajas: unknown = null;
    try {
      if (await toca(admin, 'bajas_futbol', 60)) {
        bajas = await actualizarBajasFutbol(admin);
        await admin.from('futbol_valor_estado').upsert({ clave: 'cron:bajas_futbol', valor: { en: new Date().toISOString(), resultado: bajas }, actualizado_en: new Date().toISOString() }, { onConflict: 'clave' });
      }
    } catch (e) {
      bajas = { error: (e as Error).message };
    }
    const r = await enviarNotificacionesPush(admin);
    return NextResponse.json({ ...r, tareas, tenis, valorFutbol, bajas });
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
