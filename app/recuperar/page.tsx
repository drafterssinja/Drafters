'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { traducirErrorAuth } from '@/lib/authErrors';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';

// Pantalla "Recupera tu contraseña" (isForgot en la maqueta). Manda el
// enlace de recuperación de Supabase, que lleva a /restablecer para escribir
// la contraseña nueva.
export default function RecuperarPage() {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/restablecer` : undefined,
    });

    setCargando(false);

    if (resetError) {
      setError(traducirErrorAuth(resetError.message));
      return;
    }

    setEnviado(true);
  }

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader />
        <div style={S.centeredFormSection()}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>
              Recupera tu contraseña
            </h1>
            <p style={{ fontSize: 14, color: S.MUTED, margin: 0 }}>Te enviamos un enlace para crear una nueva.</p>
          </div>

          <form onSubmit={onSubmit} style={S.fieldGroup}>
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

            {error && <p style={S.errorText}>{error}</p>}
            {enviado && (
              <p style={S.infoText}>
                Si existe una cuenta con ese email, te hemos enviado un enlace para restablecer la contraseña.
              </p>
            )}

            <button type="submit" disabled={cargando} style={{ ...S.primaryButton, opacity: cargando ? 0.7 : 1 }}>
              {cargando ? 'Enviando...' : 'Enviar enlace'}
            </button>
          </form>

          <Link href="/login" style={{ fontSize: 13, color: S.ACCENT, textAlign: 'center' }}>
            Volver a iniciar sesión
          </Link>
        </div>
      </div>
    </main>
  );
}
