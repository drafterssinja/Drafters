'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';

// ============================================================================
// GESTIONAR PARTIDOS DE UNA JORNADA — admin (nuevo, 29/09)
// ============================================================================
// Pedido de Iñi, con la estructura exacta que quiere ver en la pantalla real
// del usuario: "escudo del equipo, nombre del equipo que juega en casa,
// botón del 1, botón del X, botón del 2, nombre del equipo que juega afuera
// y escudo". Aquí, en el admin, se cargan esos mismos 10 partidos (nombre de
// cada equipo + URL de escudo opcional) y, más adelante, se marca a mano el
// resultado real de cada uno según se van jugando — decisión de Iñi: "lo
// marcas tú a mano", sin conectar ninguna API de resultados en directo.
//
// Los escudos son opcionales a propósito: Drafters no incluye ni aloja
// escudos oficiales con licencia (ver DRAFTERS_Costes_Business_Plan.md) — si
// no se pega una URL, la pantalla del usuario pinta un círculo con las
// iniciales del equipo en su lugar (ver PORRA_FUTBOL_ESCUDO_FALLBACK en
// app/porras/[id]/crear-equipo/page.tsx).

const NUM_PARTIDOS = 10;

type PorraFutbol = {
  id: string;
  major: string;
  estado: string;
  precio: number;
};

type PartidoForm = {
  id: string | null;
  orden: number;
  equipo_local: string;
  equipo_visitante: string;
  escudo_local_url: string;
  escudo_visitante_url: string;
  resultado_real: '' | '1' | 'x' | '2';
};

type ClasificacionFila = {
  equipo_id: string;
  nombre_equipo: string;
  aciertos: number;
  partidos_resueltos: number;
  total_partidos: number;
};

function partidoVacio(orden: number): PartidoForm {
  return { id: null, orden, equipo_local: '', equipo_visitante: '', escudo_local_url: '', escudo_visitante_url: '', resultado_real: '' };
}

export default function AdminGestionarPartidosPage() {
  const router = useRouter();
  const params = useParams();
  const porraId = params?.id as string;

  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [porra, setPorra] = useState<PorraFutbol | null>(null);
  const [partidos, setPartidos] = useState<PartidoForm[]>(Array.from({ length: NUM_PARTIDOS }, (_, i) => partidoVacio(i + 1)));
  const [clasificacion, setClasificacion] = useState<ClasificacionFila[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);

  async function cargarTodo() {
    const [{ data: porraData }, { data: partidosData }, { data: clasificacionData }] = await Promise.all([
      supabase.from('porras').select('id, major, estado, precio').eq('id', porraId).single(),
      supabase.from('partidos_porra_futbol').select('*').eq('porra_id', porraId).order('orden', { ascending: true }),
      supabase.rpc('futbol_porra_clasificacion', { p_porra_id: porraId }),
    ]);

    setPorra((porraData as PorraFutbol) ?? null);

    const porOrden = new Map<number, PartidoForm>();
    ((partidosData as (PartidoForm & { porra_id: string })[] | null) ?? []).forEach((p) => {
      porOrden.set(p.orden, {
        id: p.id,
        orden: p.orden,
        equipo_local: p.equipo_local ?? '',
        equipo_visitante: p.equipo_visitante ?? '',
        escudo_local_url: p.escudo_local_url ?? '',
        escudo_visitante_url: p.escudo_visitante_url ?? '',
        resultado_real: (p.resultado_real as PartidoForm['resultado_real']) ?? '',
      });
    });
    setPartidos(Array.from({ length: NUM_PARTIDOS }, (_, i) => porOrden.get(i + 1) ?? partidoVacio(i + 1)));
    setClasificacion((clasificacionData as ClasificacionFila[]) ?? []);
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
      await cargarTodo();
    }

    if (porraId) cargar();
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, porraId]);

  function actualizarPartido(index: number, cambios: Partial<PartidoForm>) {
    setPartidos((prev) => prev.map((p, i) => (i === index ? { ...p, ...cambios } : p)));
  }

  async function guardarPartidos() {
    setGuardando(true);
    setError(null);
    setResultado(null);

    const filas = partidos
      .filter((p) => p.equipo_local.trim() && p.equipo_visitante.trim())
      .map((p) => ({
        porra_id: porraId,
        orden: p.orden,
        equipo_local: p.equipo_local.trim(),
        equipo_visitante: p.equipo_visitante.trim(),
        escudo_local_url: p.escudo_local_url.trim() || null,
        escudo_visitante_url: p.escudo_visitante_url.trim() || null,
        resultado_real: p.resultado_real || null,
      }));

    if (filas.length === 0) {
      setGuardando(false);
      setError('Rellena al menos el nombre de los dos equipos de un partido antes de guardar.');
      return;
    }

    const { error: upsertError } = await supabase.from('partidos_porra_futbol').upsert(filas, { onConflict: 'porra_id,orden' });

    setGuardando(false);
    if (upsertError) {
      setError('No se han podido guardar los partidos. Inténtalo de nuevo.');
      return;
    }

    setResultado(
      filas.length < NUM_PARTIDOS
        ? `Guardados ${filas.length} de ${NUM_PARTIDOS} partidos — completa el resto cuando los tengas.`
        : `Los ${NUM_PARTIDOS} partidos están guardados.`
    );
    await cargarTodo();
  }

  if (autorizado === null || !perfil || !porra) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader sinVolver />
          <div style={{ padding: '40px 20px' }}>
            <p style={{ fontSize: 14, color: S.MUTED }}>Cargando...</p>
          </div>
        </div>
      </main>
    );
  }

  const partidosCompletos = partidos.filter((p) => p.equipo_local.trim() && p.equipo_visitante.trim()).length;
  const partidosConResultado = partidos.filter((p) => p.resultado_real).length;

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader sinVolver saldoLabel={`${perfil.saldo_simulado.toFixed(2)} €`} accountInitials={S.iniciales(perfil.nombre, perfil.apellido)} />
        <div style={S.accountSection}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Link href="/admin/porras-futbol" style={{ fontSize: 12, color: S.MUTED_2, textDecoration: 'none' }}>
              ← Porras de fútbol
            </Link>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>{porra.major}</h1>
            <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>
              {partidosCompletos}/{NUM_PARTIDOS} partidos cargados · {partidosConResultado}/{NUM_PARTIDOS} con resultado marcado · {porra.estado}
            </p>
          </div>

          {error && <p style={S.errorText}>{error}</p>}
          {resultado && <p style={S.infoText}>{resultado}</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14 }}>
            <span style={S.sectionLabel}>Los 10 partidos</span>
            <p style={{ fontSize: 11.5, color: S.MUTED_3, margin: 0, lineHeight: 1.5 }}>
              La URL del escudo es opcional — si la dejas en blanco, se muestra un círculo con las iniciales del equipo. Marca el resultado real (1 / X / 2) en cuanto se juegue cada partido.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {partidos.map((p, i) => (
                <div key={p.orden} style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'rgba(255,255,255,0.02)', border: `1px solid ${S.CARD_BORDER}`, borderRadius: 10, padding: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: S.MUTED_3 }}>Partido {p.orden}</span>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input
                      value={p.equipo_local}
                      onChange={(e) => actualizarPartido(i, { equipo_local: e.target.value })}
                      placeholder="Equipo local"
                      style={{ ...S.input, flex: '1 1 160px', padding: '8px 10px', fontSize: 13 }}
                    />
                    <input
                      value={p.equipo_visitante}
                      onChange={(e) => actualizarPartido(i, { equipo_visitante: e.target.value })}
                      placeholder="Equipo visitante"
                      style={{ ...S.input, flex: '1 1 160px', padding: '8px 10px', fontSize: 13 }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input
                      value={p.escudo_local_url}
                      onChange={(e) => actualizarPartido(i, { escudo_local_url: e.target.value })}
                      placeholder="URL escudo local (opcional)"
                      style={{ ...S.input, flex: '1 1 160px', padding: '8px 10px', fontSize: 12 }}
                    />
                    <input
                      value={p.escudo_visitante_url}
                      onChange={(e) => actualizarPartido(i, { escudo_visitante_url: e.target.value })}
                      placeholder="URL escudo visitante (opcional)"
                      style={{ ...S.input, flex: '1 1 160px', padding: '8px 10px', fontSize: 12 }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: S.MUTED_2, marginRight: 4 }}>Resultado real:</span>
                    {(['1', 'x', '2'] as const).map((opcion) => (
                      <button
                        key={opcion}
                        type="button"
                        onClick={() => actualizarPartido(i, { resultado_real: p.resultado_real === opcion ? '' : opcion })}
                        style={S.pill(p.resultado_real === opcion)}
                      >
                        {opcion.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={guardarPartidos} disabled={guardando} style={{ ...S.primaryButton, marginTop: 0, opacity: guardando ? 0.7 : 1 }}>
              {guardando ? 'Guardando...' : 'Guardar partidos y resultados'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={S.sectionLabel}>Clasificación provisional (aciertos)</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {clasificacion.length === 0 && <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>Todavía no hay ningún equipo inscrito.</p>}
              {clasificacion.map((c, i) => (
                <div key={c.equipo_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 10, padding: '8px 12px' }}>
                  <span style={{ fontSize: 12.5, color: S.TEXT, fontWeight: 700 }}>
                    {i + 1}º · {c.nombre_equipo}
                  </span>
                  <span style={{ fontSize: 12, color: S.MUTED_2 }}>
                    {c.aciertos} acierto{c.aciertos === 1 ? '' : 's'} de {c.partidos_resueltos} resuelto{c.partidos_resueltos === 1 ? '' : 's'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
