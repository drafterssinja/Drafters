'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { conTiempoMaximo } from '@/lib/conTiempoMaximo';
import { normalizarNombre } from '@/lib/nombreMatch';
import { formatEuros } from '@/lib/salaShared';
import { claveEquipoFutbol } from '@/lib/futbolLaLiga';
import type { ResultadoCompeticionFutbol } from '@/lib/server/sincronizarFutbolEspn';

// ============================================================================
// RESULTADOS DE FÚTBOL EN VIVO — panel de admin (06/10)
// ============================================================================
// Las mesas de fútbol (La Liga y Champions) puntúan con las tablas de
// Drafters calculadas con las estadísticas por jugador de ESPN, en directo.
// Todo se sincroniza solo (cron cada minuto, ver sql_futbol_puntos_espn.sql).
// Esta pantalla sirve para:
//   - Sincronizar a mano ahora ("Sincronizar ahora" / "Forzar").
//   - Comprobar, ANTES de la jornada, que nuestros equipos y jugadores se
//     casan con las plantillas de ESPN ("Comprobar equipos y jugadores"), y
//     enlazar a mano los que no (se guarda un alias que vale para siempre).
//   - Después de cada partido, ver los jugadores de ESPN que han jugado y no
//     tienen pareja en nuestra ficha (esos no puntuarían).
//   - Descargar los escudos ("Descargar escudos").

type JugadorFicha = { id: string; nombre: string; equipo: string | null };

export default function AdminResultadosFutbolPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [autorizado, setAutorizado] = useState(false);
  const [errorAcceso, setErrorAcceso] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [resultados, setResultados] = useState<ResultadoCompeticionFutbol[] | null>(null);
  const [seleccion, setSeleccion] = useState<Record<string, string>>({});
  const [guardados, setGuardados] = useState<Set<string>>(new Set());
  const [errorAlias, setErrorAlias] = useState<string | null>(null);

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
        const { data: perfilData, error: perfilError } = await conTiempoMaximo(supabase.from('perfiles').select('*').eq('id', session.user.id).single(), 'cargar tu perfil');
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
      } catch (e) {
        if (!activo) return;
        setErrorAcceso(e instanceof Error ? `No se ha podido comprobar tu acceso: ${e.message}` : 'No se ha podido comprobar tu acceso.');
      }
    }
    cargar();
    return () => {
      activo = false;
    };
  }, [router]);

  async function llamar(accion: 'sync' | 'forzar' | 'comprobar' | 'escudos' | 'crear' | 'reparar') {
    setTrabajando(true);
    setError(null);
    setMensaje(null);
    setResultados(null);
    setGuardados(new Set());
    setErrorAlias(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setTrabajando(false);
      setError('Tu sesión ha caducado. Vuelve a iniciar sesión.');
      return;
    }
    try {
      const res = await fetch(accion === 'crear' ? '/api/admin/crear-futbol-automatico' : accion === 'reparar' ? '/api/admin/reparar-jornadas-futbol' : '/api/admin/actualizar-futbol-en-vivo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'No se ha podido completar la acción.');
      } else if (accion === 'crear') {
        const r = (body.resultados ?? []) as { liga: string; jornada: number | null; estado: string; detalle: string }[];
        setMensaje(r.length === 0 ? 'Nada que hacer.' : r.map((x) => `${x.liga}${x.jornada ? ` J${x.jornada}` : ''} → ${x.estado}: ${x.detalle}`).join('\n'));
      } else if (accion === 'reparar') {
        const r = (body.resultados ?? []) as { competicion: string; estado: string; detalle: string }[];
        setMensaje(r.length === 0 ? 'No hay jornadas abiertas que reparar.' : r.map((x) => `${x.competicion} → ${x.estado}: ${x.detalle}`).join('\n'));
      } else if (accion === 'escudos') {
        setMensaje(`Escudos descargados: ${(body.escudos as { liga: string; equipos: number; error?: string }[]).map((e) => `${e.liga} ${e.equipos}${e.error ? ` (error: ${e.error})` : ''}`).join(' · ')}`);
      } else {
        setResultados((body.resultados ?? []) as ResultadoCompeticionFutbol[]);
        if (body.mensaje) setMensaje(body.mensaje);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido completar la acción.');
    } finally {
      setTrabajando(false);
    }
  }

  async function guardarAlias(competicion: string, nombreTabla: string, fichas: JugadorFicha[]) {
    const clave = `${competicion}:::${nombreTabla}`;
    const ficha = fichas.find((f) => f.id === seleccion[clave]);
    if (!ficha) {
      setErrorAlias('Elige a qué jugador corresponde antes de guardar.');
      return;
    }
    setErrorAlias(null);
    const { error: upsertError } = await supabase.from('alias_nombres_jugador').upsert(
      {
        deporte: 'futbol',
        nombre_origen: nombreTabla,
        nombre_normalizado_origen: normalizarNombre(nombreTabla),
        nombre_destino: ficha.nombre,
        nombre_normalizado_destino: normalizarNombre(ficha.nombre.replace(/\([^)]*\)\s*$/, '')),
        fuente: 'espn',
      },
      { onConflict: 'deporte,nombre_normalizado_origen' }
    );
    if (upsertError) {
      setErrorAlias(`No se ha podido guardar el alias: ${upsertError.message}`);
      return;
    }
    setGuardados((prev) => new Set(prev).add(clave));
  }

  if (errorAcceso) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader />
          <div style={{ padding: '40px 20px' }}>
            <p style={S.errorText}>{errorAcceso}</p>
          </div>
        </div>
      </main>
    );
  }
  if (!autorizado || !perfil) {
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

  const saldoLabel = formatEuros(perfil.saldo_simulado);
  const initials = S.iniciales(perfil.nombre, perfil.apellido);
  const boton = (texto: string, accion: 'sync' | 'forzar' | 'comprobar' | 'escudos' | 'crear' | 'reparar', principal = false) => (
    <button
      type="button"
      disabled={trabajando}
      onClick={() => llamar(accion)}
      style={{ ...(principal ? S.primaryButton : S.secondaryLinkButton), width: 'auto', padding: '10px 16px', opacity: trabajando ? 0.6 : 1, cursor: trabajando ? 'default' : 'pointer' }}
    >
      {texto}
    </button>
  );

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
        <div style={S.accountSection}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>Resultados de fútbol en vivo</h1>
            <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0, lineHeight: 1.5 }}>
              Mesas de La Liga y Champions: puntos de las tablas de Drafters calculados con las estadísticas por jugador de ESPN, marcadores, minuto, escudos y goles en directo. Todo se sincroniza solo mientras hay mesas activas; aquí puedes lanzarlo a mano. Se ve en la{' '}
              <Link href="/salas" style={{ color: S.ACCENT }}>
                clasificación en directo
              </Link>{' '}
              de cada mesa.
            </p>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {boton('Sincronizar ahora', 'sync', true)}
            {boton('Comprobar equipos y jugadores', 'comprobar')}
            {boton('Descargar escudos', 'escudos')}
            {boton('Forzar sincronización', 'forzar')}
            {boton('Crear jornadas ahora', 'crear')}
            {boton('Reparar jornadas (añadir jugadores que faltan)', 'reparar')}
          </div>
          <p style={{ fontSize: 10.5, color: S.MUTED_3, lineHeight: 1.4, margin: 0 }}>
            "Crear jornadas ahora" comprueba el calendario de ESPN y crea las jornadas de La Liga y Champions que ya tengan todos los horarios confirmados (también se hace solo cada 30 minutos). "Sincronizar ahora" respeta las reglas del cron (no hace nada si la jornada está a más de 12 h o ya está completa). "Forzar" lo ejecuta igualmente y recalcula también los partidos ya congelados.
          </p>

          {trabajando && <p style={{ fontSize: 13, color: S.MUTED }}>Trabajando... (la comprobación de plantillas puede tardar unos segundos)</p>}
          {error && <p style={S.errorText}>{error}</p>}
          {mensaje && <p style={{ fontSize: 12.5, color: S.MUTED_2, margin: 0, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{mensaje}</p>}
          {errorAlias && <p style={S.errorText}>{errorAlias}</p>}

          {resultados?.map((r) => {
            const fichas: JugadorFicha[] = r.nombresFichaSinEmparejar;
            return (
              <div key={r.competicion} style={{ display: 'flex', flexDirection: 'column', gap: 8, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14 }}>
                <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 14, color: S.TEXT }}>{r.competicion}</span>
                <span style={{ fontSize: 12, color: r.ok ? S.MUTED : S.ERROR }}>
                  {r.estado === 'error'
                    ? `Error: ${r.error}`
                    : r.estado === 'pendiente_de_empezar'
                      ? r.aviso
                      : r.estado === 'completa'
                        ? 'Jornada completa: todos los partidos actualizados.'
                        : r.estado === 'no_soportada'
                          ? r.aviso
                          : `${r.jugadoresEmparejados}/${r.jugadoresEnFicha} jugadores emparejados · ${r.partidosEncontrados} partidos (${r.partidosFinalizados} terminados)`}
                </span>
                {r.aviso && r.estado === 'sincronizada' && <span style={{ fontSize: 11.5, color: '#F0B94D' }}>{r.aviso}</span>}
                {r.equiposSinEmparejar.length > 0 && (
                  <span style={{ fontSize: 11.5, color: S.ERROR }}>
                    Equipos nuestros sin pareja en ESPN (hay que añadir su nombre a lib/aliasEquipos.ts): {r.equiposSinEmparejar.join(', ')}
                  </span>
                )}
                {r.equiposSinPartido.length > 0 && (
                  <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>Equipos sin partido en el marcador: {r.equiposSinPartido.join(', ')}</span>
                )}

                {r.partidos.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {r.partidos.map((p) => (
                      <span key={`${p.local}-${p.visitante}`} style={{ fontSize: 11.5, color: S.MUTED }}>
                        {p.local} {p.marcador ?? 'vs'} {p.visitante} — {p.estado === 'pendiente' ? 'pendiente' : p.estado === 'en_juego' ? 'en juego' : p.estado === 'aplazado' ? 'aplazado' : 'terminado'}
                        {p.actualizado ? ' · puntos definitivos' : ''}
                      </span>
                    ))}
                  </div>
                )}

                {r.jugadoresEspnSinEmparejar.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                    <span style={S.sectionLabel}>Jugadores de ESPN que han jugado y no están emparejados con nuestra ficha ({r.jugadoresEspnSinEmparejar.length})</span>
                    <span style={{ fontSize: 10.5, color: S.MUTED_3, lineHeight: 1.4 }}>
                      Si alguno es un jugador que sí tenemos con otro nombre, elígelo y guarda: queda enlazado para siempre y sus puntos se recalculan en la siguiente pasada. (Los que no están en nuestra lista simplemente no puntúan; es normal.)
                    </span>
                    {r.jugadoresEspnSinEmparejar.slice(0, 80).map((n) => {
                      const clave = `${r.competicion}:::${n.nombre}`;
                      const hecho = guardados.has(clave);
                      return (
                        <div key={clave} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, color: S.TEXT, minWidth: 150 }}>
                            {n.nombre} <span style={{ color: S.MUTED_3 }}>({n.equipo})</span>
                          </span>
                          <select
                            value={seleccion[clave] ?? ''}
                            onChange={(e) => setSeleccion((prev) => ({ ...prev, [clave]: e.target.value }))}
                            style={{ ...S.selectInput, width: 'auto', minWidth: 160, padding: '6px 8px', fontSize: 12 }}
                          >
                            <option value="">— nuestro jugador —</option>
                            {fichas.filter((f) => !n.equipo || claveEquipoFutbol(f.equipo) === claveEquipoFutbol(n.equipo)).map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.nombre} {f.equipo ? `(${f.equipo})` : ''}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={hecho}
                            onClick={() => guardarAlias(r.competicion, n.nombre, fichas)}
                            style={{ ...S.pill(false), padding: '5px 10px', fontSize: 11, opacity: hecho ? 0.6 : 1 }}
                          >
                            {hecho ? 'Guardado' : 'Guardar alias'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {fichas.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                    <span style={S.sectionLabel}>Nuestros jugadores sin pareja en ESPN ({fichas.length})</span>
                    <span style={{ fontSize: 11.5, color: S.MUTED_3, lineHeight: 1.5 }}>
                      {fichas.slice(0, 120).map((f) => `${f.nombre}${f.equipo ? ` (${f.equipo})` : ''}`).join(' · ')}
                      {fichas.length > 120 ? ' …' : ''}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
