'use client';

import { Suspense, useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { traducirErrorAuth } from '@/lib/authErrors';
import BackButton from '@/components/BackButton';

function VerificarForm() {
  const router = useRouter();
  const params = useSearchParams();
  const emailInicial = params.get('email') ?? '';
  const [email, setEmail] = useState(emailInicial);
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reenviado, setReenviado] = useState(false);
  const [cargando, setCargando] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
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

    router.push('/cuenta');
  }

  async function reenviarCodigo() {
    setError(null);
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email,
    });
    if (resendError) {
      setError(traducirErrorAuth(resendError.message));
      return;
    }
    setReenviado(true);
  }

  return (
    <main>
      <BackButton />
      <h1>Verifica tu email</h1>
      <p className="subtitle">
        Te hemos enviado un código a tu email. Escríbelo aquí para activar tu cuenta.
      </p>
      <form onSubmit={onSubmit}>
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
          <label htmlFor="codigo">Código de verificación</label>
          <input
            id="codigo"
            required
            inputMode="numeric"
            placeholder="123456"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
          />
        </div>
        {error && <p className="error-msg">{error}</p>}
        {reenviado && <p className="info-msg">Código reenviado. Revisa tu email.</p>}
        <button type="submit" disabled={cargando}>
          {cargando ? 'Verificando...' : 'Verificar'}
        </button>
      </form>
      <button className="secondary" onClick={reenviarCodigo} type="button">
        Reenviar código
      </button>
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
