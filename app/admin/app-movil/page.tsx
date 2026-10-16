'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import Cargando from '@/components/Cargando';

// ============================================================================
// APP EN EL MÓVIL — ESTADÍSTICAS (13/10, pedido de Iñi)
// ============================================================================
// Cuántos usuarios tienen Drafters en la pantalla de inicio (iPhone/Android),
// cuántas veces la abren desde el icono y cuántos pulsan el botón "Añadir".
// iPhone no avisa al instalar: cuenta como "tiene la app" quien la ha abierto
// alguna vez desde el icono. Nadie avisa al desinstalar: por eso se muestran
// también los activos de los últimos 7 días. Datos: estadisticas_app_movil()
// (30_sql_estadisticas_app_movil_13-10.sql).

type Estadisticas = {
  usuarios_total: number;
  con_app: { ios: number; android: number; total: number };
  aperturas: { hoy: number; dias_7: number; dias_30: number };
  activos_7_dias: { ios: number; android: number };
  clics_boton: { ios: number; android: number };
  usuarios: { nombre_usuario: string | null; plataforma: string; desde: string; ultima_apertura: string | null; aperturas: number }[];
};

function fecha(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
}

function Cifra({ titulo, valor, detalle }: { titulo: string; valor: string | number; detalle?: string }) {
  return (
    <div style={{ flex: '1 1 140px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_2 }}>{titulo}</span>
      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 28, color: S.ACCENT }}>{valor}</span>
      {detalle && <span style={{ fontSize: 11.5, color: S.MUTED_2 }}>{detalle}</span>}
    </div>
  );
}

export default function AdminAppMovilPage() {
  const router = useRouter();
  const [datos, setDatos] = useState<Estadisticas | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return router.push('/login');
      const { data: p } = await supabase.from('perfiles').select('rol').eq('id', session.user.id).single();
      if (!p || p.rol !== 'admin') return router.push('/cuenta');
      const { data, error: e } = await supabase.rpc('estadisticas_app_movil');
      if (e) setError(e.message.includes('estadisticas_app_movil') ? 'Falta ejecutar 30_sql_estadisticas_app_movil_13-10.sql en Supabase.' : e.message);
      else setDatos(data as Estadisticas);
    })();
  }, [router]);

  const pct = (n: number) => (datos && datos.usuarios_total > 0 ? `${Math.round((n / datos.usuarios_total) * 100)} % de los usuarios` : '');

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader sinVolver />
        <div style={{ ...S.accountSection, gap: 14 }}>
          <Link href="/admin" style={{ fontSize: 12, color: S.MUTED_2, textDecoration: 'none' }}>← Panel de administración</Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>App en el móvil</h1>
          <p style={{ fontSize: 12.5, color: S.MUTED_2, margin: 0 }}>
            iPhone no avisa al instalar: cuenta como &quot;tiene la app&quot; quien la ha abierto alguna vez desde el icono. Las desinstalaciones no se pueden saber; por eso se muestran también los activos de los últimos 7 días.
          </p>
          {error && <p style={{ fontSize: 13, color: S.ERROR, margin: 0 }}>{error}</p>}
          {!datos && !error && <Cargando compacto />}
          {datos && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <Cifra titulo="Con la app" valor={datos.con_app.total} detalle={pct(datos.con_app.total)} />
                <Cifra titulo="iPhone" valor={datos.con_app.ios} detalle={`${datos.activos_7_dias.ios} activos en 7 días`} />
                <Cifra titulo="Android" valor={datos.con_app.android} detalle={`${datos.activos_7_dias.android} activos en 7 días`} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <Cifra titulo="Aperturas hoy" valor={datos.aperturas.hoy} />
                <Cifra titulo="Últimos 7 días" valor={datos.aperturas.dias_7} />
                <Cifra titulo="Últimos 30 días" valor={datos.aperturas.dias_30} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <Cifra titulo="Pulsaron «Añadir a iPhone»" valor={datos.clics_boton.ios} detalle={`${datos.con_app.ios} la tienen`} />
                <Cifra titulo="Pulsaron «Añadir a Android»" valor={datos.clics_boton.android} detalle={`${datos.con_app.android} la tienen`} />
              </div>

              <span style={S.sectionLabel}>Usuarios con la app ({datos.usuarios.length})</span>
              {datos.usuarios.length === 0 && <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>Todavía nadie la ha instalado o abierto desde el icono.</p>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {datos.usuarios.map((u, i) => (
                  <div key={`${u.nombre_usuario}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 10 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: S.TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{u.nombre_usuario ?? '—'}</span>
                    <span style={{ flexShrink: 0, fontSize: 11, color: S.MUTED_2, width: 56 }}>{u.plataforma === 'ios' ? 'iPhone' : u.plataforma === 'android' ? 'Android' : 'Otro'}</span>
                    <span style={{ flexShrink: 0, fontSize: 11, color: S.MUTED_2, width: 76, textAlign: 'right' }}>{u.aperturas} aperturas</span>
                    <span style={{ flexShrink: 0, fontSize: 11, color: S.MUTED_3, width: 86, textAlign: 'right' }}>{fecha(u.ultima_apertura ?? u.desde)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
