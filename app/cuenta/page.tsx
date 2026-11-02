'use client';

import FechaNacimientoSelect, { fechaNacimientoCompleta } from '@/components/FechaNacimientoSelect';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AjustesNotificaciones from '@/components/AjustesNotificaciones';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import CabeceraV2 from '@/components/v2/CabeceraV2';
import InstalarApp from '@/components/InstalarApp';
import * as S from '@/lib/mockupStyles';
import Cargando from '@/components/Cargando';

// Mismo criterio que en el registro (app/registro/page.tsx): solo letras,
// números, guion bajo y punto, sin espacios, 3-20 caracteres.
const NOMBRE_USUARIO_REGEX = /^[a-zA-Z0-9_.]{3,20}$/;

type FilaHistorial = {
  id: string;
  nombre_equipo: string | null;
  modo: string;
  gasto_total: number;
  puntos_totales: number | null;
  posicion_final: number | null;
  created_at: string;
  salas: { nombre: string; codigo: string; deporte: string; estado: string } | null;
  porras: { major: string; codigo: string; estado: string } | null;
};

function haceDiasLabel(fechaIso: string): string {
  const dias = Math.floor((Date.now() - new Date(fechaIso).getTime()) / (1000 * 60 * 60 * 24));
  if (dias <= 0) return 'Hoy';
  if (dias === 1) return 'Hace 1 día';
  return `Hace ${dias} días`;
}

export default function CuentaPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [historial, setHistorial] = useState<FilaHistorial[]>([]);
  const [cargando, setCargando] = useState(true);
  // 16/10: solicitudes de amistad pendientes (para el aviso en la tarjeta de Amigos).
  const [solicitudesAmigos, setSolicitudesAmigos] = useState(0);
  useEffect(() => {
    supabase.rpc('amigos_lista').then(({ data }) => {
      setSolicitudesAmigos(((data as { estado: string; recibida: boolean }[]) ?? []).filter((f) => f.estado === 'pendiente' && f.recibida).length);
    });
  }, []);
  const [error, setError] = useState<string | null>(null);
  // 02/11: apartado abierto en Mi perfil.
  const [abierto, setAbierto] = useState<'avisos' | 'datos' | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#notificaciones') setAbierto('avisos');
  }, []);

  // Formulario de datos de la cuenta
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [email, setEmail] = useState('');
  const [fechaNacimiento, setFechaNacimiento] = useState('');
  const [nuevaPassword, setNuevaPassword] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState<string | null>(null);

  // Nombre de usuario editable (pedido de Iñi, 23/09): antes solo se podía
  // elegir una vez, en el registro — algunas cuentas creadas antes de que
  // ese campo existiera (como la suya propia) recibieron un nombre
  // provisional automático al pegar el esquema, y necesitan poder ponerse
  // uno de verdad desde aquí.
  const [nombreUsuario, setNombreUsuario] = useState('');
  const [usuarioDisponible, setUsuarioDisponible] = useState<boolean | null>(null);
  const [comprobandoUsuario, setComprobandoUsuario] = useState(false);

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

      const [
        { data: perfilData, error: perfilError },
        { data: historialData, error: historialError },
      ] = await Promise.all([
        supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
        supabase
          .from('equipos')
          .select(
            'id, nombre_equipo, modo, gasto_total, puntos_totales, posicion_final, created_at, salas(nombre, codigo, deporte, estado), porras(major, codigo, estado)'
          )
          .eq('usuario_id', session.user.id)
          .order('created_at', { ascending: false }),
      ]);

      if (!activo) return;

      if (perfilError) {
        setError('No se ha podido cargar tu perfil. Inténtalo de nuevo.');
      } else {
        const p = perfilData as Perfil;
        setPerfil(p);
        setNombre(p.nombre ?? '');
        setApellido(p.apellido ?? '');
        setFechaNacimiento(p.fecha_nacimiento ?? '');
        setEmail(session.user.email ?? '');
        setNombreUsuario(p.nombre_usuario ?? '');
      }

      if (historialError) setError('No se ha podido cargar tu historial de partidas.');
      else setHistorial((historialData as unknown as FilaHistorial[]) ?? []);

      setCargando(false);
    }

    cargar();
    return () => {
      activo = false;
    };
  }, [router]);

  // Comprueba disponibilidad en cuanto se deja el campo — igual que en el
  // registro, pero excluyendo la propia fila (p_excluir_id), para que
  // dejarlo tal cual (sin cambiarlo) no salga como "no disponible".
  async function comprobarUsuario() {
    if (!perfil) return;
    const valor = nombreUsuario.trim();
    if (valor === (perfil.nombre_usuario ?? '') || !NOMBRE_USUARIO_REGEX.test(valor)) {
      setUsuarioDisponible(null);
      return;
    }
    setComprobandoUsuario(true);
    const { data, error: rpcError } = await supabase.rpc('nombre_usuario_disponible', {
      p_nombre_usuario: valor,
      p_excluir_id: perfil.id,
    });
    setComprobandoUsuario(false);
    if (rpcError) {
      setUsuarioDisponible(null);
      return;
    }
    setUsuarioDisponible(Boolean(data));
  }

  async function guardarCambios() {
    if (!perfil) return;
    setError(null);
    setGuardadoOk(null);

    const nombreUsuarioTrim = nombreUsuario.trim();
    if (!NOMBRE_USUARIO_REGEX.test(nombreUsuarioTrim)) {
      setError('El nombre de usuario debe tener entre 3 y 20 caracteres, sin espacios (solo letras, números, "_" y ".").');
      return;
    }
    if (usuarioDisponible === false) {
      setError('Ese nombre de usuario ya está en uso. Elige otro.');
      return;
    }
    if (fechaNacimiento && !fechaNacimientoCompleta(fechaNacimiento)) {
      setError('La fecha de nacimiento está incompleta: elige día, mes y año.');
      return;
    }

    setGuardando(true);

    const { error: perfilUpdateError } = await supabase
      .from('perfiles')
      .update({ nombre, apellido, fecha_nacimiento: fechaNacimiento || null, nombre_usuario: nombreUsuarioTrim })
      .eq('id', perfil.id);

    if (perfilUpdateError) {
      setGuardando(false);
      setError(
        perfilUpdateError.message.includes('perfiles_nombre_usuario_unico')
          ? 'Ese nombre de usuario ya está en uso. Elige otro.'
          : 'No se han podido guardar los cambios. Inténtalo de nuevo.'
      );
      return;
    }

    const cambiosAuth: { email?: string; password?: string } = {};
    if (email && email !== perfil.id) cambiosAuth.email = email;
    if (nuevaPassword) cambiosAuth.password = nuevaPassword;

    if (Object.keys(cambiosAuth).length > 0) {
      const { error: authUpdateError } = await supabase.auth.updateUser(cambiosAuth);
      if (authUpdateError) {
        setGuardando(false);
        setError('Tus datos se han guardado, pero no se ha podido actualizar el email o la contraseña: ' + authUpdateError.message);
        return;
      }
    }

    setGuardando(false);
    setNuevaPassword('');
    setPerfil({ ...perfil, nombre, apellido, fecha_nacimiento: fechaNacimiento || null, nombre_usuario: nombreUsuarioTrim });
    setUsuarioDisponible(null);
    setGuardadoOk(
      cambiosAuth.email
        ? 'Cambios guardados. Revisa tu email para confirmar el nuevo correo.'
        : 'Cambios guardados.'
    );
  }

  async function cerrarSesion() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  if (cargando || !perfil) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader />
          <div style={S.accountSection}>
            <Cargando />
          </div>
        </div>
      </main>
    );
  }

  const initials = S.iniciales(perfil.nombre, perfil.apellido);

  // 02/11 (Iñi): "Mi perfil" súper compacto. Fuera el listado de salas; cada
  // apartado es una fila que se abre al pulsarla.
  const fila = (abierta: boolean): React.CSSProperties => ({ width: '100%', fontFamily: "'Manrope', sans-serif", display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', color: S.TEXT, textDecoration: 'none', borderBottom: abierta ? '1px solid #1E2723' : 'none' });
  const icono = (e: string) => <span style={{ width: 22, textAlign: 'center', fontSize: 17 }}>{e}</span>;
  const titulo = (t: string, sub?: string) => (
    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontWeight: 700, fontSize: 14.5 }}>{t}</span>
      {sub && <span style={{ fontSize: 11.5, color: S.MUTED_2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>}
    </span>
  );
  const flecha = (abierta?: boolean) => <span style={{ color: S.MUTED_3, fontSize: 13 }}>{abierta === undefined ? '›' : abierta ? '▾' : '▸'}</span>;
  const caja: React.CSSProperties = { borderRadius: 14, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, overflow: 'hidden' };
  const separador: React.CSSProperties = { height: 1, background: '#1E2723', margin: '0 14px' };

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <CabeceraV2 perfil={perfil} deporte="futbol" sinDeporte />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 16px 40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 46, height: 46, borderRadius: '50%', background: S.ACCENT, color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 17, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials}</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, color: S.TEXT, lineHeight: 1.1 }}>Mi perfil</span>
              {perfil.nombre_usuario && <span style={{ fontSize: 13, color: S.MUTED_2 }}>@{perfil.nombre_usuario}</span>}
            </span>
          </div>

          <InstalarApp variante="aviso" />

          <div style={caja}>
            <Link href="/v2/nivel" style={fila(false)}>
              {icono('🎖️')}
              {titulo('Mi nivel', 'Tu insignia, tus últimas partidas y cómo se sube')}
              {flecha()}
            </Link>
            <div style={separador} />
            <Link href="/amigos" style={fila(false)}>
              {icono('👥')}
              {titulo('Amigos', solicitudesAmigos > 0 ? `Tienes ${solicitudesAmigos} solicitud${solicitudesAmigos === 1 ? '' : 'es'} de amistad` : 'Mis amigos y qué ven de mí')}
              {solicitudesAmigos > 0 ? (
                <span style={{ minWidth: 22, height: 22, borderRadius: 999, background: '#FF5C5C', color: '#FFF', fontSize: 11.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>{solicitudesAmigos}</span>
              ) : (
                flecha()
              )}
            </Link>
            <div style={separador} />
            <div id="notificaciones" style={{ scrollMarginTop: 80 }}>
              <button type="button" onClick={() => setAbierto(abierto === 'avisos' ? null : 'avisos')} style={fila(abierto === 'avisos')}>
                {icono('🔔')}
                {titulo('Notificaciones', 'Actívalas y elige cuáles quieres recibir')}
                {flecha(abierto === 'avisos')}
              </button>
              {abierto === 'avisos' && (
                <div style={{ padding: '12px 14px 14px' }}>
                  <AjustesNotificaciones compacto />
                </div>
              )}
            </div>
            <div style={separador} />
            <button type="button" onClick={() => setAbierto(abierto === 'datos' ? null : 'datos')} style={fila(abierto === 'datos')}>
              {icono('✏️')}
              {titulo('Mis datos', 'Nombre, usuario, email, fecha de nacimiento y contraseña')}
              {flecha(abierto === 'datos')}
            </button>
            {abierto === 'datos' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 14px 16px' }}>
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ ...S.field, flex: 1, minWidth: 0 }}>
                    <span style={S.label}>Nombre</span>
                    <input value={nombre} onChange={(e) => setNombre(e.target.value)} style={S.input} />
                  </div>
                  <div style={{ ...S.field, flex: 1, minWidth: 0 }}>
                    <span style={S.label}>Apellido</span>
                    <input value={apellido} onChange={(e) => setApellido(e.target.value)} style={S.input} />
                  </div>
                </div>
                <div style={S.field}>
                  <span style={S.label}>Nombre de usuario</span>
                  <input value={nombreUsuario} onChange={(e) => setNombreUsuario(e.target.value)} onBlur={comprobarUsuario} style={S.input} />
                  {comprobandoUsuario && <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>Comprobando...</span>}
                  {!comprobandoUsuario && usuarioDisponible === true && <span style={{ fontSize: 11.5, color: S.ACCENT }}>Disponible.</span>}
                  {!comprobandoUsuario && usuarioDisponible === false && <span style={{ fontSize: 11.5, color: S.ERROR }}>Ese nombre de usuario ya está en uso.</span>}
                  <span style={{ fontSize: 11, color: S.MUTED_3 }}>Es el nombre que ven los demás, nunca tu nombre real.</span>
                </div>
                <div style={S.field}>
                  <span style={S.label}>Email</span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={S.input} />
                </div>
                <div style={S.field}>
                  <span style={S.label}>Fecha de nacimiento</span>
                  <FechaNacimientoSelect value={fechaNacimiento ?? ''} onChange={setFechaNacimiento} />
                </div>
                <div style={S.field}>
                  <span style={S.label}>Cambiar contraseña</span>
                  <input type="password" placeholder="Déjalo en blanco para no cambiarla" value={nuevaPassword} onChange={(e) => setNuevaPassword(e.target.value)} style={S.input} />
                </div>
                {error && <p style={S.errorText}>{error}</p>}
                {guardadoOk && <p style={S.infoText}>{guardadoOk}</p>}
                <button type="button" onClick={guardarCambios} disabled={guardando} style={{ ...S.primaryButton, opacity: guardando ? 0.7 : 1 }}>
                  {guardando ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            )}
            {perfil.rol === 'admin' && (
              <>
                <div style={separador} />
                <Link href="/admin" style={fila(false)}>
                  {icono('🛠️')}
                  {titulo('Panel de administración', 'Solo tú')}
                  {flecha()}
                </Link>
              </>
            )}
          </div>

          {error && abierto !== 'datos' && <p style={S.errorText}>{error}</p>}

          <button type="button" onClick={cerrarSesion} style={{ ...S.secondaryLinkButton, marginTop: 4 }}>
            Cerrar sesión
          </button>
        </div>
      </div>
    </main>
  );
}
