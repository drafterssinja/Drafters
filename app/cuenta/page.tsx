'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil, Movimiento } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';

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
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Formulario de datos de la cuenta
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [email, setEmail] = useState('');
  const [fechaNacimiento, setFechaNacimiento] = useState('');
  const [nuevaPassword, setNuevaPassword] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState<string | null>(null);

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
        { data: movimientosData, error: movimientosError },
      ] = await Promise.all([
        supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
        supabase
          .from('equipos')
          .select(
            'id, nombre_equipo, modo, gasto_total, puntos_totales, posicion_final, created_at, salas(nombre, codigo, deporte, estado), porras(major, codigo, estado)'
          )
          .eq('usuario_id', session.user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('movimientos')
          .select('id, usuario_id, tipo, importe, creado_en')
          .eq('usuario_id', session.user.id)
          .order('creado_en', { ascending: false }),
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
      }

      if (historialError) setError('No se ha podido cargar tu historial de partidas.');
      else setHistorial((historialData as unknown as FilaHistorial[]) ?? []);

      if (movimientosError) setError('No se ha podido cargar tu historial de movimientos.');
      else setMovimientos((movimientosData as Movimiento[]) ?? []);

      setCargando(false);
    }

    cargar();
    return () => {
      activo = false;
    };
  }, [router]);

  async function guardarCambios() {
    if (!perfil) return;
    setError(null);
    setGuardadoOk(null);
    setGuardando(true);

    const { error: perfilUpdateError } = await supabase
      .from('perfiles')
      .update({ nombre, apellido, fecha_nacimiento: fechaNacimiento || null })
      .eq('id', perfil.id);

    if (perfilUpdateError) {
      setGuardando(false);
      setError('No se han podido guardar los cambios. Inténtalo de nuevo.');
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
    setPerfil({ ...perfil, nombre, apellido, fecha_nacimiento: fechaNacimiento || null });
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
            <p style={{ fontSize: 14, color: S.MUTED }}>Cargando tu cuenta...</p>
          </div>
        </div>
      </main>
    );
  }

  const saldoLabel = `${perfil.saldo_simulado.toFixed(2)} €`;
  const initials = S.iniciales(perfil.nombre, perfil.apellido);

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
        <div style={S.accountSection}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: S.ACCENT,
                color: '#04140B',
                fontFamily: "'Barlow Condensed', sans-serif",
                fontWeight: 800,
                fontSize: 22,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {initials}
            </span>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>
              Mi cuenta
            </h1>
            {perfil.nombre_usuario && (
              <span style={{ fontSize: 13, color: S.MUTED_2 }}>@{perfil.nombre_usuario}</span>
            )}
          </div>

          <Link href="/recargar" style={S.card}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_2, fontWeight: 700 }}>
                Saldo disponible
              </span>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, color: S.TEXT }}>
                {saldoLabel}
              </span>
            </div>
            <span
              style={{
                flexShrink: 0,
                fontFamily: "'Barlow Condensed', sans-serif",
                fontWeight: 700,
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
                color: '#04140B',
                background: S.ACCENT,
                borderRadius: 8,
                padding: '9px 14px',
                whiteSpace: 'nowrap',
              }}
            >
              Recargar
            </span>
          </Link>

          {perfil.rol === 'admin' && (
            <Link href="/admin" style={S.card}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_2, fontWeight: 700 }}>
                  Solo tú
                </span>
                <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, color: S.TEXT }}>
                  Panel de administración
                </span>
              </div>
              <span style={{ flexShrink: 0, color: S.FAINT, fontSize: 18 }}>›</span>
            </Link>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={S.sectionLabel}>Historial de partidas</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {historial.length === 0 && (
                <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>Todavía no te has inscrito en ninguna mesa ni porra.</p>
              )}
              {historial.map((fila) => {
                const nombreMesa = fila.salas?.nombre ?? fila.porras?.major ?? 'Mesa';
                const deporteLabel = fila.salas?.deporte ?? 'Porra';
                const competicionLabel = fila.porras?.codigo ?? fila.salas?.codigo ?? '';
                const estado = fila.salas?.estado ?? fila.porras?.estado ?? 'abierta';
                const finalizada = estado === 'finalizada';
                return (
                  <div
                    key={fila.id}
                    style={{ display: 'flex', flexDirection: 'column', gap: 8, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: '12px 14px' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {fila.nombre_equipo ?? nombreMesa}
                        </span>
                        <span style={{ fontSize: 11, color: S.FAINT }}>
                          {deporteLabel} · {competicionLabel} · {haceDiasLabel(fila.created_at)}
                        </span>
                      </div>
                      <span
                        style={{
                          flexShrink: 0,
                          fontFamily: "'Manrope', sans-serif",
                          fontWeight: 700,
                          fontSize: 10.5,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          color: S.MUTED_2,
                          background: 'rgba(139,149,143,0.12)',
                          borderRadius: 999,
                          padding: '5px 10px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {finalizada ? 'Finalizada' : 'En curso'}
                      </span>
                    </div>
                    <span style={{ fontSize: 12.5, color: '#F0B94D', fontWeight: 700 }}>
                      {finalizada
                        ? `Posición: ${fila.posicion_final ?? '—'} · Puntos: ${fila.puntos_totales ?? '—'}`
                        : 'Resultado pendiente de cierre'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={S.sectionLabel}>Historial de ingresos y retiradas</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {movimientos.length === 0 && (
                <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>Todavía no tienes movimientos de saldo.</p>
              )}
              {movimientos.map((mv) => (
                <div
                  key={mv.id}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: '11px 14px' }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 13, color: S.TEXT }}>
                      {mv.tipo === 'deposito' ? 'Ingreso' : 'Retirada'}
                    </span>
                    <span style={{ fontSize: 11, color: S.FAINT }}>{new Date(mv.creado_en).toLocaleDateString('es-ES')}</span>
                  </div>
                  <span
                    style={{
                      flexShrink: 0,
                      fontFamily: "'Barlow Condensed', sans-serif",
                      fontWeight: 800,
                      fontSize: 15,
                      color: mv.tipo === 'deposito' ? S.ACCENT : S.ERROR,
                    }}
                  >
                    {mv.tipo === 'deposito' ? '+' : '-'}{Number(mv.importe).toFixed(2)} €
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={S.fieldGroup}>
            <div style={S.field}>
              <span style={S.label}>Nombre</span>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} style={S.input} />
            </div>
            <div style={S.field}>
              <span style={S.label}>Apellido</span>
              <input value={apellido} onChange={(e) => setApellido(e.target.value)} style={S.input} />
            </div>
            <div style={S.field}>
              <span style={S.label}>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={S.input} />
            </div>
            <div style={S.field}>
              <span style={S.label}>Fecha de nacimiento</span>
              <input type="date" value={fechaNacimiento ?? ''} onChange={(e) => setFechaNacimiento(e.target.value)} style={S.input} />
            </div>
            <div style={S.field}>
              <span style={S.label}>Cambiar contraseña</span>
              <input
                type="password"
                placeholder="Déjalo en blanco para no cambiarla"
                value={nuevaPassword}
                onChange={(e) => setNuevaPassword(e.target.value)}
                style={S.input}
              />
            </div>
          </div>

          {error && <p style={S.errorText}>{error}</p>}
          {guardadoOk && <p style={S.infoText}>{guardadoOk}</p>}

          <button type="button" onClick={guardarCambios} disabled={guardando} style={{ ...S.primaryButton, opacity: guardando ? 0.7 : 1 }}>
            {guardando ? 'Guardando...' : 'Guardar cambios'}
          </button>

          <button
            type="button"
            onClick={cerrarSesion}
            style={{ ...S.secondaryLinkButton, marginTop: -6 }}
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </main>
  );
}
