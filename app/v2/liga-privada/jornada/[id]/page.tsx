'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import MarcoV2 from '@/components/v2/MarcoV2';
import { useSesionV2 } from '@/components/v2/useSesionV2';
import Cargando from '@/components/Cargando';
import { jornadaBonita } from '@/components/v2/LigaDuelos';
import ClasificacionMesaFutbol, { type EquipoExterno } from '@/components/ClasificacionMesaFutbol';
import ClasificacionSala from '@/components/ClasificacionMesaGolf';
import ClasificacionMesaTenis from '@/components/ClasificacionMesaTenis';
import { cadaXSegundos, mensajeError } from '@/lib/v2';
import { registrarVistaClasificacion } from '@/lib/actividad';
import ClasificacionLigaPrivada, { type JornadaLP } from '@/components/v2/ClasificacionLigaPrivada';

// ============================================================================
// LIGA PRIVADA — LOS EQUIPOS DE UNA JORNADA (31/10, Iñi)
// ============================================================================
// La clasificación de siempre (equipos a la izquierda, jugadores a la derecha),
// con los equipos de los miembros de la liga en esta jornada (SQL 71).

type Fila = { id: string; liga_id: string; competicion: string; cierre: string | null; orden?: number | null; lp_ligas: { nombre: string; deporte: 'futbol' | 'golf' | 'tenis' } | { nombre: string; deporte: 'futbol' | 'golf' | 'tenis' }[] | null };
type Eq = { usuario_id: string; nombre: string; jugadores: string[]; alineacion: string | null; unido_en: string };
type Estado = 'pendiente' | 'en_juego' | 'terminada';
type Res = { usuario_id: string; nombre: string; tiene_equipo: boolean; total: number | null; puesto: number | null; puntos_liga: number | null; soy_yo: boolean };

export default function JornadaLigaPrivada() {
  const { id } = useParams<{ id: string }>();
  const { perfil, estado } = useSesionV2();
  const [j, setJ] = useState<{ ligaId: string; nombre: string; deporte: 'futbol' | 'golf' | 'tenis'; competicion: string; numero: number | null; estado: Estado; puntos: Map<string, number | null>; resultados: Res[] } | null>(null);
  const [equipos, setEquipos] = useState<Eq[] | null>(null);
  // 02/11 (Iñi): todas las jornadas de la liga, para la clasificación de la liga en directo.
  const [jornadasLiga, setJornadasLiga] = useState<JornadaLP[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (estado !== 'ok') return;
    let activo = true;
    async function cargar() {
      const { data: fila, error: e } = await supabase.from('lp_jornadas').select('id,liga_id,competicion,cierre,orden,lp_ligas(nombre,deporte)').eq('id', id).maybeSingle();
      if (!activo) return;
      if (e || !fila) return setError(mensajeError(e) || 'No se ha encontrado esta jornada.');
      const f = fila as unknown as Fila;
      const liga = Array.isArray(f.lp_ligas) ? f.lp_ligas[0] : f.lp_ligas;
      const [{ data: info }, { data: eqs }] = await Promise.all([supabase.rpc('lp_info', { p_liga: f.liga_id }), supabase.rpc('lp_equipos_jornada', { p_jornada: id })]);
      if (!activo) return;
      const todas = (info as { jornadas?: { id: string; estado: Estado; resultados: Res[] }[] } | null)?.jornadas ?? [];
      setJornadasLiga(todas as unknown as JornadaLP[]);
      const jo = todas.find((x) => x.id === id);
      setJ({ ligaId: f.liga_id, nombre: liga?.nombre ?? 'Liga privada', deporte: liga?.deporte ?? 'futbol', competicion: f.competicion, numero: f.orden ?? null, estado: jo?.estado ?? 'pendiente', puntos: new Map((jo?.resultados ?? []).map((r) => [r.usuario_id, r.puntos_liga])), resultados: jo?.resultados ?? [] });
      setEquipos((eqs as Eq[]) ?? []);
      registrarVistaClasificacion(`lp_jornada:${id}`, { modo: 'liga_privada', nombre: `${liga?.nombre ?? 'Liga privada'} · ${f.competicion}`, deporte: liga?.deporte });
    }
    void cargar();
    const parar = cadaXSegundos(() => void cargar(), 60);
    return () => {
      activo = false;
      parar();
    };
  }, [estado, id]);

  const miId = perfil?.id ?? '';
  const externos: EquipoExterno[] = (equipos ?? []).map((e) => ({ equipoId: e.usuario_id, nombre: `@${e.nombre}`, jugadores: e.jugadores, createdAt: e.unido_en }));
  const externo = { equipos: externos, misJugadores: externos.find((e) => e.equipoId === miId)?.jugadores ?? [] };
  const terminada = j?.estado === 'terminada';
  // 01/11: la pestaña "Clasificación final / Premios" de la liga: puesto, puntos del equipo y puntos de liga.
  // 02/11 (Iñi): la pestaña "Jornada" (antes "Mesa") lleva debajo la clasificación de la
  // liga en directo, y la pestaña "Liga" (antes "Premios") es esa misma clasificación.
  const premios = j ? <ClasificacionLigaPrivada ligaId={j.ligaId} jornadas={jornadasLiga} miId={miId} titulo="Clasificación de la liga" /> : null;
  const etiquetas = { etiquetaMesa: 'Jornada', etiquetaPremios: 'Liga', bajoMesa: premios };

  return (
    <MarcoV2 perfil={perfil} estado={estado} deporte={j?.deporte ?? 'futbol'} volverA={j ? `/v2/liga-privada/${j.ligaId}` : undefined}>
      {error && <p style={S.errorText}>{error}</p>}
      {!j && !error && <Cargando compacto />}
      {j && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Link href={`/v2/liga-privada/${j.ligaId}`} style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#F5C94A', textDecoration: 'none' }}>
              🔒 {j.nombre}
            </Link>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 26, color: S.TEXT }}>{j.numero ? `Jornada ${j.numero} · ` : ''}{jornadaBonita(j.competicion, j.deporte)}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: j.estado === 'en_juego' ? '#3DDC84' : S.MUTED_2 }}>{terminada ? 'Terminada' : j.estado === 'en_juego' ? '● En juego · puntos en directo' : 'Todavía no ha empezado'}</span>
          </div>
          {equipos === null ? (
            <Cargando compacto />
          ) : j.estado === 'pendiente' ? (
            <p style={{ fontSize: 13, color: S.MUTED_2 }}>Los equipos de los demás se ven cuando empiece la jornada.</p>
          ) : externos.length === 0 ? (
            <p style={{ fontSize: 13, color: S.MUTED_2 }}>Nadie hizo equipo en esta jornada.</p>
          ) : j.deporte === 'tenis' ? (
            <ClasificacionMesaTenis competicion={j.competicion} terminada={terminada} externo={externo} premios={premios} {...etiquetas} />
          ) : j.deporte === 'golf' ? (
            <ClasificacionSala
              embebido
              salaFija={{ id: j.ligaId, nombre: j.nombre, competicion: j.competicion, deporte: 'golf', tipo: 'amistoso', estado: terminada ? 'finalizada' : 'abierta', buy_in: 0, aforo: externos.length, fecha_limite_inscripcion: null, tramo: null }}
              externo={externo}
              premios={premios}
              {...etiquetas}
            />
          ) : (
            <ClasificacionMesaFutbol
              embebido
              sala={{ id: j.ligaId, nombre: j.nombre, competicion: j.competicion, tipo: 'amistoso', estado: terminada ? 'finalizada' : 'abierta', buy_in: 0, aforo: externos.length, fecha_limite_inscripcion: null, tramo: null }}
              externo={externo}
              premios={premios}
              {...etiquetas}
            />
          )}
        </>
      )}
    </MarcoV2>
  );
}
