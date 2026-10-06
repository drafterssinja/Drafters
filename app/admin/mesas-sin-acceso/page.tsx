'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { conTiempoMaximo } from '@/lib/conTiempoMaximo';

// ============================================================================
// INTENTOS DE MESAS DRAFTERS SIN ACCESO (nuevo, 03/10 — pedido de Iñi)
// ============================================================================
// Pedido de Iñi: "quiero que en el registro de actividad se quede guardado
// también... pero que se me quede en un registro aparte, que no me ensucie
// todo el resto del registro de actividad que tengo" — quiere ver qué
// usuarios SIN acceso a Mesas Drafters (perfiles.acceso_mesas_drafters)
// entran a una mesa, se construyen un equipo entero, y llegan hasta el
// final sin poder confirmar porque el botón no les deja. Pantalla
// deliberadamente aparte de /admin/actividad (mismo patrón visual, pero
// otra tabla y otra función RPC — ver intentos_mesas_sin_acceso y
// intentos_mesas_sin_acceso_admin() en drafters-schema.sql), para no
// mezclar este listado con el registro general de login/inscripción/
// recarga/premio.
//
// Cada fila es un intento real: alguien sin acceso llegó a la pantalla de
// revisión final con su equipo ya completo — se registra una sola vez por
// cada vez que llega ahí (no en cada paso intermedio), desde
// app/salas/[id]/crear-equipo/page.tsx.

type IntentoMesaSinAcceso = {
  id: string;
  usuario_id: string;
  nombre: string | null;
  apellido: string | null;
  nombre_usuario: string | null;
  email: string | null;
  sala_id: string | null;
  sala_nombre: string | null;
  num_jugadores: number;
  creado_en: string;
};

const LIMITE_INTENTOS = 300;

export default function AdminMesasSinAccesoPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [usuarios, setUsuarios] = useState<Perfil[]>([]);
  const [intentos, setIntentos] = useState<IntentoMesaSinAcceso[]>([]);
  const [usuarioFiltro, setUsuarioFiltro] = useState<string>('todos');
  const [cargandoIntentos, setCargandoIntentos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorAcceso, setErrorAcceso] = useState<string | null>(null);

  async function cargarIntentos(usuarioId: string) {
    setCargandoIntentos(true);
    const { data, error: intentosError } = await supabase.rpc('intentos_mesas_sin_acceso_admin', {
      p_usuario_id: usuarioId === 'todos' ? null : usuarioId,
      p_limite: LIMITE_INTENTOS,
    });
    setCargandoIntentos(false);

    if (intentosError) {
      // Mismo criterio que /admin/actividad: se enseña el mensaje real de
      // Supabase — lo más probable, si esto falla, es que todavía no se
      // haya vuelto a ejecutar drafters-schema.sql en el editor SQL de
      // Supabase desde que se añadió esta función.
      setError(`No se ha podido cargar el registro: ${intentosError.message}`);
    } else {
      setIntentos((data as IntentoMesaSinAcceso[]) ?? []);
    }
  }

  useEffect(() => {
    let activo = true;

    async function cargar() {
      try {
        const {
          data: { session },
        } = await conTiempoMaximo(supabase.auth.getSession(), 'comprobar la sesión');

        if (!activo) return;

        if (!session) {
          router.push('/login');
          return;
        }

        const { data: perfilData, error: perfilError } = await conTiempoMaximo(
          supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
          'cargar tu perfil'
        );

        if (!activo) return;

        if (perfilError) {
          setErrorAcceso(`No se ha podido comprobar tu acceso: ${perfilError.message}`);
          return;
        }

        const p = perfilData as Perfil | null;
        if (!p || p.rol !== 'admin') {
          router.push('/cuenta');
          return;
        }

        setPerfil(p);
        setAutorizado(true);

        const { data: usuariosData, error: usuariosError } = await supabase
          .from('perfiles')
          .select('id, nombre, apellido, nombre_usuario, email')
          .order('nombre', { ascending: true });

        if (!activo) return;

        if (usuariosError) setError('No se han podido cargar los usuarios para el filtro.');
        else setUsuarios((usuariosData as Perfil[]) ?? []);

        await cargarIntentos('todos');
      } catch (e) {
        if (!activo) return;
        setErrorAcceso(e instanceof Error ? `No se ha podido comprobar tu acceso: ${e.message}` : 'No se ha podido comprobar tu acceso.');
      }
    }

    cargar();
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function onCambiarFiltro(usuarioId: string) {
    setUsuarioFiltro(usuarioId);
    await cargarIntentos(usuarioId);
  }

  if (errorAcceso) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader sinVolver />
          <div style={S.accountSection}>
            <p style={S.errorText}>{errorAcceso}</p>
            <button
              type="button"
              onClick={() => {
                setErrorAcceso(null);
                setAutorizado(null);
                window.location.reload();
              }}
              style={S.primaryButton}
            >
              Reintentar
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (autorizado === null || !perfil) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader sinVolver />
          <div style={S.accountSection}>
            <p style={{ fontSize: 14, color: S.MUTED_2 }}>Comprobando acceso...</p>
          </div>
        </div>
      </main>
    );
  }

  const saldoLabel = `${perfil.saldo_simulado.toFixed(2)} €`;
  const initials = S.iniciales(perfil.nombre, perfil.apellido);

  function nombreUsuario(u: { nombre: string | null; apellido: string | null; nombre_usuario?: string | null }) {
    const completo = `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim();
    return completo || u.nombre_usuario || '(sin nombre)';
  }

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader sinVolver saldoLabel={saldoLabel} accountInitials={initials} />
        <div style={S.accountSection}>
          <a href="/admin" style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12.5, color: S.ACCENT, textDecoration: 'none' }}>
            ← Panel de administración
          </a>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>
              Intentos sin acceso a Mesas Drafters
            </h1>
            <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>
              Usuarios sin acceso habilitado que han construido un equipo entero y han llegado a la revisión final de
              una mesa, sin poder confirmar. Registro aparte del de actividad general.
            </p>
          </div>

          {error && <p style={S.errorText}>{error}</p>}

          <div style={S.field}>
            <span style={S.label}>Filtrar por usuario</span>
            <select value={usuarioFiltro} onChange={(e) => onCambiarFiltro(e.target.value)} style={S.input}>
              <option value="todos">Todos los usuarios</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {nombreUsuario(u)}
                  {u.nombre_usuario ? ` (@${u.nombre_usuario})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {cargandoIntentos && <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>Cargando...</p>}
            {!cargandoIntentos && intentos.length === 0 && (
              <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>Todavía no se ha registrado ningún intento.</p>
            )}
            {!cargandoIntentos &&
              intentos.map((it) => (
                <div
                  key={it.id}
                  style={{ display: 'flex', flexDirection: 'column', gap: 4, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: '12px 14px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {nombreUsuario(it)}
                    </span>
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 10,
                        fontWeight: 700,
                        color: '#F0B94D',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        background: 'rgba(240,185,77,0.14)',
                        borderRadius: 999,
                        padding: '3px 8px',
                      }}
                    >
                      Sin acceso
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: S.MUTED_2 }}>
                    Construyó un equipo de {it.num_jugadores} jugadores en la mesa &quot;{it.sala_nombre ?? '(borrada)'}&quot; y no pudo confirmar.
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontSize: 11.5, color: S.MUTED_3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {it.email ?? ''}
                    </span>
                    <span style={{ fontSize: 10.5, color: S.FAINT, flexShrink: 0 }}>
                      {new Date(it.creado_en).toLocaleString('es-ES', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </main>
  );
}
