import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';

// ============================================================================
// DIAGNÓSTICO — LIVE TENNIS API (13/10, antes de montar el tenis en directo)
// ============================================================================
// Llama a un endpoint de Live Tennis API con la clave de la variable de entorno
// LIVE_TENNIS_API_KEY y devuelve la respuesta CRUDA, para ver qué campos trae
// de verdad cada plan antes de construir la puntuación. Solo admin. La clave
// nunca sale al navegador.
export const maxDuration = 30;

const BASE = 'https://api.livetennisapi.com/api/public/v1';

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

  const clave = process.env.LIVE_TENNIS_API_KEY;
  if (!clave) return NextResponse.json({ error: 'Falta la variable de entorno LIVE_TENNIS_API_KEY en Vercel.' }, { status: 500 });

  let body: { ruta?: string } = {};
  try {
    body = await req.json();
  } catch {
    // vacío
  }
  const ruta = (body.ruta ?? '/usage').trim();
  if (!ruta.startsWith('/') || ruta.includes('..') || ruta.includes('://')) {
    return NextResponse.json({ error: 'Ruta no válida (tiene que empezar por / , p. ej. /matches).' }, { status: 400 });
  }

  try {
    const r = await fetch(`${BASE}${ruta}`, { headers: { Authorization: `Bearer ${clave}`, Accept: 'application/json' }, cache: 'no-store' });
    const texto = await r.text();
    let json: unknown = null;
    try {
      json = JSON.parse(texto);
    } catch {
      // no es JSON
    }
    return NextResponse.json({ ruta, status: r.status, respuesta: json ?? texto.slice(0, 20000) });
  } catch (err) {
    return NextResponse.json({ ruta, error: (err as Error).message }, { status: 502 });
  }
}
