'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, type Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import Cargando from '@/components/Cargando';
import * as S from '@/lib/mockupStyles';
import { formatEuros } from '@/lib/salaShared';

// Marco de las pantallas sencillas con sesión (cabecera de siempre + contenido).
export function usePerfil() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  useEffect(() => {
    let activo = true;
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }
      const { data } = await supabase.from('perfiles').select('*').eq('id', session.user.id).single();
      if (activo && data) setPerfil(data as Perfil);
    })();
    return () => {
      activo = false;
    };
  }, [router]);
  return perfil;
}

export default function MarcoSimple({ perfil, cargando = false, volverA, children }: { perfil: Perfil | null; cargando?: boolean; volverA?: string; children: ReactNode }) {
  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={perfil ? formatEuros(perfil.saldo_simulado) : undefined} accountInitials={perfil ? S.iniciales(perfil.nombre, perfil.apellido) : undefined} volverA={volverA} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '24px 20px 64px' }}>{!perfil || cargando ? <Cargando /> : children}</div>
      </div>
    </main>
  );
}
