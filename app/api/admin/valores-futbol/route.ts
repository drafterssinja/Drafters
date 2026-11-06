import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import { encolarValorFutbol, procesarColaValorFutbol } from '@/lib/server/valorFutbol';
import { claveApif, pedirApif } from '@/lib/server/apiFootball';
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
  const { accion, id, apif_id } = (await req.json().catch(() => ({}))) as { accion?: string; id?: string; apif_id?: number };
  try {
    if (accion === 'plantillas') return NextResponse.json(await encolarValorFutbol(admin, 'plantilla'));
    if (accion === 'valores') return NextResponse.json(await encolarValorFutbol(admin, 'stats'));
    if (accion === 'procesar') return NextResponse.json(await procesarColaValorFutbol(admin, 10));
    // 05/11: lesionados, sancionados y dudas de las jornadas abiertas.
    if (accion === 'bajas') return NextResponse.json(await actualizarBajasFutbol(admin));
    // 06/11: casar a mano un jugador con API-Football.
    if (accion === 'squad' && id) return NextResponse.json(await plantillaApifDe(admin, id));
    if (accion === 'casar' && id && apif_id) return NextResponse.json(await casarAMano(admin, id, Number(apif_id)));
    return NextResponse.json({ error: 'Acción desconocida.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// ----------------------------------------------------------------------------
// CASAR A MANO (06/11, Iñi): "Youssef Enríquez" no se casaba porque en
// API-Football sale con otro nombre. Se elige de la plantilla de su equipo.
// ----------------------------------------------------------------------------
type Admin = ReturnType<typeof crearClienteAdmin>;
type FilaV = { id: string; liga: string; nombre: string; equipo_real: string | null; apif_id: number | null; apif_equipo_id: number | null; activo: boolean };

async function equipoApifDe(admin: Admin, f: FilaV): Promise<number | null> {
  if (f.apif_equipo_id) return f.apif_equipo_id;
  const { data } = await admin.from('futbol_valor').select('apif_equipo_id').eq('liga', f.liga).eq('equipo_real', f.equipo_real ?? '').not('apif_equipo_id', 'is', null).limit(200);
  const votos = new Map<number, number>();
  for (const r of (data as { apif_equipo_id: number }[]) ?? []) votos.set(r.apif_equipo_id, (votos.get(r.apif_equipo_id) ?? 0) + 1);
  return Array.from(votos.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

async function plantillaApifDe(admin: Admin, id: string) {
  const { data: f } = await admin.from('futbol_valor').select('id,liga,nombre,equipo_real,apif_id,apif_equipo_id,activo').eq('id', id).maybeSingle();
  if (!f) throw new Error('No encuentro a ese jugador.');
  const equipo = await equipoApifDe(admin, f as FilaV);
  if (!equipo) throw new Error(`No sé qué equipo de API-Football es ${f.equipo_real ?? 'el suyo'}.`);
  const json = await pedirApif(`/players/squads?team=${equipo}`);
  const plantilla = ((json?.response?.[0]?.players ?? []) as { id: number; name: string; number: number | null; position: string | null }[]).filter((p) => p?.id);
  const { data: usados } = await admin.from('futbol_valor').select('nombre,apif_id').eq('liga', (f as FilaV).liga).eq('activo', true).in('apif_id', plantilla.map((p) => p.id));
  const porId = new Map(((usados as { nombre: string; apif_id: number }[]) ?? []).map((u) => [u.apif_id, u.nombre]));
  return {
    equipo,
    jugadores: plantilla
      .map((p) => ({ id: p.id, nombre: p.name, dorsal: p.number, posicion: p.position, casadoCon: porId.get(p.id) ?? null }))
      .sort((a, b) => Number(!!a.casadoCon) - Number(!!b.casadoCon) || a.nombre.localeCompare(b.nombre)),
  };
}

async function casarAMano(admin: Admin, id: string, apifId: number) {
  const { data: f } = await admin.from('futbol_valor').select('id,liga,nombre,equipo_real,apif_id,apif_equipo_id,activo').eq('id', id).maybeSingle();
  if (!f) throw new Error('No encuentro a ese jugador.');
  const fila = f as FilaV;
  const { data: otro } = await admin.from('futbol_valor').select('id,nombre').eq('liga', fila.liga).eq('activo', true).eq('apif_id', apifId).neq('id', id).limit(1);
  const o = (otro as { id: string; nombre: string }[] | null)?.[0];
  if (o) throw new Error(`Ese jugador de API-Football ya está casado con ${o.nombre}.`);
  const equipo = await equipoApifDe(admin, fila);
  const { error } = await admin.from('futbol_valor').update({ apif_id: apifId, apif_equipo_id: equipo, actualizado_en: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
  return { ok: true };
}
