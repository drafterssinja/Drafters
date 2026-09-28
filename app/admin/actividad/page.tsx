'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { conTiempoMaximo } from '@/lib/conTiempoMaximo';

// ============================================================================
// REGISTRO DE ACTIVIDAD (nuevo, 28/09 — pedido de Iñi)
// ============================================================================
// Un único log global, más reciente primero, filtrable por usuario — Iñi
// dudaba entre esto o un listado de usuarios con el historial "dentro" de
// cada uno, y se decantó él mismo por el log global filtrable. Coincidimos:
// con un log global se puede ver de un vistazo "qué ha pasado hoy" sin tener
// que entrar usuario por usuario, y el filtro cubre el caso de querer mirar
// solo a una persona. Cada fila viene de eventos_actividad_admin() (ver
// drafters-schema.sql), que ya comprueba que quien llama es admin y junta
// nombre/apellido/email del usuario — aquí no hace falta ninguna comprobación
// extra de permisos aparte del auth-check de siempre.
//
// De momento se registran dos tipos de evento (registrar_evento_actividad()
// se llama desde /login y desde confirmarInscripcion() en las pantallas de
// crear-equipo de salas y porras):
//   - 'login': cada vez que alguien entra con usuario y contraseña.
//   - 'inscripcion': cada vez que alguien se inscribe (por primera vez, no al
//     editar un equipo ya existente) a una mesa o a una porra.

type EventoActividad = {
  id: string;
  usuario_id: string;
  nombre: string | null;
  apellido: string | null;
  email: string | null;
  tipo: 'login' | 'inscripcion';
  detalle: { modo?: 'sala' | 'porra'; nombre?: string } | null;
  creado_en: string;
};

const LIMITE_EVENTOS = 300;

export default function AdminActividadPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [usuarios, setUsuarios] = useState<Perfil[]>([]);
  const [eventos, setEventos] = useState<EventoActividad[]>([]);
  const [usuarioFiltro, setUsuarioFiltro] = useState<string>('todos');
  // Filtro por fechas (28/09, pedido de Iñi: "de tal día a tal día") — los
  // <input type="date"> dan "AAAA-MM-DD" en hora local; para "desde" se
  // manda tal cual (medianoche de ese día) y para "hasta" se manda con
  // "T23:59:59" añadido, para que ese último día quede incluido entero y
  // no se quede fuera todo lo que pasó después de medianoche.
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [cargandoEventos, setCargandoEventos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorAcceso, setErrorAcceso] = useState<string | null>(null);

  async function cargarEventos(usuarioId: string, desde: string, hasta: string) {
    setCargandoEventos(true);
    const { data, error: eventosError } = await supabase.rpc('eventos_actividad_admin', {
      p_usuario_id: usuarioId === 'todos' ? null : usuarioId,
      p_limite: LIMITE_EVENTOS,
      p_fecha_desde: desde ? new Date(desde).toISOString() : null,
      p_fecha_hasta: hasta ? new Date(`${hasta}T23:59:59`).toISOString() : null,
    });
    setCargandoEventos(false);

    if (eventosError) {
      // Se enseña el mensaje real de Supabase (28/09) — lo más probable si
      // esto falla es que todavía no se haya vuelto a ejecutar el
      // drafters-schema.sql completo en el editor SQL de Supabase desde que
      // se añadió esta función (eventos_actividad_admin no existiría
      // todavía en la base de datos), y así se ve claramente en vez de un
      // mensaje genérico.
      setError(`No se ha podido cargar el registro de actividad: ${eventosError.message}`);
    } else {
      setEventos((data as EventoActividad[]) ?? []);
    }
  }

  useEffect(() => {
    let activo = true;

    async function cargar() {
      // Mismo endurecimiento que en /admin/videos (28/09, aviso de
      // Iñi): todo el bloque de comprobación de acceso va con un tiempo
      // máximo de espera y capturando cualquier error, para no quedarse
      // colgado en "Comprobando acceso..." sin explicación.
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

        await cargarEventos('todos', '', '');
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
    await cargarEventos(usuarioId, fechaDesde, fechaHasta);
  }

  async function onCambiarFechas(desde: string, hasta: string) {
    setFechaDesde(desde);
    setFechaHasta(hasta);
    await cargarEventos(usuarioFiltro, desde, hasta);
  }

  if (errorAcceso) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader />
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
          <DraftersHeader />
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

  function resumenEvento(e: EventoActividad): string {
    if (e.tipo === 'login') return 'Ha iniciado sesión';
    const nombreObjetivo = e.detalle?.nombre ?? '';
    if (e.detalle?.modo === 'porra') return `Se ha inscrito en la porra "${nombreObjetivo}"`;
    if (e.detalle?.modo === 'sala') return `Se ha inscrito en la mesa "${nombreObjetivo}"`;
    return 'Se ha inscrito';
  }

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
        <div style={S.accountSection}>
          <a href="/admin" style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12.5, color: S.ACCENT, textDecoration: 'none' }}>
            ← Panel de administración
          </a>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>
              Registro de actividad
            </h1>
            <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>
              Accesos e inscripciones de todos los usuarios, más recientes primero.
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

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ ...S.field, flex: 1 }}>
              <span style={S.label}>Desde</span>
              <input type="date" value={fechaDesde} onChange={(e) => onCambiarFechas(e.target.value, fechaHasta)} style={S.input} />
            </div>
            <div style={{ ...S.field, flex: 1 }}>
              <span style={S.label}>Hasta</span>
              <input type="date" value={fechaHasta} onChange={(e) => onCambiarFechas(fechaDesde, e.target.value)} style={S.input} />
            </div>
            {(fechaDesde || fechaHasta) && (
              <button
                type="button"
                onClick={() => onCambiarFechas('', '')}
                style={{ alignSelf: 'flex-end', background: 'transparent', border: `1px solid ${S.BORDER}`, borderRadius: 8, color: S.MUTED_2, fontSize: 11.5, padding: '10px 12px', cursor: 'pointer' }}
              >
                Quitar fechas
              </button>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {cargandoEventos && <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>Cargando...</p>}
            {!cargandoEventos && eventos.length === 0 && (
              <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>Todavía no hay actividad registrada.</p>
            )}
            {!cargandoEventos &&
              eventos.map((e) => {
                const esLogin = e.tipo === 'login';
                return (
                  <div
                    key={e.id}
                    style={{ display: 'flex', flexDirection: 'column', gap: 4, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: '12px 14px' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {nombreUsuario(e)}
                      </span>
                      <span
                        style={{
                          flexShrink: 0,
                          fontSize: 10,
                          fontWeight: 700,
                          color: esLogin ? S.MUTED : S.ACCENT,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          background: esLogin ? 'rgba(148,163,184,0.14)' : 'rgba(61,220,132,0.12)',
                          borderRadius: 999,
                          padding: '3px 8px',
                        }}
                      >
                        {esLogin ? 'Login' : 'Inscripción'}
                      </span>
                    </div>
                    <span style={{ fontSize: 12, color: S.MUTED_2 }}>{resumenEvento(e)}</span>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <span style={{ fontSize: 11.5, color: S.MUTED_3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {e.email ?? ''}
                      </span>
                      <span style={{ fontSize: 10.5, color: S.FAINT, flexShrink: 0 }}>
                        {new Date(e.creado_en).toLocaleString('es-ES', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </main>
  );
}
