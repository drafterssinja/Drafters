'use client';

import { Suspense, useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { traducirErrorAuth } from '@/lib/authErrors';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';

function VerificarForm() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get('email') ?? '';
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reenviado, setReenviado] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [reenviando, setReenviando] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setReenviado(false);
    setCargando(true);

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: codigo,
      type: 'signup',
    });

    setCargando(false);

    if (verifyError) {
      setError(traducirErrorAuth(verifyError.message));
      return;
    }

    router.push('/inicio');
  }

  async function reenviarCodigo() {
    setError(null);
    setReenviado(false);
    setReenviando(true);
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email,
    });
    setReenviando(false);
    if (resendError) {
      setError(traducirErrorAuth(resendError.message));
      return;
    }
    setReenviado(true);
  }

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader />
        <div style={S.centeredFormSection()}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>
              Verifica tu email
            </h1>
            <p style={{ fontSize: 14, lineHeight: 1.5, color: S.MUTED, margin: 0 }}>
              Te hemos enviado un código de 6 dígitos a{' '}
              <span style={{ color: S.TEXT, fontWeight: 600 }}>{email || 'tu email'}</span>.
            </p>
          </div>

          <form onSubmit={onSubmit} style={S.fieldGroup}>
            <div style={S.field}>
              <span style={S.label}>Código de verificación</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                placeholder="000000"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                style={S.codeInput}
              />
            </div>

            {error && <p style={S.errorText}>{error}</p>}
            {reenviado && !error && <p style={S.infoText}>Código reenviado. Revisa tu email (también la carpeta de spam).</p>}

            <button type="submit" disabled={cargando} style={{ ...S.primaryButton, opacity: cargando ? 0.7 : 1 }}>
              {cargando ? 'Verificando...' : 'Verificar cuenta'}
            </button>
          </form>

          <p style={S.footerNote}>
            ¿No te ha llegado?{' '}
            <button
              type="button"
              onClick={reenviarCodigo}
              disabled={reenviando}
              style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: S.ACCENT, cursor: 'pointer' }}
            >
              {reenviando ? 'Enviando...' : 'Reenviar código'}
            </button>
          </p>
        </div>
      </div>
    </main>
  );
}

export default function VerificarPage() {
  return (
    <Suspense fallback={null}>
      <VerificarForm />
    </Suspense>
  );
}
