'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';

// ============================================================================
// PORRAS DE FÚTBOL POR JORNADA — menú de administración (nuevo, 29/09)
// ============================================================================
// Pedido de Iñi: "una porra de fútbol de primera división... en cada
// jornada de liga me vas a permitir cargar, dentro del superadmin... cuáles
// son todos los partidos que hay". Aquí se crea la porra de la jornada (solo
// el nombre, la fecha límite y el precio — 2€ por defecto, con la misma
// comisión del 10% que el resto de la app, ver lib/salaShared.ts); cargar
// los 10 partidos y marcar sus resultados reales vive en su propia pantalla,
// /admin/porras-futbol/[id] (demasiados campos por partido para caber aquí
// sin abrumar la lista).
//
// A diferencia de las porras de golf, aquí NO hay listado de jugadores que
// pegar — se reutiliza el mismo `formato` de porras.formato
// ('futbol_jornada') y el mismo motor de inscripción/reparto que el resto de
// la app, pero sin la ficha maestra de `jugadores`.

type PorraFutbolAdmin = {
  id: string;
  major: string;
  estado: string;
  precio: number;
  fecha_limite_inscripcion: string | null;
};

export default function AdminPorrasFutbolPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [porras, setPorras] = useState<PorraFutbolAdmin[]>([]);

  const [jornadaNombre, setJornadaNombre] = useState('');
  const [jornadaFechaLimite, setJornadaFechaLimite] = useState('');
  const [precioEntrada, setPrecioEntrada] = useState('2');
  const [creando, setCreando] = useState(false);

  const [eliminandoId, setEliminandoId] = useState<string | null>(null);

  async function cargarPorras() {
    const { data } = await supabase
      .from('porras')
      .select('id, major, estado, precio, fecha_limite_inscripcion')
      .eq('formato', 'futbol_jornada')
      .order('created_at', { ascending: false });
    setPorras((data as PorraFutbolAdmin[]) ?? []);
  }

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
      await cargarPorras();
    }

    cargar();
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function crearJornada() {
    const nombre = jornadaNombre.trim();
    const precioNum = Number(precioEntrada);
    if (!nombre || !Number.isFinite(precioNum) || precioNum <= 0) return;

    setCreando(true);
    setError(null);

    const fechaLimiteIso = jornadaFechaLimite ? new Date(jornadaFechaLimite).toISOString() : null;

    const { data, error: porraError } = await supabase
      .from('porras')
      .insert({
        major: nombre,
        estado: 'disponible',
        precio: precioNum,
        formato: 'futbol_jornada',
        fecha_limite_inscripcion: fechaLimiteIso,
      })
      .select('id')
      .single();

    setCreando(false);
    if (porraError || !data) {
      setError('No se ha podido crear la jornada. Inténtalo de nuevo.');
      return;
    }

    setJornadaNombre('');
    setJornadaFechaLimite('');
    setPrecioEntrada('2');
    await cargarPorras();
    router.push(`/admin/porras-futbol/${data.id}`);
  }

  async function eliminarPorra(p: PorraFutbolAdmin) {
    if (!window.confirm(`¿Eliminar la porra "${p.major}"? Se reembolsará a los equipos inscritos y se les avisará. Esta acción no se puede deshacer.`)) return;
    setEliminandoId(p.id);
    setError(null);
    const { error: rpcError } = await supabase.rpc('eliminar_porra', { p_porra_id: p.id });
    setEliminandoId(null);
    if (rpcError) {
      setError('No se ha podido eliminar la porra. Inténtalo de nuevo.');
      return;
    }
    await cargarPorras();
  }

  if (autorizado === null || !perfil) {
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

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={`${perfil.saldo_simulado.toFixed(2)} €`} accountInitials={S.iniciales(perfil.nombre, perfil.apellido)} />
        <div style={S.accountSection}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Link href="/admin" style={{ fontSize: 12, color: S.MUTED_2, textDecoration: 'none' }}>
              ← Panel de administración
            </Link>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>Porras de fútbol</h1>
            <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>
              Una porra por jornada de Primera División: 10 partidos, pronóstico 1X2, inscripción libre (varias veces por usuario).
            </p>
          </div>

          {error && <p style={S.errorText}>{error}</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14 }}>
            <span style={S.sectionLabel}>Nueva jornada</span>
            <div style={S.field}>
              <span style={S.label}>Nombre de la jornada</span>
              <input value={jornadaNombre} onChange={(e) => setJornadaNombre(e.target.value)} placeholder="LaLiga · Jornada 8" style={S.input} />
            </div>
            <div style={S.field}>
              <span style={S.label}>Fecha y hora límite de inscripción</span>
              <input type="datetime-local" value={jornadaFechaLimite} onChange={(e) => setJornadaFechaLimite(e.target.value)} style={S.input} />
            </div>
            <div style={S.field}>
              <span style={S.label}>Precio de inscripción</span>
              <input type="number" min={0.01} step="0.01" value={precioEntrada} onChange={(e) => setPrecioEntrada(e.target.value)} style={S.input} />
              <span style={{ fontSize: 11, color: S.FAINT }}>Comisión del 10% incluida — del bote real van el 90% (p.ej. 2,00 € → 1,80 € al bote).</span>
            </div>
            <button
              type="button"
              onClick={crearJornada}
              disabled={creando || !jornadaNombre.trim()}
              style={{ ...S.primaryButton, marginTop: 0, opacity: creando || !jornadaNombre.trim() ? 0.7 : 1 }}
            >
              {creando ? 'Creando...' : 'Crear jornada y cargar los 10 partidos'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={S.sectionLabel}>Jornadas creadas</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {porras.length === 0 && <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>Todavía no hay ninguna jornada creada.</p>}
              {porras.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.major}</span>
                    <span style={{ fontSize: 11, color: S.FAINT }}>{p.estado} · {p.precio.toFixed(2)} €</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <Link
                      href={`/admin/porras-futbol/${p.id}`}
                      style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: S.ACCENT, background: 'transparent', border: `1px solid rgba(61,220,132,0.4)`, borderRadius: 8, padding: '6px 10px', textDecoration: 'none' }}
                    >
                      Gestionar partidos
                    </Link>
                    <Link
                      href={`/porras/${p.id}`}
                      style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: '#C9D2CC', background: 'transparent', border: `1px solid ${S.BORDER}`, borderRadius: 8, padding: '6px 10px', textDecoration: 'none' }}
                    >
                      Ver
                    </Link>
                    <button
                      type="button"
                      disabled={eliminandoId === p.id}
                      onClick={() => eliminarPorra(p)}
                      style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: S.ERROR, background: 'transparent', border: `1px solid ${S.ERROR}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', opacity: eliminandoId === p.id ? 0.6 : 1 }}
                    >
                      {eliminandoId === p.id ? 'Eliminando...' : 'Eliminar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
