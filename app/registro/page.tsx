'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function RegistroPage() {
  const router = useRouter();
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fechaNacimiento, setFechaNacimiento] = useState('');
  const [terminos, setTerminos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

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

    setCargando(true);
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          nombre,
          fecha_nacimiento: fechaNacimiento,
          terminos_aceptados: true,
        },
      },
    });
    setCargando(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    // Supabase manda un código de verificación al email (plantilla "Confirm
    // signup" configurada para enviar {{ .Token }} en vez del enlace).
    router.push(`/verificar?email=${encodeURIComponent(email)}`);
  }

  return (
    <main>
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
