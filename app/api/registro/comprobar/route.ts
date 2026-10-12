import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';

// Comprobación previa al registro (11/10, pedido de Iñi): si el EMAIL o el
// NOMBRE DE USUARIO ya pertenecen a una cuenta, no se deja crear otra —
// basta con que coincida UNO de los dos. Antes solo se detectaba el email
// repetido por la respuesta de Supabase (identities vacías), y eso falla
// cuando la cuenta existente no estaba verificada: Supabase reenvía el código
// y deja "registrarse" otra vez con el mismo correo y otro nombre de usuario.
// Se hace en servidor para no exponer la tabla de perfiles al navegador; solo
// se devuelve si cada dato está libre o no.
export const maxDuration = 15;

function escaparIlike(valor: string) {
  return valor.replace(/[\\%_]/g, (c) => '\\' + c);
}

export async function POST(req: NextRequest) {
  let body: { email?: string; nombre_usuario?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición no válida.' }, { status: 400 });
  }

  const email = (body.email ?? '').trim();
  const nombreUsuario = (body.nombre_usuario ?? '').trim();
  if (!email || !nombreUsuario) {
    return NextResponse.json({ error: 'Faltan datos.' }, { status: 400 });
  }

  let admin;
  try {
    admin = crearClienteAdmin();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const [porEmail, porUsuario] = await Promise.all([
    admin.from('perfiles').select('id').ilike('email', escaparIlike(email)).limit(1),
    admin.from('perfiles').select('id').ilike('nombre_usuario', escaparIlike(nombreUsuario)).limit(1),
  ]);

  if (porEmail.error || porUsuario.error) {
    return NextResponse.json({ error: 'No se ha podido comprobar.' }, { status: 500 });
  }

  return NextResponse.json({
    email_libre: (porEmail.data ?? []).length === 0,
    usuario_libre: (porUsuario.data ?? []).length === 0,
  });
}
