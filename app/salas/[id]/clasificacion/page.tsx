'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { formatEuros } from '@/lib/salaShared';

// ============================================================================
// CLASIFICACIÓN EN DIRECTO — todavía por construir
// ============================================================================
// Requiere el motor de puntuación en directo (resultados_evento) y la
// liquidación de premios, ninguno de los dos construidos todavía. El banner
// "sala completa · ha empezado" del detalle de sala ya enlaza aquí para no
// dejar un enlace roto.
export default function ClasificacionPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [perfil, setPerfil] = useState<Perfil | null>(null);

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
      const { data } = await supabase.from('perfiles').select('*').eq('id', session.user.id).single();
      if (activo && data) setPerfil(data as Perfil);
    }
    cargar();
    return () => {
      activo = false;
    };
  }, [router]);

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={perfil ? formatEuros(perfil.saldo_simulado) : '···'} accountInitials={perfil ? S.iniciales(perfil.nombre, perfil.apellido) : '·'} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '48px 24px', alignItems: 'center', textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif" }}>Clasificación en directo — próximamente</h1>
          <p style={{ fontSize: 14, color: S.MUTED_2, lineHeight: 1.6 }}>
            La puntuación jugada a jugada y el reparto final de premios todavía no están conectados a datos en directo.
          </p>
          <Link href={`/salas/${params.id}`} style={{ ...S.secondaryLinkButton, width: 'auto', padding: '12px 24px', textDecoration: 'none', display: 'inline-flex' }}>
            Volver a la sala
          </Link>
        </div>
      </div>
    </main>
  );
}
