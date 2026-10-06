'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { parseListaJugadores, JugadorParseado } from '@/lib/parsePlayerList';

// ============================================================================
// RANKING DE JUGADORES — menú de administración dedicado (nuevo, 28/09)
// ============================================================================
// Movido a su propio menú (28/09) — pedido de Iñi: "que me lo ordenes bien,
// como un menú" — antes esta sección vivía seguida en app/admin/page.tsx,
// que se ha quedado solo como panel/dashboard con tarjetas de navegación.
// El ranking mundial que se guarda aquí es lo que usa "Mesas Drafters"
// (/admin/mesas-drafters) para calcular el precio y el grupo de la porra
// clásica de cada jugador al importar un torneo de golf o tenis — no hace
// falta volver a pegarlo por cada torneo, solo actualizarlo de vez en
// cuando.

export default function AdminRankingsPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Rankings mundiales de golf y tenis (mantenidos aparte, ver
  // drafters-schema.sql sección 4.5) — se usan para saber el puesto REAL de
  // cada inscrito al importar un torneo, en vez de asumir que el orden del
  // listado pegado ya es el ranking.
  const [rankingDeporte, setRankingDeporte] = useState<'golf' | 'tenis'>('golf');
  const [rankingConteos, setRankingConteos] = useState<Record<'golf' | 'tenis', { total: number; actualizado: string | null }>>({
    golf: { total: 0, actualizado: null },
    tenis: { total: 0, actualizado: null },
  });
  const [rankingTexto, setRankingTexto] = useState('');
  const [rankingPreview, setRankingPreview] = useState<JugadorParseado[]>([]);
  const [guardandoRanking, setGuardandoRanking] = useState(false);
  const [resultadoRanking, setResultadoRanking] = useState<string | null>(null);
  const [errorRanking, setErrorRanking] = useState<string | null>(null);

  async function cargarRankings() {
    const [{ data: golfData }, { data: tenisData }] = await Promise.all([
      supabase.from('rankings_mundiales').select('actualizado_en').eq('deporte', 'golf').order('actualizado_en', { ascending: false }).limit(1),
      supabase.from('rankings_mundiales').select('actualizado_en').eq('deporte', 'tenis').order('actualizado_en', { ascending: false }).limit(1),
    ]);
    const [{ count: golfCount }, { count: tenisCount }] = await Promise.all([
      supabase.from('rankings_mundiales').select('id', { count: 'exact', head: true }).eq('deporte', 'golf'),
      supabase.from('rankings_mundiales').select('id', { count: 'exact', head: true }).eq('deporte', 'tenis'),
    ]);
    setRankingConteos({
      golf: { total: golfCount ?? 0, actualizado: (golfData as { actualizado_en: string }[] | null)?.[0]?.actualizado_en ?? null },
      tenis: { total: tenisCount ?? 0, actualizado: (tenisData as { actualizado_en: string }[] | null)?.[0]?.actualizado_en ?? null },
    });
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
      await cargarRankings();
    }

    cargar();
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function previsualizarRanking() {
    setResultadoRanking(null);
    setErrorRanking(null);
    setRankingPreview(parseListaJugadores(rankingTexto));
  }

  function quitarDeRankingPreview(index: number) {
    setRankingPreview((prev) => prev.filter((_, i) => i !== index));
  }

  function editarNombreRankingPreview(index: number, nombre: string) {
    setRankingPreview((prev) => prev.map((j, i) => (i === index ? { ...j, nombre } : j)));
  }

  async function guardarRanking() {
    if (rankingPreview.length === 0) return;
    setGuardandoRanking(true);
    setErrorRanking(null);
    setResultadoRanking(null);

    // reemplazar_ranking_mundial() borra e inserta en una sola transacción
    // (ver drafters-schema.sql) — sustituye SIEMPRE la lista entera de este
    // deporte, nunca hace un merge fila a fila con la anterior.
    const { error: rpcError } = await supabase.rpc('reemplazar_ranking_mundial', {
      p_deporte: rankingDeporte,
      p_jugadores: rankingPreview.map((j) => ({ nombre: j.nombre, puesto: j.rank })),
    });

    setGuardandoRanking(false);
    if (rpcError) {
      setErrorRanking('No se ha podido guardar el ranking. Inténtalo de nuevo.');
      return;
    }

    setResultadoRanking(`Ranking de ${rankingDeporte === 'golf' ? 'golf' : 'tenis'} actualizado: ${rankingPreview.length} jugadores.`);
    setRankingPreview([]);
    setRankingTexto('');
    await cargarRankings();
  }

  if (autorizado === null || !perfil) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader sinVolver />
          <div style={S.accountSection}>
            <p style={{ fontSize: 14, color: S.MUTED }}>Comprobando acceso...</p>
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
        <DraftersHeader sinVolver saldoLabel={saldoLabel} accountInitials={initials} />
        <div style={S.accountSection}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Link href="/admin" style={{ fontSize: 12, color: S.MUTED_2, textDecoration: 'none' }}>
              ← Panel de administración
            </Link>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>Ranking de jugadores</h1>
            <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>Ranking mundial de golf y tenis.</p>
          </div>

          {error && <p style={S.errorText}>{error}</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14 }}>
            <p style={{ fontSize: 12.5, color: S.MUTED_2, margin: 0, lineHeight: 1.5 }}>
              El ranking mundial que guardes aquí es lo que usa la app para calcular el precio y el grupo de la porra
              clásica de cada jugador al importar un torneo (en Mesas Drafters) — no hace falta volver a pegarlo por cada
              torneo, solo actualizarlo de vez en cuando.
            </p>

            <div style={{ display: 'flex', gap: 8 }}>
              {(['golf', 'tenis'] as const).map((d) => (
                <button key={d} type="button" onClick={() => setRankingDeporte(d)} style={S.pill(rankingDeporte === d)}>
                  {d === 'golf' ? 'Golf' : 'Tenis'} · {rankingConteos[d].total}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 11, color: S.MUTED_3 }}>
              {rankingConteos[rankingDeporte].total > 0
                ? `Guardado: ${rankingConteos[rankingDeporte].total} jugadores${
                    rankingConteos[rankingDeporte].actualizado ? ` · actualizado ${new Date(rankingConteos[rankingDeporte].actualizado!).toLocaleDateString('es-ES')}` : ''
                  }.`
                : 'Todavía no hay ranking guardado para este deporte.'}
            </span>

            <div style={S.field}>
              <span style={S.label}>Ranking mundial pegado (uno por línea, en orden de ranking)</span>
              <textarea
                value={rankingTexto}
                onChange={(e) => setRankingTexto(e.target.value)}
                placeholder={'1  Scottie Scheffler\n2  Rory McIlroy\n3  Jon Rahm\n...'}
                rows={6}
                style={{ ...S.input, fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }}
              />
            </div>
            <button type="button" onClick={previsualizarRanking} disabled={!rankingTexto.trim()} style={{ ...S.secondaryLinkButton, opacity: rankingTexto.trim() ? 1 : 0.5 }}>
              Previsualizar ranking
            </button>

            {rankingPreview.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 11, color: S.MUTED_3 }}>
                  {rankingPreview.length} jugadores detectados — al guardar, sustituye por completo el ranking de {rankingDeporte === 'golf' ? 'golf' : 'tenis'} que hubiera antes.
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                  {rankingPreview.map((j, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 28, flexShrink: 0, fontSize: 11, color: S.MUTED_3, textAlign: 'right' }}>#{j.rank}</span>
                      <input
                        value={j.nombre}
                        onChange={(e) => editarNombreRankingPreview(i, e.target.value)}
                        style={{ ...S.input, padding: '8px 10px', fontSize: 13 }}
                      />
                      <button
                        type="button"
                        onClick={() => quitarDeRankingPreview(i)}
                        aria-label="Quitar"
                        style={{ flexShrink: 0, background: 'transparent', border: `1px solid ${S.BORDER}`, borderRadius: 8, color: S.ERROR, width: 32, height: 32, cursor: 'pointer' }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={guardarRanking}
                  disabled={guardandoRanking}
                  style={{ ...S.primaryButton, marginTop: 0, opacity: guardandoRanking ? 0.7 : 1 }}
                >
                  {guardandoRanking ? 'Guardando...' : `Guardar ranking de ${rankingDeporte === 'golf' ? 'golf' : 'tenis'} (${rankingPreview.length} jugadores)`}
                </button>
              </div>
            )}
            {errorRanking && <p style={S.errorText}>{errorRanking}</p>}
            {resultadoRanking && <p style={S.infoText}>{resultadoRanking}</p>}
          </div>
        </div>
      </div>
    </main>
  );
}
