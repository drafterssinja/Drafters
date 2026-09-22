'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { traducirErrorAuth } from '@/lib/authErrors';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [necesitaVerificar, setNecesitaVerificar] = useState(false);
  const [cargando, setCargando] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNecesitaVerificar(false);
    setCargando(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setCargando(false);

    if (signInError) {
      // Caso concreto: el email todavía no se ha verificado. Además del
      // mensaje, ofrecemos ir directos a la pantalla de verificación en vez
      // de dejar al usuario sin ninguna forma clara de continuar.
      if (/email not confirmed/i.test(signInError.message)) {
        setNecesitaVerificar(true);
      }
      setError(traducirErrorAuth(signInError.message));
      return;
    }

    router.push('/inicio');
  }

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader />
        <div style={S.centeredFormSection()}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 style={{ fontSize: 30, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>
              Inicia sesión
            </h1>
            <p style={{ fontSize: 14, color: S.MUTED, margin: 0 }}>Accede a tu cuenta de Drafters.</p>
          </div>

          <form onSubmit={onSubmit} style={S.fieldGroup}>
            <div style={S.field}>
              <span style={S.label}>Usuario o email</span>
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="tucorreo@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={S.input}
              />
            </div>
            <div style={S.field}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={S.label}>Contraseña</span>
                <Link href="/recuperar" style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 12, color: S.ACCENT }}>
                  ¿Has olvidado tu contraseña?
                </Link>
              </div>
              <input
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={S.input}
              />
            </div>

            {error && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <p style={S.errorText}>{error}</p>
                {necesitaVerificar && (
                  <Link
                    href={`/verificar?email=${encodeURIComponent(email)}`}
                    style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12.5, color: S.ACCENT }}
                  >
                    Ir a verificar mi email →
                  </Link>
                )}
              </div>
            )}

            <button type="submit" disabled={cargando} style={{ ...S.primaryButton, opacity: cargando ? 0.7 : 1 }}>
              {cargando ? 'Entrando...' : 'Iniciar sesión'}
            </button>
          </form>

          <p style={S.footerNote}>
            ¿No tienes cuenta todavía?{' '}
            <Link href="/registro" style={{ color: S.ACCENT }}>Únete</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
