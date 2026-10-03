'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { traducirErrorAuth } from '@/lib/authErrors';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';

// Solo letras/números/guion bajo/punto, sin espacios — es el nombre que
// verán el resto de jugadores en las salas, así que tiene que ser corto y
// sin caracteres raros.
const NOMBRE_USUARIO_REGEX = /^[a-zA-Z0-9_.]{3,20}$/;

export default function RegistroPage() {
  const router = useRouter();
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [nombreUsuario, setNombreUsuario] = useState('');
  const [usuarioDisponible, setUsuarioDisponible] = useState<boolean | null>(null);
  const [comprobandoUsuario, setComprobandoUsuario] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [fechaNacimiento, setFechaNacimiento] = useState('');
  // Consentimiento de notificaciones por email (nuevo, 03/10, pedido de
  // Iñi): "un campo que tiene que ser obligatorio contestar, justo debajo
  // del email... sí o no, sobre si consientes recibir información y
  // notificaciones de inicio de porras" — null a propósito (ninguna opción
  // premarcada) hasta que el usuario pulse Sí o No; se valida en el envío
  // igual que los términos. Se guarda en perfiles.acepta_notificaciones_email
  // vía handle_new_user() (drafters-schema.sql) y controla en exclusiva a
  // quién le llega el aviso automático de nueva porra.
  const [aceptaNotificaciones, setAceptaNotificaciones] = useState<boolean | null>(null);
  const [terminos, setTerminos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  // Se activa cuando Supabase responde sin ninguna "identity" nueva — ver el
  // comentario junto a su uso más abajo (pedido de Iñi, 23/09).
  const [emailYaUsado, setEmailYaUsado] = useState(false);

  // Comprueba la disponibilidad del nombre de usuario en cuanto el usuario
  // deja el campo, para avisar antes de intentar crear la cuenta entera (en
  // vez de que se entere solo si el registro completo falla al final).
  async function comprobarUsuario() {
    const valor = nombreUsuario.trim();
    if (!NOMBRE_USUARIO_REGEX.test(valor)) {
      setUsuarioDisponible(null);
      return;
    }
    setComprobandoUsuario(true);
    const { data, error: rpcError } = await supabase.rpc('nombre_usuario_disponible', {
      p_nombre_usuario: valor,
    });
    setComprobandoUsuario(false);
    if (rpcError) {
      // No bloqueamos el registro si la comprobación en sí falla (por
      // ejemplo, por no tener aún la función instalada en la base de
      // datos) — se seguirá comprobando de todas formas al enviar.
      setUsuarioDisponible(null);
      return;
    }
    setUsuarioDisponible(Boolean(data));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEmailYaUsado(false);

    if (aceptaNotificaciones === null) {
      setError('Tienes que indicar si quieres recibir avisos por email.');
      return;
    }
    if (!terminos) {
      setError('Tienes que aceptar los términos para continuar.');
      return;
    }
    if (!NOMBRE_USUARIO_REGEX.test(nombreUsuario.trim())) {
      setError('El nombre de usuario debe tener entre 3 y 20 caracteres, sin espacios (solo letras, números, "_" y ".").');
      return;
    }
    if (usuarioDisponible === false) {
      setError('Ese nombre de usuario ya está en uso. Elige otro.');
      return;
    }
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== passwordConfirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setCargando(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          nombre,
          apellido,
          nombre_usuario: nombreUsuario.trim(),
          fecha_nacimiento: fechaNacimiento,
          terminos_aceptados: true,
          acepta_notificaciones_email: aceptaNotificaciones,
        },
      },
    });
    setCargando(false);

    if (signUpError) {
      setError(traducirErrorAuth(signUpError.message));
      return;
    }

    // Supabase, para no revelar qué emails están registrados, puede
    // responder "éxito" sin ninguna "identity" nueva tanto si el email ya
    // tiene una cuenta CONFIRMADA como, según la versión, si ya existe pero
    // SIN confirmar — no hay forma fiable de distinguir los dos casos desde
    // aquí (corregido 23/09: antes dábamos por hecho que esto solo pasaba
    // con cuentas confirmadas, y eso dejaba bloqueado sin ninguna salida a
    // quien de verdad tenía una cuenta a medio verificar — "ese correo ya no
    // me deja"). Como no podemos saber cuál de los dos casos es, ofrecemos
    // las dos salidas: iniciar sesión (si ya está confirmada) o ir a
    // verificar el email (si no lo estaba — desde ahí "Reenviar código" pide
    // uno nuevo aunque este intento de registro no lo haya mandado).
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      setEmailYaUsado(true);
      setError('Ya hay una cuenta con este email, o todavía no la has verificado.');
      return;
    }

    router.push(`/verificar?email=${encodeURIComponent(email)}`);
  }

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader />
        <div style={S.formSection}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 style={{ fontSize: 30, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>
              Únete a Drafters
            </h1>
            <p style={{ fontSize: 14, color: S.MUTED, margin: 0 }}>Crea tu cuenta y arma tu primer equipo.</p>
          </div>

          <form onSubmit={onSubmit} style={S.fieldGroup}>
            <div style={S.field}>
              <span style={S.label}>Nombre</span>
              <input required placeholder="Tu nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} style={S.input} />
            </div>

            <div style={S.field}>
              <span style={S.label}>Apellido</span>
              <input required placeholder="Tu apellido" value={apellido} onChange={(e) => setApellido(e.target.value)} style={S.input} />
            </div>

            <div style={S.field}>
              <span style={S.label}>Nombre de usuario</span>
              <input
                required
                minLength={3}
                maxLength={20}
                placeholder="Como te verán los demás en las salas"
                value={nombreUsuario}
                onChange={(e) => {
                  setNombreUsuario(e.target.value);
                  setUsuarioDisponible(null);
                }}
                onBlur={comprobarUsuario}
                style={S.input}
              />
              {comprobandoUsuario && <span style={{ fontSize: 11, color: S.MUTED_3 }}>Comprobando disponibilidad...</span>}
              {!comprobandoUsuario && usuarioDisponible === false && (
                <span style={{ fontSize: 11, color: S.ERROR }}>Ese nombre de usuario ya está en uso.</span>
              )}
              {!comprobandoUsuario && usuarioDisponible === true && (
                <span style={{ fontSize: 11, color: S.ACCENT }}>Disponible.</span>
              )}
            </div>

            <div style={S.field}>
              <span style={S.label}>Email</span>
              <input
                type="email"
                required
                placeholder="tucorreo@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={S.input}
              />
            </div>

            <div style={S.field}>
              <span style={S.label}>¿Quieres recibir información y avisos de inicio de porras por email?</span>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setAceptaNotificaciones(true)}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    borderRadius: 10,
                    fontFamily: "'Manrope', sans-serif",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                    border: `1.5px solid ${aceptaNotificaciones === true ? S.ACCENT : S.BORDER}`,
                    background: aceptaNotificaciones === true ? 'rgba(61,220,132,0.12)' : 'transparent',
                    color: aceptaNotificaciones === true ? S.ACCENT : S.MUTED_2,
                  }}
                >
                  Sí
                </button>
                <button
                  type="button"
                  onClick={() => setAceptaNotificaciones(false)}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    borderRadius: 10,
                    fontFamily: "'Manrope', sans-serif",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                    border: `1.5px solid ${aceptaNotificaciones === false ? S.MUTED_2 : S.BORDER}`,
                    background: aceptaNotificaciones === false ? 'rgba(139,149,143,0.14)' : 'transparent',
                    color: aceptaNotificaciones === false ? S.TEXT : S.MUTED_2,
                  }}
                >
                  No
                </button>
              </div>
              <span style={{ fontSize: 11, color: S.MUTED_3 }}>Puedes cambiarlo más adelante escribiéndonos.</span>
            </div>

            <div style={S.field}>
              <span style={S.label}>Fecha de nacimiento</span>
              <input
                type="date"
                required
                value={fechaNacimiento}
                onChange={(e) => setFechaNacimiento(e.target.value)}
                style={S.input}
              />
              <span style={{ fontSize: 11, color: S.MUTED_3 }}>Debes ser mayor de 18 años para jugar.</span>
            </div>

            <div style={S.field}>
              <span style={S.label}>Contraseña</span>
              <input
                type="password"
                required
                minLength={8}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={S.input}
              />
            </div>

            <div style={S.field}>
              <span style={S.label}>Confirmar contraseña</span>
              <input
                type="password"
                required
                minLength={8}
                placeholder="••••••••"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                style={S.input}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 4 }}>
              <input
                type="checkbox"
                checked={terminos}
                onChange={(e) => setTerminos(e.target.checked)}
                style={{ width: 18, height: 18, marginTop: 1, accentColor: S.ACCENT, flexShrink: 0 }}
              />
              <span style={{ fontSize: 12, lineHeight: 1.5, color: S.MUTED_2 }}>
                Acepto los <a href="#" style={{ color: S.ACCENT }}>Términos y condiciones</a> y la{' '}
                <a href="#" style={{ color: S.ACCENT }}>Política de privacidad</a>.
              </span>
            </div>

            {error && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <p style={S.errorText}>{error}</p>
                {emailYaUsado && (
                  <div style={{ display: 'flex', gap: 14 }}>
                    <Link href="/login" style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12.5, color: S.ACCENT }}>
                      Iniciar sesión →
                    </Link>
                    <Link
                      href={`/verificar?email=${encodeURIComponent(email)}`}
                      style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12.5, color: S.ACCENT }}
                    >
                      Verificar mi email →
                    </Link>
                  </div>
                )}
              </div>
            )}

            <button type="submit" disabled={cargando} style={{ ...S.primaryButton, opacity: cargando ? 0.7 : 1 }}>
              {cargando ? 'Creando cuenta...' : 'Crear cuenta'}
            </button>
          </form>

          <p style={S.footerNote}>
            ¿Ya tienes cuenta?{' '}
            <Link href="/login" style={{ color: S.ACCENT }}>Inicia sesión</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
