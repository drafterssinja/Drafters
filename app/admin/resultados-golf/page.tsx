'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { conTiempoMaximo } from '@/lib/conTiempoMaximo';

// ============================================================================
// RESULTADOS DE GOLF EN VIVO — panel de admin (nuevo, 28/09)
// ============================================================================
// Pantalla propia, mismo patrón que /admin/videos: gestiona la tabla
// `torneos_golf_live` (drafters-schema.sql) — la relación entre una
// "competicion" de Drafters (el mismo texto libre que ya usan
// jugadores.competicion / porras.competicion / salas.competicion) y el
// torneo correspondiente en ESPN (tour + id de evento).
//
// El texto de "competicion" tiene que ser EXACTAMENTE igual, carácter a
// carácter, al que tengan ya los jugadores de esa porra en la tabla
// `jugadores` — si no coincide, la sincronización no encuentra a ningún
// jugador de ese torneo (columna "jugadoresEnCampo" de la última
// sincronización se quedaría a 0, ver abajo).
//
// El id de evento de ESPN se saca de la propia web pública de ESPN: entra
// en https://www.espn.com/golf/leaderboard (o .../schedule del tour que
// toque) y busca el torneo — la URL de su leaderboard lleva
// "...leaderboard?tournamentId=XXXXXX&..." o "/leaderboard/_/id/XXXXXX/...";
// ese número (o código) es el que va aquí.
//
// El botón "Actualizar ahora" llama a la misma ruta que usa el cron
// automático de Supabase (cada 5 minutos, ver el final de
// drafters-schema.sql), pero autenticado con la sesión del admin en vez
// del secreto compartido — útil para probar una configuración nueva sin
// esperar al siguiente ciclo del cron.

type TorneoGolfLive = {
  id: string;
  competicion: string;
  tour: 'pga' | 'eur';
  espn_event_id: string;
  temporada: number;
  activo: boolean;
  ultima_actualizacion: string | null;
  ultimo_error: string | null;
};

type ResultadoSync = {
  competicion: string;
  ok: boolean;
  jugadoresEnCampo: number;
  jugadoresEmparejados: number;
  nombresSinEmparejar: string[];
  hoyosActualizados: number;
  error?: string;
};

const TOUR_LABELS: Record<'pga' | 'eur', string> = { pga: 'PGA Tour', eur: 'DP World Tour' };

export default function AdminResultadosGolfPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [errorAcceso, setErrorAcceso] = useState<string | null>(null);
  const [torneos, setTorneos] = useState<TorneoGolfLive[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Formulario de nuevo torneo.
  const [competicion, setCompeticion] = useState('');
  const [tour, setTour] = useState<'pga' | 'eur'>('pga');
  const [espnEventId, setEspnEventId] = useState('');
  const [temporada, setTemporada] = useState(String(new Date().getFullYear()));
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

  const [sincronizando, setSincronizando] = useState(false);
  const [resultadoSync, setResultadoSync] = useState<ResultadoSync[] | null>(null);
  const [errorSync, setErrorSync] = useState<string | null>(null);

  async function cargarTorneos() {
    const { data, error: torneosError } = await supabase.from('torneos_golf_live').select('*').order('competicion');
    if (torneosError) {
      setError('No se han podido cargar los torneos de golf en vivo.');
      return;
    }
    setTorneos((data as TorneoGolfLive[]) ?? []);
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
        await cargarTorneos();
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

  async function crearTorneo() {
    setErrorGuardar(null);
    if (!competicion.trim()) {
      setErrorGuardar('Pon el nombre exacto de la competición (tal cual está en jugadores/porras).');
      return;
    }
    if (!espnEventId.trim()) {
      setErrorGuardar('Pon el id del evento en ESPN.');
      return;
    }
    const temporadaNum = parseInt(temporada, 10);
    if (!Number.isFinite(temporadaNum)) {
      setErrorGuardar('La temporada tiene que ser un año válido.');
      return;
    }

    setGuardando(true);
    const { error: insertError } = await supabase.from('torneos_golf_live').insert({
      competicion: competicion.trim(),
      tour,
      espn_event_id: espnEventId.trim(),
      temporada: temporadaNum,
      activo: true,
    });
    setGuardando(false);

    if (insertError) {
      setErrorGuardar(`No se ha podido guardar: ${insertError.message}`);
      return;
    }

    setCompeticion('');
    setEspnEventId('');
    setTemporada(String(new Date().getFullYear()));
    await cargarTorneos();
  }

  async function actualizarTorneo(id: string, cambios: Partial<Pick<TorneoGolfLive, 'activo' | 'tour' | 'espn_event_id' | 'temporada'>>) {
    setTorneos((prev) => prev.map((t) => (t.id === id ? { ...t, ...cambios } : t)));
    const { error: updateError } = await supabase.from('torneos_golf_live').update(cambios).eq('id', id);
    if (updateError) {
      setError('No se ha podido guardar el cambio. Se ha recargado la lista.');
      await cargarTorneos();
    }
  }

  async function eliminarTorneo(t: TorneoGolfLive) {
    if (!window.confirm(`¿Eliminar la conexión con ESPN de "${t.competicion}"? Los resultados ya guardados no se borran, pero dejará de actualizarse.`)) {
      return;
    }
    const { error: deleteError } = await supabase.from('torneos_golf_live').delete().eq('id', t.id);
    if (deleteError) {
      setError('No se ha podido eliminar.');
      return;
    }
    setTorneos((prev) => prev.filter((x) => x.id !== t.id));
  }

  async function actualizarAhora() {
    setSincronizando(true);
    setErrorSync(null);
    setResultadoSync(null);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      setSincronizando(false);
      setErrorSync('Tu sesión ha caducado. Vuelve a iniciar sesión.');
      return;
    }

    try {
      const res = await fetch('/api/admin/actualizar-golf-en-vivo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await res.json();
      if (!res.ok) {
        setErrorSync(body.error ?? 'No se ha podido sincronizar.');
      } else {
        setResultadoSync(body.resultados ?? []);
        await cargarTorneos();
      }
    } catch (e) {
      setErrorSync(e instanceof Error ? e.message : 'No se ha podido sincronizar.');
    } finally {
      setSincronizando(false);
    }
  }

  if (errorAcceso) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader />
          <div style={S.accountSection}>
            <p style={S.errorText}>{errorAcceso}</p>
            <button type="button" onClick={() => window.location.reload()} style={S.primaryButton}>
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

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
        <div style={S.accountSection}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>
              Resultados de golf en vivo
            </h1>
            <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0, lineHeight: 1.5 }}>
              Conecta cada competición de Drafters con su torneo en ESPN. Se sincroniza solo, cada 5 minutos, mediante un
              cron programado en Supabase. Los resultados se ven en la{' '}
              <Link href="/" style={{ color: S.ACCENT }}>
                clasificación en directo
              </Link>{' '}
              de cada porra.
            </p>
          </div>

          {error && <p style={S.errorText}>{error}</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14 }}>
            <span style={S.sectionLabel}>Conectar una competición nueva</span>

            <div style={S.field}>
              <span style={S.label}>Competición (texto exacto de jugadores.competicion / porras.competicion)</span>
              <input value={competicion} onChange={(e) => setCompeticion(e.target.value)} placeholder="p.ej. The Open Championship 2026" style={S.input} />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ ...S.field, flex: 1 }}>
                <span style={S.label}>Tour</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" style={S.pill(tour === 'pga')} onClick={() => setTour('pga')}>
                    PGA Tour
                  </button>
                  <button type="button" style={S.pill(tour === 'eur')} onClick={() => setTour('eur')}>
                    DP World Tour
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ ...S.field, flex: 1 }}>
                <span style={S.label}>Id de evento en ESPN</span>
                <input value={espnEventId} onChange={(e) => setEspnEventId(e.target.value)} placeholder="p.ej. 401703504" style={S.input} />
              </div>
              <div style={{ ...S.field, width: 110 }}>
                <span style={S.label}>Temporada</span>
                <input value={temporada} onChange={(e) => setTemporada(e.target.value)} style={S.input} />
              </div>
            </div>

            {errorGuardar && <p style={S.errorText}>{errorGuardar}</p>}

            <button type="button" disabled={guardando} onClick={crearTorneo} style={{ ...S.primaryButton, opacity: guardando ? 0.7 : 1 }}>
              {guardando ? 'Guardando...' : 'Conectar competición'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={S.sectionLabel}>
                {torneos.length} competición{torneos.length === 1 ? '' : 'es'} conectada{torneos.length === 1 ? '' : 's'}
              </span>
              <button type="button" disabled={sincronizando} onClick={actualizarAhora} style={{ ...S.secondaryLinkButton, width: 'auto', padding: '8px 14px', opacity: sincronizando ? 0.7 : 1, cursor: 'pointer', border: 'none' }}>
                {sincronizando ? 'Actualizando...' : 'Actualizar ahora'}
              </button>
            </div>

            {errorSync && <p style={S.errorText}>{errorSync}</p>}

            {resultadoSync && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 10, padding: 10 }}>
                {resultadoSync.length === 0 && <p style={{ fontSize: 12, color: S.MUTED_3, margin: 0 }}>No hay ninguna competición activa que sincronizar.</p>}
                {resultadoSync.map((r) => (
                  <div key={r.competicion} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: r.ok ? S.TEXT : S.ERROR }}>
                      {r.competicion}: {r.ok ? `${r.jugadoresEmparejados}/${r.jugadoresEnCampo} jugadores emparejados, ${r.hoyosActualizados} hoyos actualizados` : `error — ${r.error}`}
                    </span>
                    {r.nombresSinEmparejar.length > 0 && (
                      <span style={{ fontSize: 11, color: S.MUTED_3 }}>
                        Sin emparejar en ESPN: {r.nombresSinEmparejar.join(', ')}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {torneos.length === 0 && <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>Todavía no hay ninguna competición conectada.</p>}

            {torneos.map((t) => (
              <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.competicion}
                    </span>
                    <span style={{ fontSize: 11, color: S.MUTED_3 }}>
                      {TOUR_LABELS[t.tour]} · ESPN #{t.espn_event_id} · temporada {t.temporada}
                    </span>
                    <span style={{ fontSize: 10.5, color: t.ultimo_error ? S.ERROR : S.MUTED_3 }}>
                      {t.ultimo_error
                        ? `Último error: ${t.ultimo_error}`
                        : t.ultima_actualizacion
                          ? `Última actualización: ${new Date(t.ultima_actualizacion).toLocaleString('es-ES')}`
                          : 'Todavía no se ha sincronizado.'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => eliminarTorneo(t)}
                    aria-label="Eliminar"
                    style={{ flexShrink: 0, background: 'transparent', border: `1px solid ${S.BORDER}`, borderRadius: 8, color: S.ERROR, width: 32, height: 32, cursor: 'pointer' }}
                  >
                    ×
                  </button>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: S.TEXT, cursor: 'pointer', padding: '3px 0' }}>
                  <input
                    type="checkbox"
                    checked={t.activo}
                    onChange={(e) => actualizarTorneo(t.id, { activo: e.target.checked })}
                    style={{ width: 16, height: 16, flexShrink: 0, accentColor: S.ACCENT, cursor: 'pointer' }}
                  />
                  Activo (se sincroniza en el cron de cada 5 minutos)
                </label>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
