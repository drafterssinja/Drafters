'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Perfil, Movimiento } from '@/lib/supabaseClient';
import BackButton from '@/components/BackButton';

const RECARGA_MONTOS = [10, 25, 50, 100];

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

export default function CuentaPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [historial, setHistorial] = useState<FilaHistorial[]>([]);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recargando, setRecargando] = useState(false);

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

      if (perfilError) setError('No se ha podido cargar tu perfil. Inténtalo de nuevo.');
      else setPerfil(perfilData as Perfil);

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

  async function cerrarSesion() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  async function recargar(monto: number) {
    setError(null);
    setRecargando(true);
    const { data, error: rpcError } = await supabase.rpc('registrar_movimiento', {
      p_tipo: 'deposito',
      p_importe: monto,
    });
    setRecargando(false);
    if (rpcError) {
      setError('No se ha podido completar la recarga. Inténtalo de nuevo.');
      return;
    }
    setPerfil(data as Perfil);
    setMovimientos((prev) => [
      { id: 'temp-' + Date.now(), usuario_id: perfil?.id ?? '', tipo: 'deposito', importe: monto, creado_en: new Date().toISOString() },
      ...prev,
    ]);
  }

  if (cargando) {
    return (
      <main>
        <BackButton />
        <p className="subtitle">Cargando tu cuenta...</p>
      </main>
    );
  }

  return (
    <main>
      <BackButton />
      <h1>¡Bienvenido{perfil?.nombre ? `, ${perfil.nombre}` : ''}!</h1>
      {error && <p className="error-msg">{error}</p>}

      <div className="card">
        <p className="subtitle" style={{ margin: 0 }}>Saldo simulado</p>
        <p style={{ fontSize: 24, fontWeight: 800, margin: '4px 0 0' }}>
          {perfil ? `${perfil.saldo_simulado.toFixed(2)} €` : '—'}
        </p>
      </div>

      {perfil?.rol === 'admin' && (
        <a href="/admin"><button className="secondary">Panel de administración</button></a>
      )}

      <h2 style={{ fontSize: 16, margin: '8px 0 0' }}>Recargar saldo</h2>
      <p className="subtitle" style={{ margin: 0 }}>Sigue siendo saldo simulado (€), sin pasarela de pago real.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {RECARGA_MONTOS.map((monto) => (
          <button key={monto} className="secondary" disabled={recargando} onClick={() => recargar(monto)}>
            +{monto} €
          </button>
        ))}
      </div>

      <h2 style={{ fontSize: 16, margin: '8px 0 0' }}>Historial de partidas</h2>
      {historial.length === 0 && (
        <p className="subtitle">Todavía no te has inscrito en ninguna mesa ni porra.</p>
      )}
      {historial.map((fila) => {
        const nombre = fila.salas?.nombre ?? fila.porras?.major ?? 'Mesa';
        const codigo = fila.salas?.codigo ?? fila.porras?.codigo ?? '';
        const estado = fila.salas?.estado ?? fila.porras?.estado ?? 'abierta';
        return (
          <div className="card" key={fila.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{nombre}</strong>
              <span className="subtitle" style={{ margin: 0 }}>{codigo}</span>
            </div>
            <p className="subtitle" style={{ margin: '4px 0' }}>
              {fila.nombre_equipo ?? 'Sin nombre de equipo'} · {estado === 'finalizada' ? 'Finalizada' : 'En curso'}
            </p>
            {estado === 'finalizada' ? (
              <p style={{ margin: 0 }}>
                Posición: {fila.posicion_final ?? '—'} · Puntos: {fila.puntos_totales ?? '—'}
              </p>
            ) : (
              <p className="subtitle" style={{ margin: 0 }}>Resultado pendiente de cierre</p>
            )}
          </div>
        );
      })}

      <h2 style={{ fontSize: 16, margin: '8px 0 0' }}>Historial de ingresos y retiradas</h2>
      {movimientos.length === 0 && (
        <p className="subtitle">Todavía no tienes movimientos de saldo.</p>
      )}
      {movimientos.map((mv) => (
        <div className="card" key={mv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>{mv.tipo === 'deposito' ? 'Ingreso' : 'Retirada'}</strong>
            <p className="subtitle" style={{ margin: 0 }}>{new Date(mv.creado_en).toLocaleDateString('es-ES')}</p>
          </div>
          <span style={{ fontWeight: 800, color: mv.tipo === 'deposito' ? '#3ddc84' : '#e94f4f' }}>
            {mv.tipo === 'deposito' ? '+' : '-'}{Number(mv.importe).toFixed(2)} €
          </span>
        </div>
      ))}

      <button className="secondary" onClick={cerrarSesion}>Cerrar sesión</button>
    </main>
  );
}
