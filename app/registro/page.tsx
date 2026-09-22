'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { traducirErrorAuth } from '@/lib/authErrors';
import BackButton from '@/components/BackButton';

export default function RegistroPage() {
  const router = useRouter();
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [nombreUsuario, setNombreUsuario] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fechaNacimiento, setFechaNacimiento] = useState('');
  const [terminos, setTerminos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  // Solo letras/números/guion bajo/punto, sin espacios — es el nombre que
  // verán el resto de jugadores en las salas, así que tiene que ser corto y
  // sin caracteres raros.
  const NOMBRE_USUARIO_REGEX = /^[a-zA-Z0-9_.]{3,20}$/;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!terminos) {
      setError('Tienes que aceptar los términos para continuar.');
      return;
    }
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (!NOMBRE_USUARIO_REGEX.test(nombreUsuario.trim())) {
      setError('El nombre de usuario debe tener entre 3 y 20 caracteres, sin espacios (solo letras, números, "_" y ".").');
      return;
    }

    setCargando(true);
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          nombre,
          apellido,
          nombre_usuario: nombreUsuario.trim(),
          fecha_nacimiento: fechaNacimiento,
          terminos_aceptados: true,
        },
      },
    });
    setCargando(false);

    if (signUpError) {
      setError(traducirErrorAuth(signUpError.message));
      return;
    }

    // Supabase manda un código de verificación al email (plantilla "Confirm
    // signup" configurada para enviar {{ .Token }} en vez del enlace).
    router.push(`/verificar?email=${encodeURIComponent(email)}`);
  }

  return (
    <main>
      <BackButton />
      <h1>Crear cuenta</h1>
      <p className="subtitle">Regístrate en Drafters.</p>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="nombre">Nombre</label>
          <input
            id="nombre"
            required
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="apellido">Apellido</label>
          <input
            id="apellido"
            required
            value={apellido}
            onChange={(e) => setApellido(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="nombreUsuario">Nombre de usuario</label>
          <input
            id="nombreUsuario"
            required
            minLength={3}
            maxLength={20}
            placeholder="Como te verán los demás en las salas"
            value={nombreUsuario}
            onChange={(e) => setNombreUsuario(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="fechaNacimiento">Fecha de nacimiento</label>
          <input
            id="fechaNacimiento"
            type="date"
            required
            value={fechaNacimiento}
            onChange={(e) => setFechaNacimiento(e.target.value)}
          />
        </div>
        <div className="checkbox-field">
          <input
            id="terminos"
            type="checkbox"
            checked={terminos}
            onChange={(e) => setTerminos(e.target.checked)}
          />
          <label htmlFor="terminos" style={{ margin: 0 }}>
            Acepto los términos y condiciones de Drafters.
          </label>
        </div>
        {error && <p className="error-msg">{error}</p>}
        <button type="submit" disabled={cargando}>
          {cargando ? 'Creando cuenta...' : 'Crear cuenta'}
        </button>
      </form>
      <p className="subtitle">
        ¿Ya tienes cuenta? <a href="/login">Inicia sesión</a>
      </p>
    </main>
  );
}
