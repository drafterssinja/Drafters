'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Perfil } from '@/lib/supabaseClient';

// Sesión + perfil + acceso a Drafters V2 (perfiles.acceso_v2, o admin).
export function useSesionV2() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'sin_acceso'>('cargando');

  useEffect(() => {
    let activo = true;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }
      const { data } = await supabase.from('perfiles').select('*').eq('id', session.user.id).single();
      if (!activo) return;
      const p = data as Perfil | null;
      setPerfil(p);
      setEstado(p && (p.acceso_v2 || p.rol === 'admin') ? 'ok' : 'sin_acceso');
    })();
    return () => {
      activo = false;
    };
  }, [router]);

  return { perfil, estado };
}
