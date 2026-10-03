// ============================================================================
// ENVÍO DE EMAILS TRANSACCIONALES — RESEND (nuevo, 03/10, pedido de Iñi)
// ============================================================================
// Hasta ahora esta app no enviaba ningún email propio: todo el correo que
// sale (verificación de cuenta, recuperar contraseña) lo manda Supabase Auth
// solo, automáticamente, para sus propios eventos de autenticación — no hay
// forma de usar eso para avisos de negocio como "se ha creado una porra
// nueva" (pedido de Iñi, 03/10: avisar por email, solo a quien haya
// consentido, cuando se cree una porra). Hacía falta un proveedor de envío
// transaccional de verdad — se ha elegido Resend por ser el más simple de
// integrar con una app en Next.js (una sola llamada HTTP, sin librería
// obligatoria) y tener un nivel gratuito con el que probar antes de pagar.
//
// IMPORTANTE — esto no funciona todavía "solo", Iñi tiene que:
//   1. Crear una cuenta en https://resend.com (gratis para empezar).
//   2. Verificar un dominio propio suyo para poder enviar a destinatarios
//      reales (sin dominio verificado, Resend solo deja enviar a la propia
//      dirección con la que te registraste — nunca a la lista de usuarios
//      real). Resend explica el proceso paso a paso en su panel (añadir unos
//      registros DNS en el proveedor donde tenga el dominio).
//   3. Generar una API key desde el panel de Resend y añadirla en Vercel
//      (Settings → Environment Variables) como RESEND_API_KEY — SOLO ahí,
//      nunca pegada en el código ni en el chat.
//   4. Añadir también en Vercel una variable EMAIL_FROM con la dirección de
//      envío ya verificada, por ejemplo 'Drafters <notificaciones@tudominio.com>'.
// Sin esas dos variables puestas, enviarEmailSimple() lanza un error claro
// en vez de fallar en silencio — y la ruta que lo llama (ver
// app/api/notificaciones/nueva-porra/route.ts) atrapa ese error por cada
// destinatario sin que rompa el resto del envío.

export async function enviarEmailSimple(destinatario: string, asunto: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const remitente = process.env.EMAIL_FROM;
  if (!apiKey || !remitente) {
    throw new Error('Faltan RESEND_API_KEY o EMAIL_FROM en las variables de entorno del servidor.');
  }

  const respuesta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: remitente,
      to: destinatario,
      subject: asunto,
      html,
    }),
  });

  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => '');
    throw new Error(`Resend respondió ${respuesta.status}: ${cuerpo}`);
  }
}
