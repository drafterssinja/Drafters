'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase, type Perfil } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import CabeceraV2 from '@/components/v2/CabeceraV2';
import Cargando from '@/components/Cargando';
import { puedeJugarPocha } from '@/lib/pocha';

// ============================================================================
// MARCO DE LA POCHA (19/10, Iñi): solo Iñi y Javier
// ============================================================================
// Sesión + comprobación de acceso (en la web por el email y, además, en la base
// de datos: pocha_tengo_acceso, SQL 58). A cualquier otro le sale "no existe".

export function useAccesoPocha() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'sin_acceso'>('cargando');
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }
      const [{ data: p }, { data: acceso, error }] = await Promise.all([
        supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
        supabase.rpc('pocha_tengo_acceso'),
      ]);
      if (!vivo) return;
      setPerfil(p as Perfil | null);
      const ok = puedeJugarPocha(session.user.email) && (error ? true : acceso === true);
      setEstado(ok ? 'ok' : 'sin_acceso');
    })();
    return () => {
      vivo = false;
    };
  }, [router]);
  return { perfil, estado };
}

export default function MarcoPocha({ perfil, estado, volverA, children }: { perfil: Perfil | null; estado: 'cargando' | 'ok' | 'sin_acceso'; volverA?: string; children: ReactNode }) {
  return (
    <main className="v2" style={S.mainReset}>
      <div style={S.pageFrame}>
        <CabeceraV2 perfil={estado === 'ok' ? perfil : null} deporte="pocha" volverA={volverA} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '18px 16px 64px' }}>
          {estado === 'cargando' && <Cargando />}
          {estado === 'sin_acceso' && (
            <div style={{ ...S.card, flexDirection: 'column', alignItems: 'flex-start' }}>
              <span style={{ fontWeight: 700, color: S.TEXT }}>Esta página no existe</span>
              <Link href="/v2/futbol" style={{ ...S.secondaryLinkButton, textAlign: 'center', textDecoration: 'none' }}>
                Volver
              </Link>
            </div>
          )}
          {estado === 'ok' && children}
        </div>
      </div>
    </main>
  );
}

export const ORO = '#F0B94D';
export const VERDE = '#3DDC84';
export const ROJO = '#FF8A8A';
