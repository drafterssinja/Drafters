'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import Cargando from '@/components/Cargando';

// ============================================================================
// ADMIN · LIGA DE DUELOS 1 CONTRA 1 (fútbol V2, 26/10, SQL 60)
// ============================================================================
// 1. Crear la temporada: de qué jornada a qué jornada de LaLiga (una vuelta).
//    Las de Champions de esas fechas se añaden solas (calendario).
// 2. Empezar: se forman las divisiones con los apuntados (ascensos/descensos
//    de la temporada anterior; los nuevos, abajo) y el calendario sorteado.
// 3. Al acabar: cerrar (puestos finales, quién sube y quién baja).

type Ronda = { id: string; orden: number; competicion: string; tipo: string; estado: string; duelos: number };
type Temporada = { id: string; nombre: string; estado: string; desde: number; hasta: number; tam: number; ascensos: number; descensos: number; rondas: Ronda[]; divisiones: { id: string; nombre: string; nivel: number; jugadores: number }[] };
type Resumen = { apuntados: { usuario_id: string; nombre: string; unido_en: string }[]; temporadas: Temporada[]; calendario_liga: { numero: number; inicio: string }[] };

const boton = { width: 'auto', padding: '9px 14px', borderRadius: 10, border: 'none', background: S.ACCENT, color: '#04140B', fontWeight: 800, fontSize: 13, cursor: 'pointer' } as const;

export default function AdminLigaDuelos() {
  const router = useRouter();
  const [datos, setDatos] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('19');
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, setConfirmar] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('duelos_admin_resumen');
    if (e) return setError(e.message.includes('duelos_admin_resumen') ? 'Falta ejecutar 60_sql_v2_liga_duelos_y_amistosos_de_10_26-10.sql en Supabase.' : e.message);
    const r = data as Resumen;
    setDatos(r);
    // Sugerencia: la próxima jornada de LaLiga que no ha empezado.
    const prox = r.calendario_liga.find((c) => new Date(c.inicio).getTime() > Date.now());
    if (prox) {
      setDesde((d) => d || String(prox.numero));
      setHasta((h) => (h === '19' && prox.numero > 19 ? '38' : h));
    }
  }, []);

  useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return router.push('/login');
      const { data: p } = await supabase.from('perfiles').select('rol').eq('id', session.user.id).single();
      if (!p || p.rol !== 'admin') return router.push('/cuenta');
      void cargar();
    })();
  }, [router, cargar]);

  async function llamar(fn: string, args: Record<string, unknown>, ok: string) {
    setOcupado(true);
    setError(null);
    setAviso(null);
    const { data, error: e } = await supabase.rpc(fn, args);
    setOcupado(false);
    setConfirmar(null);
    if (e) return setError(e.message.replace(/^ERROR:\s*/i, ''));
    setAviso(typeof data === 'object' && data ? `${ok} ${JSON.stringify(data)}` : ok);
    void cargar();
  }

  const abierta = datos?.temporadas.find((t) => t.estado !== 'terminada');
  const nDesde = Number(desde);
  const nHasta = Number(hasta);
  const jornadas = nDesde && nHasta && nHasta >= nDesde ? nHasta - nDesde + 1 : 0;
  const tam = jornadas ? ((jornadas + 1) % 2 === 0 ? jornadas + 1 : jornadas) : 0;

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader sinVolver />
        <div style={{ ...S.accountSection, gap: 14 }}>
          <Link href="/admin" style={{ fontSize: 12, color: S.MUTED_2, textDecoration: 'none' }}>
            ← Panel de administración
          </Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>Liga de duelos (fútbol)</h1>
          <p style={{ fontSize: 12.5, color: S.MUTED_2, margin: 0, lineHeight: 1.5 }}>
            Temporada = una vuelta de LaLiga. Divisiones de tantos como jornadas + 1 (20 en una vuelta completa): todos contra todos, una vez. Champions = jornadas extra con rival sorteado. Ganar 3, empatar 1, perder 0. Suben y bajan 5 de 20 (la cuarta parte en divisiones más pequeñas). Cada jornada cuesta 1 crédito.
          </p>
          {error && <p style={{ fontSize: 13, color: S.ERROR, margin: 0 }}>{error}</p>}
          {aviso && <p style={{ fontSize: 13, color: S.ACCENT, margin: 0 }}>{aviso}</p>}
          {!datos && !error && <Cargando compacto />}

          {datos && (
            <>
              <div style={{ ...S.card, flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <span style={{ fontWeight: 800, color: S.TEXT }}>Apuntados: {datos.apuntados.length}</span>
                <span style={{ fontSize: 12, color: S.MUTED_2, lineHeight: 1.6 }}>{datos.apuntados.map((a) => a.nombre).join(' · ') || 'Nadie todavía'}</span>
              </div>

              {!abierta && (
                <div style={{ ...S.card, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                  <span style={{ fontWeight: 800, color: S.TEXT }}>1. Crear temporada</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, color: S.MUTED }}>De la jornada</span>
                    <input value={desde} onChange={(e) => setDesde(e.target.value.replace(/\D/g, ''))} style={{ ...S.input, width: 70 }} inputMode="numeric" />
                    <span style={{ fontSize: 13, color: S.MUTED }}>a la</span>
                    <input value={hasta} onChange={(e) => setHasta(e.target.value.replace(/\D/g, ''))} style={{ ...S.input, width: 70 }} inputMode="numeric" />
                  </div>
                  {jornadas > 0 && (
                    <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>
                      {jornadas} jornadas de LaLiga → divisiones de hasta {tam} jugadores (+ las de Champions de esas fechas).
                    </span>
                  )}
                  <button type="button" disabled={ocupado || !jornadas} onClick={() => void llamar('duelos_crear_temporada', { p_desde: nDesde, p_hasta: nHasta }, 'Temporada creada.')} style={{ ...boton, opacity: ocupado || !jornadas ? 0.5 : 1 }}>
                    Crear temporada
                  </button>
                </div>
              )}

              {datos.temporadas.map((t) => (
                <div key={t.id} style={{ ...S.card, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 800, color: S.TEXT }}>{t.nombre}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: t.estado === 'en_juego' ? S.ACCENT : S.MUTED_2, textTransform: 'uppercase' }}>{t.estado === 'inscripcion' ? 'Sin empezar' : t.estado === 'en_juego' ? 'En juego' : 'Terminada'}</span>
                  </div>
                  <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>
                    Divisiones de hasta {t.tam} · suben {t.ascensos} y bajan {t.descensos} (en las completas)
                  </span>
                  {t.divisiones.length > 0 && <span style={{ fontSize: 12.5, color: S.MUTED }}>{t.divisiones.map((d) => `${d.nombre}: ${d.jugadores}`).join(' · ')}</span>}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {t.rondas.map((r) => (
                      <span key={r.id} title={r.competicion} style={{ fontSize: 11, padding: '3px 7px', borderRadius: 6, background: r.tipo === 'champions' ? 'rgba(127,178,255,0.15)' : '#1A211D', color: r.estado === 'terminada' ? S.MUTED_3 : r.estado === 'en_juego' ? S.ACCENT : S.MUTED }}>
                        {r.tipo === 'champions' ? 'UCL ' : 'J'}
                        {r.competicion.match(/(\d+)\s*$/)?.[1]}
                        {r.estado === 'terminada' ? ' ✓' : r.estado === 'en_juego' ? ' ●' : ''}
                      </span>
                    ))}
                  </div>
                  {t.estado === 'inscripcion' && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {confirmar === `empezar:${t.id}` ? (
                        <button type="button" disabled={ocupado} onClick={() => void llamar('duelos_empezar_temporada', { p_temporada: t.id }, 'Temporada empezada.')} style={boton}>
                          Sí, formar divisiones con los {datos.apuntados.length} apuntados
                        </button>
                      ) : (
                        <button type="button" disabled={ocupado} onClick={() => setConfirmar(`empezar:${t.id}`)} style={boton}>
                          2. Empezar (divisiones y calendario)
                        </button>
                      )}
                      <button type="button" disabled={ocupado} onClick={() => void llamar('duelos_anadir_champions', { p_temporada: t.id }, 'Jornadas de Champions añadidas:')} style={{ ...boton, background: 'transparent', color: S.TEXT, border: `1px solid ${S.BORDER}` }}>
                        Añadir jornadas de Champions
                      </button>
                    </div>
                  )}
                  {t.estado === 'en_juego' && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" disabled={ocupado} onClick={() => void llamar('duelos_anadir_champions', { p_temporada: t.id }, 'Jornadas de Champions añadidas:')} style={{ ...boton, background: 'transparent', color: S.TEXT, border: `1px solid ${S.BORDER}` }}>
                        Añadir jornadas de Champions
                      </button>
                      {confirmar === `cerrar:${t.id}` ? (
                        <button type="button" disabled={ocupado} onClick={() => void llamar('duelos_cerrar_temporada', { p_temporada: t.id }, 'Temporada cerrada.')} style={{ ...boton, background: '#FF5C5C', color: '#fff' }}>
                          Sí, cerrar: puestos finales, ascensos y descensos
                        </button>
                      ) : (
                        <button type="button" disabled={ocupado} onClick={() => setConfirmar(`cerrar:${t.id}`)} style={{ ...boton, background: 'transparent', color: '#FF8A8A', border: '1px solid rgba(255,138,138,0.5)' }}>
                          3. Cerrar temporada
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
