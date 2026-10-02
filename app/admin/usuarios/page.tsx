'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';

// ============================================================================
// LISTADO DE USUARIOS REGISTRADOS (nuevo, ronda de correcciones del 23/09)
// ============================================================================
// Pantalla propia a la que se llega pulsando el número de la tarjeta
// "Usuarios registrados" del panel de estadísticas de /admin — Iñi pidió
// explícitamente que NO fuera un listado siempre visible ahí mismo, sino
// algo a lo que se llega al pulsar. Muestra nombre de usuario, nombre real
// (nombre + apellido) y correo electrónico de cada perfil — el email sale
// de `perfiles.email` (copia de solo lectura de auth.users, rellenada por
// handle_new_user() al registrarse — ver drafters-schema.sql).

export default function AdminUsuariosPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [usuarios, setUsuarios] = useState<Perfil[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Acceso a Mesas Drafters por usuario (nuevo, 01/10, pedido de Iñi): de
  // serie todos en false — el admin los habilita uno a uno aquí mismo,
  // p.ej. para su socio Javi Murúa, mientras las Mesas Drafters siguen en
  // "solo vista previa" para el resto. Ver drafters-schema.sql
  // (perfiles.acceso_mesas_drafters) y app/salas/[id]/crear-equipo/page.tsx.
  const [cambiandoAccesoId, setCambiandoAccesoId] = useState<string | null>(null);

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

      const { data: perfilData } = await supabase.from('perfiles').select('*').eq('id', session.user.id).single();

      if (!activo) return;

      const p = perfilData as Perfil | null;
      if (!p || p.rol !== 'admin') {
        router.push('/cuenta');
        return;
      }

      setPerfil(p);
      setAutorizado(true);

      const { data: usuariosData, error: usuariosError } = await supabase
        .from('perfiles')
        .select('id, nombre, apellido, nombre_usuario, email, rol, created_at, acceso_mesas_drafters')
        .order('created_at', { ascending: false });

      if (!activo) return;

      if (usuariosError) {
        setError('No se han podido cargar los usuarios registrados.');
      } else {
        setUsuarios((usuariosData as Perfil[]) ?? []);
      }
    }

    cargar();
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  if (autorizado === null || !perfil) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader />
          <div style={S.accountSection}>
            <p style={{ fontSize: 14, color: S.MUTED_2 }}>Comprobando acceso...</p>
          </div>
        </div>
      </main>
    );
  }

  async function alternarAccesoMesas(usuario: Perfil) {
    const nuevoValor = !usuario.acceso_mesas_drafters;
    setCambiandoAccesoId(usuario.id);
    const { error: updateError } = await supabase.from('perfiles').update({ acceso_mesas_drafters: nuevoValor }).eq('id', usuario.id);
    if (!updateError) {
      setUsuarios((prev) => prev.map((u) => (u.id === usuario.id ? { ...u, acceso_mesas_drafters: nuevoValor } : u)));
    }
    setCambiandoAccesoId(null);
  }

  const busquedaNorm = busqueda.trim().toLowerCase();
  const usuariosFiltrados = busquedaNorm
    ? usuarios.filter((u) => {
        const nombreCompleto = `${u.nombre} ${u.apellido ?? ''}`.toLowerCase();
        return (
          (u.nombre_usuario ?? '').toLowerCase().includes(busquedaNorm) ||
          nombreCompleto.includes(busquedaNorm) ||
          (u.email ?? '').toLowerCase().includes(busquedaNorm)
        );
      })
    : usuarios;

  const saldoLabel = `${perfil.saldo_simulado.toFixed(2)} €`;
  const initials = S.iniciales(perfil.nombre, perfil.apellido);

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
        <div style={S.accountSection}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>
              Usuarios registrados
            </h1>
            <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>
              {usuarios.length} usuario{usuarios.length === 1 ? '' : 's'} en total.
            </p>
          </div>

          {error && <p style={S.errorText}>{error}</p>}

          <div style={S.field}>
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre de usuario, nombre o correo..."
              style={S.input}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {usuariosFiltrados.length === 0 && (
              <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>
                {usuarios.length === 0 ? 'Todavía no hay ningún usuario registrado.' : 'Ningún usuario coincide con esa búsqueda.'}
              </p>
            )}
            {usuariosFiltrados.map((u) => (
              <div
                key={u.id}
                style={{ display: 'flex', flexDirection: 'column', gap: 4, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: '12px 14px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    @{u.nombre_usuario ?? '(sin nombre de usuario)'}
                  </span>
                  {u.rol === 'admin' && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 10,
                        fontWeight: 700,
                        color: S.ACCENT,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        background: 'rgba(61,220,132,0.12)',
                        borderRadius: 999,
                        padding: '3px 8px',
                      }}
                    >
                      Admin
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 12, color: S.MUTED_2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {u.nombre} {u.apellido ?? ''}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 11.5, color: S.MUTED_3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {u.email ?? '(sin correo guardado — vuelve a pegar el esquema)'}
                  </span>
                  <span style={{ fontSize: 10.5, color: S.FAINT, flexShrink: 0 }}>
                    {new Date(u.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </span>
                </div>

                {/* Acceso a Mesas Drafters (01/10) — el admin siempre tiene
                    acceso (ver tiene_acceso_mesas_drafters() en el esquema),
                    así que el toggle no tiene sentido mostrarlo en su propia
                    fila. */}
                {u.rol !== 'admin' && (
                  <button
                    type="button"
                    onClick={() => alternarAccesoMesas(u)}
                    disabled={cambiandoAccesoId === u.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      marginTop: 4,
                      padding: '7px 10px',
                      borderRadius: 8,
                      border: `1px solid ${u.acceso_mesas_drafters ? 'rgba(61,220,132,0.4)' : '#1E2723'}`,
                      background: u.acceso_mesas_drafters ? 'rgba(61,220,132,0.08)' : 'transparent',
                      cursor: cambiandoAccesoId === u.id ? 'default' : 'pointer',
                      opacity: cambiandoAccesoId === u.id ? 0.6 : 1,
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: u.acceso_mesas_drafters ? S.ACCENT : S.MUTED_2 }}>
                      {u.acceso_mesas_drafters ? 'Acceso a Mesas Drafters habilitado' : 'Sin acceso a Mesas Drafters (solo preview)'}
                    </span>
                    <div style={{ flexShrink: 0, width: 32, height: 18, borderRadius: 999, background: u.acceso_mesas_drafters ? 'rgba(61,220,132,0.35)' : '#232B26', position: 'relative' }}>
                      <div style={{ position: 'absolute', top: 2, left: u.acceso_mesas_drafters ? 16 : 2, width: 14, height: 14, borderRadius: '50%', background: '#F5F7F5', transition: 'left 0.15s ease' }} />
                    </div>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
