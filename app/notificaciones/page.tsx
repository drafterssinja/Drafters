'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { formatEuros } from '@/lib/salaShared';

// ============================================================================
// NOTIFICACIONES (pedido de Iñi, 23/09)
// ============================================================================
// No hay pantalla equivalente en la maqueta visual — se sigue el mismo
// lenguaje del resto de la app (S.PANEL, misma cabecera, mismas tarjetas).
// Al entrar aquí se marcan como leídas todas las que estuvieran pendientes
// (por eso el puntito rojo de la cabecera desaparece al volver de esta
// pantalla), pero la propia lista sigue señalando cuáles eran nuevas en el
// momento de abrirla, para que no "desaparezcan" visualmente de golpe.

type NotificacionRow = {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string;
  leido: boolean;
  link: string | null;
  created_at: string;
};

const ICONO_TIPO: Record<string, string> = {
  trasladado: '↔',
  reembolsado: '€',
  eliminado: '⚠',
  resultado: '🏆',
  nuevo_usuario: '👤',
};

export default function NotificacionesPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [notificaciones, setNotificaciones] = useState<NotificacionRow[]>([]);
  const [eranNuevas, setEranNuevas] = useState<Set<string>>(new Set());
  const [cargando, setCargando] = useState(true);
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

      const [{ data: perfilData }, { data: notisData, error: notisError }] = await Promise.all([
        supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
        supabase.from('notificaciones').select('id, tipo, titulo, mensaje, leido, link, created_at').order('created_at', { ascending: false }),
      ]);

      if (!activo) return;

      if (perfilData) setPerfil(perfilData as Perfil);

      if (notisError) {
        setError('No se han podido cargar tus notificaciones.');
        setCargando(false);
        return;
      }

      const filas = (notisData as NotificacionRow[]) ?? [];
      setNotificaciones(filas);
      setEranNuevas(new Set(filas.filter((n) => !n.leido).map((n) => n.id)));
      setCargando(false);

      // Marca como leídas todas las que llegaron sin leer — así el puntito
      // rojo de la cabecera se pone a cero al volver de esta pantalla.
      const idsSinLeer = filas.filter((n) => !n.leido).map((n) => n.id);
      if (idsSinLeer.length > 0) {
        await supabase.from('notificaciones').update({ leido: true }).in('id', idsSinLeer);
      }
    }

    cargar();
    return () => {
      activo = false;
    };
  }, [router]);

  if (cargando || !perfil) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader />
          <div style={{ padding: '40px 20px' }}>
            <p style={{ fontSize: 14, color: S.MUTED }}>Cargando...</p>
          </div>
        </div>
      </main>
    );
  }

  const saldoLabel = formatEuros(perfil.saldo_simulado);
  const initials = S.iniciales(perfil.nombre, perfil.apellido);

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '28px 20px 60px' }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>
            Notificaciones
          </h1>

          {error && <p style={S.errorText}>{error}</p>}

          {!error && notificaciones.length === 0 && (
            <p style={{ fontSize: 13.5, color: S.MUTED_2 }}>Todavía no tienes ninguna notificación.</p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {notificaciones.map((n) => {
              const esNueva = eranNuevas.has(n.id);
              const contenido = (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    background: esNueva ? 'rgba(61,220,132,0.07)' : S.PANEL,
                    border: `1px solid ${esNueva ? 'rgba(61,220,132,0.3)' : S.CARD_BORDER}`,
                    borderRadius: 12,
                    padding: '13px 14px',
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: 30,
                      height: 30,
                      borderRadius: '50%',
                      background: '#1E2723',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                    }}
                  >
                    {ICONO_TIPO[n.tipo] ?? '•'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 13.5, color: S.TEXT }}>{n.titulo}</span>
                      {esNueva && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FF5C5C', flexShrink: 0 }} />}
                    </div>
                    <span style={{ fontSize: 12.5, color: S.MUTED_2, lineHeight: 1.4 }}>{n.mensaje}</span>
                    <span style={{ fontSize: 10.5, color: S.MUTED_3 }}>{new Date(n.created_at).toLocaleString('es-ES')}</span>
                  </div>
                  {n.link && <span style={{ flexShrink: 0, color: '#3DDC84', fontSize: 16, fontWeight: 700 }}>→</span>}
                </div>
              );

              return n.link ? (
                <Link key={n.id} href={n.link} style={{ textDecoration: 'none' }}>
                  {contenido}
                </Link>
              ) : (
                <div key={n.id}>{contenido}</div>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}
