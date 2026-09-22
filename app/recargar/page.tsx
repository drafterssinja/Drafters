'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';

const RECARGA_OPCIONES = [10, 25, 50, 100];

export default function RecargarPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [cargando, setCargando] = useState(true);
  const [recargando, setRecargando] = useState(false);
  const [confirmacion, setConfirmacion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;

    async function cargar() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      const { data, error: perfilError } = await supabase.from('perfiles').select('*').eq('id', session.user.id).single();
      if (!activo) return;
      if (perfilError) setError('No se ha podido cargar tu saldo. Inténtalo de nuevo.');
      else setPerfil(data as Perfil);
      setCargando(false);
    }

    cargar();
    return () => {
      activo = false;
    };
  }, [router]);

  async function recargar(monto: number) {
    setError(null);
    setConfirmacion(null);
    setRecargando(true);
    const { data, error: rpcError } = await supabase.rpc('registrar_movimiento', {
      p_tipo: 'deposito',
      p_importe: monto,
    });
    setRecargando(false);
    if (rpcError) {
      setError('No se ha podido completar la recarga. Inténtalo de nuevo.');
      return;
    }
    setPerfil(data as Perfil);
    setConfirmacion(`Has añadido ${monto} € a tu saldo.`);
  }

  if (cargando || !perfil) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader />
          <div style={S.accountSection}>
            <p style={{ fontSize: 14, color: S.MUTED }}>Cargando...</p>
          </div>
        </div>
      </main>
    );
  }

  const saldoLabel = `${perfil.saldo_simulado.toFixed(2)} €`;
  const initials = S.iniciales(perfil.nombre, perfil.apellido);

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
        <div style={S.accountSection}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>
              Recargar saldo
            </h1>
            <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>
              Saldo actual: <span style={{ color: S.TEXT, fontWeight: 700 }}>{saldoLabel}</span>
            </p>
          </div>

          {confirmacion && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', background: 'rgba(61,220,132,0.12)', border: '1px solid rgba(61,220,132,0.4)', borderRadius: 10 }}>
              <span style={{ color: S.ACCENT, fontSize: 15, flexShrink: 0 }}>✓</span>
              <span style={{ fontSize: 12.5, color: '#C9D2CC' }}>{confirmacion}</span>
            </div>
          )}
          {error && <p style={S.errorText}>{error}</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={S.sectionLabel}>Elige un importe</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {RECARGA_OPCIONES.map((monto) => (
                <button
                  key={monto}
                  type="button"
                  disabled={recargando}
                  onClick={() => recargar(monto)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: S.PANEL,
                    border: `1px solid ${S.CARD_BORDER}`,
                    borderRadius: 12,
                    padding: 18,
                    cursor: 'pointer',
                    opacity: recargando ? 0.6 : 1,
                  }}
                >
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color: S.TEXT }}>
                    +{monto} €
                  </span>
                </button>
              ))}
            </div>
          </div>

          <span style={{ fontSize: 10, color: S.FAINT }}>
            *Saldo simulado (€) — no hay pasarela de pago real conectada.
          </span>
        </div>
      </div>
    </main>
  );
}
