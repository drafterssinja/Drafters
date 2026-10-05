import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';

// Login con NOMBRE DE USUARIO (05/10, pedido de Iñi: "ese login tiene que
// poder probar con el nombre de usuario o con el correo"). Con email, la
// pantalla de login sigue llamando directamente a Supabase. Con nombre de
// usuario, el email NO se puede resolver desde el navegador sin exponer los
// emails de todos los jugadores, así que se hace aquí, en servidor: se busca
// el email de ese usuario, se inicia sesión con la contraseña y se devuelven
// solo los tokens de sesión (el navegador los instala con setSession). Nunca
// se devuelve el email. Si el usuario no existe se responde exactamente igual
// que con una contraseña errónea, para no revelar qué usuarios existen.
export const maxDuration = 30;

const ERROR_GENERICO = 'Invalid login credentials';

export async function POST(req: NextRequest) {
  let body: { identificador?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Petición no válida.' }, { status: 400 });
  }
  const identificador = (body.identificador ?? '').trim();
  const password = body.password ?? '';
  if (!identificador || !password) {
    return NextResponse.json({ error: ERROR_GENERICO }, { status: 400 });
  }

  let admin;
  try {
    admin = crearClienteAdmin();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  let email = identificador;
  if (!identificador.includes('@')) {
    const { data: perfil } = await admin
      .from('perfiles')
      .select('id, email')
      .ilike('nombre_usuario', identificador.replace(/[\\%_]/g, (c) => '\\' + c))
      .maybeSingle();
    if (!perfil) return NextResponse.json({ error: ERROR_GENERICO }, { status: 400 });
    let emailPerfil: string | null = perfil.email ?? null;
    if (!emailPerfil) {
      const { data: u } = await admin.auth.admin.getUserById(perfil.id);
      emailPerfil = u?.user?.email ?? null;
    }
    if (!emailPerfil) return NextResponse.json({ error: ERROR_GENERICO }, { status: 400 });
    email = emailPerfil;
  }

  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    return NextResponse.json({ error: error?.message ?? ERROR_GENERICO }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
}
