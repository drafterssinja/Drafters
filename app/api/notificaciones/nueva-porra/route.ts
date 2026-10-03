import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import { conConcurrenciaLimitada } from '@/lib/espnGolf';
import { enviarEmailSimple } from '@/lib/server/emailResend';

// ============================================================================
// AVISO AUTOMÁTICO DE NUEVA PORRA POR EMAIL (nuevo, 03/10, pedido de Iñi)
// ============================================================================
// "cuando creemos una nueva porra, de momento solamente una nueva porra, a
// los que sí que hayan aceptado [recibir avisos] se les mandará un correo
// de notificación... y que se lance automáticamente" — esta ruta es el
// destino de esa llamada automática: la llama SOLO el trigger de Postgres
// notificar_nueva_porra_creada() (ver drafters-schema.sql, "after insert on
// porras"), nunca un botón del admin ni el navegador de ningún usuario — de
// ahí que la única autorización válida sea la cabecera x-cron-secret, igual
// que en app/api/admin/actualizar-golf-en-vivo (mismo CRON_SECRET, ya
// configurado en Vercel, reutilizado aquí para no pedirle a Iñi un segundo
// secreto).
//
// Solo porras (no Mesas Drafters/salas) — así lo pidió Iñi explícitamente
// ("de momento solamente una nueva porra"); si algún día hace falta también
// al crear una sala, haría falta su propio trigger "after insert on salas"
// apuntando a una ruta equivalente.
//
// El contenido del email (asunto + cuerpo) lo escribe Drafters, no Iñi — lo
// pidió así ("créalo tú, algo simple"): deliberadamente breve, sin más que
// el aviso y el enlace a la porra, nada de los datos de la porra en sí
// (precio, fecha límite...) para no tener que mantener dos sitios
// sincronizados — quien haga clic ve todo el detalle real en la propia
// página.

const SITE_URL = 'https://drafters-rho.vercel.app';

type PerfilConEmail = { email: string | null };

function estaAutorizado(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const cabeceraCron = req.headers.get('x-cron-secret');
  return !!cronSecret && !!cabeceraCron && cabeceraCron === cronSecret;
}

export async function POST(req: NextRequest) {
  if (!estaAutorizado(req)) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  const cuerpo = await req.json().catch(() => null);
  const porraId = cuerpo?.porra_id as string | undefined;
  if (!porraId) {
    return NextResponse.json({ error: 'Falta porra_id.' }, { status: 400 });
  }

  const admin = crearClienteAdmin();

  const { data: porraData, error: porraError } = await admin.from('porras').select('id').eq('id', porraId).maybeSingle();
  if (porraError) {
    return NextResponse.json({ error: `No se ha podido leer la porra: ${porraError.message}` }, { status: 500 });
  }
  if (!porraData) {
    // La porra pudo borrarse justo después de crearse (caso de carrera poco
    // probable, pero no debe romper nada) — simplemente no hay nada que
    // avisar.
    return NextResponse.json({ ok: true, enviados: 0, fallidos: 0, motivo: 'Porra no encontrada (quizá borrada).' });
  }

  const { data: usuariosData, error: usuariosError } = await admin
    .from('perfiles')
    .select('email')
    .eq('acepta_notificaciones_email', true)
    .not('email', 'is', null);
  if (usuariosError) {
    return NextResponse.json({ error: `No se han podido leer los destinatarios: ${usuariosError.message}` }, { status: 500 });
  }

  const destinatarios = ((usuariosData as PerfilConEmail[]) ?? [])
    .map((u) => u.email)
    .filter((email): email is string => !!email);

  if (destinatarios.length === 0) {
    return NextResponse.json({ ok: true, enviados: 0, fallidos: 0, motivo: 'Ningún usuario ha consentido recibir avisos por email.' });
  }

  const asunto = '¡Nueva porra disponible en Drafters!';
  const url = `${SITE_URL}/porras/${porraId}`;
  const html = `
    <p>¡Hola!</p>
    <p>Se ha abierto una nueva porra en Drafters. Entra para ver el detalle y armar tu equipo antes de que se cierren las inscripciones:</p>
    <p><a href="${url}">${url}</a></p>
    <p>Un saludo,<br />El equipo de Drafters</p>
  `.trim();

  let enviados = 0;
  const errores: string[] = [];

  await conConcurrenciaLimitada(destinatarios, 5, async (email) => {
    try {
      await enviarEmailSimple(email, asunto, html);
      enviados += 1;
    } catch (err) {
      errores.push(`${email}: ${(err as Error).message}`);
    }
  });

  return NextResponse.json({ ok: true, enviados, fallidos: errores.length, total: destinatarios.length, errores: errores.slice(0, 5) });
}
