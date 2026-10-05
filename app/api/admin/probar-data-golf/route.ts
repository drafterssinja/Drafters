import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import {
  obtenerCalendarioDataGolf,
  obtenerCampoDataGolf,
  obtenerEstadisticasEnVivoDataGolf,
  obtenerEnJuegoDataGolf,
  obtenerEstadisticasHoyoDataGolf,
  obtenerListaJugadoresDataGolf,
  obtenerCuotasOutrightsDataGolf,
  type DataGolfTour,
} from '@/lib/dataGolf';

// ============================================================================
// RUTA DE DIAGNÓSTICO — DATA GOLF (02/10, preparación para la integración)
// ============================================================================
// Como Data Golf no documenta en ningún sitio la forma exacta del JSON que
// devuelve cada endpoint (ver la cabecera de lib/dataGolf.ts), esta ruta NO
// procesa ni mapea nada: se limita a llamar al endpoint pedido y devolver
// la respuesta cruda, tal cual, para que Iñi la pueda ver y copiar desde
// /admin/resultados-golf (botón "Probar Data Golf") en cuanto tenga una
// cuenta de pago con clave real — sin necesitar Postman ni herramientas de
// desarrollador.
//
// Mismo patrón de autorización que /api/admin/actualizar-golf-en-vivo:
// sesión de administrador con Bearer token. No hace falta el secreto de
// cron aquí porque ningún cron llama a esta ruta — solo el botón de admin.
export const maxDuration = 30;

async function estaAutorizado(req: NextRequest, admin: ReturnType<typeof crearClienteAdmin>): Promise<boolean> {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return false;

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return false;

  const { data: perfil } = await admin.from('perfiles').select('rol').eq('id', userData.user.id).single();
  return !!perfil && perfil.rol === 'admin';
}

const ENDPOINTS = ['get-schedule', 'field-updates', 'live-tournament-stats', 'in-play', 'live-hole-stats', 'get-player-list', 'outrights'] as const;
type Endpoint = (typeof ENDPOINTS)[number];

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

  let body: { endpoint?: string; tour?: string; market?: string } = {};
  try {
    body = await req.json();
  } catch {
    // sin cuerpo — se usan los valores por defecto de abajo
  }

  const endpoint = (body.endpoint ?? 'get-schedule') as string;
  const tour = (body.tour ?? 'euro') as DataGolfTour;

  if (!(ENDPOINTS as readonly string[]).includes(endpoint)) {
    return NextResponse.json({ error: `Endpoint desconocido: "${endpoint}". Válidos: ${ENDPOINTS.join(', ')}.` }, { status: 400 });
  }

  try {
    let data: unknown;
    switch (endpoint as Endpoint) {
      case 'get-schedule':
        data = await obtenerCalendarioDataGolf(tour, false);
        break;
      case 'field-updates':
        data = await obtenerCampoDataGolf(tour);
        break;
      case 'live-tournament-stats':
        data = await obtenerEstadisticasEnVivoDataGolf(tour);
        break;
      case 'in-play':
        data = await obtenerEnJuegoDataGolf(tour);
        break;
      case 'live-hole-stats':
        data = await obtenerEstadisticasHoyoDataGolf(tour);
        break;
      case 'get-player-list':
        data = await obtenerListaJugadoresDataGolf();
        break;
      case 'outrights': {
        const mercadosValidos = ['win', 'top_5', 'top_10', 'top_20', 'mc', 'make_cut', 'frl'] as const;
        const mercado = (mercadosValidos as readonly string[]).includes(body.market ?? '') ? (body.market as (typeof mercadosValidos)[number]) : 'win';
        data = await obtenerCuotasOutrightsDataGolf(tour, mercado);
        break;
      }
    }
    return NextResponse.json({ endpoint, tour, data });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
