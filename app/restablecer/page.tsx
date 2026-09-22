'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { traducirErrorAuth } from '@/lib/authErrors';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';

// Pantalla a la que llega el usuario tras pulsar el enlace del correo de
// "Recupera tu contraseña" (/recuperar). Supabase, gracias a
// detectSessionInUrl en supabaseClient.ts, establece automáticamente una
// sesión de recuperación al volver de ese enlace y dispara el evento
// PASSWORD_RECOVERY — hasta que no lo vemos, no mostramos el formulario
// (para no dejar escribir una contraseña que luego no se pueda guardar).
export default function RestablecerPage() {
  const router = useRouter();
  const [listo, setListo] = useState(false);
  const [enlaceInvalido, setEnlaceInvalido] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState(false);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setListo(true);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setListo(true);
    });

    const timeout = setTimeout(() => {
      setListo((yaListo) => {
        if (!yaListo) setEnlaceInvalido(true);
        return yaListo;
      });
    }, 4000);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== passwordConfirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setGuardando(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setGuardando(false);

    if (updateError) {
      setError(traducirErrorAuth(updateError.message));
      return;
    }

    setGuardadoOk(true);
    setTimeout(() => router.push('/cuenta'), 1500);
  }

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader />
        <div style={S.centeredFormSection()}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>
              Crea tu nueva contraseña
            </h1>
            <p style={{ fontSize: 14, color: S.MUTED, margin: 0 }}>Escribe la nueva contraseña para tu cuenta de Drafters.</p>
          </div>

          {!listo && !enlaceInvalido && <p style={{ fontSize: 14, color: S.MUTED_2 }}>Comprobando el enlace...</p>}

          {enlaceInvalido && !guardadoOk && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={S.errorText}>Este enlace no es válido o ha caducado.</p>
              <Link href="/recuperar" style={{ fontSize: 13, color: S.ACCENT }}>Pedir un enlace nuevo →</Link>
            </div>
          )}

          {listo && !guardadoOk && (
            <form onSubmit={onSubmit} style={S.fieldGroup}>
              <div style={S.field}>
                <span style={S.label}>Nueva contraseña</span>
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

              {error && <p style={S.errorText}>{error}</p>}

              <button type="submit" disabled={guardando} style={{ ...S.primaryButton, opacity: guardando ? 0.7 : 1 }}>
                {guardando ? 'Guardando...' : 'Guardar contraseña'}
              </button>
            </form>
          )}

          {guardadoOk && <p style={S.infoText}>Contraseña actualizada. Entrando en tu cuenta...</p>}
        </div>
      </div>
    </main>
  );
}
